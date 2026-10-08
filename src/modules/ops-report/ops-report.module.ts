import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { SassModule } from '../sass/sass.module.js';
import { OpsReportController } from './controller/ops-report.controller.js';
import { OpsReportService } from './services/ops-report.service.js';

/**
 * @description 运维上报模块，提供桌面客户端问题提交与后台处理能力
 * @keyword-cn 运维上报模块
 * @keyword-en ops-report-module
 */
@Module({
  imports: [AdminModule, DataSourceModule, SassModule],
  controllers: [OpsReportController],
  providers: [OpsReportService],
  exports: [OpsReportService],
})
export class OpsReportModule {}
