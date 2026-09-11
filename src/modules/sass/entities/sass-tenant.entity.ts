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
  /** 小红书文章生成的租户级并发上限 */
  xhsArticleConcurrencyLimit?: number;
  /** 可用 Credit；-1 表示无限额度 */
  credit: number;
  /** Credit 的整数最小计费单位；-1 表示无限额度 */
  creditUnits: number;
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
  xhsArticleConcurrencyLimit?: number;
  /** 初始 Credit；新租户缺省为 0，-1 仅用于兼容历史无限额度 */
  credit?: number;
}
