import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { McpStorageService } from './mcp-storage.service.js';
import { McpAdaptersService } from './mcp-adapter.service.js';

/**
 * @description 提供 MCP 相关的函数调用工具：资源列表、读取与专用文件录入。
 * @keyword mcp, tool, resource
 * @since 2026-01-24
 */
@Injectable()
export class McpFunctionCallService {
  constructor(
    private readonly storage: McpStorageService,
    private readonly adapters: McpAdaptersService,
  ) {}

  /**
   * @description 返回 MCP 工具句柄集合：mcp_list_resources、mcp_read_resource、mcp_ingest_file。
   * @param {(msg: string) => void} [streamWriter] 可选的流式日志输出
   * @returns {CreateAgentParams['tools']} 工具集合
   * @keyword mcp, tools, handle
   * @example
   * const tools = service.getHandle();
   * @since 2026-01-24
   */
  getHandle(streamWriter?: (msg: string) => void): CreateAgentParams['tools'] {
    const mcpList = tool(
      async ({ pattern }) => {
        const items = await this.storage.listResources(pattern);
        if (streamWriter)
          streamWriter(`[MCP] Listed ${items.length} resources`);
        return JSON.stringify({ resources: items });
      },
      {
        name: 'mcp_list_resources',
        description:
          'List MCP resources from the dedicated storage directory. Supports optional name substring filtering.',
        schema: z.object({
          pattern: z.string().optional().describe('Name substring filter'),
        }),
      },
    );

    const mcpRead = tool(
      async ({ id, name }) => {
        const data = await this.storage.readResource({ id, name });
        if (streamWriter) streamWriter(`[MCP] Read resource: ${data.name}`);
        return JSON.stringify({ resource: data });
      },
      {
        name: 'mcp_read_resource',
        description:
          'Read MCP resource content by id or name. Returns utf-8 or base64 encoded content with mime.',
        schema: z.object({
          id: z.string().optional().describe('Resource id'),
          name: z.string().optional().describe('File name'),
        }),
      },
    );

    const mcpIngest = tool(
      async ({ filename, content, encoding }) => {
        const res = await this.storage.ingestFile(
          filename,
          content,
          (encoding as 'utf-8' | 'base64') ?? 'utf-8',
        );
        if (streamWriter) streamWriter(`[MCP] Ingested file: ${res.name}`);
        return JSON.stringify({ resource: res });
      },
      {
        name: 'mcp_ingest_file',
        description:
          'Ingest a file into the MCP storage directory. Accepts content encoded as utf-8 or base64.',
        schema: z.object({
          filename: z.string().describe('Target file name'),
          content: z.string().describe('File content'),
          encoding: z
            .enum(['utf-8', 'base64'])
            .optional()
            .describe('Content encoding (default utf-8)'),
        }),
      },
    );

    const mcpListMcpTools = tool(
      () => {
        const tools = this.adapters.getTools() ?? [];
        const names = tools
          .map((t) => (t as unknown as { name?: string }).name)
          .filter((n): n is string => typeof n === 'string');
        return JSON.stringify({ tools: names });
      },
      {
        name: 'mcp_list_mcp_tools',
        description:
          'List tool names currently loaded from MCP servers configured in config/mcp.servers.json.',
        schema: z.object({}),
      },
    );

    const mcpListMcpResources = tool(
      async ({ serverName, uris }) => {
        try {
          const res = await this.adapters.listMcpResources(serverName, {
            uris,
          });
          if (streamWriter)
            streamWriter(
              `[MCP] Listed ${res.length} resources from ${serverName ?? 'all servers'}`,
            );
          return JSON.stringify({ resources: res });
        } catch (error) {
          const msg =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : JSON.stringify(error);
          return JSON.stringify({ error: msg });
        }
      },
      {
        name: 'mcp_list_mcp_resources',
        description:
          'List resources exposed by MCP servers via @langchain/mcp-adapters. Optionally filter by server name or URIs.',
        schema: z.object({
          serverName: z
            .string()
            .optional()
            .describe('Server name as defined in config/mcp.servers.json'),
          uris: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .describe('Specific resource URI or list of URIs to load'),
        }),
      },
    );

    return [mcpList, mcpRead, mcpIngest, mcpListMcpTools, mcpListMcpResources];
  }
}
