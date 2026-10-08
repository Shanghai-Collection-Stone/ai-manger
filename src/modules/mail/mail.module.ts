import { Global, Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { MailController } from './controller/mail.controller.js';
import { MailConfigService } from './services/mail-config.service.js';
import { MailCryptoService } from './services/mail-crypto.service.js';
import { MailTemplateService } from './services/mail-template.service.js';
import { MailService } from './services/mail.service.js';

/**
 * @description 平台发信邮箱全局模块，向其他业务模块导出 MailService
 * @keyword-cn 发信邮箱模块, 全局模块
 * @keyword-en mail-module, global-module
 */
@Global()
@Module({
  imports: [AdminModule, DataSourceModule],
  controllers: [MailController],
  providers: [
    MailCryptoService,
    MailConfigService,
    MailTemplateService,
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
