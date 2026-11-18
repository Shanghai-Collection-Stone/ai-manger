import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import type { Collection, Db, Filter } from 'mongodb';
import type {
  AdminAccountEntity,
  AdminUserEntity,
} from '../../admin/entities/admin.entity.js';
import type { AiCreditTransactionEntity } from '../../ai-billing/entities/ai-credit-transaction.entity.js';
import {
  AiCreditWalletService,
  type AiCreditLedgerMeta,
} from '../../ai-billing/services/ai-credit-wallet.service.js';
import type { SassTenantEntity } from '../../sass/entities/sass-tenant.entity.js';
import type {
  CurrentCreditAccountView,
  MemberCreditView,
  TenantCreditSummaryView,
} from '../entities/tenant-credit.entity.js';

/**
 * @description 一个 Credit 的整数最小计费单位，与计费模块一致。
 * @keyword-cn 额度计费精度, 最小计费单位
 * @keyword-en tenant-credit-unit-scale, billing-unit-scale
 */
const UNIT_SCALE = 1_000_000;

/**
 * @description 钱包层错误码中需要原样透传给后台的业务错误。
 * @keyword-cn 钱包业务错误, 错误透传
 * @keyword-en wallet-business-errors, error-passthrough
 */
const WALLET_BUSINESS_ERRORS = new Set([
  'CREDIT_AMOUNT_INVALID',
  'CREDIT_POOL_INSUFFICIENT',
  'MEMBER_CREDIT_INSUFFICIENT',
  'CREDIT_OVERDRAFT',
  'TENANT_CREDIT_ALREADY_ALLOCATED',
  'UNLIMITED_CREDIT_CANNOT_ALLOCATE',
  'TENANT_NOT_FOUND',
]);

/**
 * @description 租户 Credit 分配服务：租户管理员把待分配额度分给成员、设置新成员赠送额度，超管迁移旧余额与给个人额度充值，并为桌面端返回当前成员的额度拆分。
 * @keyword-cn 租户额度分配服务, 成员额度
 * @keyword-en tenant-credit-service, member-credit
 */
@Injectable()
export class TenantCreditService {
  private readonly logger = new Logger(TenantCreditService.name);
  private readonly tenants: Collection<SassTenantEntity>;
  private readonly users: Collection<AdminUserEntity>;
  private readonly accounts: Collection<AdminAccountEntity>;

  /**
   * @description 注入数据源库与钱包服务。
   * @keyword-cn 额度服务初始化, 钱包依赖
   * @keyword-en tenant-credit-service-init, wallet-dependency
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly wallet: AiCreditWalletService,
  ) {
    this.tenants = db.collection<SassTenantEntity>('sass_tenants');
    this.users = db.collection<AdminUserEntity>('admin_users');
    this.accounts = db.collection<AdminAccountEntity>('admin_accounts');
  }

  /**
   * @description 返回当前登录成员的额度：分配模式为本租户分到的额度 + 个人额度，共用模式为租户余额 + 个人额度；tenant.credit 换成合计值，旧客户端直接显示也正确。
   * @keyword-cn 当前Credit账户, 额度拆分
   * @keyword-en current-credit-account, credit-breakdown
   */
  async getCurrentAccount(
    user: AdminUserEntity,
    input: { limit?: number; before?: Date },
  ): Promise<CurrentCreditAccountView> {
    if (!user.tenantId) return { tenant: null, transactions: [] };
    const tenant = await this.requireTenant(user.tenantId);
    const mode = this.wallet.creditMode(tenant);
    const unlimited = this.wallet.isUnlimited(tenant);
    const memberId = user._id.toHexString();
    const accountId = user.accountId?.trim() || undefined;
    const personalUnits = accountId
      ? await this.wallet.getWalletUnits('account', accountId)
      : 0;
    const tenantUnits = unlimited
      ? -1
      : mode === 'allocated'
        ? await this.wallet.getWalletUnits('member', memberId)
        : this.tenantUnits(tenant);
    const totalUnits = unlimited ? -1 : tenantUnits + personalUnits;
    const filters: Filter<AiCreditTransactionEntity>[] = [
      mode === 'allocated'
        ? { wallet: 'member', memberId }
        : { tenantId: user.tenantId, wallet: { $nin: ['member', 'account'] } },
    ];
    if (accountId) filters.push({ wallet: 'account', accountId });
    const transactions = await this.wallet.listTransactions(
      { $or: filters },
      input,
    );
    return {
      tenant: {
        ...tenant,
        credit: unlimited ? -1 : totalUnits / UNIT_SCALE,
        creditUnits: totalUnits,
        creditWallet: {
          mode,
          unlimited,
          tenantCredit: unlimited ? -1 : tenantUnits / UNIT_SCALE,
          personalCredit: personalUnits / UNIT_SCALE,
          totalCredit: unlimited ? -1 : totalUnits / UNIT_SCALE,
        },
      },
      transactions,
    };
  }

  /**
   * @description 读取租户额度总览与全部成员额度，超管还能看到每个成员的个人额度。
   * @keyword-cn 成员额度总览, 待分配额度
   * @keyword-en member-credit-overview, pool-credit
   */
  async getOverview(
    user: AdminUserEntity,
    requestedTenantId?: string,
  ): Promise<{ tenant: TenantCreditSummaryView; members: MemberCreditView[] }> {
    const tenantId = this.resolveTenantId(user, requestedTenantId);
    const tenant = await this.requireTenant(tenantId);
    const members = await this.users
      .find({ tenantId, deletedAt: { $exists: false } })
      .sort({ createdAt: 1 })
      .toArray();
    const accountIds = members
      .map((member) => member.accountId?.trim() || '')
      .filter(Boolean);
    const accountRows = accountIds.length
      ? await this.accounts
          .find({
            _id: {
              $in: accountIds
                .filter((id) => ObjectId.isValid(id))
                .map((id) => new ObjectId(id)),
            },
          })
          .toArray()
      : [];
    const accountMap = new Map(
      accountRows.map((row) => [row._id.toHexString(), row]),
    );
    const memberUnits = await this.wallet.getWalletUnitsMap(
      'member',
      members.map((member) => member._id.toHexString()),
    );
    const superAdmin = this.isSuperAdmin(user);
    const personalUnits = superAdmin
      ? await this.wallet.getWalletUnitsMap('account', accountIds)
      : new Map<string, number>();
    return {
      tenant: this.toSummary(tenant),
      members: members.map((member) => {
        const memberId = member._id.toHexString();
        const accountId = member.accountId?.trim() || null;
        const account = accountId ? accountMap.get(accountId) : undefined;
        return {
          memberId,
          accountId,
          displayName:
            account?.displayName || member.displayName || member.username,
          phone: account?.phone || member.phone || null,
          role: member.role,
          enabled: member.enabled,
          tenantCredit: (memberUnits.get(memberId) ?? 0) / UNIT_SCALE,
          personalCredit: superAdmin
            ? (accountId ? (personalUnits.get(accountId) ?? 0) : 0) / UNIT_SCALE
            : null,
        };
      }),
    };
  }

  /**
   * @description 正数从待分配额度划给成员，负数从成员收回到待分配额度；只允许分配模式、有限额度的租户。
   * @keyword-cn 分配成员额度, 回收成员额度
   * @keyword-en allocate-member-credit, reclaim-member-credit
   */
  async allocate(
    user: AdminUserEntity,
    tenantId: string,
    memberId: string,
    input: { amount: number; reason: string },
  ): Promise<{ tenantCredit: number; poolCredit: number }> {
    const scopedTenantId = this.resolveTenantId(user, tenantId);
    const tenant = await this.requireTenant(scopedTenantId);
    this.assertAllocatable(tenant);
    const member = await this.requireMember(scopedTenantId, memberId);
    const units = Math.round(input.amount * UNIT_SCALE);
    if (!Number.isSafeInteger(units) || units === 0) {
      throw new BadRequestException('CREDIT_AMOUNT_INVALID');
    }
    const pool = {
      kind: 'tenant' as const,
      ownerId: scopedTenantId,
      tenantId: scopedTenantId,
    };
    const target = {
      kind: 'member' as const,
      ownerId: member._id.toHexString(),
      tenantId: scopedTenantId,
      memberId: member._id.toHexString(),
      accountId: member.accountId?.trim() || undefined,
    };
    const meta: AiCreditLedgerMeta = {
      type: 'allocation',
      reason: input.reason.trim(),
      operatorType: 'admin',
      ...this.operatorOf(user),
    };
    const result = await this.runWallet(() =>
      units > 0
        ? this.wallet.transfer({
            from: pool,
            to: target,
            units,
            meta,
            insufficientCode: 'CREDIT_POOL_INSUFFICIENT',
          })
        : this.wallet.transfer({
            from: target,
            to: pool,
            units: -units,
            meta,
            insufficientCode: 'MEMBER_CREDIT_INSUFFICIENT',
          }),
    );
    return units > 0
      ? {
          poolCredit: result.fromAfter / UNIT_SCALE,
          tenantCredit: result.toAfter / UNIT_SCALE,
        }
      : {
          tenantCredit: result.fromAfter / UNIT_SCALE,
          poolCredit: result.toAfter / UNIT_SCALE,
        };
  }

  /**
   * @description 设置新成员加入时从待分配额度赠送的 Credit。
   * @keyword-cn 新成员赠送设置, 注册发放额度
   * @keyword-en update-new-member-grant, registration-grant-setting
   */
  async updateSettings(
    user: AdminUserEntity,
    tenantId: string,
    input: { memberCreditGrant: number },
  ): Promise<TenantCreditSummaryView> {
    const scopedTenantId = this.resolveTenantId(user, tenantId);
    const grant =
      Math.round(Math.max(0, input.memberCreditGrant) * UNIT_SCALE) /
      UNIT_SCALE;
    const updated = await this.tenants.findOneAndUpdate(
      { _id: new ObjectId(scopedTenantId) },
      { $set: { memberCreditGrant: grant, updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!updated.value) throw new NotFoundException('TENANT_NOT_FOUND');
    return this.toSummary(updated.value);
  }

  /**
   * @description 超管把旧共用租户切到分配模式：migrate 时原余额给每个启用成员各一份全额并清零租户余额，否则原余额留作待分配额度。
   * @keyword-cn 切换分配模式, 旧余额迁移
   * @keyword-en switch-credit-mode, legacy-credit-migration
   */
  async switchMode(
    user: AdminUserEntity,
    tenantId: string,
    input: { migrate: boolean },
  ): Promise<{
    tenant: TenantCreditSummaryView;
    migration: { amount: number; credited: number; failed: string[] } | null;
  }> {
    this.assertSuperAdmin(user);
    const tenant = await this.requireTenant(tenantId);
    if (this.wallet.isUnlimited(tenant)) {
      throw new BadRequestException('UNLIMITED_CREDIT_CANNOT_ALLOCATE');
    }
    let migration: {
      amount: number;
      credited: number;
      failed: string[];
    } | null = null;
    if (input.migrate) {
      const members = await this.users
        .find({ tenantId, enabled: true, deletedAt: { $exists: false } })
        .toArray();
      const result = await this.runWallet(() =>
        this.wallet.migrateTenantToMembers({
          tenant,
          members: members.map((member) => ({
            memberId: member._id.toHexString(),
            accountId: member.accountId?.trim() || undefined,
          })),
          operator: this.operatorOf(user),
        }),
      );
      migration = {
        amount: result.amountUnits / UNIT_SCALE,
        credited: result.credited,
        failed: result.failed,
      };
    } else {
      await this.runWallet(() => this.wallet.enableAllocation(tenant));
    }
    return {
      tenant: this.toSummary(await this.requireTenant(tenantId)),
      migration,
    };
  }

  /**
   * @description 分页读取某个成员在本租户额度钱包的流水。
   * @keyword-cn 成员额度流水, 租户边界
   * @keyword-en member-credit-ledger, tenant-boundary
   */
  async listMemberTransactions(
    user: AdminUserEntity,
    tenantId: string,
    memberId: string,
    input: { limit?: number; before?: Date },
  ): Promise<{ transactions: AiCreditTransactionEntity[] }> {
    const scopedTenantId = this.resolveTenantId(user, tenantId);
    const member = await this.requireMember(scopedTenantId, memberId);
    return {
      transactions: await this.wallet.listTransactions(
        { wallet: 'member', memberId: member._id.toHexString() },
        input,
      ),
    };
  }

  /**
   * @description 超管读取手机号账号的个人额度与流水。
   * @keyword-cn 个人额度查询, 个人流水
   * @keyword-en personal-credit-query, personal-ledger
   */
  async getPersonalAccount(
    user: AdminUserEntity,
    accountId: string,
    input: { limit?: number; before?: Date },
  ): Promise<{
    account: {
      id: string;
      displayName: string;
      phone: string | null;
      email: string | null;
    };
    credit: number;
    transactions: AiCreditTransactionEntity[];
  }> {
    this.assertSuperAdmin(user);
    const account = await this.requireAccount(accountId);
    const id = account._id.toHexString();
    return {
      account: {
        id,
        displayName: account.displayName,
        phone: account.phone ?? null,
        email: account.email ?? null,
      },
      credit: (await this.wallet.getWalletUnits('account', id)) / UNIT_SCALE,
      transactions: await this.wallet.listTransactions(
        { wallet: 'account', accountId: id },
        input,
      ),
    };
  }

  /**
   * @description 超管给个人额度充值或调账，个人额度在该账号加入的所有租户里都能用。
   * @keyword-cn 个人额度充值, 跨租户通用
   * @keyword-en change-personal-credit, cross-tenant-credit
   */
  async changePersonalCredit(
    user: AdminUserEntity,
    accountId: string,
    type: 'recharge' | 'manual_adjustment',
    input: { amount: number; reason: string; referenceId?: string },
  ): Promise<{ credit: number; transaction: AiCreditTransactionEntity }> {
    this.assertSuperAdmin(user);
    const account = await this.requireAccount(accountId);
    if (account.deletedAt) throw new BadRequestException('ACCOUNT_DELETED');
    const result = await this.runWallet(() =>
      this.wallet.changeAccountWallet({
        accountId: account._id.toHexString(),
        units: Math.round(input.amount * UNIT_SCALE),
        type,
        reason: input.reason,
        referenceId: input.referenceId,
        operator: this.operatorOf(user),
      }),
    );
    return {
      credit: result.balanceUnits / UNIT_SCALE,
      transaction: result.transaction,
    };
  }

  /**
   * @description 新成员加入租户后按租户设置赠送 Credit；任何失败只记日志，不影响注册或审批。
   * @keyword-cn 新成员赠送, 注册发放
   * @keyword-en grant-new-member, registration-grant
   */
  async grantNewMember(memberId: string): Promise<number> {
    try {
      if (!ObjectId.isValid(memberId)) return 0;
      const member = await this.users.findOne({ _id: new ObjectId(memberId) });
      if (!member?.tenantId || !ObjectId.isValid(member.tenantId)) return 0;
      const tenant = await this.tenants.findOne({
        _id: new ObjectId(member.tenantId),
      });
      if (!tenant) return 0;
      const units = await this.wallet.grantNewMember(tenant, {
        memberId,
        accountId: member.accountId?.trim() || undefined,
      });
      return units / UNIT_SCALE;
    } catch (error) {
      this.logger.warn(
        `[grantNewMember] member=${memberId} 赠送失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * @description 把租户文档转换为额度总览视图。
   * @keyword-cn 额度总览视图, 租户模式
   * @keyword-en tenant-credit-summary-view, tenant-mode
   */
  private toSummary(tenant: SassTenantEntity): TenantCreditSummaryView {
    const unlimited = this.wallet.isUnlimited(tenant);
    return {
      tenantId: tenant._id.toHexString(),
      tenantName: tenant.name,
      mode: this.wallet.creditMode(tenant),
      unlimited,
      poolCredit: unlimited ? -1 : this.tenantUnits(tenant) / UNIT_SCALE,
      memberCreditGrant: Math.max(0, Number(tenant.memberCreditGrant) || 0),
      creditMigratedAt: tenant.creditMigratedAt
        ? new Date(tenant.creditMigratedAt).toISOString()
        : null,
    };
  }

  /**
   * @description 读取租户余额单位，兼容只有 credit 没有 creditUnits 的历史文档。
   * @keyword-cn 租户余额单位, 历史兼容
   * @keyword-en tenant-balance-units, legacy-compat
   */
  private tenantUnits(tenant: SassTenantEntity): number {
    if (typeof tenant.creditUnits === 'number')
      return Math.max(0, tenant.creditUnits);
    return Math.max(0, Math.round((Number(tenant.credit) || 0) * UNIT_SCALE));
  }

  /**
   * @description 只有分配模式、有限额度的租户才能分配成员额度。
   * @keyword-cn 可分配校验, 共用模式拒绝
   * @keyword-en assert-allocatable, shared-mode-reject
   */
  private assertAllocatable(tenant: SassTenantEntity): void {
    if (this.wallet.isUnlimited(tenant)) {
      throw new BadRequestException('UNLIMITED_CREDIT_CANNOT_ALLOCATE');
    }
    if (this.wallet.creditMode(tenant) !== 'allocated') {
      throw new BadRequestException('TENANT_CREDIT_SHARED_MODE');
    }
  }

  /**
   * @description 解析可操作的租户：操作员无权，租户管理员只能是本租户，平台超管必须指定租户。
   * @keyword-cn 额度租户范围, 跨租户禁止
   * @keyword-en credit-tenant-scope, cross-tenant-forbidden
   */
  private resolveTenantId(user: AdminUserEntity, requested?: string): string {
    if (user.role === 'operator')
      throw new ForbiddenException('PERMISSION_DENIED');
    const target = requested?.trim() || '';
    if (this.isSuperAdmin(user)) {
      if (!target) throw new BadRequestException('TENANT_REQUIRED');
      if (!ObjectId.isValid(target))
        throw new BadRequestException('INVALID_TENANT_ID');
      return target;
    }
    if (!user.tenantId) throw new ForbiddenException('PERMISSION_DENIED');
    if (target && target !== user.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    return user.tenantId;
  }

  /**
   * @description 平台超管（无租户的 super_admin）判断。
   * @keyword-cn 平台超管, 角色判断
   * @keyword-en platform-super-admin, role-check
   */
  private isSuperAdmin(user: AdminUserEntity): boolean {
    return user.role === 'super_admin' && !user.tenantId;
  }

  /**
   * @description 非平台超管抛 PERMISSION_DENIED。
   * @keyword-cn 超管校验, 权限拒绝
   * @keyword-en assert-super-admin, permission-denied
   */
  private assertSuperAdmin(user: AdminUserEntity): void {
    if (!this.isSuperAdmin(user))
      throw new ForbiddenException('PERMISSION_DENIED');
  }

  /**
   * @description 按 ID 读取租户，不存在抛 TENANT_NOT_FOUND。
   * @keyword-cn 读取租户, 租户不存在
   * @keyword-en require-tenant, tenant-not-found
   */
  private async requireTenant(tenantId: string): Promise<SassTenantEntity> {
    if (!ObjectId.isValid(tenantId))
      throw new BadRequestException('INVALID_TENANT_ID');
    const tenant = await this.tenants.findOne({ _id: new ObjectId(tenantId) });
    if (!tenant) throw new NotFoundException('TENANT_NOT_FOUND');
    return tenant;
  }

  /**
   * @description 读取属于指定租户且未注销的成员，否则抛 MEMBER_NOT_FOUND。
   * @keyword-cn 读取租户成员, 成员不存在
   * @keyword-en require-tenant-member, member-not-found
   */
  private async requireMember(
    tenantId: string,
    memberId: string,
  ): Promise<AdminUserEntity> {
    if (!ObjectId.isValid(memberId))
      throw new NotFoundException('MEMBER_NOT_FOUND');
    const member = await this.users.findOne({
      _id: new ObjectId(memberId),
      tenantId,
      deletedAt: { $exists: false },
    });
    if (!member) throw new NotFoundException('MEMBER_NOT_FOUND');
    return member;
  }

  /**
   * @description 按 ID 读取手机号账号，不存在抛 ACCOUNT_NOT_FOUND。
   * @keyword-cn 读取手机号账号, 账号不存在
   * @keyword-en require-account, account-not-found
   */
  private async requireAccount(accountId: string): Promise<AdminAccountEntity> {
    if (!ObjectId.isValid(accountId))
      throw new NotFoundException('ACCOUNT_NOT_FOUND');
    const account = await this.accounts.findOne({
      _id: new ObjectId(accountId),
    });
    if (!account) throw new NotFoundException('ACCOUNT_NOT_FOUND');
    return account;
  }

  /**
   * @description 生成写进流水的操作人信息。
   * @keyword-cn 流水操作人, 后台操作
   * @keyword-en ledger-operator, admin-operation
   */
  private operatorOf(user: AdminUserEntity): {
    operatorId: string;
    operatorName: string;
  } {
    return {
      operatorId: user._id.toHexString(),
      operatorName: user.displayName || user.username,
    };
  }

  /**
   * @description 执行钱包操作，把钱包层业务错误码转成 400 响应。
   * @keyword-cn 钱包错误转换, 业务错误码
   * @keyword-en wallet-error-mapping, business-error-code
   */
  private async runWallet<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && WALLET_BUSINESS_ERRORS.has(code)) {
        throw new BadRequestException(code);
      }
      throw error;
    }
  }
}
