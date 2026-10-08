import { Global, Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { EmailVerificationController } from './controller/email-verification.controller.js';
import { EmailCodeGuard } from './guards/email-code.guard.js';
import { EmailCodeConsumeInterceptor } from './interceptors/email-code-consume.interceptor.js';
import { EmailVerificationService } from './services/email-verification.service.js';

/**
 * @description 邮箱验证码模块（全局）：任意模块的控制器直接使用 @RequireEmailCode，无需再 import 本模块；
 *   发信走全局 MailModule 的平台发信邮箱。
 * @keyword-cn 邮箱验证码模块, 全局模块
 * @keyword-en email-verification-module, global-module
 */
@Global()
@Module({
  imports: [DataSourceModule],
  controllers: [EmailVerificationController],
  providers: [
    EmailVerificationService,
    EmailCodeGuard,
    EmailCodeConsumeInterceptor,
  ],
  exports: [
    EmailVerificationService,
    EmailCodeGuard,
    EmailCodeConsumeInterceptor,
  ],
})
export class EmailVerificationModule {}
