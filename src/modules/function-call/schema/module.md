# Function-Call-Schema Module

## 模块描述
该模块将数据源的Schema检索与数据库查询能力封装为可被Agent调用的工具服务，依赖Data-Source模块对外提供统一数据访问层。
文件路径: `src/modules/function-call/schema`

## 功能描述及关键词

### schema.service.ts
Schema服务。
- **关键词**: schema, function-call, tools, data-source, mongo, tenant, source-code, service
- **函数**:
  - `getHandle`: 获取句柄/get handle
  - `resolveTenantId`: 解析租户ID/resolve tenant id

### schema.module.ts
Schema模块定义。
- **关键词**: module
