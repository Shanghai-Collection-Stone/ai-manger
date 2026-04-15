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
      const names = this.toolsCache.map((t) => (t as { name?: string }).name).filter(Boolean);
      this.logger.log(`[MCP] Loaded tools: ${this.toolsCache.length} — ${names.join(', ')}`);
    } catch (e) {
      this.toolsCache = [];
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error(
        `[MCP] Tool discovery failed; MCP tools set to empty. Error: ${err.message}\nStack: ${err.stack}`,
      );
    }
  }

  /**
   * @description 返回已缓存的 MCP 工具集合；若未配置或初始化失败，返回空数组。
   * @returns {CreateAgentParams['tools']}
   * @keyword mcp, tools, cache
   * @keyword-en mcp, tools, cache
   * @since 2026-01-24
   */
  getTools(): CreateAgentParams['tools'] {
    return this.toolsCache ?? [];
  }

  /**
   * @description 将 camelCase 字符串转换为 snake_case。
   * @param {string} s - 输入字符串。
   * @returns {string} snake_case 字符串。
   * @keyword-en camelCase, snake_case, transform
   */
  private camelToSnake(s: string): string {
    return String(s ?? '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/__/g, '_')
      .toLowerCase();
  }

  /**
   * @description 将 snake_case 字符串转换为 camelCase。
   * @param {string} s - 输入字符串。
   * @returns {string} camelCase 字符串。
   * @keyword-en snake_case, camelCase, transform
   */
  private snakeToCamel(s: string): string {
    return String(s ?? '').replace(/_([a-z0-9])/g, (_m, ch) =>
      String(ch).toUpperCase(),
    );
  }

  /**
   * @description 尝试从 ZodObject schema 中提取顶层字段名列表，用于做入参裁剪。
   * @param {unknown} schema - Tool schema。
   * @returns {string[] | null} 允许字段名列表，无法提取时返回 null。
   * @keyword-en zod, schema, keys
   */
  private getSchemaKeys(schema: unknown): string[] | null {
    const anySchema = schema as { _def?: unknown; shape?: unknown };
    const def = (anySchema as { _def?: { shape?: unknown } })._def as
      | { shape?: unknown }
      | undefined;

    const shapeFn = def?.shape;
    if (typeof shapeFn === 'function') {
      try {
        const shape = (shapeFn as () => Record<string, unknown>)();
        return Object.keys(shape ?? {});
      } catch {
        return null;
      }
    }
    const shapeObj = (anySchema as { shape?: unknown }).shape;
    if (shapeObj && typeof shapeObj === 'object') {
      try {
        return Object.keys(shapeObj as Record<string, unknown>);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * @description 根据 tool 的 schema 过滤并映射入参字段，减少 schema mismatch。
   * @param {unknown} tool - MCP tool 实例。
   * @param {unknown} input - 原始入参。
   * @returns {unknown} 规范化后的入参。
   * @keyword-en mcp, tool, input, normalize
   */
  private normalizeToolInput(tool: unknown, input: unknown): unknown {
    const anyTool = tool as { schema?: unknown };
    const schemaKeys = this.getSchemaKeys(anyTool?.schema);
    if (!schemaKeys || schemaKeys.length === 0) return input;

    const src =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {};
    const out: Record<string, unknown> = {};

    for (const k of schemaKeys) {
      if (Object.prototype.hasOwnProperty.call(src, k)) {
        out[k] = src[k];
        continue;
      }
      if (k.includes('_')) {
        const camel = this.snakeToCamel(k);
        if (Object.prototype.hasOwnProperty.call(src, camel)) {
          out[k] = src[camel];
          continue;
        }
      } else {
        const snake = this.camelToSnake(k);
        if (Object.prototype.hasOwnProperty.call(src, snake)) {
          out[k] = src[snake];
          continue;
        }
      }
    }

    return out;
  }

  /**
   * @description 从 LangChain/Zod 抛出的错误中提取 issues，用于打印定位信息。
   * @param {unknown} err - 捕获到的异常。
   * @returns {unknown[] | undefined} Zod issues 数组。
   * @keyword-en zod, issues, parse
   */
  private extractZodIssues(err: unknown): unknown[] | undefined {
    const any = err as Record<string, unknown>;
    const cause = any?.['cause'] as Record<string, unknown> | undefined;
    const zodErr = (cause?.['error'] as Record<string, unknown>) ?? cause;
    const issues = zodErr?.['issues'];
    return Array.isArray(issues) ? (issues as unknown[]) : undefined;
  }

  /**
   * @description 调用指定 MCP 工具，并在调用前按 schema 过滤/映射字段以降低入参错误。
   * @param {string} toolName - MCP 工具名。
   * @param {unknown} input - 工具入参。
   * @returns {Promise<unknown>} 工具返回值（若为 JSON 字符串会尝试解析）。
   * @throws {Error} 当工具不存在、不可调用或入参 schema 校验失败时抛出。
   * @keyword-en mcp, tool, invoke, schema
   */
  async invokeTool(toolName: string, input: unknown): Promise<unknown> {
    const tools = this.toolsCache ?? [];
    const t = tools.find((x) => (x as { name?: string }).name === toolName);
    if (!t) throw new Error(`MCP_TOOL_NOT_FOUND:${toolName}`);

    const normalizedInput = this.normalizeToolInput(t, input);
    const finalInput = this.preprocessToolInput(toolName, normalizedInput);
    console.log(
      `[invokeTool] Tool: ${toolName}, Input:`,
      JSON.stringify(finalInput),
    );

    const anyT = t as {
      invoke?: (i: unknown) => Promise<unknown>;
      call?: (i: unknown) => Promise<unknown>;
      _call?: (i: unknown) => Promise<unknown>;
    };

    let rawResult: unknown;
    try {
      const timeoutMs = this.pickToolTimeoutMs(toolName);
      if (typeof anyT.invoke === 'function') {
        rawResult = await this.withTimeout(
          anyT.invoke(finalInput),
          timeoutMs,
          toolName,
        );
      } else if (typeof anyT.call === 'function') {
        rawResult = await this.withTimeout(
          anyT.call(finalInput),
          timeoutMs,
          toolName,
        );
      } else if (typeof anyT._call === 'function') {
        rawResult = await this.withTimeout(
          anyT._call(finalInput),
          timeoutMs,
          toolName,
        );
      } else {
        throw new Error(`MCP_TOOL_NOT_INVOKABLE:${toolName}`);
      }
    } catch (e) {
      const issues = this.extractZodIssues(e);
      if (issues && issues.length > 0) {
        console.error('[invokeTool] Schema issues:', JSON.stringify(issues));
      }
      throw e;
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
   * @description 对部分工具的入参做轻量预处理（例如把 /static/... 转为绝对 URL）。
   * @param {string} toolName - 工具名。
   * @param {unknown} input - 已规范化的入参。
   * @returns {unknown} 预处理后的入参。
   * @keyword-en mcp, preprocess, input, static url
   */
  private preprocessToolInput(toolName: string, input: unknown): unknown {
    if (toolName !== 'batch_task_add_post') return input;
    if (!input || typeof input !== 'object') return input;
    const rec = input as Record<string, unknown>;
    const post = rec['post'];
    if (!post || typeof post !== 'object') return input;
    const p = post as Record<string, unknown>;
    const imagesRaw = p['images'];
    if (!Array.isArray(imagesRaw)) return input;
    const images = (imagesRaw as unknown[])
      .map((x) => (typeof x === 'string' ? this.resolveStaticUrl(x) : ''))
      .filter((x) => x.length > 0);
    return { ...rec, post: { ...p, images } };
  }

  /**
   * @description 将 /static/... 这类相对路径转换为可被 MCP 服务访问的绝对 URL。
   * @param {string} input - 原始路径或 URL。
   * @returns {string} 绝对 URL 或原值。
   * @keyword-en static, url, resolve
   */
  private resolveStaticUrl(input: string): string {
    const s = String(input ?? '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (!s.startsWith('/')) return s;

    const baseCandidates = [
      process.env.APP_PUBLIC_URL,
      process.env.PUBLIC_BASE_URL,
      process.env.APP_URL,
      process.env.BASE_URL,
    ]
      .map((x) => String(x ?? '').trim())
      .filter((x) => x.length > 0);

    const portRaw = String(process.env.PORT ?? '').trim();
    const portNum = portRaw.length > 0 ? Number(portRaw) : undefined;
    const port =
      typeof portNum === 'number' && Number.isFinite(portNum) && portNum > 0
        ? portNum
        : 3011;

    const base = baseCandidates[0] ?? `http://localhost:${port}`;
    const b = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${b}${s}`;
  }

  /**
   * @description 为 MCP 工具调用增加超时保护，避免调用方无限等待。
   * @template T
   * @param {Promise<T>} p - 原始 Promise。
   * @param {number} timeoutMs - 超时时间（毫秒）。
   * @param {string} toolName - 工具名，用于错误信息。
   * @returns {Promise<T>} 超时前返回原结果，超时则抛错。
   * @throws {Error} 超时抛出 MCP_TOOL_TIMEOUT:* 错误。
   * @keyword-en mcp, timeout, promise, safeguard
   */
  private async withTimeout<T>(
    p: Promise<T>,
    timeoutMs: number,
    toolName: string,
  ): Promise<T> {
    const ms = Math.max(0, Math.floor(timeoutMs || 0));
    if (ms <= 0) return await p;
    return await Promise.race([
      p,
      new Promise<T>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`MCP_TOOL_TIMEOUT:${toolName}`)), ms);
      }),
    ]);
  }

  /**
   * @description 选择不同 MCP 工具的默认超时，避免 batch_task_add_post 等卡死。
   * @param {string} toolName - 工具名。
   * @param {unknown} _input - 入参（预留扩展）。
   * @returns {number} 超时毫秒数（<=0 表示不超时）。
   * @keyword-en mcp, timeout, tool, policy
   */
  private pickToolTimeoutMs(toolName: string): number {
    const raw = process.env.MCP_TOOL_TIMEOUT_MS;
    const base =
      typeof raw === 'string' && raw.trim().length > 0 ? Number(raw) : 60_000;
    const fallback = Number.isFinite(base) ? base : 60_000;

    if (toolName === 'batch_task_run_sync') return 15 * 60_000;
    if (toolName === 'batch_task_run') return Math.max(fallback, 2 * 60_000);
    if (toolName === 'batch_task_add_post') return Math.max(fallback, 60_000);
    return fallback;
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
    this.logger.debug(`[MCP] Raw server config: ${JSON.stringify(config)}`);
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
      const hasCommand = typeof entry['command'] === 'string' && entry['command'].length > 0;
      const hasArgs = Array.isArray(entry['args']) && entry['args'].length > 0;
      const hasUrl = typeof entry['url'] === 'string' && entry['url'].startsWith('http');

      // 显式 transport
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
        continue;
      }

      // 隐式 stdio: 有 command + args 但无显式 transport（如 { command: "uvx", args: ["pkg"] }）
      if (hasCommand && hasArgs) {
        const cmd = entry['command'] as string;
        const args = entry['args'] as string[];
        if (cmd === 'node' && args.length > 0) {
          try {
            const stat = await fs.stat(args[0]);
            if (!stat.isFile()) continue;
          } catch {
            continue;
          }
        }
        out[name] = { transport: 'stdio', command: cmd, args } as StdioServer;
        continue;
      }

      // 隐式 http/sse: 有 url 但无显式 transport
      if (hasUrl) {
        const url = entry['url'] as string;
        const headers = entry['headers'] as Record<string, string> | undefined;
        // 默认为 streamable_http，MCP SDK 会自动降级到 SSE
        out[name] = { transport: 'streamable_http', url, headers } as HttpServer;
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
