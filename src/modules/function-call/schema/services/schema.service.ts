import { Injectable, Inject } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { Db, ObjectId } from 'mongodb';
import { DataSourceSchemaService } from '../../../data-source/services/data-source-schema.service.js';
import { DataSourceSchemaSearchResult } from '../../../data-source/entities/data-source-schema.entity.js';

/**
 * @title Schema 函数调用服务 Schema Function Call Service
 * @description 提供基于自然语言的Schema搜索工具，支持跨数据源搜索。
 *              对于租户上下文额外搜索 sass_schema（租户专属表），sourceCode 标为 tenant-mongo，
 *              对应查询工具为 tenant_query（自动加前缀）。
 * @keywords-cn Schema, 函数调用, 搜索, 多数据源
 * @keywords-en schema, function-call, search, multi-source
 */
@Injectable()
export class SchemaFunctionCallService {
  constructor(
    private readonly schemaService: DataSourceSchemaService,
    @Inject('DS_MONGO_DB') private readonly db: Db,
  ) {}

  /**
   * @description 在 sass_schema 中按关键词搜索租户专属表，转换为统一格式
   * @keyword-en search tenant sass schema by keywords
   */
  private async searchSassSchema(
    query: string,
    limit: number,
  ): Promise<
    Array<{
      collectionName: string;
      sourceCode: string;
      nameCn: string;
      keywords: string[];
      fields: Array<{
        name: string;
        type: string;
        nameCn: string;
        description: string;
      }>;
      score: number;
    }>
  > {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];

    // 宽松关键词匹配：tableName | tableDesc 包含任意词
    const regexStr = tokens
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const docs = await this.db
      .collection<{
        table: string;
        tableDesc: string;
        tableField: Record<string, string>;
      }>('sass_schema')
      .find({
        $or: [
          { table: { $regex: regexStr, $options: 'i' } },
          { tableDesc: { $regex: regexStr, $options: 'i' } },
        ],
      })
      .limit(limit)
      .toArray();

    return docs.map((doc) => {
      let score = 0;
      const lowerName = doc.table.toLowerCase();
      const lowerDesc = (doc.tableDesc ?? '').toLowerCase();
      for (const t of tokens) {
        if (lowerName.includes(t)) score += 3;
        if (lowerDesc.includes(t)) score += 2;
      }
      return {
        collectionName: doc.table,
        sourceCode: 'tenant-mongo',
        nameCn: doc.tableDesc ?? doc.table,
        keywords: [doc.table, doc.tableDesc].filter(Boolean),
        fields: Object.entries(doc.tableField ?? {}).map(([name, desc]) => ({
          name,
          type: 'string',
          nameCn: name,
          description: desc ?? '',
        })),
        score,
      };
    });
  }

  /**
   * @description 获取Schema工具句柄
   * @keyword-en get schema tool handle
   */
  getHandle(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    /**
     * Schema 搜索工具 - 统一搜索所有数据源
     * TODO: schema_search 同时搜索 sass_schema 和 data_source_schemas
     * - sass_schema: 子租户专属表，sourceCode=tenant-mongo
     * - data_source_schemas: 外部数据源（飞书、main-mongo、super-party等）
     */
    const schemaSearch = tool(
      async ({ query, limit, sourceCode, tenantId }) => {
        const scopedTenantId = this.resolveTenantId(tenantId, scope);
        const effectiveLimit = limit ?? 10;

        // 1. 搜索 data_source_schemas（外部数据源）
        const dsResults = await this.schemaService.searchAllSources(
          query,
          effectiveLimit,
          {
            tenantId: scopedTenantId,
            sourceCode:
              sourceCode && sourceCode !== 'tenant-mongo'
                ? sourceCode
                : undefined,
          },
        );

        // 2. 搜索 sass_schema（子租户专属表）
        const sassItems =
          scopedTenantId && (!sourceCode || sourceCode === 'tenant-mongo')
            ? await this.searchSassSchema(query, effectiveLimit)
            : [];

        // 3. 合并结果
        const dsItems = dsResults.map((r) => ({
          ...(r.schema.sourceCode === 'feishu-bitable' ||
          r.schema.sourceCode === 'feishu-bitable-task'
            ? { tableId: r.schema.collectionName }
            : { collectionName: r.schema.collectionName }),
          sourceCode: r.schema.sourceCode,
          nameCn: r.schema.nameCn,
          keywords: r.schema.keywords,
          fields: r.schema.fields,
          score: r.score,
        }));

        const allItems = [...dsItems, ...sassItems];

        if (allItems.length === 0) {
          return JSON.stringify({
            query,
            items: [],
            message: '未找到匹配的 schema，请尝试其他关键词',
          });
        }

        const sourceCodes = new Set(allItems.map((i) => i.sourceCode));

        return JSON.stringify({
          query,
          items: allItems,
          sourceCodes: Array.from(sourceCodes),
          toolMapping: {
            'main-mongo': 'data_source_query',
            'tenant-mongo': 'data_source_query',
            'super-party': 'super_party_query',
            'feishu-bitable': 'feishu_bitable_list_records',
            'feishu-bitable-task': 'feishu_bitable_list_records',
          },
        });
      },
      {
        name: 'schema_search',
        description: `统一搜索所有数据源的 schema（表/集合结构）。
同时搜索：sass_schema（子租户表）和 data_source_schemas（飞书、main-mongo等外部数据源）。
返回结果包含 sourceCode 字段，根据 sourceCode 选择对应的查询工具：
- tenant-mongo → data_source_query
- main-mongo → data_source_query
- super-party → super_party_query
- feishu-bitable / feishu-bitable-task → feishu_bitable_list_records`,
        schema: z.object({
          query: z.string().describe('表的中文或英文关键词，多个用空格隔开'),
          limit: z.number().optional().default(10).describe('返回结果数量限制'),
          sourceCode: z
            .string()
            .optional()
            .describe('数据源代码，不传则搜索所有数据源'),
          tenantId: z.string().optional().describe('租户ID'),
        }),
      },
    );

    /**
     * 批量获取 Schema 结构 - 一次查询多个表的完整字段结构
     * TODO: 同时支持 sass_schema 和 data_source_schemas
     */
    const schemaBatchGet = tool(
      async ({ schemas, tenantId }) => {
        const scopedTenantId = this.resolveTenantId(tenantId, scope);

        if (!Array.isArray(schemas) || schemas.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'SCHEMAS_ARRAY_REQUIRED',
            message: 'schemas 参数必须是非空数组',
          });
        }

        if (schemas.length > 20) {
          return JSON.stringify({
            success: false,
            error: 'SCHEMAS_TOO_MANY',
            message: '单次最多支持 20 个 schema 查询',
          });
        }

        // 批量并发查询所有 schema
        const results = await Promise.all(
          schemas.map(async (item) => {
            try {
              const { collectionName, sourceCode = 'main-mongo' } = item;
              if (!collectionName || typeof collectionName !== 'string') {
                return {
                  success: false,
                  collectionName,
                  sourceCode,
                  error: 'INVALID_COLLECTION_NAME',
                };
              }

              // tenant-mongo 查 sass_schema，其他查 data_source_schemas
              let searchResults: DataSourceSchemaSearchResult[] = [];
              if (sourceCode === 'tenant-mongo' && scopedTenantId) {
                // 从 sass_schema 查找
                const sassDoc = await this.db
                  .collection('sass_schema')
                  .findOne({ table: collectionName });
                if (sassDoc) {
                  searchResults = [
                    {
                      schema: {
                        _id: new ObjectId(),
                        collectionName: sassDoc.table,
                        sourceCode: 'tenant-mongo',
                        nameCn: sassDoc.tableDesc ?? sassDoc.table,
                        keywords: [sassDoc.table, sassDoc.tableDesc].filter(
                          Boolean,
                        ),
                        fields: Object.entries(sassDoc.tableField ?? {}).map(
                          ([name, desc]) => ({
                            name,
                            type: 'string',
                            nameCn: name,
                            description: String(desc ?? ''),
                          }),
                        ),
                        version: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      },
                      score: 1,
                      matchType: 'keyword' as const,
                    },
                  ];
                }
              } else {
                searchResults = await this.schemaService.searchSchema(
                  collectionName,
                  sourceCode,
                  1,
                );
              }

              if (searchResults.length === 0) {
                return {
                  success: false,
                  collectionName,
                  sourceCode,
                  error: 'SCHEMA_NOT_FOUND',
                  message: `未找到 ${collectionName} 的 schema，请先使用 schema_search 搜索`,
                };
              }

              const schema = searchResults[0].schema as unknown as Record<
                string,
                unknown
              >;
              return {
                success: true,
                collectionName: String(schema.collectionName),
                sourceCode: String(schema.sourceCode),
                nameCn: String(schema.nameCn ?? ''),
                keywords: Array.isArray(schema.keywords)
                  ? (schema.keywords as string[])
                  : [],
                fields: Array.isArray(schema.fields) ? schema.fields : [],
              };
            } catch (err) {
              return {
                success: false,
                collectionName: item.collectionName,
                sourceCode: item.sourceCode || 'main-mongo',
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }),
        );

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.length - successCount;

        console.log(
          `[schema_batch_get] Completed: ${successCount} success, ${failCount} failed`,
        );

        return JSON.stringify({
          success: true,
          total: results.length,
          successCount,
          failCount,
          results,
          ...(failCount > 0
            ? {
                warning: `${failCount} 个 schema 查询失败，请检查表名和数据源是否正确`,
              }
            : {}),
        });
      },
      {
        name: 'schema_batch_get',
        description: `批量获取多个表的完整 schema 结构。
用途：已知表名时，快速批量获取多个表的字段结构，用于联合分析或多表查询前的结构确认。
支持同时查询不同数据源的表。

返回结果包含每个表的完整字段信息（fields数组），包含：
- name: 字段名
- type: 字段类型
- nameCn: 中文名
- description: 字段描述

如果某个表查询失败，会在 results 中标记 error 字段，不会影响其他表的结果。`,
        schema: z.object({
          schemas: z
            .array(
              z.object({
                collectionName: z.string().describe('表/集合名称'),
                sourceCode: z
                  .string()
                  .optional()
                  .describe('数据源代码，默认 main-mongo')
                  .default('main-mongo'),
              }),
            )
            .min(1)
            .max(20)
            .describe('要查询的表列表，最多20个'),
          tenantId: z.string().optional().describe('租户ID，不传表示平台范围'),
        }),
      },
    );

    return [schemaSearch, schemaBatchGet];
  }

  /**
   * @description 解析租户ID优先级
   * @keyword-en resolve tenant id for schema tool
   */
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
