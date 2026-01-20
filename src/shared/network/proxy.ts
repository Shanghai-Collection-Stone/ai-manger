import { ProxyAgent, setGlobalDispatcher } from 'undici';
/**
 * @title 代理启用 Proxy Enable
 * @description 启用基于环境变量的HTTP/HTTPS代理。
 * @keywords-cn 代理, v2ray, 网络
 * @keywords-en proxy, v2ray, network
 */
export function enableProxyFromEnv(): void {
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
  if (!enabled) return;
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
  if (!proxy || typeof proxy !== 'string' || proxy.length === 0) return;
  try {
    const agent = new ProxyAgent(proxy);
    setGlobalDispatcher(agent);
  } catch {
    void 0;
  }
}
