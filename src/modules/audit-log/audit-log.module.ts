import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuditLogController } from './controller/audit-log.controller.js';
import { AuditLogService } from './services/audit-log.service.js';

/**
 * @description 审计日志模块,提供审计事件写入与查询,并被工作区/网盘模块复用做自动埋点
 * @keyword-en audit log module
 * @keyword-cn 审计日志模块
 */
@Module({
  imports: [DataSourceModule, AdminModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
