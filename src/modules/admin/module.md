# Admin Module

## 模块描述
 后台管理模块，负责租户化登录、JWT鉴权、用户管理、平台级AI提供商管理与密钥管理、Claw 接入配置管理、Agent 配置管理。
文件路径: `src/modules/admin`

## 功能描述及关键词

### controller/admin.controller.ts
后台管理控制器。
- **关键词**: admin, auth, login, jwt, tenants, providers, users, keys, controller, claw, agent, llm settings
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
  - `testAiProvider`: 测试提供商连通性(POST /admin/ai-providers/:id/test, GET /models 探活, 15s 超时, 不消耗配额)/test ai provider
  - `listClawConfigs`: Claw配置列表/list claw configs
  - `createClawConfig`: 创建Claw配置/create claw config
  - `updateClawConfig`: 更新Claw配置/update claw config
  - `deleteClawConfig`: 删除Claw配置/delete claw config
  - `pingClawConfig`: 测试Claw连通性/ping claw config
  - `listAgentConfigs`: Agent配置列表/list agent configs
  - `createAgentConfig`: 创建Agent配置/create agent config
  - `updateAgentConfig`: 更新Agent配置/update agent config
  - `deleteAgentConfig`: 删除Agent配置/delete agent config
  - `getLlmSetting`: 获取LLM设置/get llm setting
  - `upsertLlmSetting`: 创建或更新LLM设置/upsert llm setting
  - `updateLlmSetting`: 更新LLM设置/update llm setting

### services/admin.service.ts
后台管理服务。
- **关键词**: admin service, jwt, session, tenant scope, provider category, llm, em, image, api-key, default, claw config, agent config, llm settings, kimi, moonshot
- **函数**:
  - `ensureIndexes`: 索引初始化（含畸形旧 partial 索引先 drop 再建，重建唯一偏索引前调用 dedupeDefaultProviders 兜底去重）/ensure indexes
  - `dedupeDefaultProviders`: 重建 { modelCategory, isDefault } 唯一偏索引前去重，每个 modelCategory 仅留最新一条 isDefault=true，其余降级 false，防 E11000 | keywords: dedupe-default-providers, unique-index-guard
  - `login`: 登录签发JWT/login issue jwt
  - `getUserByToken`: token解析用户/get user by token
  - `logout`: 注销会话/logout
  - `listLoginTenants`: 登录租户列表/list login tenants
  - `getDefaultAiProvider`: 读取默认提供商（llm/em 未设 default 时 fallback 任一 enabled 记录）/get default provider
  - `getDefaultAiProviderRuntime`: 读取默认提供商运行配置/get default provider runtime
  - `getDefaultEmbeddingRuntime`: 读取默认向量配置/get default embedding runtime
  - `getDefaultImageProviderRuntime`: 读取默认生图配置（严格 isDefault=true，未设 default 返回 null 走 meitu-cli 降级）/get default image provider runtime
  - `listAiProviders`: 提供商列表/list providers
  - `upsertAiProvider`: 创建或更新提供商/upsert provider
  - `updateAiProvider`: 更新提供商/update provider
  - `deleteAiProvider`: 删除提供商/delete provider
  - `testAiProvider`: 测试提供商连通性(GET /models 探活, openai-compat 含 kimi/moonshot 用 Bearer、gemini 走 ?key、anthropic 走 x-api-key, 15s 超时)/test ai provider
  - `resolveDefaultProviderBaseUrl`: 厂商默认 baseUrl 兜底(openai/deepseek/nvidia/minimax/glm/gemini/anthropic/doubao/kimi, 与 AgentService 对齐)/resolve default provider base url
  - `formatFetchCauseShort`: 简短序列化 fetch error.cause 给测试连接返回 message/format fetch cause short
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
  - `getLlmSetting`: 获取LLM设置/get llm setting
  - `upsertLlmSetting`: 创建或更新LLM设置/upsert llm setting
  - `updateLlmSetting`: 更新LLM设置/update llm setting
  - `ensureProvidersFromEnv`: 环境迁移提供商（含 GLM 国际端 z.ai 与 Kimi/Moonshot LLM 候选；仅对 llm/em 兜底设 default；image 不回种，未设 default 由运行时降级 meitu-cli）/migrate providers from env

### guards/admin-auth.guard.ts
后台鉴权守卫。
- **关键词**: guard, auth, bearer, jwt
- **函数**:
  - `canActivate`: 鉴权校验/can activate

### entities/admin.entity.ts
后台实体定义。
- **关键词**: user entity, session entity, provider entity, claw config entity, agent config entity, llm setting entity, jwt payload

### controller/admin.dto.ts
后台请求体定义。
- **关键词**: dto, login dto, tenant, provider default, claw config dto, agent config dto, llm setting dto

### types/admin-request.types.ts
后台请求上下文定义。
- **关键词**: request type, auth context
