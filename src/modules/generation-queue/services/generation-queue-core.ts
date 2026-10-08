import {
  GENERATION_QUEUE_FALLBACK_LIMITS,
  type GenerationQueueLimits,
  type GenerationQueueSnapshot,
  type GenerationQueueTicket,
} from '../entities/generation-queue.entity.js';

type CoreLane = {
  globalLimit: number;
  tenantLimits: Map<string, number>;
  waiting: GenerationQueueTicket[];
  running: Map<string, GenerationQueueTicket>;
  tenantRunning: Map<string, number>;
};

/**
 * @description 生成排队的登记簿与分配算法（纯同步、不含 IO）：记录每条通道的等待与执行票据、最近上报的上限，
 *   按先进先出分配名额。单进程时由 `GenerationQueueService` 直接持有；多进程时只在主进程里有一份，所有 worker 经 IPC 共用。
 * @keyword-cn 排队登记簿, 名额分配算法
 * @keyword-en queue-registry, slot-allocation
 */
export class GenerationQueueCore {
  private readonly lanes = new Map<string, CoreLane>();

  /**
   * @description 登记一张等待票据并记下它带来的最新上限，然后尝试分配。
   * @keyword-cn 登记等待票据, 上报上限
   * @keyword-en enqueue-ticket, report-limits
   * @param ticket 票据。
   * @param limits 申请方按租户读到的上限。
   * @returns {GenerationQueueTicket[]} 本次新拿到名额的票据。
   */
  enqueue(
    ticket: GenerationQueueTicket,
    limits: GenerationQueueLimits,
  ): GenerationQueueTicket[] {
    const lane = this.lane(ticket.lane);
    this.applyLimits(lane, ticket.tenantKey, limits);
    lane.waiting.push(ticket);
    return this.drain(lane);
  }

  /**
   * @description 更新某租户的上限（后台改了配置后由状态轮询上报），然后尝试分配。
   * @keyword-cn 更新并发上限, 上限调整生效
   * @keyword-en update-lane-limits, apply-new-limits
   * @param laneName 通道名。
   * @param tenantKey 租户键。
   * @param limits 最新上限。
   * @returns {GenerationQueueTicket[]} 本次新拿到名额的票据。
   */
  updateLimits(
    laneName: string,
    tenantKey: string,
    limits: GenerationQueueLimits,
  ): GenerationQueueTicket[] {
    const lane = this.lane(laneName);
    this.applyLimits(lane, tenantKey, limits);
    return this.drain(lane);
  }

  /**
   * @description 归还一张票据的名额（执行中）或撤掉它（还在等待），然后尝试分配；重复归还无副作用。
   * @keyword-cn 归还名额, 撤销等待票据
   * @keyword-en release-ticket, cancel-waiting-ticket
   * @param ticketId 票据 ID。
   * @returns {GenerationQueueTicket[]} 本次新拿到名额的票据。
   */
  release(ticketId: string): GenerationQueueTicket[] {
    const granted: GenerationQueueTicket[] = [];
    for (const lane of this.lanes.values()) {
      if (this.removeTicket(lane, (ticket) => ticket.ticketId === ticketId)) {
        granted.push(...this.drain(lane));
      }
    }
    return granted;
  }

  /**
   * @description 归还某个进程持有的全部票据（该 worker 退出时调用），然后尝试分配。
   * @keyword-cn 回收进程名额, worker退出回收
   * @keyword-en release-owner-tickets, worker-exit-cleanup
   * @param owner 持有者（worker ID）。
   * @returns {GenerationQueueTicket[]} 本次新拿到名额的票据。
   */
  releaseOwner(owner: number): GenerationQueueTicket[] {
    const granted: GenerationQueueTicket[] = [];
    for (const lane of this.lanes.values()) {
      if (this.removeTicket(lane, (ticket) => ticket.owner === owner)) {
        granted.push(...this.drain(lane));
      }
    }
    return granted;
  }

  /**
   * @description 查询某个业务键（如文章 `租户:子选题`、抖音任务 ID）当前是排队中、执行中还是不在队列里。
   * @keyword-cn 查询业务键状态, 跨进程存活确认
   * @keyword-en query-key-state, cross-process-liveness
   * @param laneName 通道名。
   * @param key 业务键。
   * @returns {'queued'|'running'|null} 状态。
   */
  stateOf(laneName: string, key: string): 'queued' | 'running' | null {
    const lane = this.lanes.get(laneName);
    if (!lane) return null;
    for (const ticket of lane.running.values()) {
      if (ticket.key === key) return 'running';
    }
    return lane.waiting.some((ticket) => ticket.key === key) ? 'queued' : null;
  }

  /**
   * @description 列出通道里排队与执行中的全部业务键。
   * @keyword-cn 列出活跃业务键, 跨进程存活确认
   * @keyword-en list-active-keys, cross-process-liveness
   * @param laneName 通道名。
   * @returns {string[]} 业务键。
   */
  activeKeys(laneName: string): string[] {
    const lane = this.lanes.get(laneName);
    if (!lane) return [];
    return [...lane.running.values(), ...lane.waiting]
      .map((ticket) => ticket.key)
      .filter((key): key is string => Boolean(key));
  }

  /**
   * @description 读取通道执行数与等待数。
   * @keyword-cn 队列快照, 排队数量
   * @keyword-en queue-snapshot, waiting-count
   * @param laneName 通道名。
   * @returns {GenerationQueueSnapshot} 快照。
   */
  snapshot(laneName: string): GenerationQueueSnapshot {
    const lane = this.lanes.get(laneName);
    return {
      running: lane?.running.size ?? 0,
      waiting: lane?.waiting.length ?? 0,
    };
  }

  /**
   * @description 先进先出分配：全平台执行数达到上限即停；某租户达到租户上限就跳过它，看后面其他租户的票据。
   * @keyword-cn 分配执行名额, 先进先出
   * @keyword-en drain-generation-queue, fifo-order
   */
  private drain(lane: CoreLane): GenerationQueueTicket[] {
    const granted: GenerationQueueTicket[] = [];
    let index = 0;
    while (index < lane.waiting.length) {
      if (lane.running.size >= lane.globalLimit) break;
      const ticket = lane.waiting[index];
      const tenantLimit =
        lane.tenantLimits.get(ticket.tenantKey) ??
        GENERATION_QUEUE_FALLBACK_LIMITS.tenantLimit;
      const tenantRunning = lane.tenantRunning.get(ticket.tenantKey) ?? 0;
      if (tenantRunning >= tenantLimit) {
        index += 1;
        continue;
      }
      lane.waiting.splice(index, 1);
      lane.running.set(ticket.ticketId, ticket);
      lane.tenantRunning.set(ticket.tenantKey, tenantRunning + 1);
      granted.push(ticket);
    }
    return granted;
  }

  /**
   * @description 从通道里移除符合条件的票据，执行中的同时归还租户计数；返回是否有移除。
   * @keyword-cn 移除票据, 归还租户计数
   * @keyword-en remove-ticket, return-tenant-count
   */
  private removeTicket(
    lane: CoreLane,
    match: (ticket: GenerationQueueTicket) => boolean,
  ): boolean {
    let removed = false;
    for (const [ticketId, ticket] of lane.running) {
      if (!match(ticket)) continue;
      lane.running.delete(ticketId);
      const remaining = (lane.tenantRunning.get(ticket.tenantKey) ?? 1) - 1;
      if (remaining > 0) lane.tenantRunning.set(ticket.tenantKey, remaining);
      else lane.tenantRunning.delete(ticket.tenantKey);
      removed = true;
    }
    const before = lane.waiting.length;
    lane.waiting = lane.waiting.filter((ticket) => !match(ticket));
    return removed || lane.waiting.length !== before;
  }

  /**
   * @description 记下全平台上限与该租户上限，一律规整为不小于 1 的整数。
   * @keyword-cn 记录并发上限, 上限规整
   * @keyword-en apply-limits, normalize-limits
   */
  private applyLimits(
    lane: CoreLane,
    tenantKey: string,
    limits: GenerationQueueLimits,
  ): void {
    lane.globalLimit = Math.max(1, Math.floor(Number(limits.globalLimit) || 1));
    lane.tenantLimits.set(
      tenantKey,
      Math.max(1, Math.floor(Number(limits.tenantLimit) || 1)),
    );
  }

  /**
   * @description 取通道状态，没有就按保底上限新建。
   * @keyword-cn 读取通道状态, 懒创建通道
   * @keyword-en get-core-lane, lazy-create-lane
   */
  private lane(name: string): CoreLane {
    let lane = this.lanes.get(name);
    if (!lane) {
      lane = {
        globalLimit: GENERATION_QUEUE_FALLBACK_LIMITS.globalLimit,
        tenantLimits: new Map(),
        waiting: [],
        running: new Map(),
        tenantRunning: new Map(),
      };
      this.lanes.set(name, lane);
    }
    return lane;
  }
}
