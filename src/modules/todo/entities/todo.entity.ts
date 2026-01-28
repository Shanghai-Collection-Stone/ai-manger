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
  userId: string;
  title: string;
  description?: string;
  aiConsideration: string;
  decisionReason: string;
  aiPlan: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 待办创建输入
 * @param {string} userId - 指定用户ID
 * @param {string} title - 标题
 * @param {string} [description] - 描述
 * @param {string} aiConsideration - AI的考量
 * @param {string} decisionReason - 决策产生过程
 * @param {string} aiPlan - AI打算让你怎么做
 * @returns {void}
 * @throws {Error} 参数缺失
 * @keyword todo, create, input
 * @since 2026-01-27
 */
export interface TodoCreateInput {
  userId: string;
  title: string;
  description?: string;
  aiConsideration: string;
  decisionReason: string;
  aiPlan: string;
}

/**
 * @description 待办更新输入
 * @param {number} id - 序号ID
 * @returns {void}
 * @keyword todo, update, input
 * @since 2026-01-27
 */
export interface TodoUpdateInput {
  id: number;
  userId?: string;
  title?: string;
  description?: string;
  aiConsideration?: string;
  decisionReason?: string;
  aiPlan?: string;
  status?: 'pending' | 'in_progress' | 'done' | 'cancelled';
}
