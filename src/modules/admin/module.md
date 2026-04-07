# Admin Module

## 模块描述
后台管理模块，负责租户化登录、JWT鉴权、用户管理、平台级AI提供商管理与密钥管理、Claw 接入配置管理、Agent 配置管理。
文件路径: `src/modules/admin`

## 功能描述及关键词

### controller/admin.controller.ts
后台管理控制器。
- **关键词**: admin, auth, login, jwt, tenants, providers, users, keys, controller, claw, agent
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
  - `listClawConfigs`: Claw配置列表/list claw configs
  - `createClawConfig`: 创建Claw配置/create claw config
  - `updateClawConfig`: 更新Claw配置/update claw config
  - `deleteClawConfig`: 删除Claw配置/delete claw config
  - `pingClawConfig`: 测试Claw连通性/ping claw config
  - `listAgentConfigs`: Agent配置列表/list agent configs
  - `createAgentConfig`: 创建Agent配置/create agent config
  - `updateAgentConfig`: 更新Agent配置/update agent config
  - `deleteAgentConfig`: 删除Agent配置/delete agent config

### services/admin.service.ts
后台管理服务。
- **关键词**: admin service, jwt, session, tenant scope, provider category, llm, em, api-key, default, claw config, agent config
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
  - `listClawConfigs`: Claw配置列表/list claw configs
  - `getClawConfigById`: 按ID获取Claw配置/get claw config by id
  - `createClawConfig`: 创建Claw配置/create claw config
  - `updateClawConfig`: 更新Claw配置/update claw config
  - `deleteClawConfig`: 删除Claw配置/delete claw config
  - `pingClawConfig`: 测试Claw连通性/ping claw config
  - `listAgentConfigs`: Agent配置列表/list agent configs
  - `getAgentConfigById`: 按ID获取Agent配置/get agent config by id
  - `createAgentConfig`: 创建Agent配置/create agent config
  - `updateAgentConfig`: 更新Agent配置/update agent config
  - `deleteAgentConfig`: 删除Agent配置/delete agent config
  - `ensureProvidersFromEnv`: 环境迁移提供商/migrate providers from env

### guards/admin-auth.guard.ts
后台鉴权守卫。
- **关键词**: guard, auth, bearer, jwt
- **函数**:
  - `canActivate`: 鉴权校验/can activate

### entities/admin.entity.ts
后台实体定义。
- **关键词**: user entity, session entity, provider entity, claw config entity, agent config entity, jwt payload

### controller/admin.dto.ts
后台请求体定义。
- **关键词**: dto, login dto, tenant, provider default, claw config dto, agent config dto

### types/admin-request.types.ts
后台请求上下文定义。
- **关键词**: request type, auth context
