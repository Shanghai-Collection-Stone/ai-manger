import cluster, { type Worker } from 'node:cluster';
import {
  CLUSTER_ENV,
  CLUSTER_REPLY_TYPE,
  type ClusterEnvelope,
  type ClusterPrimaryApi,
  type ClusterPrimaryHandler,
} from '../entities/cluster-runtime.entity.js';

/**
 * @description worker 意外退出后重新派生前的等待时间，避免崩溃循环把 CPU 打满。
 * @keyword-cn 重新派生延迟, 崩溃退避
 * @keyword-en respawn-delay, crash-backoff
 */
export const CLUSTER_RESPAWN_DELAY_MS = 1_000;

/**
 * @description 一分钟内 worker 意外退出超过这么多次就判定为崩溃循环，主进程退出交给容器重启。
 * @keyword-cn 崩溃循环上限, 容器重启
 * @keyword-en crash-loop-limit, container-restart
 */
export const CLUSTER_CRASH_LOOP_LIMIT = 10;

/**
 * @description 主进程收到停止信号后等待 worker 退出的最长时间。
 * @keyword-cn 优雅退出等待, 停止信号
 * @keyword-en graceful-shutdown-timeout, stop-signal
 */
export const CLUSTER_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * @description 多进程主进程：先跑一次启动前任务（数据库迁移），再派生 N 个 worker（1 号为 leader，其余 follower），
 *   按消息名把 worker 发来的消息交给对应处理器或转发给 leader / 全体；worker 意外退出时回收其资源并按原序号与角色重新派生；
 *   收到 SIGTERM / SIGINT 时通知全部 worker 退出后再退出。主进程本身不加载 Nest 应用、不处理请求。
 *   `workerExecArgv` 追加给每个 worker 的 Node 启动参数（如按内存预算算出的堆上限）。
 * @keyword-cn 多进程主进程, 派生worker, 进程间转发
 * @keyword-en cluster-primary, fork-workers, ipc-routing
 * @param options worker 数、worker 启动参数、启动前任务与主进程消息处理器。
 * @returns {Promise<void>} 派生完成。
 */
export async function runClusterPrimary(options: {
  workers: number;
  workerExecArgv?: string[];
  beforeFork?: () => Promise<void>;
  handlers: ClusterPrimaryHandler[];
}): Promise<void> {
  if (options.beforeFork) await options.beforeFork();
  if (options.workerExecArgv?.length) {
    // 同名参数以这里为准：先剔掉继承来的堆上限，再追加
    cluster.setupPrimary({
      execArgv: [
        ...process.execArgv.filter(
          (arg) => !arg.startsWith('--max-old-space-size'),
        ),
        ...options.workerExecArgv,
      ],
    });
  }
  const indexByWorkerId = new Map<number, number>();
  const workerByIndex = new Map<number, Worker>();
  const recentCrashes: number[] = [];
  let shuttingDown = false;

  const api: ClusterPrimaryApi = {
    send(workerId, envelope) {
      const worker = cluster.workers?.[workerId];
      if (worker?.isConnected()) worker.send(envelope);
    },
    reply(workerId, requestId, payload) {
      api.send(workerId, { type: CLUSTER_REPLY_TYPE, requestId, payload });
    },
  };

  const fork = (index: number): void => {
    const worker = cluster.fork({
      [CLUSTER_ENV.role]: index === 1 ? 'leader' : 'follower',
      [CLUSTER_ENV.index]: String(index),
      [CLUSTER_ENV.total]: String(options.workers),
    });
    indexByWorkerId.set(worker.id, index);
    workerByIndex.set(index, worker);
    worker.on('message', (raw: unknown) =>
      routeMessage(worker.id, raw as ClusterEnvelope),
    );
  };

  const routeMessage = (workerId: number, envelope: ClusterEnvelope): void => {
    if (!envelope || typeof envelope.type !== 'string') return;
    const handler = options.handlers.find((item) =>
      envelope.type.startsWith(item.prefix),
    );
    if (handler) {
      try {
        handler.handle(envelope, workerId, api);
      } catch (error) {
        console.error(
          `[cluster-primary] handler ${envelope.type} failed:`,
          error instanceof Error ? error.message : error,
        );
      }
      return;
    }
    const forwarded: ClusterEnvelope = {
      type: envelope.type,
      payload: envelope.payload,
    };
    if (envelope.target === 'leader') {
      const leader = workerByIndex.get(1);
      if (leader?.isConnected()) leader.send(forwarded);
    } else if (envelope.target === 'all') {
      for (const worker of workerByIndex.values()) {
        if (worker.isConnected()) worker.send(forwarded);
      }
    }
  };

  cluster.on('exit', (worker, code, signal) => {
    const index = indexByWorkerId.get(worker.id);
    indexByWorkerId.delete(worker.id);
    for (const handler of options.handlers) {
      handler.onWorkerExit?.(worker.id, api);
    }
    if (index === undefined || shuttingDown) return;
    if (workerByIndex.get(index) === worker) workerByIndex.delete(index);
    const now = Date.now();
    recentCrashes.push(now);
    while (recentCrashes.length && now - recentCrashes[0] > 60_000) {
      recentCrashes.shift();
    }
    console.error(
      `[cluster-primary] worker #${index} 退出 code=${code} signal=${signal ?? '-'}，${CLUSTER_RESPAWN_DELAY_MS}ms 后重新派生`,
    );
    if (recentCrashes.length > CLUSTER_CRASH_LOOP_LIMIT) {
      console.error(
        '[cluster-primary] worker 反复崩溃，主进程退出交给容器重启',
      );
      process.exit(1);
    }
    setTimeout(() => {
      if (!shuttingDown) fork(index);
    }, CLUSTER_RESPAWN_DELAY_MS);
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cluster-primary] 收到 ${signal}，通知 worker 退出`);
    for (const worker of workerByIndex.values()) worker.kill('SIGTERM');
    const timer = setTimeout(
      () => process.exit(0),
      CLUSTER_SHUTDOWN_TIMEOUT_MS,
    );
    timer.unref();
    const check = setInterval(() => {
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        clearInterval(check);
        process.exit(0);
      }
    }, 200);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  for (let index = 1; index <= options.workers; index += 1) fork(index);
  console.log(
    `[cluster-primary] pid=${process.pid} 已派生 ${options.workers} 个 worker（#1 为 leader）`,
  );
}

/**
 * @description worker 侧：主进程断开（被杀或崩溃）时自行退出，避免留下无人管理的孤儿进程。
 * @keyword-cn 主进程断开退出, 孤儿进程
 * @keyword-en exit-on-primary-disconnect, orphan-worker
 */
export function exitWhenPrimaryGone(): void {
  process.on('disconnect', () => process.exit(0));
}
