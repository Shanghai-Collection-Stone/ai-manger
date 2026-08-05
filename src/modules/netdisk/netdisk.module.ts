import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { NetdiskController } from './controller/netdisk.controller.js';
import { NetdiskService } from './services/netdisk.service.js';
import { NetdiskStorageService } from './services/netdisk-storage.service.js';

/**
 * @description 网盘模块(v2),租户网盘真实文件存储、文件树 CRUD、容量配额与审计埋点
 * @keyword-en netdisk module
 * @keyword-cn 网盘模块
 */
@Module({
  imports: [DataSourceModule, AdminModule, AuditLogModule, WorkspaceModule],
  controllers: [NetdiskController],
  providers: [NetdiskService, NetdiskStorageService],
  exports: [NetdiskService],
})
export class NetdiskModule {}
