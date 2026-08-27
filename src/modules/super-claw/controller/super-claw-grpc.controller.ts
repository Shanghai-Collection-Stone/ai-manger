import { Controller, UseGuards } from '@nestjs/common';
import {
  GrpcMethod,
  GrpcStreamCall,
  RpcException,
} from '@nestjs/microservices';
import {
  status,
  type ServerDuplexStream,
  type ServerUnaryCall,
} from '@grpc/grpc-js';
import { ADMIN_SUBJECTS } from '../../admin/casl/admin-permission.constants.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type {
  SuperClawHeartbeatRequest,
  SuperClawHeartbeatResponse,
  SuperClawRegisterRequest,
  SuperClawRegisterResponse,
} from '../entities/super-claw.entity.js';
import type {
  SuperClawCreateTaskRequest,
  SuperClawCreateTaskInteractionRequest,
  SuperClawBrowserSessionRequest,
  SuperClawGetTaskInteractionRequest,
  SuperClawListTasksRequest,
  SuperClawStartConversationRequest,
  SuperClawTaskTokenRequest,
  SuperClawTenantRequest,
  SuperClawUpdateTaskRequest,
  SuperClawUpsertBrowserSessionRequest,
  SuperClawTaskChannelEvent,
  SuperClawTaskChannelRequest,
} from '../entities/super-claw-grpc.entity.js';
import {
  SuperClawTokenGuard,
  type AuthenticatedSuperClawCall,
} from '../guards/super-claw-token.guard.js';
import { SuperClawService } from '../services/super-claw.service.js';
import { SuperClawGatewayService } from '../services/super-claw-gateway.service.js';
import { SuperClawTaskChannelService } from '../services/super-claw-task-channel.service.js';

/**
 * @description SuperClaw gRPC 注册和心跳控制器
 * @keyword-cn gRPC控制器, 节点接入
 * @keyword-en grpc-controller, node-onboarding
 */
@Controller()
export class SuperClawGrpcController {
  constructor(
    private readonly superClawService: SuperClawService,
    private readonly gatewayService: SuperClawGatewayService,
    private readonly taskChannelService: SuperClawTaskChannelService,
  ) {}

  /**
   * @description 使用平台 Token 注册 SuperClaw 实例并建立连接状态
   * @keyword-cn 注册端点, 建立连接
   * @keyword-en register-endpoint, establish-connection
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'Register')
  async register(
    request: SuperClawRegisterRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ): Promise<SuperClawRegisterResponse> {
    return this.superClawService.register(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 接收已注册 SuperClaw 的连接心跳
   * @keyword-cn 心跳端点, 连接续期
   * @keyword-en heartbeat-endpoint, connection-renewal
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'Heartbeat')
  async heartbeat(
    request: SuperClawHeartbeatRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ): Promise<SuperClawHeartbeatResponse> {
    return this.superClawService.heartbeat(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 获取当前节点所辖租户的对话列表。
   * @keyword-cn 租户对话列表端点, gRPC会话查询
   * @keyword-en tenant-conversation-list-endpoint, grpc-session-query
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('read', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'ListConversations')
  async listConversations(
    request: SuperClawTenantRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.listConversations(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 在当前节点所辖租户范围发起非流式 AI 对话。
   * @keyword-cn 发起租户对话端点, gRPCAI对话
   * @keyword-en start-tenant-conversation-endpoint, grpc-ai-chat
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('create', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'StartConversation')
  async startConversation(
    request: SuperClawStartConversationRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.startConversation(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 获取当前节点所辖租户的工作区列表。
   * @keyword-cn 租户工作区端点, gRPC工作区查询
   * @keyword-en tenant-workspace-endpoint, grpc-workspace-query
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('read', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'ListWorkspaces')
  async listWorkspaces(
    request: SuperClawTenantRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.listWorkspaces(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 建立平台主动推送任务的双向 gRPC 通道，租户路由完全由服务端节点归属决定。
   * @keyword-cn 主动任务通道端点, 服务端租户路由
   * @keyword-en active-task-channel-endpoint, server-tenant-routing
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcStreamCall('SuperClawGateway', 'OpenTaskChannel')
  openTaskChannel(
    call: ServerDuplexStream<
      SuperClawTaskChannelRequest,
      SuperClawTaskChannelEvent
    >,
  ): void {
    this.taskChannelService.openTaskChannel(
      this.requireSuperClawId(call),
      call,
    );
  }

  /**
   * @description 原子领取并下发一条 SuperClaw 数据抓取任务，响应携带任务专用 Token。
   * @keyword-cn 下发任务端点, 任务专用令牌
   * @keyword-en dispatch-task-endpoint, dedicated-task-token
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'DispatchTask')
  async dispatchTask(
    request: SuperClawTenantRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.dispatchTask(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 节点向平台创建任务并取得任务专用 Token。
   * @keyword-cn 创建任务端点, 返回任务令牌
   * @keyword-en create-task-endpoint, return-task-token
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('create', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'CreateTask')
  async createTask(
    request: SuperClawCreateTaskRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.createTask(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 按租户列出任务且不返回任何任务专用 Token。
   * @keyword-cn 任务列表端点, 隐藏任务令牌
   * @keyword-en list-tasks-endpoint, hide-task-tokens
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('read', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'ListTasks')
  async listTasks(
    request: SuperClawListTasksRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.listTasks(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 使用任务专用 Token 获取单个任务。
   * @keyword-cn 获取任务端点, 任务令牌鉴权
   * @keyword-en get-task-endpoint, task-token-auth
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('read', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'GetTask')
  async getTask(
    request: SuperClawTaskTokenRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.getTask(this.requireSuperClawId(call), request);
  }

  /**
   * @description 使用任务专用 Token 更新单个任务。
   * @keyword-cn 更新任务端点, 任务状态回写
   * @keyword-en update-task-endpoint, task-status-writeback
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'UpdateTask')
  async updateTask(
    request: SuperClawUpdateTaskRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.updateTask(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 使用任务 Token 读取当前工作区保存的浏览器登录态。
   * @keyword-cn 读取浏览器会话端点, 工作区登录态
   * @keyword-en get-browser-session-endpoint, workspace-login-state
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('read', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'GetBrowserSession')
  async getBrowserSession(
    request: SuperClawBrowserSessionRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.getBrowserSession(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 使用任务 Token 加密保存当前工作区浏览器登录态。
   * @keyword-cn 保存浏览器会话端点, 加密Cookie
   * @keyword-en upsert-browser-session-endpoint, encrypted-cookie
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'UpsertBrowserSession')
  async upsertBrowserSession(
    request: SuperClawUpsertBrowserSessionRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.upsertBrowserSession(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 使用任务 Token 删除当前工作区失效的浏览器登录态。
   * @keyword-cn 失效浏览器会话端点, 删除Cookie
   * @keyword-en invalidate-browser-session-endpoint, delete-cookie
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('delete', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'InvalidateBrowserSession')
  async invalidateBrowserSession(
    request: SuperClawBrowserSessionRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.invalidateBrowserSession(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 为执行中的任务创建二维码登录或简短文本交互窗口。
   * @keyword-cn 创建任务交互端点, 二维码窗口
   * @keyword-en create-task-interaction-endpoint, qr-window
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'CreateTaskInteraction')
  async createTaskInteraction(
    request: SuperClawCreateTaskInteractionRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.createTaskInteraction(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 查询任务交互状态以及用户提交的简短回复。
   * @keyword-cn 查询任务交互端点, 用户回调
   * @keyword-en get-task-interaction-endpoint, user-callback
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('read', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'GetTaskInteraction')
  async getTaskInteraction(
    request: SuperClawGetTaskInteractionRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.getTaskInteraction(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 使用任务专用 Token 删除单个任务。
   * @keyword-cn 删除任务端点, 令牌删除
   * @keyword-en delete-task-endpoint, token-authorized-delete
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('delete', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'DeleteTask')
  async deleteTask(
    request: SuperClawTaskTokenRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ) {
    return this.gatewayService.deleteTask(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 从已认证 gRPC 调用读取 SuperClaw ID
   * @keyword-cn 读取节点身份, 鉴权上下文
   * @keyword-en read-node-identity, auth-context
   */
  private requireSuperClawId(call: AuthenticatedSuperClawCall): string {
    const id = call.superClawId;
    if (!id) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'INVALID_SUPER_CLAW_TOKEN',
      });
    }
    return id;
  }
}
