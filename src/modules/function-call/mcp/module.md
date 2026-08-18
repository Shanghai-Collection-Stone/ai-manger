# MCP-Function-Call Module

## 模块描述
该模块实现 MCP 资源工具与原生 MCP 工具加载能力：列出资源、读取资源、文件录入，并将 MCP 服务端暴露的工具提供给 Agent 使用，以访问或管理上下文资源。
文件路径: `src/modules/function-call/mcp`

## 功能描述及关键词

### mcp.service.ts
MCP核心服务。
- **关键词**: mcp, adapters, resources, ingest, tool, function-call, batch-task, servers, mcp-resources, service

### mcp-storage.service.ts
MCP存储服务。
- **关键词**: storage, service

### mcp-adapter.service.ts
MCP适配器服务。除全量缓存外，支持按服务名隔离读取工具，供仅允许特定 MCP 的业务 Agent 使用。
- **关键词**: adapters, service, mcp-server-tools, server-isolation
- **函数**:
  - `getToolsForServer(serverName)` — 按 MCP 服务名读取隔离工具集 | keywords: MCP服务工具, 服务隔离, mcp-server-tools, server-isolation

### mcp.module.ts
MCP模块定义。
- **关键词**: module
