# Data-Source Module

## 模块描述
该模块管理主业务Mongo连接（DS_MONGO_DB），提供数据源注册、Schema缓存更新与通用数据查询/聚合能力，并向函数调用层导出可复用的查询工具服务。
文件路径: `src/modules/data-source`

## 功能描述及关键词

### data-source.controller.ts
数据源控制器。
- **关键词**: data-source, mongo, schema, query, aggregate, tools, feishu, bitable, super-party, embedding, controller

### data-source.service.ts
数据源服务。
- **关键词**: service, tenant-scope, mongo-connection, external, local, main
- **函数**:
  - `registerSource`: 注册数据源/register source
  - `findAccessibleSource`: 按租户可见性查询/find accessible source
  - `listAccessibleSources`: 列出租户可见数据源/list accessible sources
  - `resolveMongoConnection`: 解析连接配置/resolve mongo connection

### data-source-schema.service.ts
Schema服务。
- **关键词**: schema, service, tenant-filter, source-filter
- **函数**:
  - `searchAllSources`: 跨源搜索并按租户过滤/search all sources with tenant scope
  - `searchSchema`: 单源schema搜索/search schema
  - `resolveDefaultEmbeddingConfig`: 默认向量配置解析/resolve default embedding config

### data-source-search.tools.ts
数据源搜索工具。
- **关键词**: tools, data-source-query, tenant-hard-isolation, mongo-route
- **函数**:
  - `getHandle`: 工具句柄/get handle
  - `normalizeBatchQueriesInput`: 批量查询入参规范化/normalize batch queries input
  - `formatZodIssues`: 校验错误格式化/format zod issues
  - `resolveTargetCollection`: 解析查询目标/resolve target collection
  - `buildExternalMongoUri`: 构建外部连接/build external mongo uri

### data-source.module.ts
数据源模块定义。
- **关键词**: module
