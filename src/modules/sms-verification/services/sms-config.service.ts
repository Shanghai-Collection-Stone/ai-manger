import { Inject, Injectable, Logger } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import {
  SMS_DEFAULT_TEMPLATE_PARAM_NAME,
  SMS_PLATFORM_SCOPE_ID,
  type AliyunSmsRuntimeConfig,
  type SmsSettingEntity,
  type SmsSettingInput,
  type SmsSettingView,
} from '../entities/sms-verification.entity.js';
import { SmsCryptoService } from './sms-crypto.service.js';

/**
 * @description 平台短信配置服务：保存阿里云 AccessKey、签名与模板，接口层只拿得到 Secret 掩码。
 * @keyword-cn 短信配置服务, 阿里云密钥
 * @keyword-en sms-config-service, aliyun-access-key
 */
@Injectable()
export class SmsConfigService {
  private readonly logger = new Logger(SmsConfigService.name);
  private readonly settings: Collection<SmsSettingEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly crypto: SmsCryptoService,
  ) {
    this.settings = db.collection<SmsSettingEntity>('sms_settings');
    void this.ensureIndexes();
  }

  /**
   * @description 建立配置集合索引，一个作用域只保留一行
   * @keyword-cn 配置索引, 作用域唯一
   * @keyword-en config-indexes, unique-scope
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.settings.createIndex(
      { scopeId: 1 },
      { unique: true, name: 'sms_setting_scope_unique' },
    );
  }

  /**
   * @description 读取配置页视图，Secret 只回尾 4 位掩码
   * @keyword-cn 读取短信配置, 密钥掩码
   * @keyword-en read-sms-setting, masked-secret
   * @returns {Promise<SmsSettingView>} 配置页视图。
   */
  async getView(): Promise<SmsSettingView> {
    const doc = await this.findPlatform();
    const secret = this.crypto.decrypt(doc?.accessKeySecret);
    return {
      provider: doc?.provider ?? 'aliyun',
      enabled: Boolean(doc?.enabled),
      accessKeyId: doc?.accessKeyId ?? '',
      hasAccessKeySecret: Boolean(secret),
      accessKeySecretMasked: this.mask(secret),
      signName: doc?.signName ?? '',
      templateCode: doc?.templateCode ?? '',
      templateParamName:
        doc?.templateParamName || SMS_DEFAULT_TEMPLATE_PARAM_NAME,
      ready: Boolean(doc?.enabled && this.toRuntime(doc, secret)),
      mockMode: this.isMockMode(),
      updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : undefined,
    };
  }

  /**
   * @description 保存平台短信配置；Secret 空串清空、不传保持不变，配置页无需回填明文
   * @keyword-cn 保存短信配置, 密钥更新
   * @keyword-en save-sms-setting, update-secret
   * @param input 待写入字段。
   * @param operatorId 操作人后台用户 ID。
   * @returns {Promise<SmsSettingView>} 保存后的配置页视图。
   */
  async save(
    input: SmsSettingInput,
    operatorId: string,
  ): Promise<SmsSettingView> {
    const now = new Date();
    const set: Record<string, unknown> = {
      provider: 'aliyun',
      updatedAt: now,
      updatedBy: operatorId,
    };
    const unset: Record<string, ''> = {};
    const setOnInsert: Record<string, unknown> = {
      _id: new ObjectId(),
      scopeId: SMS_PLATFORM_SCOPE_ID,
      createdAt: now,
    };
    if (typeof input.enabled === 'boolean') set.enabled = input.enabled;
    else setOnInsert.enabled = false;
    for (const key of [
      'accessKeyId',
      'signName',
      'templateCode',
      'templateParamName',
    ] as const) {
      const value = input[key];
      if (typeof value === 'string') set[key] = value.trim();
    }
    if (typeof input.accessKeySecret === 'string') {
      const trimmed = input.accessKeySecret.trim();
      if (trimmed) set.accessKeySecret = this.crypto.encrypt(trimmed);
      else unset.accessKeySecret = '';
    }
    await this.settings.updateOne(
      { scopeId: SMS_PLATFORM_SCOPE_ID },
      {
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        $setOnInsert: setOnInsert,
      },
      { upsert: true },
    );
    this.logger.log(
      `[save] operator=${operatorId} secret=${
        typeof input.accessKeySecret === 'string'
          ? input.accessKeySecret.trim()
            ? 'set'
            : 'cleared'
          : 'kept'
      }`,
    );
    return this.getView();
  }

  /**
   * @description 解析真实发送使用的明文配置；默认要求已启用，后台测试发送可忽略启用开关
   * @keyword-cn 解析发送配置, 启用开关
   * @keyword-en resolve-sms-runtime, enabled-switch
   * @param options.requireEnabled 是否要求配置已启用，默认 true。
   * @returns {Promise<AliyunSmsRuntimeConfig | null>} 配置不全或未启用时为 null。
   */
  async resolveRuntime(
    options: { requireEnabled?: boolean } = {},
  ): Promise<AliyunSmsRuntimeConfig | null> {
    const doc = await this.findPlatform();
    if (!doc) return null;
    if ((options.requireEnabled ?? true) && !doc.enabled) return null;
    return this.toRuntime(doc, this.crypto.decrypt(doc.accessKeySecret));
  }

  /**
   * @description 是否处于本地模拟模式：`SMS_VERIFICATION_MOCK=true` 且非生产环境时验证码只打日志不真实发送
   * @keyword-cn 模拟发送模式, 本地调试
   * @keyword-en sms-mock-mode, local-debug
   * @returns {boolean} 是否模拟发送。
   */
  isMockMode(): boolean {
    return (
      String(process.env.SMS_VERIFICATION_MOCK ?? '').trim() === 'true' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  /**
   * @description 把配置文档与 Secret 明文组装成运行配置，必填项缺失返回 null
   * @keyword-cn 组装运行配置, 必填校验
   * @keyword-en build-runtime-config, required-fields
   * @param doc 配置文档。
   * @param secret Secret 明文。
   * @returns {AliyunSmsRuntimeConfig | null} 运行配置。
   */
  private toRuntime(
    doc: SmsSettingEntity,
    secret: string,
  ): AliyunSmsRuntimeConfig | null {
    const accessKeyId = String(doc.accessKeyId ?? '').trim();
    const signName = String(doc.signName ?? '').trim();
    const templateCode = String(doc.templateCode ?? '').trim();
    if (!accessKeyId || !secret || !signName || !templateCode) return null;
    return {
      accessKeyId,
      accessKeySecret: secret,
      signName,
      templateCode,
      templateParamName:
        String(doc.templateParamName ?? '').trim() ||
        SMS_DEFAULT_TEMPLATE_PARAM_NAME,
    };
  }

  /**
   * @description 读取平台作用域配置文档
   * @keyword-cn 读取平台配置
   * @keyword-en find-platform-setting
   * @returns {Promise<SmsSettingEntity | null>} 配置文档。
   */
  private findPlatform(): Promise<SmsSettingEntity | null> {
    return this.settings.findOne({ scopeId: SMS_PLATFORM_SCOPE_ID });
  }

  /**
   * @description 把 Secret 掩码成只剩尾 4 位
   * @keyword-cn 密钥掩码, 尾号展示
   * @keyword-en mask-secret, tail-digits
   * @param secret Secret 明文。
   * @returns {string} 掩码串；无 Secret 时为空串。
   */
  private mask(secret: string): string {
    if (!secret) return '';
    if (secret.length <= 4) return '****';
    return `****${secret.slice(-4)}`;
  }
}
