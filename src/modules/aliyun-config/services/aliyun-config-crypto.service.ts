import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import type { AliyunSecretEnvelope } from '../entities/aliyun-config.entity.js';

/** @type {number} 密钥版本号，换算法时递增，旧信封直接判为不可解。 */
const ALIYUN_KEY_VERSION = 1;

/**
 * @description 阿里云配置的 Secret 加解密：AES-256-GCM 落库（无密钥时明文降级并告警）。
 *   加密密钥与短信配置同一条链（`SMS_ENCRYPTION_KEY` → `BROWSER_AUTH_ENCRYPTION_KEY`），部署时只需配一个环境变量。
 * @keyword-cn 阿里云密钥加密, 加密存储
 * @keyword-en aliyun-secret-encryption, encrypted-storage
 */
@Injectable()
export class AliyunConfigCryptoService {
  private readonly logger = new Logger(AliyunConfigCryptoService.name);
  private warned = false;

  /**
   * @description 把 Secret 明文封装成落库信封。
   * @keyword-cn 加密密钥, 生成信封
   * @keyword-en encrypt-secret, build-envelope
   * @param value Secret 明文。
   * @returns {AliyunSecretEnvelope} 加密信封；无密钥时为明文信封。
   */
  encrypt(value: string): AliyunSecretEnvelope {
    const key = this.resolveKey();
    if (!key) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          '[encrypt] 未配置 SMS_ENCRYPTION_KEY / BROWSER_AUTH_ENCRYPTION_KEY，阿里云 AccessKey Secret 将以明文保存',
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
      keyVersion: ALIYUN_KEY_VERSION,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /**
   * @description 从信封还原 Secret 明文，解不开返回空串而不抛异常。
   * @keyword-cn 解密密钥, 容错解包
   * @keyword-en decrypt-secret, tolerant-unwrap
   * @param envelope 落库信封。
   * @returns {string} Secret 明文；无法还原时为空串。
   */
  decrypt(envelope?: AliyunSecretEnvelope): string {
    if (!envelope) return '';
    if (envelope.algorithm === 'plain') return envelope.value;
    const key = this.resolveKey();
    if (!key || envelope.keyVersion !== ALIYUN_KEY_VERSION) {
      this.logger.warn(
        '[decrypt] 缺少密钥或密钥版本不匹配，无法还原阿里云 Secret',
      );
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
      this.logger.warn('[decrypt] 阿里云 Secret 解密失败');
      return '';
    }
  }

  /**
   * @description 解析 32 字节密钥：十六进制、base64 或任意字符串的 SHA-256，与短信配置同一规则。
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
