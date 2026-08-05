import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAbilityFactory } from '../casl/admin-ability.factory.js';
import {
  REQUIRE_PERMISSION_KEY,
  type RequiredPermission,
} from '../decorators/require-permission.decorator.js';
import type { AdminRequest } from '../types/admin-request.types.js';

/**
 * @description 后台 CASL 策略守卫，读取 @RequirePermission 声明与登录用户角色能力，命中不足抛 403
 * @keyword-en admin policies guard
 * @keyword-cn 策略守卫
 */
@Injectable()
export class AdminPoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AdminAbilityFactory,
  ) {}

  /**
   * @description 校验当前登录用户是否具备入口声明的 (动作,主体) 能力
   * @keyword-en can activate policy check
   * @keyword-cn 策略校验
   */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<
      RequiredPermission | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<AdminRequest>();
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');

    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can(required.action, required.subject)) {
      throw new ForbiddenException('PERMISSION_DENIED');
    }
    return true;
  }
}
