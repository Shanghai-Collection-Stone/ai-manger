import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { RobotRegistryService } from '../../auto-task-robot/services/robot-registry.service.js';
import { TodoService } from '../../todo/services/todo.service.js';
import { XhsPostStatService } from '../../todo/services/xhs-post-stat.service.js';
import { XhsTopicRepositoryService } from '../../xhs-topic/services/xhs-topic-repository.service.js';
import type { XhsTopicEntity } from '../../xhs-topic/entities/xhs-topic.entity.js';
import type {
  XhsCrawlSettingsEntity,
  XhsCrawlTaskEntity,
  XhsCrawlTaskStatus,
  XhsCrawlTaskTrigger,
  XhsCrawlTaskView,
} from '../entities/xhs-topic-data.entity.js';

/** @type {number} 未配置抓取频率时使用的默认间隔（分钟），与前端设置面板默认值一致。 */
export const DEFAULT_CRAWL_INTERVAL_MINUTES = 30;

/** @type {number} 调度器轮询周期（毫秒），到点才真正建任务，轮询本身很轻。 */
const SCHEDULER_TICK_MS = 60_000;

/** @type {number} 同一次抓取的回写合并窗口（毫秒）。Agent 可能把一次采集拆成多个请求陆续发上来，
 *  窗口内的回写算同一次抓取；超出窗口（例如长时任务隔天再采）才算新的一次。 */
const CRAWL_RUN_MERGE_WINDOW_MS = 10 * 60 * 1000;

/** @type {string} 数据追踪 Agent 的 module 标识，调度器据此挑选抓取执行方。 */
const DATA_TRACKING_AGENT_MODULE = 'xhs_data_tracking';

/**
 * @description 子选题抓取调度服务：维护抓取开关、按频率自动创建抓取 Todo、绑定任务与选题，并把回写数据归属到子选题。
 * @keyword-cn 抓取调度, 抓取任务绑定, 取消抓取
 * @keyword-en crawl-scheduler, crawl-task-binding, cancel-crawl
 */
@Injectable()
export class XhsTopicCrawlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(XhsTopicCrawlService.name);
  private readonly tasks: Collection<XhsCrawlTaskEntity>;
  private readonly settings: Collection<XhsCrawlSettingsEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private schedulerBusy = false;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly todos: TodoService,
    private readonly postStats: XhsPostStatService,
    private readonly topics: XhsTopicRepositoryService,
    private readonly robots: RobotRegistryService,
  ) {
    this.tasks = db.collection<XhsCrawlTaskEntity>('xhs_topic_crawl_tasks');
    this.settings = db.collection<XhsCrawlSettingsEntity>(
      'xhs_topic_crawl_settings',
    );
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
   * @description 建立抓取任务与调度配置的集合索引及自增计数器。
   * @keyword-cn 抓取任务索引, 计数器初始化
   * @keyword-en crawl-task-indexes, counter-init
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.tasks.createIndex({ id: 1 }, { unique: true });
    await this.tasks.createIndex({ topicId: 1, startedAt: -1 });
    await this.tasks.createIndex({ todoId: 1, runIndex: -1 });
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
              ...(status === 'failed' && todo?.abnormalReason
                ? { error: todo.abnormalReason }
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
   * @description 抓取数据回写入口调用：把这批数据划归一次抓取运行并记进任务明细。
   *   同一个 Todo 的多次回写会落成**多行**运行记录——长时采集任务一跑就是几天，
   *   每天回写一次就是一次抓取，压成一行既看不出抓了几次，趋势也会被挤成一个批次。
   *   合并窗口内的连续回写（Agent 把一次采集拆成几个请求）仍算同一次。
   * @keyword-cn 记录抓取运行, 每次抓取一条, 回写归属
   * @keyword-en record-crawl-run, per-crawl-record, write-attribution
   * @param todoId 回写数据的抓取 Todo ID。
   * @returns {Promise<number | undefined>} 本次归属到的运行记录 ID；Todo 未绑定子选题时为 undefined。
   */
  async recordCrawlRun(todoId: number): Promise<number | undefined> {
    const latest = await this.tasks
      .find({ todoId })
      .sort({ runIndex: -1, id: -1 })
      .limit(1)
      .next();
    if (!latest) {
      // 没有绑定记录说明这个抓取 Todo 不是从数据看板发起的（例如聊天里直接建的采集任务），
      // 拿不到归属子选题，只能放过——数据本身照常入库，只是不进某个子选题的看板。
      this.logger.debug?.(
        `[recordCrawlRun] todoId=${todoId} 未绑定子选题，跳过运行记录`,
      );
      return undefined;
    }

    const now = new Date();
    const inFlight = latest.status === 'pending' || latest.status === 'running';
    const withinWindow =
      !!latest.finishedAt &&
      now.getTime() - new Date(latest.finishedAt).getTime() <
        CRAWL_RUN_MERGE_WINDOW_MS;

    let target = latest;
    if (!inFlight && !withinWindow) {
      const id = await this.nextTaskId();
      target = {
        _id: new ObjectId(),
        id,
        tenantId: latest.tenantId,
        userId: latest.userId,
        topicId: latest.topicId,
        todoId,
        runIndex: latest.runIndex + 1,
        trigger: latest.trigger,
        status: 'running',
        startedAt: now,
        collectedCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await this.tasks.insertOne(target);
    }

    const assigned = await this.postStats.assignCrawlRun(
      todoId,
      latest.topicId,
      target.id,
    );
    await this.tasks.updateOne(
      { id: target.id },
      {
        $set: {
          status: 'done',
          finishedAt: now,
          collectedCount: target.collectedCount + assigned,
          updatedAt: now,
        },
        $unset: { error: '' },
      },
    );
    await this.topics.markCrawled(latest.topicId, now);
    this.logger.log(
      `[recordCrawlRun] topicId=${latest.topicId} todoId=${todoId} runId=${target.id} run=${target.runIndex} assigned=${assigned}`,
    );
    return target.id;
  }

  /**
   * @description 为一个子选题立即创建一次抓取任务：建 Todo、指派数据追踪 Agent、写入绑定记录并触发执行。
   * @keyword-cn 创建抓取任务, 指派数据追踪
   * @keyword-en create-crawl-task, assign-tracking-agent
   * @param topic 子选题实体。
   * @param trigger 触发来源。
   * @returns {Promise<XhsCrawlTaskEntity | null>} 新建的抓取任务，找不到可用 Agent 时为 null。
   */
  async createCrawlTask(
    topic: XhsTopicEntity,
    trigger: XhsCrawlTaskTrigger,
  ): Promise<XhsCrawlTaskEntity | null> {
    const assignee = await this.resolveTrackingAssignee();
    if (!assignee) {
      this.logger.warn(
        `[createCrawlTask] 未找到 module=${DATA_TRACKING_AGENT_MODULE} 的数据追踪 Agent，topicId=${topic.id}`,
      );
      return null;
    }
    const now = new Date();
    const todo = await this.todos.create({
      tenantId: topic.tenantId ?? undefined,
      userId: topic.userId,
      title: `小红书数据抓取 · ${topic.title}`,
      description: `围绕子选题「${topic.title}」采集小红书笔记互动数据。`,
      category: 'xhs',
      type: 'auto_execute',
      assignee,
      aiConsideration: '子选题数据看板需要按抓取频率获取最新互动数据。',
      decisionReason: `子选题 #${topic.id} 处于抓取中状态，由${
        trigger === 'schedule' ? '定时调度' : '用户手动'
      }发起本次采集。`,
      aiPlan: this.buildCrawlPlan(topic),
    });
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
   * @description 调度轮询主体：遍历所有抓取中的子选题，到达抓取间隔且没有在途任务的建新任务。
   * @keyword-cn 调度轮询, 频率节流
   * @keyword-en scheduler-tick, interval-throttle
   * @returns {Promise<void>}
   */
  private async tickScheduler(): Promise<void> {
    if (this.schedulerBusy) return;
    this.schedulerBusy = true;
    try {
      const topics = await this.topics.listCrawlingChildTopics();
      if (topics.length === 0) return;
      const now = Date.now();
      const intervalCache = new Map<string, number>();
      for (const topic of topics) {
        const cacheKey = `${topic.tenantId ?? ''}|${topic.userId}`;
        let interval = intervalCache.get(cacheKey);
        if (interval === undefined) {
          interval = await this.getIntervalMinutes({
            tenantId: topic.tenantId,
            userId: topic.userId,
          });
          intervalCache.set(cacheKey, interval);
        }
        const lastScheduled = topic.crawl?.lastScheduledAt
          ? new Date(topic.crawl.lastScheduledAt).getTime()
          : 0;
        if (now - lastScheduled < interval * 60_000) continue;
        const inflight = await this.tasks.countDocuments({
          topicId: topic.id,
          status: { $in: ['pending', 'running'] },
        });
        if (inflight > 0) continue;
        await this.createCrawlTask(topic, 'schedule');
      }
    } catch (error) {
      this.logger.warn(`[tickScheduler] ${String(error)}`);
    } finally {
      this.schedulerBusy = false;
    }
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
      (item) => item.module === DATA_TRACKING_AGENT_MODULE,
    );
    if (byModule) return byModule.id;
    return configs.find((item) => item.name.includes('数据追踪'))?.id;
  }

  /**
   * @description 生成抓取 Todo 的执行计划，采集字段口径与 task-api 回写接口保持一致。
   * @keyword-cn 抓取执行计划, 采集字段说明
   * @keyword-en crawl-plan, collect-field-spec
   * @param topic 子选题实体。
   * @returns {string} aiPlan 文本。
   */
  private buildCrawlPlan(topic: XhsTopicEntity): string {
    return [
      `【采集目标】围绕子选题「${topic.title}」（题目类型：${
        topic.topicType || '未标注'
      }）采集小红书笔记数据。`,
      '【采集字段】postTitle、postUrl、authorUrl、likeCount、commentCount、collectCount、viewCount(曝光/浏览量，能取到就取)、shareCount(分享量，能取到就取)、top5 评论。',
      '【数据回写规则】采集完成后通过任务专项接口回写：',
      '  - 接口地址：POST /task-api/{todoId}/xhs-stats/bulk',
      '  - 鉴权方式：Authorization: Bearer {taskToken}（从 todo.taskToken 获取）',
      '  - 请求体：{ "items": [ { postTitle, postUrl, authorUrl, likeCount, commentCount, collectCount, viewCount, shareCount, topComments, tag, dataAt } ] }',
      '  - topComments 格式：[ { content, likeCount, replyCount } ]（最多 5 条）',
      '  - viewCount / shareCount 取不到时省略字段，不要填 0 冒充真实值。',
      '【操作约束】按「小红书网站操作说明.md」完成站内操作，单次任务只回写一次 bulk。',
    ].join('\n');
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
