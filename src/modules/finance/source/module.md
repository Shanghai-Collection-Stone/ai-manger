# Finance-Source Module

## 模块描述
财务源读取模块（独立飞书通路，不依赖 `data-source` 模块）。
- 多维表读取：按 appToken + tableId 拉记录与字段元
- 审批读取：按 approval_code 拉实例 + form 字段
- 凭证统一从 `tenant-credential` 取 appId/appSecret，按租户构建 lark.Client
- **每条 row.fields 自动带 `record_id` 字段**(多维表的 record_id / 审批的 instance_code 统一用此 key 暴露),DSL 可用 `{"from":"record_id"}` 引用作 externalId 等稳定主键
- **每条 row.fields 自动带 `source_alias` 字段**(由上层 push runner / agent tools 在拉行后注入,内容是 binding 上该 source 的 alias,即"表定义"),DSL 行级可直接 `{"from":"source_alias"}` 引用,典型用法是 `compute: lookup` 把 alias → companyId / bankAccount 映射
文件路径: `src/modules/finance/source`

## 功能描述及关键词

### types/finance-source.types.ts
统一类型定义。
- **关键词**: finance source types, raw row, column meta, fetch result, params
- **类型**:
  - `FinanceRawRow`: 原始行（统一供 transform）
  - `FinanceSourceType`: 源类型枚举 bitable/approval
  - `FinanceColumnMeta`: 字段元数据
  - `FinanceFetchResult`: 拉取结果（含分页）
  - `BitableFetchParams`: 多维表拉取参数
  - `ApprovalFetchParams`: 审批拉取参数
  - `ApprovalInstanceStatus`: 审批实例状态枚举

### services/finance-feishu-client.factory.ts
租户级 lark.Client 工厂（带凭证缓存，凭证变更自动失效）。
- **关键词**: finance feishu client factory, tenant credential cache
- **函数**:
  - `getClient`: 按租户获取 lark.Client /get lark client by tenant
  - `invalidate`: 清缓存（凭证更新后调用）/invalidate client cache

### services/bitable-reader.service.ts
多维表读取器。
- **关键词**: finance bitable reader, app token, table id, fields, search records, paging, list tables
- **函数**:
  - `listTables`: 列出 appToken 下所有数据表（自动翻页，供前端勾选批量绑定）/list bitable tables
  - `listColumns`: 列字段元 /list bitable fields
  - `fetch`: 单页拉取 /fetch one page
  - `fetchAll`: 自动翻页拉全表（maxRows 防爆）/fetch all records

### services/approval-reader.service.ts
飞书审批读取器（默认仅 APPROVED）。
- **关键词**: finance approval reader, approval code, instance list, form parse, status filter
- **函数**:
  - `listInstanceCodes`: 列实例 code（按 approvalCode + 时间窗）/list instance codes
  - `getInstance`: 取单实例详情（含 form 解析）/get instance detail
  - `fetchAll`: 拉全实例（按状态过滤；并发 5）/fetch all instances
  - `parseForm`: 解析 form JSON 字符串 /parse form
  - `toMs`: 秒/毫秒时间戳归一 /to milliseconds
  - `guessType`: 简易字段类型推断 /guess column type
  - `getInstanceClient`: 兼容 SDK approval.v4.instance 路径 /resolve approval instance client

### finance-source.module.ts
模块定义。
- **关键词**: finance source module, providers, exports
