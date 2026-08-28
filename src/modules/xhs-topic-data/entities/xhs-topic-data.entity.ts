import type { ObjectId } from 'mongodb';
import type { XhsTopComment } from '../../todo/entities/xhs-post-stat.entity.js';

/**
 * @description 一次抓取任务的执行状态，与承载它的 Todo 状态一一对应。
 * @keyword-cn 抓取任务状态, 任务执行结果
 * @keyword-en crawl-task-status, task-execution-result
 */
export type XhsCrawlTaskStatus =
  'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/**
 * @description 抓取任务的触发来源，定时调度与用户手动各自可追溯。
 * @keyword-cn 抓取触发方式, 定时手动
 * @keyword-en crawl-trigger, schedule-manual
 */
export type XhsCrawlTaskTrigger = 'schedule' | 'manual';

/**
 * @description 专用抓取调度表的线性状态：等待、执行中、已取消或区间已完成。
 * @keyword-cn 采集调度状态, 线性工作流
 * @keyword-en crawl-schedule-status, linear-workflow
 */
export type XhsCrawlScheduleStatus =
  'waiting' | 'running' | 'cancelled' | 'completed';

/**
 * @description 已发布文章对应的专用抓取调度记录，调度器仅按 nextRunAt 索引领取到期行。
 * @keyword-cn 采集调度记录, 到期任务表
 * @keyword-en crawl-schedule-entity, due-task-table
 */
export interface XhsCrawlScheduleEntity {
  _id: ObjectId;
  /** 一个子选题只维护一条周期调度记录。 */
  topicId: number;
  articleId: number;
  libraryId: number;
  tenantId?: string | null;
  userId: string;
  status: XhsCrawlScheduleStatus;
  /** 本轮周期采集允许开始的时间。 */
  startAt: Date;
  /** 本轮周期采集硬截止时间，到期后不再创建任务。 */
  endAt: Date;
  /** waiting 时为下次抓取时间，running 时为下次运行态检查时间。 */
  nextRunAt: Date;
  currentTodoId?: number;
  lastDispatchedAt?: Date;
  lastFinishedAt?: Date;
  lastError?: string;
  /** 多实例原子领取的短租约。 */
  lockToken?: string;
  lockUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 子选题与抓取 Todo 的绑定记录，既是抓取任务明细的数据源，也是帖子数据回填 topicId 的依据。
 * @keyword-cn 抓取任务记录, 选题任务绑定
 * @keyword-en crawl-task-entity, topic-todo-binding
 */
export interface XhsCrawlTaskEntity {
  _id: ObjectId;
  id: number;
  tenantId?: string | null;
  userId: string;
  /** 归属子选题 ID */
  topicId: number;
  /** 承载本次抓取执行的 Todo ID；每个周期 Todo 只对应这一条运行记录。TikHub 直采没有 Todo，恒为 0。 */
  todoId: number;
  /** 兼容字段；单次 Todo 工作流中恒为 1。 */
  runIndex: number;
  /** 本次运行走的采集渠道，缺省视为 `super_claw`。 */
  channel?: XhsCrawlChannel;
  trigger: XhsCrawlTaskTrigger;
  status: XhsCrawlTaskStatus;
  /** 任务创建时间 */
  startedAt: Date;
  /** 任务进入终态的时间 */
  finishedAt?: Date;
  /** 本次任务回写的帖子数据条数 */
  collectedCount: number;
  /** 失败原因，仅 status=failed 时存在 */
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 抓取任务明细分页返回给前端的单行结构。
 * @keyword-cn 抓取任务视图, 任务明细行
 * @keyword-en crawl-task-view, task-detail-row
 */
export interface XhsCrawlTaskView {
  id: number;
  topicId: number;
  /** TikHub 直采没有 Todo，这里为 0，前端据此不渲染 Todo 跳转。 */
  todoId: number;
  /** 兼容字段；单次 Todo 工作流中恒为 1。 */
  runIndex: number;
  /** 本次运行走的采集渠道。 */
  channel: XhsCrawlChannel;
  trigger: XhsCrawlTaskTrigger;
  status: XhsCrawlTaskStatus;
  startedAt: string;
  finishedAt?: string;
  /** 耗时毫秒数，未结束时为 undefined */
  durationMs?: number;
  collectedCount: number;
  error?: string;
}

/**
 * @description 总览里单个指标卡的取值。`available=false` 表示采集端尚未回传该字段，前端渲染「待采集」。
 * @keyword-cn 指标卡取值, 待采集
 * @keyword-en metric-value, pending-collection
 */
export interface XhsTopicMetricValue {
  key: string;
  label: string;
  /** 当前累计值，available=false 时无意义 */
  value: number;
  /** 较上一次抓取的绝对增量，无对照批次时为 undefined */
  delta?: number;
  /** 较上一次抓取的百分比增量，基数为 0 时为 undefined */
  deltaRate?: number;
  /** 该指标是否已有采集数据 */
  available: boolean;
  /** 折线走势采样点，按批次时间升序 */
  trend: number[];
}

/**
 * @description 总览趋势图的一个时间点，聚合该批次全部笔记的指标。
 * @keyword-cn 趋势采样点, 批次聚合
 * @keyword-en trend-point, batch-aggregate
 */
export interface XhsTopicTrendPoint {
  /** 采集批次时间，ISO 字符串 */
  at: string;
  likeCount: number;
  commentCount: number;
  collectCount: number;
  viewCount?: number;
  shareCount?: number;
  interaction: number;
}

/**
 * @description 数据总览返回体：核心指标、派生指标、趋势、最后抓取时间与抓取开关状态。
 * @keyword-cn 数据总览, 指标汇总
 * @keyword-en data-overview, metric-summary
 */
export interface XhsTopicOverview {
  topicId: number;
  crawlStatus: 'crawling' | 'cancelled';
  /** 核心指标卡 */
  metrics: XhsTopicMetricValue[];
  /** 去重后的笔记数 */
  postCount: number;
  /** 篇均互动 */
  averageInteraction: number;
  /** 互动量达到爆文阈值的笔记数 */
  hotPostCount: number;
  /** 爆文判定阈值 */
  hotPostThreshold: number;
  /** 互动量最高的笔记 */
  topPost?: {
    postTitle: string;
    postUrl?: string;
    interaction: number;
  };
  /** 互动率 =（赞+评+藏+享）/ 曝光，缺曝光时为 undefined */
  interactionRate?: number;
  /** 最近一次成功抓取时间 */
  lastCrawledAt?: string;
  /** 最近一次抓取带回的条数 */
  lastCrawledCount: number;
  /** 调度表里真实排定的下次抓取时间 */
  nextCrawlAt?: string;
  /** 当前生效的每日抓取时刻，`HH:mm`（服务器本地时区） */
  crawlDailyAt: string;
  /** @deprecated 兼容字段，定点调度后恒为 1440；新前端读 `crawlDailyAt`。 */
  crawlIntervalMinutes: number;
  trend: XhsTopicTrendPoint[];
}

/**
 * @description 数据明细分页中的单行，前端表格直接消费。
 * @keyword-cn 数据明细行, 分页明细
 * @keyword-en data-detail-row, paged-detail
 */
export interface XhsTopicDetailRow {
  id: number;
  /** 采集自然日 YYYY-MM-DD，删除按天时作为入参 */
  day: string;
  dataAt: string;
  postTitle: string;
  postUrl?: string;
  authorUrl?: string;
  tag?: string;
  likeCount: number;
  commentCount: number;
  collectCount: number;
  viewCount?: number;
  shareCount?: number;
  interaction: number;
  interactionRate?: number;
  topComments: XhsTopComment[];
}

/**
 * @description 情感极性分布的一项。
 * @keyword-cn 情感分布, 舆论极性
 * @keyword-en sentiment-distribution, opinion-polarity
 */
export interface XhsOpinionSentiment {
  polarity: 'positive' | 'neutral' | 'negative';
  /** 归入该极性的评论条数 */
  count: number;
  /** 占比 0-1 */
  ratio: number;
}

/**
 * @description 舆论导向分析结果，由后端 Agent 基于 topComments 生成后缓存。
 * @keyword-cn 舆论导向分析, 情感关键词
 * @keyword-en opinion-analysis, sentiment-keywords
 */
export interface XhsTopicOpinion {
  topicId: number;
  /** 参与分析的评论总条数 */
  sampleCount: number;
  sentiments: XhsOpinionSentiment[];
  /** 热点关键词，按词频倒序 */
  keywords: { word: string; weight: number }[];
  /** AI 给出的一句话舆论结论 */
  conclusion: string;
  /** 代表性评论样本 */
  highlights: {
    polarity: 'positive' | 'neutral' | 'negative';
    content: string;
  }[];
  /** 分析生成时间 */
  analyzedAt: string;
  /** 分析所覆盖数据的最新采集时间，用于判断缓存是否过期 */
  dataAt?: string;
}

/**
 * @description 舆论分析结果的 MongoDB 缓存文档。
 * @keyword-cn 舆论分析缓存, 分析结果存储
 * @keyword-en opinion-cache, analysis-persistence
 */
export interface XhsTopicOpinionEntity extends Omit<
  XhsTopicOpinion,
  'analyzedAt' | 'dataAt'
> {
  _id: ObjectId;
  tenantId?: string | null;
  userId: string;
  analyzedAt: Date;
  dataAt?: Date;
}

/**
 * @description 小红书数据采集渠道：`super_claw` 走节点跑 Playwright 脚本，`tikhub` 由平台直接调 TikHub 开放接口。
 *   缺省一律按 `super_claw` 处理，保证历史配置行为不变。
 * @keyword-cn 采集渠道, 渠道切换
 * @keyword-en crawl-channel, channel-switch
 */
export type XhsCrawlChannel = 'super_claw' | 'tikhub';

/**
 * @description 租户用户级的抓取调度配置，由后台「小红书采集」页同步下来，含每日抓取时刻与采集渠道。
 * @keyword-cn 抓取时刻配置, 每日定点
 * @keyword-en crawl-settings, daily-crawl-time
 */
export interface XhsCrawlSettingsEntity {
  _id: ObjectId;
  tenantId?: string | null;
  userId: string;
  /** 每天固定抓取时刻，`HH:mm`，按服务器本地时区解释；缺省视为 `23:59`。 */
  dailyCrawlAt?: string;
  /** @deprecated 旧的分钟级间隔，调度已改为每天定点，只为读取历史文档保留。 */
  intervalMinutes?: number;
  /** 缺省视为 `super_claw`，历史文档没有这个字段。 */
  channel?: XhsCrawlChannel;
  updatedAt: Date;
}
