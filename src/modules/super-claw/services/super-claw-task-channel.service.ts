import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ServerDuplexStream } from '@grpc/grpc-js';
import { randomUUID } from 'crypto';
import type {
  SuperClawTaskChannelEvent,
  SuperClawTaskChannelRequest,
  SuperClawTaskDispatch,
} from '../entities/super-claw-grpc.entity.js';
import type { WorkspaceEntity } from '../../workspace/entities/workspace.entity.js';
import { SuperClawGatewayService } from './super-claw-gateway.service.js';
import { SuperClawService } from './super-claw.service.js';

const ACK_TIMEOUT_SECONDS = 15;
const TASK_LEASE_SECONDS = 120;
const IDLE_SWEEP_SECONDS = 30;

/**
 * @description 同一任务允许被节点 ACK 并开始执行的最大次数；超过后平台停止重投并判失败。
 * @keyword-cn 重复领取上限, 重投封顶
 * @keyword-en max-execution-attempts, redelivery-cap
 */
export const SUPER_CLAW_MAX_DISPATCH_ATTEMPTS = 3;

type TaskChannelCall = ServerDuplexStream<
  SuperClawTaskChannelRequest,
  SuperClawTaskChannelEvent
>;

type ActiveDelivery = {
  message: SuperClawTaskDispatch;
  acknowledged: boolean;
  timer?: NodeJS.Timeout;
};

type ActiveWorkspaceProvision = {
  workspaceId: string;
  timer?: NodeJS.Timeout;
};

/** 节点断线时被摘下的已确认投递，等待同一节点重连后重新挂回任务流。 */
type DetachedDelivery = {
  delivery: ActiveDelivery;
  timer?: NodeJS.Timeout;
};

type TaskChannelState = {
  superClawId: string;
  call: TaskChannelCall;
  availableSlots: number;
  deliveries: Map<string, ActiveDelivery>;
  workspaceProvisions: Map<string, ActiveWorkspaceProvision>;
  serial: Promise<void>;
  closed: boolean;
};

/**
 * @description 维护 SuperClaw 双向任务通道，由平台按节点租户归属主动推送并管理 ACK、租约与重投。
 * @keyword-cn 主动任务通道, 服务端任务租约
 * @keyword-en active-task-channel, server-task-lease
 */
@Injectable()
export class SuperClawTaskChannelService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SuperClawTaskChannelService.name);
  private readonly channels = new Map<string, TaskChannelState>();
  /** superClawId -> deliveryId -> 断线期间保留的执行中投递。 */
  private readonly detachedDeliveries = new Map<
    string,
    Map<string, DetachedDelivery>
  >();
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly gatewayService: SuperClawGatewayService,
    private readonly superClawService: SuperClawService,
  ) {}

  /**
   * @description 启动空闲通道巡检，兜底断线保留租约到期、通知丢失等无人唤醒的推送时机。
   * @keyword-cn 启动空闲巡检, 兜底唤醒
   * @keyword-en start-idle-sweep, fallback-wakeup
   */
  onModuleInit(): void {
    this.sweepTimer = setInterval(
      () => this.sweepIdleChannels(),
      IDLE_SWEEP_SECONDS * 1000,
    );
    this.sweepTimer.unref?.();
  }

  /**
   * @description 停止空闲通道巡检定时器。
   * @keyword-cn 停止空闲巡检, 定时器清理
   * @keyword-en stop-idle-sweep, timer-cleanup
   */
  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  /**
   * @description 周期性给所有空闲在线通道补一次推送机会，无空槽或已有投递的通道会被 pushNext 自行跳过。
   * @keyword-cn 巡检空闲通道, 补发推送机会
   * @keyword-en sweep-idle-channels, retry-push-window
   */
  private sweepIdleChannels(): void {
    for (const state of this.channels.values()) {
      if (state.closed || state.availableSlots < 1 || state.deliveries.size > 0)
        continue;
      state.serial = state.serial
        .then(() => this.pushNext(state))
        .catch((error) => this.failChannel(state, error));
    }
  }

  /**
   * @description 工作区写入平台后立即向其租户绑定的在线节点下发创建指令，离线时保留 pending 等待重连补发。
   * @keyword-cn 通知创建工作区, 离线补发
   * @keyword-en notify-workspace-provision, offline-provision-replay
   */
  async notifyWorkspaceProvision(workspace: WorkspaceEntity): Promise<boolean> {
    const state = this.channels.get(workspace.superClawId);
    if (!state || state.closed) return false;
    state.serial = state.serial
      .then(() => this.sendWorkspaceProvision(state, workspace))
      .catch((error) => this.failChannel(state, error));
    await state.serial;
    return true;
  }

  /**
   * @description 在新 Todo 进入队列时定位租户所属在线节点并立即尝试主动推送。
   * @keyword-cn 通知租户新任务, 事件驱动推送
   * @keyword-en notify-tenant-task, event-driven-push
   */
  async notifyTenant(tenantId: string): Promise<boolean> {
    const superClawId =
      await this.superClawService.getAssignedSuperClawId(tenantId);
    const state = superClawId ? this.channels.get(superClawId) : undefined;
    if (!state || state.closed) return false;
    state.serial = state.serial
      .then(() => this.pushNext(state))
      .catch((error) => this.failChannel(state, error));
    await state.serial;
    return true;
  }

  /**
   * @description 根据平台工作区的固定节点归属触发任务推送，不依赖租户绑定信息。
   * @keyword-cn 通知工作区任务, 平台任务推送
   * @keyword-en notify-workspace-task, platform-task-push
   */
  async notifyWorkspace(workspaceId: string): Promise<boolean> {
    const superClawId =
      await this.superClawService.getWorkspaceSuperClawId(workspaceId);
    const state = superClawId ? this.channels.get(superClawId) : undefined;
    if (!state || state.closed) return false;
    state.serial = state.serial
      .then(() => this.pushNext(state))
      .catch((error) => this.failChannel(state, error));
    await state.serial;
    return true;
  }

  /**
   * @description 注册节点双向流并发送服务端租约参数；同节点新连接会替换旧连接。
   * @keyword-cn 打开任务通道, 替换旧连接
   * @keyword-en open-task-channel, replace-stale-channel
   */
  openTaskChannel(superClawId: string, call: TaskChannelCall): void {
    const previous = this.channels.get(superClawId);
    if (previous) {
      void this.closeChannel(previous, 'replaced');
      previous.call.end();
    }
    const state: TaskChannelState = {
      superClawId,
      call,
      availableSlots: 0,
      deliveries: new Map(),
      workspaceProvisions: new Map(),
      serial: Promise.resolve(),
      closed: false,
    };
    this.channels.set(superClawId, state);
    this.adoptDetachedDeliveries(state);
    call.write({
      hello: {
        superClawId,
        serverTime: new Date().toISOString(),
        ackTimeoutSeconds: ACK_TIMEOUT_SECONDS,
        leaseSeconds: TASK_LEASE_SECONDS,
      },
    });
    call.on('data', (message: SuperClawTaskChannelRequest) => {
      state.serial = state.serial
        .then(() => this.handleMessage(state, message))
        .catch((error) => this.failChannel(state, error));
    });
    const close = () => void this.closeChannel(state, 'disconnected');
    call.on('error', close);
    call.on('end', close);
    call.on('close', close);
    call.on('cancelled', close);
  }

  /**
   * @description 串行处理 ready、ACK、NACK、租约心跳、完成确认和 ping 消息。
   * @keyword-cn 处理通道消息, 串行协议状态
   * @keyword-en handle-channel-message, serialized-protocol-state
   */
  private async handleMessage(
    state: TaskChannelState,
    message: SuperClawTaskChannelRequest,
  ): Promise<void> {
    if (state.closed) return;
    if (message.ready) {
      state.availableSlots = Math.min(
        1,
        Math.max(0, Math.trunc(Number(message.ready.availableSlots ?? 0))),
      );
      await this.flushWorkspaceProvisions(state);
      await this.pushNext(state);
      return;
    }
    if (message.workspaceAck) {
      const deliveryId = String(message.workspaceAck.deliveryId ?? '');
      const provision = state.workspaceProvisions.get(deliveryId);
      if (
        !provision ||
        provision.workspaceId !== String(message.workspaceAck.workspaceId ?? '')
      ) {
        return;
      }
      if (provision.timer) clearTimeout(provision.timer);
      state.workspaceProvisions.delete(deliveryId);
      const success = Boolean(message.workspaceAck.success);
      await this.superClawService.confirmWorkspaceProvision({
        superClawId: state.superClawId,
        workspaceId: provision.workspaceId,
        success,
        error: message.workspaceAck.error,
      });
      if (success) await this.pushNext(state);
      return;
    }
    if (message.ack) {
      const delivery = this.matchDelivery(
        state,
        message.ack.deliveryId,
        message.ack.taskId,
      );
      if (!delivery) return;
      const acknowledged = await this.gatewayService.acknowledgeTaskDelivery(
        state.superClawId,
        {
          deliveryId: delivery.message.deliveryId,
          taskId: Number(delivery.message.task.id),
          leaseExpiresAt: this.nextLeaseExpiry(),
        },
      );
      if (!acknowledged) {
        await this.releaseDelivery(state, delivery, 'ack-rejected');
        state.call.end();
        return;
      }
      if (
        this.matchDelivery(
          state,
          delivery.message.deliveryId,
          delivery.message.task.id,
        ) !== delivery
      ) {
        return;
      }
      delivery.acknowledged = true;
      this.armLeaseTimer(state, delivery);
      return;
    }
    if (message.lease) {
      const delivery = this.matchDelivery(
        state,
        message.lease.deliveryId,
        message.lease.taskId,
      );
      if (!delivery?.acknowledged) return;
      const renewed = await this.gatewayService.renewTaskDelivery(
        state.superClawId,
        {
          deliveryId: delivery.message.deliveryId,
          taskId: Number(delivery.message.task.id),
          leaseExpiresAt: this.nextLeaseExpiry(),
        },
      );
      if (
        renewed &&
        this.matchDelivery(
          state,
          delivery.message.deliveryId,
          delivery.message.task.id,
        ) === delivery
      ) {
        this.armLeaseTimer(state, delivery);
      } else if (!renewed) {
        await this.releaseDelivery(state, delivery, 'lease-rejected');
        state.call.end();
      }
      return;
    }
    if (message.completed) {
      const delivery = this.matchDelivery(
        state,
        message.completed.deliveryId,
        message.completed.taskId,
      );
      if (!delivery) return;
      const terminal = await this.gatewayService.isTaskDeliveryComplete(
        state.superClawId,
        {
          tenantId: delivery.message.task.tenantId,
          taskId: Number(delivery.message.task.id),
        },
      );
      if (!terminal) return;
      this.removeDelivery(state, delivery.message.deliveryId);
      state.availableSlots = 1;
      await this.pushNext(state);
      return;
    }
    if (message.nack) {
      const delivery = this.matchDelivery(
        state,
        message.nack.deliveryId,
        message.nack.taskId,
      );
      if (delivery) await this.releaseDelivery(state, delivery, 'nack');
      return;
    }
    if (message.ping) {
      state.call.write({
        pong: {
          clientTime: String(message.ping.clientTime ?? ''),
          serverTime: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * @description 在节点有空闲槽位时，从平台所辖租户中预留并主动写入一条任务。
   * @keyword-cn 推送下一任务, 平台租户路由
   * @keyword-en push-next-task, platform-tenant-routing
   */
  private async pushNext(state: TaskChannelState): Promise<void> {
    if (state.closed || state.availableSlots < 1 || state.deliveries.size > 0) {
      return;
    }
    const deliveryId = randomUUID();
    const ackDeadline = new Date(Date.now() + ACK_TIMEOUT_SECONDS * 1000);
    const message = await this.gatewayService.reserveTaskDelivery(
      state.superClawId,
      {
        deliveryId,
        ackDeadline,
        leaseSeconds: TASK_LEASE_SECONDS,
        maxExecutionAttempts: SUPER_CLAW_MAX_DISPATCH_ATTEMPTS,
      },
    );
    if (!message) return;
    if (state.closed) {
      await this.gatewayService.releaseTaskDelivery(state.superClawId, {
        deliveryId: message.deliveryId,
        taskId: Number(message.task.id),
      });
      return;
    }
    const delivery: ActiveDelivery = { message, acknowledged: false };
    state.deliveries.set(deliveryId, delivery);
    state.availableSlots = 0;
    state.call.write({ task: message });
    delivery.timer = setTimeout(() => {
      state.serial = state.serial
        .then(async () => {
          if (
            this.matchDelivery(
              state,
              delivery.message.deliveryId,
              delivery.message.task.id,
            ) !== delivery
          ) {
            return;
          }
          await this.releaseDelivery(state, delivery, 'ack-timeout');
          state.call.end();
        })
        .catch((error) => this.failChannel(state, error));
    }, ACK_TIMEOUT_SECONDS * 1000);
    delivery.timer.unref?.();
  }

  /**
   * @description 节点上线时把平台中尚未确认的工作区创建指令全部补发。
   * @keyword-cn 补发待创建工作区, 节点上线同步
   * @keyword-en flush-pending-workspaces, node-online-sync
   */
  private async flushWorkspaceProvisions(
    state: TaskChannelState,
  ): Promise<void> {
    const rows = await this.superClawService.listPendingWorkspaceProvisions(
      state.superClawId,
    );
    for (const workspace of rows) {
      this.sendWorkspaceProvision(state, workspace);
    }
  }

  /**
   * @description 在节点双向流下发单个工作区创建命令，并等待节点 ACK。
   * @keyword-cn 下发工作区创建, 等待节点确认
   * @keyword-en send-workspace-provision, await-node-ack
   */
  private sendWorkspaceProvision(
    state: TaskChannelState,
    workspace: WorkspaceEntity,
  ): void {
    if (state.closed || workspace.superClawId !== state.superClawId) return;
    if (
      [...state.workspaceProvisions.values()].some(
        (row) => row.workspaceId === String(workspace._id),
      )
    ) {
      return;
    }
    const deliveryId = randomUUID();
    const provision: ActiveWorkspaceProvision = {
      workspaceId: String(workspace._id),
    };
    state.workspaceProvisions.set(deliveryId, provision);
    state.call.write({
      workspace: {
        deliveryId,
        workspaceId: String(workspace._id),
        tenantId: workspace.tenantId ?? '',
        name: workspace.name,
        description: workspace.description ?? '',
        capacityBytes: String(workspace.capacityBytes),
      },
    });
    provision.timer = setTimeout(() => {
      state.workspaceProvisions.delete(deliveryId);
    }, ACK_TIMEOUT_SECONDS * 1000);
    provision.timer.unref?.();
  }

  /**
   * @description 校验上行消息中的 deliveryId 与 taskId 是否匹配当前内存投递。
   * @keyword-cn 匹配任务投递, 防止串线
   * @keyword-en match-task-delivery, prevent-cross-delivery
   */
  private matchDelivery(
    state: TaskChannelState,
    deliveryId?: string,
    taskId?: string,
  ): ActiveDelivery | undefined {
    const delivery = state.deliveries.get(String(deliveryId ?? ''));
    return delivery && delivery.message.task.id === String(taskId ?? '')
      ? delivery
      : undefined;
  }

  /**
   * @description 重置当前任务的本地租约超时保护；超时会回收平台任务并断开旧执行流。
   * @keyword-cn 重置租约计时, 超时回收
   * @keyword-en reset-lease-timer, timeout-reclaim
   */
  private armLeaseTimer(
    state: TaskChannelState,
    delivery: ActiveDelivery,
  ): void {
    if (delivery.timer) clearTimeout(delivery.timer);
    delivery.timer = setTimeout(() => {
      state.serial = state.serial
        .then(async () => {
          if (
            this.matchDelivery(
              state,
              delivery.message.deliveryId,
              delivery.message.task.id,
            ) !== delivery
          ) {
            return;
          }
          await this.releaseDelivery(state, delivery, 'lease-timeout');
          state.call.end();
        })
        .catch((error) => this.failChannel(state, error));
    }, TASK_LEASE_SECONDS * 1000);
    delivery.timer.unref?.();
  }

  /**
   * @description 释放一条未完成投递并从内存通道移除，平台同时轮换旧任务 Token。
   * @keyword-cn 释放通道投递, 轮换旧令牌
   * @keyword-en release-channel-delivery, rotate-stale-token
   */
  private async releaseDelivery(
    state: TaskChannelState,
    delivery: ActiveDelivery,
    reason: string,
  ): Promise<void> {
    this.removeDelivery(state, delivery.message.deliveryId);
    await this.gatewayService.releaseTaskDelivery(state.superClawId, {
      deliveryId: delivery.message.deliveryId,
      taskId: Number(delivery.message.task.id),
    });
    this.logger.warn(
      `[releaseDelivery] superClawId=${state.superClawId} taskId=${delivery.message.task.id} reason=${reason}`,
    );
  }

  /**
   * @description 清理单条投递的计时器与通道内存状态。
   * @keyword-cn 清理投递状态, 释放计时器
   * @keyword-en clear-delivery-state, release-timer
   */
  private removeDelivery(state: TaskChannelState, deliveryId: string): void {
    const delivery = state.deliveries.get(deliveryId);
    if (delivery?.timer) clearTimeout(delivery.timer);
    state.deliveries.delete(deliveryId);
  }

  /**
   * @description 关闭通道；只立即回收尚未 ACK 的投递，已在执行的任务保留服务端租约作为重连宽限期。
   * @keyword-cn 关闭任务通道, 断线保留租约
   * @keyword-en close-task-channel, keep-lease-on-disconnect
   */
  private async closeChannel(
    state: TaskChannelState,
    reason: string,
  ): Promise<void> {
    if (state.closed) return;
    state.closed = true;
    if (this.channels.get(state.superClawId) === state) {
      this.channels.delete(state.superClawId);
    }
    const deliveries = [...state.deliveries.values()];
    for (const provision of state.workspaceProvisions.values()) {
      if (provision.timer) clearTimeout(provision.timer);
    }
    state.workspaceProvisions.clear();
    // 断线立刻把执行中的任务退回 pending，会让节点一重连就收到同一条任务并
    // 再启动一次抓取。已 ACK 的投递改为摘下保留：节点在租约内重连会重新挂回
    // 同一条投递继续跑，节点确实死掉时由保留租约到期回收。
    const reclaimable = deliveries.filter((delivery) => !delivery.acknowledged);
    for (const delivery of deliveries) {
      if (!delivery.acknowledged) continue;
      this.removeDelivery(state, delivery.message.deliveryId);
      this.detachDelivery(state.superClawId, delivery);
      this.logger.warn(
        `[closeChannel] superClawId=${state.superClawId} taskId=${delivery.message.task.id} reason=${reason} detachedForSeconds=${TASK_LEASE_SECONDS}`,
      );
    }
    await Promise.all(
      reclaimable.map((delivery) =>
        this.releaseDelivery(state, delivery, reason).catch((error) =>
          this.logger.error(String(error)),
        ),
      ),
    );
  }

  /**
   * @description 把断线时仍在执行的投递挂到保留区，并按租约时长安排兜底回收。
   * @keyword-cn 摘下执行中投递, 保留租约回收
   * @keyword-en detach-running-delivery, retained-lease-reclaim
   */
  private detachDelivery(superClawId: string, delivery: ActiveDelivery): void {
    let bucket = this.detachedDeliveries.get(superClawId);
    if (!bucket) {
      bucket = new Map();
      this.detachedDeliveries.set(superClawId, bucket);
    }
    const deliveryId = delivery.message.deliveryId;
    const entry: DetachedDelivery = { delivery };
    bucket.set(deliveryId, entry);
    entry.timer = setTimeout(() => {
      const current = this.detachedDeliveries.get(superClawId);
      if (current?.get(deliveryId) !== entry) return;
      current.delete(deliveryId);
      if (!current.size) this.detachedDeliveries.delete(superClawId);
      void this.gatewayService
        .releaseTaskDelivery(superClawId, {
          deliveryId,
          taskId: Number(delivery.message.task.id),
        })
        .then(() =>
          this.logger.warn(
            `[detachDelivery] superClawId=${superClawId} taskId=${delivery.message.task.id} reason=detached-lease-timeout`,
          ),
        )
        .catch((error) => this.logger.error(String(error)));
    }, TASK_LEASE_SECONDS * 1000);
    entry.timer.unref?.();
  }

  /**
   * @description 节点重连后把保留区的执行中投递挂回新任务流，使续约与完成消息重新可匹配。
   * @keyword-cn 挂回执行中投递, 重连续跑
   * @keyword-en adopt-detached-delivery, resume-after-reconnect
   */
  private adoptDetachedDeliveries(state: TaskChannelState): void {
    const bucket = this.detachedDeliveries.get(state.superClawId);
    if (!bucket?.size) return;
    this.detachedDeliveries.delete(state.superClawId);
    for (const entry of bucket.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      const delivery = entry.delivery;
      state.deliveries.set(delivery.message.deliveryId, delivery);
      this.armLeaseTimer(state, delivery);
      this.logger.log(
        `[adoptDetachedDeliveries] superClawId=${state.superClawId} taskId=${delivery.message.task.id}`,
      );
      // 立刻续一次平台租约，避免节点还在跑时被过期回收扫走。
      state.serial = state.serial
        .then(() =>
          this.gatewayService.renewTaskDelivery(state.superClawId, {
            deliveryId: delivery.message.deliveryId,
            taskId: Number(delivery.message.task.id),
            leaseExpiresAt: this.nextLeaseExpiry(),
          }),
        )
        .then(() => undefined)
        .catch((error) => this.failChannel(state, error));
    }
  }

  /**
   * @description 处理通道协议异常并关闭流，避免保留不可恢复的内存状态。
   * @keyword-cn 通道异常处理, 安全关闭
   * @keyword-en channel-error-handling, safe-close
   */
  private async failChannel(
    state: TaskChannelState,
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      `[failChannel] superClawId=${state.superClawId} error=${String(error)}`,
    );
    await this.closeChannel(state, 'protocol-error');
    state.call.end();
  }

  /**
   * @description 计算下一次平台任务租约截止时间。
   * @keyword-cn 计算租约截止, 服务端时间
   * @keyword-en calculate-lease-expiry, server-time
   */
  private nextLeaseExpiry(): Date {
    return new Date(Date.now() + TASK_LEASE_SECONDS * 1000);
  }
}
