import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { OssStorageService } from './oss-storage.service.js';
import type {
  VideoCreateInput,
  VideoEntity,
  VideoUpdateInput,
} from '../entities/video.entity.js';

/**
 * @description 视频记录服务：登记、查询、改标签分组、删除。**删除必须先删库再清 OSS**——
 *   反过来一旦清完对象数据库写失败，列表里会留下一条点开就是 404 的记录；先删库最坏只是
 *   多一个没人引用的对象，可以靠对账脚本回收。
 * @keyword-cn 视频服务, 视频记录, OSS清理
 * @keyword-en video-library-service, video-record, oss-cleanup
 */
@Injectable()
export class VideoLibraryService {
  private readonly videos: Collection<VideoEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly oss: OssStorageService,
  ) {
    this.videos = db.collection<VideoEntity>('videos');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 建立视频索引并初始化自增计数器。`{tenantId, id}` 是列表查询的主索引，
   *   游标分页按 id 倒序走的就是它。
   * @keyword-cn 视频索引
   * @keyword-en ensure-video-indexes
   * @returns {Promise<void>} 无返回值。
   */
  async ensureIndexes(): Promise<void> {
    await this.videos.createIndex({ id: 1 }, { unique: true });
    await this.videos.createIndex({ tenantId: 1, id: -1 });
    await this.videos.createIndex({ tenantId: 1, groupId: 1, id: -1 });
    await this.videos.createIndex({ tenantId: 1, tags: 1 });
    await this.videos.createIndex({ key: 1 });
    const exists = await this.counters.findOne({ _id: 'videos' });
    if (!exists) await this.counters.insertOne({ _id: 'videos', seq: 0 });
  }

  /**
   * @description 取下一个视频自增 ID。
   * @keyword-cn 视频自增ID
   * @keyword-en next-video-id
   * @returns {Promise<number>} 自增 ID。
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'videos' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 构建租户可见性过滤条件，与图库同口径。
   * @keyword-cn 租户过滤
   * @keyword-en build-tenant-filter
   * @param {string} [tenantId] - 租户 ID。
   * @returns {Record<string, unknown>} MongoDB 过滤条件。
   */
  private buildTenantFilter(tenantId?: string): Record<string, unknown> {
    const current = String(tenantId ?? '').trim();
    if (!current) {
      return {
        $or: [
          { tenantId: { $exists: false } },
          { tenantId: null },
          { tenantId: '' },
        ],
      };
    }
    return { tenantId: current };
  }

  /**
   * @description 服务端登记一条站外地址的视频（OSS 未配置时保存 AI 平台返回的成片地址）。只供后端内部调用，
   *   不暴露给前端接口；对象键为空，删除记录时不会去清 OSS。
   * @keyword-cn 登记外部视频, 生成成片兜底
   * @keyword-en register-external-video, generated-video-fallback
   * @param {Omit<VideoCreateInput, 'key' | 'coverKey'> & {url: string}} input - 记录字段与外部地址。
   * @returns {Promise<Omit<VideoEntity, '_id'>>} 入库后的记录。
   */
  async registerExternal(
    input: Omit<VideoCreateInput, 'key' | 'coverKey'> & { url: string },
  ): Promise<Omit<VideoEntity, '_id'>> {
    const now = new Date();
    const doc: VideoEntity = {
      _id: new ObjectId(),
      id: await this.nextId(),
      userId: input.userId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      name: input.name,
      key: '',
      url: input.url,
      ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
      contentType: input.contentType,
      sizeBytes: Number(input.sizeBytes) || 0,
      durationMs: this.toNullableNumber(input.durationMs),
      width: this.toNullableNumber(input.width),
      height: this.toNullableNumber(input.height),
      tags: Array.isArray(input.tags) ? input.tags : [],
      groupId:
        typeof input.groupId === 'number' && Number.isFinite(input.groupId)
          ? input.groupId
          : null,
      createdAt: now,
      updatedAt: now,
    };
    await this.videos.insertOne(doc);
    const { _id, ...clean } = doc;
    void _id;
    return clean;
  }

  /**
   * @description 直传完成后登记一条视频记录。`url` 由服务端按对象键重算，不信前端传来的地址——
   *   否则任何人都能往库里写一条指向站外的"视频"。
   * @keyword-cn 登记视频, 直传回执
   * @keyword-en register-video, upload-receipt
   * @param {VideoCreateInput} input - 记录字段。
   * @returns {Promise<Omit<VideoEntity, '_id'>>} 入库后的记录。
   */
  async register(input: VideoCreateInput): Promise<Omit<VideoEntity, '_id'>> {
    const now = new Date();
    const key = String(input.key ?? '').replace(/^\/+/, '');
    const coverKey = String(input.coverKey ?? '').replace(/^\/+/, '');
    const doc: VideoEntity = {
      _id: new ObjectId(),
      id: await this.nextId(),
      userId: input.userId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      name: input.name,
      key,
      url: this.oss.publicUrl(key),
      ...(coverKey ? { coverKey, coverUrl: this.oss.publicUrl(coverKey) } : {}),
      contentType: input.contentType,
      sizeBytes: Number(input.sizeBytes) || 0,
      durationMs: this.toNullableNumber(input.durationMs),
      width: this.toNullableNumber(input.width),
      height: this.toNullableNumber(input.height),
      tags: Array.isArray(input.tags) ? input.tags : [],
      groupId:
        typeof input.groupId === 'number' && Number.isFinite(input.groupId)
          ? input.groupId
          : null,
      createdAt: now,
      updatedAt: now,
    };
    await this.videos.insertOne(doc);
    const { _id, ...clean } = doc;
    void _id;
    return clean;
  }

  /**
   * @description 把可能缺失的数值字段收敛成 number 或 null。
   * @keyword-cn 数值归一
   * @keyword-en nullable-number
   * @param {unknown} value - 原始值。
   * @returns {number|null} 数值或 null。
   */
  private toNullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  }

  /**
   * @description 游标分页查询视频列表。游标是上一页最后一条的 id，按 id 倒序取更小的，
   *   与 `/gallery` 的 `cursorId` 语义逐字一致，前端两处可以共用同一套分页代码。
   * @keyword-cn 视频列表, 游标分页
   * @keyword-en list-videos, cursor-pagination
   * @param {{tenantId?: string, groupId?: number, tag?: string, cursorId?: number, limit?: number}} [options] - 查询条件。
   * @returns {Promise<Array<Omit<VideoEntity, '_id'>>>} 视频列表。
   */
  async list(options?: {
    tenantId?: string;
    groupId?: number;
    tag?: string;
    cursorId?: number;
    limit?: number;
  }): Promise<Array<Omit<VideoEntity, '_id'>>> {
    const clauses: Record<string, unknown>[] = [
      this.buildTenantFilter(options?.tenantId),
    ];
    if (
      typeof options?.groupId === 'number' &&
      Number.isFinite(options.groupId)
    ) {
      clauses.push({ groupId: options.groupId });
    }
    if (options?.tag) clauses.push({ tags: options.tag });
    if (
      typeof options?.cursorId === 'number' &&
      Number.isFinite(options.cursorId)
    ) {
      clauses.push({ id: { $lt: options.cursorId } });
    }
    const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 24)));
    return this.videos
      .find(clauses.length === 1 ? clauses[0] : { $and: clauses }, {
        projection: { _id: 0 },
      })
      .sort({ id: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * @description 列出当前租户已用过的视频标签。
   * @keyword-cn 视频标签
   * @keyword-en list-video-tags
   * @param {{tenantId?: string, limit?: number}} [options] - 查询选项。
   * @returns {Promise<string[]>} 标签列表。
   */
  async listTags(options?: {
    tenantId?: string;
    limit?: number;
  }): Promise<string[]> {
    const raw = await this.videos.distinct(
      'tags',
      this.buildTenantFilter(options?.tenantId),
    );
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      const tag = String(item ?? '').trim();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
    out.sort((a, b) => a.localeCompare(b));
    const limit = Math.max(
      1,
      Math.min(5000, Math.floor(options?.limit ?? 500)),
    );
    return out.slice(0, limit);
  }

  /**
   * @description 更新视频的名称、标签或分组。对象键与地址不开放修改。
   * @keyword-cn 更新视频
   * @keyword-en update-video
   * @param {number} id - 视频 ID。
   * @param {VideoUpdateInput} input - 待更新字段。
   * @param {string} [tenantId] - 租户 ID。
   * @returns {Promise<Omit<VideoEntity, '_id'>|null>} 更新后的记录，未命中为 null。
   */
  async update(
    id: number,
    input: VideoUpdateInput,
    tenantId?: string,
  ): Promise<Omit<VideoEntity, '_id'> | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) {
      patch.name = input.name.trim();
    }
    if (Array.isArray(input.tags)) {
      patch.tags = input.tags
        .map((tag) => String(tag ?? '').trim())
        .filter(Boolean);
    }
    if (input.groupId === null) patch.groupId = null;
    else if (
      typeof input.groupId === 'number' &&
      Number.isFinite(input.groupId)
    ) {
      patch.groupId = input.groupId;
    }
    const res = await this.videos.findOneAndUpdate(
      { $and: [{ id }, this.buildTenantFilter(tenantId)] },
      { $set: patch },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    return res ?? null;
  }

  /**
   * @description 删除一批视频：先删库记录，再按记录里的 `key` / `coverKey` 清 OSS 对象。
   *   OSS 清理失败只回报在 `orphanKeys` 里，不影响删除结果——记录已经没了，
   *   为残留对象把接口判失败只会让用户以为视频还在。
   * @keyword-cn 删除视频, 清理OSS, 残留对象
   * @keyword-en delete-videos, cleanup-oss, orphan-objects
   * @param {{ids: number[], tenantId?: string}} input - 待删除的视频 ID 与租户。
   * @returns {Promise<{deleted: number, deletedIds: number[], orphanKeys: string[]}>} 删除统计。
   */
  async remove(input: {
    ids: number[];
    tenantId?: string;
  }): Promise<{ deleted: number; deletedIds: number[]; orphanKeys: string[] }> {
    const ids = Array.from(
      new Set(
        (Array.isArray(input.ids) ? input.ids : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id)),
      ),
    );
    if (ids.length === 0) return { deleted: 0, deletedIds: [], orphanKeys: [] };

    const filter = {
      $and: [{ id: { $in: ids } }, this.buildTenantFilter(input.tenantId)],
    };
    const rows = await this.videos
      .find(filter, { projection: { _id: 0, id: 1, key: 1, coverKey: 1 } })
      .toArray();
    if (rows.length === 0) {
      return { deleted: 0, deletedIds: [], orphanKeys: [] };
    }

    const deletedIds = rows.map((row) => row.id);
    await this.videos.deleteMany({ id: { $in: deletedIds } });

    const keys = rows.flatMap((row) =>
      [row.key, row.coverKey].filter(
        (key): key is string => typeof key === 'string' && key.length > 0,
      ),
    );
    const cleanup = await this.oss.deleteObjects(keys);
    return {
      deleted: deletedIds.length,
      deletedIds,
      orphanKeys: cleanup.failed,
    };
  }
}
