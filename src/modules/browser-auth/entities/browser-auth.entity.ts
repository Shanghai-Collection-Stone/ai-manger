import type { ObjectId } from 'mongodb';

/**
 * @description AES-GCM 加密后的浏览器认证敏感值，只保存密文、随机向量和认证标签。
 * @keyword-cn 浏览器认证密文, 认证标签
 * @keyword-en browser-auth-ciphertext, authentication-tag
 */
export interface BrowserAuthSecretEnvelope {
  algorithm: 'aes-256-gcm';
  keyVersion: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * @description 按租户、工作区、站点和浏览器配置隔离的持久化登录会话。
 * @keyword-cn 浏览器登录会话, 工作区隔离
 * @keyword-en browser-login-session, workspace-isolation
 */
export interface BrowserSessionEntity {
  _id: ObjectId;
  scopeId: string;
  tenantId?: string;
  workspaceId: string;
  site: string;
  profile: string;
  storageState: BrowserAuthSecretEnvelope;
  expiresAt: Date;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 节点读取浏览器会话时返回的明文视图，明文只存在于本次受鉴权调用响应中。
 * @keyword-cn 浏览器会话视图, 临时明文
 * @keyword-en browser-session-view, transient-plaintext
 */
export interface BrowserSessionView {
  found: boolean;
  site: string;
  profile: string;
  storageStateJson: string;
  expiresAt: string;
  updatedAt: string;
}

/**
 * @description 任务等待用户时支持的交互类型：扫码登录或简短文本回复。
 * @keyword-cn 任务交互类型, 扫码登录
 * @keyword-en task-interaction-kind, qr-login
 */
export type BrowserAuthInteractionKind = 'qr_login' | 'short_text';

/**
 * @description 任务交互生命周期状态。
 * @keyword-cn 任务交互状态, 用户回调
 * @keyword-en task-interaction-status, user-callback
 */
export type BrowserAuthInteractionStatus =
  'pending' | 'answered' | 'expired' | 'cancelled';

/**
 * @description 与单个 Todo 绑定的用户交互请求，二维码内容与回复均加密保存。
 * @keyword-cn 任务交互请求, 加密二维码
 * @keyword-en task-interaction-request, encrypted-qr
 */
export interface BrowserAuthInteractionEntity {
  _id: ObjectId;
  id: string;
  todoId: number;
  scopeId: string;
  tenantId?: string;
  userId: string;
  workspaceId: string;
  sessionId?: string;
  kind: BrowserAuthInteractionKind;
  status: BrowserAuthInteractionStatus;
  title: string;
  prompt: string;
  qrContent?: BrowserAuthSecretEnvelope;
  response?: BrowserAuthSecretEnvelope;
  expiresAt: Date;
  answeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 对用户或节点可见的任务交互安全视图，不包含数据库密文结构。
 * @keyword-cn 任务交互视图, 安全展示
 * @keyword-en task-interaction-view, safe-display
 */
export interface BrowserAuthInteractionView {
  id: string;
  todoId: number;
  kind: BrowserAuthInteractionKind;
  status: BrowserAuthInteractionStatus;
  title: string;
  prompt: string;
  qrContent?: string;
  response?: string;
  expiresAt: string;
  answeredAt?: string;
  createdAt: string;
}

/**
 * @description 节点查询任务交互时使用的可空响应包装。
 * @keyword-cn 任务交互响应, 可空包装
 * @keyword-en task-interaction-response, optional-envelope
 */
export interface BrowserAuthInteractionEnvelope {
  found: boolean;
  interaction?: BrowserAuthInteractionView;
}
