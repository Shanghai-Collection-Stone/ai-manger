import type { ObjectId } from 'mongodb';
import type { AiCreditWalletKind } from './ai-credit-wallet.entity.js';
import type { AiCreditServiceCode } from './ai-service-credit.entity.js';

/**
 * @description Credit 余额流水的业务类型，流水只追加不修改删除；allocation 为租户待分配额度与成员之间划拨，registration_grant 为新成员赠送，migration 为旧租户余额迁移给成员。
 * @keyword-cn 流水类型, 只追加账本
 * @keyword-en transaction-type, append-only-ledger
 */
export type AiCreditTransactionType =
  | 'initial_credit'
  | 'recharge'
  | 'manual_adjustment'
  | 'service_charge'
  | 'provider_charge'
  | 'refund'
  | 'allocation'
  | 'registration_grant'
  | 'migration';

/**
 * @description Credit 余额变动流水，记录变动值及所在钱包变动前后余额；缺 wallet 的历史流水都属于租户钱包。
 * @keyword-cn Credit流水, 余额审计
 * @keyword-en credit-transaction, balance-audit
 */
export interface AiCreditTransactionEntity {
  _id: ObjectId;
  transactionId: string;
  /** 变动发生的租户；个人钱包的后台充值不属于任何租户时为空 */
  tenantId?: string;
  /** 变动所在钱包，缺省为 tenant（历史流水） */
  wallet?: AiCreditWalletKind;
  /** member 钱包流水的成员 ID */
  memberId?: string;
  /** account 钱包流水的账号 ID */
  accountId?: string;
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
