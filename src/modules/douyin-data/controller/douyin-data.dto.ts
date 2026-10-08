import {
  IsBoolean,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * @description 校验开启 / 取消监控参数。
 * @keyword-cn 监控开关参数
 * @keyword-en set-monitor-dto
 */
export class SetDouyinDataMonitorDto {
  @IsBoolean()
  monitoring!: boolean;
}

/**
 * @description 校验绑定作品链接参数：链接、分享口令或纯数字作品 ID。
 * @keyword-cn 绑定作品链接参数
 * @keyword-en bind-work-link-dto
 */
export class BindDouyinDataLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url!: string;
}

/**
 * @description 校验新增链接参数：目标发布库、作品标题（与发布库标题上限一致 60 字）和抖音链接。
 * @keyword-cn 新增链接参数
 * @keyword-en create-manual-link-dto
 */
export class CreateDouyinDataManualLinkDto {
  @IsMongoId()
  libraryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url!: string;
}
