/**
 * @description 后台权限动作枚举，CASL ability 的 action 维度，manage 为通配全动作
 * @keyword-en admin permission action
 * @keyword-cn 权限动作
 */
export const ADMIN_ACTIONS = [
  'manage',
  'create',
  'read',
  'update',
  'delete',
] as const;

/**
 * @description 后台权限动作类型
 * @keyword-en admin action type
 * @keyword-cn 权限动作类型
 */
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/**
 * @description 后台权限主体注册中心根 key，所有 subject 唯一来源，鉴权声明的 subject 必须逐字取自此表
 * @keyword-en admin permission subject registry
 * @keyword-cn 权限主体注册中心
 */
export const ADMIN_SUBJECTS = {
  /** 后台用户 */
  User: 'User',
  /** 角色 */
  Role: 'Role',
  /** 工作区(含成员管理) */
  Workspace: 'Workspace',
  /** 工作区 Agent 通讯录 */
  WorkspaceAgent: 'WorkspaceAgent',
  /** 工作区会话与消息 */
  WorkspaceConversation: 'WorkspaceConversation',
  /** 工作区任务与跟进记录 */
  WorkspaceTask: 'WorkspaceTask',
  /** 租户网盘(文件/文件夹节点与容量) */
  Netdisk: 'Netdisk',
  /** 审计日志 */
  AuditLog: 'AuditLog',
  /** 通知管理 */
  Notice: 'Notice',
  /** 通知已读状态(接收人视角：我的通知/标记已读/未读数) */
  NoticeRead: 'NoticeRead',
  /** 通配全部主体 */
  All: 'all',
} as const;

/**
 * @description 后台权限主体类型
 * @keyword-en admin permission subject type
 * @keyword-cn 权限主体类型
 */
export type AdminSubject = (typeof ADMIN_SUBJECTS)[keyof typeof ADMIN_SUBJECTS];
