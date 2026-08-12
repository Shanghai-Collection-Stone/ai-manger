import { ObjectId } from 'mongodb';

/**
 * @description 工作区协作附件，引用租户网盘中的真实文件节点(disk_nodes._id)，不另存二进制
 * @keyword-en workspace collab attachment
 * @keyword-cn 工作区协作附件
 */
export interface WorkspaceAttachment {
  /** 网盘文件节点 ID */
  nodeId: string;
  /** 冗余文件名，便于列表展示 */
  name: string;
  /** 冗余文件大小(字节) */
  sizeBytes: number;
}

/**
 * @description 工作区 Agent 实体(通讯录)，隶属租户，工作区成员可与其建立会话或指派任务
 * @keyword-en workspace agent entity
 * @keyword-cn 工作区Agent实体
 */
export interface WorkspaceAgentEntity {
  _id: ObjectId;
  /** 归属租户 */
  tenantId: string;
  /** 租户内唯一键，如 general / sheet / image */
  key: string;
  name: string;
  description: string;
  /** 通讯录图标类名(前端 agent-icon 修饰类) */
  icon: string;
  /** 会话图标类名(前端 session-icon 修饰类) */
  accent: string;
  /** 是否在通讯录中可用 */
  enabled: boolean;
  /** 是否接入 AI 运行时自动回复；关闭时会话只记录成员消息 */
  aiEnabled: boolean;
  /** AI 运行时提供商编码(接 chat-main 时透传) */
  aiProvider?: string;
  /** AI 运行时模型名(接 chat-main 时透传) */
  aiModel?: string;
  /** 通讯录排序 */
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 工作区会话消息角色(成员发出/Agent 回复)
 * @keyword-en workspace message role
 * @keyword-cn 会话消息角色
 */
export type WorkspaceMessageRole = 'user' | 'agent';

/**
 * @description 工作区会话实体，一条会话固定绑定一个 Agent，隶属某工作区
 * @keyword-en workspace conversation entity
 * @keyword-cn 工作区会话实体
 */
export interface WorkspaceConversationEntity {
  _id: ObjectId;
  tenantId: string;
  workspaceId: string;
  /** 绑定的 Agent 键 */
  agentKey: string;
  /** 冗余 Agent 名称，便于列表展示 */
  agentName: string;
  title: string;
  /** 会话摘要(取自 Agent 简介或最近一条消息) */
  summary: string;
  /** AI 运行时上下文会话 ID，开启 aiEnabled 时透传给 chat-main */
  sessionId: string;
  createdBy: string;
  createdByName: string;
  messageCount: number;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 工作区会话消息实体
 * @keyword-en workspace conversation message entity
 * @keyword-cn 工作区会话消息实体
 */
export interface WorkspaceMessageEntity {
  _id: ObjectId;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  role: WorkspaceMessageRole;
  /** 成员消息为发送者后台用户 ID；Agent 回复为空 */
  authorUserId?: string;
  /** 展示用作者名(成员昵称或 Agent 名) */
  authorName: string;
  text: string;
  attachments: WorkspaceAttachment[];
  createdAt: Date;
}

/**
 * @description 工作区任务状态
 * @keyword-en workspace task status
 * @keyword-cn 工作区任务状态
 */
export type WorkspaceTaskStatus = 'in_progress' | 'completed' | 'failed';

/**
 * @description 任务承接方类型(成员/Agent)
 * @keyword-en workspace task assignee type
 * @keyword-cn 任务承接方类型
 */
export type WorkspaceTaskAssigneeType = 'user' | 'agent';

/**
 * @description 工作区任务实体，隶属某工作区，可指派给成员或 Agent
 * @keyword-en workspace task entity
 * @keyword-cn 工作区任务实体
 */
export interface WorkspaceTaskEntity {
  _id: ObjectId;
  tenantId: string;
  workspaceId: string;
  title: string;
  description?: string;
  status: WorkspaceTaskStatus;
  createdBy: string;
  createdByName: string;
  assigneeType: WorkspaceTaskAssigneeType;
  /** assigneeType=user 时为 admin_users._id；=agent 时为 Agent 键 */
  assigneeId: string;
  /** 冗余承接方名称，便于列表展示 */
  assigneeName: string;
  /** 截止时间，可空 */
  dueAt?: Date;
  attachments: WorkspaceAttachment[];
  followupCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 工作区任务跟进记录实体
 * @keyword-en workspace task followup entity
 * @keyword-cn 任务跟进记录实体
 */
export interface WorkspaceTaskFollowupEntity {
  _id: ObjectId;
  tenantId: string;
  workspaceId: string;
  taskId: string;
  authorUserId: string;
  authorName: string;
  text: string;
  attachments: WorkspaceAttachment[];
  createdAt: Date;
}
