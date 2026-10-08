import { Inject, Injectable, Logger } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import {
  MAIL_PLATFORM_SCOPE_ID,
  type MailRuntimeConfig,
  type MailSettingEntity,
  type MailSettingInput,
  type MailSettingView,
} from '../entities/mail.entity.js';
import { MailCryptoService } from './mail-crypto.service.js';

/**
 * @description 平台发信邮箱配置服务，负责 SMTP 配置读写、密码掩码与运行配置解析
 * @keyword-cn 邮箱配置服务, SMTP配置
 * @keyword-en mail-config-service, smtp-setting
 */
@Injectable()
export class MailConfigService {
  private readonly logger = new Logger(MailConfigService.name);
  private readonly settings: Collection<MailSettingEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly crypto: MailCryptoService,
  ) {
    this.settings = db.collection<MailSettingEntity>('mail_settings');
    void this.ensureIndexes();
  }

  /**
   * @description 建立配置集合索引，一个平台作用域只保留一行
   * @keyword-cn 配置索引, 作用域唯一
   * @keyword-en config-indexes, unique-scope
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.settings.createIndex(
      { scopeId: 1 },
      { unique: true, name: 'mail_setting_scope_unique' },
    );
  }

  /**
   * @description 读取发信邮箱配置页视图，密码只回尾四位掩码
   * @keyword-cn 读取邮箱配置, 密码掩码
   * @keyword-en read-mail-setting, masked-password
   * @returns {Promise<MailSettingView>} 配置页视图。
   */
  async getView(): Promise<MailSettingView> {
    const doc = await this.findPlatform();
    const password = this.crypto.decrypt(doc?.passwordEnvelope);
    return {
      enabled: Boolean(doc?.enabled),
      host: doc?.host ?? '',
      port: doc?.port ?? 465,
      secure: doc?.secure ?? true,
      username: doc?.username ?? '',
      hasPassword: Boolean(password),
      passwordMasked: this.mask(password),
      fromAddress: doc?.fromAddress ?? '',
      fromName: doc?.fromName ?? '',
      ready: Boolean(doc?.enabled && this.toRuntime(doc, password)),
      mockMode: this.isMockMode(),
      updatedAt: doc?.updatedAt?.toISOString() ?? null,
    };
  }

  /**
   * @description 保存平台 SMTP 配置，密码空串清空、不传保持不变
   * @keyword-cn 保存邮箱配置, 密码更新
   * @keyword-en save-mail-setting, update-password
   * @param input 待写入配置。
   * @param operatorId 操作人后台用户 ID。
   * @returns {Promise<MailSettingView>} 保存后的配置页视图。
   */
  async save(
    input: MailSettingInput,
    operatorId: string,
  ): Promise<MailSettingView> {
    const now = new Date();
    const set: Record<string, unknown> = {
      enabled: input.enabled,
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      username: input.username.trim(),
      fromAddress: input.fromAddress.trim(),
      fromName: String(input.fromName ?? '').trim(),
      updatedAt: now,
      updatedBy: operatorId,
    };
    const unset: Record<string, ''> = {};
    if (typeof input.password === 'string') {
      if (input.password) {
        set.passwordEnvelope = this.crypto.encrypt(input.password);
      } else unset.passwordEnvelope = '';
    }
    await this.settings.updateOne(
      { scopeId: MAIL_PLATFORM_SCOPE_ID },
      {
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        $setOnInsert: {
          _id: new ObjectId(),
          scopeId: MAIL_PLATFORM_SCOPE_ID,
          createdAt: now,
        },
      },
      { upsert: true },
    );
    this.logger.log(
      `[save] operator=${operatorId} password=${
        typeof input.password === 'string'
          ? input.password
            ? 'set'
            : 'cleared'
          : 'kept'
      }`,
    );
    return this.getView();
  }

  /**
   * @description 解析明文 SMTP 运行配置，默认要求已启用，测试发信可忽略开关
   * @keyword-cn 解析发信配置, 启用开关
   * @keyword-en resolve-mail-runtime, enabled-switch
   * @param options.requireEnabled 是否要求配置已启用，默认 true。
   * @returns {Promise<MailRuntimeConfig | null>} 配置不全或未启用时为 null。
   */
  async resolveRuntime(
    options: { requireEnabled?: boolean } = {},
  ): Promise<MailRuntimeConfig | null> {
    const doc = await this.findPlatform();
    if (!doc) return null;
    if ((options.requireEnabled ?? true) && !doc.enabled) return null;
    return this.toRuntime(doc, this.crypto.decrypt(doc.passwordEnvelope));
  }

  /**
   * @description 判断是否为非生产环境的邮件模拟发送模式
   * @keyword-cn 模拟发信模式, 本地调试
   * @keyword-en mail-mock-mode, local-debug
   * @returns {boolean} 是否模拟发信。
   */
  isMockMode(): boolean {
    return (
      String(process.env.MAIL_MOCK ?? '').trim() === 'true' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  /**
   * @description 把配置文档与密码组装成运行配置，必填项缺失时返回 null
   * @keyword-cn 组装发信配置, 必填校验
   * @keyword-en build-runtime-config, required-fields
   * @param doc 配置文档。
   * @param password SMTP 密码明文。
   * @returns {MailRuntimeConfig | null} SMTP 运行配置。
   */
  private toRuntime(
    doc: MailSettingEntity,
    password: string,
  ): MailRuntimeConfig | null {
    const host = String(doc.host ?? '').trim();
    const username = String(doc.username ?? '').trim();
    const fromAddress = String(doc.fromAddress ?? '').trim();
    const port = Number(doc.port);
    if (
      !host ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !username ||
      !password ||
      !fromAddress
    ) {
      return null;
    }
    return {
      host,
      port,
      secure: Boolean(doc.secure),
      username,
      password,
      fromAddress,
      fromName: String(doc.fromName ?? '').trim(),
      version: doc.updatedAt.toISOString(),
    };
  }

  /**
   * @description 读取平台作用域发信邮箱配置文档
   * @keyword-cn 读取平台配置
   * @keyword-en find-platform-setting
   * @returns {Promise<MailSettingEntity | null>} 配置文档。
   */
  private findPlatform(): Promise<MailSettingEntity | null> {
    return this.settings.findOne({ scopeId: MAIL_PLATFORM_SCOPE_ID });
  }

  /**
   * @description 把 SMTP 密码掩码成只显示尾四位
   * @keyword-cn 密码掩码, 尾号展示
   * @keyword-en mask-password, tail-digits
   * @param password SMTP 密码明文。
   * @returns {string} 掩码串；无密码时为空串。
   */
  private mask(password: string): string {
    if (!password) return '';
    if (password.length <= 4) return '****';
    return `****${password.slice(-4)}`;
  }
}
