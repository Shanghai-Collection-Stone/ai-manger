import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
/**
 * @title 解析代理地址 Resolve Proxy URI
 * @description 按统一规则从环境变量解析当前生效的代理地址(.env 统一配置)。
 *   - dev 环境读 DEV_PROXY_ENABLED / DEV_HTTPS_PROXY|DEV_HTTP_PROXY|DEV_ALL_PROXY
 *   - 非 dev 读 PROXY_ENABLED / HTTPS_PROXY|HTTP_PROXY|ALL_PROXY
 *   - PROXY_ENABLED=false 时返回 null(显式关闭)
 *   供 enableProxyFromEnv(全局 dispatcher) 与生图专用 dispatcher 复用同一份配置,
 *   避免各处各自读环境变量导致不一致。
 * @keyword-cn 代理地址, 地址规范化, 统一代理配置
 * @keyword-en resolve-proxy-uri, proxy-uri-normalization, unified-proxy-config
 */
export function resolveProxyUriFromEnv(): string | null {
  const env = (process.env.NODE_ENV ?? '').toLowerCase();
  const isDev = env === 'development' || env === 'dev';
  let enabled = true;
  if (isDev) {
    const v = process.env.DEV_PROXY_ENABLED;
    if (typeof v !== 'undefined') enabled = v.toLowerCase() === 'true';
  } else {
    const v = process.env.PROXY_ENABLED;
    if (typeof v !== 'undefined') enabled = v.toLowerCase() === 'true';
  }
  if (!enabled) return null;
  const devProxy = isDev
    ? process.env.DEV_HTTPS_PROXY ||
      process.env.DEV_HTTP_PROXY ||
      process.env.DEV_ALL_PROXY
    : undefined;
  const proxy =
    devProxy ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY;
  if (!proxy || typeof proxy !== 'string' || proxy.trim().length === 0) {
    return null;
  }
  const normalized = proxy.trim();
  return /^[a-z][a-z\d+.-]*:\/\//i.test(normalized)
    ? normalized
    : `http://${normalized}`;
}

/**
 * @title 代理启用 Proxy Enable
 * @description 启用基于环境变量的HTTP/HTTPS代理。
 * @keywords-cn 代理, v2ray, 网络
 * @keywords-en proxy, v2ray, network
 */
export function enableProxyFromEnv(): void {
  const proxy = resolveProxyUriFromEnv();
  if (!proxy) return;
  try {
    const noProxy = parseNoProxyEnv([
      process.env.NO_PROXY,
      process.env.no_proxy,
      process.env.PROXY_NO_PROXY,
    ]);
    const dispatcher = new SelectiveProxyDispatcher(proxy, noProxy);
    setGlobalDispatcher(dispatcher as unknown as Dispatcher);
  } catch {
    void 0;
  }
}

class SelectiveProxyDispatcher {
  private readonly proxyDispatcher: ProxyAgent;
  private readonly directDispatcher: Agent;
  private readonly noProxy: string[];

  constructor(proxyUri: string, noProxy: string[]) {
    this.proxyDispatcher = new ProxyAgent(proxyUri);
    this.directDispatcher = new Agent();
    this.noProxy = Array.isArray(noProxy) ? noProxy : [];
  }

  dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    const origin = options?.origin as unknown;
    const parsed = parseOrigin(origin);
    if (parsed) {
      const hostname = parsed.hostname;
      const host = parsed.port ? `${hostname}:${parsed.port}` : hostname;
      if (shouldBypassProxy(hostname, host, this.noProxy)) {
        return this.directDispatcher.dispatch(options, handler);
      }
    }
    return this.proxyDispatcher.dispatch(options, handler);
  }

  close(): Promise<void> {
    return Promise.all([
      this.proxyDispatcher.close(),
      this.directDispatcher.close(),
    ]).then(() => void 0);
  }

  destroy(error?: Error): void {
    const err = error ?? null;
    void this.proxyDispatcher.destroy(err);
    void this.directDispatcher.destroy(err);
  }
}

function parseNoProxyEnv(values: Array<string | undefined>): string[] {
  const defaultHosts = [
    'localhost',
    '127.0.0.1',
    '::1',
    'host.docker.internal',
  ];
  const raw = values
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(',');
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const set = new Set<string>();
  for (const h of [...defaultHosts, ...parts]) set.add(h);
  return Array.from(set);
}

function parseOrigin(origin: unknown): URL | null {
  if (!origin) return null;
  if (origin instanceof URL) return origin;
  if (typeof origin === 'string') {
    try {
      return new URL(origin);
    } catch {
      return null;
    }
  }
  if (typeof origin === 'object') {
    const href = (origin as { href?: unknown }).href;
    if (typeof href === 'string') {
      try {
        return new URL(href);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function shouldBypassProxy(hostname: string, host: string, noProxy: string[]) {
  const hn = String(hostname || '')
    .trim()
    .toLowerCase();
  const h = String(host || '')
    .trim()
    .toLowerCase();
  if (!hn) return false;
  const list = Array.isArray(noProxy) ? noProxy : [];
  for (const raw of list) {
    const item = String(raw || '')
      .trim()
      .toLowerCase();
    if (!item) continue;
    if (item === '*') return true;
    if (item.includes(':')) {
      if (h === item) return true;
      continue;
    }
    if (item.startsWith('.')) {
      const suffix = item.slice(1);
      if (suffix && hn.endsWith(`.${suffix}`)) return true;
      continue;
    }
    if (hn === item) return true;
    if (hn.endsWith(`.${item}`)) return true;
  }
  return false;
}
