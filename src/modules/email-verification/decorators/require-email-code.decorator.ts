import {
  applyDecorators,
  SetMetadata,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  REQUIRE_EMAIL_CODE_KEY,
  type EmailVerificationScene,
} from '../entities/email-verification.entity.js';
import { EmailCodeGuard } from '../guards/email-code.guard.js';
import { EmailCodeConsumeInterceptor } from '../interceptors/email-code-consume.interceptor.js';

/**
 * @description 接口接入邮箱验证码的唯一入口：一行声明即完成「场景元数据 + 判定守卫 + 成功后作废」。
 *   请求体需携带业务字段 email 与 emailCode（或 X-Email-Code 头），业务方法从 req.emailVerification.email 读取已验证邮箱。
 * @keyword-cn 接入邮箱验证码, 邮箱验证码装饰器
 * @keyword-en require-email-code, email-code-decorator
 * @param scene 已在 EMAIL_VERIFICATION_SCENES 登记的场景。
 * @returns {MethodDecorator & ClassDecorator} 组合装饰器。
 */
export const RequireEmailCode = (scene: EmailVerificationScene) =>
  applyDecorators(
    SetMetadata(REQUIRE_EMAIL_CODE_KEY, scene),
    UseGuards(EmailCodeGuard),
    UseInterceptors(EmailCodeConsumeInterceptor),
  );
