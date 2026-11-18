import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { Collection, Db, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type {
  AdminAccountEntity,
  AdminUserEntity,
} from '../../admin/entities/admin.entity.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { EmailVerificationService } from '../../email-verification/services/email-verification.service.js';
import type { SassTenantEntity } from '../../sass/entities/sass-tenant.entity.js';
import { SmsVerificationService } from '../../sms-verification/services/sms-verification.service.js';
import { TenantCreditService } from '../../tenant-credit/services/tenant-credit.service.js';
import type {
  ApplicationView,
  TenantJoinApplicationEntity,
  TenantJoinApplicationStatus,
} from '../entities/tenant-join.entity.js';
import { TenantInviteService } from './tenant-invite.service.js';
import { TenantJoinNotifyService } from './tenant-join-notify.service.js';

/**
 * @description 注册时按公司名称申请加入的申请留言。
 * @keyword-cn 公司名称申请留言, 注册申请
 * @keyword-en company-application-message, registration-application
 */
const COMPANY_APPLICATION_MESSAGE = '注册时按公司名称申请加入';

/**
 * @description 注册页公司名称模糊搜索每次最多返回的候选租户数。
 * @keyword-cn 公司搜索条数上限, 防枚举
 * @keyword-en company-search-limit, anti-enumeration
 */
const COMPANY_SEARCH_LIMIT = 10;

/**
 * @description 租户入驻申请服务，编排随便逛逛 / 邀请 / 公司名称三种注册方式、租户范围审批与通知结果回写
 * @keyword-cn 入驻申请服务, 两种注册模式
 * @keyword-en join-application-service, registration-modes
 */
@Injectable()
export class TenantJoinApplicationService implements OnModuleInit {
  private readonly applications: Collection<TenantJoinApplicationEntity>;
  private readonly accounts: Collection<AdminAccountEntity>;
  private readonly tenants: Collection<SassTenantEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly admin: AdminService,
    private readonly invites: TenantInviteService,
    private readonly notify: TenantJoinNotifyService,
    private readonly credits: TenantCreditService,
    private readonly smsCodes: SmsVerificationService,
    private readonly emailCodes: EmailVerificationService,
  ) {
    this.applications = db.collection<TenantJoinApplicationEntity>(
      'tenant_join_applications',
    );
    this.accounts = db.collection<AdminAccountEntity>('admin_accounts');
    this.tenants = db.collection<SassTenantEntity>('sass_tenants');
  }

  /**
   * @description 模块启动时建立申请列表、账号与待审批唯一偏索引
   * @keyword-cn 申请索引, 待审批唯一
   * @keyword-en application-indexes, unique-pending-application
   */
  async onModuleInit(): Promise<void> {
    await this.applications.createIndex(
      { tenantId: 1, status: 1, createdAt: -1 },
      { name: 'tenant_join_tenant_status_created' },
    );
    await this.applications.createIndex(
      { accountId: 1 },
      { name: 'tenant_join_account' },
    );
    await this.applications.createIndex(
      { accountId: 1, tenantId: 1 },
      {
        unique: true,
        partialFilterExpression: { status: 'pending' },
        name: 'tenant_join_pending_account_tenant_unique',
      },
    );
  }

  /**
   * @description 按注册时选的加入方式注册已短信验证的手机号（邮箱已由邮箱验证码校验）：随便逛逛进默认租户；邀请码直接加入邀请租户；公司（模糊搜索后选中的租户 ID，或旧客户端的公司名称）先进默认租户逛，同时向该租户提交入驻申请等管理员审批。新成员按所进租户的设置领赠送 Credit，成功后发注册成功邮件
   * @keyword-cn 租户目标注册, 可信手机号, 注册加入方式
   * @keyword-en tenant-target-registration, trusted-phone, registration-join-choice
   */
  async register(input: {
    phone?: string;
    password: string;
    email?: string;
    displayName?: string;
    inviteCode?: string;
    companyName?: string;
    companyTenantId?: string;
  }): Promise<{
    registered: true;
    mode: 'invite' | 'default' | 'company';
    tenantId: string;
    tenantName: string;
    application?: { id: string; tenantName: string; status: 'pending' };
  }> {
    const companyName = this.normalizeCompanyName(input.companyName);
    const companyTenantId = String(input.companyTenantId ?? '').trim();
    if (input.inviteCode && (companyName || companyTenantId)) {
      throw new BadRequestException('JOIN_TARGET_CONFLICT');
    }
    if (input.inviteCode) return this.registerByInvite(input);
    const contact = input.phone || input.email || '';
    const companyTenant = companyTenantId
      ? await this.findCompanyTenantById(contact, companyTenantId)
      : companyName
        ? await this.findCompanyTenant(contact, companyName)
        : null;

    const registered = await this.admin.register({
      password: input.password,
      phone: input.phone,
      email: input.email,
      displayName: input.displayName,
    });
    await this.credits.grantNewMember(String(registered.user.id));
    if (!companyTenant) {
      return {
        registered: true,
        mode: 'default',
        tenantId: registered.tenantId,
        tenantName: registered.tenantName,
      };
    }
    const now = new Date();
    const application: TenantJoinApplicationEntity = {
      _id: new ObjectId(),
      accountId: registered.accountId,
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
      displayName:
        input.displayName?.trim() || input.phone || input.email || '',
      tenantId: companyTenant._id.toHexString(),
      tenantName: companyTenant.name,
      message: COMPANY_APPLICATION_MESSAGE,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await this.applications.insertOne(application);
    return {
      registered: true,
      mode: 'company',
      tenantId: registered.tenantId,
      tenantName: registered.tenantName,
      application: {
        id: application._id.toHexString(),
        tenantName: companyTenant.name,
        status: 'pending',
      },
    };
  }

  /**
   * @description 规范公司名称：去首尾空格、合并连续空白，空串视为未填写
   * @keyword-cn 公司名称规范化, 空白合并
   * @keyword-en normalize-company-name, collapse-whitespace
   */
  private normalizeCompanyName(value?: string): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * @description 注册第 1 步预检：校验所选手机号 / 邮箱的验证码（只累加尝试次数、不作废，正式注册还能用），再查是否已注册，让「已注册」「验证码错误」在选公司之前就提示；必须先证明是本人号码才查注册状态，防止枚举账号。判重规则与建账号一致：有手机号按手机号，只有邮箱时按邮箱
   * @keyword-cn 注册预检, 已注册提前提示, 防枚举
   * @keyword-en register-precheck, early-duplicate-check, anti-enumeration
   */
  async precheckRegistration(input: {
    smsPhone?: string;
    smsCode?: string;
    email?: string;
    emailCode?: string;
  }): Promise<{ ok: true }> {
    const smsCode = String(input.smsCode ?? '').trim();
    const emailCode = String(input.emailCode ?? '').trim();
    if (!smsCode && !emailCode) {
      throw new BadRequestException('VERIFICATION_CODE_REQUIRED');
    }
    let phone: string | undefined;
    let email: string | undefined;
    if (smsCode) {
      if (!input.smsPhone) throw new BadRequestException('SMS_PHONE_INVALID');
      phone = (
        await this.smsCodes.verify({
          phone: input.smsPhone,
          scene: 'register',
          code: smsCode,
        })
      ).phone;
    }
    if (emailCode) {
      if (!input.email) throw new BadRequestException('EMAIL_INVALID');
      email = (
        await this.emailCodes.verify({
          email: input.email,
          scene: 'register',
          code: emailCode,
        })
      ).email;
    }
    if (
      phone &&
      (await this.accounts.findOne({ phone }, { projection: { _id: 1 } }))
    ) {
      throw new BadRequestException('PHONE_ALREADY_REGISTERED');
    }
    if (
      !phone &&
      email &&
      (await this.accounts.findOne({ email }, { projection: { _id: 1 } }))
    ) {
      throw new BadRequestException('EMAIL_ALREADY_REGISTERED');
    }
    return { ok: true };
  }

  /**
   * @description 注册页公司名称模糊搜索：用户先输入至少 2 个字，按名称包含（忽略大小写）查租户，排除默认租户，前缀命中优先、名称短的优先，最多返回 10 条；按 IP 每分钟 30 次限流，防止遍历租户列表
   * @keyword-cn 公司名称模糊搜索, 防枚举限流
   * @keyword-en company-fuzzy-search, anti-enumeration-throttle
   */
  async searchCompanies(
    ip: string,
    keyword: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const normalized = this.normalizeCompanyName(keyword);
    if (normalized.length < 2) return [];
    await this.invites.assertAttemptLimit(
      `company-search:${ip || 'unknown'}`,
      60_000,
      30,
    );
    const selfRegisterName =
      process.env.SELF_REGISTER_TENANT_NAME?.trim() || '其他';
    const rows = await this.tenants
      .find(
        { name: { $regex: this.escapeRegExp(normalized), $options: 'i' } },
        { projection: { _id: 1, name: 1 } },
      )
      .limit(COMPANY_SEARCH_LIMIT * 3)
      .toArray();
    const lowered = normalized.toLowerCase();
    return rows
      .map((row) => ({ id: row._id.toHexString(), name: row.name.trim() }))
      .filter((row) => row.name && row.name !== selfRegisterName)
      .sort((a, b) => {
        const aPrefix = a.name.toLowerCase().startsWith(lowered) ? 0 : 1;
        const bPrefix = b.name.toLowerCase().startsWith(lowered) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        return a.name.length - b.name.length || a.name.localeCompare(b.name);
      })
      .slice(0, COMPANY_SEARCH_LIMIT);
  }

  /**
   * @description 转义正则特殊字符，让用户输入的公司名称只按字面匹配
   * @keyword-cn 正则转义, 字面匹配
   * @keyword-en escape-regexp, literal-match
   */
  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * @description 按模糊搜索后选中的租户 ID 找公司租户；默认租户等同随便逛逛返回 null，ID 不存在报 `COMPANY_NOT_FOUND` 并按注册手机号或邮箱限流
   * @keyword-cn 选中公司租户, 按编号匹配
   * @keyword-en selected-company-tenant, match-by-id
   */
  private async findCompanyTenantById(
    contact: string,
    tenantId: string,
  ): Promise<SassTenantEntity | null> {
    const selfRegisterName =
      process.env.SELF_REGISTER_TENANT_NAME?.trim() || '其他';
    const tenant = ObjectId.isValid(tenantId)
      ? await this.tenants.findOne({ _id: new ObjectId(tenantId) })
      : null;
    if (tenant) {
      return tenant.name.trim() === selfRegisterName ? null : tenant;
    }
    await this.invites.assertAttemptLimit(`company:${contact}`, 10 * 60_000);
    throw new BadRequestException('COMPANY_NOT_FOUND');
  }

  /**
   * @description 按公司名称（先精确、再忽略大小写）找唯一租户；填的是默认租户等同随便逛逛返回 null，找不到或重名报错。查找失败按注册手机号或邮箱限流，防止拿验证码反复猜租户名
   * @keyword-cn 公司名称匹配租户, 防猜测限流
   * @keyword-en match-company-tenant, guess-throttle
   */
  private async findCompanyTenant(
    contact: string,
    companyName: string,
  ): Promise<SassTenantEntity | null> {
    const selfRegisterName =
      process.env.SELF_REGISTER_TENANT_NAME?.trim() || '其他';
    if (companyName === selfRegisterName) return null;
    let matches = await this.tenants
      .find({ name: companyName })
      .limit(2)
      .toArray();
    if (!matches.length) {
      const escaped = this.escapeRegExp(companyName);
      matches = await this.tenants
        .find({ name: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } })
        .limit(2)
        .toArray();
    }
    if (matches.length === 1) {
      if (matches[0].name.trim() === selfRegisterName) return null;
      return matches[0];
    }
    await this.invites.assertAttemptLimit(`company:${contact}`, 10 * 60_000);
    throw new BadRequestException(
      matches.length ? 'COMPANY_NAME_AMBIGUOUS' : 'COMPANY_NOT_FOUND',
    );
  }

  /**
   * @description 新建平台账号并通过有效邀请直接加入目标租户，成功后发送带团队名的注册成功邮件
   * @keyword-cn 邀请模式注册, 失败回滚账号
   * @keyword-en invite-mode-registration, account-rollback
   */
  private async registerByInvite(input: {
    phone?: string;
    password: string;
    email?: string;
    displayName?: string;
    inviteCode?: string;
  }): Promise<{
    registered: true;
    mode: 'invite';
    tenantId: string;
    tenantName: string;
  }> {
    const invite = await this.invites.requireUsable(input.inviteCode ?? '');
    const account = await this.admin.createPlatformAccount({
      phone: input.phone,
      password: input.password,
      email: input.email,
      displayName: input.displayName,
    });
    let joined: Awaited<ReturnType<AdminService['addAccountToTenant']>>;
    try {
      joined = await this.admin.addAccountToTenant({
        accountId: String(account._id),
        tenantId: invite.tenantId,
        role: 'operator',
      });
    } catch (error) {
      await this.accounts.deleteOne({ _id: account._id });
      throw error;
    }
    await this.invites.markUsed(invite._id);
    await this.credits.grantNewMember(String(joined.user.id));
    this.admin.notifyRegistered(account, joined.tenantName);
    return {
      registered: true,
      mode: 'invite',
      tenantId: joined.tenantId,
      tenantName: joined.tenantName,
    };
  }

  /**
   * @description 按登录用户可见租户范围分页查询申请和待审总数
   * @keyword-cn 申请分页列表, 待审数量
   * @keyword-en paged-application-list, pending-count
   */
  async list(
    user: AdminUserEntity,
    input: {
      status: 'pending' | 'approved' | 'rejected' | 'all';
      tenantId?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    items: ApplicationView[];
    total: number;
    page: number;
    pageSize: number;
    pendingCount: number;
  }> {
    const scope = this.buildScope(user, input.tenantId);
    const filter: Filter<TenantJoinApplicationEntity> = { ...scope };
    if (input.status !== 'all') filter.status = input.status;
    const [rows, total, pendingCount] = await Promise.all([
      this.applications
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((input.page - 1) * input.pageSize)
        .limit(input.pageSize)
        .toArray(),
      this.applications.countDocuments(filter),
      this.applications.countDocuments({ ...scope, status: 'pending' }),
    ]);
    return {
      items: rows.map((row) => this.toView(row)),
      total,
      page: input.page,
      pageSize: input.pageSize,
      pendingCount,
    };
  }

  /**
   * @description 审批通过申请、加入租户并在审批落库后独立发送通知
   * @keyword-cn 通过入驻申请, 审批后通知
   * @keyword-en approve-join-application, notify-after-approval
   */
  async approve(user: AdminUserEntity, id: string): Promise<ApplicationView> {
    const application = await this.requireApplication(user, id);
    if (application.status !== 'pending') {
      throw new BadRequestException('APPLICATION_NOT_PENDING');
    }
    const member = await this.admin.addAccountToTenant({
      accountId: application.accountId,
      tenantId: application.tenantId,
      role: 'operator',
    });
    const reviewedAt = new Date();
    const approved = await this.applications.findOneAndUpdate(
      { _id: application._id, status: 'pending' },
      {
        $set: {
          status: 'approved',
          reviewerId: String(user._id),
          reviewerName: user.displayName,
          reviewedAt,
          memberUserId: String(member.user.id),
          updatedAt: reviewedAt,
        },
      },
      { returnDocument: 'after' },
    );
    if (!approved) throw new BadRequestException('APPLICATION_NOT_PENDING');
    if (!member.alreadyMember) {
      await this.credits.grantNewMember(String(member.user.id));
    }
    const notify = await this.notify.sendApproved({
      email: approved.email,
      displayName: approved.displayName,
      tenantName: approved.tenantName,
      phone: approved.phone,
    });
    return this.persistNotifyResult(approved, notify);
  }

  /**
   * @description 拒绝申请并在状态落库后独立发送通知
   * @keyword-cn 拒绝入驻申请, 拒绝后通知
   * @keyword-en reject-join-application, notify-after-rejection
   */
  async reject(
    user: AdminUserEntity,
    id: string,
    reason?: string,
  ): Promise<ApplicationView> {
    const application = await this.requireApplication(user, id);
    if (application.status !== 'pending') {
      throw new BadRequestException('APPLICATION_NOT_PENDING');
    }
    const reviewedAt = new Date();
    const rejected = await this.applications.findOneAndUpdate(
      { _id: application._id, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          reviewerId: String(user._id),
          reviewerName: user.displayName,
          reviewedAt,
          rejectReason: reason?.trim() || '',
          updatedAt: reviewedAt,
        },
      },
      { returnDocument: 'after' },
    );
    if (!rejected) throw new BadRequestException('APPLICATION_NOT_PENDING');
    const notify = await this.notify.sendRejected({
      email: rejected.email,
      displayName: rejected.displayName,
      tenantName: rejected.tenantName,
      reason: rejected.rejectReason,
    });
    return this.persistNotifyResult(rejected, notify);
  }

  /**
   * @description 回写独立邮件通知结果并返回最新申请视图
   * @keyword-cn 回写通知结果, 邮件失败不回滚
   * @keyword-en persist-notify-result, no-approval-rollback
   */
  private async persistNotifyResult(
    application: TenantJoinApplicationEntity,
    notify: { status: 'sent' | 'failed' | 'skipped'; error?: string },
  ): Promise<ApplicationView> {
    const set: Partial<TenantJoinApplicationEntity> = {
      notifyStatus: notify.status,
      updatedAt: new Date(),
    };
    if (notify.error) set.notifyError = notify.error;
    const updated = await this.applications.findOneAndUpdate(
      { _id: application._id },
      {
        $set: set,
        ...(!notify.error ? { $unset: { notifyError: '' } } : {}),
      },
      { returnDocument: 'after' },
    );
    return this.toView(updated ?? { ...application, ...set });
  }

  /**
   * @description 读取申请并校验租户数据边界
   * @keyword-cn 读取入驻申请, 跨租户禁止
   * @keyword-en require-join-application, cross-tenant-forbidden
   */
  private async requireApplication(
    user: AdminUserEntity,
    id: string,
  ): Promise<TenantJoinApplicationEntity> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('APPLICATION_NOT_FOUND');
    }
    const row = await this.applications.findOne({ _id: new ObjectId(id) });
    if (!row) throw new NotFoundException('APPLICATION_NOT_FOUND');
    if (user.role !== 'super_admin' && user.tenantId !== row.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    return row;
  }

  /**
   * @description 构建超管或租户管理员可见的申请查询范围
   * @keyword-cn 申请可见范围, 租户隔离
   * @keyword-en application-visibility-scope, tenant-isolation
   */
  private buildScope(
    user: AdminUserEntity,
    requestedTenantId?: string,
  ): Filter<TenantJoinApplicationEntity> {
    if (user.role === 'super_admin') {
      return requestedTenantId ? { tenantId: requestedTenantId } : {};
    }
    if (!user.tenantId) throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    return { tenantId: user.tenantId };
  }

  /**
   * @description 将申请文档转换为稳定的接口视图
   * @keyword-cn 申请视图转换, ISO时间
   * @keyword-en application-view-mapping, iso-timestamp
   */
  private toView(row: TenantJoinApplicationEntity): ApplicationView {
    return {
      id: String(row._id),
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      phone: row.phone ?? null,
      email: row.email ?? null,
      displayName: row.displayName,
      message: row.message ?? null,
      status: row.status as TenantJoinApplicationStatus,
      rejectReason: row.rejectReason || null,
      reviewerName: row.reviewerName ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      notifyStatus: row.notifyStatus ?? null,
      notifyError: row.notifyError ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
