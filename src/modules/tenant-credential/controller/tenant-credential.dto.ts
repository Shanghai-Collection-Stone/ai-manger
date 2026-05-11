import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * @description Upsert 飞书凭证请求体（tenantId 由登录态决定，不接受外部传入）
 * @keyword-en upsert feishu credential dto
 */
export class UpsertFeishuCredentialDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  appId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  appSecret!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remark?: string;
}

/**
 * @description 更新飞书凭证请求体
 * @keyword-en update feishu credential dto
 */
export class UpdateFeishuCredentialDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  appId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  appSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remark?: string;
}
