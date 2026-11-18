import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { ClientSession, Collection, Db, Filter } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type { SassTenantEntity } from '../../sass/entities/sass-tenant.entity.js';
import type {
  AiCreditTransactionEntity,
  AiCreditTransactionType,
} from '../entities/ai-credit-transaction.entity.js';
import type {
  AiCreditAllocation,
  AiCreditPayer,
  AiCreditWalletEntity,
  AiCreditWalletKind,
  AiTenantCreditMode,
} from '../entities/ai-credit-wallet.entity.js';
import type { AiCreditServiceCode } from '../entities/ai-service-credit.entity.js';

/**
 * @description 一个 Credit 的整数最小计费单位，与 ai-billing.service 的 CREDIT_UNIT_SCALE 保持一致。
 * @keyword-cn 钱包计费精度, 最小计费单位
 * @keyword-en wallet-unit-scale, billing-unit-scale
 */
const WALLET_UNIT_SCALE = 1_000_000;

/**
 * @description 写一笔钱包流水需要的业务信息。
 * @keyword-cn 流水元信息, 操作方
 * @keyword-en ledger-meta, ledger-operator
 */
export interface AiCreditLedgerMeta {
  type: AiCreditTransactionType;
  reason: string;
  referenceId?: string;
  serviceCode?: AiCreditServiceCode;
  serviceName?: string;
  operatorType?: 'admin' | 'system';
  operatorId?: string;
  operatorName?: string;
}

/**
 * @description 一次多钱包扣费的结果，revert 用它撤销。
 * @keyword-cn 扣费结果, 撤销依据
 * @keyword-en debit-result, revert-basis
 */
export interface AiCreditDebitResult {
  allocations: AiCreditAllocation[];
  transactionIds: string[];
}

/**
 * @description Credit 钱包服务：维护租户待分配额度、成员租户额度与个人额度三种钱包，提供按顺序跨钱包原子扣减、原路退款、划拨、新成员赠送与旧余额迁移。
 * @keyword-cn Credit钱包, 跨钱包扣费
 * @keyword-en credit-wallet-service, multi-wallet-debit
 */
@Injectable()
export class AiCreditWalletService {
  private readonly logger = new Logger(AiCreditWalletService.name);
  private readonly wallets: Collection<AiCreditWalletEntity>;
  private readonly tenants: Collection<SassTenantEntity>;
  private readonly users: Collection<AdminUserEntity>;
  private readonly transactions: Collection<AiCreditTransactionEntity>;
  private readonly tenantUnitsReady = new Set<string>();

  /**
   * @description 初始化钱包相关集合并异步建索引。
   * @keyword-cn 钱包服务初始化, 钱包索引
   * @keyword-en wallet-service-init, wallet-index
   */
  constructor(@Inject('CTX_MONGO_DB') db: Db) {
    this.wallets = db.collection<AiCreditWalletEntity>('ai_credit_wallets');
    this.tenants = db.collection<SassTenantEntity>('sass_tenants');
    this.users = db.collection<AdminUserEntity>('admin_users');
    this.transactions = db.collection<AiCreditTransactionEntity>(
      'ai_credit_transactions',
    );
    void this.ensureIndexes().catch((error: unknown) => {
      this.logger.warn(
        `[wallet] ensureIndexes failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /**
   * @description 建立钱包唯一键、租户成员钱包与按成员 / 账号查流水的索引。
   * @keyword-cn 钱包索引, 钱包流水索引
   * @keyword-en wallet-index, wallet-ledger-index
   */
  async ensureIndexes(): Promise<void> {
    await this.wallets.createIndex({ walletKey: 1 }, { unique: true });
    await this.wallets.createIndex({ kind: 1, tenantId: 1 });
    await this.transactions.createIndex(
      { memberId: 1, createdAt: -1 },
      { partialFilterExpression: { memberId: { $exists: true } } },
    );
    await this.transactions.createIndex(
      { accountId: 1, createdAt: -1 },
      { partialFilterExpression: { accountId: { $exists: true } } },
    );
  }

  /**
   * @description 拼出成员或个人钱包的唯一键。
   * @keyword-cn 钱包唯一键, 钱包定位
   * @keyword-en wallet-key, wallet-locate
   */
  walletKey(
    kind: Exclude<AiCreditWalletKind, 'tenant'>,
    ownerId: string,
  ): string {
    return `${kind}:${ownerId}`;
  }

  /**
   * @description 读取租户 Credit 模式，缺省视为历史共用模式。
   * @keyword-cn 租户额度模式, 历史共用
   * @keyword-en tenant-credit-mode, legacy-shared
   */
  creditMode(tenant: SassTenantEntity): AiTenantCreditMode {
    return tenant.creditMode === 'allocated' ? 'allocated' : 'shared';
  }

  /**
   * @description 判断租户是否为无限额度（-1 或缺 credit 字段）。
   * @keyword-cn 无限额度, 租户额度
   * @keyword-en unlimited-credit, tenant-credit
   */
  isUnlimited(tenant: SassTenantEntity): boolean {
    return (
      typeof tenant.credit !== 'number' ||
      tenant.credit === -1 ||
      tenant.creditUnits === -1
    );
  }

  /**
   * @description 按租户模式与调用成员确定扣费钱包顺序：分配模式先成员租户额度、共用模式先租户余额，再扣个人额度；查不到成员（系统任务）只扣租户余额。
   * @keyword-cn 付款顺序, 先租户后个人
   * @keyword-en resolve-payers, tenant-first-then-personal
   */
  async resolvePayers(
    tenant: SassTenantEntity,
    userId?: string,
  ): Promise<AiCreditPayer[]> {
    const tenantId = tenant._id.toHexString();
    const tenantPayer: AiCreditPayer = {
      kind: 'tenant',
      ownerId: tenantId,
      tenantId,
    };
    const member = await this.findTenantMember(tenantId, userId);
    if (!member) return [tenantPayer];
    const memberId = member._id.toHexString();
    const accountId = member.accountId?.trim() || undefined;
    const payers: AiCreditPayer[] =
      this.creditMode(tenant) === 'allocated'
        ? [{ kind: 'member', ownerId: memberId, tenantId, memberId, accountId }]
        : [{ ...tenantPayer, memberId, accountId }];
    if (accountId) {
      payers.push({
        kind: 'account',
        ownerId: accountId,
        tenantId,
        memberId,
        accountId,
      });
    }
    return payers;
  }

  /**
   * @description 按调用方用户 ID 读取其在该租户下的成员身份，非法 ID 或跨租户返回 null。
   * @keyword-cn 计费成员, 租户成员查找
   * @keyword-en billing-member, tenant-member-lookup
   */
  private async findTenantMember(
    tenantId: string,
    userId?: string,
  ): Promise<AdminUserEntity | null> {
    const raw = String(userId ?? '').trim();
    if (!raw || !ObjectId.isValid(raw)) return null;
    return this.users.findOne({ _id: new ObjectId(raw), tenantId });
  }

  /**
   * @description 依次从多个钱包扣减指定单位；partial 时能扣多少扣多少（耗尽尾款），否则不足即撤销已扣部分并抛 CREDIT_EXHAUSTED。每个落账钱包写一笔流水。
   * @keyword-cn 跨钱包扣费, 额度耗尽
   * @keyword-en multi-wallet-debit, credit-exhausted
   */
  async debit(input: {
    payers: AiCreditPayer[];
    units: number;
    partial?: boolean;
    meta: AiCreditLedgerMeta;
    session?: ClientSession;
  }): Promise<AiCreditDebitResult> {
    const units = Math.max(0, Math.floor(input.units));
    const allocations: AiCreditAllocation[] = [];
    if (units <= 0 || !input.payers.length) {
      return { allocations, transactionIds: [] };
    }
    const balances: number[] = [];
    let remaining = units;
    for (
      let index = 0;
      index < input.payers.length && remaining > 0;
      index += 1
    ) {
      const payer = input.payers[index];
      const exact = !input.partial && index === input.payers.length - 1;
      const result = await this.take(payer, remaining, exact, input.session);
      if (result.taken <= 0) continue;
      allocations.push({ ...payer, units: result.taken });
      balances.push(result.after);
      remaining -= result.taken;
    }
    if (remaining > 0 && !input.partial) {
      if (!input.session) await this.giveBack(allocations);
      throw this.walletError('CREDIT_EXHAUSTED');
    }
    const transactionIds: string[] = [];
    try {
      for (let index = 0; index < allocations.length; index += 1) {
        const allocation = allocations[index];
        const transaction = this.buildLedger(
          allocation,
          -allocation.units,
          balances[index],
          input.meta,
        );
        await this.insertLedger(transaction, input.session);
        transactionIds.push(transaction.transactionId);
      }
    } catch (error) {
      if (!input.session) {
        await this.revert({ allocations, transactionIds });
      }
      throw error;
    }
    return { allocations, transactionIds };
  }

  /**
   * @description 撤销一次未提交成功的扣费：删掉已写流水并把单位加回原钱包（单机 Mongo 补偿用）。
   * @keyword-cn 撤销扣费, 单机补偿
   * @keyword-en revert-debit, standalone-compensation
   */
  async revert(result: AiCreditDebitResult): Promise<void> {
    if (result.transactionIds.length) {
      await this.transactions.deleteMany({
        transactionId: { $in: result.transactionIds },
      });
    }
    await this.giveBack(result.allocations);
  }

  /**
   * @description 按扣费分摊从后往前原路退回指定单位并写退款流水；租户已改成无限额度时只跳过加余额。加余额失败会抛出并带上已退单位数。
   * @keyword-cn 原路退款, 预占退款
   * @keyword-en refund-to-source, reservation-refund
   */
  async refund(input: {
    allocations: AiCreditAllocation[];
    units: number;
    meta: AiCreditLedgerMeta;
  }): Promise<{ refundedUnits: number; remaining: AiCreditAllocation[] }> {
    const remaining = input.allocations.map((item) => ({ ...item }));
    let left = Math.max(0, Math.floor(input.units));
    let refundedUnits = 0;
    for (let index = remaining.length - 1; index >= 0 && left > 0; index -= 1) {
      const allocation = remaining[index];
      const portion = Math.min(allocation.units, left);
      if (portion <= 0) continue;
      let after: number | null;
      try {
        after = await this.give(allocation, portion);
      } catch (error) {
        const wrapped = error as Error & { creditedUnits?: number };
        wrapped.creditedUnits = refundedUnits;
        throw wrapped;
      }
      allocation.units -= portion;
      left -= portion;
      if (after === null) continue;
      refundedUnits += portion;
      try {
        await this.insertLedger(
          this.buildLedger(allocation, portion, after, input.meta),
        );
      } catch (error) {
        // 余额已加回，流水写失败不能回滚余额，否则会重复退款；只记日志供对账
        this.logger.error(
          `[wallet] refund credited but ledger insert failed wallet=${allocation.kind}:${allocation.ownerId} units=${portion} ref=${input.meta.referenceId ?? ''}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      refundedUnits,
      remaining: remaining.filter((item) => item.units > 0),
    };
  }

  /**
   * @description 在两个钱包之间原子划拨（先扣后加），不足时抛 insufficientCode，写出入两笔流水；流水失败整体撤销。
   * @keyword-cn 钱包划拨, 额度分配
   * @keyword-en wallet-transfer, credit-allocation
   */
  async transfer(input: {
    from: AiCreditPayer;
    to: AiCreditPayer;
    units: number;
    meta: AiCreditLedgerMeta;
    insufficientCode: string;
  }): Promise<{ fromAfter: number; toAfter: number }> {
    const units = Math.floor(input.units);
    if (units <= 0) throw this.walletError('CREDIT_AMOUNT_INVALID');
    if (input.from.kind === 'tenant') {
      await this.ensureTenantUnits(new ObjectId(input.from.ownerId));
    }
    const taken = await this.take(input.from, units, true);
    if (taken.taken <= 0) throw this.walletError(input.insufficientCode);
    const toAfter = await this.give(input.to, units).catch(async (error) => {
      await this.give(input.from, units);
      throw error;
    });
    if (toAfter === null) {
      await this.give(input.from, units);
      throw this.walletError('UNLIMITED_CREDIT_CANNOT_ALLOCATE');
    }
    const outgoing = this.buildLedger(
      input.from,
      -units,
      taken.after,
      input.meta,
    );
    const incoming = this.buildLedger(input.to, units, toAfter, input.meta);
    const written: string[] = [];
    try {
      await this.insertLedger(outgoing);
      written.push(outgoing.transactionId);
      await this.insertLedger(incoming);
      written.push(incoming.transactionId);
    } catch (error) {
      if (written.length) {
        await this.transactions.deleteMany({ transactionId: { $in: written } });
      }
      await this.take(input.to, units, true);
      await this.give(input.from, units);
      throw error;
    }
    return { fromAfter: taken.after, toAfter };
  }

  /**
   * @description 新成员加入分配模式租户时，从待分配额度赠送租户设定的 Credit；同一成员只处理一次，待分配额度不足则记为未赠送。
   * @keyword-cn 新成员赠送, 注册发放
   * @keyword-en new-member-grant, registration-grant
   */
  async grantNewMember(
    tenant: SassTenantEntity,
    member: { memberId: string; accountId?: string },
  ): Promise<number> {
    if (this.creditMode(tenant) !== 'allocated' || this.isUnlimited(tenant)) {
      return 0;
    }
    const grantUnits = Math.round(
      Math.max(0, Number(tenant.memberCreditGrant) || 0) * WALLET_UNIT_SCALE,
    );
    if (grantUnits <= 0) return 0;
    const tenantId = tenant._id.toHexString();
    const walletKey = this.walletKey('member', member.memberId);
    const now = new Date();
    try {
      await this.wallets.updateOne(
        { walletKey, grantedAt: { $exists: false } },
        {
          $set: { grantedAt: now, grantedUnits: 0, updatedAt: now },
          $setOnInsert: {
            _id: new ObjectId(),
            kind: 'member',
            memberId: member.memberId,
            ...(member.accountId ? { accountId: member.accountId } : {}),
            tenantId,
            creditUnits: 0,
            createdAt: now,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) return 0;
      throw error;
    }
    try {
      await this.transfer({
        from: { kind: 'tenant', ownerId: tenantId, tenantId },
        to: {
          kind: 'member',
          ownerId: member.memberId,
          tenantId,
          memberId: member.memberId,
          accountId: member.accountId,
        },
        units: grantUnits,
        meta: {
          type: 'registration_grant',
          reason: '新成员赠送',
          referenceId: `member-grant:${member.memberId}`,
          operatorType: 'system',
        },
        insufficientCode: 'CREDIT_POOL_INSUFFICIENT',
      });
    } catch (error) {
      this.logger.warn(
        `[wallet] new member grant skipped tenant=${tenantId} member=${member.memberId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
    await this.wallets.updateOne(
      { walletKey },
      { $set: { grantedUnits: grantUnits, updatedAt: new Date() } },
    );
    return grantUnits;
  }

  /**
   * @description 旧共用租户迁移：原子切到分配模式并清零租户余额，再给每个启用成员发一份等于原余额的全额，逐笔写迁移流水。
   * @keyword-cn 旧余额迁移, 每人全额
   * @keyword-en legacy-credit-migration, full-copy-per-member
   */
  async migrateTenantToMembers(input: {
    tenant: SassTenantEntity;
    members: Array<{ memberId: string; accountId?: string }>;
    operator: { operatorId: string; operatorName: string };
  }): Promise<{ amountUnits: number; credited: number; failed: string[] }> {
    const tenantObjectId = input.tenant._id;
    const tenantId = tenantObjectId.toHexString();
    await this.ensureTenantUnits(tenantObjectId);
    const now = new Date();
    const claimed = await this.tenants.findOneAndUpdate(
      {
        _id: tenantObjectId,
        credit: { $ne: -1 },
        creditUnits: { $ne: -1 },
        creditMode: { $ne: 'allocated' },
      },
      {
        $set: {
          creditMode: 'allocated',
          creditUnits: 0,
          credit: 0,
          creditMigratedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'before', includeResultMetadata: true },
    );
    if (!claimed.value)
      throw this.walletError('TENANT_CREDIT_ALREADY_ALLOCATED');
    const amountUnits = Math.max(0, Math.floor(claimed.value.creditUnits ?? 0));
    const meta: AiCreditLedgerMeta = {
      type: 'migration',
      reason: '旧租户余额迁移给成员（每人一份全额）',
      referenceId: `tenant-migration:${tenantId}`,
      operatorType: 'admin',
      operatorId: input.operator.operatorId,
      operatorName: input.operator.operatorName,
    };
    if (amountUnits > 0) {
      await this.insertLedger(
        this.buildLedger(
          { kind: 'tenant', ownerId: tenantId, tenantId },
          -amountUnits,
          0,
          meta,
        ),
      ).catch((error: unknown) => {
        this.logger.error(
          `[wallet] migration pool ledger failed tenant=${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    let credited = 0;
    const failed: string[] = [];
    if (amountUnits <= 0) return { amountUnits, credited, failed };
    for (const member of input.members) {
      const payer: AiCreditPayer = {
        kind: 'member',
        ownerId: member.memberId,
        tenantId,
        memberId: member.memberId,
        accountId: member.accountId,
      };
      try {
        const after = await this.give(payer, amountUnits);
        if (after === null) continue;
        await this.insertLedger(
          this.buildLedger(payer, amountUnits, after, meta),
        );
        credited += 1;
      } catch (error) {
        failed.push(member.memberId);
        this.logger.error(
          `[wallet] migration credit failed tenant=${tenantId} member=${member.memberId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { amountUnits, credited, failed };
  }

  /**
   * @description 不迁移余额，直接把共用租户切到分配模式，原余额保留为待分配额度。
   * @keyword-cn 切换分配模式, 保留待分配额度
   * @keyword-en enable-allocation-mode, keep-pool-balance
   */
  async enableAllocation(tenant: SassTenantEntity): Promise<void> {
    const result = await this.tenants.updateOne(
      { _id: tenant._id, creditMode: { $ne: 'allocated' } },
      { $set: { creditMode: 'allocated', updatedAt: new Date() } },
    );
    if (!result.matchedCount) {
      throw this.walletError('TENANT_CREDIT_ALREADY_ALLOCATED');
    }
  }

  /**
   * @description 后台给个人钱包充值或调账：正数加余额、负数扣余额且不许透支；同一外部单号幂等返回原流水。
   * @keyword-cn 个人充值, 个人调账
   * @keyword-en personal-recharge, personal-adjustment
   */
  async changeAccountWallet(input: {
    accountId: string;
    units: number;
    type: 'recharge' | 'manual_adjustment';
    reason: string;
    referenceId?: string;
    operator: { operatorId: string; operatorName: string };
  }): Promise<{
    balanceUnits: number;
    transaction: AiCreditTransactionEntity;
  }> {
    const units = Math.trunc(input.units);
    if (!Number.isSafeInteger(units) || units === 0) {
      throw this.walletError('CREDIT_AMOUNT_INVALID');
    }
    const referenceId = input.referenceId?.trim() || undefined;
    const payer: AiCreditPayer = {
      kind: 'account',
      ownerId: input.accountId,
      accountId: input.accountId,
    };
    if (referenceId) {
      const existing = await this.transactions.findOne({
        wallet: 'account',
        accountId: input.accountId,
        referenceId,
        operatorType: 'admin',
      });
      if (existing) {
        return {
          balanceUnits: await this.getWalletUnits('account', input.accountId),
          transaction: existing,
        };
      }
    }
    let after: number;
    if (units > 0) {
      const given = await this.give(payer, units);
      after = given ?? 0;
    } else {
      const taken = await this.take(payer, -units, true);
      if (taken.taken <= 0) throw this.walletError('CREDIT_OVERDRAFT');
      after = taken.after;
    }
    const transaction = this.buildLedger(payer, units, after, {
      type: input.type,
      reason: input.reason.trim(),
      referenceId,
      operatorType: 'admin',
      operatorId: input.operator.operatorId,
      operatorName: input.operator.operatorName,
    });
    try {
      await this.insertLedger(transaction);
    } catch (error) {
      if (units > 0) await this.take(payer, units, true);
      else await this.give(payer, -units);
      throw error;
    }
    return { balanceUnits: after, transaction };
  }

  /**
   * @description 读取单个成员或个人钱包余额，钱包不存在为 0。
   * @keyword-cn 钱包余额, 单钱包查询
   * @keyword-en wallet-balance, single-wallet-query
   */
  async getWalletUnits(
    kind: Exclude<AiCreditWalletKind, 'tenant'>,
    ownerId: string,
  ): Promise<number> {
    const wallet = await this.wallets.findOne({
      walletKey: this.walletKey(kind, ownerId),
    });
    return Math.max(0, wallet?.creditUnits ?? 0);
  }

  /**
   * @description 批量读取一组成员或个人钱包余额，返回 ownerId → 单位数。
   * @keyword-cn 批量钱包余额, 成员额度列表
   * @keyword-en batch-wallet-balance, member-credit-list
   */
  async getWalletUnitsMap(
    kind: Exclude<AiCreditWalletKind, 'tenant'>,
    ownerIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const ids = Array.from(new Set(ownerIds.filter(Boolean)));
    if (!ids.length) return map;
    const rows = await this.wallets
      .find({ walletKey: { $in: ids.map((id) => this.walletKey(kind, id)) } })
      .toArray();
    for (const row of rows) {
      const ownerId = kind === 'member' ? row.memberId : row.accountId;
      if (ownerId) map.set(ownerId, Math.max(0, row.creditUnits ?? 0));
    }
    return map;
  }

  /**
   * @description 按过滤条件倒序分页读取钱包流水。
   * @keyword-cn 钱包流水查询, 倒序分页
   * @keyword-en wallet-ledger-query, reverse-pagination
   */
  async listTransactions(
    filter: Filter<AiCreditTransactionEntity>,
    input: { limit?: number; before?: Date },
  ): Promise<AiCreditTransactionEntity[]> {
    const query: Filter<AiCreditTransactionEntity> = { ...filter };
    if (input.before) query.createdAt = { $lt: input.before };
    return this.transactions
      .find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, input.limit ?? 50)))
      .toArray();
  }

  /**
   * @description 为历史租户懒初始化 Credit 与整数计费单位，缺 credit 视为无限额度。
   * @keyword-cn 历史租户兼容, 余额单位初始化
   * @keyword-en legacy-tenant-compat, balance-unit-init
   */
  async ensureTenantUnits(tenantId: ObjectId): Promise<void> {
    const tenantKey = tenantId.toHexString();
    if (this.tenantUnitsReady.has(tenantKey)) return;
    const tenant = await this.tenants.findOne({ _id: tenantId });
    if (!tenant) throw this.walletError('TENANT_NOT_FOUND');
    if (typeof tenant.credit !== 'number') {
      await this.tenants.updateOne(
        { _id: tenantId, credit: { $exists: false } },
        { $set: { credit: -1, creditUnits: -1, updatedAt: new Date() } },
      );
      this.tenantUnitsReady.add(tenantKey);
      return;
    }
    if (typeof tenant.creditUnits !== 'number') {
      const units =
        tenant.credit === -1
          ? -1
          : Math.max(0, Math.floor(tenant.credit * WALLET_UNIT_SCALE));
      await this.tenants.updateOne(
        { _id: tenantId, creditUnits: { $exists: false } },
        { $set: { creditUnits: units, updatedAt: new Date() } },
      );
    }
    this.tenantUnitsReady.add(tenantKey);
  }

  /**
   * @description 从单个钱包原子扣减：exact 时余额够才扣满，否则扣到 0 为止；返回实际扣减与扣后余额。
   * @keyword-cn 单钱包扣减, 原子扣减余额
   * @keyword-en single-wallet-take, atomic-balance-debit
   */
  private async take(
    payer: AiCreditPayer,
    units: number,
    exact: boolean,
    session?: ClientSession,
  ): Promise<{ taken: number; after: number }> {
    if (units <= 0) return { taken: 0, after: 0 };
    const now = new Date();
    const options = {
      includeResultMetadata: true as const,
      ...(session ? { session } : {}),
    };
    if (payer.kind === 'tenant') {
      const tenantId = new ObjectId(payer.ownerId);
      await this.ensureTenantUnits(tenantId);
      if (exact) {
        const result = await this.tenants.findOneAndUpdate(
          { _id: tenantId, credit: { $ne: -1 }, creditUnits: { $gte: units } },
          {
            $inc: { creditUnits: -units, credit: -units / WALLET_UNIT_SCALE },
            $set: { updatedAt: now },
          },
          { returnDocument: 'after', ...options },
        );
        return result.value
          ? { taken: units, after: result.value.creditUnits }
          : { taken: 0, after: 0 };
      }
      const result = await this.tenants.findOneAndUpdate(
        { _id: tenantId, credit: { $ne: -1 }, creditUnits: { $gt: 0 } },
        [
          {
            $set: {
              creditUnits: {
                $max: [0, { $subtract: ['$creditUnits', units] }],
              },
              updatedAt: now,
            },
          },
          {
            $set: { credit: { $divide: ['$creditUnits', WALLET_UNIT_SCALE] } },
          },
        ],
        { returnDocument: 'before', ...options },
      );
      const before = Math.max(0, Math.floor(result.value?.creditUnits ?? 0));
      const taken = Math.min(before, units);
      return { taken, after: before - taken };
    }
    const walletKey = this.walletKey(payer.kind, payer.ownerId);
    if (exact) {
      const result = await this.wallets.findOneAndUpdate(
        { walletKey, creditUnits: { $gte: units } },
        { $inc: { creditUnits: -units }, $set: { updatedAt: now } },
        { returnDocument: 'after', ...options },
      );
      return result.value
        ? { taken: units, after: result.value.creditUnits }
        : { taken: 0, after: 0 };
    }
    const result = await this.wallets.findOneAndUpdate(
      { walletKey, creditUnits: { $gt: 0 } },
      [
        {
          $set: {
            creditUnits: { $max: [0, { $subtract: ['$creditUnits', units] }] },
            updatedAt: now,
          },
        },
      ],
      { returnDocument: 'before', ...options },
    );
    const before = Math.max(0, Math.floor(result.value?.creditUnits ?? 0));
    const taken = Math.min(before, units);
    return { taken, after: before - taken };
  }

  /**
   * @description 给单个钱包加单位并返回加后余额；成员 / 个人钱包不存在时自动创建，租户已是无限额度返回 null。
   * @keyword-cn 单钱包入账, 自动建钱包
   * @keyword-en single-wallet-give, auto-create-wallet
   */
  private async give(
    payer: AiCreditPayer,
    units: number,
    session?: ClientSession,
  ): Promise<number | null> {
    const now = new Date();
    const options = {
      returnDocument: 'after' as const,
      includeResultMetadata: true as const,
      ...(session ? { session } : {}),
    };
    if (payer.kind === 'tenant') {
      const result = await this.tenants.findOneAndUpdate(
        { _id: new ObjectId(payer.ownerId), credit: { $ne: -1 } },
        {
          $inc: { creditUnits: units, credit: units / WALLET_UNIT_SCALE },
          $set: { updatedAt: now },
        },
        options,
      );
      return result.value ? result.value.creditUnits : null;
    }
    const walletKey = this.walletKey(payer.kind, payer.ownerId);
    const result = await this.wallets.findOneAndUpdate(
      { walletKey },
      {
        $inc: { creditUnits: units },
        $set: { updatedAt: now },
        $setOnInsert: {
          _id: new ObjectId(),
          kind: payer.kind,
          ...(payer.kind === 'member'
            ? { memberId: payer.ownerId, tenantId: payer.tenantId }
            : {}),
          ...(payer.accountId || payer.kind === 'account'
            ? {
                accountId:
                  payer.kind === 'account' ? payer.ownerId : payer.accountId,
              }
            : {}),
          createdAt: now,
        },
      },
      { ...options, upsert: true },
    );
    return result.value?.creditUnits ?? units;
  }

  /**
   * @description 把一组扣费分摊原样加回各自钱包，不写流水（撤销未提交的扣费用）。
   * @keyword-cn 加回余额, 补偿撤销
   * @keyword-en give-back-balance, compensation-undo
   */
  private async giveBack(allocations: AiCreditAllocation[]): Promise<void> {
    for (const allocation of allocations) {
      try {
        await this.give(allocation, allocation.units);
      } catch (error) {
        this.logger.error(
          `[wallet] compensation failed wallet=${allocation.kind}:${allocation.ownerId} units=${allocation.units}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * @description 按钱包与变动值生成一笔追加式流水，余额字段取该钱包变动前后值。
   * @keyword-cn 生成钱包流水, 变动前后余额
   * @keyword-en build-wallet-ledger, balance-before-after
   */
  private buildLedger(
    payer: AiCreditPayer,
    deltaUnits: number,
    afterUnits: number,
    meta: AiCreditLedgerMeta,
  ): AiCreditTransactionEntity {
    const transaction: AiCreditTransactionEntity = {
      _id: new ObjectId(),
      transactionId: randomUUID(),
      wallet: payer.kind,
      type: meta.type,
      amount: deltaUnits / WALLET_UNIT_SCALE,
      amountUnits: deltaUnits,
      balanceBefore: (afterUnits - deltaUnits) / WALLET_UNIT_SCALE,
      balanceAfter: afterUnits / WALLET_UNIT_SCALE,
      reason: meta.reason,
      operatorType: meta.operatorType ?? 'system',
      createdAt: new Date(),
    };
    if (payer.tenantId) transaction.tenantId = payer.tenantId;
    if (payer.memberId && payer.kind !== 'account') {
      transaction.memberId = payer.memberId;
    }
    if (payer.kind === 'account') transaction.accountId = payer.ownerId;
    if (meta.operatorId) transaction.operatorId = meta.operatorId;
    if (meta.operatorName) transaction.operatorName = meta.operatorName;
    if (meta.referenceId) transaction.referenceId = meta.referenceId;
    if (meta.serviceCode) transaction.serviceCode = meta.serviceCode;
    if (meta.serviceName) transaction.serviceName = meta.serviceName;
    return transaction;
  }

  /**
   * @description 写入一笔流水，有事务会话时随会话提交。
   * @keyword-cn 写入流水, 事务会话
   * @keyword-en insert-ledger, transaction-session
   */
  private async insertLedger(
    transaction: AiCreditTransactionEntity,
    session?: ClientSession,
  ): Promise<void> {
    if (session) await this.transactions.insertOne(transaction, { session });
    else await this.transactions.insertOne(transaction);
  }

  /**
   * @description 构造带稳定错误码的钱包异常。
   * @keyword-cn 钱包异常, 错误码
   * @keyword-en wallet-error, error-code
   */
  private walletError(code: string): Error {
    const error = new Error(code) as Error & { code?: string };
    error.name = code;
    error.code = code;
    return error;
  }
}
