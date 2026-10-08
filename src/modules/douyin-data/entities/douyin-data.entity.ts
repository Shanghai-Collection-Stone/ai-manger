import type { ObjectId } from 'mongodb';
import type { DouyinPublishWorkView } from '../../douyin-publish/entities/douyin-publish.entity.js';

/**
 * @description 一次开启监控的最长时长（天），与小红书数据监控「最多监控 2 周」一致。
 * @keyword-cn 监控时长上限, 两周监控
 * @keyword-en monitor-window-days, two-week-monitor
 */
export const DOUYIN_DATA_MONITOR_DAYS = 14;

/**
 * @description 定时抓取的默认间隔（分钟），可用环境变量 `DOUYIN_DATA_CRAWL_INTERVAL_MINUTES` 覆盖。
 * @keyword-cn 默认抓取间隔, 定时抓取
 * @keyword-en default-crawl-interval, scheduled-crawl
 */
export const DOUYIN_DATA_DEFAULT_INTERVAL_MINUTES = 360;

/**
 * @description 同一作品两次手动抓取的最短间隔（毫秒），防止连点重复计费。
 * @keyword-cn 手动抓取冷却, 防重复计费
 * @keyword-en manual-crawl-cooldown, duplicate-charge-guard
 */
export const DOUYIN_DATA_MANUAL_COOLDOWN_MS = 60_000;

/**
 * @description 数据监控的访问作用域，与抖音发布库一致（租户 + 后台用户）。
 * @keyword-cn 数据监控作用域
 * @keyword-en douyin-data-scope
 */
export interface DouyinDataScope {
  tenantId?: string;
  userId: string;
}

/**
 * @description 监控状态：`monitoring` 监控中，`stopped` 手动取消，`finished` 满两周自动结束。
 * @keyword-cn 作品监控状态
 * @keyword-en work-monitor-status
 */
export type DouyinDataMonitorStatus = 'monitoring' | 'stopped' | 'finished';

/**
 * @description 发布作品的数据监控记录，一个作品一行，集合 `douyin_data_monitors`。
 * @keyword-cn 作品监控实体, 抓取调度
 * @keyword-en work-monitor-entity, crawl-schedule
 */
export interface DouyinDataMonitorEntity {
  _id: ObjectId;
  workId: ObjectId;
  tenantId?: string;
  userId: string;
  status: DouyinDataMonitorStatus;
  /** 用户绑定链接解析出的作品 ID，优先于发布回写的 douyinVideoId。 */
  awemeId: string | null;
  linkUrl: string | null;
  /** TikHub 返回的作品封面，手动链接作品没有视频快照时用它展示。 */
  coverUrl: string | null;
  startedAt: Date | null;
  endAt: Date | null;
  nextCrawlAt: Date | null;
  lastCrawledAt: Date | null;
  lastError: string | null;
  lastManualAt: Date | null;
  lockToken?: string | null;
  lockUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 一次抓取的互动数据快照，集合 `douyin_data_snapshots`；取不到的指标不写字段。
 * @keyword-cn 抓取快照, 互动指标
 * @keyword-en crawl-snapshot, interaction-metrics
 */
export interface DouyinDataSnapshotEntity {
  _id: ObjectId;
  workId: ObjectId;
  tenantId?: string;
  userId: string;
  awemeId: string;
  trigger: 'schedule' | 'manual';
  playCount?: number;
  likeCount: number;
  commentCount: number;
  collectCount?: number;
  shareCount?: number;
  crawledAt: Date;
}

/**
 * @description 监控状态接口视图。
 * @keyword-cn 监控状态视图
 * @keyword-en monitor-view
 */
export interface DouyinDataMonitorView {
  status: DouyinDataMonitorStatus;
  awemeId: string | null;
  linkUrl: string | null;
  coverUrl: string | null;
  startedAt: string | null;
  endAt: string | null;
  nextCrawlAt: string | null;
  lastCrawledAt: string | null;
  lastError: string | null;
  lastManualAt: string | null;
}

/**
 * @description 作品在所选区间内最近一次抓取的指标视图；互动总量为点赞、评论、收藏、分享之和。
 * @keyword-cn 作品指标视图, 互动率
 * @keyword-en work-metrics-view, interaction-rate
 */
export interface DouyinDataMetricsView {
  playCount?: number;
  likeCount: number;
  commentCount: number;
  collectCount?: number;
  shareCount?: number;
  interaction: number;
  interactionRate?: number;
  crawledAt: string;
}

/**
 * @description 数据监控表格的一行：发布作品、监控状态、区间指标与可抓取的作品 ID。
 * @keyword-cn 数据监控行视图
 * @keyword-en data-monitor-row-view
 */
export interface DouyinDataWorkItemView {
  work: DouyinPublishWorkView;
  monitor: DouyinDataMonitorView | null;
  metrics: DouyinDataMetricsView | null;
  /** 实际用于抓取的作品 ID；为 null 时需要先绑定作品链接。 */
  crawlTarget: string | null;
}

/**
 * @description 采集通道可用性，界面据此提示「未配置 TikHub API Key」。
 * @keyword-cn 采集通道状态
 * @keyword-en collector-status
 */
export interface DouyinDataCollectorView {
  channel: 'tikhub';
  available: boolean;
  reason?: string;
  intervalMinutes: number;
}

/**
 * @description 立即抓取一次的结果；失败时带中文原因，成功时带最新指标。
 * @keyword-cn 立即抓取结果
 * @keyword-en crawl-now-result
 */
export interface DouyinDataCrawlResult {
  status: 'success' | 'failed';
  error?: string;
  crawledAt: string;
  metrics: DouyinDataMetricsView | null;
}
