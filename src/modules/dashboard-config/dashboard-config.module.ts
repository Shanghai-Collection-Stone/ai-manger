import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { DashboardConfigController } from './controller/dashboard-config.controller.js';
import { AdminDashboardConfigController } from './controller/admin-dashboard-config.controller.js';
import { DashboardConfigService } from './services/dashboard-config.service.js';

/**
 * @description 看板配置模块（租户 -> JSON配置文件映射）
 * @keyword-en dashboard config module
 */
@Module({
  imports: [DataSourceModule, AdminModule],
  controllers: [DashboardConfigController, AdminDashboardConfigController],
  providers: [DashboardConfigService],
  exports: [DashboardConfigService],
})
export class DashboardConfigModule {}

