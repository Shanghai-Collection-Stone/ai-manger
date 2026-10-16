import {
  Body,
  Controller,
  Delete,
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
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { TenantMcpService } from '../services/tenant-mcp.service.js';
import {
  CreateMcpEndpointDto,
  CreateMcpKeyDto,
  UpdateMcpEndpointDto,
  UpdateMcpKeyDto,
} from './tenant-mcp.dto.js';

/** @keyword-en mcp-admin, key-management */
@Controller('admin/tenant-mcp')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class TenantMcpAdminController {
  /** @keyword-en mcp-admin, key-management */
  constructor(private readonly service: TenantMcpService) {}

  /** @keyword-en mcp-admin-scope, tenant-isolation */
  private user(req: AdminRequest) {
    if (!req.adminUser) throw new UnauthorizedException();
    return req.adminUser;
  }

  /** @keyword-en mcp-list, key-management */
  @Get()
  @RequirePermission('read', 'TenantMcp')
  list(@Req() req: AdminRequest, @Query('tenantId') tenantId?: string) {
    return this.service.list(this.service.scope(this.user(req), tenantId));
  }

  /** @keyword-en mcp-create-endpoint, key-management */
  @Post('endpoints')
  @RequirePermission('create', 'TenantMcp')
  createEndpoint(
    @Req() req: AdminRequest,
    @Body() body: CreateMcpEndpointDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.createEndpoint(
      this.service.scope(this.user(req), tenantId),
      this.user(req),
      body,
    );
  }

  /** @keyword-en mcp-update-endpoint, key-management */
  @Patch('endpoints/:endpointId')
  @RequirePermission('update', 'TenantMcp')
  updateEndpoint(
    @Req() req: AdminRequest,
    @Param('endpointId') endpointId: string,
    @Body() body: UpdateMcpEndpointDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.updateEndpoint(
      this.service.scope(this.user(req), tenantId),
      endpointId,
      body,
    );
  }

  /** @keyword-en mcp-delete-endpoint, key-revocation */
  @Delete('endpoints/:endpointId')
  @RequirePermission('delete', 'TenantMcp')
  deleteEndpoint(
    @Req() req: AdminRequest,
    @Param('endpointId') endpointId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.deleteEndpoint(
      this.service.scope(this.user(req), tenantId),
      endpointId,
    );
  }

  /** @keyword-en mcp-create-key, one-time-secret */
  @Post('endpoints/:endpointId/keys')
  @RequirePermission('create', 'TenantMcp')
  createKey(
    @Req() req: AdminRequest,
    @Param('endpointId') endpointId: string,
    @Body() body: CreateMcpKeyDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.createKey(
      this.service.scope(this.user(req), tenantId),
      endpointId,
      this.user(req),
      body,
    );
  }

  /** @keyword-en mcp-update-key, tool-permission */
  @Patch('endpoints/:endpointId/keys/:keyId')
  @RequirePermission('update', 'TenantMcp')
  updateKey(
    @Req() req: AdminRequest,
    @Param('endpointId') endpointId: string,
    @Param('keyId') keyId: string,
    @Body() body: UpdateMcpKeyDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.updateKey(
      this.service.scope(this.user(req), tenantId),
      endpointId,
      keyId,
      body,
    );
  }

  /** @keyword-en mcp-delete-key, key-revocation */
  @Delete('endpoints/:endpointId/keys/:keyId')
  @RequirePermission('delete', 'TenantMcp')
  deleteKey(
    @Req() req: AdminRequest,
    @Param('endpointId') endpointId: string,
    @Param('keyId') keyId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.deleteKey(
      this.service.scope(this.user(req), tenantId),
      endpointId,
      keyId,
    );
  }
}
