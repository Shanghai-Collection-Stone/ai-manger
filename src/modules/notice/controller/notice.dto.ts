import {
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * @description 创建通知请求体
 * @keyword-en create notice dto
 * @keyword-cn 创建通知请求体
 */
export class CreateNoticeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  /** 定向接收人后台用户 ID 列表；空/省略 = 租户全体 */
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  recipients?: string[];
}

/**
 * @description 更新通知请求体
 * @keyword-en update notice dto
 * @keyword-cn 更新通知请求体
 */
export class UpdateNoticeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  recipients?: string[];
}

/**
 * @description 通知列表状态过滤 query 参数
 * @keyword-en notice list query dto
 * @keyword-cn 通知列表过滤
 */
export class ListNoticesQueryDto {
  @IsOptional()
  @IsIn(['draft', 'published', 'revoked'])
  status?: string;
}

/**
 * @description 我的通知 query 参数(可选仅未读)
 * @keyword-en my notices query dto
 * @keyword-cn 我的通知过滤
 */
export class MyNoticesQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyUnread?: boolean;
}
