import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import {
  RobotRegistryService,
  SUPER_CLAW_DATA_TRACKING_AGENT_MODULE,
} from '../../auto-task-robot/services/robot-registry.service.js';
import { TodoService } from '../../todo/services/todo.service.js';
import { XhsPostStatService } from '../../todo/services/xhs-post-stat.service.js';
import { XhsTopicRepositoryService } from '../../xhs-topic/services/xhs-topic-repository.service.js';
import type { XhsTopicEntity } from '../../xhs-topic/entities/xhs-topic.entity.js';
import type {
  XhsCrawlSettingsEntity,
  XhsCrawlScheduleEntity,
  XhsCrawlTaskEntity,
  XhsCrawlTaskStatus,
  XhsCrawlTaskTrigger,
  XhsCrawlTaskView,
} from '../entities/xhs-topic-data.entity.js';
import { ArticleLibraryService } from '../../article-library/services/article-library.service.js';
import { ContextService } from '../../context/services/context.service.js';
import { ContextRole } from '../../context/enums/context.enums.js';

/**
 * @type {number} 未配置抓取频率时使用的默认间隔（分钟），与前端设置面板默认值一致。
 * @keyword-cn 默认抓取频率, 分钟间隔
 * @keyword-en default-crawl-interval, minute-frequency
 */
export const DEFAULT_CRAWL_INTERVAL_MINUTES = 30;

/**
 * @type {number} 发布后默认持续采集两周。
 * @keyword-cn 默认抓取区间, 两周时限
 * @keyword-en default-crawl-window, two-week-deadline
 */
export const DEFAULT_CRAWL_WINDOW_DAYS = 14;

/** @type {number} 调度器轮询周期（毫秒），到点才真正建任务，轮询本身很轻。 */
const SCHEDULER_TICK_MS = 60_000;

/** @type {number} 单轮最多处理的到期调度行，防止大量任务同一时刻到期拖垮进程。 */
const SCHEDULER_BATCH_SIZE = 20;

/** @type {number} 调度行的多实例领取租约，超时后允许其他实例接管。 */
const SCHEDULE_LOCK_MS = 2 * 60 * 1000;

/** @type {number} 运行中 Todo 的状态复查间隔。 */
const RUNNING_CHECK_MS = 60_000;

/** @type {number} 数据追踪 Agent 暂不可用时的退避时间。 */
const AGENT_RETRY_MS = 5 * 60 * 1000;

/** @type {string} 数据追踪 Agent 的 module 标识，调度器据此挑选抓取执行方。 */
const LEGACY_DATA_TRACKING_AGENT_MODULE = 'xhs_data_tracking';

/**
 * @description 单次抓取任务要覆盖的一篇已发布笔记；抓取对象只由 NoteId 确定，不靠关键词搜索。
 * @keyword-cn 抓取目标笔记, 已发布笔记
 * @keyword-en crawl-target-note, published-note
 */
type CrawlTargetNote = {
  noteId: string;
  articleId: number;
  title: string;
};

/**
 * @description 子选题抓取调度服务：维护抓取开关、按频率自动创建抓取 Todo、绑定任务与选题，并把回写数据归属到子选题。
 * @keyword-cn 抓取调度, 抓取任务绑定, 取消抓取
 * @keyword-en crawl-scheduler, crawl-task-binding, cancel-crawl
 */
@Injectable()
export class XhsTopicCrawlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(XhsTopicCrawlService.name);
  private readonly tasks: Collection<XhsCrawlTaskEntity>;
  private readonly schedules: Collection<XhsCrawlScheduleEntity>;
  private readonly settings: Collection<XhsCrawlSettingsEntity>;
  private readonly articles: Collection<{
    id: number;
    libraryId: number;
    title?: string;
    source?: string;
    publishStatus?: string;
    meta?: Record<string, unknown>;
  }>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private schedulerBusy = false;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly todos: TodoService,
    private readonly postStats: XhsPostStatService,
    private readonly topics: XhsTopicRepositoryService,
    private readonly robots: RobotRegistryService,
    private readonly libraries: ArticleLibraryService,
    private readonly context: ContextService,
  ) {
    this.tasks = db.collection<XhsCrawlTaskEntity>('xhs_topic_crawl_tasks');
    this.schedules = db.collection<XhsCrawlScheduleEntity>(
      'xhs_topic_crawl_schedules',
    );
    this.settings = db.collection<XhsCrawlSettingsEntity>(
      'xhs_topic_crawl_settings',
    );
    this.articles = db.collection('articles');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    void this.ensureIndexes();
  }

  /**
   * @description 启动抓取调度轮询，每分钟检查一次哪些子选题到了下一次抓取时间。
   * @keyword-cn 启动调度, 定时轮询
   * @keyword-en start-scheduler, interval-tick
   * @returns {void}
   */
  onModuleInit(): void {
    if (this.schedulerTimer) return;
    this.schedulerTimer = setInterval(() => {
      void this.tickScheduler();
    }, SCHEDULER_TICK_MS);
  }

  /**
   * @description 停止抓取调度轮询。
   * @keyword-cn 停止调度, 释放定时器
   * @keyword-en stop-scheduler, clear-timer
   * @returns {void}
   */
  onModuleDestroy(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
  }

  /**
   * @description 建立抓取任务、专用调度表与配置索引，首次启用时回填既有已发布文章。
   * @keyword-cn 抓取任务索引, 调度表初始化
   * @keyword-en crawl-task-indexes, schedule-table-init
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.tasks.createIndex({ id: 1 }, { unique: true });
    await this.tasks.createIndex({ topicId: 1, startedAt: -1 });
    await this.tasks.createIndex({ todoId: 1, runIndex: -1 });
    await this.schedules.createIndex({ topicId: 1 }, { unique: true });
    await this.schedules.createIndex({ currentTodoId: 1 }, { sparse: true });
    await this.schedules.createIndex({
      status: 1,
      nextRunAt: 1,
      endAt: 1,
      lockUntil: 1,
    });
    const migrationNow = new Date();
    await this.schedules.updateMany(
      { startAt: { $exists: false } },
      { $set: { startAt: migrationNow } },
    );
    await this.schedules.updateMany(
      { endAt: { $exists: false } },
      {
        $set: {
          endAt: new Date(
            migrationNow.getTime() +
              DEFAULT_CRAWL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      },
    );
    await this.schedules.updateMany(
      { status: 'paused' as never },
      { $set: { status: 'cancelled' } },
    );
    await this.settings.createIndex(
      { tenantId: 1, userId: 1 },
      { unique: true },
    );
    const exists = await this.counters.findOne({
      _id: 'xhs_topic_crawl_tasks',
    });
    if (!exists) {
      await this.counters.insertOne({ _id: 'xhs_topic_crawl_tasks', seq: 0 });
    }
    await this.backfillPublishedArticleSchedules();
  }

  /**
   * @description 首次启用时按迁移标记把既有已发布的小红书选题文章幂等写入专用调度表。
   * @keyword-cn 已发布文章回填, 调度表迁移
   * @keyword-en published-article-backfill, schedule-table-migration
   * @returns {Promise<void>}
   */
  private async backfillPublishedArticleSchedules(): Promise<void> {
    const markerKey = 'xhs_topic_crawl_schedule_backfill';
    const marker = await this.counters.findOne({ _id: markerKey });
    if ((marker?.seq ?? 0) >= 1) return;
    const cursor = this.articles.find({
      source: 'xhs-topic',
      publishStatus: 'published',
    });
    let count = 0;
    for await (const article of cursor) {
      const topicId = this.readArticleTopicId(article.meta);
      if (!topicId) continue;
      const created = await this.syncArticlePublishSchedule({
        topicId,
        articleId: article.id,
        libraryId: article.libraryId,
        status: 'published',
      });
      if (created) count += 1;
    }
    if (count > 0) {
      this.logger.log(`[backfillPublishedArticleSchedules] count=${count}`);
    }
    await this.counters.updateOne(
      { _id: markerKey },
      { $set: { seq: 1 } },
      { upsert: true },
    );
  }

  /**
   * @description 根据文章发布状态创建、激活或暂停专用抓取调度行，发布入口通过字符串令牌调用。
   * @keyword-cn 发布触发调度, 同步采集计划
   * @keyword-en publish-triggered-schedule, sync-crawl-plan
   * @param input 文章、文章库、来源子选题及目标发布状态。
   * @returns {Promise<boolean>} 是否存在并更新了对应调度行。
   */
  async syncArticlePublishSchedule(input: {
    topicId: number;
    articleId: number;
    libraryId: number;
    status: 'unpublished' | 'published';
  }): Promise<boolean> {
    const topicId = Number(input.topicId);
    if (!Number.isInteger(topicId) || topicId <= 0) return false;
    const existing = await this.schedules.findOne({ topicId });
    if (input.status !== 'published') {
      if (!existing) return false;
      await this.schedules.updateOne(
        { topicId },
        {
          $set: { status: 'cancelled', updatedAt: new Date() },
          $unset: {
            currentTodoId: '',
            lockToken: '',
            lockUntil: '',
          },
        },
      );
      await this.cancelRunningTasks(topicId);
      return true;
    }

    const topic = await this.topics.getChildTopicById(topicId);
    if (!topic) {
      this.logger.warn(
        `[syncArticlePublishSchedule] 子选题不存在 topicId=${topicId} articleId=${input.articleId}`,
      );
      return false;
    }
    const now = new Date();
    const defaultEndAt = new Date(
      now.getTime() + DEFAULT_CRAWL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const scope = {
      articleId: input.articleId,
      libraryId: input.libraryId,
      tenantId: topic.tenantId ?? null,
      userId: topic.userId,
      updatedAt: now,
    };
    if (existing) {
      const keepRunning = existing.status === 'running';
      await this.schedules.updateOne(
        { topicId },
        {
          $set: {
            ...scope,
            ...(keepRunning
              ? {}
              : {
                  status:
                    topic.crawl?.status === 'cancelled'
                      ? ('cancelled' as const)
                      : ('waiting' as const),
                  startAt: now,
                  endAt: defaultEndAt,
                  nextRunAt: now,
                }),
          },
          ...(!keepRunning
            ? { $unset: { lockToken: '', lockUntil: '', lastError: '' } }
            : {}),
        },
      );
      return true;
    }
    await this.schedules.insertOne({
      _id: new ObjectId(),
      topicId,
      ...scope,
      status: topic.crawl?.status === 'cancelled' ? 'cancelled' : 'waiting',
      startAt: now,
      endAt: defaultEndAt,
      nextRunAt: now,
      createdAt: now,
    });
    return true;
  }

  /**
   * @description 暂停子选题的专用调度行，取消抓取时与在途 Todo 一并停止。
   * @keyword-cn 暂停采集计划, 取消调度
   * @keyword-en pause-crawl-schedule, cancel-schedule
   * @param topicId 子选题业务 ID。
   * @returns {Promise<boolean>} 是否命中调度行。
   */
  async pauseScheduleForTopic(topicId: number): Promise<boolean> {
    const result = await this.schedules.updateOne(
      { topicId },
      {
        $set: { status: 'cancelled', updatedAt: new Date() },
        $unset: { currentTodoId: '', lockToken: '', lockUntil: '' },
      },
    );
    return result.matchedCount > 0;
  }

  /**
   * @description 恢复既有专用调度行并令其立即到期，不扫描或补建未发布子选题。
   * @keyword-cn 恢复采集计划, 立即到期
   * @keyword-en resume-crawl-schedule, schedule-due-now
   * @param topicId 子选题业务 ID。
   * @returns {Promise<boolean>} 是否命中调度行。
   */
  async resumeScheduleForTopic(topicId: number): Promise<boolean> {
    const now = new Date();
    const current = await this.schedules.findOne({ topicId });
    if (!current) return false;
    const expired = new Date(current.endAt).getTime() <= now.getTime();
    const result = await this.schedules.updateOne(
      { topicId },
      {
        $set: {
          status: 'waiting',
          startAt: expired ? now : current.startAt,
          endAt: expired
            ? new Date(
                now.getTime() + DEFAULT_CRAWL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
              )
            : current.endAt,
          nextRunAt: expired
            ? now
            : new Date(Math.max(now.getTime(), current.startAt.getTime())),
          updatedAt: now,
        },
        $unset: {
          currentTodoId: '',
          lockToken: '',
          lockUntil: '',
          lastError: '',
        },
      },
    );
    return result.matchedCount > 0;
  }

  /**
   * @description 更新已发布子选题的周期采集起止区间，并把未取消计划推进到新区间起点。
   * @keyword-cn 设置抓取区间, 采集时限
   * @keyword-en set-crawl-window, collection-deadline
   * @param topicId 子选题业务 ID。
   * @param startAt 抓取区间开始时间。
   * @param endAt 抓取区间结束时间。
   * @returns {Promise<XhsCrawlScheduleEntity | null>} 更新后的调度行。
   */
  async setScheduleWindow(
    topicId: number,
    startAt: Date,
    endAt: Date,
  ): Promise<XhsCrawlScheduleEntity | null> {
    if (
      !Number.isFinite(startAt.getTime()) ||
      !Number.isFinite(endAt.getTime()) ||
      endAt.getTime() <= startAt.getTime()
    ) {
      throw new Error('INVALID_CRAWL_WINDOW');
    }
    const current = await this.schedules.findOne({ topicId });
    if (!current) return null;
    const now = new Date();
    const outsideActiveWindow =
      startAt.getTime() > now.getTime() || endAt.getTime() <= now.getTime();
    if (current.currentTodoId && outsideActiveWindow) {
      await this.cancelRunningTasks(topicId);
    }
    const status =
      current.status === 'cancelled'
        ? 'cancelled'
        : endAt.getTime() <= now.getTime()
          ? 'completed'
          : startAt.getTime() > now.getTime()
            ? 'waiting'
            : current.status === 'running'
              ? 'running'
              : 'waiting';
    return await this.schedules.findOneAndUpdate(
      { topicId },
      {
        $set: {
          startAt,
          endAt,
          status,
          nextRunAt:
            status === 'running'
              ? current.nextRunAt
              : new Date(Math.max(now.getTime(), startAt.getTime())),
          updatedAt: now,
        },
        ...(outsideActiveWindow
          ? { $unset: { currentTodoId: '', lockUntil: '', lockedBy: '' } }
          : {}),
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * @description 从专用调度表读取子选题下一次到期时间，供数据总览直接展示真实计划。
   * @keyword-cn 下次采集时间, 调度表查询
   * @keyword-en next-crawl-time, schedule-table-query
   * @param topicId 子选题业务 ID。
   * @returns {Promise<Date | undefined>} 等待执行的时间，取消、结束或无计划时为空。
   */
  async getNextRunAt(topicId: number): Promise<Date | undefined> {
    const schedule = await this.schedules.findOne(
      { topicId, status: 'waiting' },
      { projection: { nextRunAt: 1 } },
    );
    return schedule?.nextRunAt;
  }

  /**
   * @description 返回单个子选题的调度诊断状态，供接口和模拟脚本解释未创建 Todo 的原因。
   * @keyword-cn 查询调度诊断, 任务阻断原因
   * @keyword-en get-schedule-diagnostics, task-block-reason
   */
  async getScheduleStatus(topicId: number): Promise<{
    status: XhsCrawlScheduleEntity['status'];
    nextRunAt: string;
    currentTodoId?: number;
    lastError?: string;
    lockUntil?: string;
  } | null> {
    const schedule = await this.schedules.findOne({ topicId });
    if (!schedule) return null;
    return {
      status: schedule.status,
      nextRunAt: schedule.nextRunAt.toISOString(),
      currentTodoId: schedule.currentTodoId,
      lastError: schedule.lastError,
      lockUntil: schedule.lockUntil?.toISOString(),
    };
  }

  /**
   * @description 从文章元数据安全解析来源子选题 ID。
   * @keyword-cn 解析来源选题, 文章调度关联
   * @keyword-en parse-source-topic, article-schedule-binding
   * @param meta 文章元数据。
   * @returns {number | undefined} 有效正整数子选题 ID。
   */
  private readArticleTopicId(
    meta?: Record<string, unknown>,
  ): number | undefined {
    const topicId = Number(meta?.xhsTopicId);
    return Number.isInteger(topicId) && topicId > 0 ? topicId : undefined;
  }

  /**
   * @description 读取当前租户用户生效的抓取间隔，未配置时回退默认值。
   * @keyword-cn 读取抓取频率, 调度间隔
   * @keyword-en read-crawl-interval, schedule-interval
   * @param scope 当前租户与用户作用域。
   * @returns {Promise<number>} 抓取间隔分钟数。
   */
  async getIntervalMinutes(scope: {
    tenantId?: string | null;
    userId: string;
  }): Promise<number> {
    const doc = await this.settings.findOne({
      tenantId: String(scope.tenantId ?? '').trim() || null,
      userId: scope.userId,
    });
    const minutes = Number(doc?.intervalMinutes);
    return Number.isFinite(minutes) && minutes > 0
      ? minutes
      : DEFAULT_CRAWL_INTERVAL_MINUTES;
  }

  /**
   * @description 保存前端「抓取数据频率」设置，调度器下一轮即按新间隔建任务。
   * @keyword-cn 保存抓取频率, 同步设置
   * @keyword-en save-crawl-interval, sync-settings
   * @param intervalMinutes 抓取间隔分钟数。
   * @param scope 当前租户与用户作用域。
   * @returns {Promise<number>} 实际生效的间隔分钟数。
   */
  async saveIntervalMinutes(
    intervalMinutes: number,
    scope: { tenantId?: string | null; userId: string },
  ): Promise<number> {
    const minutes = Math.max(1, Math.round(Number(intervalMinutes) || 0));
    await this.settings.updateOne(
      {
        tenantId: String(scope.tenantId ?? '').trim() || null,
        userId: scope.userId,
      },
      { $set: { intervalMinutes: minutes, updatedAt: new Date() } },
      { upsert: true },
    );
    return minutes;
  }

  /**
   * @description 分页读取某个子选题的抓取任务明细，读取前先与 Todo 状态对账。
   * @keyword-cn 抓取任务明细, 分页任务
   * @keyword-en crawl-task-list, paged-tasks
   * @param topicId 子选题业务 ID。
   * @param page 页码，从 1 开始。
   * @param pageSize 每页条数。
   * @returns {Promise<{items: XhsCrawlTaskView[], total: number}>} 任务明细与总数。
   */
  async listTasks(
    topicId: number,
    page: number,
    pageSize: number,
  ): Promise<{ items: XhsCrawlTaskView[]; total: number }> {
    await this.syncTaskStatuses(topicId);
    const total = await this.tasks.countDocuments({ topicId });
    const docs = await this.tasks
      .find({ topicId }, { projection: { _id: 0 } })
      .sort({ startedAt: -1, id: -1 })
      .skip(Math.max(0, (page - 1) * pageSize))
      .limit(pageSize)
      .toArray();
    return { items: docs.map((doc) => this.toTaskView(doc)), total };
  }

  /**
   * @description 统计某个子选题的抓取任务总数，供总览展示。
   * @keyword-cn 抓取任务计数, 总览统计
   * @keyword-en crawl-task-count, overview-stat
   * @param topicId 子选题业务 ID。
   * @returns {Promise<number>} 任务条数。
   */
  async countTasks(topicId: number): Promise<number> {
    return await this.tasks.countDocuments({ topicId });
  }

  /**
   * @description 读取某个子选题最近一次抓取任务，用于推算下次抓取时间。
   * @keyword-cn 最近抓取任务, 下次抓取
   * @keyword-en latest-crawl-task, next-crawl-at
   * @param topicId 子选题业务 ID。
   * @returns {Promise<XhsCrawlTaskEntity | null>} 最近一次任务。
   */
  async getLatestTask(topicId: number): Promise<XhsCrawlTaskEntity | null> {
    return await this.tasks
      .find({ topicId })
      .sort({ startedAt: -1, id: -1 })
      .limit(1)
      .next();
  }

  /**
   * @description 把在途抓取运行与其 Todo 的状态对账一次。数据归属不在这里做——那发生在回写入口
   *   `recordCrawlRun`，只有那里才知道「这批数据属于第几次抓取」。这里只负责把 Todo 已经失败、
   *   取消或跑完却没回写数据的运行收进终态，免得列表里永远挂着「执行中」。
   * @keyword-cn 抓取任务对账, 在途任务收尾
   * @keyword-en reconcile-crawl-tasks, settle-inflight-runs
   * @param topicId 子选题业务 ID。
   * @returns {Promise<void>}
   */
  async syncTaskStatuses(topicId: number): Promise<void> {
    const inflight = await this.tasks
      .find({ topicId, status: { $in: ['pending', 'running'] } })
      .toArray();
    if (inflight.length === 0) return;
    for (const task of inflight) {
      try {
        const todo = await this.todos.get(task.todoId);
        const status = this.mapTodoStatus(todo?.status);
        if (status === 'pending' || status === 'running') {
          // Todo 还在跑，运行记录保持在途，等回写来收尾。
          if (task.status !== status) {
            await this.tasks.updateOne(
              { id: task.id },
              { $set: { status, updatedAt: new Date() } },
            );
          }
          continue;
        }
        const now = new Date();
        await this.tasks.updateOne(
          { id: task.id },
          {
            $set: {
              status,
              finishedAt: now,
              updatedAt: now,
              ...(status === 'failed'
                ? {
                    error:
                      todo?.abnormalReason ||
                      todo?.taskResult ||
                      '抓取 Todo 执行失败',
                  }
                : {}),
              ...(status === 'done' && task.collectedCount === 0
                ? { error: '任务已结束但没有回写任何数据' }
                : {}),
            },
          },
        );
      } catch (error) {
        this.logger.warn(
          `[syncTaskStatuses] topicId=${topicId} taskId=${task.id} ${String(error)}`,
        );
      }
    }
  }

  /**
   * @description 抓取数据回写入口调用：一个单次 Todo 固定对应一条抓取运行，所有回写数据都归入该行；
   *   运行记录继承 Todo 的真实状态，在途回写不提前完成，部分成功也不覆盖 failed 终态。
   * @keyword-cn 记录抓取运行, 每次抓取一条, 回写归属
   * @keyword-en record-crawl-run, per-crawl-record, write-attribution
   * @param todoId 回写数据的抓取 Todo ID。
   * @returns {Promise<number | undefined>} 本次归属到的运行记录 ID；Todo 未绑定子选题时为 undefined。
   */
  async recordCrawlRun(todoId: number): Promise<number | undefined> {
    const task = await this.tasks
      .find({ todoId })
      .sort({ runIndex: -1, id: -1 })
      .limit(1)
      .next();
    if (!task) {
      // 没有绑定记录说明这个抓取 Todo 不是从数据看板发起的（例如聊天里直接建的采集任务），
      // 拿不到归属子选题，只能放过——数据本身照常入库，只是不进某个子选题的看板。
      this.logger.debug?.(
        `[recordCrawlRun] todoId=${todoId} 未绑定子选题，跳过运行记录`,
      );
      return undefined;
    }

    const now = new Date();
    const assigned = await this.postStats.assignCrawlRun(
      todoId,
      task.topicId,
      task.id,
    );
    const todo = await this.todos.get(todoId);
    const status = this.mapTodoStatus(todo?.status);

    if (status === 'pending' || status === 'running') {
      await this.tasks.updateOne(
        { id: task.id },
        {
          $set: { status, updatedAt: now },
          $inc: { collectedCount: assigned },
        },
      );
      if (assigned > 0) await this.topics.markCrawled(task.topicId, now);
      this.logger.log(
        `[recordCrawlRun] topicId=${task.topicId} todoId=${todoId} runId=${task.id} status=${status} assigned=${assigned}`,
      );
      return task.id;
    }

    const terminalError =
      status === 'failed'
        ? todo?.abnormalReason || todo?.taskResult || '抓取 Todo 执行失败'
        : status === 'cancelled'
          ? '抓取 Todo 已取消'
          : undefined;
    await this.tasks.updateOne(
      { id: task.id },
      {
        $set: {
          status,
          finishedAt: now,
          updatedAt: now,
          ...(terminalError ? { error: terminalError } : {}),
        },
        $inc: { collectedCount: assigned },
        ...(!terminalError ? { $unset: { error: '' } } : {}),
      },
    );
    if (assigned > 0) await this.topics.markCrawled(task.topicId, now);
    await this.advanceScheduleAfterTodo(todoId, terminalError);
    this.logger.log(
      `[recordCrawlRun] topicId=${task.topicId} todoId=${todoId} runId=${task.id} status=${status} assigned=${assigned}`,
    );
    return task.id;
  }

  /**
   * @description 为一个子选题读取文章库工作区、建立任务会话，再创建一次抓取 Todo、绑定运行记录并触发执行。
   * @keyword-cn 创建抓取任务, 指派数据追踪
   * @keyword-en create-crawl-task, assign-tracking-agent
   * @param topic 子选题实体。
   * @param trigger 触发来源。
   * @param beforeTrigger 调度器在触发 Agent 前绑定当前 Todo 的可选钩子。
   * @param deadline 单次任务不可越过的调度区间截止时间，缺省为创建后两周。
   * @returns {Promise<XhsCrawlTaskEntity | null>} 新建的抓取任务，找不到可用 Agent 时为 null。
   */
  async createCrawlTask(
    topic: XhsTopicEntity,
    trigger: XhsCrawlTaskTrigger,
    beforeTrigger?: (task: XhsCrawlTaskEntity) => Promise<void>,
    deadline?: Date,
  ): Promise<XhsCrawlTaskEntity | null> {
    const assignee = await this.resolveTrackingAssignee();
    if (!assignee) {
      this.logger.warn(
        `[createCrawlTask] 未找到 module=${SUPER_CLAW_DATA_TRACKING_AGENT_MODULE} 的数据追踪 Agent，topicId=${topic.id}`,
      );
      return null;
    }
    const now = new Date();
    const schedule = await this.schedules.findOne({ topicId: topic.id });
    if (!schedule) {
      this.logger.warn(
        `[createCrawlTask] topicId=${topic.id} 尚未绑定已发布文章库，拒绝创建无工作区 Todo`,
      );
      return null;
    }
    const workspaceId = await this.libraries.ensureWorkspace(
      schedule.libraryId,
      topic.tenantId ?? undefined,
    );
    // 抓取对象恒定是已发布笔记，且同一子选题可能发过多篇，这里一次把全部 NoteId 收齐。
    const notes = await this.resolvePublishedNotes(topic.id, schedule);
    if (!notes.length) {
      this.logger.warn(
        `[createCrawlTask] topicId=${topic.id} 没有任何带 NoteId 的已发布文章，跳过本次抓取`,
      );
      return null;
    }
    const sessionKey = await this.context.createSessionWithScope(undefined, {
      tenantId: topic.tenantId ?? undefined,
      userId: topic.userId,
      sessionType: 'xhs-tracker',
      workspaceId,
    });
    const todo = await this.todos.create({
      tenantId: topic.tenantId ?? undefined,
      userId: topic.userId,
      title: `小红书数据抓取 · ${topic.title}`,
      description: `围绕子选题「${topic.title}」采集 ${notes.length} 篇已发布笔记的互动数据。`,
      category: 'xhs',
      type: 'auto_execute',
      associatedResources: [
        { type: 'xhs_topic', resourceId: topic.id },
        ...notes.map((note) => ({
          type: 'article',
          resourceId: note.articleId,
        })),
        ...notes.map((note) => ({
          type: 'xhs_note',
          resourceId: note.noteId,
        })),
        { type: 'article_library', resourceId: schedule.libraryId },
        { type: 'workspace', resourceId: workspaceId },
      ],
      workspaceId,
      sessionKey,
      assignee,
      deadline:
        deadline ??
        new Date(
          now.getTime() + DEFAULT_CRAWL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ),
      aiConsideration: '子选题数据看板需要按抓取频率获取最新互动数据。',
      decisionReason: `子选题 #${topic.id} 处于抓取中状态，由${
        trigger === 'schedule' ? '定时调度' : '用户手动'
      }发起本次采集。`,
      aiPlan: this.buildCrawlPlan(topic, notes),
    });
    await this.context.appendMessage(
      sessionKey,
      {
        role: ContextRole.User,
        content: `执行 Todo #${todo.id}：${todo.title}\n\n${todo.aiPlan}`,
      },
      {
        tenantId: topic.tenantId ?? undefined,
        userId: topic.userId,
        sessionType: 'xhs-tracker',
      },
    );
    const id = await this.nextTaskId();
    const task: XhsCrawlTaskEntity = {
      _id: new ObjectId(),
      id,
      tenantId: topic.tenantId ?? null,
      userId: topic.userId,
      topicId: topic.id,
      todoId: todo.id,
      runIndex: 1,
      trigger,
      status: 'pending',
      startedAt: now,
      collectedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.tasks.insertOne(task);
    await this.topics.markCrawlScheduled(topic.id, now);
    if (beforeTrigger) await beforeTrigger(task);
    try {
      await this.robots.triggerIfRobotAssigned({ todo });
    } catch (error) {
      this.logger.warn(
        `[createCrawlTask] 触发抓取机器人失败 topicId=${topic.id} todoId=${todo.id} ${String(error)}`,
      );
    }
    this.logger.log(
      `[createCrawlTask] topicId=${topic.id} todoId=${todo.id} trigger=${trigger}`,
    );
    return task;
  }

  /**
   * @description 取消某个子选题在途的抓取任务，取消抓取时连同尚未结束的 Todo 一起停掉。
   * @keyword-cn 取消在途任务, 停止抓取
   * @keyword-en cancel-running-tasks, stop-crawl
   * @param topicId 子选题业务 ID。
   * @returns {Promise<number>} 被取消的任务数。
   */
  async cancelRunningTasks(topicId: number): Promise<number> {
    const running = await this.tasks
      .find({ topicId, status: { $in: ['pending', 'running'] } })
      .toArray();
    const now = new Date();
    for (const task of running) {
      try {
        await this.todos.update({ id: task.todoId, status: 'cancelled' });
      } catch (error) {
        this.logger.warn(
          `[cancelRunningTasks] 取消 Todo 失败 todoId=${task.todoId} ${String(error)}`,
        );
      }
      await this.tasks.updateOne(
        { id: task.id },
        { $set: { status: 'cancelled', finishedAt: now, updatedAt: now } },
      );
    }
    return running.length;
  }

  /**
   * @description 调度轮询主体：按 nextRunAt 索引分批原子领取专用调度行，不再扫描全部子选题。
   * @keyword-cn 到期任务领取, 索引调度
   * @keyword-en due-task-claim, indexed-scheduling
   * @returns {Promise<void>}
   */
  private async tickScheduler(): Promise<void> {
    if (this.schedulerBusy) return;
    this.schedulerBusy = true;
    try {
      for (let index = 0; index < SCHEDULER_BATCH_SIZE; index += 1) {
        const schedule = await this.claimDueSchedule();
        if (!schedule) break;
        try {
          await this.processClaimedSchedule(schedule);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.schedules.updateOne(
            { topicId: schedule.topicId, lockToken: schedule.lockToken },
            {
              $set: {
                status: 'waiting',
                nextRunAt: new Date(Date.now() + AGENT_RETRY_MS),
                lastError: message.slice(0, 500),
                updatedAt: new Date(),
              },
              $unset: { lockToken: '', lockUntil: '' },
            },
          );
          this.logger.warn(
            `[tickScheduler] topicId=${schedule.topicId} ${message}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(`[tickScheduler] ${String(error)}`);
    } finally {
      this.schedulerBusy = false;
    }
  }

  /**
   * @description 通过 MongoDB findOneAndUpdate 原子领取最早到期调度行，支持多实例租约接管。
   * @keyword-cn 原子领取调度, 多实例租约
   * @keyword-en atomic-schedule-claim, multi-instance-lease
   * @returns {Promise<XhsCrawlScheduleEntity | null>} 已加锁的调度行。
   */
  private async claimDueSchedule(): Promise<XhsCrawlScheduleEntity | null> {
    const now = new Date();
    const lockToken = randomUUID();
    const result = await this.schedules.findOneAndUpdate(
      {
        status: { $in: ['waiting', 'running'] },
        nextRunAt: { $lte: now },
        $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lte: now } }],
      },
      {
        $set: {
          lockToken,
          lockUntil: new Date(now.getTime() + SCHEDULE_LOCK_MS),
          updatedAt: now,
        },
      },
      {
        sort: { nextRunAt: 1 },
        returnDocument: 'after',
        includeResultMetadata: true,
      },
    );
    return result.value ?? null;
  }

  /**
   * @description 推进一条已领取调度：等待态创建 Todo，运行态只核对当前 Todo 并安排下一节点。
   * @keyword-cn 推进线性调度, 运行态对账
   * @keyword-en advance-linear-schedule, running-state-reconcile
   * @param schedule 已持有当前实例锁的调度行。
   * @returns {Promise<void>}
   */
  private async processClaimedSchedule(
    schedule: XhsCrawlScheduleEntity,
  ): Promise<void> {
    const now = new Date();
    if (new Date(schedule.endAt).getTime() <= now.getTime()) {
      if (schedule.currentTodoId) {
        await this.cancelRunningTasks(schedule.topicId);
      }
      await this.schedules.updateOne(
        { topicId: schedule.topicId, lockToken: schedule.lockToken },
        {
          $set: { status: 'completed', updatedAt: now },
          $unset: { currentTodoId: '', lockToken: '', lockUntil: '' },
        },
      );
      return;
    }
    if (new Date(schedule.startAt).getTime() > now.getTime()) {
      await this.schedules.updateOne(
        { topicId: schedule.topicId, lockToken: schedule.lockToken },
        {
          $set: {
            status: 'waiting',
            nextRunAt: schedule.startAt,
            updatedAt: now,
          },
          $unset: { lockToken: '', lockUntil: '' },
        },
      );
      return;
    }
    const topic = await this.topics.getChildTopicById(schedule.topicId);
    if (!topic || topic.crawl?.status === 'cancelled') {
      await this.schedules.updateOne(
        { topicId: schedule.topicId, lockToken: schedule.lockToken },
        {
          $set: {
            status: 'cancelled',
            updatedAt: new Date(),
            ...(!topic ? { lastError: '来源子选题不存在' } : {}),
          },
          $unset: { currentTodoId: '', lockToken: '', lockUntil: '' },
        },
      );
      return;
    }

    if (schedule.status === 'running' && schedule.currentTodoId) {
      const todo = await this.todos.get(schedule.currentTodoId);
      if (
        todo?.status === 'pending' ||
        todo?.status === 'in_progress' ||
        todo?.status === 'waiting_user'
      ) {
        await this.schedules.updateOne(
          { topicId: schedule.topicId, lockToken: schedule.lockToken },
          {
            $set: {
              nextRunAt: new Date(Date.now() + RUNNING_CHECK_MS),
              updatedAt: new Date(),
            },
            $unset: { lockToken: '', lockUntil: '' },
          },
        );
        return;
      }
      await this.syncTaskStatuses(schedule.topicId);
      const error =
        todo?.status === 'failed'
          ? todo.abnormalReason || '抓取 Todo 执行失败'
          : todo?.status === 'cancelled'
            ? '抓取 Todo 已取消'
            : !todo
              ? '抓取 Todo 不存在'
              : todo.status === 'done'
                ? '任务已结束但没有回写任何数据'
                : undefined;
      await this.advanceScheduleAfterTodo(schedule.currentTodoId, error);
      return;
    }

    const task = await this.createCrawlTask(
      topic,
      'schedule',
      async (createdTask) => {
        await this.schedules.updateOne(
          { topicId: schedule.topicId, lockToken: schedule.lockToken },
          {
            $set: {
              status: 'running',
              currentTodoId: createdTask.todoId,
              lastDispatchedAt: now,
              nextRunAt: new Date(now.getTime() + RUNNING_CHECK_MS),
              updatedAt: now,
            },
            $unset: { lockToken: '', lockUntil: '', lastError: '' },
          },
        );
      },
      schedule.endAt,
    );
    if (!task) {
      await this.schedules.updateOne(
        { topicId: schedule.topicId, lockToken: schedule.lockToken },
        {
          $set: {
            status: 'waiting',
            nextRunAt: new Date(now.getTime() + AGENT_RETRY_MS),
            lastError: '未找到可用的数据追踪 Agent',
            updatedAt: now,
          },
          $unset: { lockToken: '', lockUntil: '' },
        },
      );
      return;
    }
  }

  /**
   * @description 抓取 Todo 结束后把调度行从 running 推回 waiting，并按用户频率计算下一次到期时间。
   * @keyword-cn 完成调度周期, 推进下次执行
   * @keyword-en complete-schedule-cycle, advance-next-run
   * @param todoId 当前调度绑定的 Todo ID。
   * @param error 本轮终态错误；成功回写时为空。
   * @returns {Promise<void>}
   */
  private async advanceScheduleAfterTodo(
    todoId: number,
    error?: string,
  ): Promise<void> {
    const schedule = await this.schedules.findOne({
      currentTodoId: todoId,
      status: 'running',
    });
    if (!schedule) return;
    const interval = await this.getIntervalMinutes({
      tenantId: schedule.tenantId,
      userId: schedule.userId,
    });
    const now = new Date();
    await this.schedules.updateOne(
      { topicId: schedule.topicId, currentTodoId: todoId, status: 'running' },
      {
        $set: {
          status: 'waiting',
          nextRunAt: new Date(now.getTime() + interval * 60_000),
          lastFinishedAt: now,
          updatedAt: now,
          ...(error ? { lastError: error } : {}),
        },
        $unset: {
          currentTodoId: '',
          lockToken: '',
          lockUntil: '',
          ...(!error ? { lastError: '' } : {}),
        },
      },
    );
  }

  /**
   * @description 当前是否存在可用的数据追踪 Agent。没有它调度器建不出任何抓取任务，
   *   而这个原因原本只落在服务端日志里，界面上只会看到一个空列表——所以要能查。
   * @keyword-cn 数据追踪可用性, 抓取前置条件
   * @keyword-en tracking-agent-available, crawl-precondition
   * @returns {Promise<boolean>} 是否存在可用的数据追踪 Agent。
   */
  async hasTrackingAgent(): Promise<boolean> {
    return Boolean(await this.resolveTrackingAssignee());
  }

  /**
   * @description 从已启用的 Agent 配置里挑出数据追踪执行方，优先按 module 匹配，回退按名称匹配。
   * @keyword-cn 数据追踪代理, 指派解析
   * @keyword-en tracking-agent-lookup, assignee-resolve
   * @returns {Promise<string | undefined>} `agent:<id>` 格式的 assignee。
   */
  private async resolveTrackingAssignee(): Promise<string | undefined> {
    const configs = await this.robots.listAgentConfigs();
    const byModule = configs.find(
      (item) => item.module === SUPER_CLAW_DATA_TRACKING_AGENT_MODULE,
    );
    if (byModule) return byModule.id;
    const legacy = configs.find(
      (item) => item.module === LEGACY_DATA_TRACKING_AGENT_MODULE,
    );
    if (legacy) return legacy.id;
    return configs.find((item) => item.name.includes('数据追踪'))?.id;
  }

  /**
   * @description 生成抓取 Todo 的执行计划：先沉淀可复用的采集脚本，再按 NoteId 清单开始抓取，
   *   最后经任务 Token 一次性回写。抓取对象恒定是已发布笔记，可能一篇也可能多篇。
   * @keyword-cn 抓取执行计划, 沉淀采集脚本
   * @keyword-en crawl-plan, persist-collector-script
   * @param topic 子选题实体。
   * @param notes 本次要抓取的已发布笔记清单，至少一条。
   * @returns {string} aiPlan 文本。
   */
  private buildCrawlPlan(
    topic: XhsTopicEntity,
    notes: CrawlTargetNote[],
  ): string {
    const noteLines = notes.map(
      (note, index) =>
        `  ${index + 1}. NoteId=${note.noteId}${
          note.title ? ` · 标题《${note.title}》` : ''
        }（article #${note.articleId}）`,
    );
    return [
      `【任务目标】抓取子选题「${topic.title}」（题目类型：${
        topic.topicType || '未标注'
      }）名下 ${notes.length} 篇已发布笔记的互动数据。抓取对象由下面的 NoteId 清单唯一确定，不需要也不允许按关键词另行搜索选文章。`,
      `【NoteId 清单】共 ${notes.length} 篇：`,
      ...noteLines,
      '',
      '【第一步 · 沉淀脚本】',
      '  1. 先在工作区里找有没有沉淀过的小红书笔记采集脚本（Playwright）。有就直接复用，不要重写。',
      '  2. 没有就新建一个，并且必须写成「输入 NoteId 数组 → 输出统一结构数组」的可复用形态，参数化保存到工作区，供后续任务继续用。',
      '  3. 复用的脚本跑不通（选择器失效、页面改版）时，读数据采集 MCP 的日志池定位后原地修补脚本并保存，不要绕过脚本手工点采。',
      '  4. 脚本内定位单篇笔记的方式：用已登录的小红书浏览器会话，在站内搜索结果、页面链接或接口响应中定位该 NoteId，取出当前登录态可用的 xsec_token，再打开 https://www.xiaohongshu.com/explore/{NoteId}?xsec_token={xsec_token}&xsec_source=pc_search。',
      '',
      '【第二步 · 开始抓取】',
      '  1. 把上面整份 NoteId 清单作为入参跑脚本，逐篇采集，不要一篇一个脚本。',
      '  2. 每篇采集字段：postTitle、postUrl、authorUrl、likeCount、commentCount、collectCount、viewCount(曝光/浏览量，能取到就取)、shareCount(分享量，能取到就取)、top5 评论。',
      '  3. 单篇失败不要中断整批：记下失败的 NoteId 与原因，继续抓剩下的。',
      '  4. 必须等数据采集日志池进入 completed/failed/timeout 等终态后再进入下一步。',
      '',
      '【第三步 · 回写数据】调用 superclaw.v1.SuperClawGateway/UpdateTask：',
      '  - 鉴权方式：metadata 使用节点 Token；请求同时携带 tenantId、taskId、taskToken',
      '  - 请求字段：xhsStats: [ { postTitle, postUrl, authorUrl, likeCount, commentCount, collectCount, viewCount, shareCount, topComments, tag, dataAt } ]',
      '  - 一次 UpdateTask 把本批全部成功笔记一起回写；整个任务只回写一次 bulk',
      '  - 终态必须按执行结果设置：仅当全部 NoteId 均采集成功且执行过程没有任何错误时，才设置 status=done',
      '  - 任一 NoteId 失败，或日志池进入 failed/timeout，或发生登录、鉴权、脚本、网络等错误时，必须设置 status=failed；即使已有部分成功数据，也不得标记为 done',
      '  - status=failed 时必须填写 abnormalReason，用一两句话语义化说明根因与影响范围（例如“小红书会话未登录，1 篇笔记均无法取得访问参数”），禁止只写错误码、failed 或原始堆栈',
      '  - taskResult 必须说明成功数、失败数，并逐条列出失败 NoteId 与可读原因；部分成功的 xhsStats 可与 failed 状态在这唯一一次 UpdateTask 中一起回写',
      '  - topComments 格式：[ { content, likeCount, replyCount } ]（最多 5 条）',
      '  - viewCount / shareCount 取不到时省略字段，不要填 0 冒充真实值。',
      '',
      '【约束】xsec_token 仅限本次登录态访问使用，不写入 Todo 结果、采集数据、日志或长期文件；站内操作按「小红书网站操作说明.md」执行。',
    ].join('\n');
  }

  /**
   * @description 汇总本次抓取要覆盖的已发布笔记：取该子选题在文章库里全部带 NoteId 的已发布文章，
   *   查不到时回退到调度记录绑定的那一篇，保证任务始终有明确的抓取对象。
   * @keyword-cn 汇总已发布笔记, 抓取目标清单
   * @keyword-en collect-published-notes, crawl-target-list
   * @param topicId 子选题 ID。
   * @param schedule 该子选题的周期调度记录。
   * @returns {Promise<CrawlTargetNote[]>} 去重后的笔记清单，可能为空。
   */
  private async resolvePublishedNotes(
    topicId: number,
    schedule: XhsCrawlScheduleEntity,
  ): Promise<CrawlTargetNote[]> {
    const rows = await this.articles
      .find(
        { libraryId: schedule.libraryId, publishStatus: 'published' },
        { projection: { id: 1, title: 1, meta: 1 } },
      )
      .toArray();
    const notes: CrawlTargetNote[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (this.readArticleTopicId(row.meta) !== topicId) continue;
      const noteId =
        typeof row.meta?.NoteId === 'string' ? row.meta.NoteId.trim() : '';
      if (!noteId || seen.has(noteId)) continue;
      seen.add(noteId);
      notes.push({
        noteId,
        articleId: Number(row.id),
        title: typeof row.title === 'string' ? row.title : '',
      });
    }
    if (notes.length) return notes;
    // 兜底：文章的 meta.xhsTopicId 缺失时仍能按调度绑定的那篇文章抓。
    const bound = await this.articles.findOne(
      { id: schedule.articleId, libraryId: schedule.libraryId },
      { projection: { id: 1, title: 1, meta: 1 } },
    );
    const boundNoteId =
      typeof bound?.meta?.NoteId === 'string' ? bound.meta.NoteId.trim() : '';
    if (!boundNoteId) return [];
    return [
      {
        noteId: boundNoteId,
        articleId: schedule.articleId,
        title: typeof bound?.title === 'string' ? bound.title : '',
      },
    ];
  }

  /**
   * @description 把 Todo 状态映射为抓取任务状态。
   * @keyword-cn 任务状态映射, 待办状态
   * @keyword-en todo-status-mapping, task-status
   * @param status Todo 状态。
   * @returns {XhsCrawlTaskStatus} 抓取任务状态。
   */
  private mapTodoStatus(status?: string): XhsCrawlTaskStatus {
    switch (status) {
      case 'in_progress':
      case 'waiting_user':
        return 'running';
      case 'done':
        return 'done';
      case 'failed':
        return 'failed';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  /**
   * @description 把抓取任务实体转换为前端表格行，顺带算出耗时。
   * @keyword-cn 任务视图转换, 耗时计算
   * @keyword-en task-view-mapping, duration-calc
   * @param task 抓取任务实体。
   * @returns {XhsCrawlTaskView} 前端表格行。
   */
  private toTaskView(task: XhsCrawlTaskEntity): XhsCrawlTaskView {
    return {
      id: task.id,
      topicId: task.topicId,
      todoId: task.todoId,
      runIndex: task.runIndex ?? 1,
      trigger: task.trigger,
      status: task.status,
      startedAt: new Date(task.startedAt).toISOString(),
      finishedAt: task.finishedAt
        ? new Date(task.finishedAt).toISOString()
        : undefined,
      durationMs: task.finishedAt
        ? new Date(task.finishedAt).getTime() -
          new Date(task.startedAt).getTime()
        : undefined,
      collectedCount: task.collectedCount,
      error: task.error,
    };
  }

  /**
   * @description 原子递增抓取任务业务 ID。
   * @keyword-cn 任务自增ID, 计数器
   * @keyword-en next-task-id, counter
   * @returns {Promise<number>} 新的任务 ID。
   */
  private async nextTaskId(): Promise<number> {
    const res = await this.counters.findOneAndUpdate(
      { _id: 'xhs_topic_crawl_tasks' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: true },
    );
    const seq = res.value?.seq;
    return typeof seq === 'number' ? seq : 1;
  }
}
