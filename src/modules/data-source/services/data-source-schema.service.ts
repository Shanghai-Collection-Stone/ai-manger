import { Injectable, Inject } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
import { EmbeddingService } from '../../shared/embedding/embedding.service.js';
import {
  DataSourceSchemaEntity,
  DataSourceSchemaCreateInput,
  DataSourceSchemaSearchResult,
} from '../entities/data-source-schema.entity.js';
import { FieldMeta } from '../types/data-source.types.js';

/**
 * @title 主数据源定义 Main Data Source Definition
 * @description 静态声明主数据源，不需要启动时注册。
 */
export const MAIN_DATA_SOURCE = {
  code: 'main-mongo',
  name: 'AI系统主数据库',
  description:
    'AI Manager 系统主 MongoDB 数据库，包含用户、会话、消息等核心数据',
  moduleRef: 'sources/mongo',
} as const;

/**
 * @title 数据源 Schema 服务 Data Source Schema Service
 * @description 管理数据源 Schema 的 CRUD 和搜索。关键词优先，向量保底。
 * @keywords-cn 数据源Schema, 关键词搜索, 向量搜索
 * @keywords-en data source schema, keyword search, vector search
 */
@Injectable()
export class DataSourceSchemaService {
  private readonly collection: Collection<DataSourceSchemaEntity>;
  private readonly VECTOR_INDEX_NAME = 'data_source_schema_embedding_index';
  private isAtlasAvailable: boolean | null = null; // 缓存 Atlas 可用性检测结果

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.collection = db.collection<DataSourceSchemaEntity>(
      'data_source_schemas',
    );
    void this.ensureIndexes();
  }

  /**
   * @title 组合搜索 Search Schema
   * @description 先用关键词搜索，无结果再用向量搜索（保底）。
   */
  async searchSchema(
    query: string,
    sourceCode: string = MAIN_DATA_SOURCE.code,
    limit = 10,
  ): Promise<DataSourceSchemaSearchResult[]> {
    // 1. 先用关键词搜索
    const keywordResults = await this.searchSchemaByKeywords(
      query,
      sourceCode,
      limit,
    );
    if (keywordResults.length > 0) {
      return keywordResults;
    }

    // 2. 无结果时用向量搜索（保底）
    return this.searchSchemaByVector(query, sourceCode, limit);
  }

  /**
   * @title 跨数据源搜索 Search All Sources
   * @description 搜索所有数据源的 schema，返回结果包含 sourceCode。
   */
  async searchAllSources(
    query: string,
    limit = 10,
  ): Promise<DataSourceSchemaSearchResult[]> {
    const q = String(query).toLowerCase();
    const tokens = q
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      return [];
    }

    // 构建正则匹配条件
    const regexPatterns = tokens.map(
      (t) => new RegExp(this.escapeRegex(t), 'i'),
    );

    // 搜索所有数据源（不限制 sourceCode）
    const results = await this.collection
      .find({
        $or: [
          { keywords: { $in: regexPatterns } },
          {
            collectionName: {
              $regex: tokens.map((t) => this.escapeRegex(t)).join('|'),
              $options: 'i',
            },
          },
          {
            nameCn: {
              $regex: tokens.map((t) => this.escapeRegex(t)).join('|'),
              $options: 'i',
            },
          },
        ],
      })
      .limit(limit * 2) // 获取更多结果以便排序
      .toArray();

    // 计算匹配分数
    return results
      .map((schema) => {
        let score = 0;
        const lowerName = schema.collectionName.toLowerCase();
        const lowerNameCn = (schema.nameCn ?? '').toLowerCase();
        const keywords = (schema.keywords ?? []).map((k) => k.toLowerCase());

        for (const token of tokens) {
          const lowerToken = token.toLowerCase();
          if (lowerName.includes(lowerToken)) score += 3;
          if (lowerNameCn.includes(lowerToken)) score += 2;
          if (keywords.some((k) => k.includes(lowerToken))) score += 1;
        }

        return { schema, score, matchType: 'keyword' as const };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * @title 关键词搜索 Search by Keywords
   * @description 使用关键词进行文本匹配搜索（优先）。
   */
  async searchSchemaByKeywords(
    query: string,
    sourceCode: string = MAIN_DATA_SOURCE.code,
    limit = 10,
  ): Promise<DataSourceSchemaSearchResult[]> {
    const q = String(query).toLowerCase();
    const tokens = q
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      return [];
    }

    // 构建正则匹配条件
    const regexPatterns = tokens.map(
      (t) => new RegExp(this.escapeRegex(t), 'i'),
    );

    const results = await this.collection
      .find({
        sourceCode,
        $or: [
          { keywords: { $in: regexPatterns } },
          {
            collectionName: {
              $regex: tokens.map((t) => this.escapeRegex(t)).join('|'),
              $options: 'i',
            },
          },
          {
            nameCn: {
              $regex: tokens.map((t) => this.escapeRegex(t)).join('|'),
              $options: 'i',
            },
          },
        ],
      })
      .limit(limit)
      .toArray();

    // 计算匹配分数
    return results
      .map((schema) => {
        let score = 0;
        const lowerName = schema.collectionName.toLowerCase();
        const lowerNameCn = (schema.nameCn ?? '').toLowerCase();
        const keywords = (schema.keywords ?? []).map((k) => k.toLowerCase());

        for (const token of tokens) {
          if (lowerName.includes(token)) score += 3;
          if (lowerNameCn.includes(token)) score += 2;
          if (keywords.some((k) => k.includes(token))) score += 1;
        }

        return { schema, score, matchType: 'keyword' as const };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * @title 向量搜索 Search by Vector
   * @description 使用向量相似度搜索（保底机制）。
   */
  async searchSchemaByVector(
    query: string,
    sourceCode: string = MAIN_DATA_SOURCE.code,
    limit = 10,
  ): Promise<DataSourceSchemaSearchResult[]> {
    const queryEmbedding = await this.embeddingService.embedText(query);

    // 如果已知 Atlas 不可用，直接使用本地搜索
    if (this.isAtlasAvailable === false) {
      return this.searchSchemaByVectorLocal(queryEmbedding, sourceCode, limit);
    }

    try {
      // 使用 Atlas Vector Search
      const results = await this.collection
        .aggregate<DataSourceSchemaEntity & { score: number }>([
          {
            $vectorSearch: {
              index: this.VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 10,
              limit,
              filter: { sourceCode },
            },
          },
          {
            $addFields: {
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ])
        .toArray();

      // 标记 Atlas 可用
      this.isAtlasAvailable = true;

      return results.map((r) => ({
        schema: r,
        score: r.score,
        matchType: 'vector' as const,
      }));
    } catch {
      // 检测到 Atlas 不可用，标记并回退到本地余弦相似度
      if (this.isAtlasAvailable === null) {
        console.warn(
          '[DataSourceSchemaService] Atlas Vector Search not available, using local cosine similarity',
        );
        this.isAtlasAvailable = false;
      }
      return this.searchSchemaByVectorLocal(queryEmbedding, sourceCode, limit);
    }
  }

  /**
   * @title 本地向量搜索 Local Vector Search
   * @description 在应用层计算余弦相似度（备用方案）。
   */
  private async searchSchemaByVectorLocal(
    queryEmbedding: number[],
    sourceCode: string,
    limit: number,
  ): Promise<DataSourceSchemaSearchResult[]> {
    const allSchemas = await this.collection.find({ sourceCode }).toArray();

    const scored = allSchemas
      .filter(
        (schema): schema is DataSourceSchemaEntity & { embedding: number[] } =>
          Array.isArray(schema.embedding) && schema.embedding.length > 0,
      )
      .map((schema) => ({
        schema,
        score: this.embeddingService.cosineSimilarity(
          queryEmbedding,
          schema.embedding,
        ),
        matchType: 'vector' as const,
      }));

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * @title 创建或更新 Schema Upsert Schema
   * @description 如果存在则更新，否则创建新的。
   */
  async upsertSchema(
    input: DataSourceSchemaCreateInput,
  ): Promise<DataSourceSchemaEntity> {
    const now = new Date();

    // 生成关键词（如果未提供）
    const keywords =
      input.keywords ??
      this.generateKeywords(input.collectionName, input.nameCn);

    // 生成向量嵌入（可选，失败时继续）
    let embedding: number[] = [];
    try {
      const textForEmbedding = [
        input.collectionName,
        input.nameCn ?? '',
        ...keywords,
        ...input.fields.map(
          (f) => `${f.name} ${f.nameCn ?? ''} ${f.description ?? ''}`,
        ),
      ].join(' ');
      embedding = await this.embeddingService.embedText(textForEmbedding);
    } catch (error) {
      console.warn(
        `[DataSourceSchemaService] Failed to generate embedding for ${input.collectionName}, using keyword search only:`,
        error instanceof Error ? error.message : error,
      );
    }

    const existing = await this.collection.findOne({
      sourceCode: input.sourceCode,
      collectionName: input.collectionName,
    });

    if (existing) {
      // 更新
      const result = await this.collection.findOneAndUpdate(
        { _id: existing._id },
        {
          $set: {
            nameCn: input.nameCn,
            keywords,
            fields: input.fields,
            embedding,
            version: existing.version + 1,
            updatedAt: now,
          },
        },
        { returnDocument: 'after' },
      );
      return result!;
    } else {
      // 创建
      const entity: DataSourceSchemaEntity = {
        _id: new ObjectId(),
        sourceCode: input.sourceCode,
        collectionName: input.collectionName,
        nameCn: input.nameCn,
        keywords,
        fields: input.fields,
        embedding,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.collection.insertOne(entity);
      return entity;
    }
  }

  /**
   * @title 生成 Schema Generate Schema for Source
   * @description 从数据源采样生成 Schema 并存储。
   */
  async generateSchemaForCollection(
    collectionName: string,
    sourceCode: string = MAIN_DATA_SOURCE.code,
    sampleSize = 100,
  ): Promise<DataSourceSchemaEntity> {
    console.log(
      `[DataSourceSchemaService] Generating schema for ${collectionName}...`,
    );

    const col = this.db.collection(collectionName);
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

    const fields: FieldMeta[] = [];
    for (const [name, type] of seen.entries()) {
      fields.push({ name, type });
    }

    return this.upsertSchema({
      sourceCode,
      collectionName,
      fields,
    });
  }

  /**
   * @title 批量生成所有 Schema Generate All Schemas
   * @description 为数据源的所有集合生成 Schema。
   */
  async generateAllSchemas(
    sourceCode: string = MAIN_DATA_SOURCE.code,
  ): Promise<number> {
    const collections = await this.db.listCollections().toArray();
    let count = 0;

    for (const col of collections) {
      if (typeof col.name === 'string' && !col.name.startsWith('system.')) {
        await this.generateSchemaForCollection(col.name, sourceCode);
        count++;
      }
    }

    console.log(
      `[DataSourceSchemaService] Generated ${count} schemas for ${sourceCode}`,
    );
    return count;
  }

  /**
   * @title 清除 Schema Clear Schema for Source
   * @description 清除指定数据源的所有 Schema。
   */
  async clearSchemaForSource(sourceCode: string): Promise<number> {
    const result = await this.collection.deleteMany({ sourceCode });
    console.log(
      `[DataSourceSchemaService] Cleared ${result.deletedCount} schemas for ${sourceCode}`,
    );
    return result.deletedCount;
  }

  /**
   * @title 列出所有集合 List Collections
   * @description 返回数据库中的所有集合名称。
   */
  async listCollections(): Promise<string[]> {
    const collections = await this.db.listCollections().toArray();
    return collections
      .map((c) => c.name)
      .filter(
        (name) => typeof name === 'string' && !name.startsWith('system.'),
      );
  }

  /**
   * @title 获取或生成 Schema Get or Generate Schema
   * @description 搜索 Schema，如果不存在则自动生成。
   */
  async getOrGenerateSchema(
    query: string,
    sourceCode: string = MAIN_DATA_SOURCE.code,
    limit = 10,
  ): Promise<DataSourceSchemaSearchResult[]> {
    // 1. 先搜索
    let results = await this.searchSchema(query, sourceCode, limit);

    // 2. 如果没有结果，尝试生成所有 Schema 并重新搜索
    if (results.length === 0) {
      console.log('[DataSourceSchemaService] No schemas found, generating...');
      await this.generateAllSchemas(sourceCode);
      results = await this.searchSchema(query, sourceCode, limit);
    }

    return results;
  }

  /**
   * @title 生成关键词 Generate Keywords
   * @description 从集合名和中文名自动生成中英文关键词。
   */
  private generateKeywords(collectionName: string, nameCn?: string): string[] {
    const keywords: string[] = [];

    // 英文关键词：拆分驼峰和下划线
    const englishTokens = collectionName
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[_\-\s]+/)
      .filter((t) => t.length > 1);
    keywords.push(...englishTokens);
    keywords.push(collectionName.toLowerCase());

    // 中文关键词
    if (nameCn) {
      keywords.push(nameCn);
      // 拆分中文词（简单拆分2-3字组合）
      for (let i = 0; i < nameCn.length - 1; i++) {
        keywords.push(nameCn.slice(i, i + 2));
        if (i < nameCn.length - 2) {
          keywords.push(nameCn.slice(i, i + 3));
        }
      }
    }

    return [...new Set(keywords)];
  }

  /**
   * @title 推断类型 Infer Type
   */
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

  /**
   * @title 转义正则特殊字符 Escape Regex Characters
   */
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * @title 确保索引 Ensure Indexes
   */
  private async ensureIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ sourceCode: 1 });
      await this.collection.createIndex(
        { sourceCode: 1, collectionName: 1 },
        { unique: true },
      );
      await this.collection.createIndex({ keywords: 1 });
      // 创建文本索引用于全文搜索
      await this.collection.createIndex(
        { collectionName: 'text', nameCn: 'text', keywords: 'text' },
        { name: 'schema_text_index' },
      );
    } catch (e) {
      // 索引可能已存在
      void e;
    }
  }
}
