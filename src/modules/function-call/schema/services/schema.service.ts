import { Injectable, Inject } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { Db } from 'mongodb';
import { DataSourceSchemaService } from '../../../data-source/services/data-source-schema.service.js';

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
      fields: Array<{ name: string; type: string; nameCn: string; description: string }>;
      score: number;
    }>
  > {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];

    // 宽松关键词匹配：tableName | tableDesc 包含任意词
    const regexStr = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
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
        keywords: [doc.table, doc.tableDesc].filter(Boolean) as string[],
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
    const schemaSearch = tool(
      async ({ query, limit, sourceCode, tenantId }) => {
        const scopedTenantId = this.resolveTenantId(tenantId, scope);
        const effectiveLimit = limit ?? 10;
        console.log('[schema_search] Searching all sources:', query, {
          limit: effectiveLimit,
          sourceCode,
          tenantId: scopedTenantId,
        });

        // 跨所有数据源搜索（data_source_schemas，排除无 scope 的数据源租户泄漏已在 service 层控制）
        const dsResults = await this.schemaService.searchAllSources(
          query,
          effectiveLimit,
          {
            tenantId: scopedTenantId,
            sourceCode: sourceCode && sourceCode !== 'tenant-mongo' ? sourceCode : undefined,
          },
        );

        // 租户上下文且未指定其他数据源时，额外搜 sass_schema（租户专属表）
        const sassItems =
          scopedTenantId && (!sourceCode || sourceCode === 'tenant-mongo')
            ? await this.searchSassSchema(query, effectiveLimit)
            : [];

        if (dsResults.length === 0 && sassItems.length === 0) {
          return JSON.stringify({
            query,
            items: [],
            message: '未找到匹配的 schema，请尝试其他关键词',
          });
        }

        const dsItems = dsResults.map((r) => ({
          ...(r.schema.sourceCode === 'feishu-bitable'
            ? { tableId: r.schema.collectionName }
            : { collectionName: r.schema.collectionName }),
          sourceCode: r.schema.sourceCode,
          nameCn: r.schema.nameCn,
          keywords: r.schema.keywords,
          fields: r.schema.fields,
          score: r.score,
        }));

        const allItems = [
          ...dsItems,
          ...sassItems,
        ];

        const sourceCodes = new Set(allItems.map((i) => i.sourceCode));
        const hasMultipleSources = sourceCodes.size > 1;

        console.log(
          `[schema_search] Found ${allItems.length} schemas from ${sourceCodes.size} source(s)`,
        );

        return JSON.stringify({
          query,
          items: allItems,
          ...(hasMultipleSources
            ? {
                warning:
                  '检测到多个数据源匹配，请与用户确认使用哪个数据源后再查询',
              }
            : {}),
          toolMapping: {
            'main-mongo': 'data_source_query',
            'tenant-mongo': 'tenant_query（自动加租户前缀，传逻辑表名即可）',
            'super-party': 'super_party_query',
            'feishu-bitable': 'feishu_bitable_list_records',
          },
        });
      },
      {
        name: 'schema_search',
        description: `搜索所有数据源的 schema（表/集合结构）。
返回结果包含 sourceCode 字段，根据 sourceCode 选择对应的查询工具：
- tenant-mongo → tenant_query（租户专属表，传逻辑表名，前缀自动加）
- main-mongo → data_source_query（使用 collectionName）
- super-party → super_party_query（使用 collectionName）
- feishu-bitable → feishu_bitable_list_records（使用 tableId）
有租户上下文时优先查 sourceCode=tenant-mongo 的结果。
若返回多个不同 sourceCode 的结果，请与用户确认使用哪个数据源。`,
        schema: z.object({
          query: z.string().describe('表的中文或英文关键词，多个用空格隔开'),
          limit: z.number().optional().default(10).describe('返回结果数量限制'),
          sourceCode: z
            .string()
            .optional()
            .describe('数据源代码，建议显式传入'),
          tenantId: z.string().optional().describe('租户ID，不传表示平台范围'),
        }),
      },
    );
    return [schemaSearch];
  }

  /**
   * @description 解析租户ID优先级
   * @keyword-en resolve tenant id for schema tool
   */
  private resolveTenantId(
    tenantId?: string,
    scope?: { tenantId?: string; userId?: string },
  ): string | undefined {
    const value = tenantId?.trim();
    if (value) return value;
    return scope?.tenantId;
  }
}
