# Mongo Query Module

## 模块描述
Mongo 通用查询模块：提供一个“复杂 JSON filter + 可选关联查询($lookup)”的通用接口，并在服务端自动注入租户隔离条件（非母平台租户只能查询自己的数据）。
文件路径: `src/modules/mongo-query`

## 功能描述及关键词

### mongo-query.module.ts
模块定义。
- **关键词**: module, mongo, query, tenant

### controller/mongo-query.controller.ts
查询控制器，提供 `/mongo/query` 入口。
- **关键词**: controller, mongo query, json filter
- **函数**:
  - `query`: 通用查询入口/execute query

### controller/mongo-query.dto.ts
查询请求 DTO（基础字段校验）。
- **关键词**: dto, validation, query

### services/mongo-query.service.ts
查询服务，负责鉴权范围解析、filter DSL 解析、租户隔离注入、以及 `$lookup` 聚合管道构建。
- **关键词**: service, filter dsl, lookup, aggregate, tenant isolation
- **函数**:
  - `isObjectRecord`: 对象记录判断/check object record
  - `parseApiKey`: 解析API Key/parse api key header
  - `hashApiKey`: API key哈希/hash api key
  - `execute`: 执行查询，自动识别集合前缀隔离/execute query with prefix isolation detection
  - `requireScope`: 要求范围/require scope
  - `resolveAuthScope`: 解析Bearer范围/resolve bearer scope
  - `resolveApiKeyScope`: 解析API key范围/resolve api key scope
  - `assertCollectionName`: 校验集合名/assert collection name
  - `assertFieldPath`: 校验字段路径/assert field path
  - `normalizeTenantField`: 规范化租户字段/normalize tenant field
  - `normalizeLimit`: 规范化limit/normalize limit
  - `normalizeSkip`: 规范化skip/normalize skip
  - `normalizeSort`: 规范化sort/normalize sort
  - `normalizeProjection`: 规范化projection/normalize projection
  - `sanitizeSimpleFilter`: 过滤简单filter/sanitize simple filter
  - `containsMongoOperator`: 检测$操作符/detect operator keys
  - `coerceValue`: ISO日期字符串自动转Date/auto coerce ISO date string
  - `parseWhereNode`: where DSL解析/parse where node
  - `buildFinalFilter`: 合并过滤条件/build final filter
  - `buildAggregatePipeline`: 构建聚合管道/build aggregate pipeline
  - `buildLookupStages`: 构建lookup阶段/build lookup stages

### types/mongo-query.types.ts
类型定义。
- **关键词**: types, filter, join

