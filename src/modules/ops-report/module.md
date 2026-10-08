# 模块名称 (Module Name)

运维上报模块（ops-report）

## 概述 (Overview)

接收桌面客户端提交的问题描述、客户端环境与本地错误日志，执行字段校验、提交频控和敏感信息脱敏后写入 MongoDB。租户管理员只能查看本租户成员的上报，平台超管可跨租户检索、查看详情并更新处理状态。

## 文件清单 (File List)

- `ops-report.module.ts` — 模块入口，装配后台鉴权、MongoDB、租户服务、控制器和业务服务。
- `entities/ops-report.entity.ts` — 上报文档、客户端信息、日志条目、状态及响应视图类型。
- `controller/ops-report.dto.ts` — 创建、列表查询、嵌套日志条目和状态更新 DTO 校验。
- `controller/ops-report.controller.ts` — 运维上报提交、列表、详情和处理状态接口。
- `services/ops-report.service.ts` — 集合索引、提交频控、脱敏、租户隔离、查询和处理状态业务。

## 函数清单 (Function List)

- `OpsReportModule()` — 注册运维上报控制器与服务 | keywords: 运维上报模块, ops-report-module
- `OpsReportController()` — 暴露运维上报提交与后台管理接口 | keywords: 运维上报接口, ops-report-controller
- `OpsReportController.create(req,dto)` — 提交问题描述与桌面客户端本地错误日志 | keywords: 提交运维上报接口, create-ops-report-endpoint
- `OpsReportController.list(req,query)` — 分页读取权限范围内的上报摘要 | keywords: 查询运维上报接口, list-ops-report-endpoint
- `OpsReportController.get(req,id)` — 读取单条上报及完整日志明细 | keywords: 查询上报详情接口, get-ops-report-endpoint
- `OpsReportController.update(req,id,dto)` — 更新上报处理状态与处理备注 | keywords: 更新上报状态接口, update-ops-report-endpoint
- `OpsReportController.requireUser(req)` — 从鉴权请求读取当前后台用户 | keywords: 读取后台用户, read-admin-user
- `OpsReportClientDto()` — 校验桌面客户端环境信息 | keywords: 客户端环境请求体, ops-client-dto
- `OpsLogEntryDto()` — 校验单条错误或警告日志 | keywords: 上报日志请求体, ops-log-entry-dto
- `CreateOpsReportDto()` — 校验创建运维上报请求体 | keywords: 创建上报请求体, create-ops-report-dto
- `ListOpsReportQueryDto()` — 校验列表状态、租户、关键词和分页参数 | keywords: 上报列表查询, list-ops-report-query
- `UpdateOpsReportDto()` — 校验处理状态与处理备注 | keywords: 更新上报请求体, update-ops-report-dto
- `OpsReportService()` — 提供运维上报写入、脱敏、频控和管理能力 | keywords: 运维上报服务, ops-report-service
- `OpsReportService.onModuleInit()` — 模块启动时建立租户/状态列表、全局时间线与用户频控查询索引 | keywords: 初始化上报索引, initialize-report-indexes
- `OpsReportService.create(user,input)` — 从登录态补全提交人与租户并脱敏入库 | keywords: 创建运维上报, create-ops-report
- `OpsReportService.list(user,query)` — 按权限边界分页查询上报摘要 | keywords: 查询上报列表, list-ops-reports
- `OpsReportService.get(user,id)` — 读取详情并校验租户边界 | keywords: 查询上报详情, get-ops-report-detail
- `OpsReportService.update(user,id,input)` — 更新处理状态并记录处理人和时间 | keywords: 更新上报状态, update-ops-report-status
- `OpsReportService.findRequired(id)` — 按标识读取上报或抛出不存在错误 | keywords: 查找上报记录, find-required-report
- `OpsReportService.assertTenantAccess(user,report)` — 阻止非超管跨租户读取上报 | keywords: 校验租户边界, assert-report-tenant
- `OpsReportService.buildListFilter(user,query)` — 构造状态、租户与关键词过滤条件 | keywords: 构造上报筛选, build-report-filter
- `OpsReportService.escapeRegex(value)` — 转义关键词中的正则特殊字符 | keywords: 转义正则关键词, escape-regex-keyword
- `OpsReportService.redact(value)` — 对令牌、敏感查询参数和手机号脱敏 | keywords: 敏感信息脱敏, redact-sensitive-text
- `OpsReportService.redactEntry(entry)` — 对日志消息、堆栈和 URL 脱敏 | keywords: 脱敏日志条目, redact-log-entry
- `OpsReportService.toSummary(report)` — 将数据库文档映射为摘要视图 | keywords: 转换上报摘要, map-report-summary
- `OpsReportService.toDetail(report)` — 将数据库文档映射为详情视图 | keywords: 转换上报详情, map-report-detail

## 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 运维上报模块 | ops-report-module |
| 运维上报接口 | ops-report-controller |
| 运维上报服务 | ops-report-service |
| 创建运维上报 | create-ops-report |
| 查询上报列表 | list-ops-reports |
| 查询上报详情 | get-ops-report-detail |
| 更新上报状态 | update-ops-report-status |
| 敏感信息脱敏 | redact-sensitive-text |
| 脱敏日志条目 | redact-log-entry |
| 校验租户边界 | assert-report-tenant |
| 提交频率限制 | report-rate-limit |
| 上报日志条目 | ops-log-entry |
| 客户端环境 | ops-client-info |

## 类型导出 (Type Exports)

- `OpsReportStatus` — 处理状态：`open`、`processing`、`resolved`。
- `OpsLogKind` — 日志来源：`api`、`page`、`main`、`crash`。
- `OpsLogLevel` — 日志级别：`error`、`warn`。
- `OpsReportClient` — 客户端应用、外壳、工作台、系统和页面环境信息。
- `OpsLogEntry` — 单条本地错误或警告日志。
- `OpsReportEntity` — `ops_reports` 集合文档。
- `OpsReportSummary` — 列表摘要视图，不包含 `entries`，包含 `entryCount`。
- `OpsReportDetail` — 详情视图，在摘要基础上包含完整 `entries`。

## 模块功能描述 (Module Description)

**入口鉴权**

| 路由 | 权限 |
| --- | --- |
| `POST /api/ops-report/reports` | `create OpsReport`；operator、tenant_admin 与 super_admin 按权限注册中心授权 |
| `GET /api/ops-report/reports` | `read OpsReport`；租户管理员强制当前租户，超管可用 `tenantId` 过滤全部租户 |
| `GET /api/ops-report/reports/:id` | `read OpsReport`；租户管理员跨租户访问返回 `CROSS_TENANT_FORBIDDEN` |
| `PATCH /api/ops-report/reports/:id` | `update OpsReport`；当前权限配置仅 super_admin 拥有 |

全部入口同址声明 `AdminAuthGuard`、`AdminPoliciesGuard` 与 `RequirePermission`，权限主体使用注册中心的 `ADMIN_SUBJECTS.OpsReport`。

**请求与响应**

- 创建请求：`description` 1..2000 字符，`contact` 最多 100 字符，`client` 为客户端环境，`entries` 最多 300 条。响应 `{ report: { id, createdAt } }`。
- 列表查询：支持 `status=open|processing|resolved|all`、`tenantId`、`keyword`、`page`、`pageSize`。响应 `{ items, total, page, pageSize }`，每项为 `OpsReportSummary`。
- 详情响应：`{ report: OpsReportDetail }`。
- 状态更新请求：`{ status: 'open'|'processing'|'resolved', handlerNote?: string }`，备注最多 500 字符。响应 `{ report: OpsReportDetail }`。

**上报条目字段**

| 字段 | 约束与说明 |
| --- | --- |
| `ts` | ISO 时间字符串 |
| `kind` | `api`、`page`、`main`、`crash` |
| `level` | `error`、`warn` |
| `message` | 必填字符串，最多 2000 字符 |
| `method` | 可选，最多 10 字符 |
| `url` | 可选，最多 1000 字符 |
| `status` | 可选整数 HTTP 状态码 |
| `durationMs` | 可选数值耗时 |
| `source` | 可选，最多 300 字符 |
| `stack` | 可选，最多 4000 字符 |
| `page` | 可选，最多 300 字符 |

**集合与索引**

集合 `ops_reports` 保存提交人、租户快照、问题描述、联系方式、客户端信息、日志条目、处理状态与审计时间。模块初始化建立 `{ tenantId: 1, createdAt: -1 }`、`{ tenantId: 1, status: 1, createdAt: -1 }`、`{ status: 1, createdAt: -1 }`、`{ createdAt: -1 }` 与 `{ userId: 1, createdAt: -1 }` 索引；最后一组用于一分钟提交频控。

**脱敏与频控**

- `Bearer <token>` 替换为 `Bearer ***`。
- URL 查询参数 `token=`、`access_token=`、`password=`、`secret=` 的值替换为 `***`。
- 11 位中国大陆手机号中间四位替换为 `****`。
- 脱敏应用于 `description` 以及每条日志的 `message`、`stack`、`url`。
- 同一 `userId` 最近 1 分钟已有 5 条记录时拒绝提交，返回 HTTP 429 `OPS_REPORT_TOO_FREQUENT`。

**错误码**

| 错误码 | HTTP 状态 | 说明 |
| --- | --- | --- |
| `OPS_REPORT_TOO_FREQUENT` | 429 | 同一用户 1 分钟内提交超过 5 次 |
| `OPS_REPORT_NOT_FOUND` | 404 | 上报标识非法或记录不存在 |
| `CROSS_TENANT_FORBIDDEN` | 403 | 非超管访问其他租户的上报 |

**桌面端对应关系**

桌面 IPC `desktop.xhs-desktop.opsReport.submit` 经主进程携带当前登录 token 调用 `POST /api/ops-report/reports`。后端只从登录态 `req.adminUser` 写入 `userId`、`username`、`displayName`、`phone`、`tenantId` 与租户名称，不信任桌面端请求体中的用户或租户身份。
