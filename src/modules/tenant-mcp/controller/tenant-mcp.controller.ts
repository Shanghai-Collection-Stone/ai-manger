import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import {
  TenantMcpAuthGuard,
  type TenantMcpRequest,
} from './tenant-mcp-auth.guard.js';
import { TenantMcpProtocolService } from '../services/tenant-mcp-protocol.service.js';

/** @keyword-en mcp-controller, streamable-http */
@Controller('api/mcp/:endpointId')
@UseGuards(TenantMcpAuthGuard)
export class TenantMcpController {
  /** @keyword-en mcp-controller, streamable-http */
  constructor(private readonly protocol: TenantMcpProtocolService) {}

  /** @keyword-en mcp-http-handler, streamable-http */
  @Post()
  @RequirePermission('read', 'TenantMcp')
  handle(@Req() req: TenantMcpRequest, @Res() res: Response) {
    return this.protocol.handle(req, res);
  }

  /** @keyword-en mcp-http-method, stateless-transport */
  @Get()
  @RequirePermission('read', 'TenantMcp')
  get(@Res() res: Response) {
    res.setHeader('Allow', 'POST');
    res
      .status(405)
      .json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Stateless MCP supports POST only' },
      });
  }

  /** @keyword-en mcp-http-method, stateless-transport */
  @Delete()
  @RequirePermission('read', 'TenantMcp')
  delete(@Res() res: Response) {
    res.setHeader('Allow', 'POST');
    res
      .status(405)
      .json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Stateless MCP has no session to terminate',
        },
      });
  }
}
