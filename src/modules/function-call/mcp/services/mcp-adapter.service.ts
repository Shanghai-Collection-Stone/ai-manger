import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { CreateAgentParams } from 'langchain';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type StdioServer = {
  transport: 'stdio';
  command: string;
  args?: string[];
};

type HttpServer = {
  transport: 'http' | 'sse' | 'streamable_http';
  url: string;
  headers?: Record<string, string>;
};

type ServerConfig = Record<string, StdioServer | HttpServer>;

/**
 * @description 使用 LangChain 原生 MCP 适配器连接多个 MCP 服务，并缓存其工具供 Agent 使用。
 * @keyword mcp, adapters, tools
 * @since 2026-01-24
 */
@Injectable()
export class McpAdaptersService implements OnModuleInit {
  private readonly logger = new Logger(McpAdaptersService.name);
  private client: {
    getTools: () => Promise<CreateAgentParams['tools']>;
    getResources?: (
      serverName?: string,
      opts?: { uris?: string | string[] },
    ) => Promise<unknown[]>;
    session?: (serverName: string) => Promise<unknown>;
    config?: unknown;
  } | null = null;
  private toolsCache: CreateAgentParams['tools'] = [];
  private serverConfig: ServerConfig | null = null;

  /**
   * @description 初始化 MCP 客户端并加载工具，读取环境变量 MCP_SERVERS_JSON。
   * @returns {Promise<void>}
   * @throws {Error} JSON 解析失败或客户端初始化失败
   * @keyword mcp, init, servers
   * @since 2026-01-24
   */
  async onModuleInit(): Promise<void> {
    const raw = await this.getServerConfigFromFile();
    const cfg = await this.sanitizeServerConfig(raw);
    if (!cfg || Object.keys(cfg).length === 0) {
      this.client = null;
      this.toolsCache = [];
      this.serverConfig = null;
      if (!raw) {
        this.logger.log('[MCP] No servers configured (missing config file)');
      } else {
        this.logger.log('[MCP] No valid servers configured after sanitization');
      }
      return;
    }

    this.logger.log(`[MCP] Loading servers: ${formatServerList(cfg)}`);
    try {
      const pkg = (await import('@langchain/mcp-adapters')) as {
        MultiServerMCPClient: new (cfg: Record<string, unknown>) => {
          getTools: () => Promise<CreateAgentParams['tools']>;
          getResources?: (
            serverName?: string,
            opts?: { uris?: string | string[] },
          ) => Promise<unknown[]>;
          session?: (serverName: string) => Promise<unknown>;
          config?: unknown;
        };
      };
      const ClientCtor = pkg.MultiServerMCPClient;
      this.client = new ClientCtor({
        onConnectionError: 'ignore',
        mcpServers: cfg,
      });
      this.serverConfig = cfg;
    } catch {
      this.client = null;
      this.toolsCache = [];
      this.serverConfig = null;
      this.logger.error('[MCP] Failed to initialize MCP client');
      return;
    }
    try {
      this.toolsCache = (await this.client.getTools()) ?? [];
      this.logger.log(`[MCP] Loaded tools: ${this.toolsCache.length}`);
    } catch (e) {
      this.toolsCache = [];
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.warn(
        `[MCP] Tool discovery failed; MCP tools set to empty. ${err.message}`,
      );
      if (err.stack) this.logger.debug(err.stack);
    }
  }

  /**
   * @description 返回已缓存的 MCP 工具集合；若未配置或初始化失败，返回空数组。
   * @returns {CreateAgentParams['tools']}
   * @keyword mcp, tools, cache
   * @since 2026-01-24
   */
  getTools(): CreateAgentParams['tools'] {
    return this.toolsCache ?? [];
  }

  async invokeTool(toolName: string, input: unknown): Promise<unknown> {
    const tools = this.toolsCache ?? [];
    const t = tools.find((x) => (x as { name?: string }).name === toolName);
    if (!t) throw new Error(`MCP_TOOL_NOT_FOUND:${toolName}`);

    console.log(
      `[invokeTool] Tool: ${toolName}, Input:`,
      JSON.stringify(input),
    );

    const anyT = t as {
      invoke?: (i: unknown) => Promise<unknown>;
      call?: (i: unknown) => Promise<unknown>;
      _call?: (i: unknown) => Promise<unknown>;
    };

    let rawResult: unknown;
    if (typeof anyT.invoke === 'function') {
      rawResult = await anyT.invoke(input);
    } else if (typeof anyT.call === 'function') {
      rawResult = await anyT.call(input);
    } else if (typeof anyT._call === 'function') {
      rawResult = await anyT._call(input);
    } else {
      throw new Error(`MCP_TOOL_NOT_INVOKABLE:${toolName}`);
    }

    console.log(`[invokeTool] Raw result type:`, typeof rawResult);

    // 如果返回的是字符串，尝试解析为 JSON
    if (typeof rawResult === 'string') {
      try {
        const parsed = JSON.parse(rawResult) as unknown;
        console.log(`[invokeTool] Parsed JSON result:`, parsed);
        return parsed;
      } catch {
        // 不是有效 JSON，返回原始字符串
        return rawResult;
      }
    }

    return rawResult;
  }

  /**
   * @description 调用 MCP 工具并返回解析后的对象
   */
  async invokeToolParsed<T = Record<string, unknown>>(
    toolName: string,
    input: unknown,
  ): Promise<T> {
    const result = await this.invokeTool(toolName, input);
    return result as T;
  }

  /**
   * @description 列出 MCP 服务器提供的资源（跨所有或指定服务器）。
   * @param {string} [serverName] 服务器名称（来自 config/mcp.servers.json 的键）
   * @param {{ uris?: string|string[] }} [opts] 可选的资源URI过滤
   * @returns {Promise<Array<{ uri?: string; mimetype?: string }>>} 资源信息列表
   * @throws {Error} 适配器未初始化或资源加载失败
   * @keyword mcp, resources, list
   * @since 2026-01-27
   */
  async listMcpResources(
    serverName?: string,
    opts?: { uris?: string | string[] },
  ): Promise<Array<{ uri?: string; mimetype?: string }>> {
    if (!this.client || typeof this.client !== 'object') {
      throw new Error('MCP_CLIENT_NOT_INITIALIZED');
    }
    const fn = (
      this.client as {
        getResources?: (
          serverName?: string,
          opts?: { uris?: string | string[] },
        ) => Promise<unknown[]>;
      }
    ).getResources;
    if (typeof fn !== 'function') {
      // 若库版本不支持 getResources，则返回空数组以避免崩溃
      return [];
    }
    try {
      const resources = await fn(serverName, opts);
      const out: Array<{ uri?: string; mimetype?: string }> = [];
      for (const r of resources ?? []) {
        const anyR = r as Record<string, unknown>;
        const meta = (anyR['metadata'] as Record<string, unknown>) || {};
        const uri =
          (meta['uri'] as string) || (anyR['uri'] as string) || undefined;
        const mimetype =
          (anyR['mimetype'] as string) ||
          (anyR['mimeType'] as string) ||
          undefined;
        out.push({ uri, mimetype });
      }
      return out;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw err;
    }
  }

  /**
   * @description 手动刷新工具缓存（例如运行时更新了 MCP_SERVERS_JSON）。
   * @returns {Promise<void>}
   * @keyword mcp, refresh, tools
   * @since 2026-01-24
   */
  async refresh(): Promise<void> {
    if (!this.client) {
      await this.onModuleInit();
      return;
    }
    try {
      this.toolsCache = (await this.client.getTools()) ?? [];
    } catch {
      this.toolsCache = [];
    }
  }

  private async getServerConfigFromFile(): Promise<ServerConfig | null> {
    const file = path.resolve(process.cwd(), 'config/mcp.servers.json');
    try {
      const buf = await fs.readFile(file);
      const txt = buf.toString('utf-8');
      const obj = JSON.parse(txt) as ServerConfig;
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      return null;
    }
  }

  /**
   * @description 清理与校验服务器配置，过滤掉无效的 stdio 项（如 node args 文件不存在）。
   * @param {ServerConfig|null} config 原始配置
   * @returns {Promise<ServerConfig|null>} 过滤后的配置；若全部无效则返回 null
   * @keyword mcp, validate, config
   * @since 2026-01-27
   */
  private async sanitizeServerConfig(
    config: ServerConfig | null,
  ): Promise<ServerConfig | null> {
    if (!config || typeof config !== 'object') return null;
    const out: ServerConfig = {};
    for (const [name, raw] of Object.entries(config)) {
      const entry = raw as Record<string, unknown>;
      if (!entry || typeof entry !== 'object') continue;
      const transport = (entry['transport'] ?? entry['type']) as
        | 'stdio'
        | 'http'
        | 'sse'
        | 'streamable_http'
        | undefined;
      if (transport === 'stdio') {
        const cmd = (entry['command'] as string) ?? 'node';
        const args = (entry['args'] as string[]) ?? [];
        if (cmd === 'node' && args.length > 0) {
          const script = args[0];
          try {
            const stat = await fs.stat(script);
            if (!stat.isFile()) continue;
          } catch {
            continue;
          }
        }
        out[name] = { transport: 'stdio', command: cmd, args } as StdioServer;
        continue;
      }
      if (
        transport === 'http' ||
        transport === 'sse' ||
        transport === 'streamable_http'
      ) {
        const url = entry['url'] as string;
        const headers = entry['headers'] as Record<string, string> | undefined;
        if (typeof url === 'string' && url.startsWith('http')) {
          out[name] = { transport, url, headers } as HttpServer;
        }
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }
}

function formatServerList(cfg: ServerConfig): string {
  const parts: string[] = [];
  for (const [name, server] of Object.entries(cfg)) {
    if (!server || typeof server !== 'object') continue;
    if (server.transport === 'http') {
      const rawUrl = server.url;
      const safeUrl = sanitizeUrlForLog(rawUrl);
      parts.push(`${name}(http:${safeUrl})`);
      continue;
    }
    if (server.transport === 'sse') {
      const rawUrl = server.url;
      const safeUrl = sanitizeUrlForLog(rawUrl);
      parts.push(`${name}(sse:${safeUrl})`);
      continue;
    }
    if (server.transport === 'streamable_http') {
      const rawUrl = server.url;
      const safeUrl = sanitizeUrlForLog(rawUrl);
      parts.push(`${name}(streamable_http:${safeUrl})`);
      continue;
    }
    if (server.transport === 'stdio') {
      const cmd = server.command;
      parts.push(`${name}(stdio:${cmd})`);
    }
  }
  return parts.join(', ');
}

function sanitizeUrlForLog(input: string): string {
  try {
    const u = new URL(input);
    const host = u.host;
    const pathname = u.pathname || '/';
    return `${u.protocol}//${host}${pathname}`;
  } catch {
    return String(input || '').slice(0, 160);
  }
}
