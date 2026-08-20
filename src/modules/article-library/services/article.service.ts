import { Inject, Injectable, Logger } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import type {
  ArticleCreateInput,
  ArticleEntity,
  ArticleLeaseResult,
  ArticleUpdateInput,
} from '../entities/article.entity.js';
import type { ArticlePublishStatus } from '../entities/article-library.entity.js';

/**
 * @title 文章服务 Article Service
 * @description 文章入库、列表、状态更新与队列式顺序领取（CAS + 15 分钟租约）。
 * @keyword-en article service put list update lease fifo queue
 */
@Injectable()
export class ArticleService {
  private readonly logger = new Logger(ArticleService.name);
  private readonly articles: Collection<ArticleEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly COUNTER_KEY = 'articles';
  /** 租约持续时间：15 分钟 */
  private readonly LEASE_DURATION_MS = 15 * 60 * 1000;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.articles = db.collection<ArticleEntity>('articles');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 建立 FIFO 领取、状态过滤、租约扫描及来源选题查询索引。
   * @keyword-cn 文章入库, 计数器校准
   * @keyword-en article-id-counter
   */
  async ensureIndexes(): Promise<void> {
    await this.articles.createIndex({ id: 1 }, { unique: true });
    await this.articles.createIndex({ libraryId: 1, createdAt: 1 });
    await this.articles.createIndex({
      tenantId: 1,
      userId: 1,
      source: 1,
      'meta.xhsTopicId': 1,
    });
    await this.articles.createIndex({
      libraryId: 1,
      publishStatus: 1,
      lockExpireAt: 1,
      createdAt: 1,
    });
    await this.ensureCounterAtLeast(await this.getMaxArticleId());
  }

  /**
   * @description 读取当前 articles 集合中的最大业务 ID，用于修复 counter 落后于真实数据的问题。
   * @keyword-cn 文章入库, 计数器校准
   * @keyword-en article-id-counter
   */
  private async getMaxArticleId(): Promise<number> {
    const latest = await this.articles
      .find({}, { projection: { id: 1 } })
      .sort({ id: -1 })
      .limit(1)
      .next();
    const id = Number(latest?.id);
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0;
  }

  /**
   * @description 将 articles counter 至少推进到指定下限，防止后续自增号撞上已有文章 ID。
   * @keyword-cn 文章入库, 计数器校准
   * @keyword-en article-id-counter
   */
  private async ensureCounterAtLeast(seq: number): Promise<void> {
    const nextSeq = Math.max(0, Math.floor(Number(seq) || 0));
    await this.counters.updateOne(
      { _id: this.COUNTER_KEY },
      [
        {
          $set: {
            seq: {
              $cond: [
                { $gte: [{ $ifNull: ['$seq', 0] }, nextSeq] },
                '$seq',
                nextSeq,
              ],
            },
          },
        },
      ],
      { upsert: true },
    );
  }

  /**
   * @description 分配新的文章业务 ID，分配前先把 counter 推进到已有最大文章 ID。
   * @keyword-cn 文章入库, 计数器校准
   * @keyword-en article-id-counter
   */
  private async nextId(): Promise<number> {
    await this.ensureCounterAtLeast(await this.getMaxArticleId());
    const res = await this.counters.findOneAndUpdate(
      { _id: this.COUNTER_KEY },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 入库：存一篇文章到指定库
   * @keyword-en article create put into library
   */
  async create(input: ArticleCreateInput): Promise<ArticleEntity> {
    const now = new Date();
    const id = await this.nextId();
    const doc: ArticleEntity = {
      _id: new ObjectId(),
      id,
      libraryId: input.libraryId,
      userId: input.userId,
      tenantId: input.tenantId,
      title: String(input.title ?? '').trim(),
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 32) : undefined,
      contentJson: input.contentJson,
      text: typeof input.text === 'string' ? input.text : undefined,
      imageUrls: Array.isArray(input.imageUrls) ? input.imageUrls : undefined,
      imageIds: Array.isArray(input.imageIds) ? input.imageIds : undefined,
      meta: input.meta,
      publishStatus: input.publishStatus ?? 'unpublished',
      source: input.source,
      sourceRef: input.sourceRef,
      createdAt: now,
      updatedAt: now,
    };
    await this.articles.insertOne(doc);
    return doc;
  }

  /**
   * @description 批量入库（例如把整个 canvas 的所有文章存入库）
   * @keyword-en article bulk create from canvas
   */
  async bulkCreate(inputs: ArticleCreateInput[]): Promise<ArticleEntity[]> {
    const out: ArticleEntity[] = [];
    for (const input of inputs) {
      out.push(await this.create(input));
    }
    return out;
  }

  /**
   * @description 获取文章
   * @keyword-en article get
   */
  async get(id: number, tenantId?: string): Promise<ArticleEntity | null> {
    const filter: Record<string, unknown> = { id };
    if (tenantId) filter.tenantId = tenantId;
    return this.articles.findOne(filter);
  }

  /**
   * @description 列出某库下文章（可选按状态过滤，按创建时间升序）
   * @keyword-en article list by library with status filter
   */
  async list(params: {
    libraryId: number;
    tenantId?: string;
    status?: ArticlePublishStatus | 'all';
    limit?: number;
    offset?: number;
  }): Promise<{ items: ArticleEntity[]; total: number }> {
    const filter: Record<string, unknown> = { libraryId: params.libraryId };
    if (params.tenantId) filter.tenantId = params.tenantId;
    if (params.status && params.status !== 'all') {
      filter.publishStatus = params.status;
    }
    const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
    const offset = Math.max(0, params.offset ?? 0);
    const [items, total] = await Promise.all([
      this.articles
        .find(filter)
        .sort({ createdAt: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.articles.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * @description 更新文章字段
   * @keyword-en article update fields
   */
  async update(input: ArticleUpdateInput): Promise<ArticleEntity | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) set.title = String(input.title).trim();
    if (input.tags !== undefined) set.tags = input.tags;
    if (input.contentJson !== undefined) set.contentJson = input.contentJson;
    if (input.text !== undefined) set.text = input.text;
    if (input.imageUrls !== undefined) set.imageUrls = input.imageUrls;
    if (input.imageIds !== undefined) set.imageIds = input.imageIds;
    if (input.meta !== undefined) set.meta = input.meta;
    if (input.publishStatus !== undefined) {
      set.publishStatus = input.publishStatus;
      if (input.publishStatus === 'published') {
        set.publishedAt = new Date();
      }
    }
    const filter: Record<string, unknown> = { id: input.id };
    if (input.tenantId) filter.tenantId = input.tenantId;
    const res = await this.articles.findOneAndUpdate(
      filter,
      { $set: set },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 更新文章状态（published 时记录 publishedAt；同时释放租约）
   * @keyword-en article update publish status release lease
   */
  async updatePublishStatus(
    id: number,
    status: ArticlePublishStatus,
    opts: {
      tenantId?: string;
      libraryId?: number;
      leaseToken?: string;
      meta?: Record<string, unknown>;
    } = {},
  ): Promise<ArticleEntity | null> {
    const filter: Record<string, unknown> = { id };
    if (opts.tenantId) filter.tenantId = opts.tenantId;
    if (typeof opts.libraryId === 'number' && Number.isFinite(opts.libraryId)) {
      filter.libraryId = opts.libraryId;
    }
    if (opts.leaseToken) filter.lastLeaseToken = opts.leaseToken;
    const set: Record<string, unknown> = {
      publishStatus: status,
      updatedAt: new Date(),
      lockExpireAt: null,
    };
    if (status === 'published') set.publishedAt = new Date();
    if (opts.meta !== undefined) set.meta = opts.meta;
    const res = await this.articles.findOneAndUpdate(
      filter,
      { $set: set },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 把文章移动到同租户下的另一个文章库；租约未过期的在途文章拒绝移动。
   * @keyword-cn 移动文章, 跨库转移
   * @keyword-en move-article-to-library, cross-library-transfer
   */
  async moveToLibrary(params: {
    id: number;
    fromLibraryId: number;
    toLibraryId: number;
    tenantId?: string;
  }): Promise<ArticleEntity | null> {
    const filter: Record<string, unknown> = {
      id: params.id,
      libraryId: params.fromLibraryId,
      $or: [
        { lockExpireAt: { $exists: false } },
        { lockExpireAt: null },
        { lockExpireAt: { $lte: new Date() } },
      ],
    };
    if (params.tenantId) filter.tenantId = params.tenantId;
    const res = await this.articles.findOneAndUpdate(
      filter,
      { $set: { libraryId: params.toLibraryId, updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return res.value ?? null;
  }

  /**
   * @description 删除文章
   * @keyword-en article delete
   */
  async delete(id: number, tenantId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { id };
    if (tenantId) filter.tenantId = tenantId;
    const res = await this.articles.deleteOne(filter);
    return res.deletedCount === 1;
  }

  /**
   * @description 队列式领取一篇未发布文章：按 createdAt 升序 FIFO；
   * 已发布/已发送文章不再进入领取池，未释放租约的文章也不会被再次领取。
   * CAS 原子更新写入 lockExpireAt=now+15min 与 leaseToken，租约过期后自动回池。
   * @keyword-en article lease next unpublished fifo cas 15min
   */
  async leaseNext(params: {
    libraryId: number;
    tenantId?: string;
  }): Promise<ArticleLeaseResult | null> {
    const now = new Date();
    const expireAt = new Date(now.getTime() + this.LEASE_DURATION_MS);
    const leaseToken = randomUUID();
    const filter: Record<string, unknown> = {
      libraryId: params.libraryId,
      publishStatus: 'unpublished',
      $or: [
        { lockExpireAt: { $exists: false } },
        { lockExpireAt: null },
        { lockExpireAt: { $lt: now } },
      ],
    };
    if (params.tenantId) filter.tenantId = params.tenantId;

    const res = await this.articles.findOneAndUpdate(
      filter,
      {
        $set: {
          lockExpireAt: expireAt,
          lastLeaseAt: now,
          lastLeaseToken: leaseToken,
          updatedAt: now,
        },
      },
      {
        sort: { createdAt: 1 },
        returnDocument: 'after',
        includeResultMetadata: true,
      },
    );
    const article = res.value;
    if (!article) return null;
    return { article, leaseToken, leaseExpireAt: expireAt };
  }

  /**
   * @description 主动释放租约（任务失败时将文章放回池）
   * @keyword-en article release lease
   */
  async releaseLease(
    id: number,
    leaseToken: string,
    opts: { tenantId?: string; libraryId?: number } = {},
  ): Promise<boolean> {
    const filter: Record<string, unknown> = { id, lastLeaseToken: leaseToken };
    if (opts.tenantId) filter.tenantId = opts.tenantId;
    if (typeof opts.libraryId === 'number' && Number.isFinite(opts.libraryId)) {
      filter.libraryId = opts.libraryId;
    }
    const res = await this.articles.updateOne(filter, {
      $set: { updatedAt: new Date() },
      $unset: { lockExpireAt: '' },
    });
    return res.modifiedCount === 1;
  }
}
