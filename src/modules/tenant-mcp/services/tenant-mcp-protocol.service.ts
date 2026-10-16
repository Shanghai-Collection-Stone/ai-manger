import { HttpException, Injectable } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import type { TenantMcpRequest } from '../controller/tenant-mcp-auth.guard.js';
import type { TenantMcpPrincipal } from '../entities/tenant-mcp.entity.js';
import { TENANT_MCP_TOOLS } from '../tenant-mcp.tools.js';
import { TenantMcpService } from './tenant-mcp.service.js';
import { TenantMcpToolsService } from './tenant-mcp-tools.service.js';

/** @keyword-en mcp-protocol, streamable-http */
@Injectable()
export class TenantMcpProtocolService {
  /** @keyword-en mcp-protocol, streamable-http */
  constructor(
    private readonly service: TenantMcpService,
    private readonly tools: TenantMcpToolsService,
  ) {}

  /** @keyword-en mcp-server, tool-permission */
  createServer(principal: TenantMcpPrincipal, authorization: string): Server {
    const server = new Server(
      { name: 'tenant-article-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const current = await this.service.authenticate(
        principal.endpointId,
        authorization,
      );
      return {
        tools: Object.entries(TENANT_MCP_TOOLS)
          .filter(([name]) => current.permissions.includes(name))
          .map(([name, tool]) => ({
            name,
            title: tool.title,
            description: tool.description,
            inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }) as {
              type: 'object';
              properties: Record<string, unknown>;
            },
            annotations: {
              readOnlyHint: [
                'gallery_search',
                'library_list',
                'library_get',
                'article_get',
                'article_list',
                'article_list_published',
                'article_list_unpublished',
                'article_recent_data',
              ].includes(name),
              destructiveHint: name.endsWith('_update'),
              openWorldHint: name === 'article_crawl',
            },
          })),
      };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const current = await this.service.authenticate(
          principal.endpointId,
          authorization,
        );
        const result = await this.tools.execute(
          current,
          request.params.name,
          request.params.arguments ?? {},
        );
        const serialized = JSON.stringify(result);
        return {
          content: [{ type: 'text' as const, text: serialized }],
          structuredContent: JSON.parse(serialized) as Record<string, unknown>,
        };
      } catch (error) {
        const message =
          error instanceof ZodError
            ? 'INVALID_TOOL_ARGUMENTS'
            : error instanceof HttpException
              ? error.message
              : 'MCP_TOOL_EXECUTION_FAILED';
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
        };
      }
    });
    return server;
  }

  /** @keyword-en mcp-http-handler, streamable-http */
  async handle(req: TenantMcpRequest, res: Response): Promise<void> {
    // 浏览器 Origin 仅接受部署地址；无 Origin 的标准 MCP 客户端可直接访问。
    const origin = req.headers.origin;
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
      res.status(403).json({ error: 'MCP_ORIGIN_NOT_ALLOWED' });
      return;
    }
    const server = this.createServer(
      req.mcpPrincipal,
      req.headers.authorization || '',
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } finally {
      await server.close();
    }
  }
}
