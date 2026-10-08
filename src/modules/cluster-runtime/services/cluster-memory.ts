import { writeFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';
import {
  CLUSTER_ENV,
  type ClusterMemoryPlan,
  type ClusterMemoryReport,
  type ClusterPrimaryHandler,
} from '../entities/cluster-runtime.entity.js';
import { sendClusterMessage } from './cluster-ipc.js';

const MB = 1024 * 1024;

/**
 * @description 内存预算里分给 V8 堆的比例，其余留给代码、Buffer、sharp/libvips 原生内存与线程栈。
 * @keyword-cn 堆内存占比, 原生内存余量
 * @keyword-en heap-share, native-memory-headroom
 */
export const CLUSTER_HEAP_SHARE = 0.6;

/**
 * @description 没有容器内存上限、也没配置预算时，按整机内存的这个比例算预算（同机还有 Mongo 与其他服务）。
 * @keyword-cn 整机内存占比, 默认内存预算
 * @keyword-en host-memory-share, default-memory-budget
 */
export const CLUSTER_HOST_MEMORY_SHARE = 0.5;

/**
 * @description 每个 worker 堆上限的下限；按预算算出来低于它时自动减少 worker 数，而不是开一堆一跑就 OOM 的进程。
 * @keyword-cn 最小堆上限, 自动减进程
 * @keyword-en min-worker-heap, auto-reduce-workers
 */
export const CLUSTER_MIN_HEAP_MB = 384;

/**
 * @description worker 的 OOM 分值调整：调高后，内存真的耗尽时内核优先杀 worker（主进程会重新派生），而不是主进程或 Mongo。
 * @keyword-cn OOM优先级, 优先杀worker
 * @keyword-en oom-score-adj, kill-worker-first
 */
export const CLUSTER_WORKER_OOM_SCORE_ADJ = 500;

/**
 * @description worker 上报内存的间隔。
 * @keyword-cn 内存上报间隔, 内存监控
 * @keyword-en memory-report-interval, memory-monitoring
 */
export const CLUSTER_MEMORY_REPORT_MS = 30_000;

/**
 * @description 读取正整数环境变量，非法返回 undefined。
 * @keyword-cn 读取整数配置, 环境变量
 * @keyword-en read-int-env, env-config
 */
function readPositiveIntEnv(name: string): number | undefined {
  const value = Math.floor(Number(process.env[name]));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * @description 算内存预算与每个 worker 的堆上限：预算优先取 `CLUSTER_MEMORY_BUDGET_MB`，其次容器内存上限（cgroup），
 *   都没有时取整机内存的一半；堆上限 = 预算 × 0.6 ÷ worker 数，限制在 256–4096MB（`WORKER_MAX_OLD_SPACE_MB` 可直接指定）；
 *   算出来低于 384MB 时自动减少 worker 数。
 * @keyword-cn 内存预算规划, 堆上限计算, 自动减进程
 * @keyword-en memory-budget-plan, heap-limit-calc, auto-reduce-workers
 * @param requestedWorkers 配置要求的 worker 数。
 * @returns {ClusterMemoryPlan} 预算、来源、实际 worker 数与每个 worker 的堆上限。
 */
export function resolveMemoryPlan(requestedWorkers: number): ClusterMemoryPlan {
  const hostMb = Math.floor(totalmem() / MB);
  const constrained = Number(process.constrainedMemory?.() ?? 0);
  const containerMb =
    constrained > 0 && constrained < totalmem()
      ? Math.floor(constrained / MB)
      : undefined;
  const envBudget = readPositiveIntEnv('CLUSTER_MEMORY_BUDGET_MB');
  const budgetMb =
    envBudget ?? containerMb ?? Math.floor(hostMb * CLUSTER_HOST_MEMORY_SHARE);
  const source: ClusterMemoryPlan['source'] = envBudget
    ? 'env'
    : containerMb
      ? 'container'
      : 'host';
  const heapPool = Math.floor(budgetMb * CLUSTER_HEAP_SHARE);
  let workers = Math.max(1, requestedWorkers);
  if (heapPool / workers < CLUSTER_MIN_HEAP_MB) {
    workers = Math.max(1, Math.floor(heapPool / CLUSTER_MIN_HEAP_MB));
  }
  const heapMbPerWorker =
    readPositiveIntEnv('WORKER_MAX_OLD_SPACE_MB') ??
    Math.min(4096, Math.max(256, Math.floor(heapPool / workers)));
  return {
    budgetMb,
    source,
    requestedWorkers,
    workers,
    heapMbPerWorker,
    rssWarnMbPerWorker: Math.floor((budgetMb / workers) * 0.9),
  };
}

/**
 * @description worker 调高自己的 OOM 分值（只在 Linux 上有效，失败忽略）：整机或容器内存耗尽时内核优先杀 worker。
 * @keyword-cn OOM优先级, 优先杀worker
 * @keyword-en raise-oom-score, kill-worker-first
 */
export function raiseOwnOomScore(): void {
  if (process.platform !== 'linux') return;
  try {
    writeFileSync(
      '/proc/self/oom_score_adj',
      String(CLUSTER_WORKER_OOM_SCORE_ADJ),
    );
  } catch {
    // 容器不允许写时保持默认分值
  }
}

/**
 * @description 限制 sharp（libvips）的原生内存：线程数按「CPU 核数 ÷ worker 数」分（`SHARP_CONCURRENCY` 可覆盖），
 *   缓存压到 32MB / 10 个文件 / 50 项。sharp 是进程内单例，启动时配置一次对后续动态加载都生效；未安装时忽略。
 * @keyword-cn 限制图片处理内存, sharp并发
 * @keyword-en limit-sharp-memory, sharp-concurrency
 * @returns {Promise<void>} 配置完成。
 */
export async function applySharpMemoryLimits(): Promise<void> {
  try {
    // 与画布服务的加载方式一致：ESM 包装下取 default，拿不到就用模块本身
    const mod = (await import('sharp')) as unknown as {
      default?: typeof import('sharp');
    };
    const sharp = mod.default ?? (mod as unknown as typeof import('sharp'));
    // 单进程时没有该变量，按 1 个进程独享全部核数
    const workers = readPositiveIntEnv(CLUSTER_ENV.total) ?? 1;
    const concurrency =
      readPositiveIntEnv('SHARP_CONCURRENCY') ??
      Math.max(1, Math.floor(availableParallelism() / workers));
    sharp.concurrency(concurrency);
    sharp.cache({ memory: 32, files: 10, items: 50 });
  } catch {
    // 没装 sharp 的环境不处理
  }
}

/**
 * @description worker 定时把内存用量（RSS、堆已用 / 上限、外部与 ArrayBuffer）上报给主进程。
 * @keyword-cn 上报内存用量, 内存监控
 * @keyword-en report-memory-usage, memory-monitoring
 */
export function startMemoryReporting(): void {
  const report = () => {
    const usage = process.memoryUsage();
    const payload: ClusterMemoryReport = {
      index: Number(process.env[CLUSTER_ENV.index]) || 0,
      role: process.env[CLUSTER_ENV.role] === 'leader' ? 'leader' : 'follower',
      rssMb: Math.round(usage.rss / MB),
      heapUsedMb: Math.round(usage.heapUsed / MB),
      heapLimitMb: Math.round(getHeapStatistics().heap_size_limit / MB),
      externalMb: Math.round(usage.external / MB),
      arrayBuffersMb: Math.round(usage.arrayBuffers / MB),
    };
    sendClusterMessage({ type: CLUSTER_MEMORY_REPORT_TYPE, payload });
  };
  report();
  setInterval(report, CLUSTER_MEMORY_REPORT_MS).unref();
}

/**
 * @description worker 上报内存的消息名。
 * @keyword-cn 内存上报消息, 进程间消息
 * @keyword-en memory-report-message, ipc-message
 */
export const CLUSTER_MEMORY_REPORT_TYPE = 'cluster-runtime.memory.report';

/**
 * @description 主进程内存看护：收各 worker 上报，堆已用超过上限 85% 或 RSS 超过人均预算 90% 时告警（每个 worker 5 分钟最多一次），
 *   每 10 分钟打一次全体汇总日志；worker 退出时清掉它的记录。
 * @keyword-cn 内存看护, 内存告警
 * @keyword-en memory-watchdog, memory-alert
 * @param plan 内存规划。
 * @returns {ClusterPrimaryHandler} 认领 `cluster-runtime.memory.` 消息的处理器。
 */
export function createMemoryWatchHandler(
  plan: ClusterMemoryPlan,
): ClusterPrimaryHandler {
  const latest = new Map<number, ClusterMemoryReport>();
  const lastWarnAt = new Map<number, number>();
  setInterval(() => {
    if (!latest.size) return;
    const rows = [...latest.values()]
      .sort((a, b) => a.index - b.index)
      .map(
        (item) =>
          `#${item.index}${item.role === 'leader' ? '(leader)' : ''} rss=${item.rssMb}MB heap=${item.heapUsedMb}/${item.heapLimitMb}MB ab=${item.arrayBuffersMb}MB`,
      );
    console.log(
      `[cluster-memory] 预算 ${plan.budgetMb}MB（${plan.source}） ${rows.join(' | ')}`,
    );
  }, 10 * 60_000).unref();
  return {
    prefix: 'cluster-runtime.memory.',
    handle(envelope, workerId) {
      if (envelope.type !== CLUSTER_MEMORY_REPORT_TYPE) return;
      const report = envelope.payload as ClusterMemoryReport;
      latest.set(workerId, report);
      const heapHigh = report.heapUsedMb > report.heapLimitMb * 0.85;
      const rssHigh = report.rssMb > plan.rssWarnMbPerWorker;
      if (!heapHigh && !rssHigh) return;
      const now = Date.now();
      if (now - (lastWarnAt.get(workerId) ?? 0) < 5 * 60_000) return;
      lastWarnAt.set(workerId, now);
      console.warn(
        `[cluster-memory] worker #${report.index} 内存偏高：rss=${report.rssMb}MB（人均预算 ${plan.rssWarnMbPerWorker}MB） heap=${report.heapUsedMb}/${report.heapLimitMb}MB external=${report.externalMb}MB arrayBuffers=${report.arrayBuffersMb}MB`,
      );
    },
    onWorkerExit(workerId) {
      latest.delete(workerId);
      lastWarnAt.delete(workerId);
    },
  };
}
