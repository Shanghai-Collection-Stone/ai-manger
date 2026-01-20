import {
  Body,
  Controller,
  Post,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { Db } from 'mongodb';
import { MongoFunctionCallService } from '../services/mongo.service.js';
import { readMongoSchemaCache } from '../cache/mongo.cache.js';
import { AgentService } from '../../../ai-agent/services/agent.service.js';

@Controller('fc/mongo')
export class MongoSearchController {
  constructor(
    @Inject('FC_MONGO_DB') private readonly db: Db,
    private readonly fcService: MongoFunctionCallService,
    private readonly agent: AgentService,
  ) {}

  private isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  private async correctFilterWithAI(
    collection: string,
    original: Record<string, unknown>,
    schemaMap: Record<
      string,
      'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
    >,
  ): Promise<Record<string, unknown> | undefined> {
    const extractJson = (text: string): Record<string, unknown> | undefined => {
      const fence = text.match(/```+\s*(json)?\s*([\s\S]*?)```/i);
      const raw = fence ? fence[2] : text;
      try {
        const objRaw: unknown = JSON.parse(raw);
        return this.isPlainObject(objRaw) ? objRaw : undefined;
      } catch {
        return undefined;
      }
    };

    const collectFields = (input?: unknown): Set<string> => {
      const fields = new Set<string>();
      if (!this.isPlainObject(input)) return fields;
      for (const [key, val] of Object.entries(input)) {
        if (key === '$and' || key === '$or') {
          if (Array.isArray(val)) {
            for (const item of val) {
              if (this.isPlainObject(item)) {
                for (const k of collectFields(item)) fields.add(k);
              }
            }
          }
          continue;
        }
        if (!key.startsWith('$')) fields.add(key);
      }
      return fields;
    };

    const sys = [
      '你是一个MongoDB筛选条件修正器。',
      '根据提供的schema字段与类型，修正filter中不在schema里的字段名。',
      '保持原筛选结构与值不变，仅替换字段名，不偏离本意。',
      '只输出修正后的JSON对象，不要输出任何解释。',
    ].join('\n');
    const user = JSON.stringify({
      collection,
      schema: schemaMap,
      filter: original,
    });
    const ai = await this.agent.runWithMessages({
      config: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        temperature: 0.1,
        nonStreaming: true,
        noPostHook: true,
      },
      messages: this.agent.toMessages([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ]),
    });
    const content = (ai as unknown as { content: unknown }).content;
    const correctedObj =
      typeof content === 'string'
        ? extractJson(content)
        : this.isPlainObject(content)
          ? content
          : undefined;
    if (!correctedObj) return undefined;

    const originalFields = collectFields(original);
    const correctedFields = collectFields(correctedObj);
    const schemaFields = new Set(Object.keys(schemaMap));

    for (const f of correctedFields) {
      if (!schemaFields.has(f)) return undefined;
    }
    const validOriginal = Array.from(originalFields).filter((f) =>
      schemaFields.has(f),
    );
    for (const f of validOriginal) {
      if (!correctedFields.has(f)) return undefined;
    }
    if (correctedFields.size !== originalFields.size) return undefined;

    return correctedObj;
  }

  private collectFields(input?: unknown): Set<string> {
    const fields = new Set<string>();
    const visit = (node: unknown) => {
      if (!this.isPlainObject(node)) return;
      for (const [key, val] of Object.entries(node)) {
        if (key.startsWith('$')) {
          if (Array.isArray(val)) {
            for (const item of val) visit(item);
          } else {
            visit(val);
          }
          continue;
        }
        fields.add(key);
        visit(val);
      }
    };
    visit(input);
    return fields;
  }

  private collectStringFieldRefs(input?: unknown): Set<string> {
    const refs = new Set<string>();
    const visit = (node: unknown) => {
      if (typeof node === 'string') {
        const m = node.match(/^\$(?<f>[A-Za-z_][A-Za-z0-9_.]*)$/);
        const f = m?.groups?.f;
        if (f) refs.add(f.split('.')[0]);
        return;
      }
      if (Array.isArray(node)) {
        for (const it of node) visit(it);
        return;
      }
      if (this.isPlainObject(node)) {
        for (const v of Object.values(node)) visit(v);
      }
    };
    visit(input);
    return refs;
  }

  private async correctParamsWithAI(
    collection: string,
    type:
      | 'find'
      | 'count'
      | 'aggregate'
      | 'distinct'
      | 'min'
      | 'max'
      | 'sum'
      | 'avg',
    schemaMap: Record<
      string,
      'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
    >,
    params: {
      filter?: Record<string, unknown>;
      key?: string;
      projection?: Record<string, 0 | 1>;
      sort?: Record<string, 1 | -1>;
      pipeline?: Record<string, unknown>[];
    },
  ): Promise<
    | {
        filter?: Record<string, unknown>;
        key?: string;
        projection?: Record<string, 0 | 1>;
        sort?: Record<string, 1 | -1>;
        pipeline?: Record<string, unknown>[];
      }
    | undefined
  > {
    const extractJson = (text: string): Record<string, unknown> | undefined => {
      const fence = text.match(/```+\s*(json)?\s*([\s\S]*?)```/i);
      const raw = fence ? fence[2] : text;
      try {
        const objRaw: unknown = JSON.parse(raw);
        return this.isPlainObject(objRaw) ? objRaw : undefined;
      } catch {
        return undefined;
      }
    };

    const sys = [
      '你是一个MongoDB查询参数修正器。',
      '任务：在保持原查询结构与语义不变的前提下，仅修正不在schema中的字段名',
      '检查对应逻辑和对应字段,包括一些 $字段 的引入也要检查是否在schema中,不是就修改',
      '如果有字段在schema中不存在,并且也找不到类似含义的字段那就去掉,这个可以不保留,权重高',
      '输出严格为JSON，键使用与输入相同的名称。',
    ].join('\n');
    const user = JSON.stringify({
      collection,
      type,
      schema: schemaMap,
      params,
    });
    const ai = await this.agent.runWithMessages({
      config: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: 0.1,
        nonStreaming: true,
        noPostHook: true,
      },
      messages: this.agent.toMessages([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ]),
    });
    const content = (ai as unknown as { content: unknown }).content;

    const obj =
      typeof content === 'string'
        ? extractJson(content)
        : this.isPlainObject(content)
          ? content
          : undefined;
    if (!obj) return undefined;

    const out: any = {
      ...obj,
      ...(obj.params ?? {}),
    };
    console.log(out, JSON.stringify(out));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return out;
  }

  private isAggregateResultInvalid(docs: unknown[]): boolean {
    if (!Array.isArray(docs)) return true;
    if (docs.length === 0) return true;
    if (docs.length === 1) {
      const d = docs[0] as Record<string, unknown>;
      if (this.isPlainObject(d)) {
        const idIsNull = d['_id'] === null || typeof d['_id'] === 'undefined';
        const keys = Object.keys(d).filter((k) => k !== '_id');
        if (keys.length === 0) return true;
        const valuesWeak = keys.every((k) => {
          const v = d[k];
          if (typeof v === 'number') return v === 0 || Number.isNaN(v);
          if (v === null || typeof v === 'undefined') return true;
          if (Array.isArray(v)) return v.length === 0;
          if (this.isPlainObject(v)) return Object.keys(v).length === 0;
          if (typeof v === 'string') return v.trim().length === 0;
          return false;
        });
        if (idIsNull && valuesWeak) return true;
      }
    }
    return false;
  }

  private hasNullDeep(input: unknown): boolean {
    if (input === null) return true;
    if (Array.isArray(input)) {
      for (const it of input) if (this.hasNullDeep(it)) return true;
      return false;
    }
    if (this.isPlainObject(input)) {
      for (const v of Object.values(input)) {
        if (v === null) return true;
        if (this.hasNullDeep(v)) return true;
      }
      return false;
    }
    return false;
  }

  @Post('search')
  async search(
    @Body()
    body: {
      collection: string;
      filter?: Record<string, unknown>;
      projection?: Record<string, 0 | 1>;
      limit?: number;
      sort?: Record<string, 1 | -1>;
      schema?: Record<
        string,
        'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
      >;
      type?:
        | 'find'
        | 'count'
        | 'aggregate'
        | 'distinct'
        | 'min'
        | 'max'
        | 'sum'
        | 'avg';
      pipeline?: Record<string, unknown>[];
      key?: string;
      skip?: number;
      includeTotal?: boolean;
    },
  ): Promise<unknown[]> {
    const {
      collection,
      filter,
      projection,
      limit,
      sort,
      schema,
      type,
      pipeline,
      key,
      skip,
      includeTotal,
    } = body;
    let schemaMap = schema;
    if (!schemaMap) {
      const cache = await readMongoSchemaCache();
      const table =
        cache && Array.isArray(cache.tables)
          ? cache.tables.find((t) => t.name === collection)
          : undefined;
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
        schemaMap = Object.keys(out).length > 0 ? out : undefined;
      }
    }
    if (!schemaMap) {
      throw new BadRequestException({
        error: 'SCHEMA_REQUIRED',
        message: 'No schema found for collection',
        collection,
        original_filter: filter ?? {},
      });
    }
    const col = this.db.collection(collection);
    const finalFilter = await this.fcService.normalizeFilter(
      collection,
      filter ?? {},
      schemaMap,
    );
    const safeLimit = Math.min(
      typeof limit === 'number' && limit > 0 ? limit : 20,
      100,
    );
    const safeSkip = Math.max(0, typeof skip === 'number' ? skip : 0);

    if (type === 'count') {
      const count = await col.countDocuments(finalFilter);
      if (count === 0 && filter && typeof filter === 'object') {
        const corrected = await this.correctParamsWithAI(
          collection,
          'count',
          schemaMap,
          { filter },
        );
        if (corrected?.filter) {
          const cf = await this.fcService.normalizeFilter(
            collection,
            corrected.filter,
            schemaMap,
          );
          const count2 = await col.countDocuments(cf);
          return [{ count: count2 }];
        }
      }
      return [{ count }];
    }

    if (type === 'distinct') {
      let distinctKey = key;
      if (!distinctKey || typeof distinctKey !== 'string') {
        const corrected = await this.correctParamsWithAI(
          collection,
          'distinct',
          schemaMap,
          { filter, key },
        );
        if (corrected?.key) distinctKey = corrected.key;
      }
      if (!distinctKey || typeof distinctKey !== 'string') {
        throw new BadRequestException('Key is required for distinct');
      }
      const values = await col.distinct(distinctKey, finalFilter);
      if (values.length === 0 || this.hasNullDeep(values)) {
        const corrected = await this.correctParamsWithAI(
          collection,
          'distinct',
          schemaMap,
          { filter, key: distinctKey },
        );
        const cf = corrected?.filter
          ? await this.fcService.normalizeFilter(
              collection,
              corrected.filter,
              schemaMap,
            )
          : finalFilter;
        const ck = corrected?.key ?? distinctKey;
        const retry = await col.distinct(ck, cf);
        return retry as unknown[];
      }
      return values as unknown[];
    }

    if (type === 'min' || type === 'max' || type === 'sum' || type === 'avg') {
      let aggKey = key;
      if (!aggKey || typeof aggKey !== 'string') {
        const correctedEarly = await this.correctParamsWithAI(
          collection,
          type,
          schemaMap,
          { filter, key },
        );
        if (correctedEarly?.key) aggKey = correctedEarly.key;
      }
      if (!aggKey || typeof aggKey !== 'string') {
        throw new BadRequestException('Key is required for aggregation');
      }
      const opMap: Record<string, '$min' | '$max' | '$sum' | '$avg'> = {
        min: '$min',
        max: '$max',
        sum: '$sum',
        avg: '$avg',
      };
      const op = opMap[type];
      const stages = [
        { $match: finalFilter },
        { $group: { _id: null, value: { [op]: `$${aggKey}` } } },
      ];
      const docs = await col.aggregate(stages).toArray();
      const value =
        docs.length > 0
          ? (docs[0] as Record<string, unknown>).value
          : undefined;
      if (value === null || typeof value === 'undefined') {
        const corrected = await this.correctParamsWithAI(
          collection,
          type,
          schemaMap,
          { filter, key: aggKey },
        );
        const cf = corrected?.filter
          ? await this.fcService.normalizeFilter(
              collection,
              corrected.filter,
              schemaMap,
            )
          : finalFilter;
        const ck = corrected?.key ?? aggKey;
        const retryDocs = await col
          .aggregate([
            { $match: cf },
            { $group: { _id: null, value: { [op]: `$${ck}` } } },
          ])
          .toArray();
        const retryValue =
          retryDocs.length > 0
            ? (retryDocs[0] as Record<string, unknown>).value
            : undefined;
        return [{ [type]: retryValue }];
      }
      return [{ [type]: value }];
    }

    if (type === 'aggregate') {
      if (!pipeline || !Array.isArray(pipeline)) {
        throw new BadRequestException('Pipeline is required for aggregate');
      }
      const stages = await Promise.all(
        pipeline.map(async (st) => {
          const isObj =
            typeof st === 'object' && st !== null && !Array.isArray(st);
          if (isObj && '$match' in st) {
            const mv = st['$match'];
            if (mv && typeof mv === 'object' && !Array.isArray(mv)) {
              const normalized = await this.fcService.normalizeFilter(
                collection,
                mv as Record<string, unknown>,
                schemaMap,
              );
              return { $match: normalized } as Record<string, unknown>;
            }
          }
          return st;
        }),
      );
      if (safeSkip > 0) stages.push({ $skip: safeSkip });
      stages.push({ $limit: safeLimit });
      const docs = await col.aggregate(stages).toArray();
      if (
        docs.length === 0 ||
        this.isAggregateResultInvalid(docs) ||
        this.hasNullDeep(docs)
      ) {
        const correctedAll = await this.correctParamsWithAI(
          collection,
          'aggregate',
          schemaMap,
          { pipeline },
        );
        if (correctedAll?.pipeline) {
          const normalized = await Promise.all(
            correctedAll.pipeline.map(async (st) => {
              const isObj =
                typeof st === 'object' && st !== null && !Array.isArray(st);
              if (isObj && '$match' in st) {
                const mv = st['$match'];
                if (mv && typeof mv === 'object' && !Array.isArray(mv)) {
                  const normalized = await this.fcService.normalizeFilter(
                    collection,
                    mv as Record<string, unknown>,
                    schemaMap,
                  );
                  return { $match: normalized } as Record<string, unknown>;
                }
              }
              return st;
            }),
          );
          if (safeSkip > 0) normalized.push({ $skip: safeSkip });
          normalized.push({ $limit: safeLimit });
          const retryDocs = await col.aggregate(normalized).toArray();
          return retryDocs as unknown[];
        }
        const fallbackDocs = await col.aggregate(stages).toArray();
        return fallbackDocs as unknown[];
      }
      return docs as unknown[];
    }

    let cursor = col.find(finalFilter, { projection });
    if (typeof sort !== 'undefined') cursor = cursor.sort(sort);
    if (safeSkip > 0) cursor = cursor.skip(safeSkip);
    cursor = cursor.limit(safeLimit);
    const docs = await cursor.toArray();
    if (docs.length === 0 || this.hasNullDeep(docs)) {
      const corrected = await this.correctParamsWithAI(
        collection,
        'find',
        schemaMap,
        { filter, projection, sort },
      );
      if (corrected) {
        const correctedFilter = corrected.filter
          ? await this.fcService.normalizeFilter(
              collection,
              corrected.filter,
              schemaMap,
            )
          : finalFilter;
        let retry = col.find(correctedFilter, {
          projection: corrected.projection ?? projection,
        });
        const finalSort = corrected.sort ?? sort;
        if (typeof finalSort !== 'undefined') retry = retry.sort(finalSort);
        if (safeSkip > 0) retry = retry.skip(safeSkip);
        retry = retry.limit(safeLimit);
        const retryDocs = await retry.toArray();
        if (includeTotal === true) {
          const total = await col.countDocuments(correctedFilter);
          return [{ data: retryDocs, total }];
        }
        return retryDocs as unknown[];
      }
    }
    if (includeTotal === true) {
      const total = await col.countDocuments(finalFilter);
      return [{ data: docs, total }];
    }
    return docs as unknown[];
  }
}
