import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { mkdirSync, existsSync } from 'fs';
import { Collection, Db, ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import { join, resolve, extname } from 'path';
import { EmbeddingService } from '../../shared/embedding/embedding.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import type {
  GalleryImageCreateInput,
  GalleryImageEntity,
  GallerySearchResult,
} from '../entities/gallery-image.entity.js';
import { AI_GENERATED_IMAGE_TAG } from '../gallery.constants.js';

/**
 * @description 图库中由系统写入的封面类标签。
 * @keyword-cn 系统封面标签, 图库标签
 * @keyword-en system-cover-tags, gallery-tags
 */
export const GALLERY_COVER_TAGS = [
  '封面',
  '拼图封面',
  '自动封面',
  'canvas封面',
] as const;

@Injectable()
export class GalleryService {
  private readonly images: Collection<GalleryImageEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly VECTOR_INDEX_NAME = 'gallery_image_embedding_index';
  /** 精确封面标签枚举（系统写入的类型标记，非用户描述关键词） */
  private readonly COVER_TAGS = [...GALLERY_COVER_TAGS];
  private readonly coverTagSet = new Set<string>(GALLERY_COVER_TAGS);
  private isAtlasAvailable: boolean | null = null;
  private jimpModulePromise: Promise<unknown> | null = null;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly embedding: EmbeddingService,
    private readonly adminService: AdminService,
  ) {
    this.images = db.collection<GalleryImageEntity>('gallery_images');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 按图片 ID 精确读取当前租户可见图片，并按输入 ID 顺序返回。
   * @param {string | undefined} userId - 用户 ID。
   * @param {string | undefined} tenantId - 租户 ID。
   * @param {number[]} ids - 图片业务 ID 列表。
   * @returns {Promise<GalleryImageEntity[]>} 可见图片列表。
   * @keyword-cn 封面重生成, 图片选择
   * @keyword-en cover-regenerate
   * @keyword-en selected-source-images
   */
  async findAccessibleImagesByIds(
    userId: string | undefined,
    tenantId: string | undefined,
    ids: number[],
  ): Promise<GalleryImageEntity[]> {
    const orderedIds = Array.from(
      new Set(
        (Array.isArray(ids) ? ids : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.floor(id)),
      ),
    );
    if (orderedIds.length === 0) return [];
    const rows = await this.images
      .find(
        {
          $and: [
            this.buildTenantFilter(userId, tenantId),
            { id: { $in: orderedIds } },
          ],
        },
        { projection: { _id: 0 } },
      )
      .toArray();
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    return orderedIds
      .map((id) => byId.get(id))
      .filter((img): img is GalleryImageEntity => !!img)
      .map((img) => this.toPublicImage(img) as GalleryImageEntity);
  }

  /**
   * @description 创建图库租户、标签、时间线与完整收藏排序索引，并删除较短的收藏前缀索引。
   * @returns {Promise<void>} 无返回值。
   * @throws {Error} 当MongoDB创建索引或写入计数器失败时抛出。
   * @keyword-cn 图库索引, 收藏排序
   * @keyword-en gallery-indexes, favorite-sorting
   * @since 2026-02-04
   */
  async ensureIndexes(): Promise<void> {
    await this.images.createIndex({ id: 1 }, { unique: true });
    await this.images.createIndex({ userId: 1 });
    await this.images.createIndex({ groupId: 1, createdAt: -1 });
    await this.images.createIndex({ tags: 1 });
    await this.images.createIndex({ isCollage: 1, updatedAt: -1 });
    await this.images.createIndex({ createdAt: -1 });
    // 租户隔离索引
    await this.images.createIndex({ scope: 1, tenantId: 1, userId: 1 });
    await this.images.createIndex({ scope: 1, tenantId: 1, tags: 1 });
    await this.images.createIndex({ tenantId: 1, tags: 1 });
    await this.images.createIndex({ tenantId: 1, createdAt: -1, id: -1 });
    await this.images.createIndex({
      tenantId: 1,
      favorite: -1,
      favoritedAt: -1,
      createdAt: -1,
      id: -1,
    });
    await this.images
      .dropIndex('tenantId_1_favorite_-1_favoritedAt_-1')
      .catch(() => undefined);
    const exists = await this.counters.findOne({ _id: 'gallery_images' });
    if (!exists)
      await this.counters.insertOne({ _id: 'gallery_images', seq: 0 });
  }

  /**
   * @description 获取图片自增ID。
   * @returns {Promise<number>} 下一个可用的自增ID。
   * @throws {Error} 当计数器更新失败时抛出。
   * @keyword gallery, counter, id
   * @since 2026-02-04
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'gallery_images' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 构造用于生成Embedding的文本（描述+标签+文件名）。
   * @param {GalleryImageCreateInput} input - 图片创建输入。
   * @returns {string} 用于Embedding的拼接文本。
   * @keyword gallery, embedding, text
   * @since 2026-02-04
   */
  private buildEmbeddingText(input: GalleryImageCreateInput): string {
    const parts = [
      input.description,
      ...(input.tags ?? []),
      input.originalName,
      input.fileName,
    ];
    return parts
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0)
      .join(' ');
  }

  /**
   * @description 从已存在的图片实体字段构造用于生成Embedding的文本。
   * @param {Pick<GalleryImageEntity, 'description' | 'tags' | 'originalName' | 'fileName'>} img - 图片实体的必要字段。
   * @returns {string} 用于Embedding的拼接文本。
   * @keyword gallery, embedding, rebuild
   * @since 2026-02-04
   */
  private buildEmbeddingTextFromEntity(
    img: Pick<
      GalleryImageEntity,
      'description' | 'tags' | 'originalName' | 'fileName'
    >,
  ): string {
    const parts = [
      img.description,
      ...(Array.isArray(img.tags) ? img.tags : []),
      img.originalName,
      img.fileName,
    ];
    return parts
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0)
      .join(' ');
  }

  /**
   * @description 将输入的标签集合（string 或 string[]）标准化为去重后的字符串数组。
   * @param {unknown} tags - 原始标签输入。
   * @returns {string[]} 规范化后的标签数组。
   * @keyword-cn 标签规整, 标签去重
   * @keyword-en tag-normalization, tag-deduplication
   * @since 2026-02-04
   */
  private normalizeTags(tags: unknown): string[] {
    const list = Array.isArray(tags)
      ? tags
      : typeof tags === 'string'
        ? tags.split(/[,\t\n\r\s]+/g)
        : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
      const t = String(raw ?? '')
        .trim()
        .replace(/^#+/, '');
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  /**
   * @description 把数据库图片归一化为对外图片，补齐历史数据缺失的图库重构字段并移除Mongo主键。
   * @keyword-cn 图片公开归一化, 历史默认值
   * @keyword-en public-image-normalization, legacy-defaults
   */
  toPublicImage(
    image: GalleryImageEntity | Omit<GalleryImageEntity, '_id'>,
  ): Omit<GalleryImageEntity, '_id'> {
    const raw = image as GalleryImageEntity & { _id?: ObjectId };
    const { _id: _ignored, ...clean } = raw;
    return {
      ...clean,
      favorite: raw.favorite === true,
      note: typeof raw.note === 'string' ? raw.note : '',
      aiFaceProtected: raw.aiFaceProtected === true,
    };
  }

  /**
   * @description 返回标签库统计应排除的系统封面标签。
   * @keyword-cn 系统标签列表, 标签库排除
   * @keyword-en system-tag-list, tag-library-exclusion
   */
  getSystemTags(): string[] {
    return [...this.COVER_TAGS];
  }

  /**
   * @description 判断给定绝对路径是否位于 public 目录下，用于删除文件安全校验。
   * @param {string} p - 绝对路径。
   * @returns {boolean} 是否为允许删除的 public 子路径。
   * @keyword gallery, delete, safety
   * @since 2026-02-04
   */
  private isSafePublicPath(p: string): boolean {
    const raw = String(p || '').trim();
    if (!raw) return false;
    const root = resolve(join(process.cwd(), 'public'));
    const norm = (s: string) => resolve(s).replace(/\\/g, '/').toLowerCase();
    const rootNorm = norm(root);
    const fileNorm = norm(raw);
    return fileNorm === rootNorm || fileNorm.startsWith(`${rootNorm}/`);
  }

  /**
   * @description 在安全校验通过的前提下尝试删除文件（忽略不存在等错误）。
   * @param {string} [p] - 绝对路径。
   * @returns {Promise<boolean>} 是否删除成功。
   * @keyword gallery, delete, fs
   * @since 2026-02-04
   */
  private async unlinkIfSafe(p?: string): Promise<boolean> {
    const s = typeof p === 'string' ? p.trim() : '';
    if (!s) return false;
    if (!this.isSafePublicPath(s)) return false;
    try {
      await fs.unlink(s);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @description 批量创建图片记录，并为每条记录生成Embedding。
   * @param {GalleryImageCreateInput[]} inputs - 批量创建输入。
   * @returns {Promise<GalleryImageEntity[]>} 新建图片实体数组。
   * @throws {Error} 当数据库写入失败或Embedding服务异常且未能回退时抛出。
   * @keyword-cn 图片批量创建, 元数据默认值
   * @keyword-en batch-image-create, metadata-defaults
   * @since 2026-02-04
   */
  async createMany(
    inputs: GalleryImageCreateInput[],
  ): Promise<GalleryImageEntity[]> {
    if (!Array.isArray(inputs) || inputs.length === 0) return [];

    const now = new Date();
    const ids = await Promise.all(inputs.map(() => this.nextId()));
    const texts = inputs.map((i) => this.buildEmbeddingText(i));
    const embeddingConfig = await this.resolveDefaultEmbeddingConfig();
    let embeddings: number[][] = [];
    try {
      embeddings = await this.embedding.embedBatch(texts, embeddingConfig);
    } catch (error) {
      console.warn(
        '[GalleryService.createMany] embedBatch failed, fallback to zero vectors:',
        error,
      );
      embeddings = Array.from({ length: inputs.length }, () =>
        new Array<number>(768).fill(0),
      );
    }

    const docs: GalleryImageEntity[] = inputs.map((input, idx) => {
      const w = Number.isFinite(Number(input.width))
        ? Math.floor(Number(input.width))
        : undefined;
      const h = Number.isFinite(Number(input.height))
        ? Math.floor(Number(input.height))
        : undefined;
      const isPortrait = w !== undefined && h !== undefined ? h > w : undefined;
      return {
        _id: new ObjectId(),
        id: ids[idx],
        userId: input.userId,
        scope: (input.scope ?? 'tenant') as 'platform' | 'tenant',
        tenantId: input.tenantId,
        groupId: input.groupId,
        originalName: input.originalName,
        fileName: input.fileName,
        url: input.url,
        thumbFileName: input.thumbFileName,
        thumbUrl: input.thumbUrl,
        absPath: input.absPath,
        mimeType: input.mimeType,
        size: input.size,
        width: w,
        height: h,
        isPortrait,
        tags: Array.isArray(input.tags) ? input.tags : [],
        description: input.description,
        favorite: input.favorite === true,
        favoritedAt:
          input.favorite === true ? (input.favoritedAt ?? now) : undefined,
        note: typeof input.note === 'string' ? input.note.slice(0, 500) : '',
        aiFaceProtected: input.aiFaceProtected === true,
        isCollage: input.isCollage === true,
        collageSourceImageIds: Array.isArray(input.collageSourceImageIds)
          ? input.collageSourceImageIds
              .map((x) => Number(x))
              .filter((x) => Number.isFinite(x))
              .slice(0, 2)
          : undefined,
        collageMeta:
          input.collageMeta &&
          Number.isFinite(Number(input.collageMeta.width)) &&
          Number.isFinite(Number(input.collageMeta.height)) &&
          Number.isFinite(Number(input.collageMeta.dpi))
            ? {
                width: Math.max(1, Math.floor(Number(input.collageMeta.width))),
                height: Math.max(
                  1,
                  Math.floor(Number(input.collageMeta.height)),
                ),
                dpi: Math.max(1, Math.floor(Number(input.collageMeta.dpi))),
              }
            : undefined,
        embedding:
          Array.isArray(embeddings[idx]) && embeddings[idx].length > 0
            ? embeddings[idx]
            : new Array<number>(768).fill(0),
        createdAt: now,
        updatedAt: now,
      };
    });

    await this.images.insertMany(docs);
    return docs.map((doc) => ({
      ...this.toPublicImage(doc),
      _id: doc._id,
    }));
  }

  /**
   * @description 按租户可见性查找图片，兼容旧游标分页并支持多标签、收藏、随机与收藏优先排序。
   * @param {string} userId - 用户ID
   * @param {string} [tenantId] - 租户ID
   * @param {Object} [options] - 查询选项
   * @param {number} [options.groupId] - 图库组ID
   * @param {string} [options.tag] - 标签
   * @param {number} [options.cursorId] - 游标
   * @param {number} [options.limit=50] - 返回条数
   * @param {'asc'|'desc'} [options.sortOrder='desc'] - 旧创建时间排序方向
   * @returns {Promise<GalleryImageEntity[]>} 图片列表
   * @keyword-cn 租户图片查询, 图库多条件排序
   * @keyword-en tenant-image-query, gallery-multi-sort
   * @since 2026-03-23
   */
  async findAccessibleImages(
    userId: string | undefined,
    tenantId?: string,
    options?: {
      groupId?: string | number;
      tag?: string;
      cursorId?: number;
      limit?: number;
      includeCollage?: boolean;
      imageType?: 'all' | 'regular' | 'collage';
      sortOrder?: 'asc' | 'desc';
      sort?: 'newest' | 'oldest' | 'random' | 'favorite';
      tags?: string[];
      favoriteOnly?: boolean;
      offset?: number;
    },
  ): Promise<GalleryImageEntity[]> {
    const {
      groupId,
      tag,
      cursorId,
      limit = 50,
      includeCollage = true,
      imageType,
      sortOrder = 'desc',
      sort,
      tags,
      favoriteOnly = false,
      offset = 0,
    } = options ?? {};
    const resolvedSort = sort ?? (sortOrder === 'asc' ? 'oldest' : 'newest');
    const sortDirection = resolvedSort === 'oldest' ? 1 : -1;
    const clauses: Record<string, unknown>[] = [
      this.buildTenantFilter(userId, tenantId),
    ];
    if (imageType && imageType !== 'all') {
      clauses.push(this.buildImageTypeFilter(imageType));
    } else if (!includeCollage) {
      clauses.push({ isCollage: { $ne: true } });
    }
    if (groupId !== undefined) clauses.push({ groupId });
    const normalizedTags = this.normalizeTags(tags);
    if (normalizedTags.length > 0) {
      clauses.push({ tags: { $all: normalizedTags } });
    }
    if (tag) clauses.push({ tags: tag });
    if (favoriteOnly) clauses.push({ favorite: true });
    if (
      (resolvedSort === 'newest' || resolvedSort === 'oldest') &&
      typeof cursorId === 'number' &&
      Number.isFinite(cursorId)
    ) {
      clauses.push({
        id: sortDirection === 1 ? { $gt: cursorId } : { $lt: cursorId },
      });
    }
    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    if (resolvedSort === 'random') {
      const rows = await this.images
        .aggregate<GalleryImageEntity>([
          { $match: filter },
          { $sample: { size: lim } },
          { $project: { _id: 0 } },
        ])
        .toArray();
      return rows.map((row) => this.toPublicImage(row) as GalleryImageEntity);
    }
    const query = this.images.find(filter, { projection: { _id: 0 } });
    if (resolvedSort === 'favorite') {
      query
        .sort({ favorite: -1, favoritedAt: -1, createdAt: -1, id: -1 })
        .skip(Math.max(0, Math.floor(offset)));
    } else {
      query.sort({ createdAt: sortDirection, id: sortDirection });
    }
    const rows = await query.limit(lim).toArray();
    return rows.map((row) => this.toPublicImage(row) as GalleryImageEntity);
  }

  /**
   * @description 精确统计当前图片可见范围内的图片、收藏和去重标签数量。
   * @keyword-cn 图库精确统计, 可见范围计数
   * @keyword-en gallery-exact-stats, visibility-count
   */
  async getAccessibleStats(
    userId: string | undefined,
    tenantId?: string,
  ): Promise<{ images: number; favorites: number; tags: number }> {
    const filter = this.buildTenantFilter(userId, tenantId);
    const [images, favorites, tags] = await Promise.all([
      this.images.countDocuments(filter),
      this.images.countDocuments({ $and: [filter, { favorite: true }] }),
      this.images.distinct('tags', filter),
    ]);
    return {
      images,
      favorites,
      tags: new Set(tags.map((tag) => String(tag ?? '').trim()).filter(Boolean))
        .size,
    };
  }

  /**
   * @description 更新当前可见范围内的一张图片备注、收藏、人脸保护和标签。
   * @keyword-cn 单图元数据更新, 图片可见范围
   * @keyword-en single-image-metadata, image-visibility
   */
  async updateImageMeta(input: {
    userId?: string;
    tenantId?: string;
    id: number;
    note?: string;
    favorite?: boolean;
    aiFaceProtected?: boolean;
    addTags?: string[];
    removeTags?: string[];
  }): Promise<Omit<GalleryImageEntity, '_id'> | null> {
    const filter = {
      $and: [
        this.buildTenantFilter(input.userId, input.tenantId),
        { id: input.id },
      ],
    };
    const current = await this.images.findOne(filter);
    if (!current) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const unset: Record<string, ''> = {};
    if (typeof input.note === 'string') set.note = input.note.slice(0, 500);
    if (typeof input.aiFaceProtected === 'boolean') {
      set.aiFaceProtected = input.aiFaceProtected;
    }
    if (typeof input.favorite === 'boolean') {
      set.favorite = input.favorite;
      if (input.favorite) set.favoritedAt = new Date();
      else unset.favoritedAt = '';
    }
    const add = this.normalizeTags(input.addTags);
    const remove = new Set(this.normalizeTags(input.removeTags));
    if (add.length > 0 || remove.size > 0) {
      set.tags = Array.from(
        new Set([
          ...this.normalizeTags(current.tags).filter((tag) => !remove.has(tag)),
          ...add,
        ]),
      );
    }
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const result = await this.images.findOneAndUpdate(filter, update, {
      returnDocument: 'after',
      includeResultMetadata: true,
    });
    return result.value ? this.toPublicImage(result.value) : null;
  }

  /**
   * @description 批量更新当前可见图片元数据，追加备注时按行去重并限制总长度。
   * @keyword-cn 批量元数据更新, 备注按行去重
   * @keyword-en batch-image-metadata, deduplicate-note-lines
   */
  async updateImagesMetaBatch(input: {
    userId?: string;
    tenantId?: string;
    ids: Array<string | number>;
    note?: string;
    noteMode?: 'replace' | 'append';
    favorite?: boolean;
    aiFaceProtected?: boolean;
    addTags?: string[];
    removeTags?: string[];
  }): Promise<{ updated: number }> {
    const ids = Array.from(
      new Set(
        input.ids
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.floor(id)),
      ),
    ).slice(0, 500);
    if (ids.length === 0) return { updated: 0 };
    const rows = await this.images
      .find({
        $and: [
          this.buildTenantFilter(input.userId, input.tenantId),
          { id: { $in: ids } },
        ],
      })
      .toArray();
    const add = this.normalizeTags(input.addTags);
    const remove = new Set(this.normalizeTags(input.removeTags));
    const now = new Date();
    const operations = rows.map((row) => {
      const set: Record<string, unknown> = { updatedAt: now };
      const unset: Record<string, ''> = {};
      if (typeof input.note === 'string') {
        set.note =
          input.noteMode === 'append'
            ? this.appendNoteLines(row.note, input.note)
            : input.note.slice(0, 500);
      }
      if (typeof input.aiFaceProtected === 'boolean') {
        set.aiFaceProtected = input.aiFaceProtected;
      }
      if (typeof input.favorite === 'boolean') {
        set.favorite = input.favorite;
        if (input.favorite) set.favoritedAt = now;
        else unset.favoritedAt = '';
      }
      if (add.length > 0 || remove.size > 0) {
        set.tags = Array.from(
          new Set([
            ...this.normalizeTags(row.tags).filter((tag) => !remove.has(tag)),
            ...add,
          ]),
        );
      }
      const update: Record<string, unknown> = { $set: set };
      if (Object.keys(unset).length > 0) update.$unset = unset;
      return { updateOne: { filter: { _id: row._id }, update } };
    });
    if (operations.length === 0) return { updated: 0 };
    await this.images.bulkWrite(operations, { ordered: false });
    return { updated: operations.length };
  }

  /**
   * @description 将新备注按非空行追加到旧备注，忽略已有同文并限制为500字。
   * @keyword-cn 备注追加, 文本去重
   * @keyword-en append-note, text-deduplication
   */
  private appendNoteLines(current: unknown, incoming: unknown): string {
    const lines = String(current ?? '')
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    const seen = new Set(lines);
    for (const line of String(incoming ?? '').split(/\r?\n/g)) {
      const text = line.trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        lines.push(text);
      }
    }
    return lines.join('\n').slice(0, 500);
  }

  /**
   * @description 用图片已有向量查找相似图，无有效向量或计算失败时按共同标签和时间兜底。
   * @keyword-cn 相似图片, 标签相似兜底
   * @keyword-en similar-images, tag-similarity-fallback
   */
  async findSimilarImages(input: {
    userId?: string;
    tenantId?: string;
    id: number;
    limit: number;
  }): Promise<Array<Omit<GalleryImageEntity, '_id'>>> {
    const scope = this.buildTenantFilter(input.userId, input.tenantId);
    const source = await this.images.findOne({
      $and: [scope, { id: input.id }],
    });
    if (!source) return [];
    const candidates = await this.images
      .find({ $and: [scope, { id: { $ne: input.id } }] })
      .toArray();
    const limit = Math.max(1, Math.min(30, Math.floor(input.limit || 12)));
    const sourceEmbedding = Array.isArray(source.embedding)
      ? source.embedding
      : [];
    const hasVector = sourceEmbedding.some(
      (value) => Number.isFinite(value) && value !== 0,
    );
    if (hasVector) {
      try {
        const vectorRows = candidates
          .filter(
            (row) =>
              Array.isArray(row.embedding) &&
              row.embedding.length === sourceEmbedding.length,
          )
          .map((image) => ({
            image,
            score: this.embedding.cosineSimilarity(
              sourceEmbedding,
              image.embedding,
            ),
          }))
          .filter((entry) => Number.isFinite(entry.score))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        if (vectorRows.length > 0) {
          return vectorRows.map(({ image }) => this.toPublicImage(image));
        }
      } catch {
        // 向量不可用时继续走共同标签兜底。
      }
    }
    const sourceTags = new Set(Array.isArray(source.tags) ? source.tags : []);
    return candidates
      .map((image) => ({
        image,
        commonTags: (Array.isArray(image.tags) ? image.tags : []).filter(
          (tag) => sourceTags.has(tag),
        ).length,
      }))
      .sort(
        (a, b) =>
          b.commonTags - a.commonTags ||
          new Date(b.image.createdAt).getTime() -
            new Date(a.image.createdAt).getTime(),
      )
      .slice(0, limit)
      .map(({ image }) => this.toPublicImage(image));
  }

  /**
   * @description 从可见图片移除指定标签，并把标签文字按行去重追加到备注。
   * @keyword-cn 标签转备注, 图片批量迁移
   * @keyword-en tags-to-note, image-batch-migration
   */
  async convertTagsToNote(input: {
    userId?: string;
    tenantId?: string;
    tags: string[];
  }): Promise<{ updated: number }> {
    const tags = this.normalizeTags(input.tags).slice(0, 50);
    if (tags.length === 0) return { updated: 0 };
    const rows = await this.images
      .find({
        $and: [
          this.buildTenantFilter(input.userId, input.tenantId),
          { tags: { $in: tags } },
        ],
      })
      .toArray();
    const now = new Date();
    const operations = rows.map((row) => {
      const matched = tags.filter((tag) => row.tags?.includes(tag));
      return {
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              note: this.appendNoteLines(row.note, matched.join('\n')),
              updatedAt: now,
            },
            $pull: { tags: { $in: matched } },
          },
        },
      };
    });
    if (operations.length === 0) return { updated: 0 };
    await this.images.bulkWrite(operations, { ordered: false });
    return { updated: operations.length };
  }

  /**
   * @description 构建租户过滤条件
   * @param {string} userId - 用户ID
   * @param {string} [tenantId] - 租户ID
   * @returns {Record<string, unknown>} MongoDB filter 对象
   * @keyword-en build tenant filter
   * @since 2026-03-23
   */
  private buildTenantFilter(
    userId: string | undefined,
    tenantId?: string,
  ): Record<string, unknown> {
    const currentTenantId = tenantId?.trim();
    const base: Record<string, unknown> = {};
    // if (userId) base.userId = userId;
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
   * @description 构建图片类型 DB 过滤条件；普通图排除拼图、封面标签与 AI 生成素材，拼图口径保持不变。
   * @param {'regular' | 'collage'} imageType - 目标图片类型。
   * @returns {Record<string, unknown>} MongoDB filter 对象。
   * @keyword-cn 普通图筛选, AI素材排除
   * @keyword-en regular-image-filter, exclude-ai-material
   */
  private buildImageTypeFilter(
    imageType: 'regular' | 'collage',
  ): Record<string, unknown> {
    if (imageType === 'regular') {
      // Exclude collages, system cover images, and AI-generated materials.
      return {
        isCollage: { $ne: true },
        tags: { $nin: [...this.COVER_TAGS, AI_GENERATED_IMAGE_TAG] },
      };
    }
    return {
      $or: [{ isCollage: true }, { tags: { $in: this.COVER_TAGS } }],
    };
  }

  /**
   * @description 内存层图片类型匹配；普通图排除拼图、封面标签与 AI 生成素材，用于 Atlas 向量搜索结果后处理。
   * @param {GalleryImageEntity} image - 图片对象。
   * @param {'all' | 'regular' | 'collage'} imageType - 目标类型。
   * @returns {boolean}
   * @keyword-cn 普通图内存筛选, AI素材排除
   * @keyword-en in-memory-image-filter, exclude-ai-material
   */
  private matchesImageType(
    image: GalleryImageEntity,
    imageType: 'all' | 'regular' | 'collage',
  ): boolean {
    if (imageType === 'all') return true;
    const tags = Array.isArray(image.tags) ? image.tags : [];
    const isCover =
      image.isCollage === true ||
      tags.some((t) => this.coverTagSet.has(String(t ?? '').trim()));
    if (imageType === 'regular') {
      return !isCover && !tags.includes(AI_GENERATED_IMAGE_TAG);
    }
    return isCover;
  }

  /**
   * @description 按租户过滤列出标签
   * @param {string} userId - 用户ID
   * @param {string} [tenantId] - 租户ID
   * @param {number} [limit=500] - 返回条数
   * @returns {Promise<string[]>} 标签列表
   * @keyword-en list tags with tenant filter
   * @since 2026-03-23
   */
  async listDistinctTagsWithTenant(
    userId: string | undefined,
    tenantId?: string,
    limit = 500,
  ): Promise<string[]> {
    const filter = this.buildTenantFilter(userId, tenantId);
    const raw = await this.images.distinct('tags', filter);
    const list = (Array.isArray(raw) ? raw : [])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of list) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    out.sort((a, b) => a.localeCompare(b));
    const lim = Math.max(1, Math.min(5000, Math.floor(limit || 500)));
    console.log(filter, raw);
    return out.slice(0, lim);
  }

  /**
   * @description 列出图片，支持按 userId/tag/groupId 过滤，并支持基于自增 id 的游标分页。
   * @param {string} [userId] - 用户ID。
   * @param {number} [groupId] - 图库组ID。
   * @param {string} [tag] - 标签。
   * @param {number} [cursorId] - 游标：仅返回 id < cursorId 的更早数据。
   * @param {number} [limit=50] - 返回条数上限。
   * @returns {Promise<GalleryImageEntity[]>} 图片列表。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword gallery, list, pagination
   * @since 2026-02-04
   */
  async list(
    userId?: string,
    groupId?: string | number,
    tag?: string,
    cursorId?: number,
    limit = 50,
  ): Promise<GalleryImageEntity[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
    if (
      groupId !== undefined &&
      (typeof groupId === 'number'
        ? Number.isFinite(groupId)
        : typeof groupId === 'string')
    )
      filter.groupId = groupId;
    if (tag) filter.tags = tag;
    if (typeof cursorId === 'number' && Number.isFinite(cursorId)) {
      filter.id = { $lt: cursorId };
    }
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = await this.images
      .find(filter, { projection: { _id: 0 } })
      .sort({ id: -1 })
      .limit(lim)
      .toArray();
    return rows.map((row) => this.toPublicImage(row) as GalleryImageEntity);
  }

  /**
   * @description 列出某用户下所有已出现的标签（distinct tags）。
   * @param {string} [userId] - 用户ID过滤。
   * @param {number} [limit=500] - 返回条数上限。
   * @returns {Promise<string[]>} 标签列表。
   * @throws {Error} 当MongoDB distinct 查询失败时抛出。
   * @keyword gallery, tag, list
   * @since 2026-02-04
   */
  async listDistinctTags(userId?: string, limit = 500): Promise<string[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
    const raw = await this.images.distinct('tags', filter);
    const list = (Array.isArray(raw) ? raw : [])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of list) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    out.sort((a, b) => a.localeCompare(b));
    const lim = Math.max(1, Math.min(5000, Math.floor(limit || 500)));
    return out.slice(0, lim);
  }

  async listDistinctTagsByGroup(
    userId: string | undefined,
    groupId: number | undefined,
    limit = 500,
  ): Promise<string[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
    if (
      groupId !== undefined &&
      (typeof groupId === 'number'
        ? Number.isFinite(groupId)
        : typeof groupId === 'string')
    ) {
      filter.groupId = groupId;
    }
    const raw = await this.images.distinct('tags', filter);
    const list = (Array.isArray(raw) ? raw : [])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of list) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    out.sort((a, b) => a.localeCompare(b));
    const lim = Math.max(1, Math.min(5000, Math.floor(limit || 500)));
    return out.slice(0, lim);
  }

  /**
   * @description 按 tags 检索图片。默认排除 isUsed=true（已被生成消耗）的图片,
   *  传 includeUsed=true 可关闭该过滤（用于素材管理类查询）。
   * @keyword-en search images by tags, defaults to excluding used images
   */
  async searchByTags(input: {
    userId?: string;
    tenantId?: string;
    groupId?: string | number;
    tags: string[];
    limit?: number;
    matchCollage?: boolean;
    imageType?: 'all' | 'regular' | 'collage';
    /** 是否包含已使用 (isUsed=true) 图片, 默认 false */
    includeUsed?: boolean;
  }): Promise<GalleryImageEntity[]> {
    const tags = Array.isArray(input?.tags)
      ? input.tags.map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    if (tags.length === 0) return [];
    const clauses: Record<string, unknown>[] = [
      this.buildTenantFilter(input.userId, input.tenantId),
      { tags: { $in: tags } },
    ];
    if (input.imageType && input.imageType !== 'all') {
      clauses.push(this.buildImageTypeFilter(input.imageType));
    } else if (input.matchCollage === false) {
      clauses.push({ isCollage: { $ne: true } });
    }
    if (
      input.groupId !== undefined &&
      ((typeof input.groupId === 'number' && Number.isFinite(input.groupId)) ||
        typeof input.groupId === 'string')
    ) {
      clauses.push({ groupId: input.groupId });
    }
    if (input.includeUsed !== true) {
      clauses.push({ isUsed: { $ne: true } });
    }
    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
    const lim = Math.max(1, Math.min(200, Math.floor(input.limit ?? 24)));
    const rows = await this.images
      .find(filter, { projection: { _id: 0 } })
      .sort({ id: -1 })
      .limit(lim)
      .toArray();
    return rows.map((row) => this.toPublicImage(row) as GalleryImageEntity);
  }

  /**
   * @description 统计指定 tags 当前可用图片数(默认已排除 isUsed)。用于生成前的不足量预估。
   *  返回 byTag 字典(每个 tag 单独 count) + total(去重后总数,$or 匹配任一 tag)。
   *  传 includeUsed=true 关闭 isUsed 过滤(不去重生成时统计全量)。
   * @keyword-en count available images by tags excluding used by default
   */
  async countAvailableByTags(input: {
    userId?: string;
    tenantId?: string;
    tags: string[];
    imageType?: 'all' | 'regular' | 'collage';
    /** 是否包含已使用 (isUsed=true) 图片, 默认 false(去重统计) */
    includeUsed?: boolean;
  }): Promise<{ total: number; byTag: Record<string, number> }> {
    const tags = Array.isArray(input?.tags)
      ? input.tags.map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    if (tags.length === 0) return { total: 0, byTag: {} };
    const baseClauses: Record<string, unknown>[] = [
      this.buildTenantFilter(input.userId, input.tenantId),
    ];
    if (input.includeUsed !== true) {
      baseClauses.push({ isUsed: { $ne: true } });
    }
    if (input.imageType && input.imageType !== 'all') {
      baseClauses.push(this.buildImageTypeFilter(input.imageType));
    }
    const byTag: Record<string, number> = {};
    for (const t of tags) {
      const filter = { $and: [...baseClauses, { tags: t }] };
      byTag[t] = await this.images.countDocuments(filter);
    }
    const totalFilter = { $and: [...baseClauses, { tags: { $in: tags } }] };
    const total = await this.images.countDocuments(totalFilter);
    return { total, byTag };
  }

  /**
   * @description 列出租户可见的热门 tag (按图片数量倒序),用于 AI 推荐 tag 选择。
   *  自动过滤 isUsed=true 的图片,避免推荐已耗尽的 tag。
   * @keyword-en list top tags by image count for AI recommendation
   */
  async listTopTagsWithCount(input: {
    userId?: string;
    tenantId?: string;
    limit?: number;
    imageType?: 'all' | 'regular' | 'collage';
  }): Promise<Array<{ tag: string; count: number }>> {
    const matchClauses: Record<string, unknown>[] = [
      this.buildTenantFilter(input.userId, input.tenantId),
      { isUsed: { $ne: true } },
      { tags: { $exists: true, $ne: [] } },
    ];
    if (input.imageType && input.imageType !== 'all') {
      matchClauses.push(this.buildImageTypeFilter(input.imageType));
    }
    const lim = Math.max(1, Math.min(50, Math.floor(input.limit ?? 12)));
    const pipe: Record<string, unknown>[] = [
      { $match: { $and: matchClauses } },
      { $unwind: '$tags' },
      { $match: { tags: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: lim },
      { $project: { _id: 0, tag: '$_id', count: 1 } },
    ];
    return this.images
      .aggregate<{ tag: string; count: number }>(pipe)
      .toArray();
  }

  /**
   * @description 批量标记图片为已使用 (isUsed=true)。生成图组/拼图完成后调用,
   *  消耗的原图后续不再被 searchByTags 默认查询命中。传 reset=true 可反向重置(将 isUsed 设回 false,清空 usedAt)。
   * @keyword-en mark images as used or reset to unused
   */
  async markUsedBatch(input: {
    ids: number[];
    reset?: boolean;
  }): Promise<{ matched: number; modified: number }> {
    const ids = (Array.isArray(input?.ids) ? input.ids : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    if (ids.length === 0) return { matched: 0, modified: 0 };
    const now = new Date();
    const update =
      input.reset === true
        ? { $set: { isUsed: false, updatedAt: now }, $unset: { usedAt: '' } }
        : { $set: { isUsed: true, usedAt: now, updatedAt: now } };
    const res = await this.images.updateMany(
      { id: { $in: ids } },
      update as unknown as Record<string, unknown>,
    );
    return { matched: res.matchedCount ?? 0, modified: res.modifiedCount ?? 0 };
  }

  /**
   * @description 在完整可见图库或指定标签并集中随机采样图片，并支持图片类型、分组和排除条件；默认排除 isUsed=true。
   * @keyword-cn 图库随机采样, 标签随机取图
   * @keyword-en gallery-random-sample, tag-random-selection
   */
  async sampleRandom(input: {
    userId?: string;
    tenantId?: string;
    groupId?: string | number;
    tags?: string[];
    imageType?: 'all' | 'regular' | 'collage';
    excludedGroupIds?: Array<string | number>;
    excludedTags?: string[];
    limit?: number;
    /** 是否包含已使用图片, 默认 false */
    includeUsed?: boolean;
  }): Promise<GalleryImageEntity[]> {
    const clauses: Record<string, unknown>[] = [
      this.buildTenantFilter(input.userId, input.tenantId),
    ];
    if (
      input.groupId !== undefined &&
      ((typeof input.groupId === 'number' && Number.isFinite(input.groupId)) ||
        typeof input.groupId === 'string')
    ) {
      clauses.push({ groupId: input.groupId });
    }
    const tags = Array.from(
      new Set(
        (Array.isArray(input.tags) ? input.tags : [])
          .map((tag) => String(tag ?? '').trim())
          .filter(Boolean),
      ),
    );
    if (tags.length > 0) {
      clauses.push({ tags: { $in: tags } });
    }
    if (input.imageType && input.imageType !== 'all') {
      clauses.push(this.buildImageTypeFilter(input.imageType));
    }
    const excludedGroupIds = Array.from(
      new Set(
        (Array.isArray(input.excludedGroupIds) ? input.excludedGroupIds : [])
          .filter(
            (id): id is string | number =>
              (typeof id === 'number' && Number.isFinite(id)) ||
              (typeof id === 'string' && id.trim().length > 0),
          )
          .map((id) => (typeof id === 'string' ? id.trim() : id)),
      ),
    );
    if (excludedGroupIds.length > 0) {
      clauses.push({ groupId: { $nin: excludedGroupIds } });
    }
    const excludedTags = Array.from(
      new Set(
        (Array.isArray(input.excludedTags) ? input.excludedTags : [])
          .map((tag) => String(tag ?? '').trim())
          .filter(Boolean),
      ),
    );
    if (excludedTags.length > 0) {
      clauses.push({ tags: { $nin: excludedTags } });
    }
    if (input.includeUsed !== true) {
      clauses.push({ isUsed: { $ne: true } });
    }
    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
    const lim = Math.max(1, Math.min(200, Math.floor(input.limit ?? 24)));
    const pipe: Record<string, unknown>[] = [{ $match: filter }];
    pipe.push({ $sample: { size: lim } });
    pipe.push({ $project: { _id: 0 } });
    const rows = await this.images
      .aggregate<GalleryImageEntity>(pipe)
      .toArray();
    return rows.map((row) => this.toPublicImage(row) as GalleryImageEntity);
  }

  /**
   * @description 批量为当前租户可见图片添加/移除标签，可见口径与图库列表一致。
   * @param {{ userId?: string; tenantId?: string; ids: number[]; addTags?: unknown; removeTags?: unknown }} input - 批量更新输入。
   * @returns {Promise<{ matched: number; modified: number }>} 匹配与修改数量。
   * @throws {Error} 当MongoDB updateMany 失败时抛出。
   * @keyword gallery, tag, batch
   * @keyword-cn 批量改标签, 租户可见范围
   * @keyword-en batch-update-tags, tenant-visibility
   * @since 2026-02-04
   */
  async updateTagsBatch(input: {
    userId?: string;
    tenantId?: string;
    ids: number[];
    addTags?: unknown;
    removeTags?: unknown;
  }): Promise<{ matched: number; modified: number }> {
    const ids = (Array.isArray(input?.ids) ? input.ids : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    if (ids.length === 0) return { matched: 0, modified: 0 };

    const add = this.normalizeTags(input?.addTags);
    const remove = this.normalizeTags(input?.removeTags);
    if (add.length === 0 && remove.length === 0)
      return { matched: 0, modified: 0 };

    const update: Record<string, unknown> = { $set: { updatedAt: new Date() } };
    if (add.length > 0) {
      (update as { $addToSet?: unknown }).$addToSet = {
        tags: { $each: add },
      };
    }
    if (remove.length > 0) {
      (update as { $pull?: unknown }).$pull = {
        tags: { $in: remove },
      };
    }

    const res = await this.images.updateMany(
      {
        $and: [
          this.buildTenantFilter(input.userId, input.tenantId),
          { id: { $in: ids } },
        ],
      },
      update,
    );
    return { matched: res.matchedCount ?? 0, modified: res.modifiedCount ?? 0 };
  }

  /**
   * @description 删除当前租户可见的单张图片记录，并在安全范围内尝试删除本地文件与缩略图文件。
   * @param {{ userId?: string; tenantId?: string; id: number }} input - 删除输入。
   * @returns {Promise<{ ok: boolean }>} 删除结果。
   * @throws {Error} 当MongoDB查询或删除失败时抛出。
   * @keyword gallery, image, delete
   * @keyword-cn 删除图片, 租户可见范围
   * @keyword-en delete-image, tenant-visibility
   * @since 2026-02-04
   */
  async deleteImage(input: {
    userId?: string;
    tenantId?: string;
    id: number;
  }): Promise<{ ok: boolean }> {
    const id = Number(input?.id);
    if (!Number.isFinite(id)) return { ok: false };

    const filter = {
      $and: [this.buildTenantFilter(input.userId, input.tenantId), { id }],
    };
    const doc = await this.images.findOne(filter);
    if (!doc) return { ok: false };

    const del = await this.images.deleteOne({ _id: doc._id });
    if (!del.deletedCount) return { ok: false };

    const absPath = typeof doc.absPath === 'string' ? doc.absPath : '';
    const thumbFile =
      typeof doc.thumbFileName === 'string' ? doc.thumbFileName : '';
    const thumbPath = thumbFile
      ? join(process.cwd(), 'public', 'uploads_thumbs', thumbFile)
      : typeof doc.thumbUrl === 'string' &&
          doc.thumbUrl.includes('/uploads_thumbs/')
        ? join(
            process.cwd(),
            'public',
            'uploads_thumbs',
            doc.thumbUrl.split('/').pop() || '',
          )
        : '';

    await Promise.allSettled([
      this.unlinkIfSafe(absPath),
      this.unlinkIfSafe(thumbPath),
    ]);
    return { ok: true };
  }

  /**
   * @description 批量删除图片记录及其本地原图/缩略图文件，逐条复用单删逻辑，互不阻断。
   * @param {{ userId?: string; tenantId?: string; ids: number[] }} input - 批量删除输入（token 用户与租户 + 图片自增 id 列表）。
   * @returns {Promise<{ deleted: number; failed: number; deletedIds: number[] }>} 成功/失败统计与已删除 id。
   * @keyword gallery, image, delete, batch
   * @keyword-cn 图库批量删除
   * @keyword-en gallery batch delete images
   */
  async deleteManyImages(input: {
    userId?: string;
    tenantId?: string;
    ids: number[];
  }): Promise<{ deleted: number; failed: number; deletedIds: number[] }> {
    const { userId, tenantId } = input;
    const ids = Array.from(
      new Set(
        (Array.isArray(input?.ids) ? input.ids : [])
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x))
          .map((x) => Math.floor(x)),
      ),
    );
    if (ids.length === 0) {
      return { deleted: 0, failed: 0, deletedIds: [] };
    }
    const deletedIds: number[] = [];
    let failed = 0;
    for (const id of ids) {
      const res = await this.deleteImage({ userId, tenantId, id });
      if (res.ok) deletedIds.push(id);
      else failed++;
    }
    return { deleted: deletedIds.length, failed, deletedIds };
  }

  /**
   * @description 批量重建当前租户可见图片的Embedding向量，支持从指定 startId 起更新 limit 条。
   * @param {{ userId?: string; tenantId?: string; startId?: number; limit?: number }} input - 重建输入。
   * @returns {Promise<{ updated: number }>} 更新条数。
   * @throws {Error} 当MongoDB读取/写入失败时抛出。
   * @keyword gallery, embedding, batch
   * @keyword-cn 重建向量, 租户可见范围
   * @keyword-en rebuild-embeddings, tenant-visibility
   * @since 2026-02-04
   */
  async rebuildEmbeddings(input: {
    userId?: string;
    tenantId?: string;
    startId?: number;
    limit?: number;
  }): Promise<{ updated: number }> {
    const startId =
      typeof input?.startId === 'number' && Number.isFinite(input.startId)
        ? input.startId
        : Number.isFinite(Number(input?.startId))
          ? Number(input?.startId)
          : 1;
    const lim = Math.max(
      1,
      Math.min(200, Math.floor(Number(input?.limit ?? 50))),
    );

    const conditions: Record<string, unknown>[] = [
      this.buildTenantFilter(input.userId, input.tenantId),
    ];
    if (Number.isFinite(startId)) conditions.push({ id: { $gte: startId } });
    const filter = { $and: conditions };

    const rows = await this.images
      .find(filter, {
        projection: {
          _id: 1,
          id: 1,
          description: 1,
          tags: 1,
          originalName: 1,
          fileName: 1,
        },
      })
      .sort({ id: 1 })
      .limit(lim)
      .toArray();

    if (rows.length === 0) return { updated: 0 };

    const texts = rows.map((r) => this.buildEmbeddingTextFromEntity(r));
    const embeddingConfig = await this.resolveDefaultEmbeddingConfig();
    const embeddings = await this.embedding.embedBatch(texts, embeddingConfig);
    const now = new Date();
    const ops = rows.map((r, idx) => ({
      updateOne: {
        filter: { _id: r._id },
        update: {
          $set: {
            embedding: embeddings[idx] ?? new Array<number>(768).fill(0),
            updatedAt: now,
          },
        },
      },
    }));

    if (ops.length === 0) return { updated: 0 };
    await this.images.bulkWrite(ops, { ordered: false });
    return { updated: ops.length };
  }

  /**
   * @description 基于文本查询进行向量相似检索，优先使用 Atlas Vector Search，失败回退本地余弦相似度。
   * @param {string} query - 查询文本。
   * @param {string} [userId] - 用户ID过滤。
   * @param {string} [tenantId] - 租户ID，用于租户隔离。
   * @param {number} [limit=8] - 返回条数。
   * @param {number} [minScore=0.5] - 最小相似度阈值。
   * @returns {Promise<GallerySearchResult[]>} 相似检索结果。
   * @throws {Error} 当Embedding生成失败且未能回退时抛出。
   * @keyword gallery, vector-search, similarity
   * @example
   * // 搜索与”简历头像”相似的图片
   * const results = await galleryService.searchSimilar('resume avatar', 'u1', undefined, 8, 0.6);
   * @since 2026-02-04
   */
  async searchSimilar(
    query: string,
    userId?: string,
    tenantId?: string,
    limit = 8,
    minScore = 0.5,
    imageType?: 'all' | 'regular' | 'collage',
  ): Promise<GallerySearchResult[]> {
    const embeddingConfig = await this.resolveDefaultEmbeddingConfig();
    const queryEmbedding = await this.embedding.embedText(
      query,
      embeddingConfig,
    );
    if (this.isAtlasAvailable === false) {
      return this.searchSimilarLocal(
        queryEmbedding,
        userId,
        tenantId,
        limit,
        minScore,
        imageType,
      );
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
      const rows = await this.images
        .aggregate<GalleryImageEntity & { score: number }>(pipe)
        .toArray();
      this.isAtlasAvailable = true;
      return rows
        .filter((r) => r.score >= minScore)
        .filter((r) => !imageType || this.matchesImageType(r, imageType))
        .slice(0, limit)
        .map((r) => ({
          image: this.toPublicImage(r) as GalleryImageEntity,
          score: r.score,
        }));
    } catch {
      if (this.isAtlasAvailable === null) this.isAtlasAvailable = false;
      return this.searchSimilarLocal(
        queryEmbedding,
        userId,
        tenantId,
        limit,
        minScore,
        imageType,
      );
    }
  }

  /**
   * @description 本地相似检索回退：全量拉取后计算余弦相似度并排序。
   * @param {number[]} queryEmbedding - 查询向量。
   * @param {string | undefined} userId - 用户ID过滤。
   * @param {string | undefined} tenantId - 租户ID过滤。
   * @param {number} limit - 返回条数。
   * @param {number} minScore - 最小相似度阈值。
   * @returns {Promise<GallerySearchResult[]>} 相似检索结果。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword gallery, fallback, cosine
   * @since 2026-02-04
   */
  private async searchSimilarLocal(
    queryEmbedding: number[],
    userId: string | undefined,
    tenantId: string | undefined,
    limit: number,
    minScore: number,
    imageType?: 'all' | 'regular' | 'collage',
  ): Promise<GallerySearchResult[]> {
    const clauses: Record<string, unknown>[] = [
      this.buildTenantFilter(userId, tenantId),
    ];
    if (imageType && imageType !== 'all') {
      clauses.push(this.buildImageTypeFilter(imageType));
    }
    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
    const rows = await this.images.find(filter).toArray();
    const scored = rows
      .filter(
        (r): r is GalleryImageEntity & { embedding: number[] } =>
          Array.isArray(r.embedding) && r.embedding.length > 0,
      )
      .map((image) => ({
        image,
        score: this.embedding.cosineSimilarity(queryEmbedding, image.embedding),
      }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => {
        return {
          image: this.toPublicImage(x.image) as GalleryImageEntity,
          score: x.score,
        };
      });
    return scored;
  }

  /**
   * @description 解析默认Embedding配置（来源于AI提供商表）
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
      return {
        providerCode: 'gemini',
        model: 'gemini-embedding-001',
      };
    }
    return {
      providerCode: runtime.providerCode,
      model: runtime.model,
      apiKey: runtime.apiKey,
      baseUrl: runtime.baseUrl,
    };
  }

  /**
   * @description 原图保质量压缩(就地替换)。限制最大边到 maxWidth/maxHeight、按 quality
   *   重编码;仅当压缩后体积比原文件小 >1KB 时,才用临时文件原子替换原图(替换失败回滚到
   *   备份),否则保留原图不动。jimp 不可用/读图失败/压缩反而更大等情况均安全跳过(返回
   *   changed=false + reason)。供普通批量上传与 ZIP 批量导入共用,保证两条入库路径压缩口径一致。
   * @param {{ filePath: string; maxWidth?: number; maxHeight?: number; quality?: number }} params - 压缩参数(默认 1600x1600 / quality 75)。
   * @returns {Promise<{ changed: boolean; beforeSize: number; afterSize: number; reason?: string }>} 是否替换及前后体积。
   * @keyword-en compress image in place keep quality
   * @keyword-cn 原图保质量压缩, 就地替换
   */
  async compressImageInPlace(params: {
    filePath: string;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  }): Promise<{
    changed: boolean;
    beforeSize: number;
    afterSize: number;
    reason?: string;
  }> {
    const filePath = String(params.filePath || '');
    if (!filePath)
      return { changed: false, beforeSize: 0, afterSize: 0, reason: 'no-path' };

    let beforeSize = 0;
    try {
      const beforeStat = await fs.stat(filePath);
      beforeSize = beforeStat.size;
    } catch {
      return {
        changed: false,
        beforeSize: 0,
        afterSize: 0,
        reason: 'stat-failed',
      };
    }

    const maxWidth = Math.max(1, Math.floor(params.maxWidth ?? 1600));
    const maxHeight = Math.max(1, Math.floor(params.maxHeight ?? 1600));
    const quality = Math.min(
      95,
      Math.max(30, Math.floor(params.quality ?? 75)),
    );

    if (!this.jimpModulePromise) {
      this.jimpModulePromise = import('jimp') as Promise<unknown>;
    }
    const mod = await this.jimpModulePromise;
    const Jimp = (mod as Record<string, unknown>).Jimp as
      | {
          read: (path: string) => Promise<{
            bitmap?: { width: number; height: number };
            resize: (opts: { w: number; h: number }) => unknown;
            write: (path: string, opts: { quality: number }) => Promise<void>;
          }>;
        }
      | undefined;
    if (!Jimp || typeof Jimp.read !== 'function') {
      return {
        changed: false,
        beforeSize,
        afterSize: beforeSize,
        reason: 'jimp-unavailable',
      };
    }

    let img: Awaited<ReturnType<typeof Jimp.read>>;
    try {
      img = await Jimp.read(filePath);
    } catch (e) {
      return {
        changed: false,
        beforeSize,
        afterSize: beforeSize,
        reason: e instanceof Error ? e.message : 'read-failed',
      };
    }
    if (typeof img?.resize !== 'function' || typeof img?.write !== 'function') {
      return {
        changed: false,
        beforeSize,
        afterSize: beforeSize,
        reason: 'bad-image',
      };
    }

    const w = typeof img.bitmap?.width === 'number' ? img.bitmap.width : 0;
    const h = typeof img.bitmap?.height === 'number' ? img.bitmap.height : 0;
    if (w > 0 && h > 0) {
      const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
      if (ratio < 1) {
        const nw = Math.max(1, Math.floor(w * ratio));
        const nh = Math.max(1, Math.floor(h * ratio));
        img.resize({ w: nw, h: nh });
      }
    }

    const ext = extname(filePath) || '.jpg';
    const base = filePath.toLowerCase().endsWith(ext.toLowerCase())
      ? filePath.slice(0, -ext.length)
      : filePath;
    const rand = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const tmpPath = `${base}.__upload_compress_tmp__${rand()}${ext}`;

    const safeUnlink = async (p: string) => {
      try {
        if (existsSync(p)) await fs.unlink(p);
      } catch {
        void 0;
      }
    };

    try {
      await img.write(tmpPath, { quality });
    } catch (e) {
      await safeUnlink(tmpPath);
      return {
        changed: false,
        beforeSize,
        afterSize: beforeSize,
        reason: e instanceof Error ? e.message : 'write-failed',
      };
    }

    let afterSize = beforeSize;
    try {
      const afterStat = await fs.stat(tmpPath);
      afterSize = afterStat.size;
    } catch {
      await safeUnlink(tmpPath);
      return {
        changed: false,
        beforeSize,
        afterSize: beforeSize,
        reason: 'tmp-stat-failed',
      };
    }

    // 压缩收益不足 1KB 视为无效,保留原图(避免无意义重写、避免把已优化图越压越糊)
    if (afterSize + 1024 >= beforeSize) {
      await safeUnlink(tmpPath);
      return {
        changed: false,
        beforeSize,
        afterSize: beforeSize,
        reason: 'not-smaller',
      };
    }

    const bakPath = `${base}.__upload_compress_bak__${rand()}${ext}`;
    try {
      await fs.rename(filePath, bakPath);
    } catch (e) {
      await safeUnlink(tmpPath);
      return {
        changed: false,
        beforeSize,
        afterSize: beforeSize,
        reason: e instanceof Error ? e.message : 'backup-failed',
      };
    }
    try {
      await fs.rename(tmpPath, filePath);
    } catch (e) {
      // 替换失败:回滚备份,保证原图不丢
      try {
        if (existsSync(bakPath)) await fs.rename(bakPath, filePath);
      } catch {
        void 0;
      }
      await safeUnlink(tmpPath);
      return {
        changed: false,
        beforeSize,
        afterSize: beforeSize,
        reason: e instanceof Error ? e.message : 'replace-failed',
      };
    }
    await safeUnlink(bakPath);
    return { changed: true, beforeSize, afterSize };
  }

  /**
   * @description 为已存在的图片文件生成缩略图，返回缩略图文件名和URL。
   * @param {string} absPath - 图片绝对路径。
   * @param {string} originalFileName - 原始文件名（用于提取扩展名）。
   * @returns {Promise<{ thumbFileName: string; thumbUrl: string } | null>} 缩略图信息，失败返回null。
   * @keyword gallery, thumbnail, generate
   * @since 2026-03-28
   */
  async generateThumbnail(
    absPath: string,
    originalFileName: string,
  ): Promise<{ thumbFileName: string; thumbUrl: string } | null> {
    const src = String(absPath || '');
    if (!src) return null;

    const dir = join(process.cwd(), 'public', 'uploads_thumbs');
    mkdirSync(dir, { recursive: true });

    const rawExt = extname(String(originalFileName || '')).toLowerCase();
    const ext = rawExt && rawExt.length <= 12 ? rawExt : '.jpg';
    const thumbFileName = `${Date.now()}-${randomUUID()}${ext}`;
    const outputPath = join(dir, thumbFileName);

    try {
      if (!this.jimpModulePromise) {
        this.jimpModulePromise = import('jimp') as Promise<unknown>;
      }
      const mod = await this.jimpModulePromise;
      const Jimp = (mod as Record<string, unknown>).Jimp as {
        read: (path: string) => Promise<{
          bitmap?: { width: number; height: number };
          resize: (opts: { w: number; h: number }) => unknown;
          write: (path: string, opts: { quality: number }) => Promise<void>;
        }>;
      };
      if (!Jimp) return null;

      const img = await Jimp.read(src);
      const w = img?.bitmap?.width ?? 0;
      const h = img?.bitmap?.height ?? 0;
      if (w > 0 && h > 0) {
        const maxW = 720;
        const maxH = 720;
        const ratio = Math.min(maxW / w, maxH / h, 1);
        const nw = Math.max(1, Math.floor(w * ratio));
        const nh = Math.max(1, Math.floor(h * ratio));
        if (nw !== w || nh !== h) {
          img.resize({ w: nw, h: nh });
        }
      }
      await img.write(outputPath, { quality: 68 });
      return {
        thumbFileName,
        thumbUrl: `/static/uploads_thumbs/${thumbFileName}`,
      };
    } catch (e) {
      console.error('[GalleryService.generateThumbnail] failed:', e);
      return null;
    }
  }
}
