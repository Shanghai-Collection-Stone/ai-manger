# Finance-Agent Module

## 模块名称 (Module Name)

Finance-Agent

## 概述 (Overview)

财务 Agent 围绕单个 binding name 提供 Transform DSL 设计、解释、试运行与保存能力。后台接口支持同步 chat 和 SSE 流式 chat;流式 chat 会返回 token、tool_start、tool_chunk、tool_end、end/error 等事件,让前端实时展示模型输出和工具调用进度。

## 文件清单 (File List)

- `finance-agent.module.ts` — Nest 模块定义,聚合 Agent、配置、源、Transform 与推送依赖。
- `services/finance-agent.service.ts` — 财务 Agent 对外服务,提供系统提示词、工具句柄、同步 chat 与流式 chat。
- `services/finance-tools.service.ts` — LangChain 工具集合,封装 binding、source sample、transform CRUD、dry-run、外部 stores/companies 查询。
- `controller/finance-agent-admin.controller.ts` — 后台管理端财务 Agent 控制器。
- `controller/finance-agent.dto.ts` — 财务 Agent chat DTO。

## 函数清单 (Function List)

- `FinanceAgentModule()` — 财务 Agent Nest 模块 | keywords: finance-agent-module, external-resource-query
- `FinanceAgentService()` — 财务 Agent 服务类 | keywords: finance-agent-service, system-prompt
- `getToolsHandle(scope)` — 获取带 binding name 与 admin 作用域的工具集合 | keywords: finance-tools-handle, tool-scope
- `getSystemPrompt()` — 返回财务 Agent 系统提示词 | keywords: finance-agent-system-prompt, system-prompt
- `chat(scope,messages)` — 同步执行完整历史聊天并返回最终 reply | keywords: finance-agent-chat, one-shot-chat
- `streamChat(scope,messages)` — 流式执行聊天并透传 token/tool 事件 | keywords: finance-agent-chat-stream, agent-stream
- `FinanceToolsService()` — 财务 Agent 工具服务类 | keywords: finance-agent-tools, langchain-tools
- `getHandle(scope)` — 返回全部财务工具数组 | keywords: finance-tools-handle, tool-scope
- `createGetBindingTool(scope)` — 构建读取当前 binding 的工具 | keywords: binding-tool, tool-read
- `createReadSourceSampleTool(scope)` — 构建读取源样本并注入 source_alias 的工具 | keywords: source-sample-tool, alias-injection
- `createGetTransformTool(scope)` — 构建读取已保存 Transform DSL 的工具 | keywords: transform-get-tool, dsl-read
- `createPatchTransformTool(scope)` — 构建基于 JSON Pointer 局部修改或首次创建 DSL 的工具(ops + 可选 base) | keywords: transform-patch-tool, dsl-patch, json-pointer
- `applyJsonPatch(doc,ops)` — 按 RFC 6901 对文档执行 replace/add/remove 操作 | keywords: json-pointer, dsl-patch, json-patch
- `createDryRunTransformTool(scope)` — 构建 DSL 校验与样本试运行工具 | keywords: transform-dry-run-tool, dsl-validate
- `coerceDslArg(input)` — dry-run 入参兜底:把弱模型平铺/漏写的 DSL 字段并回 `dsl` 对象 | keywords: dsl-arg-coerce, weak-model-tolerance
- `createListExternalStoresTool(scope)` — 构建外部门店列表工具 | keywords: external-stores-tool, lookup-source
- `createListExternalCompaniesTool(scope)` — 构建外部公司列表工具 | keywords: external-companies-tool, lookup-source
- `fetchSample(tenantId,source,sampleSize)` — 按源类型读取样本 | keywords: source-sample-fetch, source-dispatch
- `injectSourceAlias(rows,alias?)` — 向源行 fields 注入 `source_alias` | keywords: source-alias-inject, virtual-field
- `resolveScopeId(adminUser)` — 解析 admin user 的财务作用域 ID | keywords: scope-id-resolve, tenant-scope
- `FinanceAgentAdminController()` — 后台财务 Agent 控制器类 | keywords: finance-agent-admin-controller, admin-chat
- `chat(req,body)` — `POST /admin/finance/agent/chat` 同步聊天入口 | keywords: finance-agent-chat-endpoint, one-shot-chat
- `chatStream(req,res,body)` — `POST /admin/finance/agent/chat/stream` SSE 流式聊天入口 | keywords: finance-agent-chat-stream, sse-endpoint
- `write(event,data)` — 写出单个 SSE 事件 | keywords: finance-agent-sse-write, sse-event

## 关键词索引 (Keyword Index)

| 中文              | English                   |
| ----------------- | ------------------------- |
| 财务 Agent        | finance-agent-service     |
| 流式聊天          | finance-agent-chat-stream |
| 工具事件          | sse-event                 |
| 工具集合          | finance-agent-tools       |
| DSL 局部替换/创建 | dsl-patch, json-pointer   |
| DSL 试运行        | dsl-validate              |
| 入参兜底/弱模型容错 | dsl-arg-coerce            |
| 源样本            | source-sample-fetch       |
| 外部映射来源      | lookup-source             |
| 租户作用域        | tenant-scope              |

## 类型导出 (Type Exports)

- `FinanceToolsScope` — 工具构建作用域 | keywords: finance-tools-scope, tool-scope
- `FinanceAgentChatMessageDto` — 单条 chat 消息 DTO | keywords: finance-agent-message-dto, chat-dto
- `FinanceAgentChatDto` — chat 请求 DTO | keywords: finance-agent-chat-dto, chat-dto

## 模块功能描述 (Module Feature Description)

控制器负责 admin 鉴权和 HTTP/SSE 输出;服务层负责把前端历史消息转换为 LangChain message 并装入系统提示词与财务工具。工具层始终基于 admin user 解析租户边界,并在 source sample/dry-run 时注入 `source_alias`,便于 DSL 行级映射 companyId、storeId 与 bankAccount。系统提示词要求 financial_event 产出 `attributedPeriod` 归属年月(`YYYY-MM`),并明确它与交易/业务发生日期 `occurredAt`、现金流日期 `settledAt` 分开维护。
