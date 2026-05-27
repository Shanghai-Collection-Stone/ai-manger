# Finance-Push Module

## 模块名称 (Module Name)
Finance-Push

## 概述 (Overview)
财务推送模块负责把飞书源数据经过 Transform DSL 转成外部财务系统的 `financial_event` 记录, 并批量推送到 `/events/upsert`。后台接口继续提供配置、测试、手动 SSE 推送和外部资源透传; webhook 接收点用于接收外部财务系统的 `webhooks.requiredPush` 事件, 触发后台 push 并把进度回报到 `hook.reportUrl`。

## 文件清单 (File List)
- `finance-push.module.ts` — Nest 模块定义, 注册后台控制器、webhook 控制器与推送服务。
- `controller/finance-push-admin.controller.ts` — 后台财务推送配置、测试、手动运行和外部资源透传接口。
- `controller/finance-push-webhook.controller.ts` — 公开 webhook 接收点与同 URL 探活 `GET|POST /finance/push/webhooks/required-push`。
- `controller/finance-push.dto.ts` — 后台配置和手动运行 DTO。
- `entities/finance-push-config.entity.ts` — 财务推送配置实体与输入类型。
- `services/finance-push-config.service.ts` — 每租户一份 push config 的 CRUD 与 lastTest/lastPush 记录。
- `services/finance-push-runner.service.ts` — 财务推送执行器, 负责拉源、转换、过滤、分批 upsert 和运行日志。
- `services/finance-external.service.ts` — 外部财务系统 stores/companies 透传查询。
- `services/finance-push-webhook.service.ts` — webhook 请求日志、探活识别、验签、上下文解析、后台推送触发和进度回报。

## 函数清单 (Function List)
- `FinancePushModule()` — 注册财务推送模块依赖、控制器和服务 | keywords: finance-push-module, scoped-config, run-by-name, webhook-receiver
- `FinancePushAdminController()` — 后台财务推送控制器 | keywords: finance push admin controller, scoped config, run by name, external proxy
- `getConfig(req)` — 获取当前作用域推送配置 | keywords: get finance push config
- `upsertConfig(req,body)` — 保存当前作用域推送配置 | keywords: upsert finance push config endpoint
- `deleteConfig(req)` — 删除当前作用域推送配置 | keywords: delete finance push config endpoint
- `test(req)` — 探测外部财务系统 `/me` | keywords: test finance push connectivity endpoint
- `run(req,res,name,body)` — 后台按 binding name 以 SSE 运行一次 push | keywords: run finance push by name as SSE stream
- `listExternalStores(req)` — 透传外部门店列表 | keywords: list external stores for binding picker
- `listExternalCompanies(req)` — 透传外部公司列表 | keywords: list external companies for binding picker
- `requireUser(req)` — 解析后台登录用户 | keywords: require admin user
- `FinancePushWebhookController()` — 公开 webhook 接收控制器 | keywords: finance-push-webhook-controller, webhook-receiver
- `health(req)` — 返回 webhook 接收点探活状态 | keywords: finance-push-webhook-health, webhook-health
- `receiveRequiredPush(req,body)` — 接收 `webhooks.requiredPush` 或配置探活并按文档返回 200 | keywords: receive-required-push-webhook, webhook-trigger
- `FinancePushWebhookService()` — webhook 验签、触发和进度回报服务 | keywords: finance-push-webhook-service, webhook-progress-report
- `accept(req,body)` — 识别探活或校验 webhook 并启动后台 push;未指定 binding 时跑该租户所有 binding | keywords: accept-finance-push-webhook, webhook-trigger
- `probe(req?,body?,options?)` — 返回无副作用的 webhook 探活响应 | keywords: finance-push-webhook-probe, webhook-health
- `logIncomingRequest(req,body)` — 记录 webhook 接收端收到的请求快照 | keywords: log-webhook-request, webhook-debug
- `processAccepted(context)` — 顺序执行已接收的一个或多个财务源 binding push 并回报状态 | keywords: process-accepted-webhook, webhook-progress-report
- `report(context,input)` — 向 `hook.reportUrl` 发送状态回报 | keywords: send-webhook-report, webhook-progress-report
- `verifySignature(req,body)` — 按 `${occurredAt}.${rawBody}` 校验 HMAC-SHA256 签名 | keywords: verify-webhook-signature, hmac-sha256
- `getWebhookSecret()` — 从环境变量解析 webhook 密钥 | keywords: resolve-webhook-secret, webhook-secret
- `parseContext(req,body)` — 从顶层或新版 `binding` 对象解析 webhook 事件、外部租户、内部作用域、binding 列表、hook 和日期窗口 | keywords: parse-webhook-context, webhook-envelope
- `resolveWebhookScopeId(externalTenantId)` — 把财务系统租户 ID 映射为本系统内部作用域 | keywords: 外部租户映射, webhook作用域, resolve-webhook-scope, external-tenant-mapping
- `extractEnvelopeBinding(body,payload)` — 提取顶层 `binding` 或 `payload.binding` 投递绑定对象 | keywords: extract-envelope-binding, webhook-envelope
- `isProbeRequest(req,body)` — 识别空请求、ping/test/url_verification/challenge 探活请求 | keywords: detect-webhook-probe, webhook-health
- `extractProbeChallenge(req,body)` — 从请求体或 query 提取 webhook 验证 challenge | keywords: extract-webhook-challenge, webhook-health
- `extractHook(req,body,payload)` — 从顶层 `hook`、`binding.hook`、`binding` 提取 hook id、回报地址和回报 token | keywords: extract-webhook-hook, report-url
- `extractBindingNames(scopeId,payload,body)` — 从 `payload.input`、payload 或 top-level 解析财务源 binding 列表,未指定时列出内部作用域全部 binding;空列表抛 400 | keywords: extract-binding-names, webhook-payload
- `extractDateWindow(payload,input?)` — 解析 payload、`payload.input` 或 dateWindow 中的可选 `startDate/endDate` 日期窗口 | keywords: extract-date-window, date-window
- `toResultMeta(result)` — 压缩推送结果供 webhook 回报使用 | keywords: compact-result-meta, webhook-report-meta
- `getHeader(req,name)` — 读取并裁剪请求头字符串 | keywords: read-webhook-header, header-string
- `getRawBody(req,body)` — 读取 Nest rawBody, 无签名场景回退 JSON 字符串 | keywords: read-raw-body, hmac-raw-body
- `sanitizeForLog(value,key?)` — 日志输出前递归掩码敏感字段 | keywords: sanitize-webhook-log, webhook-debug
- `isSensitiveLogKey(key)` — 判断日志字段名是否需要掩码 | keywords: detect-sensitive-log-key, webhook-debug
- `maskSensitiveText(text)` — 掩码 rawBody 文本里的敏感片段 | keywords: mask-sensitive-log-text, webhook-debug
- `pickStringArray(record,keys)` — 从对象中读取字符串数组或逗号分隔字符串 | keywords: pick-string-array, record-helper
- `pickQueryString(value)` — 从 Express query 值中提取首个非空字符串 | keywords: pick-query-string, record-helper
- `pickString(record,keys)` — 从对象中取第一个非空字符串字段 | keywords: pick-string-field, record-helper
- `isRecord(value)` — 判断值是否为普通对象记录 | keywords: is-record, object-guard
- `toReportLevel(level)` — 将 runner 的 `warn` 映射为 webhook 文档里的 `warning` | keywords: map-report-level, webhook-report-level
- `toErrorMessage(err)` — 将未知错误转为可读消息 | keywords: error-to-message, error-reporting
- `FinancePushConfigService()` — 推送配置 CRUD 服务 | keywords: finance push config service, scoped single, base url, api key
- `ensureIndexes()` — 建立内部租户和外部租户唯一索引并清理历史重复配置 | keywords: ensure push config indexes with legacy category dedup
- `get(scopeId)` — 获取作用域配置 | keywords: get push config by scope
- `getByExternalTenantId(externalTenantId)` — 通过外部财务系统租户 ID 查找本系统作用域配置 | keywords: 外部租户映射, 推送配置, get-push-config-by-external-tenant, external-tenant-mapping
- `upsert(currentUser,input)` — 保存作用域配置和 webhook 外部租户映射 | keywords: upsert finance push config
- `isDuplicateExternalTenantError(error)` — 判断是否为外部租户 ID 唯一索引冲突 | keywords: 外部租户映射, 重复键, detect-external-tenant-duplicate, external-tenant-mapping
- `delete(currentUser)` — 删除作用域配置 | keywords: delete finance push config
- `recordTest(scopeId,status,message?)` — 写入最近一次连通性测试结果 | keywords: record push connectivity test result
- `recordPush(scopeId,payload)` — 写入最近一次推送结果 | keywords: record push run result
- `resolveScopeId(currentUser)` — 从后台用户解析租户作用域 | keywords: resolve scope id
- `FinancePushRunnerService()` — 财务推送执行器 | keywords: finance push runner, unified events endpoint, abs amount, batch upsert
- `test(currentUser)` — 探测外部财务系统 `/me` | keywords: test push connectivity by probing /me
- `run(currentUser,name,opts?)` — 后台用户上下文运行一次 push | keywords: run one push by binding name with logs and date window
- `runByScope(scopeId,name,opts?)` — 直接按租户作用域运行一次 push | keywords: run-push-by-scope, webhook-trigger
- `collectRawRows(scopeId,sources,log)` — 拉取所有绑定源数据并注入 source alias | keywords: collect raw rows with per-source logs and schema constants injection
- `passesDateWindow(value,start?,end?)` — 判断记录日期是否落在推送窗口内 | keywords: row passes date window check
- `toDayString(value)` — 将日期值归一为 `YYYY-MM-DD` | keywords: occurred at to YYYY-MM-DD
- `normalizeDateOpt(value)` — 校验并归一日期参数 | keywords: normalize date opt
- `stripEmptyFields(row)` — 推送前剥离空字段并兜底序列化复杂对象 | keywords: strip empty fields and stringify non-primitive leaks
- `normalizeAmount(row)` — 将 amount 兜底取绝对值 | keywords: push amount abs fallback
- `upsertBatch(url,apiKey,records)` — 单批 upsert 并保留失败响应 | keywords: upsert one batch all or nothing with full raw response
- `probe(url,apiKey)` — 探测目标端点并分类状态 | keywords: probe target endpoint and classify status
- `classifyHttpError(status,body,rawText)` — 归类 HTTP 错误 | keywords: classify http error code and message keeping full raw
- `joinUrl(baseUrl,path)` — 拼接 baseUrl 与 path | keywords: join base url and path
- `isOkBody(body)` — 判断响应 body 是否为成功形态 | keywords: check ok body shape
- `pickCode(body)` — 提取错误 code | keywords: pick error code from body
- `pickMessage(body)` — 提取错误 message | keywords: pick error message from body
- `formatFailedReason(res)` — 格式化失败原因写入配置 | keywords: format failed batch reason
- `FinanceExternalService()` — 外部资源透传服务 | keywords: finance external proxy, list stores companies via push config
- `listStores(currentUser)` — 透传外部门店列表 | keywords: list external stores
- `listCompanies(currentUser)` — 透传外部公司列表 | keywords: list external companies
- `fetchAll(currentUser,path,pluralKey)` — 分页拉取外部资源列表 | keywords: fetch all with pagination cap
- `extractArray(body,pluralKey)` — 从兼容响应结构提取数组 | keywords: extract array from response

## 关键词索引 (Keyword Index)
| 中文 | English |
|---|---|
| 财务推送 | finance-push-module |
| 后台手动推送 | run-by-name |
| webhook接收点 | webhook-receiver |
| webhook探活 | webhook-health |
| webhook调试日志 | webhook-debug |
| webhook触发 | webhook-trigger |
| 进度回报 | webhook-progress-report |
| HMAC签名 | hmac-sha256 |
| 原始请求体 | hmac-raw-body |
| 租户作用域 | scoped-config |
| 外部租户映射 | external-tenant-mapping |
| 重复键 | detect-external-tenant-duplicate |
| 日期窗口 | date-window |
| 外部资源透传 | external proxy |
| 分批推送 | batch upsert |

## 类型导出 (Type Exports)
- `FinancePushTestStatus` — 推送连通性测试状态 | keywords: push config last test status enum
- `FinancePushConfigEntity` — 租户维度 push config 实体,可保存外部租户映射 | keywords: finance push config entity, scoped, unified events endpoint
- `FinancePushConfigInput` — push config 输入,包含可选外部租户 ID | keywords: finance push config input
- `UpsertFinancePushConfigDto` — 后台保存配置 DTO,包含可选外部租户 ID | keywords: upsert finance push config dto
- `RunFinancePushDto` — 后台手动运行 DTO | keywords: run finance push dto with optional date window
- `FinancePushTestResult` — 连通性测试结果 | keywords: push test result type
- `FinancePushLogEntry` — 推送执行日志项 | keywords: push run log entry
- `FinancePushRunResult` — 推送执行结果 | keywords: push run result type
- `FinancePushRunOptions` — 推送执行选项 | keywords: run options
- `FinanceExternalResource` — 外部资源列表项 | keywords: external resource shape
- `FinancePushWebhookAccepted` — webhook 已接收响应 `{ ok: true }` | keywords: finance-push-webhook-accepted, webhook-trigger
- `FinancePushWebhookProbe` — webhook 探活响应,不会触发后台 push | keywords: finance-push-webhook-probe, webhook-health
- `FinancePushWebhookResponse` — webhook 接收端响应联合类型 | keywords: finance-push-webhook-response, webhook-health

## 模块功能描述 (Module Feature Description)
后台运行路径使用 `AdminAuthGuard` 解析当前用户作用域, 再由 `FinancePushRunnerService.run` 运行。webhook 路径挂载在 `/finance/push/webhooks/required-push`: `GET` 和空 `POST`/`ping`/`test`/`url_verification`/`challenge` 仅返回 200 探活响应,不触发业务;正式 `POST` 接收 `webhooks.requiredPush` 事件。若配置 `FINANCE_PUSH_WEBHOOK_SECRET` 或 `FINANCE_WEBHOOK_SECRET`, 正式事件会按文档用 `x-finance-webhook-time` 和原始 body 校验 `x-finance-webhook-signature`。通过校验后接口会先把财务系统传来的外部 `tenantId` 匹配到当前系统 push config 的 `externalTenantId`,再拿该配置的内部 `tenantId` 作为 `scopeId`;未绑定时抛 `FINANCE_WEBHOOK_TENANT_UNMAPPED` 400。校验通过且映射存在后接口立即返回 200 `{ ok: true }`。payload 可传 `bindingName` 或 `bindingNames`;不传时自动列出内部作用域所有 binding,后台逐个调用 `runByScope(scopeId,bindingName,opts)`, 并把 `dispatching/running/completed/failed` 状态回报给必填的 `hook.reportUrl`。
