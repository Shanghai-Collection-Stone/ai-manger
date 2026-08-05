import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { AuditLogService } from '../../audit-log/services/audit-log.service.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type {
  NoticeEntity,
  NoticeStatus,
} from '../entities/notice.entity.js';
import type { NoticeReadEntity } from '../entities/notice-read.entity.js';
import { NOTICE_AUDIT_ACTIONS } from '../constants/notice-audit.constants.js';

/**
 * @description 创建通知入参
 * @keyword-en create notice input
 * @keyword-cn 创建通知入参
 */
export interface CreateNoticeInput {
  title: string;
  content: string;
  type?: string;
  recipients?: string[];
}

/**
 * @description 更新通知入参
 * @keyword-en update notice input
 * @keyword-cn 更新通知入参
 */
export interface UpdateNoticeInput {
  title?: string;
  content?: string;
  type?: string;
  recipients?: string[];
}

/**
 * @description 接收人视角的通知(附带当前用户的已读状态)
 * @keyword-en notice with read state
 * @keyword-cn 带已读状态的通知
 */
export interface NoticeWithRead extends NoticeEntity {
  /** 当前用户是否已读 */
  isRead: boolean;
  /** 当前用户已读时间 */
  readAt?: Date;
}

/**
 * @description 通知服务，后台通知的增删改查与发起(发布)/撤销，接收人视角的我的通知/已读未读，管理变更自动埋点审计
 * @keyword-en notice service
 * @keyword-cn 通知服务
 */
@Injectable()
export class NoticeService {
  private readonly notices: Collection<NoticeEntity>;
  private readonly reads: Collection<NoticeReadEntity>;

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly auditLogService: AuditLogService,
  ) {
    this.notices = db.collection<NoticeEntity>('notices');
    this.reads = db.collection<NoticeReadEntity>('notice_reads');
    void this.ensureIndexes();
  }

  /**
   * @description 初始化通知与已读记录索引
   * @keyword-en ensure notice indexes
   * @keyword-cn 初始化通知索引
   */
  async ensureIndexes(): Promise<void> {
    await this.notices.createIndex({ tenantId: 1, updatedAt: -1 });
    await this.notices.createIndex({ tenantId: 1, status: 1 });
    await this.reads.createIndex({ tenantId: 1, userId: 1, readAt: -1 });
    await this.reads.createIndex(
      { noticeId: 1, userId: 1 },
      { unique: true },
    );
  }

  /**
   * @description 通知列表(租户隔离，时间倒序，支持状态过滤)
   * @keyword-en list notices
   * @keyword-cn 通知列表
   */
  async list(
    currentUser: AdminUserEntity,
    status?: string,
  ): Promise<NoticeEntity[]> {
    const filter: Record<string, unknown> = {
      tenantId: this.requireTenant(currentUser),
    };
    if (status) filter.status = status;
    return this.notices.find(filter).sort({ updatedAt: -1 }).toArray();
  }

  /**
   * @description 获取单条通知(校验租户边界)
   * @keyword-en get notice by id
   * @keyword-cn 获取通知
   */
  async get(currentUser: AdminUserEntity, id: string): Promise<NoticeEntity> {
    const tenantId = this.requireTenant(currentUser);
    const notice = await this.notices.findOne({
      _id: this.toId(id),
      tenantId,
    });
    if (!notice) throw new NotFoundException('NOTICE_NOT_FOUND');
    return notice;
  }

  /**
   * @description 创建通知(草稿)
   * @keyword-en create notice
   * @keyword-cn 创建通知
   */
  async create(
    currentUser: AdminUserEntity,
    input: CreateNoticeInput,
  ): Promise<NoticeEntity> {
    const now = new Date();
    const doc: NoticeEntity = {
      _id: new ObjectId(),
      tenantId: this.requireTenant(currentUser),
      title: input.title.trim(),
      content: input.content.trim(),
      type: input.type?.trim(),
      status: 'draft',
      recipients: (input.recipients ?? []).map((r) => r.trim()).filter(Boolean),
      createdBy: String(currentUser._id),
      createdAt: now,
      updatedAt: now,
    };
    await this.notices.insertOne(doc);
    await this.audit(currentUser, NOTICE_AUDIT_ACTIONS.create, String(doc._id), {
      title: doc.title,
      type: doc.type,
      recipientCount: doc.recipients.length,
    });
    return doc;
  }

  /**
   * @description 更新通知(仅草稿/已撤销可改；已发布须先撤销)
   * @keyword-en update notice
   * @keyword-cn 更新通知
   */
  async update(
    currentUser: AdminUserEntity,
    id: string,
    input: UpdateNoticeInput,
  ): Promise<NoticeEntity> {
    const notice = await this.get(currentUser, id);
    if (notice.status === 'published') {
      throw new BadRequestException('PUBLISHED_NOTICE_LOCKED');
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.title === 'string') updates.title = input.title.trim();
    if (typeof input.content === 'string') updates.content = input.content.trim();
    if (typeof input.type === 'string') updates.type = input.type.trim();
    if (Array.isArray(input.recipients)) {
      updates.recipients = input.recipients
        .map((r) => r.trim())
        .filter(Boolean);
    }
    const res = await this.notices.findOneAndUpdate(
      { _id: notice._id },
      { $set: updates },
      { returnDocument: 'after' },
    );
    await this.audit(currentUser, NOTICE_AUDIT_ACTIONS.update, id, updates);
    return res ?? notice;
  }

  /**
   * @description 删除通知(任意状态可删)
   * @keyword-en delete notice
   * @keyword-cn 删除通知
   */
  async remove(currentUser: AdminUserEntity, id: string): Promise<boolean> {
    const notice = await this.get(currentUser, id);
    const res = await this.notices.deleteOne({ _id: notice._id });
    await this.audit(currentUser, NOTICE_AUDIT_ACTIONS.delete, id, {
      title: notice.title,
      status: notice.status,
    });
    return res.deletedCount === 1;
  }

  /**
   * @description 发起/发布通知(draft → published)
   * @keyword-en publish notice
   * @keyword-cn 发布通知
   */
  async publish(
    currentUser: AdminUserEntity,
    id: string,
  ): Promise<NoticeEntity> {
    const notice = await this.get(currentUser, id);
    if (notice.status === 'revoked') {
      throw new BadRequestException('REVOKED_NOTICE_CANNOT_PUBLISH');
    }
    const now = new Date();
    const res = await this.notices.findOneAndUpdate(
      { _id: notice._id },
      { $set: { status: 'published', publishedAt: now, updatedAt: now } },
      { returnDocument: 'after' },
    );
    await this.audit(currentUser, NOTICE_AUDIT_ACTIONS.publish, id, {
      title: notice.title,
    });
    return res ?? notice;
  }

  /**
   * @description 撤销通知(published → revoked)
   * @keyword-en revoke notice
   * @keyword-cn 撤销通知
   */
  async revoke(
    currentUser: AdminUserEntity,
    id: string,
  ): Promise<NoticeEntity> {
    const notice = await this.get(currentUser, id);
    if (notice.status !== 'published') {
      throw new BadRequestException('ONLY_PUBLISHED_CAN_REVOKE');
    }
    const now = new Date();
    const res = await this.notices.findOneAndUpdate(
      { _id: notice._id },
      { $set: { status: 'revoked', revokedAt: now, updatedAt: now } },
      { returnDocument: 'after' },
    );
    await this.audit(currentUser, NOTICE_AUDIT_ACTIONS.revoke, id, {
      title: notice.title,
    });
    return res ?? notice;
  }

  /**
   * @description 我的通知：当前用户可见的已发布通知(面向全体或定向含自己)，附带已读状态
   * @keyword-en list my notices with read state
   * @keyword-cn 我的通知
   */
  async mine(
    currentUser: AdminUserEntity,
    onlyUnread?: boolean,
  ): Promise<NoticeWithRead[]> {
    const userId = String(currentUser._id);
    const visible = await this.notices
      .find(this.visibleFilter(this.requireTenant(currentUser), userId))
      .sort({ publishedAt: -1, createdAt: -1 })
      .toArray();
    const ids = visible.map((n) => String(n._id));
    const readMap = new Map<string, Date>();
    if (ids.length > 0) {
      const reads = await this.reads
        .find({ userId, noticeId: { $in: ids } })
        .toArray();
      for (const r of reads) readMap.set(r.noticeId, r.readAt);
    }
    return visible
      .filter((n) => !onlyUnread || !readMap.has(String(n._id)))
      .map((n) => ({
        ...n,
        isRead: readMap.has(String(n._id)),
        readAt: readMap.get(String(n._id)),
      }));
  }

  /**
   * @description 当前用户未读通知数
   * @keyword-en count unread notices
   * @keyword-cn 未读通知数
   */
  async unreadCount(currentUser: AdminUserEntity): Promise<number> {
    const userId = String(currentUser._id);
    const visible = await this.notices
      .find(this.visibleFilter(this.requireTenant(currentUser), userId))
      .project({ _id: 1 })
      .toArray();
    const ids = visible.map((n) => String(n._id));
    if (ids.length === 0) return 0;
    const readCount = await this.reads.countDocuments({
      userId,
      noticeId: { $in: ids },
    });
    return ids.length - readCount;
  }

  /**
   * @description 标记某条通知已读(仅对可见的已发布通知生效，可重复标记幂等)
   * @keyword-en mark notice as read
   * @keyword-cn 标记通知已读
   */
  async markRead(
    currentUser: AdminUserEntity,
    noticeId: string,
  ): Promise<{ readAt: Date }> {
    const tenantId = this.requireTenant(currentUser);
    const userId = String(currentUser._id);
    const notice = await this.notices.findOne({
      _id: this.toId(noticeId),
      ...this.visibleFilter(tenantId, userId),
    });
    if (!notice) throw new NotFoundException('NOTICE_NOT_FOUND');
    const readAt = new Date();
    await this.reads.updateOne(
      { noticeId, userId },
      {
        $set: { tenantId, noticeId, userId, readAt },
        $setOnInsert: { _id: new ObjectId() },
      },
      { upsert: true },
    );
    return { readAt };
  }

  /**
   * @description 构建当前用户可见的已发布通知过滤条件(同租户 + 已发布 + 全体或定向含自己)
   * @keyword-en build visible published filter
   * @keyword-cn 可见通知过滤条件
   */
  private visibleFilter(
    tenantId: string,
    userId: string,
  ): Record<string, unknown> {
    return {
      tenantId,
      status: 'published',
      $or: [
        { recipients: { $exists: false } },
        { recipients: { $size: 0 } },
        { recipients: userId },
      ],
    };
  }

  /**
   * @description 要求当前用户具备租户上下文(通知为租户级资源)
   * @keyword-en require tenant context
   * @keyword-cn 要求租户上下文
   */
  private requireTenant(currentUser: AdminUserEntity): string {
    if (!currentUser.tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    return currentUser.tenantId;
  }

  /**
   * @description 转换并校验 ObjectId
   * @keyword-en to object id
   * @keyword-cn 转换对象ID
   */
  private toId(id: string, code = 'INVALID_NOTICE_ID'): ObjectId {
    if (!ObjectId.isValid(id)) throw new BadRequestException(code);
    return new ObjectId(id);
  }

  /**
   * @description 埋点写入审计事件(封装 actor/tenant 上下文)
   * @keyword-en write notice audit
   * @keyword-cn 通知审计埋点
   */
  private async audit(
    currentUser: AdminUserEntity,
    action: string,
    targetId: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogService.record({
      tenantId: currentUser.tenantId,
      actorUserId: String(currentUser._id),
      actorUsername: currentUser.username,
      action,
      targetType: 'notice',
      targetId,
      detail,
    });
  }
}

/** @keyword-en notice status type re-export */
export type { NoticeStatus };
