import { ObjectId } from 'mongodb';

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
  type?: string;
  assignee?: string;
  abnormalReason?: string;
  aiConsideration: string;
  decisionReason: string;
  aiPlan: string;
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
  type?: string;
  assignee?: string;
  aiConsideration: string;
  decisionReason: string;
  aiPlan: string;
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
  type?: string;
  assignee?: string;
  abnormalReason?: string;
  aiConsideration?: string;
  decisionReason?: string;
  aiPlan?: string;
  status?: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
}
