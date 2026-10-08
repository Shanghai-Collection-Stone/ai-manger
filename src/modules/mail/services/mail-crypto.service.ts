import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import type { MailPasswordEnvelope } from '../entities/mail.entity.js';

/** @type {number} 密钥版本号，换算法时递增。 */
const MAIL_KEY_VERSION = 1;

/**
 * @description 发信邮箱密码加解密服务，使用 AES-256-GCM 落库，无密钥时明文降级并告警
 * @keyword-cn 邮箱密码加密, 加密信封
 * @keyword-en mail-password-encryption, encryption-envelope
 */
@Injectable()
export class MailCryptoService {
  private readonly logger = new Logger(MailCryptoService.name);
  private warned = false;

  /**
   * @description 把 SMTP 密码明文封装成落库信封
   * @keyword-cn 加密密码, 生成信封
   * @keyword-en encrypt-password, build-envelope
   * @param value SMTP 密码明文。
   * @returns {MailPasswordEnvelope} 加密信封；无密钥时为明文信封。
   */
  encrypt(value: string): MailPasswordEnvelope {
    const key = this.resolveKey();
    if (!key) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          '[encrypt] 未配置 MAIL_ENCRYPTION_KEY / SMS_ENCRYPTION_KEY / BROWSER_AUTH_ENCRYPTION_KEY，SMTP 密码将以明文保存',
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
      keyVersion: MAIL_KEY_VERSION,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /**
   * @description 从落库信封还原 SMTP 密码，无法解密时返回空串
   * @keyword-cn 解密密码, 容错解包
   * @keyword-en decrypt-password, tolerant-unwrap
   * @param envelope 密码落库信封。
   * @returns {string} SMTP 密码明文；无法还原时为空串。
   */
  decrypt(envelope?: MailPasswordEnvelope): string {
    if (!envelope) return '';
    if (envelope.algorithm === 'plain') return envelope.value;
    const key = this.resolveKey();
    if (!key || envelope.keyVersion !== MAIL_KEY_VERSION) {
      this.logger.warn('[decrypt] 缺少密钥或密钥版本不匹配，无法还原 SMTP 密码');
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
      this.logger.warn('[decrypt] SMTP 密码解密失败');
      return '';
    }
  }

  /**
   * @description 解析 32 字节加密密钥，依次回落邮箱、短信与浏览器认证密钥
   * @keyword-cn 解析加密密钥, 环境变量
   * @keyword-en resolve-encryption-key, environment-key
   * @returns {Buffer | null} 32 字节密钥；全部缺失时为 null。
   */
  private resolveKey(): Buffer | null {
    const configured = String(
      process.env.MAIL_ENCRYPTION_KEY ??
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
