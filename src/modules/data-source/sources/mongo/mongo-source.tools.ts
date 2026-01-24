import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { MongoSourceService } from './mongo-source.service.js';

/**
 * @title Mongo 数据源 Tools Mongo Source Tools
 * @description 提供 MongoDB 数据源的 LangChain 工具函数。
 * @keywords-cn Mongo工具, 函数调用, 查询
 * @keywords-en mongo tools, function call, query
 */
@Injectable()
export class MongoSourceToolsService {
  constructor(private readonly mongoSource: MongoSourceService) {}

  /**
   * @title 获取工具句柄 Get Handle
   * @description 返回 MongoDB 数据源相关的工具列表。
   */
  getHandle(): CreateAgentParams['tools'] {
    const mongoQuery = tool(
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

          const results = await this.mongoSource.query(
            collection,
            parsedFilter,
            {
              projection: parsedProjection,
              sort: parsedSort,
              limit,
              skip,
            },
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
        name: 'mongo_query',
        description:
          'Execute a MongoDB find query on a collection. Use this to search and retrieve documents.',
        schema: z.object({
          collection: z.string().describe('Collection name to query'),
          filter: z
            .string()
            .optional()
            .describe('JSON string of MongoDB filter query'),
          projection: z
            .string()
            .optional()
            .describe('JSON string of field projection'),
          sort: z
            .string()
            .optional()
            .describe('JSON string of sort specification'),
          limit: z
            .number()
            .optional()
            .default(20)
            .describe('Maximum number of documents to return'),
          skip: z.number().optional().describe('Number of documents to skip'),
        }),
      },
    );

    const mongoAggregate = tool(
      async ({ collection, pipeline }) => {
        try {
          const parsedPipeline = JSON.parse(pipeline) as Record<
            string,
            unknown
          >[];
          const results = await this.mongoSource.aggregate(
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
        name: 'mongo_aggregate',
        description:
          'Execute a MongoDB aggregation pipeline. Use this for complex queries, grouping, and data transformations.',
        schema: z.object({
          collection: z.string().describe('Collection name to aggregate'),
          pipeline: z
            .string()
            .describe('JSON string of aggregation pipeline array'),
        }),
      },
    );

    const mongoSchemaInfo = tool(
      async ({ collection, sampleSize }) => {
        try {
          const schema = await this.mongoSource.getCollectionSchema(
            collection,
            sampleSize,
          );
          const count = await this.mongoSource.getDocumentCount(collection);
          const indexes = await this.mongoSource.getIndexes(collection);

          return JSON.stringify({
            success: true,
            collection,
            documentCount: count,
            fields: schema,
            indexes: indexes.map((idx) => ({
              name: idx['name'],
              key: idx['key'],
            })),
          });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'mongo_schema_info',
        description:
          'Get schema information about a MongoDB collection including field types, document count, and indexes.',
        schema: z.object({
          collection: z.string().describe('Collection name to inspect'),
          sampleSize: z
            .number()
            .optional()
            .default(100)
            .describe('Number of documents to sample for schema inference'),
        }),
      },
    );

    const mongoListCollections = tool(
      async () => {
        try {
          const collections = await this.mongoSource.getCollections();
          return JSON.stringify({ success: true, collections });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'mongo_list_collections',
        description: 'List all collections in the MongoDB database.',
        schema: z.object({}),
      },
    );

    return [mongoQuery, mongoAggregate, mongoSchemaInfo, mongoListCollections];
  }
}
