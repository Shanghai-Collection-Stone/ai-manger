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

    return [dataSourceQuery];
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
    // tenant-mongo 是 schema_search 返回的虚拟 sourceCode，指向本租户主数据库
    const resolvedSourceCode =
      sourceCode === 'tenant-mongo' ? MAIN_DATA_SOURCE.code : sourceCode;
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
