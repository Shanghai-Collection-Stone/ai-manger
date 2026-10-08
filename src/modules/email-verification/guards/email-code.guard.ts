import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_EMAIL_CODE_KEY,
  type EmailVerificationScene,
  type EmailVerifiedRequest,
} from '../entities/email-verification.entity.js';
import { EmailVerificationService } from '../services/email-verification.service.js';

/**
 * @description 邮箱验证码判定守卫：用请求体业务字段 email 与 emailCode（或 X-Email-Code 头）校验，
 *   通过后从 body 移除 emailCode（业务 DTO 无需声明），把 email 换成规范化值，并把可信邮箱挂到 req.emailVerification。
 * @keyword-cn 邮箱验证码守卫, 验证码判定
 * @keyword-en email-code-guard, email-code-check
 */
@Injectable()
export class EmailCodeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verification: EmailVerificationService,
  ) {}

  /**
   * @description 按 @RequireEmailCode 声明的场景校验邮箱验证码
   * @keyword-cn 校验请求邮箱验证码, 场景绑定
   * @keyword-en check-request-email-code, scene-binding
   * @param context 执行上下文。
   * @returns {Promise<boolean>} 是否放行。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scene = this.reflector.getAllAndOverride<
      EmailVerificationScene | undefined
    >(REQUIRE_EMAIL_CODE_KEY, [context.getHandler(), context.getClass()]);
    if (!scene) return true;

    const req = context.switchToHttp().getRequest<EmailVerifiedRequest>();
    const body = (
      req.body && typeof req.body === 'object' ? req.body : {}
    ) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const code = this.readCode(body.emailCode, req.headers['x-email-code']);
    if (!email || !code) throw new BadRequestException('EMAIL_CODE_REQUIRED');

    req.emailVerification = await this.verification.verify({
      email,
      scene,
      code,
    });
    body.email = req.emailVerification.email;
    delete body.emailCode;
    return true;
  }

  /**
   * @description body 字段优先、请求头兜底地读取验证码
   * @keyword-cn 读取邮箱验证码, 请求头兜底
   * @keyword-en read-email-code, header-fallback
   * @param bodyValue body 字段值。
   * @param headerValue 请求头值。
   * @returns {string} 去空格后的验证码。
   */
  private readCode(bodyValue: unknown, headerValue: unknown): string {
    if (typeof bodyValue === 'string' && bodyValue.trim()) {
      return bodyValue.trim();
    }
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return typeof header === 'string' ? header.trim() : '';
  }
}
