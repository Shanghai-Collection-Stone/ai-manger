import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { EmbeddingService } from '../../shared/embedding/embedding.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
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
  private readonly DYNAMIC_COVER_GROUP_NAME = '动态封面';
  private readonly DYNAMIC_COLLAGE_GROUP_NAME = '动态拼图';
  private readonly DYNAMIC_COVER_ID = 'default_group_image';
  private readonly DYNAMIC_COLLAGE_ID = 'default_collage_image';
  private readonly LEGACY_COLLAGE_GROUP_NAME = '拼图封面';
  private isAtlasAvailable: boolean | null = null;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly embedding: EmbeddingService,
    private readonly adminService: AdminService,
  ) {
    this.groups = db.collection<GalleryGroupEntity>('gallery_groups');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 解析默认 embedding runtime 配置（来源 ai_providers 表的 em 记录）。
   * @returns {Promise<{ providerCode?: string; model?: string; apiKey?: string; baseUrl?: string }>} 配置。
   * @keyword-en resolve default embedding config from provider table
   */
  private async resolveDefaultEmbeddingConfig(): Promise<{
    providerCode?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  }> {
    const runtime = await this.adminService.getDefaultEmbeddingRuntime();
    if (!runtime) {
      return { providerCode: 'gemini', model: 'gemini-embedding-001' };
    }
    return {
      providerCode: runtime.providerCode,
      model: runtime.model,
      apiKey: runtime.apiKey,
      baseUrl: runtime.baseUrl,
    };
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
    // 租户隔离索引
    await this.groups.createIndex({ scope: 1, tenantId: 1, userId: 1 });
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
   * @description 安全生成文本向量，失败时回退零向量，避免分组创建中断。
   * @param {string} text - 待向量化文本。
   * @returns {Promise<number[]>} 向量数组。
   * @keyword-en safe embed text with fallback
   */
  private async safeEmbedText(text: string): Promise<number[]> {
    try {
      const config = await this.resolveDefaultEmbeddingConfig();
      const vec = await this.embedding.embedText(text, config);
      if (Array.isArray(vec) && vec.length > 0) return vec;
    } catch (error) {
      console.warn(
        '[GalleryGroupService.safeEmbedText] embedText failed, fallback to zero vector:',
        error,
      );
    }
    return new Array<number>(768).fill(0);
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
    const embedding = await this.safeEmbedText(embeddingText);

    const doc: GalleryGroupEntity = {
      _id: new ObjectId(),
      id,
      userId: input.userId,
      scope: (input.scope ?? 'tenant') as 'platform' | 'tenant',
      tenantId: input.tenantId,
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
   * @description 构建租户过滤条件
   * @param {string | undefined} userId - 用户ID
   * @param {string | undefined} tenantId - 租户ID
   * @returns {Record<string, unknown>} MongoDB filter 对象
   * @keyword-en build tenant filter
   * @since 2026-03-24
   */
  private buildTenantFilter(
    userId: string | undefined,
    tenantId?: string,
  ): Record<string, unknown> {
    const currentTenantId = tenantId?.trim();
    const base: Record<string, unknown> = {};
    if (userId) base.userId = userId;
    // 无 tenantId 时（母平台）：返回 tenantId 为空/null/不存在的母平台数据
    if (!currentTenantId) {
      return {
        ...base,
        $or: [
          { tenantId: { $exists: false } },
          { tenantId: null },
          { tenantId: '' },
        ],
      };
    }
    // 有 tenantId 时：只返回匹配该 tenantId 的租户数据
    return {
      ...base,
      tenantId: currentTenantId,
    };
  }

  /**
   * @description 按用户ID和租户隔离查找名为指定名称的图库组。
   * @param {string} name - 组名称。
   * @param {string | undefined} userId - 用户ID。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<GalleryGroupEntity | null>} 找到的组或null。
   * @keyword gallery, groups, find-by-name
   * @since 2026-03-28
   */
  async findByName(
    name: string,
    userId: string | undefined,
    tenantId?: string,
  ): Promise<GalleryGroupEntity | null> {
    const filter = this.buildTenantFilter(userId, tenantId);
    filter.name = name;
    return this.groups.findOne(filter, { projection: { _id: 0 } }) as Promise<GalleryGroupEntity | null>;
  }

  /**
   * @description 创建动态生成图片默认分组（封面/拼图）。
   * @param {object} input - 分组创建参数。
   * @returns {Promise<GalleryGroupEntity>} 新建分组实体。
   * @keyword-en create default generated image group
   */
  private async createGeneratedGroup(input: {
    name: string;
    description: string;
    tags: string[];
    userId?: string;
    tenantId?: string;
  }): Promise<GalleryGroupEntity> {
    const now = new Date();
    const id = await this.nextId();
    const embeddingText = this.buildEmbeddingText({
      name: input.name,
      description: input.description,
      tags: input.tags,
    });
    const embedding = await this.safeEmbedText(embeddingText);

    const doc: GalleryGroupEntity = {
      _id: new ObjectId(),
      id,
      userId: input.userId ?? 'default',
      scope: 'tenant',
      tenantId: input.tenantId,
      name: input.name,
      description: input.description,
      tags: input.tags,
      embedding,
      createdAt: now,
      updatedAt: now,
    };
    await this.groups.insertOne(doc);
    return doc;
  }

  /**
   * @description 查找或创建“动态封面”默认分组。
   * @param {string | undefined} userId - 用户ID。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<GalleryGroupEntity>} 找到或新建的分组。
   * @keyword-en find or create dynamic cover group
   */
  async findOrCreateDynamicCoverGroup(
    userId: string | undefined,
    tenantId?: string,
  ): Promise<GalleryGroupEntity> {
    // First check by name (with tenant filter)
    const existing = await this.findByName(
      this.DYNAMIC_COVER_GROUP_NAME,
      userId,
      tenantId,
    );
    if (existing) return existing;

    // Also check by fixed ID to avoid duplicate key error
    const byId = await this.groups.findOne(
      { id: this.DYNAMIC_COVER_ID },
      { projection: { _id: 0 } },
    );
    if (byId) return byId as GalleryGroupEntity;

    // Use fixed string ID for dynamic cover group
    const now = new Date();
    const doc: GalleryGroupEntity = {
      _id: new ObjectId(),
      id: this.DYNAMIC_COVER_ID,
      userId: userId ?? 'default',
      scope: 'tenant',
      tenantId,
      name: this.DYNAMIC_COVER_GROUP_NAME,
      description: 'auto generated cover image',
      tags: ['封面', '自动生成', '动态封面'],
      embedding: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.groups.insertOne(doc);
    return doc;
  }

  /**
   * @description 查找或创建”default collage image”默认分组；若命中历史”拼图封面”组则自动升级为新名称。
   * @param {string | undefined} userId - 用户ID。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<GalleryGroupEntity>} 找到或新建的分组。
   * @keyword-en find or create dynamic collage group
   */
  async findOrCreateDynamicCollageGroup(
    userId: string | undefined,
    tenantId?: string,
  ): Promise<GalleryGroupEntity> {
    // First check by name (with tenant filter)
    const existing = await this.findByName(
      this.DYNAMIC_COLLAGE_GROUP_NAME,
      userId,
      tenantId,
    );
    if (existing) return existing;

    // Also check by fixed ID to avoid duplicate key error
    const byId = await this.groups.findOne(
      { id: this.DYNAMIC_COLLAGE_ID },
      { projection: { _id: 0 } },
    );
    if (byId) return byId as GalleryGroupEntity;

    const legacy = await this.findByName(
      this.LEGACY_COLLAGE_GROUP_NAME,
      userId,
      tenantId,
    );
    if (legacy) {
      await this.groups.updateOne(
        { id: legacy.id },
        {
          $set: {
            id: this.DYNAMIC_COLLAGE_ID,
            name: this.DYNAMIC_COLLAGE_GROUP_NAME,
            description: '自动生成的动态拼图图片',
            tags: ['拼图', '自动生成', '动态拼图'],
            updatedAt: new Date(),
          },
        },
      );
      const upgraded = await this.groups.findOne(
        { id: this.DYNAMIC_COLLAGE_ID },
        { projection: { _id: 0 } },
      );
      if (upgraded) return upgraded as GalleryGroupEntity;
    }

    // Use fixed string ID for dynamic collage group
    const now = new Date();
    const doc: GalleryGroupEntity = {
      _id: new ObjectId(),
      id: this.DYNAMIC_COLLAGE_ID,
      userId: userId ?? 'default',
      scope: 'tenant',
      tenantId,
      name: this.DYNAMIC_COLLAGE_GROUP_NAME,
      description: '自动生成的动态拼图图片',
      tags: ['拼图', '自动生成', '动态拼图'],
      embedding: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.groups.insertOne(doc);
    return doc;
  }

  /**
   * @description 确保默认动态分组存在（动态封面、动态拼图）。
   * @param {string | undefined} userId - 用户ID。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<{ coverGroup: GalleryGroupEntity; collageGroup: GalleryGroupEntity }>} 默认分组。
   * @keyword-en ensure default generated groups
   */
  async ensureDefaultDynamicGroups(
    userId: string | undefined,
    tenantId?: string,
  ): Promise<{ coverGroup: GalleryGroupEntity; collageGroup: GalleryGroupEntity }> {
    const [coverGroup, collageGroup] = await Promise.all([
      this.findOrCreateDynamicCoverGroup(userId, tenantId),
      this.findOrCreateDynamicCollageGroup(userId, tenantId),
    ]);
    return { coverGroup, collageGroup };
  }

  /**
   * @description 获取默认动态分组 ID（自动确保存在）。
   * @param {string | undefined} userId - 用户ID。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<number[]>} 默认分组 ID 数组。
   * @keyword-en get default generated group ids
   */
  async getDefaultDynamicGroupIds(
    userId: string | undefined,
    tenantId?: string,
  ): Promise<number[]> {
    const { coverGroup, collageGroup } = await this.ensureDefaultDynamicGroups(
      userId,
      tenantId,
    );
    return Array.from(
      new Set(
        [coverGroup.id, collageGroup.id].filter(
          (id): id is number => typeof id === 'number' && Number.isFinite(id),
        ),
      ),
    );
  }

  /**
   * @description 兼容旧接口：查找或创建“动态拼图”默认分组。
   * @param {string | undefined} userId - 用户ID。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<GalleryGroupEntity>} 找到或新建的组。
   * @keyword-en find or create collage group (compat)
   * @since 2026-03-28
   */
  async findOrCreateCollageGroup(
    userId: string | undefined,
    tenantId?: string,
  ): Promise<GalleryGroupEntity> {
    return this.findOrCreateDynamicCollageGroup(userId, tenantId);
  }

  /**
   * @description 按租户可见性列出图库组（租户隔离）
   * @param {string | undefined} userId - 用户ID
   * @param {string | undefined} tenantId - 租户ID
   * @param {string} [tag] - 标签
   * @param {number} [limit=50] - 返回条数上限
   * @returns {Promise<GalleryGroupEntity[]>} 图库组列表
   * @keyword-en list gallery groups with tenant filter
   * @since 2026-03-24
   */
  async listAccessibleGroups(
    userId: string | undefined,
    tenantId?: string,
    tag?: string,
    limit = 50,
  ): Promise<GalleryGroupEntity[]> {
    const filter = this.buildTenantFilter(userId, tenantId);
    if (tag) filter.tags = tag;
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    return this.groups
      .find(filter, { projection: { _id: 0 } })
      .sort({ createdAt: -1, id: -1 })
      .limit(lim)
      .toArray();
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
   * @deprecated 使用 listAccessibleGroups 代替以支持租户隔离
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
    const embedding = await this.safeEmbedText(embeddingText);

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
   * @description 基于文本查询进行向量相似检索，优先使用 Atlas Vector Search，失败回退本地余弦相似度（租户隔离）。
   * @param {string} query - 查询文本。
   * @param {string} [userId] - 用户ID过滤。
   * @param {string} [tenantId] - 租户ID（用于租户隔离）。
   * @param {number} [limit=8] - 返回条数。
   * @param {number} [minScore=0.5] - 最小相似度阈值。
   * @returns {Promise<GalleryGroupSearchResult[]>} 相似检索结果。
   * @throws {Error} 当Embedding生成失败且未能回退时抛出。
   * @keyword gallery, groups, vector-search
   * @example
   * const results = await galleryGroupService.searchSimilar('avatar portraits', 'u1', 'tenant1', 8, 0.6);
   * @since 2026-02-04
   */
  async searchSimilar(
    query: string,
    userId?: string,
    tenantId?: string,
    limit = 8,
    minScore = 0.5,
  ): Promise<GalleryGroupSearchResult[]> {
    const embeddingConfig = await this.resolveDefaultEmbeddingConfig();
    const queryEmbedding = await this.embedding.embedText(query, embeddingConfig);
    if (this.isAtlasAvailable === false) {
      return this.searchSimilarLocal(queryEmbedding, userId, tenantId, limit, minScore);
    }
    try {
      const filter = this.buildTenantFilter(userId, tenantId);
      const pipe: Record<string, unknown>[] = [
        {
          $vectorSearch: {
            index: this.VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: limit * 10,
            limit: limit * 2,
            filter,
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
      return this.searchSimilarLocal(queryEmbedding, userId, tenantId, limit, minScore);
    }
  }

  /**
   * @description 本地相似检索回退：全量拉取后计算余弦相似度并排序（租户隔离）。
   * @param {number[]} queryEmbedding - 查询向量。
   * @param {string | undefined} userId - 用户ID过滤。
   * @param {string | undefined} tenantId - 租户ID过滤。
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
    tenantId: string | undefined,
    limit: number,
    minScore: number,
  ): Promise<GalleryGroupSearchResult[]> {
    const filter = this.buildTenantFilter(userId, tenantId);
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
