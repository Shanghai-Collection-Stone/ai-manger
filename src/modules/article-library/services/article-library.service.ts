import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  ArticleLibraryCreateInput,
  ArticleLibraryEntity,
  ArticleLibraryPushConfig,
  ArticleLibraryScope,
  ArticleLibraryStats,
  ArticleLibraryUpdateInput,
  ArticlePublishStatus,
} from '../entities/article-library.entity.js';
import type { ArticleEntity } from '../entities/article.entity.js';

/**
 * @title 文章库容器服务 Article Library Container Service
 * @description 管理文章库（容器）的增删改查与统计，不负责具体文章文档操作。
 * @keyword-en article library container service crud stats
 */
@Injectable()
export class ArticleLibraryService {
  private readonly libraries: Collection<ArticleLibraryEntity>;
  private readonly articles: Collection<ArticleEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly COUNTER_KEY = 'article_libraries';

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.libraries = db.collection<ArticleLibraryEntity>('article_libraries');
    this.articles = db.collection<ArticleEntity>('articles');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 创建集合索引与计数器
   * @keyword-en article library ensure indexes
   */
  async ensureIndexes(): Promise<void> {
    await this.libraries.createIndex({ id: 1 }, { unique: true });
    await this.libraries.createIndex({ scope: 1, tenantId: 1, userId: 1 });
    await this.libraries.createIndex({ scope: 1, tenantId: 1, type: 1 });
    await this.libraries.createIndex({ createdAt: -1 });
    const exists = await this.counters.findOne({ _id: this.COUNTER_KEY });
    if (!exists)
      await this.counters.insertOne({ _id: this.COUNTER_KEY, seq: 0 });
  }

  /**
   * @description 生成下一个文章库自增 ID
   * @returns {Promise<number>} 下一个可用 ID
   * @keyword-en article library next id
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: this.COUNTER_KEY },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 规范化 pushConfig（补默认值：statusFilter 默认仅未发布）
   * @keyword-en article library normalize push config
   */
  private normalizePushConfig(
    input?: Partial<ArticleLibraryPushConfig>,
  ): ArticleLibraryPushConfig {
    const validStatuses: ArticlePublishStatus[] = ['unpublished', 'published'];
    const rawFilter = Array.isArray(input?.statusFilter)
      ? (input!.statusFilter as string[]).filter((s): s is ArticlePublishStatus =>
          validStatuses.includes(s as ArticlePublishStatus),
        )
      : [];
    const statusFilter: ArticlePublishStatus[] =
      rawFilter.length > 0 ? Array.from(new Set(rawFilter)) : ['unpublished'];
    const pushUrl =
      typeof input?.pushUrl === 'string' ? input!.pushUrl.trim() || undefined : undefined;
    return { statusFilter, pushUrl };
  }

  /**
   * @description 创建文章库
   * @keyword-en article library create
   */
  async create(input: ArticleLibraryCreateInput): Promise<ArticleLibraryEntity> {
    const now = new Date();
    const scope: ArticleLibraryScope = input.scope ?? 'tenant';
    const id = await this.nextId();
    const doc: ArticleLibraryEntity = {
      _id: new ObjectId(),
      id,
      userId: input.userId,
      scope,
      tenantId: scope === 'tenant' ? input.tenantId : undefined,
      name: input.name.trim(),
      type: String(input.type ?? '').trim(),
      pushConfig: this.normalizePushConfig(input.pushConfig),
      createdAt: now,
      updatedAt: now,
    };
    await this.libraries.insertOne(doc);
    return doc;
  }

  /**
   * @description 按 ID 获取文章库（按 tenantId 过滤）
   * @keyword-en article library get by id
   */
  async get(
    id: number,
    tenantId?: string,
  ): Promise<ArticleLibraryEntity | null> {
    const filter: Record<string, unknown> = { id };
    if (tenantId) filter.tenantId = tenantId;
    return this.libraries.findOne(filter);
  }

  /**
   * @description 列出文章库（按 tenant/user 作用域）
   * @keyword-en article library list
   */
  async list(params: {
    tenantId?: string;
    userId?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ArticleLibraryEntity[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (params.tenantId) filter.tenantId = params.tenantId;
    if (params.userId) filter.userId = params.userId;
    if (params.type && params.type.trim().length > 0)
      filter.type = params.type.trim();
    const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
    const offset = Math.max(0, params.offset ?? 0);
    const [items, total] = await Promise.all([
      this.libraries
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.libraries.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * @description 更新文章库（名称 / 类型 / 推送配置）
   * @keyword-en article library update
   */
  async update(
    input: ArticleLibraryUpdateInput,
  ): Promise<ArticleLibraryEntity | null> {
    const existing = await this.get(input.id, input.tenantId);
    if (!existing) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim().length > 0)
      set.name = input.name.trim();
    if (typeof input.type === 'string') set.type = input.type.trim();
    if (input.pushConfig !== undefined) {
      set.pushConfig = this.normalizePushConfig({
        ...existing.pushConfig,
        ...input.pushConfig,
      });
    }
    const res = await this.libraries.findOneAndUpdate(
      { id: input.id },
      { $set: set },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除文章库（并级联删除所属文章）
   * @keyword-en article library delete cascade articles
   */
  async delete(id: number, tenantId?: string): Promise<boolean> {
    const existing = await this.get(id, tenantId);
    if (!existing) return false;
    await this.articles.deleteMany({ libraryId: id });
    const res = await this.libraries.deleteOne({ id });
    return res.deletedCount === 1;
  }

  /**
   * @description 统计文章库内各状态数量
   * @keyword-en article library stats aggregate by status
   */
  async getStats(libraryId: number): Promise<ArticleLibraryStats> {
    const cursor = this.articles.aggregate<{
      _id: ArticlePublishStatus;
      count: number;
    }>([
      { $match: { libraryId } },
      { $group: { _id: '$publishStatus', count: { $sum: 1 } } },
    ]);
    const rows = await cursor.toArray();
    let publishedCount = 0;
    let unpublishedCount = 0;
    for (const row of rows) {
      if (row._id === 'published') publishedCount = row.count;
      else if (row._id === 'unpublished') unpublishedCount = row.count;
    }
    return {
      total: publishedCount + unpublishedCount,
      publishedCount,
      unpublishedCount,
    };
  }

  /**
   * @description 取文章库缩略图所需的前 N 篇文章首图
   * @keyword-en article library thumbnail sources by first image
   */
  async getThumbnailImages(
    libraryId: number,
    limit = 4,
  ): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(limit, 9));
    const docs = await this.articles
      .find(
        { libraryId, imageUrls: { $exists: true, $ne: [] } },
        { projection: { imageUrls: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .toArray();
    return docs
      .map((d) => (Array.isArray(d.imageUrls) ? d.imageUrls[0] : undefined))
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
  }
}
