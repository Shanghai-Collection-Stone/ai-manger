import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  OpsLogKind,
  OpsLogLevel,
  OpsReportStatus,
} from '../entities/ops-report.entity.js';

/**
 * @description 桌面客户端环境信息请求体
 * @keyword-cn 客户端环境请求体
 * @keyword-en ops-client-dto
 */
export class OpsReportClientDto {
  @IsString()
  appVersion!: string;

  @IsOptional()
  @IsString()
  shellVersion?: string;

  @IsOptional()
  @IsString()
  workbenchVersion?: string;

  @IsString()
  platform!: string;

  @IsOptional()
  @IsString()
  arch?: string;

  @IsOptional()
  @IsString()
  osVersion?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  boardId?: string;
}

/**
 * @description 单条运维错误或警告日志请求体
 * @keyword-cn 上报日志请求体
 * @keyword-en ops-log-entry-dto
 */
export class OpsLogEntryDto {
  @IsISO8601()
  ts!: string;

  @IsIn(['api', 'page', 'main', 'crash'])
  kind!: OpsLogKind;

  @IsIn(['error', 'warn'])
  level!: OpsLogLevel;

  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  url?: string;

  @IsOptional()
  @IsInt()
  status?: number;

  @IsOptional()
  @IsNumber()
  durationMs?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  page?: string;
}

/**
 * @description 创建运维上报请求体
 * @keyword-cn 创建上报请求体
 * @keyword-en create-ops-report-dto
 */
export class CreateOpsReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact?: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => OpsReportClientDto)
  client!: OpsReportClientDto;

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => OpsLogEntryDto)
  entries!: OpsLogEntryDto[];
}

/**
 * @description 运维上报列表查询参数
 * @keyword-cn 上报列表查询
 * @keyword-en list-ops-report-query
 */
export class ListOpsReportQueryDto {
  @IsOptional()
  @IsIn(['open', 'processing', 'resolved', 'all'])
  status: OpsReportStatus | 'all' = 'all';

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize = 20;
}

/**
 * @description 更新运维上报处理状态请求体
 * @keyword-cn 更新上报请求体
 * @keyword-en update-ops-report-dto
 */
export class UpdateOpsReportDto {
  @IsIn(['open', 'processing', 'resolved'])
  status!: OpsReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  handlerNote?: string;
}
