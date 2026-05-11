# Finance-Config Module

## 模块描述
财务配置模块:保存"用户自定义 name 的 binding"(源绑定:多维表 + 审批多选混搭)以及对应的 Transform DSL。
- 作用域规则与 `tenant-credential` 一致:tenant_admin 用 `tenantId`,super_admin 用 `__platform__` 占位符
- 每作用域 × 每 name 唯一一份 binding 与 transform(支持 previousName 触发改名)
- binding 上挂 `flowDefault / partyTypeDefault`(给 agent 拼默认值参考);**storeId/companyId 不在源级别绑定**(同一银行/审批常跨多门店),由 DSL 用 `compute: lookup` 从源行字段映射
- 落库前 transform 由 `transform-validator` 强校验
- 后台 CRUD 控制器挂载于 `/admin/finance/*`,复用 `AdminAuthGuard`

文件路径: `src/modules/finance/config`

## 功能描述及关键词

### entities/finance-binding.entity.ts
绑定实体定义。
- **关键词**: finance binding entity, named scope, sources, flow default, party type default, org defaults
- **类型**:
  - `FinanceFlow`: `'in' | 'out'`
  - `FinancePartyType`: `'supplier' | 'customer' | 'employee' | 'counterparty'`
  - `FinanceBitableSourceItem`: `{ type:'bitable', appToken, tableId, alias? }`
  - `FinanceApprovalSourceItem`: `{ type:'approval', approvalCode, alias? }`
  - **`alias` 即表定义**:用户给表起的语义化名字(如"云境上海银行流水"、"集盒虹瑞招商银行流水")。push runner / agent tools 拉行后会把它注入到每行 fields 的保留字段 `source_alias`(与 `record_id` 同风格),DSL 通过 `from: "source_alias"` 在行级引用,典型用法是 `compute: lookup` 把 alias → companyId / bankAccount 映射
  - `FinanceSourceItem`: 联合
  - `FinanceBindingEntity`: `{ tenantId, name, flowDefault?, partyTypeDefault?, sources, remark?, ... }`

### entities/finance-transform.entity.ts
Transform 持久化实体。
- **关键词**: finance transform entity, named scope, dsl, explanation
- **类型**: `FinanceTransformEntity`: `{ tenantId, name, dsl, explanation? }`

### services/finance-binding.service.ts
绑定服务(每作用域 × 每 name 唯一,支持改名)。
- **关键词**: finance binding service, named scope, upsert with rename, dedupe sources, tenant isolation
- **函数**:
  - `ensureIndexes`: 索引(tenantId+name 唯一,旧 category 索引静默清理)/ensure indexes
  - `list`: 当前用户可见列表 /list bindings
  - `getByName`: 按 name 取单条 /get binding by name
  - `upsert`: Upsert(传 previousName 则触发改名;normalizeSources 强校验)/upsert with rename
  - `delete`: 按 name 删除 /delete by name
  - `normalizeSources`: sources 标准化(去重 + 字段裁剪)/normalize sources
  - `resolveScopeId`: 解析作用域 ID /resolve scope id
  - `assertName`: name 校验(必填 + 长度上限)/assert name
  - `assertTenantAccess`: 校验租户边界 /assert tenant access

### services/finance-transform.service.ts
Transform 持久化服务。
- **关键词**: finance transform service, named scope, dsl crud with rename, validator
- **函数**:
  - `ensureIndexes`: 索引(tenantId+name 唯一)/ensure indexes
  - `list`: 列表 /list transforms
  - `getByName`: 按 name 取单条 /get transform by name
  - `upsert`: Upsert(支持 previousName 改名,落库前 validator 校验)/upsert with rename
  - `delete`: 按 name 删除 /delete by name
  - `resolveScopeId`: 解析作用域 ID /resolve scope id
  - `assertName`: name 校验 /assert name
  - `assertTenantAccess`: 校验租户边界 /assert tenant access

### controller/finance-config-admin.controller.ts
后台控制器(挂载 `/admin/finance`),注入 `BitableReaderService` 供"列表多维表"接口。
- **关键词**: finance config admin controller, named bindings transforms crud, bitable tables list
- **函数**:
  - `listBindings`: GET /bindings /list bindings
  - `upsertBinding`: POST /bindings(支持 previousName 改名)/upsert binding
  - `deleteBinding`: DELETE /bindings/:name /delete by name
  - `listTransforms`: GET /transforms /list transforms
  - `upsertTransform`: POST /transforms(支持 previousName 改名)/upsert transform
  - `deleteTransform`: DELETE /transforms/:name /delete by name
  - `listBitableTables`: GET /bitable-tables?appToken= /list bitable tables

### controller/finance-config.dto.ts
DTO 定义。
- **关键词**: finance config dto, class-validator
- **类型**:
  - `UpsertFinanceBindingDto`: `{ name, previousName?, flowDefault?, partyTypeDefault?, sources, remark? }`
  - `UpsertFinanceTransformDto`: `{ name, previousName?, dsl, explanation? }`

### finance-config.module.ts
模块定义。
- **关键词**: finance config module, providers, exports
