import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { WorkspaceController } from './controller/workspace.controller.js';
import { WorkspaceService } from './services/workspace.service.js';
import { SuperClawModule } from '../super-claw/super-claw.module.js';

/**
 * @description 工作区模块(v2),作为 SuperClaw 子资源提供 CRUD、成员管理与网盘容量记账
 * @keyword-en workspace module
 * @keyword-cn 工作区模块
 */
@Module({
  imports: [DataSourceModule, AdminModule, AuditLogModule, SuperClawModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
