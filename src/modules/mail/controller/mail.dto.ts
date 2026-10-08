import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * @description 保存平台发信邮箱配置请求体，password 空串清空、不传保持不变
 * @keyword-cn 保存邮箱配置请求体, SMTP配置
 * @keyword-en save-mail-setting-dto, smtp-setting
 */
export class SaveMailSettingDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(255)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsString()
  @MaxLength(255)
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;

  @IsEmail()
  @MaxLength(320)
  fromAddress!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  fromName?: string;
}

/**
 * @description 后台 SMTP 测试发送请求体
 * @keyword-cn 测试发信请求体
 * @keyword-en test-mail-setting-dto
 */
export class TestMailSettingDto {
  @IsEmail()
  @MaxLength(320)
  to!: string;
}
