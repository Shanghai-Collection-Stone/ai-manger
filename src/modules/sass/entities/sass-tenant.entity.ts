import { ObjectId } from 'mongodb';

/**
 * @description 租户实体，标识SaaS租户基础信息
 * @keyword-en sass tenant entity
 */
export interface SassTenantEntity {
  _id: ObjectId;
  name: string;
  description?: string;
  /** 平台为租户分配的 SuperClaw 节点 ID */
  superClawId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 创建租户输入
 * @keyword-en sass tenant create input
 */
export interface SassTenantCreateInput {
  name: string;
  description?: string;
}
