# Admin UI Module

## 模块描述
后台管理前端:提供用户/租户/API Key/数据源等管理能力,并提供看板配置映射管理页面(租户 -> JSON 配置文件路径)。
支持 AI 提供商按模型类型管理(llm/em/image),并支持平台 AI 配置中的"是否开启 AI 封面"开关。
**租户隔离**:`tenant_admin` 不可见 AI 提供商、租户管理 Tab;看板配置映射锁定到自己租户。

文件路径: `web/src/ui/Admin`

## 功能描述及关键词

### AdminApp.jsx
后台管理主应用,包含多 Tab 管理界面与数据加载逻辑,刷新后保留上次点击 Tab。
Tab 按角色过滤:`platformOnly` 仅 super_admin 可见;`tenantOnly` 仅租户级用户可见(super_admin 隐藏)。
**飞书凭证 / 财务**对所有用户开放:tenant_admin 看到自己租户的;super_admin 看到平台自身的(service 内部统一用 `__platform__` 作为作用域占位符)。
**飞书凭证 Tab 改为单条本作用域表单(无表格、无租户列)**;
**财务 Tab(简化版,对齐 api.md `financial_event` 统一模型)**:
- 顶部:推送配置卡片(默认折叠,显示 baseUrl 摘要 + 连通性 badge;展开后才有 baseUrl/apiKey 输入与"测试连通性")
- 推送结果反馈(全宽,推送后显示成功/失败摘要 + 完整错误信息 + 对方原始响应 body + 该批前 3 条 payload + 折叠的"执行日志"区显示后端 push runner 累积的关键步骤 log;失败时提供"复制详情"和"发给 Agent"两个按钮一键把 markdown 化的完整失败详情送给 LLM 排错)
- 子 Tab(流水表 / 审批表 / 应付表 / 应收表,FINANCE_KINDS 预设 — name/flow/partyType 自动注入,用户不感知)
  - 流水表:bank,partyType=counterparty,flow 不预设(由 DSL 按金额正负决定)
  - 审批表:expense,flow=out,partyType=employee(报销审批,stage 由审批状态映射)
  - 应付表:payable,flow=out,partyType=supplier
  - 应收表:receivable,flow=in,partyType=customer
- 子 Tab 内左 2/3:源绑定卡片(添加多维表 / 审批,只配源本身;不在源上选门店 — 同一银行/审批常跨多门店)+ 备注 + 保存 / 立即推送 + **推送时间窗(date 选择器,按 occurredAt 过滤,留空=全量)** + 折叠的"高级:Transform DSL"区。门店/公司归属由 Agent 用 `compute: lookup` 从源字段映射,Agent 自带工具调外部 API 拿 storeId 列表
- 每个 source 没有额外的"表定义"配置 — `alias` 字段(如"云境上海银行流水")本身就是表定义。后端在拉行时把它注入到每行 fields 的 `source_alias` 保留字段(与 `record_id` 同风格),DSL 行级可用 `from: "source_alias"` + `compute: lookup` 映射成 companyId/bankAccount 等
- **聊天记忆持久化**:`financeChat` 用 localStorage(`finance_chat_history` key)按 binding name 分别保存 messages,刷新页面不丢;只有点"清空"按钮才删该 binding 的历史
- 子 Tab 内右 1/3:Agent 对话(sticky)
- **关键词**: admin ui, tabs, crud, localStorage, dashboard config mapping, tenant isolation, ai provider, image category, ai cover toggle, feishu credential single tenant, finance preset kinds (FINANCE_KINDS), expense payable sub tabs, hidden name flow partyType auto inject, collapsible push config, auto-loaded stores companies, collapsed dsl advanced

#### finance 相关常量与函数
- `FINANCE_KINDS`: 子 Tab 预设(支出/应付,内含 id=name + flowDefault + partyTypeDefault + hint)/finance kinds preset
- `onSelectFinanceBinding`: 把指定 name 的 binding/transform 同步到表单(切 Tab 自动调用)/sync by preset name
- `onAddBitableSource` / `onCloseBitableModal` / `onLoadBitableTables` / `onToggleBitableTable` / `onConfirmBitableModal`: 多维表批量添加弹窗 /bitable picker handlers
- `onAddApprovalSource`: 追加审批源 /add approval source
- `onUpdateSourceField`: 修改 source 字段(type/appToken/tableId/approvalCode/alias)/update source field
- `onRemoveSource`: 移除 source /remove source
- `onSubmitFinanceBinding`: 保存当前子 Tab 的 binding(name + flow/partyType 默认值由 FINANCE_KINDS 自动注入)/submit binding with preset
- `onUpdateFinanceChatInput` / `onClearFinanceChat`: 聊天联动 /chat input
- `reloadFinanceTransforms`: 刷 transform 显示(agent 落库后)/reload transforms
- `onSendFinanceChat`: 发送聊天(按 name)/send chat by name
- `onSubmitFinanceTransform`: 保存 DSL(name 取自当前子 Tab)/submit transform with preset
- `onSubmitFinancePushConfig`: 保存全局推送配置 /submit push config
- `onTestFinancePush`: 测试 /me /test connectivity
- `onRunFinancePush`: 按 binding name 立即推送(带 `financePushDateWindow.startDate/endDate` 时间窗参数)/run push by name with date window
- `formatPushFailureMarkdown`: 把推送失败详情格式化成 Markdown(HTTP/错误信息/对方原始响应/前 3 条 payload)/format push failure as markdown
- `onCopyPushFailure`: 复制失败详情到剪贴板 /copy push failure to clipboard
- `onSendPushFailureToAgent`: 把失败详情塞进当前 binding 的 Agent 输入框 /send push failure to agent composer

#### 通用函数
- `toText` / `toLower` / `readAdminActiveTab` / `writeAdminActiveTab` / `toDateInput` / `getRoleLabel` / `hasAdminFullAccess` / `isSuperAdmin` / `ALL_TABS` / `buildPagedRows` / `renderPager` / `loadData` / `updateForm` / `updateFilter` / `gotoPage`
- `reloadDashboardConfigs` / `onSubmitDashboardConfig` / `onDeleteDashboardConfig` / `onSubmitPlatformInfo`
- `onSubmitFeishuCredential` / `onDeleteFeishuCredential`

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
  - `adminApi.listXhsAccounts` / `createXhsAccount` / `updateXhsAccount` / `deleteXhsAccount` / `testLoginXhsAccount`
  - `adminApi.listFeishuCredentials` / `upsertFeishuCredential` / `deleteFeishuCredential`: 飞书凭证 CRUD
  - `adminApi.listFinanceBindings` / `upsertFinanceBinding` / `deleteFinanceBinding`: 财务源绑定 CRUD(按 name)
  - `adminApi.listBitableTables`: 按 appToken 列飞书多维表
  - `adminApi.getFinancePushConfig` / `upsertFinancePushConfig` / `deleteFinancePushConfig`: 推送配置 CRUD(每作用域一份)
  - `adminApi.testFinancePush`: 测试 /me 探活
  - `adminApi.runFinancePush(name)`: 按 binding name 立即推送
  - `adminApi.listExternalStores` / `listExternalCompanies`: 透传外部 stores/companies 列表
  - `adminApi.listFinanceTransforms` / `upsertFinanceTransform` / `deleteFinanceTransform`: 财务 transform DSL CRUD(按 name)
  - `adminApi.chatFinanceAgent`: 财务 Agent 同步聊天(传 `{ name, messages }`)
