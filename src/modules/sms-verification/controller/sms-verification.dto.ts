import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  SMS_VERIFICATION_SCENES,
  type SmsVerificationScene,
} from '../entities/sms-verification.entity.js';

/** @type {RegExp} 中国大陆手机号，允许 +86/86 前缀。 */
const MAINLAND_PHONE_PATTERN = /^(\+?86)?1[3-9]\d{9}$/;

/**
 * @description 发送验证码请求体
 * @keyword-cn 发送验证码请求体
 * @keyword-en send-sms-code-dto
 */
export class SendSmsCodeDto {
  @IsString()
  @Matches(MAINLAND_PHONE_PATTERN, { message: 'SMS_PHONE_INVALID' })
  phone!: string;

  @IsIn([...SMS_VERIFICATION_SCENES], { message: 'SMS_SCENE_INVALID' })
  scene!: SmsVerificationScene;
}

/**
 * @description 保存平台短信配置请求体；accessKeySecret 空串清空、不传保持不变
 * @keyword-cn 保存短信配置请求体, 阿里云密钥
 * @keyword-en save-sms-setting-dto, aliyun-access-key
 */
export class SaveSmsSettingDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

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
  @MaxLength(40)
  signName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^SMS_\d+$/, { message: 'SMS_TEMPLATE_CODE_INVALID' })
  templateCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^[A-Za-z_][A-Za-z0-9_]{0,31}$/, {
    message: 'SMS_TEMPLATE_PARAM_NAME_INVALID',
  })
  templateParamName?: string;
}

/**
 * @description 后台测试发送请求体
 * @keyword-cn 测试发送请求体
 * @keyword-en test-sms-setting-dto
 */
export class TestSmsSettingDto {
  @IsString()
  @Matches(MAINLAND_PHONE_PATTERN, { message: 'SMS_PHONE_INVALID' })
  phone!: string;
}
