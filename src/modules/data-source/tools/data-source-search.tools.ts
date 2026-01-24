import { Injectable, Inject } from '@nestjs/common';
import { Db } from 'mongodb';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import {
  DataSourceSchemaService,
  MAIN_DATA_SOURCE,
} from '../services/data-source-schema.service.js';
import type { FieldMeta } from '../types/data-source.types.js';

/**
 * @title 数据源搜索工具 Data Source Search Tool
 * @description 提供数据源的查询工具，包括 schema 搜索和数据查询。
 * @keywords-cn 数据源搜索, 查询, MongoDB
 * @keywords-en data source search, query, MongoDB
 */
@Injectable()
export class DataSourceSearchToolsService {
  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly schemaService: DataSourceSchemaService,
  ) {}

  /**
   * @title 获取工具句柄 Get Handle
   * @description 返回数据源搜索相关的工具列表。
   */
  getHandle(): CreateAgentParams['tools'] {
    const dataSourceQuery = tool(
      async ({
        collection,
        filter,
        projection,
        limit,
        sort,
        type,
        pipeline,
        key,
      }) => {
        console.log('[data_source_query]', {
          collection,
          filter,
          projection,
          limit,
          sort,
          type,
          pipeline,
          key,
        });

        const col = this.db.collection(collection);
        const safeLimit = Math.min(
          typeof limit === 'number' && limit > 0 ? limit : 20,
          100,
        );

        // 获取 schema 用于字段验证
        const schemaResults = await this.schemaService.searchSchema(
          collection,
          MAIN_DATA_SOURCE.code,
          1,
        );
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
          return JSON.stringify(values);
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
          return JSON.stringify(docs);
        }

        // 默认 find 操作
        let cursor = col.find(finalFilter, { projection });
        if (typeof sort !== 'undefined') cursor = cursor.sort(sort);
        cursor = cursor.limit(safeLimit);

        const docs = await cursor.toArray();
        return JSON.stringify(docs);
      },
      {
        name: 'data_source_query',
        description:
          '在数据源上执行查询操作。支持 find、count、aggregate、distinct、min、max、sum、avg 等操作。需要先使用 schema_search 获取集合的字段信息。',
        schema: z.object({
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
            .record(z.unknown())
            .optional()
            .describe('Query filter for find/count/distinct'),
          projection: z
            .record(z.union([z.literal(0), z.literal(1)]))
            .optional()
            .describe('Projection for find'),
          limit: z
            .number()
            .optional()
            .describe('Max results (default 20, max 100)'),
          sort: z
            .record(z.union([z.literal(1), z.literal(-1)]))
            .optional()
            .describe('Sort order for find'),
          pipeline: z
            .array(z.record(z.unknown()))
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
}
