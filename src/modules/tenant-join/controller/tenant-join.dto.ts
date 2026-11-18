import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * @description 支持随便逛逛（默认租户）、邀请码或公司名称申请三种加入方式的注册请求体；手机号或邮箱只填一个并用验证码验证
 * @keyword-cn 租户入驻注册请求体
 * @keyword-en tenant-join-register-dto
 */
export class TenantJoinRegisterDto {
  @IsString()
  @MinLength(6)
  @MaxLength(120)
  password!: string;

  /** 兼容旧客户端：带了手机号却没带短信验证码时留在 body，只做格式校验，不会保存（只保存验证过的手机号） */
  @IsOptional()
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: 'SMS_PHONE_INVALID' })
  smsPhone?: string;

  /** 用邮箱注册时由邮箱验证码守卫校验；没带邮箱验证码时不会保存 */
  @IsOptional()
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{22}$/, { message: 'INVITE_CODE_INVALID' })
  inviteCode?: string;

  /** 注册时按公司名称申请加入；与 inviteCode 互斥，都不填即随便逛逛进默认租户 */
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'COMPANY_NAME_INVALID' })
  @MaxLength(60, { message: 'COMPANY_NAME_INVALID' })
  companyName?: string;
}

/**
 * @description 已有账号接受邀请请求体
 * @keyword-cn 接受邀请请求体
 * @keyword-en accept-invite-dto
 */
export class AcceptInviteDto {
  /** 已有账号的手机号或注册邮箱 */
  @IsString()
  @MaxLength(254)
  @Matches(/^(1[3-9]\d{9}|[^\s@]+@[^\s@]+\.[^\s@]+)$/, {
    message: 'PHONE_INVALID',
  })
  account!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(120)
  password!: string;
}

/**
 * @description 入驻申请列表查询参数
 * @keyword-cn 入驻申请查询参数
 * @keyword-en join-application-query-dto
 */
export class ApplicationListQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'all'])
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'all';

  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

/**
 * @description 拒绝入驻申请请求体
 * @keyword-cn 拒绝申请请求体
 * @keyword-en reject-application-dto
 */
export class RejectApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * @description 邀请列表查询参数
 * @keyword-cn 邀请列表查询参数
 * @keyword-en invite-list-query-dto
 */
export class InviteListQueryDto {
  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 创建租户邀请请求体
 * @keyword-cn 创建租户邀请请求体
 * @keyword-en create-invite-dto
 */
export class CreateInviteDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays = 7;

  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}
