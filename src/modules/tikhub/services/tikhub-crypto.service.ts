import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import type { TikhubSecretEnvelope } from '../entities/tikhub.entity.js';

/** @type {number} 密钥版本号，换密钥算法时递增，旧信封直接判为不可解。 */
const TIKHUB_KEY_VERSION = 1;

/**
 * @description TikHub API Key 加解密服务：配置了密钥就 AES-256-GCM 落库，
 *   没配置则退化成明文信封并告警——本地环境没有密钥时仍要能保存配置。
 * @keyword-cn TikHub密钥加密, 明文降级
 * @keyword-en tikhub-secret-encryption, plaintext-fallback
 */
@Injectable()
export class TikhubCryptoService {
  private readonly logger = new Logger(TikhubCryptoService.name);
  private warned = false;

  /**
   * @description 把 API Key 明文封装成落库信封。
   * @keyword-cn 加密密钥, 生成信封
   * @keyword-en encrypt-api-key, build-envelope
   * @param value API Key 明文。
   * @returns {TikhubSecretEnvelope} 加密信封；无密钥时为明文信封。
   */
  encrypt(value: string): TikhubSecretEnvelope {
    const key = this.resolveKey();
    if (!key) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          '[encrypt] 未配置 TIKHUB_ENCRYPTION_KEY / BROWSER_AUTH_ENCRYPTION_KEY，TikHub API Key 将以明文保存',
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
      keyVersion: TIKHUB_KEY_VERSION,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /**
   * @description 从信封还原 API Key 明文，解不开时返回空串而不是抛异常，避免拖垮采集主流程。
   * @keyword-cn 解密密钥, 容错解包
   * @keyword-en decrypt-api-key, tolerant-unwrap
   * @param envelope 落库信封。
   * @returns {string} API Key 明文；无法还原时为空串。
   */
  decrypt(envelope?: TikhubSecretEnvelope): string {
    if (!envelope) return '';
    if (envelope.algorithm === 'plain') return envelope.value;
    const key = this.resolveKey();
    if (!key || envelope.keyVersion !== TIKHUB_KEY_VERSION) {
      this.logger.warn('[decrypt] 缺少密钥或密钥版本不匹配，无法还原 API Key');
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
      this.logger.warn('[decrypt] TikHub API Key 解密失败');
      return '';
    }
  }

  /**
   * @description 解析 32 字节密钥，优先 TIKHUB_ENCRYPTION_KEY，回落到浏览器认证密钥复用同一份运维配置。
   * @keyword-cn 解析加密密钥, 环境变量
   * @keyword-en resolve-encryption-key, environment-key
   * @returns {Buffer | null} 32 字节密钥；两个环境变量都没配时为 null。
   */
  private resolveKey(): Buffer | null {
    const configured = String(
      process.env.TIKHUB_ENCRYPTION_KEY ??
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
