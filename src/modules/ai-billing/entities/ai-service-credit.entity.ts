import type { ObjectId } from 'mongodb';

/**
 * @description 代码内固定的 AI 收费服务编码。
 * @keyword-cn 服务编码, 固定目录
 * @keyword-en service-code, fixed-catalog
 */
export type AiCreditServiceCode = 'text-generation' | 'video-generation';

/**
 * @description 代码内固定的 AI 收费服务定义，后台只能修改消耗点数。
 * @keyword-cn 服务定义, 固定目录
 * @keyword-en service-definition, fixed-catalog
 */
export interface AiCreditServiceDefinition {
  code: AiCreditServiceCode;
  name: string;
  defaultCreditCost: number;
}

/**
 * @description AI 服务固定目录；新增收费业务时必须先在此登记英文编码和服务名。
 * @keyword-cn 服务目录, 固定编码
 * @keyword-en service-catalog, fixed-code
 */
export const AI_CREDIT_SERVICE_CATALOG: readonly AiCreditServiceDefinition[] = [
  { code: 'text-generation', name: '生文服务', defaultCreditCost: 1 },
  { code: 'video-generation', name: '生视频服务', defaultCreditCost: 1 },
];

/**
 * @description 后台可修改的 AI 服务 Credit 点数配置。
 * @keyword-cn 服务点数配置, 后台改价
 * @keyword-en service-credit-config, admin-pricing
 */
export interface AiServiceCreditConfigEntity {
  _id: ObjectId;
  serviceCode: AiCreditServiceCode;
  creditCost: number;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 后台展示的固定服务目录与当前生效点数合并视图。
 * @keyword-cn 服务管理视图, 生效点数
 * @keyword-en service-management-view, effective-credit
 */
export interface AiCreditServiceView extends AiCreditServiceDefinition {
  creditCost: number;
  configured: boolean;
  updatedAt?: Date;
}

/**
 * @description 一次服务级 Credit 扣费流水，用于审计服务编码、点数和业务操作。
 * @keyword-cn 服务扣费流水, 固定点数
 * @keyword-en service-charge-ledger, fixed-credit
 */
export interface AiServiceUsageRecordEntity {
  _id: ObjectId;
  chargeId: string;
  serviceCode: AiCreditServiceCode;
  serviceName: string;
  tenantId?: string;
  userId?: string;
  operationId?: string;
  source?: string;
  creditCost: number;
  chargedUnits: number;
  unlimited: boolean;
  status: 'succeeded' | 'credit_exhausted';
  errorCode?: string;
  createdAt: Date;
}
