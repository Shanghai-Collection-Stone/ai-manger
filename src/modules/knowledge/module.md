# 模块名称 (Module Name)

引用知识（knowledge）

## 概述 (Overview)

租户内共享的知识条目（名称 + 知识内容），比如门店信息、产品卖点、价格与活动规则、品牌说法。小红书与抖音的「添加母选题」都可以多选引用知识；母选题只保存引用的知识 ID，生成子选题、文章（小红书）和脚本（抖音）时由服务端按租户读取知识内容，拼成一段 `<reference_knowledge>` 注入提示词，作为事实依据——涉及具体信息以知识为准、不编造，但不能覆盖合规边界与交付协议。

## 文件清单 (File List)

- `knowledge.module.ts` — Nest 模块声明，装配后台鉴权、数据源、控制器与服务，并导出 `KnowledgeService`。
- `entities/knowledge.entity.ts` — 名称 / 内容 / 引用条数 / 提示词预算上限常量，作用域、实体与视图类型。
- `services/knowledge.service.ts` — 知识增删改查（租户内共享、名称不重复）与按引用 ID 拼提示词段落。
- `services/knowledge-ids.ts` — 母选题引用 ID 的归一化（格式、去重、上限），小红书与抖音仓储共用。
- `services/knowledge-prompt.ts` — 把知识条目拼成注入提示词的段落，超预算截断。
- `services/knowledge-prompt.spec.ts` — 提示词拼接回归测试。
- `controller/knowledge.controller.ts` — `/api/knowledge` 管理接口。
- `controller/knowledge.dto.ts` — 新建 / 修改知识的请求体校验。

## 函数清单 (Function List)

- `KnowledgeModule()` — 装配引用知识模块并导出服务 | keywords: 引用知识模块, knowledge-module
- `KNOWLEDGE_NAME_MAX_LENGTH` — 知识名称最多 50 字 | keywords: 知识名称上限, knowledge-name-limit
- `KNOWLEDGE_CONTENT_MAX_LENGTH` — 单条知识内容最多 5000 字 | keywords: 知识内容上限, knowledge-content-limit
- `KNOWLEDGE_REFERENCE_LIMIT` — 一个母选题最多引用 10 条知识 | keywords: 引用知识条数上限, knowledge-reference-limit
- `KNOWLEDGE_PROMPT_MAX_LENGTH` — 注入提示词的知识总字数上限 8000 | keywords: 引用知识提示词预算, knowledge-prompt-budget
- `normalizeKnowledgeIds(ids)` — 只留 24 位十六进制 ID、转小写、去重、按上限截断 | keywords: 归一化引用知识ID, normalize-knowledge-ids
- `buildKnowledgePromptBlock(items,maxLength?)` — 按顺序拼「【名称】内容」并包进 `<reference_knowledge>`，超预算截断，没有知识返回空串 | keywords: 拼接引用知识提示词, 知识预算截断, build-knowledge-prompt, knowledge-budget-truncate
- `KnowledgeService()` — 引用知识仓储与提示词服务 | keywords: 引用知识服务, 知识增删改查, knowledge-service, knowledge-crud
- `KnowledgeService.ensureIndexes()` — 建立租户时间线与租户内名称索引 | keywords: 引用知识索引, knowledge-indexes
- `KnowledgeService.list(keyword,scope)` — 本租户知识按最近更新在前，关键词同时搜名称与内容 | keywords: 查询引用知识, 关键词搜索, list-knowledge, keyword-search
- `KnowledgeService.create(input,scope)` — 新建知识，同租户名称不能重复 | keywords: 新建引用知识, create-knowledge
- `KnowledgeService.update(id,input,scope)` — 修改名称或内容 | keywords: 修改引用知识, update-knowledge
- `KnowledgeService.remove(id,scope)` — 删除知识，已引用的母题生成时自动跳过 | keywords: 删除引用知识, delete-knowledge
- `KnowledgeService.buildPromptSection(ids,scope)` — 按引用 ID 读本租户知识并拼提示词段落，缺失的跳过 | keywords: 引用知识提示词, 按引用拼接, knowledge-prompt-section, reference-assembly
- `KnowledgeService.require(id,scope)` — 读取本租户一条知识，不存在 404 | keywords: 要求引用知识, require-knowledge
- `KnowledgeService.assertNameFree(name,selfId,scope)` — 同租户名称查重 | keywords: 知识名称查重, knowledge-name-unique
- `KnowledgeService.requireName(value)` — 校验并归一名称 | keywords: 知识名称校验, validate-knowledge-name
- `KnowledgeService.requireContent(value)` — 校验并归一内容 | keywords: 知识内容校验, validate-knowledge-content
- `KnowledgeService.tenantFilter(scope)` — 有租户精确匹配，母平台只看无租户知识 | keywords: 知识租户过滤, knowledge-tenant-filter
- `KnowledgeService.toView(entity)` — 实体转视图 | keywords: 知识视图转换, knowledge-view-mapping
- `KnowledgeController()` — `/api/knowledge` 接口，统一 `Knowledge` 权限主体 | keywords: 引用知识接口, 管理端鉴权, knowledge-controller, admin-authorization
- `KnowledgeController.list(keyword,req)` — 查询接口 | keywords: 查询引用知识接口, list-knowledge-endpoint
- `KnowledgeController.create(body,req)` — 新建接口 | keywords: 新建引用知识接口, create-knowledge-endpoint
- `KnowledgeController.update(id,body,req)` — 修改接口 | keywords: 修改引用知识接口, update-knowledge-endpoint
- `KnowledgeController.remove(id,req)` — 删除接口 | keywords: 删除引用知识接口, delete-knowledge-endpoint
- `KnowledgeController.requireUser(req)` — 读取后台用户 | keywords: 读取知识接口用户, read-knowledge-user
- `KnowledgeController.scopeOf(user)` — 构造租户用户作用域 | keywords: 构造知识作用域, build-knowledge-scope
- `CreateKnowledgeDto()` — 名称 1-50 字、内容 1-5000 字 | keywords: 新建引用知识参数, create-knowledge-dto
- `UpdateKnowledgeDto()` — 只传要改的字段 | keywords: 修改引用知识参数, update-knowledge-dto

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 引用知识模块 | knowledge-module |
| 引用知识服务 | knowledge-service |
| 查询引用知识 | list-knowledge |
| 新建引用知识 | create-knowledge |
| 修改引用知识 | update-knowledge |
| 删除引用知识 | delete-knowledge |
| 引用知识提示词 | knowledge-prompt-section |
| 拼接引用知识提示词 | build-knowledge-prompt |
| 归一化引用知识ID | normalize-knowledge-ids |
| 引用知识条数上限 | knowledge-reference-limit |
| 知识租户过滤 | knowledge-tenant-filter |

## 类型导出 (Type Exports)

- `KnowledgeScope` — 租户与用户作用域 | keywords: 引用知识作用域, 租户共享, knowledge-scope, tenant-shared
- `KnowledgeEntity` — 知识实体，集合 `knowledge_items` | keywords: 引用知识实体, knowledge-entity
- `KnowledgeView` — 接口视图 `{ id, name, content, createdAt, updatedAt }` | keywords: 引用知识视图, knowledge-view

## 模块功能描述 (Module Description)

**入口鉴权**（全部 `AdminAuthGuard` + `AdminPoliciesGuard`，权限主体 `Knowledge` 已登记在 `admin-permission.constants.ts`，租户管理员与操作员都是 `manage`）：

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | `/api/knowledge?keyword=` | read Knowledge | 列出本租户知识 `{ items }` |
| POST | `/api/knowledge` | create Knowledge | 新建 `{ name, content }` → `{ item }` |
| PATCH | `/api/knowledge/:id` | update Knowledge | 修改名称或内容 → `{ item }` |
| DELETE | `/api/knowledge/:id` | delete Knowledge | 删除 → `{ ok: true }` |

作用域：同一租户内所有账号共享（记录 `createdBy` / `updatedBy`），母平台（无租户）只看无租户的平台级知识；ID 为 Mongo ObjectId 十六进制串。错误码：`KNOWLEDGE_NOT_FOUND`（404）、`KNOWLEDGE_NAME_EXISTS`（409，同租户重名）、`KNOWLEDGE_NAME_REQUIRED` / `KNOWLEDGE_CONTENT_REQUIRED`（400，去空白后为空）。

**引用与注入**：`xhs-topic` 与 `douyin-workbench` 的母选题新增 `knowledgeIds`（最多 10 条，保存时只做格式归一，不查库）。生成时调用 `buildPromptSection(ids, scope)`：按租户过滤读取、保持用户选择顺序、已删除或跨租户的 ID 自动跳过，总字数超 8000 截断后面的内容；没有可用知识返回空串，提示词不变。注入位置：小红书子选题生成（`XhsTopicService.buildSystemPrompt`，由前端在请求里带母题的 `knowledgeIds`）、小红书文章生成（`XhsArticleGenerationService` 读母题 `knowledgeIds`）、抖音脚本生成（`DouyinChildTopicGenerationService` 读母题 `knowledgeIds`）。
