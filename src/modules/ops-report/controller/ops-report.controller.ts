import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ADMIN_SUBJECTS } from '../../admin/casl/admin-permission.constants.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { OpsReportService } from '../services/ops-report.service.js';
import {
  CreateOpsReportDto,
  ListOpsReportQueryDto,
  UpdateOpsReportDto,
} from './ops-report.dto.js';

/**
 * @description 运维上报接口，接收桌面客户端问题日志并供管理员查看处理
 * @keyword-cn 运维上报接口
 * @keyword-en ops-report-controller
 */
@Controller('api/ops-report/reports')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class OpsReportController {
  constructor(private readonly reports: OpsReportService) {}

  /**
   * @description 提交问题描述与桌面客户端本地错误日志
   * @keyword-cn 提交运维上报接口
   * @keyword-en create-ops-report-endpoint
   */
  @Post()
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('create', ADMIN_SUBJECTS.OpsReport)
  async create(@Req() req: AdminRequest, @Body() dto: CreateOpsReportDto) {
    return { report: await this.reports.create(this.requireUser(req), dto) };
  }

  /**
   * @description 分页读取有权限租户范围内的运维上报摘要
   * @keyword-cn 查询运维上报接口
   * @keyword-en list-ops-report-endpoint
   */
  @Get()
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', ADMIN_SUBJECTS.OpsReport)
  async list(
    @Req() req: AdminRequest,
    @Query() query: ListOpsReportQueryDto,
  ) {
    return this.reports.list(this.requireUser(req), query);
  }

  /**
   * @description 读取单条运维上报及其日志明细
   * @keyword-cn 查询上报详情接口
   * @keyword-en get-ops-report-endpoint
   */
  @Get(':id')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', ADMIN_SUBJECTS.OpsReport)
  async get(@Req() req: AdminRequest, @Param('id') id: string) {
    return { report: await this.reports.get(this.requireUser(req), id) };
  }

  /**
   * @description 更新运维上报处理状态与处理备注
   * @keyword-cn 更新上报状态接口
   * @keyword-en update-ops-report-endpoint
   */
  @Patch(':id')
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.OpsReport)
  async update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateOpsReportDto,
  ) {
    const user = this.requireUser(req);
    return { report: await this.reports.update(user, id, dto) };
  }

  /**
   * @description 从鉴权请求读取当前后台用户
   * @keyword-cn 读取后台用户
   * @keyword-en read-admin-user
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
