import type { AiCreditTransactionEntity } from '../../ai-billing/entities/ai-credit-transaction.entity.js';
import type { AiTenantCreditMode } from '../../ai-billing/entities/ai-credit-wallet.entity.js';
import type { SassTenantEntity } from '../../sass/entities/sass-tenant.entity.js';

/**
 * @description 租户 Credit 分配总览：模式、待分配额度与新成员赠送额度。
 * @keyword-cn 租户额度总览, 待分配额度
 * @keyword-en tenant-credit-summary, pool-credit
 */
export interface TenantCreditSummaryView {
  tenantId: string;
  tenantName: string;
  mode: AiTenantCreditMode;
  unlimited: boolean;
  /** 共用模式下是全员共用余额，分配模式下是尚未分出去的待分配额度；无限额度为 -1 */
  poolCredit: number;
  memberCreditGrant: number;
  creditMigratedAt: string | null;
}

/**
 * @description 成员额度行：成员在本租户的额度，超管额外看到个人额度。
 * @keyword-cn 成员额度视图, 个人额度
 * @keyword-en member-credit-view, personal-credit
 */
export interface MemberCreditView {
  memberId: string;
  accountId: string | null;
  displayName: string;
  phone: string | null;
  role: string;
  enabled: boolean;
  tenantCredit: number;
  /** 仅超管可见，其余角色为 null */
  personalCredit: number | null;
}

/**
 * @description 当前成员可用额度拆分：本租户额度 + 个人额度 = 合计；无限额度时三项均为 -1。
 * @keyword-cn 当前额度拆分, 合计额度
 * @keyword-en current-credit-breakdown, total-credit
 */
export interface CurrentCreditWalletView {
  mode: AiTenantCreditMode;
  unlimited: boolean;
  tenantCredit: number;
  personalCredit: number;
  totalCredit: number;
}

/**
 * @description 桌面端账户中心使用的 Credit 账户：沿用 `{ tenant, transactions }` 形状，tenant.credit 改为当前成员合计可用额度，拆分放在 tenant.creditWallet。
 * @keyword-cn 当前Credit账户, 兼容旧形状
 * @keyword-en current-credit-account, legacy-shape-compat
 */
export interface CurrentCreditAccountView {
  tenant: (SassTenantEntity & { creditWallet: CurrentCreditWalletView }) | null;
  transactions: AiCreditTransactionEntity[];
}
