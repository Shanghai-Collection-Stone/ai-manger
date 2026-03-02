import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';

/**
 * @title 看板控制器 Dashboard Controller
 * @description AI Commander 看板数据接口，每个接口对应一种数据类型。
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /** 营收总览 */
  @Get('revenue-overview')
  getRevenueOverview(@Query('timeRange') timeRange?: string) {
    return this.service.getRevenueOverview(timeRange ?? '本月');
  }

  /** 日营收 & 日人数趋势 */
  @Get('daily-revenue')
  getDailyRevenue(@Query('timeRange') timeRange?: string) {
    return this.service.getDailyRevenue(timeRange ?? '本月');
  }

  /** 人数统计 */
  @Get('people-stats')
  getPeopleStats(@Query('timeRange') timeRange?: string) {
    return this.service.getPeopleStats(timeRange ?? '本月');
  }

  /** 需求与渠道 */
  @Get('demand-channel')
  getDemandChannel(@Query('timeRange') timeRange?: string) {
    return this.service.getDemandChannel(timeRange ?? '本月');
  }

  /** 活动与类型 */
  @Get('events')
  getEvents(@Query('timeRange') timeRange?: string) {
    return this.service.getEvents(timeRange ?? '本月');
  }

  /** 销售与客户 */
  @Get('sales')
  getSales(@Query('timeRange') timeRange?: string) {
    return this.service.getSales(timeRange ?? '本月');
  }
}
