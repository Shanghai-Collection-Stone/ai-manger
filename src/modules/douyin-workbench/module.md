# 模块名称 (Module Name)

AI 抖音工作台（douyin-workbench）

## 概述 (Overview)

提供租户隔离的抖音母选题、LLM 子选题、逐段分镜持久化，以及生成视频（整片 / 分镜 / 分镜合成 / 探店数字人）、发布视频和作品数据抓取直连接口。母题由用户创建；子题综合母题、租户或母平台 AI 提示词与用户补充要求生成，生成数量由 LLM 自主规划，内容类型在服务端固定为短视频。支持由 LLM 推荐一条可编辑的生成要求。分镜使用项目现有 LLM 并按 `text-generation` 服务一次扣费；其他三类操作只调用显式配置的 HTTP 服务，不会隐式使用 SuperClaw，也不会产生模拟结果。
每条脚本可选一个 [预设人物](../douyin-persona/module.md)（决定出镜人物的长相、叙事视角与成片音色）、一种脚本风格（决定口播调性与画面质感），以及最多 4 张来自租户图库的参考图。AI 出图偏向下逐镜出图为线性串行：第 N 镜以第 N-1 镜刚生成的画面为底图，叠加人物形象图与脚本参考图，换取镜头之间场景、色调与人物状态的连贯。

## 文件清单 (File List)

- `douyin-workbench.module.ts` — NestJS 模块入口与依赖装配（含分镜自动配图所需的 `GalleryModule`、按节点取模型的 `WorkflowModelModule`、成片落库所需的 `VideoLibraryModule`）。
- `controller/douyin-workbench.controller.ts` — 抖音工作台鉴权 REST 接口。
- `controller/douyin-workbench.dto.ts` — 选题、分镜、生成、发布和抓取输入校验。
- `entities/douyin-workbench.entity.ts` — 选题、分镜、素材引用和直连调用实体。
- `services/douyin-workbench-repository.service.ts` — MongoDB 母子选题、分镜和素材归属持久化。
- `services/douyin-child-topic-generation.service.ts` — 综合母题和平台 AI 提示词的 LLM 候选脚本生成（不入库）：一次结构化输出规划标题与角度，再并发写口播正文；另含脚本 AI 微调与探店台词写作。
- `services/douyin-storyboard-generation.service.ts` — 一次结构化输出写完整条分镜，图库自找时再做一次关思考的分镜选图，AI 出图时先文字后逐镜串行出图；同时并行写好发布文案。
- `services/douyin-generation-job.service.ts` — 分镜 / 子选题后台生成任务：立即返回、经 AI 生成排队服务 `douyin-generation` 通道排队（全平台与租户两级上限）、进度写库、候选脚本保存 / 放弃、失败原因翻译与中断收敛。
- `services/douyin-storyboard-image.service.ts` — 分镜自动配图：从租户图库挑选相关候选图、生成选图清单、按镜头文字相关度自动补图。
- `services/douyin-shot-image.service.ts` — 按分镜描述文生图重新生成单镜画面，入图库后绑定到该镜。
- `services/douyin-operation.service.ts` — 整片 / 单镜头视频生成、发布、抓取与调用审计，按通道同步状态；列表与同步入口收敛过期客户端合成。
- `services/douyin-shot-concat.service.ts` — 客户端合成协调：校验分镜（探店模式按分段）就绪、返回有序视频地址、认领自动合成预约、接收进度与成片 ID、绑定当前整片。
- `services/douyin-shot-concat.service.spec.ts` — 客户端合成领取、探店分段合成、旧视频重生成保护、结果回报与过期收敛测试。
- `services/douyin-store-visit.service.ts` — 探店录音克隆或文字设计音色、数字人生视频与轮询转存；提供商来自 Ai 提供商设置（代码 digital-human）与工作流节点 voice-clone / voice-design / store-visit-video，按固定契约路径调用；节点选数眼智能时把生成与同步交给分段通道。
- `services/douyin-store-visit-shuyan.service.ts` — 探店数眼分段通道：可灵音色库与选用、「人物在场景里」关键帧、逐段可灵语音合成配音后用可灵数字人或万相数字人对口型、后台轮询转存并绑定分段。
- `services/douyin-store-visit-shuyan.service.spec.ts` — 引擎路由、任务地址、状态映射、音色语种、报错翻译、关键帧提示词、分段规整与合并、分场景台词解析单测。
- `services/douyin-store-visit-workflow.spec.ts` — 独立探店及声音测试：纯提示词提交、旧 ID 忽略、可选固定音色、移除与字段清理、提示词保留、选题作用域及 DTO 禁止伪造音色。
- `services/douyin-store-visit.service.spec.ts` — 数字人状态归一、响应字段读取与契约地址拼接单测。
- `services/douyin-video-storage.service.ts` — 成片落库：本地合成文件或供应商临时地址存进视频库（OSS 优先，未配置时落 `public/uploads` 或登记外链）。
- `services/douyin-pixmax-video.service.ts` — PixMax 生视频通道：分镜 / 整片提示词、提交任务、后台轮询、成片转存视频库并回填。
- `services/douyin-pixmax-video.service.spec.ts` — 分镜与整片提示词单测。
- `services/douyin-shuyan-video.service.ts` — 数眼智能生视频通道（Seedance 与 MiniMax-H3 两条原生路由）：任务提交 / 查询、后台续轮询、临时成片转存视频库并回填。
- `services/douyin-shuyan-video.service.spec.ts` — 数眼视频路由、网关与任务地址、型号时长与清晰度、状态与错误映射单测。
- `config.example.env` — 视频生成 / 发布 / 抓取直连接口示例；合成使用客户端内置 ffmpeg，探店能力由后台提供商与节点配置。

## 函数清单 (Function List)

- `buildStoreVisitRepository()` — 构造独立探店草稿与素材归属测试仓储 | keywords: 探店流程测试仓储, 租户素材测试, store-visit-test-repository, tenant-media-test
- `buildStoreVisitVoiceService()` — 构造声音设计服务桩，保留真实选题作用域检查和提交逻辑 | keywords: 声音设计测试服务, 音色来源测试, voice-design-test-service, voice-source-test
- `DouyinChildTopicGenerationService.constructor(agentService,adminService,personas,repository,workflowModels,knowledge)` — 初始化脚本与探店台词生成依赖 | keywords: 初始化脚本生成, 生成依赖, init-script-generation, generation-dependencies

- `ReportDouyinConcatResultDto()` — 校验进度、完成视频 ID 或失败说明 | keywords: 合成结果参数, 客户端回报, concat-result-dto, client-report
- `DouyinConcatClip()` — 声明有序分镜视频引用 | keywords: 合成片段, 分镜视频地址, concat-clip, shot-video-url
- `DouyinConcatReport()` — 声明客户端合成结果 | keywords: 合成结果回报, 客户端回报, concat-result-report, client-report
- `DouyinShotConcatService.constructor(db,repository)` — 初始化客户端合成集合与仓储 | keywords: 初始化合成服务, 合成仓储, init-concat-service, concat-repository
- `DouyinShotConcatService.prepare(topicId,scope,options?)` — 校验就绪状态（探店模式按分段、片段 ID 为段 ID）并返回合成记录与有序片段 | keywords: 准备客户端合成, 合成前校验, prepare-client-concat, concat-precheck
- `DouyinShotConcatService.report(operationId,report,scope)` — 更新进度、失败原因或完成后绑定成片 | keywords: 回报合成结果, 设为当前整片, report-concat-result, bind-merged-video
- `DouyinOperationService.constructor(db,repository,billing,workflowModels,pixmaxVideos,shuyanVideos,storeVisit,shotConcat)` — 初始化调用集合与视频依赖 | keywords: 初始化调用服务, 视频服务依赖, init-operation-service, video-service-dependencies
- `reportConcatResult(req,id,dto)` — 回报合成结果并验证 update DouyinWorkbench 权限 | keywords: 回报合成结果接口, 设为当前整片, report-concat-result-api, bind-merged-video
- `memoryOperations(rows)` — 构造合成记录内存集合供回归使用 | keywords: 内存集合, 测试替身, in-memory-collection, test-double
- `memoryOperations.matches(row,filter)` — 匹配测试等值、日期和集合查询 | keywords: 匹配测试查询, 内存集合, match-test-query, in-memory-collection
- `build(topic,rows?)` — 建立测试合成服务与仓储 | keywords: 构造测试服务, 假仓储, build-test-service, fake-repository
- `readyTopic()` — 建立已出片的测试脚本 | keywords: 就绪脚本, 测试素材, ready-topic, test-media
- `DouyinWorkbenchModule()` — 装配抖音真实业务能力 | keywords: 抖音工作台模块, 视频业务编排, douyin-workbench-module, video-business-orchestration
- `DouyinMediaReferenceDto()` — 校验真实素材引用 | keywords: 分镜素材参数, 真实素材引用, storyboard-media-dto, persisted-media-reference
- `DouyinStoryboardShotDto()` — 校验单段分镜字段 | keywords: 分镜段落参数, 镜头编辑, storyboard-shot-dto, shot-editing
- `DouyinStoryboardPreferenceDto()` — 校验配图偏向（AI 生成 / 图库自找 + 最多 20 个标签） | keywords: 配图偏向参数, 图库标签限定, storyboard-preference-dto, gallery-tag-filter
- `DouyinScriptDraftPickDto()` — 校验一条挑中的候选（key、可改写的标题正文、配图偏向、出镜人物、风格、参考图） | keywords: 挑选脚本参数, 候选改写, script-draft-pick-dto, draft-edit
- `DouyinReferenceImageDto()` — 校验脚本参考图，只接受真实图库图片，最多 4 张 | keywords: 脚本参考图参数, 底图候选, reference-image-dto, base-image-candidate
- `RefineDouyinScriptDto()` — 校验脚本 AI 微调请求（原正文 + 一句话修改指令 + 可选人物风格） | keywords: 脚本微调参数, 修改指令, refine-script-dto, revision-instruction
- `ConfirmDouyinScriptDraftsDto()` — 校验一次保存 1 至 12 条挑中候选 | keywords: 保存挑选脚本, 批量入库, confirm-script-drafts-dto, batch-persist
- `CreateDouyinMotherTopicDto()` — 校验人工母选题创建参数（标题、制作模式与可选引用知识 `knowledgeIds`，最多 10 条） | keywords: 新建抖音母题, 人工母题, create-douyin-mother, manual-mother-topic
- `GenerateDouyinChildrenDto()` — 校验 AI 子选题的可选生成要求、本轮统一的出镜人物与风格 | keywords: 生成抖音子题, 平台提示词, generate-douyin-children, platform-ai-prompt
- `UpdateDouyinTopicDto()` — 校验选题、母题引用知识（空数组清空）、出镜人物（0 表示取消）、风格（空串表示取消）、参考图及完整分镜更新 | keywords: 更新抖音选题, 保存分镜, update-douyin-topic, save-storyboard
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
- `DouyinPublishCopyDto()` — 校验脚本发布文案：标题 ≤60 字、正文 ≤1000 字、话题 ≤5 个（单个 ≤20 字，可带井号） | keywords: 发布文案参数, 话题数量限制, publish-copy-dto, tag-count-limit
- `normalizePublishCopy(input?)` — 规整发布文案：标题压单行、话题去井号去重限量，三项全空返回 null 表示清掉 | keywords: 规整发布文案, 话题去井号, normalize-publish-copy, strip-hashtag
- `DouyinWorkbenchRepositoryService()` — 管理抖音选题和分镜持久化 | keywords: 抖音工作台仓储, 租户隔离, douyin-workbench-repository, tenant-isolation
- `ensureIndexes()` — 创建抖音选题父子查询与用户创建时间线索引 | keywords: 抖音选题索引, 父子查询, douyin-topic-indexes, parent-child-query
- `listWorkspace(scope)` — 返回真实母子选题聚合 | keywords: 查询抖音工作台, 母子聚合, list-douyin-workspace, parent-child-aggregation
- `create(input,scope)` — 人工新建母选题，可带引用知识与制作模式；探店同时创建空制作草稿 | keywords: 新建抖音母题, 人工母题, create-douyin-mother, manual-mother-topic
- `createChildren(parentId,candidates,scope)` — 批量保存用户挑中的脚本（标题 + 口播正文 + 配图偏向 + 出镜人物 + 风格 + 参考图）并固定短视频类型 | keywords: 保存AI脚本, 脚本正文, 固定短视频, 分镜配图偏向, persist-ai-scripts, script-body, fixed-short-video, storyboard-image-preference
- `get(id,scope)` — 按作用域读取选题 | keywords: 读取抖音选题, 所有权校验, get-douyin-topic, ownership-check
- `update(id,input,scope)` — 保存选题正文、人物风格、素材、声音及发布设置、探店表单；声音描述嵌套更新保留固定音色，显式 voiceMode=prompt 移除音色引用并保留描述，遵守选题作用域 | keywords: 更新抖音选题, 保存脚本正文, 持久化分镜, update-douyin-topic, persist-script-body, persist-storyboard
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
- `generate(parentId,input,scope,onProgress?)` — 先一次结构化输出规划 3-12 条标题与角度，再并发写口播正文（带 `key`，不入库），按 `personaId` / `scriptStyle` 统一人称视角与调性；单条失败重试一次、仍失败丢掉，至少写出一条即成功；`onProgress` 回报规划数量与已写好条数 | keywords: 生成AI子选题, LLM自主数量, 候选脚本, 并发写脚本, generate-ai-child-topics, llm-decided-count, script-draft, parallel-script-writing
- `DOUYIN_SCRIPT_WRITE_CONCURRENCY` — 候选脚本正文同时在写的条数上限（6），其余排队 | keywords: 并发写脚本, 写稿并发上限, script-write-concurrency, parallel-script-writing
- `ZDouyinScriptPlan` — 规划候选脚本的结构化输出（标题 + 切入角度，3-12 条） | keywords: 脚本规划结构, LLM自主数量, script-plan-schema, llm-decided-count
- `ZDouyinScriptBody` — 单条口播正文的结构化输出 | keywords: 口播正文结构, 结构化输出, script-body-schema, structured-output
- `buildScriptLlm(scope)` — 按节点 `script` 构造带计费回调的模型，规划与各条写稿共用 | keywords: 构造脚本模型, 节点指定模型, build-script-llm, per-node-model
- `planScripts(llm,brief,takenTitles)` — 一次结构化输出规划全部标题与角度，去掉与已有题目或本轮重复的标题 | keywords: 规划候选脚本, 标题去重, plan-script-drafts, title-deduplication
- `writeScript(llm,brief,item,siblings)` — 按标题与角度写一条口播正文，太短或报错重试一次；两次太短返回 null，第二次仍报错则抛出 | keywords: 写候选脚本正文, 失败重试, write-script-draft, retry-once
- `runWithConcurrency(list,limit,worker)` — 以固定并发数跑完一组异步任务 | keywords: 限流并发执行, 并发写脚本, bounded-concurrency, parallel-script-writing
- `recommendPrompt(parentId,scope)` — 根据完整上下文推荐可编辑的生成要求 | keywords: 推荐抖音子题提示, 母题上下文, recommend-douyin-child-prompt, mother-topic-context
- `loadGenerationContext(parentId,scope)` — 读取母题（含引用知识 ID）、平台提示和已有子题 | keywords: 读取子题生成上下文, 已有子题, load-child-generation-context, existing-child-topics
- `buildSystemPrompt(input)` — 构造规划与写稿共用的创作背景（母题、要求、已有题目、人设段、风格调性、母题引用知识、平台业务说明与安全约束） | keywords: 构造子题提示词, 固定短视频, build-child-topic-prompt, fixed-short-video
- `refineScript(input,scope)` — 按一句话指令微调口播正文，只改点名处、保留原意与人称，不落库 | keywords: 脚本AI微调, 按指令改写, refine-script, instruction-rewrite
- `readAgentText(result)` — 从 Agent 响应读取推荐提示文本 | keywords: 读取Agent文本, 推荐提示, read-agent-text, prompt-recommendation
- `DouyinStoryboardGenerationService()` — 使用 LLM 一次结构化输出生成抖音分镜，图库配图另做一次关思考的选图 | keywords: 抖音分镜生成, 结构化工具调用, douyin-storyboard-generation, structured-tool-call
- `generate(topicId,prompt,scope,onProgress?)` — 按脚本配图偏向生成四至十二段分镜：一次写完整条分镜（不足 4 段重试一次）；图库自找时再由关思考的 `pickShotImages` 选图、保存前自动补图；AI 生成时先保存文字分镜再逐镜出图；拆分镜同时并行写发布文案并随分镜保存，返回段数、出图成败数与是否写好文案 | keywords: 生成真实分镜, 保存镜头脚本, 分镜自动配图, 先文字后配图, 同步写发布文案, generate-real-storyboard, persist-shot-script, storyboard-auto-image, text-first-imaging, publish-copy-with-storyboard
- `ZDouyinPublishCopy` — 发布文案的结构化输出（标题、正文、话题） | keywords: 发布文案结构, 结构化输出, publish-copy-schema, structured-output
- `generatePublishCopy(topicId,input,scope)` — 一次结构化输出按脚本写好发布标题、正文与 3-5 个话题，失败返回 null、保留原文案 | keywords: 生成发布文案, 分镜同步文案, generate-publish-copy, publish-copy-with-storyboard
- `generateShotImages(topicId,shots,scope,onProgress?)` — 文字分镜落库后线性串行逐镜文生图：第 N 镜以第 N-1 镜刚生成的画面为底图保证连贯，每张回报 `imaging` 进度，单镜失败只计数并断开这一处的连贯链 | keywords: 逐镜出图, 线性连贯出图, 先文字后配图, generate-shot-images, linear-shot-imaging, text-first-imaging
- `STORYBOARD_IMAGE_GENERATION_LINEAR` — 逐镜出图为线性串行（不并发），换取镜头之间的场景与色调延续 | keywords: 线性连贯出图, 串行出图, linear-shot-imaging, serial-image-generation
- `GENERATE_IMAGE_INSTRUCTION` — AI 出图偏向下给 LLM 的配图说明（不给图库清单、写好 image_prompt） | keywords: AI出图说明, 配图提示词, ai-image-instruction, image-prompt-guide
- `ZDouyinStoryboard` — 一次写完整条分镜的结构化输出（4-12 段，含时长、景别、画面、旁白、转场与配图提示词） | keywords: 分镜结构, 一次写完分镜, storyboard-schema, single-shot-storyboard
- `ZDouyinShotImagePicks` — 分镜选图的结构化输出（第几段配哪张候选图） | keywords: 分镜选图结构, 候选图编号, shot-image-pick-schema, candidate-image-id
- `pickShotImages(shots,candidates,scope)` — 分镜选图（节点 `image-decision`，关闭思考）：一次为每段挑候选图，只认清单内编号、同图不重复，失败只记警告 | keywords: 分镜选图, 关闭思考, storyboard-image-pick, thinking-off
- `DOUYIN_GENERATION_STALE_MS` — 运行中任务无进度写入且不在当前进程超过 10 分钟即判定中断 | keywords: 任务中断判定, 静默超时, job-interrupted-threshold, silent-timeout
- `DOUYIN_GENERATION_QUEUE_LANE` — 抖音生成在 AI 生成排队服务里的通道名 `douyin-generation`，候选脚本与分镜任务共用 | keywords: 抖音生成排队通道, 排队生成, douyin-generation-lane, queued-generation
- `DOUYIN_QUEUED_REPORT_DELAY_MS` — 申请名额超过 500ms 还没拿到才回报 `queued`，避免有空位时界面闪「排队中」 | keywords: 排队提示延迟, 防闪烁, queued-report-delay, anti-flicker
- `DOUYIN_GENERATION_ERROR_MESSAGES` — 后台生成失败码与中文原因对照表（含 AI 画面全部失败） | keywords: 生成失败原因, 错误码翻译, generation-failure-reason, error-code-translate
- `DouyinGenerationJobService()` — 分镜与子选题的后台生成任务服务 | keywords: 后台生成任务, 异步生成, background-generation-job, async-generation
- `DouyinGenerationJobService.ensureIndexes()` — 创建任务 ID、作用域更新时间线/开始时间线与同选题运行态索引 | keywords: 生成任务索引, 运行态查询, generation-job-indexes, running-state-query
- `DouyinGenerationJobService.start(kind,topicId,prompt,scope,options?)` — 校验选题类型、拦截同选题重复任务，写入运行中任务（候选脚本任务可带本轮统一的 `personaId` / `scriptStyle`）后立即返回 | keywords: 启动后台生成, 重复任务拦截, start-background-generation, duplicate-job-guard
- `DouyinGenerationJobService.list(scope)` — 触发一次排队补位后，读取运行中、最近 24 小时以及候选未处理的任务，先收敛中断任务 | keywords: 查询生成任务, 进度轮询, list-generation-jobs, progress-polling
- `DouyinGenerationJobService.run(job,scope)` — 后台执行生成（先在抖音生成通道排队占名额）、进度写库，成功写结果（分镜段数与出图数，或候选脚本），失败写失败码与中文原因 | keywords: 执行后台生成, 进度写库, run-background-generation, persist-progress
- `DouyinGenerationJobService.confirmDrafts(jobId,items,scope)` — 占住候选后按序入库挑中的脚本与偏向（人物 / 风格留空时沿用本轮任务设置），再逐条启动分镜任务 | keywords: 保存挑选脚本, 启动分镜任务, confirm-script-drafts, start-storyboard-jobs
- `DouyinGenerationJobService.discardDrafts(jobId,scope)` — 放弃整批候选脚本 | keywords: 放弃候选脚本, 候选已处理, discard-script-drafts, drafts-settled
- `DouyinGenerationJobService.requirePendingDrafts(jobId,scope)` — 读取本人已完成且候选未处理的子选题任务 | keywords: 读取待选脚本, 候选归属校验, require-pending-drafts, draft-ownership-check
- `DouyinGenerationJobService.acquireSlot(jobId,scope,report)` — 在抖音生成通道排队申请名额（任务 ID 作业务键登记），一时拿不到时回报 `queued`，返回释放函数 | keywords: 申请抖音生成名额, 排队生成, acquire-douyin-generation-slot, queued-generation
- `DouyinGenerationJobService.settleStaleJobs(scope)` — 把已不在任何进程（本进程集合与排队登记簿都查不到）且 10 分钟无进度的运行中任务收进失败终态 | keywords: 收敛中断任务, 僵尸任务, settle-stale-jobs, zombie-job
- `DouyinGenerationJobService.describeError(code)` — 翻译失败码，含子选题数量不足的动态码 | keywords: 生成失败原因, 错误码翻译, generation-failure-reason, error-code-translate
- `DouyinGenerationJobService.scopeFilter(scope)` — 构造任务的租户用户过滤 | keywords: 任务作用域过滤, 用户隔离, job-scope-filter, user-isolation
- `DouyinGenerationJobService.toView(row)` — 去掉数据库字段与原始提示词 | keywords: 生成任务视图, 隐藏内部字段, generation-job-view, hide-internal-fields
- `writeStoryboard(brief,scope)` — 一次结构化输出写完整条分镜（节点 `storyboard`，平台说明拼进系统提示），画面描述不看候选图，返回规整后的最多 12 段 | keywords: 执行分镜Agent, 抖音创作约束, 一次写完分镜, run-storyboard-agent, douyin-creative-constraints, single-shot-storyboard
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
- `ensureIndexes()` — 创建直连调用记录、用户时间线与供应商状态轮询索引 | keywords: 抖音调用索引, 操作查询, douyin-operation-indexes, operation-query
- `createGeneration(topicId,prompt,user)` — 整片模式：节点 `full-video` 指定了模型时交给 PixMax 通道，否则用整条分镜直连生成合成总片并写服务扣费流水 | keywords: 直连视频生成, 合成总片, 生视频扣费, 整片生成, direct-video-generation, composite-video, video-service-charge, full-video
- `createShotGeneration(topicId,shotId,prompt,user)` — 提交单镜视频生成并绑定结果，自动合成由桌面客户端认领 | keywords: 单镜头视频生成, 分镜视频历史, single-shot-video-generation, shot-video-history
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
- `list(scope)` — 收敛过期客户端合成并查询当前用户的真实调用结果 | keywords: 查询抖音调用, 真实接口结果, list-douyin-operations, real-api-result
- `DouyinOperationService.DIRECT_RESOLUTIONS` — 直连视频服务的可选清晰度（720P / 1080P） | keywords: 直连可选清晰度, 整片清晰度, direct-resolution-choices, full-video-resolution
- `getVideoOptions()` — 独立读取探店克隆、设计、视频节点状态（storeVisit.voiceClone / voiceDesign / video，视频节点带 `channel`：digital-human 或 shuyan，数眼时带引擎 `engine`），以及整片和分镜的通道、模型、时长与清晰度 | keywords: 视频生成选项, 可选时长, 可选清晰度, video-generation-options, duration-choices, resolution-choices
- `openVideoDownload(videoId,user)` — 校验视频归属后由服务端拉取视频地址（站内地址读本地文件），返回可读流、类型、大小与文件名 | keywords: 代理下载视频, 跨域下载, proxy-video-download, cross-origin-download
- `sync(id,user)` — 收敛过期合成并按提供商同步异步调用（数眼探店分段交给探店服务），客户端合成与克隆音色返回当前记录 | keywords: 同步抖音调用状态, 异步任务查询, sync-douyin-operation, async-job-status
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
- `DouyinPixmaxVideoService.onModuleInit()` — 启动后台轮询，重启后续跟未结束任务；多进程时只在 leader 进程上轮询 | keywords: 启动PixMax轮询, 重启续跟, start-pixmax-polling, resume-after-restart
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
- `DOUYIN_FACE_MASK_STYLES` — 人像处理风格 `cartoon-3d` / `anime-bighead` / `anthropomorphic` / `deidentify`，与前端风格弹窗一致 | keywords: 人像处理风格, 分镜换头风格, face-mask-styles, shot-portrait-style
- `MaskDouyinShotFacesDto()` — 校验人像处理风格参数，缺省 3D 卡通大头 | keywords: 人像处理风格参数, mask-shot-faces-dto
- `DOUYIN_SHOT_FACE_MASK_STYLE` — 3D 卡通大头的皮克斯风头像描述 | keywords: 卡通大头风格, 皮克斯风, cartoon-head-style, pixar-style
- `DOUYIN_FACE_MASK_STYLE_LABELS` — 人像处理风格中文名（3D 卡通大头 / 动画大头 / 拟人风格 / AI 去除真人特征），用于图库命名 | keywords: 人像处理风格名称, face-mask-style-labels
- `buildShotFaceMaskPrompt(style?)` — 按风格拼「只改人物、其余像素不动」的图像编辑提示词：3D 大头、二维动画 Q 版大头、拟人动物角色、写实 AI 虚拟模特去识别化 | keywords: 人像处理提示词, 定点编辑, face-mask-prompt, targeted-edit
- `DouyinShotImageService.maskFaces(topicId,shotId,scope,style?)` — 以当前画面为底图按所选风格处理真人，记 `faceMaskStyle` 与 `originalMedia` 供恢复 | keywords: 分镜卡通换头, 遮挡真人, shot-face-mask, cover-real-person
- `DouyinShotImageService.restoreOriginalImage(topicId,shotId,scope)` — 换回处理前的原图并清掉 `originalMedia` 与 `faceMaskStyle` | keywords: 恢复分镜原图, 撤销换头, restore-shot-image, undo-face-mask
- `DouyinShotImageService.requireTopic(topicId,scope)` — 读取子选题，不是子选题时报错 | keywords: 读取脚本选题, 子选题校验, require-child-topic, child-topic-check
- `DouyinShotImageService.requireShot(topicId,shotId,scope)` — 读取选题与分镜段落 | keywords: 读取分镜段落, 段落校验, require-storyboard-shot, shot-check
- `maskShotFaces()` — `POST topics/:id/storyboard/:shotId/image/mask-faces`（`create DouyinWorkbench`），body `{ style? }` | keywords: 分镜卡通换头接口, 遮挡真人, shot-face-mask-api, cover-real-person
- `restoreShotImage()` — `POST topics/:id/storyboard/:shotId/image/restore`（`update DouyinWorkbench`） | keywords: 恢复分镜原图接口, 撤销换头, restore-shot-image-api, undo-face-mask
- `DOUYIN_SHUYAN_VIDEO_RESOLUTION` — 数眼 Seedance 生视频默认分辨率（480p，最省档位） | keywords: 数眼视频分辨率, 默认清晰度, shuyan-video-resolution, default-quality
- `SHUYAN_VIDEO_ERROR_RULES` — 数眼通道自己的错误对照（网络 / 密钥 / 限流 / 型号未接入），不套用写着 PixMax 的文案 | keywords: 数眼错误对照, 通道错误, shuyan-error-rules, channel-error
- `describeRejectedShuyanImages(raw)` — 从报错里的 `content[N]` 认出被拒的是第几张参考图 | keywords: 定位被拒参考图, 报错图片序号, locate-rejected-image, error-image-index
- `describeShuyanVideoFailure(raw)` — 数眼报错翻译成中文：先查通道规则，再复用 PixMax 的上游模型规则，并点名被拒的参考图 | keywords: 翻译数眼报错, 友好错误提示, describe-shuyan-error, friendly-error-message
- `listShuyanVideoResolutionChoices(model)` — 数眼型号可选清晰度，写法与接口逐字一致（MiniMax-H3 为 `768P` / `2K`；1080p 仅 Seedance 2.x） | keywords: Seedance可选清晰度, 型号清晰度范围, seedance-resolution-choices, model-resolution-range
- `shuyanResolutionHeightOf(label)` — 清晰度档位换算短边像素（`720p` → 720、`2K` → 1440、`4K` → 2160），供就近取档 | keywords: 清晰度短边像素, 档位换算, resolution-short-edge, resolution-to-pixels
- `clampShuyanVideoResolution(model,resolution?)` — 设定的清晰度（大小写不限）收敛到型号档位，对不上按像素就近取；没设定用默认档，型号没有默认档时取最低档 | keywords: Seedance清晰度收敛, 视频清晰度, clamp-seedance-resolution, video-resolution
- `ShuyanVideoTask` — 数眼创建 / 查询任务的内部响应结构（Seedance 平铺、`id`、`content.video_url`；MiniMax-H3 创建返回 `task_id`、查询包在 `task` 里、`content.url`） | keywords: 数眼视频任务, Seedance任务, H3任务, shuyan-video-task, seedance-task, minimax-h3-task
- `ShuyanVideoRoute` — 数眼已接入的视频原生路由 `seedance` / `hailuo-v2` | keywords: 数眼视频路由, 原生端点, shuyan-video-route, native-endpoint
- `resolveShuyanVideoRoute(model)` — 按模型名判路由：含 seedance → `seedance`，MiniMax-H3 → `hailuo-v2`，其余视频族返回 null | keywords: 数眼视频路由, 视频模型支持, resolve-shuyan-video-route, video-model-support
- `normalizeShuyanVideoModel(model)` — MiniMax-H3 不分大小写对齐到接口枚举 `MiniMax-H3`，其余原样 | keywords: 数眼模型名规整, H3模型枚举, normalize-shuyan-video-model, minimax-h3-model-enum
- `resolveShuyanVideoTaskUrl(gateway,route,taskId?)` — 拼创建 / 查询地址（Seedance `/seedance/api/v3/contents/generations/tasks[/{id}]`；H3 `/hailuo/v2/video_generation`、`/hailuo/v2/query/video_generation/{id}`） | keywords: 数眼视频任务地址, 创建与查询, shuyan-video-task-url, create-and-query
- `unwrapShuyanVideoTask(raw)` — 拆掉 MiniMax-H3 查询结果的 `task` 外壳，平铺结果原样 | keywords: 拆包数眼任务, H3查询结果, unwrap-shuyan-video-task, minimax-h3-query-result
- `resolveShuyanVideoGateway(baseUrl?)` — 从 OpenAI `/v1` baseUrl 还原数眼原生视频网关 | keywords: 数眼视频网关, 移除V1路径, shuyan-video-gateway, strip-v1-path
- `listShuyanVideoDurationChoices(model)` — 返回整数秒可选范围（MiniMax-H3 4~15 秒，Seedance 按版本） | keywords: Seedance可选时长, 型号时长范围, seedance-duration-choices, model-duration-range
- `clampShuyanVideoDuration(model,seconds)` — 收敛到数眼型号允许的整数秒 | keywords: Seedance时长收敛, 视频时长, clamp-seedance-duration, video-duration
- `mapShuyanVideoStatus(status?)` — 把 queued / running / succeeded / failed 等状态映射成工作台状态，初建无状态视为 queued | keywords: 数眼视频状态映射, 初建无状态, map-shuyan-video-status, missing-status-queued
- `describeShuyanVideoError(task)` — 保留错误码与消息生成中文失败说明 | keywords: 数眼视频错误, 上游错误码, describe-shuyan-video-error, upstream-error-code
- `DouyinShuyanVideoService()` — 数眼 Seedance / MiniMax-H3 生视频、轮询与成片转存通道 | keywords: 数眼Seedance生视频, 数眼H3生视频, 成片转存, 分镜视频, shuyan-seedance-video, shuyan-minimax-h3-video, persist-generated-video, shot-video
- `DouyinShuyanVideoService.onModuleInit()` — 启动后台轮询并在重启后续跟；多进程时只在 leader 进程上轮询 | keywords: 启动数眼视频轮询, 重启续跟, start-shuyan-video-polling, resume-after-restart
- `DouyinShuyanVideoService.onModuleDestroy()` — 停止数眼后台轮询 | keywords: 停止数眼视频轮询, 模块销毁, stop-shuyan-video-polling, module-destroy
- `DouyinShuyanVideoService.start(input)` — 按型号选 Seedance / MiniMax-H3 路由，组装多模态 content、扣费、提交任务并写调用记录 | keywords: 提交数眼视频, Seedance多模态, submit-shuyan-video, seedance-multimodal
- `DouyinShuyanVideoService.refresh(id)` — 手动同步一条数眼调用 | keywords: 同步数眼视频调用, 手动刷新, sync-shuyan-video-operation, manual-refresh
- `DouyinShuyanVideoService.pollOnce()` — 跟进一轮未结束数眼调用（探店分段除外），不重入 | keywords: 轮询数眼视频调用, 防重入, poll-shuyan-video-operations, reentry-guard
- `DouyinShuyanVideoService.refreshRow(row)` — 按记录型号选路由查询并推进任务，成功后认领、转存与回填；手动同步可重试曾经失败的成片转存 | keywords: 推进数眼视频调用, 完成转存, advance-shuyan-video-operation, save-on-complete
- `DouyinShuyanVideoService.saveVideo(url,input)` — OSS 已配置时立即转存临时成片（Seedance 24 小时、MiniMax-H3 约 7 天），否则登记临时外链 | keywords: 转存数眼成片, 视频库登记, save-shuyan-video, register-video
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
- `videoOptions()` — `GET video/options` 返回整片 / 分镜节点的通道、模型、可选时长与可选清晰度（`read DouyinWorkbench`） | keywords: 视频生成选项接口, 可选时长, 可选清晰度, video-generation-options-api, duration-choices, resolution-choices
- `downloadVideo(req,videoId,res)` — `GET videos/:videoId/download` 以附件形式代理下载视频库视频（`read DouyinWorkbench`） | keywords: 下载视频接口, 代理下载, download-video-api, proxy-download
- `listOperations(req)` — 查询直连调用记录 | keywords: 查询抖音任务接口, 供应商响应, list-douyin-operations-api, provider-response
- `syncOperation(req,id)` — 同步供应商异步状态 | keywords: 同步抖音任务接口, 供应商状态, sync-douyin-operation-api, provider-status
- `readId(value)` — 校验路由业务 ID | keywords: 解析抖音业务ID, 路由校验, parse-douyin-business-id, route-validation
- `requireUser(req)` — 读取鉴权用户 | keywords: 读取抖音用户, 鉴权上下文, read-douyin-user, auth-context
- `scopeOf(user)` — 构造控制器数据边界 | keywords: 构造抖音作用域, 用户边界, build-douyin-scope, user-boundary
- `DouyinStoreVisitVoiceSample` — 克隆音色用过的录音信息（文件名、类型、大小、上传时间），录音本身不落盘 | keywords: 克隆音色录音, 探店音色样本, voice-clone-sample, store-visit-voice-sample
- `DouyinStoreVisitSetting` — 探店人物场景、声音提示词、可选固定音色与来源（clone / design / preset）、音色语种、voiceMode=prompt|generated、样本或试听、创建时间、台词及数眼分段 | keywords: 探店模式设置, 出镜人脸, 克隆音色, store-visit-setting, presenter-face, cloned-voice
- `DouyinStoreVisitSegment` — 探店分段：段 ID、台词、场景图 ID、动作描述，服务端写入的关键帧与本段成片 | keywords: 探店分段, 场景关键帧, 分段成片, store-visit-segment, scene-keyframe, segment-video
- `DOUYIN_STORE_VISIT_LINES_MAX` — 探店台词最长 2000 字，前端台词框同上限 | keywords: 探店台词上限, 台词字数, store-visit-lines-limit, lines-length
- `DouyinStoreVisitSegmentDto()` — 校验一段分段：段 ID、台词（最多 1000 字）、场景图 ID 与动作描述，关键帧和成片只由服务端写 | keywords: 探店分段参数, 分段台词, store-visit-segment-dto, segment-lines
- `DouyinStoreVisitDto()` — 校验人物场景台词、最多 8 段分段、最多 1000 字声音描述与 voiceMode=prompt；不允许伪造音色 ID 或启用 generated | keywords: 探店设置参数, 出镜人脸, store-visit-setting-dto, presenter-face
- `ConcatDouyinShotVideosDto()` — 校验客户端是否领取自动合成预约 | keywords: 分镜合成参数, 自动合成领取, concat-shot-videos-dto, auto-concat-claim
- `GenerateDouyinStoreVisitLinesDto()` — 校验 AI 写探店台词的一句话补充要求 | keywords: 探店台词参数, 台词补充要求, store-visit-lines-dto, lines-requirement
- `DesignDouyinStoreVisitVoiceDto()` — 校验声音描述（10～1000 字）、音色名称（最多 60 字）与试听文本（10～300 字） | keywords: 声音设计参数, 音色试听文本, voice-design-dto, voice-preview-text
- `GenerateDouyinStoreVisitVideoDto()` — 校验探店视频的台词（可选，10～2000 字，数眼分段通道不用）与补充要求 | keywords: 探店视频参数, 数字人台词, store-visit-video-dto, digital-human-lines
- `UseDouyinStoreVisitPresetVoiceDto()` — 校验选用可灵音色：音色 ID、名称、可选试听地址与语种 | keywords: 可灵音色参数, 选用音色库, preset-voice-dto, pick-voice-library
- `GenerateDouyinStoreVisitKeyframeDto()` — 校验生成关键帧的可选补充描述（最多 500 字） | keywords: 关键帧参数, 关键帧补充描述, keyframe-dto, keyframe-requirement
- `normalizeStoreVisitLines(input?)` — 规整探店台词：统一换行、去首尾空白、最多 2000 字 | keywords: 规整探店台词, 台词字数, normalize-store-visit-lines, lines-length
- `DOUYIN_STORE_VISIT_SEGMENT_LIMITS` — 分段上限：最多 8 段、单段台词 1000 字、动作 300 字 | keywords: 探店分段上限, 单段台词上限, store-visit-segment-limit, segment-lines-limit
- `normalizeStoreVisitSegments(input,sceneImageIds)` — 规整分段：去空段、非法或重复段 ID 换新、清掉不在本选题场景里的场景图 | keywords: 规整探店分段, 分段校验, normalize-store-visit-segments, segment-validation
- `mergeStoreVisitSegments(next,current)` — 保存分段时按段 ID 接上服务端字段：场景没变保留关键帧，台词与动作也没变才保留成片 | keywords: 合并探店分段, 保留关键帧, merge-store-visit-segments, keep-keyframe
- `saveStoreVisitVoice(id,voice,scope)` — 保存克隆、设计或可灵音色库音色的来源、名称、ID、模型、语种与对应样本或试听，清除旧来源字段，人脸场景台词不动 | keywords: 保存克隆音色, 探店音色, save-cloned-voice, store-visit-voice
- `claimAutoConcat(id,scope)` — 原子清掉「全部出片后自动合成」标记，只有真正清掉的那次返回 true | keywords: 认领自动合成, 防重复合成, claim-auto-concat, dedupe-concat
- `updateStoreVisitSegment(topicId,segmentId,patch,scope)` — 按段 ID 写关键帧（同时作废成片）或绑定 / 清掉本段成片，段不存在时返回 null | keywords: 更新探店分段, 分段局部写入, update-store-visit-segment, partial-segment-write
- `parseStoreVisitSceneSegments(text,sceneImageIds)` — 解析以「【场景k】」开头的分段台词，标记缺失或越界时返回空 | keywords: 解析分场景台词, 场景标记, parse-scene-segments, scene-marker
- `writeStoreVisitLines(topicId,prompt,scope)` — 按现有脚本或分镜口播、独立探店选题与场景写 30～60 秒探店口播台词（节点 `script`），保持人物人称与风格调性；独立探店有场景图时按场景顺序分段返回 `segments`，不落库 | keywords: 探店台词生成, 数字人台词, store-visit-lines, digital-human-lines
- `DouyinOutputVideoMeta` — 成片登记参数（名称、作用域、标签、时长、尺寸） | keywords: 成片登记参数, 视频库登记, output-video-meta, video-library-register
- `resolveStaticFilePath(url)` — 站内 `/static/...` 地址换成 `public` 下的磁盘路径，拒绝 `..` 穿越 | keywords: 站内地址转磁盘路径, 路径穿越防护, static-url-to-path, path-traversal-guard
- `DouyinVideoStorageService()` — 抖音成片落库服务 | keywords: 抖音成片落库, 视频库登记, douyin-output-video-storage, video-library-register
- `DouyinVideoStorageService.saveFile(filePath,meta)` — 本地 mp4 存进视频库：OSS 配好时上传并按对象键登记，否则复制到 `public/uploads/douyin-video` 并登记站内地址 | keywords: 保存本地成片, 合成成片入库, save-local-video, store-merged-video
- `DouyinVideoStorageService.saveRemote(url,meta)` — 供应商临时地址存进视频库：OSS 配好时下载后走 `saveFile`，否则登记外链 | keywords: 保存供应商成片, 临时地址转存, save-remote-video, persist-temporary-url
- `DouyinVideoStorageService.download(url,target)` — 站内文件直接复制、公网地址流式下载到本机，10 分钟超时 | keywords: 下载视频到本机, 站内文件复制, download-video-file, copy-static-file
- `DouyinVideoStorageService.commonFields(meta)` — 视频库登记公共字段（时长换算毫秒） | keywords: 视频登记公共字段, 时长换算, video-register-fields, duration-to-ms
- `DOUYIN_SHOT_CONCAT_STALE_MS()` — 合成记录 30 分钟无进度判中断 | keywords: 合成中断判定, 静默超时, concat-stale-threshold, silent-timeout
- `DOUYIN_RUNNING_OPERATION_STATUSES()` — 生成中状态值，与前端一致，自动合成据此等待仍在生成的分镜 | keywords: 生成中状态, 自动合成等待, running-operation-statuses, auto-concat-wait
- `DouyinShotConcatService()` — 协调客户端合成与自动合成认领 | keywords: 分镜视频合成, 客户端合成, 自动合成, shot-video-concat, client-side-merge, auto-concat
- `DouyinShotConcatService.settleStale()` — 将三十分钟未回报的客户端合成标为失败，供列表刷新、同步与领取入口调用 | keywords: 收敛中断合成, 僵尸记录, settle-stale-concat, zombie-operation
- `DouyinShotConcatService.tenantFilter(tenantId?)` — 合成记录的租户边界 | keywords: 合成租户过滤, 母平台边界, concat-tenant-filter, platform-boundary
- `DouyinShotConcatService.toView(row)` — 合成调用视图 | keywords: 合成调用视图, 隐藏请求, concat-operation-view, hide-request
- `DOUYIN_DIGITAL_HUMAN_POLL_MS` — 数字人任务后台跟进间隔（15 秒） | keywords: 数字人轮询间隔, 后台轮询, digital-human-poll-interval, background-polling
- `DOUYIN_DIGITAL_HUMAN_TASK_TIMEOUT_MS` — 数字人任务 2 小时未结束判超时 | keywords: 数字人任务超时, 保存中断, digital-human-task-timeout, saving-stale
- `DOUYIN_VOICE_SAMPLE_MAX_BYTES` — 克隆音色录音最大 10MB | keywords: 录音大小上限, 克隆音色录音, voice-sample-limit, voice-clone-sample
- `DOUYIN_VOICE_SAMPLE_EXTENSIONS` — 没有 `audio/*` 类型时按扩展名认可的录音格式 | keywords: 录音格式, 音频扩展名, voice-sample-format, audio-extension
- `DOUYIN_STORE_VISIT_SCENE_IMAGE_LIMIT` — 一次最多带 4 张独立场景图作参考，旧记录可回退分镜画面 | keywords: 场景参考图上限, 分镜画面, scene-image-limit, storyboard-frame
- `mapDigitalHumanStatus(status)` — 直连服务状态归一成 queued / running / completed / failed | keywords: 数字人状态映射, 直连状态归一, map-digital-human-status, direct-status-normalize
- `readDirectField(response,keys)` — 按候选字段名顺序在顶层、`data`、`result`、`output` 里找第一个非空值 | keywords: 读取响应字段, 多层兜底, read-response-field, nested-fallback
- `DouyinStoreVisitService()` — 探店模式服务 | keywords: 探店模式, 克隆音色, 数字人生视频, store-visit-mode, voice-clone, digital-human-video
- `DouyinStoreVisitService.onModuleInit()` — leader 进程启动数字人任务轮询 | keywords: 启动数字人轮询, 重启续跟, start-digital-human-polling, resume-after-restart
- `DouyinStoreVisitService.onModuleDestroy()` — 停止轮询 | keywords: 停止数字人轮询, 模块销毁, stop-digital-human-polling, module-destroy
- `DouyinStoreVisitService.cloneVoice(topicId,file,scope)` — 校验录音后取「音色克隆」节点的提供商，把录音 base64 交给它，音色 ID 连同提供商与模型写进脚本，记 `voice-clone` 审计（不含录音） | keywords: 克隆探店音色, 上传录音, clone-store-visit-voice, upload-voice-sample
- `DouyinStoreVisitService.designVoice(topicId,input,scope)` — 按声音设计节点提交文字描述，保存实际音色与可选试听，失败保留旧音色并记审计 | keywords: 设计探店音色, 文字声音设计, design-store-visit-voice, text-voice-design
- `DouyinStoreVisitService.start(topicId,input,scope)` — 节点选数眼智能时交给分段通道 `startAll`；否则取「探店数字人视频」节点的提供商，保存台词后把人脸、音色（带克隆模型）、台词与分镜场景图交给数字人服务，按 `video-generation` 扣费，提交失败退款 | keywords: 提交探店视频, 数字人生视频, submit-store-visit-video, digital-human-video
- `DouyinStoreVisitService.usesShuyanChannel()` — 判断「探店数字人视频」节点是否选了数眼智能，节点没配或不可用时按通用数字人处理 | keywords: 判断探店通道, 数眼分段通道, detect-store-visit-channel, shuyan-segment-channel
- `DouyinStoreVisitService.refresh(id)` — 手动同步一条探店调用，数眼分段记录交给分段通道 | keywords: 同步探店调用, 手动刷新, sync-store-visit-operation, manual-refresh
- `DouyinStoreVisitService.pollOnce()` — 跟进一轮未结束的数字人任务，不重入 | keywords: 轮询数字人任务, 防重入, poll-digital-human-operations, reentry-guard
- `DouyinStoreVisitService.refreshRow(row)` — 按任务记录上的提供商查一次并推进（提供商删除或停用即收成失败），超时 2 小时判失败 | keywords: 推进数字人任务, 状态查询, advance-digital-human-task, status-query
- `DouyinStoreVisitService.advance(row,response)` — 认领保存权后转存成片并设为脚本成片 | keywords: 转存探店成片, 认领保存, save-store-visit-video, claim-saving
- `DouyinStoreVisitService.collectSceneImages(topic)` — 优先取独立场景图，旧记录兼容分镜图片并按顺序去重 | keywords: 收集场景参考图, 分镜画面去重, collect-scene-images, dedupe-shot-images
- `DouyinStoreVisitService.toImagePayload(url)` — 公网图原样给，站内图转 data URL | keywords: 图片转直连入参, 站内图片Base64, image-to-direct-payload, local-image-data-url
- `DouyinStoreVisitService.readNodeRuntime(nodeKey,label)` — 读取探店节点在「工作流节点模型」里指定的提供商，没指定 / 停用 / 选错提供商 / 没填服务地址时用中文说明拒绝（写明去哪里配） | keywords: 读取探店节点提供商, 缺配置拒绝, read-store-visit-node-runtime, reject-unconfigured
- `DouyinStoreVisitRuntime` — 探店能力调用时用的提供商运行配置（提供商 ID、名称、模型、服务地址、Key） | keywords: 探店提供商配置, 节点运行配置, store-visit-provider-runtime, node-runtime
- `DIGITAL_HUMAN_PROVIDER_CODE` — 通用数字人服务的提供商代码 `digital-human`，按类别各建一条（audio 给音色克隆、video 给探店数字人视频） | keywords: 数字人提供商代码, 通用契约, digital-human-provider-code, generic-contract
- `DIGITAL_HUMAN_PATHS` — 契约固定路径：`POST /voice-clone`、`POST /voice-design`、`POST /digital-human/tasks`、`GET /digital-human/tasks/{id}` | keywords: 数字人契约路径, 服务地址拼接, digital-human-contract-paths, base-url-join
- `buildDigitalHumanUrl(baseUrl,path,id?)` — 契约路径拼到提供商服务地址后（去多余斜杠，`{id}` 编码替换） | keywords: 拼接契约地址, 服务地址拼接, build-contract-url, base-url-join
- `DouyinStoreVisitService.fetchJson(url,init,apiKey?)` — 带超时与 Bearer 的 JSON 请求，非 2xx 带上对端错误体 | keywords: 探店直连请求, 超时控制, store-visit-direct-request, timeout-control
- `DouyinStoreVisitService.requireChild(topicId,scope)` — 校验子选题归属 | keywords: 校验探店脚本, 操作所有权, require-store-visit-topic, operation-ownership
- `DouyinStoreVisitService.fail(id,message,detail?)` — 标记数字人调用失败 | keywords: 标记数字人失败, 失败原因, mark-digital-human-failed, failure-reason
- `DouyinStoreVisitService.toView(row)` — 探店调用视图 | keywords: 探店调用视图, 隐藏请求, store-visit-operation-view, hide-request
- `concatShotVideos(req,id,dto)` — 校验并领取客户端合成，返回调用记录与有序片段，权限为 create DouyinWorkbench | keywords: 准备客户端合成接口, 分镜视频地址, prepare-client-concat-api, shot-video-urls
- `cloneStoreVisitVoice(req,id,file)` — `POST topics/:id/store-visit/voice`（`create DouyinWorkbench`，multipart `file` ≤10MB） | keywords: 克隆探店音色接口, 上传录音, clone-store-visit-voice-api, upload-voice-sample
- `designStoreVisitVoice(req,id,dto)` — `POST topics/:id/store-visit/voice/design`（`create DouyinWorkbench`），创建音色并返回当前租户工作台 | keywords: 声音设计接口, 探店音色, design-store-visit-voice-api, store-visit-voice
- `generateStoreVisitLines(req,id,dto)` — `POST topics/:id/store-visit/lines`（`create DouyinWorkbench`），只返回台词 | keywords: 探店台词接口, 数字人台词, store-visit-lines-api, digital-human-lines
- `generateStoreVisitVideo(req,id,dto)` — `POST topics/:id/store-visit/generate`（`create DouyinWorkbench`），数眼通道返回各段调用记录 | keywords: 探店视频生成接口, 数字人生视频, store-visit-video-api, digital-human-video
- `listStoreVisitPresetVoices()` — `GET store-visit/voices`（`read DouyinWorkbench`），列出数眼可灵音色库 | keywords: 可灵音色库接口, 预置音色列表, kling-preset-voices-api, preset-voice-list
- `useStoreVisitPresetVoice(req,id,dto)` — `POST topics/:id/store-visit/voice/preset`（`update DouyinWorkbench`），选用可灵音色并返回工作台 | keywords: 选用可灵音色接口, 保存预置音色, use-kling-preset-voice-api, save-preset-voice
- `generateStoreVisitKeyframe(req,id,segmentId,dto)` — `POST topics/:id/store-visit/segments/:segmentId/keyframe`（`create DouyinWorkbench`），生成本段关键帧并返回工作台 | keywords: 探店关键帧接口, 人物进场景, store-visit-keyframe-api, person-in-scene
- `generateStoreVisitSegment(req,id,segmentId)` — `POST topics/:id/store-visit/segments/:segmentId/generate`（`create DouyinWorkbench`），重新生成单段 | keywords: 重新生成探店分段接口, 单段重做, regenerate-store-visit-segment-api, single-segment-retry
- `readSegmentId(value)` — 校验路由里的探店分段 ID | keywords: 解析探店分段ID, 路由校验, parse-segment-id, route-validation
- `StoreVisitAvatarEngine` — 数眼分段的数字人引擎：`kling-avatar`（音频 2～300 秒）/ `wan-s2v`（音频少于 20 秒、要公网地址） | keywords: 探店数字人引擎, 可灵数字人, 万相数字人, store-visit-avatar-engine, kling-avatar, wan-s2v
- `DOUYIN_STORE_VISIT_SEGMENT_POLL_MS` — 分段任务后台跟进间隔（15 秒） | keywords: 探店分段轮询间隔, 后台轮询, store-visit-segment-poll-interval, background-polling
- `DOUYIN_STORE_VISIT_SEGMENT_TIMEOUT_MS` — 分段任务 3 小时未结束判超时 | keywords: 探店分段超时, 保存中断, store-visit-segment-timeout, saving-stale
- `STORE_VISIT_AVATAR_AUDIO_SECONDS` — 各引擎接受的单段配音秒数 | keywords: 单段配音时长, 数字人音频上限, segment-audio-limit, avatar-audio-range
- `textOf(value)` — 把对端响应字段读成去空白的字符串，只认字符串与数字，其余返回空串 | keywords: 读取响应文本, 字段转字符串, read-response-text, field-to-string
- `resolveStoreVisitAvatarEngine(model)` — 按节点模型名选引擎：含 s2v 走万相，含 kling / avatar 走可灵（含 pro 为高品质模式） | keywords: 解析探店数字人引擎, 模型名路由, resolve-store-visit-avatar-engine, model-routing
- `buildStoreVisitAvatarUrl(gateway,engine,taskId?)` — 拼可灵 `/kling/v1/videos/avatar/image2video[/{id}]` 或万相创建 / 查询地址 | keywords: 探店数字人任务地址, 创建与查询, store-visit-avatar-task-url, create-and-query
- `mapStoreVisitAvatarStatus(status?)` — 可灵与万相任务状态收成 queued / running / completed / failed | keywords: 探店数字人状态映射, 可灵万相状态, map-store-visit-avatar-status, kling-wan-status
- `inferKlingVoiceLanguage(voiceId,voiceName)` — 按音色 ID 与名称推断语音合成语种 | keywords: 推断音色语种, 可灵音色, infer-voice-language, kling-voice
- `describeStoreVisitSegmentFailure(raw)` — 可灵业务错误与语音合成失败带上对端原话，其余走数眼通道对照 | keywords: 翻译分段报错, 可灵错误, describe-segment-failure, kling-error
- `buildStoreVisitKeyframePrompt(input)` — 关键帧图像编辑提示词：底图人物 + 第二张场景图，生成竖屏口播首帧 | keywords: 探店关键帧提示词, 人物进场景, store-visit-keyframe-prompt, person-in-scene
- `StoreVisitPresetVoice` — 可灵音色库条目（ID、名称、试听、语种） | keywords: 可灵音色条目, 音色试听, kling-preset-voice, voice-trial
- `DouyinStoreVisitShuyanService()` — 探店数眼分段通道 | keywords: 数眼探店分段, 分段对口型, 可灵语音合成, shuyan-store-visit-segments, segment-lip-sync, kling-tts
- `DouyinStoreVisitShuyanService.constructor(db,repository,billing,storage,workflowModels,adminService,agentService,aiImages,personas)` — 初始化调用集合与配音、关键帧、转存依赖 | keywords: 初始化数眼探店服务, 分段依赖, init-shuyan-store-visit, segment-dependencies
- `DouyinStoreVisitShuyanService.onModuleInit()` — leader 进程启动分段任务轮询 | keywords: 启动分段轮询, 重启续跟, start-segment-polling, resume-after-restart
- `DouyinStoreVisitShuyanService.onModuleDestroy()` — 停止分段轮询 | keywords: 停止分段轮询, 模块销毁, stop-segment-polling, module-destroy
- `DouyinStoreVisitShuyanService.listPresetVoices()` — 按节点的数眼 Key 拉可灵官方音色（最多 3 页），30 分钟缓存 | keywords: 可灵音色库, 预置音色列表, list-kling-preset-voices, preset-voice-list
- `DouyinStoreVisitShuyanService.usePresetVoice(topicId,input,scope)` — 选用可灵音色为固定音色（来源 preset、模型 kling-tts） | keywords: 选用可灵音色, 保存预置音色, use-kling-preset-voice, save-preset-voice
- `DouyinStoreVisitShuyanService.generateKeyframe(topicId,segmentId,prompt,scope)` — 出镜人物作底图、场景图作第二张参考图，按分镜画面节点出竖屏关键帧并写进分段 | keywords: 生成探店关键帧, 人物进场景, generate-store-visit-keyframe, person-in-scene
- `DouyinStoreVisitShuyanService.startAll(topicId,scope)` — 全部分段配音并提交对口型 | keywords: 提交探店分段生成, 分段对口型, submit-store-visit-segments, segment-lip-sync
- `DouyinStoreVisitShuyanService.startOne(topicId,segmentId,scope)` — 只重新生成某一段 | keywords: 重新生成探店分段, 单段重做, regenerate-store-visit-segment, single-segment-retry
- `DouyinStoreVisitShuyanService.refresh(id)` — 手动同步一条分段调用 | keywords: 同步探店分段, 手动刷新, sync-store-visit-segment, manual-refresh
- `DouyinStoreVisitShuyanService.pollOnce()` — 跟进一轮未结束的分段任务，不重入 | keywords: 轮询探店分段, 防重入, poll-store-visit-segments, reentry-guard
- `DouyinStoreVisitShuyanService.startSegments(topic,segments,scope)` — 校验关键帧、可灵音色、无分段在跑，清旧成片、打自动合成标记后逐段提交 | keywords: 提交探店分段, 分段前置校验, submit-store-visit-segment-batch, segment-precheck
- `DouyinStoreVisitShuyanService.submitSegment(input)` — 扣费 → 可灵语音合成 → 校验配音时长 → 提交数字人任务，失败退款并写失败记录 | keywords: 提交单段对口型, 分段配音, submit-segment-lip-sync, segment-voiceover
- `DouyinStoreVisitShuyanService.synthesize(gateway,apiKey,input)` — 可灵语音合成，创建即给音频就用，否则轮询至多 60 秒 | keywords: 可灵语音合成, 分段配音, kling-tts, segment-voiceover
- `DouyinStoreVisitShuyanService.refreshRow(row)` — 按引擎查一次任务并推进，完成时转存并绑定分段；生成期间台词或关键帧被改时不绑定 | keywords: 推进探店分段, 分段转存, advance-store-visit-segment, save-segment-video
- `DouyinStoreVisitShuyanService.readRuntime()` — 读取探店视频节点的数眼运行配置，不是数眼或没填 Key 时拒绝 | keywords: 读取数眼探店配置, 缺配置拒绝, read-shuyan-store-visit-runtime, reject-unconfigured
- `DouyinStoreVisitShuyanService.toKlingImage(url)` — 公网图原样给，站内图转不带前缀的 Base64 | keywords: 可灵图片入参, 站内图片Base64, kling-image-input, local-image-base64
- `DouyinStoreVisitShuyanService.requirePublicUrl(url,label)` — 万相只收公网地址，否则说明要配 OSS | keywords: 校验公网地址, 万相入参, require-public-url, wan-input
- `DouyinStoreVisitShuyanService.fetchJson(url,init,apiKey?)` — 带超时与 Bearer 的数眼请求，非 2xx 与可灵业务码非 0 都抛错并保留对端报错 | keywords: 数眼探店请求, 错误体保留, shuyan-store-visit-request, preserve-error-body
- `DouyinStoreVisitShuyanService.requireChild(topicId,scope)` — 校验子选题归属 | keywords: 校验探店脚本, 操作所有权, require-store-visit-topic, operation-ownership
- `DouyinStoreVisitShuyanService.requireSegment(topic,segmentId)` — 取脚本里的一段，找不到时报错 | keywords: 读取探店分段, 分段校验, require-store-visit-segment, segment-check
- `DouyinStoreVisitShuyanService.fail(id,message,detail?)` — 标记分段调用失败 | keywords: 标记分段失败, 失败原因, mark-segment-failed, failure-reason
- `DouyinStoreVisitShuyanService.toView(row)` — 分段调用视图（带 segmentId） | keywords: 分段调用视图, 隐藏请求, segment-operation-view, hide-request

## 关键词索引 (Keyword Index)

| 中文           | English                      |
| -------------- | ---------------------------- |
| 探店流程测试仓储 | store-visit-test-repository |
| 初始化脚本生成 | init-script-generation |
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
| 分镜卡通换头   | shot-face-mask               |
| 人像处理风格   | face-mask-styles             |
| 恢复分镜原图   | restore-shot-image           |
| 整片清晰度     | full-video-resolution        |
| 可选清晰度     | resolution-choices           |
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
| 数眼H3生视频   | shuyan-minimax-h3-video      |
| 数眼视频路由   | resolve-shuyan-video-route   |
| 数眼视频任务地址 | shuyan-video-task-url      |
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
| 脚本发布文案   | script-publish-copy          |
| 生成发布文案   | generate-publish-copy        |
| 同步写发布文案 | publish-copy-with-storyboard |
| 规整发布文案   | normalize-publish-copy       |
| 并发写脚本     | parallel-script-writing      |
| 规划候选脚本   | plan-script-drafts           |
| 结构化输出     | structured-output            |
| 一次写完分镜   | single-shot-storyboard       |
| 分镜选图       | storyboard-image-pick        |
| 关闭思考       | thinking-off                 |
| 抖音生成排队通道 | douyin-generation-lane     |
| 分镜视频合成   | shot-video-concat            |
| 客户端合成     | client-side-merge            |
| 自动合成       | auto-concat                  |
| 准备客户端合成 | prepare-client-concat        |
| 回报合成结果   | report-concat-result         |
| 合成结果参数   | concat-result-dto            |
| 收敛中断合成   | settle-stale-concat          |
| 抖音成片落库   | douyin-output-video-storage  |
| 探店模式       | store-visit-mode             |
| 克隆音色       | voice-clone                  |
| 声音设计测试服务 | voice-design-test-service |
| 音色来源测试 | voice-source-test |
| 声音设计参数 | voice-design-dto |
| 音色试听文本 | voice-preview-text |
| 设计探店音色 | design-store-visit-voice |
| 文字声音设计 | text-voice-design |
| 声音设计接口 | design-store-visit-voice-api |
| 克隆探店音色   | clone-store-visit-voice      |
| 数字人生视频   | digital-human-video          |
| 探店台词生成   | store-visit-lines            |
| 数字人状态映射 | map-digital-human-status     |
| 数字人提供商代码 | digital-human-provider-code |
| 数字人契约路径 | digital-human-contract-paths |
| 探店分段 | store-visit-segment |
| 场景关键帧 | scene-keyframe |
| 分段成片 | segment-video |
| 探店分段参数 | store-visit-segment-dto |
| 可灵音色参数 | preset-voice-dto |
| 关键帧参数 | keyframe-dto |
| 探店分段上限 | store-visit-segment-limit |
| 规整探店分段 | normalize-store-visit-segments |
| 合并探店分段 | merge-store-visit-segments |
| 更新探店分段 | update-store-visit-segment |
| 解析分场景台词 | parse-scene-segments |
| 判断探店通道 | detect-store-visit-channel |
| 数眼分段通道 | shuyan-segment-channel |
| 可灵音色库接口 | kling-preset-voices-api |
| 选用可灵音色接口 | use-kling-preset-voice-api |
| 探店关键帧接口 | store-visit-keyframe-api |
| 重新生成探店分段接口 | regenerate-store-visit-segment-api |
| 解析探店分段ID | parse-segment-id |
| 探店数字人引擎 | store-visit-avatar-engine |
| 可灵数字人 | kling-avatar |
| 万相数字人 | wan-s2v |
| 探店分段轮询间隔 | store-visit-segment-poll-interval |
| 探店分段超时 | store-visit-segment-timeout |
| 单段配音时长 | segment-audio-limit |
| 解析探店数字人引擎 | resolve-store-visit-avatar-engine |
| 探店数字人任务地址 | store-visit-avatar-task-url |
| 探店数字人状态映射 | map-store-visit-avatar-status |
| 推断音色语种 | infer-voice-language |
| 翻译分段报错 | describe-segment-failure |
| 探店关键帧提示词 | store-visit-keyframe-prompt |
| 人物进场景 | person-in-scene |
| 可灵音色条目 | kling-preset-voice |
| 数眼探店分段 | shuyan-store-visit-segments |
| 分段对口型 | segment-lip-sync |
| 可灵语音合成 | kling-tts |
| 可灵音色库 | list-kling-preset-voices |
| 选用可灵音色 | use-kling-preset-voice |
| 生成探店关键帧 | generate-store-visit-keyframe |
| 提交探店分段生成 | submit-store-visit-segments |
| 重新生成探店分段 | regenerate-store-visit-segment |
| 同步探店分段 | sync-store-visit-segment |
| 轮询探店分段 | poll-store-visit-segments |
| 提交单段对口型 | submit-segment-lip-sync |
| 分段配音 | segment-voiceover |
| 推进探店分段 | advance-store-visit-segment |
| 读取数眼探店配置 | read-shuyan-store-visit-runtime |
| 可灵图片入参 | kling-image-input |
| 校验公网地址 | require-public-url |
| 数眼探店请求 | shuyan-store-visit-request |
| 读取探店分段 | require-store-visit-segment |
| 标记分段失败 | mark-segment-failed |
| 分段调用视图 | segment-operation-view |
| 读取响应文本 | read-response-text |

## 类型导出 (Type Exports)

- `DesignDouyinStoreVisitVoiceDto` — 声音设计请求参数。

- `DouyinPublishCopy` — 脚本发布文案（标题、正文、话题），子选题的 `publishCopy` 字段。
- `DouyinStoreVisitSetting` / `DouyinStoreVisitVoiceSample` / `DouyinStoreVisitSegment` — 探店设置（出镜人脸、独立场景图片与说明、录音信息、音色 ID 与语种、台词、数眼分段），子选题的 `storeVisit` 字段；子选题另有 `autoConcatShots`（全部出片后自动合成，探店分段同样使用）。调用记录视图新增 `segmentId`（探店分段）。
- `DouyinConcatClip` / `DouyinConcatReport` — 客户端合成的有序片段与结果回报；`DouyinOutputVideoMeta` — 供应商成片登记参数；`DouyinStoreVisitRuntime` — 探店提供商运行配置。
- `DouyinMediaReference` / `DouyinStoryboardShot` / `DouyinStoryboardPreference` / `DouyinVideoAudioSetting` / `DouyinScriptDraft` / `DouyinTopicEntity` / `DouyinWorkspaceGroup` / `DouyinOperationView` / `DouyinOperationEntity`。
- `DouyinScriptStyle` — 脚本风格键名联合类型，取值来自 `DOUYIN_SCRIPT_STYLES`。
- `DouyinGenerationJobKind` / `DouyinGenerationJobProgress` / `DouyinGenerationJobView` / `DouyinGenerationJobEntity` — 后台生成任务类型、真实进度（阶段含 `queued` / `imaging` + 已写入数或已出图数 + 总数）、前端视图（结果含候选脚本与处理时间）与持久化实体。
- `ShuyanVideoRoute` — 数眼视频原生路由 `seedance` / `hailuo-v2`（MiniMax-H3）。
- `StoreVisitAvatarEngine` / `StoreVisitPresetVoice` — 探店数眼分段的数字人引擎与可灵音色库条目。
- `StoryboardImageCandidate` — 分镜自动配图的候选图（编号、名称、原图与缩略图地址、标签、描述、是否竖图）。
- `DouyinMediaReferenceDto` / `DouyinStoryboardShotDto` / `DouyinStoryboardPreferenceDto` / `DouyinVideoAudioDto` / `DouyinScriptDraftPickDto` / `ConfirmDouyinScriptDraftsDto` / `CreateDouyinMotherTopicDto` / `GenerateDouyinChildrenDto` / `UpdateDouyinTopicDto` / `GenerateDouyinStoryboardDto` / `GenerateDouyinVideoDto` / `GenerateDouyinShotImageDto` / `GenerateDouyinShotVideoDto` / `PublishDouyinVideoDto` / `CrawlDouyinDataDto` / `DouyinReferenceImageDto` / `RefineDouyinScriptDto` / `DouyinPublishCopyDto` / `DouyinStoreVisitDto` / `DouyinStoreVisitSegmentDto` / `ConcatDouyinShotVideosDto` / `GenerateDouyinStoreVisitLinesDto` / `GenerateDouyinStoreVisitVideoDto` / `UseDouyinStoreVisitPresetVoiceDto` / `GenerateDouyinStoreVisitKeyframeDto`。

## 模块功能描述 (Module Feature Description)

**新增选题即选择制作流程**：`POST topics` 可带 `productionMode=storyboard|store-visit`，缺省分镜模式。探店模式一次写入母题与空子题草稿，二者同为探店模式，草稿不含脚本或分镜；沿用既有租户用户隔离与接口权限，不创建生成任务。`storeVisit.sceneImages` 保存最多 4 张独立图库图片，按租户校验；`sceneDescription` 最多 2000 字，嵌套更新不覆盖人物、音色。台词生成在没有正文或分镜时直接使用探店标题和场景说明；新探店选题提交生成前必须有场景图片，在供应商调用和扣费前校验。数字人请求带独立场景图及 `sceneDescription`；旧脚本未设置独立场景时仍可使用原分镜图片，显式空数组禁止回退。

接口前缀为 `/api/douyin-workbench`，全部使用 `AdminAuthGuard`、`AdminPoliciesGuard` 并在路由注册处声明 `DouyinWorkbench` 权限。`POST topics` 接受人工母选题与制作模式；`POST topics/:id/children/prompt/recommend` 根据母题、平台提示和已有子题返回一条可编辑的 AI 推荐要求。`POST topics/:id/children/generate` 调用节点 `script` 的 LLM，综合母选题、租户平台 AI 提示词（母平台作用域读取全局配置）与可选用户要求，先一次结构化输出自主规划三至十二条标题与角度，再并发写各条口播正文（见下文「脚本生成提速」）。子选题不接收数量或内容类型，仓储统一写入 `短视频`。`douyin_topics` 保存母子选题和完整分镜，素材引用保存前会按当前租户检查 `gallery_images` 或 `videos` 真实记录。

分镜接口 `POST topics/:id/storyboard/generate` 先按 `text-generation` 当前后台定价扣一次 Credit，再复用默认 LLM，并在该调用链内关闭 Provider 重复扣费；母平台作用域不扣点。分镜由 `writeStoryboard` 一次结构化输出（`withStructuredOutput`，functionCalling）写出四至十二段，不足 4 段重试一次；原来逐段调 `douyin_workbench_add_storyboard_shot` 工具、每段一轮请求的方式已移除。视频生成、发布和抓取分别读取 `DOUYIN_VIDEO_GENERATION_*`、`DOUYIN_PUBLISH_*`、`DOUYIN_DATA_*` 配置；未设置 `*_URL` 时返回 `*_NOT_CONFIGURED`。可选 `*_STATUS_URL_TEMPLATE` 用 `{id}` 占位同步异步状态；视频生成响应返回已登记到 `video-library` 的 `videoId` 后，子选题自动绑定该成片。模块没有 SuperClaw、Todo 或 Workspace 依赖。

**分镜与子选题改为后台异步生成**：`POST topics/:id/storyboard/generate` 与 `POST topics/:id/children/generate` 不再等 LLM 跑完，`DouyinGenerationJobService.start` 校验选题类型（分镜要子选题、子选题要母选题）、拦截同一选题正在运行的同类任务（409 `DOUYIN_GENERATION_ALREADY_RUNNING`），在 `douyin_generation_jobs` 写入运行中任务后立即返回 `{ job }`，生成在后台继续。两个生成服务通过 `onProgress` 回报真实进度：分镜每写入一段报一次段数，子选题规划后报总数、每写入一条报已写数，最后进入 `saving`。完成写 `result`（分镜段数，或规划数量与新子选题 ID），失败写失败码和 `DOUYIN_GENERATION_ERROR_MESSAGES` 翻译的中文原因（扣费不足等错误也以失败任务的形式出现，而不是接口直接报错）。`GET generation-jobs`（`read DouyinWorkbench`）返回运行中与最近 24 小时的任务供前端轮询；读取与启动前会把「运行中但不在当前进程、且 10 分钟没有进度写入」的任务收成 `DOUYIN_GENERATION_INTERRUPTED`，避免服务重启后永远显示生成中。

**分镜自动配图（目前只配图片）**：分镜生成前，`DouyinStoryboardImageService.loadCandidates` 用「母题 + 子题 + 补充要求」在当前租户图库挑候选图：先走 `GalleryService.searchSimilar` 向量检索（相似度 ≥0.35 的普通图），再按命中这段文字的图库标签随机取图，不够再随机补普通图，去重后最多 40 张；拼图、各类封面与 `ai素材` 一律排除。候选清单（`#ID｜竖/横｜标签｜描述`）不再塞进拆分镜的提示词：分镜写完后由 `pickShotImages` 单独一次关闭思考的调用（节点 `image-decision`，未指定时用默认文本模型）按每段画面挑图，只接受清单内的编号、同一张图不重复用，调用失败只记警告。选图完成后，`autoAssignShotImages` 给仍然没有素材的镜头补图：使用次数少的优先，其次比镜头文字与标签/描述的重合得分，再按候选相关度顺序，候选全部用过一轮后才会重复。写入的素材结构与前端手动「引用素材」一致（`type=image`、`url`、缩略图 `coverUrl`），保存时照常经过 `validateStoryboardMedia` 的租户归属校验；图库为空或读取失败时分镜照常生成，只是不配图。模块因此新增依赖 `GalleryModule`。

**脚本正文、分镜画面重生成与分镜视频**：子选题在前端显示为「脚本」，AI 生成时每条同时写入标题和口播正文（`script`，可经 `PATCH topics/:id` 修改）；分镜生成把正文交给 LLM 逐段拆解，旁白取自正文，并为每镜写 `imagePrompt`。`POST topics/:id/storyboard/:shotId/image/generate` 调 `AgentService.sendPrompt` 按竖屏 9:16 出图（计费由生图运行时按 `douyin-workbench.shot-image-generation` 记账），经 `GalleryAiImageService` 入图库并打「ai素材」「抖音分镜」标签，再用 `updateShot` 只写这一镜。`POST topics/:id/storyboard/:shotId/video/generate` 只提交这一镜给视频生成服务（请求带 `scope: 'shot'`、`shotId`、`shotIndex`，按 `video-generation` 扣费），调用记录带 `shotId`；直接拿到或同步到 `videoId` 时写到该镜的 `videoId`。整条 `video/generate` 请求带 `scope: 'composite'` 与正文，成片仍写到选题的 `generatedVideoId`。两类新接口都挂 `create DouyinWorkbench` 权限。

**候选脚本先挑选、再入库**：`POST topics/:id/children/generate` 的后台任务不再直接写 `douyin_topics`，而是把 LLM 写出的脚本连同随机 `key` 存进任务的 `result.drafts`。前端挑选后调用 `POST generation-jobs/:jobId/drafts/confirm`（`create DouyinWorkbench`）：服务端只接受这次任务里存在的 `key`，标题 / 正文留空则沿用候选原文；先原子地写入 `result.draftsSettledAt` 占住这批候选（重复提交返回 404 `DOUYIN_SCRIPT_DRAFTS_NOT_FOUND`，入库失败会撤销占用），再按顺序 `createChildren`（每条带规整后的 `storyboardPreference`），把新 ID 写回 `result.createdTopicIds`，最后逐条 `start('storyboard')`，响应返回 `{ topics, jobs, groups }`。`POST generation-jobs/:jobId/drafts/discard`（`update DouyinWorkbench`）只标记已处理。`GET generation-jobs` 额外返回候选还没处理的子选题任务，不受 24 小时窗口限制。

**配图偏向与先文字后配图**：子选题新增 `storyboardPreference: { imageSource: 'generate' | 'gallery', galleryTags }`，可经 `PATCH topics/:id` 修改，旧数据缺省视为图库自找、不限标签。分镜生成读取偏向：`gallery` 时 `loadCandidates` 带上限定标签（向量检索多取 60 张再按标签过滤，随机补足只在标签内取，不再按选题文字匹配标签或无标签补图），其余流程不变，文字和画面一起保存；`generate` 时不给 LLM 图库清单，只要求写好 `image_prompt`，文字分镜先落库并把进度切到 `imaging`（`current/total` = 已出图 / 镜头数），再用 `DouyinShotImageService.regenerate` 按并发 2 逐镜出图，每张图经 `updateShot` 单独写回，单镜失败只计数；全部失败时任务以 `DOUYIN_SHOT_IMAGES_ALL_FAILED` 结束（文字分镜仍保留），部分失败写进 `result.imageFailedCount`。出图计费沿用 `douyin-workbench.shot-image-generation`，按张记账。候选脚本与分镜任务都经 [AI 生成排队](../generation-queue/module.md) 的 `douyin-generation` 通道排队：全平台上限读平台信息 `douyinGenerationGlobalConcurrencyLimit`（默认 6），租户上限读租户 `douyinGenerationConcurrencyLimit`（默认 3），与小红书文章各算各的；申请名额 500ms 内没拿到就把进度切到 `queued`。一次确认多条脚本时超出上限的分镜任务在 `queued` 阶段等待；排队任务仍在本进程执行集合与排队登记簿里（多进程时登记簿覆盖全部 worker），不会被当成中断任务收掉。`GET generation-jobs` 每次轮询都会触发补位，后台调高上限后立即生效。

**按节点使用后台指定的模型**：候选脚本生成与生成要求推荐读取节点 `script`，分镜拆解读取 `storyboard`，图库自找时的分镜选图读取 `image-decision`（以 `disableThinking` 关闭思考），节点 key 统一取自 `WORKFLOW_NODES.douyinWorkbench`；二者把 [workflow-model](../workflow-model/module.md) 返回的提供商、模型、Key 与 baseUrl 覆盖进 `runWithMessages` 的 config；分镜画面（自动出图与单镜重生成）读取 `shot-image`，作为 `AgentService.sendPrompt` 的 `runtimeOverride`，指定后出图失败直接报错、不降级美图。节点没有设置时一律沿用后台默认提供商，行为与之前一致。`shot-video` / `full-video` 指定 PixMax 或数眼 Seedance 时走对应任务服务，未指定仍走 `DOUYIN_VIDEO_GENERATION_*`。

**两种生视频模式**：分镜模式（`POST topics/:id/storyboard/:shotId/video/generate`，节点 `shot-video`）每镜单独出一段，有画面时以画面为首帧；整片模式（`POST topics/:id/video/generate`，节点 `full-video`）把全部分镜按时间轴写进一条提示词，带上各镜画面作为参考图（按模型上限截取），一次生成一条完整视频，模型单次时长不够时按比例压缩每镜并在调用记录里标 `durationClamped`。指定 PixMax 时走 `DouyinPixmaxVideoService`；指定数眼智能的 Seedance 型号时走 `DouyinShuyanVideoService`，把 `/v1` baseUrl 还原成网关根地址后调用 `POST /seedance/api/v3/contents/generations/tasks`，单镜画面作为 `first_frame`，Seedance 2.x 整片最多带 9 张 `reference_image`，比例固定 9:16、分辨率默认 480p（`DOUYIN_SHUYAN_VIDEO_RESOLUTION`）、时长按版本收敛。数眼任务初建无 status 时保持 queued，每 15 秒用 `GET .../tasks/{id}` 续轮询，成功后在 `content.video_url` 的 24 小时有效期内转存 OSS；未配置 OSS 时仅登记临时外链并写警告。两条通道都在提交前按 `video-generation` 扣费、用原子 saving 状态防重复保存，并回填分镜 `videoId` 或脚本 `generatedVideoId`；未指定节点模型时仍走 `DOUYIN_VIDEO_GENERATION_*` 直连服务。指定数眼的 MiniMax-H3 时同样走 `DouyinShuyanVideoService`，但用另一套端点：`POST /hailuo/v2/video_generation`（返回 `task_id`）提交，`GET /hailuo/v2/query/video_generation/{id}` 查询（结果包在 `task` 里，成片在 `content.url`，约 7 天有效）；`resolution` / `duration` / `ratio` 都是顶层必填字段，不写在提示词里。模型名提交前对齐成枚举 `MiniMax-H3`；清晰度 `768P` / `2K`（默认 768P），时长 4～15 秒；单镜画面作首帧时 `ratio` 按接口要求传 `adaptive`（成片比例跟着图片走），整片最多带 9 张 `reference_image`、比例 9:16，纯文生视频也是 9:16；H3 没有声音开关，静音只靠提示词【声音】段约束。轮询按调用记录的型号选路由，接入 H3 前的旧记录一律按 Seedance 查。数眼的 Kling / Vidu / 旧版 Hailuo / 即梦等型号使用不同原生路由，当前会以 `SHUYAN_VIDEO_MODEL_NOT_SUPPORTED` 明确拒绝。

**声音是结构化设置、脚本随整片提交**：子选题新增 `videoAudio: { mode: voiceover | music | mute, language: zh-CN | yue | en }`（经 `PATCH topics/:id` 保存，缺省普通话配音），整片与分镜共用。生成时：模型有 `includeAudio` 参数就按「静音 = false，其余 = true」写入；提示词【声音】段由 `buildVideoAudioSection` 按设置生成（配音限定语言、禁止其他语言人声；仅音乐禁止人声；静音要求无声）。提示词统一分区：整片为【视频】【分镜时间轴】（逐镜画面、参考图编号、口播、转场）【口播稿】（完整脚本正文，没有正文时拼接各镜口播；非配音模式标注「不要朗读」）【声音】【参考图】【时长】【限制】【补充要求】；单镜的【口播稿】是本镜口播。调用请求记录 `audio`、`audioSwitchApplied`、`scriptIncluded`，视图 `plan` 带出声音与是否带口播稿。分镜画面在模型支持任意带图方式时一定带上（多图参考 → 图片参考 → 首尾帧 → 首帧），只有模型完全不支持带图才纯文生视频。

**真人画面换成卡通大头**：火山系视频模型（Seedance / 豆包）不收带真人的参考图，会以 `InputImageSensitiveContentDetected.PrivacyInformation` 在提交时直接打回。`POST .../image/mask-faces` 以这一镜当前画面为底图走图像编辑（`sendPrompt` 带 `baseImageCandidates` 时走的就是 image-edit 路径，不是重新文生图），按 `buildShotFaceMaskPrompt` 只把每个真人的头替换成 3D 皮克斯风卡通大头，构图、衣着、光线、人数与位置都要求保持原样。新图入图库（带 `抖音分镜` 标签）并绑定到这一段，处理前的画面记进分镜的 `originalMedia`；反复换头不会覆盖最早那张原图，`POST .../image/restore` 一键换回来。效果取决于 `shot-image` 节点配的模型——纯文生图模型给了底图也可能整张重画，这活要配图像编辑能力强的模型。注意这是「不再使用真人肖像」，不是给人脸打码去骗过检测；画面里仍有真人身体与场景时，仍可能被判 `may contain real person`。

**引用知识**：母选题新增 `knowledgeIds`（[knowledge](../knowledge/module.md) 模块的知识，最多 10 条，创建时 `CreateDouyinMotherTopicDto` 可带，`PATCH topics/:id` 可改，只对母题生效），工作台列表随母题原样返回。AI 生成脚本时 `DouyinChildTopicGenerationService` 读取母题引用，经 `KnowledgeService.buildPromptSection` 拼成 `<reference_knowledge>` 段放进创作背景，脚本涉及门店、产品、价格等具体信息以知识为准；已删除的知识自动跳过。

**人像处理风格**：`mask-faces` 接收可选 `style`（`MaskDouyinShotFacesDto`，缺省 `cartoon-3d`），`buildShotFaceMaskPrompt(style)` 按风格换一段核心要求，「场景、姿态、光线、人数与位置不变、不出文字水印」的收尾要求四种风格共用：`cartoon-3d` 头部换 3D 皮克斯风大头；`anime-bighead` 头部换二维动画 Q 版大头（描边 + 赛璐珞平涂，明暗贴合实拍光线）；`anthropomorphic` 整个人换成穿原衣服、保持原动作的拟人化卡通动物（不同的人用不同动物）；`deidentify` 把真人重绘成写实但带明显 AI 写真 / 电商模特图质感的虚拟模特（五官精致、皮肤干净、人物身上柔和补光，受光方向与色温仍随场景），脸与原人明显不同，衣着、配饰、姿态、发型长短与场景不变，去掉胸牌、纹身等身份细节，不打码不模糊——目的是让火山系视频模型不再把参考图识别为真人。所用风格写进分镜的 `faceMaskStyle`（DTO 白名单放行，前端保存分镜原样回传），图库命名为「…分镜画面（风格名）」；恢复原图时同时清空 `faceMaskStyle`。

**数眼通道的失败也翻译成中文**：提交期（`POST .../tasks` 直接 4xx）和轮询期（任务 `error`）的报错都走 `describeShuyanVideoFailure`：网络、密钥、限流、型号未接入这类通道自身的错走 `SHUYAN_VIDEO_ERROR_RULES`（不能套用 `PIXMAX_ERROR_RULES` 里写着「PixMax」的文案），模型内容审核类的错误码两家通用，交给 `PIXMAX_ERROR_RULES`；报错里带 `content[N]` 时按「`content[0]` 是提示词、往后依次是参考图」换算成「第 N 张参考图」点名。火山系模型不接受带真人的参考图（`InputImageSensitiveContentDetected.PrivacyInformation`），这条单独给了能照着做的说明（换空镜，或把配图偏向改成「AI 生成画面」）。原始报错仍写进 `errorDetail`，前端折叠在「查看原始信息」里；`presentDouyinVideoError` 对 pixmax 与 shuyan 两条通道的旧记录都做同样翻译。提交期失败不再一律说「请检查模型、密钥与参数」——真人素材被拒时那句是误导。

**视频生成错误友好化**：PixMax 通道的失败统一经 `pixmax-error` 翻译：提交阶段上传或审核某张分镜画面失败时，错误里会指明「第 N 镜的画面」（同一张图被多镜使用时列出全部镜号）；提交失败的 HTTP 响应、调用记录 `error` 都是中文说明，原始报错写进 `errorDetail`（视图带出，前端折叠显示）并记警告日志；任务失败、成片转存失败同样处理。旧记录没有 `errorDetail` 时由 `presentDouyinVideoError` 在输出时翻译。

**整片清晰度**：子选题新增 `fullVideoResolution`（模型自己的档位取值，如 `720P` / `1080p`；`PATCH topics/:id` 传空串清除，表示用模型默认档），只作用于整片模式；分镜模式另有 `shotVideoResolution`（同样的取值规则与清除方式，整条脚本的分镜共用，空为分镜模型默认档，直连通道放进单镜请求体的 `resolution`）。PixMax 通道把它交给 `buildPixmaxVideoParams` 的 `targetResolution`，在模型 `resolution` 参数的档位里就近取；数眼通道按 `clampShuyanVideoResolution` 收敛到型号支持的档（1080p 仅 Seedance 2.x；MiniMax-H3 只有 `768P` / `2K`，按短边像素就近取），没设定时用 `DOUYIN_SHUYAN_VIDEO_RESOLUTION`，型号没有这一档时取最低档；直连通道把 `resolution` 一并放进请求体。调用请求记录 `resolution`（实际提交档位）、`targetResolution`（设定值）与 `resolutionClamped`（设定档位模型不支持、已换档），视图 `plan` 带出前两者与是否换档。`GET video/options` 的 `resolutions` 告诉前端当前模型有哪些档位可选（直连通道给 `DIRECT_RESOLUTIONS`），为空表示这个通道不让选；前端只渲染这里报上来的档位，所以老客户端连上新后端、或新客户端连上老后端都不会设出存不进去的值。清晰度直接影响计费（供应商按「分辨率 × 时长」计价），档位越高越贵。

**整片生成时长**：子选题新增 `fullVideoDuration`（1～120 秒，`PATCH topics/:id` 传 0 清除，表示用模型最长时长）。整片生成时目标时长取它，未设定则取整片模型能生成的最长时长（数眼按 `listShuyanVideoDurationChoices`，PixMax 按 `listPixmaxDurationChoices`；PixMax 模型没有时长参数时才回落到分镜总时长；直连通道不传 `duration`，由服务自己决定），再按模型可选时长取不小于目标的最短一档（没有则最长一档）；时间轴每镜按「实际时长 / 分镜总时长」等比缩放，短于分镜总时长时压缩并在【时长】段要求所有镜头都出现，长于时放缓节奏。调用请求记录 `plannedSeconds`（分镜总时长）、`targetSeconds`（设定值）与 `durationClamped`（实际短于分镜总时长），直连通道请求也带 `duration`。`GET video/options` 告诉前端整片 / 分镜节点当前模型可生成哪些时长；分镜模式仍按每镜自己的时长就近取档。

**预设人物、脚本风格与参考图**：子选题新增 `personaId`（[预设人物](../douyin-persona/module.md)）、`scriptStyle`（`DOUYIN_SCRIPT_STYLES` 的键）、`referenceImages`（最多 4 张租户图库图片，写入前经 `validateMediaReferences` 校验归属）。三者可在生成候选脚本时统一指定（`POST topics/:id/children/generate` 带 `personaId` / `scriptStyle`，写进任务并在挑选入库时作为缺省），也可逐条在挑选时覆盖，或事后经 `PATCH topics/:id` 修改（`personaId` 传 0、`scriptStyle` 传空串、`referenceImages` 传空数组表示取消）。链路里的三处注入：写脚本与拆分镜用人设段（第一人称 + 叙事视角）与风格 `tone`；逐镜出图用人物外貌段与风格 `visual`，并把人物形象图、脚本参考图放进 `baseImageCandidates`；成片配音把音色写进【声音】段。`GET script-styles`（`read DouyinWorkbench`）返回风格登记表供前端渲染下拉。

**线性连贯出图**：AI 出图偏向下 `generateShotImages` 由并发改为串行，第 N 镜调用 `regenerate` 时传入第 N-1 镜刚生成的 `imageUrl` 作为 `previousImageUrl`，提示词里要求延续上一镜的场景、光线方向、色调与人物状态。单镜失败只计数并把 `previousImageUrl` 清空（下一镜改从人物形象图与参考图起头），已成功的画面不回滚。代价是一条分镜的出图时间约等于镜头数乘单张耗时，进度条的 `imaging` 阶段因此走得比以前慢。

**脚本生成提速（规划一次 + 并发写稿）**：原来候选脚本走 `createDeepAgent` 的工具循环——先调一次数量规划工具，再每条脚本调一次写入工具，每次工具调用都是一整轮 LLM 往返，而且每轮都带着 DeepAgent 自带的待办 / 文件系统 / 子代理提示词和越来越长的对话历史重发，12 条脚本就是十几轮串行请求。现在改为两步、都不走工具循环：`planScripts` 用 `withStructuredOutput(..., { method: 'functionCalling' })` 一次拿到全部标题与切入角度（去掉与已有题目或本轮重复的，少于 3 条再补规划一次），`writeScript` 按条并发写口播正文（`DOUYIN_SCRIPT_WRITE_CONCURRENCY` = 6，超出排队），总耗时约为「规划一次 + 写最慢的一条」。平台业务说明由 `buildSystemPrompt` 直接拼进系统提示（不再经过 Agent 自动合并）。单条太短或报错重试一次，仍失败的丢掉，至少写出一条就算成功（`decidedCount` 为规划数，`drafts` 可能少于它）；一条都没写出时优先抛真实错误（如额度不足），否则报 `DOUYIN_CHILD_TOPIC_GENERATION_INCOMPLETE_0_OF_N`。计费仍按 `douyin-workbench.child-topic-generation` 逐次记账，总调用数与原来持平，但每次的输入短得多。`recommendPrompt` 与 `refineScript` 仍走 `runWithMessages`。

**发布文案随分镜写好**：子选题新增 `publishCopy: { title, description, tags }`（上限与视频发布库一致：标题 60 字、正文 1000 字、话题 5 个且每个 20 字），经 `PATCH topics/:id` 修改，三项全空表示清掉（`normalizePublishCopy` 返回 null → `$unset`）。分镜任务在拆分镜的同时并行调用 `generatePublishCopy`（节点 `script` 的模型，一次结构化输出，不增加任务耗时），与分镜在同一次 `repository.update` 里保存，任务结果带 `publishCopyWritten`；两者同在分镜那一次 `text-generation` 扣费内（`runWithServiceBilling`）。重新生成分镜会按当前脚本重写文案；文案生成失败只记警告，分镜照常保存、原文案保留。前端保存到视频发布库时以它为默认值。

**脚本 AI 微调**：`POST script/refine`（`update DouyinWorkbench`）接收原正文与一句话修改指令，LLM 只改被点名的部分、保留原意与分段，选了人物或风格时一并作为约束（保持第一人称与调性）。结果不落库，由前端决定替换与保存，因此候选脚本挑选弹窗和已保存脚本都能用同一个接口。

**抓取数据改走数据监控**：工作台「抓取数据」区已改为与小红书同款的数据监控，后端在独立模块 `douyin-data`（`/api/douyin-data`，经 TikHub 按作品 ID 定时 / 手动抓取发布库里的已发布作品）。本模块的 `POST topics/:id/crawl` 直连抓取接口保留，但界面不再调用。

**分镜视频合成（客户端内置 ffmpeg）**：服务器不运行 ffmpeg。桌面客户端请求 POST topics/:id/video/concat（create DouyinWorkbench），带 auto 表示认领自动合成预约；后端校验所有镜头已出片、当前镜头没有生成中的调用、同脚本没有正在合成的记录，返回 provider=client、mode=concat 的运行中调用与按分镜顺序排列的片段地址。客户端用随安装包分发的 ffmpeg 合成，直传 OSS 并登记视频库，然后通过 POST operations/:id/concat-result（update DouyinWorkbench）回报 running / completed / failed；完成时验证视频库归属并绑定 generatedVideoId。只接受当前租户本人仍在运行的客户端合成回报。合成不扣 AI 生成费用。三十分钟无回报时，列表刷新、状态同步或下一次领取会将记录标为失败；服务器重启不会中断仍在客户端运行的合成。

**全部出片后自动合成**：客户端在全部所选分镜成功提交后 PATCH topics/:id 写 autoConcatShots=true。在线工作台发现所有镜头有视频、没有分镜生成或合成正在运行时自动领取；claimAutoConcat 原子清掉预约标记，避免多个客户端重复领取。重新提交分镜前先取消旧预约，部分人像处理或视频提交失败时不重新预约，防止合入旧视频。手动合成也清掉预约；autoConcatShots=false 可取消。客户端需要保持打开，离线期间已保存的预约在下次打开工作台时继续检查。

**探店模式（AI 提供商 + 通用契约）**：storeVisit 保存人物场景台词、声音描述 voiceDescription、来源 voiceSource=clone|design、使用模式 voiceMode=prompt|generated，以及可选固定音色 ID、名称、提供商模型和试听。旧记录按音色 ID 推断模式。PATCH topics/:id（update DouyinWorkbench 权限）允许编辑声音描述；voiceMode=prompt 原子切换到 design 并移除 ID/名称/提供商/模型/样本/试听/时间，保留描述、人物场景台词及已有成片，不调用供应商远端删除。只编辑描述保留固定音色。音色 ID 和 generated 模式仅由成功创建接口写入。

**探店提供商配置**：后台 digital-human 提供商分别绑定 voice-clone、voice-design、store-visit-video。声音设计默认直接使用提示词，无需 voice-design；该节点只用于可选固定音色生成。video/options 返回独立节点状态。适配服务须支持视频请求 voiceMode=prompt 和 voiceDescription，并允许不传 voiceId；实际厂商由适配服务对接，原生厂商地址不能直接用作通用契约地址。

**音色创建契约**：`POST topics/:id/store-visit/voice` 上传 multipart file（≤10MB），调用 `POST {baseUrl}/voice-clone`，请求 operationId/model/topicId/name/language/audioFileName/audioContentType/audioBase64，返回 voiceId（可为 voice_id / speakerId，支持 data 包装）；录音只转交不落盘，审计不含录音。`POST topics/:id/store-visit/voice/design` 收 description（去空白后 10～1000 字）、可选 name（≤60 字）、previewText（10～300 字，未传使用默认试听句），调用 `POST {baseUrl}/voice-design`，请求 operationId/model/topicId/name/language/description/previewText，返回 voiceId（或 voice_id / speakerId / speaker_id）与可选 previewUrl（或 preview_url / audioUrl / audio_url），支持 data/result/output 包装；仅 HTTP(S) 试听地址保存，不把通用请求 id 当音色 ID。两种创建成功才更新原音色，调用失败或缺 ID 记录失败审计并保留原音色；operation 分别为 voice-clone / voice-design，音色审计不进入视频轮询。

**探店视频契约**：生成校验人物场景和至少 10 字台词；固定音色要求 ID，纯提示词要求非空声音描述（≤1000 字）。POST {baseUrl}/digital-human/tasks 带 operationId/model/topicId/title/aspectRatio/voiceSource/voiceMode/lines/language/resolution/prompt/faceImageUrl/sceneImageUrls/sceneDescription。generated 带 voiceId/voiceModel/voiceProviderId；prompt 带 voiceDescription，描述同时加入 prompt 的【声音设计】段，不传 ID/音色模型/音色提供商并忽略旧残留 ID，仅调用视频节点，无音色创建调用或额外音色扣费。视频收费、失败退款、查询轮询和成片转存沿用既有流程，生成入口挂 create DouyinWorkbench 权限。

**探店数眼分段通道**：「探店数字人视频」节点选数眼智能（`shuyan` / `shuyanai`）时，`store-visit/generate` 不走通用数字人契约，改由 `DouyinStoreVisitShuyanService` 按 `storeVisit.segments` 逐段生成：模型名决定引擎（`kling-avatar-std` / `kling-avatar-pro` → 可灵数字人 `POST /kling/v1/videos/avatar/image2video`，`wan2.2-s2v` → 万相数字人 `POST /ali/api/v1/services/aigc/image2video/video-synthesis`）。音色要先从可灵音色库（`GET store-visit/voices` 拉 `/kling/v1/general/presets-voices`）选一个存成 `voiceSource=preset`；每段先按 `video-generation` 扣费，再用 `POST /kling/v1/audio/tts` 按这个音色把本段台词念成配音（可灵按 `audio_id`、万相按音频公网地址交给数字人），配音时长要在引擎范围内（可灵 2～300 秒，万相少于 20 秒），提交失败退款。数字人的画面是本段关键帧：`POST topics/:id/store-visit/segments/:segmentId/keyframe` 用「分镜画面」节点的生图模型，以出镜人物作底图、本段场景图作第二张参考图（`AgentService.sendPrompt` 的 `extraImageCandidates`）生成「人物在这个场景里」的竖屏首帧，入图库并写进分段。生成前清掉各段旧成片并打上 `autoConcatShots`，各段完成后转存视频库、绑定到分段（生成期间台词或关键帧被改过就不绑定），桌面端发现全部出片后用 `topics/:id/video/concat` 领取合成（此时片段按分段顺序），合成结果设为脚本成片。分段记录 `provider=shuyan`、`mode=store-visit`、带 `segmentId`，由分段通道自己每 15 秒轮询（数眼视频通道的轮询跳过它们），3 小时未结束判超时；单段可用 `segments/:segmentId/generate` 重做。数眼通道暂不支持录音克隆与声音设计音色。
