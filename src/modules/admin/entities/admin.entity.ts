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
  /** 自助注册时经短信验证的手机号 */
  phone?: string;
  /** 关联的手机号账号 `admin_accounts._id`；有值时登录密码以账号为准，本行 passwordHash 不再参与校验 */
  accountId?: string;
  enabled: boolean;
  /**
   * 用户自助注销的时间。置位时同时把 `enabled` 落为 false——登录路径本来就拦 `enabled`
   * （`ACCOUNT_DISABLED`），因此注销后无法再登录。
   *
   * 注意当前只做到软删：**没有**任何定时任务会按本字段清理数据，注销后个人信息与业务内容
   * 仍留在库里。隐私政策第四节据此写的是「立即停用并保留，用户另行申请后 15 个工作日内彻底删除」，
   * 而不是承诺自动删除。将来补上清理任务时，隐私政策要同步改回自动删除的表述。
   */
  deletedAt?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 手机号账号实体：一个人一条，经 `admin_users.accountId` 关联多个租户成员身份
 * @keyword-cn 手机号账号, 多租户身份
 * @keyword-en phone-account-entity, multi-tenant-identity
 */
export interface AdminAccountEntity {
  _id: ObjectId;
  /** 已短信验证的大陆手机号，全局唯一 */
  phone: string;
  passwordHash: string;
  displayName: string;
  /** 自助注销时间。与名下全部 `admin_users` 一同置位，保留期内不释放手机号。 */
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 登录第一步签发的短期票据载荷，只能换取所列候选成员的会话，不能当作访问 token
 * @keyword-cn 登录票据, 候选租户
 * @keyword-en login-ticket-payload, tenant-candidates
 */
export interface AdminLoginTicketPayload {
  typ: 'login_ticket';
  /** 已通过密码校验的 `admin_users._id` 列表 */
  uids: string[];
  exp: number;
  iat: number;
}

/**
 * @description 登录第一步返回的可选租户项，`tenantId` 为空串表示平台端身份
 * @keyword-cn 可选租户, 登录租户选择
 * @keyword-en login-tenant-option, tenant-selection
 */
export interface AdminLoginTenantOption {
  tenantId: string;
  tenantName: string;
  role: AdminUserRole;
  displayName: string;
  lastLoginAt?: Date;
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
  /** llm 文本 / em 向量 / image 生图 / video 生视频 */
  modelCategory: 'llm' | 'em' | 'image' | 'video';
  model?: string;
  apiKey?: string;
  enabled: boolean;
  isDefault?: boolean;
  /** 一个 Credit 对应的 Token 数 */
  tokensPerCredit?: number;
  /** 每次物理调用固定计费 Token；空值表示按真实 usage */
  fixedTokensPerCall?: number;
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
