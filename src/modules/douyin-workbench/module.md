# 模块名称 (Module Name)

AI 抖音工作台（douyin-workbench）

## 概述 (Overview)

提供租户隔离的抖音母选题、LLM 子选题、逐段分镜持久化，以及生成视频、发布视频和作品数据抓取直连接口。母题由用户创建；子题综合母题、租户或母平台 AI 提示词与用户补充要求生成，生成数量由 LLM 自主规划，内容类型在服务端固定为短视频。支持由 LLM 推荐一条可编辑的生成要求。分镜使用项目现有 LLM 并按 `text-generation` 服务一次扣费；其他三类操作只调用显式配置的 HTTP 服务，不会隐式使用 SuperClaw，也不会产生模拟结果。

## 文件清单 (File List)

- `douyin-workbench.module.ts` — NestJS 模块入口与依赖装配（含分镜自动配图所需的 `GalleryModule`）。
- `controller/douyin-workbench.controller.ts` — 抖音工作台鉴权 REST 接口。
- `controller/douyin-workbench.dto.ts` — 选题、分镜、生成、发布和抓取输入校验。
- `entities/douyin-workbench.entity.ts` — 选题、分镜、素材引用和直连调用实体。
- `services/douyin-workbench-repository.service.ts` — MongoDB 母子选题、分镜和素材归属持久化。
- `services/douyin-child-topic-generation.service.ts` — 综合母题和平台 AI 提示词的 LLM 子选题生成。
- `services/douyin-storyboard-generation.service.ts` — LLM 工具调用式分镜生成。
- `services/douyin-generation-job.service.ts` — 分镜 / 子选题后台生成任务：立即返回、后台执行、进度写库、失败原因翻译与中断收敛。
- `services/douyin-storyboard-image.service.ts` — 分镜自动配图：从租户图库挑选相关候选图、生成选图清单、按镜头文字相关度自动补图。
- `services/douyin-operation.service.ts` — 视频生成、发布、抓取直连请求与调用审计。
- `config.example.env` — 三类直连接口地址、密钥与状态查询模板示例。

## 函数清单 (Function List)

- `DouyinWorkbenchModule()` — 装配抖音真实业务能力 | keywords: 抖音工作台模块, 视频业务编排, douyin-workbench-module, video-business-orchestration
- `DouyinMediaReferenceDto()` — 校验真实素材引用 | keywords: 分镜素材参数, 真实素材引用, storyboard-media-dto, persisted-media-reference
- `DouyinStoryboardShotDto()` — 校验单段分镜字段 | keywords: 分镜段落参数, 镜头编辑, storyboard-shot-dto, shot-editing
- `CreateDouyinMotherTopicDto()` — 校验人工母选题创建参数 | keywords: 新建抖音母题, 人工母题, create-douyin-mother, manual-mother-topic
- `GenerateDouyinChildrenDto()` — 校验 AI 子选题的可选生成要求 | keywords: 生成抖音子题, 平台提示词, generate-douyin-children, platform-ai-prompt
- `UpdateDouyinTopicDto()` — 校验选题及完整分镜更新 | keywords: 更新抖音选题, 保存分镜, update-douyin-topic, save-storyboard
- `GenerateDouyinStoryboardDto()` — 校验 LLM 分镜补充要求 | keywords: 生成分镜参数, 创作要求, generate-storyboard-dto, creative-requirement
- `GenerateDouyinVideoDto()` — 校验视频生成补充提示 | keywords: 生成视频参数, 分镜合成, generate-video-dto, storyboard-rendering
- `PublishDouyinVideoDto()` — 校验视频库素材和发布文案 | keywords: 发布视频参数, 抖音文案, publish-video-dto, douyin-caption
- `CrawlDouyinDataDto()` — 校验真实作品 ID | keywords: 抓取抖音数据, 视频作品标识, crawl-douyin-data, published-video-id
- `DouyinWorkbenchRepositoryService()` — 管理抖音选题和分镜持久化 | keywords: 抖音工作台仓储, 租户隔离, douyin-workbench-repository, tenant-isolation
- `ensureIndexes()` — 创建抖音选题或调用记录索引 | keywords: 抖音选题索引, 父子查询, douyin-topic-indexes, parent-child-query
- `listWorkspace(scope)` — 返回真实母子选题聚合 | keywords: 查询抖音工作台, 母子聚合, list-douyin-workspace, parent-child-aggregation
- `create(input,scope)` — 人工新建母选题 | keywords: 新建抖音母题, 人工母题, create-douyin-mother, manual-mother-topic
- `createChildren(parentId,titles,scope)` — 批量保存 LLM 子选题并固定短视频类型 | keywords: 保存AI子选题, 固定短视频, persist-ai-child-topics, fixed-short-video
- `get(id,scope)` — 按作用域读取选题 | keywords: 读取抖音选题, 所有权校验, get-douyin-topic, ownership-check
- `update(id,input,scope)` — 保存选题、分镜或成片绑定 | keywords: 更新抖音选题, 持久化分镜, update-douyin-topic, persist-storyboard
- `remove(id,scope)` — 删除选题并级联子题 | keywords: 删除抖音选题, 级联删除, delete-douyin-topic, cascade-delete
- `requireVideo(id,scope)` — 校验真实视频库记录 | keywords: 校验视频素材, 视频库归属, require-video-asset, video-library-ownership
- `validateStoryboardMedia(storyboard,scope)` — 阻止伪造图库和视频库引用 | keywords: 校验分镜素材, 防伪造引用, validate-storyboard-media, prevent-forged-reference
- `nextId()` — 生成抖音选题业务 ID | keywords: 抖音选题自增ID, 计数器, next-douyin-topic-id, counter
- `scopeFilter(scope)` — 构造租户用户过滤 | keywords: 抖音作用域过滤, 用户隔离, douyin-scope-filter, user-isolation
- `tenantFilter(tenantId?)` — 构造租户或母平台数据边界 | keywords: 母平台数据边界, 租户过滤, platform-data-boundary, tenant-filter
- `toView(row)` — 移除数据库 ID | keywords: 抖音选题视图, 隐藏数据库ID, douyin-topic-view, hide-database-id
- `DouyinChildTopicGenerationService()` — 综合创作上下文生成抖音子选题 | keywords: 抖音子题生成, 平台AI提示词, douyin-child-generation, platform-ai-prompt
- `generate(parentId,input,scope,onProgress?)` — 由 LLM 自主规划数量并生成差异化短视频子选题，`onProgress` 回报规划数量与已写入条数 | keywords: 生成AI子选题, LLM自主数量, generate-ai-child-topics, llm-decided-count
- `recommendPrompt(parentId,scope)` — 根据完整上下文推荐可编辑的生成要求 | keywords: 推荐抖音子题提示, 母题上下文, recommend-douyin-child-prompt, mother-topic-context
- `loadGenerationContext(parentId,scope)` — 读取母题、平台提示和已有子题 | keywords: 读取子题生成上下文, 已有子题, load-child-generation-context, existing-child-topics
- `createPlanTool(plan,onProgress?)` — 让 LLM 在安全范围内自主规划子题数量，规划后回报总数 | keywords: 子题数量规划, LLM自主数量, child-topic-count-plan, llm-decided-count
- `createCandidateTool(candidates,existingTitles,plan,onProgress?)` — 创建子题写入与标题去重工具，每写入一条回报进度 | keywords: 子题追加工具, 标题去重, child-topic-append-tool, title-deduplication
- `buildSystemPrompt(input)` — 合并创作上下文并要求 LLM 自主规划数量 | keywords: 构造子题提示词, 固定短视频, build-child-topic-prompt, fixed-short-video
- `runAgent(system,tools,expectedCount?,platformPrompt,scope)` — 执行数量规划与子题工具调用 Agent | keywords: 执行子题Agent, 工具结果, run-child-topic-agent, tool-result-only
- `readAgentText(result)` — 从 Agent 响应读取推荐提示文本 | keywords: 读取Agent文本, 推荐提示, read-agent-text, prompt-recommendation
- `DouyinStoryboardGenerationService()` — 使用 LLM 生成结构化分镜 | keywords: 抖音分镜生成, 结构化工具调用, douyin-storyboard-generation, structured-tool-call
- `generate(topicId,prompt,scope,onProgress?)` — 先从图库挑候选图，按生文服务扣费后生成并保存四至十二段分镜，LLM 没选图的镜头自动补图，`onProgress` 回报已写入段数 | keywords: 生成真实分镜, 保存镜头脚本, 分镜自动配图, generate-real-storyboard, persist-shot-script, storyboard-auto-image
- `createShotTool(shots,candidates,onProgress?)` — 创建逐段分镜写入工具，`image_id` 只接受候选清单内的图片，重复用图时提示换图，每写入一段回报进度 | keywords: 分镜追加工具, 内存写入, 分镜选图, storyboard-append-tool, memory-write, storyboard-image-pick
- `DOUYIN_GENERATION_STALE_MS` — 运行中任务无进度写入且不在当前进程超过 10 分钟即判定中断 | keywords: 任务中断判定, 静默超时, job-interrupted-threshold, silent-timeout
- `DOUYIN_GENERATION_ERROR_MESSAGES` — 后台生成失败码与中文原因对照表 | keywords: 生成失败原因, 错误码翻译, generation-failure-reason, error-code-translate
- `DouyinGenerationJobService()` — 分镜与子选题的后台生成任务服务 | keywords: 后台生成任务, 异步生成, background-generation-job, async-generation
- `DouyinGenerationJobService.ensureIndexes()` — 创建任务 ID、作用域时间线与同选题运行态索引 | keywords: 生成任务索引, 运行态查询, generation-job-indexes, running-state-query
- `DouyinGenerationJobService.start(kind,topicId,prompt,scope)` — 校验选题类型、拦截同选题重复任务，写入运行中任务后立即返回 | keywords: 启动后台生成, 重复任务拦截, start-background-generation, duplicate-job-guard
- `DouyinGenerationJobService.list(scope)` — 读取运行中与最近 24 小时的任务，先收敛中断任务 | keywords: 查询生成任务, 进度轮询, list-generation-jobs, progress-polling
- `DouyinGenerationJobService.run(job,scope)` — 后台执行生成、进度写库，成功写结果、失败写失败码与中文原因 | keywords: 执行后台生成, 进度写库, run-background-generation, persist-progress
- `DouyinGenerationJobService.settleStaleJobs(scope)` — 把服务中断遗留的运行中任务收进失败终态 | keywords: 收敛中断任务, 僵尸任务, settle-stale-jobs, zombie-job
- `DouyinGenerationJobService.describeError(code)` — 翻译失败码，含子选题数量不足的动态码 | keywords: 生成失败原因, 错误码翻译, generation-failure-reason, error-code-translate
- `DouyinGenerationJobService.scopeFilter(scope)` — 构造任务的租户用户过滤 | keywords: 任务作用域过滤, 用户隔离, job-scope-filter, user-isolation
- `DouyinGenerationJobService.toView(row)` — 去掉数据库字段与原始提示词 | keywords: 生成任务视图, 隐藏内部字段, generation-job-view, hide-internal-fields
- `runAgent(title,topicType,requirement,imagePrompt,shots,addShot,scope)` — 调用默认 LLM 完成抖音分镜，并附上候选图片清单逐段选图 | keywords: 执行分镜Agent, 抖音创作约束, run-storyboard-agent, douyin-creative-constraints
- `STORYBOARD_IMAGE_CANDIDATE_LIMIT` — 一次分镜生成最多给 LLM 的候选图数量（40） | keywords: 候选图片上限, 上下文预算, image-candidate-limit, context-budget
- `STORYBOARD_EXCLUDED_IMAGE_TAGS` — 不参与分镜配图的封面与 AI 素材系统标签 | keywords: 排除系统标签, 封面素材, excluded-system-tags, cover-material
- `toCandidate(image)` — 把图库实体转成候选图，缺地址返回 null | keywords: 图库转候选, 候选图片, gallery-to-candidate, storyboard-image-candidate
- `toImageMediaReference(candidate)` — 候选图转分镜素材引用，结构与前端手动引用一致 | keywords: 候选转素材引用, 分镜素材, candidate-to-media-reference, storyboard-media
- `buildImageCandidatePrompt(candidates)` — 生成 `#ID｜竖/横｜标签｜描述` 的候选清单与选图规则 | keywords: 候选图片清单, 选图提示词, image-candidate-list, image-pick-prompt
- `scoreImageForShot(shot,candidate)` — 按标签命中与描述二字片段重合给镜头配图打分 | keywords: 镜头配图打分, 标签重合, shot-image-score, tag-overlap
- `autoAssignShotImages(shots,candidates)` — 给没有素材的镜头补图：少用的优先、同用量比得分、再比相关度顺序；不动已有素材 | keywords: 自动补图, 镜头配图, auto-assign-shot-images, shot-image-match
- `DouyinStoryboardImageService({ gallery })` — 分镜候选图服务 | keywords: 分镜候选图片, 自动配图, storyboard-image-candidate, auto-image-attach
- `DouyinStoryboardImageService.loadCandidates(query,scope)` — 按向量检索 → 标签命中 → 随机补足收集最多 40 张去重候选，排除拼图、封面与 AI 素材，任一路失败不影响分镜 | keywords: 收集候选图片, 相关度排序, load-image-candidates, relevance-order
- `DouyinOperationService()` — 管理三类直连操作及持久化审计 | keywords: 抖音直连接口, 禁止隐式节点, douyin-direct-api, no-implicit-super-claw
- `ensureIndexes()` — 创建直连调用记录索引 | keywords: 抖音调用索引, 操作查询, douyin-operation-indexes, operation-query
- `createGeneration(topicId,prompt,user)` — 直连视频生成并写服务扣费流水 | keywords: 直连视频生成, 生视频扣费, direct-video-generation, video-service-charge
- `createPublish(topicId,input,user)` — 直连发布真实视频库素材 | keywords: 直连抖音发布, 真实视频素材, direct-douyin-publish, real-video-asset
- `createCrawl(topicId,platformVideoId,user)` — 直连抓取真实作品指标 | keywords: 直连抖音抓取, 真实作品数据, direct-douyin-crawl, real-published-metrics
- `list(scope)` — 查询真实直连调用结果 | keywords: 查询抖音调用, 真实接口结果, list-douyin-operations, real-api-result
- `sync(id,user)` — 同步异步供应商状态 | keywords: 同步抖音调用状态, 异步任务查询, sync-douyin-operation, async-job-status
- `invoke(operation,topicId,request,config,scope,operationId?)` — 调用外部接口并写审计 | keywords: 调用抖音外部接口, 保存调用审计, invoke-douyin-external-api, persist-call-audit
- `fetchJson(url,init,apiKey?)` — 发起超时受控 JSON 请求 | keywords: 抖音HTTP请求, 超时控制, douyin-http-request, timeout-control
- `readConfig(operation)` — 读取显式直连配置 | keywords: 读取抖音直连配置, 缺配置拒绝, read-douyin-direct-config, reject-unconfigured
- `readExternalId(response)` — 兼容读取外部任务 ID | keywords: 解析外部任务ID, 供应商兼容, parse-external-job-id, provider-compatibility
- `readStatus(response)` — 解析供应商状态 | keywords: 解析外部状态, 受理状态, parse-external-status, accepted-status
- `readError(response)` — 解析供应商错误 | keywords: 解析外部错误, 调用失败原因, parse-external-error, call-failure-reason
- `readGeneratedVideoId(result)` — 读取真实视频库成片 ID 并用于自动绑定 | keywords: 读取生成视频ID, 自动绑定成片, read-generated-video-id, auto-bind-output
- `requireChild(topicId,scope)` — 校验子题操作所有权 | keywords: 校验抖音子选题, 操作所有权, require-douyin-child, operation-ownership
- `scopeOf(user)` — 生成租户用户作用域 | keywords: 抖音用户作用域, 租户身份, douyin-user-scope, tenant-identity
- `tenantFilter(tenantId?)` — 过滤直连记录租户边界 | keywords: 抖音租户过滤, 母平台边界, douyin-tenant-filter, platform-boundary
- `toView(row)` — 隐藏请求与数据库字段 | keywords: 抖音调用安全视图, 隐藏请求字段, douyin-operation-view, hide-request-fields
- `DouyinWorkbenchController()` — 暴露带同址权限声明的 REST 接口 | keywords: 抖音工作台接口, 真实业务接口, douyin-workbench-controller, real-business-api
- `list(req)` — 查询真实选题分镜 | keywords: 查询抖音工作台, 分镜列表, get-douyin-workspace, storyboard-list
- `create(req,dto)` — 人工创建真实母选题 | keywords: 新建抖音母题接口, 返回工作台, create-douyin-mother-api, return-workspace
- `generateChildren(req,id,dto)` — 启动后台子选题生成并立即返回运行中任务 | keywords: AI生成抖音子题接口, 平台提示词, generate-douyin-children-api, platform-ai-prompt
- `listGenerationJobs(req)` — 查询运行中与最近 24 小时的后台生成任务 | keywords: 查询生成任务接口, 进度轮询, list-generation-jobs-api, progress-polling
- `recommendChildPrompt(req,id)` — 推荐可编辑的子选题生成要求 | keywords: 推荐抖音子题提示接口, AI生成要求, recommend-douyin-child-prompt-api, ai-generation-requirement
- `update(req,id,dto)` — 更新选题或保存分镜 | keywords: 更新抖音选题接口, 保存分镜接口, update-douyin-topic-api, save-storyboard-api
- `remove(req,id)` — 删除选题并级联清理 | keywords: 删除抖音选题接口, 级联清理, delete-douyin-topic-api, cascade-cleanup
- `generateStoryboard(req,id,dto)` — 启动后台 LLM 分镜生成并立即返回运行中任务 | keywords: 生成抖音分镜接口, 真实LLM, generate-douyin-storyboard-api, real-llm
- `generateVideo(req,id,dto)` — 调用视频生成服务 | keywords: 生成视频任务接口, 服务扣费, generate-video-task-api, service-charge
- `publish(req,id,dto)` — 调用抖音发布服务 | keywords: 发布抖音视频接口, 真实视频素材, publish-douyin-video-api, real-video-asset
- `crawl(req,id,dto)` — 调用作品数据服务 | keywords: 抓取抖音数据接口, 真实作品, crawl-douyin-data-api, real-published-video
- `listOperations(req)` — 查询直连调用记录 | keywords: 查询抖音任务接口, 供应商响应, list-douyin-operations-api, provider-response
- `syncOperation(req,id)` — 同步供应商异步状态 | keywords: 同步抖音任务接口, 供应商状态, sync-douyin-operation-api, provider-status
- `readId(value)` — 校验路由业务 ID | keywords: 解析抖音业务ID, 路由校验, parse-douyin-business-id, route-validation
- `requireUser(req)` — 读取鉴权用户 | keywords: 读取抖音用户, 鉴权上下文, read-douyin-user, auth-context
- `scopeOf(user)` — 构造控制器数据边界 | keywords: 构造抖音作用域, 用户边界, build-douyin-scope, user-boundary

## 关键词索引 (Keyword Index)

| 中文         | English                      |
| ------------ | ---------------------------- |
| 抖音工作台   | douyin-workbench             |
| 母子选题     | parent-child-topics          |
| AI子选题生成 | generate-douyin-children     |
| LLM自主数量  | llm-decided-count            |
| AI生成要求   | ai-generation-requirement    |
| 平台AI提示词 | platform-ai-prompt           |
| 固定短视频   | fixed-short-video            |
| 分镜生成     | douyin-storyboard-generation |
| 真实LLM      | real-llm                     |
| 直连视频生成 | direct-video-generation      |
| 直连抖音发布 | direct-douyin-publish        |
| 真实作品数据 | real-published-metrics       |
| 租户隔离     | tenant-isolation             |
| 服务扣费     | service-charge               |
| 禁止隐式节点 | no-implicit-super-claw       |
| 后台生成任务 | background-generation-job    |
| 异步生成     | async-generation             |
| 进度轮询     | progress-polling             |
| 进度写库     | persist-progress             |
| 重复任务拦截 | duplicate-job-guard          |
| 收敛中断任务 | settle-stale-jobs            |
| 生成失败原因 | generation-failure-reason    |
| 分镜自动配图 | storyboard-auto-image        |
| 分镜选图     | storyboard-image-pick        |
| 分镜候选图片 | storyboard-image-candidate   |
| 候选图片清单 | image-candidate-list         |
| 自动补图     | auto-assign-shot-images      |
| 镜头配图打分 | shot-image-score             |
| 收集候选图片 | load-image-candidates        |

## 类型导出 (Type Exports)

- `DouyinMediaReference` / `DouyinStoryboardShot` / `DouyinTopicEntity` / `DouyinWorkspaceGroup` / `DouyinOperationView` / `DouyinOperationEntity`。
- `DouyinGenerationJobKind` / `DouyinGenerationJobProgress` / `DouyinGenerationJobView` / `DouyinGenerationJobEntity` — 后台生成任务类型、真实进度（阶段 + 已写入数 + 子选题规划总数）、前端视图与持久化实体。
- `StoryboardImageCandidate` — 分镜自动配图的候选图（编号、名称、原图与缩略图地址、标签、描述、是否竖图）。
- `DouyinMediaReferenceDto` / `DouyinStoryboardShotDto` / `CreateDouyinMotherTopicDto` / `GenerateDouyinChildrenDto` / `UpdateDouyinTopicDto` / `GenerateDouyinStoryboardDto` / `GenerateDouyinVideoDto` / `PublishDouyinVideoDto` / `CrawlDouyinDataDto`。

## 模块功能描述 (Module Feature Description)

接口前缀为 `/api/douyin-workbench`，全部使用 `AdminAuthGuard`、`AdminPoliciesGuard` 并在路由注册处声明 `DouyinWorkbench` 权限。`POST topics` 只接受人工母选题；`POST topics/:id/children/prompt/recommend` 根据母题、平台提示和已有子题返回一条可编辑的 AI 推荐要求。`POST topics/:id/children/generate` 调用默认 LLM，综合母选题、租户平台 AI 提示词（母平台作用域读取全局配置）与可选用户要求，先通过 `douyin_workbench_plan_child_topics` 自主决定三至十二项的合理数量，再通过 `douyin_workbench_add_child_topic` 逐条生成并保存。子选题不接收数量或内容类型，仓储统一写入 `短视频`。`douyin_topics` 保存母子选题和完整分镜，素材引用保存前会按当前租户检查 `gallery_images` 或 `videos` 真实记录。

分镜接口 `POST topics/:id/storyboard/generate` 先按 `text-generation` 当前后台定价扣一次 Credit，再复用默认 LLM，并在该调用链内关闭 Provider 重复扣费；母平台作用域不扣点。分镜通过 `douyin_workbench_add_storyboard_shot` 工具逐段收集四至十二段结构化结果。视频生成、发布和抓取分别读取 `DOUYIN_VIDEO_GENERATION_*`、`DOUYIN_PUBLISH_*`、`DOUYIN_DATA_*` 配置；未设置 `*_URL` 时返回 `*_NOT_CONFIGURED`。可选 `*_STATUS_URL_TEMPLATE` 用 `{id}` 占位同步异步状态；视频生成响应返回已登记到 `video-library` 的 `videoId` 后，子选题自动绑定该成片。模块没有 SuperClaw、Todo 或 Workspace 依赖。

**分镜与子选题改为后台异步生成**：`POST topics/:id/storyboard/generate` 与 `POST topics/:id/children/generate` 不再等 LLM 跑完，`DouyinGenerationJobService.start` 校验选题类型（分镜要子选题、子选题要母选题）、拦截同一选题正在运行的同类任务（409 `DOUYIN_GENERATION_ALREADY_RUNNING`），在 `douyin_generation_jobs` 写入运行中任务后立即返回 `{ job }`，生成在后台继续。两个生成服务通过 `onProgress` 回报真实进度：分镜每写入一段报一次段数，子选题规划后报总数、每写入一条报已写数，最后进入 `saving`。完成写 `result`（分镜段数，或规划数量与新子选题 ID），失败写失败码和 `DOUYIN_GENERATION_ERROR_MESSAGES` 翻译的中文原因（扣费不足等错误也以失败任务的形式出现，而不是接口直接报错）。`GET generation-jobs`（`read DouyinWorkbench`）返回运行中与最近 24 小时的任务供前端轮询；读取与启动前会把「运行中但不在当前进程、且 10 分钟没有进度写入」的任务收成 `DOUYIN_GENERATION_INTERRUPTED`，避免服务重启后永远显示生成中。

**分镜自动配图（目前只配图片）**：分镜生成前，`DouyinStoryboardImageService.loadCandidates` 用「母题 + 子题 + 补充要求」在当前租户图库挑候选图：先走 `GalleryService.searchSimilar` 向量检索（相似度 ≥0.35 的普通图），再按命中这段文字的图库标签随机取图，不够再随机补普通图，去重后最多 40 张；拼图、各类封面与 `ai素材` 一律排除。候选以 `#ID｜竖/横｜标签｜描述` 的清单写进系统提示词，分镜工具新增可选参数 `image_id`，只接受清单内的编号（清单外的编号直接忽略、该段留空），同一张图重复使用时工具回话提示换图。LLM 交付完成后，`autoAssignShotImages` 给仍然没有素材的镜头补图：使用次数少的优先，其次比镜头文字与标签/描述的重合得分，再按候选相关度顺序，候选全部用过一轮后才会重复。写入的素材结构与前端手动「引用素材」一致（`type=image`、`url`、缩略图 `coverUrl`），保存时照常经过 `validateStoryboardMedia` 的租户归属校验；图库为空或读取失败时分镜照常生成，只是不配图。模块因此新增依赖 `GalleryModule`。
