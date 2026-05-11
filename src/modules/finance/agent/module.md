# Finance-Agent Module

## 模块描述
财务 Agent 模块。围绕**单个 binding name** 提供「设定 / 解读 transform」对话能力。
**system prompt 内含外部财务系统的 financial_event 目标 schema**(对齐 api.md §6:`flow / stage / partyType / occurredAt / dueAt / settledAt / storeId / companyId / ...`),让 agent 生成的 DSL 直接合规。
- 工具集:`finance_get_binding` / `finance_read_source_sample` / `finance_get_transform` / `finance_set_transform` / `finance_dry_run_transform` / `finance_list_external_stores` / `finance_list_external_companies`
- storeId/companyId 不在 source 级别绑定。Agent 通过 `finance_list_external_stores/companies` 工具拿目标系统 ID 列表,然后用 `compute: lookup` 从源行字段(如"门店"、"商户号"、"备注")映射
- **每个 source 的 `alias` 就是表定义**(用户起的名字本身已携带语义,如"云境上海银行流水")。tools 拉行后把 alias 注入到每行 fields 的 `source_alias` 保留字段(与 `record_id` 同风格),DSL 通过 `from: "source_alias"` 行级引用 + `compute: lookup` 映射成 companyId/bankAccount 等
- 暴露 `getToolsHandle(scope)` 与 `getSystemPrompt()`(可供其他 chat 入口接入)
- **后台 chat 入口**:`POST /admin/finance/agent/chat`,传 `{ name, messages[] }`,返回 `{ reply }`
- 工具内部 closure 校验租户边界(基于 admin user)

文件路径: `src/modules/finance/agent`

## 功能描述及关键词

### services/finance-tools.service.ts
LangChain 工具集合(zod schema + tool() 包装),按 admin user + binding name 维度构建。
- **关键词**: finance agent tools, langchain, zod schema, transform crud by name, source sample, dry run, external stores companies query
- **类型**: `FinanceToolsScope`: `{ adminUser, name }`
- **函数**:
  - `getHandle`: 返回工具数组(7 个)/get tools handle
  - `createGetBindingTool`: 取当前 name 绑定(sources/flowDefault/partyTypeDefault)/get binding tool
  - `createReadSourceSampleTool`: 拉源样本(默认 5 行,自动注入 source_alias 到样本 fields)/read source sample with alias injection
  - `createGetTransformTool`: 取已保存 DSL /get transform tool
  - `createSetTransformTool`: 保存 DSL(落库前 validator 校验)/set transform tool
  - `createDryRunTransformTool`: 试运行 DSL(自动注入 source_alias,不落库)/dry run transform tool with alias injection
  - `injectSourceAlias`: 把 source.alias 注入到样本行 fields 的 source_alias 字段(私有 helper)/inject source alias into row fields
  - `createListExternalStoresTool`: 列外部 stores(给 Agent 写 lookup map 用)/list external stores
  - `createListExternalCompaniesTool`: 列外部 companies /list external companies
  - `fetchSample`: 按源类型分发 /fetch sample dispatch
  - `resolveScopeId`: 解析作用域 ID /resolve scope id

### services/finance-agent.service.ts
对外服务(暴露工具句柄、system prompt,以及后台同步 chat)。
- **关键词**: finance agent service, financial_event schema prompt, tools handle, chat one-shot
- **system prompt 重点**:产出 financial_event 字段、stage 中文 → 枚举映射、强制 const 表达 flow/partyType、storeId/companyId 通过 lookup 从源行字段映射(先调 list_external_stores/companies 拿 ID 列表,再设计 lookup map);**externalId 默认用 `from: "record_id"`(每条源行 fields 自动带,飞书 record_id 或审批 instance_code 的统一 key)**
- **函数**:
  - `getToolsHandle`: 工具句柄(含 binding name)/get tools handle
  - `getSystemPrompt`: 系统提示词 /get system prompt
  - `chat`: 后台同步聊天(传完整历史 messages)/finance agent chat

### controller/finance-agent-admin.controller.ts
后台 chat 控制器,挂 `/admin/finance/agent`。
- **关键词**: finance agent admin controller, chat by name, admin auth guard
- **函数**: `chat`: POST /chat 传 `{ name, messages }` 同步聊天 /finance agent chat endpoint

### controller/finance-agent.dto.ts
DTO 定义。
- **关键词**: finance agent dto, chat by binding name, class-validator
- **类型**:
  - `FinanceAgentChatMessageDto`: 单条消息(role + content)
  - `FinanceAgentChatDto`: 聊天请求(`name + messages[]`)

### finance-agent.module.ts
模块定义。
- **关键词**: finance agent module, providers, controllers, exports
