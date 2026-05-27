import { Injectable, Inject } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import type { Filter } from 'mongodb';
import { Db } from 'mongodb';
import { DashboardConfigService } from '../../../dashboard-config/services/dashboard-config.service.js';
import type {
  MongoWhereCondition,
  MongoWhereGroup,
  MongoWhereNode,
} from '../../../mongo-query/types/mongo-query.types.js';

/**
 * @description 看板数据工具服务，为 AI 指挥官提供租户隔离的表结构查询、数据查询、看板配置读写能力
 * @keyword-en dashboard tools service, tenant-isolated, ai tool
 */
@Injectable()
export class DashboardToolsService {
  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly dashboardConfig: DashboardConfigService,
  ) {}

  /**
   * @description 构建租户集合前缀（与 sass.service 逻辑保持一致）
   * @param {string} tenantId - 租户ID（MongoDB ObjectId hex字符串）
   * @returns {string} 四位前缀，如 "69a9"
   * @keyword-en build tenant prefix
   */
  private buildTenantPrefix(tenantId: string): string {
    const raw = String(tenantId)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    const safe = raw.length > 0 ? raw : 'tn';
    return (safe + '0000').slice(0, 4);
  }

  /**
   * @description 规范化看板 code（AI 工具侧容错：非法值回退默认看板）
   * @keyword-en normalize dashboard code for ai tool
   */
  private normalizeDashboardCodeForTool(value?: string): string | undefined {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return undefined;
    return /^[a-zA-Z0-9_-]+$/.test(raw) ? raw : undefined;
  }

  /**
   * @description 判断值是否为对象记录
   * @keyword-en check object record
   */
  private isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  /**
   * @description 校验集合名
   * @keyword-en assert collection name
   */
  private assertCollectionName(name: string): string {
    const value = String(name ?? '').trim();
    if (!value) throw new Error('COLLECTION_REQUIRED');
    if (!/^[a-zA-Z0-9_]+$/.test(value))
      throw new Error('INVALID_COLLECTION_NAME');
    if (value.startsWith('system_') || value.startsWith('system.')) {
      throw new Error('INVALID_COLLECTION_NAME');
    }
    return value;
  }

  /**
   * @description 校验字段路径
   * @keyword-en assert field path
   */
  private assertFieldPath(path: string, errorCode: string): string {
    const value = String(path ?? '').trim();
    if (!value) throw new Error(errorCode);
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.]*$/.test(value)) throw new Error(errorCode);
    if (value.includes('..') || value.includes('$')) throw new Error(errorCode);
    return value;
  }

  /**
   * @description 规范化 limit
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
   * @description 规范化 skip
   * @keyword-en normalize skip
   */
  private normalizeSkip(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    const safe = Math.floor(n);
    return safe > 0 ? safe : 0;
  }

  /**
   * @description 规范化 sort
   * @keyword-en normalize sort
   */
  private normalizeSort(value: unknown): Record<string, 1 | -1> | undefined {
    if (!this.isObjectRecord(value)) return undefined;
    const sort: Record<string, 1 | -1> = {};
    for (const [k, v] of Object.entries(value)) {
      const field = this.assertFieldPath(k, 'INVALID_SORT_FIELD');
      sort[field] = v === -1 ? -1 : 1;
    }
    return Object.keys(sort).length > 0 ? sort : undefined;
  }

  /**
   * @description 规范化 projection
   * @keyword-en normalize projection
   */
  private normalizeProjection(
    value: unknown,
  ): Record<string, 0 | 1> | undefined {
    if (!this.isObjectRecord(value)) return undefined;
    const projection: Record<string, 0 | 1> = {};
    for (const [k, v] of Object.entries(value)) {
      const field = this.assertFieldPath(k, 'INVALID_PROJECTION_FIELD');
      projection[field] = v === 0 ? 0 : 1;
    }
    return Object.keys(projection).length > 0 ? projection : undefined;
  }

  /**
   * @description 检查对象中是否存在 Mongo 操作符键
   * @keyword-en detect mongo operator
   */
  private containsMongoOperator(value: unknown): boolean {
    if (!this.isObjectRecord(value)) return false;
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$')) return true;
      if (this.containsMongoOperator(v)) return true;
    }
    return false;
  }

  /**
   * @description 过滤简单 filter（禁止 $ 操作符注入）
   * @keyword-en sanitize simple filter
   */
  private sanitizeSimpleFilter(
    value?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (
      !value ||
      !this.isObjectRecord(value) ||
      Object.keys(value).length === 0
    )
      return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const field = this.assertFieldPath(k, 'INVALID_FILTER_FIELD');
      if (this.containsMongoOperator(v))
        throw new Error('FILTER_OPERATOR_FORBIDDEN');
      out[field] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /**
   * @description 值透传（where DSL 统一语义）
   * @keyword-en coerce where value
   */
  private coerceValue(value: unknown): unknown {
    return value;
  }

  /**
   * @description 解析 where DSL 为 Mongo filter
   * @keyword-en parse where dsl
   */
  private parseWhereNode(
    node: MongoWhereNode,
  ): Filter<Record<string, unknown>> {
    const asCondition = node as MongoWhereCondition;
    if (typeof asCondition.field === 'string') {
      const field = this.assertFieldPath(
        asCondition.field,
        'INVALID_FILTER_FIELD',
      );
      const op = asCondition.op ?? 'eq';
      const value = this.coerceValue(asCondition.value);
      if (op === 'eq') return { [field]: value };
      if (op === 'ne') return { [field]: { $ne: value } };
      if (op === 'gt') return { [field]: { $gt: value } };
      if (op === 'gte') return { [field]: { $gte: value } };
      if (op === 'lt') return { [field]: { $lt: value } };
      if (op === 'lte') return { [field]: { $lte: value } };
      if (op === 'in') {
        const values = Array.isArray(asCondition.values)
          ? asCondition.values.map((item) => this.coerceValue(item))
          : [];
        return { [field]: { $in: values } };
      }
      if (op === 'nin') {
        const values = Array.isArray(asCondition.values)
          ? asCondition.values.map((item) => this.coerceValue(item))
          : [];
        return { [field]: { $nin: values } };
      }
      if (op === 'between') {
        return {
          [field]: {
            $gte: this.coerceValue(asCondition.min),
            $lte: this.coerceValue(asCondition.max),
          },
        };
      }
      if (op === 'exists') {
        return { [field]: { $exists: Boolean(asCondition.value) } };
      }
      if (op === 'regex') {
        if (typeof asCondition.value !== 'string')
          throw new Error('INVALID_REGEX_VALUE');
        return {
          [field]: {
            $regex: asCondition.value,
            $options:
              typeof asCondition.options === 'string'
                ? asCondition.options
                : 'i',
          },
        };
      }
      if (op === 'contains') {
        if (typeof asCondition.value !== 'string')
          throw new Error('INVALID_CONTAINS_VALUE');
        return { [field]: { $regex: asCondition.value, $options: 'i' } };
      }
      if (op === 'starts_with') {
        if (typeof asCondition.value !== 'string')
          throw new Error('INVALID_STARTS_WITH_VALUE');
        return { [field]: { $regex: `^${asCondition.value}`, $options: 'i' } };
      }
      if (op === 'ends_with') {
        if (typeof asCondition.value !== 'string')
          throw new Error('INVALID_ENDS_WITH_VALUE');
        return { [field]: { $regex: `${asCondition.value}$`, $options: 'i' } };
      }
      throw new Error('INVALID_FILTER_OPERATOR');
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
    throw new Error('INVALID_FILTER_GROUP');
  }

  /**
   * @description 合并 filter / where
   * @keyword-en build final filter
   */
  private buildFinalFilter(
    filter?: Record<string, unknown>,
    where?: MongoWhereNode,
  ): Filter<Record<string, unknown>> {
    const list: Filter<Record<string, unknown>>[] = [];
    if (filter && Object.keys(filter).length > 0) list.push(filter);
    if (where) list.push(this.parseWhereNode(where));
    if (list.length === 0) return {};
    if (list.length === 1) return list[0];
    return { $and: list };
  }

  /**
   * @description 将 Python 风格字面量转换为 JSON 字面量（仅字符串外部）
   * @keyword-en normalize python literals to json literals
   */
  private normalizePythonLiterals(raw: string): string {
    const isWord = (ch: string | undefined): boolean =>
      !!ch && /[A-Za-z0-9_]/.test(ch);
    const tokenMap: Array<[string, string]> = [
      ['None', 'null'],
      ['True', 'true'],
      ['False', 'false'],
    ];
    let out = '';
    let i = 0;
    let inString = false;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    while (i < raw.length) {
      const ch = raw[i];
      if (inString) {
        out += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (quote && ch === quote) {
          inString = false;
          quote = null;
        }
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        out += ch;
        i += 1;
        continue;
      }
      let replaced = false;
      for (const [token, value] of tokenMap) {
        if (!raw.startsWith(token, i)) continue;
        const prev = i > 0 ? raw[i - 1] : undefined;
        const next =
          i + token.length < raw.length ? raw[i + token.length] : undefined;
        if (isWord(prev) || isWord(next)) continue;
        out += value;
        i += token.length;
        replaced = true;
        break;
      }
      if (replaced) continue;
      out += ch;
      i += 1;
    }
    return out;
  }

  /**
   * @description 规范化 patch 输入（支持对象/JSON 字符串；自动兼容 Python 字面量）
   * @keyword-en normalize dashboard patch input
   */
  private normalizePatchInput(value: unknown): Record<string, unknown> {
    const unwrapPatchObject = (
      obj: Record<string, unknown>,
    ): Record<string, unknown> => {
      const configVal = obj['config'];
      if (
        Object.keys(obj).length === 1 &&
        this.isObjectRecord(configVal) &&
        !Array.isArray(configVal)
      ) {
        return configVal;
      }
      return obj;
    };

    if (this.isObjectRecord(value) && !Array.isArray(value)) {
      return unwrapPatchObject(value);
    }
    if (typeof value !== 'string') {
      throw new Error('PATCH_REQUIRED_OBJECT_OR_JSON_STRING');
    }
    const raw = value.trim();
    if (!raw) {
      throw new Error('PATCH_REQUIRED_OBJECT_OR_JSON_STRING');
    }
    const parseObject = (text: string): Record<string, unknown> => {
      const parsed: unknown = JSON.parse(text);
      if (!this.isObjectRecord(parsed) || Array.isArray(parsed)) {
        throw new Error('PATCH_MUST_BE_OBJECT');
      }
      return parsed;
    };
    try {
      return unwrapPatchObject(parseObject(raw));
    } catch {
      const normalized = this.normalizePythonLiterals(raw);
      return unwrapPatchObject(parseObject(normalized));
    }
  }

  /**
   * @description 规范化聚合管道输入（支持 JSON 字符串）
   * @keyword-en normalize aggregate pipeline input
   */
  private normalizePipelineInput(value: unknown): Record<string, unknown>[] {
    const toStages = (input: unknown): Record<string, unknown>[] => {
      if (!Array.isArray(input)) throw new Error('PIPELINE_REQUIRED');
      const stages: Record<string, unknown>[] = [];
      for (const stage of input) {
        if (!this.isObjectRecord(stage) || Array.isArray(stage)) {
          throw new Error('INVALID_PIPELINE_STAGE');
        }
        stages.push(stage);
      }
      if (stages.length === 0) throw new Error('PIPELINE_REQUIRED');
      return stages;
    };

    if (Array.isArray(value)) return toStages(value);
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw) throw new Error('PIPELINE_REQUIRED');
      try {
        const parsed: unknown = JSON.parse(raw);
        return toStages(parsed);
      } catch {
        throw new Error('INVALID_PIPELINE_JSON');
      }
    }
    throw new Error('PIPELINE_REQUIRED');
  }

  /**
   * @description 返回看板 AI 工具句柄，所有工具在 scope 的 tenantId 下运行，天然租户隔离
   * @param {{ tenantId?: string }} [scope] - 当前会话 scope，含租户ID
   * @returns {CreateAgentParams['tools']} 工具集合
   * @keyword-en dashboard tools handle tenant scope
   */
  getHandle(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    const tenantId = scope?.tenantId;

    /**
     * 工具1: 列出当前租户所有数据表结构
     * keyword: tenant_tables
     */
    const tenantTables = tool(
      async () => {
        // 母平台返回空，让 AI 自己判断
        if (!tenantId) {
          return JSON.stringify([]);
        }
        const schemas = await this.db
          .collection('sass_schema')
          .find({})
          .project({ _id: 0, table: 1, tableDesc: 1, tableField: 1 })
          .toArray();
        return JSON.stringify(
          schemas.map((s) => ({
            table: s.table,
            desc: s.tableDesc,
            fields: s.tableField,
          })),
        );
      },
      {
        name: 'tenant_tables',
        description:
          '列出当前租户专属的 sass_schema 表数据（租户自己创建的表）。',
        schema: z.object({}),
      },
    );

    /**
     * 工具2: 查询租户物理表数据（自动按 tenantId 前缀路由）
     * keyword: tenant_query
     */
    const tenantQuery = tool(
      async ({ table, mode, where, limit, sort, pipeline }) => {
        // 母平台返回空，让 AI 自己判断
        if (!tenantId) {
          return JSON.stringify({ rows: [], count: 0 });
        }
        const prefix = this.buildTenantPrefix(tenantId);
        const collection = `${prefix}_${table}`;
        const filter: Record<string, unknown> =
          where && typeof where === 'object' ? where : {};
        const col = this.db.collection(collection);
        if (mode === 'count') {
          const count = await col.countDocuments(filter);
          return JSON.stringify({ count });
        }
        if (mode === 'aggregate') {
          // pipeline 优先；未提供时自动构建简单 match+count pipeline
          const agg = Array.isArray(pipeline)
            ? pipeline
            : ([{ $match: filter }, { $count: 'total' }] as Record<
                string,
                unknown
              >[]);
          const rows = await col.aggregate(agg).toArray();
          return JSON.stringify({ rows });
        }
        const safeLimit = Math.min(limit ?? 50, 100);
        const rows = await col
          .find(filter)
          .sort((sort as Record<string, 1 | -1>) ?? { _id: -1 })
          .limit(safeLimit)
          .toArray();
        return JSON.stringify({ rows });
      },
      {
        name: 'tenant_query',
        description: '查询租户专属表数据（sass_schema 中的表，自动加前缀）。',
        schema: z.object({
          table: z
            .string()
            .describe(
              'Logical table name, e.g. "orders", "order_usages" (no prefix)',
            ),
          mode: z
            .enum(['count', 'list', 'aggregate'])
            .default('count')
            .describe(
              'count=total docs; list=fetch rows; aggregate=run aggregation pipeline',
            ),
          where: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              'MongoDB filter for count/list mode, e.g. {"channelName": "抖音"}',
            ),
          pipeline: z
            .array(z.record(z.string(), z.unknown()))
            .optional()
            .describe(
              'Aggregation pipeline stages for aggregate mode, e.g. [{"$match": {...}}, {"$group": {...}}]',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Max rows to return (list mode only, max 100)'),
          sort: z
            .record(z.string(), z.union([z.literal(1), z.literal(-1)]))
            .optional()
            .describe('Sort spec, e.g. {"orderTime": -1}'),
        }),
      },
    );

    /**
     * 工具3: 万用 Mongo 搜索（与 /mongo/query 对齐），用于定义看板 queries 结构
     * keyword: dashboard_mongo_search
     */
    const dashboardMongoSearch = tool(
      async ({
        collection,
        mode,
        filter,
        where,
        projection,
        sort,
        limit,
        skip,
        pipeline,
      }) => {
        try {
          const prefix = tenantId ? this.buildTenantPrefix(tenantId) : null;
          const rawCollection = this.assertCollectionName(collection);
          const physicalCollection =
            prefix && !rawCollection.toLowerCase().startsWith(`${prefix}_`)
              ? `${prefix}_${rawCollection}`
              : rawCollection;
          const safeLimit = this.normalizeLimit(limit, 200);
          const safeSkip = this.normalizeSkip(skip);
          const safeSort = this.normalizeSort(sort);
          const safeProjection = this.normalizeProjection(projection);
          const safeFilter = this.sanitizeSimpleFilter(
            filter && typeof filter === 'object' ? filter : undefined,
          );
          const finalFilter = this.buildFinalFilter(
            safeFilter,
            where && typeof where === 'object'
              ? (where as MongoWhereNode)
              : undefined,
          );
          const col =
            this.db.collection<Record<string, unknown>>(physicalCollection);
          if (mode === 'count') {
            const count = await col.countDocuments(finalFilter);
            return JSON.stringify({
              collection: rawCollection,
              physicalCollection,
              mode,
              count,
            });
          }
          if (mode === 'aggregate') {
            const normalizedPipeline = this.normalizePipelineInput(pipeline);
            const aggregatePipeline: Record<string, unknown>[] = [];
            if (Object.keys(finalFilter).length > 0) {
              aggregatePipeline.push({
                $match: finalFilter as Record<string, unknown>,
              });
            }
            aggregatePipeline.push(...normalizedPipeline);
            if (safeSkip > 0) aggregatePipeline.push({ $skip: safeSkip });
            aggregatePipeline.push({ $limit: safeLimit });
            const rows = await col.aggregate(aggregatePipeline).toArray();
            return JSON.stringify({
              collection: rawCollection,
              physicalCollection,
              mode,
              rows,
            });
          }
          const rows = await col
            .find(
              finalFilter,
              safeProjection ? { projection: safeProjection } : undefined,
            )
            .sort(safeSort ?? { _id: -1 })
            .skip(safeSkip)
            .limit(safeLimit)
            .toArray();
          return JSON.stringify({
            collection: rawCollection,
            physicalCollection,
            mode,
            rows,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return JSON.stringify({
            error: 'DASHBOARD_MONGO_SEARCH_INVALID_INPUT',
            message,
            hint: 'mode 支持 list/count/aggregate；aggregate 模式需传 pipeline（数组或 JSON 字符串）。',
          });
        }
      },
      {
        name: 'dashboard_mongo_search',
        description:
          'Universal Mongo search for dashboard data design (compatible with /mongo/query, and supports aggregate pipeline). ' +
          'Use this to validate new fields and build config.queries before dashboard_config_patch. ' +
          'Input collection uses logical table name; when tenant scope exists, prefix is auto-added.',
        schema: z.object({
          collection: z
            .string()
            .describe(
              'Logical collection name, e.g. "todo_items" (no tenant prefix).',
            ),
          mode: z.enum(['list', 'count', 'aggregate']).default('list'),
          filter: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Simple equality filter (no $ operators).'),
          where: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              'Where DSL (and/or/not + eq/ne/gt/gte/lt/lte/in/nin/between/exists/regex/contains/starts_with/ends_with).',
            ),
          projection: z
            .record(z.string(), z.union([z.literal(0), z.literal(1)]))
            .optional(),
          sort: z
            .record(z.string(), z.union([z.literal(1), z.literal(-1)]))
            .optional(),
          pipeline: z
            .union([z.array(z.record(z.string(), z.unknown())), z.string()])
            .optional()
            .describe(
              'Aggregate pipeline (required when mode=aggregate). Can pass JSON array or JSON string.',
            ),
          limit: z.number().int().min(1).max(200).optional(),
          skip: z.number().int().min(0).max(20000).optional(),
        }),
      },
    );

    /**
     * 工具4: 查看当前看板 JSON 配置
     * keyword: dashboard_config_view
     */
    const dashboardConfigView = tool(
      async ({ dashboardCode }) => {
        const safeDashboardCode =
          this.normalizeDashboardCodeForTool(dashboardCode);
        const result = await this.dashboardConfig.getScopedConfig({
          tenantId,
          dashboardCode: safeDashboardCode,
        });
        return JSON.stringify(result.config);
      },
      {
        name: 'dashboard_config_view',
        description:
          'View the current dashboard JSON configuration (tabs, blocks, queries). Use this before patching to understand the current structure.',
        schema: z.object({
          dashboardCode: z
            .string()
            .optional()
            .describe(
              'Dashboard code. Use only letters/numbers/_/-. If omitted or invalid, fallback to default dashboard.',
            ),
        }),
      },
    );

    /**
     * 工具5: 对看板 JSON 配置执行 JSON Merge Patch（RFC 7396）
     * keyword: dashboard_config_patch
     */
    const dashboardConfigPatch = tool(
      async ({ dashboardCode, patch }) => {
        try {
          const safeDashboardCode =
            this.normalizeDashboardCodeForTool(dashboardCode);
          const safePatch = this.normalizePatchInput(patch);
          await this.dashboardConfig.patchConfig({
            tenantId,
            dashboardCode: safeDashboardCode,
            patch: safePatch,
          });
          return JSON.stringify({ ok: true });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return JSON.stringify({
            error: 'DASHBOARD_CONFIG_PATCH_INVALID_INPUT',
            message,
            hint: 'patch 需传对象或 JSON 字符串；若出现 Python 字面量 None/True/False 会自动转换。',
          });
        }
      },
      {
        name: 'dashboard_config_patch',
        description:
          'Patch the dashboard JSON configuration using an order-aware merge strategy. ' +
          'ARRAY RULES: If your patch array contains ALL existing item ids → items are reordered/inserted exactly as you specify (full-coverage mode, supports position control). ' +
          'If your patch array contains only SOME item ids → only those items are updated, others stay in place (partial mode). ' +
          'When adding/changing metrics, update config.queries at the same time and prefer query definitions verified by dashboard_mongo_search. ' +
          'config.queries also supports sourceType=feishu-bitable (tableId can be placed in collection) and transformJs for frontend data shaping. ' +
          'Always call dashboard_config_view first to get current ids. To insert a block at a specific position, include ALL block ids in the desired order. ' +
          'TO REMOVE a block/tab: add "_remove": true to that item (e.g. {"id": "refund_rate", "_remove": true}). Works in both modes. ' +
          'NEVER set an array item to null — this breaks the frontend. ' +
          'Objects are recursively merged. Setting an object field to null deletes ONLY that field (not the whole block).',
        schema: z.object({
          dashboardCode: z
            .string()
            .optional()
            .describe(
              'Dashboard code to patch. Use only letters/numbers/_/-. If omitted or invalid, fallback to default dashboard.',
            ),
          patch: z
            .union([z.record(z.string(), z.unknown()), z.string()])
            .describe(
              'JSON merge patch object or JSON string. To remove a block/tab: include it with {"id": "...", "_remove": true}. To delete an object field: set it to null. Never set an array item itself to null.',
            ),
        }),
      },
    );

    // TODO: [统一搜索] tenant_tables 和 tenant_query 已注释
    // 原因：统一使用 schema_search 工具搜索所有数据源，tenant-mongo 路由到 sass_schema
    // 如果需要恢复，取消下方注释并确保 data_source_query 支持 tenant-mongo 路由
    return [
      // tenantTables,
      // tenantQuery,
      dashboardMongoSearch,
      dashboardConfigView,
      dashboardConfigPatch,
    ];
  }
}
