import { Injectable, OnModuleInit } from '@nestjs/common';
import type { CreateAgentParams } from 'langchain';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

type StdioServer = {
  transport: 'stdio';
  command: string;
  args?: string[];
};

type HttpServer = {
  transport: 'http';
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
  private client: MultiServerMCPClient | null = null;
  private toolsCache: CreateAgentParams['tools'] = [];

  /**
   * @description 初始化 MCP 客户端并加载工具，读取环境变量 MCP_SERVERS_JSON。
   * @returns {Promise<void>}
   * @throws {Error} JSON 解析失败或客户端初始化失败
   * @keyword mcp, init, servers
   * @since 2026-01-24
   */
  async onModuleInit(): Promise<void> {
    const cfg = this.getServerConfigFromEnv();
    if (!cfg || Object.keys(cfg).length === 0) {
      this.client = null;
      this.toolsCache = [];
      return;
    }
    this.client = new MultiServerMCPClient(cfg);
    try {
      this.toolsCache = (await this.client.getTools()) ?? [];
    } catch (e) {
      this.toolsCache = [];
      const err = e instanceof Error ? e : new Error(String(e));
      throw err;
    }
  }

  /**
   * @description 返回已缓存的 MCP 工具集合；若未配置或初始化失败，返回空数组。
   * @returns {CreateAgentParams['tools']}
   * @keyword mcp, tools, cache
   * @since 2026-01-24
   */
  getTools(): CreateAgentParams['tools'] {
    return this.toolsCache;
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

  private getServerConfigFromEnv(): ServerConfig | null {
    const raw = process.env.MCP_SERVERS_JSON ?? '';
    if (!raw || raw.trim().length === 0) return null;
    try {
      const obj = JSON.parse(raw) as ServerConfig;
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      return null;
    }
  }
}
