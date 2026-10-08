import { randomUUID } from 'node:crypto';
import {
  CLUSTER_REPLY_TYPE,
  type ClusterEnvelope,
} from '../entities/cluster-runtime.entity.js';
import { isClusterWorker } from './cluster-role.js';

type Listener = (payload: unknown) => void;
type Pending = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const listeners = new Map<string, Set<Listener>>();
const pendingRequests = new Map<string, Pending>();
let attached = false;

/**
 * @description 在 worker 上挂一次 `process.on('message')`，按消息名分发给订阅者，并把应答交给等待中的请求。
 * @keyword-cn 挂载进程消息, 消息分发
 * @keyword-en attach-ipc-listener, message-dispatch
 */
function attachListener(): void {
  if (attached) return;
  attached = true;
  process.on('message', (raw: unknown) => {
    const envelope = raw as ClusterEnvelope;
    if (!envelope || typeof envelope.type !== 'string') return;
    if (envelope.type === CLUSTER_REPLY_TYPE && envelope.requestId) {
      const pending = pendingRequests.get(envelope.requestId);
      if (!pending) return;
      pendingRequests.delete(envelope.requestId);
      clearTimeout(pending.timer);
      pending.resolve(envelope.payload);
      return;
    }
    for (const listener of listeners.get(envelope.type) ?? []) {
      try {
        listener(envelope.payload);
      } catch (error) {
        console.error(
          `[cluster-ipc] listener ${envelope.type} failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  });
}

/**
 * @description 订阅主进程发来的某类消息；非 worker 进程直接忽略。返回取消订阅函数。
 * @keyword-cn 订阅进程消息, 进程间通知
 * @keyword-en on-cluster-message, ipc-subscribe
 * @param type 消息名。
 * @param listener 处理函数。
 * @returns {() => void} 取消订阅。
 */
export function onClusterMessage(type: string, listener: Listener): () => void {
  if (!isClusterWorker()) return () => undefined;
  attachListener();
  const set = listeners.get(type) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(type, set);
  return () => set.delete(listener);
}

/**
 * @description 向主进程发送一条消息（`target` 为 leader / all 时由主进程转发）；非 worker 进程返回 false。
 * @keyword-cn 发送进程消息, 转发到主工作进程
 * @keyword-en send-cluster-message, forward-to-leader
 * @param envelope 消息信封。
 * @returns {boolean} 是否已发出。
 */
export function sendClusterMessage(envelope: ClusterEnvelope): boolean {
  if (!isClusterWorker() || !process.send) return false;
  attachListener();
  process.send(envelope);
  return true;
}

/**
 * @description 向主进程发请求并等待应答，超时报错。
 * @keyword-cn 请求主进程, 进程间应答
 * @keyword-en request-primary, ipc-reply
 * @param type 请求消息名。
 * @param payload 请求内容。
 * @param timeoutMs 超时毫秒数。
 * @returns {Promise<T>} 应答内容。
 * @throws {Error} 非 worker 进程或超时。
 */
export function requestPrimary<T>(
  type: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<T> {
  if (!isClusterWorker()) {
    return Promise.reject(new Error('CLUSTER_NOT_WORKER'));
  }
  attachListener();
  const requestId = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`CLUSTER_REQUEST_TIMEOUT:${type}`));
    }, timeoutMs);
    timer.unref?.();
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
    sendClusterMessage({ type, payload, requestId });
  });
}
