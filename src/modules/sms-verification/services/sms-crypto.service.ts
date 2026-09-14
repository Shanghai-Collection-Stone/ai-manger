import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'crypto';
import type {
  SmsSecretEnvelope,
  SmsVerificationScene,
} from '../entities/sms-verification.entity.js';

/** @type {number} 密钥版本号，换算法时递增，旧信封直接判为不可解。 */
const SMS_KEY_VERSION = 1;

/**
 * @description 短信模块加解密服务：AccessKey Secret 用 AES-256-GCM 落库（无密钥时明文降级并告警），
 *   验证码只存 HMAC 摘要。
 * @keyword-cn 短信密钥加密, 验证码摘要
 * @keyword-en sms-secret-encryption, sms-code-hash
 */
@Injectable()
export class SmsCryptoService {
  private readonly logger = new Logger(SmsCryptoService.name);
  private warned = false;

  /**
   * @description 把 Secret 明文封装成落库信封
   * @keyword-cn 加密密钥, 生成信封
   * @keyword-en encrypt-secret, build-envelope
   * @param value Secret 明文。
   * @returns {SmsSecretEnvelope} 加密信封；无密钥时为明文信封。
   */
  encrypt(value: string): SmsSecretEnvelope {
    const key = this.resolveKey();
    if (!key) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          '[encrypt] 未配置 SMS_ENCRYPTION_KEY / BROWSER_AUTH_ENCRYPTION_KEY，短信 AccessKey Secret 将以明文保存',
        );
      }
      return { algorithm: 'plain', value };
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return {
      algorithm: 'aes-256-gcm',
      keyVersion: SMS_KEY_VERSION,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /**
   * @description 从信封还原 Secret 明文，解不开返回空串而不抛异常
   * @keyword-cn 解密密钥, 容错解包
   * @keyword-en decrypt-secret, tolerant-unwrap
   * @param envelope 落库信封。
   * @returns {string} Secret 明文；无法还原时为空串。
   */
  decrypt(envelope?: SmsSecretEnvelope): string {
    if (!envelope) return '';
    if (envelope.algorithm === 'plain') return envelope.value;
    const key = this.resolveKey();
    if (!key || envelope.keyVersion !== SMS_KEY_VERSION) {
      this.logger.warn('[decrypt] 缺少密钥或密钥版本不匹配，无法还原短信 Secret');
      return '';
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(envelope.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      this.logger.warn('[decrypt] 短信 Secret 解密失败');
      return '';
    }
  }

  /**
   * @description 计算验证码 HMAC-SHA256 摘要，手机号与场景参与计算，防止跨场景复用
   * @keyword-cn 验证码摘要, 场景绑定
   * @keyword-en sms-code-hash, scene-binding
   * @param phone 规范化后的手机号。
   * @param scene 业务场景。
   * @param code 6 位验证码。
   * @returns {string} 十六进制摘要。
   */
  hashCode(phone: string, scene: SmsVerificationScene, code: string): string {
    const pepper =
      this.resolveKey() ??
      String(
        process.env.ADMIN_JWT_SECRET ?? 'ai-mvp-sms-verification-pepper',
      );
    return createHmac('sha256', pepper)
      .update(`${scene}:${phone}:${code}`)
      .digest('hex');
  }

  /**
   * @description 解析 32 字节密钥，优先 SMS_ENCRYPTION_KEY，回落浏览器认证密钥
   * @keyword-cn 解析加密密钥, 环境变量
   * @keyword-en resolve-encryption-key, environment-key
   * @returns {Buffer | null} 32 字节密钥；都未配置时为 null。
   */
  private resolveKey(): Buffer | null {
    const configured = String(
      process.env.SMS_ENCRYPTION_KEY ??
        process.env.BROWSER_AUTH_ENCRYPTION_KEY ??
        '',
    ).trim();
    if (!configured) return null;
    if (/^[a-f0-9]{64}$/i.test(configured)) {
      return Buffer.from(configured, 'hex');
    }
    const base64 = Buffer.from(configured, 'base64');
    if (base64.length === 32 && base64.toString('base64') === configured) {
      return base64;
    }
    return createHash('sha256').update(configured, 'utf8').digest();
  }
}
