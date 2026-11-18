import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_EMAIL_CODE_KEY,
  REQUIRE_EMAIL_CODE_OPTIONAL_KEY,
} from '../entities/email-verification.entity';
import type { EmailVerificationService } from '../services/email-verification.service';
import { EmailCodeGuard } from './email-code.guard';

/**
 * @description 构造带指定元数据与请求体的执行上下文。
 * @keyword-cn 邮箱守卫测试上下文, 请求体模拟
 * @keyword-en email-guard-test-context, request-body-mock
 */
function buildContext(optional: boolean, body: Record<string, unknown>) {
  const handler = () => undefined;
  Reflect.defineMetadata(REQUIRE_EMAIL_CODE_KEY, 'register', handler);
  Reflect.defineMetadata(REQUIRE_EMAIL_CODE_OPTIONAL_KEY, optional, handler);
  const req: Record<string, unknown> = { body, headers: {} };
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('EmailCodeGuard 可选模式', () => {
  const verify = jest.fn();
  const guard = new EmailCodeGuard(new Reflector(), {
    verify,
  } as unknown as EmailVerificationService);

  beforeEach(() => verify.mockReset());

  it('可选且没带验证码时放行，email 原样留给业务 DTO，不挂可信邮箱', async () => {
    const body = { email: 'A@Example.com', emailCode: '' };
    const { context, req } = buildContext(true, body);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(body).toEqual({ email: 'A@Example.com' });
    expect(req.emailVerification).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it('非可选时没带验证码仍拒绝', async () => {
    const { context } = buildContext(false, { email: 'a@example.com' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'EMAIL_CODE_REQUIRED',
    );
  });
});
