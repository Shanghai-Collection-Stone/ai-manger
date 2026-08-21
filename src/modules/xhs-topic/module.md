# 模块名称 (Module Name)

小红书 AI 选题生成模块（xhs-topic）

## 概述 (Overview)

提供母选题与子选题候选生成、真实选题列表、文章生成、批量入库和级联删除接口。候选与文章生成都先创建 Todo；选题 Agent 只通过工具逐项写入候选，文章 Agent 只通过工具分别设置标题、正文、文章标签并从真实图库标签中选择相关配图标签，模型最终文本均不参与结果解析。文章内存完整校验后，复用既有生文图片阶段按相关标签生成无字封面底图、五张内页、动态拼图与可选 AI 封面底图；小红书专家的 `ai-overlay` 封面可通过 `coverStyle` 选择素材风格预设或传 `random` 随机，并把生成出的透明文字海报层以 `ai素材` 标签同步入图库，同时把封面文案保存为灵感画布可编辑图层元数据，最终将文章与完整图组一并写入对应子选题的 `article` 字段。Agent 可按需使用已配置的 DuckDuckGo MCP 搜索工具，默认提示词强制执行法律、平台与高风险内容合规边界。

## 文件清单 (File List)

- `xhs-topic.module.ts` — NestJS 模块入口，装配后台鉴权、Agent、MCP、Todo、Canvas 生文配图、图库与选题服务。
- `controller/xhs-topic.controller.ts` — 小红书选题生成 HTTP 接口与权限声明。
- `controller/xhs-topic.dto.ts` — 生成层级、提示词、母选题、数量与检索开关校验。
- `entities/xhs-topic.entity.ts` — 选题候选、数据库实体、母子列表、生成输入、Todo 结果与接口响应类型。
- `services/xhs-topic-repository.service.ts` — MongoDB 索引、真实母子选题列表（已存入文章库的子题不再返回）、批量入库和级联删除。
- `services/xhs-article-generation.service.ts` — 文章 Todo、Agent 内存文章工具、真实图库标签选择、Duck 搜索、生文图组工作流与文章落库。
- `services/xhs-topic.service.ts` — Todo 生命周期、数量解析、Agent 工具写入、Duck 搜索筛选与结果持久化。

## 函数清单 (Function List)

- `GenerateXhsTopicDto({ kind, prompt?, parentTopic?, count?, useSearch? })` — 校验母选题或子选题生成请求 | keywords: 选题生成参数, 提示词数量, topic-generation-dto, prompt-quantity
- `RecommendXhsTopicPromptDto({ parentTopic })` — 校验根据母题推荐子选题提示词的请求 | keywords: 子选题提示词推荐, 母题上下文, child-topic-prompt-recommendation, parent-topic-context
- `PersistXhsTopicCandidateDto({ title, topicType })` — 校验用户确认入库的单条候选 | keywords: 保存选题候选, 题目类型, persist-topic-candidate, topic-type
- `CreateXhsTopicsDto({ kind, parentId?, sourceTodoId?, candidates })` — 校验批量保存母题或子题请求 | keywords: 批量保存选题, 数据库存储, create-topics-dto, database-storage
- `DeleteXhsTopicsDto({ ids })` — 校验批量和级联删除请求 | keywords: 批量删除选题, 级联删除, delete-topics-dto, cascade-delete
- `UpdateXhsTopicDto({ title?, topicType?, status? })` — 校验真实选题内容或状态更新 | keywords: 更新真实选题, 选题状态, update-persisted-topic, topic-status
- `GenerateXhsArticleDto({ prompt?, useSearch?, dedup?, coverStyle?, regenerateImages? })` — 校验真实文章生成请求、配图去重、封面风格预设及重新配图规则 | keywords: 文章生成参数, 文章提示词, article-generation-dto, article-prompt
- `XhsArticleCanvasCollageCellDto({ src, imageId?, x, y, width, height, objectFit? })` — 校验拼图画布格式里的单个源图格子 | keywords: 拼图画布格式, 拼图格子, collage-canvas-format, collage-cell
- `XhsArticleCanvasCollageDto({ width, height, cells })` — 校验拼图画布格式的画布尺寸与 2-4 个源图格子 | keywords: 拼图画布格式, 可换图拼图, collage-canvas-format, swappable-collage
- `XhsArticleCanvasMaterialDto({ id, name, src, materialSrc, x, y, width, height, canvasWidth, canvasHeight, includesText?, effect? })` — 校验与照片分离、可回改特效并可标记已融合文字的海报素材层 | keywords: 可编辑装饰素材, 图层分离, editable-decoration-material, separated-layers
- `XhsArticleCanvasBoardDto({ imageIndex, kind, title?, subtitle?, baseSrc?, materials?, collage? })` — 校验独立底图、素材、文字与拼图画板元数据 | keywords: 文章画板, 可编辑封面, 图层分离, article-canvas-board, editable-cover, separated-layers
- `UpdateXhsArticleDto({ title?, body?, tags?, images?, canvasBoards?, contentType? })` — 校验真实文章、配图与结构化画板编辑请求 | keywords: 编辑文章参数, 真实配图, update-article-dto, persisted-images
- `XHS_TOPIC_COMPLIANCE_PROMPT()` — 定义候选生成的法律、平台、真实性与高风险内容边界 | keywords: 合规提示词, 选题安全, compliance-prompt, topic-safety
- `resolveRequestedTopicCount(prompt, explicitCount, kind)` — 优先使用显式数量，否则从提示词解析并限制候选数 | keywords: 解析选题数量, 提示词数量, resolve-topic-count, prompt-quantity
- `XhsTopicService({ agentService, mcpAdapters, todoService })` — 编排工具写入内存候选并持久化 Todo | keywords: 选题生成服务, 内存候选, topic-generation-service, in-memory-candidates
- `XhsTopicService.recommendPrompt(parentTopicInput, scope)` — 根据母题生成可编辑的子选题提示词并提供稳定回退模板 | keywords: 推荐子选题提示词, 母题上下文, recommend-child-topic-prompt, parent-topic-context
- `XhsTopicService.generate(input, scope)` — 创建 Todo、执行 Agent 并返回写入 taskResult 的候选 | keywords: 生成选题候选, 待办结果, generate-topic-candidates, todo-result
- `XhsTopicService.createCandidateTool(candidates, requestedCount)` — 创建标题和题目类型的逐项内存追加工具 | keywords: 追加候选工具, 内存写入, candidate-append-tool, memory-write
- `XhsTopicService.getDuckSearchTools()` — 按 `ddg-search` 服务名隔离读取 DuckDuckGo MCP 工具 | keywords: Duck搜索工具, 搜索筛选, duck-search-tools, tool-filter
- `XhsTopicService.buildSystemPrompt(input)` — 构造合规、检索与工具交付约束 | keywords: 构造选题提示词, 工具交付约束, build-topic-prompt, tool-delivery-contract
- `XhsTopicService.runAgent(system, tools, remainingCount)` — 执行 Agent 并忽略其最终文本 | keywords: 执行选题Agent, 忽略最终文本, run-topic-agent, ignore-final-text
- `XhsTopicRepositoryService({ db })` — 管理租户用户隔离的 MongoDB 选题集合 | keywords: 选题数据库服务, 租户隔离, topic-repository, tenant-isolation
- `XhsTopicRepositoryService.ensureIndexes()` — 创建业务 ID、作用域及父子关系索引 | keywords: 选题索引, 父子关系, topic-indexes, parent-child-relation
- `XhsTopicRepositoryService.listStoredArticleTopicIds(scope, topicIds)` — 在给定子选题里挑出已存入文章库的那些 ID，按选题 ID 反查而不按 userId 关联 | keywords: 已入库子选题, 文章库来源, stored-topic-ids, article-library-source
- `XhsTopicRepositoryService.listWorkspace(scope)` — 聚合当前用户的真实母题与尚未存入文章库的子题列表 | keywords: 读取选题工作台, 母子聚合, list-topic-workspace, parent-child-aggregation
- `XhsTopicRepositoryService.createMany(input, scope)` — 批量保存候选并校验父题归属，同名去重只比对仍留在工作台的选题 | keywords: 批量创建选题, 父题校验, 已入库子选题, create-topics, parent-validation, stored-topic-ids
- `XhsTopicRepositoryService.getOwnedTopic(id, scope)` — 按作用域读取文章生成所需真实选题 | keywords: 读取真实选题, 文章生成上下文, get-owned-topic, article-generation-context
- `XhsTopicRepositoryService.saveGeneratedArticle(id, article, scope)` — 将完整内存文章写入子选题 | keywords: 保存生成文章, 文章落库, save-generated-article, persist-article
- `XhsTopicRepositoryService.updateArticle(id, input, scope)` — 更新已生成文章内容、真实配图与结构化画板元数据 | keywords: 更新真实文章, 文章配图, update-persisted-article, article-images
- `XhsTopicRepositoryService.normalizeCanvasCollage(collage?)` — 归一化画板里的拼图画布格式，过滤空地址与非法尺寸格子，不足两格视为普通单图 | keywords: 拼图画布格式, 可换图拼图, collage-canvas-format, swappable-collage
- `XhsTopicRepositoryService.deleteMany(ids, scope)` — 删除选题并级联子题 | keywords: 删除选题, 级联子题, delete-topics, cascade-children
- `XhsTopicRepositoryService.update(id, input, scope)` — 更新标题、类型或发布状态 | keywords: 更新选题, 发布状态, update-topic, publish-status
- `XhsTopicRepositoryService.nextIds(count)` — 校准计数器并批量分配选题业务 ID | keywords: 批量选题业务ID, 自增计数器, allocate-topic-ids, sequence-counter
- `XhsTopicRepositoryService.ensureCounterAtLeast(sequence)` — 将计数器校准到已有最大业务 ID | keywords: 选题计数器校准, 业务ID防冲突, topic-counter-calibration, id-collision-guard
- `XhsTopicRepositoryService.buildScopeFilter(scope)` — 构造租户用户隔离条件，并兼容无租户数据的 null 与缺失字段 | keywords: 查询作用域, 用户隔离, scope-filter, user-isolation
- `XhsTopicRepositoryService.normalizeStringList(values, maximumItems, maximumLength)` — 规整文章标签或图片列表并去重截断 | keywords: 规整文章列表, 去重截断, normalize-article-list, deduplicate-values
- `XhsTopicRepositoryService.toChildView(entity)` — 转换子题数据库实体为接口结构 | keywords: 子选题转换, 接口视图, child-topic-view, api-view
- `XhsArticleGenerationService({ agentService, mcpAdapters, todoService, repository, galleryService, canvasService })` — 编排工具写入内存、真实图库标签选择与生文图组工作流 | keywords: 文章生成服务, 内存文章, article-generation-service, in-memory-article
- `XHS_ARTICLE_ERROR_MESSAGES` — 文章生成失败码与前端可读中文原因的对照表 | keywords: 文章生成错误码, 失败原因文案, article-error-code, failure-reason-text
- `XHS_ARTICLE_TODO_RESOURCE_TYPE` — 生成 Todo 绑定子选题时使用的资源类型 | keywords: 生成任务关联资源, 子选题归位, generation-todo-resource, topic-binding
- `XHS_ARTICLE_RUNTIME_MISS_LIMIT` — 定义持久化运行态缺失真实执行实例时的连续确认次数 | keywords: 异步存活确认, 连续查询, async-liveness-confirmation, consecutive-polls
- `describeXhsArticleError(code, detail?)` — 把失败码翻译成可直接展示的中文原因，未知码回退为原始码 | keywords: 失败原因文案, 错误码翻译, failure-reason-text, error-code-translate
- `XhsArticleGenerationError(code, detail?)` — 携带失败码与明细的文章生成错误，供接口层原样抛给前端 | keywords: 文章生成错误, 失败码, article-generation-error, failure-code
- `XhsArticleGenerationService.start(topicId, input, scope)` — 创建运行中的 Todo 后立即返回，并把缺省不去重的配图规则传入后台任务 | keywords: 异步生成文章, 后台任务, 并发生成, start-article-generation, background-task, concurrent-generation
- `XhsArticleGenerationService.runGeneration(params)` — 后台执行文章全流程，按请求保留或重新生成配图，并把结果回写 Todo | keywords: 后台生成文章, 待办回写, run-article-generation, todo-writeback
- `XhsArticleGenerationService.listGenerations(scope)` — 汇总最近生成状态，并通过持久化 Todo 与当前进程执行集合双重确认，连续两次缺失后收敛陈旧运行态 | keywords: 文章生成状态, 逐条进度, 异步存活确认, article-generation-state, per-topic-progress, async-liveness-confirmation
- `XhsArticleGenerationService.isRuntimeGenerationActive(scope,topicId)` — 确认子选题是否仍由当前服务进程实际执行 | keywords: 运行实例确认, 异步存活确认, runtime-instance-check, async-liveness-confirmation
- `XhsArticleGenerationService.buildRuntimeConfirmationKey(scope,topicId)` — 构造租户用户及子选题隔离的连续存活确认键 | keywords: 存活确认键, 租户隔离, liveness-confirmation-key, tenant-isolation
- `XhsArticleGenerationService.readTodoTopicId(todo)` — 从 Todo 关联资源读取对应子选题 ID | keywords: 生成任务关联资源, 子选题归位, generation-todo-resource, topic-binding
- `XhsArticleGenerationService.readTodoErrorCode(todo)` — 从 Todo 结果解析文章生成失败码 | keywords: 失败码, 待办结果解析, failure-code, task-result-parse
- `XhsArticleGenerationService.createCurrentArticleReadTool(article, state)` — 创建强制读取当前标题、正文、标签、配图与发布形式的 Agent 工具 | keywords: 读取当前文章, 文章改写上下文, read-current-article, article-rewrite-context
- `XhsArticleGenerationService.createArticleMemoryTool(draft, availableImageTags)` — 创建标题、正文、文章标签和真实图库标签的内存调整工具 | keywords: 文章调整工具, 内存写入, article-memory-tool, memory-write
- `XhsArticleGenerationService.buildSystemPrompt(input)` — 构造文章合规、搜索、重新匹配图库和工具交付提示词 | keywords: 构造文章提示词, 工具交付约束, build-article-prompt, tool-delivery-contract
- `XhsArticleGenerationService.runAgent(system, tools, draft)` — 执行文章 Agent 并忽略最终文本 | keywords: 执行文章Agent, 忽略最终文本, run-article-agent, ignore-final-text
- `XhsArticleGenerationService.isArticleComplete(draft, requireImageTags)` — 校验标题、正文、文章标签，并仅在首次配图时要求图库标签 | keywords: 校验文章完整性, 内存文章, validate-article-completeness, in-memory-article
- `XhsArticleGenerationService.generateArticleImagesByWorkflow(input, scope)` — 按去重与封面风格规则生成图片组，并把合成封面拆成原照片与已融合文字的独立海报素材画板元数据 | keywords: 生文配图工作流, 可编辑封面, article-image-workflow, editable-cover
- `XhsArticleGenerationService.toCanvasBoardCollage(collage?)` — 把图组拼图的画布格式转成文章画板元数据，源图格子随文章持久化 | keywords: 拼图画布格式, 可换图拼图, collage-canvas-format, swappable-collage
- `XhsArticleGenerationService.buildResult(topicId, article, searchEnabled, searchAvailable)` — 构造可写入 Todo 的文章结果 | keywords: 构造文章结果, 日期序列化, build-article-result, serialize-dates
- `XhsTopicController({ xhsTopicService, articleGenerationService, repository })` — 暴露带后台鉴权的选题、真实文章生成与持久化接口 | keywords: 小红书选题接口, 待办返回, xhs-topic-controller, todo-response
- `XhsTopicController.recommendPrompt(req, dto)` — 返回基于当前母题的可编辑子选题推荐提示词 | keywords: 推荐子选题提示词, 母题上下文, recommend-child-topic-prompt, parent-topic-context
- `XhsTopicController.list(req)` — 返回真实母子选题工作台 | keywords: 查询真实选题, 母子列表, list-persisted-topics, workspace-list
- `XhsTopicController.create(req, dto)` — 批量入库所选候选并返回真实列表 | keywords: 保存真实选题, 批量创建, persist-selected-topics, bulk-create
- `XhsTopicController.remove(req, dto)` — 批量删除选题并级联子题 | keywords: 删除真实选题, 级联删除, delete-persisted-topics, cascade-delete
- `XhsTopicController.update(req, id, dto)` — 修改真实选题及状态 | keywords: 更新真实选题, 发布状态, update-persisted-topic, publish-status
- `XhsTopicController.listArticleGenerations(req)` — 返回每个子选题最近一次文章生成进度与失败原因 | keywords: 文章生成状态接口, 逐条进度, article-generation-state-api, per-topic-progress
- `XhsTopicController.generateArticle(req, id, dto)` — 异步启动文章生成并立即返回运行中的 Todo | keywords: 生成真实文章接口, 异步生成文章, 并发生成, generate-persisted-article-api, start-article-generation, concurrent-generation
- `XhsTopicController.updateArticle(req, id, dto)` — 修改已生成文章与真实配图 | keywords: 更新真实文章接口, 文章配图, update-persisted-article-api, article-images
- `XhsTopicController.generate(req, dto)` — 生成候选并返回 taskResult 已落盘的 Todo | keywords: 生成选题接口, 待办结果, generate-topic-api, todo-result
- `XhsTopicController.requireUser(req)` — 读取当前后台用户并拒绝未鉴权请求 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `XhsTopicModule()` — 装配选题生成业务依赖 | keywords: 小红书选题模块, 选题生成, xhs-topic-module, topic-generation

## 关键词索引 (Keyword Index)

| 中文关键词       | English keyword                   | 定位                                                                                 |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| 小红书选题       | xhs-topic                         | 模块入口、控制器与业务服务                                                           |
| 生成选题候选     | generate-topic-candidates         | Agent 生成与 Todo 返回主流程                                                         |
| 内存候选         | in-memory-candidates              | Agent 工具逐项写入的运行态集合                                                       |
| 追加候选工具     | candidate-append-tool             | 标题和题目类型写入工具                                                               |
| 提示词数量       | prompt-quantity                   | 显式数量及“生成 20 个”“给我来 20 条”等自然语言数量解析                               |
| 子选题提示词推荐 | child-topic-prompt-recommendation | 根据当前母题生成可编辑的子选题创作提示词                                             |
| 合规提示词       | compliance-prompt                 | 默认法律和平台安全边界                                                               |
| Duck搜索工具     | duck-search-tools                 | DuckDuckGo MCP 工具筛选                                                              |
| 待办结果         | todo-result                       | taskResult 持久化与接口响应                                                          |
| 选题数据库服务   | topic-repository                  | `xhs_topics` 集合读写与租户用户隔离                                                  |
| 母子聚合         | parent-child-aggregation          | 真实母题与子题工作台列表                                                             |
| 已入库子选题     | stored-topic-ids                  | 已存入文章库的来源子选题，工作台列表与同名去重都会跳过                               |
| userId 口径差异  | user-id-mismatch                  | `xhs_topics.userId` 存后台用户 ObjectId，`articles.userId` 存用户名，两表不可用 userId 关联 |
| 文章库来源       | article-library-source            | articles 集合里 `source=xhs-topic` + `meta.xhsTopicId` 的入库记录                     |
| 批量入库         | bulk-persistence                  | 保存用户确认的候选                                                                   |
| 级联删除         | cascade-delete                    | 删除母题时同步删除所属子题                                                           |
| 内存文章         | in-memory-article                 | Agent 通过工具设置标题、正文并逐个追加标签                                           |
| 真实文章         | persisted-article                 | 子选题 article 字段与右侧详情数据源                                                  |
| 文章调整工具     | article-memory-tool               | `xhs_article_update_memory` 工具                                                     |
| 读取当前文章     | read-current-article              | `xhs_article_read_current` 工具与文章修改、重写前置协议                              |
| 文章落库         | persist-article                   | 完整性校验后统一持久化                                                               |
| 生文配图工作流   | article-image-workflow            | 相关图库标签取图、动态拼图、封面与可选 AI 生图                                       |
| 可编辑封面       | editable-cover                    | 无字封面底图与灵感画布主副标题图层元数据                                             |
| 装饰素材叠加     | decoration-overlay                | 小红书封面走 `ai-overlay`：AI 输出文字与装饰融合的绿幕海报素材，真实照片主体不被重绘 |
| 可编辑装饰素材   | editable-decoration-material      | 合成预览保留用于发布，画板另外保存原照片、透明素材、绿幕原图与特效参数               |
| 图层分离         | separated-layers                  | 照片与文字海报素材进入灵感画布后是独立对象，文字属于素材像素而非原生文字层           |
| 文章画板         | article-canvas-board              | 图片下标、封面/内页类型与可编辑文案的持久化结构                                      |
| 拼图画布格式     | collage-canvas-format             | 拼图画布尺寸与源图格子，进入灵感画布后拆成独立图层                                   |
| 可换图拼图       | swappable-collage                 | 拼图里的每张源图都能在画布上单独替换                                                 |
| 文章生成错误码   | article-error-code                | 失败码与中文原因对照表，接口层据此下发用户可读提示                                   |
| 失败原因文案     | failure-reason-text               | `describeXhsArticleError` 翻译出的中文失败原因                                        |
| 文章生成错误     | article-generation-error          | `XhsArticleGenerationError` 携带失败码与明细，配图不足时附带本次图库标签             |
| 异步存活确认     | async-liveness-confirmation        | 查询时同时核对 Todo 状态与当前进程执行集合，连续两次缺失后判定服务中断               |

## 类型导出 (Type Exports)

- `XhsTopicKind` — `mother` 或 `child` 选题层级。
- `XhsTopicCandidate` — 包含 `title` 与 `topicType` 的候选。
- `XhsTopicEntity` — MongoDB 中持久化的母题或子题。
- `XhsTopicStatus` — 真实选题的业务状态。
- `XhsArticleCanvasCollageCell` — 拼图内单张源图的格子（地址、图库 ID、坐标尺寸与填充方式）。
- `XhsArticleCanvasCollage` — 拼图画布格式：画布尺寸与 2-4 个源图格子。
- `XhsArticleCanvasMaterial` — 封面独立图片素材层，保留原素材、去底结果、坐标尺寸、特效参数与文字融合标记。
- `XhsArticleCanvasBoard` — 文章画板初始化元数据；支持独立底图、含字图片素材、旧版原生文字与拼图格子。
- `XhsTopicArticle` — 子选题持久化的真实文章、标签、图片与内容形式。
- `XhsTopicCreateInput` — 用户确认候选的批量入库输入。
- `XhsChildTopicView` — 子题接口列表结构。
- `XhsTopicWorkspaceGroup` — 母题及其子题的聚合结构。
- `XhsTopicGenerateInput` — 服务层标准生成输入。
- `XhsArticleUpdateInput` — 已生成文章编辑输入。
- `XhsArticleMemoryDraft` — Agent 工具在单次运行中调整的文章内存，含文章标签与真实图库配图标签。
- `XhsArticleGenerateInput` — 真实文章生成输入，包含配图去重、素材风格库封面预设和可选的整组配图重新生成开关。
- `XhsArticleGenerationResult` — 写入 Todo `taskResult` 的文章生成结果。
- `XhsArticleGenerationState` — 单个子选题最近一次文章生成任务的运行、完成或失败状态。
- `XhsTopicGenerationResult` — 写入 Todo `taskResult` 的结果结构。
- `XhsTopicGenerateResponse` — 服务内部携带 Todo 与生成结果的响应，控制器仅输出 Todo。

## 模块功能描述 (Module Feature Description)

`POST /api/xhs-topic/generate` 以 `create XhsTopic` 权限接收选题层级、提示词、可选母选题、可选数量和搜索开关。服务从显式参数或提示词解析目标数量，创建运行 Todo 后将内存追加工具与 DuckDuckGo 检索工具交给 Agent。每条候选都必须通过 `xhs_topic_add_candidate` 写入，包含题目和题目类型；最终回答被忽略。服务最多补跑一次缺失候选，数量准确时将最终内存集合序列化到 Todo `taskResult`，更新状态为 `done` 并只返回 Todo；仍不足或运行异常时将已有候选与错误写入 `failed` Todo 并同样返回。

`POST /api/xhs-topic/prompt/recommend` 根据当前母题调用 AI 返回一条可编辑的子选题生成提示词，失败时使用包含数量、差异化角度、内容价值和标题风格的稳定模板回退。入口与选题生成一样声明 `create XhsTopic` 权限。

`POST /api/xhs-topic/:id/article/generate` 同时承担首次生成与已有文章改写。接口创建 `in_progress` Todo 后立即返回，Agent、配图和落库流程在后台继续执行；不同子选题互不阻塞并可同时生成，同一子选题在当前运行实例内拒绝重复启动。服务预载已保存文章，并强制 Agent 首先调用 `xhs_article_read_current` 读取标题、正文、标签、配图和发布形式，再根据用户提示词做局部修改或完全重写；所有变更仍必须经 `xhs_article_update_memory` 写入。改写默认保留现有图片和画板数据，因此不再依赖图库标签；首次生成或没有现有图组时才要求选择真实图库标签并调用 Canvas 生文图片阶段生成一张封面和五张内页。租户开启 AI 封面时走 `ai-overlay`：模型生成纯绿实底、指定主副标题与波普装饰融合的文字海报素材，真实照片不传给模型；sharp 输出合成预览和透明 PNG 素材，`canvasBoards` 另外保存 `baseSrc` 原照片以及带 `includesText` 标记的 `materials` 素材原图/去底图/特效参数。文章预览与发布继续使用合成封面，进入灵感画布后则还原成照片和含字图片素材两个独立图层；素材可移动、缩放、隐藏或重开图片特效。完整文章落库后状态才变为 `generated`。后台失败会把失败码写进 Todo `taskResult.error`，把中文原因写进 `taskResult.errorMessage` 与 `abnormalReason`。前端通过 `GET /api/xhs-topic/article/generations` 轮询每个子选题最近一次任务；查询同时读取 Todo 持久化状态并核对当前进程 `runningTopics`，若数据库仍显示运行但进程内任务已不存在，第一次仅记录疑似中断，连续第二次确认仍缺失后才将 Todo 改为 `failed`，错误码为 `XHS_ARTICLE_GENERATION_INTERRUPTED`。正常运行任务每次都能通过运行实例确认，不会被误清理；服务重启遗留的陈旧状态也不会永久显示“生成中”。配图阶段的 `XHS_ARTICLE_IMAGE_WORKFLOW_INSUFFICIENT` 会附带本次使用的图库标签，便于用户判断该补哪些标签的图。

`GET /api/xhs-topic` 从 `xhs_topics` 返回当前租户用户的母子选题工作台，并通过 `articles.source=xhs-topic` 与 `meta.xhsTopicId` 过滤已经存入选题文章库的子题；历史已入库文章同样生效，库内文章删除后对应子题会重新出现。无租户账号同时兼容历史缺失字段与 MongoDB 序列化的 `null`；`POST /api/xhs-topic` 将用户确认的候选批量入库并返回最新工作台；`PATCH /api/xhs-topic/:id` 更新标题、类型或状态；`DELETE /api/xhs-topic` 删除当前用户指定选题，母题命中时级联删除所有子题。入口分别声明 `read/create/update/delete XhsTopic` 权限。
