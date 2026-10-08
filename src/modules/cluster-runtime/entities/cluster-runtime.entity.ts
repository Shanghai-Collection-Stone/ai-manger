/**
 * @description 进程间消息信封：`type` 为点号分段的消息名；`target` 只在 worker 发给主进程转发时使用；
 *   `requestId` 用于请求 / 应答配对。
 * @keyword-cn 进程间消息, 消息信封
 * @keyword-en cluster-envelope, ipc-message
 */
export interface ClusterEnvelope {
  type: string;
  payload?: unknown;
  requestId?: string;
  target?: 'leader' | 'all';
}

/**
 * @description 主进程上的消息处理器：认领一组消息名，处理 worker 发来的消息；worker 退出时回收它占用的资源。
 * @keyword-cn 主进程消息处理, worker退出回收
 * @keyword-en primary-message-handler, worker-exit-cleanup
 */
export interface ClusterPrimaryHandler {
  /** 认领的消息名前缀，例如 `generation-queue.` */
  prefix: string;
  handle(
    envelope: ClusterEnvelope,
    workerId: number,
    api: ClusterPrimaryApi,
  ): void;
  onWorkerExit?(workerId: number, api: ClusterPrimaryApi): void;
}

/**
 * @description 主进程处理器可用的发送能力：发给指定 worker、应答某个请求。
 * @keyword-cn 主进程发送能力, 请求应答
 * @keyword-en primary-send-api, request-reply
 */
export interface ClusterPrimaryApi {
  send(workerId: number, envelope: ClusterEnvelope): void;
  reply(workerId: number, requestId: string, payload: unknown): void;
}

/**
 * @description 进程角色：`leader` 负责 gRPC 长连接与全部后台定时任务，`follower` 只处理 HTTP 请求；未开多进程时视为 leader。
 * @keyword-cn 进程角色, 主工作进程
 * @keyword-en cluster-role, leader-worker
 */
export type ClusterRole = 'leader' | 'follower';

/**
 * @description 进程角色与序号的环境变量名，由主进程派生 worker 时写入。
 * @keyword-cn 进程角色环境变量, worker序号
 * @keyword-en cluster-role-env, worker-index-env
 */
export const CLUSTER_ENV = {
  workers: 'CLUSTER_WORKERS',
  role: 'CLUSTER_ROLE',
  index: 'CLUSTER_WORKER_INDEX',
  /** 实际派生的 worker 总数（内存不够时可能少于配置），sharp 按它分线程 */
  total: 'CLUSTER_WORKER_TOTAL',
} as const;

/**
 * @description 多进程内存规划：预算及来源（配置 / 容器上限 / 整机一半）、配置与实际的 worker 数、每个 worker 的堆上限与 RSS 告警线。
 * @keyword-cn 内存预算规划, 堆上限计算
 * @keyword-en memory-budget-plan, heap-limit-calc
 */
export interface ClusterMemoryPlan {
  budgetMb: number;
  source: 'env' | 'container' | 'host';
  requestedWorkers: number;
  workers: number;
  heapMbPerWorker: number;
  rssWarnMbPerWorker: number;
}

/**
 * @description worker 上报给主进程的内存用量（单位 MB）。
 * @keyword-cn 内存用量上报, 内存监控
 * @keyword-en memory-usage-report, memory-monitoring
 */
export interface ClusterMemoryReport {
  index: number;
  role: ClusterRole;
  rssMb: number;
  heapUsedMb: number;
  heapLimitMb: number;
  externalMb: number;
  arrayBuffersMb: number;
}

/**
 * @description 主进程对请求的应答消息名。
 * @keyword-cn 请求应答消息, 进程间应答
 * @keyword-en request-reply-message, ipc-reply
 */
export const CLUSTER_REPLY_TYPE = 'cluster-runtime.request.reply';
