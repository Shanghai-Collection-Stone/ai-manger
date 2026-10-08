import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, Db, ObjectId } from 'mongodb';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import { DouyinPublishWorkService } from '../../douyin-publish/services/douyin-publish-work.service.js';
import { TikhubDouyinService } from '../../tikhub/services/tikhub-douyin.service.js';
import {
  DOUYIN_DATA_MANUAL_COOLDOWN_MS,
  type DouyinDataCrawlResult,
  type DouyinDataMonitorEntity,
  type DouyinDataScope,
  type DouyinDataSnapshotEntity,
} from '../entities/douyin-data.entity.js';
import { resolveCrawlTarget } from './douyin-aweme-link.js';
import { DouyinDataService } from './douyin-data.service.js';

/** @type {number} 调度轮询间隔（毫秒）。 */
const SCHEDULER_TICK_MS = 60_000;

/** @type {number} 每轮最多处理的到期监控数，避免一次打满 TikHub 限频。 */
const SCHEDULER_BATCH_SIZE = 20;

/** @type {number} 单次抓取持有的锁时长（毫秒），进程崩溃后锁自然过期可被接管。 */
const CRAWL_LOCK_MS = 2 * 60_000;

/** @type {number} 定时抓取失败后的重试间隔（毫秒）。 */
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;

/** @type {number} 相邻两次上游调用间隔（毫秒），规避 TikHub 限频。 */
const CALL_GAP_MS = 300;

/**
 * @description 抖音作品数据抓取：监控中的作品由 leader 进程每分钟轮询、按间隔经 TikHub 抓取并写快照，满 14 天自动结束；
 *   也支持对单个作品立即抓取一次。每次抓取用监控行上的原子锁防止重复调用计费。
 * @keyword-cn 抖音数据抓取, 定时抓取调度
 * @keyword-en douyin-data-crawl, scheduled-crawl
 */
@Injectable()
export class DouyinDataCrawlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DouyinDataCrawlService.name);
  private readonly monitors: Collection<DouyinDataMonitorEntity>;
  private readonly snapshots: Collection<DouyinDataSnapshotEntity>;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private schedulerBusy = false;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly data: DouyinDataService,
    private readonly works: DouyinPublishWorkService,
    private readonly tikhub: TikhubDouyinService,
  ) {
    this.monitors = db.collection<DouyinDataMonitorEntity>(
      'douyin_data_monitors',
    );
    this.snapshots = db.collection<DouyinDataSnapshotEntity>(
      'douyin_data_snapshots',
    );
  }

  /**
   * @description 启动调度轮询；多进程时只在 leader 进程上跑，避免重复抓取计费。
   * @keyword-cn 启动抖音抓取调度, 定时轮询
   * @keyword-en start-douyin-crawl-scheduler, interval-tick
   */
  onModuleInit(): void {
    if (this.schedulerTimer || !isLeaderProcess()) return;
    this.schedulerTimer = setInterval(() => {
      void this.tickScheduler();
    }, SCHEDULER_TICK_MS);
  }

  /**
   * @description 停止调度轮询。
   * @keyword-cn 停止抖音抓取调度, 释放定时器
   * @keyword-en stop-douyin-crawl-scheduler, clear-timer
   */
  onModuleDestroy(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
  }

  /**
   * @description 对一个监控中的作品立即抓取一次并写快照，不改动定时计划。
   * @keyword-cn 立即抓取, 手动触发抓取
   * @keyword-en crawl-now, manual-crawl-trigger
   * @param workId 发布作品 ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinDataCrawlResult>} 抓取结果；上游失败时 status=failed 并带中文原因。
   * @throws {BadRequestException} DOUYIN_DATA_NOT_MONITORING / DOUYIN_DATA_TARGET_MISSING / DOUYIN_DATA_TIKHUB_KEY_MISSING。
   * @throws {HttpException} 429 DOUYIN_DATA_CRAWL_TOO_FREQUENT：一分钟内重复手动抓取。
   * @throws {ConflictException} DOUYIN_DATA_CRAWL_RUNNING：同一作品已有抓取在进行。
   */
  async crawlNow(
    workId: string,
    scope: DouyinDataScope,
  ): Promise<DouyinDataCrawlResult> {
    const work = await this.data.requirePublishedWork(workId, scope);
    const monitor = await this.monitors.findOne({ workId: work._id });
    if (monitor?.status !== 'monitoring') {
      throw new BadRequestException('DOUYIN_DATA_NOT_MONITORING');
    }
    const target = resolveCrawlTarget(work.douyinVideoId, monitor.awemeId);
    if (!target) throw new BadRequestException('DOUYIN_DATA_TARGET_MISSING');
    if (!(await this.tikhub.isReady(scope))) {
      throw new BadRequestException('DOUYIN_DATA_TIKHUB_KEY_MISSING');
    }
    const now = new Date();
    if (
      monitor.lastManualAt &&
      now.getTime() - monitor.lastManualAt.getTime() <
        DOUYIN_DATA_MANUAL_COOLDOWN_MS
    ) {
      throw new HttpException(
        'DOUYIN_DATA_CRAWL_TOO_FREQUENT',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const claimed = await this.claim(
      { _id: monitor._id },
      { lastManualAt: now },
    );
    if (!claimed) throw new ConflictException('DOUYIN_DATA_CRAWL_RUNNING');
    return this.runCrawl(claimed, target, 'manual');
  }

  /**
   * @description 调度轮询主体：逐个原子领取到期的监控行并处理，单条出错不影响其余。
   * @keyword-cn 领取到期监控, 批量调度
   * @keyword-en claim-due-monitors, batch-scheduling
   */
  private async tickScheduler(): Promise<void> {
    if (this.schedulerBusy) return;
    this.schedulerBusy = true;
    try {
      for (let index = 0; index < SCHEDULER_BATCH_SIZE; index += 1) {
        const monitor = await this.claim({
          status: 'monitoring',
          nextCrawlAt: { $lte: new Date() },
        });
        if (!monitor) break;
        try {
          await this.processScheduled(monitor);
        } catch (error) {
          await this.release(monitor, {
            lastError: this.describeError(error),
            nextCrawlAt: new Date(Date.now() + RETRY_AFTER_FAILURE_MS),
          });
          this.logger.warn(
            `[tickScheduler] workId=${monitor.workId.toHexString()} ${String(error)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, CALL_GAP_MS));
      }
    } catch (error) {
      this.logger.warn(`[tickScheduler] ${String(error)}`);
    } finally {
      this.schedulerBusy = false;
    }
  }

  /**
   * @description 处理一条到期监控：满 14 天结束监控；作品已删除或不再是已发布就停止；缺作品 ID 或 Key 时记原因等下一轮；否则抓取。
   * @keyword-cn 处理到期监控, 监控到期结束
   * @keyword-en process-due-monitor, monitor-expiry
   * @param monitor 已持锁的监控行。
   */
  private async processScheduled(
    monitor: DouyinDataMonitorEntity,
  ): Promise<void> {
    const now = new Date();
    const scope = this.scopeOf(monitor);
    const interval = this.data.intervalMinutes() * 60_000;
    if (monitor.endAt && monitor.endAt.getTime() <= now.getTime()) {
      await this.release(monitor, { status: 'finished', nextCrawlAt: null });
      return;
    }
    const work = await this.works.findWork(monitor.workId.toHexString(), scope);
    if (!work || work.status !== 'published') {
      await this.release(monitor, {
        status: 'stopped',
        nextCrawlAt: null,
        lastError: '作品已从发布库删除或不再是已发布状态，已停止监控',
      });
      return;
    }
    const target = resolveCrawlTarget(work.douyinVideoId, monitor.awemeId);
    if (!target) {
      await this.release(monitor, {
        lastError: '还没有可抓取的抖音作品 ID，请先绑定作品链接',
        nextCrawlAt: new Date(now.getTime() + interval),
      });
      return;
    }
    if (!(await this.tikhub.isReady(scope))) {
      await this.release(monitor, {
        lastError: '未配置 TikHub API Key',
        nextCrawlAt: new Date(now.getTime() + interval),
      });
      return;
    }
    await this.runCrawl(monitor, target, 'schedule');
  }

  /**
   * @description 执行一次抓取：成功写快照、刷新封面与最后抓取时间；失败记中文原因。定时抓取推进下一次时间，手动抓取不改计划。
   * @keyword-cn 执行抓取, 写入快照
   * @keyword-en run-crawl, write-snapshot
   * @param monitor 已持锁的监控行。
   * @param awemeId 抓取目标作品 ID。
   * @param trigger 触发方式。
   * @returns {Promise<DouyinDataCrawlResult>} 抓取结果。
   */
  private async runCrawl(
    monitor: DouyinDataMonitorEntity,
    awemeId: string,
    trigger: 'schedule' | 'manual',
  ): Promise<DouyinDataCrawlResult> {
    const scope = this.scopeOf(monitor);
    const intervalMs = this.data.intervalMinutes() * 60_000;
    try {
      const stat = await this.tikhub.collectVideo(awemeId, scope);
      const snapshot: DouyinDataSnapshotEntity = {
        _id: new ObjectId(),
        workId: monitor.workId,
        userId: monitor.userId,
        ...(monitor.tenantId ? { tenantId: monitor.tenantId } : {}),
        awemeId,
        trigger,
        likeCount: stat.likeCount,
        commentCount: stat.commentCount,
        ...(stat.collectCount === undefined
          ? {}
          : { collectCount: stat.collectCount }),
        ...(stat.shareCount === undefined
          ? {}
          : { shareCount: stat.shareCount }),
        ...(stat.playCount === undefined ? {} : { playCount: stat.playCount }),
        crawledAt: stat.dataAt,
      };
      await this.snapshots.insertOne(snapshot);
      await this.release(monitor, {
        lastCrawledAt: stat.dataAt,
        lastError: null,
        coverUrl: stat.coverUrl ?? monitor.coverUrl ?? null,
        ...(trigger === 'schedule'
          ? { nextCrawlAt: new Date(stat.dataAt.getTime() + intervalMs) }
          : {}),
      });
      return {
        status: 'success',
        crawledAt: stat.dataAt.toISOString(),
        metrics: this.data.toMetricsView(snapshot),
      };
    } catch (error) {
      const message = this.describeError(error);
      await this.release(monitor, {
        lastError: message,
        ...(trigger === 'schedule'
          ? { nextCrawlAt: new Date(Date.now() + RETRY_AFTER_FAILURE_MS) }
          : {}),
      });
      return {
        status: 'failed',
        error: message,
        crawledAt: new Date().toISOString(),
        metrics: null,
      };
    }
  }

  /**
   * @description 原子领取一条满足条件且未被锁住的监控行，写入锁令牌与过期时间。
   * @keyword-cn 原子领取监控, 抓取锁
   * @keyword-en atomic-monitor-claim, crawl-lock
   * @param filter 额外条件。
   * @param extraSet 领取时一并写入的字段。
   * @returns {Promise<DouyinDataMonitorEntity | null>} 已持锁的监控行。
   */
  private async claim(
    filter: Record<string, unknown>,
    extraSet: Partial<DouyinDataMonitorEntity> = {},
  ): Promise<DouyinDataMonitorEntity | null> {
    const now = new Date();
    const result = await this.monitors.findOneAndUpdate(
      {
        ...filter,
        $or: [
          { lockUntil: { $exists: false } },
          { lockUntil: null },
          { lockUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          ...extraSet,
          lockToken: randomUUID(),
          lockUntil: new Date(now.getTime() + CRAWL_LOCK_MS),
          updatedAt: now,
        },
      },
      {
        sort: { nextCrawlAt: 1 },
        returnDocument: 'after',
        includeResultMetadata: true,
      },
    );
    return result.value ?? null;
  }

  /**
   * @description 释放抓取锁并写入结果字段；锁令牌不匹配（已被接管）时不写。
   * @keyword-cn 释放抓取锁, 写入结果
   * @keyword-en release-crawl-lock, write-result
   * @param monitor 持锁的监控行。
   * @param set 要写入的字段。
   */
  private async release(
    monitor: DouyinDataMonitorEntity,
    set: Partial<DouyinDataMonitorEntity>,
  ): Promise<void> {
    await this.monitors.updateOne(
      { _id: monitor._id, lockToken: monitor.lockToken },
      {
        $set: { ...set, updatedAt: new Date() },
        $unset: { lockToken: '', lockUntil: '' },
      },
    );
  }

  /**
   * @description 把 TikHub 报错转成界面能看懂的中文原因。
   * @keyword-cn 抓取失败原因, 错误可读化
   * @keyword-en crawl-failure-reason, readable-error
   * @param error 捕获到的异常。
   * @returns {string} 中文原因（最长 300 字）。
   */
  private describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/TikHub 返回 401|TikHub 返回 403/.test(message))
      return 'TikHub API Key 无效或已过期';
    if (/TikHub 返回 402/.test(message)) return 'TikHub 账户余额不足';
    if (/TikHub 返回 429/.test(message))
      return 'TikHub 调用过于频繁，请稍后再试';
    if (/请求超时|TimeoutError/.test(message))
      return 'TikHub 请求超时，请稍后再试';
    return message.slice(0, 300);
  }

  /**
   * @description 由监控行还原租户用户作用域，定时抓取按作品归属人解析 TikHub Key。
   * @keyword-cn 还原抓取作用域
   * @keyword-en monitor-scope
   * @param monitor 监控行。
   * @returns {DouyinDataScope} 作用域。
   */
  private scopeOf(monitor: DouyinDataMonitorEntity): DouyinDataScope {
    return { tenantId: monitor.tenantId, userId: monitor.userId };
  }
}
