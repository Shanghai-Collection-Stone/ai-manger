import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { McpStorageService } from './mcp-storage.service.js';
import { McpProcessService } from './mcp-process.service.js';

/**
 * @description 提供 MCP 相关的函数调用工具：资源列表、读取与专用文件录入。
 * @keyword mcp, tool, resource
 * @since 2026-01-24
 */
@Injectable()
export class McpFunctionCallService {
  constructor(
    private readonly storage: McpStorageService,
    private readonly proc: McpProcessService,
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

    const mcpRunNpx = tool(
      async ({ pkg, args, input, timeoutMs, env, cwd }) => {
        const result = await this.proc.runNpx({
          package: pkg,
          args: Array.isArray(args) ? args : undefined,
          input,
          timeoutMs,
          env: (env as Record<string, string>) ?? undefined,
          cwd: typeof cwd === 'string' ? cwd : undefined,
        });
        if (streamWriter)
          streamWriter(
            `[MCP] npx ${pkg} exited with ${result.exitCode}, ${result.stdout.length}B stdout`,
          );
        return JSON.stringify(result);
      },
      {
        name: 'mcp_run_npx',
        description:
          'Run external MCP connector via npx. Pass package name and args; optional stdin input and timeoutMs.',
        schema: z.object({
          pkg: z.string().describe('npx package or command name'),
          args: z.array(z.string()).optional().describe('arguments array'),
          input: z.string().optional().describe('stdin content'),
          timeoutMs: z
            .number()
            .optional()
            .describe('timeout in milliseconds (default 60000)'),
          env: z
            .record(z.string())
            .optional()
            .describe('extra environment variables'),
          cwd: z.string().optional().describe('working directory'),
        }),
      },
    );

    return [mcpList, mcpRead, mcpIngest, mcpRunNpx];
  }
}
