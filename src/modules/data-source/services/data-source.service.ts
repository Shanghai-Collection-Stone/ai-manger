import { Injectable, Inject } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
import { EmbeddingService } from '../../shared/embedding/embedding.service.js';
import {
  DataSourceEntity,
  DataSourceCreateInput,
  DataSourceSearchResult,
} from '../entities/data-source.entity.js';

/**
 * @title 数据源服务 Data Source Service
 * @description 管理数据源的 CRUD 操作和向量搜索。
 * @keywords-cn 数据源服务, CRUD, 向量搜索
 * @keywords-en data source service, CRUD, vector search
 */
@Injectable()
export class DataSourceService {
  private readonly collection: Collection<DataSourceEntity>;
  private readonly VECTOR_INDEX_NAME = 'data_source_embedding_index';
  private isAtlasAvailable: boolean | null = null; // 缓存 Atlas 可用性检测结果

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.collection = db.collection<DataSourceEntity>('data_sources');
    void this.ensureIndexes();
  }

  /**
   * @title 注册数据源 Register Source
   * @description 创建新数据源并生成向量嵌入。
   * @keywords-cn 注册, 创建
   * @keywords-en register, create
   */
  async registerSource(
    input: DataSourceCreateInput,
  ): Promise<DataSourceEntity> {
    const now = new Date();

    // 检查是否已存在
    const existing = await this.collection.findOne({ code: input.code });
    if (existing) {
      throw new Error(`Data source with code '${input.code}' already exists`);
    }

    // 生成向量嵌入
    const embedding = await this.embeddingService.embedText(input.description);

    const entity: DataSourceEntity = {
      _id: new ObjectId(),
      code: input.code,
      name: input.name,
      description: input.description,
      embedding,
      moduleRef: input.moduleRef,
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.collection.insertOne(entity);
    return entity;
  }

  /**
   * @title 按 code 查找 Find By Code
   * @description 根据唯一标识查找数据源。
   * @keywords-cn 查找, code
   * @keywords-en find, code
   */
  async findByCode(code: string): Promise<DataSourceEntity | null> {
    return this.collection.findOne({ code });
  }

  /**
   * @title 获取所有数据源 Get All Sources
   * @description 返回所有已注册的数据源。
   * @keywords-cn 获取全部, 列表
   * @keywords-en get all, list
   */
  async getAllSources(): Promise<DataSourceEntity[]> {
    return this.collection.find({ status: 'active' }).toArray();
  }

  /**
   * @title 向量相似度搜索 Search Similar
   * @description 使用 Atlas Vector Search 进行相似度搜索。
   * @keywords-cn 向量搜索, 相似度
   * @keywords-en vector search, similarity
   */
  async searchSimilar(
    query: string,
    limit = 5,
  ): Promise<DataSourceSearchResult[]> {
    // 生成查询向量
    const queryEmbedding = await this.embeddingService.embedText(query);

    // 如果已知 Atlas 不可用，直接使用本地搜索
    if (this.isAtlasAvailable === false) {
      return this.searchSimilarLocal(queryEmbedding, limit);
    }

    try {
      // 使用 Atlas Vector Search
      const results = await this.collection
        .aggregate<DataSourceEntity & { score: number }>([
          {
            $vectorSearch: {
              index: this.VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 10,
              limit,
            },
          },
          {
            $addFields: {
              score: { $meta: 'vectorSearchScore' },
            },
          },
          {
            $match: { status: 'active' },
          },
        ])
        .toArray();

      // 标记 Atlas 可用
      this.isAtlasAvailable = true;

      return results.map((r) => ({
        source: r,
        score: r.score,
      }));
    } catch {
      // 检测到 Atlas 不可用，标记并回退到本地余弦相似度
      if (this.isAtlasAvailable === null) {
        console.warn(
          '[DataSourceService] Atlas Vector Search not available, using local cosine similarity',
        );
        this.isAtlasAvailable = false;
      }
      return this.searchSimilarLocal(queryEmbedding, limit);
    }
  }

  /**
   * @title 本地余弦相似度搜索 Local Cosine Similarity Search
   * @description 在应用层计算余弦相似度（备用方案）。
   */
  private async searchSimilarLocal(
    queryEmbedding: number[],
    limit: number,
  ): Promise<DataSourceSearchResult[]> {
    const allSources = await this.collection
      .find({ status: 'active' })
      .toArray();

    const scored = allSources
      .filter(
        (source): source is DataSourceEntity & { embedding: number[] } =>
          Array.isArray(source.embedding) && source.embedding.length > 0,
      )
      .map((source) => ({
        source,
        score: this.embeddingService.cosineSimilarity(
          queryEmbedding,
          source.embedding,
        ),
      }));

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * @title 更新描述 Update Description
   * @description 更新数据源描述并重新生成向量。
   * @keywords-cn 更新描述, 重新向量化
   * @keywords-en update description, re-embed
   */
  async updateDescription(
    code: string,
    description: string,
  ): Promise<DataSourceEntity | null> {
    const embedding = await this.embeddingService.embedText(description);
    const now = new Date();

    const result = await this.collection.findOneAndUpdate(
      { code },
      {
        $set: {
          description,
          embedding,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );

    return result ?? null;
  }

  /**
   * @title 更新状态 Update Status
   * @description 更新数据源状态。
   */
  async updateStatus(
    code: string,
    status: 'active' | 'inactive',
  ): Promise<DataSourceEntity | null> {
    const now = new Date();

    const result = await this.collection.findOneAndUpdate(
      { code },
      { $set: { status, updatedAt: now } },
      { returnDocument: 'after' },
    );

    return result ?? null;
  }

  /**
   * @title 删除数据源 Delete Source
   * @description 删除指定的数据源。
   */
  async deleteSource(code: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ code });
    return result.deletedCount > 0;
  }

  /**
   * @title 确保索引 Ensure Indexes
   * @description 创建必要的数据库索引。
   */
  private async ensureIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ code: 1 }, { unique: true });
      await this.collection.createIndex({ status: 1 });
      await this.collection.createIndex({ moduleRef: 1 });
    } catch {
      // ignore
    }
  }
}
