import {
  applyDecorators,
  SetMetadata,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  REQUIRE_SMS_CODE_KEY,
  REQUIRE_SMS_CODE_OPTIONAL_KEY,
  type SmsVerificationScene,
} from '../entities/sms-verification.entity.js';
import { SmsCodeGuard } from '../guards/sms-code.guard.js';
import { SmsCodeConsumeInterceptor } from '../interceptors/sms-code-consume.interceptor.js';

/**
 * @description 接口接入短信验证码的唯一入口：一行声明即完成「场景元数据 + 判定守卫 + 成功后作废」。
 *   请求需携带 smsPhone/smsCode（body 或 X-Sms-Phone/X-Sms-Code 头），业务方法从 req.smsVerification.phone 读取已验证手机号。
 * @keyword-cn 接入验证码, 验证码装饰器
 * @keyword-en require-sms-code, sms-code-decorator
 *   options.optional 为 true 时没带验证码也放行（不挂 req.smsVerification），用于「手机号与邮箱二选一验证」，业务方法须自行要求至少一项已验证。
 * @param scene 已在 SMS_VERIFICATION_SCENES 登记的场景。
 * @param options 可选：optional 表示验证码可不带。
 * @returns {MethodDecorator & ClassDecorator} 组合装饰器。
 */
export const RequireSmsCode = (
  scene: SmsVerificationScene,
  options: { optional?: boolean } = {},
) =>
  applyDecorators(
    SetMetadata(REQUIRE_SMS_CODE_KEY, scene),
    SetMetadata(REQUIRE_SMS_CODE_OPTIONAL_KEY, options.optional === true),
    UseGuards(SmsCodeGuard),
    UseInterceptors(SmsCodeConsumeInterceptor),
  );
