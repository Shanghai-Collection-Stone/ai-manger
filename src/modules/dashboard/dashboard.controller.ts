import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';

/**
 * @title 看板控制器 Dashboard Controller
 * @description AI Commander 看板数据接口，每个接口对应一种数据类型。
 * @keyword-en dashboard controller
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /**
   * @description 营收总览
   * @keyword-en revenue overview
   */
  @Get('revenue-overview')
  getRevenueOverview(@Query('timeRange') timeRange?: string) {
    return this.service.getRevenueOverview(timeRange ?? '本月');
  }

  /**
   * @description 日营收与人数趋势
   * @keyword-en daily revenue
   */
  @Get('daily-revenue')
  getDailyRevenue(@Query('timeRange') timeRange?: string) {
    return this.service.getDailyRevenue(timeRange ?? '本月');
  }

  /**
   * @description 人数统计
   * @keyword-en people stats
   */
  @Get('people-stats')
  getPeopleStats(@Query('timeRange') timeRange?: string) {
    return this.service.getPeopleStats(timeRange ?? '本月');
  }

  /**
   * @description 需求与渠道
   * @keyword-en demand channel
   */
  @Get('demand-channel')
  getDemandChannel(@Query('timeRange') timeRange?: string) {
    return this.service.getDemandChannel(timeRange ?? '本月');
  }

  /**
   * @description 活动与类型
   * @keyword-en events
   */
  @Get('events')
  getEvents(@Query('timeRange') timeRange?: string) {
    return this.service.getEvents(timeRange ?? '本月');
  }

  /**
   * @description 销售与客户
   * @keyword-en sales
   */
  @Get('sales')
  getSales(@Query('timeRange') timeRange?: string) {
    return this.service.getSales(timeRange ?? '本月');
  }
}
