import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * @description 单张图库图片元数据更新请求。
 * @keyword-cn 图片元数据, 单图更新
 * @keyword-en image-metadata, single-image-update
 */
export class UpdateGalleryImageMetaDto {
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(500, { message: '备注不能超过500字' })
  note?: string;

  @IsOptional()
  @IsBoolean({ message: '收藏状态必须是布尔值' })
  favorite?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'AI人脸保护状态必须是布尔值' })
  aiFaceProtected?: boolean;

  @IsOptional()
  @IsArray({ message: '新增标签必须是数组' })
  @IsString({ each: true, message: '标签必须是字符串' })
  addTags?: string[];

  @IsOptional()
  @IsArray({ message: '移除标签必须是数组' })
  @IsString({ each: true, message: '标签必须是字符串' })
  removeTags?: string[];
}

/**
 * @description 批量图库图片元数据更新请求。
 * @keyword-cn 图片元数据, 批量更新
 * @keyword-en image-metadata, batch-image-update
 */
export class BatchUpdateGalleryImageMetaDto extends UpdateGalleryImageMetaDto {
  @IsArray({ message: '图片ID必须是数组' })
  @ArrayMinSize(1, { message: '至少选择1张图片' })
  @ArrayMaxSize(500, { message: '一次最多更新500张图片' })
  ids!: Array<string | number>;

  @IsOptional()
  @IsIn(['replace', 'append'], { message: '备注模式只能是replace或append' })
  noteMode?: 'replace' | 'append';
}

/**
 * @description 标签库分类请求项。
 * @keyword-cn 标签分类, 标签库校验
 * @keyword-en tag-category, tag-library-validation
 */
export class GalleryTagCategoryDto {
  @IsOptional()
  @IsString({ message: '分类ID必须是字符串' })
  id?: string;

  @IsString({ message: '分类名称必须是字符串' })
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(20, { message: '分类名称不能超过20字' })
  name!: string;

  @IsArray({ message: '分类标签必须是数组' })
  @ArrayMaxSize(100, { message: '每个分类最多100个标签' })
  @IsString({ each: true, message: '标签必须是字符串' })
  tags!: string[];
}

/**
 * @description 整体替换图库标签库请求。
 * @keyword-cn 标签库替换, 分类校验
 * @keyword-en replace-tag-library, category-validation
 */
export class ReplaceGalleryTagLibraryDto {
  @IsArray({ message: '分类必须是数组' })
  @ArrayMaxSize(20, { message: '最多只能创建20个分类' })
  @ValidateNested({ each: true })
  @Type(() => GalleryTagCategoryDto)
  categories!: GalleryTagCategoryDto[];
}

/**
 * @description 批量把标签转换为图片备注的请求。
 * @keyword-cn 标签转备注, 批量转换
 * @keyword-en tags-to-note, batch-conversion
 */
export class ConvertGalleryTagsToNoteDto {
  @IsArray({ message: '标签必须是数组' })
  @ArrayMinSize(1, { message: '至少选择1个标签' })
  @ArrayMaxSize(50, { message: '一次最多转换50个标签' })
  @IsString({ each: true, message: '标签必须是字符串' })
  tags!: string[];
}
