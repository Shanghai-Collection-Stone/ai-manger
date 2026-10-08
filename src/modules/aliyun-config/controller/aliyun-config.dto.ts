import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * @description 校验 OSS 设置与 OSS 专用 AccessKey：地域可写 `cn-shanghai` 或 `oss-cn-shanghai`，bucket 按阿里云命名规则，
 *   访问域名必须是 http(s) 地址；各字段空串表示清空，`accessKeySecret` 不传保持不变。
 * @keyword-cn OSS设置参数, 命名校验, OSS访问密钥
 * @keyword-en oss-setting-dto, naming-validation, oss-access-key
 */
export class AliyunOssSettingDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accessKeyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  accessKeySecret?: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^(oss-)?[a-z]{2}-[a-z0-9-]+$/i, {
    message: 'ALIYUN_OSS_REGION_INVALID',
  })
  region?: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, {
    message: 'ALIYUN_OSS_BUCKET_INVALID',
  })
  bucket?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^$|^https?:\/\/[^\s]+$/i, {
    message: 'ALIYUN_OSS_PUBLIC_BASE_URL_INVALID',
  })
  publicBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^$|^[A-Za-z0-9._/-]+$/, {
    message: 'ALIYUN_OSS_ROOT_DIR_INVALID',
  })
  rootDir?: string;
}

/**
 * @description 校验阿里云配置保存请求：`oss` 只更新传入字段（含 OSS 专用 AccessKey）。
 * @keyword-cn 保存阿里云配置参数, 阿里云密钥
 * @keyword-en save-aliyun-setting-dto, aliyun-access-key
 */
export class SaveAliyunSettingDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AliyunOssSettingDto)
  oss?: AliyunOssSettingDto;
}
