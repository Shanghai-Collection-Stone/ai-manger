import type { ObjectId } from 'mongodb';

/**
 * @description AI 调用的业务归属信息，平台任务必须显式使用 platformScope。
 * @keyword-cn 计费上下文, 调用归属
 * @keyword-en billing-context, call-attribution
 */
export interface AiBillingContext {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  operationId?: string;
  source?: string;
  platformScope?: boolean;
}

/**
 * @description AI 提供商在一次调用中使用的计费快照。
 * @keyword-cn 提供商计费, 固定Token
 * @keyword-en provider-billing, fixed-token
 */
export interface AiProviderBillingSnapshot {
  providerId?: string;
  providerCode: string;
  model?: string;
  modelCategory: 'llm' | 'image';
  tokensPerCredit?: number;
  fixedTokensPerCall?: number;
  streaming?: boolean;
}

/**
 * @description AI 调用用量流水，记录真实 Token、计费 Token 与 Credit 变化。
 * @keyword-cn AI用量流水, Credit扣费
 * @keyword-en ai-usage-ledger, credit-charge
 */
export interface AiUsageRecordEntity {
  _id: ObjectId;
  callId: string;
  parentCallId?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  operationId?: string;
  source?: string;
  modality: 'chat' | 'image';
  providerId?: string;
  providerCode: string;
  model?: string;
  modelCategory: 'llm' | 'image';
  status: 'started' | 'succeeded' | 'failed' | 'credit_exhausted';
  tokenSource: 'actual' | 'fixed' | 'estimated';
  inputTokens: number;
  outputTokens: number;
  actualTotalTokens?: number;
  billedTokens: number;
  tokensPerCredit?: number;
  fixedTokensPerCall?: number;
  reservedUnits: number;
  chargedUnits: number;
  theoreticalUnits: number;
  unlimited: boolean;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
