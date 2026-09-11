import type { ObjectId } from 'mongodb';
import type { AiCreditServiceCode } from './ai-service-credit.entity.js';

/**
 * @description Credit 余额流水的业务类型，流水只追加不修改删除。
 * @keyword-cn 流水类型, 只追加账本
 * @keyword-en transaction-type, append-only-ledger
 */
export type AiCreditTransactionType =
  | 'initial_credit'
  | 'recharge'
  | 'manual_adjustment'
  | 'service_charge'
  | 'provider_charge'
  | 'refund';

/**
 * @description 租户 Credit 余额变动流水，记录变动值及变动前后余额。
 * @keyword-cn Credit流水, 余额审计
 * @keyword-en credit-transaction, balance-audit
 */
export interface AiCreditTransactionEntity {
  _id: ObjectId;
  transactionId: string;
  tenantId: string;
  type: AiCreditTransactionType;
  amount: number;
  amountUnits: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  operatorType: 'admin' | 'system';
  operatorId?: string;
  operatorName?: string;
  referenceId?: string;
  serviceCode?: AiCreditServiceCode;
  serviceName?: string;
  createdAt: Date;
}
