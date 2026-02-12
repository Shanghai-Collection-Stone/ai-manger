import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { EmbeddingService } from '../../shared/embedding/embedding.service.js';
import type {
  GalleryGroupCreateInput,
  GalleryGroupEntity,
  GalleryGroupSearchResult,
  GalleryGroupUpdateInput,
} from '../entities/gallery-group.entity.js';

@Injectable()
export class GalleryGroupService {
  private readonly groups: Collection<GalleryGroupEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly VECTOR_INDEX_NAME = 'gallery_group_embedding_index';
  private isAtlasAvailable: boolean | null = null;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly embedding: EmbeddingService,
  ) {
    this.groups = db.collection<GalleryGroupEntity>('gallery_groups');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 创建 gallery_groups 所需索引，并初始化自增计数器。
   * @returns {Promise<void>} 无返回值。
   * @throws {Error} 当MongoDB创建索引或写入计数器失败时抛出。
   * @keyword gallery, groups, mongo
   * @since 2026-02-04
   */
  async ensureIndexes(): Promise<void> {
    await this.groups.createIndex({ id: 1 }, { unique: true });
    await this.groups.createIndex({ userId: 1 });
    await this.groups.createIndex({ tags: 1 });
    await this.groups.createIndex({ createdAt: -1 });
    const exists = await this.counters.findOne({ _id: 'gallery_groups' });
    if (!exists)
      await this.counters.insertOne({ _id: 'gallery_groups', seq: 0 });
  }

  /**
   * @description 获取图库组自增ID。
   * @returns {Promise<number>} 下一个可用的自增ID。
   * @throws {Error} 当计数器更新失败时抛出。
   * @keyword gallery, groups, id
   * @since 2026-02-04
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'gallery_groups' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 构造用于生成Embedding的文本（name+description+tags）。
   * @param {Pick<GalleryGroupEntity, 'name'|'description'|'tags'>} input - 组的文本字段。
   * @returns {string} 用于Embedding的拼接文本。
   * @keyword gallery, groups, embedding
   * @since 2026-02-04
   */
  private buildEmbeddingText(input: {
    name: string;
    description?: string;
    tags: string[];
  }): string {
    const parts = [input.name, input.description, ...(input.tags ?? [])];
    return parts
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0)
      .join(' ');
  }

  /**
   * @description 创建图库组（含 embedding 向量）。
   * @param {GalleryGroupCreateInput} input - 创建参数。
   * @returns {Promise<GalleryGroupEntity>} 新建的图库组实体。
   * @throws {Error} 当数据库写入失败或Embedding生成失败时抛出。
   * @keyword gallery, groups, create
   * @since 2026-02-04
   */
  async create(input: GalleryGroupCreateInput): Promise<GalleryGroupEntity> {
    const now = new Date();
    const id = await this.nextId();
    const tags = Array.isArray(input.tags) ? input.tags : [];
    const embeddingText = this.buildEmbeddingText({
      name: input.name,
      description: input.description,
      tags,
    });
    const embedding = await this.embedding.embedText(embeddingText);

    const doc: GalleryGroupEntity = {
      _id: new ObjectId(),
      id,
      userId: input.userId,
      name: input.name,
      description: input.description,
      tags,
      embedding,
      createdAt: now,
      updatedAt: now,
    };
    await this.groups.insertOne(doc);
    return doc;
  }

  /**
   * @description 列出图库组，支持按 userId 与 tag 过滤。
   * @param {string} [userId] - 用户ID。
   * @param {string} [tag] - 标签。
   * @param {number} [limit=50] - 返回条数上限。
   * @returns {Promise<GalleryGroupEntity[]>} 图库组列表。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword gallery, groups, list
   * @since 2026-02-04
   */
  async list(
    userId?: string,
    tag?: string,
    limit = 50,
  ): Promise<GalleryGroupEntity[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
    if (tag) filter.tags = tag;
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    return this.groups
      .find(filter, { projection: { _id: 0 } })
      .sort({ createdAt: -1, id: -1 })
      .limit(lim)
      .toArray();
  }

  /**
   * @description 更新图库组的名称/描述/标签，并重算 embedding。
   * @param {GalleryGroupUpdateInput} input - 更新参数。
   * @returns {Promise<GalleryGroupEntity | null>} 更新后的实体，不存在时返回 null。
   * @throws {Error} 当数据库更新失败或Embedding生成失败时抛出。
   * @keyword gallery, groups, update
   * @since 2026-02-04
   */
  async update(
    input: GalleryGroupUpdateInput,
  ): Promise<GalleryGroupEntity | null> {
    const cur = await this.groups.findOne({ id: input.id });
    if (!cur) return null;

    const name = typeof input.name === 'string' ? input.name : cur.name;
    const description =
      typeof input.description === 'string'
        ? input.description
        : cur.description;
    const tags = Array.isArray(input.tags) ? input.tags : cur.tags;
    const embeddingText = this.buildEmbeddingText({ name, description, tags });
    const embedding = await this.embedding.embedText(embeddingText);

    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string') upd.name = input.name;
    if (typeof input.description === 'string')
      upd.description = input.description;
    if (Array.isArray(input.tags)) upd.tags = input.tags;
    upd.embedding = embedding;

    await this.groups.updateOne({ id: input.id }, { $set: upd });
    const next = await this.groups.findOne(
      { id: input.id },
      { projection: { _id: 0 } },
    );
    return (next as GalleryGroupEntity | null) ?? null;
  }

  /**
   * @description 删除图库组。
   * @param {number} id - 图库组ID。
   * @returns {Promise<{ ok: boolean }>} 删除结果。
   * @throws {Error} 当数据库删除失败时抛出。
   * @keyword gallery, groups, delete
   * @since 2026-02-04
   */
  async remove(id: number): Promise<{ ok: boolean }> {
    await this.groups.deleteOne({ id });
    return { ok: true };
  }

  /**
   * @description 基于文本查询进行向量相似检索，优先使用 Atlas Vector Search，失败回退本地余弦相似度。
   * @param {string} query - 查询文本。
   * @param {string} [userId] - 用户ID过滤。
   * @param {number} [limit=8] - 返回条数。
   * @param {number} [minScore=0.5] - 最小相似度阈值。
   * @returns {Promise<GalleryGroupSearchResult[]>} 相似检索结果。
   * @throws {Error} 当Embedding生成失败且未能回退时抛出。
   * @keyword gallery, groups, vector-search
   * @example
   * const results = await galleryGroupService.searchSimilar('avatar portraits', 'u1', 8, 0.6);
   * @since 2026-02-04
   */
  async searchSimilar(
    query: string,
    userId?: string,
    limit = 8,
    minScore = 0.5,
  ): Promise<GalleryGroupSearchResult[]> {
    const queryEmbedding = await this.embedding.embedText(query);
    if (this.isAtlasAvailable === false) {
      return this.searchSimilarLocal(queryEmbedding, userId, limit, minScore);
    }
    try {
      const filter: Record<string, unknown> = {};
      if (userId) filter.userId = userId;
      const pipe: Record<string, unknown>[] = [
        {
          $vectorSearch: {
            index: this.VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: limit * 10,
            limit: limit * 2,
            ...(Object.keys(filter).length > 0 ? { filter } : {}),
          },
        },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } },
        { $project: { _id: 0 } },
      ];
      const rows = await this.groups
        .aggregate<GalleryGroupEntity & { score: number }>(pipe)
        .toArray();
      this.isAtlasAvailable = true;
      return rows
        .filter((r) => r.score >= minScore)
        .slice(0, limit)
        .map((r) => ({ group: r, score: r.score }));
    } catch {
      if (this.isAtlasAvailable === null) this.isAtlasAvailable = false;
      return this.searchSimilarLocal(queryEmbedding, userId, limit, minScore);
    }
  }

  /**
   * @description 本地相似检索回退：全量拉取后计算余弦相似度并排序。
   * @param {number[]} queryEmbedding - 查询向量。
   * @param {string | undefined} userId - 用户ID过滤。
   * @param {number} limit - 返回条数。
   * @param {number} minScore - 最小相似度阈值。
   * @returns {Promise<GalleryGroupSearchResult[]>} 相似检索结果。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword gallery, groups, cosine
   * @since 2026-02-04
   */
  private async searchSimilarLocal(
    queryEmbedding: number[],
    userId: string | undefined,
    limit: number,
    minScore: number,
  ): Promise<GalleryGroupSearchResult[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
    const rows = await this.groups.find(filter).toArray();
    return rows
      .filter(
        (r): r is GalleryGroupEntity & { embedding: number[] } =>
          Array.isArray(r.embedding) && r.embedding.length > 0,
      )
      .map((group) => ({
        group,
        score: this.embedding.cosineSimilarity(queryEmbedding, group.embedding),
      }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => {
        const any = x.group as unknown as Record<string, unknown>;
        const clean = { ...any };
        delete (clean as { _id?: unknown })._id;
        return {
          group: clean as unknown as GalleryGroupEntity,
          score: x.score,
        };
      });
  }
}
