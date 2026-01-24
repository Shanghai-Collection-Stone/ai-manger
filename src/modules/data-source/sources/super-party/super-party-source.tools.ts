import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { SuperPartySourceService } from './super-party-source.service.js';

/**
 * @title 超级派对数据源工具 Super Party Source Tools
 * @description 提供超级派对 MongoDB 数据源的 LangChain 工具函数。
 * @keywords-cn 超级派对工具, 函数调用, 查询
 * @keywords-en super party tools, function call, query
 */
@Injectable()
export class SuperPartySourceToolsService {
  constructor(private readonly service: SuperPartySourceService) {}

  /**
   * @title 获取工具句柄 Get Handle
   */
  getHandle(): CreateAgentParams['tools'] {
    const superPartyQuery = tool(
      async ({ collection, filter, projection, sort, limit, skip }) => {
        try {
          const parsedFilter = filter
            ? (JSON.parse(filter) as Record<string, unknown>)
            : {};
          const parsedProjection = projection
            ? (JSON.parse(projection) as Record<string, 0 | 1>)
            : undefined;
          const parsedSort = sort
            ? (JSON.parse(sort) as Record<string, 1 | -1>)
            : undefined;

          const results = await this.service.query(collection, parsedFilter, {
            projection: parsedProjection,
            sort: parsedSort,
            limit,
            skip,
          });
          return JSON.stringify({
            success: true,
            count: results.length,
            data: results,
          });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'super_party_query',
        description:
          '在超级派对数据库执行查询。用于查询小程序数据，如用户、活动、订单等。',
        schema: z.object({
          collection: z.string().describe('集合名称'),
          filter: z.string().optional().describe('JSON 格式的查询条件'),
          projection: z.string().optional().describe('JSON 格式的字段投影'),
          sort: z.string().optional().describe('JSON 格式的排序规则'),
          limit: z.number().optional().default(20).describe('最大返回数量'),
          skip: z.number().optional().describe('跳过的文档数量'),
        }),
      },
    );

    const superPartyAggregate = tool(
      async ({ collection, pipeline }) => {
        try {
          const parsedPipeline = JSON.parse(pipeline) as Record<
            string,
            unknown
          >[];
          const results = await this.service.aggregate(
            collection,
            parsedPipeline,
          );
          return JSON.stringify({
            success: true,
            count: results.length,
            data: results,
          });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'super_party_aggregate',
        description: '在超级派对数据库执行聚合管道。用于复杂查询和数据统计。',
        schema: z.object({
          collection: z.string().describe('集合名称'),
          pipeline: z.string().describe('JSON 格式的聚合管道'),
        }),
      },
    );

    const superPartyListCollections = tool(
      async () => {
        try {
          const collections = await this.service.getCollections();
          return JSON.stringify({ success: true, collections });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'super_party_list_collections',
        description: '列出超级派对数据库中的所有集合。',
        schema: z.object({}),
      },
    );

    const superPartySchemaInfo = tool(
      async ({ collection, sampleSize }) => {
        try {
          const schema = await this.service.getCollectionSchema(
            collection,
            sampleSize,
          );
          const count = await this.service.getDocumentCount(collection);
          return JSON.stringify({
            success: true,
            collection,
            documentCount: count,
            fields: schema,
          });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'super_party_schema_info',
        description: '获取超级派对数据库集合的 Schema 信息。',
        schema: z.object({
          collection: z.string().describe('集合名称'),
          sampleSize: z.number().optional().default(100).describe('采样数量'),
        }),
      },
    );

    return [
      superPartyQuery,
      superPartyAggregate,
      superPartyListCollections,
      superPartySchemaInfo,
    ];
  }
}
