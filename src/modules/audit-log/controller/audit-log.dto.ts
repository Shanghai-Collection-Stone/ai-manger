import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * @description 审计日志查询请求体(query 参数)，全部可选，按租户隔离由服务层强制
 * @keyword-en audit log query dto
 * @keyword-cn 审计查询请求体
 */
export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @IsOptional()
  @IsIn([
    'workspace',
    'workspace_member',
    'workspace_agent',
    'workspace_conversation',
    'workspace_task',
    'disk_node',
    'disk_root',
    'notice',
  ])
  targetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorUserId?: string;

  @IsOptional()
  @IsISO8601()
  since?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
