import { Injectable, Inject } from '@nestjs/common';
import { Db, MongoClient, Collection } from 'mongodb';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import {
  DataSourceSchemaService,
  MAIN_DATA_SOURCE,
} from '../services/data-source-schema.service.js';
import type { FieldMeta } from '../types/data-source.types.js';
import { DataSourceService } from '../services/data-source.service.js';
import type { DataSourceEntity } from '../entities/data-source.entity.js';

/**
 * @title 数据源搜索工具 Data Source Search Tool
 * @description 提供数据源的查询工具，包括 schema 搜索和数据查询。
 * @keywords-cn 数据源搜索, 查询, MongoDB
 * @keywords-en data source search, query, MongoDB
 */
@Injectable()
export class DataSourceSearchToolsService {
  private readonly externalClientCache = new Map<string, MongoClient>();

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly schemaService: DataSourceSchemaService,
    private readonly dataSourceService: DataSourceService,
  ) {}

  /**
   * @title 获取工具句柄 Get Handle
   * @description 返回数据源搜索相关的工具列表。
   */
  /**
   * @description 截断过大的工具输出，防止超出 LLM 上下文长度限制。
   */
  private safeTruncate(json: string, maxChars = 60000): string {
    if (json.length <= maxChars) return json;
    // Try to parse and reduce array length
    try {
      const parsed: unknown = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length > 1) {
        const totalLen = json.length;
        const avgPerItem = totalLen / parsed.length;
        const keepCount = Math.max(
          1,
          Math.floor((maxChars * 0.9) / avgPerItem),
        );
        const truncated = parsed.slice(0, keepCount);
        return JSON.stringify({
          _truncated: true,
          _message: `结果过多（共 ${parsed.length} 条），仅返回前 ${keepCount} 条以避免超出上下文长度。请缩小查询范围或使用 projection 减少字段。`,
          totalCount: parsed.length,
          returnedCount: keepCount,
          data: truncated,
        });
      }
    } catch {
      /* ignore */
    }
    // Fallback: hard truncate
    return (
      json.slice(0, maxChars) +
      '\n... [OUTPUT TRUNCATED - too large for context window. Use projection or smaller limit]'
    );
  }

  /**
   * @description 执行单条数据源查询
   * @keyword-en execute single data source query
   */
  private async executeSingleQuery(params: {
    sourceCode: string;
    tenantId?: string;
    collection: string;
    filter?: Record<string, unknown>;
    projection?: Record<string, 0 | 1>;
    limit?: number;
    sort?: Record<string, 1 | -1> | string[];
    type?: string;
    pipeline?: string | Record<string, unknown>[];
    key?: string;
    scope?: { tenantId?: string; userId?: string };
  }): Promise<{ collection: string; sourceCode: string; data: unknown; error?: string }> {
    const {
      sourceCode,
      tenantId,
      collection,
      filter,
      projection,
      limit,
      sort: rawSort,
      type,
      pipeline: rawPipeline,
      key,
      scope,
    } = params;

    // 解析 sort 字符串数组为对象
    let sort: Record<string, 1 | -1> | undefined;
    if (Array.isArray(rawSort)) {
      sort = {};
      for (const item of rawSort) {
        const parts = String(item).split(/\s+/);
        if (parts.length >= 2) {
          const field = parts[0];
          const order = parts[1].toUpperCase() === 'DESC' ? -1 : 1;
          sort[field] = order;
        } else if (parts.length === 1) {
          sort[parts[0]] = 1;
        }
      }
    } else {
      sort = rawSort;
    }

    // 解析 pipeline 字符串为数组
    let pipeline: Record<string, unknown>[] | undefined;
    if (typeof rawPipeline === 'string') {
      try {
        pipeline = JSON.parse(rawPipeline);
      } catch {
        return { collection, sourceCode, data: null, error: `Invalid pipeline JSON: ${rawPipeline}` };
      }
    } else {
      pipeline = rawPipeline;
    }

    try {
      const finalTenantId = this.resolveTenantId(tenantId, scope);
      const finalSourceCode = sourceCode?.trim() || MAIN_DATA_SOURCE.code;

      const { col, logicalCollectionName } = await this.resolveTargetCollection(
        finalSourceCode,
        collection,
        finalTenantId,
      );
      const safeLimit = Math.min(
        typeof limit === 'number' && limit > 0 ? limit : 20,
        100,
      );

      // tenant-mongo: 从 sass_schema 获取字段信息用于验证
      let schemaMap: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'> | undefined;
      if (finalSourceCode === 'tenant-mongo' && finalTenantId) {
        const sassDoc = await this.db.collection('sass_schema').findOne({ table: logicalCollectionName });
        if (sassDoc && sassDoc.tableField) {
          schemaMap = {};
          for (const [name] of Object.entries(sassDoc.tableField)) {
            schemaMap[name] = 'string'; // sass_schema 中的字段都是 string 类型
          }
        }
      } else {
        // 其他数据源：从 data_source_schemas 获取 schema
        const schemaResultsByLogical = await this.schemaService.searchSchema(
          logicalCollectionName,
          sourceCode,
          1,
        );
        const schemaResults =
          schemaResultsByLogical.length > 0
            ? schemaResultsByLogical
            : await this.schemaService.searchSchema(collection, sourceCode, 1);
        schemaMap =
          schemaResults.length > 0
            ? this.buildSchemaMap(schemaResults[0].schema.fields)
            : undefined;
      }

      if (!schemaMap) {
        return {
          collection,
          sourceCode: finalSourceCode,
          data: null,
          error: 'SCHEMA_REQUIRED: No schema found. Call schema_search first.',
        };
      }

      // 验证 filter 字段
      const filterFields = this.collectFilterFields(filter);
      const schemaFields = new Set(Object.keys(schemaMap));
      const invalid: string[] = [];
      for (const f of filterFields) {
        if (!schemaFields.has(f)) invalid.push(f);
      }
      if (invalid.length > 0) {
        return {
          collection,
          sourceCode: finalSourceCode,
          data: null,
          error: `INVALID_FILTER_FIELDS: ${invalid.join(', ')}. Use schema_search to get valid fields.`,
        };
      }

      // 转换日期字段
      const baseFilter = this.isPlainObject(filter) ? filter : {};
      const finalFilter = this.transformDateStringFilter(baseFilter, schemaMap);

      let result: unknown;
      if (type === 'count') {
        const count = await col.countDocuments(finalFilter);
        result = [{ count }];
      } else if (type === 'distinct') {
        if (!key || typeof key !== 'string') {
          return {
            collection,
            sourceCode: finalSourceCode,
            data: null,
            error: 'KEY_REQUIRED: Key is required for distinct operation',
          };
        }
        const values = await col.distinct(key, finalFilter);
        result = this.safeTruncate(JSON.stringify(values));
      } else if (type === 'min' || type === 'max' || type === 'sum' || type === 'avg') {
        if (!key || typeof key !== 'string') {
          return {
            collection,
            sourceCode: finalSourceCode,
            data: null,
            error: `KEY_REQUIRED: Key is required for ${type} operation`,
          };
        }
        const opMap: Record<string, '$min' | '$max' | '$sum' | '$avg'> = {
          min: '$min',
          max: '$max',
          sum: '$sum',
          avg: '$avg',
        };
        const op = opMap[type];
        const aggPipeline = [
          { $match: finalFilter },
          { $group: { _id: null, value: { [op]: `$${key}` } } },
        ];
        const docs = await col.aggregate(aggPipeline).toArray();
        result = [{ [type]: docs.length > 0 ? (docs[0] as Record<string, unknown>).value : undefined }];
      } else if (type === 'aggregate') {
        if (!pipeline || !Array.isArray(pipeline)) {
          return {
            collection,
            sourceCode: finalSourceCode,
            data: null,
            error: 'PIPELINE_REQUIRED: Pipeline is required for aggregate operation',
          };
        }
        const normalized = this.normalizeAggregationPipeline(pipeline, schemaMap);
        const finalPipeline = [...normalized, { $limit: safeLimit }];
        const docs = await col.aggregate(finalPipeline).toArray();
        result = this.safeTruncate(JSON.stringify(docs));
      } else {
        // 默认 find 操作
        let cursor = col.find(finalFilter, { projection });
        if (typeof sort !== 'undefined') cursor = cursor.sort(sort);
        cursor = cursor.limit(safeLimit);
        const docs = await cursor.toArray();
        result = this.safeTruncate(JSON.stringify(docs));
      }

      return { collection, sourceCode: finalSourceCode, data: result };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        collection,
        sourceCode: params.sourceCode,
        data: null,
        error: `QUERY_ERROR: ${errMsg}`,
      };
    }
  }

  /**
   * @description 返回数据源查询工具集合
   * @keyword-en get data source tools handle
   */
  getHandle(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    const dataSourceQuery = tool(
      async ({
        sourceCode,
        tenantId,
        collection,
        filter,
        projection,
        limit,
        sort,
        type,
        pipeline,
        key,
      }) => {
        const finalTenantId = this.resolveTenantId(tenantId, scope);
        const finalSourceCode = sourceCode?.trim() || MAIN_DATA_SOURCE.code;
        console.log('[data_source_query]', {
          sourceCode: finalSourceCode,
          tenantId: finalTenantId,
          collection,
          filter,
          projection,
          limit,
          sort,
          type,
          pipeline,
          key,
        });

        const { source, col, logicalCollectionName } =
          await this.resolveTargetCollection(
            finalSourceCode,
            collection,
            finalTenantId,
          );
        const safeLimit = Math.min(
          typeof limit === 'number' && limit > 0 ? limit : 20,
          100,
        );

        // 获取 schema 用于字段验证
        const schemaResultsByLogical = await this.schemaService.searchSchema(
          logicalCollectionName,
          source.code,
          1,
        );
        const schemaResults =
          schemaResultsByLogical.length > 0
            ? schemaResultsByLogical
            : await this.schemaService.searchSchema(collection, source.code, 1);
        const schemaMap =
          schemaResults.length > 0
            ? this.buildSchemaMap(schemaResults[0].schema.fields)
            : undefined;

        if (!schemaMap) {
          return JSON.stringify({
            error: 'SCHEMA_REQUIRED',
            message:
              'No schema found for collection. Please call schema_search first to get valid fields.',
            collection,
            sourceCode: source.code,
            operation: type ?? 'find',
          });
        }

        // 验证 filter 字段
        const filterFields = this.collectFilterFields(filter);
        const schemaFields = new Set(Object.keys(schemaMap));
        const invalid: string[] = [];
        for (const f of filterFields) {
          if (!schemaFields.has(f)) invalid.push(f);
        }
        if (invalid.length > 0) {
          return JSON.stringify({
            error: 'INVALID_FILTER_FIELDS',
            message:
              'Filter contains fields not present in schema. Use schema_search to get valid fields.',
            collection,
            sourceCode: source.code,
            operation: type ?? 'find',
            invalid_fields: invalid,
            schema_fields: Array.from(schemaFields),
          });
        }

        // 转换日期字段
        const baseFilter = this.isPlainObject(filter) ? filter : {};
        const finalFilter = this.transformDateStringFilter(
          baseFilter,
          schemaMap,
        );

        if (type === 'count') {
          const count = await col.countDocuments(finalFilter);
          return JSON.stringify([{ count }]);
        }

        if (type === 'distinct') {
          if (!key || typeof key !== 'string') {
            throw new Error('Key is required for distinct operation');
          }
          const values = await col.distinct(key, finalFilter);
          return this.safeTruncate(JSON.stringify(values));
        }

        if (
          type === 'min' ||
          type === 'max' ||
          type === 'sum' ||
          type === 'avg'
        ) {
          if (!key || typeof key !== 'string') {
            throw new Error('Key is required for aggregation operation');
          }
          const opMap: Record<string, '$min' | '$max' | '$sum' | '$avg'> = {
            min: '$min',
            max: '$max',
            sum: '$sum',
            avg: '$avg',
          };
          const op = opMap[type];
          const aggPipeline = [
            { $match: finalFilter },
            { $group: { _id: null, value: { [op]: `$${key}` } } },
          ];
          const docs = await col.aggregate(aggPipeline).toArray();
          const value =
            docs.length > 0
              ? (docs[0] as Record<string, unknown>).value
              : undefined;
          return JSON.stringify([{ [type]: value }]);
        }

        if (type === 'aggregate') {
          if (!pipeline || !Array.isArray(pipeline)) {
            throw new Error('Pipeline is required for aggregate operation');
          }
          const normalized = this.normalizeAggregationPipeline(
            pipeline,
            schemaMap,
          );
          const finalPipeline = [...normalized, { $limit: safeLimit }];
          const docs = await col.aggregate(finalPipeline).toArray();
          return this.safeTruncate(JSON.stringify(docs));
        }

        // 默认 find 操作
        let cursor = col.find(finalFilter, { projection });
        if (typeof sort !== 'undefined') cursor = cursor.sort(sort);
        cursor = cursor.limit(safeLimit);

        const docs = await cursor.toArray();
        return this.safeTruncate(JSON.stringify(docs));
      },
      {
        name: 'data_source_query',
        description:
          '在数据源上执行查询操作。支持 find、count、aggregate、distinct、min、max、sum、avg 等操作。需要先使用 schema_search 获取集合的字段信息。',
        schema: z.object({
          sourceCode: z
            .string()
            .describe('Data source code, such as main-mongo'),
          tenantId: z
            .string()
            .optional()
            .describe('Tenant id, omit for platform scope'),
          type: z
            .enum([
              'find',
              'count',
              'aggregate',
              'distinct',
              'min',
              'max',
              'sum',
              'avg',
            ])
            .optional()
            .default('find')
            .describe('Operation type'),
          collection: z.string().describe('Collection name to query'),
          filter: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Query filter for find/count/distinct'),
          projection: z
            .record(z.string(), z.union([z.literal(0), z.literal(1)]))
            .optional()
            .describe('Projection for find'),
          limit: z
            .number()
            .optional()
            .describe('Max results (default 20, max 100)'),
          sort: z
            .record(z.string(), z.union([z.literal(1), z.literal(-1)]))
            .optional()
            .describe('Sort order for find'),
          pipeline: z
            .array(z.record(z.string(), z.unknown()))
            .optional()
            .describe('Pipeline stages for aggregate'),
          key: z
            .string()
            .optional()
            .describe('Field name for distinct/min/max/sum/avg'),
        }),
      },
    );

    /**
     * 批量数据源查询 - 一次执行多个查询
     * 用于需要从多个表或多条件查询数据的场景，减少工具调用次数
     */
    const dataSourceBatchQuery = tool(
      async ({ queries, tenantId }) => {
        console.log('[data_source_batch_query] Batch queries:', queries.length);

        if (!Array.isArray(queries) || queries.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'QUERIES_ARRAY_REQUIRED',
            message: 'queries 参数必须是非空数组',
          });
        }

        if (queries.length > 10) {
          return JSON.stringify({
            success: false,
            error: 'QUERIES_TOO_MANY',
            message: '单次最多支持 10 个并发查询',
          });
        }

        // 并发执行所有查询
        const results = await Promise.all(
          queries.map((q, index) =>
            this.executeSingleQuery({
              sourceCode: q.sourceCode || MAIN_DATA_SOURCE.code,
              tenantId,
              collection: q.collection,
              filter: q.filter,
              projection: q.projection,
              limit: q.limit,
              sort: q.sort,
              type: q.type,
              pipeline: q.pipeline,
              key: q.key,
              scope: { tenantId: tenantId ?? scope?.tenantId },
            }).then((r) => ({
              index,
              queryName: q.queryName || `query_${index + 1}`,
              ...r,
            })),
          ),
        );

        // 检查是否有超量查询
        const oversizedResults = results.filter((r) => {
          if (!r.data || typeof r.data !== 'string') return false;
          const dataStr = r.data as string;
          // 检测是否包含截断标记
          return (
            dataStr.includes('_truncated') ||
            dataStr.includes('OUTPUT TRUNCATED') ||
            dataStr.includes('结果过多')
          );
        });

        const successCount = results.filter((r) => !r.error).length;
        const failCount = results.length - successCount;

        console.log(
          `[data_source_batch_query] Completed: ${successCount} success, ${failCount} failed`,
        );

        const response: Record<string, unknown> = {
          success: true,
          total: results.length,
          successCount,
          failCount,
          results: results.map((r) => ({
            queryName: r.queryName,
            collection: r.collection,
            sourceCode: r.sourceCode,
            data: r.data,
            error: r.error,
          })),
        };

        // 如果有超量查询，添加警告
        if (oversizedResults.length > 0) {
          response.warning = `${oversizedResults.length} 个查询返回数据过多被截断，请调整查询条件（如增加 filter、减少 limit 或使用 projection）`;
          response.oversizedQueries = oversizedResults.map((r) => ({
            queryName: r.queryName,
            collection: r.collection,
          }));
        }

        return JSON.stringify(response);
      },
      {
        name: 'data_source_batch_query',
        description: `批量数据源查询工具，一次执行多个查询。
用途：需要从多个表查询数据或多条件查询时，使用此工具减少工具调用次数。
特点：
- 并发执行所有查询，提高效率
- 单个查询失败不影响其他查询
- 自动检测查询结果是否超量（被截断），如有会在 warning 中提示

如果某个查询的数据量过大被截断，会在对应 query 的 data 中包含 _truncated 标记，
此时应该根据 warning 提示调整该查询的 filter 条件或 limit 限制。`,
        schema: z.object({
          queries: z
            .array(
              z.object({
                queryName: z
                  .string()
                  .optional()
                  .describe('查询名称标识，用于结果匹配'),
                sourceCode: z
                  .string()
                  .optional()
                  .describe('数据源代码，默认 main-mongo'),
                collection: z.string().describe('Collection name to query'),
                type: z
                  .enum(['find', 'count', 'aggregate', 'distinct', 'min', 'max', 'sum', 'avg'])
                  .optional()
                  .default('find')
                  .describe('Operation type'),
                filter: z
                  .record(z.string(), z.unknown())
                  .optional()
                  .describe('Query filter'),
                projection: z
                  .record(z.string(), z.union([z.literal(0), z.literal(1)]))
                  .optional()
                  .describe('Projection for find'),
                limit: z.number().optional().describe('Max results'),
                sort: z
                  .union([
                    z.record(z.string(), z.union([z.literal(1), z.literal(-1)])).describe('Sort as record'),
                    z.array(z.string()).describe('Sort as array like ["field ASC", "field2 DESC"]'),
                  ])
                  .optional()
                  .describe('Sort order'),
                pipeline: z
                  .union([
                    z.string().describe('JSON string of pipeline array'),
                    z.array(z.record(z.string(), z.unknown())).describe('Pipeline array'),
                  ])
                  .optional()
                  .describe('Pipeline for aggregate'),
                key: z.string().optional().describe('Field for distinct/min/max/sum/avg'),
              }),
            )
            .min(1)
            .max(10)
            .describe('查询列表，最多10个'),
          tenantId: z.string().optional().describe('租户ID'),
        }),
      },
    );

    return [dataSourceQuery, dataSourceBatchQuery];
  }

  private buildSchemaMap(
    fields: FieldMeta[],
  ): Record<
    string,
    'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
  > {
    const out: Record<
      string,
      'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
    > = {};
    for (const f of fields) {
      const t = f.type as
        | 'string'
        | 'number'
        | 'boolean'
        | 'date'
        | 'object'
        | 'array';
      if (t) out[f.name] = t;
    }
    return out;
  }

  private isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  private collectFilterFields(input?: unknown): Set<string> {
    const fields = new Set<string>();
    if (!this.isPlainObject(input)) return fields;
    for (const [key, val] of Object.entries(input)) {
      if (key === '$and' || key === '$or') {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (this.isPlainObject(item)) {
              for (const k of this.collectFilterFields(item)) {
                fields.add(k);
              }
            }
          }
        }
        continue;
      }
      if (!key.startsWith('$')) fields.add(key);
    }
    return fields;
  }

  private transformDateStringFilter(
    input: Record<string, unknown>,
    schemaMap: Record<
      string,
      'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
    >,
  ): Record<string, unknown> {
    const tryParse = (s: string): Date | undefined => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? undefined : d;
    };

    const visit = (node: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node)) {
        if (key.startsWith('$')) {
          if (Array.isArray(val)) {
            const arr = val as unknown[];
            const mapped: unknown[] = arr.map((item: unknown) =>
              this.isPlainObject(item as Record<string, unknown>)
                ? visit(item as Record<string, unknown>)
                : item,
            );
            out[key] = mapped;
          } else if (this.isPlainObject(val)) {
            out[key] = visit(val);
          } else {
            out[key] = val;
          }
          continue;
        }
        const t = schemaMap[key];
        if (t === 'date' && typeof val === 'string') {
          const d = tryParse(val);
          if (d) {
            out[key] = d;
            continue;
          }
        }
        if (t === 'date' && this.isPlainObject(val)) {
          const inner: Record<string, unknown> = {};
          for (const [op, v] of Object.entries(val)) {
            if (typeof v === 'string') {
              inner[op] = tryParse(v) ?? v;
            } else {
              inner[op] = v;
            }
          }
          out[key] = inner;
          continue;
        }
        out[key] = val;
      }
      return out;
    };

    return visit(input);
  }

  private normalizeAggregationPipeline(
    pipeline: Record<string, unknown>[],
    schemaMap: Record<
      string,
      'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
    >,
  ): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const stage of pipeline) {
      if (this.isPlainObject(stage)) {
        const matchVal = stage['$match'];
        if (this.isPlainObject(matchVal)) {
          const normalized = this.transformDateStringFilter(
            matchVal,
            schemaMap,
          );
          out.push({ $match: normalized });
          continue;
        }
      }
      out.push(stage);
    }
    return out;
  }

  /**
   * @description 解析目标查询集合与连接
   * @keyword-en resolve target query collection
   * TODO: [统一搜索] 支持 tenant-mongo 路由到 sass_schema
   * - tenant-mongo: 查询 sass_schema 中注册的租户表，collectionName 为 sass_schema 中的 table 字段
   */
  private async resolveTargetCollection(
    sourceCode: string,
    collectionName: string,
    tenantId?: string,
  ): Promise<{
    source: DataSourceEntity;
    col: Collection<Record<string, unknown>>;
    logicalCollectionName: string;
  }> {
    // tenant-mongo: 从 sass_schema 获取实际表名，添加前缀查询
    if (sourceCode === 'tenant-mongo') {
      if (!tenantId) {
        throw new Error('TENANT_ID_REQUIRED: tenant-mongo requires tenantId');
      }
      // 先从 sass_schema 获取实际表名
      const sassDoc = await this.db.collection('sass_schema').findOne({ table: collectionName });
      const actualTable = sassDoc ? sassDoc.table : collectionName;
      const prefix = this.buildSaasTenantPrefix(tenantId);
      const physicalCollectionName = `${prefix}_${actualTable}`;
      return {
        source: null as unknown as DataSourceEntity,
        col: this.db.collection<Record<string, unknown>>(physicalCollectionName),
        logicalCollectionName: actualTable,
      };
    }

    const resolvedSourceCode = sourceCode;
    const source = await this.dataSourceService.findAccessibleSource(
      resolvedSourceCode,
      tenantId,
    );
    if (!source) {
      throw new Error('SOURCE_NOT_ACCESSIBLE');
    }
    const conn = this.dataSourceService.resolveMongoConnection(source);
    const logicalCollectionName = collectionName.trim();
    const mappedByMap = conn.collectionMap?.[logicalCollectionName];
    const configPrefix = conn.localCollectionPrefix?.trim() || '';
    // main/local 模式下：若无显式前缀配置，则按 tenantId 自动推导 SaaS 4 字符前缀
    const autoPrefix =
      !configPrefix && tenantId && (conn.mode === 'main' || conn.mode === 'local')
        ? this.buildSaasTenantPrefix(tenantId) + '_'
        : '';
    const effectivePrefix = configPrefix || autoPrefix;
    const physicalCollectionName =
      mappedByMap ||
      (effectivePrefix
        ? `${effectivePrefix}${logicalCollectionName}`
        : logicalCollectionName);
    if (conn.mode === 'main' || conn.mode === 'local') {
      return {
        source,
        col: this.db.collection<Record<string, unknown>>(
          physicalCollectionName,
        ),
        logicalCollectionName,
      };
    }
    const client = await this.getExternalClient(sourceCode, conn);
    const dbName = conn.dbName?.trim();
    if (!dbName) {
      throw new Error('EXTERNAL_DB_NAME_REQUIRED');
    }
    const db = client.db(dbName);
    return {
      source,
      col: db.collection<Record<string, unknown>>(physicalCollectionName),
      logicalCollectionName,
    };
  }

  /**
   * @description 获取外部Mongo客户端
   * @keyword-en get external mongo client
   */
  private async getExternalClient(
    sourceCode: string,
    connection: {
      mode: 'main' | 'local' | 'external';
      uri?: string;
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      authSource?: string;
      params?: Record<string, string>;
    },
  ): Promise<MongoClient> {
    const cached = this.externalClientCache.get(sourceCode);
    if (cached) return cached;
    const uri = this.buildExternalMongoUri(connection);
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    this.externalClientCache.set(sourceCode, client);
    return client;
  }

  /**
   * @description 构建外部Mongo连接串
   * @keyword-en build external mongo uri
   */
  private buildExternalMongoUri(connection: {
    uri?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    authSource?: string;
    params?: Record<string, string>;
  }): string {
    if (connection.uri?.trim()) return connection.uri.trim();
    const host = connection.host?.trim();
    if (!host) throw new Error('EXTERNAL_MONGO_HOST_REQUIRED');
    const port = connection.port ?? 27017;
    const query = new URLSearchParams(connection.params ?? {});
    if (connection.authSource?.trim() && !query.get('authSource')) {
      query.set('authSource', connection.authSource.trim());
    }
    const user = connection.user?.trim();
    const pass = connection.password?.trim();
    const authPrefix =
      user && pass
        ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
        : '';
    const queryString = query.toString();
    return `mongodb://${authPrefix}${host}:${port}/${queryString ? `?${queryString}` : ''}`;
  }

  /**
   * @description 解析租户ID优先级
   * @keyword-en resolve tenant id
   */
  /**
   * @description 根据 tenantId 构建 4 字符集合前缀（与 SaaS 租户表命名规则一致）
   * @keyword-en build tenant collection prefix
   */
  private buildSaasTenantPrefix(tenantId: string): string {
    const raw = String(tenantId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const safe = raw.length > 0 ? raw : 'tn';
    return (safe + '0000').slice(0, 4);
  }

  private resolveTenantId(
    tenantId?: string,
    scope?: { tenantId?: string; userId?: string },
  ): string | undefined {
    const scoped = scope?.tenantId?.trim();
    const requested = tenantId?.trim();
    if (scoped) {
      if (requested && requested !== scoped) {
        throw new Error('TENANT_SCOPE_MISMATCH');
      }
      return scoped;
    }
    return requested;
  }
}
