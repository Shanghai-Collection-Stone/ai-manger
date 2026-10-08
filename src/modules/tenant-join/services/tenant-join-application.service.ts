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
import type {
  ApplicationView,
  TenantJoinApplicationEntity,
  TenantJoinApplicationStatus,
} from '../entities/tenant-join.entity.js';
import { TenantInviteService } from './tenant-invite.service.js';
import { TenantJoinNotifyService } from './tenant-join-notify.service.js';

/**
 * @description 租户入驻申请服务，编排两种注册模式、租户范围审批与通知结果回写
 * @keyword-cn 入驻申请服务, 两种注册模式
 * @keyword-en join-application-service, registration-modes
 */
@Injectable()
export class TenantJoinApplicationService implements OnModuleInit {
  private readonly applications: Collection<TenantJoinApplicationEntity>;
  private readonly accounts: Collection<AdminAccountEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly admin: AdminService,
    private readonly invites: TenantInviteService,
    private readonly notify: TenantJoinNotifyService,
  ) {
    this.applications =
      db.collection<TenantJoinApplicationEntity>('tenant_join_applications');
    this.accounts = db.collection<AdminAccountEntity>('admin_accounts');
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
   * @description 按默认或邀请模式注册已短信验证的手机号（邮箱已由邮箱验证码校验），注册成功后发注册成功邮件
   * @keyword-cn 租户目标注册, 可信手机号
   * @keyword-en tenant-target-registration, trusted-phone
   */
  async register(input: {
    phone: string;
    password: string;
    email: string;
    displayName?: string;
    inviteCode?: string;
  }): Promise<{
    registered: true;
    mode: 'invite' | 'default';
    tenantId: string;
    tenantName: string;
  }> {
    if (input.inviteCode) return this.registerByInvite(input);

    const registered = await this.admin.register({
      password: input.password,
      phone: input.phone,
      email: input.email,
      displayName: input.displayName,
    });
    return {
      registered: true,
      mode: 'default',
      tenantId: registered.tenantId,
      tenantName: registered.tenantName,
    };
  }

  /**
   * @description 新建平台账号并通过有效邀请直接加入目标租户，成功后发送带团队名的注册成功邮件
   * @keyword-cn 邀请模式注册, 失败回滚账号
   * @keyword-en invite-mode-registration, account-rollback
   */
  private async registerByInvite(input: {
    phone: string;
    password: string;
    email: string;
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
      phone: row.phone,
      email: row.email,
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
