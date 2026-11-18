import type { ObjectId } from 'mongodb';

/**
 * @description Credit 钱包种类：tenant 为租户待分配额度（存在 sass_tenants），member 为成员在某租户内的额度，account 为手机号账号的个人额度（跨租户通用）。
 * @keyword-cn 钱包种类, 三层额度
 * @keyword-en wallet-kind, three-tier-credit
 */
export type AiCreditWalletKind = 'tenant' | 'member' | 'account';

/**
 * @description 租户 Credit 模式：shared 为历史全员共用租户余额，allocated 为租户余额只作待分配额度、成员按各自额度消费。
 * @keyword-cn 租户额度模式, 统一分配
 * @keyword-en tenant-credit-mode, unified-allocation
 */
export type AiTenantCreditMode = 'shared' | 'allocated';

/**
 * @description 成员或个人 Credit 钱包文档（`ai_credit_wallets`），walletKey 形如 `member:<成员ID>` / `account:<账号ID>` 且唯一。
 * @keyword-cn 成员钱包, 个人钱包
 * @keyword-en member-wallet, personal-wallet
 */
export interface AiCreditWalletEntity {
  _id: ObjectId;
  walletKey: string;
  kind: Exclude<AiCreditWalletKind, 'tenant'>;
  /** member 钱包对应的 admin_users 成员 ID */
  memberId?: string;
  /** account 钱包对应的 admin_accounts 账号 ID；member 钱包记录成员所属账号便于对账 */
  accountId?: string;
  /** member 钱包所属租户 */
  tenantId?: string;
  /** 余额，整数最小计费单位 */
  creditUnits: number;
  /** 新成员赠送已处理的时间，存在即不再重复赠送 */
  grantedAt?: Date;
  /** 实际赠送的单位数，待分配额度不足时为 0 */
  grantedUnits?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 一次扣费可动用的付款钱包，按数组顺序依次扣减。
 * @keyword-cn 付款钱包, 扣费顺序
 * @keyword-en credit-payer, charge-order
 */
export interface AiCreditPayer {
  kind: AiCreditWalletKind;
  /** tenant 为租户 ID，member 为成员 ID，account 为账号 ID */
  ownerId: string;
  /** 本次消费发生的租户，写进流水便于按租户追溯 */
  tenantId?: string;
  memberId?: string;
  accountId?: string;
}

/**
 * @description 一次扣费落在某个钱包上的实际单位数，退款按它原路退回。
 * @keyword-cn 扣费分摊, 原路退回
 * @keyword-en charge-allocation, refund-to-source
 */
export interface AiCreditAllocation extends AiCreditPayer {
  units: number;
}
