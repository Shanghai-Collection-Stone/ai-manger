import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type {
  VideoGroupCreateInput,
  VideoGroupEntity,
  VideoGroupUpdateInput,
  VideoGroupView,
} from '../entities/video-group.entity.js';
import type { VideoEntity } from '../entities/video.entity.js';

/**
 * @description 视频分组服务：分组 CRUD 与分组内视频计数。租户隔离口径与图库一致——
 *   无 tenantId 视为母平台，只看得到没有 tenantId 的数据；有 tenantId 只看本租户。
 * @keyword-cn 视频分组服务, 租户隔离
 * @keyword-en video-group-service, tenant-isolation
 */
@Injectable()
export class VideoGroupService {
  private readonly groups: Collection<VideoGroupEntity>;
  private readonly videos: Collection<VideoEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(@Inject('DS_MONGO_DB') db: Db) {
    this.groups = db.collection<VideoGroupEntity>('video_groups');
    this.videos = db.collection<VideoEntity>('videos');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 建立分组索引并初始化自增计数器。
   * @keyword-cn 分组索引
   * @keyword-en ensure-video-group-indexes
   * @returns {Promise<void>} 无返回值。
   */
  async ensureIndexes(): Promise<void> {
    await this.groups.createIndex({ id: 1 }, { unique: true });
    await this.groups.createIndex({ tenantId: 1, userId: 1 });
    await this.groups.createIndex({ createdAt: -1 });
    const exists = await this.counters.findOne({ _id: 'video_groups' });
    if (!exists) await this.counters.insertOne({ _id: 'video_groups', seq: 0 });
  }

  /**
   * @description 取下一个分组自增 ID。
   * @keyword-cn 分组自增ID
   * @keyword-en next-video-group-id
   * @returns {Promise<number>} 自增 ID。
   */
  private async nextId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'video_groups' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }

  /**
   * @description 构建租户可见性过滤条件，与 `GalleryService.buildTenantFilter` 同口径。
   * @keyword-cn 租户过滤
   * @keyword-en build-tenant-filter
   * @param {string} [tenantId] - 租户 ID。
   * @returns {Record<string, unknown>} MongoDB 过滤条件。
   */
  buildTenantFilter(tenantId?: string): Record<string, unknown> {
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
   * @description 列出当前租户可见的分组，并带上分组内视频数。计数走一次聚合而不是逐组
   *   `countDocuments`：分组是个位数量级，但每组一次往返在侧栏加载时会明显拖慢。
   * @keyword-cn 分组列表, 分组计数
   * @keyword-en list-video-groups, group-video-count
   * @param {{tenantId?: string, limit?: number}} [options] - 查询选项。
   * @returns {Promise<VideoGroupView[]>} 分组列表。
   */
  async list(options?: {
    tenantId?: string;
    limit?: number;
  }): Promise<VideoGroupView[]> {
    const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 100)));
    const filter = this.buildTenantFilter(options?.tenantId);
    const rows = await this.groups
      .find(filter, { projection: { _id: 0 } })
      .sort({ createdAt: -1, id: -1 })
      .limit(limit)
      .toArray();
    if (rows.length === 0) return [];

    const counts = await this.videos
      .aggregate<{ _id: number | null; count: number }>([
        { $match: { ...filter, groupId: { $in: rows.map((row) => row.id) } } },
        { $group: { _id: '$groupId', count: { $sum: 1 } } },
      ])
      .toArray();
    const countByGroup = new Map<number, number>(
      counts
        .filter((item) => typeof item._id === 'number')
        .map((item) => [item._id as number, item.count]),
    );

    return rows.map((row) => ({
      ...(row as Omit<VideoGroupEntity, '_id'>),
      video_count: countByGroup.get(row.id) ?? 0,
    }));
  }

  /**
   * @description 按业务 ID 读取分组（限当前租户可见）。
   * @keyword-cn 读取分组
   * @keyword-en find-video-group
   * @param {number} id - 分组 ID。
   * @param {string} [tenantId] - 租户 ID。
   * @returns {Promise<VideoGroupEntity|null>} 分组，未命中为 null。
   */
  async findById(
    id: number,
    tenantId?: string,
  ): Promise<VideoGroupEntity | null> {
    if (!Number.isFinite(id)) return null;
    return this.groups.findOne({
      $and: [{ id }, this.buildTenantFilter(tenantId)],
    });
  }

  /**
   * @description 新建分组。
   * @keyword-cn 新建分组
   * @keyword-en create-video-group
   * @param {VideoGroupCreateInput} input - 分组字段。
   * @returns {Promise<Omit<VideoGroupEntity, '_id'>>} 新分组。
   */
  async create(
    input: VideoGroupCreateInput,
  ): Promise<Omit<VideoGroupEntity, '_id'>> {
    const now = new Date();
    const doc: VideoGroupEntity = {
      _id: new ObjectId(),
      id: await this.nextId(),
      userId: input.userId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      name: input.name,
      description: input.description,
      tags: Array.isArray(input.tags) ? input.tags : [],
      createdAt: now,
      updatedAt: now,
    };
    await this.groups.insertOne(doc);
    const { _id, ...clean } = doc;
    void _id;
    return clean;
  }

  /**
   * @description 更新分组，只写传进来的字段。
   * @keyword-cn 更新分组
   * @keyword-en update-video-group
   * @param {number} id - 分组 ID。
   * @param {VideoGroupUpdateInput} input - 待更新字段。
   * @param {string} [tenantId] - 租户 ID。
   * @returns {Promise<Omit<VideoGroupEntity, '_id'>|null>} 更新后的分组，未命中为 null。
   */
  async update(
    id: number,
    input: VideoGroupUpdateInput,
    tenantId?: string,
  ): Promise<Omit<VideoGroupEntity, '_id'> | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim()) {
      patch.name = input.name.trim();
    }
    if (typeof input.description === 'string') {
      patch.description = input.description.trim();
    }
    if (Array.isArray(input.tags)) patch.tags = input.tags;
    const res = await this.groups.findOneAndUpdate(
      { $and: [{ id }, this.buildTenantFilter(tenantId)] },
      { $set: patch },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    return res ?? null;
  }

  /**
   * @description 删除分组，组内视频改为未分组而不是跟着删掉——分组是整理方式，
   *   删一个筛选条件不该连素材一起没。
   * @keyword-cn 删除分组, 视频转未分组
   * @keyword-en delete-video-group, detach-videos
   * @param {number} id - 分组 ID。
   * @param {string} [tenantId] - 租户 ID。
   * @returns {Promise<{ok: boolean, detached: number}>} 删除结果与被移出的视频数。
   */
  async remove(
    id: number,
    tenantId?: string,
  ): Promise<{ ok: boolean; detached: number }> {
    const filter = this.buildTenantFilter(tenantId);
    const res = await this.groups.deleteOne({ $and: [{ id }, filter] });
    if (res.deletedCount === 0) return { ok: false, detached: 0 };
    const detached = await this.videos.updateMany(
      { $and: [{ groupId: id }, filter] },
      { $set: { groupId: null, updatedAt: new Date() } },
    );
    return { ok: true, detached: detached.modifiedCount };
  }
}
