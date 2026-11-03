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
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

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
   * @description 把拿不到名额的调用存成排队记录（`status=queued` + `queue.stage=waiting`）；`existing` 为 true 时改写已有记录（探店续段）。
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
   * @description 给一批调用视图补上排队位置（同一模型前面还有几个）。
   * @keyword-cn 补排队位置, 前面还有几个
   * @keyword-en attach-queue-positions, waiting-ahead
   * @param views 调用视图。
   * @returns {Promise<DouyinOperationView[]>} 补好的视图。
   */
  async attachPositions(
    views: DouyinOperationView[],
  ): Promise<DouyinOperationView[]> {
    const waiting = views.filter((view) => view.queue?.stage === 'waiting');
    if (!waiting.length) return views;
    const positions = await this.concurrency
      .positions(waiting.map((view) => view.id))
      .catch(() => new Map<string, number>());
    for (const view of waiting) {
      const ahead = positions.get(view.id);
      if (ahead !== undefined && view.queue)
        view.queue = { ...view.queue, ahead };
    }
    return views;
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
