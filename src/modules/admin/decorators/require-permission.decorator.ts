import { SetMetadata } from '@nestjs/common';
import type { AdminAction, AdminSubject } from '../casl/admin-permission.constants.js';

/**
 * @description 权限要求元数据 key
 * @keyword-en require permission metadata key
 * @keyword-cn 权限元数据键
 */
export const REQUIRE_PERMISSION_KEY = 'admin:require-permission';

/**
 * @description 单条权限要求 (动作, 主体)
 * @keyword-en required permission tuple
 * @keyword-cn 权限要求
 */
export interface RequiredPermission {
  action: AdminAction;
  subject: AdminSubject;
}

/**
 * @description 入口鉴权声明装饰器，与路由装饰器同址标注该入口所需 (动作,主体)，由 AdminPoliciesGuard 消费
 * @keyword-en require permission decorator
 * @keyword-cn 入口鉴权声明
 */
export const RequirePermission = (
  action: AdminAction,
  subject: AdminSubject,
) => SetMetadata<string, RequiredPermission>(REQUIRE_PERMISSION_KEY, { action, subject });
