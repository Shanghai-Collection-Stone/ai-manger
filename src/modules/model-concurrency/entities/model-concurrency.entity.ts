import type { ObjectId } from 'mongodb';

/**
 * @description 并发上限设置（集合 `model_concurrency_limits`）：按「提供商 + 模型」保存全平台共用的并发上限，
 *   所有租户、所有工作流用到这个模型都算在里面；没有记录表示不限。
 * @keyword-cn 模型并发上限, 全平台共用
 * @keyword-en model-concurrency-limit, platform-wide-limit
 */
export interface ModelConcurrencyLimitEntity {
  _id?: ObjectId;
  providerId: string;
  model: string;
  limit: number;
  updatedAt: Date;
  updatedBy?: string;
}

/**
 * @description 名额（集合 `model_concurrency_slots`）：一条代表一个已经提交给模型、还没结束的任务。
 *   有上限时 `slot` 是 `0`～`上限-1` 的序号，靠 `key + slot` 唯一索引保证多进程同时申请也不会超额；
 *   不限时写 `free:<holder>`，只用来统计正在跑的数量。
 * @keyword-cn 模型名额, 名额登记
 * @keyword-en model-slot, slot-ledger
 */
export interface ModelConcurrencySlotEntity {
  _id?: ObjectId;
  key: string;
  slot: string;
  holder: string;
  kind: string;
  acquiredAt: Date;
}

/**
 * @description 排队（集合 `model_concurrency_waiters`）：名额满时登记的任务，按 `enqueuedAt` 先来先到。
 * @keyword-cn 模型排队, 先来先到
 * @keyword-en model-waiter, fifo-order
 */
export interface ModelConcurrencyWaiterEntity {
  _id?: ObjectId;
  key: string;
  holder: string;
  kind: string;
  providerId: string;
  model: string;
  enqueuedAt: Date;
}

/**
 * @description 要限并发的模型：提供商记录 ID + 模型编码。
 * @keyword-cn 限流模型, 提供商模型
 * @keyword-en concurrency-target, provider-model
 */
export interface ModelConcurrencyTarget {
  providerId: string;
  model: string;
}

/**
 * @description 业务注册的任务种类：名额空出来时由它提交排队的任务，并告诉名额登记哪些任务还占着模型。
 * @keyword-cn 排队任务种类, 业务提交回调
 * @keyword-en concurrency-kind, dispatch-handler
 */
export interface ModelConcurrencyKind {
  /** 拿到名额后提交排队的任务；返回 false 表示任务已不需要提交（已取消、已失败），名额立即归还 */
  dispatch(holder: string): Promise<boolean>;
  /** 查询任务状态：true 仍占着模型，false 已结束；查不到的任务不放进结果 */
  inspect(holders: string[]): Promise<Map<string, boolean>>;
}

/**
 * @description 后台看到的一个模型的并发情况。
 * @keyword-cn 模型并发概览, 排队数量
 * @keyword-en model-concurrency-usage, waiting-count
 */
export interface ModelConcurrencyUsage {
  providerId: string;
  model: string;
  /** null 表示不限 */
  limit: number | null;
  running: number;
  waiting: number;
}

/**
 * @description 主进程检查名额与排队的间隔（毫秒）。
 * @keyword-cn 排队检查间隔, 派发周期
 * @keyword-en model-concurrency-tick-ms, dispatch-interval
 */
export const MODEL_CONCURRENCY_TICK_MS = 5000;

/**
 * @description 刚拿到名额、业务记录还没写好的保护期（毫秒）：查不到任务的名额超过这么久才回收。
 * @keyword-cn 名额保护期, 提交中保护
 * @keyword-en slot-grace-ms, submitting-grace
 */
export const MODEL_CONCURRENCY_SLOT_GRACE_MS = 10 * 60 * 1000;

/**
 * @description 后台能设的最大并发上限。
 * @keyword-cn 并发上限最大值, 上限校验
 * @keyword-en max-concurrency-limit, limit-validation
 */
export const MODEL_CONCURRENCY_MAX_LIMIT = 100;
