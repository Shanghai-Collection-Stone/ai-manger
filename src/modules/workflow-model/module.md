# 模块名称 (Module Name)

工作流节点模型（workflow-model）

## 概述 (Overview)

为代码内固定的预设工作流（小红书图文、抖音视频制作）的每个节点指定使用哪个 AI 提供商、哪个模型。提供商仍来自后台「Ai提供商设置」（`admin_ai_providers`），本模块只保存「节点 → 提供商 + 模型」的平台级映射；节点没设置时业务沿用该类型的默认提供商。业务模块在调用模型前用 `resolveNodeRuntime(workflowKey, nodeKey)` 取运行配置。

## 文件清单 (File List)

- `workflow-model.module.ts` — NestJS 模块入口，导出 `WorkflowModelService`。
- `entities/workflow-model.entity.ts` — 预设工作流目录、运行时支持矩阵、节点设置实体与后台视图类型。
- `services/workflow-model.service.ts` — 节点设置读写、PixMax 可选模型查询、节点运行配置解析与 LLM 覆盖参数转换。
- `controller/workflow-model-admin.controller.ts` — 平台后台 `admin/workflow-models` 接口。
- `controller/workflow-model.dto.ts` — 保存节点模型、查询可选模型的参数校验。

## 函数清单 (Function List)

- `WorkflowModelModule()` — 装配节点模型设置并导出服务 | keywords: 工作流节点模型模块, 按节点取模型, workflow-model-module, per-node-model
- `WorkflowNodeCategory` — 节点模型类型 llm / image / video | keywords: 节点模型类型, 提供商类型, node-model-category, provider-category
- `WorkflowNodeDefinition` — 代码固定的节点定义 | keywords: 预设工作流节点, 节点定义, preset-workflow-node, node-definition
- `WorkflowDefinition` — 代码固定的工作流定义 | keywords: 预设工作流, 工作流定义, preset-workflow, workflow-definition
- `WORKFLOW_NODES` — 工作流与节点 key 常量，业务调用处统一从这里取 | keywords: 工作流节点标识, 节点key常量, workflow-node-keys, node-key-constants
- `WORKFLOW_MODEL_CATALOG` — 预设工作流目录（小红书图文：topic / article / cover-copy / cover-image / cover-overlay / inner-image；抖音：script / storyboard / shot-image / shot-video / full-video） | keywords: 预设工作流目录, 节点登记, preset-workflow-catalog, node-registry
- `WORKFLOW_RUNTIME_SUPPORT` — 各类型运行时能真正调用的提供商（文本排除 pixmax，生图 gemini/doubao/ark/openai，视频仅 pixmax） | keywords: 运行时支持范围, 提供商兼容, runtime-support-matrix, provider-compatibility
- `WorkflowNodeModelEntity` — 节点设置持久化实体（`workflow_node_models`） | keywords: 节点模型设置, 平台级配置, node-model-binding, platform-setting
- `WorkflowNodeRuntime` — 节点调用时的提供商运行配置 | keywords: 节点运行配置, 提供商密钥, node-runtime, provider-credential
- `WorkflowProviderOption` — 不含密钥的提供商选项 | keywords: 提供商选项, 隐藏密钥, provider-option, hide-api-key
- `WorkflowNodeView` — 节点定义 + 当前设置 + 默认回退 | keywords: 节点设置视图, 默认回退, node-setting-view, default-fallback
- `WorkflowView` — 后台列表里的一条工作流 | keywords: 工作流设置视图, 节点列表, workflow-setting-view, node-list
- `PIXMAX_NODE_TYPES` — 节点类型与 PixMax `nodeType` 对照 | keywords: PixMax节点类型, 类型映射, pixmax-node-type, category-mapping
- `isWorkflowRuntimeSupported(category,providerCode)` — 判断提供商在该类型下运行时能否调用 | keywords: 运行时支持判断, 提供商兼容, is-runtime-supported, provider-compatibility
- `toWorkflowLlmConfig(runtime)` — 节点运行配置转成 `runWithMessages` 的 provider/model/apiKey/baseUrl 覆盖字段，未设置返回空对象 | keywords: 节点LLM覆盖参数, 默认回退, node-llm-config-override, default-fallback
- `WorkflowModelService()` — 节点模型设置服务 | keywords: 工作流节点模型, 节点指定模型, workflow-node-model, per-node-model
- `WorkflowModelService.ensureIndexes()` — 建立工作流 + 节点唯一索引 | keywords: 节点设置索引, 唯一约束, node-binding-index, unique-constraint
- `WorkflowModelService.list(currentUser)` — 列出工作流、节点设置、默认回退与已启用提供商 | keywords: 工作流设置列表, 提供商选项, list-workflow-settings, provider-options
- `WorkflowModelService.saveNode(currentUser,workflowKey,nodeKey,input)` — 校验提供商已启用且类型一致后保存，模型留空用提供商默认模型 | keywords: 保存节点模型, 类型校验, save-node-model, category-check
- `WorkflowModelService.resetNode(currentUser,workflowKey,nodeKey)` — 清除设置回到默认提供商 | keywords: 重置节点模型, 回退默认, reset-node-model, fallback-default
- `WorkflowModelService.listProviderModels(providerId,category)` — PixMax 实时读取可用模型并按类型过滤，其他提供商返回自身模型并允许手填 | keywords: 提供商可选模型, PixMax模型列表, list-provider-models, pixmax-model-list
- `WorkflowModelService.resolveNodeRuntime(workflowKey,nodeKey)` — 取节点运行配置：未设置或提供商已删除/停用返回 null 回退默认，类型不符或运行时不支持直接报错 | keywords: 解析节点运行配置, 回退默认提供商, resolve-node-runtime, fallback-default-provider
- `WorkflowModelService.readFallback(category)` — 读取未设置时生效的默认提供商（视频未指定时走直连服务，返回 null） | keywords: 读取默认提供商, 回退说明, read-fallback-provider, fallback-label
- `WorkflowModelService.requireNode(workflowKey,nodeKey)` — 查找目录里的节点定义 | keywords: 查找节点定义, 目录校验, require-node-definition, catalog-check
- `WorkflowModelService.isNodeCategory(category)` — 排除向量模型 | keywords: 节点可用类型, 排除向量, is-node-category, exclude-embedding
- `WorkflowModelService.toProviderOption(row)` — 提供商实体转无密钥选项 | keywords: 提供商选项视图, 隐藏密钥, provider-option-view, hide-api-key
- `WorkflowModelAdminController()` — 平台后台节点模型接口 | keywords: 节点模型后台接口, 平台配置, workflow-model-admin-controller, platform-setting
- `WorkflowModelAdminController.list(req)` — `GET admin/workflow-models` | keywords: 节点模型列表接口, 工作流目录, list-workflow-models-api, workflow-catalog
- `WorkflowModelAdminController.listProviderModels(providerId,query)` — `GET admin/workflow-models/providers/:providerId/models?category=` | keywords: 可选模型接口, PixMax模型列表, list-provider-models-api, pixmax-model-list
- `WorkflowModelAdminController.save(req,workflowKey,nodeKey,body)` — `PUT admin/workflow-models/:workflowKey/nodes/:nodeKey` | keywords: 保存节点模型接口, 指定模型, save-node-model-api, assign-model
- `WorkflowModelAdminController.reset(req,workflowKey,nodeKey)` — `DELETE admin/workflow-models/:workflowKey/nodes/:nodeKey` | keywords: 重置节点模型接口, 回退默认, reset-node-model-api, fallback-default
- `WorkflowModelAdminController.requireUser(req)` — 读取后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `SaveWorkflowNodeModelDto()` — 校验提供商 ID 与可选模型 | keywords: 保存节点模型参数, 提供商选择, save-node-model-dto, provider-selection
- `ListWorkflowProviderModelsDto()` — 校验节点类型 | keywords: 查询可选模型参数, 节点类型, list-provider-models-dto, node-category

## 关键词索引 (Keyword Index)

| 中文             | English                   |
| ---------------- | ------------------------- |
| 工作流节点模型   | workflow-node-model       |
| 节点指定模型     | per-node-model            |
| 预设工作流目录   | preset-workflow-catalog   |
| 节点模型设置     | node-model-binding        |
| 解析节点运行配置 | resolve-node-runtime      |
| 回退默认提供商   | fallback-default-provider |
| 运行时支持范围   | runtime-support-matrix    |
| PixMax模型列表   | pixmax-model-list         |
| 节点LLM覆盖参数  | node-llm-config-override  |
| 节点key常量      | node-key-constants        |

## 类型导出 (Type Exports)

- `WorkflowNodeCategory` / `WorkflowNodeDefinition` / `WorkflowDefinition` / `WorkflowNodeModelEntity` / `WorkflowNodeRuntime` / `WorkflowProviderOption` / `WorkflowNodeView` / `WorkflowView`。
- `SaveWorkflowNodeModelDto` / `ListWorkflowProviderModelsDto`。

## 模块功能描述 (Module Feature Description)

**节点目录写在代码里**：`WORKFLOW_NODES` 定义 key 常量，`WORKFLOW_MODEL_CATALOG` 登记每条预设工作流里会调用模型的节点及其类型（文本 / 生图 / 生视频），后台只能为节点选模型，不能增删节点。新增节点时先在目录里登记，再在业务调用处取节点配置；`workflowKey` / `nodeKey` 上线后不要改名。

**保存规则**：`PUT admin/workflow-models/:workflowKey/nodes/:nodeKey` 只接受已启用、且 `modelCategory` 与节点类型一致的提供商；模型留空时用该提供商记录里的默认模型，两者都没有则拒绝。同一提供商代码在不同类型下是不同记录（例如 PixMax 生图、PixMax 生视频各一条），与「Ai提供商设置」现有的 `providerCode + modelCategory` 唯一规则一致。`DELETE` 清除设置。四个接口都挂 `AiProvider` 权限（平台 AI 配置，仅超管）。

**可选模型**：提供商代码为 `pixmax` 时，`GET .../providers/:providerId/models?category=` 用它的 Key 实时调 `POST /openapi/model/available`，按 `GENERATE_TEXT / GENERATE_IMAGE / GENERATE_VIDEO` 过滤后返回，页面只能从列表里选；其他提供商返回其默认模型并允许手填。

**运行时解析**：`resolveNodeRuntime` 没有设置时返回 `null`，业务照旧用默认提供商；设置的提供商被删除或停用时记警告并回退默认；类型不符或 `WORKFLOW_RUNTIME_SUPPORT` 判定运行时不支持（例如为生图节点选了 PixMax）时抛 `WORKFLOW_NODE_PROVIDER_NOT_SUPPORTED:<类型>:<提供商>`，不静默换模型。后台允许先保存这类组合并标注「运行时暂不支持」，等对应调用接入后再把提供商加入支持矩阵。

**当前接入情况（小红书图文）**：`topic` 覆盖选题候选生成与子选题提示词推荐（`xhs-topic.service`），`article` 覆盖文章 Agent 的首次生文与重写（`xhs-article-generation.service`），`cover-copy` 覆盖图组封面主副标题生成，`cover-image` 覆盖 `ai-direct` 封面底图与灵感画布封面重绘，`cover-overlay` 覆盖 `ai-overlay` 文字海报素材层，`inner-image` 覆盖灵感画布内页重绘（后四者在 `canvas-image-group.service`）。封面文案、AI 封面原本失败就回退的地方仍按原逻辑回退。

**当前接入情况（抖音视频制作）**：`script`（候选脚本生成、生成要求推荐）与 `storyboard`（分镜拆解）经 `toWorkflowLlmConfig` 覆盖 LLM 的 provider/model/apiKey/baseUrl；`shot-image` 把节点配置作为 `AgentService.sendPrompt` 的 `runtimeOverride`，指定后出图失败直接报错、不降级美图；`shot-video`（分镜模式）与 `full-video`（整片模式）指定 PixMax 模型后由 `DouyinPixmaxVideoService` 调用 PixMax，未指定时仍走 `DOUYIN_VIDEO_GENERATION_*` 直连服务。

**后台页面**：「工作流节点模型」Tab 左侧是工作流子菜单（显示节点数与已指定数，记住上次选择），右侧是选中工作流的全部模型节点设置。单测 `workflow-model.service.spec.ts` 校验 `WORKFLOW_NODES` 与目录逐项一致。
