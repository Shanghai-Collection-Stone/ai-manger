import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
 * @description 校验发布库名称。
 * @keyword-cn 发布库名称参数
 * @keyword-en publish-library-name-dto
 */
export class CreateDouyinPublishLibraryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name!: string;
}

/**
 * @description 校验发布库改名参数。
 * @keyword-cn 发布库改名参数
 * @keyword-en update-publish-library-dto
 */
export class UpdateDouyinPublishLibraryDto extends CreateDouyinPublishLibraryDto {}

/**
 * @description 校验作品入库参数。
 * @keyword-cn 作品入库参数
 * @keyword-en create-publish-work-dto
 */
export class CreateDouyinPublishWorkDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  topicId?: number;

  @IsString()
  @MinLength(1)
  videoId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(21, { each: true })
  @Transform(({ value }: { value: unknown }): unknown =>
    Array.isArray(value)
      ? value.map((item) => String(item).replace(/^#+/, '').trim())
      : value,
  )
  tags?: string[];
}

/**
 * @description 校验作品可编辑字段与换库目标。
 * @keyword-cn 作品更新参数, 换库参数
 * @keyword-en update-publish-work-dto, move-library-dto
 */
export class UpdateDouyinPublishWorkDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(21, { each: true })
  @Transform(({ value }: { value: unknown }): unknown =>
    Array.isArray(value)
      ? value.map((item) => String(item).replace(/^#+/, '').trim())
      : value,
  )
  tags?: string[];

  @IsOptional()
  @IsMongoId()
  libraryId?: string;
}

/**
 * @description 校验小程序发布结果回写参数。
 * @keyword-cn 发布结果参数
 * @keyword-en publish-result-dto
 */
export class DouyinPublishResultDto {
  @IsIn(['published', 'failed'])
  status!: 'published' | 'failed';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  douyinVideoId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(21, { each: true })
  @Transform(({ value }: { value: unknown }): unknown =>
    Array.isArray(value)
      ? value.map((item) => String(item).replace(/^#+/, '').trim())
      : value,
  )
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  errorMessage?: string;
}
