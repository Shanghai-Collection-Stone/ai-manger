import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import type { DouyinPublishWorkEntity } from '../../douyin-publish/entities/douyin-publish.entity.js';
import { DouyinPublishWorkService } from '../../douyin-publish/services/douyin-publish-work.service.js';
import { TikhubDouyinService } from '../../tikhub/services/tikhub-douyin.service.js';
import {
  DOUYIN_DATA_DEFAULT_INTERVAL_MINUTES,
  DOUYIN_DATA_MONITOR_DAYS,
  type DouyinDataCollectorView,
  type DouyinDataMetricsView,
  type DouyinDataMonitorEntity,
  type DouyinDataMonitorView,
  type DouyinDataScope,
  type DouyinDataSnapshotEntity,
  type DouyinDataWorkItemView,
} from '../entities/douyin-data.entity.js';
import {
  resolveCrawlTarget,
  resolveDouyinAwemeId,
} from './douyin-aweme-link.js';

/** @type {number} 一个发布库最多读取的已发布作品数，与小红书数据监控一次读 200 篇同量级。 */
const LIBRARY_WORK_LIMIT = 500;

/**
 * @description 抖音作品数据监控：列出发布库里的已发布作品及其监控状态与区间指标，负责开启 / 取消监控、绑定作品链接与按链接新增作品。
 *   抓取本身在 `DouyinDataCrawlService`。
 * @keyword-cn 抖音数据监控服务, 作品监控
 * @keyword-en douyin-data-service, work-monitor
 */
@Injectable()
export class DouyinDataService {
  private readonly monitors: Collection<DouyinDataMonitorEntity>;
  private readonly snapshots: Collection<DouyinDataSnapshotEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly works: DouyinPublishWorkService,
    private readonly tikhub: TikhubDouyinService,
  ) {
    this.monitors = db.collection<DouyinDataMonitorEntity>(
      'douyin_data_monitors',
    );
    this.snapshots = db.collection<DouyinDataSnapshotEntity>(
      'douyin_data_snapshots',
    );
    void this.ensureIndexes();
  }

  /**
   * @description 建立监控表的作品唯一索引、调度到期索引与快照时间线索引。
   * @keyword-cn 数据监控索引, 调度到期索引
   * @keyword-en douyin-data-indexes, due-schedule-index
   */
  async ensureIndexes(): Promise<void> {
    await this.monitors.createIndex({ workId: 1 }, { unique: true });
    await this.monitors.createIndex({ status: 1, nextCrawlAt: 1 });
    await this.snapshots.createIndex({ workId: 1, crawledAt: -1 });
  }

  /**
   * @description 读取定时抓取间隔（分钟）：环境变量 `DOUYIN_DATA_CRAWL_INTERVAL_MINUTES` 取 30-1440，非法时用默认 360。
   * @keyword-cn 抓取间隔, 环境变量
   * @keyword-en crawl-interval, environment-config
   * @returns {number} 间隔分钟数。
   */
  intervalMinutes(): number {
    const value = Number(process.env.DOUYIN_DATA_CRAWL_INTERVAL_MINUTES);
    return Number.isInteger(value) && value >= 30 && value <= 1440
      ? value
      : DOUYIN_DATA_DEFAULT_INTERVAL_MINUTES;
  }

  /**
   * @description 列出发布库全部已发布作品，拼上监控状态、所选区间内最近一次抓取的指标与抓取目标；
   *   同时返回未发布数量（界面提示已隐藏几条）与 TikHub 采集通道是否可用。
   * @keyword-cn 数据监控作品列表, 区间指标
   * @keyword-en list-monitor-works, ranged-metrics
   * @param libraryId 视频发布库 ID。
   * @param range 指标时间区间，缺省为全部。
   * @param scope 租户用户作用域。
   * @returns 作品行、总数、未发布数与采集通道状态。
   */
  async listLibraryWorks(
    libraryId: string,
    range: { start?: Date; end?: Date },
    scope: DouyinDataScope,
  ): Promise<{
    items: DouyinDataWorkItemView[];
    total: number;
    unpublishedCount: number;
    collector: DouyinDataCollectorView;
  }> {
    const result = await this.works.list(
      libraryId,
      { status: 'published', page: 1, pageSize: LIBRARY_WORK_LIMIT },
      scope,
    );
    const workIds = result.items.map((item) => new ObjectId(item.id));
    const [monitorRows, metricsByWork, available] = await Promise.all([
      workIds.length
        ? this.monitors.find({ workId: { $in: workIds } }).toArray()
        : Promise.resolve([]),
      this.latestMetrics(workIds, range),
      this.tikhub.isReady(scope),
    ]);
    const monitorByWork = new Map(
      monitorRows.map((row) => [row.workId.toHexString(), row]),
    );
    return {
      items: result.items.map((work) => {
        const monitor = monitorByWork.get(work.id);
        return {
          work,
          monitor: monitor ? this.toMonitorView(monitor) : null,
          metrics: metricsByWork.get(work.id) ?? null,
          crawlTarget: resolveCrawlTarget(work.douyinVideoId, monitor?.awemeId),
        };
      }),
      total: result.total,
      unpublishedCount: result.stats.unpublished,
      collector: {
        channel: 'tikhub',
        available,
        ...(available
          ? {}
          : {
              reason:
                '未配置 TikHub API Key，请在管理后台「小红书采集」里填写（抖音与小红书共用）',
            }),
        intervalMinutes: this.intervalMinutes(),
      },
    };
  }

  /**
   * @description 开启或取消一个已发布作品的监控。开启时要求已有可抓取的作品 ID，重新计 14 天窗口并在一分钟内抓第一次。
   * @keyword-cn 切换作品监控, 开启取消监控
   * @keyword-en toggle-work-monitor, start-stop-monitor
   * @param workId 发布作品 ID。
   * @param monitoring 目标状态。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinDataMonitorView>} 更新后的监控状态。
   * @throws {BadRequestException} DOUYIN_DATA_TARGET_MISSING：还没有可抓取的作品 ID。
   */
  async setMonitoring(
    workId: string,
    monitoring: boolean,
    scope: DouyinDataScope,
  ): Promise<DouyinDataMonitorView> {
    const work = await this.requirePublishedWork(workId, scope);
    const existing = await this.monitors.findOne({ workId: work._id });
    const now = new Date();
    if (monitoring) {
      if (!resolveCrawlTarget(work.douyinVideoId, existing?.awemeId)) {
        throw new BadRequestException('DOUYIN_DATA_TARGET_MISSING');
      }
      return this.upsertMonitor(work, {
        status: 'monitoring',
        startedAt: now,
        endAt: new Date(now.getTime() + DOUYIN_DATA_MONITOR_DAYS * 86_400_000),
        nextCrawlAt: now,
        lastError: null,
      });
    }
    return this.upsertMonitor(work, { status: 'stopped', nextCrawlAt: null });
  }

  /**
   * @description 给作品绑定抖音链接（或作品 ID）：服务端解析出作品 ID 后保存，监控中的作品一分钟内按新 ID 重新抓取。
   * @keyword-cn 绑定作品链接, 解析抖音作品ID
   * @keyword-en bind-work-link, parse-douyin-aweme-id
   * @param workId 发布作品 ID。
   * @param url 用户粘贴的链接、分享口令或作品 ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinDataMonitorView>} 更新后的监控状态。
   * @throws {BadRequestException} DOUYIN_DATA_LINK_INVALID：解析不到作品 ID。
   */
  async bindLink(
    workId: string,
    url: string,
    scope: DouyinDataScope,
  ): Promise<DouyinDataMonitorView> {
    const work = await this.requirePublishedWork(workId, scope);
    const awemeId = await resolveDouyinAwemeId(url);
    if (!awemeId) throw new BadRequestException('DOUYIN_DATA_LINK_INVALID');
    const existing = await this.monitors.findOne({ workId: work._id });
    return this.upsertMonitor(work, {
      awemeId,
      linkUrl: url.trim().slice(0, 2000),
      ...(existing?.status === 'monitoring'
        ? { nextCrawlAt: new Date(), lastError: null }
        : {}),
    });
  }

  /**
   * @description 按抖音链接在发布库里新增一条已发布作品并直接开启监控（对应小红书数据监控的「新增链接」）。
   * @keyword-cn 新增抖音链接, 手动添加作品
   * @keyword-en add-douyin-link, manual-douyin-work
   * @param input 发布库、标题与链接。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinDataWorkItemView>} 新作品行。
   * @throws {BadRequestException} DOUYIN_DATA_LINK_INVALID：解析不到作品 ID。
   */
  async createManualLink(
    input: { libraryId: string; title: string; url: string },
    scope: DouyinDataScope,
  ): Promise<DouyinDataWorkItemView> {
    const awemeId = await resolveDouyinAwemeId(input.url);
    if (!awemeId) throw new BadRequestException('DOUYIN_DATA_LINK_INVALID');
    const linkUrl = input.url.trim().slice(0, 2000);
    const view = await this.works.createFromLink(
      input.libraryId,
      { title: input.title, douyinVideoId: awemeId, douyinUrl: linkUrl },
      scope,
    );
    const work = await this.requirePublishedWork(view.id, scope);
    const now = new Date();
    const monitor = await this.upsertMonitor(work, {
      status: 'monitoring',
      awemeId,
      linkUrl,
      startedAt: now,
      endAt: new Date(now.getTime() + DOUYIN_DATA_MONITOR_DAYS * 86_400_000),
      nextCrawlAt: now,
      lastError: null,
    });
    return { work: view, monitor, metrics: null, crawlTarget: awemeId };
  }

  /**
   * @description 读取当前作用域内的已发布作品，不存在 404、未发布 400。
   * @keyword-cn 要求已发布作品, 作用域校验
   * @keyword-en require-published-work, scope-check
   * @param workId 发布作品 ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinPublishWorkEntity>} 作品实体。
   */
  async requirePublishedWork(
    workId: string,
    scope: DouyinDataScope,
  ): Promise<DouyinPublishWorkEntity> {
    const work = await this.works.findWork(workId, scope);
    if (!work) throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_FOUND');
    if (work.status !== 'published') {
      throw new BadRequestException('DOUYIN_DATA_WORK_UNPUBLISHED');
    }
    return work;
  }

  /**
   * @description 把监控实体转换成接口视图。
   * @keyword-cn 监控视图转换
   * @keyword-en monitor-view-mapping
   * @param entity 监控实体。
   * @returns {DouyinDataMonitorView} 接口视图。
   */
  toMonitorView(entity: DouyinDataMonitorEntity): DouyinDataMonitorView {
    const iso = (value: Date | null | undefined) =>
      value?.toISOString() ?? null;
    return {
      status: entity.status,
      awemeId: entity.awemeId,
      linkUrl: entity.linkUrl,
      coverUrl: entity.coverUrl,
      startedAt: iso(entity.startedAt),
      endAt: iso(entity.endAt),
      nextCrawlAt: iso(entity.nextCrawlAt),
      lastCrawledAt: iso(entity.lastCrawledAt),
      lastError: entity.lastError,
      lastManualAt: iso(entity.lastManualAt),
    };
  }

  /**
   * @description 把抓取快照转换成指标视图，互动总量 = 点赞 + 评论 + 收藏 + 分享，拿到播放量时算互动率。
   * @keyword-cn 快照转指标, 互动率计算
   * @keyword-en snapshot-to-metrics, interaction-rate-calc
   * @param snapshot 抓取快照。
   * @returns {DouyinDataMetricsView} 指标视图。
   */
  toMetricsView(snapshot: DouyinDataSnapshotEntity): DouyinDataMetricsView {
    const interaction =
      snapshot.likeCount +
      snapshot.commentCount +
      (snapshot.collectCount ?? 0) +
      (snapshot.shareCount ?? 0);
    return {
      ...(snapshot.playCount === undefined
        ? {}
        : { playCount: snapshot.playCount }),
      likeCount: snapshot.likeCount,
      commentCount: snapshot.commentCount,
      ...(snapshot.collectCount === undefined
        ? {}
        : { collectCount: snapshot.collectCount }),
      ...(snapshot.shareCount === undefined
        ? {}
        : { shareCount: snapshot.shareCount }),
      interaction,
      ...(snapshot.playCount
        ? { interactionRate: interaction / snapshot.playCount }
        : {}),
      crawledAt: snapshot.crawledAt.toISOString(),
    };
  }

  /**
   * @description 取每个作品在区间内最近一次抓取的快照（互动数是累计值，最近一次即区间末的数据）。
   * @keyword-cn 区间最近快照, 聚合取最新
   * @keyword-en latest-snapshot-in-range, aggregate-latest
   * @param workIds 作品 ID 列表（已按作用域校验）。
   * @param range 时间区间。
   * @returns {Promise<Map<string, DouyinDataMetricsView>>} 作品 ID 到指标的映射。
   */
  private async latestMetrics(
    workIds: ObjectId[],
    range: { start?: Date; end?: Date },
  ): Promise<Map<string, DouyinDataMetricsView>> {
    if (!workIds.length) return new Map();
    const crawledAt: Record<string, Date> = {};
    if (range.start) crawledAt.$gte = range.start;
    if (range.end) crawledAt.$lte = range.end;
    const rows = await this.snapshots
      .aggregate<{ _id: ObjectId; doc: DouyinDataSnapshotEntity }>([
        {
          $match: {
            workId: { $in: workIds },
            ...(Object.keys(crawledAt).length ? { crawledAt } : {}),
          },
        },
        { $sort: { workId: 1, crawledAt: -1 } },
        { $group: { _id: '$workId', doc: { $first: '$$ROOT' } } },
      ])
      .toArray();
    return new Map(
      rows.map((row) => [row._id.toHexString(), this.toMetricsView(row.doc)]),
    );
  }

  /**
   * @description 写入或新建作品的监控行，新行默认未监控；返回更新后的视图。
   * @keyword-cn 写入监控行, 默认未监控
   * @keyword-en upsert-monitor, default-stopped
   * @param work 已校验作用域的作品。
   * @param set 要写入的字段。
   * @returns {Promise<DouyinDataMonitorView>} 更新后的监控视图。
   */
  private async upsertMonitor(
    work: DouyinPublishWorkEntity,
    set: Partial<DouyinDataMonitorEntity>,
  ): Promise<DouyinDataMonitorView> {
    const now = new Date();
    const defaults: Partial<DouyinDataMonitorEntity> = {
      status: 'stopped',
      awemeId: null,
      linkUrl: null,
      coverUrl: null,
      startedAt: null,
      endAt: null,
      nextCrawlAt: null,
      lastCrawledAt: null,
      lastError: null,
      lastManualAt: null,
    };
    const setOnInsert = Object.fromEntries(
      Object.entries(defaults).filter(([key]) => !(key in set)),
    );
    const result = await this.monitors.findOneAndUpdate(
      { workId: work._id },
      {
        $set: { ...set, updatedAt: now },
        $setOnInsert: {
          ...setOnInsert,
          workId: work._id,
          userId: work.userId,
          ...(work.tenantId ? { tenantId: work.tenantId } : {}),
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    if (!result.value)
      throw new NotFoundException('DOUYIN_PUBLISH_WORK_NOT_FOUND');
    return this.toMonitorView(result.value);
  }
}
