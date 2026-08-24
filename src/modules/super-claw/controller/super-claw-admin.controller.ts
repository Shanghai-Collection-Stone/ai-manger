import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ADMIN_SUBJECTS } from '../../admin/casl/admin-permission.constants.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import { SuperClawService } from '../services/super-claw.service.js';
import {
  AssignTenantSuperClawDto,
  CreateSuperClawDto,
  UpdateSuperClawDto,
} from './super-claw.dto.js';

/**
 * @description 平台后台 SuperClaw 节点、工作区槽位与租户节点归属控制器
 * @keyword-cn 后台控制器, 租户分配
 * @keyword-en admin-controller, tenant-allocation
 */
@Controller('admin/super-claws')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class SuperClawAdminController {
  constructor(private readonly superClawService: SuperClawService) {}

  /**
   * @description 列出平台 SuperClaw 节点
   * @keyword-cn 节点列表端点, 平台管理
   * @keyword-en list-nodes-endpoint, platform-management
   */
  @RequirePermission('read', ADMIN_SUBJECTS.SuperClaw)
  @Get()
  async list() {
    return { superClaws: await this.superClawService.list() };
  }

  /**
   * @description 创建节点并返回一次性明文 Token
   * @keyword-cn 创建节点端点, 一次性令牌
   * @keyword-en create-node-endpoint, one-time-token
   */
  @RequirePermission('create', ADMIN_SUBJECTS.SuperClaw)
  @Post()
  async create(@Body() body: CreateSuperClawDto) {
    return this.superClawService.create(body);
  }

  /**
   * @description 更新节点信息与容量上限
   * @keyword-cn 更新节点端点, 容量上限
   * @keyword-en update-node-endpoint, capacity-limit
   */
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateSuperClawDto) {
    return { superClaw: await this.superClawService.update(id, body) };
  }

  /**
   * @description 删除没有租户占用的节点
   * @keyword-cn 删除节点端点, 占用保护
   * @keyword-en delete-node-endpoint, allocation-guard
   */
  @RequirePermission('delete', ADMIN_SUBJECTS.SuperClaw)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return { ok: await this.superClawService.remove(id) };
  }

  /**
   * @description 轮换节点连接 Token
   * @keyword-cn 轮换令牌端点, 密钥管理
   * @keyword-en rotate-token-endpoint, secret-management
   */
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @Post(':id/token/rotate')
  async rotateToken(@Param('id') id: string) {
    return this.superClawService.rotateToken(id);
  }

  /**
   * @description 设置租户 SuperClaw 归属并整体迁移其工作区
   * @keyword-cn 租户节点端点, 工作区迁移
   * @keyword-en tenant-node-endpoint, workspace-migration
   */
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @Put('tenant-allocations/:tenantId')
  async assignTenant(
    @Param('tenantId') tenantId: string,
    @Body() body: AssignTenantSuperClawDto,
  ) {
    const tenant = await this.superClawService.assignTenant(
      tenantId,
      body.superClawId,
    );
    return { tenant };
  }
}
