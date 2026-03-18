import { ObjectId } from 'mongodb';

/**
 * @description 决策卡实体
 * @keyword-en decision card entity
 */
export interface DecisionCardEntity {
  _id: ObjectId;
  sessionId: string;
  tenantId?: string;
  userId?: string;
  question: string;
  title: string;
  summary: string;
  reasoning?: string[];
  options?: string[];
  recommendation?: string;
  risks?: string[];
  actions?: string[];
  sourceDataBrief?: string;
  capabilityBrief?: string;
  status: 'generated' | 'applied' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}
