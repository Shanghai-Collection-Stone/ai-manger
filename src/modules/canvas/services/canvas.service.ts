import { Inject, Injectable, Logger } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  CanvasAddArticlesInput,
  CanvasArticleEntity,
  CanvasCreateInput,
  CanvasEntity,
  CanvasImageGroup,
  CanvasImageGroupCreateInput,
  CanvasStatus,
} from '../entities/canvas.entity.js';
import {
  CanvasImageGroupService,
  type ImageGroupSourcePreparation,
} from './canvas-image-group.service.js';

@Injectable()
export class CanvasService {
  private readonly logger = new Logger(CanvasService.name);
  private readonly canvases: Collection<CanvasEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly imageGroupService: CanvasImageGroupService,
  ) {
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
    // 租户隔离索引
    await this.canvases.createIndex({ tenantId: 1, userId: 1 });
    const exists = await this.counters.findOne({ _id: 'canvases' });
    if (!exists) await this.counters.insertOne({ _id: 'canvases', seq: 0 });
  }

  /**
   * @description 构建租户过滤条件
   * @param {string | undefined} tenantId - 租户ID
   * @returns {Record<string, unknown>} MongoDB filter 对象
   * @keyword-en build tenant filter
   * @since 2026-03-24
   */
  private buildTenantFilter(tenantId?: string): Record<string, unknown> {
    const currentTenantId = tenantId?.trim();
    // 无 tenantId 时（母平台）：返回 tenantId 为空/null/不存在的母平台数据
    if (!currentTenantId) {
      return {
        $or: [
          { tenantId: { $exists: false } },
          { tenantId: null },
          { tenantId: '' },
        ],
      };
    }
    // 有 tenantId 时：只返回匹配该 tenantId 的租户数据
    return { tenantId: currentTenantId };
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
      tenantId: input.tenantId,
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
   * @description 根据自增ID获取画布（租户隔离）。
   * @param {number} id - 画布ID。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<CanvasEntity | null>} 画布实体，不存在时返回 null。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword canvas, get, mongo
   * @since 2026-02-04
   */
  async get(id: number, tenantId?: string): Promise<CanvasEntity | null> {
    const filter = { id, ...this.buildTenantFilter(tenantId) };
    const doc = await this.canvases.findOne(filter, { projection: { _id: 0 } });
    return (doc as CanvasEntity | null) ?? null;
  }

  /**
   * @description 列出画布，支持按 userId / type / tag 过滤，支持 skip 分页（租户隔离）。
   * @param {string} [userId] - 用户ID。
   * @param {string} [tenantId] - 租户ID。
   * @param {number} [limit=50] - 返回条数上限。
   * @param {string} [type] - 画布类型过滤（article / image-group）。
   * @param {number} [skip=0] - 跳过条数（分页偏移）。
   * @param {string} [tag] - 关键词标签过滤（匹配 keywords 数组）。
   * @returns {Promise<CanvasEntity[]>} 画布列表，按 updatedAt 倒序。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword canvas, list, user-filter, pagination
   * @since 2026-02-04
   */
  async list(
    userId?: string,
    tenantId?: string,
    limit = 50,
    type?: string,
    skip = 0,
    tag?: string,
  ): Promise<CanvasEntity[]> {
    const filter = this.buildTenantFilter(tenantId);
    if (userId) filter.userId = userId;
    if (type) filter.type = type;
    if (tag) filter.keywords = { $in: [tag] };
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    const skp = Math.max(0, Math.floor(skip));
    return this.canvases
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .skip(skp)
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
    tenantId?: string,
  ): Promise<CanvasEntity | null> {
    const cur = await this.canvases.findOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
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
    return await this.get(id, tenantId);
  }

  /**
   * @description 更新画布整体状态。
   * @param {number} id - 画布ID。
   * @param {CanvasStatus} status - 画布状态。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体，不存在时返回 null。
   * @throws {Error} 当数据库更新失败时抛出。
   * @keyword canvas, status, update
   * @since 2026-02-04
   */
  async updateStatus(
    id: number,
    status: CanvasStatus,
    tenantId?: string,
  ): Promise<CanvasEntity | null> {
    const res = await this.canvases.findOneAndUpdate(
      { id, ...this.buildTenantFilter(tenantId) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    return (res.value as CanvasEntity | null) ?? null;
  }

  /**
   * @description 更新画布元信息（租户隔离）。
   * @param {number} id - 画布ID。
   * @param {{ topic?: string; outline?: Record<string, unknown>; style?: Record<string, unknown>; }} patch - 更新字段。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体。
   * @keyword-en update canvas meta
   */
  async updateMeta(
    id: number,
    patch: {
      topic?: string;
      outline?: Record<string, unknown>;
      style?: Record<string, unknown>;
      keywords?: string[];
    },
    tenantId?: string,
  ): Promise<CanvasEntity | null> {
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof patch.topic === 'string') upd['topic'] = patch.topic;
    if (patch.outline && typeof patch.outline === 'object') {
      upd['outline'] = patch.outline;
    }
    if (patch.style && typeof patch.style === 'object') {
      upd['style'] = patch.style;
    }
    if (Array.isArray(patch.keywords)) {
      upd['keywords'] = patch.keywords;
    }
    await this.canvases.updateOne(
      { id, ...this.buildTenantFilter(tenantId) },
      { $set: upd },
    );
    return await this.get(id, tenantId);
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
    tenantId?: string,
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
      {
        id: canvasId,
        'articles.id': articleId,
        ...this.buildTenantFilter(tenantId),
      },
      { $set: upd },
    );
    return await this.get(canvasId, tenantId);
  }

  /**
   * @description 更新画布文章内容与状态。
   * @param {number} canvasId - 画布ID。
   * @param {number} articleId - 文章ID。
   * @param {object} patch - 更新字段。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体。
   * @keyword canvas, article, update
   * @since 2026-02-04
   */
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
    tenantId?: string,
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
      {
        id: canvasId,
        'articles.id': articleId,
        ...this.buildTenantFilter(tenantId),
      },
      { $set: upd },
    );
    return await this.get(canvasId, tenantId);
  }

  /**
   * @description 创建图片组类型 Canvas，立即返回 generating 状态，后台异步生成图片组。
   * @param {CanvasImageGroupCreateInput} input - 创建入参（articles 含 title+tags）。
   * @returns {Promise<CanvasEntity>} 新建的 Canvas 实体（status=generating）。
   * @keyword-en create image-group canvas async
   * @since 2026-04-02
   */
  async createImageGroupCanvas(
    input: CanvasImageGroupCreateInput,
  ): Promise<CanvasEntity> {
    const now = new Date();
    const id = await this.nextId();
    const doc: CanvasEntity = {
      _id: new ObjectId(),
      id,
      userId: input.userId,
      tenantId: input.tenantId,
      topic: input.topic,
      type: 'image-group',
      status: 'generating',
      articles: (input.articles ?? []).map((a, idx) => ({
        id: idx + 1,
        title: a.title,
        tags: Array.isArray(a.tags) ? a.tags : [],
        contentJson: {},
        status: 'pending',
      })),
      imageGroups: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.canvases.insertOne(doc);
    this.logger.debug(
      `[image-group] created canvasId=${id} topic=${input.topic ?? ''} articleCount=${doc.articles.length}`,
    );

    // 异步后台生成图片组，不阻塞接口返回
    void this.runImageGroupGeneration(id, input);

    return { ...doc, _id: doc._id };
  }

  /**
   * @description 在指定 Canvas 上按图片组规则生成 imageGroups，并回写到同一 Canvas。
   * @param {{ canvasId: number; userId: string; tenantId?: string; topic?: string; articles: CanvasImageGroupCreateInput['articles']; }} input - 生成参数。
   * @returns {Promise<CanvasImageGroup[]>} 生成后的图片组列表。
   * @keyword-en generate image groups for existing canvas
   */
  async generateImageGroupsForCanvas(input: {
    canvasId: number;
    userId: string;
    tenantId?: string;
    topic?: string;
    articles: CanvasImageGroupCreateInput['articles'];
    /** true=追加到现有图组(复用 Canvas 再生成);false/缺省=覆盖(新建 Canvas 首次生成) */
    append?: boolean;
  }): Promise<CanvasImageGroup[]> {
    const groups = await this.imageGroupService.generateImageGroups({
      userId: input.userId,
      tenantId: input.tenantId,
      topic: input.topic,
      articles: input.articles,
    });
    await this.updateImageGroups(
      input.canvasId,
      groups,
      input.tenantId,
      input.append === true,
    );
    return groups;
  }

  /**
   * @description 为指定 Canvas 预先准备图片组源图分配，不生成封面/拼图文件，用于图文生成前置不足量拦截。
   * @param {{ canvasId: number; userId: string; tenantId?: string; topic?: string; articles: CanvasImageGroupCreateInput['articles']; }} input - 分配参数。
   * @returns {Promise<ImageGroupSourcePreparation>} 源图分配结果。
   * @keyword-en prepare, allocation, canvas
   */
  async prepareImageGroupsForCanvas(input: {
    canvasId: number;
    userId: string;
    tenantId?: string;
    topic?: string;
    articles: CanvasImageGroupCreateInput['articles'];
  }): Promise<ImageGroupSourcePreparation> {
    void input.canvasId;
    return await this.imageGroupService.prepareImageGroupSources({
      userId: input.userId,
      tenantId: input.tenantId,
      topic: input.topic,
      articles: input.articles,
    });
  }

  /**
   * @description 根据预分配结果渲染图片组并回写到 Canvas。
   * @param {{ canvasId: number; userId: string; tenantId?: string; topic?: string; articles: CanvasImageGroupCreateInput['articles']; preparation: Extract<ImageGroupSourcePreparation, {ok: true}>; append?: boolean }} input - 渲染参数。
   * @returns {Promise<CanvasImageGroup[]>} 渲染后的图片组。
   * @keyword-en render, prepared, image-group
   */
  async renderPreparedImageGroupsForCanvas(input: {
    canvasId: number;
    userId: string;
    tenantId?: string;
    topic?: string;
    articles: CanvasImageGroupCreateInput['articles'];
    preparation: Extract<ImageGroupSourcePreparation, { ok: true }>;
    append?: boolean;
  }): Promise<CanvasImageGroup[]> {
    const groups = await this.imageGroupService.renderPreparedImageGroups(
      {
        userId: input.userId,
        tenantId: input.tenantId,
        topic: input.topic,
        articles: input.articles,
      },
      input.preparation,
    );
    await this.updateImageGroups(
      input.canvasId,
      groups,
      input.tenantId,
      input.append === true,
    );
    return groups;
  }

  /**
   * @description 后台异步执行图片组生成并回写 Canvas。
   * @param {number} canvasId - Canvas ID。
   * @param {CanvasImageGroupCreateInput} input - 创建入参。
   * @returns {Promise<void>}
   * @keyword-en run image group generation in background
   */
  private async runImageGroupGeneration(
    canvasId: number,
    input: CanvasImageGroupCreateInput,
  ): Promise<void> {
    this.logger.debug(
      `[image-group] generation_start canvasId=${canvasId} articleCount=${input.articles?.length ?? 0}`,
    );
    try {
      const groups = await this.generateImageGroupsForCanvas({
        canvasId,
        userId: input.userId,
        tenantId: input.tenantId,
        topic: input.topic,
        articles: input.articles,
      });
      const doneCount = groups.filter((g) => g.status === 'done').length;
      const failedCount = groups.filter((g) => g.status === 'failed').length;
      this.logger.debug(
        `[image-group] generation_done canvasId=${canvasId} groupsTotal=${groups.length} done=${doneCount} failed=${failedCount}`,
      );
      const finalStatus = failedCount > 0 ? 'requires_human' : 'completed';
      await this.canvases.updateOne(
        { id: canvasId },
        { $set: { status: finalStatus, updatedAt: new Date() } },
      );
    } catch (err) {
      await this.canvases.updateOne(
        { id: canvasId },
        { $set: { status: 'failed', updatedAt: new Date() } },
      );
      this.logger.error(
        `[image-group] generation_failed canvasId=${canvasId}`,
        err,
      );
    }
  }

  /**
   * @description 按关键词（tags）搜索 Canvas，优先 keywords 字段精确匹配，兜底 topic + 文章 title 文本搜索。
   * @param {object} input - 搜索参数
   * @param {string[]} input.tags - 要匹配的关键词列表（任意一个命中即返回）
   * @param {string} [input.userId] - 用户 ID 过滤
   * @param {string} [input.tenantId] - 租户 ID（隔离）
   * @param {string} [input.type] - canvas 类型过滤（article / image-group）
   * @param {number} [input.limit=20] - 最大返回数
   * @returns {Promise<{ canvases: CanvasEntity[]; matchMode: 'keyword' | 'text' }>} 搜索结果及命中模式
   * @keyword-en canvas search by keywords, tag match, text fallback
   */
  async searchByKeywords(input: {
    tags: string[];
    userId?: string;
    tenantId?: string;
    type?: string;
    limit?: number;
  }): Promise<{ canvases: CanvasEntity[]; matchMode: 'keyword' | 'text' }> {
    const tags = (input.tags ?? [])
      .map((t) => String(t).trim())
      .filter(Boolean);
    const lim = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
    const baseFilter = this.buildTenantFilter(input.tenantId);
    if (input.userId) baseFilter.userId = input.userId;
    if (input.type) baseFilter.type = input.type;

    // 主匹配：keywords 字段 $in（精确 tag 命中）
    if (tags.length > 0) {
      const kwFilter = { ...baseFilter, keywords: { $in: tags } };
      const kwResults = await this.canvases
        .find(kwFilter, { projection: { _id: 0, embeddingVector: 0 } })
        .sort({ updatedAt: -1 })
        .limit(lim)
        .toArray();
      if (kwResults.length > 0) {
        return { canvases: kwResults, matchMode: 'keyword' };
      }
    }

    // 兜底：topic 或文章 title 文本 regex 搜索
    if (tags.length > 0) {
      const regexParts = tags.map(
        (t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      );
      const orConditions = regexParts.flatMap((re) => [
        { topic: { $regex: re } },
        { 'articles.title': { $regex: re } },
        { 'articles.tags': { $regex: re } },
      ]);
      const textFilter = { ...baseFilter, $or: orConditions };
      const textResults = await this.canvases
        .find(textFilter, { projection: { _id: 0, embeddingVector: 0 } })
        .sort({ updatedAt: -1 })
        .limit(lim)
        .toArray();
      return { canvases: textResults, matchMode: 'text' };
    }

    // 无 tags：返回最近画布
    const recent = await this.canvases
      .find(baseFilter, { projection: { _id: 0, embeddingVector: 0 } })
      .sort({ updatedAt: -1 })
      .limit(lim)
      .toArray();
    return { canvases: recent, matchMode: 'keyword' };
  }

  /**
   * @description 将生成好的图片组写入 Canvas。
   * @param {number} id - Canvas ID。
   * @param {CanvasImageGroup[]} imageGroups - 图片组列表。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<void>}
   * @keyword-en update canvas image groups
   */
  /**
   * @description 回写 Canvas 的图组。
   *   - append=false(默认): 整组覆盖(新建 Canvas 首次生成)
   *   - append=true: 追加到现有 imageGroups 之后(复用 Canvas 再生成新图组),
   *     新图组 id 接续现有最大 id 重新编号,避免 id 冲突。
   * @keyword-en update or append image groups on canvas
   */
  async updateImageGroups(
    id: number,
    imageGroups: CanvasImageGroup[],
    tenantId?: string,
    append = false,
  ): Promise<void> {
    if (!append) {
      await this.canvases.updateOne(
        { id, ...this.buildTenantFilter(tenantId) },
        { $set: { imageGroups, updatedAt: new Date() } },
      );
      return;
    }
    const existing = await this.get(id, tenantId);
    const old = Array.isArray(existing?.imageGroups)
      ? existing.imageGroups
      : [];
    const maxId = old.reduce(
      (m, g) => Math.max(m, Number((g as { id?: unknown }).id) || 0),
      0,
    );
    const renumbered = imageGroups.map((g, idx) => ({
      ...g,
      id: maxId + idx + 1,
    }));
    await this.canvases.updateOne(
      { id, ...this.buildTenantFilter(tenantId) },
      { $set: { imageGroups: [...old, ...renumbered], updatedAt: new Date() } },
    );
  }

  /**
   * @description 将画布文章标记为已发送（小红书发布成功后回写时间）。
   * @param {number} canvasId - 画布ID。
   * @param {number} articleId - 文章ID。
   * @param {string} [tenantId] - 租户ID。
   * @param {Date} [sentAt] - 发送时间，默认当前时间。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体。
   * @keyword-en mark canvas article as sent
   */
  async markArticleSent(
    canvasId: number,
    articleId: number,
    tenantId?: string,
    sentAt?: Date,
  ): Promise<CanvasEntity | null> {
    const now = sentAt ?? new Date();
    await this.canvases.updateOne(
      {
        id: canvasId,
        'articles.id': articleId,
        ...this.buildTenantFilter(tenantId),
      },
      { $set: { 'articles.$.sentAt': now, updatedAt: new Date() } },
    );
    return await this.get(canvasId, tenantId);
  }

  /**
   * @description 删除整个 Canvas（租户隔离）。
   * @param {number} id - Canvas ID。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<boolean>} 是否删除成功。
   * @keyword-en delete canvas
   */
  async deleteCanvas(id: number, tenantId?: string): Promise<boolean> {
    const res = await this.canvases.deleteOne({
      id,
      ...this.buildTenantFilter(tenantId),
    });
    return res.deletedCount > 0;
  }

  /**
   * @description 删除 Canvas 中指定文章（$pull，租户隔离）。
   * @param {number} canvasId - Canvas ID。
   * @param {number} articleId - 文章 ID。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体。
   * @keyword-en delete article from canvas
   */
  async deleteArticle(
    canvasId: number,
    articleId: number,
    tenantId?: string,
  ): Promise<CanvasEntity | null> {
    await this.canvases.updateOne(
      { id: canvasId, ...this.buildTenantFilter(tenantId) },
      {
        $pull: { articles: { id: articleId } },
        $set: { updatedAt: new Date() },
      } as any,
    );
    return await this.get(canvasId, tenantId);
  }

  /**
   * @description 删除图片组中的指定图片（按 imageId，$pull，租户隔离）。
   * @param {number} canvasId - Canvas ID。
   * @param {number} groupId - 图片组 ID。
   * @param {number} imageId - 图片 imageId。
   * @param {string} [tenantId] - 租户ID。
   * @returns {Promise<CanvasEntity | null>} 更新后的画布实体。
   * @keyword-en delete image from image group canvas
   */
  async deleteImageFromGroup(
    canvasId: number,
    groupId: number,
    imageId: number,
    tenantId?: string,
  ): Promise<CanvasEntity | null> {
    await this.canvases.updateOne(
      {
        id: canvasId,
        'imageGroups.id': groupId,
        ...this.buildTenantFilter(tenantId),
      },
      {
        $pull: { 'imageGroups.$.images': { imageId } },
        $set: { updatedAt: new Date() },
      } as any,
    );
    return await this.get(canvasId, tenantId);
  }
}
