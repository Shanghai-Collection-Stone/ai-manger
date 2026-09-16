import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsObject,
  Max,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';
import type {
  DataSourceStatus,
  MongoConnectionConfig,
} from '../../data-source/entities/data-source.entity.js';
import type { AdminUserRole } from '../entities/admin.entity.js';

/**
 * @description 登录请求体
 * @keyword-en admin login dto
 */
export class AdminLoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(120)
  password!: string;

  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 两步登录第一步请求体：账号可为手机号或历史用户名
 * @keyword-cn 登录识别请求体, 手机号登录
 * @keyword-en login-identify-dto, phone-login
 */
export class AdminLoginIdentifyDto {
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  account!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(120)
  password!: string;
}

/**
 * @description 两步登录第二步请求体：用登录票据选择租户，平台端身份不传 tenantId
 * @keyword-cn 选择租户请求体, 登录票据
 * @keyword-en login-select-dto, login-ticket
 */
export class AdminLoginSelectDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  loginTicket!: string;

  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 自助注册请求体：以已验证手机号为身份固定注册进默认租户；tenantName 仅为兼容旧客户端保留且被忽略
 * @keyword-cn 自助注册请求体, 默认租户
 * @keyword-en admin-register-dto, default-tenant
 */
export class AdminRegisterDto {
  /** @deprecated 旧客户端字段，服务端忽略 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tenantName?: string;

  /** 旧客户端会传；缺省时用户名取手机号 */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(120)
  password!: string;
}

/**
 * @description 创建后台用户请求体
 * @keyword-en create admin user dto
 */
export class CreateAdminUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  username!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(120)
  password!: string;

  @IsIn(['super_admin', 'tenant_admin', 'operator'])
  role!: AdminUserRole;

  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  /** 填写后按手机号关联账号：已有账号直接加入本租户（沿用其密码），没有则用本次密码新建 */
  @IsOptional()
  @Matches(/^1[3-9]\d{9}$/, { message: 'PHONE_INVALID' })
  phone?: string;
}

/**
 * @description 更新后台用户请求体
 * @keyword-en update admin user dto
 */
export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(120)
  password?: string;

  @IsOptional()
  @IsIn(['super_admin', 'tenant_admin', 'operator'])
  role?: AdminUserRole;

  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * @description AI提供商配置请求体
 * @keyword-en upsert ai provider dto
 */
export class UpsertAiProviderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  providerCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsString()
  @IsIn(['llm', 'em', 'image'])
  modelCategory!: 'llm' | 'em' | 'image';

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(300)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  tokensPerCredit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  fixedTokensPerCall?: number;
}

/**
 * @description 更新AI提供商配置请求体
 * @keyword-en update ai provider dto
 */
export class UpdateAiProviderDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  providerCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsIn(['llm', 'em', 'image'])
  modelCategory?: 'llm' | 'em' | 'image';

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(300)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  tokensPerCredit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  fixedTokensPerCall?: number;
}

/**
 * @description 更新固定 AI 服务 Credit 消耗点数请求体。
 * @keyword-cn 更新服务点数, 服务计费
 * @keyword-en update-service-credit, service-billing
 */
export class UpdateAiServiceCreditDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1_000_000)
  creditCost!: number;
}

/**
 * @description 租户 Credit 充值请求体，充值只追加流水。
 * @keyword-cn 租户充值, 追加流水
 * @keyword-en tenant-recharge, append-ledger
 */
export class RechargeTenantCreditDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(1_000_000_000)
  amount!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceId?: string;
}

/**
 * @description 租户 Credit 人工增减调账请求体，零变动不允许入账。
 * @keyword-cn 人工调账, 非零变动
 * @keyword-en manual-adjustment, nonzero-change
 */
export class AdjustTenantCreditDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  @NotEquals(0)
  amount!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceId?: string;
}

/**
 * @description 创建租户请求体
 * @keyword-en create tenant dto for admin
 */
export class CreateTenantByAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  xhsArticleConcurrencyLimit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1_000_000_000)
  credit?: number;
}

/**
 * @description 更新租户请求体
 * @keyword-en update tenant dto for admin
 */
export class UpdateTenantByAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  xhsArticleConcurrencyLimit?: number;
}

/**
 * @description 创建key请求体
 * @keyword-en create api key dto for admin
 */
export class CreateApiKeyByAdminDto {
  @IsMongoId()
  tenantId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500)
  expireDays?: number;
}

/**
 * @description 更新key请求体
 * @keyword-en update api key dto for admin
 */
export class UpdateApiKeyByAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  revokedAt?: string;
}

/**
 * @description 创建数据源请求体
 * @keyword-en create data source dto for admin
 */
export class CreateDataSourceByAdminDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  moduleRef!: string;

  @IsOptional()
  @IsIn(['mongo', 'api'])
  sourceType?: 'mongo' | 'api';

  @IsOptional()
  @IsIn(['platform', 'tenant'])
  scope?: 'platform' | 'tenant';

  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  @IsOptional()
  @IsObject()
  connection?: MongoConnectionConfig;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: DataSourceStatus;
}

/**
 * @description 更新数据源请求体
 * @keyword-en update data source dto
 */
export class UpdateDataSourceByAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  moduleRef?: string;

  @IsOptional()
  @IsIn(['mongo', 'api'])
  sourceType?: 'mongo' | 'api';

  @IsOptional()
  @IsIn(['platform', 'tenant'])
  scope?: 'platform' | 'tenant';

  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  @IsOptional()
  @IsObject()
  connection?: MongoConnectionConfig;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: DataSourceStatus;
}

/**
 * @description 创建 Claw 接入配置请求体
 * @keyword-en create claw config dto
 */
export class CreateClawConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  token!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  serviceUrl!: string;
}

/**
 * @description 更新 Claw 接入配置请求体
 * @keyword-en update claw config dto
 */
export class UpdateClawConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  token?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  serviceUrl?: string;
}

/**
 * @description 创建 Agent 管理配置请求体
 * @keyword-en create agent config dto
 */
export class CreateAgentConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  module!: string;

  @IsOptional()
  @IsMongoId()
  clawConfigId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  clawAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  prompt?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * @description 更新 Agent 管理配置请求体
 * @keyword-en update agent config dto
 */
export class UpdateAgentConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  module?: string;

  @IsOptional()
  @IsMongoId()
  clawConfigId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  clawAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  prompt?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * @description 平台AI配置请求体
 * @keyword-en upsert platform info dto
 */
export class UpsertPlatformInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  aiPromptSupplement?: string;

  @IsOptional()
  @IsBoolean()
  enableAiCover?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  xhsArticleGlobalConcurrencyLimit?: number;

  /** 注册页业务员微信二维码：http(s) 地址或 data:image base64，空串表示清除 */
  @IsOptional()
  @IsString()
  @MaxLength(700000)
  @Matches(/^$|^https?:\/\/|^data:image\/(png|jpeg|webp);base64,/, {
    message: 'SALES_QRCODE_URL_INVALID',
  })
  salesWechatQrCodeUrl?: string;

  /** 业务员二维码提示语 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  salesContactTip?: string;
}

/**
 * @description LLM 设置请求体
 * @keyword-en llm setting dto
 */
export class UpsertLlmSettingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  imageCount?: number;

  @IsOptional()
  @IsBoolean()
  coverUseLlm?: boolean;
}

/**
 * @description 更新 LLM 设置请求体
 * @keyword-en update llm setting dto
 */
export class UpdateLlmSettingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  imageCount?: number;

  @IsOptional()
  @IsBoolean()
  coverUseLlm?: boolean;
}

/**
 * @description 创建自媒体账号请求体（通用，platform 区分平台）
 * @keyword-en create social account dto
 */
export class CreateXhsAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  platform?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  passwordEncrypted?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  adspowerId?: string;

  @IsOptional()
  @IsMongoId()
  clawConfigId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  clawAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * @description 更新小红书账号请求体
 * @keyword-en update xhs account dto
 */
export class UpdateXhsAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  passwordEncrypted?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  adspowerId?: string;

  @IsOptional()
  @IsMongoId()
  clawConfigId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  clawAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
