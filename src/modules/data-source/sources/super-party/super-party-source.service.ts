import { Injectable, Inject } from '@nestjs/common';
import { Db } from 'mongodb';

/**
 * @title 超级派对数据源服务 Super Party Source Service
 * @description 提供超级派对 MongoDB 数据源的核心操作能力。
 * @keywords-cn 超级派对, 查询, 聚合
 * @keywords-en super party, query, aggregate
 */
@Injectable()
export class SuperPartySourceService {
  constructor(@Inject('SP_MONGO_DB') private readonly db: Db) {}

  /**
   * @title 获取集合列表 Get Collections
   */
  async getCollections(): Promise<string[]> {
    const cols = await this.db.listCollections().toArray();
    return cols.map((c) => c.name);
  }

  /**
   * @title 执行查询 Execute Query
   */
  async query(
    collection: string,
    filter: Record<string, unknown> = {},
    options?: {
      projection?: Record<string, 0 | 1>;
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
    },
  ): Promise<Record<string, unknown>[]> {
    const col = this.db.collection(collection);
    let cursor = col.find(filter, { projection: options?.projection });

    if (options?.sort) {
      cursor = cursor.sort(options.sort);
    }
    if (typeof options?.skip === 'number') {
      cursor = cursor.skip(options.skip);
    }
    if (typeof options?.limit === 'number') {
      cursor = cursor.limit(options.limit);
    }

    return cursor.toArray() as Promise<Record<string, unknown>[]>;
  }

  /**
   * @title 执行聚合 Execute Aggregate
   */
  async aggregate(
    collection: string,
    pipeline: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const col = this.db.collection(collection);
    return col.aggregate(pipeline).toArray() as Promise<
      Record<string, unknown>[]
    >;
  }

  /**
   * @title 获取集合 Schema 信息 Get Collection Schema
   */
  async getCollectionSchema(
    collection: string,
    sampleSize = 100,
  ): Promise<{ name: string; type: string }[]> {
    const col = this.db.collection(collection);
    const cursor = col.find({}, { limit: sampleSize });
    const seen: Map<string, string> = new Map();

    for await (const doc of cursor) {
      if (doc && typeof doc === 'object') {
        for (const [k, v] of Object.entries(doc)) {
          const tp = this.inferType(v);
          if (!seen.has(k)) seen.set(k, tp);
        }
      }
    }

    const fields: { name: string; type: string }[] = [];
    for (const [name, type] of seen.entries()) {
      fields.push({ name, type });
    }
    return fields;
  }

  /**
   * @title 获取文档数量 Get Document Count
   */
  async getDocumentCount(
    collection: string,
    filter: Record<string, unknown> = {},
  ): Promise<number> {
    const col = this.db.collection(collection);
    return col.countDocuments(filter);
  }

  private inferType(val: unknown): string {
    if (val === null || typeof val === 'undefined') return 'null';
    if (Array.isArray(val)) return 'array';
    const t = typeof val;
    if (t === 'string' || t === 'number' || t === 'boolean') return t;
    if (val instanceof Date) return 'date';
    if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>;
      if (obj['$oid']) return 'objectId';
      if (obj['$date']) return 'date';
    }
    return 'object';
  }
}
