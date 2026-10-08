import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import {
  CLUSTER_ENV,
  type ClusterRole,
} from '../entities/cluster-runtime.entity.js';

/**
 * @description 读取要派生的 worker 数：`CLUSTER_WORKERS` 为正整数时按它，`auto` 按 CPU 核数，未设置或不大于 1 表示不开多进程。
 * @keyword-cn 读取进程数, 多进程开关
 * @keyword-en read-cluster-workers, cluster-switch
 * @returns {number} worker 数，1 表示单进程。
 */
export function readClusterWorkerCount(): number {
  const raw = String(process.env[CLUSTER_ENV.workers] ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'auto') return Math.max(1, availableParallelism());
  const count = Math.floor(Number(raw));
  return Number.isFinite(count) && count > 1 ? Math.min(count, 32) : 1;
}

/**
 * @description 当前进程是否为多进程模式下的 worker（有 IPC 通道）。
 * @keyword-cn 判断worker进程, 进程间通道
 * @keyword-en is-cluster-worker, ipc-channel
 * @returns {boolean} 是 worker 时为 true。
 */
export function isClusterWorker(): boolean {
  return cluster.isWorker && typeof process.send === 'function';
}

/**
 * @description 读取当前进程角色；未开多进程时是唯一进程，按 leader 处理。
 * @keyword-cn 读取进程角色, 主工作进程
 * @keyword-en read-cluster-role, leader-worker
 * @returns {ClusterRole} 进程角色。
 */
export function readClusterRole(): ClusterRole {
  if (!isClusterWorker()) return 'leader';
  return process.env[CLUSTER_ENV.role] === 'leader' ? 'leader' : 'follower';
}

/**
 * @description 当前进程是否负责 gRPC 长连接与后台定时任务（单进程时永远是）。
 * @keyword-cn 是否主工作进程, 后台任务归属
 * @keyword-en is-leader-process, background-task-owner
 * @returns {boolean} 是 leader 时为 true。
 */
export function isLeaderProcess(): boolean {
  return readClusterRole() === 'leader';
}
