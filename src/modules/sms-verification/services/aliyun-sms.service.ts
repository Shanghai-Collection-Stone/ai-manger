import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import type { AliyunSmsRuntimeConfig } from '../entities/sms-verification.entity.js';

/**
 * @description 阿里云短信 Dysmsapi 接口地址（RPC 风格，签名 V1）
 * @keyword-cn 阿里云短信地址
 * @keyword-en aliyun-sms-endpoint
 */
export const ALIYUN_SMS_ENDPOINT = 'https://dysmsapi.aliyuncs.com/';

/**
 * @description 阿里云短信调用失败：`code` 为阿里云返回码或网络失败时的 `NETWORK_ERROR`
 * @keyword-cn 阿里云短信错误, 服务商返回码
 * @keyword-en aliyun-sms-error, provider-code
 */
export class AliyunSmsError extends Error {
  /**
   * @description 构造阿里云短信错误
   * @keyword-cn 构造短信错误
   * @keyword-en construct-sms-error
   * @param code 阿里云返回码。
   * @param providerMessage 阿里云返回说明。
   */
  constructor(
    readonly code: string,
    readonly providerMessage: string,
  ) {
    super(`${code}: ${providerMessage}`);
  }
}

interface AliyunSmsResponse {
  Code?: string;
  Message?: string;
  BizId?: string;
  RequestId?: string;
}

/**
 * @description 阿里云短信客户端：直接按 RPC 签名 V1 调 SendSms，不引入 SDK；日志不带密钥与完整手机号。
 * @keyword-cn 阿里云短信客户端, 发送验证码
 * @keyword-en aliyun-sms-client, send-sms-code
 */
@Injectable()
export class AliyunSmsService {
  private readonly logger = new Logger(AliyunSmsService.name);

  /**
   * @description 用模板发送一条验证码短信，失败抛 AliyunSmsError
   * @keyword-cn 发送验证码短信, 模板短信
   * @keyword-en send-sms-code, template-sms
   * @param config 明文运行配置。
   * @param phone 11 位手机号。
   * @param code 验证码。
   * @returns {Promise<{ bizId: string }>} 阿里云回执 ID。
   */
  async sendCode(
    config: AliyunSmsRuntimeConfig,
    phone: string,
    code: string,
  ): Promise<{ bizId: string }> {
    const params: Record<string, string> = {
      AccessKeyId: config.accessKeyId,
      Action: 'SendSms',
      Format: 'JSON',
      PhoneNumbers: phone,
      RegionId: 'cn-hangzhou',
      SignName: config.signName,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: randomUUID(),
      SignatureVersion: '1.0',
      TemplateCode: config.templateCode,
      TemplateParam: JSON.stringify({ [config.templateParamName]: code }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2017-05-25',
    };
    const query = this.buildSignedQuery(params, config.accessKeySecret);
    let payload: AliyunSmsResponse;
    try {
      const res = await fetch(`${ALIYUN_SMS_ENDPOINT}?${query}`, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });
      payload = (await res.json()) as AliyunSmsResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[sendCode] 请求阿里云短信失败 phone=${this.maskPhone(phone)} error=${message}`,
      );
      throw new AliyunSmsError('NETWORK_ERROR', message);
    }
    if (payload.Code === 'OK') return { bizId: String(payload.BizId ?? '') };
    this.logger.warn(
      `[sendCode] 阿里云短信返回失败 phone=${this.maskPhone(phone)} code=${payload.Code} message=${payload.Message} requestId=${payload.RequestId}`,
    );
    throw new AliyunSmsError(
      String(payload.Code ?? 'UNKNOWN'),
      String(payload.Message ?? ''),
    );
  }

  /**
   * @description 按阿里云 RPC 签名 V1 生成带 Signature 的查询串
   * @keyword-cn RPC签名, HMAC-SHA1
   * @keyword-en rpc-signature, hmac-sha1
   * @param params 未签名的公共参数与业务参数。
   * @param secret AccessKey Secret 明文。
   * @returns {string} 已签名查询串。
   */
  buildSignedQuery(params: Record<string, string>, secret: string): string {
    const canonical = Object.keys(params)
      .sort()
      .map(
        (key) => `${this.percentEncode(key)}=${this.percentEncode(params[key])}`,
      )
      .join('&');
    const stringToSign = `GET&${this.percentEncode('/')}&${this.percentEncode(canonical)}`;
    const signature = createHmac('sha1', `${secret}&`)
      .update(stringToSign)
      .digest('base64');
    return `Signature=${this.percentEncode(signature)}&${canonical}`;
  }

  /**
   * @description RFC3986 百分号编码（补齐 encodeURIComponent 不编码的 !'()*）
   * @keyword-cn 百分号编码, RFC3986
   * @keyword-en percent-encode, rfc3986
   * @param value 原始字符串。
   * @returns {string} 编码后的字符串。
   */
  private percentEncode(value: string): string {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  /**
   * @description 手机号日志脱敏，只留前 3 后 4
   * @keyword-cn 手机号脱敏, 日志安全
   * @keyword-en mask-phone, log-safety
   * @param phone 手机号。
   * @returns {string} 脱敏后的手机号。
   */
  private maskPhone(phone: string): string {
    return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '****';
  }
}
