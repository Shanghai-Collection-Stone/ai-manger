# Tenant-Credential Module

## 模块描述
租户第三方凭证模块：以登录用户的"作用域 ID"为操作边界，每个作用域最多保留一份凭证。
**作用域规则**：tenant_admin 用自身 `tenantId`；super_admin 无 tenantId 时落到平台占位符 `__platform__`，
让平台层（财务对接 / 平台自身飞书机器人）也能配置一份凭证（不与任何真实租户冲突，因 ObjectId 不会为该字符串）。
首发场景为飞书（财务多维表 / 审批读取共用），后续可扩展企微、钉钉等。
凭证集合与 `data-source`、`sass/platform-info` 完全解耦，独立 collection 管理。
文件路径: `src/modules/tenant-credential`

## 功能描述及关键词

### entities/tenant-feishu-credential.entity.ts
租户飞书凭证实体与输入类型定义。
- **关键词**: tenant feishu credential entity, app id, app secret
- **类型**:
  - `TenantFeishuCredentialEntity`: 飞书凭证实体（tenantId 唯一）
  - `TenantFeishuCredentialInput`: 凭证输入（tenantId 由登录态决定，不在入参中）

### services/tenant-credential.service.ts
凭证 CRUD，全部以登录用户作用域 ID 为边界（tenant_admin 用 tenantId / super_admin 用 `__platform__`）。
- **关键词**: tenant feishu credential service, crud, scoped, platform self, mongo
- **常量**:
  - `PLATFORM_SCOPE_ID = '__platform__'`：super_admin 的作用域占位符
- **函数**:
  - `ensureIndexes`: 索引初始化（tenantId 唯一）/ensure indexes
  - `list`: 列出当前作用域凭证（最多一份）/list current scope credential
  - `getByTenant`: 按租户读取凭证（运行时财务源用，传入真实 tenantId）/get credential by tenant
  - `upsert`: 用登录态作用域 upsert 凭证 /upsert credential
  - `update`: 按 ID 更新凭证（校验目标作用域一致）/update credential
  - `delete`: 删除当前作用域凭证 /delete credential
  - `resolveScopeId`: 解析当前用户作用域（tenant_admin 用 tenantId / super_admin 用 platform） /resolve scope id
  - `toObjectId`: ObjectId 校验 /parse object id

### controller/tenant-credential-admin.controller.ts
后台控制器，挂载于 `/admin/tenant-feishu-credentials`，复用 `AdminAuthGuard`。
- **关键词**: tenant feishu credential admin controller, crud, admin auth guard
- **函数**:
  - `list`: GET / 列出当前租户凭证 /list current tenant credential
  - `upsert`: POST / Upsert 飞书凭证 /upsert credential
  - `update`: PATCH /:id 更新飞书凭证 /update credential
  - `remove`: DELETE /:id 删除飞书凭证 /delete credential
  - `requireUser`: 取登录用户 /require admin user

### controller/tenant-credential.dto.ts
DTO 定义（已移除 `tenantId` 字段，避免外部覆盖租户边界）。
- **关键词**: tenant credential dto, class-validator
- **类型**:
  - `UpsertFeishuCredentialDto`: Upsert 凭证请求体（appId / appSecret / remark）
  - `UpdateFeishuCredentialDto`: 更新凭证请求体（部分字段）

### tenant-credential.module.ts
模块定义。imports 必须包含 `DataSourceModule`（提供 `DS_MONGO_DB` token）。
- **关键词**: tenant credential module, nest module, ds mongo db, admin auth
