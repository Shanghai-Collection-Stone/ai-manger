/**
 * @description 一条生成通道的并发上限：全平台同时执行数与单个租户同时执行数。
 * @keyword-cn 生成并发上限, 租户并发上限
 * @keyword-en generation-concurrency-limits, tenant-concurrency-limit
 */
export interface GenerationQueueLimits {
  globalLimit: number;
  tenantLimit: number;
}

/**
 * @description 按租户读取通道并发上限的函数，由业务模块在注册通道时提供（通常读后台平台信息与租户配置）。
 * @keyword-cn 并发上限读取, 通道注册
 * @keyword-en limits-resolver, lane-registration
 */
export type GenerationQueueLimitResolver = (
  tenantId?: string,
) => Promise<GenerationQueueLimits>;

/**
 * @description 通道当前的执行与等待数量，供状态接口与日志使用。
 * @keyword-cn 队列快照, 排队数量
 * @keyword-en queue-snapshot, waiting-count
 */
export interface GenerationQueueSnapshot {
  running: number;
  waiting: number;
}

/**
 * @description 一张排队票据：属于哪条通道、哪个租户，可选业务键（用于跨进程查询任务是否还在排队 / 执行）与持有进程。
 * @keyword-cn 排队票据, 业务键
 * @keyword-en queue-ticket, business-key
 */
export interface GenerationQueueTicket {
  ticketId: string;
  lane: string;
  tenantKey: string;
  key?: string;
  /** 多进程时为持有票据的 worker ID，单进程为空 */
  owner?: number;
}

/**
 * @description 生成排队的进程间消息名（`generation-queue.<对象>.<动作>`），由主进程上的处理器认领。
 * @keyword-cn 排队消息名, 进程间消息
 * @keyword-en queue-message-types, ipc-message
 */
export const GENERATION_QUEUE_MESSAGES = {
  acquire: 'generation-queue.slot.acquire',
  grant: 'generation-queue.slot.grant',
  release: 'generation-queue.slot.release',
  updateLimits: 'generation-queue.lane.updateLimits',
  queryState: 'generation-queue.key.queryState',
  queryKeys: 'generation-queue.lane.queryKeys',
  querySnapshot: 'generation-queue.lane.querySnapshot',
} as const;

/**
 * @description 上限读取失败时的保底值，避免后台配置读不到就让整条通道停摆。
 * @keyword-cn 保底并发上限, 读取失败回退
 * @keyword-en fallback-concurrency-limits, resolver-failure-fallback
 */
export const GENERATION_QUEUE_FALLBACK_LIMITS: GenerationQueueLimits = {
  globalLimit: 4,
  tenantLimit: 2,
};
