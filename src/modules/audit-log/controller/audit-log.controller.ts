import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AuditLogService } from '../services/audit-log.service.js';
import { AuditLogQueryDto } from './audit-log.dto.js';

/**
 * @description 审计日志控制器(v2)，提供按租户隔离的审计事件分页查询
 * @keyword-en audit log controller
 * @keyword-cn 审计日志控制器
 */
@Controller('api/v2/audit-logs')
@UsePipes(
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * @description 分页查询审计事件；非平台超管仅能看本租户，鉴权要求 read AuditLog
   * @keyword-en list audit logs endpoint
   * @keyword-cn 审计日志查询端点
   */
  @UseGuards(AdminAuthGuard, AdminPoliciesGuard)
  @RequirePermission('read', 'AuditLog')
  @Get()
  async list(@Req() req: AdminRequest, @Query() query: AuditLogQueryDto) {
    const user = this.requireUser(req);
    const result = await this.auditLogService.list({
      // 租户用户强制锁定本租户；平台超管(无 tenantId)可跨租户查看
      tenantId: user.tenantId,
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      actorUserId: query.actorUserId,
      since: query.since ? new Date(query.since) : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return result;
  }

  /**
   * @description 读取当前登录后台用户
   * @keyword-en read current admin user
   * @keyword-cn 读取当前用户
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
