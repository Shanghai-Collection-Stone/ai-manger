import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * @description 列出网盘节点 query 参数
 * @keyword-en list nodes query dto
 * @keyword-cn 列节点查询体
 */
export class ListNodesQueryDto {
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;

  @IsOptional()
  @IsMongoId()
  parentId?: string;

  /** 目标租户；仅平台超管需要显式指定，租户用户传入会被拒绝 */
  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 读取网盘根 query 参数
 * @keyword-en disk root query dto
 * @keyword-cn 网盘根查询体
 */
export class DiskRootQueryDto {
  /** 目标租户；仅平台超管需要显式指定 */
  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 创建文件夹请求体
 * @keyword-en create folder dto
 * @keyword-cn 创建文件夹请求体
 */
export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsMongoId()
  workspaceId?: string;

  @IsOptional()
  @IsMongoId()
  parentId?: string;

  /** 目标租户；仅平台超管需要显式指定 */
  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 上传文件的附带表单字段(文件本体走 multipart file 字段)
 * @keyword-en upload file dto
 * @keyword-cn 上传文件表单
 */
export class UploadFileDto {
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;

  @IsOptional()
  @IsMongoId()
  parentId?: string;

  /** 目标租户；仅平台超管需要显式指定 */
  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}

/**
 * @description 重命名节点请求体
 * @keyword-en rename node dto
 * @keyword-cn 重命名节点请求体
 */
export class RenameNodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

/**
 * @description 设置租户网盘容量请求体
 * @keyword-en update disk root dto
 * @keyword-cn 设置网盘容量请求体
 */
export class UpdateDiskRootDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  capacityBytes!: number;

  /** 目标租户；平台超管为租户分配容量时必填 */
  @IsOptional()
  @IsMongoId()
  tenantId?: string;
}
