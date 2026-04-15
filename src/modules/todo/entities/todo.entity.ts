import { ObjectId } from 'mongodb';

/**
 * @description 关联资源条目
 * @keyword-en TodoAssociatedResource entry format for associated resources
 * @since 2026-04-14
 */
export interface TodoAssociatedResource {
  /** 资源类型：canvas | markdown | xhs_stats | ... */
  type: string;
  /** 资源ID或资源路径 */
  resourceId: string | number;
}

/**
 * @description 待办实体，包含AI考量、决策来源与AI计划
 * @keyword todo, entity, ai-consideration
 * @returns {void}
 * @since 2026-01-27
 */
export interface TodoEntity {
  _id: ObjectId;
  id: number;
  tenantId?: string;
  userId: string;
  title: string;
  description?: string;
  /** @deprecated 已废弃，请使用 associatedResources */
  resource?: string;
  /** 关联资源列表，统一格式：[{ type, resourceId }] */
  associatedResources?: TodoAssociatedResource[];
  type?: string;
  /** 任务分类标签（如 xhs 标识小红书相关任务） */
  category?: string;
  assignee?: string;
  abnormalReason?: string;
  aiConsideration: string;
  decisionReason: string;
  aiPlan: string;
  /** 关联会话上下文键（用于 Claw 等需要持久化会话的场景） */
  sessionKey?: string;
  /** 任务专属token，用于skill回调接口鉴权 */
  taskToken?: string;
  /** 任务成果，由claw api最终返回的markdown内容 */
  taskResult?: string;
  /** 长时任务截止时间（long_task 类型专用，非必填） */
  deadline?: Date;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 待办创建输入
 */
export interface TodoCreateInput {
  tenantId?: string;
  userId: string;
  title: string;
  description?: string;
  /** @deprecated 已废弃，请使用 associatedResources */
  resource?: string;
  /** 关联资源列表 */
  associatedResources?: TodoAssociatedResource[];
  type?: string;
  /** 任务分类标签（如 xhs） */
  category?: string;
  assignee?: string;
  aiConsideration: string;
  decisionReason: string;
  aiPlan: string;
  /** 长时任务截止时间（long_task 类型专用） */
  deadline?: Date;
}

/**
 * @description 待办更新输入
 */
export interface TodoUpdateInput {
  id: number;
  tenantId?: string;
  userId?: string;
  title?: string;
  description?: string;
  /** @deprecated 已废弃，请使用 associatedResources */
  resource?: string;
  /** 关联资源列表 */
  associatedResources?: TodoAssociatedResource[];
  type?: string;
  /** 任务分类标签（如 xhs） */
  category?: string;
  assignee?: string;
  abnormalReason?: string;
  aiConsideration?: string;
  decisionReason?: string;
  aiPlan?: string;
  sessionKey?: string;
  taskToken?: string;
  taskResult?: string;
  /** 长时任务截止时间（long_task 类型专用） */
  deadline?: Date;
  status?: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
}
