# Admin UI Module

## 模块描述

后台管理前端:提供用户/租户/API Key/数据源等管理能力,并提供看板配置映射管理页面(租户 -> JSON 配置文件路径)。
支持 AI 提供商按模型类型管理(llm/em/image),并支持平台 AI 配置中的"是否开启 AI 封面"开关。
新增"小红书采集"Tab:切换数据采集渠道(SuperClaw 节点 / TikHub 开放接口)、设置每天固定抓取时刻(默认 23:59,服务器本地时区)、配置并自检 TikHub API Key。
新增"热点采集榜"Tab:热点采集规则管理(含可用性自检)、触发采集(默认清除历史)、榜单浏览与过滤、AI 归类标签弹窗、按母选题推荐热点;由独立组件 `HotTopicPanel.jsx` 承载,后端见 [hot-topic 模块](../../../../src/modules/hot-topic/module.md)。
**租户隔离**:`tenant_admin` 不可见 AI 提供商、租户管理 Tab;看板配置映射锁定到自己租户。

文件路径: `web/src/ui/Admin`

## 功能描述及关键词

### AdminApp.jsx

后台管理主应用,包含多 Tab 管理界面与数据加载逻辑,刷新后保留上次点击 Tab。平台 SuperClaw Tab 支持节点 CRUD、一次性 Token 展示/轮换、连接状态和工作区槽位查看；租户管理表单选择 SuperClaw 后，该租户全部工作区归属并计入所选节点。
**代码分割**: `@uiw/react-md-editor`(含 CodeMirror,约 1.6 MB)改为 `React.lazy` 按需加载 — 模块内自建 `MDEditor` 与 `MDEditor.Markdown` 两个 Suspense 包装组件,三处调用点写法不变;编辑器样式表仍静态引入避免 FOUC。后台首屏包由 1.77 MB 降到 88 KB。

- **函数**(代码分割相关):
  - `MDEditor(props)` — 按需加载的 Markdown 编辑器包装 | keywords: lazy-import, markdown-editor
  - `MDEditor.Markdown(props)` — 按需加载的 Markdown 只读渲染包装 | keywords: lazy-import, markdown-preview
    Tab 按角色过滤:`platformOnly` 仅 super_admin 可见;`tenantOnly` 仅租户级用户可见(super_admin 隐藏)。
    **飞书凭证 / 财务**对所有用户开放:tenant_admin 看到自己租户的;super_admin 看到平台自身的(service 内部统一用 `__platform__` 作为作用域占位符)。
    **飞书凭证 Tab 改为单条本作用域表单(无表格、无租户列)**;
    **财务 Tab(简化版,对齐 api.md `financial_event` 统一模型)**:
- 顶部:推送配置卡片(默认折叠,显示 baseUrl + 外部租户 ID 摘要 + 连通性 badge;展开后才有 baseUrl/apiKey/外部租户 ID 输入与"测试连通性")
- 推送结果反馈(全宽,**SSE 流式**:推送中实时显示蓝色进度条+最后一条 log,执行日志区随后端 onLog 逐条追加;结束后切到成功/失败摘要 + 完整错误信息 + 对方原始响应 body + 该批前 3 条 payload + 完整执行日志;失败时提供"复制详情"和"发给 Agent"两个按钮一键把 markdown 化的完整失败详情送给 LLM 排错)
- 子 Tab(流水表 / 审批表 / 应付表 / 应收表,FINANCE_KINDS 预设 — name/flow/partyType 自动注入,用户不感知)
  - 流水表:bank,partyType=counterparty,flow 不预设(由 DSL 按金额正负决定)
  - 审批表:expense,flow=out,partyType=employee(报销审批,stage 由审批状态映射)
  - 应付表:payable,flow=out,partyType=supplier
  - 应收表:receivable,flow=in,partyType=customer
- 子 Tab 内左 2/3:源绑定卡片(添加多维表 / 审批,只配源本身;不在源上选门店 — 同一银行/审批常跨多门店)+ 备注 + 保存 / 立即推送 + **推送时间窗(date 选择器,按 occurredAt 过滤,留空=全量)** + 折叠的"高级:Transform DSL"区。门店/公司归属由 Agent 用 `compute: lookup` 从源字段映射,Agent 自带工具调外部 API 拿 storeId 列表
- 每个 source 没有额外的"表定义"配置 — `alias` 字段(如"云境上海银行流水")本身就是表定义。后端在拉行时把它注入到每行 fields 的 `source_alias` 保留字段(与 `record_id` 同风格),DSL 行级可用 `from: "source_alias"` + `compute: lookup` 映射成 companyId/bankAccount 等
- **聊天记忆持久化**:`financeChat` 用 localStorage(`finance_chat_history` key)按 binding name 分别保存 messages,刷新页面不丢;只有点"清空"按钮才删该 binding 的历史
- 子 Tab 内右 1/3:Agent 对话(sticky),**SSE 流式**显示回复 token、当前状态与 Tool 调用参数/结果摘要,避免等待期间无反馈
- **关键词**: admin ui, tabs, crud, localStorage, dashboard config mapping, tenant isolation, ai provider, glm, z.ai, kimi, moonshot, image category, ai cover toggle, ai provider test connection button, feishu credential single tenant, finance preset kinds (FINANCE_KINDS), expense payable sub tabs, hidden name flow partyType auto inject, collapsible push config, auto-loaded stores companies, collapsed dsl advanced

#### finance 相关常量与函数

- `FINANCE_KINDS`: 子 Tab 预设(支出/应付,内含 id=name + flowDefault + partyTypeDefault + hint)/finance kinds preset
- `formatFinanceToolValue`: 格式化 Agent 工具参数/结果用于聊天气泡展示/format finance agent tool value | keywords: finance-agent-tool-value, tool-display
- `mergeFinanceToolEvent`: 合并 Agent tool_start/tool_chunk/tool_end 到单条 assistant 消息/merge finance agent tool event | keywords: finance-agent-tool-event, tool-stream
- `sanitizeFinanceAgentMessages`: 发送前清洗聊天历史,只保留后端 DTO 允许的 role/content/sanitize finance agent messages | keywords: finance-agent-message-sanitize, chat-payload
- `onSelectFinanceBinding`: 把指定 name 的 binding/transform 同步到表单(切 Tab 自动调用)/sync by preset name
- `onAddBitableSource` / `onCloseBitableModal` / `onLoadBitableTables` / `onToggleBitableTable` / `onConfirmBitableModal`: 多维表批量添加弹窗 /bitable picker handlers
- `onAddApprovalSource`: 追加审批源 /add approval source
- `onUpdateSourceField`: 修改 source 字段(type/appToken/tableId/approvalCode/alias)/update source field
- `onRemoveSource`: 移除 source /remove source
- `onSubmitFinanceBinding`: 保存当前子 Tab 的 binding(name + flow/partyType 默认值由 FINANCE_KINDS 自动注入)/submit binding with preset
- `onUpdateFinanceChatInput` / `onClearFinanceChat`: 聊天联动 /chat input
- `reloadFinanceTransforms`: 刷 transform 显示(agent 落库后)/reload transforms
- `onSendFinanceChat`: 发送聊天(按 name;请求前用 `sanitizeFinanceAgentMessages` 去掉 UI-only 的 tools/streaming/status/toolResults,再走 `chatFinanceAgentStream` 流式更新 assistant 消息和工具状态)/send chat by name with sanitized stream
- `onSubmitFinanceTransform`: 保存 DSL(name 取自当前子 Tab)/submit transform with preset
- `onSubmitFinancePushConfig`: 保存全局推送配置和 webhook 外部租户映射 /submit push config
- `onTestFinancePush`: 测试 /me /test connectivity
- `onRunFinancePush`: 按 binding name 立即推送(**走 SSE 流式接口** `runFinancePushStream`,onLog 实时把每条日志追加到 `financePushFeedback.logs`;`streaming:true` 时 UI 显示推送进度条与最后一条 log,streaming 结束后 onResult 覆盖摘要字段)/run push by name with streaming logs
- `formatPushFailureMarkdown`: 把推送失败详情格式化成 Markdown(HTTP/错误信息/对方原始响应/前 3 条 payload)/format push failure as markdown
- `onCopyPushFailure`: 复制失败详情到剪贴板 /copy push failure to clipboard
- `onSendPushFailureToAgent`: 把失败详情塞进当前 binding 的 Agent 输入框 /send push failure to agent composer

#### 通用函数

- `toText` / `toLower` / `readAdminActiveTab` / `writeAdminActiveTab` / `toDateInput` / `getRoleLabel` / `hasAdminFullAccess` / `isSuperAdmin` / `ALL_TABS` / `buildPagedRows` / `renderPager` / `loadData` / `updateForm` / `updateFilter` / `gotoPage`
- `reloadDashboardConfigs` / `onSubmitDashboardConfig` / `onDeleteDashboardConfig` / `onSubmitPlatformInfo`
- `onSubmitFeishuCredential` / `onDeleteFeishuCredential`
- `onSubmitXhsCrawlSettings()` — 保存每日抓取时刻(`HH:mm`)、采集渠道与 TikHub 凭证；Key 输入框留空即不改动已保存的 Key | keywords: 保存采集设置, 每日定点, submit-xhs-crawl-settings, daily-crawl-time
- `onClearTikhubApiKey()` — 发空串清空已保存的 TikHub API Key | keywords: 清空密钥, 移除凭证, clear-tikhub-api-key, remove-credential
- `onTestTikhubConnection()` — 用已保存的 Key 与域名做一次 TikHub 连通性自检 | keywords: 测试TikHub连接, 密钥自检, test-tikhub-connection, api-key-probe
- `XHS_CRAWL_CHANNELS` / `TIKHUB_BASE_URLS` — 采集渠道与 API 域名选项，取值与后端 `XhsCrawlChannel`、域名白名单逐字一致 | keywords: 采集渠道选项, 接口域名选项, crawl-channel-options, base-url-options
- `XHS_CRAWL_DEFAULT_AT` / `XHS_CRAWL_AT_PATTERN` — 默认每日抓取时刻(`23:59`，与后端 `DEFAULT_CRAWL_DAILY_AT` 一致)与 `HH:mm` 格式校验 | keywords: 默认抓取时刻, 每日定点, default-crawl-time, daily-fixed-time
- `onTestProvider(id)`: AI 提供商测试连接按钮 handler(列表里每行的「测试连接」按钮触发,成功时绿色 notice 显示状态+延迟+模型数+前 3 个模型名,失败时红色 error 显示状态+endpoint+原始错误 message,disable 阻止重复点击)/test ai provider handler
- `reloadSuperClaws()` — 刷新平台节点与容量 | keywords: 刷新节点, 容量状态, reload-super-claws, capacity-status
- `onSubmitSuperClaw()` — 创建或更新 SuperClaw | keywords: 提交节点, 总容量, submit-super-claw, total-capacity
- `onDeleteSuperClaw(id)` — 删除空闲 SuperClaw | keywords: 删除节点, 占用保护, delete-super-claw, allocation-guard
- `onRotateSuperClawToken(id)` — 轮换并展示一次性 Token | keywords: 轮换密钥, 一次性令牌, rotate-super-claw-token, one-time-token
- `onCopySuperClawToken()` — 复制一次性 Token | keywords: 复制密钥, 一次性展示, copy-super-claw-token, one-time-display
- `onSubmitTenant()` — 保存租户并同步工作区节点归属 | keywords: 提交租户, 工作区归属, submit-tenant, workspace-node-assignment
- `onDeleteTenant(id)` — 删除未分配节点的租户 | keywords: 删除租户, 分配保护, delete-tenant, allocation-protection

### HotTopicPanel.jsx

后台「热点采集榜」Tab 的独立面板组件,由 `AdminApp.jsx` 在 `activeTab === 'hot_topic'` 时挂载并透传 `onNotice` / `onError` 两个顶层提示回调。分四块:采集规则表格(勾选参与本次采集、启用开关、**是否可用徽标 + 失败原因 + 最近自检时间**、自检/编辑/删除、初始化预置规则)、规则编辑表单(榜单地址、榜单数组路径、标题/链接/热度/摘要取值路径、链接模板、兜底标签、附加请求头 JSON)、执行采集(「采集前清除之前的」**默认勾选**、「采集后 AI 归类打标」默认勾选、逐规则回执)、当前热点榜(分类/来源/标签/标题关键词过滤 + 分页 + 补跑归类 + 清空)与按母选题推荐热点。榜单表格的**标题列限宽并单行截断**(标题与摘要都 `truncate`,悬停 `title` 看全文),标签列固定 132px:摘要动辄上百字,不限宽会把来源/热度/采集时间几列挤出屏幕。「查看采集标签」按钮打开弹窗,把全部 AI 归类标签按条目数倒序线性铺开(标签、条目数、最近时间、出现分类、示例标题),点任一标签即把下方榜单过滤到该标签。后端见 [hot-topic 模块](../../../../src/modules/hot-topic/module.md)。

- **关键词**: hot topic panel, collect rule table, availability badge, clear previous default, ai tag dialog, parent topic recommend
- **常量**:
  - `HEALTH_BADGES` — 可用性状态徽标映射,取值与后端 `HotTopicRuleHealthStatus` 逐字一致 | keywords: 可用状态映射, 状态徽标, health-status-map, status-badge
  - `EMPTY_RULE_FORM` — 新建规则表单初始值,字段与后端 `CreateHotTopicRuleDto` 一一对应 | keywords: 规则表单初值, 表单字段, empty-rule-form, form-fields
- **函数**:
  - `ruleToForm(rule)` — 把规则实体铺平成表单值供编辑回填 | keywords: 规则转表单, 编辑回填, rule-to-form, edit-prefill
  - `formToPayload(form)` — 表单值转接口入参,请求头按 JSON 解析,非法即抛 | keywords: 表单转入参, 请求头解析, form-to-payload, headers-parse
  - `formatTime(value)` — 时间格式化成 `YYYY-MM-DD HH:mm`,空值显示占位符 | keywords: 时间格式化, 空值占位, format-datetime, empty-placeholder
  - `HotTopicPanel({ onNotice, onError })` — 热点采集榜面板主体 | keywords: 热点采集面板, 采集规则管理, 标签弹窗, hot-topic-panel, collect-rule-admin, tag-dialog
  - `run(key, fn, successText)` — 统一包装异步动作:置忙、失败上抛顶层错误、成功给 notice | keywords: 异步动作包装, 统一提示, async-action-wrapper, unified-feedback
  - `loadRules()` / `loadItems(nextFilter)` — 拉取采集规则列表与按当前过滤条件拉榜单条目和概况 | keywords: 加载采集规则, 加载榜单条目, load-rules, load-items
  - `onSeed()` — 初始化内置社会/娱乐热点预置规则 | keywords: 初始化预置规则, 幂等补齐, seed-builtin-rules, idempotent-fill
  - `onCheckRule(rule)` — 对一条规则做真实抓取自检并刷新可用性徽标 | keywords: 规则自检, 可用性探测, rule-self-check, availability-probe
  - `onToggleEnabled(rule)` — 切换规则启用状态;停用后不再参与任何采集 | keywords: 切换启用, 采集闸门, toggle-enabled, collect-gate
  - `onDeleteRule(rule)` / `onSubmitRule()` — 删除规则(二次确认)与提交新建/更新规则表单 | keywords: 删除采集规则, 提交规则表单, delete-rule, submit-rule-form
  - `onCollect()` — 触发采集:默认先清除历史再采,采完自动 AI 归类 | keywords: 触发采集, 默认清除历史, trigger-collect, clear-previous-default
  - `onRetag()` / `onClearItems()` — 补跑未归类条目的 AI 归类与清空榜单(二次确认) | keywords: 补跑归类, 清空榜单, retag-pending, clear-items
  - `onOpenTagDialog()` — 打开标签弹窗,线性拉取全部归类标签及条目数与示例标题 | keywords: 打开标签弹窗, 线性查看标签, open-tag-dialog, linear-tag-view
  - `onPickTag(tag)` — 从标签弹窗点标签,直接把榜单过滤到该标签 | keywords: 按标签过滤, 弹窗联动, filter-by-tag, dialog-linkage
  - `onRecommend()` — 按母选题调用推荐接口并展示结构化推荐结果;结果头部回显 `matchedTags`(候选被哪几个标签圈出来的)或「未命中相关标签,已在全量榜单里判定」 | keywords: 热点推荐, 母选题匹配, 粗筛标签回显, recommend-hot-topics, parent-topic-match, matched-tags-echo
  - `onApplyFilter(patch)` — 应用榜单过滤条件并回到第一页 | keywords: 应用过滤, 重置分页, apply-filter, reset-page

### AdminLoginApp.jsx

后台登录页:选择租户并登录,写入 token 并跳转。

- **关键词**: admin login, tenant select, token
- **函数**:
  - `hasAdminFullAccess`: 权限判断 /check full access
  - `readLoginIntent`: 读取来源 /read login intent
  - `resolvePostLoginTarget`: 登录后跳转 /resolve post login target

### adminApi.js

后台 API 封装:管理端接口请求、token 存取、页面跳转地址解析。注意:`request()` 内部已拼接 `/admin` 前缀,调用方路径不得重复。

- **关键词**: api, bearer token, request, redirect, social-accounts, finance named bindings, global push config, external stores companies
- **函数**:
  - `getAdminToken` / `setAdminToken` / `clearAdminToken`: token 存取
  - `resolveAdminPageHref` / `resolveFrontendPageHref` / `resolveLoginPageHref`: 页面跳转
  - `request`: 统一请求(内置 `/admin` 前缀)
  - `apiRequest`: 业务接口请求(不带 `/admin` 前缀,复用同一份后台 token;小红书采集设置走的是 `/api/xhs-topic-data/*`)/business api request
  - `adminApi.getXhsCrawlSettings` / `saveXhsCrawlSettings` / `testTikhubConnection`: 小红书采集设置读写与 TikHub 连通性自检
  - `adminApi.getHotTopicMeta`: 读取热点分类枚举与 AI 归类推荐词表 | keywords: 热点元数据, 分类枚举, hot-topic-meta, category-enum
  - `adminApi.listHotTopicRules` / `createHotTopicRule` / `updateHotTopicRule` / `deleteHotTopicRule`: 热点采集规则 CRUD(启用开关也走 update) | keywords: 采集规则CRUD, 启用开关, hot-topic-rule-crud, enabled-toggle
  - `adminApi.seedHotTopicRules`: 幂等初始化内置社会/娱乐热点预置规则 | keywords: 初始化预置规则, 幂等补齐, seed-builtin-rules, idempotent-fill
  - `adminApi.checkHotTopicRule(id)`: 对采集规则做真实抓取自检并回写可用性(只跑不落库) | keywords: 规则自检, 可用性探测, check-hot-topic-rule, availability-probe
  - `adminApi.collectHotTopics(payload)`: 触发一次采集;`clearPrevious` 不传即按默认 true(先清后采) | keywords: 触发热点采集, 默认清除历史, collect-hot-topics, clear-previous-default
  - `adminApi.retagHotTopics`: 对尚未 AI 归类的条目补跑一次归类 | keywords: 补跑归类, 未归类条目, retag-hot-topics, untagged-items
  - `adminApi.listHotTopicItems(query)` / `clearHotTopicItems(ruleIds?)`: 榜单条目分页查询(分类/规则/标签/关键词)与清库 | keywords: 榜单列表, 清空榜单, list-hot-topic-items, clear-hot-topic-items
  - `adminApi.listHotTopicTags`: 线性读取全部 AI 归类标签及条目数/分类/示例标题(标签弹窗数据源) | keywords: 采集标签汇总, 线性查看标签, hot-topic-tag-summary, linear-tag-view
  - `adminApi.recommendHotTopics(payload)`: 按母选题从当前热点榜推荐适配热点(后端两阶段:先按标签粗筛圈定范围,再看该范围内全部热点标题),返回结构化 JSON 并带 `matchedTags` / `tagFiltered` | keywords: 热点推荐, 母选题匹配, 两阶段推荐, recommend-hot-topics, parent-topic-match, two-stage-recommend
  - `adminApi.listXhsAccounts` / `createXhsAccount` / `updateXhsAccount` / `deleteXhsAccount` / `testLoginXhsAccount`
  - `adminApi.listFeishuCredentials` / `upsertFeishuCredential` / `deleteFeishuCredential`: 飞书凭证 CRUD
  - `adminApi.listFinanceBindings` / `upsertFinanceBinding` / `deleteFinanceBinding`: 财务源绑定 CRUD(按 name)
  - `adminApi.listBitableTables`: 按 appToken 列飞书多维表
  - `adminApi.getFinancePushConfig` / `upsertFinancePushConfig` / `deleteFinancePushConfig`: 推送配置 CRUD(每作用域一份,包含外部租户 ID 映射)
  - `adminApi.testFinancePush`: 测试 /me 探活
  - `adminApi.runFinancePushStream(name, opts, { onLog, onResult, onError, onEnd })`: 按 binding name 立即推送的 SSE 流式封装(fetch + ReadableStream + TextDecoder,逐帧解析 `event:`/`data:` 然后分派回调)/run push as sse stream
  - `adminApi.listExternalStores` / `listExternalCompanies`: 透传外部 stores/companies 列表
  - `adminApi.listFinanceTransforms` / `upsertFinanceTransform` / `deleteFinanceTransform`: 财务 transform DSL CRUD(按 name)
  - `adminApi.chatFinanceAgent`: 财务 Agent 同步聊天(传 `{ name, messages }`)
  - `adminApi.chatFinanceAgentStream(payload, callbacks)`: 财务 Agent SSE 流式聊天封装(fetch + ReadableStream + TextDecoder,逐帧分发 token/tool/end/error)/finance agent chat stream | keywords: finance-agent-chat-stream, sse-chat
  - `adminApi.testProvider(id)`: 测试 AI 提供商连通性(POST /admin/ai-providers/:id/test,GET /models 探活, 15s 超时, 不消耗配额)/test ai provider
  - `adminApi.listSuperClaws()` — 平台 SuperClaw 节点列表 | keywords: 节点列表, 平台管理, super-claw-list, platform-management
  - `adminApi.createSuperClaw(payload)` — 创建节点并接收一次性 Token | keywords: 创建节点, 一次性令牌, super-claw-create, one-time-token
  - `adminApi.updateSuperClaw(id, payload)` — 更新节点与容量 | keywords: 更新节点, 容量上限, super-claw-update, capacity-limit
  - `adminApi.deleteSuperClaw(id)` — 删除空闲节点 | keywords: 删除节点, 占用保护, super-claw-delete, allocation-guard
  - `adminApi.rotateSuperClawToken(id)` — 轮换节点密钥 | keywords: 轮换令牌, 密钥管理, super-claw-token-rotate, secret-management
  - `adminApi.assignTenantSuperClaw(tenantId, payload)` — 设置租户节点并迁移工作区 | keywords: 租户节点归属, 工作区迁移, tenant-node-assignment, workspace-migration
