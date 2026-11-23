import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { Collection, Db, Filter, ObjectId } from 'mongodb';
import { OssStorageService } from '../../video-library/services/oss-storage.service.js';
import type {
  DouyinMusicCategory,
  DouyinMusicEntity,
  DouyinMusicView,
} from '../entities/douyin-music.entity.js';

/**
 * @description 音乐仓储使用的租户用户作用域；`canManageUploads` 表示管理员，可删除租户内任何成员上传的音乐。
 * @keyword-cn 音乐作用域, 租户用户
 * @keyword-en music-scope, tenant-user
 */
export type DouyinMusicScope = {
  tenantId?: string;
  userId: string;
  canManageUploads?: boolean;
};

/**
 * @description 持久化曲库曲目与用户上传音乐并强制数据边界：曲库和用户上传都按租户共享，平台公开曲目所有租户只读；上传音乐只有上传者和管理员能删。
 * @keyword-cn 音乐仓储, 租户边界
 * @keyword-en douyin-music-repository, tenant-boundary
 */
@Injectable()
export class DouyinMusicRepositoryService {
  private readonly tracks: Collection<DouyinMusicEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  /**
   * @description 初始化音乐集合、计数器并创建索引。
   * @keyword-cn 初始化音乐仓储, 音乐集合
   * @keyword-en init-music-repository, music-collection
   * @param {Db} db 业务库。
   * @param {OssStorageService} oss 对象存储，用来拼试听地址。
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly oss: OssStorageService,
  ) {
    this.tracks = db.collection<DouyinMusicEntity>('douyin_music_tracks');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 创建业务 ID 唯一索引、租户曲库索引、公开曲目索引与个人上传索引。
   * @keyword-cn 音乐索引, 曲库查询
   * @keyword-en music-indexes, library-query
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.tracks.createIndex({ id: 1 }, { unique: true });
    await this.tracks.createIndex({ tenantId: 1, source: 1, status: 1 });
    await this.tracks.createIndex({ isPublic: 1, source: 1, status: 1 });
    await this.tracks.createIndex({ userId: 1, source: 1, updatedAt: -1 });
  }

  /**
   * @description 列出当前用户能用的音乐：本租户曲库、平台公开曲库与租户成员上传的；`libraryOnly` 时只返回曲库（后台管理页）。
   * @keyword-cn 查询音乐列表, 可用音乐
   * @keyword-en list-douyin-music, usable-tracks
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @param {{includeArchived?: boolean, libraryOnly?: boolean}} [options] 是否含本租户已归档曲目、是否只看曲库。
   * @returns {Promise<DouyinMusicView[]>} 音乐列表。
   */
  async list(
    scope: DouyinMusicScope,
    options: { includeArchived?: boolean; libraryOnly?: boolean } = {},
  ): Promise<DouyinMusicView[]> {
    const active = { status: 'active' as const };
    const branches: Filter<DouyinMusicEntity>[] = [
      {
        $and: [
          this.tenantFilter(scope.tenantId),
          { source: 'library' as const },
          options.includeArchived ? {} : active,
        ],
      },
    ];
    if (scope.tenantId) branches.push({ $and: [this.publicFilter(), active] });
    if (!options.libraryOnly) branches.push(this.uploadFilter(scope));
    const rows = await this.tracks
      .find({ $or: branches })
      .sort({ updatedAt: -1 })
      // 上传按租户共享后条数随成员增长，放宽上限，避免已选曲目被截断后误报不可用
      .limit(2000)
      .toArray();
    return rows.map((row) => this.toView(row, scope));
  }

  /**
   * @description 读取当前用户能用的一首音乐（含已归档，已选用它的脚本不受影响）；越权或不存在返回 null。
   * @keyword-cn 读取可用音乐, 选用校验
   * @keyword-en get-usable-music, selection-check
   * @param {number} id 音乐业务 ID。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<DouyinMusicEntity|null>} 音乐记录。
   */
  async getUsable(
    id: number,
    scope: DouyinMusicScope,
  ): Promise<DouyinMusicEntity | null> {
    const branches: Filter<DouyinMusicEntity>[] = [
      {
        $and: [
          this.tenantFilter(scope.tenantId),
          { source: 'library' as const },
        ],
      },
      this.uploadFilter(scope),
    ];
    if (scope.tenantId) branches.push(this.publicFilter());
    return this.tracks.findOne({ id, $or: branches });
  }

  /**
   * @description 拼一首音乐的下载地址，合成与试听共用。
   * @keyword-cn 音乐地址, 对象存储地址
   * @keyword-en music-url, oss-public-url
   * @param {DouyinMusicEntity} row 音乐记录。
   * @returns {string} 可访问地址。
   */
  urlOf(row: DouyinMusicEntity): string {
    return this.oss.publicUrl(row.key);
  }

  /**
   * @description 统计用户本人已上传的音乐数量，用于每人上传上限校验。
   * @keyword-cn 统计自传音乐, 上传配额
   * @keyword-en count-user-uploads, upload-quota
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<number>} 数量。
   */
  async countUploads(scope: DouyinMusicScope): Promise<number> {
    return this.tracks.countDocuments(this.ownUploadFilter(scope));
  }

  /**
   * @description 写入一条音乐记录，曲库曲目只有母平台能设公开。
   * @keyword-cn 新建音乐记录, 音乐入库
   * @keyword-en create-music-record, persist-track
   * @param {object} input 音乐字段。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<DouyinMusicView>} 新建结果。
   * @throws {ForbiddenException} 租户设置公开开关时抛出。
   */
  async create(
    input: Pick<
      DouyinMusicEntity,
      'source' | 'name' | 'category' | 'key' | 'contentType' | 'sizeBytes'
    > & { licenseNote?: string; isPublic?: boolean },
    scope: DouyinMusicScope,
  ): Promise<DouyinMusicView> {
    this.assertPublicToggle(scope, input.isPublic);
    const now = new Date();
    const doc: DouyinMusicEntity = {
      _id: new ObjectId(),
      id: await this.nextId(),
      source: input.source,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      userId: scope.userId,
      name: input.name,
      category: input.category,
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      ...(input.licenseNote ? { licenseNote: input.licenseNote } : {}),
      status: 'active',
      ...(!scope.tenantId && input.source === 'library'
        ? { isPublic: input.isPublic === true }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.tracks.insertOne(doc);
    return this.toView(doc, scope);
  }

  /**
   * @description 更新本租户的曲库曲目，只写传入字段；平台公开曲目对租户只读，按不存在处理。
   * @keyword-cn 更新曲库曲目, 归档曲目
   * @keyword-en update-library-track, archive-track
   * @param {number} id 音乐业务 ID。
   * @param {object} input 待更新字段。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<DouyinMusicView|null>} 更新后的曲目，不存在时为 null。
   * @throws {ForbiddenException} 租户设置公开开关时抛出。
   */
  async updateLibrary(
    id: number,
    input: {
      name?: string;
      category?: DouyinMusicCategory;
      licenseNote?: string;
      status?: 'active' | 'archived';
      isPublic?: boolean;
    },
    scope: DouyinMusicScope,
  ): Promise<DouyinMusicView | null> {
    this.assertPublicToggle(scope, input.isPublic);
    const patch: Partial<DouyinMusicEntity> = { updatedAt: new Date() };
    for (const field of [
      'name',
      'category',
      'licenseNote',
      'status',
      'isPublic',
    ] as const) {
      if (input[field] !== undefined)
        Object.assign(patch, { [field]: input[field] });
    }
    const filter = this.libraryFilter(id, scope);
    const result = await this.tracks.updateOne(filter, { $set: patch });
    if (!result.matchedCount) return null;
    const row = await this.tracks.findOne(filter);
    return row ? this.toView(row, scope) : null;
  }

  /**
   * @description 删除本租户的曲库曲目并返回原记录，供调用方清理对象存储。
   * @keyword-cn 删除曲库曲目, 清理记录
   * @keyword-en remove-library-track, cleanup-record
   * @param {number} id 音乐业务 ID。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<DouyinMusicEntity|null>} 被删记录，不存在时为 null。
   */
  async removeLibrary(
    id: number,
    scope: DouyinMusicScope,
  ): Promise<DouyinMusicEntity | null> {
    return this.removeOne(this.libraryFilter(id, scope));
  }

  /**
   * @description 删除上传的音乐并返回原记录，供调用方清理对象存储：成员只能删自己传的，管理员可删本租户任何成员传的。
   * @keyword-cn 删除自传音乐, 上传者校验
   * @keyword-en remove-user-upload, uploader-check
   * @param {number} id 音乐业务 ID。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<DouyinMusicEntity|null>} 被删记录，不存在或无权删除时为 null。
   */
  async removeUpload(
    id: number,
    scope: DouyinMusicScope,
  ): Promise<DouyinMusicEntity | null> {
    const allowed = scope.canManageUploads
      ? this.uploadFilter(scope)
      : this.ownUploadFilter(scope);
    return this.removeOne({ $and: [{ id }, allowed] });
  }

  /**
   * @description 按条件读出并删除一条记录。
   * @keyword-cn 读取并删除, 单条删除
   * @keyword-en find-and-remove, remove-one
   * @param {Filter<DouyinMusicEntity>} filter 过滤条件。
   * @returns {Promise<DouyinMusicEntity|null>} 被删记录。
   */
  private async removeOne(
    filter: Filter<DouyinMusicEntity>,
  ): Promise<DouyinMusicEntity | null> {
    const row = await this.tracks.findOne(filter);
    if (!row) return null;
    const result = await this.tracks.deleteOne({ _id: row._id });
    return result.deletedCount ? row : null;
  }

  /**
   * @description 生成全局递增的音乐业务 ID。
   * @keyword-cn 音乐自增ID, 计数器
   * @keyword-en next-music-id, counter
   * @returns {Promise<number>} 新 ID。
   */
  private async nextId(): Promise<number> {
    const result = await this.counters.findOneAndUpdate(
      { _id: 'douyin_music_tracks' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    return result.value?.seq ?? 1;
  }

  /**
   * @description 构造租户过滤，母平台只访问无 tenantId 的平台数据。
   * @keyword-cn 音乐租户过滤, 母平台边界
   * @keyword-en music-tenant-filter, platform-boundary
   * @param {string} [tenantId] 租户 ID。
   * @returns {Filter<DouyinMusicEntity>} 过滤条件。
   */
  private tenantFilter(tenantId?: string): Filter<DouyinMusicEntity> {
    return (
      tenantId
        ? { tenantId }
        : {
            $or: [
              { tenantId: { $exists: false } },
              { tenantId: null },
              { tenantId: '' },
            ],
          }
    ) as Filter<DouyinMusicEntity>;
  }

  /**
   * @description 构造平台公开曲库过滤。
   * @keyword-cn 平台公开曲库, 公开过滤
   * @keyword-en public-library-filter, platform-public
   * @returns {Filter<DouyinMusicEntity>} 过滤条件。
   */
  private publicFilter(): Filter<DouyinMusicEntity> {
    return {
      $and: [
        this.tenantFilter(),
        { source: 'library' as const, isPublic: true },
      ],
    };
  }

  /**
   * @description 构造本租户成员上传音乐的过滤，查询与选用都按它在租户内共享。
   * @keyword-cn 租户上传过滤, 租户共享上传
   * @keyword-en tenant-upload-filter, tenant-shared-upload
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Filter<DouyinMusicEntity>} 过滤条件。
   */
  private uploadFilter(scope: DouyinMusicScope): Filter<DouyinMusicEntity> {
    return {
      $and: [this.tenantFilter(scope.tenantId), { source: 'upload' as const }],
    };
  }

  /**
   * @description 构造本人上传音乐的过滤，用于每人配额与成员删除校验。
   * @keyword-cn 本人上传过滤, 上传者边界
   * @keyword-en own-upload-filter, uploader-boundary
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Filter<DouyinMusicEntity>} 过滤条件。
   */
  private ownUploadFilter(scope: DouyinMusicScope): Filter<DouyinMusicEntity> {
    return { $and: [this.uploadFilter(scope), { userId: scope.userId }] };
  }

  /**
   * @description 构造本租户某首曲库曲目的过滤。
   * @keyword-cn 本租户曲目过滤, 曲库归属
   * @keyword-en own-library-filter, library-ownership
   * @param {number} id 音乐业务 ID。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Filter<DouyinMusicEntity>} 过滤条件。
   */
  private libraryFilter(
    id: number,
    scope: DouyinMusicScope,
  ): Filter<DouyinMusicEntity> {
    return {
      $and: [
        { id, source: 'library' as const },
        this.tenantFilter(scope.tenantId),
      ],
    };
  }

  /**
   * @description 公开开关只允许母平台设置，租户传入即拒绝。
   * @keyword-cn 音乐公开校验, 公开仅限平台
   * @keyword-en music-public-guard, public-platform-only
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @param {boolean} [isPublic] 请求里的公开开关。
   * @throws {ForbiddenException} 租户传入公开开关时抛出。
   */
  private assertPublicToggle(
    scope: DouyinMusicScope,
    isPublic?: boolean,
  ): void {
    if (isPublic !== undefined && scope.tenantId)
      throw new ForbiddenException('DOUYIN_MUSIC_PUBLIC_PLATFORM_ONLY');
  }

  /**
   * @description 生成前端视图：去掉数据库 ID、对象键和上传者 ID，补试听地址、平台只读标记、是否本人上传与能否删除。
   * @keyword-cn 音乐视图转换, 隐藏对象键
   * @keyword-en to-music-view, hide-object-key
   * @param {DouyinMusicEntity} row 音乐记录。
   * @param {DouyinMusicScope} scope 当前读取方作用域。
   * @returns {DouyinMusicView} 前端视图。
   */
  private toView(
    row: DouyinMusicEntity,
    scope: DouyinMusicScope,
  ): DouyinMusicView {
    const { _id, key, userId, tenantId: owner, ...rest } = row;
    void _id;
    const mine = userId === scope.userId;
    return {
      ...rest,
      url: this.oss.publicUrl(key),
      fromPlatform: Boolean(scope.tenantId) && !owner,
      mine,
      canDelete:
        row.source === 'upload' && (mine || Boolean(scope.canManageUploads)),
    };
  }
}
