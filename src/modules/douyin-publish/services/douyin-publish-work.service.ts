import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import { DouyinWorkbenchRepositoryService } from '../../douyin-workbench/services/douyin-workbench-repository.service.js';
import type {
  CreateDouyinPublishWorkDto,
  DouyinPublishResultDto,
  UpdateDouyinPublishWorkDto,
} from '../controller/douyin-publish.dto.js';
import {
  DOUYIN_PUBLISH_LEASE_MS,
  type DouyinPublishLibraryStats,
  type DouyinPublishScope,
  type DouyinPublishStatus,
  type DouyinPublishWorkEntity,
  type DouyinPublishWorkView,
} from '../entities/douyin-publish.entity.js';
import { DouyinPublishLibraryService } from './douyin-publish-library.service.js';

/**
 * @description 管理发布作品快照、列表、换库、FIFO 租约和发布结果。
 * @keyword-cn 发布作品服务, 发布队列
 * @keyword-en publish-work-service, publish-queue
 */
@Injectable()
export class DouyinPublishWorkService {
  private readonly works: Collection<DouyinPublishWorkEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly libraries: DouyinPublishLibraryService,
    private readonly workbench: DouyinWorkbenchRepositoryService,
  ) {
    this.works = db.collection<DouyinPublishWorkEntity>('douyin_publish_works');
    void this.ensureIndexes();
  }

  /**
   * @description 建立发布作品队列、选题定位和发布时间索引。
   * @keyword-cn 发布作品索引, 领取队列索引
   * @keyword-en publish-work-indexes, lease-queue-index
   */
  async ensureIndexes(): Promise<void> {
    await this.works.createIndex({ libraryId: 1, status: 1, createdAt: 1 });
    await this.works.createIndex({ tenantId: 1, topicId: 1 });
    await this.works.createIndex({ libraryId: 1, status: 1, publishedAt: -1 });
    await this.works.createIndex({ libraryId: 1, douyinVideoId: 1 });
    await this.works.createIndex(
      { tenantId: 1, userId: 1, topicId: 1 },
      {
        unique: true,
        partialFilterExpression: { topicId: { $type: 'number' } },
      },
    );
  }

  /**
   * @description 新建作品，并从当前租户视频库复制地址、封面和时长快照。
   * @keyword-cn 作品入库, 视频快照
   * @keyword-en create-publish-work, video-snapshot
   */
  async create(
    libraryId: string,
    input: CreateDouyinPublishWorkDto,
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishWorkView> {
    const library = await this.libraries.require(libraryId, scope);
    if (input.topicId !== undefined) {
      const duplicate = await this.works.findOne({
        ...this.scopeFilter(scope),
        topicId: input.topicId,
      });
      if (duplicate) this.throwDuplicate(duplicate);
    }
    const numericVideoId = Number(input.videoId);
    if (!Number.isInteger(numericVideoId) || numericVideoId <= 0) {
      throw new NotFoundException('DOUYIN_VIDEO_ASSET_NOT_FOUND');
    }
    const video = await this.workbench.requireVideo(numericVideoId, scope);
    const now = new Date();
    const entity: DouyinPublishWorkEntity = {
      _id: new ObjectId(),
      libraryId: library._id,
      userId: scope.userId,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      topicId: input.topicId ?? null,
      source: 'video',
      videoId: String(numericVideoId),
      title: this.requireTitle(input.title),
      description: String(input.description ?? '').trim(),
      tags: this.normalizeTags(input.tags),
      videoUrl: typeof video.url === 'string' ? video.url : '',
      coverUrl: typeof video.coverUrl === 'string' ? video.coverUrl : '',
      duration:
        typeof video.durationMs === 'number' &&
        Number.isFinite(video.durationMs)
          ? Math.max(0, Math.round(video.durationMs / 1000))
          : null,
      status: 'unpublished',
      douyinVideoId: null,
      publishedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.works.insertOne(entity);
    } catch (error) {
      if (
        (error as { code?: number }).code === 11000 &&
        input.topicId !== undefined
      ) {
        const duplicate = await this.works.findOne({
          ...this.scopeFilter(scope),
          topicId: input.topicId,
        });
        if (duplicate) this.throwDuplicate(duplicate);
      }
      throw error;
    }
    return this.toView(entity);
  }

  /**
   * @description 按抖音链接直接建一条已发布作品（数据监控「新增链接」），不带视频快照，也不会被小程序领取；
   *   同一发布库里同一作品 ID 重复时返回 409 并带上已有作品。
   * @keyword-cn 按链接建作品, 手动链接作品
   * @keyword-en create-work-from-link, manual-link-work
   */
  async createFromLink(
    libraryId: string,
    input: { title: string; douyinVideoId: string; douyinUrl: string },
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishWorkView> {
    const library = await this.libraries.require(libraryId, scope);
    const duplicate = await this.works.findOne({
      libraryId: library._id,
      douyinVideoId: input.douyinVideoId,
    });
    if (duplicate) this.throwDuplicate(duplicate);
    const now = new Date();
    const entity: DouyinPublishWorkEntity = {
      _id: new ObjectId(),
      libraryId: library._id,
      userId: scope.userId,
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      topicId: null,
      source: 'manual-link',
      douyinUrl: input.douyinUrl,
      videoId: '',
      title: this.requireTitle(input.title),
      description: '',
      tags: [],
      videoUrl: '',
      coverUrl: '',
      duration: null,
      status: 'published',
      douyinVideoId: input.douyinVideoId,
      publishedAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.works.insertOne(entity);
    return this.toView(entity);
  }

  /**
   * @description 按 ID 读取当前作用域内的作品实体，不存在时返回 null，供数据监控校验与定时抓取使用。
   * @keyword-cn 读取发布作品, 数据监控校验
   * @keyword-en find-publish-work, data-monitor-check
   */
  async findWork(
    id: string,
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishWorkEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.works.findOne({
      _id: new ObjectId(id),
      ...this.scopeFilter(scope),
    });
  }

  /**
   * @description 按状态、关键词和分页列出库内作品，并返回库统计。
   * @keyword-cn 作品列表, 发布状态筛选
   * @keyword-en list-publish-works, publish-status-filter
   */
  async list(
    libraryId: string,
    params: {
      status: DouyinPublishStatus;
      keyword?: string;
      page: number;
      pageSize: number;
    },
    scope: DouyinPublishScope,
  ): Promise<{
    items: DouyinPublishWorkView[];
    total: number;
    page: number;
    pageSize: number;
    stats: DouyinPublishLibraryStats;
  }> {
    const library = await this.libraries.require(libraryId, scope);
    const filter: Record<string, unknown> = {
      libraryId: library._id,
      status: params.status,
    };
    const keyword = String(params.keyword ?? '').trim();
    if (keyword) {
      const regex = new RegExp(this.escapeRegex(keyword), 'i');
      filter.$or = [{ title: regex }, { description: regex }, { tags: regex }];
    }
    const sort: Record<string, 1 | -1> =
      params.status === 'published' ? { publishedAt: -1 } : { createdAt: 1 };
    const [items, total, stats] = await Promise.all([
      this.works
        .find(filter)
        .sort(sort)
        .skip((params.page - 1) * params.pageSize)
        .limit(params.pageSize)
        .toArray(),
      this.works.countDocuments(filter),
      this.libraries.getStats(library._id),
    ]);
    return {
      items: items.map((item) => this.toView(item)),
      total,
      page: params.page,
      pageSize: params.pageSize,
      stats,
    };
  }

  /**
   * @description 查询一组选题已经落入的作品和发布库位置。
   * @keyword-cn 选题入库位置
   * @keyword-en topic-work-locations
   */
  async locations(topicIds: number[], scope: DouyinPublishScope) {
    const rows = await this.works
      .find({ ...this.scopeFilter(scope), topicId: { $in: topicIds } })
      .project<{ _id: ObjectId; libraryId: ObjectId; topicId: number }>({
        libraryId: 1,
        topicId: 1,
      })
      .toArray();
    return rows.map((row) => ({
      topicId: row.topicId,
      workId: row._id.toHexString(),
      libraryId: row.libraryId.toHexString(),
    }));
  }

  /**
   * @description 更新作品文案或换库；存在有效租约时拒绝修改。
   * @keyword-cn 更新发布作品, 租约修改保护
   * @keyword-en update-publish-work, leased-mutation-guard
   */
  async update(
    id: string,
    input: UpdateDouyinPublishWorkDto,
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishWorkView> {
    const current = await this.requireWork(id, scope);
    if (this.isLeased(current)) this.throwLeased();
    let targetLibraryId = current.libraryId;
    if (input.libraryId !== undefined) {
      targetLibraryId = (await this.libraries.require(input.libraryId, scope))
        ._id;
    }
    const set: Record<string, unknown> = {
      libraryId: targetLibraryId,
      updatedAt: new Date(),
    };
    if (input.title !== undefined) set.title = this.requireTitle(input.title);
    if (input.description !== undefined)
      set.description = input.description.trim();
    if (input.tags !== undefined) set.tags = this.normalizeTags(input.tags);
    const result = await this.works.findOneAndUpdate(
      {
        _id: current._id,
        $and: [
          this.scopeFilter(scope),
          {
            $or: [
              { lockExpireAt: { $exists: false } },
              { lockExpireAt: null },
              { lockExpireAt: { $lte: new Date() } },
            ],
          },
        ],
      },
      { $set: set },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (!result.value) this.throwLeased();
    return this.toView(result.value);
  }

  /**
   * @description 删除无有效租约的作品。
   * @keyword-cn 删除发布作品, 租约删除保护
   * @keyword-en delete-publish-work, leased-delete-guard
   */
  async remove(id: string, scope: DouyinPublishScope): Promise<void> {
    const current = await this.requireWork(id, scope);
    if (this.isLeased(current)) this.throwLeased();
    const result = await this.works.deleteOne({
      _id: current._id,
      $and: [
        this.scopeFilter(scope),
        {
          $or: [
            { lockExpireAt: { $exists: false } },
            { lockExpireAt: null },
            { lockExpireAt: { $lte: new Date() } },
          ],
        },
      ],
    });
    if (result.deletedCount !== 1) this.throwLeased();
  }

  /**
   * @description 原子领取库内最早创建且没有有效租约的未发布作品。
   * @keyword-cn FIFO领取, 原子租约
   * @keyword-en fifo-lease-next, atomic-lease
   */
  async leaseNext(
    libraryId: ObjectId,
  ): Promise<DouyinPublishWorkEntity | null> {
    const now = new Date();
    const result = await this.works.findOneAndUpdate(
      {
        libraryId,
        status: 'unpublished',
        $or: [
          { lockExpireAt: { $exists: false } },
          { lockExpireAt: null },
          { lockExpireAt: { $lte: now } },
        ],
      },
      {
        $set: {
          lockExpireAt: new Date(now.getTime() + DOUYIN_PUBLISH_LEASE_MS),
          leaseToken: randomBytes(32).toString('base64url'),
          updatedAt: now,
        },
      },
      {
        sort: { createdAt: 1 },
        returnDocument: 'after',
        includeResultMetadata: true,
      },
    );
    return result.value ?? null;
  }

  /**
   * @description 按扫码 token 所属库读取指定作品。
   * @keyword-cn 小程序读取作品
   * @keyword-en miniapp-get-work
   */
  async getForLibrary(
    id: string,
    libraryId: ObjectId,
  ): Promise<DouyinPublishWorkEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.works.findOne({ _id: new ObjectId(id), libraryId });
  }

  /**
   * @description 回写发布成功或失败结果，终态成功回写幂等并始终释放租约。
   * @keyword-cn 发布结果回写, 释放租约
   * @keyword-en update-publish-result, release-lease
   */
  async updatePublishResult(
    id: string,
    libraryId: ObjectId,
    input: DouyinPublishResultDto,
  ): Promise<void> {
    const current = await this.getForLibrary(id, libraryId);
    if (!current) throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_FOUND');
    if (current.status === 'published') return;
    const now = new Date();
    if (input.status === 'published') {
      await this.works.updateOne(
        { _id: current._id, libraryId },
        {
          $set: {
            status: 'published',
            publishedAt: now,
            douyinVideoId: String(input.douyinVideoId ?? '').trim() || null,
            publishedSnapshot: {
              title: this.requireTitle(input.title ?? current.title),
              description: String(
                input.description ?? current.description,
              ).trim(),
              tags:
                input.tags === undefined
                  ? current.tags
                  : this.normalizeTags(input.tags),
            },
            lastError: null,
            lockExpireAt: null,
            leaseToken: null,
            updatedAt: now,
          },
        },
      );
      return;
    }
    await this.works.updateOne(
      { _id: current._id, libraryId },
      {
        $set: {
          lastError: String(input.errorMessage ?? '').trim() || null,
          lockExpireAt: null,
          leaseToken: null,
          updatedAt: now,
        },
      },
    );
  }

  /**
   * @description 构造与抖音工作台一致的租户用户过滤。
   * @keyword-cn 作品作用域过滤, 用户隔离
   * @keyword-en work-scope-filter, user-isolation
   */
  private scopeFilter(scope: DouyinPublishScope): Record<string, unknown> {
    return {
      userId: scope.userId,
      ...(scope.tenantId
        ? { tenantId: scope.tenantId }
        : {
            $or: [
              { tenantId: { $exists: false } },
              { tenantId: null },
              { tenantId: '' },
            ],
          }),
    };
  }

  /**
   * @description 读取当前作用域作品，不存在时返回 404。
   * @keyword-cn 要求发布作品
   * @keyword-en require-publish-work
   */
  private async requireWork(
    id: string,
    scope: DouyinPublishScope,
  ): Promise<DouyinPublishWorkEntity> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_FOUND');
    const work = await this.works.findOne({
      _id: new ObjectId(id),
      ...this.scopeFilter(scope),
    });
    if (!work) throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_FOUND');
    return work;
  }

  /**
   * @description 归一标签，去除井号、空白和重复值。
   * @keyword-cn 标签归一化
   * @keyword-en normalize-publish-tags
   */
  private normalizeTags(tags?: string[]): string[] {
    const normalized = Array.from(
      new Set(
        (tags ?? [])
          .map((tag) => String(tag).replace(/^#+/, '').trim())
          .filter(Boolean),
      ),
    );
    if (normalized.length > 5 || normalized.some((tag) => tag.length > 20)) {
      throw new BadRequestException('DOUYIN_PUBLISH_TAGS_INVALID');
    }
    return normalized;
  }

  /**
   * @description 校验并归一作品标题。
   * @keyword-cn 标题归一化
   * @keyword-en normalize-publish-title
   */
  private requireTitle(title: string): string {
    const normalized = String(title ?? '').trim();
    if (!normalized || normalized.length > 60) {
      throw new BadRequestException('DOUYIN_PUBLISH_TITLE_INVALID');
    }
    return normalized;
  }

  /**
   * @description 判断作品当前是否处于有效租约中。
   * @keyword-cn 有效租约判断
   * @keyword-en active-lease-check
   */
  private isLeased(work: DouyinPublishWorkEntity): boolean {
    return Boolean(
      work.lockExpireAt && work.lockExpireAt.getTime() > Date.now(),
    );
  }

  /**
   * @description 抛出作品租约冲突错误。
   * @keyword-cn 租约冲突错误
   * @keyword-en leased-work-conflict
   */
  private throwLeased(): never {
    throw new ConflictException('DOUYIN_PUBLISH_WORK_LEASED');
  }

  /**
   * @description 抛出重复选题错误并携带已有作品与库 ID。
   * @keyword-cn 重复选题错误
   * @keyword-en duplicate-topic-conflict
   */
  private throwDuplicate(work: DouyinPublishWorkEntity): never {
    throw new ConflictException({
      statusCode: 409,
      message: 'DOUYIN_PUBLISH_WORK_EXISTS',
      error: 'Conflict',
      workId: work._id.toHexString(),
      libraryId: work.libraryId.toHexString(),
    });
  }

  /**
   * @description 转义关键词以安全构造 Mongo 正则。
   * @keyword-cn 搜索词转义
   * @keyword-en escape-search-regex
   */
  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * @description 把作品实体转换为管理端契约视图并实时计算 leased。
   * @keyword-cn 作品视图转换, 实时租约状态
   * @keyword-en publish-work-view-mapping, computed-lease-state
   */
  toView(work: DouyinPublishWorkEntity): DouyinPublishWorkView {
    return {
      id: work._id.toHexString(),
      libraryId: work.libraryId.toHexString(),
      topicId: work.topicId,
      source: work.source ?? 'video',
      douyinUrl: work.douyinUrl ?? null,
      videoId: work.videoId,
      title: work.title,
      description: work.description,
      tags: work.tags,
      videoUrl: work.videoUrl,
      coverUrl: work.coverUrl,
      duration: work.duration,
      status: work.status,
      douyinVideoId: work.douyinVideoId,
      publishedAt: work.publishedAt?.toISOString() ?? null,
      lastError: work.lastError,
      leased: this.isLeased(work),
      createdAt: work.createdAt.toISOString(),
      updatedAt: work.updatedAt.toISOString(),
    };
  }
}
