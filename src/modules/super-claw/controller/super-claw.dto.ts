import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * @description 创建 SuperClaw 节点请求体
 * @keyword-cn 创建节点参数, 容量校验
 * @keyword-en create-node-dto, capacity-validation
 */
export class CreateSuperClawDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  capacity!: number;
}

/**
 * @description 更新 SuperClaw 节点请求体
 * @keyword-cn 更新节点参数, 容量校验
 * @keyword-en update-node-dto, capacity-validation
 */
export class UpdateSuperClawDto {
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
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  capacity?: number;
}

/**
 * @description 租户 SuperClaw 节点归属请求体，superClawId 为空表示解除归属
 * @keyword-cn 租户节点参数, 归属校验
 * @keyword-en tenant-node-dto, assignment-validation
 */
export class AssignTenantSuperClawDto {
  @IsOptional()
  @IsMongoId()
  superClawId?: string | null;
}
