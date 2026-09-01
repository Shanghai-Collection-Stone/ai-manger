import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from '@casl/ability';
import type {
  AdminUserEntity,
  AdminUserRole,
} from '../entities/admin.entity.js';
import type {
  AdminAction,
  AdminSubject,
} from './admin-permission.constants.js';

/**
 * @description 后台 CASL 能力类型，(动作, 主体) 二元组
 * @keyword-en admin casl ability type
 * @keyword-cn 后台能力类型
 */
export type AdminAbility = MongoAbility<[AdminAction, AdminSubject]>;

/**
 * @description 单条权限规则的可读描述，用于角色管理接口展示
 * @keyword-en role permission rule descriptor
 * @keyword-cn 角色权限规则
 */
export interface RolePermissionRule {
  action: AdminAction;
  subject: AdminSubject;
}

/**
 * @description 角色目录条目，含展示名、描述与该角色的静态权限矩阵
 * @keyword-en role catalog entry
 * @keyword-cn 角色目录条目
 */
export interface RoleCatalogEntry {
  role: AdminUserRole;
  displayName: string;
  description: string;
  permissions: RolePermissionRule[];
}

/**
 * @description 角色静态目录，RBAC 权限矩阵的唯一定义源，角色管理接口只读消费此表
 * @keyword-en static role catalog
 * @keyword-cn 静态角色目录
 */
export const ROLE_CATALOG: readonly RoleCatalogEntry[] = [
  {
    role: 'super_admin',
    displayName: '超级管理员',
    description: '平台级超管，跨租户全量权限',
    permissions: [{ action: 'manage', subject: 'all' }],
  },
  {
    role: 'tenant_admin',
    displayName: '租户管理员',
    description: '本租户内管理用户、工作区与网盘，可查看角色与审计日志',
    permissions: [
      { action: 'manage', subject: 'User' },
      { action: 'manage', subject: 'XhsTopic' },
      { action: 'manage', subject: 'HotTopic' },
      { action: 'read', subject: 'Role' },
      { action: 'manage', subject: 'Workspace' },
      { action: 'manage', subject: 'WorkspaceAgent' },
      { action: 'manage', subject: 'WorkspaceConversation' },
      { action: 'manage', subject: 'WorkspaceTask' },
      { action: 'manage', subject: 'Netdisk' },
      { action: 'manage', subject: 'Notice' },
      { action: 'read', subject: 'AuditLog' },
      { action: 'manage', subject: 'NoticeRead' },
    ],
  },
  {
    role: 'operator',
    displayName: '操作员',
    description:
      '只读用户/角色/工作区，可在工作区内协作(会话/任务)与操作网盘文件，不可增改删用户',
    permissions: [
      { action: 'read', subject: 'User' },
      { action: 'manage', subject: 'XhsTopic' },
      // 操作员只读热点榜与推荐；采集规则的增删改留给租户管理员
      { action: 'read', subject: 'HotTopic' },
      { action: 'read', subject: 'Role' },
      { action: 'read', subject: 'Workspace' },
      { action: 'read', subject: 'WorkspaceAgent' },
      { action: 'manage', subject: 'WorkspaceConversation' },
      { action: 'manage', subject: 'WorkspaceTask' },
      { action: 'manage', subject: 'Netdisk' },
      { action: 'read', subject: 'Notice' },
      { action: 'manage', subject: 'NoticeRead' },
    ],
  },
];

/**
 * @description 后台 CASL 能力工厂，按用户角色静态构建 ability（RBAC），能力矩阵取自 ROLE_CATALOG
 * @keyword-en admin ability factory
 * @keyword-cn 能力工厂
 */
@Injectable()
export class AdminAbilityFactory {
  /**
   * @description 依据登录用户角色构建 CASL ability 实例
   * @keyword-en create ability for admin user
   * @keyword-cn 构建用户能力
   */
  createForUser(user: AdminUserEntity): AdminAbility {
    const { can, build } = new AbilityBuilder<AdminAbility>(createMongoAbility);
    const entry = ROLE_CATALOG.find((item) => item.role === user.role);
    for (const rule of entry?.permissions ?? []) {
      can(rule.action, rule.subject);
    }
    return build();
  }
}
