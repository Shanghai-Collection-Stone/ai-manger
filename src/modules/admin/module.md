# Admin Module

## 模块描述
 后台管理模块，负责租户化登录、JWT鉴权、基于 CASL 的角色能力鉴权(RBAC 静态角色目录)、用户管理、角色管理(只读)、平台级AI提供商、固定收费服务 Credit 点数配置、租户 Credit 管理、Claw 接入配置管理、Agent 配置管理。
文件路径: `src/modules/admin`
鉴权分层: `AdminAuthGuard`(校验 JWT/注入用户) → `AdminPoliciesGuard`(校验 `@RequirePermission` 声明的 CASL 能力)。角色权限矩阵唯一定义源为 `casl/admin-ability.factory.ts` 的 `ROLE_CATALOG`。

## 功能描述及关键词

### controller/admin.controller.ts
后台管理控制器。
- **关键词**: admin, auth, login, jwt, tenants, providers, ai service, service credit, users, keys, controller, claw, agent, llm settings
- **函数**:
  - `login`: 登录/login
  - `listLoginTenants`: 登录租户选项/list login tenants
  - `me`: 当前用户/me
  - `getCurrentCreditAccount(limit?,before?)` — 查询当前登录租户自己的余额与倒序流水 | keywords: 当前Credit账户, 自身流水, current-credit-account, own-transaction-list
  - `logout`: 退出/logout
  - `listUsers`: 用户列表/list users
  - `createUser`: 创建用户/create user
  - `updateUser`: 更新用户/update user
  - `deleteUser`: 删除用户/delete user
  - `listRoles`: 角色管理列表(静态RBAC角色目录)/admin roles list | keywords: admin-roles-list-endpoint
  - `listAiProviders`: 提供商列表/list providers
  - `upsertAiProvider`: 创建或更新提供商/upsert provider
  - `updateAiProvider`: 更新提供商/update provider
  - `deleteAiProvider`: 删除提供商/delete provider
  - `testAiProvider`: 测试提供商连通性(POST /admin/ai-providers/:id/test, GET /models 探活, 15s 超时, 不消耗配额)/test ai provider
  - `listAiServices()` — 列出固定服务目录与当前生效点数 | keywords: 服务管理列表, 生效点数, service-management-list, effective-credit
  - `updateAiServiceCredit(code,body)` — 修改固定服务的 Credit 点数 | keywords: 更新服务点数, 固定服务编码, update-service-credit, immutable-service-code
  - `getTenantCreditAccount(id,limit?,before?)` — 查询当前余额与倒序追加式流水 | keywords: Credit账户查询, 流水查询, credit-account-query, transaction-list
  - `rechargeTenantCredit(id,body)` — 追加充值流水并更新租户余额 | keywords: 租户充值接口, 追加流水, tenant-recharge-endpoint, append-ledger
  - `adjustTenantCredit(id,body)` — 追加人工增减调账流水 | keywords: 人工调账接口, 余额增减, credit-adjustment-endpoint, balance-change
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
  - `ensureIndexes()` — 后台索引初始化，将旧会话过期时间普通索引迁移为 TTL 索引，并在重建唯一偏索引前执行兜底去重 | keywords: 后台索引初始化, 会话过期索引迁移, admin-index-initialization, session-ttl-index-migration
  - `dedupeDefaultProviders`: 重建 { modelCategory, isDefault } 唯一偏索引前去重，每个 modelCategory 仅留最新一条 isDefault=true，其余降级 false，防 E11000 | keywords: dedupe-default-providers, unique-index-guard
  - `login`: 登录签发JWT/login issue jwt
  - `getUserByToken`: token解析用户/get user by token
  - `listRoles`: 角色列表(静态RBAC角色目录及权限矩阵，只读)/list admin roles | keywords: list-admin-roles
  - `logout`: 注销会话/logout
  - `listLoginTenants`: 登录租户列表/list login tenants
  - `deleteTenant(currentUser, id)`: 删除没有用户且未分配 SuperClaw 的租户 | keywords: 删除租户, 分配保护, delete-tenant, allocation-protection
  - `getXhsArticleConcurrencyLimits(tenantId?)` — 读取文章生成的全平台与租户并发上限并应用安全默认值 | keywords: 文章生成并发配置, 租户并发上限, article-generation-concurrency, tenant-concurrency-limit
  - `getTenantPlatformAiPromptSupplement(tenantId?)` — 读取租户平台 AI 提示词，母平台作用域回退全局配置 | keywords: 平台AI提示词, 母平台回退, platform-ai-prompt, platform-scope-fallback
  - `getDefaultAiProvider`: 读取默认提供商（llm/em 未设 default 时 fallback 任一 enabled 记录）/get default provider
  - `getDefaultAiProviderRuntime`: 读取默认提供商运行配置/get default provider runtime
  - `getAiProviderBillingConfig(providerCode, modelCategory, model?)` — 读取调用时 Token/Credit 换算与固定 Token 配置 | keywords: 提供商计费配置, Token兑换率, provider-billing-config, token-credit-rate
  - `getDefaultEmbeddingRuntime`: 读取默认向量配置/get default embedding runtime
  - `getDefaultImageProviderRuntime`: 读取默认生图配置（严格 isDefault=true，未设 default 返回 null 走 meitu-cli 降级）/get default image provider runtime
  - `listAiProviders`: 提供商列表/list providers
  - `listAiServices(currentUser)` — 合并固定服务目录与数据库点数覆盖 | keywords: 服务管理列表, 固定服务目录, service-management-list, fixed-service-catalog
  - `updateAiServiceCredit(currentUser,serviceCode,creditCost)` — 仅更新既有服务编码的点数 | keywords: 更新服务点数, 固定服务编码, update-service-credit, immutable-service-code
  - `getTenantCreditAccount(currentUser,id,input)` — 查询租户余额及分页流水 | keywords: Credit账户查询, 流水查询, credit-account-query, transaction-list
  - `getCurrentCreditAccount(currentUser,input)` — 按登录态租户边界查询自身余额与分页流水 | keywords: 当前Credit账户, 自身流水, current-credit-account, own-transaction-list
  - `rechargeTenantCredit(currentUser,id,input)` — 新增正数充值记录 | keywords: 租户充值, 原子入账, tenant-recharge, atomic-credit
  - `adjustTenantCredit(currentUser,id,input)` — 新增正负人工调账记录 | keywords: 人工调账, 原子余额, manual-credit-adjustment, atomic-balance
  - `applyCreditChange(currentUser,tenantId,input)` — 在同一 Mongo 事务更新余额和写流水，外部单号重复时幂等返回原记录 | keywords: 余额流水事务, 禁止透支, balance-ledger-transaction, overdraft-guard
  - `commitCreditChange(currentUser,tenantId,input,amountUnits,session?)` — 提交余额条件更新和流水，单机写失败时补偿余额 | keywords: 提交余额流水, 单机补偿, commit-credit-ledger, standalone-compensation
  - `isMongoTransactionUnsupported(error)` — 识别单机 Mongo 事务能力并切换补偿写入 | keywords: 单机事务识别, 降级写入, transaction-support-detect, fallback-write
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

### guards/policies.guard.ts
后台 CASL 策略守卫，读取 `@RequirePermission` 声明与登录用户角色能力，能力不足抛 403。需在 `AdminAuthGuard` 之后生效(依赖已注入的 `req.adminUser`)。
- **关键词**: guard, casl, policy, ability, rbac, forbidden
- **函数**:
  - `canActivate`: 策略校验(校验入口声明的动作+主体能力)/can activate policy check | keywords: can-activate-policy-check

### casl/admin-ability.factory.ts
后台 CASL 能力工厂，按用户角色静态构建 ability(RBAC)；导出 `ROLE_CATALOG` 静态角色目录(权限矩阵唯一定义源)与 `AdminAbility` 类型。
- **关键词**: casl, ability, factory, rbac, role-catalog, mongo-ability
- **函数**:
  - `createForUser`: 依据登录用户角色构建 CASL ability/create ability for admin user | keywords: create-ability-for-admin-user

### casl/admin-permission.constants.ts
后台权限主体注册中心(subject 根 key)与动作枚举定义，鉴权声明的 subject 必须逐字取自 `ADMIN_SUBJECTS`；包含小红书 AI 选题生成主体 `XhsTopic`、抖音真实工作台主体 `DouyinWorkbench`、运行参数主体 `PlatformSetting`、热点采集榜主体 `HotTopic` 与平台节点主体 `SuperClaw`。租户管理员与操作员均可管理各自租户用户边界内的抖音选题、分镜和直连调用；`HotTopic` 覆盖采集规则、榜单条目、归类标签与热点推荐：`tenant_admin` 授 `manage HotTopic`，`operator` 只授 `read HotTopic`(能看榜单、能调推荐，改不了采集规则)。
- **关键词**: permission, subject, action, registry, root-key, casl
- **类型导出**: `AdminAction`, `AdminSubject`; 常量 `ADMIN_ACTIONS`, `ADMIN_SUBJECTS`

### decorators/require-permission.decorator.ts
入口鉴权声明装饰器 `@RequirePermission(action, subject)`，与路由装饰器同址标注入口所需能力，供 `AdminPoliciesGuard` 消费。
- **关键词**: decorator, metadata, require-permission, casl, policy
- **函数**:
  - `RequirePermission`: 入口鉴权声明(设置权限元数据)/require permission decorator | keywords: require-permission-decorator

### entities/admin.entity.ts
后台实体定义。
- **关键词**: user entity, session entity, provider entity, claw config entity, agent config entity, llm setting entity, jwt payload

### controller/admin.dto.ts
后台请求体定义。
- **关键词**: dto, login dto, tenant, provider default, claw config dto, agent config dto, llm setting dto
- **函数**:
  - `UpdateAiServiceCreditDto` — 校验最多六位小数的非负服务点数 | keywords: 更新服务点数, 服务计费, update-service-credit, service-billing
  - `RechargeTenantCreditDto` — 校验正数充值、原因和外部单号 | keywords: 租户充值, 追加流水, tenant-recharge, append-ledger
  - `AdjustTenantCreditDto` — 校验非零人工调账 | keywords: 人工调账, 非零变动, manual-adjustment, nonzero-change

### types/admin-request.types.ts
后台请求上下文定义。
- **关键词**: request type, auth context
