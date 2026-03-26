import type { ObjectId } from 'mongodb';

/**
 * @description 租户平台信息实体（AI补充说明）
 * @keyword-en tenant platform info entity
 */
export interface PlatformInfoEntity {
  _id: ObjectId;
  tenantId: string;
  /** AI 补充说明（markdown 格式），用于给各租户填写更适合自己使用习惯的AI提示 */
  aiPromptSupplement: string;
  createdAt: Date;
  updatedAt: Date;
}
