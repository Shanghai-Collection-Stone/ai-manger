import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { concatMap, type Observable } from 'rxjs';
import type { EmailVerifiedRequest } from '../entities/email-verification.entity.js';
import { EmailVerificationService } from '../services/email-verification.service.js';

/**
 * @description 邮箱验证码作废拦截器：业务接口成功返回后才作废验证码，参数校验或业务失败时可用同一验证码重试。
 * @keyword-cn 成功后作废, 邮箱验证码拦截器
 * @keyword-en consume-on-success, email-code-interceptor
 */
@Injectable()
export class EmailCodeConsumeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(EmailCodeConsumeInterceptor.name);

  constructor(private readonly verification: EmailVerificationService) {}

  /**
   * @description 在响应发出前作废守卫校验过的邮箱验证码
   * @keyword-cn 响应前作废, 一次性使用
   * @keyword-en consume-before-response, single-use
   * @param context 执行上下文。
   * @param next 后续处理器。
   * @returns {Observable<unknown>} 原响应流。
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<EmailVerifiedRequest>();
    return next.handle().pipe(
      concatMap(async (data: unknown) => {
        const verified = req.emailVerification;
        if (verified && !(await this.verification.consume(verified.codeId))) {
          this.logger.warn(
            `[intercept] 邮箱验证码已被并发请求作废 codeId=${verified.codeId} scene=${verified.scene}`,
          );
        }
        return data;
      }),
    );
  }
}
