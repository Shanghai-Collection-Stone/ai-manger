import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ObjectId, type Collection, type Db } from 'mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import { ModelConcurrencyService } from '../../model-concurrency/services/model-concurrency.service.js';
import type { WorkflowNodeRuntime } from '../../workflow-model/entities/workflow-model.entity.js';
import type {
  DouyinOperationEntity,
  DouyinOperationView,
  DouyinTopicEntity,
  DouyinVideoQueueState,
  DouyinVideoQueueView,
} from '../entities/douyin-workbench.entity.js';
import {
  countPeopleAhead,
  DOUYIN_VIDEO_DEFAULT_TASK_SECONDS,
  estimateVideoWaitSeconds,
  medianTaskSeconds,
} from './douyin-video-wait.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 模型实测耗时的缓存时长（毫秒），每个用户每 8 秒轮询一次，不必每次都重算。
 * @keyword-cn 实测耗时缓存, 轮询减负
 * @keyword-en task-seconds-cache-ms, polling-load
 */
const DOUYIN_VIDEO_TASK_SECONDS_CACHE_MS = 60 * 1000;

/**
 * @description 一个模型当前的负载：还没结束的任务与实测单任务耗时。
 * @keyword-cn 模型当前负载, 在跑任务
 * @keyword-en model-load, active-tasks
 */
type DouyinVideoModelLoad = {
  active: DouyinOperationEntity[];
  taskSeconds: number | null;
};

/**
 * @description 抖音视频在模型并发登记里的任务种类名。
 * @keyword-cn 抖音视频排队种类, 任务种类名
 * @keyword-en douyin-video-queue-kind, concurrency-kind-name
 */
export const DOUYIN_VIDEO_QUEUE_KIND = 'douyin-video';

/**
 * @description 已拿到名额、正在提交的排队任务超过这么久没写回结果，判为提交中断（毫秒）。
 * @keyword-cn 排队提交超时, 提交中断
 * @keyword-en queue-submit-stale-ms, submit-interrupted
 */
export const DOUYIN_VIDEO_QUEUE_SUBMIT_STALE_MS = 10 * 60 * 1000;

/**
 * @description 排队任务交回哪条通道重新提交：分镜 / 整片按供应商，探店分段统一交给探店服务。
 * @keyword-cn 排队提交通道, 视频通道
 * @keyword-en queue-submit-route, video-channel
 */
export type DouyinVideoQueueRoute =
  'pixmax' | 'shuyan' | 'opensource-video' | 'store-visit';

/**
 * @description 通道注册的重新提交函数：拿排队记录、当前脚本、按记录重建的运行配置与作用域，提交后自己写回记录。
 * @keyword-cn 排队重新提交函数, 通道回调
 * @keyword-en queue-submitter, channel-callback
 */
export type DouyinVideoQueueSubmitter = (input: {
  row: DouyinOperationEntity;
  topic: DouyinTopicEntity;
  runtime: WorkflowNodeRuntime;
  scope: DouyinScope;
}) => Promise<unknown>;

/**
 * @description 排队状态转公开视图：只留阶段，不外发重新提交参数。
 * @keyword-cn 排队公开视图, 隐藏提交参数
 * @keyword-en to-queue-view, hide-resubmit-input
 * @param queue 服务端排队状态。
 * @returns {DouyinVideoQueueView|undefined} 公开状态。
 */
export function toVideoQueueView(
  queue: DouyinVideoQueueState | undefined,
): DouyinVideoQueueView | undefined {
  return queue ? { stage: queue.stage } : undefined;
}

/**
 * @description 读取分镜 / 整片排队记录的重新提交参数：模式、单镜 ID 与补充要求。
 * @keyword-cn 读取排队分镜参数, 重新提交
 * @keyword-en read-queued-shot-request, resubmit
 * @param row 排队记录。
 * @returns 模式、单镜 ID 与补充要求。
 */
export function readQueuedShotRequest(row: DouyinOperationEntity): {
  mode: 'shot' | 'full';
  shotId?: string;
  prompt?: string;
} {
  const prompt = row.queue?.input?.prompt;
  return {
    mode: row.mode === 'full' ? 'full' : 'shot',
    shotId: row.shotId,
    prompt: typeof prompt === 'string' ? prompt : undefined,
  };
}

/**
 * @description 读取任务在自建 GPU 服务器上前面还有几个：服务端排队位置从 1 算起（前面含正在跑的那个），执行中为 0，已结束或其他通道为 0。
 * @keyword-cn 读取服务器排队位置, GPU队列位置
 * @keyword-en read-server-queue-position, gpu-queue-position
 * @param view 调用视图。
 * @returns {number} 前面的任务数。
 */
export function readVideoServerAhead(
  view: Pick<DouyinOperationView, 'provider' | 'status' | 'result'>,
): number {
  if (
    view.provider !== 'opensource-video' ||
    !['queued', 'running'].includes(view.status)
  )
    return 0;
  const position = Number(
    (view.result as { queue_position?: unknown } | undefined)?.queue_position,
  );
  return Number.isFinite(position) && position > 0 ? Math.floor(position) : 0;
}

/**
 * @description 判断调用记录是否还占着模型：排队或生成中、且不在出片后的对口型阶段（对口型用的是另一个模型）。
 * @keyword-cn 判断占用模型, 名额是否归还
 * @keyword-en is-occupying-model, slot-still-held
 * @param row 调用记录。
 * @returns {boolean} 仍占着模型时为 true。
 */
export function isOccupyingVideoModel(
  row: Pick<DouyinOperationEntity, 'status' | 'lipSync'>,
): boolean {
  return ['queued', 'running'].includes(row.status) && !row.lipSync;
}

/**
 * @description 抖音视频按模型排队：各通道提交前调 `admit` 申请名额，满了用 `enqueue` 存成排队记录直接返回；
 *   名额空出来时由 [model-concurrency](../../model-concurrency/module.md) 回调 `dispatch`，按记录重建运行配置后交回对应通道提交。
 *   主进程每分钟把提交中断的记录判失败，并补回丢了的排队登记。
 * @keyword-cn 抖音视频排队, 模型并发上限, 超出排队
 * @keyword-en douyin-video-queue, model-concurrency-limit, queue-when-full
 */
@Injectable()
export class DouyinVideoQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DouyinVideoQueueService.name);
  private readonly operations: Collection<DouyinOperationEntity>;
  private readonly submitters = new Map<
    DouyinVideoQueueRoute,
    DouyinVideoQueueSubmitter
  >();
  private readonly taskSecondsCache = new Map<
    string,
    { at: number; value: number | null }
  >();
  private timer?: NodeJS.Timeout;

  /**
   * @description 初始化调用集合并向模型并发登记注册抖音视频任务种类。
   * @keyword-cn 初始化视频排队, 注册任务种类
   * @keyword-en init-video-queue, register-concurrency-kind
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly concurrency: ModelConcurrencyService,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly adminService: AdminService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
    this.concurrency.registerKind(DOUYIN_VIDEO_QUEUE_KIND, {
      dispatch: (holder) => this.dispatch(holder),
      inspect: (holders) => this.inspect(holders),
    });
  }

  /**
   * @description 主进程上每分钟检查一次中断的排队记录。
   * @keyword-cn 启动排队巡检, 中断恢复
   * @keyword-en start-queue-recovery, interrupt-recovery
   */
  onModuleInit(): void {
    if (!isLeaderProcess()) return;
    this.timer = setInterval(() => void this.recover(), 60 * 1000);
    this.timer.unref?.();
  }

  /**
   * @description 停止排队巡检。
   * @keyword-cn 停止排队巡检, 模块销毁
   * @keyword-en stop-queue-recovery, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 通道注册重新提交函数。
   * @keyword-cn 注册排队通道, 重新提交函数
   * @keyword-en register-queue-route, queue-submitter
   * @param route 通道。
   * @param submitter 重新提交函数。
   */
  register(
    route: DouyinVideoQueueRoute,
    submitter: DouyinVideoQueueSubmitter,
  ): void {
    this.submitters.set(route, submitter);
  }

  /**
   * @description 提交前按「提供商 + 模型」申请名额；false 表示已经排上队，调用方应改存排队记录。
   * @keyword-cn 申请视频名额, 满了排队
   * @keyword-en admit-video-slot, queue-when-full
   * @param runtime 本次用的运行配置。
   * @param operationId 调用记录 ID。
   * @returns {Promise<boolean>} 是否可以立即提交。
   */
  admit(runtime: WorkflowNodeRuntime, operationId: string): Promise<boolean> {
    return this.concurrency.admit(
      DOUYIN_VIDEO_QUEUE_KIND,
      { providerId: runtime.providerId, model: runtime.model },
      operationId,
    );
  }

  /**
   * @description 归还名额（提交失败时调用，重复调用无副作用）。
   * @keyword-cn 归还视频名额, 提交失败
   * @keyword-en release-video-slot, submit-failed
   * @param operationId 调用记录 ID。
   */
  async release(operationId: string): Promise<void> {
    await this.concurrency
      .release(operationId)
      .catch((error) =>
        this.logger.warn(
          `[release] 归还名额失败 operation=${operationId}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  /**
   * @description 归还名额后原样抛出错误，给提交前的扣费等步骤失败时用。
   * @keyword-cn 失败归还名额, 原样抛错
   * @keyword-en release-and-rethrow, keep-error
   * @param operationId 调用记录 ID。
   * @param error 原错误。
   */
  async releaseAndThrow(operationId: string, error: unknown): Promise<never> {
    await this.release(operationId);
    throw error;
  }

  /**
   * @description 把拿不到名额的调用存成排队记录（`status=queued` + `queue.stage=waiting`）并立刻登记排队，下一轮派发就能轮到，不用等每分钟的巡检补登记；`existing` 为 true 时改写已有记录（探店续段）。
   * @keyword-cn 保存排队记录, 等模型空位
   * @keyword-en save-queued-operation, wait-for-model-slot
   * @param doc 调用记录字段（不含状态与时间）。
   * @param input 重新提交需要的参数（不含 Key）。
   * @param existing 是否改写已有记录。
   * @returns {Promise<DouyinOperationEntity>} 排队记录。
   */
  async enqueue(
    doc: Omit<
      DouyinOperationEntity,
      '_id' | 'status' | 'createdAt' | 'updatedAt' | 'queue'
    >,
    input: Record<string, unknown>,
    existing = false,
  ): Promise<DouyinOperationEntity> {
    const now = new Date();
    const row: DouyinOperationEntity = {
      _id: new ObjectId(),
      ...doc,
      status: 'queued',
      progress: 0,
      queue: { stage: 'waiting', enqueuedAt: now, input },
      createdAt: now,
      updatedAt: now,
    };
    if (existing) {
      const fields: Partial<DouyinOperationEntity> = { ...row };
      delete fields._id;
      await this.operations.updateOne(
        { id: row.id },
        {
          $set: fields,
          $unset: { error: '', errorDetail: '', externalId: '' },
        },
      );
    } else await this.operations.insertOne(row);
    if (row.providerId && row.model)
      await this.concurrency
        .ensureWaiting(
          DOUYIN_VIDEO_QUEUE_KIND,
          { providerId: row.providerId, model: row.model },
          row.id,
          now,
        )
        .catch((error) =>
          this.logger.warn(
            `[enqueue] 登记排队失败，等巡检补回 operation=${row.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    return row;
  }

  /**
   * @description 写提交结果：排队记录（`fromQueue`）按 ID 改写并去掉排队字段，否则新建。
   * @keyword-cn 写回提交结果, 排队记录改写
   * @keyword-en save-submit-result, overwrite-queued-row
   * @param doc 完整调用记录。
   * @param fromQueue 是否来自排队。
   */
  async save(doc: DouyinOperationEntity, fromQueue: boolean): Promise<void> {
    if (!fromQueue) {
      await this.operations.insertOne(doc);
      return;
    }
    const fields: Partial<DouyinOperationEntity> = { ...doc };
    delete fields._id;
    delete fields.queue;
    await this.operations.updateOne(
      { id: doc.id },
      { $set: fields, $unset: { queue: '' } },
    );
  }

  /**
   * @description 给一批调用视图补上排队位置（同一模型前面还有几个）、模型通道情况（几路、占用几路）、前方人数与预计等待时间，不外发提供商 ID 和用户 ID。
   * @keyword-cn 补排队位置, 前面还有几个
   * @keyword-en attach-queue-positions, waiting-ahead
   * @param views 调用视图。
   * @param rows 对应的调用记录，用来取提供商、模型与当前用户。
   * @returns {Promise<DouyinOperationView[]>} 补好的视图。
   */
  async attachPositions(
    views: DouyinOperationView[],
    rows: DouyinOperationEntity[] = [],
  ): Promise<DouyinOperationView[]> {
    const waiting = views.filter((view) => view.queue?.stage === 'waiting');
    const holdersAhead = waiting.length
      ? await this.concurrency
          .holdersAhead(waiting.map((view) => view.id))
          .catch(() => new Map<string, string[]>())
      : new Map<string, string[]>();
    for (const view of waiting) {
      const ahead = holdersAhead.get(view.id);
      if (ahead && view.queue)
        view.queue = { ...view.queue, ahead: ahead.length };
    }
    const sources = new Map(rows.map((row) => [row.id, row]));
    const capacities = new Map<
      string,
      { limit: number | null; running: number } | null
    >();
    for (const view of views) {
      if (view.queue?.stage !== 'waiting' && !readVideoServerAhead(view))
        continue;
      const row = sources.get(view.id);
      if (!row?.providerId || !row.model) continue;
      const key = `${row.providerId}:${row.model}`;
      if (!capacities.has(key))
        capacities.set(
          key,
          await this.concurrency
            .capacity({ providerId: row.providerId, model: row.model })
            .catch(() => null),
        );
      const capacity = capacities.get(key);
      if (capacity)
        view.capacity = {
          channels: capacity.limit ?? 1,
          busy: capacity.limit === null ? 0 : capacity.running,
        };
    }
    await this.attachWaitEstimates(views, sources, holdersAhead);
    return views;
  }

  /**
   * @description 给还没结束的任务补实测耗时，给排队中的任务补前方人数与预计等待；读负载失败时跳过，界面退回按任务数估算。
   * @keyword-cn 补排队估时, 前方人数
   * @keyword-en attach-wait-estimates, people-ahead
   * @param views 调用视图。
   * @param sources 调用 ID → 调用记录。
   * @param holdersAhead 平台排队里各任务前面的任务 ID。
   * @returns {Promise<void>}
   */
  private async attachWaitEstimates(
    views: DouyinOperationView[],
    sources: Map<string, DouyinOperationEntity>,
    holdersAhead: Map<string, string[]>,
  ): Promise<void> {
    const loads = new Map<string, DouyinVideoModelLoad | null>();
    const now = Date.now();
    for (const view of views) {
      if (!['queued', 'running'].includes(view.status)) continue;
      const row = sources.get(view.id);
      if (!row?.providerId || !row.model) continue;
      const key = `${row.providerId}:${row.model}`;
      if (!loads.has(key))
        loads.set(
          key,
          await this.readModelLoad(row.providerId, row.model).catch(() => null),
        );
      const load = loads.get(key);
      if (!load) continue;
      if (load.taskSeconds) view.typicalSeconds = load.taskSeconds;
      const platformAhead =
        view.queue?.stage === 'waiting' ? holdersAhead.get(view.id) : undefined;
      const serverAhead = readVideoServerAhead(view);
      if (!platformAhead && !serverAhead) continue;
      const owners = platformAhead
        ? this.ownersOfHolders(platformAhead, load)
        : this.ownersAheadOnServer(serverAhead, load);
      const running = load.active
        .filter(
          (item) =>
            isOccupyingVideoModel(item) &&
            item.status === 'running' &&
            !item.queue &&
            !readVideoServerAhead(item),
        )
        .map(
          (item) =>
            (now - new Date(item.startedAt ?? item.createdAt).getTime()) / 1000,
        );
      // 占着名额但还没开跑的（提交中、GPU 上排队）按刚开始算；GPU 上排着队说明前面至少有一个在跑
      const occupied = platformAhead ? Number(view.capacity?.busy) || 0 : 1;
      while (running.length < occupied) running.push(0);
      const { people, mine } = countPeopleAhead(owners, row.userId);
      view.wait = {
        aheadPeople: people,
        aheadMine: mine,
        aheadTasks: owners.length,
        waitSeconds: estimateVideoWaitSeconds({
          ahead: owners.length,
          channels: view.capacity?.channels ?? 1,
          runningElapsed: running,
          taskSeconds: load.taskSeconds ?? DOUYIN_VIDEO_DEFAULT_TASK_SECONDS,
        }),
      };
    }
  }

  /**
   * @description 读取模型当前负载：还没结束的任务与实测单任务耗时。
   * @keyword-cn 读取模型负载, 在跑任务
   * @keyword-en read-model-load, active-tasks
   * @param providerId 提供商 ID。
   * @param model 模型。
   * @returns {Promise<DouyinVideoModelLoad>} 负载。
   */
  private async readModelLoad(
    providerId: string,
    model: string,
  ): Promise<DouyinVideoModelLoad> {
    const [active, taskSeconds] = await Promise.all([
      this.operations
        .find(
          { providerId, model, status: { $in: ['queued', 'running'] } },
          {
            projection: {
              id: 1,
              userId: 1,
              provider: 1,
              status: 1,
              queue: 1,
              lipSync: 1,
              startedAt: 1,
              createdAt: 1,
              'result.queue_position': 1,
            },
          },
        )
        .limit(500)
        .toArray(),
      this.readTaskSeconds(providerId, model),
    ]);
    return { active, taskSeconds };
  }

  /**
   * @description 读取模型的实测单任务耗时：取最近 20 条完成记录的中位数，对口型的段含另一个模型的时间，不计入；结果缓存一分钟。
   * @keyword-cn 读取实测耗时, 最近完成任务
   * @keyword-en read-task-seconds, recent-completed-tasks
   * @param providerId 提供商 ID。
   * @param model 模型。
   * @returns {Promise<number|null>} 秒数，样本不足时为 null。
   */
  private async readTaskSeconds(
    providerId: string,
    model: string,
  ): Promise<number | null> {
    const key = `${providerId}:${model}`;
    const cached = this.taskSecondsCache.get(key);
    if (cached && Date.now() - cached.at < DOUYIN_VIDEO_TASK_SECONDS_CACHE_MS)
      return cached.value;
    const samples = await this.operations
      .find(
        {
          providerId,
          model,
          status: 'completed',
          startedAt: { $exists: true },
          lipSync: { $exists: false },
        },
        { projection: { startedAt: 1, updatedAt: 1 } },
      )
      .sort({ updatedAt: -1 })
      .limit(20)
      .toArray();
    const value = medianTaskSeconds(samples);
    this.taskSecondsCache.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * @description 把平台排队里前面的任务换成用户 ID，查不到归属的留空。
   * @keyword-cn 任务归属用户, 平台排队
   * @keyword-en owners-of-holders, platform-queue
   * @param holders 前面的任务 ID。
   * @param load 模型负载。
   * @returns {Array<string|undefined>} 各任务的用户 ID。
   */
  private ownersOfHolders(
    holders: string[],
    load: DouyinVideoModelLoad,
  ): Array<string | undefined> {
    const owners = new Map(load.active.map((item) => [item.id, item.userId]));
    return holders.map((holder) => owners.get(holder));
  }

  /**
   * @description 找 GPU 队列里排在前面的任务的用户：服务器位置 N 表示前面还排着 N-1 个（另有一个在跑），不是本平台提交的留空。
   * @keyword-cn GPU前方任务, 服务器排队归属
   * @keyword-en owners-ahead-on-server, gpu-queue-owners
   * @param position 当前任务的服务器排队位置。
   * @param load 模型负载。
   * @returns {Array<string|undefined>} 前面各任务的用户 ID。
   */
  private ownersAheadOnServer(
    position: number,
    load: DouyinVideoModelLoad,
  ): Array<string | undefined> {
    const total = Math.max(0, position - 1);
    const known = load.active
      .filter((item) => {
        const ahead = readVideoServerAhead(item);
        return ahead > 0 && ahead < position;
      })
      .slice(0, total)
      .map((item) => item.userId as string | undefined);
    return [
      ...known,
      ...Array<undefined>(total - known.length).fill(undefined),
    ];
  }

  /**
   * @description 名额空出来后提交一条排队记录：原子认领为 `submitting`，读当前脚本、按记录的提供商与模型重建运行配置，交回通道提交；
   *   通道提交前就报错（脚本删了、提供商停用、分段改了等）时把记录判失败。
   * @keyword-cn 提交排队视频, 重建运行配置
   * @keyword-en dispatch-queued-video, rebuild-runtime
   * @param holder 调用记录 ID。
   * @returns {Promise<boolean>} 已提交给模型时为 true，名额继续占着。
   */
  async dispatch(holder: string): Promise<boolean> {
    const now = new Date();
    const row = await this.operations.findOneAndUpdate(
      { id: holder, status: 'queued', 'queue.stage': 'waiting' },
      {
        $set: {
          'queue.stage': 'submitting',
          'queue.submittingAt': now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (!row) return false;
    const route: DouyinVideoQueueRoute =
      row.mode === 'store-visit'
        ? 'store-visit'
        : (row.provider as DouyinVideoQueueRoute);
    try {
      const submitter = this.submitters.get(route);
      if (!submitter) throw new Error(`排队任务的通道 ${route} 不可用`);
      const scope = { userId: row.userId, tenantId: row.tenantId };
      const topic = await this.repository.get(row.topicId, scope);
      if (!topic) throw new Error('脚本已删除');
      const runtime = await this.readRuntime(row);
      await submitter({ row, topic, runtime, scope });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failQueued(row.id, `排队后提交失败：${message}`, message);
    }
    const latest = await this.operations.findOne({ id: holder });
    return Boolean(latest && !latest.queue && isOccupyingVideoModel(latest));
  }

  /**
   * @description 告诉名额登记哪些任务还占着模型：查得到的记录按 `isOccupyingVideoModel` 判断，查不到的不放进结果。
   * @keyword-cn 查询占用状态, 回收名额依据
   * @keyword-en inspect-occupying, reclaim-basis
   * @param holders 调用记录 ID。
   * @returns {Promise<Map<string, boolean>>} ID → 是否仍占着模型。
   */
  async inspect(holders: string[]): Promise<Map<string, boolean>> {
    const rows = await this.operations
      .find(
        { id: { $in: holders } },
        { projection: { id: 1, status: 1, lipSync: 1 } },
      )
      .toArray();
    return new Map(rows.map((row) => [row.id, isOccupyingVideoModel(row)]));
  }

  /**
   * @description 巡检：提交中超过 10 分钟没写回的记录判为提交中断并归还名额；还在等的记录补回排队登记（派发中途退出时会丢）。
   * @keyword-cn 排队巡检, 提交中断
   * @keyword-en recover-queued-operations, submit-interrupted
   */
  async recover(): Promise<void> {
    try {
      const stale = await this.operations
        .find({
          status: 'queued',
          'queue.stage': 'submitting',
          'queue.submittingAt': {
            $lt: new Date(Date.now() - DOUYIN_VIDEO_QUEUE_SUBMIT_STALE_MS),
          },
        })
        .limit(50)
        .toArray();
      for (const row of stale) {
        await this.failQueued(
          row.id,
          '排队后提交时服务中断，不确定模型是否收到，请重新生成',
        );
        await this.release(row.id);
      }
      const waiting = await this.operations
        .find({ status: 'queued', 'queue.stage': 'waiting' })
        .limit(500)
        .toArray();
      for (const row of waiting) {
        if (!row.providerId || !row.model || !row.queue) continue;
        await this.concurrency.ensureWaiting(
          DOUYIN_VIDEO_QUEUE_KIND,
          { providerId: row.providerId, model: row.model },
          row.id,
          new Date(row.queue.enqueuedAt),
        );
      }
    } catch (error) {
      this.logger.warn(
        `[recover] 排队巡检失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * @description 按记录的提供商 ID 与模型重建运行配置（不跟着节点设置变，排队时用哪个模型就提交给哪个）。
   * @keyword-cn 重建运行配置, 按记录取Key
   * @keyword-en rebuild-runtime, key-from-provider
   * @param row 排队记录。
   * @returns {Promise<WorkflowNodeRuntime>} 运行配置。
   */
  private async readRuntime(
    row: DouyinOperationEntity,
  ): Promise<WorkflowNodeRuntime> {
    const provider = row.providerId
      ? await this.adminService.getAiProviderRuntimeById(row.providerId)
      : null;
    if (!provider || !row.model)
      throw new Error('排队时用的提供商已删除或停用');
    return {
      providerId: provider.providerId,
      providerCode: provider.providerCode,
      providerName: provider.name,
      model: row.model,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      tokensPerCredit: provider.tokensPerCredit,
      fixedTokensPerCall: provider.fixedTokensPerCall,
    };
  }

  /**
   * @description 把仍带排队字段的记录判失败（通道已经自己写过结果的不动）。
   * @keyword-cn 排队记录失败, 失败原因
   * @keyword-en fail-queued-operation, failure-reason
   * @param id 调用记录 ID。
   * @param message 中文说明。
   * @param detail 原始信息。
   */
  private async failQueued(
    id: string,
    message: string,
    detail?: string,
  ): Promise<void> {
    await this.operations.updateOne(
      { id, queue: { $exists: true } },
      {
        $set: {
          status: 'failed',
          error: message.slice(0, 500),
          ...(detail ? { errorDetail: detail.slice(0, 2000) } : {}),
          updatedAt: new Date(),
        },
        $unset: { queue: '' },
      },
    );
  }
}
