import type {
  ClusterPrimaryApi,
  ClusterPrimaryHandler,
} from '../../cluster-runtime/entities/cluster-runtime.entity.js';
import {
  GENERATION_QUEUE_MESSAGES,
  type GenerationQueueLimits,
  type GenerationQueueTicket,
} from '../entities/generation-queue.entity.js';
import { GenerationQueueCore } from './generation-queue-core.js';

/**
 * @description 多进程时主进程上的排队处理器：持有全局唯一的排队登记簿，处理 worker 的申请 / 归还 / 上限更新 / 状态查询，
 *   把新分配到名额的票据通知给持有它的 worker；worker 退出时回收它的全部票据，名额不会被死进程占住。
 * @keyword-cn 主进程排队处理器, 全局排队登记簿
 * @keyword-en primary-queue-handler, global-queue-registry
 * @returns {ClusterPrimaryHandler} 认领 `generation-queue.` 消息的处理器。
 */
export function createGenerationQueuePrimaryHandler(): ClusterPrimaryHandler {
  const core = new GenerationQueueCore();
  const notifyGranted = (
    granted: GenerationQueueTicket[],
    api: ClusterPrimaryApi,
  ): void => {
    for (const ticket of granted) {
      if (ticket.owner === undefined) continue;
      api.send(ticket.owner, {
        type: GENERATION_QUEUE_MESSAGES.grant,
        payload: { ticketId: ticket.ticketId },
      });
    }
  };
  return {
    prefix: 'generation-queue.',
    handle(envelope, workerId, api) {
      const payload = (envelope.payload ?? {}) as Record<string, unknown>;
      switch (envelope.type) {
        case GENERATION_QUEUE_MESSAGES.acquire:
          notifyGranted(
            core.enqueue(
              {
                ticketId: String(payload.ticketId),
                lane: String(payload.lane),
                tenantKey: String(payload.tenantKey),
                key: typeof payload.key === 'string' ? payload.key : undefined,
                owner: workerId,
              },
              payload.limits as GenerationQueueLimits,
            ),
            api,
          );
          return;
        case GENERATION_QUEUE_MESSAGES.release:
          notifyGranted(core.release(String(payload.ticketId)), api);
          return;
        case GENERATION_QUEUE_MESSAGES.updateLimits:
          notifyGranted(
            core.updateLimits(
              String(payload.lane),
              String(payload.tenantKey),
              payload.limits as GenerationQueueLimits,
            ),
            api,
          );
          return;
        case GENERATION_QUEUE_MESSAGES.queryState:
          if (envelope.requestId) {
            api.reply(workerId, envelope.requestId, {
              state: core.stateOf(String(payload.lane), String(payload.key)),
            });
          }
          return;
        case GENERATION_QUEUE_MESSAGES.queryKeys:
          if (envelope.requestId) {
            api.reply(workerId, envelope.requestId, {
              keys: core.activeKeys(String(payload.lane)),
            });
          }
          return;
        case GENERATION_QUEUE_MESSAGES.querySnapshot:
          if (envelope.requestId) {
            api.reply(
              workerId,
              envelope.requestId,
              core.snapshot(String(payload.lane)),
            );
          }
          return;
        default:
          return;
      }
    },
    onWorkerExit(workerId, api) {
      notifyGranted(core.releaseOwner(workerId), api);
    },
  };
}
