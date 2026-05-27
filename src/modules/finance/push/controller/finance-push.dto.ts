import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * @description Upsert 推送配置请求体(每作用域一份;baseUrl 含 /api/v1;可绑定外部 webhook tenantId)
 * @keyword-en upsert finance push config dto
 */
export class UpsertFinancePushConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  baseUrl!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  apiKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalTenantId?: string;
}

/**
 * @description 立即推送请求体(可选时间窗,按 YYYY-MM-DD 过滤 occurredAt)
 * @keyword-en run finance push dto with optional date window
 */
export class RunFinancePushDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 必须是 YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 必须是 YYYY-MM-DD' })
  endDate?: string;
}
