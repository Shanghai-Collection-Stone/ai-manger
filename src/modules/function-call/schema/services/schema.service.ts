import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { DataSourceSchemaService } from '../../../data-source/services/data-source-schema.service.js';

/**
 * @title Schema 函数调用服务 Schema Function Call Service
 * @description 提供基于自然语言的Schema搜索工具，支持跨数据源搜索。
 * @keywords-cn Schema, 函数调用, 搜索, 多数据源
 * @keywords-en schema, function-call, search, multi-source
 */
@Injectable()
export class SchemaFunctionCallService {
  constructor(private readonly schemaService: DataSourceSchemaService) {}

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
        console.log('[schema_search] Searching all sources:', query, {
          limit,
          sourceCode,
          tenantId: scopedTenantId,
        });

        // 跨所有数据源搜索
        const results = await this.schemaService.searchAllSources(
          query,
          limit ?? 10,
          {
            tenantId: scopedTenantId,
            sourceCode,
          },
        );

        if (results.length === 0) {
          return JSON.stringify({
            query,
            items: [],
            message: '未找到匹配的 schema，请尝试其他关键词',
          });
        }

        // 检查是否有多个数据源
        const sourceCodes = new Set(results.map((r) => r.schema.sourceCode));
        const hasMultipleSources = sourceCodes.size > 1;

        const items = results.map((r) => ({
          // 根据数据源类型返回不同的资源标识
          ...(r.schema.sourceCode === 'feishu-bitable'
            ? { tableId: r.schema.collectionName }
            : { collectionName: r.schema.collectionName }),
          sourceCode: r.schema.sourceCode,
          nameCn: r.schema.nameCn,
          keywords: r.schema.keywords,
          fields: r.schema.fields,
          score: r.score,
        }));

        console.log(
          `[schema_search] Found ${items.length} schemas from ${sourceCodes.size} source(s)`,
        );

        return JSON.stringify({
          query,
          items,
          ...(hasMultipleSources
            ? {
                warning:
                  '检测到多个数据源匹配，请与用户确认使用哪个数据源后再查询',
              }
            : {}),
          toolMapping: {
            'main-mongo': 'data_source_query',
            'super-party': 'super_party_query',
            'feishu-bitable': 'feishu_bitable_list_records',
          },
        });
      },
      {
        name: 'schema_search',
        description: `搜索所有数据源的 schema（表/集合结构）。
返回结果包含 sourceCode 字段，根据 sourceCode 选择对应的查询工具：
- main-mongo → data_source_query（使用 collectionName）
- super-party → super_party_query（使用 collectionName）
- feishu-bitable → feishu_bitable_list_records（使用 tableId）
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
