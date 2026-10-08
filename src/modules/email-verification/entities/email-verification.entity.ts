import type { Request } from 'express';
import type { ObjectId } from 'mongodb';

/**
 * @description 允许发送邮箱验证码的业务场景白名单；新增需要邮箱验证码的接口时先在此登记场景值
 * @keyword-cn 邮箱验证码场景, 场景白名单
 * @keyword-en email-code-scene, scene-allowlist
 */
export const EMAIL_VERIFICATION_SCENES = ['register'] as const;

/**
 * @description 邮箱验证码业务场景类型
 * @keyword-cn 邮箱验证码场景类型
 * @keyword-en email-code-scene-type
 */
export type EmailVerificationScene = (typeof EMAIL_VERIFICATION_SCENES)[number];

/**
 * @description 各场景在验证码邮件里的操作说明，如「注册 AI 营销官账号」
 * @keyword-cn 场景操作说明, 验证码邮件文案
 * @keyword-en scene-action-label, code-mail-copy
 */
export const EMAIL_SCENE_ACTIONS: Record<EmailVerificationScene, string> = {
  register: '注册 AI 营销官账号',
};

/**
 * @description `@RequireEmailCode` 写入的场景元数据 key
 * @keyword-cn 邮箱验证码元数据键
 * @keyword-en require-email-code-metadata-key
 */
export const REQUIRE_EMAIL_CODE_KEY = 'email-verification:require-email-code';

/**
 * @description 邮箱验证码有效期（秒）；邮件投递比短信慢，给 10 分钟
 * @keyword-cn 邮箱验证码有效期
 * @keyword-en email-code-ttl
 */
export const EMAIL_CODE_TTL_SECONDS = 600;

/**
 * @description 同一邮箱同一场景的重发间隔（秒）
 * @keyword-cn 邮箱重发间隔
 * @keyword-en email-resend-interval
 */
export const EMAIL_RESEND_INTERVAL_SECONDS = 60;

/**
 * @description 单个邮箱 24 小时内最多发送次数
 * @keyword-cn 邮箱日限额
 * @keyword-en email-daily-limit
 */
export const EMAIL_ADDRESS_DAILY_LIMIT = 10;

/**
 * @description 单个 IP 1 小时内最多发送次数
 * @keyword-cn IP小时限额
 * @keyword-en ip-hourly-limit
 */
export const EMAIL_IP_HOURLY_LIMIT = 30;

/**
 * @description 单条验证码最多校验次数，超过即作废
 * @keyword-cn 最大尝试次数, 防爆破
 * @keyword-en max-attempts, brute-force-guard
 */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

/**
 * @description 邮箱验证码记录，集合 `email_verification_codes`，过期 24 小时后由 TTL 索引清理
 * @keyword-cn 邮箱验证码记录
 * @keyword-en email-code-entity
 */
export interface EmailCodeEntity {
  _id: ObjectId;
  /** 规范化后的邮箱（去空格、小写） */
  email: string;
  scene: EmailVerificationScene;
  codeHash: string;
  ip: string;
  attempts: number;
  consumedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * @description 守卫校验通过后挂到请求上的上下文
 * @keyword-cn 邮箱验证通过上下文
 * @keyword-en email-verified-context
 */
export interface EmailVerifiedContext {
  codeId: string;
  email: string;
  scene: EmailVerificationScene;
}

/**
 * @description 携带邮箱验证上下文的请求类型，业务接口从 `emailVerification.email` 读取已验证邮箱
 * @keyword-cn 已验证请求, 可信邮箱
 * @keyword-en email-verified-request, trusted-email
 */
export interface EmailVerifiedRequest extends Request {
  emailVerification?: EmailVerifiedContext;
}
