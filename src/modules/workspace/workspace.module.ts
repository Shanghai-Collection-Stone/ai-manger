import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { WorkspaceController } from './controller/workspace.controller.js';
import { WorkspaceService } from './services/workspace.service.js';

/**
 * @description 工作区模块(v2),工作区 CRUD、成员管理与容量记账入口,导出服务供网盘做配额
 * @keyword-en workspace module
 * @keyword-cn 工作区模块
 */
@Module({
  imports: [DataSourceModule, AdminModule, AuditLogModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
