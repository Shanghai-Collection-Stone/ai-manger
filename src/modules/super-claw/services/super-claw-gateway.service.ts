import { HttpException, Injectable, Logger } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { ModuleRef } from '@nestjs/core';
import type {
  BrowserAuthInteractionEnvelope,
  BrowserSessionView,
} from '../../browser-auth/entities/browser-auth.entity.js';
import { BrowserAuthInteractionService } from '../../browser-auth/services/browser-auth-interaction.service.js';
import { BrowserSessionService } from '../../browser-auth/services/browser-session.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { SUPER_CLAW_DATA_TRACKING_AGENT_MODULE } from '../../auto-task-robot/services/robot-registry.service.js';
import { ChatMainService } from '../../chat-main/services/chat.service.js';
import type { ChatRequest } from '../../chat-main/types/chat.types.js';
import { ContextService } from '../../context/services/context.service.js';
import type { ConversationSessionType } from '../../context/entities/conversation.entity.js';
import type { TodoEntity } from '../../todo/entities/todo.entity.js';
import type { XhsPostStatCreateInput } from '../../todo/entities/xhs-post-stat.entity.js';
import { TodoService } from '../../todo/services/todo.service.js';
import { XhsPostStatService } from '../../todo/services/xhs-post-stat.service.js';
import type {
  SuperClawConversationView,
  SuperClawCreateTaskRequest,
  SuperClawCreateTaskInteractionRequest,
  SuperClawBrowserSessionRequest,
  SuperClawGetTaskInteractionRequest,
  SuperClawListTasksRequest,
  SuperClawStartConversationRequest,
  SuperClawTaskEnvelope,
  SuperClawTaskDispatch,
  SuperClawTaskTokenRequest,
  SuperClawTaskView,
  SuperClawTenantRequest,
  SuperClawUpdateTaskRequest,
  SuperClawUpsertBrowserSessionRequest,
  SuperClawWorkspaceView,
  SuperClawXhsPostStatMessage,
} from '../entities/super-claw-grpc.entity.js';
import { SuperClawService } from './super-claw.service.js';

const TODO_STATUSES = new Set([
  'pending',
  'in_progress',
  'waiting_user',
  'done',
  'failed',
  'cancelled',
]);

const CONVERSATION_SESSION_TYPES = new Set<ConversationSessionType>([
  'default',
  'thought',
  'gallery-agent',
  'xhs-specialist',
  'xhs-tracker',
  'xhs-publisher',
  'xhs-article-expert',
  'xhs-image-expert',
]);

/**
 * @description 随每个任务下发给 SuperClaw 的浏览器登录人工介入指引。
 * @keyword-cn 二维码登录指引, 任务介入链路
 * @keyword-en qr-login-guidance, task-intervention-flow
 */
export const SUPER_CLAW_BROWSER_INTERVENTION_GUIDANCE = [
  '若执行中需要网站登录：先调用 GetBrowserSession 复用当前工作区登录态。',
  '登录态缺失或失效时，调用 InvalidateBrowserSession，并用 CreateTaskInteraction(kind=qr_login) 提交浏览器生成的真实二维码；不得伪造二维码、Cookie 或登录结果。',
  '任务进入 waiting_user 后继续续租并轮询 GetTaskInteraction，等待用户在执行节点点击“已处理”；收到 answered 后继续原任务，登录成功或 Cookie 刷新后调用 UpsertBrowserSession。',
  '等待人工登录期间不得回写 done、failed 或 completed；只有交互超时或后续执行确实失败时才写 failed，并提供语义化 abnormal_reason。',
  '二维码、Cookie、storageState、用户回复和 taskToken 不得写入日志、任务结果或持久化脚本。',
].join('\n');

/**
 * @description SuperClaw 租户数据面 gRPC 服务：对话、工作区、任务领取与任务 Token CRUD。
 * @keyword-cn SuperClaw数据面, gRPC任务服务
 * @keyword-en super-claw-data-plane, grpc-task-service
 */
@Injectable()
export class SuperClawGatewayService {
  private readonly logger = new Logger(SuperClawGatewayService.name);

  constructor(
    private readonly superClawService: SuperClawService,
    private readonly contextService: ContextService,
    private readonly chatService: ChatMainService,
    private readonly todoService: TodoService,
    private readonly xhsPostStatService: XhsPostStatService,
    private readonly adminService: AdminService,
    private readonly moduleRef: ModuleRef,
    private readonly browserSessions: BrowserSessionService,
    private readonly browserInteractions: BrowserAuthInteractionService,
  ) {}

  /**
   * @description 返回当前节点所辖租户的全部对话元信息。
   * @keyword-cn 获取租户对话, 节点会话列表
   * @keyword-en list-tenant-conversations, node-session-list
   */
  async listConversations(
    superClawId: string,
    request: SuperClawTenantRequest,
  ): Promise<{ conversations: SuperClawConversationView[] }> {
    const tenantId = await this.requireTenant(superClawId, request.tenantId);
    const rows = await this.contextService.getScopedConversations({ tenantId });
    return {
      conversations: rows.map((row) => ({
        sessionId: row.sessionId,
        sessionType: row.sessionType ?? 'default',
        title: row.title ?? '',
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        workspaceId: row.workspaceId ?? '',
      })),
    };
  }

  /**
   * @description 在节点所辖租户范围创建会话并执行一次非流式 AI 回复。
   * @keyword-cn 发起gRPC对话, 租户AI回复
   * @keyword-en start-grpc-conversation, tenant-ai-response
   */
  async startConversation(
    superClawId: string,
    request: SuperClawStartConversationRequest,
  ): Promise<{ sessionId: string; text: string }> {
    const tenantId = await this.requireTenant(superClawId, request.tenantId);
    const input = String(request.input ?? '').trim();
    if (!input) this.throwInvalid('CONVERSATION_INPUT_REQUIRED');
    const sessionType = this.readSessionType(request.sessionType);
    const workspaceId = String(request.workspaceId ?? '').trim() || undefined;
    if (workspaceId) {
      const workspaces = await this.superClawService.listTenantWorkspaces(
        superClawId,
        tenantId,
      );
      if (!workspaces.some((row) => String(row._id) === workspaceId)) {
        this.throwNotFound('WORKSPACE_NOT_FOUND');
      }
    }
    const userId = request.userId?.trim() || `superclaw:${superClawId}`;
    const sessionId = await this.contextService.createSessionWithScope(
      request.sessionId?.trim() || undefined,
      { tenantId, userId, sessionType, workspaceId },
    );
    const chatRequest: ChatRequest = {
      sessionId,
      input,
      tenantId,
      userId,
      sessionType,
      workspaceId,
    };
    const response = await this.chatService.send(chatRequest);
    return { sessionId, text: response.text };
  }

  /**
   * @description 返回当前节点下指定租户的工作区安全视图。
   * @keyword-cn 获取租户工作区, gRPC工作区
   * @keyword-en list-tenant-workspaces, grpc-workspaces
   */
  async listWorkspaces(
    superClawId: string,
    request: SuperClawTenantRequest,
  ): Promise<{ workspaces: SuperClawWorkspaceView[] }> {
    const tenantId = await this.requireTenant(superClawId, request.tenantId);
    const rows = await this.superClawService.listTenantWorkspaces(
      superClawId,
      tenantId,
    );
    return {
      workspaces: rows.map((row) => ({
        id: String(row._id),
        tenantId: row.tenantId,
        name: row.name,
        description: row.description ?? '',
        capacityBytes: String(row.capacityBytes),
        usedBytes: String(row.usedBytes),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * @description 原子领取租户最早的 SuperClaw 数据抓取任务，并返回该任务专用 Token。
   * @keyword-cn 下发数据抓取任务, 原子领取
   * @keyword-en dispatch-data-task, atomic-claim
   */
  async dispatchTask(
    superClawId: string,
    request: SuperClawTenantRequest,
  ): Promise<SuperClawTaskEnvelope> {
    const tenantId = await this.requireTenant(superClawId, request.tenantId);
    const assignees = await this.getDataTrackingAssignees();
    const todo = await this.todoService.claimNextByAssignees({
      tenantId,
      assignees,
    });
    if (!todo) return { found: false, taskToken: '' };
    const taskToken = await this.todoService.ensureTaskToken(todo.id, tenantId);
    await this.todoService.createItem({
      todoId: todo.id,
      tenantId,
      title: 'SuperClaw 节点已领取',
      description: `节点 ${superClawId} 已通过 gRPC 领取任务。`,
      status: 'in_progress',
      stage: 'SuperClaw 执行中',
      doneNote: `superClawId=${superClawId}`,
    });
    return { found: true, task: this.toTaskView(todo), taskToken };
  }

  /**
   * @description 根据平台维护的节点租户归属预留最早任务，并生成可主动推送的带租约消息。
   * @keyword-cn 预留主动推送任务, 服务端租户选择
   * @keyword-en reserve-active-push-task, server-tenant-selection
   */
  async reserveTaskDelivery(
    superClawId: string,
    input: {
      deliveryId: string;
      ackDeadline: Date;
      leaseSeconds: number;
      maxExecutionAttempts?: number;
    },
  ): Promise<SuperClawTaskDispatch | undefined> {
    const tenantIds =
      await this.superClawService.listAssignedTenantIds(superClawId);
    const workspaceIds =
      await this.superClawService.listProvisionedWorkspaceIds(superClawId);
    const assignees = await this.getDataTrackingAssignees();
    const todo = await this.todoService.reserveNextForDelivery({
      tenantIds,
      workspaceIds,
      assignees,
      includePlatform: true,
      superClawId,
      deliveryId: input.deliveryId,
      ackDeadline: input.ackDeadline,
      maxExecutionAttempts: input.maxExecutionAttempts,
    });
    if (!todo?.taskToken) return undefined;
    return {
      deliveryId: input.deliveryId,
      task: this.toTaskView(todo),
      taskToken: todo.taskToken,
      dispatchedAt: new Date().toISOString(),
      ackDeadline: input.ackDeadline.toISOString(),
      leaseSeconds: input.leaseSeconds,
      attempt: todo.taskDispatchAttempts ?? 1,
    };
  }

  /**
   * @description 确认节点收到主动推送，并将任务推进为带执行租约的 in_progress。
   * @keyword-cn 确认主动推送, 启动任务租约
   * @keyword-en acknowledge-active-push, start-task-lease
   */
  async acknowledgeTaskDelivery(
    superClawId: string,
    input: { deliveryId: string; taskId: number; leaseExpiresAt: Date },
  ): Promise<boolean> {
    const todo = await this.todoService.acknowledgeTaskDelivery({
      id: input.taskId,
      superClawId,
      deliveryId: input.deliveryId,
      leaseExpiresAt: input.leaseExpiresAt,
    });
    if (!todo) return false;
    await this.todoService.createItem({
      todoId: todo.id,
      tenantId: todo.tenantId,
      title: 'SuperClaw 节点已确认接收',
      description: `节点 ${superClawId} 已确认主动推送任务。`,
      status: 'in_progress',
      stage: 'SuperClaw 执行中',
      doneNote: `deliveryId=${input.deliveryId}`,
    });
    return true;
  }

  /**
   * @description 为节点内存中正在执行的任务续期平台租约。
   * @keyword-cn 续期主动任务, 执行租约心跳
   * @keyword-en renew-active-task, execution-lease-heartbeat
   */
  async renewTaskDelivery(
    superClawId: string,
    input: { deliveryId: string; taskId: number; leaseExpiresAt: Date },
  ): Promise<boolean> {
    return await this.todoService.renewTaskDeliveryLease({
      id: input.taskId,
      superClawId,
      deliveryId: input.deliveryId,
      leaseExpiresAt: input.leaseExpiresAt,
    });
  }

  /**
   * @description 释放节点断线、拒绝或租约超时的任务，并使旧任务 Token 立即失效。
   * @keyword-cn 释放主动任务, 失效任务令牌
   * @keyword-en release-active-task, invalidate-task-token
   */
  async releaseTaskDelivery(
    superClawId: string,
    input: { deliveryId: string; taskId: number },
  ): Promise<boolean> {
    return await this.todoService.releaseTaskDelivery({
      id: input.taskId,
      superClawId,
      deliveryId: input.deliveryId,
    });
  }

  /**
   * @description 在释放通道槽位前确认对应任务已经通过专用 Token 写入终态。
   * @keyword-cn 确认任务终态, 防止提前完成
   * @keyword-en confirm-task-terminal, prevent-early-completion
   */
  async isTaskDeliveryComplete(
    superClawId: string,
    input: { tenantId: string; taskId: number },
  ): Promise<boolean> {
    const rawTenantId = input.tenantId.trim();
    const tenantId = rawTenantId
      ? await this.requireTenant(superClawId, rawTenantId)
      : undefined;
    const todo = await this.todoService.get(input.taskId, tenantId);
    if (!tenantId && todo) {
      const workspaceIds =
        await this.superClawService.listProvisionedWorkspaceIds(superClawId);
      if (!todo.workspaceId || !workspaceIds.includes(todo.workspaceId)) {
        return false;
      }
    }
    return Boolean(
      todo &&
      (todo.status === 'done' ||
        todo.status === 'failed' ||
        todo.status === 'cancelled'),
    );
  }

  /**
   * @description 节点在所属租户内创建任务并取得后续 CRUD 使用的专用 Token。
   * @keyword-cn gRPC创建任务, 返回任务令牌
   * @keyword-en create-grpc-task, return-task-token
   */
  async createTask(
    superClawId: string,
    request: SuperClawCreateTaskRequest,
  ): Promise<SuperClawTaskEnvelope> {
    const tenantId = await this.requireTenant(superClawId, request.tenantId);
    const title = String(request.title ?? '').trim();
    if (!title) this.throwInvalid('TASK_TITLE_REQUIRED');
    const deadline = this.readDeadline(request.deadline);
    const workspaceId = String(request.workspaceId ?? '').trim();
    if (!workspaceId) this.throwInvalid('TASK_WORKSPACE_REQUIRED');
    const workspaces = await this.superClawService.listTenantWorkspaces(
      superClawId,
      tenantId,
    );
    const workspace = workspaces.find((row) => String(row._id) === workspaceId);
    if (!workspace || workspace.provisionStatus !== 'provisioned') {
      this.throwNotFound('WORKSPACE_NOT_PROVISIONED');
    }
    const userId = request.userId?.trim() || `superclaw:${superClawId}`;
    const sessionKey = await this.contextService.createSessionWithScope(
      request.sessionId?.trim() || undefined,
      {
        tenantId,
        userId,
        sessionType: 'default',
        workspaceId,
      },
    );
    const defaultAssignee = (await this.getDataTrackingAssignees())[0];
    const todo = await this.todoService.create({
      tenantId,
      userId,
      title,
      description: request.description?.trim() || undefined,
      type: request.type?.trim() || (deadline ? 'long_task' : 'auto_execute'),
      category: request.category?.trim() || undefined,
      assignee: request.assignee?.trim() || defaultAssignee,
      aiConsideration:
        request.aiConsideration?.trim() ||
        '任务由 SuperClaw 节点通过 gRPC 创建。',
      decisionReason:
        request.decisionReason?.trim() || '节点请求平台建立可追踪任务。',
      aiPlan:
        request.aiPlan?.trim() ||
        '按任务描述执行并通过任务专用 Token 回写状态。',
      deadline,
      workspaceId,
      sessionKey,
      associatedResources: (request.associatedResources ?? [])
        .map((item) => ({
          type: String(item.type ?? '').trim(),
          resourceId: String(item.resourceId ?? '').trim(),
        }))
        .filter((item) => item.type && item.resourceId),
    });
    const taskToken = await this.todoService.ensureTaskToken(todo.id, tenantId);
    return { found: true, task: this.toTaskView(todo), taskToken };
  }

  /**
   * @description 按租户列出节点可见任务，列表不会暴露任何任务专用 Token。
   * @keyword-cn 列出租户任务, 隐藏令牌
   * @keyword-en list-tenant-tasks, hide-tokens
   */
  async listTasks(
    superClawId: string,
    request: SuperClawListTasksRequest,
  ): Promise<{ tasks: SuperClawTaskView[] }> {
    const tenantId = await this.requireTenant(superClawId, request.tenantId);
    const requestedStatus = request.status?.trim();
    if (requestedStatus && !TODO_STATUSES.has(requestedStatus)) {
      this.throwInvalid('INVALID_TASK_STATUS');
    }
    const rows = await this.todoService.list(undefined, tenantId);
    return {
      tasks: rows
        .filter((row) => !requestedStatus || row.status === requestedStatus)
        .map((row) => this.toTaskView(row)),
    };
  }

  /**
   * @description 使用任务专用 Token 获取单个任务。
   * @keyword-cn 获取令牌任务, 单任务读取
   * @keyword-en get-token-task, single-task-read
   */
  async getTask(
    superClawId: string,
    request: SuperClawTaskTokenRequest,
  ): Promise<SuperClawTaskEnvelope> {
    const { todo, token } = await this.requireTokenTask(superClawId, request);
    return { found: true, task: this.toTaskView(todo), taskToken: token };
  }

  /**
   * @description 使用任务专用 Token 更新允许的任务字段和状态。
   * @keyword-cn 更新令牌任务, 任务状态回写
   * @keyword-en update-token-task, task-status-writeback
   */
  async updateTask(
    superClawId: string,
    request: SuperClawUpdateTaskRequest,
  ): Promise<SuperClawTaskEnvelope> {
    const { todo, token } = await this.requireTokenTask(superClawId, request);
    const nextStatus = request.status?.trim();
    if (nextStatus && !TODO_STATUSES.has(nextStatus)) {
      this.throwInvalid('INVALID_TASK_STATUS');
    }
    if (nextStatus === 'waiting_user') {
      this.throwInvalid('USE_CREATE_TASK_INTERACTION');
    }
    const abnormalReason = request.abnormalReason?.trim();
    if (nextStatus === 'done' && abnormalReason) {
      this.throwInvalid('DONE_TASK_CANNOT_HAVE_ABNORMAL_REASON');
    }
    if (nextStatus === 'failed' && !abnormalReason) {
      this.throwInvalid('FAILED_TASK_REASON_REQUIRED');
    }
    const xhsStats = request.xhsStats ?? [];
    if (
      xhsStats.length > 0 &&
      todo.deadline &&
      todo.deadline.getTime() <= Date.now()
    ) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'TASK_DEADLINE_EXPIRED',
      });
    }
    if (xhsStats.length > 0) {
      await this.xhsPostStatService.bulkUpsert(
        todo.id,
        xhsStats.map((item) => this.toXhsPostStatInput(item)),
      );
    }
    const updated = await this.todoService.update({
      id: todo.id,
      tenantId: todo.tenantId,
      expectedTaskToken: token,
      title: request.title,
      description: request.description,
      status: nextStatus as TodoEntity['status'] | undefined,
      abnormalReason:
        nextStatus === 'done'
          ? ''
          : request.abnormalReason === undefined
            ? undefined
            : abnormalReason,
      taskResult: request.taskResult,
    });
    if (!updated) this.throwNotFound('TASK_NOT_FOUND');
    if (xhsStats.length > 0) {
      // 先写 Todo 终态，再归属抓取数据；部分成功时运行记录才能继承 failed，
      // 不会仅因为已有帖子数据就被提前标成 done。
      await this.recordXhsCrawlRun(todo.id);
    }
    return {
      found: true,
      task: this.toTaskView(updated),
      taskToken:
        nextStatus === 'done' ||
        nextStatus === 'failed' ||
        nextStatus === 'cancelled'
          ? ''
          : token,
    };
  }

  /**
   * @description 使用任务 Token 读取同租户同工作区的加密浏览器登录态。
   * @keyword-cn 读取任务浏览器会话, 工作区登录态
   * @keyword-en read-task-browser-session, workspace-login-state
   */
  async getBrowserSession(
    superClawId: string,
    request: SuperClawBrowserSessionRequest,
  ): Promise<BrowserSessionView> {
    const { todo } = await this.requireTokenTask(superClawId, request);
    const workspaceId = todo.workspaceId;
    if (!workspaceId) this.throwInvalid('TASK_WORKSPACE_REQUIRED');
    return this.callBrowserAuthOperation(() =>
      this.browserSessions.get({
        tenantId: todo.tenantId,
        workspaceId,
        site: request.site ?? '',
        profile: request.profile,
      }),
    );
  }

  /**
   * @description 使用任务 Token 加密保存同租户同工作区的 Playwright storageState。
   * @keyword-cn 保存任务浏览器会话, 持久化Cookie
   * @keyword-en save-task-browser-session, persist-cookie
   */
  async upsertBrowserSession(
    superClawId: string,
    request: SuperClawUpsertBrowserSessionRequest,
  ): Promise<BrowserSessionView> {
    const { todo } = await this.requireTokenTask(superClawId, request);
    const workspaceId = todo.workspaceId;
    if (!workspaceId) this.throwInvalid('TASK_WORKSPACE_REQUIRED');
    return this.callBrowserAuthOperation(() =>
      this.browserSessions.upsert({
        tenantId: todo.tenantId,
        workspaceId,
        site: request.site ?? '',
        profile: request.profile,
        storageStateJson: request.storageStateJson ?? '',
        expiresAt: request.expiresAt,
      }),
    );
  }

  /**
   * @description 使用任务 Token 删除当前工作区已经失效的浏览器登录态。
   * @keyword-cn 删除任务浏览器会话, 登录态失效
   * @keyword-en invalidate-task-browser-session, login-state-expiry
   */
  async invalidateBrowserSession(
    superClawId: string,
    request: SuperClawBrowserSessionRequest,
  ): Promise<{ deleted: boolean }> {
    const { todo } = await this.requireTokenTask(superClawId, request);
    const workspaceId = todo.workspaceId;
    if (!workspaceId) this.throwInvalid('TASK_WORKSPACE_REQUIRED');
    return {
      deleted: await this.callBrowserAuthOperation(() =>
        this.browserSessions.invalidate({
          tenantId: todo.tenantId,
          workspaceId,
          site: request.site ?? '',
          profile: request.profile,
        }),
      ),
    };
  }

  /**
   * @description 节点创建二维码登录或简短回复交互，并把当前 Todo 切到 waiting_user。
   * @keyword-cn 创建任务登录交互, 等待用户状态
   * @keyword-en create-task-login-interaction, waiting-user-status
   */
  async createTaskInteraction(
    superClawId: string,
    request: SuperClawCreateTaskInteractionRequest,
  ): Promise<BrowserAuthInteractionEnvelope> {
    const { todo, token } = await this.requireTokenTask(superClawId, request);
    if (todo.status !== 'in_progress' && todo.status !== 'waiting_user') {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'TASK_NOT_RUNNING',
      });
    }
    const interaction = await this.callBrowserAuthOperation(() =>
      this.browserInteractions.create(todo, request),
    );
    const updated = await this.todoService.update({
      id: todo.id,
      tenantId: todo.tenantId,
      expectedTaskToken: token,
      status: 'waiting_user',
    });
    if (!updated) {
      await this.browserInteractions.cancel(interaction.id);
      this.throwNotFound('TASK_NOT_FOUND');
    }
    return { found: true, interaction };
  }

  /**
   * @description 节点凭当前任务 Token 查询交互状态与用户短回复。
   * @keyword-cn 查询任务登录交互, 获取用户回调
   * @keyword-en get-task-login-interaction, fetch-user-callback
   */
  async getTaskInteraction(
    superClawId: string,
    request: SuperClawGetTaskInteractionRequest,
  ): Promise<BrowserAuthInteractionEnvelope> {
    const { todo } = await this.requireTokenTask(superClawId, request);
    return this.callBrowserAuthOperation(() =>
      this.browserInteractions.getForTask(todo, request.interactionId),
    );
  }

  /**
   * @description 使用任务专用 Token 删除单个任务。
   * @keyword-cn 删除令牌任务, gRPC任务删除
   * @keyword-en delete-token-task, grpc-task-delete
   */
  async deleteTask(
    superClawId: string,
    request: SuperClawTaskTokenRequest,
  ): Promise<{ deleted: boolean }> {
    const { todo } = await this.requireTokenTask(superClawId, request);
    return { deleted: await this.todoService.delete(todo.id, todo.tenantId) };
  }

  /**
   * @description 校验节点租户边界并返回规范 tenantId。
   * @keyword-cn 校验gRPC租户, 节点边界
   * @keyword-en validate-grpc-tenant, node-boundary
   */
  private async requireTenant(
    superClawId: string,
    rawTenantId?: string,
  ): Promise<string> {
    const tenantId = String(rawTenantId ?? '').trim();
    if (!tenantId) this.throwInvalid('TENANT_ID_REQUIRED');
    await this.superClawService.requireTenantAssignment(superClawId, tenantId);
    return tenantId;
  }

  /**
   * @description 校验 taskId、任务专用 Token、租户和节点归属四项一致。
   * @keyword-cn 校验任务令牌, 四重任务鉴权
   * @keyword-en validate-task-token, four-way-task-auth
   */
  private async requireTokenTask(
    superClawId: string,
    request: SuperClawTaskTokenRequest,
  ): Promise<{ todo: TodoEntity; token: string }> {
    const rawTenantId = String(request.tenantId ?? '').trim();
    const tenantId = rawTenantId
      ? await this.requireTenant(superClawId, rawTenantId)
      : undefined;
    const taskId = Number(request.taskId);
    const token = String(request.taskToken ?? '').trim();
    if (!Number.isInteger(taskId) || taskId <= 0) {
      this.throwInvalid('INVALID_TASK_ID');
    }
    if (!token) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'TASK_TOKEN_REQUIRED',
      });
    }
    const todo = await this.todoService.getByTaskToken(token);
    let scopeAllowed = Boolean(
      todo && todo.id === taskId && (todo.tenantId ?? undefined) === tenantId,
    );
    if (scopeAllowed && !tenantId && todo) {
      const workspaceIds =
        await this.superClawService.listProvisionedWorkspaceIds(superClawId);
      scopeAllowed = Boolean(
        todo.workspaceId && workspaceIds.includes(todo.workspaceId),
      );
    }
    if (!todo || !scopeAllowed) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'INVALID_TASK_TOKEN',
      });
    }
    return { todo, token };
  }

  /**
   * @description 返回所有已启用 SuperClaw 数据抓取 Agent 的 assignee 标识。
   * @keyword-cn 查询专用抓取Agent, 任务指派标识
   * @keyword-en list-data-tracking-agents, task-assignee-id
   */
  private async getDataTrackingAssignees(): Promise<string[]> {
    return (await this.adminService.listAgentConfigs())
      .filter(
        (item) =>
          item.enabled && item.module === SUPER_CLAW_DATA_TRACKING_AGENT_MODULE,
      )
      .map((item) => `agent:${String(item._id)}`);
  }

  /**
   * @description 把 gRPC 小红书指标消息校验并转换成帖子数据写入结构。
   * @keyword-cn 转换小红书指标, 校验采集回传
   * @keyword-en map-xhs-stats, validate-collection-writeback
   */
  private toXhsPostStatInput(
    item: SuperClawXhsPostStatMessage,
  ): Omit<XhsPostStatCreateInput, 'todoId'> {
    const postTitle = String(item.postTitle ?? '').trim();
    if (!postTitle) this.throwInvalid('XHS_POST_TITLE_REQUIRED');
    const dataAt = item.dataAt?.trim() ? new Date(item.dataAt) : undefined;
    if (dataAt && !Number.isFinite(dataAt.getTime())) {
      this.throwInvalid('INVALID_XHS_DATA_AT');
    }
    return {
      tag: item.tag?.trim() || undefined,
      postTitle,
      postUrl: item.postUrl?.trim() || undefined,
      authorUrl: item.authorUrl?.trim() || undefined,
      likeCount: this.readNonNegativeInteger(item.likeCount, 'LIKE_COUNT') ?? 0,
      commentCount:
        this.readNonNegativeInteger(item.commentCount, 'COMMENT_COUNT') ?? 0,
      collectCount:
        this.readNonNegativeInteger(item.collectCount, 'COLLECT_COUNT') ?? 0,
      viewCount: this.readNonNegativeInteger(item.viewCount, 'VIEW_COUNT'),
      shareCount: this.readNonNegativeInteger(item.shareCount, 'SHARE_COUNT'),
      topComments: (item.topComments ?? []).slice(0, 5).map((comment) => ({
        content: String(comment.content ?? '').trim(),
        likeCount:
          this.readNonNegativeInteger(
            comment.likeCount,
            'COMMENT_LIKE_COUNT',
          ) ?? 0,
        replyCount:
          this.readNonNegativeInteger(
            comment.replyCount,
            'COMMENT_REPLY_COUNT',
          ) ?? 0,
      })),
      dataAt,
    };
  }

  /**
   * @description 解析 gRPC int64 字符串并限制为非负安全整数。
   * @keyword-cn 解析采集计数, 非负整数校验
   * @keyword-en parse-stat-count, nonnegative-integer-validation
   */
  private readNonNegativeInteger(
    value: string | undefined,
    field: string,
  ): number | undefined {
    if (value === undefined || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      this.throwInvalid(`INVALID_XHS_${field}`);
    }
    return parsed;
  }

  /**
   * @description gRPC 数据回写后通知抓取调度模块记录本次运行与数据批次。
   * @keyword-cn 记录gRPC抓取运行, 回写批次归属
   * @keyword-en record-grpc-crawl-run, writeback-batch-attribution
   */
  private async recordXhsCrawlRun(todoId: number): Promise<void> {
    try {
      const crawlService = this.moduleRef.get<{
        recordCrawlRun: (id: number) => Promise<number | undefined>;
      }>('XhsTopicCrawlService', { strict: false });
      await crawlService?.recordCrawlRun(todoId);
    } catch (error) {
      this.logger.warn(
        `[recordXhsCrawlRun] todoId=${todoId} 记录抓取运行失败：${String(error)}`,
      );
    }
  }

  /**
   * @description 将 Todo 转成不含 Mongo _id 和 taskToken 的 gRPC 安全视图。
   * @keyword-cn 转换任务协议, 隐藏敏感字段
   * @keyword-en map-task-protocol, hide-sensitive-fields
   */
  private toTaskView(todo: TodoEntity): SuperClawTaskView {
    const aiPlan = String(todo.aiPlan ?? '').trim();
    return {
      id: String(todo.id),
      tenantId: todo.tenantId ?? '',
      userId: todo.userId,
      title: todo.title,
      description: todo.description ?? '',
      type: todo.type ?? '',
      category: todo.category ?? '',
      assignee: todo.assignee ?? '',
      status: todo.status,
      aiConsideration: todo.aiConsideration,
      decisionReason: todo.decisionReason,
      aiPlan: aiPlan
        ? `${aiPlan}\n\n${SUPER_CLAW_BROWSER_INTERVENTION_GUIDANCE}`
        : SUPER_CLAW_BROWSER_INTERVENTION_GUIDANCE,
      executionGuidance: SUPER_CLAW_BROWSER_INTERVENTION_GUIDANCE,
      abnormalReason: todo.abnormalReason ?? '',
      taskResult: todo.taskResult ?? '',
      deadline: todo.deadline?.toISOString() ?? '',
      createdAt: todo.createdAt.toISOString(),
      updatedAt: todo.updatedAt.toISOString(),
      associatedResources: (todo.associatedResources ?? []).map((item) => ({
        type: item.type,
        resourceId: String(item.resourceId),
      })),
      workspaceId: todo.workspaceId ?? '',
      sessionId: todo.sessionKey ?? '',
    };
  }

  /**
   * @description 解析并限制 gRPC 会话类型。
   * @keyword-cn 解析会话类型, 协议枚举校验
   * @keyword-en parse-session-type, protocol-enum-validation
   */
  private readSessionType(value?: string): ConversationSessionType {
    const normalized = String(value ?? '').trim() || 'default';
    if (
      !CONVERSATION_SESSION_TYPES.has(normalized as ConversationSessionType)
    ) {
      this.throwInvalid('INVALID_SESSION_TYPE');
    }
    return normalized as ConversationSessionType;
  }

  /**
   * @description 解析可选任务截止时间并拒绝无效或已经过期的时间。
   * @keyword-cn 解析任务时限, 截止时间校验
   * @keyword-en parse-task-deadline, deadline-validation
   */
  private readDeadline(value?: string): Date | undefined {
    if (!value?.trim()) return undefined;
    const deadline = new Date(value);
    if (
      !Number.isFinite(deadline.getTime()) ||
      deadline.getTime() <= Date.now()
    ) {
      this.throwInvalid('INVALID_TASK_DEADLINE');
    }
    return deadline;
  }

  /**
   * @description 把浏览器认证模块的 HTTP 领域异常转换为稳定的 gRPC 状态。
   * @keyword-cn 转换浏览器认证错误, 协议错误映射
   * @keyword-en map-browser-auth-error, grpc-error-mapping
   */
  private async callBrowserAuthOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const httpStatus = error.getStatus();
      const grpcCode =
        httpStatus === 400
          ? status.INVALID_ARGUMENT
          : httpStatus === 403
            ? status.PERMISSION_DENIED
            : httpStatus === 404
              ? status.NOT_FOUND
              : httpStatus === 503
                ? status.UNAVAILABLE
                : status.INTERNAL;
      throw new RpcException({ code: grpcCode, message: error.message });
    }
  }

  /**
   * @description 抛出稳定 INVALID_ARGUMENT gRPC 错误。
   * @keyword-cn 无效协议参数, 稳定错误码
   * @keyword-en invalid-protocol-argument, stable-error-code
   */
  private throwInvalid(message: string): never {
    throw new RpcException({ code: status.INVALID_ARGUMENT, message });
  }

  /**
   * @description 抛出稳定 NOT_FOUND gRPC 错误。
   * @keyword-cn 协议资源不存在, 稳定错误码
   * @keyword-en protocol-resource-not-found, stable-error-code
   */
  private throwNotFound(message: string): never {
    throw new RpcException({ code: status.NOT_FOUND, message });
  }
}
