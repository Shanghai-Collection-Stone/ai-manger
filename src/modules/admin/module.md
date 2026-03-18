# Admin Module

## 模块描述
后台管理模块，负责租户化登录、JWT鉴权、用户管理、平台级AI提供商管理与密钥管理。
文件路径: `src/modules/admin`

## 功能描述及关键词

### controller/admin.controller.ts
后台管理控制器。
- **关键词**: admin, auth, login, jwt, tenants, providers, users, keys, controller
- **函数**:
  - `login`: 登录/login
  - `listLoginTenants`: 登录租户选项/list login tenants
  - `me`: 当前用户/me
  - `logout`: 退出/logout
  - `listUsers`: 用户列表/list users
  - `createUser`: 创建用户/create user
  - `updateUser`: 更新用户/update user
  - `deleteUser`: 删除用户/delete user
  - `listAiProviders`: 提供商列表/list providers
  - `upsertAiProvider`: 创建或更新提供商/upsert provider
  - `updateAiProvider`: 更新提供商/update provider
  - `deleteAiProvider`: 删除提供商/delete provider

### services/admin.service.ts
后台管理服务。
- **关键词**: admin service, jwt, session, tenant scope, provider category, llm, em, api-key, default
- **函数**:
  - `ensureIndexes`: 索引初始化/ensure indexes
  - `login`: 登录签发JWT/login issue jwt
  - `getUserByToken`: token解析用户/get user by token
  - `logout`: 注销会话/logout
  - `listLoginTenants`: 登录租户列表/list login tenants
  - `getDefaultAiProvider`: 读取默认提供商/get default provider
  - `getDefaultAiProviderRuntime`: 读取默认提供商运行配置/get default provider runtime
  - `getDefaultEmbeddingRuntime`: 读取默认向量配置/get default embedding runtime
  - `listAiProviders`: 提供商列表/list providers
  - `upsertAiProvider`: 创建或更新提供商/upsert provider
  - `updateAiProvider`: 更新提供商/update provider
  - `deleteAiProvider`: 删除提供商/delete provider
  - `ensureProvidersFromEnv`: 环境迁移提供商/migrate providers from env

### guards/admin-auth.guard.ts
后台鉴权守卫。
- **关键词**: guard, auth, bearer, jwt
- **函数**:
  - `canActivate`: 鉴权校验/can activate

### entities/admin.entity.ts
后台实体定义。
- **关键词**: user entity, session entity, provider entity, jwt payload

### controller/admin.dto.ts
后台请求体定义。
- **关键词**: dto, login dto, tenant, provider default

### types/admin-request.types.ts
后台请求上下文定义。
- **关键词**: request type, auth context
