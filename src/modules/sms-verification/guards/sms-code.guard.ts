import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_SMS_CODE_KEY,
  type SmsVerificationScene,
  type SmsVerifiedRequest,
} from '../entities/sms-verification.entity.js';
import { SmsVerificationService } from '../services/sms-verification.service.js';

/**
 * @description 短信验证码判定守卫：读取 body 的 smsPhone/smsCode（或 X-Sms-Phone/X-Sms-Code 头）校验，
 *   通过后从 body 移除这两个字段（业务 DTO 无需声明）并把可信手机号挂到 req.smsVerification。
 * @keyword-cn 验证码守卫, 验证码判定
 * @keyword-en sms-code-guard, sms-code-check
 */
@Injectable()
export class SmsCodeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verification: SmsVerificationService,
  ) {}

  /**
   * @description 按 @RequireSmsCode 声明的场景校验验证码
   * @keyword-cn 校验请求验证码, 场景绑定
   * @keyword-en check-request-sms-code, scene-binding
   * @param context 执行上下文。
   * @returns {Promise<boolean>} 是否放行。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scene = this.reflector.getAllAndOverride<
      SmsVerificationScene | undefined
    >(REQUIRE_SMS_CODE_KEY, [context.getHandler(), context.getClass()]);
    if (!scene) return true;

    const req = context.switchToHttp().getRequest<SmsVerifiedRequest>();
    const body = (
      req.body && typeof req.body === 'object' ? req.body : {}
    ) as Record<string, unknown>;
    const phone = this.readField(body.smsPhone, req.headers['x-sms-phone']);
    const code = this.readField(body.smsCode, req.headers['x-sms-code']);
    if (!phone || !code) throw new BadRequestException('SMS_CODE_REQUIRED');

    req.smsVerification = await this.verification.verify({
      phone,
      scene,
      code,
    });
    delete body.smsPhone;
    delete body.smsCode;
    return true;
  }

  /**
   * @description body 字段优先、请求头兜底地读取字符串
   * @keyword-cn 读取验证字段, 请求头兜底
   * @keyword-en read-sms-field, header-fallback
   * @param bodyValue body 字段值。
   * @param headerValue 请求头值。
   * @returns {string} 去空格后的字符串。
   */
  private readField(bodyValue: unknown, headerValue: unknown): string {
    if (typeof bodyValue === 'string' && bodyValue.trim()) {
      return bodyValue.trim();
    }
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return typeof header === 'string' ? header.trim() : '';
  }
}
