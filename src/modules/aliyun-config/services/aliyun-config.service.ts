import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import {
  onClusterMessage,
  sendClusterMessage,
} from '../../cluster-runtime/services/cluster-ipc.js';
import {
  ALIYUN_CONFIG_CHANGED_MESSAGE,
  ALIYUN_PLATFORM_SCOPE_ID,
  type AliyunCredential,
  type AliyunOssProbeResult,
  type AliyunOssRuntimeConfig,
  type AliyunOssSetting,
  type AliyunOssSettingDocument,
  type AliyunSettingEntity,
  type AliyunSettingInput,
  type AliyunSettingView,
} from '../entities/aliyun-config.entity.js';
import { AliyunConfigCryptoService } from './aliyun-config-crypto.service.js';

/**
 * @description 配置缓存的兜底刷新间隔：多进程广播丢了也能在这个时间内追上最新配置。
 * @keyword-cn 配置刷新间隔, 兜底刷新
 * @keyword-en setting-refresh-interval, fallback-refresh
 */
export const ALIYUN_CONFIG_REFRESH_MS = 60_000;

/**
 * @description 规整 OSS 地域：去空白与协议，缺 `oss-` 前缀时补上（`cn-shanghai` → `oss-cn-shanghai`），
 *   因为默认 endpoint 是 `<region>.aliyuncs.com`。
 * @keyword-cn 规整OSS地域, 补地域前缀
 * @keyword-en normalize-oss-region, region-prefix
 * @param value 输入地域。
 * @returns {string} 规整后的地域，空输入返回空串。
 */
export function normalizeOssRegion(value?: string): string {
  const region = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.aliyuncs\.com.*$/, '');
  if (!region) return '';
  return region.startsWith('oss-') ? region : `oss-${region}`;
}

/**
 * @description 规整 endpoint：去协议与尾部斜杠；为空时按地域推导 `<region>.aliyuncs.com`。
 * @keyword-cn 规整OSS地址, 地域推导
 * @keyword-en normalize-oss-endpoint, derive-from-region
 * @param endpoint 输入 endpoint。
 * @param region 规整后的地域。
 * @returns {string} endpoint，推导不出时为空串。
 */
export function resolveOssEndpoint(endpoint: string, region: string): string {
  const cleaned = String(endpoint ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return cleaned || (region ? `${region}.aliyuncs.com` : '');
}

/**
 * @description 环境变量里的 OSS 配置是否齐全（后台没配时对象存储回落到它）。
 * @keyword-cn 环境变量OSS配置, 兜底配置
 * @keyword-en env-oss-configured, fallback-config
 * @returns {{configured: boolean, bucket: string, endpoint: string, publicBaseUrl: string, rootDir: string}} 环境变量配置摘要。
 */
export function readEnvOssSummary(): {
  configured: boolean;
  bucket: string;
  endpoint: string;
  publicBaseUrl: string;
  rootDir: string;
} {
  const bucket = String(process.env.OSS_BUCKET ?? '').trim();
  const endpoint = resolveOssEndpoint(
    String(process.env.OSS_ENDPOINT ?? ''),
    normalizeOssRegion(process.env.OSS_REGION),
  );
  return {
    configured: Boolean(
      bucket &&
      endpoint &&
      String(process.env.OSS_ACCESS_KEY_ID ?? '').trim() &&
      String(process.env.OSS_ACCESS_KEY_SECRET ?? '').trim(),
    ),
    bucket,
    endpoint,
    publicBaseUrl: String(process.env.OSS_PUBLIC_BASE_URL ?? '')
      .trim()
      .replace(/\/+$/, ''),
    rootDir: String(process.env.OSS_VIDEO_LIBRARY_DIR ?? '').trim(),
  };
}

/**
 * @description 阿里云配置服务：保存 OSS 设置与 OSS 专用 AccessKey（Secret 加密落库），供对象存储使用；
 *   短信的 AccessKey 可能属于另一个阿里云账号，由短信模块自己保存，不在这里。
 *   配置缓存在进程内，读取是同步的；保存后本进程立即重载，并广播让其他 worker 重载，另有每分钟一次的兜底刷新。
 * @keyword-cn 阿里云配置服务, OSS访问密钥, OSS设置
 * @keyword-en aliyun-config-service, oss-access-key, oss-setting
 */
@Injectable()
export class AliyunConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AliyunConfigService.name);
  private readonly settings: Collection<AliyunSettingEntity>;
  private ossCredential: AliyunCredential | null = null;
  private oss: AliyunOssSetting | null = null;
  private loading: Promise<void> = Promise.resolve();
  private refreshTimer?: NodeJS.Timeout;
  private ossProbe?: () => Promise<{ ok: boolean; message?: string }>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly crypto: AliyunConfigCryptoService,
  ) {
    this.settings = db.collection<AliyunSettingEntity>('aliyun_settings');
  }

  /**
   * @description 启动：建唯一索引、加载缓存、订阅配置变更广播并开启兜底刷新。
   * @keyword-cn 启动加载配置, 订阅配置变更
   * @keyword-en load-setting-on-init, subscribe-setting-change
   */
  async onModuleInit(): Promise<void> {
    await this.settings.createIndex(
      { scopeId: 1 },
      { unique: true, name: 'aliyun_setting_scope_unique' },
    );
    await this.reload();
    onClusterMessage(ALIYUN_CONFIG_CHANGED_MESSAGE, () => {
      void this.reload();
    });
    this.refreshTimer = setInterval(
      () => void this.reload(),
      ALIYUN_CONFIG_REFRESH_MS,
    );
    this.refreshTimer.unref?.();
  }

  /**
   * @description 停止兜底刷新。
   * @keyword-cn 停止配置刷新, 定时器清理
   * @keyword-en stop-setting-refresh, timer-cleanup
   */
  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /**
   * @description 从库里重载缓存（OSS 专用密钥与 OSS 设置）；读取失败时保留上一次的缓存。
   * @keyword-cn 重载阿里云配置, 进程内缓存
   * @keyword-en reload-aliyun-setting, in-process-cache
   * @returns {Promise<void>} 重载完成。
   */
  reload(): Promise<void> {
    this.loading = (async () => {
      try {
        const oss = (await this.findPlatform())?.oss;
        const secret = this.crypto.decrypt(oss?.accessKeySecret);
        const accessKeyId = String(oss?.accessKeyId ?? '').trim();
        this.ossCredential =
          accessKeyId && secret
            ? { accessKeyId, accessKeySecret: secret }
            : null;
        this.oss = oss?.bucket ? this.normalizeOss(oss) : null;
      } catch (error) {
        this.logger.warn(
          `[reload] 读取阿里云配置失败，沿用上一次缓存: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
    return this.loading;
  }

  /**
   * @description 同步读取后台 OSS 运行配置：OSS 专用密钥、bucket、endpoint 都齐才返回，否则 null（调用方回落环境变量）。
   * @keyword-cn 读取OSS运行配置, 后台优先
   * @keyword-en read-oss-runtime-config, admin-first
   * @returns {AliyunOssRuntimeConfig | null} 运行配置。
   */
  readOssConfig(): AliyunOssRuntimeConfig | null {
    if (!this.ossCredential || !this.oss?.bucket || !this.oss.endpoint) {
      return null;
    }
    return { ...this.oss, ...this.ossCredential };
  }

  /**
   * @description 由对象存储服务注册 OSS 自检函数（写入并删除一个小对象），后台「测试 OSS」调用它；
   *   这样本模块不反向依赖对象存储模块。
   * @keyword-cn 注册OSS自检, 反向解耦
   * @keyword-en register-oss-probe, dependency-inversion
   * @param probe 自检函数。
   */
  registerOssProbe(
    probe: () => Promise<{ ok: boolean; message?: string }>,
  ): void {
    this.ossProbe = probe;
  }

  /**
   * @description 用当前生效的 OSS 配置写入并删除一个小对象，检查密钥、bucket 与地域是否可用（查不到跨域规则）。
   * @keyword-cn 测试OSS, 写入测试
   * @keyword-en probe-oss, write-test
   * @returns {Promise<AliyunOssProbeResult>} 自检结果。
   */
  async probeOss(): Promise<AliyunOssProbeResult> {
    await this.loading;
    const source = this.effectiveOssSource();
    if (source === 'none') {
      return { ok: false, source, message: 'OSS_NOT_CONFIGURED' };
    }
    if (!this.ossProbe) {
      return { ok: false, source, message: 'OSS_PROBE_UNAVAILABLE' };
    }
    const result = await this.ossProbe();
    return { ...result, source };
  }

  /**
   * @description 读取配置页视图：OSS 专用 Secret 只回掩码，并标出当前生效来源与访问地址前缀。
   * @keyword-cn 读取阿里云配置, 密钥掩码
   * @keyword-en read-aliyun-setting, masked-secret
   * @returns {Promise<AliyunSettingView>} 配置页视图。
   */
  async getView(): Promise<AliyunSettingView> {
    const doc = await this.findPlatform();
    const secret = this.crypto.decrypt(doc?.oss?.accessKeySecret);
    const source = this.effectiveOssSource();
    return {
      oss: {
        ...this.normalizeOss(doc?.oss ?? {}),
        accessKeyId: doc?.oss?.accessKeyId ?? '',
        hasAccessKeySecret: Boolean(secret),
        accessKeySecretMasked: this.mask(secret),
        effectiveSource: source,
        publicUrlPrefix: this.publicUrlPrefix(source),
      },
      updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : undefined,
    };
  }

  /**
   * @description 保存 OSS 设置与 OSS 专用密钥：只更新传入字段，Secret 空串清空、不传保持不变。
   *   保存后本进程立即重载，并广播让其他 worker 重载。
   * @keyword-cn 保存阿里云配置, 配置变更广播
   * @keyword-en save-aliyun-setting, setting-changed-broadcast
   * @param input 待写入字段。
   * @param operatorId 操作人后台用户 ID。
   * @returns {Promise<AliyunSettingView>} 保存后的配置页视图。
   */
  async save(
    input: AliyunSettingInput,
    operatorId: string,
  ): Promise<AliyunSettingView> {
    const now = new Date();
    const set: Record<string, unknown> = {
      updatedAt: now,
      updatedBy: operatorId,
    };
    const secretInput = input.oss?.accessKeySecret;
    if (input.oss) {
      const { accessKeyId, accessKeySecret, ...fields } = input.oss;
      const current = (await this.findPlatform())?.oss ?? {};
      // DTO 类字段未传时也是 undefined 自有属性，先滤掉，避免只清空 Secret 时把其余设置覆盖成空
      const next: AliyunOssSettingDocument = this.normalizeOss({
        ...current,
        ...Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined),
        ),
      });
      const keyId =
        typeof accessKeyId === 'string'
          ? accessKeyId.trim()
          : current.accessKeyId;
      if (keyId) next.accessKeyId = keyId;
      const secret =
        typeof accessKeySecret === 'string'
          ? accessKeySecret.trim()
            ? this.crypto.encrypt(accessKeySecret.trim())
            : undefined
          : current.accessKeySecret;
      if (secret) next.accessKeySecret = secret;
      set.oss = next;
    }
    await this.settings.updateOne(
      { scopeId: ALIYUN_PLATFORM_SCOPE_ID },
      {
        $set: set,
        $setOnInsert: {
          _id: new ObjectId(),
          scopeId: ALIYUN_PLATFORM_SCOPE_ID,
          createdAt: now,
        },
      },
      { upsert: true },
    );
    await this.reload();
    sendClusterMessage({ type: ALIYUN_CONFIG_CHANGED_MESSAGE, target: 'all' });
    this.logger.log(
      `[save] operator=${operatorId} ossSecret=${
        typeof secretInput === 'string'
          ? secretInput.trim()
            ? 'set'
            : 'cleared'
          : 'kept'
      } oss=${input.oss ? 'updated' : 'kept'}`,
    );
    return this.getView();
  }

  /**
   * @description 当前生效的 OSS 配置来源：后台齐全用后台，否则环境变量齐全用环境变量，都没有为未配置。
   * @keyword-cn OSS生效来源, 后台优先
   * @keyword-en effective-oss-source, admin-first
   */
  private effectiveOssSource(): 'admin' | 'env' | 'none' {
    if (this.readOssConfig()) return 'admin';
    return readEnvOssSummary().configured ? 'env' : 'none';
  }

  /**
   * @description 按生效来源拼对象访问地址前缀（到根目录为止），便于在配置页核对域名与目录。
   * @keyword-cn 访问地址前缀, 域名核对
   * @keyword-en public-url-prefix, domain-check
   */
  private publicUrlPrefix(source: 'admin' | 'env' | 'none'): string {
    const setting =
      source === 'admin'
        ? this.oss
        : source === 'env'
          ? readEnvOssSummary()
          : null;
    if (!setting?.bucket || !setting.endpoint) return '';
    const base =
      setting.publicBaseUrl || `https://${setting.bucket}.${setting.endpoint}`;
    return `${base}/${setting.rootDir || 'video-library'}/`;
  }

  /**
   * @description 规整 OSS 设置：地域补前缀、endpoint 去协议并可按地域推导、访问域名去尾斜杠、根目录去首尾斜杠。
   * @keyword-cn 规整OSS设置, 地域推导
   * @keyword-en normalize-oss-setting, derive-from-region
   */
  private normalizeOss(input: Partial<AliyunOssSetting>): AliyunOssSetting {
    const region = normalizeOssRegion(input.region);
    return {
      region,
      bucket: String(input.bucket ?? '')
        .trim()
        .toLowerCase(),
      endpoint: resolveOssEndpoint(String(input.endpoint ?? ''), region),
      publicBaseUrl: String(input.publicBaseUrl ?? '')
        .trim()
        .replace(/\/+$/, ''),
      rootDir: String(input.rootDir ?? '')
        .trim()
        .replace(/^\/+|\/+$/g, ''),
    };
  }

  /**
   * @description 读取平台作用域配置文档。
   * @keyword-cn 读取平台配置
   * @keyword-en find-platform-setting
   */
  private findPlatform(): Promise<AliyunSettingEntity | null> {
    return this.settings.findOne({ scopeId: ALIYUN_PLATFORM_SCOPE_ID });
  }

  /**
   * @description 把 Secret 掩码成只剩尾 4 位。
   * @keyword-cn 密钥掩码, 尾号展示
   * @keyword-en mask-secret, tail-digits
   */
  private mask(secret: string): string {
    if (!secret) return '';
    if (secret.length <= 4) return '****';
    return `****${secret.slice(-4)}`;
  }
}
