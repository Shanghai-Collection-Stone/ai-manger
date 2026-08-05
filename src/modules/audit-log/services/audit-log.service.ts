import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  AuditLogEntity,
  AuditRecordInput,
} from '../entities/audit-log.entity.js';

/**
 * @description 审计日志查询过滤条件
 * @keyword-en audit log query filter
 * @keyword-cn 审计查询过滤
 */
export interface AuditLogQuery {
  tenantId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  actorUserId?: string;
  since?: Date;
  page?: number;
  pageSize?: number;
}

/**
 * @description 审计日志分页结果
 * @keyword-en audit log page result
 * @keyword-cn 审计分页结果
 */
export interface AuditLogPage {
  items: AuditLogEntity[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * @description 审计日志服务，提供事件写入与分页查询，供工作区/网盘等模块自动埋点
 * @keyword-en audit log service
 * @keyword-cn 审计日志服务
 */
@Injectable()
export class AuditLogService {
  private readonly logs: Collection<AuditLogEntity>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.logs = db.collection<AuditLogEntity>('audit_logs');
    void this.ensureIndexes();
  }

  /**
   * @description 初始化审计日志索引
   * @keyword-en ensure audit log indexes
   * @keyword-cn 初始化审计索引
   */
  async ensureIndexes(): Promise<void> {
    await this.logs.createIndex({ tenantId: 1, createdAt: -1 });
    await this.logs.createIndex({ action: 1 });
    await this.logs.createIndex({ targetType: 1, targetId: 1 });
    await this.logs.createIndex({ actorUserId: 1 });
  }

  /**
   * @description 写入一条审计事件(埋点入口，失败不抛出以免影响主流程)
   * @keyword-en record audit event
   * @keyword-cn 记录审计事件
   */
  async record(input: AuditRecordInput): Promise<void> {
    const doc: AuditLogEntity = {
      _id: new ObjectId(),
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorUsername: input.actorUsername,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: input.detail,
      createdAt: new Date(),
    };
    try {
      await this.logs.insertOne(doc);
    } catch (error) {
      // 审计写入失败不应阻断业务主流程，仅告警
      console.error('[AuditLog] record failed:', error);
    }
  }

  /**
   * @description 分页查询审计事件(按租户隔离，时间倒序)
   * @keyword-en list audit events
   * @keyword-cn 查询审计事件
   */
  async list(query: AuditLogQuery): Promise<AuditLogPage> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const filter: Record<string, unknown> = {};
    if (typeof query.tenantId === 'string') filter.tenantId = query.tenantId;
    if (query.action) filter.action = query.action;
    if (query.targetType) filter.targetType = query.targetType;
    if (query.targetId) filter.targetId = query.targetId;
    if (query.actorUserId) filter.actorUserId = query.actorUserId;
    if (query.since) filter.createdAt = { $gte: query.since };

    const total = await this.logs.countDocuments(filter);
    const items = await this.logs
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();
    return { items, page, pageSize, total };
  }
}
