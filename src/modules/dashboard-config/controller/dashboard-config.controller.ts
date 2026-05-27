import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DashboardConfigService } from '../services/dashboard-config.service.js';

/**
 * @description 看板配置读取控制器（按租户返回 JSON 配置）
 * @keyword-en dashboard config controller
 */
@Controller('dashboard-config')
export class DashboardConfigController {
  constructor(private readonly configs: DashboardConfigService) {}

  /**
   * @description 获取当前范围看板配置（无鉴权时默认母平台配置）
   * @keyword-en get current dashboard config
   */
  @Get('current')
  async getCurrent(
    @Req() req: Request,
    @Query('dashboardCode') dashboardCode?: string,
  ) {
    const scope = await this.configs.resolveScope(req);
    return this.configs.getScopedConfig({
      tenantId: scope.tenantId,
      dashboardCode,
    });
  }
}
