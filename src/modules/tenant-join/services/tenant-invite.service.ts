import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Collection, Db, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { SassService } from '../../sass/services/sass.service.js';
import type {
  InviteView,
  TenantInviteEntity,
} from '../entities/tenant-join.entity.js';

/** 公开接受入口的尝试计数窗口，存 Mongo 让多进程共用同一份计数 */
type AttemptWindowDoc = {
  _id: string;
  count: number;
  windowStartedAt: Date;
  expireAt: Date;
};

/**
 * @description 租户邀请服务，管理邀请有效期、撤销、使用计数与公开接受入口限流
 * @keyword-cn 租户邀请服务, 公开入口限流
 * @keyword-en tenant-invite-service, public-endpoint-throttle
 */
@Injectable()
export class TenantInviteService implements OnModuleInit {
  private readonly invites: Collection<TenantInviteEntity>;
  private readonly attempts: Collection<AttemptWindowDoc>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly admin: AdminService,
    private readonly sass: SassService,
  ) {
    this.invites = db.collection<TenantInviteEntity>('tenant_invites');
    this.attempts = db.collection<AttemptWindowDoc>('tenant_invite_attempts');
  }

  /**
   * @description 模块启动时建立邀请码与租户列表索引，以及尝试计数窗口的过期索引（窗口结束后自动删除）
   * @keyword-cn 邀请索引, 邀请码唯一
   * @keyword-en invite-indexes, unique-invite-code
   */
  async onModuleInit(): Promise<void> {
    await this.invites.createIndex(
      { code: 1 },
      { unique: true, name: 'tenant_invite_code_unique' },
    );
    await this.invites.createIndex(
      { tenantId: 1, createdAt: -1 },
      { name: 'tenant_invite_tenant_created' },
    );
    await this.attempts.createIndex(
      { expireAt: 1 },
      { expireAfterSeconds: 0, name: 'tenant_invite_attempt_ttl' },
    );
  }

  /**
   * @description 预览邀请码，过期或撤销仍返回可解释的无效状态
   * @keyword-cn 邀请预览, 邀请有效性
   * @keyword-en invite-preview, invite-validity
   */
  async preview(code: string): Promise<{
    tenantId: string;
    tenantName: string;
    expiresAt: string;
    valid: boolean;
    reason?: 'INVITE_EXPIRED' | 'INVITE_REVOKED';
  }> {
    const invite = await this.invites.findOne({ code });
    if (!invite) throw new NotFoundException('INVITE_NOT_FOUND');
    const reason = invite.revokedAt
      ? ('INVITE_REVOKED' as const)
      : invite.expiresAt.getTime() <= Date.now()
        ? ('INVITE_EXPIRED' as const)
        : undefined;
    return {
      tenantId: invite.tenantId,
      tenantName: invite.tenantName,
      expiresAt: invite.expiresAt.toISOString(),
      valid: !reason,
      ...(reason ? { reason } : {}),
    };
  }

  /**
   * @description 读取有效邀请，无效时抛出契约错误码
   * @keyword-cn 校验有效邀请, 邀请错误码
   * @keyword-en assert-valid-invite, invite-error-code
   */
  async requireUsable(code: string): Promise<TenantInviteEntity> {
    const invite = await this.invites.findOne({ code });
    if (!invite) throw new NotFoundException('INVITE_NOT_FOUND');
    if (invite.revokedAt) throw new BadRequestException('INVITE_REVOKED');
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('INVITE_EXPIRED');
    }
    return invite;
  }

  /**
   * @description 原子增加邀请使用次数并记录最近使用时间
   * @keyword-cn 邀请使用计数, 原子更新
   * @keyword-en invite-use-count, atomic-update
   */
  async markUsed(inviteId: ObjectId): Promise<void> {
    await this.invites.updateOne(
      { _id: inviteId },
      { $inc: { useCount: 1 }, $set: { lastUsedAt: new Date() } },
    );
  }

  /**
   * @description 已有平台账号凭密码接受租户邀请
   * @keyword-cn 已有账号接受邀请, 邀请加入租户
   * @keyword-en existing-account-accept-invite, invite-join-tenant
   */
  async accept(input: {
    code: string;
    account: string;
    password: string;
    ip: string;
  }): Promise<{
    joined: true;
    alreadyMember: boolean;
    tenantId: string;
    tenantName: string;
  }> {
    await this.assertAttemptLimit(`ip:${input.ip || 'unknown'}`, 60_000);
    await this.assertAttemptLimit(
      `account:${input.account.trim()}`,
      10 * 60_000,
    );
    const invite = await this.requireUsable(input.code);
    const account = await this.admin.verifyAccountCredentials({
      account: input.account,
      password: input.password,
    });
    const joined = await this.admin.addAccountToTenant({
      accountId: String(account._id),
      tenantId: invite.tenantId,
      role: 'operator',
    });
    if (!joined.alreadyMember) await this.markUsed(invite._id);
    return {
      joined: true,
      alreadyMember: joined.alreadyMember,
      tenantId: joined.tenantId,
      tenantName: joined.tenantName,
    };
  }

  /**
   * @description 按当前用户租户边界列出邀请
   * @keyword-cn 邀请列表, 租户数据边界
   * @keyword-en invite-list, tenant-data-boundary
   */
  async list(
    user: AdminUserEntity,
    requestedTenantId?: string,
  ): Promise<InviteView[]> {
    const filter: Filter<TenantInviteEntity> = {};
    if (user.role === 'super_admin') {
      if (requestedTenantId) filter.tenantId = requestedTenantId;
    } else {
      if (!user.tenantId) {
        throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
      }
      if (requestedTenantId && requestedTenantId !== user.tenantId) {
        throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
      }
      filter.tenantId = user.tenantId;
    }
    const rows = await this.invites
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    return rows.map((row) => this.toView(row));
  }

  /**
   * @description 为当前租户或超管指定租户创建限时邀请
   * @keyword-cn 创建租户邀请, 邀请有效期
   * @keyword-en create-tenant-invite, invite-expiry
   */
  async create(
    user: AdminUserEntity,
    input: { tenantId?: string; expiresInDays?: number },
  ): Promise<InviteView> {
    const tenantId = this.resolveTenantScope(user, input.tenantId, true);
    const tenant = await this.sass.getTenant(tenantId);
    if (!tenant) throw new NotFoundException('TENANT_NOT_FOUND');
    const now = new Date();
    const doc: TenantInviteEntity = {
      _id: new ObjectId(),
      code: randomBytes(16).toString('base64url'),
      tenantId,
      tenantName: tenant.name,
      createdBy: String(user._id),
      createdByName: user.displayName,
      expiresAt: new Date(
        now.getTime() + (input.expiresInDays ?? 7) * 24 * 60 * 60 * 1000,
      ),
      useCount: 0,
      createdAt: now,
    };
    await this.invites.insertOne(doc);
    return this.toView(doc);
  }

  /**
   * @description 在租户数据边界内撤销邀请并令其立即失效
   * @keyword-cn 撤销租户邀请, 立即失效
   * @keyword-en revoke-tenant-invite, immediate-invalidation
   */
  async revoke(user: AdminUserEntity, id: string): Promise<void> {
    if (!ObjectId.isValid(id)) throw new NotFoundException('INVITE_NOT_FOUND');
    const invite = await this.invites.findOne({ _id: new ObjectId(id) });
    if (!invite) throw new NotFoundException('INVITE_NOT_FOUND');
    this.assertTenantAccess(user, invite.tenantId);
    await this.invites.updateOne(
      { _id: invite._id },
      { $set: { revokedAt: new Date() } },
    );
  }

  /**
   * @description 解析邀请管理的租户范围
   * @keyword-cn 租户范围解析, 超管指定租户
   * @keyword-en resolve-tenant-scope, super-admin-tenant-selection
   */
  private resolveTenantScope(
    user: AdminUserEntity,
    requestedTenantId: string | undefined,
    requireSuperAdminTenant: boolean,
  ): string {
    if (user.role === 'super_admin') {
      if (!requestedTenantId && requireSuperAdminTenant) {
        throw new BadRequestException('TENANT_REQUIRED');
      }
      return requestedTenantId ?? '';
    }
    if (!user.tenantId) throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    return user.tenantId;
  }

  /**
   * @description 校验用户是否可操作目标租户邀请
   * @keyword-cn 邀请租户鉴权, 跨租户禁止
   * @keyword-en invite-tenant-authorization, cross-tenant-forbidden
   */
  private assertTenantAccess(user: AdminUserEntity, tenantId: string): void {
    if (user.role !== 'super_admin' && user.tenantId !== tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
  }

  /**
   * @description 对同一限流键执行每窗口最多十次的限制，计数存 Mongo（`tenant_invite_attempts`），多进程共用同一份：
   *   窗口内原子加一，窗口外重开计数；窗口结束后由过期索引自动删除。
   * @keyword-cn 共享限流计数, 尝试次数限制
   * @keyword-en shared-rate-limit, attempt-limit
   * @param key 限流键（`ip:` 或 `account:` 前缀）。
   * @param windowMs 窗口长度。
   * @throws {HttpException} 窗口内超过十次时 429 `TOO_MANY_ATTEMPTS`。
   */
  private async assertAttemptLimit(
    key: string,
    windowMs: number,
  ): Promise<void> {
    const now = new Date();
    const before = await this.attempts.findOneAndUpdate(
      {
        _id: key,
        windowStartedAt: { $gt: new Date(now.getTime() - windowMs) },
      },
      { $inc: { count: 1 } },
      { returnDocument: 'before' },
    );
    if (!before) {
      await this.attempts.updateOne(
        { _id: key },
        {
          $set: {
            count: 1,
            windowStartedAt: now,
            expireAt: new Date(now.getTime() + windowMs),
          },
        },
        { upsert: true },
      );
      return;
    }
    if (before.count >= 10) {
      throw new HttpException(
        'TOO_MANY_ATTEMPTS',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * @description 将邀请文档转换成包含实时状态的接口视图
   * @keyword-cn 邀请视图转换, 实时邀请状态
   * @keyword-en invite-view-mapping, computed-invite-status
   */
  private toView(row: TenantInviteEntity): InviteView {
    const status = row.revokedAt
      ? 'revoked'
      : row.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : 'active';
    return {
      id: String(row._id),
      code: row.code,
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      useCount: row.useCount,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      status,
    };
  }
}
