import { HttpException, Injectable } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import type { TenantMcpRequest } from '../controller/tenant-mcp-auth.guard.js';
import type { TenantMcpPrincipal } from '../entities/tenant-mcp.entity.js';
import {
  TENANT_MCP_TOOL_META,
  TENANT_MCP_TOOLS,
  type TenantMcpToolName,
} from '../tenant-mcp.tools.js';
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
      {
        capabilities: { tools: {} },
        instructions:
          '使用 tools/list 获取当前密钥已授权工具的 description 和 inputSchema，再通过 tools/call 调用。工具列表为空时需要管理员为此密钥分配工具权限。文章发布表示存入文章库；异步采集使用返回的 taskId 查询结果。抖音工作台工具（douyin_ 开头）：先用 douyin_workspace 找脚本，按 douyin_topic_get 返回的 nextStep 一步步做；出片与拼接是异步的，用 douyin_topic_get 轮询；同点位续段、统一音色与拼接成片要密钥创建人的账号在桌面端打开「视频制作」页才会完成；标注会产生费用的工具会扣租户 Credit。',
      },
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
              readOnlyHint: Boolean(
                TENANT_MCP_TOOL_META[name as TenantMcpToolName].readOnly,
              ),
              destructiveHint: Boolean(
                TENANT_MCP_TOOL_META[name as TenantMcpToolName].destructive,
              ),
              openWorldHint: Boolean(
                TENANT_MCP_TOOL_META[name as TenantMcpToolName].openWorld,
              ),
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
        if (
          !Object.hasOwn(TENANT_MCP_TOOLS, request.params.name) ||
          !current.permissions.includes(request.params.name)
        ) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Unknown or unavailable tool',
          );
        }
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
        if (error instanceof McpError) throw error;
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
