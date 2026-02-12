import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { Collection, Db, ObjectId } from 'mongodb';
import { join, resolve } from 'path';
import { EmbeddingService } from '../../shared/embedding/embedding.service.js';
import type {
  GalleryImageCreateInput,
  GalleryImageEntity,
  GallerySearchResult,
} from '../entities/gallery-image.entity.js';

@Injectable()
export class GalleryService {
  private readonly images: Collection<GalleryImageEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly VECTOR_INDEX_NAME = 'gallery_image_embedding_index';
  private isAtlasAvailable: boolean | null = null;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly embedding: EmbeddingService,
  ) {
    this.images = db.collection<GalleryImageEntity>('gallery_images');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 创建 gallery_images 所需索引，并初始化自增计数器。
   * @returns {Promise<void>} 无返回值。
   * @throws {Error} 当MongoDB创建索引或写入计数器失败时抛出。
   * @keyword gallery, mongo, index
   * @since 2026-02-04
   */
  async ensureIndexes(): Promise<void> {
    await this.images.createIndex({ id: 1 }, { unique: true });
    await this.images.createIndex({ userId: 1 });
    await this.images.createIndex({ groupId: 1, createdAt: -1 });
    await this.images.createIndex({ tags: 1 });
    await this.images.createIndex({ createdAt: -1 });
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
   * @keyword gallery, tag, normalize
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
      const t = String(raw ?? '').trim();
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
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
   * @keyword gallery, create, upload
   * @since 2026-02-04
   */
  async createMany(
    inputs: GalleryImageCreateInput[],
  ): Promise<GalleryImageEntity[]> {
    if (!Array.isArray(inputs) || inputs.length === 0) return [];

    const now = new Date();
    const ids = await Promise.all(inputs.map(() => this.nextId()));
    const texts = inputs.map((i) => this.buildEmbeddingText(i));
    const embeddings = await this.embedding.embedBatch(texts);

    const docs: GalleryImageEntity[] = inputs.map((input, idx) => ({
      _id: new ObjectId(),
      id: ids[idx],
      userId: input.userId,
      groupId: input.groupId,
      originalName: input.originalName,
      fileName: input.fileName,
      url: input.url,
      thumbFileName: input.thumbFileName,
      thumbUrl: input.thumbUrl,
      absPath: input.absPath,
      mimeType: input.mimeType,
      size: input.size,
      tags: Array.isArray(input.tags) ? input.tags : [],
      description: input.description,
      embedding: embeddings[idx] ?? new Array<number>(768).fill(0),
      createdAt: now,
      updatedAt: now,
    }));

    await this.images.insertMany(docs);
    return docs;
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
    groupId?: number,
    tag?: string,
    cursorId?: number,
    limit = 50,
  ): Promise<GalleryImageEntity[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
    if (typeof groupId === 'number') filter.groupId = groupId;
    if (tag) filter.tags = tag;
    if (typeof cursorId === 'number' && Number.isFinite(cursorId)) {
      filter.id = { $lt: cursorId };
    }
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    return this.images
      .find(filter, { projection: { _id: 0 } })
      .sort({ id: -1 })
      .limit(lim)
      .toArray();
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
    if (typeof groupId === 'number' && Number.isFinite(groupId)) {
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

  async searchByTags(input: {
    userId?: string;
    groupId?: number;
    tags: string[];
    limit?: number;
  }): Promise<GalleryImageEntity[]> {
    const tags = Array.isArray(input?.tags)
      ? input.tags.map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    if (tags.length === 0) return [];
    const filter: Record<string, unknown> = { tags: { $in: tags } };
    if (input.userId) filter.userId = input.userId;
    if (typeof input.groupId === 'number' && Number.isFinite(input.groupId)) {
      filter.groupId = input.groupId;
    }
    const lim = Math.max(1, Math.min(200, Math.floor(input.limit ?? 24)));
    return this.images
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1, id: -1 })
      .limit(lim)
      .toArray();
  }

  async sampleRandom(input: {
    userId?: string;
    groupId?: number;
    limit?: number;
  }): Promise<GalleryImageEntity[]> {
    const match: Record<string, unknown> = {};
    if (input.userId) match.userId = input.userId;
    if (typeof input.groupId === 'number' && Number.isFinite(input.groupId)) {
      match.groupId = input.groupId;
    }
    const lim = Math.max(1, Math.min(200, Math.floor(input.limit ?? 24)));
    const pipe: Record<string, unknown>[] = [];
    if (Object.keys(match).length > 0) pipe.push({ $match: match });
    pipe.push({ $sample: { size: lim } });
    pipe.push({ $project: { _id: 0 } });
    return this.images.aggregate<GalleryImageEntity>(pipe).toArray();
  }

  /**
   * @description 批量为图片添加/移除标签（基于 userId + id 列表）。
   * @param {{ userId: string; ids: number[]; addTags?: unknown; removeTags?: unknown }} input - 批量更新输入。
   * @returns {Promise<{ matched: number; modified: number }>} 匹配与修改数量。
   * @throws {Error} 当MongoDB updateMany 失败时抛出。
   * @keyword gallery, tag, batch
   * @since 2026-02-04
   */
  async updateTagsBatch(input: {
    userId: string;
    ids: number[];
    addTags?: unknown;
    removeTags?: unknown;
  }): Promise<{ matched: number; modified: number }> {
    const userId = String(input?.userId ?? '').trim();
    if (!userId) return { matched: 0, modified: 0 };
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
      { userId, id: { $in: ids } },
      update,
    );
    return { matched: res.matchedCount ?? 0, modified: res.modifiedCount ?? 0 };
  }

  /**
   * @description 删除单张图片记录，并在安全范围内尝试删除本地文件与缩略图文件。
   * @param {{ userId: string; id: number }} input - 删除输入。
   * @returns {Promise<{ ok: boolean }>} 删除结果。
   * @throws {Error} 当MongoDB查询或删除失败时抛出。
   * @keyword gallery, image, delete
   * @since 2026-02-04
   */
  async deleteImage(input: {
    userId: string;
    id: number;
  }): Promise<{ ok: boolean }> {
    const userId = String(input?.userId ?? '').trim();
    const id = Number(input?.id);
    if (!userId || !Number.isFinite(id)) return { ok: false };

    const doc = await this.images.findOne({ userId, id });
    if (!doc) return { ok: false };

    const del = await this.images.deleteOne({ userId, id });
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
   * @description 批量重建图片Embedding向量，支持从指定 startId 起更新 limit 条。
   * @param {{ userId: string; startId?: number; limit?: number }} input - 重建输入。
   * @returns {Promise<{ updated: number }>} 更新条数。
   * @throws {Error} 当MongoDB读取/写入失败时抛出。
   * @keyword gallery, embedding, batch
   * @since 2026-02-04
   */
  async rebuildEmbeddings(input: {
    userId: string;
    startId?: number;
    limit?: number;
  }): Promise<{ updated: number }> {
    const userId = String(input?.userId ?? '').trim();
    if (!userId) return { updated: 0 };
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

    const filter: Record<string, unknown> = { userId };
    if (Number.isFinite(startId)) filter.id = { $gte: startId };

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
    const embeddings = await this.embedding.embedBatch(texts);
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
   * @param {number} [limit=8] - 返回条数。
   * @param {number} [minScore=0.5] - 最小相似度阈值。
   * @returns {Promise<GallerySearchResult[]>} 相似检索结果。
   * @throws {Error} 当Embedding生成失败且未能回退时抛出。
   * @keyword gallery, vector-search, similarity
   * @example
   * // 搜索与“简历头像”相似的图片
   * const results = await galleryService.searchSimilar('resume avatar', 'u1', 8, 0.6);
   * @since 2026-02-04
   */
  async searchSimilar(
    query: string,
    userId?: string,
    limit = 8,
    minScore = 0.5,
  ): Promise<GallerySearchResult[]> {
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
      const rows = await this.images
        .aggregate<GalleryImageEntity & { score: number }>(pipe)
        .toArray();
      this.isAtlasAvailable = true;
      return rows
        .filter((r) => r.score >= minScore)
        .slice(0, limit)
        .map((r) => ({ image: r, score: r.score }));
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
   * @returns {Promise<GallerySearchResult[]>} 相似检索结果。
   * @throws {Error} 当数据库查询失败时抛出。
   * @keyword gallery, fallback, cosine
   * @since 2026-02-04
   */
  private async searchSimilarLocal(
    queryEmbedding: number[],
    userId: string | undefined,
    limit: number,
    minScore: number,
  ): Promise<GallerySearchResult[]> {
    const filter: Record<string, unknown> = {};
    if (userId) filter.userId = userId;
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
        const anyImg = x.image as unknown as Record<string, unknown>;
        const clean = { ...anyImg };
        delete (clean as { _id?: unknown })._id;
        return {
          image: clean as unknown as GalleryImageEntity,
          score: x.score,
        };
      });
    return scored;
  }
}
