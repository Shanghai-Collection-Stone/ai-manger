import { Inject, Injectable, Logger } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  TikhubConfigEntity,
  TikhubConfigScope,
  TikhubConfigView,
} from '../entities/tikhub.entity.js';
import { TikhubCryptoService } from './tikhub-crypto.service.js';

/** @type {string} 未配置自定义域名时使用的默认 API 域名。 */
export const TIKHUB_DEFAULT_BASE_URL = 'https://api.tikhub.io';

/** @type {string[]} 允许写入的 API 域名白名单，避免把 Key 发到任意第三方地址。 */
export const TIKHUB_ALLOWED_BASE_URLS = [
  'https://api.tikhub.io',
  'https://api.tikhub.dev',
];

/**
 * @description TikHub 平台配置服务：按「租户 + 后台用户」保存 API Key 与 API 域名，
 *   读取时可回落到同租户其他配置或环境变量 TIKHUB_API_KEY，接口层永远只拿得到掩码。
 * @keyword-cn TikHub配置服务, 密钥读写
 * @keyword-en tikhub-config-service, api-key-crud
 */
@Injectable()
export class TikhubConfigService {
  private readonly logger = new Logger(TikhubConfigService.name);
  private readonly configs: Collection<TikhubConfigEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly crypto: TikhubCryptoService,
  ) {
    this.configs = db.collection<TikhubConfigEntity>('tikhub_configs');
    void this.ensureIndexes();
  }

  /**
   * @description 建立配置集合索引，一个「租户 + 用户」作用域只保留一行。
   * @keyword-cn 配置索引, 作用域唯一
   * @keyword-en config-indexes, unique-scope
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.configs.createIndex(
      { tenantId: 1, userId: 1 },
      { unique: true, name: 'tikhub_config_scope_unique' },
    );
  }

  /**
   * @description 读取配置页要展示的视图，只回掩码后的 Key 尾号。
   * @keyword-cn 读取配置视图, 密钥掩码
   * @keyword-en read-config-view, masked-api-key
   * @param scope 当前租户与用户作用域。
   * @returns {Promise<TikhubConfigView>} 配置页视图。
   */
  async getView(scope: TikhubConfigScope): Promise<TikhubConfigView> {
    const doc = await this.findScoped(scope);
    const fromConfig = this.crypto.decrypt(doc?.apiKey);
    const fromEnv = String(process.env.TIKHUB_API_KEY ?? '').trim();
    const apiKey = fromConfig || fromEnv;
    return {
      hasApiKey: Boolean(apiKey),
      apiKeyMasked: this.mask(apiKey),
      apiKeySource: fromConfig ? 'config' : fromEnv ? 'env' : 'none',
      baseUrl: this.normalizeBaseUrl(doc?.baseUrl),
      updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : undefined,
    };
  }

  /**
   * @description 保存 API Key 与 API 域名。`apiKey` 传空串表示清空，传 undefined 表示保持不变，
   *   这样配置页可以只改域名而不必把 Key 再填一遍。
   * @keyword-cn 保存配置, 密钥更新
   * @keyword-en save-config, update-api-key
   * @param scope 当前租户与用户作用域。
   * @param input 待写入的 Key 与域名。
   * @returns {Promise<TikhubConfigView>} 保存后的配置页视图。
   */
  async save(
    scope: TikhubConfigScope,
    input: { apiKey?: string; baseUrl?: string },
  ): Promise<TikhubConfigView> {
    const filter = this.scopeFilter(scope);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const unset: Record<string, ''> = {};
    if (typeof input.apiKey === 'string') {
      const trimmed = input.apiKey.trim();
      if (trimmed) set.apiKey = this.crypto.encrypt(trimmed);
      else unset.apiKey = '';
    }
    if (typeof input.baseUrl === 'string') {
      set.baseUrl = this.normalizeBaseUrl(input.baseUrl);
    }
    await this.configs.updateOne(
      filter,
      {
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        $setOnInsert: { _id: new ObjectId(), ...filter },
      },
      { upsert: true },
    );
    this.logger.log(
      `[save] tenantId=${filter.tenantId ?? 'null'} userId=${filter.userId} apiKey=${
        typeof input.apiKey === 'string'
          ? input.apiKey.trim()
            ? 'set'
            : 'cleared'
          : 'kept'
      }`,
    );
    return this.getView(scope);
  }

  /**
   * @description 解析采集时真正要用的 API Key：本作用域 → 同租户任意配置 → 环境变量。
   *   调度器用的是选题归属用户，配置页填在管理员名下也要能生效，所以必须有租户级回落。
   * @keyword-cn 解析生效密钥, 租户回落
   * @keyword-en resolve-effective-key, tenant-fallback
   * @param scope 当前租户与用户作用域。
   * @returns {Promise<string>} API Key 明文；没有任何配置时为空串。
   */
  async resolveApiKey(scope: TikhubConfigScope): Promise<string> {
    const doc = await this.findScoped(scope);
    const fromConfig = this.crypto.decrypt(doc?.apiKey);
    if (fromConfig) return fromConfig;
    return String(process.env.TIKHUB_API_KEY ?? '').trim();
  }

  /**
   * @description 解析采集时使用的 API 域名，国内部署可在配置页切到 api.tikhub.dev。
   * @keyword-cn 解析API域名, 国内直连
   * @keyword-en resolve-base-url, mainland-endpoint
   * @param scope 当前租户与用户作用域。
   * @returns {Promise<string>} 生效的 API 域名。
   */
  async resolveBaseUrl(scope: TikhubConfigScope): Promise<string> {
    const doc = await this.findScoped(scope);
    return this.normalizeBaseUrl(doc?.baseUrl);
  }

  /**
   * @description 按作用域取配置：优先精确匹配，其次回落到同租户最近更新的一份。
   * @keyword-cn 作用域查询, 同租户回落
   * @keyword-en scoped-lookup, tenant-wide-fallback
   * @param scope 当前租户与用户作用域。
   * @returns {Promise<TikhubConfigEntity | null>} 命中的配置文档。
   */
  private async findScoped(
    scope: TikhubConfigScope,
  ): Promise<TikhubConfigEntity | null> {
    const filter = this.scopeFilter(scope);
    const exact = await this.configs.findOne(filter);
    if (exact?.apiKey) return exact;
    const tenantWide = await this.configs
      .find({ tenantId: filter.tenantId, apiKey: { $exists: true } })
      .sort({ updatedAt: -1 })
      .limit(1)
      .next();
    return tenantWide ?? exact;
  }

  /**
   * @description 构造强制作用域过滤，空 tenantId 统一收口成 null，避免出现两种空值。
   * @keyword-cn 作用域过滤, 空值归一
   * @keyword-en scope-filter, null-normalization
   * @param scope 当前租户与用户作用域。
   * @returns {{ tenantId: string | null; userId: string }} 归一化后的过滤条件。
   */
  private scopeFilter(scope: TikhubConfigScope): {
    tenantId: string | null;
    userId: string;
  } {
    return {
      tenantId: String(scope.tenantId ?? '').trim() || null,
      userId: scope.userId,
    };
  }

  /**
   * @description 把域名收敛到白名单，写入非法值时回落默认域名，防止 Key 被发往任意地址。
   * @keyword-cn 域名白名单, 防止外发
   * @keyword-en base-url-allowlist, exfiltration-guard
   * @param value 待校验的域名。
   * @returns {string} 白名单内的域名。
   */
  private normalizeBaseUrl(value?: string): string {
    const trimmed = String(value ?? '')
      .trim()
      .replace(/\/+$/, '');
    if (TIKHUB_ALLOWED_BASE_URLS.includes(trimmed)) return trimmed;
    const fromEnv = String(process.env.TIKHUB_BASE_URL ?? '')
      .trim()
      .replace(/\/+$/, '');
    if (!trimmed && TIKHUB_ALLOWED_BASE_URLS.includes(fromEnv)) return fromEnv;
    return TIKHUB_DEFAULT_BASE_URL;
  }

  /**
   * @description 把 API Key 掩码成只剩尾 4 位，接口和日志都只能看到这个形态。
   * @keyword-cn 密钥掩码, 尾号展示
   * @keyword-en mask-api-key, tail-digits
   * @param apiKey API Key 明文。
   * @returns {string} 掩码串；无 Key 时为空串。
   */
  private mask(apiKey: string): string {
    if (!apiKey) return '';
    if (apiKey.length <= 4) return '****';
    return `****${apiKey.slice(-4)}`;
  }
}
