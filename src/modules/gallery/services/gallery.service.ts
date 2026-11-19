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
  GalleryImageDocument,
  GalleryImageEntity,
  GalleryPublicImage,
  GallerySearchResult,
} from '../entities/gallery-image.entity.js';
import { GALLERY_MATERIAL_TAGS } from '../gallery.constants.js';
import {
  GalleryTagLinkService,
  resolveGalleryTagScopeKey,
} from './gallery-tag-link.service.js';

/**
 * @description 对外返回图片时的读取投影：不读 Mongo 主键和 768 维向量。向量只在服务端相似检索里用，前端从不需要，
 *   却占了图库列表响应的大半体积；需要向量的相似检索自己读原始文档，不走这个投影。
 * @keyword-cn 图片公开投影, 不返回向量
 * @keyword-en public-image-projection, omit-embedding
 */
const PUBLIC_IMAGE_PROJECTION = { _id: 0, embedding: 0 } as const;

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

/**
 * @description 图库图片类型：all 全部，regular 普通图（不含拼图、封面和素材图），collage 拼图与封面，material 素材图（拼图、封面与 `GALLERY_MATERIAL_TAGS` 标记的 AI 生成与出片过程图）。
 * @keyword-cn 图库图片类型, 素材图类型
 * @keyword-en gallery-image-type, material-image-type
 */
export type GalleryImageType = 'all' | 'regular' | 'collage' | 'material';

/** 不算普通图的系统标签：封面类标签加素材图标签 */
const NON_REGULAR_TAGS: string[] = [
  ...GALLERY_COVER_TAGS,
  ...GALLERY_MATERIAL_TAGS,
];
const materialTagSet = new Set<string>(GALLERY_MATERIAL_TAGS);

@Injectable()
export class GalleryService {
  private readonly images: Collection<GalleryImageDocument>;
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
    private readonly tagLinks: GalleryTagLinkService,
  ) {
    this.images = db.collection<GalleryImageDocument>('gallery_images');
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
        { projection: PUBLIC_IMAGE_PROJECTION },
      )
      .toArray();
    const withTags = await this.attachTags(rows);
    const byId = new Map(withTags.map((row) => [Number(row.id), row]));
    return orderedIds
      .map((id) => byId.get(id))
      .filter((img): img is NonNullable<typeof img> => !!img)
      .map((img) => this.toPublicImage(img) as GalleryImageEntity);
  }

  /**
   * @description 当前租户可见范围对应的标签作用域键，与标签字典和关联表一致。
   * @keyword-cn 图片标签作用域, 租户作用域键
   * @keyword-en image-tag-scope, tenant-scope-key
   */
  private scopeKeyOf(tenantId?: string): string {
    return resolveGalleryTagScopeKey(tenantId);
  }

  /**
   * @description 给图片批量回填 `tags`（来自标签关联表，按原顺序）。迁移过渡兼容：文档上还留着旧 `tags` 数组时以它为准，
   *   迁移脚本把数组移走后不再出现这种文档，届时可删掉这段兼容。
   * @keyword-cn 回填图片标签, 旧数组兼容
   * @keyword-en attach-image-tags, legacy-array-compat
   */
  private async attachTags<T extends { id: number }>(
    rows: T[],
  ): Promise<Array<T & { tags: string[] }>> {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const linked = await this.tagLinks.tagsByImageIds(
      rows.map((row) => Number(row.id)),
    );
    return rows.map((row) => {
      const legacy = (row as { tags?: unknown }).tags;
      const tags = Array.isArray(legacy)
        ? this.normalizeTags(legacy)
        : (linked.get(Number(row.id)) ?? []);
      return { ...row, tags };
    });
  }

  /**
   * @description 把标签条件换算成图片 ID 条件：`any` 带任一标签、`all` 同时带全部标签、`none` 不带其中任何标签。
   * @keyword-cn 标签条件换算, 图片ID过滤
   * @keyword-en tag-clause-to-ids, image-id-filter
   */
  private async tagIdClause(
    scopeKey: string,
    mode: 'any' | 'all' | 'none',
    names: string[],
  ): Promise<Record<string, unknown>> {
    const ids =
      mode === 'all'
        ? await this.tagLinks.imageIdsWithAllTags(scopeKey, names)
        : await this.tagLinks.imageIdsWithAnyTag(scopeKey, names);
    return mode === 'none' ? { id: { $nin: ids } } : { id: { $in: ids } };
  }

  /**
   * @description 写入图片的最新标签：先整体同步关联表，再移走这些图片上残留的旧 `tags` 数组。
   * @keyword-cn 写入图片标签, 移除旧数组
   * @keyword-en write-image-tags, drop-legacy-array
   */
  private async writeImageTags(
    entries: Array<{ id: number; tenantId?: string; tags: string[] }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.tagLinks.replaceImageTags(
      entries.map((entry) => ({
        imageId: entry.id,
        tenantId: entry.tenantId,
        tags: entry.tags,
      })),
    );
    await this.images.updateMany(
      {
        id: { $in: entries.map((entry) => entry.id) },
        tags: { $exists: true },
      },
      { $unset: { tags: '' } } as unknown as Record<string, unknown>,
    );
  }

  /**
   * @description 只读取符合条件的图片业务 ID（配合含 id 的复合索引走覆盖查询，不读整条文档）。
   * @keyword-cn 读取图片ID, 覆盖查询
   * @keyword-en find-image-ids, covered-query
   */
  private async findImageIds(
    filter: Record<string, unknown>,
  ): Promise<number[]> {
    const rows = await this.images
      .find(filter, { projection: { _id: 0, id: 1 } })
      .toArray();
    return rows.map((row) => Number(row.id));
  }

  /**
   * @description 创建图库租户、时间线、完整收藏排序与只取 ID 的覆盖索引，并删除较短的收藏前缀索引和已不用的数组标签索引。
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
    await this.images.createIndex({ isCollage: 1, updatedAt: -1 });
    await this.images.createIndex({ createdAt: -1 });
    // 租户隔离索引
    await this.images.createIndex({ scope: 1, tenantId: 1, userId: 1 });
    await this.images.createIndex({ tenantId: 1, createdAt: -1, id: -1 });
    // 只取图片 ID 的覆盖索引：拼图/已使用集合、按用户或分组列标签
    await this.images.createIndex({ tenantId: 1, isCollage: 1, id: 1 });
    await this.images.createIndex({ tenantId: 1, isUsed: 1, id: 1 });
    await this.images.createIndex({ userId: 1, id: 1 });
    await this.images.createIndex({ groupId: 1, userId: 1, id: 1 });
    // 标签已迁到 gallery_tags + gallery_image_tags，旧的数组标签索引不再使用
    for (const name of [
      'tags_1',
      'scope_1_tenantId_1_tags_1',
      'tenantId_1_tags_1',
    ]) {
      await this.images.dropIndex(name).catch(() => undefined);
    }
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
   * @description 把数据库图片归一化为对外图片，补齐历史数据缺失的图库重构字段，并移除 Mongo 主键与向量（向量只供服务端相似检索）。
   * @keyword-cn 图片公开归一化, 历史默认值
   * @keyword-en public-image-normalization, legacy-defaults, omit-embedding
   */
  toPublicImage(
    image:
      | GalleryImageEntity
      | Omit<GalleryImageEntity, '_id'>
      | Omit<GalleryImageEntity, '_id' | 'embedding'>,
  ): GalleryPublicImage {
    const raw = image as GalleryImageEntity & { _id?: ObjectId };
    const clean: Partial<GalleryImageEntity> & { _id?: ObjectId } = { ...raw };
    delete clean._id;
    delete clean.embedding;
    return {
      ...(clean as GalleryPublicImage),
      favorite: raw.favorite === true,
      note: typeof raw.note === 'string' ? raw.note : '',
      aiFaceProtected: raw.aiFaceProtected === true,
    };
  }

  /**
   * @description 返回标签库统计应排除的系统标签：封面类标签与素材图标签（素材图标签不进未归类、不能放进分类）。
   * @keyword-cn 系统标签列表, 标签库排除
   * @keyword-en system-tag-list, tag-library-exclusion
   */
  getSystemTags(): string[] {
    return [...this.COVER_TAGS, ...GALLERY_MATERIAL_TAGS];
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
   * @description 批量创建图片记录并为每条记录生成Embedding；标签规整后写入标签关联表，不再存到图片文档上。
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

    const tagsByIndex = inputs.map((input) => this.normalizeTags(input.tags));
    const docs: GalleryImageDocument[] = inputs.map((input, idx) => {
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
    await this.tagLinks.replaceImageTags(
      docs.map((doc, idx) => ({
        imageId: doc.id,
        tenantId: doc.tenantId,
        tags: tagsByIndex[idx],
      })),
    );
    // 服务内部调用方拿完整实体（含向量）；经 HTTP 返回时由 toPublicImage 去掉向量
    return docs.map((doc, idx) => ({
      ...this.toPublicImage({ ...doc, tags: tagsByIndex[idx] }),
      embedding: doc.embedding,
      _id: doc._id,
    }));
  }

  /**
   * @description 按租户可见性查找图片，兼容旧游标分页并支持多标签、收藏、关键词、随机与收藏优先排序；
   *   最新/最早排序的游标按游标图片的 `createdAt + id` 复合比较，与排序键一致且能直接从索引定位起点。
   * @param {string} userId - 用户ID
   * @param {string} [tenantId] - 租户ID
   * @param {Object} [options] - 查询选项
   * @param {number} [options.groupId] - 图库组ID
   * @param {string} [options.tag] - 标签
   * @param {number} [options.cursorId] - 游标（上一页最后一张图片 ID）
   * @param {number} [options.limit=50] - 返回条数
   * @param {'asc'|'desc'} [options.sortOrder='desc'] - 旧创建时间排序方向
   * @param {string} [options.keyword] - 文件名、描述与备注的包含搜索词
   * @returns {Promise<GalleryImageEntity[]>} 图片列表
   * @keyword-cn 租户图片查询, 图库多条件排序, 复合游标, 关键词搜索
   * @keyword-en tenant-image-query, gallery-multi-sort, keyset-cursor, keyword-search
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
      imageType?: GalleryImageType;
      sortOrder?: 'asc' | 'desc';
      sort?: 'newest' | 'oldest' | 'random' | 'favorite';
      tags?: string[];
      favoriteOnly?: boolean;
      offset?: number;
      keyword?: string;
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
      keyword,
    } = options ?? {};
    const resolvedSort = sort ?? (sortOrder === 'asc' ? 'oldest' : 'newest');
    const sortDirection = resolvedSort === 'oldest' ? 1 : -1;
    const scope = this.buildTenantFilter(userId, tenantId);
    const scopeKey = this.scopeKeyOf(tenantId);
    const clauses: Record<string, unknown>[] = [scope];
    const normalizedTags = this.normalizeTags(tags);
    const singleTag = tag ? this.normalizeTags([tag]) : [];
    if (imageType && imageType !== 'all') {
      clauses.push(
        await this.buildImageTypeFilter(scopeKey, imageType, [
          ...normalizedTags,
          ...singleTag,
        ]),
      );
    } else if (!includeCollage) {
      clauses.push({ isCollage: { $ne: true } });
    }
    if (groupId !== undefined) clauses.push({ groupId });
    if (normalizedTags.length > 0) {
      clauses.push(await this.tagIdClause(scopeKey, 'all', normalizedTags));
    }
    if (tag) {
      clauses.push(
        singleTag.length > 0
          ? await this.tagIdClause(scopeKey, 'all', singleTag)
          : { id: { $in: [] } },
      );
    }
    if (favoriteOnly) clauses.push({ favorite: true });
    const normalizedKeyword = String(keyword ?? '')
      .trim()
      .slice(0, 64);
    if (normalizedKeyword) {
      clauses.push(this.buildKeywordClause(normalizedKeyword));
    }
    if (
      (resolvedSort === 'newest' || resolvedSort === 'oldest') &&
      typeof cursorId === 'number' &&
      Number.isFinite(cursorId)
    ) {
      clauses.push(
        await this.buildCreatedAtCursorClause(scope, cursorId, sortDirection),
      );
    }
    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    if (resolvedSort === 'random') {
      const rows = await this.images
        .aggregate<GalleryImageDocument>([
          { $match: filter },
          { $sample: { size: lim } },
          { $project: PUBLIC_IMAGE_PROJECTION },
        ])
        .toArray();
      return (await this.attachTags(rows)).map(
        (row) => this.toPublicImage(row) as GalleryImageEntity,
      );
    }
    const query = this.images.find(filter, {
      projection: PUBLIC_IMAGE_PROJECTION,
    });
    if (resolvedSort === 'favorite') {
      query
        .sort({ favorite: -1, favoritedAt: -1, createdAt: -1, id: -1 })
        .skip(Math.max(0, Math.floor(offset)));
    } else {
      query.sort({ createdAt: sortDirection, id: sortDirection });
    }
    const rows = await query.limit(lim).toArray();
    return (await this.attachTags(rows)).map(
      (row) => this.toPublicImage(row) as GalleryImageEntity,
    );
  }

  /**
   * @description 按游标图片的创建时间与业务 ID 构造复合游标条件，与 `createdAt, id` 排序一致；
   *   `createdAt` 的范围让索引从游标位置起扫，不必每页从头跳过已读条目。游标图片已删除或缺创建时间时回退为只比较业务 ID。
   * @param {Record<string, unknown>} scope - 当前租户可见范围条件。
   * @param {number} cursorId - 上一页最后一张图片 ID。
   * @param {1 | -1} direction - 排序方向，1 为最早优先。
   * @returns {Promise<Record<string, unknown>>} 游标过滤条件。
   * @keyword-cn 复合游标, 创建时间分页
   * @keyword-en keyset-cursor, created-at-pagination
   */
  private async buildCreatedAtCursorClause(
    scope: Record<string, unknown>,
    cursorId: number,
    direction: 1 | -1,
  ): Promise<Record<string, unknown>> {
    const beyond = direction === 1 ? '$gt' : '$lt';
    const cursor = await this.images.findOne(
      { $and: [scope, { id: cursorId }] },
      { projection: { _id: 0, createdAt: 1 } },
    );
    const createdAt = cursor?.createdAt;
    if (!(createdAt instanceof Date)) return { id: { [beyond]: cursorId } };
    return {
      createdAt: { [direction === 1 ? '$gte' : '$lte']: createdAt },
      $or: [
        { createdAt: { [beyond]: createdAt } },
        { id: { [beyond]: cursorId } },
      ],
    };
  }

  /**
   * @description 把搜索词转成原文件名、文件名、描述与备注的不区分大小写包含匹配，正则特殊字符按字面量处理。
   * @param {string} keyword - 已去空白并截断的搜索词。
   * @returns {Record<string, unknown>} 关键词过滤条件。
   * @keyword-cn 关键词搜索, 文件名备注匹配
   * @keyword-en keyword-search, name-note-match
   */
  private buildKeywordClause(keyword: string): Record<string, unknown> {
    const pattern = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = { $regex: pattern, $options: 'i' };
    return {
      $or: ['originalName', 'fileName', 'description', 'note'].map((field) => ({
        [field]: match,
      })),
    };
  }

  /**
   * @description 精确统计当前图片可见范围内的图片（含素材图）、其中的素材图、收藏和去重标签数量；标签数只扫关联表索引，不读图片文档。
   * @keyword-cn 图库精确统计, 可见范围计数
   * @keyword-en gallery-exact-stats, visibility-count
   */
  async getAccessibleStats(
    userId: string | undefined,
    tenantId?: string,
  ): Promise<{
    images: number;
    materials: number;
    favorites: number;
    tags: number;
  }> {
    const filter = this.buildTenantFilter(userId, tenantId);
    const scopeKey = this.scopeKeyOf(tenantId);
    const materialFilter = await this.buildImageTypeFilter(
      scopeKey,
      'material',
    );
    const [images, materials, favorites, tags] = await Promise.all([
      this.images.countDocuments(filter),
      this.images.countDocuments({ $and: [filter, materialFilter] }),
      this.images.countDocuments({ $and: [filter, { favorite: true }] }),
      this.tagLinks.countDistinctTags(scopeKey),
    ]);
    return { images, materials, favorites, tags };
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
  }): Promise<GalleryPublicImage | null> {
    const filter = {
      $and: [
        this.buildTenantFilter(input.userId, input.tenantId),
        { id: input.id },
      ],
    };
    const current = await this.images.findOne(filter, {
      projection: { embedding: 0 },
    });
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
      const [withTags] = await this.attachTags([current]);
      await this.writeImageTags([
        {
          id: current.id,
          tenantId: current.tenantId,
          tags: Array.from(
            new Set([
              ...withTags.tags.filter((tag) => !remove.has(tag)),
              ...add,
            ]),
          ),
        },
      ]);
    }
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const result = await this.images.findOneAndUpdate(filter, update, {
      returnDocument: 'after',
      includeResultMetadata: true,
      projection: { embedding: 0 },
    });
    if (!result.value) return null;
    const [updated] = await this.attachTags([result.value]);
    return this.toPublicImage(updated);
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
      .find(
        {
          $and: [
            this.buildTenantFilter(input.userId, input.tenantId),
            { id: { $in: ids } },
          ],
        },
        { projection: { embedding: 0 } },
      )
      .toArray();
    const add = this.normalizeTags(input.addTags);
    const remove = new Set(this.normalizeTags(input.removeTags));
    if (add.length > 0 || remove.size > 0) {
      const withTags = await this.attachTags(rows);
      await this.writeImageTags(
        withTags.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          tags: Array.from(
            new Set([...row.tags.filter((tag) => !remove.has(tag)), ...add]),
          ),
        })),
      );
    }
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
  }): Promise<Array<GalleryPublicImage>> {
    const scope = this.buildTenantFilter(input.userId, input.tenantId);
    const source = await this.images.findOne({
      $and: [scope, { id: input.id }],
    });
    if (!source) return [];
    const limit = Math.max(1, Math.min(30, Math.floor(input.limit || 12)));
    const sourceEmbedding = Array.isArray(source.embedding)
      ? source.embedding
      : [];
    const hasVector = sourceEmbedding.some(
      (value) => Number.isFinite(value) && value !== 0,
    );
    if (hasVector) {
      try {
        const candidates = await this.images
          .find({ $and: [scope, { id: { $ne: input.id } }] })
          .toArray();
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
          const picked = await this.attachTags(
            vectorRows.map(({ image }) => image),
          );
          return picked.map((image) => this.toPublicImage(image));
        }
      } catch {
        // 向量不可用时继续走共同标签兜底。
      }
    }
    return this.findSimilarByTags(scope, source, limit);
  }

  /**
   * @description 相似图无向量时的兜底：共同标签多的在前、同数按创建时间新的在前，不够时用最新的其他图片补足；
   *   共同标签数直接在关联表上统计，不再把整个租户的图片读进内存。
   * @keyword-cn 共同标签兜底, 相似图补足
   * @keyword-en shared-tag-fallback, similar-image-fill
   */
  private async findSimilarByTags(
    scope: Record<string, unknown>,
    source: GalleryImageDocument,
    limit: number,
  ): Promise<GalleryPublicImage[]> {
    const [withTags] = await this.attachTags([source]);
    const shared = await this.tagLinks.countSharedTagsByImage(
      this.scopeKeyOf(source.tenantId),
      withTags.tags,
      source.id,
    );
    let pickedIds: number[] = [];
    if (shared.size > 0) {
      const dated = await this.images
        .find(
          { $and: [scope, { id: { $in: Array.from(shared.keys()) } }] },
          { projection: { _id: 0, id: 1, createdAt: 1 } },
        )
        .toArray();
      pickedIds = dated
        .sort(
          (a, b) =>
            (shared.get(b.id) ?? 0) - (shared.get(a.id) ?? 0) ||
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, limit)
        .map((row) => row.id);
    }
    const rows =
      pickedIds.length > 0
        ? await this.images
            .find(
              { $and: [scope, { id: { $in: pickedIds } }] },
              { projection: PUBLIC_IMAGE_PROJECTION },
            )
            .toArray()
        : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = pickedIds
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row);
    if (ordered.length < limit) {
      const filler = await this.images
        .find(
          {
            $and: [
              scope,
              { id: { $nin: [source.id, ...ordered.map((row) => row.id)] } },
            ],
          },
          { projection: PUBLIC_IMAGE_PROJECTION },
        )
        .sort({ createdAt: -1, id: -1 })
        .limit(limit - ordered.length)
        .toArray();
      ordered.push(...filler);
    }
    return (await this.attachTags(ordered)).map((image) =>
      this.toPublicImage(image),
    );
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
      .find(
        {
          $and: [
            this.buildTenantFilter(input.userId, input.tenantId),
            await this.tagIdClause(
              this.scopeKeyOf(input.tenantId),
              'any',
              tags,
            ),
          ],
        },
        { projection: { embedding: 0 } },
      )
      .toArray();
    if (rows.length === 0) return { updated: 0 };
    const withTags = await this.attachTags(rows);
    const removing = new Set(tags);
    await this.writeImageTags(
      withTags.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        tags: row.tags.filter((tag) => !removing.has(tag)),
      })),
    );
    const now = new Date();
    const operations = withTags.map((row) => {
      const matched = tags.filter((tag) => row.tags.includes(tag));
      return {
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              note: this.appendNoteLines(row.note, matched.join('\n')),
              updatedAt: now,
            },
          },
        },
      };
    });
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
   * @description 构建图片类型 DB 过滤条件；普通图排除拼图、封面标签与素材图标签（AI 生成、出片过程图、设计素材与画布成品），素材图正好取反，拼图口径保持不变。
   *   调用方明确按某个标签筛选时，普通图不再排除这个标签（例如设计编辑器手动选「画布成品」），否则结果必然为空。
   *   标签部分换算成图片 ID 条件（来自标签关联表），`isCollage` 仍按图片字段过滤。
   * @param {string} scopeKey - 标签作用域键。
   * @param {Exclude<GalleryImageType, 'all'>} imageType - 目标图片类型。
   * @param {string[]} [requestedTags] - 调用方明确要筛的标签。
   * @returns {Promise<Record<string, unknown>>} MongoDB filter 对象。
   * @keyword-cn 普通图筛选, AI素材排除
   * @keyword-en regular-image-filter, exclude-ai-material
   */
  private async buildImageTypeFilter(
    scopeKey: string,
    imageType: Exclude<GalleryImageType, 'all'>,
    requestedTags: string[] = [],
  ): Promise<Record<string, unknown>> {
    const rule = this.imageTypeTagRule(imageType, requestedTags);
    const ids = await this.tagLinks.imageIdsWithAnyTag(scopeKey, rule.tags);
    if (rule.mode === 'exclude') {
      return { isCollage: { $ne: true }, id: { $nin: ids } };
    }
    return { $or: [{ isCollage: true }, { id: { $in: ids } }] };
  }

  /**
   * @description 图片类型对应的标签规则：普通图排除拼图和这些标签（调用方明确要筛的标签不排除），素材图与拼图封面为拼图或带这些标签。
   * @keyword-cn 图片类型标签规则, 素材图口径
   * @keyword-en image-type-tag-rule, material-image-rule
   */
  private imageTypeTagRule(
    imageType: Exclude<GalleryImageType, 'all'>,
    requestedTags: string[] = [],
  ): { mode: 'exclude' | 'include'; tags: string[] } {
    if (imageType === 'regular') {
      return {
        mode: 'exclude',
        tags: NON_REGULAR_TAGS.filter((tag) => !requestedTags.includes(tag)),
      };
    }
    if (imageType === 'material') {
      return { mode: 'include', tags: [...NON_REGULAR_TAGS] };
    }
    return { mode: 'include', tags: [...GALLERY_COVER_TAGS] };
  }

  /**
   * @description 内存层图片类型匹配；普通图排除拼图、封面标签与素材图标签，素材图取反，用于 Atlas 向量搜索结果后处理。
   * @param {GalleryImageEntity} image - 图片对象。
   * @param {GalleryImageType} imageType - 目标类型。
   * @returns {boolean}
   * @keyword-cn 普通图内存筛选, AI素材排除
   * @keyword-en in-memory-image-filter, exclude-ai-material
   */
  private matchesImageType(
    image: GalleryImageEntity,
    imageType: GalleryImageType,
  ): boolean {
    if (imageType === 'all') return true;
    const tags = Array.isArray(image.tags) ? image.tags : [];
    const isCover =
      image.isCollage === true ||
      tags.some((t) => this.coverTagSet.has(String(t ?? '').trim()));
    const isMaterial = tags.some((t) =>
      materialTagSet.has(String(t ?? '').trim()),
    );
    if (imageType === 'regular') return !isCover && !isMaterial;
    if (imageType === 'material') return isCover || isMaterial;
    return isCover;
  }

  /**
   * @description 按租户过滤列出标签
   * @param {string} userId - 用户ID
   * @param {string} [tenantId] - 租户ID
   * @param {number} [limit=500] - 返回条数
   * @returns {Promise<string[]>} 标签列表
   * @keyword-cn 租户标签列表, 已用标签
   * @keyword-en list-tenant-tags, used-tags
   * @since 2026-03-23
   */
  async listDistinctTagsWithTenant(
    userId: string | undefined,
    tenantId?: string,
    limit = 500,
  ): Promise<string[]> {
    const names = await this.tagLinks.listTagNames({
      scopeKey: this.scopeKeyOf(tenantId),
    });
    return this.sortTagNames(names, limit);
  }

  /**
   * @description 标签名去空白、去重并按字典序截断，供各个列标签接口统一输出。
   * @keyword-cn 标签名排序, 标签截断
   * @keyword-en sort-tag-names, limit-tag-names
   */
  private sortTagNames(names: string[], limit: number): string[] {
    const out = Array.from(
      new Set(names.map((x) => String(x ?? '').trim()).filter(Boolean)),
    );
    out.sort((a, b) => a.localeCompare(b));
    const lim = Math.max(1, Math.min(5000, Math.floor(limit || 500)));
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
   * @keyword-cn 旧版图片列表, ID游标分页
   * @keyword-en legacy-image-list, id-cursor-pagination
   * @since 2026-02-04
   */
  async list(
    userId?: string,
    groupId?: string | number,
    tag?: string,
    cursorId?: number,
    limit = 50,
  ): Promise<GalleryImageEntity[]> {
    const clauses: Record<string, unknown>[] = [];
    if (userId) clauses.push({ userId });
    if (
      groupId !== undefined &&
      (typeof groupId === 'number'
        ? Number.isFinite(groupId)
        : typeof groupId === 'string')
    )
      clauses.push({ groupId });
    if (tag) {
      // 这个旧接口按用户而非租户过滤，标签跨作用域按名字匹配
      const ids = await this.tagLinks.imageIdsWithAnyTag(
        null,
        this.normalizeTags([tag]),
      );
      clauses.push({ id: { $in: ids } });
    }
    if (typeof cursorId === 'number' && Number.isFinite(cursorId)) {
      clauses.push({ id: { $lt: cursorId } });
    }
    const filter =
      clauses.length === 0
        ? {}
        : clauses.length === 1
          ? clauses[0]
          : { $and: clauses };
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = await this.images
      .find(filter, { projection: PUBLIC_IMAGE_PROJECTION })
      .sort({ id: -1 })
      .limit(lim)
      .toArray();
    return (await this.attachTags(rows)).map(
      (row) => this.toPublicImage(row) as GalleryImageEntity,
    );
  }

  /**
   * @description 列出某用户图片上出现过的标签；不传用户时为全部作用域已使用的标签。
   * @param {string} [userId] - 用户ID过滤。
   * @param {number} [limit=500] - 返回条数上限。
   * @returns {Promise<string[]>} 标签列表。
   * @throws {Error} 当MongoDB 查询失败时抛出。
   * @keyword-cn 用户标签列表, 已用标签
   * @keyword-en list-user-tags, used-tags
   * @since 2026-02-04
   */
  async listDistinctTags(userId?: string, limit = 500): Promise<string[]> {
    const names = userId
      ? await this.tagLinks.listTagNames({
          imageIds: await this.findImageIds({ userId }),
        })
      : await this.tagLinks.listTagNames({});
    return this.sortTagNames(names, limit);
  }

  /**
   * @description 列出某用户某分组图片上出现过的标签；先用覆盖索引取图片 ID，再查关联表。
   * @param {string | undefined} userId - 用户ID过滤。
   * @param {number | undefined} groupId - 图库组ID过滤。
   * @param {number} [limit=500] - 返回条数上限。
   * @returns {Promise<string[]>} 标签列表。
   * @keyword-cn 分组标签列表, 按分组列标签
   * @keyword-en list-group-tags, tags-by-group
   */
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
    const names =
      Object.keys(filter).length === 0
        ? await this.tagLinks.listTagNames({})
        : await this.tagLinks.listTagNames({
            imageIds: await this.findImageIds(filter),
          });
    return this.sortTagNames(names, limit);
  }

  /**
   * @description 按 tags 检索图片。默认排除 isUsed=true（已被生成消耗）的图片,
   *  传 includeUsed=true 可关闭该过滤（用于素材管理类查询）。标签先在关联表换算成图片 ID 再查图片。
   * @keyword-cn 按标签检索图片, 排除已使用
   * @keyword-en search-images-by-tags, exclude-used-images
   */
  async searchByTags(input: {
    userId?: string;
    tenantId?: string;
    groupId?: string | number;
    tags: string[];
    limit?: number;
    matchCollage?: boolean;
    imageType?: GalleryImageType;
    /** 是否包含已使用 (isUsed=true) 图片, 默认 false */
    includeUsed?: boolean;
  }): Promise<GalleryImageEntity[]> {
    const tags = this.normalizeTags(input?.tags);
    if (tags.length === 0) return [];
    const scopeKey = this.scopeKeyOf(input.tenantId);
    const clauses: Record<string, unknown>[] = [
      this.buildTenantFilter(input.userId, input.tenantId),
      await this.tagIdClause(scopeKey, 'any', tags),
    ];
    if (input.imageType && input.imageType !== 'all') {
      clauses.push(await this.buildImageTypeFilter(scopeKey, input.imageType));
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
      .find(filter, { projection: PUBLIC_IMAGE_PROJECTION })
      .sort({ id: -1 })
      .limit(lim)
      .toArray();
    return (await this.attachTags(rows)).map(
      (row) => this.toPublicImage(row) as GalleryImageEntity,
    );
  }

  /**
   * @description 统计指定 tags 当前可用图片数(默认已排除 isUsed)。用于生成前的不足量预估。
   *  返回 byTag 字典(每个 tag 单独 count) + total(去重后总数,$or 匹配任一 tag)。
   *  传 includeUsed=true 关闭 isUsed 过滤(不去重生成时统计全量)。
   * @keyword-cn 标签可用量统计, 生成前余量预估
   * @keyword-en count-available-by-tags, pre-generation-capacity
   */
  async countAvailableByTags(input: {
    userId?: string;
    tenantId?: string;
    tags: string[];
    imageType?: GalleryImageType;
    /** 是否包含已使用 (isUsed=true) 图片, 默认 false(去重统计) */
    includeUsed?: boolean;
  }): Promise<{ total: number; byTag: Record<string, number> }> {
    const tags = Array.isArray(input?.tags)
      ? input.tags.map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    if (tags.length === 0) return { total: 0, byTag: {} };
    const scopeKey = this.scopeKeyOf(input.tenantId);
    const baseClauses: Record<string, unknown>[] = [
      this.buildTenantFilter(input.userId, input.tenantId),
    ];
    if (input.includeUsed !== true) {
      baseClauses.push({ isUsed: { $ne: true } });
    }
    if (input.imageType && input.imageType !== 'all') {
      baseClauses.push(
        await this.buildImageTypeFilter(scopeKey, input.imageType),
      );
    }
    const byTag: Record<string, number> = {};
    for (const t of tags) {
      const filter = {
        $and: [
          ...baseClauses,
          await this.tagIdClause(scopeKey, 'any', this.normalizeTags([t])),
        ],
      };
      byTag[t] = await this.images.countDocuments(filter);
    }
    const totalFilter = {
      $and: [
        ...baseClauses,
        await this.tagIdClause(scopeKey, 'any', this.normalizeTags(tags)),
      ],
    };
    const total = await this.images.countDocuments(totalFilter);
    return { total, byTag };
  }

  /**
   * @description 列出租户可见的热门 tag (按图片数量倒序),用于 AI 推荐 tag 选择。
   *  自动过滤 isUsed=true 的图片,避免推荐已耗尽的 tag。计数在关联表上按图片 ID 范围完成，不展开图片文档。
   * @keyword-cn 热门标签推荐, 按图片数排行
   * @keyword-en list-top-tags, tag-count-ranking
   */
  async listTopTagsWithCount(input: {
    userId?: string;
    tenantId?: string;
    limit?: number;
    imageType?: GalleryImageType;
  }): Promise<Array<{ tag: string; count: number }>> {
    const tenantFilter = this.buildTenantFilter(input.userId, input.tenantId);
    const scopeKey = this.scopeKeyOf(input.tenantId);
    const lim = Math.max(1, Math.min(50, Math.floor(input.limit ?? 12)));
    const usedIds = await this.findImageIds({
      $and: [tenantFilter, { isUsed: true }],
    });
    if (!input.imageType || input.imageType === 'all') {
      return this.tagLinks.countImagesPerTag({
        scopeKey,
        excludeImageIds: usedIds,
        limit: lim,
      });
    }
    // 图片类型同样换算成图片 ID：拼图 ID 走覆盖索引，类型标签走关联表
    const rule = this.imageTypeTagRule(input.imageType);
    const [collageIds, taggedIds] = await Promise.all([
      this.findImageIds({ $and: [tenantFilter, { isCollage: true }] }),
      this.tagLinks.imageIdsWithAnyTag(scopeKey, rule.tags),
    ]);
    if (rule.mode === 'exclude') {
      return this.tagLinks.countImagesPerTag({
        scopeKey,
        excludeImageIds: [...usedIds, ...collageIds, ...taggedIds],
        limit: lim,
      });
    }
    const used = new Set(usedIds);
    return this.tagLinks.countImagesPerTag({
      scopeKey,
      onlyImageIds: [...collageIds, ...taggedIds].filter((id) => !used.has(id)),
      limit: lim,
    });
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
    imageType?: GalleryImageType;
    excludedGroupIds?: Array<string | number>;
    excludedTags?: string[];
    limit?: number;
    /** 是否包含已使用图片, 默认 false */
    includeUsed?: boolean;
  }): Promise<GalleryImageEntity[]> {
    const scopeKey = this.scopeKeyOf(input.tenantId);
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
    const tags = this.normalizeTags(input.tags);
    if (tags.length > 0) {
      clauses.push(await this.tagIdClause(scopeKey, 'any', tags));
    }
    if (input.imageType && input.imageType !== 'all') {
      clauses.push(await this.buildImageTypeFilter(scopeKey, input.imageType));
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
    const excludedTags = this.normalizeTags(input.excludedTags);
    if (excludedTags.length > 0) {
      clauses.push(await this.tagIdClause(scopeKey, 'none', excludedTags));
    }
    if (input.includeUsed !== true) {
      clauses.push({ isUsed: { $ne: true } });
    }
    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
    const lim = Math.max(1, Math.min(200, Math.floor(input.limit ?? 24)));
    const pipe: Record<string, unknown>[] = [{ $match: filter }];
    pipe.push({ $sample: { size: lim } });
    pipe.push({ $project: PUBLIC_IMAGE_PROJECTION });
    const rows = await this.images
      .aggregate<GalleryImageDocument>(pipe)
      .toArray();
    return (await this.attachTags(rows)).map(
      (row) => this.toPublicImage(row) as GalleryImageEntity,
    );
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
    const remove = new Set(this.normalizeTags(input?.removeTags));
    if (add.length === 0 && remove.size === 0)
      return { matched: 0, modified: 0 };

    // 只读 id/租户/旧数组（迁移过渡兼容），可见口径与图库列表一致
    const rows = await this.images
      .find(
        {
          $and: [
            this.buildTenantFilter(input.userId, input.tenantId),
            { id: { $in: ids } },
          ],
        },
        { projection: { _id: 0, id: 1, tenantId: 1, tags: 1 } },
      )
      .toArray();
    if (rows.length === 0) return { matched: 0, modified: 0 };
    const withTags = await this.attachTags(rows);
    await this.writeImageTags(
      withTags.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        tags: Array.from(
          new Set([...row.tags.filter((tag) => !remove.has(tag)), ...add]),
        ),
      })),
    );
    const res = await this.images.updateMany(
      { id: { $in: rows.map((row) => row.id) } },
      { $set: { updatedAt: new Date() } },
    );
    return { matched: rows.length, modified: res.modifiedCount ?? 0 };
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
    await this.tagLinks.removeImages([doc.id]);

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

    const texts = (await this.attachTags(rows)).map((r) =>
      this.buildEmbeddingTextFromEntity(r),
    );
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
    imageType?: GalleryImageType,
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
        { $project: PUBLIC_IMAGE_PROJECTION },
      ];
      const rows = await this.attachTags(
        await this.images
          .aggregate<GalleryImageDocument & { score: number }>(pipe)
          .toArray(),
      );
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
    imageType?: GalleryImageType,
  ): Promise<GallerySearchResult[]> {
    const clauses: Record<string, unknown>[] = [
      this.buildTenantFilter(userId, tenantId),
    ];
    if (imageType && imageType !== 'all') {
      clauses.push(
        await this.buildImageTypeFilter(this.scopeKeyOf(tenantId), imageType),
      );
    }
    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
    const rows = await this.images.find(filter).toArray();
    const top = rows
      .filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0)
      .map((image) => ({
        image,
        score: this.embedding.cosineSimilarity(queryEmbedding, image.embedding),
      }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const withTags = await this.attachTags(top.map((x) => x.image));
    return withTags.map((image, idx) => ({
      image: this.toPublicImage(image) as GalleryImageEntity,
      score: top[idx].score,
    }));
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
