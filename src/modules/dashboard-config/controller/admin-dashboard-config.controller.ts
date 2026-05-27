import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { DashboardConfigService } from '../services/dashboard-config.service.js';
import { UpsertDashboardConfigMappingDto } from './dashboard-config.dto.js';

/**
 * @description 管理端：看板配置映射管理接口
 * @keyword-en admin dashboard config controller
 */
@Controller('admin/dashboard-config')
@UseGuards(AdminAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class AdminDashboardConfigController {
  constructor(private readonly configs: DashboardConfigService) {}

  /**
   * @description 列出配置映射（平台账号可看全部，租户账号仅看本租户）
   * @keyword-en list dashboard config mappings
   */
  @Get('mappings')
  async listMappings(@Req() req: Request) {
    const user = this.requireUser(req as AdminRequest);
    const rows = await this.configs.listMappings({ tenantId: user.tenantId });
    return { rows };
  }

  /**
   * @description Upsert 配置映射（租户账号只能写自己租户）
   * @keyword-en upsert dashboard config mapping
   */
  @Post('mappings')
  async upsert(
    @Req() req: Request,
    @Body() body: UpsertDashboardConfigMappingDto,
  ) {
    const user = this.requireUser(req as AdminRequest);
    const tenantId = user.tenantId ? user.tenantId : (body.tenantId ?? null);
    if (user.tenantId && body.tenantId && body.tenantId !== user.tenantId) {
      throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
    }
    const row = await this.configs.upsertMapping({
      dashboardCode: body.dashboardCode,
      tenantId,
      filePath: body.filePath,
      enabled: body.enabled,
    });
    return { row };
  }

  /**
   * @description 删除配置映射（租户账号只能删自己租户）
   * @keyword-en delete dashboard config mapping
   */
  @Delete('mappings/:id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    this.requireUser(req as AdminRequest);
    const ok = await this.configs.deleteMapping(id);
    return { success: ok };
  }

  /**
   * @description 清除 customConfig，回退到文件配置（再次修复 AI 工具修改了数组导致 tab 丢失的问题）
   * @keyword-en reset custom config to file
   */
  @Post('reset-custom')
  async resetCustom(
    @Req() req: Request,
    @Body() body: { dashboardCode?: string },
  ) {
    const user = this.requireUser(req as AdminRequest);
    await this.configs.resetConfig({
      tenantId: user.tenantId ?? undefined,
      dashboardCode: body.dashboardCode,
    });
    return { ok: true };
  }

  /**
   * @description 读取鉴权用户
   * @keyword-en require admin user
   */
  private requireUser(req: AdminRequest) {
    const user = req.adminUser;
    if (!user) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    return user;
  }
}
