import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Collection, Db, Filter, ObjectId } from 'mongodb';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { SassService } from '../../sass/services/sass.service.js';
import type {
  CreateOpsReportDto,
  ListOpsReportQueryDto,
  UpdateOpsReportDto,
} from '../controller/ops-report.dto.js';
import type {
  OpsLogEntry,
  OpsReportDetail,
  OpsReportEntity,
  OpsReportSummary,
} from '../entities/ops-report.entity.js';

/**
 * @description 运维上报服务，负责写入、脱敏、频控、租户隔离与处理状态维护
 * @keyword-cn 运维上报服务
 * @keyword-en ops-report-service
 */
@Injectable()
export class OpsReportService implements OnModuleInit {
  private readonly reports: Collection<OpsReportEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly sassService: SassService,
  ) {
    this.reports = db.collection<OpsReportEntity>('ops_reports');
  }

  /**
   * @description 模块启动时建立运维上报查询索引
   * @keyword-cn 初始化上报索引
   * @keyword-en initialize-report-indexes
   */
  async onModuleInit(): Promise<void> {
    await this.reports.createIndex(
      { tenantId: 1, createdAt: -1 },
      { name: 'ops_report_tenant_created' },
    );
    await this.reports.createIndex(
      { tenantId: 1, status: 1, createdAt: -1 },
      { name: 'ops_report_tenant_status_created' },
    );
    await this.reports.createIndex(
      { status: 1, createdAt: -1 },
      { name: 'ops_report_status_created' },
    );
    await this.reports.createIndex(
      { createdAt: -1 },
      { name: 'ops_report_created' },
    );
    await this.reports.createIndex(
      { userId: 1, createdAt: -1 },
      { name: 'ops_report_user_created' },
    );
  }

  /**
   * @description 创建运维上报，从登录态补全提交人与租户并对敏感内容二次脱敏
   * @keyword-cn 创建运维上报
   * @keyword-en create-ops-report
   */
  async create(
    user: AdminUserEntity,
    input: CreateOpsReportDto,
  ): Promise<{ id: string; createdAt: Date }> {
    const userId = user._id.toHexString();
    const recentCount = await this.reports.countDocuments({
      userId,
      createdAt: { $gte: new Date(Date.now() - 60_000) },
    });
    if (recentCount >= 5) {
      throw new HttpException(
        'OPS_REPORT_TOO_FREQUENT',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const tenantId = String(user.tenantId ?? '').trim() || undefined;
    const tenant = tenantId ? await this.sassService.getTenant(tenantId) : null;
    const now = new Date();
    const doc: OpsReportEntity = {
      _id: new ObjectId(),
      tenantId,
      tenantName: tenant?.name,
      userId,
      username: user.username,
      displayName: user.displayName,
      phone: user.phone,
      description: this.redact(input.description),
      contact: input.contact,
      client: { ...input.client },
      entries: input.entries.map((entry) => this.redactEntry(entry)),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    await this.reports.insertOne(doc);
    return { id: doc._id.toHexString(), createdAt: doc.createdAt };
  }

  /**
   * @description 分页查询运维上报摘要，超管可跨租户，其他可读角色强制当前租户
   * @keyword-cn 查询上报列表
   * @keyword-en list-ops-reports
   */
  async list(
    user: AdminUserEntity,
    query: ListOpsReportQueryDto,
  ): Promise<{
    items: OpsReportSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const filter = this.buildListFilter(user, query);
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      this.reports
        .aggregate<OpsReportEntity & { entryCount: number }>([
          { $match: filter },
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: query.pageSize },
          { $set: { entryCount: { $size: '$entries' } } },
          { $unset: ['entries', 'phone', 'updatedAt', 'handledBy'] },
        ])
        .toArray(),
      this.reports.countDocuments(filter),
    ]);
    return {
      items: rows.map((row) => this.toSummary(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * @description 读取运维上报详情并校验租户访问边界
   * @keyword-cn 查询上报详情
   * @keyword-en get-ops-report-detail
   */
  async get(user: AdminUserEntity, id: string): Promise<OpsReportDetail> {
    const report = await this.findRequired(id);
    this.assertTenantAccess(user, report);
    return this.toDetail(report);
  }

  /**
   * @description 更新运维上报处理状态并记录处理人和处理时间
   * @keyword-cn 更新上报状态
   * @keyword-en update-ops-report-status
   */
  async update(
    user: AdminUserEntity,
    id: string,
    input: UpdateOpsReportDto,
  ): Promise<OpsReportDetail> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('OPS_REPORT_NOT_FOUND');
    }
    const now = new Date();
    const updates: Partial<OpsReportEntity> = {
      status: input.status,
      handledBy: user._id.toHexString(),
      handledByName: user.displayName,
      handledAt: now,
      updatedAt: now,
    };
    if (input.handlerNote !== undefined)
      updates.handlerNote = input.handlerNote;
    const result = await this.reports.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!result.value) throw new NotFoundException('OPS_REPORT_NOT_FOUND');
    return this.toDetail(result.value);
  }

  /**
   * @description 按标识读取上报，不存在或标识非法时统一返回不存在错误
   * @keyword-cn 查找上报记录
   * @keyword-en find-required-report
   */
  private async findRequired(id: string): Promise<OpsReportEntity> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('OPS_REPORT_NOT_FOUND');
    }
    const report = await this.reports.findOne({ _id: new ObjectId(id) });
    if (!report) throw new NotFoundException('OPS_REPORT_NOT_FOUND');
    return report;
  }

  /**
   * @description 校验非超管只能访问自身租户的运维上报
   * @keyword-cn 校验租户边界
   * @keyword-en assert-report-tenant
   */
  private assertTenantAccess(
    user: AdminUserEntity,
    report: OpsReportEntity,
  ): void {
    if (user.role === 'super_admin') return;
    const tenantId = String(user.tenantId ?? '').trim();
    if (!tenantId || report.tenantId !== tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
  }

  /**
   * @description 构造列表过滤条件并转义关键词正则字符
   * @keyword-cn 构造上报筛选
   * @keyword-en build-report-filter
   */
  private buildListFilter(
    user: AdminUserEntity,
    query: ListOpsReportQueryDto,
  ): Filter<OpsReportEntity> {
    const filter: Filter<OpsReportEntity> = {};
    if (query.status !== 'all') filter.status = query.status;
    if (user.role === 'super_admin') {
      const tenantId = String(query.tenantId ?? '').trim();
      if (tenantId) filter.tenantId = tenantId;
    } else {
      const tenantId = String(user.tenantId ?? '').trim();
      if (!tenantId) throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
      filter.tenantId = tenantId;
    }
    const keyword = String(query.keyword ?? '').trim();
    if (keyword) {
      const regex = new RegExp(this.escapeRegex(keyword), 'i');
      filter.$or = [
        { description: regex },
        { username: regex },
        { displayName: regex },
      ];
    }
    return filter;
  }

  /**
   * @description 转义用户关键词中的正则特殊字符
   * @keyword-cn 转义正则关键词
   * @keyword-en escape-regex-keyword
   */
  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * @description 对令牌、敏感查询参数与大陆手机号执行兜底脱敏
   * @keyword-cn 敏感信息脱敏
   * @keyword-en redact-sensitive-text
   */
  private redact(value: string): string {
    return value
      .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer ***')
      .replace(
        /([?&](?:token|access_token|password|secret)=)[^&#\s]*/gi,
        '$1***',
      )
      .replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, '$1****$2');
  }

  /**
   * @description 对日志条目的消息、堆栈与 URL 字段执行兜底脱敏
   * @keyword-cn 脱敏日志条目
   * @keyword-en redact-log-entry
   */
  private redactEntry(entry: OpsLogEntry): OpsLogEntry {
    return {
      ...entry,
      message: this.redact(entry.message),
      url: entry.url === undefined ? undefined : this.redact(entry.url),
      stack: entry.stack === undefined ? undefined : this.redact(entry.stack),
    };
  }

  /**
   * @description 将数据库文档转换为不含日志明细的列表视图
   * @keyword-cn 转换上报摘要
   * @keyword-en map-report-summary
   */
  private toSummary(
    report: OpsReportEntity & { entryCount?: number },
  ): OpsReportSummary {
    return {
      id: report._id.toHexString(),
      tenantId: report.tenantId,
      tenantName: report.tenantName,
      userId: report.userId,
      username: report.username,
      displayName: report.displayName,
      description: report.description,
      contact: report.contact,
      client: report.client,
      status: report.status,
      handlerNote: report.handlerNote,
      handledByName: report.handledByName,
      handledAt: report.handledAt,
      entryCount: report.entryCount ?? report.entries?.length ?? 0,
      createdAt: report.createdAt,
    };
  }

  /**
   * @description 将数据库文档转换为包含日志明细的详情视图
   * @keyword-cn 转换上报详情
   * @keyword-en map-report-detail
   */
  private toDetail(report: OpsReportEntity): OpsReportDetail {
    return {
      ...this.toSummary({ ...report, entryCount: report.entries.length }),
      entries: report.entries,
    };
  }
}
