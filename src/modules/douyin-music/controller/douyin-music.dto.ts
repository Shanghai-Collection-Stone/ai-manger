import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { DOUYIN_MUSIC_CATEGORIES } from '../entities/douyin-music.entity.js';

/**
 * @description 允许的曲库分类键名，取自实体登记表。
 * @keyword-cn 分类校验键, 曲库分类
 * @keyword-en category-keys, music-category
 */
const CATEGORY_KEYS = Object.keys(DOUYIN_MUSIC_CATEGORIES);

/**
 * @description multipart 表单里的布尔值是字符串，转成真正的布尔；其他取值原样交给校验器拒绝。
 * @keyword-cn 表单布尔转换, 公开开关
 * @keyword-en form-boolean-transform, public-toggle
 * @param {{value: unknown}} input 原始值。
 * @returns {unknown} 转换结果。
 */
function toFormBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/**
 * @description 校验新增曲库曲目的表单：授权来源必填，曲名可留空（按文件名）。
 * @keyword-cn 新增曲目参数, 授权来源必填
 * @keyword-en create-music-dto, license-required
 */
export class CreateDouyinMusicDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsIn(CATEGORY_KEYS)
  category?: string;

  @IsString()
  @Length(1, 200)
  licenseNote!: string;

  @IsOptional()
  @Transform(toFormBoolean)
  @IsBoolean()
  isPublic?: boolean;
}

/**
 * @description 校验更新曲库曲目：曲名、分类、授权来源、归档状态与平台公开开关。
 * @keyword-cn 更新曲目参数, 归档曲目
 * @keyword-en update-music-dto, archive-track
 */
export class UpdateDouyinMusicDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsIn(CATEGORY_KEYS)
  category?: keyof typeof DOUYIN_MUSIC_CATEGORIES;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  licenseNote?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
