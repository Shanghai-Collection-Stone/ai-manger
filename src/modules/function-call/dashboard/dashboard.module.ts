import { Module } from '@nestjs/common';
import { DataSourceModule } from '../../data-source/data-source.module.js';
import { DashboardConfigModule } from '../../dashboard-config/dashboard-config.module.js';
import { DashboardToolsService } from './services/dashboard-tools.service.js';

/**
 * @description 看板函数调用模块，为 AI 提供租户隔离的数据表查询与看板配置读写工具
 * @keyword-en dashboard function-call module
 */
@Module({
  imports: [DataSourceModule, DashboardConfigModule],
  providers: [DashboardToolsService],
  exports: [DashboardToolsService],
})
export class DashboardFunctionCallModule {}
