import { Injectable, Inject } from '@nestjs/common';
import { Db } from 'mongodb';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { readMongoSchemaCache } from '../cache/mongo.cache.js';
import type { FieldMeta, TableMeta } from '../types/mongo.types.js';

/**
 * @title Mongo 函数调用服务 Mongo Function Call Service
 * @description 提供结构化的MongoDB查询函数句柄。
 * @keywords-cn 函数调用, Mongo查询
 * @keywords-en function call, mongo query
 */
@Injectable()
export class MongoFunctionCallService {
  constructor(@Inject('FC_MONGO_DB') private readonly db: Db) {}

  private async buildSchemaMap(
    collection: string,
  ): Promise<
    | Record<
        string,
        'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
      >
    | undefined
  > {
    const cache = await readMongoSchemaCache();
    if (cache && Array.isArray(cache.tables)) {
      const table = cache.tables.find((t) => t.name === collection);
      if (table && Array.isArray(table.fields)) {
        const out: Record<
          string,
          'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
        > = {};
        for (const f of table.fields) {
          const t = f.type as
            | 'string'
            | 'number'
            | 'boolean'
            | 'date'
            | 'object'
            | 'array';
          if (t) out[f.name] = t;
        }
        return Object.keys(out).length > 0 ? out : undefined;
      }
    }
    return undefined;
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

    const parsePartialDateRange = (
      s: string,
    ): { start: Date; end: Date } | undefined => {
      const norm = s.trim();
      const m = norm.match(/^([0-9]{4})(?:-(\d{2}|xx))?(?:-(\d{2}|xx))?$/i);
      if (!m) return undefined;
      const year = Number(m[1]);
      const monToken = m[2];
      const dayToken = m[3];
      if (!monToken || monToken.toLowerCase() === 'xx') {
        const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
        const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
        return { start, end };
      }
      const mon = Number(monToken);
      if (!dayToken || dayToken.toLowerCase() === 'xx') {
        const start = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
        const nextMonth = mon === 12 ? 0 : mon;
        const nextYear = mon === 12 ? year + 1 : year;
        const end = new Date(Date.UTC(nextYear, nextMonth, 1, 0, 0, 0, 0));
        return { start, end };
      }
      const day = Number(dayToken);
      const start = new Date(Date.UTC(year, mon - 1, day, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, mon - 1, day + 1, 0, 0, 0, 0));
      return { start, end };
    };

    const visit = (node: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node)) {
        if (key.startsWith('$')) {
          if (Array.isArray(val)) {
            const arr: unknown[] = [];
            for (const item of val) {
              if (this.isPlainObject(item)) {
                arr.push(visit(item));
              } else {
                arr.push(item);
              }
            }
            out[key] = arr;
          } else if (this.isPlainObject(val)) {
            out[key] = visit(val);
          } else {
            out[key] = val;
          }
          continue;
        }
        if (!key.startsWith('$')) {
          const t = schemaMap[key];
          if (t === 'date') {
            if (typeof val === 'string') {
              const d = tryParse(val);
              if (d) {
                out[key] = d;
              } else {
                const range = parsePartialDateRange(val);
                out[key] = range ? { $gte: range.start, $lt: range.end } : val;
              }
              continue;
            }
            if (Array.isArray(val)) {
              const list = val as unknown[];
              out[key] = list.map((v) =>
                typeof v === 'string' ? (tryParse(v) ?? v) : v,
              );
              continue;
            }
            if (this.isPlainObject(val)) {
              const inner: Record<string, unknown> = {};
              for (const [op, v] of Object.entries(val)) {
                if (Array.isArray(v)) {
                  const list = v as unknown[];
                  inner[op] = list.map((x) =>
                    typeof x === 'string' ? (tryParse(x) ?? x) : x,
                  );
                } else if (typeof v === 'string') {
                  if (op === '$eq') {
                    const d = tryParse(v);
                    if (d) inner[op] = d;
                    else {
                      const range = parsePartialDateRange(v);
                      if (range) {
                        delete inner['$eq'];
                        inner['$gte'] = range.start;
                        inner['$lt'] = range.end;
                      } else {
                        inner[op] = v;
                      }
                    }
                  } else {
                    inner[op] = tryParse(v) ?? v;
                  }
                } else {
                  inner[op] = v;
                }
              }
              out[key] = inner;
              continue;
            }
          }
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

  async normalizeFilter(
    collection: string,
    filter?: Record<string, unknown>,
    schema?: Record<
      string,
      'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
    >,
  ): Promise<Record<string, unknown>> {
    const schemaMap = schema ?? (await this.buildSchemaMap(collection));
    const base = this.isPlainObject(filter) ? filter : {};
    if (!schemaMap) return base;
    return this.transformDateStringFilter(base, schemaMap);
  }

  /**
   * @title 获取集合字段元数据 Get Field Metas
   * @description 返回集合在缓存中的字段元数据列表，用于语义匹配建议。
   * @keywords-cn 字段, 元数据, 建议
   * @keywords-en field, meta, suggestions
   */
  private async getFieldMetas(collection: string): Promise<FieldMeta[]> {
    const cache = await readMongoSchemaCache();
    if (!cache || !Array.isArray(cache.tables)) return [];
    const table: TableMeta | undefined = cache.tables.find(
      (t) => t.name === collection,
    );
    if (!table || !Array.isArray(table.fields)) return [];
    return table.fields;
  }

  /**
   * @title 生成替换建议 Build Replacement Suggestions
   * @description 针对非法字段，基于名称/分词/中文描述提供多个候选字段及评分。
   * @keywords-cn 替换, 建议, 匹配
   * @keywords-en replace, suggestions, match
   */
  private buildFieldSuggestions(
    collection: string,
    invalidFields: string[],
    schemaMap: Record<
      string,
      'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
    >,
  ): Promise<
    Record<
      string,
      { field: string; score: number; type: string; reason: string }[]
    >
  > {
    const normalize = (s: string): string => s.toLowerCase().trim();
    const splitTokens = (s: string): string[] => {
      const a = normalize(s)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^a-z0-9]+/gi, ' ')
        .split(' ')
        .filter(Boolean);
      return a;
    };
    const tokenOverlap = (a: string[], b: string[]): number => {
      const setA = new Set(a);
      const inter = b.filter((x) => setA.has(x));
      const denom = Math.max(1, Math.min(a.length, b.length));
      return inter.length / denom;
    };

    return (async () => {
      const metas = await this.getFieldMetas(collection);
      const candidates = metas.map((m) => ({
        name: m.name,
        nameCn: m.nameCn ?? '',
        description: m.description ?? '',
        type: schemaMap[m.name] ?? 'string',
        nameTokens: splitTokens(m.name),
        cnTokens: splitTokens(m.nameCn ?? ''),
        descTokens: splitTokens(m.description ?? ''),
      }));
      const out: Record<
        string,
        { field: string; score: number; type: string; reason: string }[]
      > = {};
      for (const inv of invalidFields) {
        const invNorm = normalize(inv);
        const invTokens = splitTokens(inv);
        const scored = candidates.map((c) => {
          const nameScore =
            c.name.includes(invNorm) || invNorm.includes(c.name) ? 0.8 : 0;
          const tokenScore = Math.max(
            tokenOverlap(invTokens, c.nameTokens),
            tokenOverlap(invTokens, c.cnTokens),
          );
          const descScore = tokenOverlap(invTokens, c.descTokens) * 0.3;
          const score = Math.max(nameScore, tokenScore) + descScore;
          let reason = '';
          if (nameScore >= 0.8) reason = 'name-substring-match';
          else if (tokenScore > 0.5) reason = 'token-overlap-high';
          else if (tokenScore > 0.2) reason = 'token-overlap';
          else if (descScore > 0.1) reason = 'description-match';
          return {
            field: c.name,
            score: Number(score.toFixed(3)),
            type: c.type,
            reason,
          };
        });
        const best = scored
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        out[inv] = best;
      }
      return out;
    })();
  }

  /**
   * @title 获取函数句柄 Get Handle
   * @description 返回可用于函数调用系统的查询句柄描述。
   * @keywords-cn 句柄, 描述
   * @keywords-en handle, description
   */
  getHandle(): CreateAgentParams['tools'] {
    const mongoSearch = tool(
      async ({
        collection,
        filter,
        projection,
        limit,
        sort,
        type,
        pipeline,
        key,
        schema,
      }) => {
        console.log('mongoSearch', {
          collection,
          filter,
          projection,
          limit,
          sort,
          type,
          pipeline,
          key,
          schema,
        });
        const col = this.db.collection(collection);
        const safeLimit = Math.min(
          typeof limit === 'number' && limit > 0 ? limit : 20,
          100,
        );
        const schemaMap = schema ?? (await this.buildSchemaMap(collection));
        if (!schemaMap) {
          return JSON.stringify({
            error: 'SCHEMA_REQUIRED',
            message:
              'No schema found for collection. Please call schema_search and reconstruct filter with valid fields.',
            collection,
            operation: type ?? 'find',
            original_filter: filter ?? {},
          });
        }
        const filterFields = this.collectFilterFields(filter);
        const schemaFields = new Set(Object.keys(schemaMap));
        const invalid: string[] = [];
        for (const f of filterFields) {
          if (!schemaFields.has(f)) invalid.push(f);
        }
        if (invalid.length > 0) {
          const suggestions = await this.buildFieldSuggestions(
            collection,
            invalid,
            schemaMap,
          );
          return JSON.stringify({
            error: 'INVALID_FILTER_FIELDS',
            message:
              'Filter contains fields not present in schema. Review suggestions and replace with the correct fields.',
            collection,
            operation: type ?? 'find',
            invalid_fields: invalid,
            suggestions,
            schema_fields: Array.from(schemaFields),
            original_filter: filter ?? {},
          });
        }
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
          const pipeline = [
            { $match: finalFilter },
            { $group: { _id: null, value: { [op]: `$${key}` } } },
          ];
          const docs = await col.aggregate(pipeline).toArray();
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
          const schemaFields = new Set(Object.keys(schemaMap));
          const matchFields = new Set<string>();
          for (const st of pipeline) {
            if (this.isPlainObject(st)) {
              const mv = st['$match'];
              if (this.isPlainObject(mv)) {
                for (const k of this.collectFilterFields(mv))
                  matchFields.add(k);
              }
            }
          }
          const invalid: string[] = [];
          for (const f of matchFields)
            if (!schemaFields.has(f)) invalid.push(f);
          if (invalid.length > 0) {
            const suggestions = await this.buildFieldSuggestions(
              collection,
              invalid,
              schemaMap,
            );
            return JSON.stringify({
              error: 'INVALID_PIPELINE_FIELDS',
              message:
                '$match contains fields not present in schema. Review suggestions and replace with the correct fields.',
              collection,
              operation: type,
              invalid_fields: invalid,
              suggestions,
              schema_fields: Array.from(schemaFields),
              original_pipeline: pipeline,
            });
          }
          const normalized = this.normalizeAggregationPipeline(
            pipeline,
            schemaMap,
          );
          const finalPipeline = [...normalized, { $limit: safeLimit }];
          const docs = await col.aggregate(finalPipeline).toArray();
          return JSON.stringify(docs);
        }

        let cursor = col.find(finalFilter, { projection });
        if (typeof sort !== 'undefined') cursor = cursor.sort(sort);
        cursor = cursor.limit(safeLimit);

        const docs = await cursor.toArray();
        return JSON.stringify(docs);
      },
      {
        name: 'mongo_search',
        description: '根据Schema构造查询参数, 然后执行MongoDB查询操作。',
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
          collection: z.string().describe('MongoDB collection name'),
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
            .describe('Max results (default 20, max 20)'),
          sort: z
            .record(z.union([z.literal(1), z.literal(-1)]))
            .optional()
            .describe('Sort order for find'),
          pipeline: z
            .array(z.record(z.unknown()))
            .optional()
            .describe('Pipeline stages for aggregate'),
          key: z.string().optional().describe('Field name for distinct'),
          schema: z
            .record(
              z.enum([
                'string',
                'number',
                'boolean',
                'date',
                'object',
                'array',
              ]),
            )
            .optional()
            .describe('Field type map for coercion'),
        }),
      },
    );
    return [mongoSearch];
  }
}
