import type { Request } from 'express';
import type { ObjectId } from 'mongodb';

/**
 * @description 允许发送验证码的业务场景白名单；新增需要验证码的接口时先在此登记场景值
 * @keyword-cn 验证码场景, 场景白名单
 * @keyword-en sms-scene, scene-allowlist
 */
export const SMS_VERIFICATION_SCENES = ['register'] as const;

/**
 * @description 验证码业务场景类型
 * @keyword-cn 验证码场景类型
 * @keyword-en sms-scene-type
 */
export type SmsVerificationScene = (typeof SMS_VERIFICATION_SCENES)[number];

/**
 * @description `@RequireSmsCode` 写入的场景元数据 key
 * @keyword-cn 验证码元数据键
 * @keyword-en require-sms-code-metadata-key
 */
export const REQUIRE_SMS_CODE_KEY = 'sms-verification:require-sms-code';

/**
 * @description 平台级短信配置作用域占位符（全平台一份）
 * @keyword-cn 平台作用域, 短信配置
 * @keyword-en platform-scope, sms-setting
 */
export const SMS_PLATFORM_SCOPE_ID = '__platform__';

/**
 * @description 阿里云短信模板变量名缺省值
 * @keyword-cn 模板变量名, 缺省值
 * @keyword-en template-param-name, default-value
 */
export const SMS_DEFAULT_TEMPLATE_PARAM_NAME = 'code';

/**
 * @description 验证码有效期（秒）
 * @keyword-cn 验证码有效期
 * @keyword-en sms-code-ttl
 */
export const SMS_CODE_TTL_SECONDS = 300;

/**
 * @description 同一手机号同一场景的最短重发间隔（秒）
 * @keyword-cn 重发间隔, 发送频控
 * @keyword-en resend-interval, send-throttle
 */
export const SMS_RESEND_INTERVAL_SECONDS = 60;

/**
 * @description 单手机号 24 小时内最多发送次数
 * @keyword-cn 手机号日限额, 发送频控
 * @keyword-en phone-daily-limit, send-throttle
 */
export const SMS_PHONE_DAILY_LIMIT = 10;

/**
 * @description 单 IP 1 小时内最多发送次数
 * @keyword-cn IP小时限额, 发送频控
 * @keyword-en ip-hourly-limit, send-throttle
 */
export const SMS_IP_HOURLY_LIMIT = 30;

/**
 * @description 单条验证码最多校验次数（含正确那次），超过即作废
 * @keyword-cn 校验次数上限, 防爆破
 * @keyword-en max-verify-attempts, brute-force-guard
 */
export const SMS_CODE_MAX_ATTEMPTS = 5;

/**
 * @description 短信服务商，当前仅阿里云
 * @keyword-cn 短信服务商
 * @keyword-en sms-provider
 */
export type SmsProvider = 'aliyun';

/**
 * @description AccessKey Secret 落库信封，`aes-256-gcm` 密文或无加密密钥时的 `plain` 明文
 * @keyword-cn 密钥信封, 加密存储
 * @keyword-en secret-envelope, encrypted-storage
 */
export type SmsSecretEnvelope =
  | { algorithm: 'plain'; value: string }
  | {
      algorithm: 'aes-256-gcm';
      keyVersion: number;
      iv: string;
      authTag: string;
      ciphertext: string;
    };

/**
 * @description 平台短信配置文档，集合 `sms_settings`，`scopeId` 唯一
 * @keyword-cn 短信配置实体
 * @keyword-en sms-setting-entity
 */
export interface SmsSettingEntity {
  _id: ObjectId;
  scopeId: string;
  provider: SmsProvider;
  enabled: boolean;
  accessKeyId?: string;
  accessKeySecret?: SmsSecretEnvelope;
  signName?: string;
  templateCode?: string;
  templateParamName?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 短信配置保存入参；`accessKeySecret` 空串清空、undefined 保持不变
 * @keyword-cn 短信配置入参
 * @keyword-en sms-setting-input
 */
export interface SmsSettingInput {
  enabled?: boolean;
  accessKeyId?: string;
  accessKeySecret?: string;
  signName?: string;
  templateCode?: string;
  templateParamName?: string;
}

/**
 * @description 配置页视图，Secret 只回掩码
 * @keyword-cn 短信配置视图, 密钥掩码
 * @keyword-en sms-setting-view, masked-secret
 */
export interface SmsSettingView {
  provider: SmsProvider;
  enabled: boolean;
  accessKeyId: string;
  hasAccessKeySecret: boolean;
  accessKeySecretMasked: string;
  signName: string;
  templateCode: string;
  templateParamName: string;
  /** 配置齐全且已启用，可真实发送 */
  ready: boolean;
  /** 是否处于 SMS_VERIFICATION_MOCK 本地模拟模式 */
  mockMode: boolean;
  updatedAt?: string;
}

/**
 * @description 调用阿里云短信所需的明文运行配置
 * @keyword-cn 阿里云运行配置
 * @keyword-en aliyun-runtime-config
 */
export interface AliyunSmsRuntimeConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  templateParamName: string;
}

/**
 * @description 验证码记录，集合 `sms_verification_codes`，过期 24 小时后由 TTL 索引清理
 * @keyword-cn 验证码记录
 * @keyword-en sms-code-entity
 */
export interface SmsCodeEntity {
  _id: ObjectId;
  phone: string;
  scene: SmsVerificationScene;
  codeHash: string;
  ip: string;
  attempts: number;
  providerBizId?: string;
  consumedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * @description 守卫校验通过后挂到请求上的上下文
 * @keyword-cn 验证通过上下文
 * @keyword-en sms-verified-context
 */
export interface SmsVerifiedContext {
  codeId: string;
  phone: string;
  scene: SmsVerificationScene;
}

/**
 * @description 携带短信验证上下文的请求类型，业务接口从 `smsVerification.phone` 读取已验证手机号
 * @keyword-cn 已验证请求, 可信手机号
 * @keyword-en sms-verified-request, trusted-phone
 */
export interface SmsVerifiedRequest extends Request {
  smsVerification?: SmsVerifiedContext;
}
