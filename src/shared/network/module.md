# Shared Network 模块

## 模块描述
共享网络层工具。提供基于环境变量的统一 HTTP/HTTPS 代理配置能力。
文件路径: `src/shared/network`

## 功能描述及关键词

### proxy.ts
基于环境变量的统一代理配置。应用启动时 `enableProxyFromEnv()` 调 `setGlobalDispatcher` 设置全局 undici dispatcher;`SelectiveProxyDispatcher` 按 NO_PROXY 白名单选择走代理或直连。
- **关键词**: proxy, v2ray, undici, dispatcher, setGlobalDispatcher, no-proxy, selective
- **函数**:
  - `resolveProxyUriFromEnv`: 按统一规则从环境变量解析当前生效代理地址。dev 读 DEV_PROXY_ENABLED + DEV_HTTPS_PROXY|DEV_HTTP_PROXY|DEV_ALL_PROXY,非 dev 读 PROXY_ENABLED + HTTPS_PROXY|HTTP_PROXY|ALL_PROXY;PROXY_ENABLED=false 返回 null。供 enableProxyFromEnv 与生图专用 dispatcher(agent.service imageGenDispatcher)复用同一份配置/resolve proxy uri from env
  - `enableProxyFromEnv`: 启动时设置全局 dispatcher。代理地址来自 resolveProxyUriFromEnv,叠加 NO_PROXY 白名单构造 SelectiveProxyDispatcher/enable proxy from env
- **类**:
  - `SelectiveProxyDispatcher`: 选择性代理 dispatcher。dispatch 时按 origin hostname 匹配 noProxy 白名单(支持 `*` / `.suffix` / `host:port` / 精确域名),命中则走 directDispatcher(Agent),否则走 proxyDispatcher(ProxyAgent)/selective proxy dispatcher
