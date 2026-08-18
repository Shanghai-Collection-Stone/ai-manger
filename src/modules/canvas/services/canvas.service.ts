import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  CanvasAddArticlesInput,
  CanvasArticleEntity,
  CanvasCollageLayout,
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
import { GalleryService } from '../../gallery/services/gallery.service.js';
import type { GalleryImageEntity } from '../../gallery/entities/gallery-image.entity.js';

type CanvasGroupImageRole = CanvasImageGroup['images'][number]['role'];
type CanvasInnerImageRole = Exclude<CanvasGroupImageRole, 'cover'>;

const CANVAS_GROUP_IMAGE_ROLES: CanvasGroupImageRole[] = [
  'cover',
  'inner-1',
  'inner-2',
  'inner-3',
  'inner-4',
  'inner-5',
];

const MAX_ARTICLE_IMAGE_INDEX = 8;

@Injectable()
export class CanvasService {
  private readonly logger = new Logger(CanvasService.name);
  private readonly canvases: Collection<CanvasEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly imageGroupService: CanvasImageGroupService,
    private readonly galleryService: GalleryService,
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
    await this.canvases.createIndex({
      tenantId: 1,
      userId: 1,
      type: 1,
      status: 1,
      'imageGroupUsage.status': 1,
      updatedAt: -1,
    });
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
   * @description 查询可被生文消费的未使用图片组 Canvas。
   * @param {object} input - 查询条件。
   * @returns {Promise<CanvasEntity[]>} 未使用图片组 Canvas 列表。
   * @keyword-cn 未使用图组, 图片组查询
   * @keyword-en unused-image-groups, image-group-query
   */
  async listUnusedImageGroupCanvases(input: {
    userId?: string;
    tenantId?: string;
    limit?: number;
    skip?: number;
    tag?: string;
    includeIncomplete?: boolean;
  }): Promise<CanvasEntity[]> {
    const filter: Record<string, unknown> = {
      ...this.buildTenantFilter(input.tenantId),
      type: 'image-group',
      $or: [
        { imageGroupUsage: { $exists: false } },
        { 'imageGroupUsage.status': { $ne: 'used' } },
      ],
    };
    if (input.userId) filter.userId = input.userId;
    if (input.tag) filter.keywords = { $in: [input.tag] };
    if (!input.includeIncomplete) {
      filter.status = 'completed';
      filter['imageGroups.0'] = { $exists: true };
    }
    const lim = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
    const skp = Math.max(0, Math.floor(input.skip ?? 0));
    return this.canvases
      .find(filter, { projection: { _id: 0, embeddingVector: 0 } })
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
   * @description 启动图文 Canvas 单篇文章封面重生成任务，立即把 Canvas 置为 generating。
   * @param {object} input - 封面重生成输入。
   * @returns {Promise<CanvasEntity | null>} 已进入 generating 的 Canvas。
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en article-cover-only
   */
  async startArticleCoverRegeneration(input: {
    canvasId: number;
    articleId: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
    prompt?: string;
    includeSystemPrompt?: boolean;
  }): Promise<CanvasEntity | null> {
    return await this.startArticleImageRegeneration({
      ...input,
      imageIndex: 0,
    });
  }

  /**
   * @description 启动图文 Canvas 单篇文章指定图片槽位重生成任务，立即把 Canvas 置为 generating。
   * @param {object} input - 图片槽位重生成输入。
   * @returns {Promise<CanvasEntity | null>} 已进入 generating 的 Canvas。
   * @keyword-cn 图文内页重生成, 图片槽位重生成
   * @keyword-en article-image-regenerate
   * @keyword-en image-slot-regenerate
   */
  async startArticleImageRegeneration(input: {
    canvasId: number;
    articleId: number;
    imageIndex: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
    prompt?: string;
    includeSystemPrompt?: boolean;
  }): Promise<CanvasEntity | null> {
    const imageIndex = this.normalizeArticleImageIndex(input.imageIndex);
    const imageIds = this.normalizeCoverSourceIds(input.imageIds);
    if (imageIds.length === 0) {
      throw new BadRequestException('COVER_SOURCE_IMAGES_REQUIRED');
    }
    const canvas = await this.get(input.canvasId, input.tenantId);
    if (!canvas) throw new NotFoundException('CANVAS_NOT_FOUND');
    this.assertCanvasOwner(canvas, input.userId);
    const article = (canvas.articles ?? []).find(
      (item) => Number(item.id) === Number(input.articleId),
    );
    if (!article) throw new NotFoundException('CANVAS_ARTICLE_NOT_FOUND');
    this.assertArticleImageSlotExists(article, imageIndex);
    const previousStatus = canvas.status;
    await this.updateStatus(input.canvasId, 'generating', input.tenantId);
    void this.runArticleImageRegeneration({
      ...input,
      imageIndex,
      imageIds,
      previousStatus,
    });
    return await this.get(input.canvasId, input.tenantId);
  }

  /**
   * @description 直接使用用户选择的图库图片替换图文 Canvas 单篇文章首图封面，不进入生成中状态。
   * @param {object} input - 直接设封面的输入。
   * @returns {Promise<CanvasEntity | null>} 更新后的 Canvas。
   * @keyword-cn 直接设为封面 图片选择
   * @keyword-en cover-select
   * @keyword-en article-cover-only
   */
  async selectArticleCoverImage(input: {
    canvasId: number;
    articleId: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
  }): Promise<CanvasEntity | null> {
    return await this.selectArticleImage({ ...input, imageIndex: 0 });
  }

  /**
   * @description 直接使用用户选择的图库图片替换图文 Canvas 单篇文章指定图片槽位，不进入生成中状态。
   * @param {object} input - 直接替换文章图片槽位的输入。
   * @returns {Promise<CanvasEntity | null>} 更新后的 Canvas。
   * @keyword-cn 图文内页选择, 图片槽位替换
   * @keyword-en article-image-select
   * @keyword-en image-slot-select
   */
  async selectArticleImage(input: {
    canvasId: number;
    articleId: number;
    imageIndex: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
  }): Promise<CanvasEntity | null> {
    const imageIndex = this.normalizeArticleImageIndex(input.imageIndex);
    const { image } = await this.loadSelectedCoverImage({
      userId: input.userId,
      tenantId: input.tenantId,
      imageIds: input.imageIds,
    });
    const canvas = await this.get(input.canvasId, input.tenantId);
    if (!canvas) throw new NotFoundException('CANVAS_NOT_FOUND');
    this.assertCanvasOwner(canvas, input.userId);
    const article = (canvas.articles ?? []).find(
      (item) => Number(item.id) === Number(input.articleId),
    );
    if (!article) throw new NotFoundException('CANVAS_ARTICLE_NOT_FOUND');
    this.assertArticleImageSlotExists(article, imageIndex);

    const nextImageUrls = Array.isArray(article.imageUrls)
      ? [...article.imageUrls]
      : [];
    nextImageUrls[imageIndex] = this.resolveGalleryImageUrl(image);
    const nextImageIds = Array.isArray(article.imageIds)
      ? [...article.imageIds]
      : [];
    nextImageIds[imageIndex] = Number(image.id);
    return await this.updateArticleImages(
      input.canvasId,
      article.id,
      {
        imageUrls: nextImageUrls,
        imageIds: nextImageIds,
      },
      input.tenantId,
    );
  }

  /**
   * @description 直接使用用户选择的图库图片替换图组 Canvas 指定图组 role=cover 图片，不修改其他内页图。
   * @param {object} input - 直接设封面的输入。
   * @returns {Promise<CanvasEntity | null>} 更新后的 Canvas。
   * @keyword-cn 直接设为封面 图片选择
   * @keyword-en cover-select
   * @keyword-en image-group-cover-only
   */
  async selectImageGroupCoverImage(input: {
    canvasId: number;
    groupId: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
  }): Promise<CanvasEntity | null> {
    return await this.selectImageGroupImage({ ...input, role: 'cover' });
  }

  /**
   * @description 直接使用用户选择的图库图片替换图组 Canvas 指定 role 图片，不修改其他图片槽位。
   * @param {object} input - 直接替换图组图片槽位的输入。
   * @returns {Promise<CanvasEntity | null>} 更新后的 Canvas。
   * @keyword-cn 图片槽位替换, 内页选择
   * @keyword-en image-slot-select
   * @keyword-en image-group-image-slot
   */
  async selectImageGroupImage(input: {
    canvasId: number;
    groupId: number;
    role: string;
    userId: string;
    tenantId?: string;
    imageIds: number[];
  }): Promise<CanvasEntity | null> {
    const role = this.normalizeImageGroupImageRole(input.role);
    const { image, collage } = await this.loadSelectedCoverImage({
      userId: input.userId,
      tenantId: input.tenantId,
      imageIds: input.imageIds,
    });
    const canvas = await this.get(input.canvasId, input.tenantId);
    if (!canvas) throw new NotFoundException('CANVAS_NOT_FOUND');
    this.assertCanvasOwner(canvas, input.userId);
    const groups = Array.isArray(canvas.imageGroups) ? canvas.imageGroups : [];
    const group = groups.find(
      (item) => Number(item.id) === Number(input.groupId),
    );
    if (!group) throw new NotFoundException('CANVAS_IMAGE_GROUP_NOT_FOUND');
    const currentImage = (group.images ?? []).find((img) => img.role === role);
    const nextImage = this.toSelectedGroupImage(
      image,
      role,
      currentImage,
      group.articleTitle,
      collage,
    );
    const nextGroups = groups.map((item) =>
      Number(item.id) === Number(input.groupId)
        ? {
            ...item,
            images: this.replaceGroupImageByRole(item.images, nextImage),
          }
        : item,
    );
    await this.updateImageGroups(
      input.canvasId,
      nextGroups,
      input.tenantId,
      false,
    );
    return await this.get(input.canvasId, input.tenantId);
  }

  /**
   * @description 读取直接设图所选图库图片：选 1 张时返回该图；选 2-4 张时实时合成 3:4 拼图并返回拼图图库图片，让"直接使用"即拼即用。
   * @param {object} input - 当前用户、租户和候选图片 ID（可多张）。
   * @returns {Promise<{ image: GalleryImageEntity; collage?: CanvasCollageLayout }>} 单图或合成后的拼图图库图片，拼图另带画布格式。
   * @keyword-cn 直接设为封面 图片选择 多图拼图
   * @keyword-en cover-select
   * @keyword-en selected-cover-image
   * @keyword-en multi-collage
   */
  private async loadSelectedCoverImage(input: {
    userId: string;
    tenantId?: string;
    imageIds: number[];
  }): Promise<{ image: GalleryImageEntity; collage?: CanvasCollageLayout }> {
    const imageIds = this.normalizeCoverSourceIds(input.imageIds);
    if (imageIds.length === 0) {
      throw new BadRequestException('COVER_SOURCE_IMAGES_REQUIRED');
    }
    // 选 2-4 张 → 合成 3:4 拼图并直接使用合成图
    if (imageIds.length >= 2) {
      const collage = await this.imageGroupService.composeSelectedCollage({
        userId: input.userId,
        tenantId: input.tenantId,
        sourceImageIds: imageIds,
        generatedKind: 'collage',
      });
      if (collage) {
        this.resolveGalleryImageUrl(collage.image);
        return collage;
      }
      this.logger.warn(
        `[canvas-select] compose collage failed, fallback to first image ids=${imageIds.join(',')}`,
      );
    }
    const images = await this.galleryService.findAccessibleImagesByIds(
      input.userId,
      input.tenantId,
      imageIds.slice(0, 1),
    );
    if (!images[0]) throw new NotFoundException('COVER_SOURCE_IMAGE_NOT_FOUND');
    this.resolveGalleryImageUrl(images[0]);
    return { image: images[0] };
  }

  /**
   * @description 从图库图片中解析可写回 Canvas 的图片地址。
   * @param {GalleryImageEntity} image - 图库图片。
   * @returns {string} 原图或缩略图地址。
   * @keyword-cn 直接设为封面 图片地址
   * @keyword-en cover-select
   * @keyword-en selected-cover-image
   */
  private resolveGalleryImageUrl(image: GalleryImageEntity): string {
    const url = String(image.url || image.thumbUrl || '').trim();
    if (!url) throw new BadRequestException('COVER_SOURCE_IMAGE_URL_EMPTY');
    return url;
  }

  /**
   * @description 将图库图片转换成图组 Canvas 可直接写回的 role=cover 图片结构。
   * @param {GalleryImageEntity} image - 图库图片。
   * @param {CanvasImageGroup['images'][number] | undefined} currentCover - 原封面图。
   * @param {string | undefined} articleTitle - 图组文章标题。
   * @returns {CanvasImageGroup['images'][number]} 新封面图片。
   * @keyword-cn 直接设为封面 图片选择
   * @keyword-en cover-select
   * @keyword-en image-group-cover-only
   */
  private toSelectedCoverGroupImage(
    image: GalleryImageEntity,
    currentCover?: CanvasImageGroup['images'][number],
    articleTitle?: string,
  ): CanvasImageGroup['images'][number] {
    return this.toSelectedGroupImage(
      image,
      'cover',
      currentCover,
      articleTitle,
    );
  }

  /**
   * @description 将图库图片转换成图组 Canvas 指定 role 图片结构，封面会沿用原封面文案。
   * @param {GalleryImageEntity} image - 图库图片。
   * @param {CanvasGroupImageRole} role - 目标图片槽位。
   * @param {CanvasImageGroup['images'][number] | undefined} currentImage - 原槽位图片。
   * @param {string | undefined} articleTitle - 图组文章标题。
   * @param {CanvasCollageLayout} [collage] - 拼图画布格式（多选实时合成拼图时传入）。
   * @returns {CanvasImageGroup['images'][number]} 新槽位图片。
   * @keyword-cn 图片槽位替换, 内页选择
   * @keyword-en image-slot-select
   * @keyword-en image-group-image-slot
   */
  private toSelectedGroupImage(
    image: GalleryImageEntity,
    role: CanvasGroupImageRole,
    currentImage?: CanvasImageGroup['images'][number],
    articleTitle?: string,
    collage?: CanvasCollageLayout,
  ): CanvasImageGroup['images'][number] {
    const width = Number(image.width);
    const height = Number(image.height);
    return {
      imageId: Number(image.id),
      url: this.resolveGalleryImageUrl(image),
      thumbUrl: image.thumbUrl,
      isCollage: image.isCollage === true,
      isPortrait:
        typeof image.isPortrait === 'boolean'
          ? image.isPortrait
          : Number.isFinite(width) && Number.isFinite(height)
            ? height >= width
            : undefined,
      tags: Array.isArray(image.tags) ? [...image.tags] : [],
      role,
      ...(role === 'cover'
        ? {
            text: currentImage?.text || articleTitle,
            subtitle: currentImage?.subtitle,
          }
        : {}),
      ...(collage ? { collage } : {}),
    };
  }

  /**
   * @description 校验并归一化图组图片 role，只允许 cover 与 inner-1 到 inner-5。
   * @param {string} role - 输入 role。
   * @returns {CanvasGroupImageRole} 合法图片槽位 role。
   * @keyword-cn 图片槽位校验, 内页重生成
   * @keyword-en image-slot-regenerate
   * @keyword-en image-group-image-slot
   */
  private normalizeImageGroupImageRole(role: string): CanvasGroupImageRole {
    const normalized = String(role ?? '').trim() as CanvasGroupImageRole;
    if (!CANVAS_GROUP_IMAGE_ROLES.includes(normalized)) {
      throw new BadRequestException('CANVAS_IMAGE_ROLE_INVALID');
    }
    return normalized;
  }

  /**
   * @description 启动图片组 Canvas 单组封面重生成任务，立即把 Canvas 置为 generating。
   * @param {object} input - 封面重生成输入。
   * @returns {Promise<CanvasEntity | null>} 已进入 generating 的 Canvas。
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en image-group-cover-only
   */
  async startImageGroupCoverRegeneration(input: {
    canvasId: number;
    groupId: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
    prompt?: string;
    includeSystemPrompt?: boolean;
  }): Promise<CanvasEntity | null> {
    return await this.startImageGroupImageRegeneration({
      ...input,
      role: 'cover',
    });
  }

  /**
   * @description 启动图片组 Canvas 指定图片槽位重生成任务，立即把 Canvas 置为 generating。
   * @param {object} input - 图片槽位重生成输入。
   * @returns {Promise<CanvasEntity | null>} 已进入 generating 的 Canvas。
   * @keyword-cn 内页重生成, 图片槽位重生成
   * @keyword-en image-slot-regenerate
   * @keyword-en image-group-image-slot
   */
  async startImageGroupImageRegeneration(input: {
    canvasId: number;
    groupId: number;
    role: string;
    userId: string;
    tenantId?: string;
    imageIds: number[];
    prompt?: string;
    includeSystemPrompt?: boolean;
  }): Promise<CanvasEntity | null> {
    const role = this.normalizeImageGroupImageRole(input.role);
    const imageIds = this.normalizeCoverSourceIds(input.imageIds);
    if (imageIds.length === 0) {
      throw new BadRequestException('COVER_SOURCE_IMAGES_REQUIRED');
    }
    const canvas = await this.get(input.canvasId, input.tenantId);
    if (!canvas) throw new NotFoundException('CANVAS_NOT_FOUND');
    this.assertCanvasOwner(canvas, input.userId);
    const group = (canvas.imageGroups ?? []).find(
      (item) => Number(item.id) === Number(input.groupId),
    );
    if (!group) throw new NotFoundException('CANVAS_IMAGE_GROUP_NOT_FOUND');
    const previousStatus = canvas.status;
    await this.updateStatus(input.canvasId, 'generating', input.tenantId);
    void this.runImageGroupImageRegeneration({
      ...input,
      role,
      imageIds,
      previousStatus,
    });
    return await this.get(input.canvasId, input.tenantId);
  }

  /**
   * @description 校验 Canvas 归属，避免同租户内误操作其他用户 Canvas。
   * @param {CanvasEntity} canvas - Canvas 实体。
   * @param {string} userId - 当前用户 ID。
   * @returns {void}
   * @keyword-cn 封面重生成, 权限校验
   * @keyword-en cover-regenerate
   * @keyword-en canvas-owner-check
   */
  private assertCanvasOwner(canvas: CanvasEntity, userId: string): void {
    if (canvas.userId !== userId) {
      throw new ForbiddenException('CANVAS_SCOPE_FORBIDDEN');
    }
  }

  /**
   * @description 归一化图片槽位重生成素材图片 ID，去重并限制最多 4 张。
   * @param {number[]} imageIds - 输入图片 ID 列表。
   * @returns {number[]} 可用图片 ID 列表。
   * @keyword-cn 封面重生成, 图片选择
   * @keyword-en cover-regenerate
   * @keyword-en selected-source-images
   */
  private normalizeCoverSourceIds(imageIds: number[]): number[] {
    return Array.from(
      new Set(
        (Array.isArray(imageIds) ? imageIds : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.floor(id)),
      ),
    ).slice(0, 4);
  }

  /**
   * @description 校验并归一化图文文章图片下标，前端最多展示 9 张图。
   * @param {number} imageIndex - 输入图片下标。
   * @returns {number} 合法图片下标。
   * @keyword-cn 图文内页重生成, 图片下标
   * @keyword-en article-image-regenerate
   * @keyword-en image-slot-regenerate
   */
  private normalizeArticleImageIndex(imageIndex: number): number {
    const index = Number(imageIndex);
    if (!Number.isFinite(index)) {
      throw new BadRequestException('ARTICLE_IMAGE_INDEX_INVALID');
    }
    const normalized = Math.floor(index);
    if (normalized < 0 || normalized > MAX_ARTICLE_IMAGE_INDEX) {
      throw new BadRequestException('ARTICLE_IMAGE_INDEX_INVALID');
    }
    return normalized;
  }

  /**
   * @description 校验图文文章图片槽位存在；封面槽位允许从空首图开始生成。
   * @param {CanvasArticleEntity} article - Canvas 文章。
   * @param {number} imageIndex - 图片下标。
   * @returns {void}
   * @keyword-cn 图文内页重生成, 图片槽位校验
   * @keyword-en article-image-regenerate
   * @keyword-en image-slot-regenerate
   */
  private assertArticleImageSlotExists(
    article: CanvasArticleEntity,
    imageIndex: number,
  ): void {
    if (imageIndex === 0) return;
    const urls = Array.isArray(article.imageUrls) ? article.imageUrls : [];
    const url = String(urls[imageIndex] ?? '').trim();
    if (!url) {
      throw new NotFoundException('ARTICLE_IMAGE_SLOT_NOT_FOUND');
    }
  }

  /**
   * @description 将图文文章图片下标转换为内页生成 role 文案。
   * @param {number} imageIndex - 图片下标。
   * @returns {CanvasInnerImageRole} 内页 role。
   * @keyword-cn 图文内页重生成, 内页角色
   * @keyword-en article-image-regenerate
   * @keyword-en inner-regenerate
   */
  private toArticleInnerRole(imageIndex: number): CanvasInnerImageRole {
    const innerIndex = Math.max(1, Math.min(5, Math.floor(imageIndex)));
    return `inner-${innerIndex}` as CanvasInnerImageRole;
  }

  /**
   * @description 封面生成完成后恢复 Canvas 原状态，若原状态仍是 generating 则落为 completed。
   * @param {CanvasStatus} previousStatus - 进入任务前的状态。
   * @returns {CanvasStatus} 任务成功后的状态。
   * @keyword-cn 封面重生成, 状态恢复
   * @keyword-en cover-regenerate
   * @keyword-en restore-canvas-status
   */
  private resolveCoverFinalStatus(previousStatus: CanvasStatus): CanvasStatus {
    return previousStatus === 'generating' ? 'completed' : previousStatus;
  }

  /**
   * @description 后台执行图文 Canvas 单篇文章封面重生成，只替换 imageUrls/imageIds 的第一项。
   * @param {object} input - 后台任务参数。
   * @returns {Promise<void>}
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en article-cover-only
   */
  private async runArticleCoverRegeneration(input: {
    canvasId: number;
    articleId: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
    prompt?: string;
    previousStatus: CanvasStatus;
  }): Promise<void> {
    await this.runArticleImageRegeneration({ ...input, imageIndex: 0 });
  }

  /**
   * @description 后台执行图文 Canvas 单篇文章指定图片槽位重生成，只替换目标 imageUrls/imageIds 下标。
   * @param {object} input - 后台任务参数。
   * @returns {Promise<void>}
   * @keyword-cn 图文内页重生成, 图片槽位重生成
   * @keyword-en article-image-regenerate
   * @keyword-en image-slot-regenerate
   */
  private async runArticleImageRegeneration(input: {
    canvasId: number;
    articleId: number;
    imageIndex: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
    prompt?: string;
    includeSystemPrompt?: boolean;
    previousStatus: CanvasStatus;
  }): Promise<void> {
    try {
      const canvas = await this.get(input.canvasId, input.tenantId);
      const article = (canvas?.articles ?? []).find(
        (item) => Number(item.id) === Number(input.articleId),
      );
      if (!canvas || !article) throw new Error('CANVAS_ARTICLE_NOT_FOUND');
      this.assertArticleImageSlotExists(article, input.imageIndex);
      // 下标→角色对齐审计：imageIndex=0 走封面提示词，1+ 走内页提示词(任务5)
      this.logger.log(
        `[canvas-article-image] regenerate_role_resolved canvasId=${input.canvasId} articleId=${input.articleId} imageIndex=${input.imageIndex} role=${input.imageIndex === 0 ? 'cover' : this.toArticleInnerRole(input.imageIndex)}`,
      );
      const nextImage =
        input.imageIndex === 0
          ? await this.imageGroupService.regenerateCoverImage({
              userId: input.userId,
              tenantId: input.tenantId,
              topic: canvas.topic,
              articleTitle: article.title,
              articleTags: Array.isArray(article.tags) ? article.tags : [],
              prompt: input.prompt,
              includeSystemPrompt: input.includeSystemPrompt,
              sourceImageIds: input.imageIds,
            })
          : await this.imageGroupService.regenerateInnerImage({
              userId: input.userId,
              tenantId: input.tenantId,
              topic: canvas.topic,
              articleTitle: article.title,
              articleTags: Array.isArray(article.tags) ? article.tags : [],
              role: this.toArticleInnerRole(input.imageIndex),
              prompt: input.prompt,
              includeSystemPrompt: input.includeSystemPrompt,
              sourceImageIds: input.imageIds,
            });
      const nextImageUrls = Array.isArray(article.imageUrls)
        ? [...article.imageUrls]
        : [];
      nextImageUrls[input.imageIndex] = nextImage.url;
      const nextImageIds = Array.isArray(article.imageIds)
        ? [...article.imageIds]
        : [];
      if (Number.isFinite(Number(nextImage.imageId))) {
        nextImageIds[input.imageIndex] = Number(nextImage.imageId);
      }
      await this.updateArticleImages(
        input.canvasId,
        article.id,
        {
          imageUrls: nextImageUrls,
          imageIds: nextImageIds.length > 0 ? nextImageIds : undefined,
        },
        input.tenantId,
      );
      await this.updateStatus(
        input.canvasId,
        this.resolveCoverFinalStatus(input.previousStatus),
        input.tenantId,
      );
    } catch (err) {
      await this.updateStatus(input.canvasId, 'requires_human', input.tenantId);
      this.logger.error(
        `[canvas-article-image] article_image_regenerate_failed canvasId=${input.canvasId} articleId=${input.articleId} imageIndex=${input.imageIndex}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * @description 后台执行图片组 Canvas 封面重生成，只替换目标组 role=cover 的图片。
   * @param {object} input - 后台任务参数。
   * @returns {Promise<void>}
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en image-group-cover-only
   */
  private async runImageGroupCoverRegeneration(input: {
    canvasId: number;
    groupId: number;
    userId: string;
    tenantId?: string;
    imageIds: number[];
    prompt?: string;
    includeSystemPrompt?: boolean;
    previousStatus: CanvasStatus;
  }): Promise<void> {
    await this.runImageGroupImageRegeneration({ ...input, role: 'cover' });
  }

  /**
   * @description 后台执行图片组 Canvas 指定图片槽位重生成，只替换目标组对应 role 的图片。
   * @param {object} input - 后台任务参数。
   * @returns {Promise<void>}
   * @keyword-cn 内页重生成, 图片槽位重生成
   * @keyword-en image-slot-regenerate
   * @keyword-en image-group-image-slot
   */
  private async runImageGroupImageRegeneration(input: {
    canvasId: number;
    groupId: number;
    role: CanvasGroupImageRole;
    userId: string;
    tenantId?: string;
    imageIds: number[];
    prompt?: string;
    includeSystemPrompt?: boolean;
    previousStatus: CanvasStatus;
  }): Promise<void> {
    try {
      const canvas = await this.get(input.canvasId, input.tenantId);
      const groups = Array.isArray(canvas?.imageGroups)
        ? canvas.imageGroups
        : [];
      const group = groups.find(
        (item) => Number(item.id) === Number(input.groupId),
      );
      if (!canvas || !group) throw new Error('CANVAS_IMAGE_GROUP_NOT_FOUND');
      const nextImage =
        input.role === 'cover'
          ? await this.imageGroupService.regenerateCoverImage({
              userId: input.userId,
              tenantId: input.tenantId,
              topic: canvas.topic,
              articleTitle: group.articleTitle,
              prompt: input.prompt,
              includeSystemPrompt: input.includeSystemPrompt,
              sourceImageIds: input.imageIds,
            })
          : await this.imageGroupService.regenerateInnerImage({
              userId: input.userId,
              tenantId: input.tenantId,
              topic: canvas.topic,
              articleTitle: group.articleTitle,
              articleTags: this.readArticleTagsForImageGroup(canvas, group),
              role: input.role as CanvasInnerImageRole,
              prompt: input.prompt,
              includeSystemPrompt: input.includeSystemPrompt,
              sourceImageIds: input.imageIds,
            });
      const nextGroups = groups.map((item) =>
        Number(item.id) === Number(input.groupId)
          ? {
              ...item,
              images: this.replaceGroupImageByRole(item.images, nextImage),
            }
          : item,
      );
      await this.updateImageGroups(
        input.canvasId,
        nextGroups,
        input.tenantId,
        false,
      );
      await this.updateStatus(
        input.canvasId,
        this.resolveCoverFinalStatus(input.previousStatus),
        input.tenantId,
      );
    } catch (err) {
      await this.updateStatus(input.canvasId, 'requires_human', input.tenantId);
      this.logger.error(
        `[canvas-image-slot] image_group_image_regenerate_failed canvasId=${input.canvasId} groupId=${input.groupId} role=${input.role}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * @description 读取图组对应文章标签，供内页重生成提示词补充语义。
   * @param {CanvasEntity} canvas - Canvas 实体。
   * @param {CanvasImageGroup} group - 图片组实体。
   * @returns {string[]} 标签列表。
   * @keyword-cn 内页重生成, 文章标签
   * @keyword-en inner-regenerate
   * @keyword-en image-group-image-slot
   */
  private readArticleTagsForImageGroup(
    canvas: CanvasEntity,
    group: CanvasImageGroup,
  ): string[] {
    const article = (canvas.articles ?? []).find(
      (item) => Number(item.id) === Number(group.articleId),
    );
    if (Array.isArray(article?.tags)) return article.tags;
    const byTitle = (canvas.articles ?? []).find(
      (item) => String(item.title ?? '') === String(group.articleTitle ?? ''),
    );
    return Array.isArray(byTitle?.tags) ? byTitle.tags : [];
  }

  /**
   * @description 替换图片组中的封面图片，若原图组没有封面则插入到第一位。
   * @param {CanvasImageGroup['images']} images - 原图片列表。
   * @param {CanvasImageGroup['images'][number]} cover - 新封面图。
   * @returns {CanvasImageGroup['images']} 替换后的图片列表。
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en replace-cover-image
   */
  private replaceCoverImage(
    images: CanvasImageGroup['images'],
    cover: CanvasImageGroup['images'][number],
  ): CanvasImageGroup['images'] {
    return this.replaceGroupImageByRole(images, cover);
  }

  /**
   * @description 按 role 替换图片组中的指定图片槽位，若原槽位不存在则追加到封面后或列表末尾。
   * @param {CanvasImageGroup['images']} images - 原图片列表。
   * @param {CanvasImageGroup['images'][number]} nextImage - 新图片。
   * @returns {CanvasImageGroup['images']} 替换后的图片列表。
   * @keyword-cn 图片槽位替换, 内页重生成
   * @keyword-en image-slot-regenerate
   * @keyword-en replace-image-slot
   */
  private replaceGroupImageByRole(
    images: CanvasImageGroup['images'],
    nextImage: CanvasImageGroup['images'][number],
  ): CanvasImageGroup['images'] {
    const list = Array.isArray(images) ? [...images] : [];
    const roleIndex = list.findIndex((img) => img.role === nextImage.role);
    if (roleIndex >= 0) {
      list[roleIndex] = nextImage;
      return list;
    }
    if (nextImage.role === 'cover') return [nextImage, ...list];
    const coverIndex = list.findIndex((img) => img.role === 'cover');
    if (coverIndex >= 0) {
      list.splice(coverIndex + 1, 0, nextImage);
      return list;
    }
    return [...list, nextImage];
  }

  /**
   * @description 创建图片组类型 Canvas，立即返回 generating 状态并后台生成图片组。
   * @param {CanvasImageGroupCreateInput} input - 图片组 Canvas 创建参数。
   * @returns {Promise<CanvasEntity>} 新建 Canvas 实体。
   * @keyword-cn 图片组, 异步生成
   * @keyword-en create-image-group-canvas
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
      imageGroupUsage: { status: 'unused' },
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
   * @description 复用生文图片阶段，按文章相关标签生成带封面、内页、拼图及可选 AI 生图的完整图组，不创建独立 Canvas。
   * @param {CanvasImageGroupCreateInput} input - 文章标题、相关图库标签与作用域。
   * @returns {Promise<CanvasImageGroup[]>} 生文工作流渲染完成的文章图组。
   * @keyword-cn 生文配图工作流, 文章图组
   * @keyword-en article-image-workflow, generated-image-group
   */
  async generateArticleImageGroups(
    input: CanvasImageGroupCreateInput,
  ): Promise<CanvasImageGroup[]> {
    return await this.imageGroupService.generateImageGroups(input);
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
    /** 是否去重(默认 true)。false=不去重: 命中已用图、随机取图、生成后不写 isUsed */
    dedup?: boolean;
  }): Promise<CanvasImageGroup[]> {
    const groups = await this.imageGroupService.generateImageGroups({
      userId: input.userId,
      tenantId: input.tenantId,
      topic: input.topic,
      articles: input.articles,
      dedup: input.dedup,
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
    /** 是否去重(默认 true)。false=不去重: 命中已用图、随机取图 */
    dedup?: boolean;
  }): Promise<ImageGroupSourcePreparation> {
    void input.canvasId;
    return await this.imageGroupService.prepareImageGroupSources({
      userId: input.userId,
      tenantId: input.tenantId,
      topic: input.topic,
      articles: input.articles,
      dedup: input.dedup,
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
    /** 是否去重(默认 true)。false=不去重: 生成后不写 isUsed，源图可复用 */
    dedup?: boolean;
  }): Promise<CanvasImageGroup[]> {
    const groups = await this.imageGroupService.renderPreparedImageGroups(
      {
        userId: input.userId,
        tenantId: input.tenantId,
        topic: input.topic,
        articles: input.articles,
        dedup: input.dedup,
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
        dedup: input.dedup,
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
   * @description 将图片组 Canvas 标记为已被生文 Canvas 消费。
   * @param {object} input - 使用标记参数。
   * @returns {Promise<number>} 成功更新的 Canvas 数量。
   * @keyword-cn 图组已使用, 生文消费
   * @keyword-en mark-image-group-used, article-consumption
   */
  async markImageGroupCanvasesUsed(input: {
    sources: Array<{ canvasId: number; groupIds?: number[] }>;
    tenantId?: string;
    usedByCanvasId?: number;
    usedByArticleIds?: number[];
    usedAt?: Date;
  }): Promise<number> {
    const sourceMap = new Map<number, Set<number>>();
    for (const source of input.sources ?? []) {
      const canvasId = Math.floor(Number(source?.canvasId));
      if (!Number.isFinite(canvasId) || canvasId <= 0) continue;
      const set = sourceMap.get(canvasId) ?? new Set<number>();
      for (const rawGroupId of source.groupIds ?? []) {
        const groupId = Math.floor(Number(rawGroupId));
        if (Number.isFinite(groupId) && groupId > 0) set.add(groupId);
      }
      sourceMap.set(canvasId, set);
    }
    if (sourceMap.size === 0) return 0;

    const usedAt = input.usedAt ?? new Date();
    let modified = 0;
    for (const [canvasId, groupIds] of sourceMap.entries()) {
      const canvas = await this.get(canvasId, input.tenantId);
      const allGroupIds = (canvas?.imageGroups ?? [])
        .map((group) => Math.floor(Number(group?.id)))
        .filter((id) => Number.isFinite(id) && id > 0);
      const existingUsedGroupIds = new Set(
        (canvas?.imageGroupUsage?.usedGroupIds ?? [])
          .map((groupId) => Math.floor(Number(groupId)))
          .filter((groupId) => Number.isFinite(groupId) && groupId > 0),
      );
      const groupIdsToMark =
        groupIds.size > 0 ? Array.from(groupIds) : allGroupIds;
      for (const groupId of groupIdsToMark) existingUsedGroupIds.add(groupId);
      const nextUsedGroupIds = Array.from(existingUsedGroupIds).sort(
        (a, b) => a - b,
      );
      const nextStatus =
        allGroupIds.length > 0 &&
        allGroupIds.every((groupId) => existingUsedGroupIds.has(groupId))
          ? 'used'
          : nextUsedGroupIds.length > 0
            ? 'partial'
            : 'unused';
      const res = await this.canvases.updateOne(
        {
          id: canvasId,
          type: 'image-group',
          ...this.buildTenantFilter(input.tenantId),
        },
        {
          $set: {
            imageGroupUsage: {
              status: nextStatus,
              usedAt,
              usedByCanvasId: input.usedByCanvasId,
              usedByArticleIds: Array.isArray(input.usedByArticleIds)
                ? input.usedByArticleIds
                : undefined,
              usedGroupIds: nextUsedGroupIds,
            },
            updatedAt: new Date(),
          },
        },
      );
      modified += res.modifiedCount;
    }
    return modified;
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
