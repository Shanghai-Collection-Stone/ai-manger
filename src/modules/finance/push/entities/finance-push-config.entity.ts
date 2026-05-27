import { ObjectId } from 'mongodb';

/**
 * @description 上次连通性测试结果分类
 * @keyword-en push config last test status enum
 */
export type FinancePushTestStatus =
  | 'ok'
  | 'auth'
  | 'scope'
  | 'validation'
  | 'network'
  | 'unknown';

/**
 * @description 财务推送配置(每作用域唯一一份;统一推送到 /api/v1/events/upsert;可绑定外部 webhook tenantId)
 * @keyword-en finance push config entity, scoped, unified events endpoint
 */
export interface FinancePushConfigEntity {
  _id: ObjectId;
  tenantId: string;
  /** 外部财务系统的租户 ID,用于 webhook tenantId -> 本系统作用域映射 */
  externalTenantId?: string;
  /** 通常形如 http(s)://server.com/api/v1;推送时拼到 /events/upsert */
  baseUrl: string;
  apiKey: string;
  lastTestedAt?: Date;
  lastTestStatus?: FinancePushTestStatus;
  lastTestMessage?: string;
  /** 上次推送的 binding name */
  lastPushName?: string;
  lastPushAt?: Date;
  lastPushTotalRows?: number;
  lastPushSuccessCount?: number;
  lastPushBatches?: number;
  lastPushFailedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 推送配置入参
 * @keyword-en finance push config input
 */
export interface FinancePushConfigInput {
  baseUrl: string;
  apiKey: string;
  externalTenantId?: string;
}
