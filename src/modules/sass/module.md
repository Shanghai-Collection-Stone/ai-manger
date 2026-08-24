# Sass Module

## 模块描述

该模块提供SaaS数据源接入能力，包含Schema定义管理、租户与API Key管理、基于API Key租户识别的数据隔离CRUD接口，并提供非租户对接payload到SaaS payload的同步入库接口。
文件路径: `src/modules/sass`
标识策略: 统一使用 MongoDB `_id`（ObjectId 字符串），不再维护自增数字 id。

## 功能描述及关键词

### sass.controller.ts

Sass控制器，提供Schema、Tenant、API Key、租户数据CRUD接口，统一接入DTO校验。

- **关键词**: sass, schema, tenant, api-key, crud, controller, class-validator, dto
- **函数**:
  - `createSchema`: 创建schema/create schema
  - `listSchema`: 列出schema/list schema
  - `getSchema`: 获取schema/get schema
  - `updateSchema`: 更新schema/update schema
  - `deleteSchema`: 删除schema/delete schema
  - `createTenant`: 创建租户/create tenant
  - `listTenant`: 列出租户/list tenant
  - `getTenant`: 获取租户/get tenant
  - `getPlatformInfo`: 获取平台AI配置/get platform info
  - `upsertPlatformInfo`: 更新平台AI配置（含AI补充说明与AI封面开关）/upsert platform info
  - `createApiKey`: 创建api key/create api key
  - `listApiKey`: 列出api key/list api key
  - `revokeApiKey`: 撤销api key/revoke api key
  - `insertData`: 新增数据/insert data
  - `patchData`: 补丁数据（存在更新，不存在新增）/patch data
  - `listData`: 查询列表/list data
  - `findOneData`: 查询单条/find one data
  - `updateOneData`: 更新单条/update one data
  - `deleteOneData`: 删除单条/delete one data

### sass-sync.controller.ts

Sass对接同步控制器，提供订单、订单使用、订单退单的兼容接收接口并转换为SaaS入库格式，订单接口支持手机号AES解密（特供固定密钥配置），并复用租户鉴权上下文入库。

- **关键词**: sync, order, usage, refund, payload transform, phone decrypt, aes, fixed key, request-id, tenant context, controller
- **函数**:
  - `syncOrders`: 同步订单/sync orders
  - `syncUsages`: 同步订单使用/sync usages
  - `syncRefunds`: 同步订单退单/sync refunds
  - `readTenantId`: 读取租户上下文/read tenant context
  - `readKeyId`: 读取密钥上下文/read key context
  - `assertDataType`: 校验数据类型/assert data type
  - `assertNonEmptyArray`: 校验非空数组/assert non-empty array
  - `resolveSchemaId`: 解析schemaId/resolve schema id
  - `toSyncResponse`: 构建响应/build sync response
  - `readSyncHeaders`: 读取并标准化请求头/read and normalize sync headers
  - `assertContentType`: 校验请求类型/assert content type
  - `readRequestId`: 读取并强制校验请求标识/read and require request id
  - `readHeaderTimestamp`: 读取请求时间戳/read header timestamp
  - `readPhoneAesConfig`: 读取解密密钥配置/read phone aes config
  - `decryptPhone`: 解密手机号/decrypt phone

### sass.service.ts

Sass服务，封装schema、tenant、api-key和租户数据隔离能力，支持批量插入、去重、过滤DSL与数据日志，并统一ObjectId校验与历史索引清理。

- **关键词**: service, mongo, schema, tenant, api-key, data isolation, dedupe, batch insert, log, objectid, index migration
- **函数**:
  - `ensureIndexes`: 初始化索引/ensure indexes
  - `dropLegacyIdIndex`: 清理历史id索引/drop legacy id index
  - `toObjectId`: 转换并校验ObjectId/convert and validate object id
  - `resolveTenantTarget`: 解析schema与集合目标/resolve target
  - `isNonEmptyValue`: 非空值判断/check non-empty value
  - `validateRowBySchema`: 数据与schema校验/validate row schema
  - `buildDedupeKey`: 构建去重键/build dedupe key
  - `parseFilterNode`: 解析过滤节点/parse filter node
  - `buildFinalFilter`: 构建最终过滤/build final filter
  - `writeDataLog`: 记录数据日志/write data log
  - `createSchema`: 创建schema/create schema
  - `updateSchema`: 更新schema/update schema
  - `deleteSchema`: 删除schema/delete schema
  - `getSchema`: 获取schema/get schema
  - `listSchema`: 列出schema/list schema
  - `createTenant`: 创建租户/create tenant
  - `getTenant`: 获取租户/get tenant
  - `listTenant`: 列出租户/list tenant
  - `createApiKey`: 创建api key/create api key
  - `listApiKey`: 列出api key/list api key
  - `revokeApiKey`: 撤销api key/revoke api key
  - `insertData`: 新增数据/insert data
  - `patchData`: 补丁数据（存在更新，不存在新增）/patch data
  - `listData`: 查询列表/list data
  - `findOneData`: 查询单条/find one data
  - `updateOneData`: 更新单条/update one data
  - `deleteOneData`: 删除单条/delete one data
  - `syncOrdersToSchema`: 同步订单入库/sync orders to schema
  - `syncUsagesToSchema`: 同步订单使用入库/sync usages to schema
  - `syncRefundsToSchema`: 同步订单退单入库/sync refunds to schema
  - `getPlatformInfo`: 获取租户平台AI配置/get platform info
  - `upsertPlatformInfo`: 更新租户平台AI配置（含enableAiCover）/upsert platform info

### sass-tenant-auth.middleware.ts

Sass租户鉴权中间件，在sass schema、data与sync路由生效，支持通过 `X-Request-ID` 或传统API Key头解析密钥。

- **关键词**: middleware, api-key, request-id, tenant-id, header, auth
- **函数**:
  - `use`: 校验API Key并注入tenantId/verify api key and inject tenant id

### sass.module.ts

Sass模块定义。

- **关键词**: module, nest, middleware

### sass.dto.ts

Sass请求体DTO与校验约束定义，包含租户CRUD与外部同步payload结构。

- **关键词**: dto, class-validator, validation, sync payload
- **函数**:
  - `validate`: DTO约束校验入口/validate dto fields

### sass-schema.entity.ts

Schema实体定义。

- **关键词**: entity, schema

### sass-tenant.entity.ts

租户实体定义；`superClawId` 保存租户工作区默认归属的 SuperClaw 节点，容量由实际工作区数量汇总。

- **关键词**: entity, tenant, tenant-node-assignment, workspace-count

### sass-api-key.entity.ts

API Key实体定义。

- **关键词**: entity, api-key

### platform-info.entity.ts

平台AI配置实体定义。

- **关键词**: entity, platform-info, ai-prompt-supplement, enable-ai-cover

### sass-database-log.entity.ts

数据操作日志实体定义。

- **关键词**: entity, data-log, operation
