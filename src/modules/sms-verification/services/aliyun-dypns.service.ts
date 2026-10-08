import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  SMS_CODE_TTL_SECONDS,
  SMS_RESEND_INTERVAL_SECONDS,
  type AliyunDypnsRuntimeConfig,
} from '../entities/sms-verification.entity.js';
import { AliyunSmsError, AliyunSmsService } from './aliyun-sms.service.js';

/**
 * @description 阿里云号码认证服务 Dypnsapi 接口地址（RPC 风格，签名 V1）
 * @keyword-cn 号码认证短信地址
 * @keyword-en aliyun-dypns-endpoint
 */
export const ALIYUN_DYPNS_ENDPOINT = 'https://dypnsapi.aliyuncs.com/';

interface AliyunDypnsResponse {
  Code?: string;
  Message?: string;
  Success?: boolean;
  RequestId?: string;
  Model?: {
    VerifyCode?: string | number;
    BizId?: string | number;
    VerifyResult?: string;
  };
}

/**
 * @description 阿里云号码认证短信客户端，发送由服务商生成的验证码并支持服务商侧校验。
 * @keyword-cn 号码认证短信客户端, 服务商校验
 * @keyword-en aliyun-dypns-client, provider-verification
 */
@Injectable()
export class AliyunDypnsService {
  private readonly logger = new Logger(AliyunDypnsService.name);

  /**
   * @description 注入共用的阿里云 RPC V1 签名实现
   * @keyword-cn 共用签名实现, 依赖注入
   * @keyword-en shared-rpc-signer, dependency-injection
   * @param signer 阿里云短信 RPC 签名服务。
   */
  constructor(private readonly signer: AliyunSmsService) {}

  /**
   * @description 调用 SendSmsVerifyCode 发送验证码，可要求服务商回传本次验证码
   * @keyword-cn 号码认证发送验证码, 回传验证码
   * @keyword-en dypns-send-code, return-verify-code
   * @param config 号码认证明文运行配置。
   * @param phone 11 位手机号。
   * @param options.outId 本次验证码记录标识。
   * @returns {Promise<{ verifyCode?: string; bizId?: string }>} 回传验证码与业务回执。
   */
  async sendVerifyCode(
    config: AliyunDypnsRuntimeConfig,
    phone: string,
    options: { outId: string },
  ): Promise<{ verifyCode?: string; bizId?: string }> {
    const payload = await this.request(
      config,
      {
        Action: 'SendSmsVerifyCode',
        PhoneNumber: phone,
        CountryCode: '86',
        SignName: config.signName,
        TemplateCode: config.templateCode,
        TemplateParam: config.templateParam,
        CodeLength: '6',
        ValidTime: String(SMS_CODE_TTL_SECONDS),
        Interval: String(SMS_RESEND_INTERVAL_SECONDS),
        CodeType: '1',
        DuplicatePolicy: '1',
        ReturnVerifyCode: 'true',
        OutId: options.outId,
        ...(config.schemeName ? { SchemeName: config.schemeName } : {}),
      },
      phone,
    );
    const verifyCode = payload.Model?.VerifyCode;
    const bizId = payload.Model?.BizId;
    return {
      verifyCode:
        verifyCode === undefined || verifyCode === null || verifyCode === ''
          ? undefined
          : String(verifyCode),
      bizId:
        bizId === undefined || bizId === null || bizId === ''
          ? undefined
          : String(bizId),
    };
  }

  /**
   * @description 调用 CheckSmsVerifyCode 校验未回传到本地的验证码
   * @keyword-cn 号码认证校验验证码, 服务商校验
   * @keyword-en dypns-check-code, provider-verification
   * @param config 号码认证明文运行配置。
   * @param phone 11 位手机号。
   * @param code 用户提交的验证码。
   * @param options.outId 发码时使用的记录标识。
   * @returns {Promise<boolean>} 服务商判定是否通过。
   */
  async checkVerifyCode(
    config: AliyunDypnsRuntimeConfig,
    phone: string,
    code: string,
    options: { outId: string },
  ): Promise<boolean> {
    const payload = await this.request(
      config,
      {
        Action: 'CheckSmsVerifyCode',
        PhoneNumber: phone,
        VerifyCode: code,
        CountryCode: '86',
        OutId: options.outId,
        ...(config.schemeName ? { SchemeName: config.schemeName } : {}),
      },
      phone,
    );
    return payload.Model?.VerifyResult === 'PASS';
  }

  /**
   * @description 补齐公共 RPC 参数、签名并执行 Dypnsapi 请求
   * @keyword-cn 号码认证请求, RPC签名
   * @keyword-en dypns-request, rpc-signature
   * @param config 号码认证明文运行配置。
   * @param actionParams 接口业务参数。
   * @param phone 日志脱敏用手机号。
   * @returns {Promise<AliyunDypnsResponse>} 服务商响应。
   */
  private async request(
    config: AliyunDypnsRuntimeConfig,
    actionParams: Record<string, string>,
    phone: string,
  ): Promise<AliyunDypnsResponse> {
    const params: Record<string, string> = {
      AccessKeyId: config.accessKeyId,
      Format: 'JSON',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: randomUUID(),
      SignatureVersion: '1.0',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2017-05-25',
      ...actionParams,
    };
    const query = this.signer.buildSignedQuery(params, config.accessKeySecret);
    let payload: AliyunDypnsResponse;
    try {
      const response = await fetch(`${ALIYUN_DYPNS_ENDPOINT}?${query}`, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });
      payload = (await response.json()) as AliyunDypnsResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[request] 请求阿里云号码认证失败 phone=${this.maskPhone(phone)} action=${actionParams.Action} error=${message}`,
      );
      throw new AliyunSmsError('NETWORK_ERROR', message);
    }
    if (payload.Code === 'OK' && payload.Success !== false) return payload;
    this.logger.warn(
      `[request] 阿里云号码认证返回失败 phone=${this.maskPhone(phone)} action=${actionParams.Action} code=${payload.Code} message=${payload.Message} requestId=${payload.RequestId}`,
    );
    throw new AliyunSmsError(
      String(payload.Code ?? 'UNKNOWN'),
      String(payload.Message ?? ''),
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
