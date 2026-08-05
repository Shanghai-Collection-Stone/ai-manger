import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { NoticeController } from './controller/notice.controller.js';
import { NoticeService } from './services/notice.service.js';

/**
 * @description 通知模块(v2)，后台通知的增删改查与发起(发布)/撤销，变更自动埋点审计
 * @keyword-en notice module
 * @keyword-cn 通知模块
 */
@Module({
  imports: [DataSourceModule, AdminModule, AuditLogModule],
  controllers: [NoticeController],
  providers: [NoticeService],
  exports: [NoticeService],
})
export class NoticeModule {}
