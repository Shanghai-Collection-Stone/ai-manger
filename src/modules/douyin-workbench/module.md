# 模块名称 (Module Name)

AI 抖音工作台（douyin-workbench）

## 概述 (Overview)

提供租户隔离的抖音母选题、LLM 子选题、逐段分镜持久化，以及生成视频、发布视频和作品数据抓取直连接口。母题由用户创建；子题综合母题、租户或母平台 AI 提示词与用户补充要求生成，生成数量由 LLM 自主规划，内容类型在服务端固定为短视频。支持由 LLM 推荐一条可编辑的生成要求。分镜使用项目现有 LLM 并按 `text-generation` 服务一次扣费；其他三类操作只调用显式配置的 HTTP 服务，不会隐式使用 SuperClaw，也不会产生模拟结果。
每条脚本可选一个 [预设人物](../douyin-persona/module.md)（决定出镜人物的长相、叙事视角与成片音色）、一种脚本风格（决定口播调性与画面质感），以及最多 4 张来自租户图库的参考图。AI 出图偏向下逐镜出图为线性串行：第 N 镜以第 N-1 镜刚生成的画面为底图，叠加人物形象图与脚本参考图，换取镜头之间场景、色调与人物状态的连贯。

## 文件清单 (File List)

- `douyin-workbench.module.ts` — NestJS 模块入口与依赖装配（含分镜自动配图所需的 `GalleryModule`、按节点取模型的 `WorkflowModelModule`）。
- `controller/douyin-workbench.controller.ts` — 抖音工作台鉴权 REST 接口。
- `controller/douyin-workbench.dto.ts` — 选题、分镜、生成、发布和抓取输入校验。
- `entities/douyin-workbench.entity.ts` — 选题、分镜、素材引用和直连调用实体。
- `services/douyin-workbench-repository.service.ts` — MongoDB 母子选题、分镜和素材归属持久化。
- `services/douyin-child-topic-generation.service.ts` — 综合母题和平台 AI 提示词的 LLM 候选脚本生成（不入库）。
- `services/douyin-storyboard-generation.service.ts` — LLM 工具调用式分镜生成，按脚本配图偏向走图库选图或先文字后逐镜出图。
- `services/douyin-generation-job.service.ts` — 分镜 / 子选题后台生成任务：立即返回、后台执行、分镜并发排队、进度写库、候选脚本保存 / 放弃、失败原因翻译与中断收敛。
- `services/douyin-storyboard-image.service.ts` — 分镜自动配图：从租户图库挑选相关候选图、生成选图清单、按镜头文字相关度自动补图。
- `services/douyin-shot-image.service.ts` — 按分镜描述文生图重新生成单镜画面，入图库后绑定到该镜。
- `services/douyin-operation.service.ts` — 整片 / 单镜头视频生成入口（按节点设置分流到 PixMax 或直连服务）、发布、抓取直连请求与调用审计。
- `services/douyin-pixmax-video.service.ts` — PixMax 生视频通道：分镜 / 整片提示词、提交任务、后台轮询、成片转存视频库并回填。
- `services/douyin-pixmax-video.service.spec.ts` — 分镜与整片提示词单测。
- `services/douyin-shuyan-video.service.ts` — 数眼智能 Seedance 生视频通道：原生任务提交 / 查询、后台续轮询、24 小时临时成片转存视频库并回填。
- `services/douyin-shuyan-video.service.spec.ts` — 数眼视频网关、型号时长、状态与错误映射单测。
- `config.example.env` — 三类直连接口地址、密钥与状态查询模板示例。

## 函数清单 (Function List)

- `DouyinWorkbenchModule()` — 装配抖音真实业务能力 | keywords: 抖音工作台模块, 视频业务编排, douyin-workbench-module, video-business-orchestration
- `DouyinMediaReferenceDto()` — 校验真实素材引用 | keywords: 分镜素材参数, 真实素材引用, storyboard-media-dto, persisted-media-reference
- `DouyinStoryboardShotDto()` — 校验单段分镜字段 | keywords: 分镜段落参数, 镜头编辑, storyboard-shot-dto, shot-editing
- `DouyinStoryboardPreferenceDto()` — 校验配图偏向（AI 生成 / 图库自找 + 最多 20 个标签） | keywords: 配图偏向参数, 图库标签限定, storyboard-preference-dto, gallery-tag-filter
- `DouyinScriptDraftPickDto()` — 校验一条挑中的候选（key、可改写的标题正文、配图偏向、出镜人物、风格、参考图） | keywords: 挑选脚本参数, 候选改写, script-draft-pick-dto, draft-edit
- `DouyinReferenceImageDto()` — 校验脚本参考图，只接受真实图库图片，最多 4 张 | keywords: 脚本参考图参数, 底图候选, reference-image-dto, base-image-candidate
- `RefineDouyinScriptDto()` — 校验脚本 AI 微调请求（原正文 + 一句话修改指令 + 可选人物风格） | keywords: 脚本微调参数, 修改指令, refine-script-dto, revision-instruction
- `ConfirmDouyinScriptDraftsDto()` — 校验一次保存 1 至 12 条挑中候选 | keywords: 保存挑选脚本, 批量入库, confirm-script-drafts-dto, batch-persist
- `CreateDouyinMotherTopicDto()` — 校验人工母选题创建参数 | keywords: 新建抖音母题, 人工母题, create-douyin-mother, manual-mother-topic
- `GenerateDouyinChildrenDto()` — 校验 AI 子选题的可选生成要求、本轮统一的出镜人物与风格 | keywords: 生成抖音子题, 平台提示词, generate-douyin-children, platform-ai-prompt
- `UpdateDouyinTopicDto()` — 校验选题、出镜人物（0 表示取消）、风格（空串表示取消）、参考图及完整分镜更新 | keywords: 更新抖音选题, 保存分镜, update-douyin-topic, save-storyboard
- `DOUYIN_SCRIPT_STYLES` — 脚本风格登记表：生活随拍 / 电影质感 / 干净商业 / 纪实街头 / 高饱和潮流 / 温暖治愈，每项含口播调性 `tone` 与画面质感 `visual` | keywords: 脚本风格, 画面质感风格, script-style, visual-style
- `normalizeScriptStyle(input?)` — 规整脚本风格，未登记回退为不指定 | keywords: 规整脚本风格, 默认不指定风格, normalize-script-style, default-no-style
- `normalizeReferenceImages(input?)` — 规整脚本参考图：只留图片、去重、最多 4 张 | keywords: 规整脚本参考图, 参考图去重, normalize-reference-images, reference-dedupe
- `GenerateDouyinStoryboardDto()` — 校验 LLM 分镜补充要求 | keywords: 生成分镜参数, 创作要求, generate-storyboard-dto, creative-requirement
- `GenerateDouyinVideoDto()` — 校验视频生成补充提示 | keywords: 生成视频参数, 分镜合成, generate-video-dto, storyboard-rendering
- `PublishDouyinVideoDto()` — 校验视频库素材和发布文案 | keywords: 发布视频参数, 抖音文案, publish-video-dto, douyin-caption
- `CrawlDouyinDataDto()` — 校验真实作品 ID | keywords: 抓取抖音数据, 视频作品标识, crawl-douyin-data, published-video-id
- `normalizeStoryboardPreference(input?)` — 规整配图偏向，非法来源回退图库自找，标签去重限长限量 | keywords: 规整配图偏向, 图库标签限定, normalize-storyboard-preference, gallery-tag-filter
- `normalizeVideoAudio(input?)` — 规整视频声音设置，缺省普通话配音 | keywords: 规整声音设置, 默认普通话配音, normalize-video-audio, default-mandarin-voiceover
- `DouyinVideoAudioDto()` — 校验声音方式（配音 / 仅音乐 / 静音）与配音语言 | keywords: 声音设置参数, 配音语言, video-audio-dto, voiceover-language
- `DouyinWorkbenchRepositoryService()` — 管理抖音选题和分镜持久化 | keywords: 抖音工作台仓储, 租户隔离, douyin-workbench-repository, tenant-isolation
- `ensureIndexes()` — 创建抖音选题或调用记录索引 | keywords: 抖音选题索引, 父子查询, douyin-topic-indexes, parent-child-query
- `listWorkspace(scope)` — 返回真实母子选题聚合 | keywords: 查询抖音工作台, 母子聚合, list-douyin-workspace, parent-child-aggregation
- `create(input,scope)` — 人工新建母选题 | keywords: 新建抖音母题, 人工母题, create-douyin-mother, manual-mother-topic
- `createChildren(parentId,candidates,scope)` — 批量保存用户挑中的脚本（标题 + 口播正文 + 配图偏向 + 出镜人物 + 风格 + 参考图）并固定短视频类型 | keywords: 保存AI脚本, 脚本正文, 固定短视频, 分镜配图偏向, persist-ai-scripts, script-body, fixed-short-video, storyboard-image-preference
- `get(id,scope)` — 按作用域读取选题 | keywords: 读取抖音选题, 所有权校验, get-douyin-topic, ownership-check
- `update(id,input,scope)` — 保存标题、脚本正文、配图偏向、出镜人物（0 取消）、风格（空串取消）、参考图（空数组取消）、视频声音设置、整片目标时长（0 改回自动）、分镜或成片绑定 | keywords: 更新抖音选题, 保存脚本正文, 持久化分镜, update-douyin-topic, persist-script-body, persist-storyboard
- `updateShot(topicId,shotId,patch,scope)` — 用 arrayFilters 只写一镜的画面 / 配图提示词 / 分镜视频，并发互不覆盖 | keywords: 更新单段分镜, 分镜局部写入, update-single-shot, partial-storyboard-write
- `remove(id,scope)` — 删除选题并级联子题 | keywords: 删除抖音选题, 级联删除, delete-douyin-topic, cascade-delete
- `requireVideo(id,scope)` — 校验真实视频库记录 | keywords: 校验视频素材, 视频库归属, require-video-asset, video-library-ownership
- `validateStoryboardMedia(storyboard,scope)` — 阻止伪造图库和视频库引用 | keywords: 校验分镜素材, 防伪造引用, validate-storyboard-media, prevent-forged-reference
- `validateMediaReferences(references,scope)` — 校验脚本参考图确实属于本租户，阻止伪造 ID 借用他人素材 | keywords: 校验素材引用, 防伪造引用, validate-media-references, prevent-forged-reference
- `nextId()` — 生成抖音选题业务 ID | keywords: 抖音选题自增ID, 计数器, next-douyin-topic-id, counter
- `scopeFilter(scope)` — 构造租户用户过滤 | keywords: 抖音作用域过滤, 用户隔离, douyin-scope-filter, user-isolation
- `tenantFilter(tenantId?)` — 构造租户或母平台数据边界 | keywords: 母平台数据边界, 租户过滤, platform-data-boundary, tenant-filter
- `toView(row)` — 移除数据库 ID | keywords: 抖音选题视图, 隐藏数据库ID, douyin-topic-view, hide-database-id
- `DouyinChildTopicGenerationService()` — 综合创作上下文生成抖音子选题 | keywords: 抖音子题生成, 平台AI提示词, douyin-child-generation, platform-ai-prompt
- `generate(parentId,input,scope,onProgress?)` — 由 LLM 自主规划数量并生成差异化候选脚本（带 `key`，不入库），按 `personaId` / `scriptStyle` 统一人称视角与调性，`onProgress` 回报规划数量与已写入条数 | keywords: 生成AI子选题, LLM自主数量, 候选脚本, generate-ai-child-topics, llm-decided-count, script-draft
- `recommendPrompt(parentId,scope)` — 根据完整上下文推荐可编辑的生成要求 | keywords: 推荐抖音子题提示, 母题上下文, recommend-douyin-child-prompt, mother-topic-context
- `loadGenerationContext(parentId,scope)` — 读取母题、平台提示和已有子题 | keywords: 读取子题生成上下文, 已有子题, load-child-generation-context, existing-child-topics
- `createPlanTool(plan,onProgress?)` — 让 LLM 在安全范围内自主规划子题数量，规划后回报总数 | keywords: 子题数量规划, LLM自主数量, child-topic-count-plan, llm-decided-count
- `createCandidateTool(candidates,existingTitles,plan,onProgress?)` — 创建脚本写入工具（标题 + 不少于 60 字的口播正文）并去重标题，每写入一条回报进度 | keywords: 子题追加工具, 标题去重, child-topic-append-tool, title-deduplication
- `buildSystemPrompt(input)` — 合并创作上下文（含出镜人物人设段与风格调性）并要求 LLM 自主规划数量 | keywords: 构造子题提示词, 固定短视频, build-child-topic-prompt, fixed-short-video
- `refineScript(input,scope)` — 按一句话指令微调口播正文，只改点名处、保留原意与人称，不落库 | keywords: 脚本AI微调, 按指令改写, refine-script, instruction-rewrite
- `runAgent(system,tools,expectedCount?,platformPrompt,scope)` — 执行数量规划与子题工具调用 Agent | keywords: 执行子题Agent, 工具结果, run-child-topic-agent, tool-result-only
- `readAgentText(result)` — 从 Agent 响应读取推荐提示文本 | keywords: 读取Agent文本, 推荐提示, read-agent-text, prompt-recommendation
- `DouyinStoryboardGenerationService()` — 使用 LLM 生成结构化分镜 | keywords: 抖音分镜生成, 结构化工具调用, douyin-storyboard-generation, structured-tool-call
- `generate(topicId,prompt,scope,onProgress?)` — 按脚本配图偏向生成四至十二段分镜：图库自找时先按标签挑候选图、LLM 选图并自动补图后保存；AI 生成时先保存文字分镜再逐镜出图，返回段数与出图成败数 | keywords: 生成真实分镜, 保存镜头脚本, 分镜自动配图, 先文字后配图, generate-real-storyboard, persist-shot-script, storyboard-auto-image, text-first-imaging
- `generateShotImages(topicId,shots,scope,onProgress?)` — 文字分镜落库后线性串行逐镜文生图：第 N 镜以第 N-1 镜刚生成的画面为底图保证连贯，每张回报 `imaging` 进度，单镜失败只计数并断开这一处的连贯链 | keywords: 逐镜出图, 线性连贯出图, 先文字后配图, generate-shot-images, linear-shot-imaging, text-first-imaging
- `STORYBOARD_IMAGE_GENERATION_LINEAR` — 逐镜出图为线性串行（不并发），换取镜头之间的场景与色调延续 | keywords: 线性连贯出图, 串行出图, linear-shot-imaging, serial-image-generation
- `GENERATE_IMAGE_INSTRUCTION` — AI 出图偏向下给 LLM 的配图说明（不给图库清单、写好 image_prompt） | keywords: AI出图说明, 配图提示词, ai-image-instruction, image-prompt-guide
- `createShotTool(shots,candidates,onProgress?)` — 创建逐段分镜写入工具，`image_id` 只接受候选清单内的图片，重复用图时提示换图，`image_prompt` 存为该镜配图提示词，每写入一段回报进度 | keywords: 分镜追加工具, 内存写入, 分镜选图, storyboard-append-tool, memory-write, storyboard-image-pick
- `DOUYIN_GENERATION_STALE_MS` — 运行中任务无进度写入且不在当前进程超过 10 分钟即判定中断 | keywords: 任务中断判定, 静默超时, job-interrupted-threshold, silent-timeout
- `DOUYIN_STORYBOARD_JOB_CONCURRENCY` — 当前进程同时执行的分镜任务上限（3），其余排队 | keywords: 分镜任务并发, 排队生成, storyboard-job-concurrency, queued-generation
- `DOUYIN_GENERATION_ERROR_MESSAGES` — 后台生成失败码与中文原因对照表（含 AI 画面全部失败） | keywords: 生成失败原因, 错误码翻译, generation-failure-reason, error-code-translate
- `DouyinGenerationJobService()` — 分镜与子选题的后台生成任务服务 | keywords: 后台生成任务, 异步生成, background-generation-job, async-generation
- `DouyinGenerationJobService.ensureIndexes()` — 创建任务 ID、作用域时间线与同选题运行态索引 | keywords: 生成任务索引, 运行态查询, generation-job-indexes, running-state-query
- `DouyinGenerationJobService.start(kind,topicId,prompt,scope,options?)` — 校验选题类型、拦截同选题重复任务，写入运行中任务（候选脚本任务可带本轮统一的 `personaId` / `scriptStyle`）后立即返回 | keywords: 启动后台生成, 重复任务拦截, start-background-generation, duplicate-job-guard
- `DouyinGenerationJobService.list(scope)` — 读取运行中、最近 24 小时以及候选未处理的任务，先收敛中断任务 | keywords: 查询生成任务, 进度轮询, list-generation-jobs, progress-polling
- `DouyinGenerationJobService.run(job,scope)` — 后台执行生成（分镜先占并发名额）、进度写库，成功写结果（分镜段数与出图数，或候选脚本），失败写失败码与中文原因 | keywords: 执行后台生成, 进度写库, run-background-generation, persist-progress
- `DouyinGenerationJobService.confirmDrafts(jobId,items,scope)` — 占住候选后按序入库挑中的脚本与偏向（人物 / 风格留空时沿用本轮任务设置），再逐条启动分镜任务 | keywords: 保存挑选脚本, 启动分镜任务, confirm-script-drafts, start-storyboard-jobs
- `DouyinGenerationJobService.discardDrafts(jobId,scope)` — 放弃整批候选脚本 | keywords: 放弃候选脚本, 候选已处理, discard-script-drafts, drafts-settled
- `DouyinGenerationJobService.requirePendingDrafts(jobId,scope)` — 读取本人已完成且候选未处理的子选题任务 | keywords: 读取待选脚本, 候选归属校验, require-pending-drafts, draft-ownership-check
- `DouyinGenerationJobService.acquireStoryboardSlot(report)` — 占分镜名额，满额时回报 `queued` 并等待 | keywords: 占用分镜名额, 排队生成, acquire-storyboard-slot, queued-generation
- `DouyinGenerationJobService.releaseStoryboardSlot()` — 释放名额并唤醒下一个排队任务 | keywords: 释放分镜名额, 唤醒排队, release-storyboard-slot, wake-queued-job
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
- `DouyinStoryboardImageService.loadCandidates(query,scope,limitTags?)` — 按向量检索 → 标签命中 → 随机补足收集最多 40 张去重候选，排除拼图、封面与 AI 素材；传了限定标签时只收带这些标签的图、随机补足也只在标签内取；任一路失败不影响分镜 | keywords: 收集候选图片, 相关度排序, 图库标签限定, load-image-candidates, relevance-order, gallery-tag-filter
- `DouyinOperationService()` — 管理三类直连操作及持久化审计 | keywords: 抖音直连接口, 禁止隐式节点, douyin-direct-api, no-implicit-super-claw
- `ensureIndexes()` — 创建直连调用记录索引 | keywords: 抖音调用索引, 操作查询, douyin-operation-indexes, operation-query
- `createGeneration(topicId,prompt,user)` — 整片模式：节点 `full-video` 指定了模型时交给 PixMax 通道，否则用整条分镜直连生成合成总片并写服务扣费流水 | keywords: 直连视频生成, 合成总片, 生视频扣费, 整片生成, direct-video-generation, composite-video, video-service-charge, full-video
- `createShotGeneration(topicId,shotId,prompt,user)` — 分镜模式：只提交一段分镜生成分镜视频（节点 `shot-video` 指定了模型时走 PixMax），记录带 shotId，成功时绑定该镜 videoId | keywords: 单镜头视频生成, 分镜视频历史, single-shot-video-generation, shot-video-history
- `DOUYIN_SHOT_IMAGE_SIZE` — 分镜画面出图尺寸（竖屏 1024x1792） | keywords: 分镜出图尺寸, 竖屏比例, shot-image-size, portrait-ratio
- `DOUYIN_SHOT_IMAGE_TAG` — 分镜 AI 配图的图库业务标签「抖音分镜」 | keywords: 分镜配图标签, 业务标签, shot-image-tag, business-tag
- `DouyinShotImageService()` — 分镜画面文生图重生成服务 | keywords: 分镜画面重生成, 文生图配图, shot-image-regeneration, text-to-image-shot
- `DouyinShotImageService.regenerate(topicId,shotId,prompt,scope,options?)` — 出一张竖屏新图入图库并绑定为该镜素材；底图候选依次为 `options.previousImageUrl`（上一镜画面）、人物形象图、脚本参考图，返回值带出 `imageUrl` 供下一镜串联 | keywords: 重新生成分镜画面, 绑定分镜素材, 线性连贯出图, regenerate-shot-image, bind-shot-media, linear-shot-imaging
- `DouyinShotImageService.buildShotImagePrompt(title,shot,requirement,persona,style,hasPreviousShot)` — 补充描述 > 配图提示词 > 画面描述，叠加人物外貌段、风格质感、上一镜延续要求与竖屏无文字规格 | keywords: 构造分镜出图提示, 竖屏无文字, build-shot-image-prompt, portrait-no-text
- `generateShotImage(req,id,shotId,dto)` — `POST topics/:id/storyboard/:shotId/image/generate` | keywords: 重新生成分镜画面接口, 文生图配图, regenerate-shot-image-api, text-to-image-shot
- `generateShotVideo(req,id,shotId,dto)` — `POST topics/:id/storyboard/:shotId/video/generate` | keywords: 单镜头视频生成接口, 分镜视频历史, generate-shot-video-api, shot-video-history
- `readShotId(value)` — 校验路由分镜 ID | keywords: 解析分镜ID, 路由校验, parse-shot-id, route-validation
- `GenerateDouyinShotImageDto()` — 校验分镜画面补充描述 | keywords: 分镜配图参数, 重新生成画面, generate-shot-image-dto, regenerate-shot-frame
- `GenerateDouyinShotVideoDto()` — 校验分镜视频补充提示 | keywords: 分镜视频参数, 单镜头生成, generate-shot-video-dto, single-shot-render
- `createPublish(topicId,input,user)` — 直连发布真实视频库素材 | keywords: 直连抖音发布, 真实视频素材, direct-douyin-publish, real-video-asset
- `createCrawl(topicId,platformVideoId,user)` — 直连抓取真实作品指标 | keywords: 直连抖音抓取, 真实作品数据, direct-douyin-crawl, real-published-metrics
- `list(scope)` — 查询真实直连调用结果 | keywords: 查询抖音调用, 真实接口结果, list-douyin-operations, real-api-result
- `getVideoOptions()` — 读取整片 / 分镜视频节点当前通道（pixmax / shuyan / direct / unavailable）、模型与可选时长 | keywords: 视频生成选项, 可选时长, video-generation-options, duration-choices
- `openVideoDownload(videoId,user)` — 校验视频归属后由服务端拉取视频地址（站内地址读本地文件），返回可读流、类型、大小与文件名 | keywords: 代理下载视频, 跨域下载, proxy-video-download, cross-origin-download
- `sync(id,user)` — 同步异步供应商状态，PixMax / 数眼记录交给各自服务刷新 | keywords: 同步抖音调用状态, 异步任务查询, sync-douyin-operation, async-job-status
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
- `toView(row)` — 隐藏请求与数据库字段，带出通道、模式、模型与进度 | keywords: 抖音调用安全视图, 隐藏请求字段, douyin-operation-view, hide-request-fields
- `DOUYIN_PIXMAX_POLL_MS` — 后台跟进 PixMax 任务的间隔（15 秒） | keywords: PixMax轮询间隔, 后台轮询, pixmax-poll-interval, background-polling
- `DOUYIN_PIXMAX_TASK_TIMEOUT_MS` — 任务超过 2 小时未结束判为超时；保存中超过 10 分钟可重新认领 | keywords: PixMax任务超时, 保存中断, pixmax-task-timeout, saving-stale
- `PIXMAX_STATUS_MESSAGES` — 积分不足、已中止等失败的中文说明 | keywords: PixMax失败原因, 积分不足, pixmax-failure-reason, credit-insufficient
- `ShotReferenceImage` — 参与生成的分镜参考图（图库 ID、地址、对应镜头序号） | keywords: 分镜参考图, 图库图片, shot-reference-image, gallery-image
- `DOUYIN_VOICE_LANGUAGE_LABELS` — 配音语言（普通话 / 粤语 / 英语）在提示词里的写法 | keywords: 配音语言名称, 声音结构, voiceover-language-label, audio-structure
- `buildVideoAudioSection(audio,clamped?,personaVoice?)` — 按声音设置生成【声音】段：配音限定语言并禁止其他语言人声，仅音乐禁止人声，静音要求无声；选了预设人物时追加音色约束并固定全片单一声线 | keywords: 声音段落, 配音语言约束, audio-section, voiceover-language-rule
- `buildShotVideoPrompt(input)` — 单镜结构化提示词：【视频】【画面】【口播稿】（本镜口播）【声音】【参考图】【限制】【补充要求】 | keywords: 分镜视频提示词, 首帧参考, 结构化提示词, shot-video-prompt, first-frame-reference, structured-prompt
- `buildFullVideoPrompt(input)` — 整片结构化提示词：【视频】【分镜时间轴】【口播稿】（完整脚本正文，没有正文时拼分镜口播）【声音】【参考图】【时长】【限制】【补充要求】 | keywords: 整片视频提示词, 多镜头时间轴, 结构化提示词, full-video-prompt, multi-shot-timeline, structured-prompt
- `readDouyinVideoPlan(request)` — 从调用请求取出生成方式、参考图张数、实际 / 计划时长、是否压缩、声音设置与是否带口播稿，供前端展示 | keywords: 读取生成方案, 参考图张数, read-video-plan, reference-image-count
- `DouyinPixmaxVideoService()` — PixMax 生视频通道 | keywords: PixMax生视频, 整片生成, 分镜视频, pixmax-video-generation, full-video, shot-video
- `DouyinPixmaxVideoService.onModuleInit()` — 启动后台轮询，重启后续跟未结束任务 | keywords: 启动PixMax轮询, 重启续跟, start-pixmax-polling, resume-after-restart
- `DouyinPixmaxVideoService.onModuleDestroy()` — 停止轮询 | keywords: 停止PixMax轮询, 模块销毁, stop-pixmax-polling, module-destroy
- `DouyinPixmaxVideoService.start(input)` — 组装提示词与参数、扣费、上传分镜画面、提交任务并写调用记录 | keywords: 提交PixMax视频, 整片或单镜, submit-pixmax-video, full-or-shot
- `DouyinPixmaxVideoService.refresh(id)` — 手动同步一条调用 | keywords: 同步PixMax调用, 手动刷新, sync-pixmax-operation, manual-refresh
- `DouyinPixmaxVideoService.pollOnce()` — 跟进一轮未结束调用，不重入 | keywords: 轮询PixMax调用, 防重入, poll-pixmax-operations, reentry-guard
- `DouyinPixmaxVideoService.refreshRow(row)` — 推进状态，完成后认领并转存回填 | keywords: 推进PixMax调用, 完成转存, advance-pixmax-operation, save-on-complete
- `DouyinPixmaxVideoService.saveVideo(runtime,asset,input)` — OSS 已配置时转存视频与封面，否则登记 PixMax 地址 | keywords: 转存生成视频, 视频库登记, save-generated-video, register-video
- `DouyinPixmaxVideoService.collectImages(shots,offset)` — 按顺序收集去重的分镜图片 | keywords: 收集分镜参考图, 图片去重, collect-shot-images, dedupe-images
- `DouyinPixmaxVideoService.readGalleryFile(url)` — 读本地或远程图库文件 | keywords: 读取图库文件, 本地或远程, read-gallery-file, local-or-remote
- `DouyinPixmaxVideoService.contentTypeOf(url,fallback)` — 按扩展名推断类型 | keywords: 推断文件类型, 扩展名, infer-content-type, file-extension
- `DouyinPixmaxVideoService.readTaskError(task)` — 读任务失败原因 | keywords: 读取任务失败原因, 失败文案, read-task-error, failure-text
- `presentDouyinVideoError(row)` — 输出调用失败信息，PixMax 旧记录里的原始报错展示时翻译成中文、原文放进 `errorDetail` | keywords: 展示视频错误, 旧记录翻译, present-video-error, legacy-error-translate
- `DouyinPixmaxVideoService.fail(id,error,detail?)` — 标记调用失败，`error` 为中文说明、`detail` 为原始信息 | keywords: 标记调用失败, 失败原因, mark-operation-failed, failure-reason
- `DouyinPixmaxVideoService.toPixmaxRuntime(runtime)` — 转 PixMax 连接信息 | keywords: 转换PixMax连接, 节点配置, to-pixmax-runtime, node-runtime
- `DouyinPixmaxVideoService.toView(row)` — 调用记录视图 | keywords: PixMax调用视图, 隐藏请求, pixmax-operation-view, hide-request
- `DOUYIN_SHUYAN_POLL_MS` — 数眼 Seedance 后台轮询间隔（15 秒） | keywords: 数眼视频轮询间隔, 后台轮询, shuyan-video-poll-interval, background-polling
- `DOUYIN_SHUYAN_TASK_TIMEOUT_MS` — 数眼任务默认 48 小时过期，保存中超过 10 分钟可重新认领 | keywords: 数眼视频任务超时, 保存中断, shuyan-video-task-timeout, saving-stale
- `ShuyanVideoTask` — 数眼 Seedance 创建 / 查询任务的内部响应结构 | keywords: 数眼视频任务, Seedance任务, shuyan-video-task, seedance-task
- `isShuyanSeedanceModel(model)` — 只把 Seedance 型号交给当前已接入的数眼视频路由 | keywords: 数眼Seedance识别, 视频模型支持, shuyan-seedance-model, video-model-support
- `resolveShuyanVideoGateway(baseUrl?)` — 从 OpenAI `/v1` baseUrl 还原数眼原生视频网关 | keywords: 数眼视频网关, 移除V1路径, shuyan-video-gateway, strip-v1-path
- `listShuyanVideoDurationChoices(model)` — 按 Seedance 版本返回整数秒可选范围 | keywords: Seedance可选时长, 型号时长范围, seedance-duration-choices, model-duration-range
- `clampShuyanVideoDuration(model,seconds)` — 收敛到 Seedance 型号允许的整数秒 | keywords: Seedance时长收敛, 视频时长, clamp-seedance-duration, video-duration
- `mapShuyanVideoStatus(status?)` — 把 queued / running / succeeded / failed 等状态映射成工作台状态，初建无状态视为 queued | keywords: 数眼视频状态映射, 初建无状态, map-shuyan-video-status, missing-status-queued
- `describeShuyanVideoError(task)` — 保留错误码与消息生成中文失败说明 | keywords: 数眼视频错误, 上游错误码, describe-shuyan-video-error, upstream-error-code
- `DouyinShuyanVideoService()` — 数眼 Seedance 生视频、轮询与成片转存通道 | keywords: 数眼Seedance生视频, 成片转存, 分镜视频, shuyan-seedance-video, persist-generated-video, shot-video
- `DouyinShuyanVideoService.onModuleInit()` — 启动后台轮询并在重启后续跟 | keywords: 启动数眼视频轮询, 重启续跟, start-shuyan-video-polling, resume-after-restart
- `DouyinShuyanVideoService.onModuleDestroy()` — 停止数眼后台轮询 | keywords: 停止数眼视频轮询, 模块销毁, stop-shuyan-video-polling, module-destroy
- `DouyinShuyanVideoService.start(input)` — 组装 Seedance 多模态 content、扣费、提交任务并写调用记录 | keywords: 提交数眼视频, Seedance多模态, submit-shuyan-video, seedance-multimodal
- `DouyinShuyanVideoService.refresh(id)` — 手动同步一条数眼调用 | keywords: 同步数眼视频调用, 手动刷新, sync-shuyan-video-operation, manual-refresh
- `DouyinShuyanVideoService.pollOnce()` — 跟进一轮未结束数眼调用，不重入 | keywords: 轮询数眼视频调用, 防重入, poll-shuyan-video-operations, reentry-guard
- `DouyinShuyanVideoService.refreshRow(row)` — 查询并推进任务，成功后认领、转存与回填；手动同步可重试曾经失败的成片转存 | keywords: 推进数眼视频调用, 完成转存, advance-shuyan-video-operation, save-on-complete
- `DouyinShuyanVideoService.saveVideo(url,input)` — OSS 已配置时立即转存 24 小时临时成片，否则登记临时外链 | keywords: 转存数眼成片, 视频库登记, save-shuyan-video, register-video
- `DouyinShuyanVideoService.collectImages(shots,offset)` — 收集去重分镜参考图 | keywords: 收集数眼参考图, 分镜图片去重, collect-shuyan-reference-images, dedupe-shot-images
- `DouyinShuyanVideoService.toSeedanceImageUrl(url)` — 公网图原样提交，站内图转 data URL | keywords: 数眼图片输入, 本地图片Base64, seedance-image-input, local-image-data-url
- `DouyinShuyanVideoService.imageContentTypeOf(url)` — 按扩展名判断图片媒体类型 | keywords: 图片媒体类型, 扩展名推断, image-content-type, extension-detection
- `DouyinShuyanVideoService.fetchJson(url,init)` — 发起数眼 JSON 请求并保留错误体 | keywords: 数眼视频HTTP请求, 错误体保留, shuyan-video-http, preserve-error-body
- `DouyinShuyanVideoService.download(url)` — 下载临时成片供 OSS 转存 | keywords: 下载数眼成片, 临时地址, download-shuyan-video, temporary-url
- `DouyinShuyanVideoService.fail(id,message,detail?)` — 收敛失败状态并保存原始错误 | keywords: 数眼视频失败收敛, 原始错误, fail-shuyan-video-operation, raw-error-detail
- `DouyinShuyanVideoService.toView(row)` — 返回隐藏请求正文的数眼视频调用视图 | keywords: 数眼视频调用视图, 隐藏请求, shuyan-video-operation-view, hide-request
- `DouyinWorkbenchController()` — 暴露带同址权限声明的 REST 接口 | keywords: 抖音工作台接口, 真实业务接口, douyin-workbench-controller, real-business-api
- `list(req)` — 查询真实选题分镜 | keywords: 查询抖音工作台, 分镜列表, get-douyin-workspace, storyboard-list
- `create(req,dto)` — 人工创建真实母选题 | keywords: 新建抖音母题接口, 返回工作台, create-douyin-mother-api, return-workspace
- `generateChildren(req,id,dto)` — 启动后台候选脚本生成并立即返回运行中任务 | keywords: AI生成抖音子题接口, 平台提示词, generate-douyin-children-api, platform-ai-prompt
- `confirmScriptDrafts(req,jobId,dto)` — `POST generation-jobs/:jobId/drafts/confirm`，保存挑中候选并启动分镜任务 | keywords: 保存挑选脚本接口, 启动分镜任务, confirm-script-drafts-api, start-storyboard-jobs
- `discardScriptDrafts(req,jobId)` — `POST generation-jobs/:jobId/drafts/discard`，放弃整批候选 | keywords: 放弃候选脚本接口, 候选已处理, discard-script-drafts-api, drafts-settled
- `readJobId(value)` — 校验路由生成任务 ID | keywords: 解析生成任务ID, 路由校验, parse-generation-job-id, route-validation
- `listGenerationJobs(req)` — 查询运行中与最近 24 小时的后台生成任务 | keywords: 查询生成任务接口, 进度轮询, list-generation-jobs-api, progress-polling
- `recommendChildPrompt(req,id)` — 推荐可编辑的子选题生成要求 | keywords: 推荐抖音子题提示接口, AI生成要求, recommend-douyin-child-prompt-api, ai-generation-requirement
- `update(req,id,dto)` — 更新选题或保存分镜 | keywords: 更新抖音选题接口, 保存分镜接口, update-douyin-topic-api, save-storyboard-api
- `remove(req,id)` — 删除选题并级联清理 | keywords: 删除抖音选题接口, 级联清理, delete-douyin-topic-api, cascade-cleanup
- `generateStoryboard(req,id,dto)` — 启动后台 LLM 分镜生成并立即返回运行中任务 | keywords: 生成抖音分镜接口, 真实LLM, generate-douyin-storyboard-api, real-llm
- `generateVideo(req,id,dto)` — 调用视频生成服务 | keywords: 生成视频任务接口, 服务扣费, generate-video-task-api, service-charge
- `publish(req,id,dto)` — 调用抖音发布服务 | keywords: 发布抖音视频接口, 真实视频素材, publish-douyin-video-api, real-video-asset
- `crawl(req,id,dto)` — 调用作品数据服务 | keywords: 抓取抖音数据接口, 真实作品, crawl-douyin-data-api, real-published-video
- `videoOptions()` — `GET video/options` 返回整片 / 分镜节点的通道、模型与可选时长（`read DouyinWorkbench`） | keywords: 视频生成选项接口, 可选时长, video-generation-options-api, duration-choices
- `downloadVideo(req,videoId,res)` — `GET videos/:videoId/download` 以附件形式代理下载视频库视频（`read DouyinWorkbench`） | keywords: 下载视频接口, 代理下载, download-video-api, proxy-download
- `listOperations(req)` — 查询直连调用记录 | keywords: 查询抖音任务接口, 供应商响应, list-douyin-operations-api, provider-response
- `syncOperation(req,id)` — 同步供应商异步状态 | keywords: 同步抖音任务接口, 供应商状态, sync-douyin-operation-api, provider-status
- `readId(value)` — 校验路由业务 ID | keywords: 解析抖音业务ID, 路由校验, parse-douyin-business-id, route-validation
- `requireUser(req)` — 读取鉴权用户 | keywords: 读取抖音用户, 鉴权上下文, read-douyin-user, auth-context
- `scopeOf(user)` — 构造控制器数据边界 | keywords: 构造抖音作用域, 用户边界, build-douyin-scope, user-boundary

## 关键词索引 (Keyword Index)

| 中文           | English                      |
| -------------- | ---------------------------- |
| 抖音工作台     | douyin-workbench             |
| 母子选题       | parent-child-topics          |
| AI子选题生成   | generate-douyin-children     |
| LLM自主数量    | llm-decided-count            |
| AI生成要求     | ai-generation-requirement    |
| 平台AI提示词   | platform-ai-prompt           |
| 固定短视频     | fixed-short-video            |
| 分镜生成       | douyin-storyboard-generation |
| 真实LLM        | real-llm                     |
| 直连视频生成   | direct-video-generation      |
| 直连抖音发布   | direct-douyin-publish        |
| 真实作品数据   | real-published-metrics       |
| 租户隔离       | tenant-isolation             |
| 服务扣费       | service-charge               |
| 禁止隐式节点   | no-implicit-super-claw       |
| 后台生成任务   | background-generation-job    |
| 异步生成       | async-generation             |
| 进度轮询       | progress-polling             |
| 进度写库       | persist-progress             |
| 重复任务拦截   | duplicate-job-guard          |
| 收敛中断任务   | settle-stale-jobs            |
| 生成失败原因   | generation-failure-reason    |
| 分镜自动配图   | storyboard-auto-image        |
| 分镜选图       | storyboard-image-pick        |
| 分镜候选图片   | storyboard-image-candidate   |
| 候选图片清单   | image-candidate-list         |
| 自动补图       | auto-assign-shot-images      |
| 镜头配图打分   | shot-image-score             |
| 收集候选图片   | load-image-candidates        |
| 脚本正文       | script-body                  |
| 分镜画面重生成 | shot-image-regeneration      |
| 更新单段分镜   | update-single-shot           |
| 合成总片       | composite-video              |
| 单镜头视频生成 | single-shot-video-generation |
| 分镜视频历史   | shot-video-history           |
| 候选脚本       | script-draft                 |
| 保存挑选脚本   | confirm-script-drafts        |
| 放弃候选脚本   | discard-script-drafts        |
| 分镜配图偏向   | storyboard-image-preference  |
| 图库标签限定   | gallery-tag-filter           |
| 先文字后配图   | text-first-imaging           |
| 逐镜出图       | generate-shot-images         |
| 排队生成       | queued-generation            |
| 节点指定模型   | per-node-model               |
| 整片生成       | full-video                   |
| 代理下载视频   | proxy-video-download         |
| 视频声音设置   | video-audio-setting          |
| 结构化提示词   | structured-prompt            |
| PixMax生视频   | pixmax-video-generation      |
| 数眼生视频     | shuyan-seedance-video        |
| 数眼网关       | shuyan-video-gateway         |
| Seedance时长   | seedance-duration-choices    |
| 数眼状态       | map-shuyan-video-status      |
| 整片视频提示词 | full-video-prompt            |
| 预设人物       | douyin-persona               |
| 脚本风格       | script-style                 |
| 画面质感风格   | visual-style                 |
| 脚本参考图     | reference-image-dto          |
| 底图候选       | base-image-candidate         |
| 线性连贯出图   | linear-shot-imaging          |
| 串行出图       | serial-image-generation      |
| 脚本AI微调     | refine-script                |
| 按指令改写     | instruction-rewrite          |
| 配音音色约束   | voiceover-timbre-rule        |

## 类型导出 (Type Exports)

- `DouyinMediaReference` / `DouyinStoryboardShot` / `DouyinStoryboardPreference` / `DouyinVideoAudioSetting` / `DouyinScriptDraft` / `DouyinTopicEntity` / `DouyinWorkspaceGroup` / `DouyinOperationView` / `DouyinOperationEntity`。
- `DouyinScriptStyle` — 脚本风格键名联合类型，取值来自 `DOUYIN_SCRIPT_STYLES`。
- `DouyinGenerationJobKind` / `DouyinGenerationJobProgress` / `DouyinGenerationJobView` / `DouyinGenerationJobEntity` — 后台生成任务类型、真实进度（阶段含 `queued` / `imaging` + 已写入数或已出图数 + 总数）、前端视图（结果含候选脚本与处理时间）与持久化实体。
- `StoryboardImageCandidate` — 分镜自动配图的候选图（编号、名称、原图与缩略图地址、标签、描述、是否竖图）。
- `DouyinMediaReferenceDto` / `DouyinStoryboardShotDto` / `DouyinStoryboardPreferenceDto` / `DouyinVideoAudioDto` / `DouyinScriptDraftPickDto` / `ConfirmDouyinScriptDraftsDto` / `CreateDouyinMotherTopicDto` / `GenerateDouyinChildrenDto` / `UpdateDouyinTopicDto` / `GenerateDouyinStoryboardDto` / `GenerateDouyinVideoDto` / `GenerateDouyinShotImageDto` / `GenerateDouyinShotVideoDto` / `PublishDouyinVideoDto` / `CrawlDouyinDataDto` / `DouyinReferenceImageDto` / `RefineDouyinScriptDto`。

## 模块功能描述 (Module Feature Description)

接口前缀为 `/api/douyin-workbench`，全部使用 `AdminAuthGuard`、`AdminPoliciesGuard` 并在路由注册处声明 `DouyinWorkbench` 权限。`POST topics` 只接受人工母选题；`POST topics/:id/children/prompt/recommend` 根据母题、平台提示和已有子题返回一条可编辑的 AI 推荐要求。`POST topics/:id/children/generate` 调用默认 LLM，综合母选题、租户平台 AI 提示词（母平台作用域读取全局配置）与可选用户要求，先通过 `douyin_workbench_plan_child_topics` 自主决定三至十二项的合理数量，再通过 `douyin_workbench_add_child_topic` 逐条生成并保存。子选题不接收数量或内容类型，仓储统一写入 `短视频`。`douyin_topics` 保存母子选题和完整分镜，素材引用保存前会按当前租户检查 `gallery_images` 或 `videos` 真实记录。

分镜接口 `POST topics/:id/storyboard/generate` 先按 `text-generation` 当前后台定价扣一次 Credit，再复用默认 LLM，并在该调用链内关闭 Provider 重复扣费；母平台作用域不扣点。分镜通过 `douyin_workbench_add_storyboard_shot` 工具逐段收集四至十二段结构化结果。视频生成、发布和抓取分别读取 `DOUYIN_VIDEO_GENERATION_*`、`DOUYIN_PUBLISH_*`、`DOUYIN_DATA_*` 配置；未设置 `*_URL` 时返回 `*_NOT_CONFIGURED`。可选 `*_STATUS_URL_TEMPLATE` 用 `{id}` 占位同步异步状态；视频生成响应返回已登记到 `video-library` 的 `videoId` 后，子选题自动绑定该成片。模块没有 SuperClaw、Todo 或 Workspace 依赖。

**分镜与子选题改为后台异步生成**：`POST topics/:id/storyboard/generate` 与 `POST topics/:id/children/generate` 不再等 LLM 跑完，`DouyinGenerationJobService.start` 校验选题类型（分镜要子选题、子选题要母选题）、拦截同一选题正在运行的同类任务（409 `DOUYIN_GENERATION_ALREADY_RUNNING`），在 `douyin_generation_jobs` 写入运行中任务后立即返回 `{ job }`，生成在后台继续。两个生成服务通过 `onProgress` 回报真实进度：分镜每写入一段报一次段数，子选题规划后报总数、每写入一条报已写数，最后进入 `saving`。完成写 `result`（分镜段数，或规划数量与新子选题 ID），失败写失败码和 `DOUYIN_GENERATION_ERROR_MESSAGES` 翻译的中文原因（扣费不足等错误也以失败任务的形式出现，而不是接口直接报错）。`GET generation-jobs`（`read DouyinWorkbench`）返回运行中与最近 24 小时的任务供前端轮询；读取与启动前会把「运行中但不在当前进程、且 10 分钟没有进度写入」的任务收成 `DOUYIN_GENERATION_INTERRUPTED`，避免服务重启后永远显示生成中。

**分镜自动配图（目前只配图片）**：分镜生成前，`DouyinStoryboardImageService.loadCandidates` 用「母题 + 子题 + 补充要求」在当前租户图库挑候选图：先走 `GalleryService.searchSimilar` 向量检索（相似度 ≥0.35 的普通图），再按命中这段文字的图库标签随机取图，不够再随机补普通图，去重后最多 40 张；拼图、各类封面与 `ai素材` 一律排除。候选以 `#ID｜竖/横｜标签｜描述` 的清单写进系统提示词，分镜工具新增可选参数 `image_id`，只接受清单内的编号（清单外的编号直接忽略、该段留空），同一张图重复使用时工具回话提示换图。LLM 交付完成后，`autoAssignShotImages` 给仍然没有素材的镜头补图：使用次数少的优先，其次比镜头文字与标签/描述的重合得分，再按候选相关度顺序，候选全部用过一轮后才会重复。写入的素材结构与前端手动「引用素材」一致（`type=image`、`url`、缩略图 `coverUrl`），保存时照常经过 `validateStoryboardMedia` 的租户归属校验；图库为空或读取失败时分镜照常生成，只是不配图。模块因此新增依赖 `GalleryModule`。

**脚本正文、分镜画面重生成与分镜视频**：子选题在前端显示为「脚本」，AI 生成时每条同时写入标题和口播正文（`script`，可经 `PATCH topics/:id` 修改）；分镜生成把正文交给 LLM 逐段拆解，旁白取自正文，并为每镜写 `imagePrompt`。`POST topics/:id/storyboard/:shotId/image/generate` 调 `AgentService.sendPrompt` 按竖屏 9:16 出图（计费由生图运行时按 `douyin-workbench.shot-image-generation` 记账），经 `GalleryAiImageService` 入图库并打「ai素材」「抖音分镜」标签，再用 `updateShot` 只写这一镜。`POST topics/:id/storyboard/:shotId/video/generate` 只提交这一镜给视频生成服务（请求带 `scope: 'shot'`、`shotId`、`shotIndex`，按 `video-generation` 扣费），调用记录带 `shotId`；直接拿到或同步到 `videoId` 时写到该镜的 `videoId`。整条 `video/generate` 请求带 `scope: 'composite'` 与正文，成片仍写到选题的 `generatedVideoId`。两类新接口都挂 `create DouyinWorkbench` 权限。

**候选脚本先挑选、再入库**：`POST topics/:id/children/generate` 的后台任务不再直接写 `douyin_topics`，而是把 LLM 写出的脚本连同随机 `key` 存进任务的 `result.drafts`。前端挑选后调用 `POST generation-jobs/:jobId/drafts/confirm`（`create DouyinWorkbench`）：服务端只接受这次任务里存在的 `key`，标题 / 正文留空则沿用候选原文；先原子地写入 `result.draftsSettledAt` 占住这批候选（重复提交返回 404 `DOUYIN_SCRIPT_DRAFTS_NOT_FOUND`，入库失败会撤销占用），再按顺序 `createChildren`（每条带规整后的 `storyboardPreference`），把新 ID 写回 `result.createdTopicIds`，最后逐条 `start('storyboard')`，响应返回 `{ topics, jobs, groups }`。`POST generation-jobs/:jobId/drafts/discard`（`update DouyinWorkbench`）只标记已处理。`GET generation-jobs` 额外返回候选还没处理的子选题任务，不受 24 小时窗口限制。

**配图偏向与先文字后配图**：子选题新增 `storyboardPreference: { imageSource: 'generate' | 'gallery', galleryTags }`，可经 `PATCH topics/:id` 修改，旧数据缺省视为图库自找、不限标签。分镜生成读取偏向：`gallery` 时 `loadCandidates` 带上限定标签（向量检索多取 60 张再按标签过滤，随机补足只在标签内取，不再按选题文字匹配标签或无标签补图），其余流程不变，文字和画面一起保存；`generate` 时不给 LLM 图库清单，只要求写好 `image_prompt`，文字分镜先落库并把进度切到 `imaging`（`current/total` = 已出图 / 镜头数），再用 `DouyinShotImageService.regenerate` 按并发 2 逐镜出图，每张图经 `updateShot` 单独写回，单镜失败只计数；全部失败时任务以 `DOUYIN_SHOT_IMAGES_ALL_FAILED` 结束（文字分镜仍保留），部分失败写进 `result.imageFailedCount`。出图计费沿用 `douyin-workbench.shot-image-generation`，按张记账。一次确认多条脚本时，进程内最多同时执行 3 个分镜任务，其余停在 `queued` 阶段等待；排队任务仍在当前进程的执行集合里，不会被当成中断任务收掉。

**按节点使用后台指定的模型**：候选脚本生成与生成要求推荐读取节点 `script`，分镜拆解读取 `storyboard`，节点 key 统一取自 `WORKFLOW_NODES.douyinWorkbench`；二者把 [workflow-model](../workflow-model/module.md) 返回的提供商、模型、Key 与 baseUrl 覆盖进 `runWithMessages` 的 config；分镜画面（自动出图与单镜重生成）读取 `shot-image`，作为 `AgentService.sendPrompt` 的 `runtimeOverride`，指定后出图失败直接报错、不降级美图。节点没有设置时一律沿用后台默认提供商，行为与之前一致。`shot-video` / `full-video` 指定 PixMax 或数眼 Seedance 时走对应任务服务，未指定仍走 `DOUYIN_VIDEO_GENERATION_*`。

**两种生视频模式**：分镜模式（`POST topics/:id/storyboard/:shotId/video/generate`，节点 `shot-video`）每镜单独出一段，有画面时以画面为首帧；整片模式（`POST topics/:id/video/generate`，节点 `full-video`）把全部分镜按时间轴写进一条提示词，带上各镜画面作为参考图（按模型上限截取），一次生成一条完整视频，模型单次时长不够时按比例压缩每镜并在调用记录里标 `durationClamped`。指定 PixMax 时走 `DouyinPixmaxVideoService`；指定数眼智能的 Seedance 型号时走 `DouyinShuyanVideoService`，把 `/v1` baseUrl 还原成网关根地址后调用 `POST /seedance/api/v3/contents/generations/tasks`，单镜画面作为 `first_frame`，Seedance 2.x 整片最多带 9 张 `reference_image`，比例固定 9:16、分辨率 720p、时长按版本收敛。数眼任务初建无 status 时保持 queued，每 15 秒用 `GET .../tasks/{id}` 续轮询，成功后在 `content.video_url` 的 24 小时有效期内转存 OSS；未配置 OSS 时仅登记临时外链并写警告。两条通道都在提交前按 `video-generation` 扣费、用原子 saving 状态防重复保存，并回填分镜 `videoId` 或脚本 `generatedVideoId`；未指定节点模型时仍走 `DOUYIN_VIDEO_GENERATION_*` 直连服务。数眼的 Kling / Vidu / Hailuo / 即梦等型号使用不同原生路由，当前会以 `SHUYAN_VIDEO_MODEL_NOT_SUPPORTED` 明确拒绝。

**声音是结构化设置、脚本随整片提交**：子选题新增 `videoAudio: { mode: voiceover | music | mute, language: zh-CN | yue | en }`（经 `PATCH topics/:id` 保存，缺省普通话配音），整片与分镜共用。生成时：模型有 `includeAudio` 参数就按「静音 = false，其余 = true」写入；提示词【声音】段由 `buildVideoAudioSection` 按设置生成（配音限定语言、禁止其他语言人声；仅音乐禁止人声；静音要求无声）。提示词统一分区：整片为【视频】【分镜时间轴】（逐镜画面、参考图编号、口播、转场）【口播稿】（完整脚本正文，没有正文时拼接各镜口播；非配音模式标注「不要朗读」）【声音】【参考图】【时长】【限制】【补充要求】；单镜的【口播稿】是本镜口播。调用请求记录 `audio`、`audioSwitchApplied`、`scriptIncluded`，视图 `plan` 带出声音与是否带口播稿。分镜画面在模型支持任意带图方式时一定带上（多图参考 → 图片参考 → 首尾帧 → 首帧），只有模型完全不支持带图才纯文生视频。

**视频生成错误友好化**：PixMax 通道的失败统一经 `pixmax-error` 翻译：提交阶段上传或审核某张分镜画面失败时，错误里会指明「第 N 镜的画面」（同一张图被多镜使用时列出全部镜号）；提交失败的 HTTP 响应、调用记录 `error` 都是中文说明，原始报错写进 `errorDetail`（视图带出，前端折叠显示）并记警告日志；任务失败、成片转存失败同样处理。旧记录没有 `errorDetail` 时由 `presentDouyinVideoError` 在输出时翻译。

**整片生成时长**：子选题新增 `fullVideoDuration`（1～120 秒，`PATCH topics/:id` 传 0 清除，表示自动）。整片生成时目标时长取它，未设定则取分镜总时长，再按模型可选时长取不小于目标的最短一档（没有则最长一档）；时间轴每镜按「实际时长 / 分镜总时长」等比缩放，短于分镜总时长时压缩并在【时长】段要求所有镜头都出现，长于时放缓节奏。调用请求记录 `plannedSeconds`（分镜总时长）、`targetSeconds`（设定值）与 `durationClamped`（实际短于分镜总时长），直连通道请求也带 `duration`。`GET video/options` 告诉前端整片 / 分镜节点当前模型可生成哪些时长；分镜模式仍按每镜自己的时长就近取档。

**预设人物、脚本风格与参考图**：子选题新增 `personaId`（[预设人物](../douyin-persona/module.md)）、`scriptStyle`（`DOUYIN_SCRIPT_STYLES` 的键）、`referenceImages`（最多 4 张租户图库图片，写入前经 `validateMediaReferences` 校验归属）。三者可在生成候选脚本时统一指定（`POST topics/:id/children/generate` 带 `personaId` / `scriptStyle`，写进任务并在挑选入库时作为缺省），也可逐条在挑选时覆盖，或事后经 `PATCH topics/:id` 修改（`personaId` 传 0、`scriptStyle` 传空串、`referenceImages` 传空数组表示取消）。链路里的三处注入：写脚本与拆分镜用人设段（第一人称 + 叙事视角）与风格 `tone`；逐镜出图用人物外貌段与风格 `visual`，并把人物形象图、脚本参考图放进 `baseImageCandidates`；成片配音把音色写进【声音】段。`GET script-styles`（`read DouyinWorkbench`）返回风格登记表供前端渲染下拉。

**线性连贯出图**：AI 出图偏向下 `generateShotImages` 由并发改为串行，第 N 镜调用 `regenerate` 时传入第 N-1 镜刚生成的 `imageUrl` 作为 `previousImageUrl`，提示词里要求延续上一镜的场景、光线方向、色调与人物状态。单镜失败只计数并把 `previousImageUrl` 清空（下一镜改从人物形象图与参考图起头），已成功的画面不回滚。代价是一条分镜的出图时间约等于镜头数乘单张耗时，进度条的 `imaging` 阶段因此走得比以前慢。

**脚本 AI 微调**：`POST script/refine`（`update DouyinWorkbench`）接收原正文与一句话修改指令，LLM 只改被点名的部分、保留原意与分段，选了人物或风格时一并作为约束（保持第一人称与调性）。结果不落库，由前端决定替换与保存，因此候选脚本挑选弹窗和已保存脚本都能用同一个接口。
