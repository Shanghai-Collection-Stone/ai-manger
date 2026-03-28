import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';
import type { Db, Filter } from 'mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import { FeishuBitableSourceService } from '../../data-source/sources/feishu-bitable/feishu-bitable-source.service.js';
import type {
  MongoQueryJoin,
  MongoQueryRequest,
  MongoQueryResponse,
  MongoWhereCondition,
  MongoWhereGroup,
  MongoWhereNode,
} from '../types/mongo-query.types.js';

/**
 * @description 判断值是否为对象记录
 * @keyword-en check object record
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * @description 解析Header中的API Key（兼容 sass 的 x-request-id / x-api-key / Authorization: ApiKey）
 * @keyword-en parse api key header
 */
function parseApiKey(req: Request): string | null {
  const requestIdValue = req.header('x-request-id');
  if (typeof requestIdValue === 'string' && requestIdValue.trim()) {
    return requestIdValue.trim();
  }
  const directValue = req.header('x-api-key');
  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue.trim();
  }
  const authorization = req.header('authorization') ?? '';
  const [scheme, token] = authorization.split(' ');
  if ((scheme ?? '').toLowerCase() === 'apikey' && token) {
    return token.trim();
  }
  return null;
}

/**
 * @description 对API Key进行哈希（与 sass 一致）
 * @keyword-en hash api key
 */
function hashApiKey(value: string): string {
  const digest = createHash('sha256').update(value).digest('base64');
  return digest.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * @description Mongo 通用 JSON Filter 查询服务（租户隔离 + 关联查询）
 * @keyword-en mongo query service
 */
@Injectable()
export class MongoQueryService {
  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly adminService: AdminService,
    @Optional()
    private readonly feishuBitableService?: FeishuBitableSourceService,
  ) {}

  /**
   * @description 将 tenantId 转为集合前缀（与 sass.service 保持一致）
   * @keyword-en build tenant prefix from tenantId
   */
  private buildTenantPrefix(tenantId: string): string {
    const raw = String(tenantId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const safe = raw.length > 0 ? raw : 'tn';
    return (safe + '0000').slice(0, 4);
  }

  /**
   * @description 解析查询数据源类型（默认 mongo）
   * @keyword-en resolve query source type
   */
  private resolveSourceType(input: MongoQueryRequest): 'mongo' | 'feishu-bitable' {
    const sourceType = String(input.sourceType ?? '').trim().toLowerCase();
    if (sourceType === 'feishu-bitable') return 'feishu-bitable';
    const sourceCode = String(input.sourceCode ?? '').trim().toLowerCase();
    if (sourceCode.includes('feishu')) return 'feishu-bitable';
    return 'mongo';
  }

  /**
   * @description 规范化飞书过滤条件
   * @keyword-en normalize feishu filter
   */
  private normalizeFeishuFilter(value?: {
    conjunction?: 'and' | 'or';
    conditions?: Array<{
      field?: string;
      fieldName?: string;
      field_name?: string;
      operator: string;
      value?: string | string[];
    }>;
  }): {
    conjunction?: 'and' | 'or';
    conditions?: Array<{
      field?: string;
      fieldName?: string;
      field_name?: string;
      operator: string;
      value?: string | string[];
    }>;
  } | undefined {
    if (!value || !isObjectRecord(value)) return undefined;
    const conjunction = value.conjunction === 'or' ? 'or' : 'and';
    const conditions: Array<{
      field_name: string;
      operator: string;
      value?: string | string[];
    }> = [];
    if (Array.isArray(value.conditions) && value.conditions.length > 0) {
      for (const item of value.conditions) {
        if (!item || !isObjectRecord(item)) continue;
        const operator = String(item.operator ?? '').trim();
        const field = String(
          item.field_name ?? item.fieldName ?? item.field ?? '',
        ).trim();
        if (!operator || !field) continue;
        const rawValue = (item as { value?: string | string[] }).value;
        conditions.push({
          field_name: field,
          operator,
          value: rawValue,
        });
      }
    }
    if (conditions.length === 0) return undefined;
    return { conjunction, conditions };
  }

  /**
   * @description 将简单 filter 转换为飞书过滤（等值）
   * @keyword-en convert simple filter to feishu filter
   */
  private convertSimpleFilterToFeishuFilter(
    value?: Record<string, unknown>,
  ): {
    conjunction: 'and' | 'or';
    conditions: Array<{
      field_name: string;
      operator: string;
      value: string[];
    }>;
  } | undefined {
    if (!value || !isObjectRecord(value)) return undefined;
    const conditions: Array<{
      field_name: string;
      operator: string;
      value: string[];
    }> = [];
    for (const [fieldName, raw] of Object.entries(value)) {
      const field = String(fieldName).trim();
      if (!field) continue;
      if (Array.isArray(raw)) {
        if (raw.length === 0) continue;
        for (const item of raw) {
          conditions.push({
            field_name: field,
            operator: 'is',
            value: [String(item)],
          });
        }
      } else {
        conditions.push({
          field_name: field,
          operator: 'is',
          value: [String(raw)],
        });
      }
    }
    if (conditions.length === 0) return undefined;
    return { conjunction: 'and', conditions };
  }

  /**
   * @description 将 sort 对象转换为飞书 sort 规则
   * @keyword-en convert sort to feishu sort
   */
  private toFeishuSort(sort?: Record<string, 1 | -1>): string[] | undefined {
    if (!sort || Object.keys(sort).length === 0) return undefined;
    const out: string[] = [];
    for (const [field, dir] of Object.entries(sort)) {
      const safeField = this.assertFieldPath(field, 'INVALID_SORT_FIELD');
      out.push(`${safeField} ${dir === -1 ? 'DESC' : 'ASC'}`);
    }
    return out.length > 0 ? out : undefined;
  }

  /**
   * @description 执行飞书多维表格查询（list/count；aggregate 退化为 list）
   * @keyword-en execute feishu bitable query
   */
  private async executeFeishuQuery(
    input: MongoQueryRequest,
  ): Promise<MongoQueryResponse> {
    if (!this.feishuBitableService) {
      throw new BadRequestException('FEISHU_SOURCE_UNAVAILABLE');
    }
    const tableId = this.assertCollectionName(input.collection);
    const requestedMode = input.mode;
    const mode: 'list' | 'count' =
      requestedMode === 'count' ? 'count' : 'list';

    const limit = this.normalizeLimit(input.limit, 500);
    const skip = this.normalizeSkip(input.skip);
    const targetCount = mode === 'count' ? Number.MAX_SAFE_INTEGER : skip + limit;
    const sort = this.normalizeSort(input.sort);
    const feishuSort = Array.isArray(input.feishuSort)
      ? input.feishuSort
      : this.toFeishuSort(sort);
    const simpleFilter = this.sanitizeSimpleFilter(input.filter);
    const normalizedFeishuFilter = this.normalizeFeishuFilter(input.feishuFilter);
    const feishuFilter = normalizedFeishuFilter ?? this.convertSimpleFilterToFeishuFilter(simpleFilter);

    let hasMore = true;
    let pageToken: string | undefined;
    let totalFromServer: number | undefined;
    const rows: Record<string, unknown>[] = [];
    while (hasMore && rows.length < targetCount) {
      const pageSize =
        mode === 'count'
          ? 500
          : Math.min(500, Math.max(targetCount - rows.length, 1));
      const response = await this.feishuBitableService.listRecords(tableId, {
        pageSize,
        pageToken,
        filter: feishuFilter,
        sort: feishuSort,
      });
      if (typeof response.total === 'number') {
        totalFromServer = response.total;
      }
      rows.push(
        ...response.records.map((record) => ({
          recordId: record.recordId,
          ...record.fields,
        })),
      );
      hasMore = Boolean(response.hasMore);
      pageToken = response.pageToken;
      if (mode === 'count' && typeof totalFromServer === 'number') {
        return { count: totalFromServer };
      }
    }

    if (mode === 'count') {
      return { count: typeof totalFromServer === 'number' ? totalFromServer : rows.length };
    }
    const sliced = rows.slice(skip, skip + limit);
    return { rows: sliced };
  }

  /**
   * @description 执行查询（list / count / aggregate），并按租户注入隔离条件
   * @keyword-en execute mongo query
   */
  async execute(req: Request, input: MongoQueryRequest): Promise<MongoQueryResponse> {
    const scope = await this.requireScope(req);
    const sourceType = this.resolveSourceType(input);
    if (sourceType === 'feishu-bitable') {
      return this.executeFeishuQuery(input);
    }

    const tenantId = scope.tenantId;
    const tenantField = this.normalizeTenantField(input.tenantField);

    const rawCollection = this.assertCollectionName(input.collection);
    const tenantPrefix = tenantId ? this.buildTenantPrefix(tenantId) : null;

    // 子租户白名单校验：只允许访问 sass_schema 中注册的逻辑表
    if (tenantId && tenantPrefix) {
      const logicalName =
        rawCollection.toLowerCase().startsWith(tenantPrefix + '_')
          ? rawCollection.slice(tenantPrefix.length + 1)
          : rawCollection;
      const allowed = await this.db
        .collection<{ table: string }>('sass_schema')
        .countDocuments({ table: logicalName }, { limit: 1 });
      if (allowed === 0) {
        throw new ForbiddenException('COLLECTION_NOT_IN_TENANT_SCHEMA');
      }
    }

    // 租户用户：若集合名不含租户前缀，视为逻辑表名（如 "orders"），自动补全为物理表名（如 "69a9_orders"）
    const collection =
      tenantId && tenantPrefix && !rawCollection.toLowerCase().startsWith(tenantPrefix + '_')
        ? `${tenantPrefix}_${rawCollection}`
        : rawCollection;

    // 集合名以租户前缀开头时，集合本身已做租户隔离，无需注入字段过滤
    const isPrefixIsolated = tenantPrefix ? collection.toLowerCase().startsWith(tenantPrefix + '_') : false;
    const tenantMatch = tenantId && !isPrefixIsolated ? { [tenantField]: tenantId } : undefined;
    const joins = Array.isArray(input.joins) ? input.joins : [];

    const limit = this.normalizeLimit(input.limit, 500);
    const skip = this.normalizeSkip(input.skip);
    const sort = this.normalizeSort(input.sort);
    const projection = this.normalizeProjection(input.projection);

    const baseFilter = this.buildFinalFilter(
      this.sanitizeSimpleFilter(input.filter),
      input.where,
      tenantMatch,
    );
    const col = this.db.collection(collection);

    if (input.mode === 'aggregate') {
      const pipeline = this.buildCustomAggregatePipeline({
        baseMatch: baseFilter,
        joins,
        tenantId: isPrefixIsolated ? undefined : tenantId,
        projection,
        sort,
        skip,
        limit,
        customPipeline: input.pipeline,
      });
      const rows = await col.aggregate(pipeline).toArray();
      return { rows: rows as unknown as Record<string, unknown>[] };
    }

    if (joins.length === 0) {
      if (input.mode === 'count') {
        const count = await col.countDocuments(baseFilter);
        return { count };
      }
      const rows = await col
        .find(baseFilter, projection ? { projection } : undefined)
        .sort(sort ?? { _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      return { rows: rows as unknown as Record<string, unknown>[] };
    }

    const pipeline = this.buildAggregatePipeline({
      baseMatch: baseFilter,
      joins,
      tenantId: isPrefixIsolated ? undefined : tenantId,
      tenantField,
      projection,
      sort,
      skip,
      limit,
      mode: input.mode,
    });

    const rows = await col.aggregate(pipeline).toArray();
    if (input.mode === 'count') {
      const first = rows[0] as Record<string, unknown> | undefined;
      const count = typeof first?.count === 'number' ? first.count : 0;
      return { count };
    }
    return { rows: rows as unknown as Record<string, unknown>[] };
  }

  /**
   * @description 要求解析出可用范围（Bearer token 或 API key）
   * @keyword-en require query scope
   */
  private async requireScope(req: Request): Promise<{ tenantId?: string; userId?: string }> {
    const authScope = await this.resolveAuthScope(req);
    if (authScope.userId) return authScope;
    const keyScope = await this.resolveApiKeyScope(req);
    if (keyScope.tenantId) return keyScope;
    throw new UnauthorizedException('AUTH_REQUIRED');
  }

  /**
   * @description 解析 Bearer token 范围
   * @keyword-en resolve bearer auth scope
   */
  private async resolveAuthScope(req: Request): Promise<{ tenantId?: string; userId?: string }> {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return {};
    const token = auth.slice(7).trim();
    if (!token) return {};
    const user = await this.adminService.getUserByToken(token);
    if (!user) return {};
    return { tenantId: user.tenantId, userId: user.username };
  }

  /**
   * @description 解析 API key 范围（tenant-only）
   * @keyword-en resolve api key scope
   */
  private async resolveApiKeyScope(req: Request): Promise<{ tenantId?: string }> {
    const apiKey = parseApiKey(req);
    if (!apiKey) return {};
    const keyId = hashApiKey(apiKey);
    const doc = await this.db
      .collection<Record<string, unknown>>('sass_api_keys')
      .findOne({ keyId, revokedAt: { $exists: false } });
    if (!doc) return {};
    const expiresAt = doc['expiresAt'];
    if (expiresAt instanceof Date && expiresAt.getTime() < Date.now()) return {};
    const tenantId = doc['tenantId'];
    if (typeof tenantId !== 'string' || !tenantId.trim()) return {};
    return { tenantId: tenantId.trim() };
  }

  /**
   * @description 校验并规范化集合名
   * @keyword-en assert mongo collection name
   */
  private assertCollectionName(name: string): string {
    const value = String(name ?? '').trim();
    if (!value) throw new BadRequestException('COLLECTION_REQUIRED');
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      throw new BadRequestException('INVALID_COLLECTION_NAME');
    }
    if (value.startsWith('system_') || value.startsWith('system.')) {
      throw new BadRequestException('INVALID_COLLECTION_NAME');
    }
    return value;
  }

  /**
   * @description 校验并规范化字段路径
   * @keyword-en assert field path
   */
  private assertFieldPath(path: string, errorCode: string): string {
    const value = String(path ?? '').trim();
    if (!value) throw new BadRequestException(errorCode);
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.]*$/.test(value)) {
      throw new BadRequestException(errorCode);
    }
    if (value.includes('..') || value.includes('$')) {
      throw new BadRequestException(errorCode);
    }
    return value;
  }

  /**
   * @description 规范化租户字段
   * @keyword-en normalize tenant field
   */
  private normalizeTenantField(value?: string): string {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) return 'tenantId';
    return this.assertFieldPath(v, 'INVALID_TENANT_FIELD');
  }

  /**
   * @description 规范化limit
   * @keyword-en normalize limit
   */
  private normalizeLimit(value: unknown, max: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return Math.min(50, max);
    const safe = Math.floor(n);
    if (safe <= 0) return Math.min(50, max);
    return Math.min(safe, max);
  }

  /**
   * @description 规范化skip
   * @keyword-en normalize skip
   */
  private normalizeSkip(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    const safe = Math.floor(n);
    return safe > 0 ? safe : 0;
  }

  /**
   * @description 规范化sort
   * @keyword-en normalize sort
   */
  private normalizeSort(value: unknown): Record<string, 1 | -1> | undefined {
    if (!isObjectRecord(value)) return undefined;
    const sort: Record<string, 1 | -1> = {};
    for (const [k, v] of Object.entries(value)) {
      const field = this.assertFieldPath(k, 'INVALID_SORT_FIELD');
      sort[field] = v === -1 ? -1 : 1;
    }
    return Object.keys(sort).length > 0 ? sort : undefined;
  }

  /**
   * @description 规范化projection
   * @keyword-en normalize projection
   */
  private normalizeProjection(value: unknown): Record<string, 0 | 1> | undefined {
    if (!isObjectRecord(value)) return undefined;
    const proj: Record<string, 0 | 1> = {};
    for (const [k, v] of Object.entries(value)) {
      const field = this.assertFieldPath(k, 'INVALID_PROJECTION_FIELD');
      proj[field] = v === 0 ? 0 : 1;
    }
    return Object.keys(proj).length > 0 ? proj : undefined;
  }

  /**
   * @description 过滤并限制 filter 为“简单条件”（禁止 $ 操作符注入）
   * @keyword-en sanitize simple mongo filter
   */
  private sanitizeSimpleFilter(value?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!value || !isObjectRecord(value) || Object.keys(value).length === 0) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const field = this.assertFieldPath(k, 'INVALID_FILTER_FIELD');
      if (this.containsMongoOperator(v)) {
        throw new BadRequestException('FILTER_OPERATOR_FORBIDDEN');
      }
      out[field] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /**
   * @description 检测对象中是否包含 $ 操作符键
   * @keyword-en detect mongo operator keys
   */
  private containsMongoOperator(value: unknown): boolean {
    if (!isObjectRecord(value)) return false;
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$')) return true;
      if (this.containsMongoOperator(v)) return true;
    }
    return false;
  }

  /**
   * @description ISO日期字符串自动转Date对象，非日期字符串原样返回
   * @keyword-en auto coerce ISO date string to Date object
   */
  /**
   * @description 值类型透传（不做类型强转，ISO字符串字段用字符串比较）
   * @keyword-en coerce value passthrough for string-typed date fields
   */
  private coerceValue(val: unknown): unknown {
    return val;
  }

  /**
   * @description 构建where节点为Mongo filter
   * @keyword-en parse where node to mongo filter
   */
  private parseWhereNode(node: MongoWhereNode): Filter<Record<string, unknown>> {
    const asCondition = node as MongoWhereCondition;
    if (typeof asCondition.field === 'string') {
      const field = this.assertFieldPath(asCondition.field, 'INVALID_FILTER_FIELD');
      const op = asCondition.op ?? 'eq';
      const v = this.coerceValue(asCondition.value);
      if (op === 'eq') return { [field]: v };
      if (op === 'ne') return { [field]: { $ne: v } };
      if (op === 'gt') return { [field]: { $gt: v } };
      if (op === 'gte') return { [field]: { $gte: v } };
      if (op === 'lt') return { [field]: { $lt: v } };
      if (op === 'lte') return { [field]: { $lte: v } };
      if (op === 'in') {
        const values = Array.isArray(asCondition.values) ? asCondition.values.map((v) => this.coerceValue(v)) : [];
        return { [field]: { $in: values } };
      }
      if (op === 'nin') {
        const values = Array.isArray(asCondition.values) ? asCondition.values.map((v) => this.coerceValue(v)) : [];
        return { [field]: { $nin: values } };
      }
      if (op === 'between') {
        return { [field]: { $gte: this.coerceValue(asCondition.min), $lte: this.coerceValue(asCondition.max) } };
      }
      if (op === 'exists') {
        return { [field]: { $exists: Boolean(asCondition.value) } };
      }
      if (op === 'regex') {
        if (typeof asCondition.value !== 'string') {
          throw new BadRequestException('INVALID_REGEX_VALUE');
        }
        return {
          [field]: {
            $regex: asCondition.value,
            $options: typeof asCondition.options === 'string' ? asCondition.options : 'i',
          },
        };
      }
      if (op === 'contains') {
        if (typeof asCondition.value !== 'string') {
          throw new BadRequestException('INVALID_CONTAINS_VALUE');
        }
        return { [field]: { $regex: asCondition.value, $options: 'i' } };
      }
      if (op === 'starts_with') {
        if (typeof asCondition.value !== 'string') {
          throw new BadRequestException('INVALID_STARTS_WITH_VALUE');
        }
        return { [field]: { $regex: `^${asCondition.value}`, $options: 'i' } };
      }
      if (op === 'ends_with') {
        if (typeof asCondition.value !== 'string') {
          throw new BadRequestException('INVALID_ENDS_WITH_VALUE');
        }
        return { [field]: { $regex: `${asCondition.value}$`, $options: 'i' } };
      }
      throw new BadRequestException('INVALID_FILTER_OPERATOR');
    }
    const asGroup = node as MongoWhereGroup;
    if (Array.isArray(asGroup.and) && asGroup.and.length > 0) {
      return { $and: asGroup.and.map((item) => this.parseWhereNode(item)) };
    }
    if (Array.isArray(asGroup.or) && asGroup.or.length > 0) {
      return { $or: asGroup.or.map((item) => this.parseWhereNode(item)) };
    }
    if (asGroup.not) {
      return { $nor: [this.parseWhereNode(asGroup.not)] };
    }
    throw new BadRequestException('INVALID_FILTER_GROUP');
  }

  /**
   * @description 合并 filter / where / tenantMatch
   * @keyword-en build final filter
   */
  private buildFinalFilter(
    filter?: Record<string, unknown>,
    where?: MongoWhereNode,
    tenantMatch?: Record<string, unknown>,
  ): Filter<Record<string, unknown>> {
    const list: Filter<Record<string, unknown>>[] = [];
    if (filter && Object.keys(filter).length > 0) list.push(filter);
    if (where) list.push(this.parseWhereNode(where));
    if (tenantMatch && Object.keys(tenantMatch).length > 0) list.push(tenantMatch);
    if (list.length === 0) return {};
    if (list.length === 1) return list[0];
    return { $and: list };
  }

  /**
   * @description 规范化自定义聚合管道输入（支持数组或 JSON 字符串）
   * @keyword-en normalize custom aggregate pipeline
   */
  private normalizeCustomPipeline(
    value?: Record<string, unknown>[] | string,
  ): Record<string, unknown>[] {
    if (typeof value === 'undefined') return [];
    const parseStages = (input: unknown): Record<string, unknown>[] => {
      if (!Array.isArray(input)) throw new BadRequestException('INVALID_PIPELINE');
      const stages: Record<string, unknown>[] = [];
      const forbidden = new Set(['$out', '$merge']);
      for (const stage of input) {
        if (!isObjectRecord(stage) || Array.isArray(stage)) {
          throw new BadRequestException('INVALID_PIPELINE_STAGE');
        }
        const stageKeys = Object.keys(stage);
        if (stageKeys.length === 0) throw new BadRequestException('INVALID_PIPELINE_STAGE');
        for (const k of stageKeys) {
          if (forbidden.has(k.toLowerCase())) {
            throw new BadRequestException('FORBIDDEN_PIPELINE_STAGE');
          }
        }
        stages.push(stage);
      }
      return stages;
    };
    if (Array.isArray(value)) return parseStages(value);
    const raw = String(value).trim();
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return parseStages(parsed);
    } catch {
      throw new BadRequestException('INVALID_PIPELINE_JSON');
    }
  }

  /**
   * @description 构建自定义 aggregate 管道（支持 where/filter/joins + 用户 pipeline）
   * @keyword-en build custom aggregate pipeline
   */
  private buildCustomAggregatePipeline(input: {
    baseMatch: Filter<Record<string, unknown>>;
    joins: MongoQueryJoin[];
    tenantId?: string;
    projection?: Record<string, 0 | 1>;
    sort?: Record<string, 1 | -1>;
    skip: number;
    limit: number;
    customPipeline?: Record<string, unknown>[] | string;
  }): Record<string, unknown>[] {
    const pipeline: Record<string, unknown>[] = [];
    if (Object.keys(input.baseMatch).length > 0) {
      pipeline.push({ $match: input.baseMatch });
    }
    for (const join of input.joins) {
      pipeline.push(...this.buildLookupStages(join, input.tenantId));
    }
    const customStages = this.normalizeCustomPipeline(input.customPipeline);
    pipeline.push(...customStages);

    if (input.projection && Object.keys(input.projection).length > 0) {
      pipeline.push({ $project: input.projection });
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      pipeline.push({ $sort: input.sort });
    }
    if (input.skip > 0) pipeline.push({ $skip: input.skip });
    pipeline.push({ $limit: input.limit });
    return pipeline;
  }

  /**
   * @description 构建聚合管道（含 $lookup 关联查询）
   * @keyword-en build aggregate pipeline with lookup
   */
  private buildAggregatePipeline(input: {
    baseMatch: Filter<Record<string, unknown>>;
    joins: MongoQueryJoin[];
    tenantId?: string;
    tenantField: string;
    projection?: Record<string, 0 | 1>;
    sort?: Record<string, 1 | -1>;
    skip: number;
    limit: number;
    mode: 'list' | 'count';
  }): Record<string, unknown>[] {
    const pipeline: Record<string, unknown>[] = [];
    pipeline.push({ $match: input.baseMatch });

    for (const join of input.joins) {
      pipeline.push(...this.buildLookupStages(join, input.tenantId));
    }

    if (input.mode === 'count') {
      pipeline.push({ $count: 'count' });
      return pipeline;
    }

    if (input.projection && Object.keys(input.projection).length > 0) {
      pipeline.push({ $project: input.projection });
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      pipeline.push({ $sort: input.sort });
    } else {
      pipeline.push({ $sort: { _id: -1 } });
    }
    if (input.skip > 0) pipeline.push({ $skip: input.skip });
    pipeline.push({ $limit: input.limit });
    return pipeline;
  }

  /**
   * @description 构建 $lookup + unwind 阶段
   * @keyword-en build lookup stages
   */
  private buildLookupStages(join: MongoQueryJoin, tenantId?: string): Record<string, unknown>[] {
    const from = this.assertCollectionName(join.from);
    const as = this.assertFieldPath(join.as, 'INVALID_JOIN_AS');
    const localField = this.assertFieldPath(join.localField, 'INVALID_JOIN_LOCAL_FIELD');
    const foreignField = this.assertFieldPath(join.foreignField, 'INVALID_JOIN_FOREIGN_FIELD');
    const joinTenantField = this.normalizeTenantField(join.tenantField);

    const filter = this.sanitizeSimpleFilter(join.filter);
    const match = this.buildFinalFilter(filter, join.where, tenantId ? { [joinTenantField]: tenantId } : undefined);

    const projection = this.normalizeProjection(join.projection);
    const sort = this.normalizeSort(join.sort);
    const limit = this.normalizeLimit(join.limit, 200);

    const stages: Record<string, unknown>[] = [];
    stages.push({
      $lookup: {
        from,
        let: { __local: `$${localField}` },
        pipeline: [
          {
            $match: {
              $expr: join.localFieldIsArray
                ? { $in: [`$${foreignField}`, `$$__local`] }
                : { $eq: [`$${foreignField}`, `$$__local`] },
            },
          },
          ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
          ...(projection ? [{ $project: projection }] : []),
          ...(sort ? [{ $sort: sort }] : []),
          ...(limit ? [{ $limit: limit }] : []),
        ],
        as,
      },
    });

    if (join.unwind) {
      if (typeof join.unwind === 'boolean') {
        stages.push({ $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } });
      } else {
        stages.push({
          $unwind: {
            path: `$${as}`,
            preserveNullAndEmptyArrays: Boolean(join.unwind.preserveNullAndEmptyArrays ?? true),
          },
        });
      }
    }

    return stages;
  }
}
