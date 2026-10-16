import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  REQUIRE_PERMISSION_KEY,
  type RequiredPermission,
} from '../../admin/decorators/require-permission.decorator.js';
import type { TenantMcpPrincipal } from '../entities/tenant-mcp.entity.js';
import { TenantMcpService } from '../services/tenant-mcp.service.js';

/** @keyword-en mcp-request, mcp-auth */
export interface TenantMcpRequest extends Request {
  mcpPrincipal: TenantMcpPrincipal;
}

/** @keyword-en mcp-auth-guard, tool-permission */
@Injectable()
export class TenantMcpAuthGuard implements CanActivate {
  /** @keyword-en mcp-auth-guard, tool-permission */
  constructor(
    private readonly service: TenantMcpService,
    private readonly reflector: Reflector,
  ) {}

  /** @keyword-en mcp-auth, tenant-isolation */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.get<RequiredPermission>(
      REQUIRE_PERMISSION_KEY,
      context.getHandler(),
    );
    if (permission?.subject !== 'TenantMcp' || permission.action !== 'read')
      throw new ForbiddenException('MCP_PERMISSION_DECLARATION_REQUIRED');
    const req = context.switchToHttp().getRequest<TenantMcpRequest>();
    req.mcpPrincipal = await this.service.authenticate(
      String(req.params.endpointId),
      req.headers.authorization,
    );
    return true;
  }
}
