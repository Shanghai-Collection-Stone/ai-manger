import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  onClusterMessage,
  requestPrimary,
  sendClusterMessage,
} from '../../cluster-runtime/services/cluster-ipc.js';
import { isClusterWorker } from '../../cluster-runtime/services/cluster-role.js';
import {
  GENERATION_QUEUE_FALLBACK_LIMITS,
  GENERATION_QUEUE_MESSAGES,
  type GenerationQueueLimitResolver,
  type GenerationQueueLimits,
  type GenerationQueueSnapshot,
  type GenerationQueueTicket,
} from '../entities/generation-queue.entity.js';
import { GenerationQueueCore } from './generation-queue-core.js';

/**
 * @description AI 生成异步排队服务。每个业务注册一条通道（如小红书文章、抖音生成），各自读取全平台与租户两级并发上限；
 *   超出上限的任务按先进先出等待，同一租户占满时后面其他租户的任务可以先执行。单进程时登记簿在本进程；
 *   多进程时登记簿只在主进程一份，所有 worker 经 IPC 申请 / 归还名额与查询状态，全平台上限对全部进程生效。
 * @keyword-cn AI生成排队, 全平台并发上限, 租户并发上限
 * @keyword-en generation-queue, global-concurrency-limit, tenant-concurrency-limit
 */
@Injectable()
export class GenerationQueueService {
  private readonly logger = new Logger(GenerationQueueService.name);
  private readonly resolvers = new Map<string, GenerationQueueLimitResolver>();
  /** 单进程时的本地登记簿；多进程 worker 不使用 */
  private readonly core = new GenerationQueueCore();
  /** 等待主进程或本地登记簿分配名额的票据 */
  private readonly pendingGrants = new Map<string, () => void>();
  /** 串行化申请，保证同一进程内按调用顺序进入队列 */
  private enqueueTail: Promise<void> = Promise.resolve();
  private readonly clustered = isClusterWorker();

  constructor() {
    if (this.clustered) {
      onClusterMessage(GENERATION_QUEUE_MESSAGES.grant, (payload) => {
        const ticketId = String((payload as { ticketId?: unknown }).ticketId);
        this.pendingGrants.get(ticketId)?.();
      });
    }
  }

  /**
   * @description 注册一条生成通道及其并发上限读取函数；重复注册只更新读取函数，不影响已在执行或排队的任务。
   * @keyword-cn 注册生成通道, 并发上限读取
   * @keyword-en register-generation-lane, limits-resolver
   * @param lane 通道名，如 `xhs-article`。
   * @param resolveLimits 按租户读取上限的函数。
   */
  registerLane(
    lane: string,
    resolveLimits: GenerationQueueLimitResolver,
  ): void {
    this.resolvers.set(lane, resolveLimits);
  }

  /**
   * @description 申请一个执行名额：有空位立即拿到，否则排队等待；返回的释放函数必须在任务结束时调用（重复调用无副作用）。
   * @keyword-cn 申请执行名额, 排队等待
   * @keyword-en acquire-generation-slot, wait-in-queue
   * @param lane 已注册的通道名。
   * @param tenantId 任务所属租户，平台作用域为空。
   * @param key 可选业务键，用于跨进程查询任务是否还在排队 / 执行。
   * @returns {Promise<() => void>} 释放名额的函数。
   * @throws {Error} 通道未注册时抛出 `GENERATION_QUEUE_LANE_NOT_REGISTERED:<lane>`。
   */
  acquire(lane: string, tenantId?: string, key?: string): Promise<() => void> {
    this.requireLane(lane);
    const ticket: GenerationQueueTicket = {
      ticketId: randomUUID(),
      lane,
      tenantKey: this.tenantKeyOf(tenantId),
      ...(key ? { key } : {}),
    };
    return new Promise((resolve) => {
      this.pendingGrants.set(ticket.ticketId, () => {
        this.pendingGrants.delete(ticket.ticketId);
        resolve(this.createRelease(ticket.ticketId));
      });
      this.enqueueTail = this.enqueueTail
        .then(async () => {
          const limits = await this.readLimits(lane, tenantId);
          if (this.clustered) {
            sendClusterMessage({
              type: GENERATION_QUEUE_MESSAGES.acquire,
              payload: { ...ticket, limits },
            });
            return;
          }
          this.grantLocal(this.core.enqueue(ticket, limits));
        })
        .catch((error) => {
          this.logger.error(
            `[acquire] lane=${lane} 入队失败: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    });
  }

  /**
   * @description 排队拿到名额后执行任务，任务结束（成功或失败）自动释放名额。
   * @keyword-cn 排队执行任务, 自动释放名额
   * @keyword-en run-in-queue, auto-release-slot
   * @param lane 已注册的通道名。
   * @param tenantId 任务所属租户。
   * @param task 拿到名额后执行的任务。
   * @param key 可选业务键。
   * @returns {Promise<T>} 任务结果。
   */
  async run<T>(
    lane: string,
    tenantId: string | undefined,
    task: () => Promise<T>,
    key?: string,
  ): Promise<T> {
    const release = await this.acquire(lane, tenantId, key);
    try {
      return await task();
    } finally {
      release();
    }
  }

  /**
   * @description 按最新上限重新分配名额：读取该租户（与全平台）当前上限后上报。后台调高上限后，
   *   业务的状态轮询调一次即可让排队任务补上空位，不必等正在执行的任务结束。
   * @keyword-cn 重新分配名额, 上限调整生效
   * @keyword-en redistribute-slots, apply-new-limits
   * @param lane 通道名，未注册时忽略。
   * @param tenantId 发起轮询的租户。
   */
  requestDrain(lane: string, tenantId?: string): void {
    if (!this.resolvers.has(lane)) return;
    void this.readLimits(lane, tenantId)
      .then((limits) => {
        const tenantKey = this.tenantKeyOf(tenantId);
        if (this.clustered) {
          sendClusterMessage({
            type: GENERATION_QUEUE_MESSAGES.updateLimits,
            payload: { lane, tenantKey, limits },
          });
          return;
        }
        this.grantLocal(this.core.updateLimits(lane, tenantKey, limits));
      })
      .catch((error) => {
        this.logger.warn(
          `[drain] lane=${lane} 上报上限失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * @description 查询业务键当前状态（全部进程范围内）：排队中、执行中或不在队列里。
   * @keyword-cn 查询业务键状态, 跨进程存活确认
   * @keyword-en query-key-state, cross-process-liveness
   * @param lane 通道名。
   * @param key 业务键。
   * @returns {Promise<'queued'|'running'|null>} 状态。
   */
  async activeState(
    lane: string,
    key: string,
  ): Promise<'queued' | 'running' | null> {
    if (!this.clustered) return this.core.stateOf(lane, key);
    const reply = await requestPrimary<{ state: 'queued' | 'running' | null }>(
      GENERATION_QUEUE_MESSAGES.queryState,
      { lane, key },
    );
    return reply.state;
  }

  /**
   * @description 列出通道里排队与执行中的全部业务键（全部进程范围内）。
   * @keyword-cn 列出活跃业务键, 跨进程存活确认
   * @keyword-en list-active-keys, cross-process-liveness
   * @param lane 通道名。
   * @returns {Promise<string[]>} 业务键。
   */
  async activeKeys(lane: string): Promise<string[]> {
    if (!this.clustered) return this.core.activeKeys(lane);
    const reply = await requestPrimary<{ keys: string[] }>(
      GENERATION_QUEUE_MESSAGES.queryKeys,
      { lane },
    );
    return reply.keys;
  }

  /**
   * @description 读取通道当前执行与等待数量（全部进程范围内）。
   * @keyword-cn 队列快照, 排队数量
   * @keyword-en queue-snapshot, waiting-count
   * @param lane 通道名。
   * @returns {Promise<GenerationQueueSnapshot>} 执行数与等待数。
   */
  async snapshot(lane: string): Promise<GenerationQueueSnapshot> {
    if (!this.clustered) return this.core.snapshot(lane);
    return await requestPrimary<GenerationQueueSnapshot>(
      GENERATION_QUEUE_MESSAGES.querySnapshot,
      { lane },
    );
  }

  /**
   * @description 生成只生效一次的释放函数：归还名额后由登记簿继续分配。
   * @keyword-cn 释放执行名额, 幂等释放
   * @keyword-en release-generation-slot, idempotent-release
   */
  private createRelease(ticketId: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.clustered) {
        sendClusterMessage({
          type: GENERATION_QUEUE_MESSAGES.release,
          payload: { ticketId },
        });
        return;
      }
      this.grantLocal(this.core.release(ticketId));
    };
  }

  /**
   * @description 单进程时把本地登记簿新分配的票据交给等待中的申请。
   * @keyword-cn 本地分配通知, 放行等待申请
   * @keyword-en grant-local-tickets, resolve-waiting-acquire
   */
  private grantLocal(granted: GenerationQueueTicket[]): void {
    for (const ticket of granted) this.pendingGrants.get(ticket.ticketId)?.();
  }

  /**
   * @description 读取并规整上限（至少为 1）；读取失败时记警告并用保底值，通道不停摆。
   * @keyword-cn 读取并发上限, 读取失败回退
   * @keyword-en read-concurrency-limits, resolver-failure-fallback
   */
  private async readLimits(
    lane: string,
    tenantId?: string,
  ): Promise<GenerationQueueLimits> {
    try {
      const limits = await this.requireLane(lane)(tenantId);
      return {
        globalLimit: Math.max(1, Math.floor(Number(limits.globalLimit) || 1)),
        tenantLimit: Math.max(1, Math.floor(Number(limits.tenantLimit) || 1)),
      };
    } catch (error) {
      this.logger.warn(
        `[limits] lane=${lane} tenant=${tenantId ?? '-'} 读取失败，使用保底上限: ${error instanceof Error ? error.message : String(error)}`,
      );
      return GENERATION_QUEUE_FALLBACK_LIMITS;
    }
  }

  /**
   * @description 租户键：平台作用域统一为 `__platform__`。
   * @keyword-cn 租户键, 平台作用域
   * @keyword-en tenant-key, platform-scope
   */
  private tenantKeyOf(tenantId?: string): string {
    return String(tenantId ?? '').trim() || '__platform__';
  }

  /**
   * @description 读取已注册通道的上限读取函数，未注册直接报错，避免任务悄悄绕过并发控制。
   * @keyword-cn 读取生成通道, 未注册报错
   * @keyword-en require-generation-lane, unregistered-lane-error
   */
  private requireLane(lane: string): GenerationQueueLimitResolver {
    const resolver = this.resolvers.get(lane);
    if (!resolver) {
      throw new Error(`GENERATION_QUEUE_LANE_NOT_REGISTERED:${lane}`);
    }
    return resolver;
  }
}
