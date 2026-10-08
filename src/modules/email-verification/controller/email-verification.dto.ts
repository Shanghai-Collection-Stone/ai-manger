import { IsIn, IsString, MaxLength } from 'class-validator';
import {
  EMAIL_VERIFICATION_SCENES,
  type EmailVerificationScene,
} from '../entities/email-verification.entity.js';

/**
 * @description 发送邮箱验证码请求体；邮箱格式由服务层规范化后校验，统一返回 EMAIL_ADDRESS_INVALID
 * @keyword-cn 发送邮箱验证码请求体
 * @keyword-en send-email-code-dto
 */
export class SendEmailCodeDto {
  @IsString({ message: 'EMAIL_ADDRESS_INVALID' })
  @MaxLength(254, { message: 'EMAIL_ADDRESS_INVALID' })
  email!: string;

  @IsIn([...EMAIL_VERIFICATION_SCENES], { message: 'EMAIL_SCENE_INVALID' })
  scene!: EmailVerificationScene;
}
