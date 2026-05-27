import {
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * @description Upsert 看板配置映射请求体
 * @keyword-en upsert dashboard config mapping dto
 */
export class UpsertDashboardConfigMappingDto {
  @IsOptional()
  @IsString()
  dashboardCode?: string;

  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  @IsString()
  @MinLength(1)
  filePath!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
