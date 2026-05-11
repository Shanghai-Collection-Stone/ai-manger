# Finance-Push Module

## 模块描述
财务推送模块:把"飞书 → transform → financial_event"产出整批 upsert 到外部财务系统的统一端点 `/api/v1/events/upsert`。
- **配置存储**:`finance_push_configs`,**每作用域唯一一份** `{ baseUrl, apiKey, lastTested*, lastPush* }`(旧的"按 category 一份"已废弃)
- **推送端点统一**:`/events/upsert`(原 `/expenses/upsert` `/payables/upsert` 已合并)
- **探活端点**:`GET /me`(只验 key 有效性,scope 由首次推送触发)
- **推送语义**:整批拒收(all-or-nothing)— 任意一行不合 schema 整批失败
- amount 推送前强制 `Math.abs()` 兜底
- 按 500 条切批;首个失败批次中止后续批次
- **按 binding name 触发**:`POST /run/:name` 跑该 name 对应的 binding + transform
- **外部资源透传**:`GET /external/stores`、`GET /external/companies` 让前端 binding 编辑器选 storeId/companyId
- 后台控制器挂载于 `/admin/finance/push/*`,复用 `AdminAuthGuard`

文件路径: `src/modules/finance/push`

## 功能描述及关键词

### entities/finance-push-config.entity.ts
推送配置实体定义。
- **关键词**: finance push config entity, scoped single, base url, api key, last test, last push by name
- **类型**:
  - `FinancePushTestStatus`: `'ok' | 'auth' | 'scope' | 'validation' | 'network' | 'unknown'`
  - `FinancePushConfigEntity`: `{ tenantId, baseUrl, apiKey, lastTestedAt?, lastTestStatus?, lastTestMessage?, lastPushName?, lastPushAt?, ... }`
  - `FinancePushConfigInput`: `{ baseUrl, apiKey }`

### services/finance-push-config.service.ts
配置 CRUD 服务(每作用域一份)。
- **关键词**: finance push config service, scoped single, record test, record push by name
- **函数**:
  - `ensureIndexes`: tenantId 唯一索引(旧 tenantId+category 索引静默清理)/ensure indexes
  - `get`: 取作用域配置 /get config
  - `upsert`: Upsert 配置 /upsert config
  - `delete`: 删除配置 /delete config
  - `recordTest`: 写"上次测试"结果 /record test
  - `recordPush`: 写"上次推送"结果(含 lastPushName)/record push
  - `resolveScopeId`: 解析作用域 ID /resolve scope id

### services/finance-push-runner.service.ts
推送执行器:连通性 + 拉源 → transform → abs → 时间窗过滤 → 切批 upsert;全程累积关键日志返回前端。
- **关键词**: finance push runner, unified events endpoint, probe /me, run by name with date window, run logs, abs amount, batch upsert
- **常量**: `BATCH_SIZE=500`、`EVENTS_UPSERT_PATH='/events/upsert'`、`PROBE_PATH='/me'`
- **类型**:
  - `FinancePushTestResult`
  - `FinancePushLogEntry`: `{ level:'info'|'warn'|'error', at, msg }`
  - `FinancePushRunResult`: 含 `name / totalRows / transformedRows / filteredRows / dateFilteredRows / transformErrors / successCount / batches / startDate? / endDate? / logs[] / failedBatch?`
  - `failedBatch`: `{ index, httpStatus, code?, message?, payloadAll[], rawResponseBody?, contentType? }`(失败时保留**完整不截断**的对方响应原文 + 该批所有 payload,给 Agent 排错;message 兜底最多 16k 字符)
  - `FinancePushRunOptions`: `{ startDate?, endDate? }`(YYYY-MM-DD)
- **函数**:
  - `test`: 探活 /me 并 recordTest /test connectivity
  - `run(currentUser, name, opts?)`: 按 binding name 推送(可选时间窗按 occurredAt 过滤),全程累积 log /run with logs and date window
  - `collectRawRows`: 多源汇总,每个源拉完打一条 log;同时把 `source.alias` 注入到每行 fields 的 `source_alias` 保留字段(与 `record_id` 同风格,DSL 行级 from 可引)/collect with per-source logs and source_alias injection
  - `passesDateWindow` / `toDayString` / `normalizeDateOpt`: 时间窗过滤辅助 /date window helpers
  - `normalizeAmount`: amount 强制 abs /normalize amount
  - `stripEmptyFields`: 推送前剥离 null/undefined/空串字段;非 primitive 的 object/array(transform 漏拍平的飞书 cell)JSON.stringify 兜底,避免对方收到 `[object Object]` 拒收;`meta` 字段允许 object 透传(api.md §6);保留 false/0 等合法 falsy /strip empty fields and stringify object leaks
  - `upsertBatch`: 单批 upsert(整批拒收)/upsert one batch
  - `probe`: GET /me 探活并归类 status /probe target endpoint
  - `classifyHttpError`: 错误归类 /classify http error
  - `joinUrl` / `isOkBody` / `pickCode` / `pickMessage` / `formatFailedReason`: 工具函数

### services/finance-external.service.ts
外部 API 透传 client(用 push config 的 baseUrl + apiKey 调外部 `/stores`、`/companies`)。被 push controller(给前端透传)和 agent tools(给 LLM 写 lookup map 时查 ID 列表)同时使用。
- **关键词**: finance external proxy, list stores companies via push config, used by agent tools for lookup map
- **类型**: `FinanceExternalResource`: `{ id, name?, code?, ... }`
- **函数**:
  - `listStores`: 透传 GET /stores(分页拉全量)/list external stores
  - `listCompanies`: 透传 GET /companies(分页拉全量)/list external companies
  - `fetchAll`: 通用分页拉取(最多 20 页 ≈ 10000 条)/fetch all with pagination cap
  - `extractArray`: 从响应取数组(兼容 data:[] 与 data.{plural}:[]) /extract array
  - `joinUrl`: 拼 baseUrl + path /join base url

### controller/finance-push-admin.controller.ts
后台控制器(挂载 `/admin/finance/push`)。
- **关键词**: finance push admin controller, scoped config, run by name, external proxy
- **函数**:
  - `getConfig`: GET /config 取作用域配置 /get config
  - `upsertConfig`: POST /config Upsert 配置 /upsert config
  - `deleteConfig`: DELETE /config 删除配置 /delete config
  - `test`: POST /test 探活 /test connectivity
  - `run`: POST /run/:name 按 name 立即推送(body 可选 `{ startDate, endDate }` YYYY-MM-DD,按 occurredAt 过滤)/run push by name with date window
  - `listExternalStores`: GET /external/stores 透传外部门店 /list external stores
  - `listExternalCompanies`: GET /external/companies 透传外部公司 /list external companies

### controller/finance-push.dto.ts
DTO 定义。
- **关键词**: finance push dto, class-validator
- **类型**:
  - `UpsertFinancePushConfigDto`: `{ baseUrl, apiKey }`
  - `RunFinancePushDto`: `{ startDate?, endDate? }`(YYYY-MM-DD,可选)

### finance-push.module.ts
模块定义。
- **关键词**: finance push module, providers, controllers, exports
- imports: `DataSourceModule`(DS_MONGO_DB)、forwardRef `AdminModule`、`FinanceConfigModule`、`FinanceSourceModule`、`FinanceTransformModule`
- providers: `FinancePushConfigService`、`FinancePushRunnerService`、`FinanceExternalService`(三个都 export — `FinanceExternalService` 被 agent 模块注入)
