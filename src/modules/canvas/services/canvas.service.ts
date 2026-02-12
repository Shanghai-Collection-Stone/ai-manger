import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  CanvasAddArticlesInput,
  CanvasArticleEntity,
  CanvasCreateInput,
  CanvasEntity,
  CanvasStatus,
} from '../entities/canvas.entity.js';

@Injectable()
export class CanvasService {
  private readonly canvases: Collection<CanvasEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.canvases = db.collection<CanvasEntity>('canvases');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 创建 canvases 所需索引，并初始化自增计数器。
   * @returns {Promise<void>} 无返回值。
   * @throws {Error} 当MongoDB创建索引或写入计数器失败时抛出。
   * @keyword canvas, mongo, index
   * @since 2026-02-04
   */
  async ensureIndexes(): Promise<void> {
    await this.canvases.createIndex({ id: 1 }, { unique: true });
    await this.canvases.createIndex({ userId: 1 });
    await this.canvases.createIndex({ status: 1 });
    await this.canvases.createIndex({ createdAt: -1 });
    const exists = await this.counters.findOne({ _id: 'canvases' });
    if (!exists) await this.counters.insertOne({ _id: 'canvases', seq: 0 });
  }

  /**
   * @description 获取画布自增ID。
   * @returns {Promise<number>} 下一个可用的自增ID。
   * @throws {Error} 当计数器更新失败时抛出。
   * @keyword canvas, counter, id
   * @since 2026-02-04
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'canvases' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 创建画布，用于承载多文章的生成与发布工作流。
   * @param {CanvasCreateInput} input - 创建参数（userId/topic/outline/style）。
   * @returns {Promise<CanvasEntity>} 新建的画布实体。
   * @throws {Error} 当数据库写入失败时抛出。
   * @keyword canvas, create, multi-article
   * @since 2026-02-04
   */
  async create(input: CanvasCreateInput): Promise<CanvasEntity> {
    const now = new Date();
    const id = await this.nextId();
    const doc: CanvasEntity = {
      _id: new ObjectId(),
      id,
      userId: input.userId,
      topic: input.topic,
      outline: input.outline,
      style: input.style,
      status: 'generating',
      articles: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.canvases.insertOne(doc);
    return doc;
  }

  /**
   * @description 根据自增ID获取画布。
   * @param {number} id - 画布ID。
   * @returns {Promise<CanvasEntity | null>} 画布实体，不存在时返回 null。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword canvas, get, mongo
   * @since 2026-02-04
   */
  async get(id: number): Promise<CanvasEntity | null> {
    const doc = await this.canvases.findOne({ id }, { projection: { _id: 0 } });
    return (doc as CanvasEntity | null) ?? null;
  }

  /**
   * @description 列出画布，支持按 userId 过滤。
   * @param {string} [userId] - 用户ID。
   * @param {number} [limit=50] - 返回条数上限。
   * @returns {Promise<CanvasEntity[]>} 画布列表，按 updatedAt 倒序。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword canvas, list, user-filter
   * @since 2026-02-04
   */
  async list(userId?: string, limit = 50): Promise<CanvasEntity[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    return this.canvases
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .limit(lim)
      .toArray();
  }

  /**
   * @description 为画布追加文章列表，并自动分配文章序号ID。
   * @param {number} id - 画布ID。
   * @param {CanvasAddArticlesInput} input - 文章输入列表。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体，不存在时返回 null。
   * @throws {Error} 当数据库更新失败时抛出。
   * @keyword canvas, articles, append
   * @since 2026-02-04
   */
  async addArticles(
    id: number,
    input: CanvasAddArticlesInput,
  ): Promise<CanvasEntity | null> {
    const cur = await this.canvases.findOne({ id });
    if (!cur) return null;
    const start = (cur.articles?.length ?? 0) + 1;
    const incoming: CanvasArticleEntity[] = (input.articles ?? []).map(
      (a, idx) => ({
        id: start + idx,
        title: a.title,
        tags: Array.isArray(a.tags) ? a.tags : [],
        contentJson: a.contentJson,
        status: 'pending',
      }),
    );
    await this.canvases.updateOne(
      { id },
      {
        $push: { articles: { $each: incoming } },
        $set: { updatedAt: new Date() },
      },
    );
    return await this.get(id);
  }

  /**
   * @description 更新画布整体状态。
   * @param {number} id - 画布ID。
   * @param {CanvasStatus} status - 画布状态。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体，不存在时返回 null。
   * @throws {Error} 当数据库更新失败时抛出。
   * @keyword canvas, status, update
   * @since 2026-02-04
   */
  async updateStatus(
    id: number,
    status: CanvasStatus,
  ): Promise<CanvasEntity | null> {
    const res = await this.canvases.findOneAndUpdate(
      { id },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return (res.value as CanvasEntity | null) ?? null;
  }

  async updateMeta(
    id: number,
    patch: {
      topic?: string;
      outline?: Record<string, unknown>;
      style?: Record<string, unknown>;
    },
  ): Promise<CanvasEntity | null> {
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof patch.topic === 'string') upd['topic'] = patch.topic;
    if (patch.outline && typeof patch.outline === 'object') {
      upd['outline'] = patch.outline;
    }
    if (patch.style && typeof patch.style === 'object') {
      upd['style'] = patch.style;
    }
    await this.canvases.updateOne({ id }, { $set: upd });
    return await this.get(id);
  }

  /**
   * @description 更新指定文章的配图信息与状态，用于生成/发布流程衔接。
   * @param {number} canvasId - 画布ID。
   * @param {number} articleId - 文章ID。
   * @param {{ imageIds?: number[]; imageUrls?: string[]; status?: CanvasArticleEntity['status']; doneNote?: string; }} patch - 更新字段。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体。
   * @throws {Error} 当数据库更新失败时抛出。
   * @keyword canvas, article, images
   * @since 2026-02-04
   */
  async updateArticleImages(
    canvasId: number,
    articleId: number,
    patch: {
      imageIds?: number[];
      imageUrls?: string[];
      status?: CanvasArticleEntity['status'];
      doneNote?: string;
    },
  ): Promise<CanvasEntity | null> {
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (Array.isArray(patch.imageIds))
      upd['articles.$.imageIds'] = patch.imageIds;
    if (Array.isArray(patch.imageUrls))
      upd['articles.$.imageUrls'] = patch.imageUrls;
    if (typeof patch.status === 'string')
      upd['articles.$.status'] = patch.status;
    if (typeof patch.doneNote === 'string')
      upd['articles.$.doneNote'] = patch.doneNote;
    await this.canvases.updateOne(
      { id: canvasId, 'articles.id': articleId },
      { $set: upd },
    );
    return await this.get(canvasId);
  }

  async updateArticle(
    canvasId: number,
    articleId: number,
    patch: {
      title?: string;
      tags?: string[];
      contentJson?: Record<string, unknown>;
      imageUrls?: string[];
      status?: CanvasArticleEntity['status'];
      doneNote?: string;
    },
  ): Promise<CanvasEntity | null> {
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof patch.title === 'string') upd['articles.$.title'] = patch.title;
    if (Array.isArray(patch.tags)) upd['articles.$.tags'] = patch.tags;
    if (patch.contentJson && typeof patch.contentJson === 'object') {
      upd['articles.$.contentJson'] = patch.contentJson;
    }
    if (Array.isArray(patch.imageUrls))
      upd['articles.$.imageUrls'] = patch.imageUrls;
    if (typeof patch.status === 'string')
      upd['articles.$.status'] = patch.status;
    if (typeof patch.doneNote === 'string')
      upd['articles.$.doneNote'] = patch.doneNote;
    await this.canvases.updateOne(
      { id: canvasId, 'articles.id': articleId },
      { $set: upd },
    );
    return await this.get(canvasId);
  }
}
