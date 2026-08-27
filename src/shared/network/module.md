# Shared Network 模块

## 模块描述
共享网络层工具。提供基于环境变量的统一 HTTP/HTTPS 代理配置能力。
文件路径: `src/shared/network`

## 功能描述及关键词

### proxy.ts
基于环境变量的统一代理配置。应用启动时 `enableProxyFromEnv()` 调 `setGlobalDispatcher` 设置全局 undici dispatcher;`SelectiveProxyDispatcher` 按 NO_PROXY 白名单选择走代理或直连。
- **关键词**: proxy, v2ray, undici, dispatcher, setGlobalDispatcher, no-proxy, selective
- **函数**:
  - `resolveProxyUriFromEnv()`: 按统一规则读取代理地址，并把 `host:port` 规范为 `http://host:port`，供全局与生图 dispatcher 复用 — 解析统一代理配置 | keywords: 代理地址, 地址规范化, 统一代理配置, resolve-proxy-uri, proxy-uri-normalization, unified-proxy-config
  - `enableProxyFromEnv`: 启动时设置全局 dispatcher。代理地址来自 resolveProxyUriFromEnv,叠加 NO_PROXY 白名单构造 SelectiveProxyDispatcher/enable proxy from env
- **类**:
  - `SelectiveProxyDispatcher`: 选择性代理 dispatcher。dispatch 时按 origin hostname 匹配 noProxy 白名单(支持 `*` / `.suffix` / `host:port` / 精确域名),命中则走 directDispatcher(Agent),否则走 proxyDispatcher(ProxyAgent)/selective proxy dispatcher

### feishu-http-instance.ts
飞书 SDK 专用 httpInstance。SelectiveProxyDispatcher 只作用于 undici fetch,对飞书 SDK 内部 axios 无效;axios 会读 OS 级 HTTP_PROXY/HTTPS_PROXY 把 open.feishu.cn 错误经本地代理明文 HTTP 发往 HTTPS 端口(400 → tenant_access_token 为空 → 崩溃),故强制飞书 axios 直连。
- **关键词**: feishu, lark, axios, proxy, no-proxy, tenant-access-token, httpInstance, 直连
- **函数**:
  - `createFeishuHttpInstance()`: 复用 SDK 自带 defaultHttpInstance(保留响应解包 interceptor)并强制 proxy=false,返回直连 axios 实例供 lark.Client 的 httpInstance 使用/feishu lark sdk direct http instance no proxy
