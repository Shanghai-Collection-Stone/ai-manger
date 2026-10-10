# 模块名称 (Module Name)

小红书 AI 选题生成模块（xhs-topic）

## 概述 (Overview)

提供母选题与子选题候选生成、真实选题列表、文章生成、批量入库和级联删除接口。母选题可持久化最多五个 `imageTags` 与一个配图规则 `imageRule`（`default` 拼图:单图 5:1 且单图排最后 / `collage-first` 全拼图 / `portrait-first` 全竖图），创建与更新后由工作台列表原样返回；该母题下首次生成或重新生成配图时，服务端会校验这些标签仍存在于真实图库、限制 Agent 的可选标签范围，并在进入配图工作流前重新锁定固定标签，空数组才沿用原有自动匹配链路。子选题可持久化最多 500 字的 `articleStyle`：生成子题时约束标题、视角与内容结构，保存后在首次生文及重写时继续注入文章 Agent。候选与文章生成都先创建 Todo；选题 Agent 只通过工具逐项写入候选；文章一次交付标题、正文与文章标签（有搜索时是轻量 Agent 的 `xhs_article_submit` 工具，无搜索时是结构化输出），配图标签由关闭思考的配图决策与写正文并行选出，模型最终文本均不参与结果解析。文章完整校验后，复用既有生文图片阶段按相关标签生成封面、五张内页、动态拼图与可选 AI 封面底图，拼图与单图配比严格按所属母题的 `imageRule` 对应版式（`XHS_MOTHER_IMAGE_RULE_LAYOUT`），凑不齐时不悄悄换版式，而是抛回 `XHS_ARTICLE_LANDSCAPE_INSUFFICIENT`（横图太少，可改用竖图或允许重复）/ `XHS_ARTICLE_PORTRAIT_INSUFFICIENT`（竖图太少，可改用拼图或允许重复），前端据此重试时带本次的 `imageRule` 覆盖或 `allowImageRepeat`；母题锁定标签时这一检查在扣费和 Agent 运行之前完成。取图默认「优先不重复」（先用没用过的图，不够再复用已用图），只有请求显式 `dedup: true` 才严格去重，`allowImageRepeat` 会覆盖严格去重并放开本篇内轮换复用；小红书专家的 `ai-overlay` 封面可通过 `coverStyle` 选择素材风格预设或传 `random` 随机，并把生成出的透明文字海报层以 `ai素材` 标签同步入图库，同时把封面文案保存为灵感画布可编辑图层元数据，最终将文章与完整图组一并写入对应子选题的 `article` 字段。Agent 可按需使用已配置的 DuckDuckGo MCP 搜索工具，默认提示词强制执行法律、平台与高风险内容合规边界。

**引用知识**：母选题可保存最多 10 个 `knowledgeIds`（[knowledge](../knowledge/module.md) 模块的知识条目，创建与 `PATCH` 都可改，传空数组清空，工作台列表原样返回）。生成子选题时前端在 `GenerateXhsTopicDto.knowledgeIds` 里带上母题的引用，`XhsTopicService` 调 `KnowledgeService.buildPromptSection` 把知识拼成 `<reference_knowledge>` 段放在用户要求之后；文章生成时 `XhsArticleGenerationService` 直接读母题 `knowledgeIds` 注入同样的段落。已删除或跨租户的知识自动跳过，没有可用知识时提示词不变。

## 文件清单 (File List)

- `xhs-topic.module.ts` — NestJS 模块入口，装配后台鉴权、Agent、MCP、Todo、Canvas 生文配图、图库、文章库、工作流节点模型与选题服务。
- `controller/xhs-topic.controller.ts` — 小红书选题生成 HTTP 接口、租户清理设置接口与权限声明。
- `controller/xhs-topic.dto.ts` — 生成层级、提示词、生成需求候选项、母选题、文章生成风格、母题配图标签与配图规则、数量与检索开关、租户清理设置校验。
- `entities/xhs-topic.entity.ts` — 选题候选、数据库实体、文章生成风格、母题配图标签、母题配图规则及合法取值、母子列表、生成输入、Todo 结果与接口响应类型。
- `entities/xhs-topic-cleanup-settings.entity.ts` — 租户清理设置的清理对象、单类规则（开关 / 保留天数 / 数量上限）与集合文档类型。
- `xhs-topic-retention.constants.ts` — 三类内容的平台默认清理设置、天数与数量取值范围、设置归一化、租户作用域键、到期时间计算与超出数量上限的挑选。
- `services/xhs-topic-cleanup-settings.service.ts` — `xhs_topic_cleanup_settings` 集合读写：按租户读取、合并保存与每日清理批量读取。
- `xhs-article-collage-key.ts` — 拼图成品指纹（与工作台 `articleCanvasBoard.js` 同算法），保存到文章库时据此跳过没改过的拼图页。
- `services/xhs-topic-repository.service.ts` — MongoDB 索引、真实母子选题列表（已存入文章库的子题不再返回）、文章生成风格与母题配图标签/配图规则持久化、批量入库和级联删除。
- `services/xhs-article-generation.service.ts` — 文章 Todo、文章通道排队、一次交付文章（轻量 Agent + 搜索 / 结构化输出）、与写正文并行的配图决策和源图分配、子题文章风格、母题配图约束、母题配图规则版式、扣费前配图预检、生成失败退点、横/竖图太少抛回、优先不重复与允许重复取图、Duck 搜索、生文图组工作流与文章落库。
- `services/xhs-article-generation-progress.ts` — 生文阶段产出写入器：先写好的正文与逐张就绪的配图合并写进运行中 Todo，关闭后不再写。
- `services/xhs-topic-cleanup.service.ts` — 历史清理时钟回填，以及每日按各租户设置执行的文章库已发布文章、子题草稿与闲置母题幂等清理。
- `services/xhs-topic.service.ts` — Todo 生命周期、数量解析、生成需求一键推荐、Agent 工具写入、Duck 搜索筛选与结果持久化。

## 函数清单 (Function List)

- `GenerateXhsTopicDto({ kind, prompt?, parentTopic?, articleStyle?, count?, useSearch? })` — 校验母选题或带文章生成风格的子选题生成请求，`prompt` 上限 5000 字（前端拼入文章风格与社会热点说明后一起提交）、`parentTopic` 200 字、`articleStyle` 500 字 | keywords: 选题生成参数, 提示词数量, 文章生成风格, topic-generation-dto, prompt-quantity, article-writing-style
- `RecommendXhsTopicPromptDto({ parentTopic })` — 校验根据母题推荐子选题提示词的请求 | keywords: 子选题提示词推荐, 母题上下文, child-topic-prompt-recommendation, parent-topic-context
- `RecommendXhsArticleRequirementsOptionsDto({ purposes, personas, styles, lengths })` — 校验生成需求推荐的四组候选项，每组 1 至 50 项且单项 1 至 20 字 | keywords: 生成需求选项, 推荐范围, requirement-options, recommendation-scope
- `RecommendXhsArticleRequirementsDto({ options })` — 校验指定子选题的一键生成需求推荐请求 | keywords: 一键推荐需求, 生成需求参数, requirement-recommendation, requirement-request
- `PersistXhsTopicCandidateDto({ title, topicType, imageTags?, imageRule?, knowledgeIds?, articleStyle? })` — 校验用户确认入库的单条候选、母题配图标签、配图规则与引用知识（最多 10 条 ObjectId）或子题文章生成风格 | keywords: 保存选题候选, 题目类型, 母题配图标签, 母题配图规则, 文章生成风格, persist-topic-candidate, topic-type, mother-image-tags, mother-image-rule, article-writing-style
- `CreateXhsTopicsDto({ kind, parentId?, sourceTodoId?, candidates })` — 校验批量保存母题或子题请求 | keywords: 批量保存选题, 数据库存储, create-topics-dto, database-storage
- `DeleteXhsTopicsDto({ ids })` — 校验批量和级联删除请求 | keywords: 批量删除选题, 级联删除, delete-topics-dto, cascade-delete
- `UpdateXhsTopicDto({ title?, topicType?, imageTags?, imageRule?, knowledgeIds?, articleStyle?, starred?, status? })` — 校验真实选题内容、状态、母题星标与引用知识或子题文章生成风格更新；子题传 `starred` 时忽略 | keywords: 更新真实选题, 选题状态, 母题星标, 文章生成风格, update-persisted-topic, topic-status, mother-topic-star, article-writing-style
- `XHS_TOPIC_IDLE_DEFAULT_DAYS` — 定义母题无活动且未受保护时的默认保留天数 | keywords: 母题闲置期限, 默认保留天数, topic-idle-retention, default-retention-days
- `XHS_DRAFT_RETENTION_DEFAULT_DAYS` — 定义未入文章库草稿文章的默认保留天数 | keywords: 草稿保留期限, 默认保留天数, draft-retention, default-retention-days
- `XHS_LIBRARY_RETENTION_DEFAULT_DAYS` — 文章库已发布文章的默认保留天数（该类默认关闭） | keywords: 文章库保留期限, 默认保留天数, library-article-retention, default-retention-days
- `XHS_CLEANUP_RETENTION_MAX_DAYS` — 租户可设置的最长保留天数 3650 | keywords: 保留天数上限, 清理设置校验, retention-days-limit, cleanup-settings-validation
- `XHS_CLEANUP_MAX_COUNT_LIMIT` — 租户可设置的最大数量上限值 100000 | keywords: 数量上限取值, 清理设置校验, max-count-limit, cleanup-settings-validation
- `XHS_CLEANUP_PLATFORM_SCOPE_KEY` — 无租户账号的清理设置键 `__platform__` | keywords: 平台作用域, 清理设置键, platform-scope, cleanup-scope-key
- `resolveRetentionDays(value, fallback)` — 读取正整数保留天数配置并让非法值回落默认值 | keywords: 保留天数配置, 非法值回落, retention-days-config, invalid-value-fallback
- `addRetentionDays(date, days)` — 计算接口展示与清理判断共用的到期时间 | keywords: 清理到期时间, 保留期限计算, cleanup-deadline, retention-deadline
- `resolveDefaultCleanupSettings(env?)` — 租户未保存设置时的平台默认值：母题与草稿开启并读环境变量天数，文章库关闭，数量不限 | keywords: 平台默认清理设置, 环境变量默认值, default-cleanup-settings, env-default-retention
- `normalizeCleanupSettings(input, fallback)` — 逐项校验三类清理规则，缺失或越界字段沿用回退值 | keywords: 清理设置归一化, 非法值回落, normalize-cleanup-settings, invalid-value-fallback
- `normalizeCleanupRule(input, fallback)` — 校验单条规则的开关、1 至 3650 天与 0 至 100000 条 | keywords: 清理规则校验, 非法值回落, normalize-cleanup-rule, invalid-value-fallback
- `xhsCleanupScopeKey(tenantId?)` — 租户 ID 转清理设置键，无租户归平台作用域 | keywords: 清理设置键, 平台作用域, cleanup-scope-key, platform-scope
- `selectCapacityOverflow({ candidates, total, maxCount, excluded, isEvictable, timeOf })` — 扣掉已按天数选中的条目后仍超出上限的部分，从可清理条目里按时间最早优先挑选 | keywords: 超出数量上限, 最早优先清理, select-capacity-overflow, oldest-first-eviction
- `XHS_CLEANUP_TARGETS` — 三类清理对象 `motherTopic` / `draftArticle` / `libraryArticle` | keywords: 清理对象, 租户清理设置, cleanup-target, tenant-cleanup-settings
- `XhsCleanupRuleDto({ enabled, retentionDays, maxCount })` — 校验单类清理规则，天数 1 至 3650、数量 0 至 100000 | keywords: 清理规则参数, 保留天数, 数量上限, cleanup-rule-dto, retention-days, max-count
- `UpdateXhsCleanupSettingsDto({ motherTopic?, draftArticle?, libraryArticle? })` — 校验租户保存清理设置请求，未传的清理对象保持原值 | keywords: 保存清理设置参数, 租户清理设置, update-cleanup-settings-dto, tenant-cleanup-settings
- `XhsTopicCleanupSettingsService({ db })` — 租户清理设置服务，未保存过时回落平台默认值 | keywords: 租户清理设置, 平台默认清理设置, tenant-cleanup-settings, default-cleanup-settings
- `XhsTopicCleanupSettingsService.ensureIndexes()` — 按租户作用域建唯一索引 | keywords: 清理设置索引, 租户唯一, cleanup-settings-index, unique-tenant-scope
- `XhsTopicCleanupSettingsService.defaults()` — 返回平台默认清理设置 | keywords: 平台默认清理设置, 环境变量默认值, default-cleanup-settings, env-default-retention
- `XhsTopicCleanupSettingsService.get(tenantId?)` — 读取租户清理设置并按默认值补齐 | keywords: 读取清理设置, 租户作用域, get-cleanup-settings, tenant-scope
- `XhsTopicCleanupSettingsService.save(tenantId, input, updatedBy)` — 合并保存租户清理设置并返回完整设置 | keywords: 保存清理设置, 部分更新, save-cleanup-settings, partial-update
- `XhsTopicCleanupSettingsService.loadAll()` — 一次读出全部租户清理设置供每日清理使用 | keywords: 批量读取清理设置, 每日清理, load-all-cleanup-settings, daily-cleanup
- `GenerateXhsArticleDto({ prompt?, useSearch?, dedup?, coverStyle?, regenerateImages?, imageRule?, allowImageRepeat? })` — 校验真实文章生成请求、配图去重（`true` 严格去重，缺省/`false` 优先不重复）、封面风格预设、重新配图，以及仅本次生效的配图规则覆盖与允许重复用图 | keywords: 文章生成参数, 文章提示词, article-generation-dto, article-prompt
- `XHS_MOTHER_IMAGE_RULES` — 母选题配图规则合法取值（`default` / `collage-first` / `portrait-first`），DTO 校验与仓储归一化共用 | keywords: 母题配图规则, 规则取值, mother-image-rule, image-rule-values
- `XhsArticleCanvasCollageCellDto({ src, imageId?, x, y, width, height, objectFit?, focusX?, focusY?, zoom? })` — 校验拼图画布格式里的单个源图格子及其裁切焦点与缩放参数 | keywords: 拼图格子, 裁切参数, collage-cell, crop-parameters
- `XhsArticleCanvasCollageDto({ width, height, cells })` — 校验拼图画布格式的画布尺寸与 2-4 个源图格子 | keywords: 拼图画布格式, 可换图拼图, collage-canvas-format, swappable-collage
- `XhsArticleCanvasMaterialDto({ id, name, src, materialSrc, x, y, width, height, canvasWidth, canvasHeight, includesText?, effect? })` — 校验与照片分离、可回改特效并可标记已融合文字的海报素材层 | keywords: 可编辑装饰素材, 图层分离, editable-decoration-material, separated-layers
- `XhsArticleCanvasEditorSizeDto({ width, height })` — 校验用户保存的灵感画布尺寸 | keywords: 画板编辑状态, 画板尺寸, canvas-editor-state, canvas-size
- `XhsArticleCanvasEditorStateDto({ version, template, size, layers })` — 校验灵感画布保存的模板、尺寸与有序图层结构 | keywords: 画板编辑状态, 图层结构, canvas-editor-state, layer-structure
- `XhsArticleCanvasBoardDto({ imageIndex, kind, title?, subtitle?, baseSrc?, materials?, collage?, editorState? })` — 校验生成态画板元数据或用户保存的完整编辑状态 | keywords: 文章画板, 画板编辑状态, 图层结构, article-canvas-board, canvas-editor-state, layer-structure
- `UpdateXhsArticleDto({ title?, body?, tags?, images?, canvasBoards?, contentType? })` — 校验真实文章、配图与结构化画板编辑请求 | keywords: 编辑文章参数, 真实配图, update-article-dto, persisted-images
- `XHS_TOPIC_COMPLIANCE_PROMPT()` — 定义候选生成的法律、平台、真实性与高风险内容边界 | keywords: 合规提示词, 选题安全, compliance-prompt, topic-safety
- `resolveRequestedTopicCount(prompt, explicitCount, kind)` — 优先使用显式数量，否则从提示词解析并限制候选数 | keywords: 解析选题数量, 提示词数量, resolve-topic-count, prompt-quantity
- `XhsTopicService({ agentService, mcpAdapters, todoService, workflowModels, repository })` — 编排模型推荐、工具写入内存候选并持久化 Todo | keywords: 选题生成服务, 内存候选, topic-generation-service, in-memory-candidates
- `XhsTopicService.recommendPrompt(parentTopicInput, scope)` — 根据母题生成可编辑的子选题提示词并提供稳定回退模板，模型取节点 `xhs-article/topic` | keywords: 推荐子选题提示词, 母题上下文, recommend-child-topic-prompt, parent-topic-context
- `XhsTopicService.recommendArticleRequirements(topicId, options, scope)` — 读取子题、母题与文章风格，调用 `xhs-article/topic` 节点推荐并安全过滤生成需求 | keywords: 生成需求推荐, 选项安全过滤, requirement-recommendation, option-safe-normalization
- `XhsTopicService.generate(input, scope)` — 创建 Todo、按文章风格执行 Agent 并返回写入 taskResult 的候选 | keywords: 生成选题候选, 待办结果, 文章生成风格, generate-topic-candidates, todo-result, article-writing-style
- `XhsTopicService.createCandidateTool(candidates, requestedCount, articleStyle?)` — 创建标题、题目类型和本轮文章风格的逐项内存追加工具 | keywords: 追加候选工具, 内存写入, 文章生成风格, candidate-append-tool, memory-write, article-writing-style
- `XhsTopicService.getDuckSearchTools()` — 按 `ddg-search` 服务名隔离读取 DuckDuckGo MCP 工具 | keywords: Duck搜索工具, 搜索筛选, duck-search-tools, tool-filter
- `XhsTopicService.buildSystemPrompt(input)` — 构造文章风格、合规、检索与工具交付约束 | keywords: 构造选题提示词, 工具交付约束, 文章生成风格, build-topic-prompt, tool-delivery-contract, article-writing-style
- `XhsTopicService.runAgent(system, tools, remainingCount, scope)` — 执行 Agent（模型取节点 `xhs-article/topic`）、按租户计费并忽略其最终文本 | keywords: 执行选题Agent, 忽略最终文本, run-topic-agent, ignore-final-text
- `XhsTopicRepositoryService({ db, cleanupSettings })` — 管理租户用户隔离的 MongoDB 选题集合，列表清理时间按租户清理设置计算 | keywords: 选题数据库服务, 租户隔离, topic-repository, tenant-isolation
- `XhsTopicRepositoryService.ensureIndexes()` — 创建业务 ID、作用域、父子关系及自动清理时钟索引 | keywords: 选题索引, 父子关系, 清理时钟, topic-indexes, parent-child-relation, cleanup-clock
- `XhsTopicRepositoryService.listStoredArticleTopicIds(scope, topicIds)` — 在给定子选题里挑出已存入文章库的那些 ID，按选题 ID 反查而不按 userId 关联 | keywords: 已入库子选题, 文章库来源, stored-topic-ids, article-library-source
- `XhsTopicRepositoryService.listWorkspace(scope,options?)` — 聚合当前用户的真实母题、固定配图标签与按需保留的已入库子题，`idleCleanupAt` / `draftCleanupAt` 按租户清理设置计算、关闭时为空 | keywords: 读取选题工作台, 母子聚合, 保留已入库子题, list-topic-workspace, parent-child-aggregation, include-stored-topics
- `XhsTopicRepositoryService.createMany(input, scope)` — 批量保存候选及子题文章风格并校验父题归属 | keywords: 批量创建选题, 父题校验, 文章生成风格, create-topics, parent-validation, article-writing-style
- `XhsTopicRepositoryService.getOwnedTopic(id, scope)` — 按作用域读取文章生成所需真实选题 | keywords: 读取真实选题, 文章生成上下文, get-owned-topic, article-generation-context
- `XhsTopicRepositoryService.saveGeneratedArticle(id, article, scope)` — 将完整内存文章写入子选题 | keywords: 保存生成文章, 文章落库, save-generated-article, persist-article
- `XhsTopicRepositoryService.updateArticle(id, input, scope)` — 更新已生成文章内容、真实配图与结构化画板元数据 | keywords: 更新真实文章, 文章配图, update-persisted-article, article-images
- `XhsTopicRepositoryService.touchDraft(id, scope)` — 重置文章从文章库回到草稿后的保留时钟 | keywords: 重置草稿时钟, 草稿保留期限, touch-draft-clock, draft-retention
- `XhsTopicRepositoryService.backfillCleanupTimestamps(now)` — 为历史母题和文章补齐清理时钟并给予完整宽限期 | keywords: 首次上线回填, 清理宽限期, cleanup-timestamp-backfill, retention-grace-period
- `XhsTopicRepositoryService.listTopicTenantIds()` — 列出存在选题的全部租户，无租户为 `undefined` | keywords: 选题租户列表, 逐租户清理, list-topic-tenants, per-tenant-cleanup
- `XhsTopicRepositoryService.listMotherCleanupUserIds(tenantId, cutoff?)` — 列出租户内需检查闲置母题的成员，传截止时间时只返回有过期母题的成员 | keywords: 母题清理成员, 过期闲置母题, mother-cleanup-users, expired-idle-topics
- `XhsTopicRepositoryService.listDraftCleanupUserIds(tenantId, cutoff?)` — 列出租户内需检查草稿的成员，传截止时间时只返回有过期草稿的成员 | keywords: 草稿清理成员, 过期文章草稿, draft-cleanup-users, expired-article-drafts
- `XhsTopicRepositoryService.listDraftTopics(scope)` — 列出成员名下仍保留文章的子题 | keywords: 成员草稿列表, 草稿时钟, list-member-drafts, draft-clock
- `XhsTopicRepositoryService.clearArticleAfterLibraryCleanup(topicId, tenantId, now)` — 文章库已发布文章被自动清理后清空来源子题文章并恢复未生成 | keywords: 文章库清理联动, 清空子题文章, library-cleanup-cascade, clear-child-article
- `XhsTopicRepositoryService.clearExpiredDraft(id, cutoff, now, scope)` — 幂等清空草稿时钟早于 `cutoff` 的文章并恢复未生成，期间被刷新过时钟的草稿不清 | keywords: 清理过期草稿, 幂等更新, clear-expired-draft, idempotent-update
- `XhsTopicRepositoryService.setCrawlStatus(id, status, scope)` — 切换子选题数据抓取开关，恢复时清空取消时间 | keywords: 切换抓取状态, 取消恢复抓取, toggle-crawl-status, cancel-resume-crawl
- `XhsTopicRepositoryService.markCrawlScheduled(id, at)` — 记录一次调度已建抓取任务，供频率节流 | keywords: 记录调度时间, 抓取频率节流, mark-crawl-scheduled, schedule-throttle
- `XhsTopicRepositoryService.markCrawled(id, at)` — 记录一次抓取成功回写数据的时间 | keywords: 记录抓取时间, 最后抓取, mark-crawled, last-crawled-at
- `XhsTopicRepositoryService.getChildTopicById(id)` — 按全局业务 ID 读取发布事件关联的子选题 | keywords: 发布选题解析, 内部选题读取, published-topic-resolve, internal-topic-read
- `XHS_MANUAL_LINK_TOPIC_TYPE` — 数据监控手动添加链接时独立子选题的题目类型（`手动链接`） | keywords: 手动链接选题, 题目类型, manual-link-topic, topic-type
- `XhsTopicRepositoryService.createManualLinkTopic(input, scope)` — 为手动添加的笔记链接建不挂母题、已发布且抓取中的独立子选题 | keywords: 手动链接选题, 独立子选题, manual-link-topic, standalone-child-topic
- `XhsTopicRepositoryService.listStandaloneChildren(scope)` — 列出当前用户不挂母题的独立子选题，供数据看板补齐抓取状态 | keywords: 独立子选题, 手动链接选题, standalone-child-topic, manual-link-topic
- `XhsTopicRepositoryService.normalizeCanvasCollage(collage?)` — 归一化画板里的拼图画布格式与裁切参数，过滤空地址与非法尺寸格子，不足两格视为普通单图；成品指纹 `renderedKey` 原样保留、不重算 | keywords: 拼图归一化, 裁切参数, collage-normalization, crop-parameters
- `computeXhsCollageRenderKey(collage)` — 计算拼图成品指纹（画布尺寸 + 每格地址、位置尺寸与焦点缩放） | keywords: 拼图指纹, 跳过重合成, collage-render-key, skip-recompose
- `hashCollageText(text)` — cyrb53 53 位字符串哈希，与工作台实现逐行一致 | keywords: 拼图指纹哈希, 前后端同算法, collage-key-hash, shared-hash-algorithm
- `canonicalNumber(value, digits?)` — 数值按固定小数位规范成文本，非法值记 0 | keywords: 拼图指纹, 数值规范化, collage-render-key, number-canonicalization
- `canonicalCrop(value, min, max, fallback)` — 裁切参数在范围内取两位小数，缺省或越界回落默认值 | keywords: 拼图指纹, 裁切参数, collage-render-key, crop-parameters
- `XhsTopicRepositoryService.deleteMany(ids, scope)` — 删除选题并级联子题 | keywords: 删除选题, 级联子题, delete-topics, cascade-children
- `XhsTopicRepositoryService.update(id, input, scope)` — 更新标题、类型、发布状态、母题配图标签与配图规则或子题文章生成风格 | keywords: 更新选题, 发布状态, 母题配图标签, 母题配图规则, 文章生成风格, update-topic, publish-status, mother-image-tags, mother-image-rule, article-writing-style
- `XhsTopicRepositoryService.touchParentLastActive(parentId, now, scope)` — 子题创建、修改或文章变更后刷新所属母题活动时间 | keywords: 刷新母题活动, 子题联动, refresh-mother-activity, child-activity-propagation
- `XhsTopicRepositoryService.nextIds(count)` — 校准计数器并批量分配选题业务 ID | keywords: 批量选题业务ID, 自增计数器, allocate-topic-ids, sequence-counter
- `XhsTopicRepositoryService.ensureCounterAtLeast(sequence)` — 将计数器校准到已有最大业务 ID | keywords: 选题计数器校准, 业务ID防冲突, topic-counter-calibration, id-collision-guard
- `XhsTopicRepositoryService.buildScopeFilter(scope)` — 构造租户用户隔离条件，并兼容无租户数据的 null 与缺失字段 | keywords: 查询作用域, 用户隔离, scope-filter, user-isolation
- `XhsTopicRepositoryService.normalizeStringList(values, maximumItems, maximumLength)` — 规整文章标签或图片列表并去重截断 | keywords: 规整文章列表, 去重截断, normalize-article-list, deduplicate-values
- `XhsTopicRepositoryService.normalizeMotherImageTags(values?)` — 规整母题固定配图标签并去除井号、空值和大小写重复项 | keywords: 母题配图标签, 标签去重, mother-image-tags, normalize-mother-tags
- `XhsTopicRepositoryService.normalizeMotherImageRule(value?)` — 规整母题配图规则，历史缺字段或非法值回落 `default` | keywords: 母题配图规则, 规则归一化, mother-image-rule, normalize-image-rule
- `XhsTopicRepositoryService.toChildView(entity, draftRule)` — 转换子题数据库实体并按租户草稿规则计算清理时间，关闭草稿清理时不返回 | keywords: 子选题转换, 接口视图, 文章生成风格, child-topic-view, api-view, article-writing-style
- `XhsTopicCleanupService({ repository, articleGeneration, cleanupSettings, articles })` — 回填历史清理时钟并按各租户设置编排文章库、草稿与母题的每日幂等清理 | keywords: 选题自动清理, 首次上线回填, 幂等清理, topic-auto-cleanup, startup-backfill, idempotent-cleanup
- `XhsTopicCleanupService.onModuleInit()` — 启动时回填历史时间、立即清理并启动每小时检查；多进程时只在 leader 进程上跑 | keywords: 启动清理调度, 历史时间回填, start-cleanup-scheduler, historical-timestamp-backfill
- `XhsTopicCleanupService.onModuleDestroy()` — 模块销毁时释放清理定时器 | keywords: 停止清理调度, 释放定时器, stop-cleanup-scheduler, clear-cleanup-timer
- `XhsTopicCleanupService.runCleanup(now)` — 遍历有选题或已发布文章的租户，按各自设置依次清理文章库、草稿与母题，单租户失败不影响其他租户 | keywords: 按租户清理, 租户清理设置, per-tenant-cleanup, tenant-cleanup-settings
- `XhsTopicCleanupService.cleanupLibraryArticles(tenantId, rule, now)` — 删除租户内超过保留期或超出数量上限的已发布文章，来源为选题时同时清空子题文章 | keywords: 清理文章库文章, 只清已发布, 文章库清理联动, cleanup-library-articles, published-only, library-cleanup-cascade
- `XhsTopicCleanupService.cleanupExpiredDrafts(tenantId, rule, now)` — 清空各成员超过保留期或超出数量上限、未入库且无生成任务运行的子题文章 | keywords: 清理过期草稿, 运行任务保护, 已入库保护, cleanup-expired-drafts, running-task-protection, stored-article-protection
- `XhsTopicCleanupService.cleanupIdleMotherTopics(tenantId, rule, now)` — 删除各成员超过闲置期限或超出数量上限、未星标且没有已入库子题保护的母题 | keywords: 清理闲置母题, 已入库保护, 级联删除, cleanup-idle-mothers, stored-article-protection, cascade-delete
- `XhsTopicCleanupService.runCleanupIfDue(now)` — 每小时检查每日门控并防止进程内重叠执行 | keywords: 每日清理门控, 防止重叠执行, daily-cleanup-gate, overlapping-run-guard
- `XhsArticleGenerationService({ adminService, agentService, aiBillingService, mcpAdapters, todoService, repository, galleryService, canvasService, workflowModels, queue })` — 编排服务固定扣费、经 AI 生成排队服务 `xhs-article` 通道限制平台及租户并发、一次交付文章与生文图组工作流 | keywords: 文章生成服务, 内存文章, article-generation-service, in-memory-article
- `XHS_ARTICLE_ERROR_MESSAGES` — 文章生成失败码与前端可读中文原因的对照表 | keywords: 文章生成错误码, 失败原因文案, article-error-code, failure-reason-text
- `XHS_MOTHER_IMAGE_RULE_LAYOUT` — 母题配图规则到固定版式的映射（默认 5 拼 1 竖 / 全拼图 / 全竖图），凑不齐不换版式 | keywords: 母题配图规则, 规则版式, mother-image-rule, rule-layout
- `XHS_ARTICLE_TODO_RESOURCE_TYPE` — 生成 Todo 绑定子选题时使用的资源类型 | keywords: 生成任务关联资源, 子选题归位, generation-todo-resource, topic-binding
- `XHS_ARTICLE_CHARGE_RESOURCE_TYPE` — 生成 Todo 上记录生文服务扣费单号的资源类型，进程中断时凭它找回 operationId 退点 | keywords: 扣费单号资源, 中断退点, charge-operation-resource, interrupted-refund
- `XHS_ARTICLE_RUNTIME_MISS_LIMIT` — 定义持久化运行态缺失真实执行实例时的连续确认次数 | keywords: 异步存活确认, 连续查询, async-liveness-confirmation, consecutive-polls
- `XHS_ARTICLE_SERVICE_CODE` — 将小红书生文工作流绑定到固定收费服务 | keywords: 生文服务编码, 服务计费, text-service-code, service-billing
- `describeXhsArticleError(code, detail?)` — 把失败码翻译成可直接展示的中文原因，未知码回退为通用失败文案；生文不完整的模型交付问题不拼进文案 | keywords: 失败原因文案, 错误码翻译, failure-reason-text, error-code-translate
- `XhsArticleGenerationError(code, detail?)` — 携带失败码与明细的文章生成错误，供接口层原样抛给前端 | keywords: 文章生成错误, 失败码, article-generation-error, failure-code
- `XhsArticleGenerationService.start(topicId, input, scope)` — 校验重复任务（本进程集合 + 排队登记簿，覆盖其他进程）、扣除一次生文服务费并创建等待 Todo，交给 `xhs-article` 通道排队（全局及租户并发上限） | keywords: 异步生成文章, 后台任务, 并发生成, start-article-generation, background-task, concurrent-generation
- `XHS_ARTICLE_QUEUE_LANE` — 文章生成在 AI 生成排队服务里的通道名 `xhs-article` | keywords: 文章生成排队通道, 并发槽位, article-generation-lane, concurrency-slot
- `XhsArticleGenerationService.launchQueuedGeneration(job)` — 拿到通道名额后切换 Todo 为执行中并跑完整个生成，返回即释放名额；切换失败时退点并置失败 | keywords: 启动排队任务, 释放并发槽位, launch-queued-generation, release-concurrency-slot
- `XhsArticleGenerationService.runGeneration(params)` — 后台执行文章全流程，按请求保留或重新生成配图，正文与配图谁先好谁先写进 Todo 阶段产出，并把结果回写 Todo | keywords: 后台生成文章, 待办回写, run-article-generation, todo-writeback
- `XhsArticleGenerationService.listGenerations(scope)` — 汇总等待、执行、完成与失败状态，并通过持久化 Todo 与排队登记簿（覆盖全部进程）双重确认 | keywords: 文章生成状态, 逐条进度, 异步存活确认, article-generation-state, per-topic-progress, async-liveness-confirmation
- `XhsArticleGenerationService.readRuntimeState(scope,topicId)` — 确认子选题生成是否还活着：先看本进程排队 / 执行集合，再查排队登记簿（多进程时覆盖全部 worker） | keywords: 运行实例确认, 等待队列确认, 异步存活确认, runtime-instance-check, waiting-queue-check, async-liveness-confirmation
- `XhsArticleGenerationService.buildRuntimeConfirmationKey(scope,topicId)` — 构造租户用户及子选题隔离的连续存活确认键 | keywords: 存活确认键, 租户隔离, liveness-confirmation-key, tenant-isolation
- `XhsArticleGenerationService.readTodoTopicId(todo)` — 从 Todo 关联资源读取对应子选题 ID | keywords: 生成任务关联资源, 子选题归位, generation-todo-resource, topic-binding
- `XhsArticleGenerationService.readTodoProgress(todo)` — 从运行中 Todo 结果解析阶段产出，没有或解析不出时返回 undefined | keywords: 读取生文阶段产出, 待办结果解析, read-generation-progress, task-result-parse
- `XhsArticleGenerationService.readTodoFailure(todo)` — 从 Todo 读取失败码、界面文案与原始明细，旧记录里当失败码存的异常原文收敛为通用失败并挪进 errorDetail | keywords: 失败码, 待办结果解析, 旧记录清洗, failure-code, task-result-parse, legacy-error-sanitize
- `XhsArticleGenerationService.refundArticleCharge(operationId,reason)` — 文章生成失败时退回生文服务扣点，退款失败只记日志不覆盖原始失败 | keywords: 文章失败退点, 生文退款, article-failure-refund, text-service-refund
- `XhsArticleGenerationService.refundInterruptedCharge(todo,topicId,scope)` — 进程中断导致的失败退点，先确认该 Todo 的文章未落库再退 | keywords: 中断退点, 落库确认, interrupted-refund, persisted-check
- `XhsArticleGenerationService.readTodoChargeOperationId(todo)` — 从 Todo 关联资源读取生文服务扣费单号 | keywords: 扣费单号读取, 关联资源, read-charge-operation-id, todo-resource
- `XhsArticleGenerationService.resolveMotherImageTags(configuredTags,availableTags)` — 校验母题固定标签仍存在于当前真实图库并保留规范写法 | keywords: 母题配图标签, 真实图库校验, mother-image-tags, validate-gallery-tags
- `ZXhsArticleDraft` — 一次交付整篇文章的结构（标题、正文、标签），交付工具与结构化输出共用 | keywords: 文章交付结构, 一次交付, article-draft-schema, single-shot-delivery
- `XHS_ARTICLE_DRAFT_JSON_SCHEMA` — 交付结构的 JSON Schema 版本，只给结构化输出用，跳过 zod 严格校验改由交付校验清洗 | keywords: 文章交付JSON结构, 宽松解析, article-draft-json-schema, lenient-parsing
- `ZXhsArticleImageTags` — 配图决策的结构化输出（2-5 个图库标签） | keywords: 配图决策结构, 图库标签, image-decision-schema, gallery-tags
- `XhsArticleGenerationService.applyArticleSubmission(draft, input)` — 校验并写入一次文章交付（标签交成一整串时按分隔符拆开），不合格不改内存文章并返回问题描述 | keywords: 写入文章交付, 交付校验, apply-article-submission, submission-validation
- `XhsArticleGenerationService.createArticleSubmitTool(draft, state)` — 一次交付标题、正文、标签的工具（`xhs_article_submit`，`returnDirect` 交付即结束） | keywords: 文章交付工具, 一次交付, article-submit-tool, single-shot-delivery
- `XhsArticleGenerationService.buildSystemPrompt(input)` — 构造文章风格、合规、搜索与一次交付约束的提示词，改写时直接带上当前文章 | keywords: 构造文章提示词, 工具交付约束, 文章生成风格, build-article-prompt, tool-delivery-contract, article-writing-style
- `XhsArticleGenerationService.writeArticle(system, searchTools, draft, scope)` — 写文章（节点 `xhs-article/article`，保留默认思考）：有搜索工具时用轻量 Agent（搜索 + 交付工具），否则一次结构化输出（传 JSON Schema 跳过 zod 严格校验，解析异常记为不合格交付）；没合格交付重试一次 | keywords: 执行文章Agent, 一次交付, 轻量Agent, run-article-agent, single-shot-delivery, lightweight-agent
- `XhsArticleGenerationService.decideImageTags(input, scope)` — 配图决策（节点 `xhs-article/image-decision`，关闭思考）从真实图库标签挑 2-5 个，失败按字面兜底 | keywords: 配图决策, 关闭思考, 并行选图, article-image-decision, thinking-off, parallel-image-pick
- `XhsArticleGenerationService.pickImageTagsByRule(text, tags)` — 配图决策兜底：标签出现在选题文字里优先，其次按两字片段重合，取至多 3 个 | keywords: 字面匹配选图, 配图兜底, rule-based-image-tags, image-decision-fallback
- `XhsArticleGenerationService.isArticleComplete(draft)` — 校验标题、正文与文章标签（配图标签由配图决策单独保证） | keywords: 校验文章完整性, 内存文章, validate-article-completeness, in-memory-article
- `XhsArticleGenerationService.buildArticleImageInput(input, scope)` — 构造生文图片阶段 Canvas 入参，版式固定取规则对应版式，允许重复时放开本篇内源图复用 | keywords: 生文配图入参, 母题配图规则, article-image-input, mother-image-rule
- `XhsArticleGenerationService.assertImageSourcesSufficient(preparation, imageTags)` — 源图分配失败时按缺口抛回横图太少 / 竖图太少 / 通用不足，附带需要与可用张数 | keywords: 横图太少, 竖图太少, 源图缺口统计, landscape-insufficient, portrait-insufficient, source-shortage-stats
- `XhsArticleGenerationService.precheckMotherImageSources(input, scope)` — 母题锁定标签时在扣费与 Agent 运行前按规则试分配源图，标签失效或横/竖图不够直接抛回 | keywords: 配图预检, 横图太少, 扣费前拦截, image-source-precheck, landscape-insufficient, pre-charge-guard
- `XhsArticleGenerationService.prepareArticleVisuals(input, scope)` — 与写正文并行：母题固定标签或配图决策选标签，再按母题配图规则版式分配源图，横/竖图不够抛回 | keywords: 配图准备, 并行选图, 母题配图规则, prepare-article-visuals, parallel-image-pick, mother-image-rule
- `XhsArticleGenerationService.generateArticleImagesByWorkflow(prepared, articleTitle: Promise, onImageReady?)` — 用已分配源图渲染整组配图：内页与封面底图不等正文先出，封面文案与 AI 封面等标题到了再出，每张图就绪即回调；把合成封面拆成原照片与已融合文字的独立海报素材画板元数据 | keywords: 生文配图工作流, 可编辑封面, 母题配图规则, 配图先于正文, article-image-workflow, editable-cover, mother-image-rule, images-before-text
- `toXhsArticleImageSlot(role)` — 把图组角色换成预览槽位（封面 0、inner-n 为 n） | keywords: 角色转槽位, 渐进显示, role-to-slot, progressive-reveal
- `XhsArticleGenerationProgressReporter` — 生文阶段产出写入器，单路在途、合并写入运行中 Todo 的 taskResult | keywords: 生文阶段产出, 合并写入, generation-progress-reporter, coalesced-writes
- `XhsArticleGenerationProgressReporter.constructor(options)` — 以出队时刻为起点建立阶段快照，不出新图时配图轨标为 skipped | keywords: 生文阶段产出, 出队起点, generation-progress-reporter, run-start-time
- `XhsArticleGenerationProgressReporter.textReady(article)` — 正文完整校验后交付标题、正文与标签 | keywords: 正文先到, 阶段交付, text-ready, stage-delivery
- `XhsArticleGenerationProgressReporter.imagesPlanned(total)` — 源图分配完成后记下计划出图张数 | keywords: 配图计划张数, 阶段交付, images-planned, stage-delivery
- `XhsArticleGenerationProgressReporter.imageReady(event)` — 单张图就绪按槽位覆盖，封面底图会被成品封面替换 | keywords: 配图逐张到达, 封面底图替换, image-ready, cover-base-replace
- `XhsArticleGenerationProgressReporter.imagesDone()` — 整组配图渲染完成，配图轨置为 done | keywords: 配图整组完成, 阶段交付, images-done, stage-delivery
- `XhsArticleGenerationProgressReporter.close()` — 停止后续写入并等在途写请求落地 | keywords: 关闭阶段写入, 终态防覆盖, close-progress-writes, protect-terminal-result
- `XhsArticleGenerationProgressReporter.schedule()` — 标记变化并在没有在途写请求时启动写循环 | keywords: 合并写入, 单路在途, coalesced-writes, single-flight
- `XhsArticleGenerationService.toCanvasBoardCollage(collage?)` — 把图组拼图的画布格式转成文章画板元数据，源图格子随文章持久化，并写入成品指纹 `renderedKey` | keywords: 拼图画布格式, 可换图拼图, 拼图指纹, collage-canvas-format, swappable-collage, collage-render-key
- `XhsArticleGenerationService.buildResult(topicId, article, searchEnabled, searchAvailable)` — 构造可写入 Todo 的文章结果 | keywords: 构造文章结果, 日期序列化, build-article-result, serialize-dates
- `XhsTopicController({ xhsTopicService, articleGenerationService, repository })` — 暴露带后台鉴权的选题、真实文章生成与持久化接口 | keywords: 小红书选题接口, 待办返回, xhs-topic-controller, todo-response
- `XhsTopicController.recommendPrompt(req, dto)` — 返回基于当前母题的可编辑子选题推荐提示词 | keywords: 推荐子选题提示词, 母题上下文, recommend-child-topic-prompt, parent-topic-context
- `XhsTopicController.list(req)` — 返回真实母子选题工作台 | keywords: 查询真实选题, 母子列表, list-persisted-topics, workspace-list
- `XhsTopicController.create(req, dto)` — 批量入库所选候选、母题配图标签及子题文章风格并返回真实列表 | keywords: 保存真实选题, 批量创建, 母题配图标签, 文章生成风格, persist-selected-topics, bulk-create, mother-image-tags, article-writing-style
- `XhsTopicController.remove(req, dto)` — 批量删除选题并级联子题 | keywords: 删除真实选题, 级联删除, delete-persisted-topics, cascade-delete
- `XhsTopicController.update(req, id, dto)` — 修改真实选题、状态、母题配图标签与配图规则或子题文章风格 | keywords: 更新真实选题, 发布状态, 母题配图标签, 母题配图规则, 文章生成风格, update-persisted-topic, publish-status, mother-image-tags, mother-image-rule, article-writing-style
- `XhsTopicController.listArticleGenerations(req)` — 返回每个子选题最近一次文章生成进度与失败原因 | keywords: 文章生成状态接口, 逐条进度, article-generation-state-api, per-topic-progress
- `XhsTopicController.recommendArticleRequirements(req, id, dto)` — 为当前作用域内的子选题一键推荐文章生成需求 | keywords: 生成需求推荐接口, 子题上下文, requirement-recommendation-api, child-topic-context
- `XhsTopicController.generateArticle(req, id, dto)` — 异步排队文章生成并立即返回等待中的 Todo | keywords: 生成真实文章接口, 异步生成文章, 并发生成, generate-persisted-article-api, start-article-generation, concurrent-generation
- `XhsTopicController.updateArticle(req, id, dto)` — 修改已生成文章与真实配图 | keywords: 更新真实文章接口, 文章配图, update-persisted-article-api, article-images
- `XhsTopicController.touchDraft(req, id)` — 文章从文章库回到草稿后重置草稿保留时钟，租户关闭草稿清理时 `draftCleanupAt` 为 null | keywords: 重置草稿接口, 草稿保留期限, touch-draft-api, draft-retention
- `XhsTopicController.getCleanupSettings(req)` — 返回当前租户清理设置与平台默认值 | keywords: 读取清理设置接口, 租户清理设置, get-cleanup-settings-api, tenant-cleanup-settings
- `XhsTopicController.updateCleanupSettings(req, dto)` — 保存当前租户清理设置，租户内成员都可修改 | keywords: 保存清理设置接口, 租户清理设置, update-cleanup-settings-api, tenant-cleanup-settings
- `XhsTopicController.generate(req, dto)` — 生成候选并返回 taskResult 已落盘的 Todo | keywords: 生成选题接口, 待办结果, generate-topic-api, todo-result
- `XhsTopicController.requireUser(req)` — 读取当前后台用户并拒绝未鉴权请求 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `XhsTopicModule()` — 装配选题生成业务依赖 | keywords: 小红书选题模块, 选题生成, xhs-topic-module, topic-generation

## 关键词索引 (Keyword Index)

| 中文关键词       | English keyword                   | 定位                                                                                        |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| 小红书选题       | xhs-topic                         | 模块入口、控制器与业务服务                                                                  |
| 生成选题候选     | generate-topic-candidates         | Agent 生成与 Todo 返回主流程                                                                |
| 内存候选         | in-memory-candidates              | Agent 工具逐项写入的运行态集合                                                              |
| 追加候选工具     | candidate-append-tool             | 标题和题目类型写入工具                                                                      |
| 提示词数量       | prompt-quantity                   | 显式数量及“生成 20 个”“给我来 20 条”等自然语言数量解析                                      |
| 子选题提示词推荐 | child-topic-prompt-recommendation | 根据当前母题生成可编辑的子选题创作提示词                                                    |
| 生成需求推荐 | requirement-recommendation | 根据子题、母题和已有文章风格从请求候选项中推荐文章生成需求 |
| 选项安全过滤 | option-safe-normalization | 服务端限制枚举值、数量与文本长度，阻止模型越过请求候选范围 |
| 文章失败退点     | article-failure-refund            | 生成失败、启动失败与进程中断时退回生文服务扣点                                              |
| 合规提示词       | compliance-prompt                 | 默认法律和平台安全边界                                                                      |
| Duck搜索工具     | duck-search-tools                 | DuckDuckGo MCP 工具筛选                                                                     |
| 待办结果         | todo-result                       | taskResult 持久化与接口响应                                                                 |
| 选题数据库服务   | topic-repository                  | `xhs_topics` 集合读写与租户用户隔离                                                         |
| 母子聚合         | parent-child-aggregation          | 真实母题与子题工作台列表                                                                    |
| 母题星标         | mother-topic-star                 | 星标母题置顶并永久跳过闲置清理                                                              |
| 母题闲置期限     | topic-idle-retention              | 租户设置 `motherTopic.retentionDays`；未设置时读 `XHS_TOPIC_IDLE_DAYS`，默认 30 天          |
| 草稿保留期限     | draft-retention                   | 租户设置 `draftArticle.retentionDays`；未设置时读 `XHS_DRAFT_RETENTION_DAYS`，默认 7 天     |
| 文章库保留期限   | library-article-retention         | 租户设置 `libraryArticle.retentionDays`，默认 90 天且该类默认关闭                           |
| 租户清理设置     | tenant-cleanup-settings           | `xhs_topic_cleanup_settings` 每租户一份，三类内容各有开关、保留天数与数量上限               |
| 平台默认清理设置 | default-cleanup-settings          | 租户未保存时的回落值：母题与草稿开启、文章库关闭、数量不限                                  |
| 超出数量上限     | select-capacity-overflow          | 扣掉按天数选中的条目后仍超出上限的部分，最早优先清理；受保护条目计数但不清理               |
| 按租户清理       | per-tenant-cleanup                | 每日清理逐租户读规则，顺序为文章库 → 草稿 → 母题                                           |
| 只清已发布       | published-only                    | 文章库自动清理只删已发布文章，未发布与租约中的不删                                         |
| 文章库清理联动   | library-cleanup-cascade           | 来源为选题的已发布文章被清理时同时清空子题文章，不回到草稿                                 |
| 平台作用域       | platform-scope                    | 无租户账号的清理设置键 `__platform__`                                                       |
| 首次上线回填     | cleanup-timestamp-backfill        | 启动时为历史母题 `lastActiveAt` 与文章 `draftAt` 补当前时间                                  |
| 已入库保护       | stored-article-protection         | 名下有已入库子题的母题不清理，已入库子题的草稿文章不清理                                    |
| 运行任务保护     | running-task-protection           | 正在等待或执行生文任务的子题文章不清理                                                      |
| 幂等清理         | idempotent-cleanup                | 多实例重复删除或 `$unset` 不产生额外副作用                                                   |
| 母题配图标签     | mother-image-tags                 | 母题持久化的最多五个真实图库标签，供所属文章统一选图                                        |
| 母题配图约束     | mother-image-constraint           | 首次生成或重配图片时锁定母题标签，阻止 Agent 清空、替换或追加                               |
| 母题配图规则     | mother-image-rule                 | 母题持久化的拼图/单图配比规则：默认 5:1 单图排最后、拼图优先、竖图优先                      |
| 规则取值         | image-rule-values                 | `XHS_MOTHER_IMAGE_RULES` 合法取值，DTO 与仓储共用                                           |
| 规则归一化       | normalize-image-rule              | 历史缺字段或非法值回落 `default`                                                            |
| 规则版式         | rule-layout                       | 配图规则对应的固定版式，凑不齐不换版式而是抛回横/竖图太少                                   |
| 优先不重复       | prefer-unused                     | 默认取图模式：先用未用图，不够再复用已用图；`dedup: true` 才严格去重                        |
| 横图太少         | landscape-insufficient            | `XHS_ARTICLE_LANDSCAPE_INSUFFICIENT`，前端提供「改用竖图 / 允许重复」重试                   |
| 竖图太少         | portrait-insufficient             | `XHS_ARTICLE_PORTRAIT_INSUFFICIENT`，前端提供「改用拼图 / 允许重复」重试                    |
| 源图缺口统计     | source-shortage-stats             | Canvas 准备阶段返回的竖图/横图需要与可用张数，用于判断缺哪种图                              |
| 配图预检         | image-source-precheck             | 母题锁定标签时扣费前试分配源图                                                              |
| 扣费前拦截       | pre-charge-guard                  | 图不够在扣费和 Agent 运行前抛回，不浪费一次生文                                             |
| 生文配图入参     | article-image-input               | `buildArticleImageInput` 统一预检与正式生成的 Canvas 入参                                   |
| 独立子选题       | standalone-child-topic            | 没有 `parentId` 的子选题，只由数据监控手动添加链接产生，选题工作台不展示                    |
| 手动链接选题     | manual-link-topic                 | 独立子选题的 `topicType=手动链接`，作为手动笔记的抓取 topicId                               |
| 文章生成风格     | article-writing-style             | 子题持久化的创作风格，约束子题候选并在首次生文与重写时继续注入 Agent                        |
| 真实图库校验     | validate-gallery-tags             | 按当前图库实际标签校验母题配置并恢复规范大小写                                              |
| 已入库子选题     | stored-topic-ids                  | 已存入文章库的来源子选题，工作台列表与同名去重都会跳过                                      |
| userId 口径差异  | user-id-mismatch                  | `xhs_topics.userId` 存后台用户 ObjectId，`articles.userId` 存用户名，两表不可用 userId 关联 |
| 文章库来源       | article-library-source            | articles 集合里 `source=xhs-topic` + `meta.xhsTopicId` 的入库记录                           |
| 批量入库         | bulk-persistence                  | 保存用户确认的候选                                                                          |
| 级联删除         | cascade-delete                    | 删除母题时同步删除所属子题                                                                  |
| 内存文章         | in-memory-article                 | Agent 通过工具设置标题、正文并逐个追加标签                                                  |
| 真实文章         | persisted-article                 | 子选题 article 字段与右侧详情数据源                                                         |
| 文章交付工具     | article-submit-tool               | `xhs_article_submit` 一次交付标题、正文与标签                                               |
| 文章交付JSON结构 | article-draft-json-schema         | 结构化输出用的交付 JSON Schema，模型侧仍要求标签数组                                        |
| 宽松解析         | lenient-parsing                   | 不在 LangChain 层严格校验，标签字符串也能拆开入库，不合格才带原因重试                       |
| 配图决策         | article-image-decision            | 与写正文并行、关闭思考的图库标签选择（节点 `xhs-article/image-decision`）                   |
| 文章生成排队通道 | article-generation-lane           | AI 生成排队服务里的 `xhs-article` 通道                                                      |
| 文章落库         | persist-article                   | 完整性校验后统一持久化                                                                      |
| 生文配图工作流   | article-image-workflow            | 相关图库标签取图、动态拼图、封面与可选 AI 生图                                              |
| 封面优先拼图     | prefer-collage-cover              | 已由母题配图规则的候选版式链取代，小红书生文不再传 `preferCollageCover`                     |
| 可编辑封面       | editable-cover                    | 无字封面底图与灵感画布主副标题图层元数据                                                    |
| 装饰素材叠加     | decoration-overlay                | 小红书封面走 `ai-overlay`：AI 输出文字与装饰融合的绿幕海报素材，真实照片主体不被重绘        |
| 可编辑装饰素材   | editable-decoration-material      | 合成预览保留用于发布，画板另外保存原照片、透明素材、绿幕原图与特效参数                      |
| 图层分离         | separated-layers                  | 照片与文字海报素材进入灵感画布后是独立对象，文字属于素材像素而非原生文字层                  |
| 文章画板         | article-canvas-board              | 图片下标、封面/内页类型与可编辑文案的持久化结构                                             |
| 画板编辑状态     | canvas-editor-state               | 用户保存的模板、尺寸和完整有序图层，重新进入灵感画布时直接恢复                              |
| 图层结构         | layer-structure                   | 编辑态画板中按顺序保存的图片、文字和形状图层                                                |
| 拼图画布格式     | collage-canvas-format             | 拼图画布尺寸与源图格子，进入灵感画布后拆成独立图层                                          |
| 可换图拼图       | swappable-collage                 | 拼图里的每张源图都能在画布上单独替换                                                        |
| 拼图格子         | collage-cell                      | 单张源图在拼图中的位置、尺寸、填充方式与可选裁切参数                                        |
| 裁切参数         | crop-parameters                   | `focusX` / `focusY` 保存横纵焦点百分比，`zoom` 保存图片缩放倍数                             |
| 拼图归一化       | collage-normalization             | 保存文章画板时数值化、钳制并保留格子的可选裁切参数                                          |
| 拼图指纹         | collage-render-key                | `collage.renderedKey`：当前成品图由哪组格子画出，生成时写入、前端重合成后更新               |
| 跳过重合成       | skip-recompose                    | 保存到文章库时指纹一致的拼图页直接复用成品图，不再重画重传                                  |
| 拼图指纹哈希     | collage-key-hash                  | `hashCollageText` 的 cyrb53 实现，与工作台逐行一致                                          |
| 前后端同算法     | shared-hash-algorithm             | 两边测试用同一组样例锁定指纹，任一侧改算法都会失配                                          |
| 数值规范化       | number-canonicalization           | 指纹里的数值统一保留两位小数，吸收前端未取整的拖动值                                        |
| 文章生成错误码   | article-error-code                | 失败码与中文原因对照表，接口层据此下发用户可读提示                                          |
| 失败原因文案     | failure-reason-text               | `describeXhsArticleError` 翻译出的中文失败原因                                              |
| 旧记录清洗       | legacy-error-sanitize             | 历史失败记录里的异常原文不再下发为界面文案，只放进 `errorDetail`                           |
| 文章生成错误     | article-generation-error          | `XhsArticleGenerationError` 携带失败码与明细，配图不足时附带本次图库标签                    |
| 异步存活确认     | async-liveness-confirmation       | 查询时同时核对 Todo 状态与当前进程执行集合，连续两次缺失后判定服务中断                      |
| 生文阶段产出     | generation-progress-reporter      | `XhsArticleGenerationProgressReporter` 把先写好的正文与逐张配图合并写进运行中 Todo          |
| 渐进显示         | progressive-reveal                | `listGenerations` 在运行态返回 `progress`，前端先显示已完成的正文或配图                     |
| 配图先于正文     | images-before-text                | 内页与封面底图不等正文先渲染，只有封面文案与 AI 封面等标题                                  |
| 读取生文阶段产出 | read-generation-progress          | `readTodoProgress` 解析运行中 Todo 的阶段产出                                               |
| 合并写入         | coalesced-writes                  | 单路在途，写入期间到达的变化合并成下一次写入                                                |
| 单路在途         | single-flight                     | 同一时刻最多一个阶段产出写请求                                                              |
| 终态防覆盖       | protect-terminal-result           | `close` 后不再写阶段产出，done / failed 结果不会被覆盖                                      |
| 正文先到         | text-ready                        | 正文写好后先交付标题、正文与标签                                                            |
| 配图逐张到达     | image-ready                       | 每张内页或封面就绪即写入对应槽位                                                            |
| 封面底图替换     | cover-base-replace                | 封面先报无字底图，成品封面就绪后同槽位替换                                                  |
| 角色转槽位       | role-to-slot                      | `toXhsArticleImageSlot` 把 cover / inner-n 转成预览槽位                                     |

## 类型导出 (Type Exports)

- `XhsTopicKind` — `mother` 或 `child` 选题层级。
- `XhsMotherImageRule` — 母题配图规则：`default` / `collage-first` / `portrait-first`。
- `XhsTopicCandidate` — 包含 `title`、`topicType`、可选母题 `imageTags` / `imageRule` / `knowledgeIds` 与可选子题 `articleStyle` 的候选。
- `XhsTopicEntity` — MongoDB 中持久化的母题或子题；母题含 `starred`、`lastActiveAt`，子题文章含 `draftAt`。
- `XhsTopicStatus` — 真实选题的业务状态。
- `XhsTopicCrawlStatus` — 子选题数据抓取开关：`crawling` 或 `cancelled`。
- `XhsTopicCrawlState` — 子选题上的抓取开关子文档（状态、最后抓取时间、最后调度时间、取消时间）。
- `XhsArticleCanvasCollageCell` — 拼图内单张源图的格子（地址、图库 ID、坐标尺寸、填充方式，以及可选的横纵裁切焦点百分比 `focusX` / `focusY` 与 1–3 倍缩放 `zoom`；缺省分别按 50 / 50 / 1 解释）。
- `XhsArticleCanvasCollage` — 拼图画布格式：画布尺寸与 2-4 个源图格子，可选成品指纹 `renderedKey`（≤64 字符，DTO 白名单放行）。
- `XhsArticleCanvasMaterial` — 封面独立图片素材层，保留原素材、去底结果、坐标尺寸、特效参数与文字融合标记。
- `XhsArticleCanvasEditorSize` — 用户保存的灵感画布宽高。
- `XhsArticleCanvasEditorState` — 灵感画布保存的模板、尺寸与完整有序图层。
- `XhsArticleCanvasBoard` — 文章画板元数据；兼容生成态封面/内页和用户保存的完整编辑状态。
- `XhsTopicArticle` — 子选题持久化的真实文章、标签、图片、内容形式与草稿时钟 `draftAt`。
- `XhsTopicCreateInput` — 用户确认候选的批量入库输入，可随母题保存 `imageTags`、随子题保存 `articleStyle`。
- `XhsTopicUpdateInput` — 真实选题更新输入；支持母题 `starred` / `imageTags` / `imageRule` / `knowledgeIds` 与子题 `articleStyle`。
- `XhsChildTopicView` — 子题接口列表结构，文章存在且租户开启草稿清理时含 `draftCleanupAt`，并保留抓取状态字段。
- `XhsTopicWorkspaceGroup` — 母题及其子题聚合结构，含 `starred`、`lastActiveAt` 与可空的 `idleCleanupAt`（星标、已入库保护或租户关闭母题清理时为 null）。
- `XhsCleanupTarget` — 清理对象：`motherTopic` / `draftArticle` / `libraryArticle`。
- `XhsCleanupRule` — 单类清理规则 `{ enabled, retentionDays, maxCount }`，`maxCount=0` 表示不限条数。
- `XhsCleanupSettings` — 一个租户的完整清理设置，三类对象各一条规则。
- `XhsCleanupSettingsEntity` — `xhs_topic_cleanup_settings` 文档，按 `scopeKey` 唯一，记录 `tenantId`、`updatedBy` 与时间戳。
- `XhsTopicGenerateInput` — 服务层标准生成输入，子题支持 `articleStyle`。
- `XhsArticleUpdateInput` — 已生成文章编辑输入。
- `XhsArticleMemoryDraft` — Agent 工具在单次运行中调整的文章内存，含文章标签与真实图库配图标签。
- `XhsArticleGenerateInput` — 真实文章生成输入，包含配图去重（`true` 严格，缺省优先不重复）、素材风格库封面预设、可选的整组配图重新生成开关，以及仅本次生效的 `imageRule` 覆盖与 `allowImageRepeat`。
- `XhsArticleGenerationResult` — 写入 Todo `taskResult` 的文章生成结果；失败时带 `error`（失败码）、`errorMessage`（界面文案）与可选 `errorDetail`（原始明细，只给控制台与运维上报）。
- `XhsArticleGenerationState` — 单个子选题最近一次文章生成任务的等待、运行、完成或失败状态；运行中带 `startedAt` 与阶段产出 `progress`；失败时带 `error`、`errorMessage` 与可选 `errorDetail`。
- `XhsArticleGenerationProgress` — 生成中的阶段产出：`startedAt`、正文轨（`running` / `done` 及标题正文标签）、配图轨（`pending` / `running` / `done` / `skipped`、计划张数 `total`、按槽位的已就绪图 `items`）。
- `XhsTopicGenerationResult` — 写入 Todo `taskResult` 的结果结构。
- `XhsTopicGenerateResponse` — 服务内部携带 Todo 与生成结果的响应，控制器仅输出 Todo。

## 模块功能描述 (Module Description)

子选题上的 `crawl` 子文档只在本模块存取（开关状态、最后抓取时间、最后调度时间），真正按频率建抓取任务、聚合看板指标和做舆论分析都在 [xhs-topic-data 模块](../xhs-topic-data/module.md)。放在这里是因为「这个子选题还抓不抓」属于选题自身的属性，跟着选题一起删；抓取任务和抓取数据则是另一份生命周期，单独成表。

`POST /api/xhs-topic/generate` 以 `create XhsTopic` 权限接收选题层级、提示词、可选母选题、子题 `articleStyle`、可选数量和搜索开关。子题配置风格后，服务把它同时写进候选结果，并要求 Agent 生成适合沿该风格继续写作的标题、叙事视角和内容结构。服务从显式参数或提示词解析目标数量，创建运行 Todo 后将内存追加工具与 DuckDuckGo 检索工具交给 Agent。每条候选都必须通过 `xhs_topic_add_candidate` 写入，包含题目和题目类型；最终回答被忽略。服务最多补跑一次缺失候选，数量准确时将最终内存集合序列化到 Todo `taskResult`，更新状态为 `done` 并只返回 Todo；仍不足或运行异常时将已有候选与错误写入 `failed` Todo 并同样返回。

`POST /api/xhs-topic/prompt/recommend` 根据当前母题调用 AI 返回一条可编辑的子选题生成提示词，失败时使用包含数量、差异化角度、内容价值和标题风格的稳定模板回退。入口与选题生成一样声明 `create XhsTopic` 权限。

`POST /api/xhs-topic/:id/article/requirements/recommend` 以 `create XhsTopic` 权限接收 `{ options: { purposes, personas, styles, lengths } }`，四组数组各需 1 至 50 项、单项 1 至 20 字。服务只读取当前租户用户拥有的子选题及所属母题，把母题标题、子题标题与已有 `articleStyle` 交给 `xhs-article/topic` 节点，并沿用提示词推荐的流式计费配置。模型必须返回严格 JSON；解析失败会重试一次，仍失败返回 HTTP 503 与 `XHS_REQUIREMENT_RECOMMEND_FAILED`（“生成需求推荐失败，请稍后重试”）。响应为 `{ purpose, persona, styleTags, keywords, length, idea }`：purpose/persona 越界时置空，length 越界时回落到 `不限` 或首项，styleTags 仅保留 styles 内最多 8 项，keywords 最多 6 项且每项截到 12 字，idea 截到 120 字。当前作用域找不到选题返回 `XHS_TOPIC_NOT_FOUND`，传入母题返回 `XHS_TOPIC_CHILD_REQUIRED`，所属母题缺失返回 `XHS_TOPIC_PARENT_NOT_FOUND`。

`POST /api/xhs-topic/:id/article/generate` 同时承担首次生成与已有文章改写。服务从子选题实体读取 `articleStyle`，把它作为标题、叙事视角、语气、节奏和结构的持续约束注入文章 Agent，因此首次生文、批量生文与重新生成都会自动沿用关联风格。接口创建 `in_progress` Todo 后立即返回，Agent、配图和落库流程在后台继续执行；不同子选题互不阻塞并可同时生成，同一子选题在全部进程范围内拒绝重复启动（本进程集合 + 排队登记簿）。服务把已保存文章（标题、正文、标签、配图张数和发布形式）直接写进提示词，模型据此按用户提示词做局部修改或完全重写，再用 `xhs_article_submit` 一次交付整篇（没要求改动的部分照原文带上）。改写默认保留现有图片和画板数据，因此不再依赖图库标签；首次生成、没有现有图组或显式重新生成图片时，服务会读取所属母题的 `imageTags`：非空配置先与当前真实图库标签校验，然后直接作为本篇配图标签；空数组则由配图决策（节点 `xhs-article/image-decision`，关闭思考）从最多 300 个图库标签里选 2-5 个，失败按字面重合兜底，仍选不出返回 `XHS_ARTICLE_IMAGE_TAGS_NOT_SELECTED`。配置标签已全部从图库移除时返回 `XHS_ARTICLE_MOTHER_IMAGE_TAGS_UNAVAILABLE`，避免静默换用其他标签。Canvas 生文图片阶段生成一张封面和五张内页，版式由母题 `imageRule` 经 `XHS_MOTHER_IMAGE_RULE_LAYOUTS` 决定：`default` 为 5 拼图 + 末页 1 竖图，`collage-first` 为全拼图，`portrait-first` 为全竖图；凑不齐时**不换版式**，横图缺口优先报 `XHS_ARTICLE_LANDSCAPE_INSUFFICIENT`，否则竖图缺口报 `XHS_ARTICLE_PORTRAIT_INSUFFICIENT`，明细带需要与可用张数和图库标签。前端的子选题错误条据此给出「改用竖图 / 改用拼图」（重试时带 `imageRule` 仅本次覆盖，不改母题设置）和「允许重复」（重试时带 `allowImageRepeat`：忽略严格去重，未用图不够补已用图，仍不够在本篇内轮换复用，拼图至少 2 张横图、单图至少 1 张竖图即可）。母题锁定了配图标签且本次需要生成图片时，`start` 在扣费前先校验标签并试分配源图，不够直接以 400 返回同样的错误码；未锁定标签时由配图决策选标签并分配源图，这一步与写正文同时进行，图不够会在正文写完前就返回失败（已扣的生文费照常退）。取图去重模式为「优先不重复」：先采未用图、不够再补已用图，未用图总是先被分配，生成后标记已用，让下一篇继续避开；前端设置里打开「配图严格去重」时请求带 `dedup: true`，改为只取未用图。租户开启 AI 封面时走 `ai-overlay`：模型生成纯绿实底、指定主副标题与波普装饰融合的文字海报素材，真实照片不传给模型；sharp 输出合成预览和透明 PNG 素材，`canvasBoards` 另外保存 `baseSrc` 原照片以及带 `includesText` 标记的 `materials` 素材原图/去底图/特效参数。文章预览与发布继续使用合成封面，进入灵感画布后则还原成照片和含字图片素材两个独立图层；素材可移动、缩放、隐藏或重开图片特效。完整文章落库后状态才变为 `generated`。后台失败会把失败码写进 Todo `taskResult.error`，把中文原因写进 `taskResult.errorMessage` 与 `abnormalReason`。前端通过 `GET /api/xhs-topic/article/generations` 轮询每个子选题最近一次任务；查询同时读取 Todo 持久化状态并核对本进程排队 / 执行集合与 [排队登记簿](../generation-queue/module.md)（多进程时登记簿在主进程，能看到全部 worker 上的任务），若数据库仍显示运行但任何进程里都已不存在，第一次仅记录疑似中断，连续第二次确认仍缺失后才将 Todo 改为 `failed`，错误码为 `XHS_ARTICLE_GENERATION_INTERRUPTED`。正常运行任务每次都能通过运行实例确认，不会被误清理；服务重启遗留的陈旧状态也不会永久显示“生成中”。配图阶段的 `XHS_ARTICLE_IMAGE_WORKFLOW_INSUFFICIENT` 会附带本次使用的图库标签，便于用户判断该补哪些标签的图。

**失败退点**: `start` 先扣一次生文服务点数，扣费单号 `operationId` 同时带进队列任务并作为 `ai_service_charge` 关联资源挂在 Todo 上。以下情况按单号调 `AiBillingService.refundService` 原路退回：扣费后 `start` 内建 Todo 或入队失败；排队任务启动失败；`runGeneration` 在文章落库之前失败（落库之后即便回写 Todo 失败也算已交付，不退）；存活确认判定 `XHS_ARTICLE_GENERATION_INTERRUPTED` 且子选题文章的 `sourceTodoId` 不是该 Todo。退款幂等，同一笔最多退一次；退款出错只记日志，不改变 Todo 的失败原因。本次改动前创建的 Todo 没有扣费单号，中断时不退。

`GET /api/xhs-topic` 从 `xhs_topics` 返回当前租户用户的母子选题工作台，并在每个母题分组原样返回 `imageTags` 与 `imageRule`（历史数据缺省为 `default`）、在每个子题原样返回 `articleStyle`；同时通过 `articles.source=xhs-topic` 与 `meta.xhsTopicId` 过滤已经存入选题文章库的子题，历史已入库文章同样生效，库内文章删除后对应子题会重新出现。无租户账号同时兼容历史缺失字段与 MongoDB 序列化的 `null`；`POST /api/xhs-topic` 将用户确认的候选、母题 `imageTags` 及子题 `articleStyle` 批量入库并返回最新工作台；`PATCH /api/xhs-topic/:id` 更新标题、类型、状态、母题 `imageTags` / `imageRule` 或子题 `articleStyle`，空值可恢复对应默认链路；`POST` 创建母题时同样可带 `imageRule`；`DELETE /api/xhs-topic` 删除当前用户指定选题，母题命中时级联删除所有子题。入口分别声明 `read/create/update/delete XhsTopic` 权限。

**租户清理设置**：过期清理由租户自己设置，不再由平台统一处理。`GET /api/xhs-topic/cleanup-settings` 返回 `{ settings, defaults }`，`PUT` 接收 `{ motherTopic?, draftArticle?, libraryArticle? }`，每项为 `{ enabled, retentionDays, maxCount }`（天数 1–3650，数量 0–100000，`0` 表示不限），未传的对象保持原值，返回 `{ settings }`。设置存在 `xhs_topic_cleanup_settings`，按 `scopeKey`（租户 ID，无租户为 `__platform__`）唯一；租户内成员都能读写。租户没保存过时使用平台默认值：母题开启、天数读 `XHS_TOPIC_IDLE_DAYS`（默认 30）；草稿开启、天数读 `XHS_DRAFT_RETENTION_DAYS`（默认 7）；文章库关闭（开启时默认 90 天）；数量都不限，因此老租户行为不变。数量上限的口径：母题与草稿按成员各自计算（选题本身按租户 + 成员隔离），文章库按整个租户合计（库是租户共享的，未发布文章计入总数但不会被删）。超出上限时先扣掉按天数已选中的条目，剩余超出部分从时间最早的可清理条目开始清；星标、已入库保护、生成中与租约中的条目计数但不清，所以上限可能腾不满。

**星标与闲置清理**：母题创建时写入 `starred=false` 与当前 `lastActiveAt`；修改母题、批量创建或修改子题、文章生成落库及文章编辑都会刷新所属母题的活动时间。工作台按星标优先、其余按 `createdAt` 降序排列母题，子题也按 `createdAt` 降序，并返回 `starred`、`lastActiveAt`、`idleCleanupAt`（星标、已入库保护或租户关闭母题清理时为 null）。`PATCH /api/xhs-topic/:id` 接受 `starred`，只对母题生效，子题传入时忽略。闲置期限与数量上限取租户 `motherTopic` 规则；未星标、名下没有任何已存入文章库子题的母题才会在超过期限或超出上限时连同子题级联删除，删除前复核没有被星标或刷新活动时间。启动时先为缺 `lastActiveAt` 的历史母题回填当前时间，确保完整宽限期。

**草稿自动清理**：文章生成落库、文章编辑及 `POST /api/xhs-topic/:id/article/touch-draft` 都会刷新 `article.draftAt`；工作台在文章存在且租户开启草稿清理时返回 `draftCleanupAt`，`touch-draft` 在关闭时返回 `draftCleanupAt: null`。保留期限与数量上限取租户 `draftArticle` 规则；只清空未存入文章库且没有等待中或运行中生文任务的子题 `article`，并把状态恢复为 `pending`，子题标题继续保留；清空时以观察到的草稿时钟为条件，期间被编辑过的草稿不会被误清。启动时为缺 `draftAt` 的历史文章回填当前时间。`touch-draft` 用于文章从文章库恢复为草稿后重新获得完整保留期。

**文章库自动清理**：租户开启 `libraryArticle` 后，每日清理删除该租户超过保留期（按 `publishedAt`，缺失时按 `updatedAt`）或超出数量上限的**已发布**文章，未发布与租约中的文章不删；删除走 `ArticleService.delete`，会同步停止对应的抓取调度。来源为选题（`source=xhs-topic`）的文章被删后，如果同一子题没有再存进别的库，会同时清空子题 `article` 并恢复 `pending`，不会以草稿形式回到选题页。

**清理调度**：定时器只在 leader 进程上跑，每小时检查、每 24 小时实际执行一次并 `unref`。每次遍历所有有选题或已发布文章的租户，按各自设置依次清理文章库 → 草稿 → 母题（文章库清理会解除子题的入库保护，母题判断随后才能看到最新状态）；单个租户失败只记日志，不影响其他租户。删除与条件 `$unset` 均可安全重复执行，多实例并发结果幂等。

**入口鉴权**：

| 入口 | 权限 | 说明 |
| --- | --- | --- |
| `POST /api/xhs-topic/:id/article/touch-draft` | `update XhsTopic` | 同方法声明 `AdminAuthGuard`、`AdminPoliciesGuard` 与 `RequirePermission`；当前作用域内子题没有文章时返回 404 |
| `POST /api/xhs-topic/:id/article/requirements/recommend` | `create XhsTopic` | 同方法声明 `AdminAuthGuard`、`AdminPoliciesGuard` 与 `RequirePermission`；仅允许读取当前作用域内子题及其母题 |
| `GET /api/xhs-topic/cleanup-settings` | `read XhsTopic` | 同方法声明 `AdminAuthGuard`、`AdminPoliciesGuard` 与 `RequirePermission`；只返回当前租户设置 |
| `PUT /api/xhs-topic/cleanup-settings` | `update XhsTopic` | 同方法声明 `AdminAuthGuard`、`AdminPoliciesGuard` 与 `RequirePermission`；租户内成员（含操作员）都可修改，只写当前租户 |

`PATCH /api/xhs-topic/:id/article` 同时接受生成阶段的 `cover/inner` 画板和灵感画布保存的 `edited` 画板。编辑态使用版本化 `editorState` 保存模板、120~1600 像素画板尺寸及最多 200 个有序图层，重新进入灵感画布时可恢复上次编辑结果；原有封面素材、拼图与文章图片结构继续兼容。

**后台可按节点指定模型**：选题生成、子选题提示词推荐与生成需求推荐使用 [workflow-model](../workflow-model/module.md) 的 `xhs-article/topic` 节点，写文章使用 `xhs-article/article` 节点，配图决策使用 `xhs-article/image-decision` 节点（建议指定响应快的模型）；节点未指定时沿用后台默认文本提供商。

**生成提速（一次交付 + 配图并行）**：原来文章 Agent 走 DeepAgent 工具循环——先读旧文、再按需搜索、标题 / 正文各写一次、文章标签与图库标签逐个追加、最后收尾，十几轮串行请求且每轮都重发 DeepAgent 的内置提示词和最多 300 个图库标签；配图（拼图逐张合成 → 封面文案 → AI 封面）全部排在文章写完之后。现在 `runGeneration` 同时启动两条线：① `writeArticle` 用轻量 Agent（`AgentConfig.lightweight`，只挂 DuckDuckGo 搜索与 `xhs_article_submit`，交付工具 `returnDirect` 交付即结束；没有搜索工具时直接一次结构化输出），保留模型默认思考；② `prepareArticleVisuals` 做配图决策（关闭思考）并按规则分配源图。两条线用 `Promise.all` 汇合，配图准备先失败会立刻抛出。之后 Canvas 渲染时封面底图、各内页拼图合成入库与封面文案（关闭思考）同时进行，AI 封面在底图与文案都就绪后生成。内页与封面底图不再等正文：源图一分好就开始渲染（`renderArticleImageGroups` 的 `articlesReady` 钩子），只有封面文案与 AI 封面等标题到了再出。仍然串行、无法再压的是「写正文 → 封面文案 → AI 封面生图」这条链，其中 AI 生图单张约 30-45 秒是大头，要再快只能给 `cover-overlay` 节点换更快的生图模型。源图从配图准备到渲染之间多了写正文这段窗口，严格去重模式下同租户同时生成的两篇仍可能分到同一张图（原来窗口更短但同样存在）。

**拼图成品指纹**：生成时拼图成品就是这组格子按默认焦点画出的，`toCanvasBoardCollage` 用 `computeXhsCollageRenderKey` 写入 `collage.renderedKey`。用户在工作台改格子（换图、焦点、缩放、换模板）只改 `canvasBoards`，指纹随之失配；保存到文章库时工作台只重合成失配的页，合成后把新指纹经 `PATCH /api/xhs-topic/:id/article` 写回。`normalizeCanvasCollage` 只保留、不重算指纹——重算会把改过但还没重合成的格子误判为最新。算法与工作台 `articleCanvasBoard.js` 的 `computeCollageRenderKey` 必须一致，`xhs-article-collage-key.spec.ts` 与工作台 `test/collage-render-key.test.cjs` 用同一组样例锁定结果；改规则时升级 `c1-` 前缀，旧指纹自然失配、首次保存重合成一次。

**渐进显示（阶段产出）**：`runGeneration` 用 `XhsArticleGenerationProgressReporter` 把阶段产出写进运行中 Todo 的 `taskResult.progress`：正文完整校验后写标题、正文与标签；源图分配完成写计划张数；每张内页就绪写一次，封面先写无字底图（`final=false`）、成品封面就绪后同槽位替换。写入单路在途、期间的变化合并成下一次写入，一篇文章约 3-8 次；落库或失败前先 `close`，终态结果不会被晚到的阶段写入覆盖。阶段写入会刷新 Todo `updatedAt`，因此 `listGenerations` 在运行态额外返回 `startedAt`（出队时刻）与 `progress`，前端进度以 `startedAt` 为起点。正文先失败时已开始的内页渲染会继续跑完但结果作废（图库里留下动态拼图，源图不标已用）。

**并发排队**：文章任务经 [AI 生成排队](../generation-queue/module.md) 的 `xhs-article` 通道排队，全平台上限读平台信息 `xhsArticleGlobalConcurrencyLimit`（默认 4），租户上限读 `xhsArticleConcurrencyLimit`（默认 2）；`listGenerations` 每次轮询都会 `requestDrain`，后台调高上限后立即补位。排队逻辑原来写在本服务里，现在与抖音生成共用同一套机制、各自上限。

**失败信息分层**：失败结果分三层下发——`error` 是失败码，`errorMessage` 是给用户看的短文案（Todo `abnormalReason` 同步写它），`errorDetail` 是原始明细（底层异常原文、生文不完整时模型的交付问题，截 2000 字）。模型输出解析失败、网络异常这类未知错误不再把异常原文当失败码，统一记为 `XHS_ARTICLE_GENERATION_FAILED`「文章生成失败，请稍后重试。」，原文进 `errorDetail` 与服务端错误日志（带堆栈）；工作台只展示 `errorMessage`，把 `errorDetail` 打到控制台并收录进运维上报。历史记录由 `readTodoFailure` 读取时按同一规则收敛，无需迁移数据。
