import { ObjectId } from 'mongodb';

/**
 * @description 审计日志目标资源类型
 * @keyword-en audit target type
 * @keyword-cn 审计目标类型
 */
export type AuditTargetType =
  | 'workspace'
  | 'workspace_member'
  | 'workspace_agent'
  | 'workspace_conversation'
  | 'workspace_task'
  | 'disk_node'
  | 'disk_root'
  | 'notice';

/**
 * @description 审计日志实体，记录后台一次可审计的变更事件(谁/在哪个租户/对什么/做了什么)
 * @keyword-en audit log entity
 * @keyword-cn 审计日志实体
 */
export interface AuditLogEntity {
  _id: ObjectId;
  /** 事件所属租户；平台级(super_admin 无租户)操作可为空 */
  tenantId?: string;
  /** 操作者后台用户 ID */
  actorUserId: string;
  /** 操作者用户名(冗余，便于查询展示) */
  actorUsername: string;
  /** 事件动作，命名空间格式 `<module>.<verb>`，如 workspace.create / netdisk.fileUpload */
  action: string;
  /** 目标资源类型 */
  targetType: AuditTargetType;
  /** 目标资源 ID */
  targetId?: string;
  /** 事件明细(变更摘要/关键字段快照)，避免存敏感原文 */
  detail?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * @description 写入审计事件的入参
 * @keyword-en audit record input
 * @keyword-cn 审计写入入参
 */
export interface AuditRecordInput {
  tenantId?: string;
  actorUserId: string;
  actorUsername: string;
  action: string;
  targetType: AuditTargetType;
  targetId?: string;
  detail?: Record<string, unknown>;
}
