import { Global, Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { SmsVerificationController } from './controller/sms-verification.controller.js';
import { SmsCodeGuard } from './guards/sms-code.guard.js';
import { SmsCodeConsumeInterceptor } from './interceptors/sms-code-consume.interceptor.js';
import { AliyunSmsService } from './services/aliyun-sms.service.js';
import { SmsConfigService } from './services/sms-config.service.js';
import { SmsCryptoService } from './services/sms-crypto.service.js';
import { SmsVerificationService } from './services/sms-verification.service.js';

/**
 * @description 短信验证码模块（全局）：任意模块的控制器直接使用 @RequireSmsCode，无需再 import 本模块。
 * @keyword-cn 短信验证码模块, 全局模块
 * @keyword-en sms-verification-module, global-module
 */
@Global()
@Module({
  imports: [AdminModule, DataSourceModule],
  controllers: [SmsVerificationController],
  providers: [
    SmsCryptoService,
    SmsConfigService,
    AliyunSmsService,
    SmsVerificationService,
    SmsCodeGuard,
    SmsCodeConsumeInterceptor,
  ],
  exports: [SmsVerificationService, SmsCodeGuard, SmsCodeConsumeInterceptor],
})
export class SmsVerificationModule {}
