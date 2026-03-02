import { Module } from '@nestjs/common';
import { FeishuBitableSourceModule } from '../data-source/sources/feishu-bitable/feishu-bitable-source.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [FeishuBitableSourceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
