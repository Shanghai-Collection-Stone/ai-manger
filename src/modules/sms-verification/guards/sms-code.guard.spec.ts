import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_SMS_CODE_KEY,
  REQUIRE_SMS_CODE_OPTIONAL_KEY,
} from '../entities/sms-verification.entity';
import type { SmsVerificationService } from '../services/sms-verification.service';
import { SmsCodeGuard } from './sms-code.guard';

/**
 * @description 构造带指定元数据与请求体的执行上下文。
 * @keyword-cn 守卫测试上下文, 请求体模拟
 * @keyword-en guard-test-context, request-body-mock
 */
function buildContext(optional: boolean, body: Record<string, unknown>) {
  const handler = () => undefined;
  Reflect.defineMetadata(REQUIRE_SMS_CODE_KEY, 'register', handler);
  Reflect.defineMetadata(REQUIRE_SMS_CODE_OPTIONAL_KEY, optional, handler);
  const req: Record<string, unknown> = { body, headers: {} };
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('SmsCodeGuard 可选模式', () => {
  const verify = jest.fn();
  const guard = new SmsCodeGuard(new Reflector(), {
    verify,
  } as unknown as SmsVerificationService);

  beforeEach(() => verify.mockReset());

  it('可选且没带验证码时放行，保留 smsPhone 给业务 DTO，不挂可信手机号', async () => {
    const body = { smsPhone: '13800000000', smsCode: '' };
    const { context, req } = buildContext(true, body);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(body).toEqual({ smsPhone: '13800000000' });
    expect(req.smsVerification).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it('可选但带了验证码时照常校验并移除两个字段', async () => {
    verify.mockResolvedValue({
      phone: '13800000000',
      codeId: 'c1',
      scene: 'register',
    });
    const body = { smsPhone: '13800000000', smsCode: '123456' };
    const { context, req } = buildContext(true, body);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith({
      phone: '13800000000',
      scene: 'register',
      code: '123456',
    });
    expect(body).toEqual({});
    expect(req.smsVerification).toEqual(
      expect.objectContaining({ phone: '13800000000' }),
    );
  });

  it('非可选时没带验证码仍拒绝', async () => {
    const { context } = buildContext(false, { smsPhone: '13800000000' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'SMS_CODE_REQUIRED',
    );
  });
});
