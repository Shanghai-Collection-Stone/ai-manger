# 模块名称 (Module Name)

工作流节点模型（workflow-model）

## 概述 (Overview)

为代码内固定的预设工作流（小红书图文、抖音视频制作）的每个节点指定使用哪个 AI 提供商、哪个模型。提供商仍来自后台「Ai提供商设置」（`admin_ai_providers`），本模块只保存「节点 → 提供商 + 模型」的平台级映射；节点没设置时业务沿用该类型的默认提供商。业务模块在调用模型前用 `resolveNodeRuntime(workflowKey, nodeKey)` 取运行配置。

## 文件清单 (File List)

- `workflow-model.module.ts` — NestJS 模块入口，导出 `WorkflowModelService`。
- `entities/workflow-model.entity.ts` — 预设工作流目录、运行时支持矩阵、节点设置实体与后台视图类型。
- `services/workflow-model.service.ts` — 节点设置读写、PixMax / 数眼智能可选模型查询、节点运行配置解析与 LLM 覆盖参数转换。
- `services/shuyan-model-catalog.ts` — 数眼智能（New API 中转）模型目录：实时拉 `GET /v1/models`、把模型判成文本 / 生图 / 生视频 / 向量 / 其他，并按节点类型出可选列表。
- `controller/workflow-model-admin.controller.ts` — 平台后台 `admin/workflow-models` 接口。
- `controller/workflow-model.dto.ts` — 保存节点模型、查询可选模型的参数校验。

## 函数清单 (Function List)

- `WorkflowModelModule()` — 装配节点模型设置并导出服务 | keywords: 工作流节点模型模块, 按节点取模型, workflow-model-module, per-node-model
- `WorkflowNodeCategory` — 节点模型类型 llm / image / video / audio（audio 为音色克隆与配音，当前只有阿里云百炼） | keywords: 节点模型类型, 提供商类型, node-model-category, provider-category
- `WorkflowNodeDefinition` — 代码固定的节点定义，可带 `runtimeProviders`（节点只接受的提供商代码）与 `unsetHint`（未指定时的后台说明） | keywords: 预设工作流节点, 节点定义, preset-workflow-node, node-definition
- `WorkflowDefinition` — 代码固定的工作流定义 | keywords: 预设工作流, 工作流定义, preset-workflow, workflow-definition
- `WORKFLOW_NODES` — 工作流与节点 key 常量，节点只按能力分思考 `think` / 生图 `image` / 生视频 `video` / 音色克隆 `voice`；原来的步骤名（script、storyboard、storeVisitVideo…）保留为别名指向所属那一类，业务代码不用改 | keywords: 工作流节点标识, 节点key常量, workflow-node-keys, node-key-constants
- `WORKFLOW_LEGACY_NODE_KEYS` — 合并前的旧节点 key 与并入顺序（抖音思考优先尾帧衔接 / 场景归类等看图节点，生视频优先探店节点） | keywords: 旧节点合并, 节点设置迁移, legacy-node-merge, node-binding-migration
- `WORKFLOW_MODEL_CATALOG` — 预设工作流目录：小红书图文 think / image，抖音 think / image / video / voice（同一类的各步骤共用一个节点） | keywords: 预设工作流目录, 节点登记, preset-workflow-catalog, node-registry
- `WORKFLOW_RUNTIME_SUPPORT` — 各类型运行时能真正调用的提供商（文本排除 pixmax；生图增加 shuyan/shuyanai；生视频支持 pixmax、shuyan/shuyanai 与自建 MiniMax-H3 opensource-video；音色只支持阿里云百炼 dashscope），节点登记了 `runtimeProviders` 时再按节点收窄 | keywords: 运行时支持范围, 提供商兼容, runtime-support-matrix, provider-compatibility
- `WorkflowNodeModelEntity` — 节点设置持久化实体（`workflow_node_models`） | keywords: 节点模型设置, 平台级配置, node-model-binding, platform-setting
- `WorkflowNodeRuntime` — 节点调用时的提供商运行配置 | keywords: 节点运行配置, 提供商密钥, node-runtime, provider-credential
- `WorkflowProviderOption` — 不含密钥的提供商选项 | keywords: 提供商选项, 隐藏密钥, provider-option, hide-api-key
- `WorkflowNodeView` — 节点定义 + 当前设置 + 默认回退 | keywords: 节点设置视图, 默认回退, node-setting-view, default-fallback
- `WorkflowView` — 后台列表里的一条工作流 | keywords: 工作流设置视图, 节点列表, workflow-setting-view, node-list
- `PIXMAX_NODE_TYPES` — 节点类型与 PixMax `nodeType` 对照（audio → `GENERATE_AUDIO`） | keywords: PixMax节点类型, 类型映射, pixmax-node-type, category-mapping
- `isWorkflowRuntimeSupported(category,providerCode,nodeProviders?)` — 判断提供商在该类型下运行时能否调用，传了节点允许的提供商时还要在其中 | keywords: 运行时支持判断, 提供商兼容, is-runtime-supported, provider-compatibility
- `toWorkflowLlmConfig(runtime)` — 节点运行配置转成 `runWithMessages` 的 provider/model/apiKey/baseUrl 覆盖字段，未设置返回空对象 | keywords: 节点LLM覆盖参数, 默认回退, node-llm-config-override, default-fallback
- `WorkflowModelService()` — 节点模型设置服务 | keywords: 工作流节点模型, 节点指定模型, workflow-node-model, per-node-model
- `WorkflowModelService.ensureIndexes()` — 建立工作流 + 节点唯一索引 | keywords: 节点设置索引, 唯一约束, node-binding-index, unique-constraint
- `WorkflowModelService.mergeLegacyBindings()` — 启动时把旧节点设置并入新节点：新节点已有设置不动，没有时按 `WORKFLOW_LEGACY_NODE_KEYS` 顺序取第一个有设置的旧节点复制；旧记录保留可回退，可重复执行 | keywords: 旧节点合并, 节点设置迁移, merge-legacy-bindings, node-binding-migration
- `WorkflowModelService.list(currentUser)` — 列出工作流、节点设置、默认回退与已启用提供商 | keywords: 工作流设置列表, 提供商选项, list-workflow-settings, provider-options
- `WorkflowModelService.saveNode(currentUser,workflowKey,nodeKey,input)` — 校验提供商已启用且类型一致后保存，模型留空用提供商默认模型 | keywords: 保存节点模型, 类型校验, save-node-model, category-check
- `WorkflowModelService.resetNode(currentUser,workflowKey,nodeKey)` — 清除设置回到默认提供商 | keywords: 重置节点模型, 回退默认, reset-node-model, fallback-default
- `WorkflowModelService.listProviderModels(providerId,category)` — PixMax 实时读取可用模型并按类型过滤（只能选），数眼智能实时读取 `/v1/models` 并按分类过滤（可选可填），自建 MiniMax-H3（opensource-video）返回 minimax-h3-turbo / -fast / -quality 三个档位（只能选），其他提供商返回自身模型并允许手填 | keywords: 提供商可选模型, PixMax模型列表, 数眼可选模型, list-provider-models, pixmax-model-list, shuyan-model-list
- `SHUYAN_PROVIDER_CODES` — 数眼智能可用的提供商代码 `shuyan` / `shuyanai` | keywords: 数眼智能提供商代码, 中转站, shuyan-provider-codes, openai-compatible-relay
- `SHUYAN_DEFAULT_BASE_URL` — 数眼智能主节点地址，baseUrl 留空时兜底 | keywords: 数眼智能默认地址, 主节点, shuyan-default-base-url, primary-endpoint
- `ShuyanModelCategory` — 节点三类之外另出 em / other，按分类过滤时自然排除 | keywords: 数眼模型分类, 向量与其他, shuyan-model-category, embedding-and-other
- `ShuyanModelItem` — `/v1/models` 返回的单条模型 | keywords: 数眼模型条目, 端点类型, shuyan-model-item, endpoint-types
- `isShuyanProvider(providerCode)` — 判断提供商代码是否数眼智能 | keywords: 数眼智能识别, 提供商代码, is-shuyan-provider, provider-code
- `classifyShuyanModel(item)` — 优先按 New API `supported_endpoint_types` 判分类，没有该字段时按模型名兜底（万相按 `-i2v` / `-t2v` / `-r2v` / `-s2v` 后缀归视频），都不命中当文本模型 | keywords: 数眼模型分类, 按名兜底, classify-shuyan-model, name-fallback
- `fetchShuyanModels(input)` — 用 Key 实时拉账号可调模型，失败抛 `SHUYAN_MODEL_LIST_FAILED:<原因>` | keywords: 拉取数眼模型, 账号可用模型, fetch-shuyan-models, available-models
- `listShuyanModelsByCategory(input)` — 拉取后按节点类型过滤并排序 | keywords: 数眼可选模型, 按分类过滤, list-shuyan-models-by-category, filter-by-category
- `WorkflowModelService.resolveNodeRuntime(workflowKey,nodeKey)` — 取节点运行配置：未设置或提供商已删除/停用返回 null 回退默认，类型不符或运行时不支持直接报错 | keywords: 解析节点运行配置, 回退默认提供商, resolve-node-runtime, fallback-default-provider
- `WorkflowModelService.readFallback(category)` — 读取未设置时生效的默认提供商（视频未指定时走直连服务、音色克隆未指定时不可用，都返回 null） | keywords: 读取默认提供商, 回退说明, read-fallback-provider, fallback-label
- `WorkflowModelService.requireNode(workflowKey,nodeKey)` — 查找目录里的节点定义 | keywords: 查找节点定义, 目录校验, require-node-definition, catalog-check
- `WorkflowModelService.isNodeCategory(category)` — 排除向量模型（含音色克隆） | keywords: 节点可用类型, 排除向量, is-node-category, exclude-embedding
- `WorkflowModelService.toProviderOption(row)` — 提供商实体转无密钥选项 | keywords: 提供商选项视图, 隐藏密钥, provider-option-view, hide-api-key
- `WorkflowModelAdminController()` — 平台后台节点模型接口 | keywords: 节点模型后台接口, 平台配置, workflow-model-admin-controller, platform-setting
- `WorkflowModelAdminController.list(req)` — `GET admin/workflow-models` | keywords: 节点模型列表接口, 工作流目录, list-workflow-models-api, workflow-catalog
- `WorkflowModelAdminController.listProviderModels(providerId,query)` — `GET admin/workflow-models/providers/:providerId/models?category=` | keywords: 可选模型接口, PixMax模型列表, 数眼可选模型, list-provider-models-api, pixmax-model-list, shuyan-model-list
- `WorkflowModelAdminController.save(req,workflowKey,nodeKey,body)` — `PUT admin/workflow-models/:workflowKey/nodes/:nodeKey` | keywords: 保存节点模型接口, 指定模型, save-node-model-api, assign-model
- `WorkflowModelAdminController.reset(req,workflowKey,nodeKey)` — `DELETE admin/workflow-models/:workflowKey/nodes/:nodeKey` | keywords: 重置节点模型接口, 回退默认, reset-node-model-api, fallback-default
- `WorkflowModelAdminController.requireUser(req)` — 读取后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `SaveWorkflowNodeModelDto()` — 校验提供商 ID 与可选模型 | keywords: 保存节点模型参数, 提供商选择, save-node-model-dto, provider-selection
- `ListWorkflowProviderModelsDto()` — 校验节点类型（llm / image / video / audio） | keywords: 查询可选模型参数, 节点类型, list-provider-models-dto, node-category

## 关键词索引 (Keyword Index)

| 中文             | English                   |
| ---------------- | ------------------------- |
| 工作流节点模型   | workflow-node-model       |
| 节点指定模型     | per-node-model            |
| 预设工作流目录   | preset-workflow-catalog   |
| 旧节点合并       | merge-legacy-bindings     |
| 节点设置迁移     | node-binding-migration    |
| 节点模型设置     | node-model-binding        |
| 解析节点运行配置 | resolve-node-runtime      |
| 回退默认提供商   | fallback-default-provider |
| 运行时支持范围   | runtime-support-matrix    |
| PixMax模型列表   | pixmax-model-list         |
| 节点LLM覆盖参数  | node-llm-config-override  |
| 节点key常量      | node-key-constants        |
| 数眼可选模型     | shuyan-model-list         |
| 数眼模型分类     | classify-shuyan-model     |
| 拉取数眼模型     | fetch-shuyan-models       |
| 按名兜底         | name-fallback             |
| 节点可用提供商   | node-runtime-providers    |
| 音色克隆节点     | voice-clone-node          |

## 类型导出 (Type Exports)

- `WorkflowNodeCategory` / `WorkflowNodeDefinition` / `WorkflowDefinition` / `WorkflowNodeModelEntity` / `WorkflowNodeRuntime` / `WorkflowProviderOption` / `WorkflowNodeView` / `WorkflowView`。
- `SaveWorkflowNodeModelDto` / `ListWorkflowProviderModelsDto`。
- `ShuyanModelCategory` / `ShuyanModelItem`。

## 模块功能描述 (Module Feature Description)

**探店连续衔接节点**：`WORKFLOW_NODES.douyinWorkbench.storeVisitContinuity` 登记为 `store-visit-continuity`，后台显示「思考」，类型为 `llm`。应指定支持看图的视觉语言模型，用于理解实际播放尾帧、原始场景和人物身份，结合下一段台词规划衔接；未单独配置时按现有文本节点规则回退默认 LLM，默认模型也必须支持图片输入。

**节点目录写在代码里，只按能力分四类**：`WORKFLOW_MODEL_CATALOG` 每条工作流只登记思考（llm）、生图（image）、生视频（video）、音色克隆（audio）这几类节点，同一类的各个步骤共用一个节点，不再一步一个节点；后台只能为节点选模型，不能增删节点。新业务步骤直接用所属那一类的节点 key 取配置，不新增节点。`WORKFLOW_NODES` 里原来的步骤名保留为别名（例如 `storeVisitVideo`、`shotVideo` 都是 `video`），业务调用处不用改。

**旧节点合并**：合并前每个步骤一个节点（抖音 13 个、小红书 7 个）。服务启动时 `mergeLegacyBindings` 把旧设置并入新节点：新节点没有设置时按 `WORKFLOW_LEGACY_NODE_KEYS` 的顺序取第一个有设置的旧节点复制过去，已有设置不覆盖；旧记录留在 `workflow_node_models` 里（目录不再显示），回退时改回旧目录即可。合并的代价：一条工作流里各步骤只能用同一个模型（例如探店人物段与空镜段不能一个用可灵数字人、一个用 Seedance；分镜选图不能单独配快模型）。

**保存规则**：`PUT admin/workflow-models/:workflowKey/nodes/:nodeKey` 只接受已启用、且 `modelCategory` 与节点类型一致的提供商；模型留空时用该提供商记录里的默认模型，两者都没有则拒绝。同一提供商代码在不同类型下是不同记录（例如 PixMax 生图、PixMax 生视频各一条），与「Ai提供商设置」现有的 `providerCode + modelCategory` 唯一规则一致。`DELETE` 清除设置。四个接口都挂 `AiProvider` 权限（平台 AI 配置，仅超管）。

**可选模型（数眼智能）**：提供商代码为 `shuyan` 时，`GET .../providers/:providerId/models?category=` 用它的 Key 实时调 OpenAI 兼容的 `GET /v1/models`（New API 按 Key 所在分组返回，不消耗额度），再把每个模型判成文本 / 生图 / 生视频 / 向量 / 其他后按节点类型过滤。分类优先读 New API 的 `supported_endpoint_types`，老版本没有这个字段时按模型名兜底（`-video` / `-image` 优先于族名，所以 `jimeng-video-*` 与 `jimeng-image-*` 能分开；`minimax-h*` 归生视频、`minimax-m*` 归文本），都不命中按文本模型处理。**新模型族上线后可能漏判**，所以返回 `allowCustom: true`，页面在下拉之外保留手填框可以纠正；规则在 `shuyan-model-catalog.ts` 的 `*_PATTERNS` 里补。向量与音频模型不对应任何节点类型，三份列表都不会出现。

**可选模型（PixMax）**：提供商代码为 `pixmax` 时，`GET .../providers/:providerId/models?category=` 用它的 Key 实时调 `POST /openapi/model/available`，按 `GENERATE_TEXT / GENERATE_IMAGE / GENERATE_VIDEO` 过滤后返回，页面只能从列表里选；其他提供商返回其默认模型并允许手填。

**运行时解析**：`resolveNodeRuntime` 没有设置时返回 `null`，业务照旧用默认提供商；设置的提供商被删除或停用时记警告并回退默认；类型不符或 `WORKFLOW_RUNTIME_SUPPORT` 判定运行时不支持（例如为生图节点选了 PixMax）时抛 `WORKFLOW_NODE_PROVIDER_NOT_SUPPORTED:<类型>:<提供商>`，不静默换模型。后台允许先保存这类组合并标注「运行时暂不支持」，等对应调用接入后再把提供商加入支持矩阵。数眼智能（`shuyan` / `shuyanai`）已接入文本、生图与 Seedance / MiniMax-H3 生视频：生图由 `AgentService.generateImageByRuntime` 调 `/v1/images/generations`；生视频由抖音工作台的 `DouyinShuyanVideoService` 按型号调 `/seedance/api/v3/contents/generations/tasks` 或 `/hailuo/v2/video_generation`。数眼里的 Kling / Vidu / 旧版 Hailuo / 即梦等视频族仍需各自原生路由，当前选择这些型号会明确报 `SHUYAN_VIDEO_MODEL_NOT_SUPPORTED`。

**当前接入情况（小红书图文）**：`think` 覆盖选题候选与子选题提示词推荐（`xhs-topic.service`）、写文章的首次生文与重写、与写正文并行的配图标签决策（`xhs-article-generation.service`）、图组封面主副标题（`canvas-image-group.service`）；`image` 覆盖 `ai-direct` 封面底图与灵感画布封面重绘、`ai-overlay` 文字海报素材层、灵感画布内页重绘。封面文案、AI 封面原本失败就回退的地方仍按原逻辑回退。

**当前接入情况（抖音视频制作）**：`think` 覆盖候选脚本、生成要求、发布文案、分镜拆解、图库选图、探店编排与台词、场景图库归类、尾帧衔接（后两者看图，要选视觉语言模型）；`image` 覆盖分镜画面、人物形象图、探店人物首帧，指定后出图失败直接报错。`video` 覆盖分镜视频、整片视频与探店空镜 / 人物段：分镜 / 整片指定 PixMax 走 PixMax，指定数眼智能或自建 MiniMax-H3（opensource-video，见 [opensource-video 模块](../opensource-video/module.md)）走对应通道，未指定时走既有直连服务；探店只支持数眼智能（Seedance、MiniMax-H3、wan2.7-i2v、kling-avatar）与自建 MiniMax-H3（参考生视频），其他提供商在探店里提示改选。`voice` 只接受阿里云百炼 dashscope（录音克隆模型填 cosyvoice-v3.5-plus，系统音色固定 cosyvoice-v3-flash），未指定时探店不能克隆音色与配音。原通用数字人服务 digital-human 与声音设计节点 voice-design 已下线。

**后台页面**：「工作流节点模型」Tab 左侧是工作流子菜单（显示节点数与已指定数，记住上次选择），右侧是选中工作流的全部模型节点设置。单测 `workflow-model.service.spec.ts` 校验 `WORKFLOW_NODES` 与目录逐项一致。

**音色类型与节点级提供商**：WorkflowNodeCategory.audio 对应 Ai 提供商的 modelCategory=audio（后台「音色模型」类别），当前只有阿里云百炼。默认回退、模型查询与保存校验都按它处理（PixMax 映射 GENERATE_AUDIO，数眼目录不出 audio 模型）。节点 runtimeProviders 白名单优先于类型矩阵，list 与 resolveNodeRuntime 都传节点白名单：voice-clone 只收 dashscope，store-visit-video 与 store-visit-avatar 只收 shuyan / shuyanai。unsetHint 在探店三个节点未指定时分别显示不可用说明。

**探店场景归类与编排推荐节点**：`WORKFLOW_NODES.douyinWorkbench.storeVisitScene` 登记为 `store-visit-scene`（后台显示「思考」，`llm`），场景图库 AI 归类用它看图把同一点位的图片归在一起、写描述并打精细度分，应指定支持看图的视觉语言模型；`storeVisitPlanner` 登记为 `store-visit-planner`（「思考」，`llm`），探店脚本先行用它看引用知识写分段脚本并定出镜人物与音色、对照引用知识自检、按脚本从门店点位配图，以及按脚本推荐人物音色。两者未单独配置时都按文本节点规则回退默认 LLM。
