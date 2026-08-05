import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * @description 创建工作区请求体
 * @keyword-en create workspace dto
 * @keyword-cn 创建工作区请求体
 */
export class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** 容量设定(字节)，0 或省略表示不限 */
  @IsOptional()
  @IsInt()
  @Min(0)
  capacityBytes?: number;

  /** 仅平台超管创建时需指定归属租户 */
  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 更新工作区请求体
 * @keyword-en update workspace dto
 * @keyword-cn 更新工作区请求体
 */
export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacityBytes?: number;
}

/**
 * @description 添加工作区成员请求体
 * @keyword-en add workspace member dto
 * @keyword-cn 添加成员请求体
 */
export class AddWorkspaceMemberDto {
  @IsMongoId()
  userId!: string;

  @IsIn(['owner', 'editor', 'viewer'])
  role!: 'owner' | 'editor' | 'viewer';
}

/**
 * @description 更新工作区成员角色请求体
 * @keyword-en update workspace member dto
 * @keyword-cn 更新成员请求体
 */
export class UpdateWorkspaceMemberDto {
  @IsIn(['owner', 'editor', 'viewer'])
  role!: 'owner' | 'editor' | 'viewer';
}
