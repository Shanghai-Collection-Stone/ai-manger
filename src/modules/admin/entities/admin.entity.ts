import { ObjectId } from 'mongodb';

/**
 * @description 后台用户角色
 * @keyword-en admin user role
 */
export type AdminUserRole = 'super_admin' | 'tenant_admin' | 'operator';

/**
 * @description 后台用户实体
 * @keyword-en admin user entity
 */
export interface AdminUserEntity {
  _id: ObjectId;
  username: string;
  passwordHash: string;
  displayName: string;
  role: AdminUserRole;
  tenantId?: string;
  enabled: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 登录会话实体
 * @keyword-en admin session entity
 */
export interface AdminSessionEntity {
  _id: ObjectId;
  sessionId: string;
  userId: string;
  tenantId?: string;
  role: AdminUserRole;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description AI提供商配置实体
 * @keyword-en ai provider settings entity
 */
export interface AdminAiProviderEntity {
  _id: ObjectId;
  providerCode: string;
  name: string;
  baseUrl?: string;
  modelCategory: 'llm' | 'em' | 'image';
  model?: string;
  apiKey?: string;
  enabled: boolean;
  isDefault?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description Claw 连通状态枚举
 * @keyword-en claw connect status
 */
export type ClawConnectStatus = 'unknown' | 'full' | 'api_only' | 'error';

/**
 * @description Claw 接入配置实体（OpenClaw 网关）
 * @keyword-en claw config entity, openclaw gateway
 */
export interface AdminClawConfigEntity {
  _id: ObjectId;
  name: string;
  description?: string;
  token: string;
  serviceUrl: string;
  /** 连通状态：unknown=未检测, full=完全通畅, api_only=接口通畅但skill未接, error=连接失败 */
  connectStatus?: ClawConnectStatus;
  /** 最近一次连通测试时间 */
  connectCheckedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description Agent 管理配置实体
 * @keyword-en agent config entity, admin agent management
 */
export interface AdminAgentConfigEntity {
  _id: ObjectId;
  name: string;
  /** 对应 auto-task-robot 中的 robot code（如 xhs_publisher / claw） */
  module: string;
  /** 当 module=claw 时指向 AdminClawConfigEntity._id */
  clawConfigId?: string;
  /** 当 module=claw 时指定 openclaw 的 agentId（默认 main） */
  clawAgentId?: string;
  /** Agent 提示词（markdown 格式） */
  prompt?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description LLM 设置实体
 * @keyword-en llm setting entity
 */
export interface AdminLlmSettingEntity {
  _id: ObjectId;
  /** 配图数量（默认6张） */
  imageCount: number;
  /** 封面是否使用 LLM */
  coverUseLlm: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 后台JWT载荷
 * @keyword-en admin jwt payload
 */
export interface AdminJwtPayload {
  sub: string;
  sid: string;
  role: AdminUserRole;
  tenantId?: string;
  username: string;
  exp: number;
  iat: number;
}

/**
 * @description 小红书账号登录状态
 * @keyword-en xhs account login status
 */
export type XhsAccountLoginStatus = 'unknown' | 'online' | 'offline' | 'error';

/**
 * @description 自媒体账号实体（多租户，支持多平台）
 * @keyword-en social media account entity, multi-platform
 */
export interface XhsAccountEntity {
  _id: ObjectId;
  /** 租户 ID */
  tenantId?: string;
  /** 平台类型，如 xhs（小红书），默认 xhs */
  platform?: string;
  /** 账号用户名（手机号/邮箱/昵称） */
  username: string;
  /** base64 加密的密码（可选） */
  passwordEncrypted?: string;
  /** 绑定的 AdsPower 浏览器配置文件 ID */
  adspowerId?: string;
  /** 绑定的 Claw 配置 ID */
  clawConfigId?: string;
  /** Claw Agent ID */
  clawAgentId?: string;
  /** 账号说明 */
  notes?: string;
  /** 登录状态 */
  loginStatus: XhsAccountLoginStatus;
  /** 最近登录时间 */
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
