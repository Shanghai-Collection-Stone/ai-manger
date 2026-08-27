import { ServiceUnavailableException, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import type { BrowserAuthSecretEnvelope } from '../entities/browser-auth.entity.js';

const BROWSER_AUTH_KEY_VERSION = 1;

/**
 * @description 浏览器认证敏感值加解密服务，使用环境密钥和 AES-256-GCM，绝不记录明文。
 * @keyword-cn 浏览器认证加密, 敏感值保护
 * @keyword-en browser-auth-encryption, secret-protection
 */
@Injectable()
export class BrowserAuthCryptoService {
  /**
   * @description 加密 Cookie storageState、二维码内容或用户回复。
   * @keyword-cn 加密认证数据, AES-GCM
   * @keyword-en encrypt-auth-data, aes-gcm
   */
  encrypt(value: string): BrowserAuthSecretEnvelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.resolveKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return {
      algorithm: 'aes-256-gcm',
      keyVersion: BROWSER_AUTH_KEY_VERSION,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /**
   * @description 仅在受鉴权请求生命周期内解密浏览器认证敏感值。
   * @keyword-cn 解密认证数据, 临时明文
   * @keyword-en decrypt-auth-data, transient-plaintext
   */
  decrypt(envelope: BrowserAuthSecretEnvelope): string {
    if (
      envelope.algorithm !== 'aes-256-gcm' ||
      envelope.keyVersion !== BROWSER_AUTH_KEY_VERSION
    ) {
      throw new ServiceUnavailableException(
        'BROWSER_AUTH_KEY_VERSION_UNSUPPORTED',
      );
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.resolveKey(),
        Buffer.from(envelope.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('BROWSER_AUTH_DECRYPT_FAILED');
    }
  }

  /**
   * @description 从 BROWSER_AUTH_ENCRYPTION_KEY 解析稳定的 32 字节密钥。
   * @keyword-cn 解析浏览器密钥, 环境密钥
   * @keyword-en resolve-browser-key, environment-key
   */
  private resolveKey(): Buffer {
    const configured = String(
      process.env.BROWSER_AUTH_ENCRYPTION_KEY ?? '',
    ).trim();
    if (!configured) {
      throw new ServiceUnavailableException(
        'BROWSER_AUTH_ENCRYPTION_KEY_REQUIRED',
      );
    }
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
