import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import {
  SMS_PROVIDERS,
  SMS_VERIFICATION_SCENES,
  type SmsProvider,
  type SmsVerificationScene,
} from '../entities/sms-verification.entity.js';

/** @type {RegExp} 中国大陆手机号，允许 +86/86 前缀。 */
const MAINLAND_PHONE_PATTERN = /^(\+?86)?1[3-9]\d{9}$/;

/**
 * @description 校验 Dypns 模板参数是 JSON 对象，且至少一个顶层值为验证码占位符
 * @keyword-cn 号码认证模板校验, 验证码占位符
 * @keyword-en dypns-template-validation, code-placeholder
 */
@ValidatorConstraint({ name: 'dypnsTemplateParam', async: false })
class DypnsTemplateParamConstraint implements ValidatorConstraintInterface {
  /**
   * @description 解析模板参数并检查 JSON 对象中的验证码占位符
   * @keyword-cn 校验模板参数, JSON对象
   * @keyword-en validate-template-param, json-object
   * @param value 待校验的模板参数字符串。
   * @returns {boolean} 是否为包含 `##code##` 值的 JSON 对象。
   */
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      const parsed = JSON.parse(value) as unknown;
      return (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.values(parsed as Record<string, unknown>).some(
          (item) => item === '##code##',
        )
      );
    } catch {
      return false;
    }
  }
}

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
 * @description 保存平台短信配置请求体（接口类型、短信专用 AccessKey、签名与模板）；accessKeySecret 空串清空、不传保持不变
 * @keyword-cn 保存短信配置请求体, 阿里云密钥, 签名模板
 * @keyword-en save-sms-setting-dto, aliyun-access-key, sign-and-template
 */
export class SaveSmsSettingDto {
  @IsOptional()
  @IsIn([...SMS_PROVIDERS])
  provider?: SmsProvider;

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

  @IsOptional()
  @IsString()
  @MaxLength(40)
  dypnsSignName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dypnsTemplateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Validate(DypnsTemplateParamConstraint, {
    message: 'SMS_DYPNS_TEMPLATE_PARAM_INVALID',
  })
  dypnsTemplateParam?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dypnsSchemeName?: string;
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
