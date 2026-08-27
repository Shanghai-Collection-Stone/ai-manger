/**
 * @description 所有租户级 SuperClaw gRPC 请求的公共作用域。
 * @keyword-cn gRPC租户请求, 节点租户作用域
 * @keyword-en grpc-tenant-request, node-tenant-scope
 */
export interface SuperClawTenantRequest {
  tenantId?: string;
}

/**
 * @description 发起租户 AI 对话的 gRPC 请求。
 * @keyword-cn 发起租户对话, 非流式对话
 * @keyword-en start-tenant-conversation, non-stream-chat
 */
export interface SuperClawStartConversationRequest extends SuperClawTenantRequest {
  userId?: string;
  sessionId?: string;
  input?: string;
  sessionType?: string;
  workspaceId?: string;
}

/**
 * @description gRPC 对话列表项与发起对话响应类型。
 * @keyword-cn 对话协议响应, 会话列表
 * @keyword-en conversation-protocol-response, session-list
 */
export interface SuperClawConversationView {
  sessionId: string;
  sessionType: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
}

/**
 * @description gRPC 工作区安全视图，不包含内部节点字段。
 * @keyword-cn 工作区协议视图, 租户工作区
 * @keyword-en workspace-protocol-view, tenant-workspace
 */
export interface SuperClawWorkspaceView {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  capacityBytes: string;
  usedBytes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * @description gRPC 任务关联资源消息。
 * @keyword-cn 任务资源协议, 关联资源
 * @keyword-en task-resource-protocol, associated-resource
 */
export interface SuperClawTaskResourceMessage {
  type?: string;
  resourceId?: string;
}

/**
 * @description 节点可见的任务视图，永不直接嵌入任务专用 Token。
 * @keyword-cn gRPC任务视图, 隐藏任务令牌
 * @keyword-en grpc-task-view, hide-task-token
 */
export interface SuperClawTaskView {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  description: string;
  type: string;
  category: string;
  assignee: string;
  status: string;
  aiConsideration: string;
  decisionReason: string;
  aiPlan: string;
  abnormalReason: string;
  taskResult: string;
  deadline: string;
  createdAt: string;
  updatedAt: string;
  associatedResources: Array<{ type: string; resourceId: string }>;
  workspaceId: string;
  sessionId: string;
  executionGuidance: string;
}

/**
 * @description 平台要求租户绑定节点创建一个持久工作区。
 * @keyword-cn 创建节点工作区, 工作区容量
 * @keyword-en provision-node-workspace, workspace-capacity
 */
export interface SuperClawWorkspaceProvision {
  deliveryId: string;
  workspaceId: string;
  tenantId: string;
  name: string;
  description: string;
  capacityBytes: string;
}

/**
 * @description 节点回报工作区创建成功或失败。
 * @keyword-cn 确认工作区创建, 节点同步结果
 * @keyword-en acknowledge-workspace-provision, node-sync-result
 */
export interface SuperClawWorkspaceProvisionAck {
  deliveryId?: string;
  workspaceId?: string;
  success?: boolean;
  error?: string;
}

/**
 * @description 单任务响应包；仅领取、创建和通过专用 Token 读取时返回 taskToken。
 * @keyword-cn 任务下发响应, 专用令牌
 * @keyword-en task-dispatch-envelope, dedicated-token
 */
export interface SuperClawTaskEnvelope {
  found: boolean;
  task?: SuperClawTaskView;
  taskToken: string;
}

/**
 * @description 节点声明主动推送通道已经准备好接收任务。
 * @keyword-cn 任务通道就绪, 节点执行槽位
 * @keyword-en task-channel-ready, node-execution-slot
 */
export interface SuperClawTaskChannelReady {
  instanceId?: string;
  availableSlots?: number;
}

/**
 * @description 节点确认已在内存中接收一条主动推送任务。
 * @keyword-cn 确认任务投递, 推送消息确认
 * @keyword-en acknowledge-task-delivery, push-message-ack
 */
export interface SuperClawTaskDeliveryAck {
  deliveryId?: string;
  taskId?: string;
}

/**
 * @description 节点拒绝当前任务投递并携带诊断原因。
 * @keyword-cn 拒绝任务投递, 释放任务租约
 * @keyword-en reject-task-delivery, release-task-lease
 */
export interface SuperClawTaskDeliveryNack extends SuperClawTaskDeliveryAck {
  reason?: string;
  retryable?: boolean;
}

/**
 * @description 节点为当前内存任务续期平台执行租约。
 * @keyword-cn 任务租约心跳, 无状态执行器续期
 * @keyword-en task-lease-heartbeat, stateless-executor-renewal
 */
export type SuperClawTaskLeaseHeartbeat = SuperClawTaskDeliveryAck;

/**
 * @description 节点确认任务终态已经通过任务 Token 成功写回平台。
 * @keyword-cn 确认任务完成, 释放执行槽位
 * @keyword-en confirm-task-completion, release-execution-slot
 */
export type SuperClawTaskDeliveryComplete = SuperClawTaskDeliveryAck;

/**
 * @description SuperClaw 双向任务通道的节点上行消息。
 * @keyword-cn 任务通道上行, 节点通道消息
 * @keyword-en task-channel-request, node-channel-message
 */
export interface SuperClawTaskChannelRequest {
  ready?: SuperClawTaskChannelReady;
  ack?: SuperClawTaskDeliveryAck;
  nack?: SuperClawTaskDeliveryNack;
  lease?: SuperClawTaskLeaseHeartbeat;
  completed?: SuperClawTaskDeliveryComplete;
  ping?: { clientTime?: string };
  workspaceAck?: SuperClawWorkspaceProvisionAck;
}

/**
 * @description 平台根据节点租户归属主动推送的单次任务消息。
 * @keyword-cn 主动推送任务, 服务端租户路由
 * @keyword-en active-task-push, server-tenant-routing
 */
export interface SuperClawTaskDispatch {
  deliveryId: string;
  task: SuperClawTaskView;
  taskToken: string;
  dispatchedAt: string;
  ackDeadline: string;
  leaseSeconds: number;
  attempt: number;
}

/**
 * @description SuperClaw 双向任务通道的平台下行事件。
 * @keyword-cn 任务通道下行, 平台推送事件
 * @keyword-en task-channel-event, platform-push-event
 */
export interface SuperClawTaskChannelEvent {
  hello?: {
    superClawId: string;
    serverTime: string;
    ackTimeoutSeconds: number;
    leaseSeconds: number;
  };
  task?: SuperClawTaskDispatch;
  pong?: { clientTime: string; serverTime: string };
  workspace?: SuperClawWorkspaceProvision;
}

/**
 * @description 节点通过 gRPC 创建平台任务的请求。
 * @keyword-cn gRPC创建任务, 节点任务输入
 * @keyword-en grpc-create-task, node-task-input
 */
export interface SuperClawCreateTaskRequest extends SuperClawTenantRequest {
  userId?: string;
  title?: string;
  description?: string;
  type?: string;
  category?: string;
  assignee?: string;
  aiConsideration?: string;
  decisionReason?: string;
  aiPlan?: string;
  deadline?: string;
  associatedResources?: SuperClawTaskResourceMessage[];
  workspaceId?: string;
  sessionId?: string;
}

/**
 * @description 租户任务列表请求，可按精确状态过滤。
 * @keyword-cn gRPC任务列表, 状态过滤
 * @keyword-en grpc-task-list, status-filter
 */
export interface SuperClawListTasksRequest extends SuperClawTenantRequest {
  status?: string;
}

/**
 * @description 使用任务专用 Token 定位单个任务的公共请求。
 * @keyword-cn 任务令牌请求, 单任务鉴权
 * @keyword-en task-token-request, single-task-auth
 */
export interface SuperClawTaskTokenRequest extends SuperClawTenantRequest {
  taskId?: string;
  taskToken?: string;
}

/**
 * @description SuperClaw 回传的小红书热门评论快照。
 * @keyword-cn 小红书评论消息, gRPC评论快照
 * @keyword-en xhs-comment-message, grpc-comment-snapshot
 */
export interface SuperClawXhsTopCommentMessage {
  content?: string;
  likeCount?: string;
  replyCount?: string;
}

/**
 * @description SuperClaw 数据抓取 Agent 通过 gRPC 回传的小红书帖子指标。
 * @keyword-cn 小红书指标消息, gRPC采集回传
 * @keyword-en xhs-stat-message, grpc-collection-writeback
 */
export interface SuperClawXhsPostStatMessage {
  tag?: string;
  postTitle?: string;
  postUrl?: string;
  authorUrl?: string;
  likeCount?: string;
  commentCount?: string;
  collectCount?: string;
  viewCount?: string;
  shareCount?: string;
  topComments?: SuperClawXhsTopCommentMessage[];
  dataAt?: string;
}

/**
 * @description 使用任务专用 Token 更新允许字段的请求。
 * @keyword-cn gRPC更新任务, 令牌写入
 * @keyword-en grpc-update-task, token-authorized-write
 */
export interface SuperClawUpdateTaskRequest extends SuperClawTaskTokenRequest {
  title?: string;
  description?: string;
  status?: string;
  abnormalReason?: string;
  taskResult?: string;
  xhsStats?: SuperClawXhsPostStatMessage[];
}

/**
 * @description 使用任务专用 Token 读取或删除工作区浏览器会话。
 * @keyword-cn 浏览器会话请求, 任务令牌鉴权
 * @keyword-en browser-session-request, task-token-auth
 */
export interface SuperClawBrowserSessionRequest
  extends SuperClawTaskTokenRequest {
  site?: string;
  profile?: string;
}

/**
 * @description 使用任务专用 Token 保存 Playwright storageState。
 * @keyword-cn 保存浏览器会话请求, Cookie回传
 * @keyword-en upsert-browser-session-request, cookie-writeback
 */
export interface SuperClawUpsertBrowserSessionRequest
  extends SuperClawBrowserSessionRequest {
  storageStateJson?: string;
  expiresAt?: string;
}

/**
 * @description 节点创建二维码登录或简短文本交互的请求。
 * @keyword-cn 创建任务交互请求, 二维码登录
 * @keyword-en create-task-interaction-request, qr-login
 */
export interface SuperClawCreateTaskInteractionRequest
  extends SuperClawTaskTokenRequest {
  kind?: string;
  title?: string;
  prompt?: string;
  qrContent?: string;
  expiresAt?: string;
}

/**
 * @description 节点查询当前任务交互的请求，可指定交互 ID。
 * @keyword-cn 查询任务交互请求, 用户回复
 * @keyword-en get-task-interaction-request, user-response
 */
export interface SuperClawGetTaskInteractionRequest
  extends SuperClawTaskTokenRequest {
  interactionId?: string;
}
