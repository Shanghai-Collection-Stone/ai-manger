# 模块名称 (Module Name)

AI 抖音工作台（douyin-workbench）

## 概述 (Overview)

提供租户隔离的抖音母选题、LLM 子选题、逐段分镜持久化，以及生成视频（整片 / 分镜 / 分镜合成 / 探店人物出镜与画外音）、发布视频和作品数据抓取直连接口。母题由用户创建；子题综合母题、租户或母平台 AI 提示词与用户补充要求生成，生成数量由 LLM 自主规划，内容类型在服务端固定为短视频。支持由 LLM 推荐一条可编辑的生成要求。分镜使用项目现有 LLM 并按 `text-generation` 服务一次扣费；其他三类操作只调用显式配置的 HTTP 服务，不会隐式使用 SuperClaw，也不会产生模拟结果。
探店另有租户共享的门店与点位（场景图库 AI 归类：视觉签名预分组 + 视觉模型归入点位、写描述打分），以及按门店与重点推荐点位推荐人物音色、按点位写台词并为每段挑参考图的 AI 编排。
每条脚本可选一个 [预设人物](../douyin-persona/module.md)（决定出镜人物的长相、叙事视角与成片音色）、一种脚本风格（决定口播调性与画面质感），以及最多 4 张来自租户图库的参考图。AI 出图偏向下逐镜出图为线性串行：第 N 镜以第 N-1 镜刚生成的画面为底图，叠加人物形象图与脚本参考图，换取镜头之间场景、色调与人物状态的连贯。

## 文件清单 (File List)

- `services/douyin-store-visit-lip-sync.ts` — 人物段视频型号出片后的对口型：可灵人脸识别与对口型地址、人脸解析、按出现时长挑主播与视觉比对提示、配音按出现时间切给选中的脸、跳过原因翻译与公开视图。
- `services/douyin-store-visit-continuity.ts` — 台词与场景边界判断、场景起始图复用、视觉 LLM 尾帧衔接任务和严格结构化结果校验。
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
- `services/douyin-shot-concat.service.ts` — 客户端合成协调，探店只交付生成的视频与字幕并保留原声；拒绝只有配音或旧替换音轨产出。
- `services/douyin-shot-concat.service.spec.ts` — 合成领取、全段原生声画与旧产出拒绝、生成并发保护、结果回报及过期收敛回归。
- `services/douyin-store-visit.service.ts` — 探店音色管理、逐段原生声画生成与队列，支持参考音色或文字音色；完成后不追加对口型，旧运行中任务兼容原快照。
- `services/douyin-cosyvoice.service.ts` — 阿里云百炼 CosyVoice 客户端：声音复刻（创建、等审核、删除音色）、按提示词设计音色、非实时语音合成与试听、WAV 时长解析、分类音色库目录与报错翻译。
- `services/douyin-cosyvoice.service.spec.ts` — 服务域名解析、克隆前缀、WAV 时长、音色库目录（每个分类男女声都有）、声音设计请求、报错翻译、合成配音请求与下载、错误保留单测。
- `services/douyin-store-visit-workflow.spec.ts` — 独立探店流程测试：新建探店草稿、场景租户校验、音色字段只由克隆、选用与提示词定制接口写入、场景说明标签保存与生成前必填、提示词定制音色、出镜人物与模板参数校验、分段成片与人物首帧的保留与作废、换人物作废首帧、百炼克隆（OSS 前置、删录音与旧音色、审核失败清理、格式校验）、系统音色选用与试听缓存、逐段配音与静音空镜提交、人物出镜段前置校验与首尾出镜混合提交（可灵对口型 + 数眼空镜）、配音超长 / 过短退费、仅凭标题与场景写台词。
- `services/douyin-store-visit-material.spec.ts` — 照片与视频参考、旧缓推转 AI、原生声画就绪、参考音色与文字音色回退、素材说明与台词事实校验回归。
- `entities/douyin-store-visit-store.entity.ts` — 探店门店与点位实体：门店（租户共享，名称、整体说明）、点位（名称、说明、开场标记、图片描述与精细度打分、补充实拍视频）、上限与自动收藏分数线、AI 归类结果结构。
- `services/douyin-store-visit-spot.service.ts` — 门店与点位管理、场景图库图片的视觉签名（dHash + 网格平均色）相似度预归类、视觉模型用归类工具逐张归入点位写描述打分（每次工具调用校验后立即推送），保存时写回图库备注并自动收藏高分图。
- `services/douyin-store-visit-spot.service.spec.ts` — 视觉签名距离、单链接聚类、归类工具会话（按 key 或中文名归入、同名只建一次、不合规调用返回原因不推送）、归类走轻量 Agent 只挂归类工具并逐条推送、归类提示词、点位名与分数规整单测。
- `services/douyin-store-visit-planner.service.ts` — 探店 AI 编排：按门店与重点推荐点位推荐出镜人物与音色（模型失败按规则兜底），按点位写台词并为每段挑同一点位的 1～3 张参考图。
- `services/douyin-store-visit-planner.service.spec.ts` — 点位目录（开场点位优先、只收已同步参考图）、「【点位k｜图k.a】」分段解析与挑图兜底、人物音色推荐校验与兜底单测。
- `services/douyin-store-visit-voice-anchor.spec.ts` — 音色锚点单测：音色标识与锚点作废、统一音色模式只先生成第 1 段且其余新镜头等锚点段、不开时照旧逐段排队、已有锚点时各段并行并拿锚点作参考音频、等锚点的续段取声音前不认领、锚点 WAV 时长校验与去重。
- `services/douyin-video-storage.service.ts` — 成片落库：本地合成文件或供应商临时地址存进视频库（OSS 优先，未配置时落 `public/uploads` 或登记外链），另存探店配音与克隆用的临时录音。
- `services/douyin-pixmax-video.service.ts` — PixMax 生视频通道：分镜 / 整片提示词、提交任务、后台轮询、成片转存视频库并回填。
- `services/douyin-pixmax-video.service.spec.ts` — 分镜与整片提示词单测。
- `services/douyin-shuyan-video.service.ts` — 数眼智能生视频通道（Seedance 与 MiniMax-H3 两条原生路由）：任务提交 / 查询、后台续轮询、临时成片转存视频库并回填。
- `services/douyin-shuyan-video.service.spec.ts` — 数眼视频路由、网关与任务地址、型号时长与清晰度、状态与错误映射单测。
- `config.example.env` — 视频生成 / 发布 / 抓取直连接口示例；合成使用客户端内置 ffmpeg，探店能力由后台提供商与节点配置。

## 函数清单 (Function List)

- `describeStoreVisitVoice(setting)` — 从定制提示词或音色库特征提取全片统一的声音描述 | keywords: 探店音色描述, 原生声音, store-visit-voice-description, native-sound
- `matchesStoreVisitRequest(topic, segment, request)` — 对齐 Mongo 空值后比较分段与任务快照（含点位模式的多张参考图），供排队、续段及成片绑定统一判断是否修改 | keywords: 分段快照校验, 数据库空值兼容, segment-request-match, mongo-null-compatibility
- `buildStoreVisitNativePrompt(input)` — 逐段生成动态画面与原生台词：支持时参考音色样本，否则使用文字音色；点位模式带同一点位的多张参考图时说明以图1 为主画面；不生成供合成替换的配音 | keywords: 探店原生声画, 台词音色提示, store-visit-native-video, dialogue-voice-prompt

- `STORE_VISIT_REAL_SCENE_RULES` — 所有探店视频最终追加的实景约束：不新增、不改变画面里的东西，缓慢推近或小幅平移，但原图里本来就有的灯光、屏幕、投影、布帘、热气等要自然动起来，不能像一张照片往前推 | keywords: 实景保真约束, 稳定镜头, real-scene-constraints, stable-camera
- `storeVisitVisualSource(segment)` — 读取生成素材来源，旧 local 照片统一按 original 生成动态声画。 | keywords: 探店画面来源, 旧数据兼容, store-visit-visual-source, legacy-visual-source
- `supportsStoreVisitReferences(model)` — 仅已接入且支持多图的型号允许分开传人物和场景 | keywords: 探店多图能力, 人物场景分图, store-visit-multi-reference, separate-person-scene
- `supportsStoreVisitReferenceAudio(model)` — Seedance 2.0 与 MiniMax-H3 支持参考音频，参考模式不能与 first_frame 混用。 | keywords: 参考音色能力, 参考音频, reference-voice-support, reference-audio
- `isStoreVisitVisualStart(segments,index)` — 场景、用途或来源变化直接切素材，本机素材段及紧跟它的段不接尾帧，禁止虚构人物入画过渡 | keywords: 实景镜头起点, 人物体验切换, real-scene-shot-start, experience-shot-boundary
- `isStoreVisitLocalSegment(segment)` — 兼容旧调用的本机素材判定，始终返回 false，所有分段都生成视频。 | keywords: 本机素材段, 免AI画面, local-material-segment, no-ai-footage
- `isStoreVisitSegmentReady(segment)` — 仅已生成视频且 nativeAudio 为真才可拼接，旧的仅配音或替换音轨版本必须重做。 | keywords: 分段就绪判断, 可拼接分段, segment-ready-check, mergeable-segment
- `buildStoreVisitExperiencePrompt(input)` — 指定一项产品或游玩动作，配画外音且不强制正脸讲解 | keywords: 人物体验提示词, 产品游玩动作, experience-video-prompt, product-play-action

- `isStoreVisitSceneStart(segments,index)` — 区分真实场景切换（照片或视频素材变了）与台词或镜头类型分段 | keywords: 场景起始判断, 台词场景分离, scene-start-check, dialogue-scene-separation
- `readStoreVisitSceneKeyframe(segment,segments)` — 只为主动合成来源读取同场景同用途的人物起始图 | keywords: 共享场景首帧, 场景画面复用, shared-scene-keyframe, scene-frame-reuse
- `StoreVisitContinuityPlan()` — 声明尾帧理解、衔接动作和实际视频提示词 | keywords: 尾帧衔接方案, 连续视频提示, tail-frame-plan, continuous-video-prompt
- `parseStoreVisitContinuityPlan(text)` — 校验视觉模型返回的三个非空字段 | keywords: 解析衔接方案, 视觉结果校验, parse-continuity-plan, vision-result-check
- `buildStoreVisitContinuityBrief({title,previous,segment,sceneChanged,sceneDescription?})` — 要求视觉 LLM 根据真实尾帧、原始场景与下一段台词规划衔接 | keywords: 尾帧理解要求, 场景衔接规划, tail-frame-analysis, scene-continuity-planning
- `DouyinOperationView.continuity()` — 公开连续生成阶段、前置段和序列编号 | keywords: 连续生成状态, 前置片段, continuity-status, predecessor-segment
- `DouyinOperationView.lipSync()` — 公开人物段对口型阶段与跳过原因 | keywords: 对口型阶段, 口型跳过原因, lip-sync-stage, lip-sync-skip-reason
- `DouyinStoreVisitLipSyncView()` — 对口型公开状态：识别人脸、对口型中、完成或跳过 | keywords: 对口型公开状态, 对口型阶段, lip-sync-public-state, lip-sync-stage
- `DouyinStoreVisitLipSyncState()` — 对口型服务端状态：原视频地址与时长、人脸会话、选中的脸、可灵任务与跳过原始报错，不外发 | keywords: 对口型内部状态, 原视频回退, lip-sync-internal-state, source-video-fallback
- `STORE_VISIT_LIP_SYNC_SKIP_PREFIX` — 对口型主动跳过的报错前缀，后接中文原因 | keywords: 对口型跳过标记, 跳过原因, lip-sync-skip-prefix, skip-reason
- `describeStoreVisitLipSyncSkip(raw)` — 翻成「没对上口型：…，已保留原画面」：主动跳过用自带原因，数眼 404 说明没开放接口，可灵业务错误带原话 | keywords: 对口型跳过说明, 报错翻译, lip-sync-skip-message, error-translation
- `STORE_VISIT_LIP_SYNC_MIN_MS` — 对口型单个音频片段最短 2000 毫秒 | keywords: 对口型最短片段, 音频裁剪下限, lip-sync-min-clip, audio-clip-floor
- `STORE_VISIT_FACE_COVERAGE_MIN` — 出现不到半段视频的脸视为路人 | keywords: 人脸出现占比, 路人过滤, face-coverage-threshold, passerby-filter
- `STORE_VISIT_FACE_MATCH_LIMIT` — 交给视觉模型比对的候选脸最多 6 张 | keywords: 候选人脸上限, 视觉比对数量, face-candidate-limit, vision-match-count
- `StoreVisitDetectedFace()` — 识别到的一张脸：编号、截图、出现起止毫秒 | keywords: 识别到的人脸, 人脸时间段, detected-face, face-time-range
- `StoreVisitLipSyncFace()` — 提交给可灵的一张脸与对应配音片段（毫秒） | keywords: 对口型人脸片段, 配音时间窗, lip-sync-face-clip, audio-window
- `buildStoreVisitLipSyncUrl(gateway,kind,taskId?)` — 拼 `/kling/v1/videos/identify-face` 与 `/kling/v1/videos/advanced-lip-sync[/{id}]` | keywords: 对口型接口地址, 人脸识别地址, lip-sync-task-url, identify-face-url
- `readFaceText(value)` — 取可灵返回的文本或数字字段（会话 ID、人脸编号、截图），其他类型当空 | keywords: 读取识别字段, 文本字段, read-face-field, text-field
- `readStoreVisitFaces(data,videoMs)` — 读出会话 ID 与每张脸，缺起止时间按整段算，Base64 截图补前缀 | keywords: 解析人脸识别, 人脸会话, parse-identify-face, face-session
- `planStoreVisitFaceMatch(faces,videoMs)` — 只有一张脸出现超过半段时直接用，否则按出现时长取候选交给视觉比对，备选为出现超过半段的最长那张 | keywords: 挑选主播人脸, 出现时长筛选, pick-presenter-face, coverage-filter
- `buildStoreVisitFaceMatchBrief(count)` — 出镜人物照对比候选脸的视觉任务，同一人被拆成多段时都列出 | keywords: 人脸比对提示, 主播身份确认, face-match-brief, presenter-identity-check
- `parseStoreVisitFaceMatches(text,count)` — 解析 `{"matches":[…]}`，只收范围内去重编号 | keywords: 解析人脸比对, 候选编号校验, parse-face-matches, candidate-index-check
- `buildStoreVisitLipSyncFaces(faces,{audioMs,videoMs,soundFile})` — 选中的脸按出现时间各对同一时段的配音，重叠归先出现的脸，短于 2 秒不提交 | keywords: 对口型片段编排, 配音时间切分, build-lip-sync-clips, audio-time-split
- `toStoreVisitLipSyncView(state?)` — 对外只给阶段与跳过原因 | keywords: 对口型状态视图, 隐藏内部字段, lip-sync-view, hide-internal-fields
- `ContinueDouyinStoreVisitDto()` — 校验前段视频与可选尾帧；同镜头续段由服务端强制要求真实尾帧 | keywords: 续段生成参数, 尾帧编号, continue-segment-dto, tail-image-id
- `FailDouyinStoreVisitContinuationDto()` — 校验本机截帧或上传失败原因 | keywords: 续段失败参数, 截帧错误, continuation-failure-dto, frame-extraction-error
- `continueStoreVisitSegment(req,operationId,dto)` — 鉴权后以实际尾帧认领并续接待处理段 | keywords: 续段生成接口, 尾帧衔接, continue-segment-api, tail-frame-continuity
- `failStoreVisitContinuation(req,operationId,dto)` — 仅结束本人尚在等待尾帧的调用 | keywords: 续段失败接口, 等待状态保护, continuation-failure-api, waiting-state-guard
- `readStoreVisitContinuationInput(req,operationId)` — 鉴权后返回前段真实素材地址与配音时长 | keywords: 续段素材接口, 前段视频鉴权, continuation-input-api, predecessor-video-auth
- `DouyinStoreVisitService.continueOperation(operationId,input,scope)` — 验证待处理段、来源及前段视频后原子认领，新镜头直接用素材，同镜头才理解尾帧；统一音色模式的新镜头等的是锚点段，锚点声音没上传前不认领，提交时拿锚点作参考音频；重复请求不重复扣费或提交 | keywords: 续接探店片段, 原子续段认领, continue-store-visit-segment, atomic-continuation-claim
- `DouyinStoreVisitService.failPendingContinuation(id,error,scope)` — 截帧失败时原子结束未认领任务 | keywords: 停止尾帧等待, 续段失败记录, stop-tail-wait, continuation-failure-record
- `DouyinStoreVisitService.readContinuationInput(id,scope)` — 校验前段视频归属并返回尾帧输入，原声片段按视频真实结尾截帧；统一音色模式还没锚点时附上锚点段的视频，让客户端先取声音 | keywords: 读取续段素材, 前段视频鉴权, read-continuation-input, predecessor-video-auth
- `DouyinWorkbenchRepositoryService.requireImage(id,scope)` — 验证图库归属并读取真实尾帧 URL | keywords: 校验尾帧素材, 图库归属, require-tail-image, gallery-ownership
- `buildContinuityService()` — 构造原子认领和视觉模型测试服务 | keywords: 连续生成测试服务, 原子认领测试, continuity-test-service, atomic-claim-test
- `buildContinuityService.findQueuedOperation(query)` — 按用户与租户匹配测试记录 | keywords: 续段作用域测试, 记录匹配, continuation-scope-test, record-match
- `buildContinuityService.claimQueuedOperation()` — 只允许一次原子认领 | keywords: 测试原子认领, 重复提交防护, test-atomic-claim, duplicate-submit-guard
- `buildContinuityService.patchQueuedOperation(query,patch)` — 将状态修改应用到测试记录 | keywords: 测试状态写入, 续段记录, test-status-write, continuation-record
- `applySet(target,patch?)` — 把 `$set`（含点号路径）写进内存记录，模拟 Mongo 更新 | keywords: 测试内存更新, 点号路径, test-memory-set, dotted-path
- `buildLipSyncService(options?)` — 构造 MiniMax-H3 人物段已出片的调用记录与数眼 / 可灵替身，验证出片后识别人脸与对口型 | keywords: 对口型测试服务, 人物段出片, lip-sync-test-service, presenter-video-ready
- `buildLipSyncService.claimLipSyncRow(query,patch)` — 按状态与对口型字段原子认领测试记录 | keywords: 测试对口型认领, 防重复提交, test-lip-sync-claim, duplicate-submit-guard
- `buildLipSyncService.patchLipSyncRow(query,patch)` — 将状态修改应用到对口型测试记录 | keywords: 测试状态写入, 对口型记录, test-status-write, lip-sync-record
- `buildLipSyncService.fakeShuyan(url)` — 按地址模拟数眼 H3 查询、可灵人脸识别与对口型 | keywords: 测试数眼替身, 可灵对口型替身, test-shuyan-double, kling-lip-sync-double
- `buildLipSyncService.fakeShuyanResponse(url)` — 按地址给出数眼 H3 查询、可灵人脸识别与对口型的响应 | keywords: 测试数眼响应, 可灵对口型响应, test-shuyan-response, kling-lip-sync-response
- `buildWanService()` — 构造「探店人物对口型」填 wan2.7-i2v 的测试服务 | keywords: 万相测试服务, 配音驱动人物段, wan-test-service, audio-driven-presenter
- `buildWanService.fakeWan(url)` — 按地址模拟数眼万相的创建与查询响应 | keywords: 测试万相替身, 百炼协议响应, test-wan-double, dashscope-protocol-response
- `buildStoreVisitRepository()` — 构造独立探店草稿与素材归属测试仓储 | keywords: 探店流程测试仓储, 租户素材测试, store-visit-test-repository, tenant-media-test
- `buildVoiceoverService(topic?)` — 构造探店画外音测试服务：保留真实作用域校验、扣费退费与分段校验，替换数据库、存储、百炼与数眼网络 | keywords: 画外音测试服务, 探店服务替身, voiceover-test-service, store-visit-service-double
- `materialSetting()` — 带视频素材开场、照片本机缓推与一段 AI 画面的探店设置测试数据 | keywords: 探店素材测试数据, 本机素材段, store-visit-material-fixture, local-segment-fixture
- `buildService(storeVisit)` — 构造本机素材生成测试服务：保留真实分段校验、排队与扣费逻辑，替换数据库、存储、百炼与数眼网络 | keywords: 本机素材测试服务, 探店服务替身, local-material-test-service, store-visit-service-double
- `buildWriter(responses)` — 构造只替换 LLM 的写台词测试服务 | keywords: 写台词测试服务, LLM替身, lines-writer-test-service, llm-double
- `DouyinChildTopicGenerationService.constructor(agentService,adminService,personas,repository,workflowModels,knowledge)` — 初始化脚本与探店台词生成依赖 | keywords: 初始化脚本生成, 生成依赖, init-script-generation, generation-dependencies

- `ReportDouyinConcatResultDto()` — 校验进度、完成视频 ID 或失败说明 | keywords: 合成结果参数, 客户端回报, concat-result-dto, client-report
- `DouyinConcatClip()` — 声明交给客户端合成的一段：镜号（探店为段号）、视频库 ID、下载地址与兜底时长；探店分段另带配音地址与字幕，客户端以配音时长为准定格补齐或截断并烧字幕；本机素材段的视频素材带入点 `start`，照片段带 `kind=image` 与运镜 `motion`（没有视频库 ID） | keywords: 合成片段, 分镜视频地址, 画外音片段, concat-clip, shot-video-url, voiceover-clip
- `DouyinConcatReport()` — 声明客户端合成结果 | keywords: 合成结果回报, 客户端回报, concat-result-report, client-report
- `DouyinShotConcatService.constructor(db,repository)` — 初始化客户端合成集合与仓储 | keywords: 初始化合成服务, 合成仓储, init-concat-service, concat-repository
- `DouyinShotConcatService.prepare(topicId,scope,options?)` — 校验就绪状态（探店模式按分段、片段 ID 为段 ID，本机素材段配好音即可）并返回合成记录与有序片段，素材地址取图库 / 视频库真实记录；参考音色出声的人物段（`nativeAudio`）只带字幕不带配音，合成时保留视频原声 | keywords: 准备客户端合成, 合成前校验, prepare-client-concat, concat-precheck
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
- `normalizeReferenceImages(input?,max=4)` — 规整脚本参考图：只留图片、去重、默认最多 4 张 | keywords: 规整脚本参考图, 参考图去重, normalize-reference-images, reference-dedupe
- `normalizeStoreVisitSceneImages(input?)` — 规整探店场景图：沿用图库引用规整（去重、最多 8 张），另保留每张的说明（500 字）与标签（去空去重、最多 10 个、每个 30 字） | keywords: 规整探店场景图, 场景说明标签, normalize-store-visit-scenes, scene-description-tags
- `DOUYIN_STORE_VISIT_MATERIAL_LIMIT` — 探店素材上限：场景图与实拍视频素材合计最多 32 个（点位模式每个点位带最多 4 张参考图、最多 8 个点位；旧版逐张选素材的界面仍限 8 个） | keywords: 探店素材上限, 图片视频合计, store-visit-material-limit, image-video-total
- `normalizeStoreVisitMaterialMeta(item?)` — 规整一个素材的说明（500 字）与标签（去空去重、最多 10 个、每个 30 字），空的不带 | keywords: 规整素材说明, 素材标签, normalize-material-meta, material-tags
- `normalizeStoreVisitSceneVideos(input?)` — 规整实拍视频素材：去重、最多 8 段，只留视频引用字段、说明、标签与时长（秒，一位小数），越权由 `validateMediaReferences` 拦截 | keywords: 规整探店视频素材, 视频素材说明, normalize-store-visit-videos, video-material-meta
- `normalizeStoreVisitOpeningScene(input,images,videos)` — 规整开场素材：只认指向当前场景图或视频素材的一项，否则清掉 | keywords: 规整开场素材, 门头招牌, normalize-opening-scene, storefront-sign
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
- `update(id,input,scope)` — 保存标题、脚本正文、类型、配图偏向、视频声音设置、整片目标时长与清晰度、发布文案、完整分镜或成片绑定，以及探店出镜人物（按租户图库校验，换人时作废首帧与人物段成片）、出镜模板、场景、台词与分段（音色字段不收），遵守选题作用域 | keywords: 更新抖音选题, 保存脚本正文, 持久化分镜, update-douyin-topic, persist-script-body, persist-storyboard
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
- `DouyinShotImageService.regenerate(topicId,shotId,prompt,scope,options?)` — 出一张竖屏新图入图库并绑定为该镜素材；底图候选依次为 `options.previousImageUrl`（上一镜画面）、人物形象图、脚本参考图，返回值带出 `imageUrl` 供下一镜串联 | keywords: 重新生成分镜画面, 绑定分镜素材, regenerate-shot-image, bind-shot-media
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
- `getVideoOptions()` — 返回各视频节点的型号、时长和清晰度，探店节点额外公开 multiReference 多图能力、referenceAudio 参考音色能力及既有口型能力 | keywords: 视频生成选项, 可选时长, 可选清晰度, video-generation-options, duration-choices, resolution-choices
- `openVideoDownload(videoId,user)` — 校验视频归属后由服务端拉取视频地址（站内地址读本地文件），返回可读流、类型、大小与文件名 | keywords: 代理下载视频, 跨域下载, proxy-video-download, cross-origin-download
- `sync(id,user)` — 收敛过期合成并按提供商同步异步调用：PixMax / 数眼直接查询推进，探店分段交给探店服务，客户端合成、音色审计、探店本机素材段配音与通用数字人历史记录返回当前记录 | keywords: 同步抖音调用状态, 异步任务查询, sync-douyin-operation, async-job-status
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
- `listShuyanVideoResolutionChoices(model)` — 数眼型号可选清晰度，写法与接口逐字一致（MiniMax-H3 为 `768P` / `2K`；wan2.7-i2v 为 `720P` / `1080P`；1080p 仅 Seedance 2.x） | keywords: Seedance可选清晰度, 型号清晰度范围, seedance-resolution-choices, model-resolution-range
- `shuyanResolutionHeightOf(label)` — 清晰度档位换算短边像素（`720p` → 720、`2K` → 1440、`4K` → 2160），供就近取档 | keywords: 清晰度短边像素, 档位换算, resolution-short-edge, resolution-to-pixels
- `clampShuyanVideoResolution(model,resolution?)` — 设定的清晰度（大小写不限）收敛到型号档位，对不上按像素就近取；没设定用默认档，型号没有默认档时取最低档 | keywords: Seedance清晰度收敛, 视频清晰度, clamp-seedance-resolution, video-resolution
- `ShuyanVideoTask` — 数眼创建 / 查询任务的内部响应结构（Seedance 平铺、`id`、`content.video_url`；MiniMax-H3 创建返回 `task_id`、查询包在 `task` 里、`content.url`） | keywords: 数眼视频任务, Seedance任务, H3任务, shuyan-video-task, seedance-task, minimax-h3-task
- `ShuyanVideoRoute` — 数眼已接入的视频原生路由 `seedance` / `hailuo-v2` / `wan`（万相百炼协议） | keywords: 数眼视频路由, 原生端点, shuyan-video-route, native-endpoint
- `resolveShuyanVideoRoute(model)` — 按模型名判路由：含 seedance → `seedance`，MiniMax-H3 → `hailuo-v2`，wan2.7-i2v（含快照）→ `wan`，其余视频族返回 null | keywords: 数眼视频路由, 视频模型支持, resolve-shuyan-video-route, video-model-support
- `normalizeShuyanVideoModel(model)` — MiniMax-H3 不分大小写对齐到接口枚举 `MiniMax-H3`，其余原样 | keywords: 数眼模型名规整, H3模型枚举, normalize-shuyan-video-model, minimax-h3-model-enum
- `resolveShuyanVideoTaskUrl(gateway,route,taskId?)` — 拼创建 / 查询地址（Seedance `/seedance/api/v3/contents/generations/tasks[/{id}]`；H3 `/hailuo/v2/video_generation`、`/hailuo/v2/query/video_generation/{id}`；万相 `/ali/api/v1/services/aigc/video-generation/video-synthesis`、`/ali/api/v1/tasks/{id}`） | keywords: 数眼视频任务地址, 创建与查询, shuyan-video-task-url, create-and-query
- `unwrapShuyanVideoTask(raw)` — 拆掉 MiniMax-H3 查询结果的 `task` 外壳；万相 `output` 里的任务 ID、状态、成片、错误与 `usage.duration` 规整成平铺结构；平铺结果原样 | keywords: 拆包数眼任务, H3查询结果, unwrap-shuyan-video-task, minimax-h3-query-result
- `SHUYAN_WAN_ASYNC_HEADERS` — 万相创建任务必带的 `X-DashScope-Async: enable` | keywords: 万相异步请求头, 百炼异步任务, wan-async-header, dashscope-async-task
- `SHUYAN_WAN_PROMPT_MAX` — 万相提示词上限 5000 字符 | keywords: 万相提示词上限, 提示词截断, wan-prompt-limit, prompt-truncate
- `buildShuyanWanPayload({model,prompt,firstFrameUrl,audioUrl?,duration,resolution})` — 万相百炼协议请求体：首帧 `first_frame`、可选配音 `driving_audio`，不改写提示词、不加水印 | keywords: 万相请求体, 首帧驱动音频, wan-request-body, first-frame-driving-audio
- `resolveShuyanVideoGateway(baseUrl?)` — 从 OpenAI `/v1` baseUrl 还原数眼原生视频网关 | keywords: 数眼视频网关, 移除V1路径, shuyan-video-gateway, strip-v1-path
- `listShuyanVideoDurationChoices(model)` — 返回整数秒可选范围（wan2.7-i2v 2~15 秒，MiniMax-H3 4~15 秒，Seedance 按版本） | keywords: Seedance可选时长, 型号时长范围, seedance-duration-choices, model-duration-range
- `clampShuyanVideoDuration(model,seconds)` — 收敛到数眼型号允许的整数秒 | keywords: Seedance时长收敛, 视频时长, clamp-seedance-duration, video-duration
- `mapShuyanVideoStatus(status?)` — 把 queued / running / succeeded / failed 等状态（含万相 CANCELED / UNKNOWN 判失败）映射成工作台状态，初建无状态视为 queued | keywords: 数眼视频状态映射, 初建无状态, map-shuyan-video-status, missing-status-queued
- `describeShuyanVideoError(task)` — 保留错误码与消息生成中文失败说明 | keywords: 数眼视频错误, 上游错误码, describe-shuyan-video-error, upstream-error-code
- `DouyinShuyanVideoService()` — 数眼 Seedance / MiniMax-H3 生视频、轮询与成片转存通道 | keywords: 数眼Seedance生视频, 数眼H3生视频, 成片转存, 分镜视频, shuyan-seedance-video, shuyan-minimax-h3-video, persist-generated-video, shot-video
- `DouyinShuyanVideoService.onModuleInit()` — 启动后台轮询并在重启后续跟；多进程时只在 leader 进程上轮询 | keywords: 启动数眼视频轮询, 重启续跟, start-shuyan-video-polling, resume-after-restart
- `DouyinShuyanVideoService.onModuleDestroy()` — 停止数眼后台轮询 | keywords: 停止数眼视频轮询, 模块销毁, stop-shuyan-video-polling, module-destroy
- `DouyinShuyanVideoService.start(input)` — 按型号选 Seedance / MiniMax-H3 / 万相路由，组装多模态 content（万相为百炼协议请求体，必须有公网地址的分镜画面作首帧）、扣费、提交任务并写调用记录 | keywords: 提交数眼视频, Seedance多模态, submit-shuyan-video, seedance-multimodal
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
- `listScriptStyles()` — `GET script-styles`（`read DouyinWorkbench`），返回脚本风格登记表，取值与后端校验同源 | keywords: 脚本风格选项接口, 风格登记表, script-style-options-api, style-registry
- `refineScript(req,dto)` — `POST script/refine`（`update DouyinWorkbench`），按一句话指令 AI 微调口播正文，只返回改写结果不落库 | keywords: 脚本微调接口, 按指令改写, refine-script-api, instruction-rewrite
- `update(req,id,dto)` — 更新选题或保存分镜 | keywords: 更新抖音选题接口, 保存分镜接口, update-douyin-topic-api, save-storyboard-api
- `remove(req,id)` — 删除选题并级联清理 | keywords: 删除抖音选题接口, 级联清理, delete-douyin-topic-api, cascade-cleanup
- `generateStoryboard(req,id,dto)` — 启动后台 LLM 分镜生成并立即返回运行中任务 | keywords: 生成抖音分镜接口, 真实LLM, generate-douyin-storyboard-api, real-llm
- `generateVideo(req,id,dto)` — 调用视频生成服务 | keywords: 生成视频任务接口, 服务扣费, generate-video-task-api, service-charge
- `publish(req,id,dto)` — 调用抖音发布服务 | keywords: 发布抖音视频接口, 真实视频素材, publish-douyin-video-api, real-video-asset
- `crawl(req,id,dto)` — 调用作品数据服务 | keywords: 抓取抖音数据接口, 真实作品, crawl-douyin-data-api, real-published-video
- `videoOptions()` — `GET video/options` 返回整片 / 分镜节点的通道、模型、可选时长与清晰度，以及探店三个节点的就绪状态（`read DouyinWorkbench`） | keywords: 视频生成选项接口, 可选时长, video-generation-options-api, duration-choices
- `downloadVideo(req,videoId,res)` — `GET videos/:videoId/download` 以附件形式代理下载视频库视频（`read DouyinWorkbench`） | keywords: 下载视频接口, 代理下载, download-video-api, proxy-download
- `listOperations(req)` — 查询直连调用记录 | keywords: 查询抖音任务接口, 供应商响应, list-douyin-operations-api, provider-response
- `syncOperation(req,id)` — 同步供应商异步状态 | keywords: 同步抖音任务接口, 供应商状态, sync-douyin-operation-api, provider-status
- `readId(value)` — 校验路由业务 ID | keywords: 解析抖音业务ID, 路由校验, parse-douyin-business-id, route-validation
- `requireUser(req)` — 读取鉴权用户 | keywords: 读取抖音用户, 鉴权上下文, read-douyin-user, auth-context
- `scopeOf(user)` — 构造控制器数据边界 | keywords: 构造抖音作用域, 用户边界, build-douyin-scope, user-boundary
- `DouyinStoreVisitVoiceSample` — 克隆音色用过的录音信息（文件名、类型、大小）；录音只为克隆临时传到对象存储、克隆完即删 | keywords: 克隆音色录音, 探店音色样本, voice-clone-sample, store-visit-voice-sample
- `DouyinStoreVisitSetting` — 探店设置：门店名称、出镜人物照、出镜模板、独立场景图与实拍视频素材（各带说明与标签）、开场素材与选填的门店整体说明、音色（来源 clone / preset / design、ID、名称、模型、提供商、录音样本与克隆时间、提示词定制的声音描述 `voicePrompt`）、台词与分段；旧版数字人的声音设计字段不再读取 | keywords: 探店模式设置, 画外音设置, 克隆音色, store-visit-setting, voiceover-setting, cloned-voice
- `DouyinStoreVisitSceneImage` — 探店场景图：图库「场景图库」图片引用，另带这张场景的说明与标签（与图库备注、标签同步），生成前每张都必须写好说明 | keywords: 探店场景图, 场景说明, store-visit-scene-image, scene-description
- `DOUYIN_STORE_VISIT_MOTIONS` — 照片在本机的运镜：缓慢推近、缓慢拉远、左右平移、静止，由桌面端 ffmpeg 生成，不调用 AI | keywords: 本机运镜, 图片缓推, local-motion, image-ken-burns
- `DouyinStoreVisitSceneVideo` — 探店实拍视频参考素材，说明提供事实依据，交给模型重新生成声画。 | keywords: 探店视频素材, 实拍素材, store-visit-scene-video, real-footage
- `DouyinStoreVisitOpeningScene` — 开场素材（门头 / 招牌）：指向场景图或视频素材里的一项，AI 写台词时开场段固定用它 | keywords: 开场素材, 门头招牌, opening-scene, storefront-sign
- `DOUYIN_STORE_VISIT_TEMPLATES` — 出镜模板取值：`presenter-all` 一镜到底、`bookend` 首尾出镜、`opening` 只开场出镜、`voiceover` 纯画外音、`custom` 逐段自定义 | keywords: 探店出镜模板, 镜头编排, store-visit-template, shot-arrangement
- `DouyinStoreVisitSegment` — 探店分段：照片或视频作为参考，每段生成动态视频与台词声音，nativeAudio 标记原声，audioUrl 仅保留旧数据兼容。 | keywords: 探店分段, 画外音配音, 分段成片, store-visit-segment, segment-voiceover, segment-video
- `DOUYIN_STORE_VISIT_LINES_MAX` — 探店台词最长 2000 字，前端台词框同上限 | keywords: 探店台词上限, 台词字数, store-visit-lines-limit, lines-length
- `DouyinStoreVisitSegmentDto()` — 校验一段探店分段：段 ID、本段台词（最多 1000 字）、对应场景图或视频素材 ID、点位模式的点位 ID 与 1～3 张参考图、视频入点、本机运镜、画面描述、镜头用途（实景 / 体验 / 讲解）与画面来源；人物首帧、成片与配音只由服务端写入 | keywords: 探店分段参数, 分段台词, store-visit-segment-dto, segment-lines
- `DouyinStoreVisitDto()` — 校验门店（点位模式另带门店 ID 与最多 8 个重点推荐点位）、素材（合计最多 32 个）、台词、分段与可编辑的声音提示词，音色 ID 等受保护字段仍由音色接口写入 | keywords: 探店设置参数, 场景台词, store-visit-setting-dto, scene-lines
- `DouyinStoreVisitSceneImageDto()` — 校验探店场景图：图库图片引用另带说明（最多 500 字）与标签（最多 10 个、每个 30 字内），旧数据没有说明时保存不拦 | keywords: 探店场景图参数, 场景说明标签, store-visit-scene-image-dto, scene-description-tags
- `DouyinStoreVisitSceneVideoDto()` — 校验探店实拍视频素材：视频库引用另带说明（最多 500 字）、标签（最多 10 个、每个 30 字内）与时长 | keywords: 探店视频素材参数, 素材说明, store-visit-scene-video-dto, material-description
- `DouyinStoreVisitOpeningSceneDto()` — 校验开场素材：指向场景图（image）或视频素材（video）里的一项 | keywords: 开场素材参数, 门头招牌, opening-scene-dto, storefront-sign
- `ConcatDouyinShotVideosDto()` — 校验客户端是否领取自动合成预约 | keywords: 分镜合成参数, 自动合成领取, concat-shot-videos-dto, auto-concat-claim
- `GenerateDouyinStoreVisitLinesDto()` — 校验 AI 写探店台词的一句话补充要求 | keywords: 探店台词参数, 台词补充要求, store-visit-lines-dto, lines-requirement
- `DouyinStoreVisitVoiceDto()` — 校验选用或试听的音色 ID（字母数字）：音色库音色由服务端按目录再校验，克隆、定制音色只允许本脚本自己的 | keywords: 音色参数, 选用试听音色, store-visit-voice-dto, pick-or-preview-voice
- `DesignDouyinStoreVisitVoiceDto()` — 校验提示词定制音色：声音描述 5～500 字（百炼声音设计只认中英文、最多 500 字），可选 30 字内的音色名称 | keywords: 提示词定制音色参数, 声音描述, design-voice-dto, voice-prompt
- `GenerateDouyinStoreVisitKeyframeDto()` — 校验生成人物首帧的可选补充描述（最多 500 字） | keywords: 人物首帧参数, 首帧补充描述, keyframe-dto, keyframe-requirement
- `normalizeStoreVisitLines(input?)` — 规整探店台词：统一换行、去首尾空白、最多 2000 字 | keywords: 规整探店台词, 台词字数, normalize-store-visit-lines, lines-length
- `DOUYIN_STORE_VISIT_SEGMENT_LIMITS` — 分段上限：最多 8 段、单段台词 1000 字（实际按单段视频时长控制在约 60 字内）、画面描述 300 字 | keywords: 探店分段上限, 单段台词上限, store-visit-segment-limit, segment-lines-limit
- `normalizeStoreVisitSegments(input,sceneImageIds,sceneVideoIds?)` — 规整探店分段（只收台词、场景图或视频素材 ID、点位模式的点位 ID 与同一点位 1～3 张参考图、视频入点、本机运镜、画面描述、镜头类型、画面来源与段 ID，人物首帧、成片与配音由服务端写）：去掉空台词段，段 ID 不合法或重复时换新，素材不在本选题素材里时清空；视频素材段不收人物镜头类型（人物出镜要用图片），最多 8 段 | keywords: 规整探店分段, 分段校验, normalize-store-visit-segments, segment-validation
- `mergeStoreVisitSegments(next,current)` — 保存分段时接上服务端写入的字段：场景（含参考图组）没变时保留人物首帧；台词、场景、画面描述与镜头类型都没变、且没有依赖的前段改动时，再保留这段的视频、配音与所用音色，任一改了就作废。新镜头（换素材、换用途或紧跟本机素材段）不依赖前段尾帧，前段改动不连带作废它；本机素材段的产出只有配音，台词没变就保留，换素材、入点或运镜都不用重新配音 | keywords: 合并探店分段, 保留分段成片, merge-store-visit-segments, keep-segment-output
- `clearPresenterKeyframes(segments)` — 换人物后清除所有场景起始图及依赖旧尾帧的成片，本机素材段与人物无关、保留配音 | keywords: 换人物作废首帧, 人物出镜成片作废, reset-presenter-keyframes, invalidate-presenter-output
- `saveStoreVisitVoice(id,voice,scope)` — 写入录音克隆、音色库预置音色或提示词定制的音色：克隆带录音样本与克隆时间，提示词定制带声音描述 `voicePrompt`，其余来源清掉它们；同时清掉旧版数字人的声音设计、试听与语种字段，场景与台词不动 | keywords: 保存探店音色, 克隆音色, save-store-visit-voice, save-cloned-voice
- `claimAutoConcat(id,scope)` — 原子清掉「全部出片后自动合成」标记，只有真正清掉的那次返回 true | keywords: 认领自动合成, 防重复合成, claim-auto-concat, dedupe-concat
- `updateStoreVisitSegment(topicId,segmentId,output,scope)` — 按段 ID 一次绑定空镜视频（先校验视频库归属）、配音地址与时长、所用音色，本机素材段不带视频时只写配音并清掉旧视频，参考音色出声的段同时标记 `nativeAudio`，传 null 一次清掉；段不存在时返回 null | keywords: 更新探店分段, 分段局部写入, update-store-visit-segment, partial-segment-write
- `setStoreVisitSegmentKeyframe(topicId,segmentId,keyframe,scope)` — 同场景共享人物起始图，并作废依赖旧尾帧的后续输出 | keywords: 写入人物首帧, 首帧作废成片, save-segment-keyframe, keyframe-invalidates-output
- `writeStoreVisitLines(topicId,prompt,scope)` — 独立探店按素材说明写一条完整的画外音口播（约 30～60 秒，附示例示范写法与节奏）：开场用门头素材报店名和这家店最吸引人的一点，后面每段照一个素材的说明介绍是什么有什么（两三句短句），团购价要连同套餐或项目一起报（不必每段都报、不套固定句式），结尾引导下单，语气口语自然、不用江湖口吻，用词只用普通话常用词、不用方言和谐音字（优先于人物设定）；只用门店名称、整体说明与素材说明（`<materials>` 按【素材k】序号）里的事实，出现资料里没有的数字、方言谐音字或格式不对时让模型重写一次，仍有问题返回 `warnings`；旧脚本按正文或分镜口播改写 | keywords: 探店台词生成, 画外音台词, store-visit-lines, voiceover-lines
- `StoreVisitMaterialEntry` — 写台词用的一项素材（类型、ID、名称、说明、标签、时长、是否开场），序号即【素材k】的 k | keywords: 探店素材目录项, 素材序号, store-visit-material-entry, material-index
- `listStoreVisitMaterials(setting)` — 按台词序号排好素材：开场素材排第一，其余照片在前、视频在后 | keywords: 探店素材目录, 开场素材排序, store-visit-material-catalog, opening-first
- `describeStoreVisitMaterials(materials)` — 把素材写成提示词清单：「素材k（开场·门头，图片 / 视频 N 秒）：说明（标签：…）」 | keywords: 素材清单提示词, 素材说明, material-catalog-prompt, material-description
- `parseStoreVisitMaterialSegments(text,materials)` — 解析以「【素材k】」（兼容「【场景k】」）开头的分段台词并对回照片或视频，标记缺失或越界时返回空 | keywords: 解析分素材台词, 素材标记, parse-material-segments, material-marker
- `findStoreVisitUnknownNumbers(lines,facts)` — 找出台词里资料没写过的数字（资料里的数字及其整数部分算已知） | keywords: 台词数字核对, 防编造价格, verify-lines-numbers, prevent-fabricated-price
- `findStoreVisitUnknownNumbers.normalize(value)` — 去掉小数末尾的 0，让 99.0 与 99 算同一个数 | keywords: 数字规整, 小数去零, normalize-number, trim-decimal-zero
- `reviewStoreVisitLines({segments,facts,storeName?})` — 核对台词：资料里没有的数字、方言谐音字、中文数字价格、开场没报店名、整条不到约 20 秒都写成提醒 | keywords: 探店台词核对, 台词提醒, verify-store-visit-lines, lines-warnings
- `STORE_VISIT_LINES_MIN_CHARACTERS` — 探店台词整条最少 90 字（约 20 秒），少于它时提醒把素材说明写具体些再重写 | keywords: 台词最少字数, 台词偏短提醒, lines-min-characters, short-lines-warning
- `STORE_VISIT_HARD_TO_VOICE_WORDS` — 配音和视频模型容易念错的方言词、方言音译字与网络谐音字清单（嘎哈、咋整、杠杠的、酱紫、木有等） | keywords: 难念字眼, 方言词, hard-to-voice-words, dialect-words
- `STORE_VISIT_PLAIN_SPEECH_RULE` — 探店台词「好念」规则：只用普通话常用词，人物设定或补充要求偏方言风格时只在语气节奏上体现；优先于人物设定和补充要求（点位台词也复用） | keywords: 台词好念规则, 普通话用词, plain-speech-rule, mandarin-wording
- `findStoreVisitHardToVoiceWords(lines,facts)` — 找出台词里的方言谐音字，店名与素材说明里本来就有的不算 | keywords: 难念字眼核对, 方言词核对, find-hard-to-voice-words, dialect-word-check
- `DouyinOutputVideoMeta` — 成片登记参数（名称、作用域、标签、时长、尺寸） | keywords: 成片登记参数, 视频库登记, output-video-meta, video-library-register
- `resolveStaticFilePath(url)` — 站内 `/static/...` 地址换成 `public` 下的磁盘路径，拒绝 `..` 穿越 | keywords: 站内地址转磁盘路径, 路径穿越防护, static-url-to-path, path-traversal-guard
- `DouyinVideoStorageService()` — 抖音成片落库服务，另存探店配音与临时克隆录音 | keywords: 抖音成片落库, 视频库登记, douyin-output-video-storage, video-library-register
- `DouyinVideoStorageService.saveFile(filePath,meta)` — 本地 mp4 存进视频库：OSS 配好时上传并按对象键登记，否则复制到 `public/uploads/douyin-video` 并登记站内地址 | keywords: 保存本地成片, 合成成片入库, save-local-video, store-merged-video
- `DouyinVideoStorageService.saveRemote(url,meta)` — 供应商临时地址存进视频库：OSS 配好时下载后走 `saveFile`，否则登记外链 | keywords: 保存供应商成片, 临时地址转存, save-remote-video, persist-temporary-url
- `DouyinVideoStorageService.download(url,target)` — 站内文件直接复制、公网地址流式下载到本机，10 分钟超时 | keywords: 下载视频到本机, 站内文件复制, download-video-file, copy-static-file
- `DouyinVideoStorageService.commonFields(meta)` — 视频库登记公共字段（时长换算毫秒） | keywords: 视频登记公共字段, 时长换算, video-register-fields, duration-to-ms
- `DouyinVideoStorageService.saveAudio(buffer,meta)` — 保存探店配音或克隆录音：OSS 配好时上传到 `audio` 场景返回公网地址与对象键，否则落 `public/uploads/douyin-audio` 返回站内地址 | keywords: 保存配音文件, 音频入存储, save-audio-file, store-voiceover
- `DouyinVideoStorageService.deleteAudio(key)` — 删掉 `saveAudio` 存到 OSS 的音频（克隆完录音立即删），失败不抛错 | keywords: 删除音频文件, 清理录音, delete-audio-file, cleanup-voice-sample
- `DouyinVideoStorageService.publishImage(url,scope)` — 把首帧图（图库站内图片或 Base64）传到 OSS 的 `poster` 场景换公网地址，已是 http(s) 原样返回；给只认公网地址的万相用，没配 OSS 抛 `DOUYIN_PUBLIC_STORAGE_MISSING` | keywords: 首帧图转公网地址, 图片传OSS, publish-frame-image, image-to-oss
- `DouyinVideoStorageService.hasPublicStorage()` — 存储能否给外部服务公网访问，只有配了 OSS 才能把录音交给百炼克隆 | keywords: 公网存储可用, OSS已配置, public-storage-available, oss-configured
- `DOUYIN_SHOT_CONCAT_STALE_MS()` — 合成记录 30 分钟无进度判中断 | keywords: 合成中断判定, 静默超时, concat-stale-threshold, silent-timeout
- `DOUYIN_RUNNING_OPERATION_STATUSES()` — 生成中状态值，与前端一致，自动合成据此等待仍在生成的分镜 | keywords: 生成中状态, 自动合成等待, running-operation-statuses, auto-concat-wait
- `DouyinShotConcatService()` — 协调客户端合成与自动合成认领 | keywords: 分镜视频合成, 客户端合成, 自动合成, shot-video-concat, client-side-merge, auto-concat
- `DouyinShotConcatService.settleStale()` — 将三十分钟未回报的客户端合成标为失败，供列表刷新、同步与领取入口调用 | keywords: 收敛中断合成, 僵尸记录, settle-stale-concat, zombie-operation
- `DouyinShotConcatService.tenantFilter(tenantId?)` — 合成记录的租户边界 | keywords: 合成租户过滤, 母平台边界, concat-tenant-filter, platform-boundary
- `DouyinShotConcatService.toView(row)` — 合成调用视图 | keywords: 合成调用视图, 隐藏请求, concat-operation-view, hide-request
- `DOUYIN_STORE_VISIT_POLL_MS` — 后台跟进探店分段空镜视频的间隔（15 秒） | keywords: 探店分段轮询间隔, 后台轮询, store-visit-segment-poll-interval, background-polling
- `DOUYIN_STORE_VISIT_TASK_TIMEOUT_MS` — 分段空镜视频 3 小时未完成判超时，保存中超过 10 分钟可重新认领 | keywords: 探店分段超时, 保存中断, store-visit-segment-timeout, saving-stale
- `DOUYIN_VOICE_SAMPLE_MAX_BYTES` — 克隆音色录音最大 10MB，前端上传前也按它拦 | keywords: 录音大小上限, 克隆音色录音, voice-sample-limit, voice-clone-sample
- `DOUYIN_VOICE_SAMPLE_EXTENSIONS` — 百炼声音复刻接受的录音格式（WAV 16bit、MP3、M4A），按扩展名认 | keywords: 录音格式, 音频扩展名, voice-sample-format, audio-extension
- `DOUYIN_STORE_VISIT_FREEZE_TOLERANCE_SECONDS` — 配音比画面型号单段上限多出这几秒内时合成阶段定格补齐，再长要求拆短 | keywords: 定格补齐容差, 单段配音上限, freeze-frame-tolerance, segment-audio-limit
- `DOUYIN_STORE_VISIT_LOCAL_MAX_SECONDS` — 本机素材段单段配音上限 30 秒，不受视频模型时长限制，只为控制节奏 | keywords: 本机素材段时长上限, 单段配音上限, local-segment-max-seconds, segment-audio-limit
- `STORE_VISIT_REFERENCE_AUDIO_SECONDS` — 数眼 Seedance 2.0 参考音频时长 2～15 秒，人物段用这段配音作参考音色时配音须在此范围 | keywords: 参考音频时长, 参考音色限制, reference-audio-range, reference-voice-limit
- `DOUYIN_STORE_VISIT_VIDEO_RESOLUTION` — 空镜视频默认清晰度，在型号档位里取最接近 720p 的一档 | keywords: 空镜视频清晰度, 默认清晰度, broll-resolution, default-resolution
- `DOUYIN_STORE_VISIT_PREVIEW_TEXT` — 音色库、克隆与提示词定制音色共用的试听句子，也是声音设计的试听文本（百炼要求 15～200 字） | keywords: 音色试听文本, 试听句子, voice-preview-text, trial-sentence
- `buildStoreVisitSceneBrief(setting,sceneImageId?)` — 拼分段用的场景说明：这一段场景图自己的说明与标签在前，门店整体说明在后，最多 600 字；写进首帧、续段衔接与视频提示词 | keywords: 分段场景说明, 场景标签, segment-scene-brief, scene-tags
- `buildStoreVisitBrollPrompt(input)` — 以原图或真实尾帧为首帧生成实景画面，没写画面描述时镜头缓慢推近、画面里已有的东西自然动起来，不新增空间或对象 | keywords: 空镜视频提示词, 探店画面, broll-video-prompt, store-visit-footage
- `buildStoreVisitReferencePrompt({title,sceneDescription?,personName?,personAppearance?,action?,lines,seconds,shot,voiceReference?})` — 门店照片与人物照一起交给多图参考视频模型时的提示词：先写【图片说明】（图1 是本段门店画面及素材说明，图2 是出镜人物名字与外貌、只取长相穿着不复制人物照背景），再写【脚本】（人物讲解对着镜头说这段台词，人物体验只做一项动作配画外音）和【画面】（人物站在场景里的中景构图、画面里已有的东西动起来），画面无文字、静音；带参考音色时多写「音频1」说明，人物讲解段用音频1 的音色和语气把台词说出来、声音只要这一个人的说话声 | keywords: 多图参考提示词, 图片说明加脚本, multi-reference-prompt, image-legend-and-script
- `STORE_VISIT_PERSON_IN_SCENE` — 人物出现在门店场景里的构图要求：中景、站在场景地面上、约占画面一半，场景是主体，光线色温阴影与场景一致，不拍成大头特写贴在背景前 | keywords: 人物融入场景, 中景构图, person-in-scene-framing, medium-shot
- `STORE_VISIT_SCENE_MOTION` — 实景画面的默认动态：镜头缓慢推近，画面里本来就有的灯光、屏幕、投影、霓虹、布料、热气自然动起来，不新增人、物和文字 | keywords: 实景默认动态, 画面活起来, scene-default-motion, living-scene
- `describeStoreVisitSegmentFailure(raw)` — 分段失败原因翻成中文：百炼语音报错按语音规则，可灵数字人业务错误带对端原话，数眼 5 分钟超时单独说明，其余按数眼视频规则 | keywords: 探店分段失败说明, 报错翻译, store-visit-segment-failure, error-translation
- `STORE_VISIT_AVATAR_AUDIO_SECONDS` — 人物出镜段配音时长范围 2～300 秒（可灵数字人限制） | keywords: 对口型配音时长, 可灵数字人限制, avatar-audio-range, kling-avatar-limit
- `STORE_VISIT_WAN_AUDIO_MIN_SECONDS` — wan2.7-i2v 驱动音频最短 2 秒 | keywords: 万相驱动音频下限, 配音最短时长, wan-driving-audio-min, voiceover-min-seconds
- `buildStoreVisitTalkingPrompt(input)` — 人物段（万相按配音生成）提示词：人物按传入配音说话，口型、表情与手势跟着配音走，只有主播露正脸，不加背景音乐与文字 | keywords: 万相说话提示词, 配音驱动画面, wan-talking-prompt, audio-driven-video
- `readKlingText(value)` — 把对端响应字段读成去空白的字符串，只认字符串与数字 | keywords: 读取响应文本, 字段转字符串, read-response-text, field-to-string
- `resolveStoreVisitAvatarMode(model)` — 对口型节点模型名含 kling / avatar 时取可灵模式（含 pro 为高品质），万相与认不出的返回 null | keywords: 解析对口型模式, 模型名路由, resolve-avatar-mode, model-routing
- `resolveStoreVisitPresenterEngine(model)` — 按「探店人物对口型」节点模型决定人物段怎么生成：kling / avatar 型号走可灵数字人对口型，wan2.7-i2v 带配音作驱动音频一次生成口型，Seedance / MiniMax-H3 走数眼图生视频、出片后再交给可灵对口型，认不出返回 null | keywords: 解析人物出镜引擎, 模型名路由, resolve-presenter-engine, model-routing
- `buildStoreVisitPresenterPrompt(input)` — 人物出镜段（视频型号）图生视频提示词：以人物首帧为起点带着镜头介绍门店，大部分时间正脸对镜头、只有主播露正脸，方便出片后对口型，无文字、静音 | keywords: 人物出镜视频提示词, 正脸对镜头, presenter-video-prompt, face-camera
- `buildStoreVisitAvatarUrl(gateway,taskId?)` — 拼可灵数字人 `/kling/v1/videos/avatar/image2video[/{id}]` 创建或查询地址 | keywords: 对口型任务地址, 创建与查询, avatar-task-url, create-and-query
- `mapStoreVisitAvatarStatus(status?)` — 可灵任务状态收成 queued / running / completed / failed | keywords: 对口型状态映射, 可灵状态, map-avatar-status, kling-status
- `buildStoreVisitKeyframePrompt(input)` — 仅主动请求时合成人物与真实场景的首帧：中景构图，人物站在场景地面上、和场景同光同影，不拍成大头贴；体验镜头不强制正脸 | keywords: 人物首帧提示词, 人物进场景, keyframe-prompt, person-in-scene
- `buildStoreVisitAvatarPrompt(action?)` — 可灵数字人动作提示：有画面描述用它，没有时看着镜头自然讲解 | keywords: 对口型动作提示, 讲解神态, avatar-motion-prompt, presenting-manner
- `DouyinStoreVisitService()` — 探店分段视频服务：百炼音色与逐段配音、人物首帧、人物段可灵数字人或 wan2.7-i2v 按配音生成（Seedance / MiniMax-H3 出片后再对口型）、空镜段数眼空镜视频、后台轮询转存并绑定分段 | keywords: 探店画外音, 克隆音色, 空镜视频, store-visit-voiceover, voice-clone, broll-video
- `DouyinStoreVisitService.constructor(db,repository,billing,storage,workflowModels,adminService,cosyVoice,agentService,aiImages,personas)` — 初始化调用集合与音色、存储、计费、生图与人物依赖 | keywords: 初始化探店服务, 画外音依赖, init-store-visit-service, voiceover-dependencies
- `DouyinStoreVisitService.onModuleInit()` — 启动分段任务后台轮询，重启后续跟；多进程时只在 leader 进程上轮询 | keywords: 启动探店分段轮询, 重启续跟, start-store-visit-polling, resume-after-restart
- `DouyinStoreVisitService.onModuleDestroy()` — 停止分段任务后台轮询 | keywords: 停止探店分段轮询, 模块销毁, stop-store-visit-polling, module-destroy
- `DouyinStoreVisitService.cloneVoice(topicId,file,scope)` — 录音临时传 OSS 交给百炼声音复刻，审核通过后立即删录音；音色 ID、模型与提供商写进脚本，换音色时删掉本脚本之前克隆或定制的旧音色，记 `voice-clone` 审计（不含录音） | keywords: 克隆探店音色, 上传录音, clone-store-visit-voice, upload-voice-sample
- `DouyinStoreVisitService.listPresetVoices()` — 列出探店可选的百炼系统音色 | keywords: 系统音色列表, 探店音色库, list-preset-voices, store-visit-voice-library
- `DouyinStoreVisitService.listPresetCategories()` — 列出音色库风格分类（顺序即展示顺序），每类男女声都有 | keywords: 音色分类列表, 男女声分类, list-voice-categories, gender-balanced-category
- `DouyinStoreVisitService.designVoice(topicId,input,scope)` — 按声音描述调百炼声音设计生成音色（模型取节点 v3 / v3.5 模型，否则 `COSYVOICE_CLONE_MODEL`）并等可用，写进脚本（`voiceSource=design`），删掉本脚本旧的克隆 / 定制音色，记 `voice-design` 审计；失败删半成品、保留原音色 | keywords: 提示词定制音色, 声音设计, design-store-visit-voice, voice-design
- `DouyinStoreVisitService.usePresetVoice(topicId,voiceId,scope)` — 选用目录里的系统音色（模型固定 `COSYVOICE_PRESET_MODEL`），清掉克隆录音信息 | keywords: 选用系统音色, 保存预置音色, use-preset-voice, save-preset-voice
- `DouyinStoreVisitService.previewVoice(topicId,voiceId,scope)` — 合成一句试听：音色库音色直接合成，其他只允许本脚本克隆或定制的音色并用其绑定模型；结果缓存 20 小时 | keywords: 音色试听, 合成试听, preview-voice, synthesize-trial
- `DouyinStoreVisitService.generateKeyframe(topicId,segmentId,prompt,scope)` — 出镜人物作底图、这段场景图作第二张参考图，按「分镜画面」节点出竖屏人物首帧，入图库并写进分段（同时作废这段旧成片） | keywords: 生成人物首帧, 人物进场景, generate-segment-keyframe, person-in-scene
- `DouyinStoreVisitService.start(topicId,scope,options?)` — 生成全部探店分段的动态画面与台词声音，不创建只配音的完成记录 | keywords: 提交探店视频, 全部分段生成, submit-store-visit-video, generate-all-segments
- `DouyinStoreVisitService.startOne(topicId,segmentId,scope,options?)` — 重新生成指定段，并重建接它实际尾帧的同镜头续段，避免把旧尾帧续段接到新画面上；后面已就绪的新镜头（换素材、换用途或本机素材段）不依赖这一段，不连带重做也不重复扣费，还没就绪的（如前段失败时被停下的）一并补上 | keywords: 重新生成探店分段, 单段重做, regenerate-store-visit-segment, single-segment-retry
- `DouyinStoreVisitService.refresh(id)` — 手动同步一条分段调用 | keywords: 同步探店分段, 手动刷新, sync-store-visit-segment, manual-refresh
- `DouyinStoreVisitService.pollOnce()` — 跟进一轮未结束的分段任务，同一进程内不重入 | keywords: 轮询探店分段, 防重入, poll-store-visit-segments, reentry-guard
- `DouyinStoreVisitService.startSegments(topic,segments,scope,options?)` — 统一校验参考素材与声音描述，按段排队生成视频；音色样本仅作参考，无样本时按文字音色生成。有可用的音色锚点时各段都拿它作参考音频；统一音色模式且还没锚点时以整条视频的第 1 段为锚点：第 1 段在本批里就先生成，不在本批（单段重做）但已出片就直接等它取声音，其余新镜头等锚点段取声音后再并行生成，同镜头续段仍等上一段尾帧 | keywords: 提交探店分段, 分段前置校验, submit-store-visit-segment-batch, segment-precheck
- `DouyinStoreVisitService.submitSegment(input)` — 按视频生成计费并提交原生声画，有音色锚点时拿它作参考音频，否则有样本时参考音色、再否则按文字音色生成；点位模式的实景段把同一点位其余 1～2 张图作参考图一起交给模型；不追加对口型或产出供合成替换的配音 | keywords: 提交单段画外音, 分段配音, submit-segment-voiceover, segment-broll
- `DouyinStoreVisitService.refreshRow(row)` — 跟进排队生成并保存原声视频，复核素材与声音描述防止旧产出绑定；等待中的续段只在分段真被改动、删除或重排，或等的那段失败时才停（等第 1 段声音的新镜头不要求紧挨第 1 段）；旧运行中调用按原请求快照完成 | keywords: 推进探店分段, 分段转存, advance-store-visit-segment, save-segment-video
- `DouyinStoreVisitService.startLipSync(row,{gateway,apiKey?,videoUrl,videoSeconds?})` — 原子认领对口型：识别人脸 → 挑主播的脸 → 配音按出现时间提交可灵对口型，任何一步失败记原因并返回跳过 | keywords: 发起人物对口型, 识别比对人脸, start-presenter-lip-sync, identify-and-match-face
- `DouyinStoreVisitService.matchPresenterFaces(row,faces,videoMs)` — 一张脸出现超过半段直接用，否则用「探店尾帧衔接」视觉模型拿出镜人物照比对，失败退回出现最久的那张 | keywords: 比对主播人脸, 视觉模型认人, match-presenter-face, vision-face-match
- `DouyinStoreVisitService.readVoiceRuntime()` — 读取「音色克隆与配音」节点的百炼运行配置，没指定、不是百炼或没填 Key 时用中文说明拒绝 | keywords: 读取百炼节点配置, 缺配置拒绝, read-dashscope-runtime, reject-unconfigured
- `DouyinStoreVisitService.readVoiceRuntimeFor(providerId)` — 克隆音色属于克隆时的百炼账号：优先用音色记录上的提供商取 Key，提供商已删除时退回节点当前提供商 | keywords: 读取音色所属提供商, 克隆音色账号, read-voice-owner-runtime, cloned-voice-account
- `DouyinStoreVisitService.readVideoRuntime()` — 读取 Seedance 2.0 或 MiniMax-H3 原生声画配置，缺少配置时拒绝生成。 | keywords: 读取探店画面节点, 缺配置拒绝, read-broll-runtime, reject-unconfigured
- `DouyinStoreVisitService.readAvatarRuntime()` — 读取人物声画生成节点，旧数字人或驱动配音型号改用画面视频节点。 | keywords: 读取对口型节点, 缺配置拒绝, read-avatar-runtime, reject-unconfigured
- `DouyinStoreVisitService.toVideoImageUrl(url)` — 场景图入参：公网地址原样给数眼，站内 `/static` 图片转 data URL | keywords: 场景图入参, 本地图片Base64, scene-image-input, local-image-data-url
- `DouyinStoreVisitService.toPublicFrameUrl(url,index,scope)` — 万相首帧入参：场景图、场景起始画面、尾帧等站内图片先传 OSS 换公网地址，没配 OSS、地址无效或上传失败时中文拒绝（这段扣费退回） | keywords: 万相首帧公网地址, 首帧传OSS, wan-first-frame-public-url, first-frame-to-oss
- `DouyinStoreVisitService.toKlingMedia(url,label)` — 可灵图片与音频入参：公网地址原样给，站内 `/static` 文件转不带前缀的 Base64 | keywords: 可灵素材入参, 站内文件Base64, kling-media-input, local-file-base64
- `DouyinStoreVisitService.fetchKling(url,init,apiKey?)` — 沿用数眼请求调可灵数字人接口，业务码非 0 时抛 `SHUYAN_KLING_ERROR` | keywords: 可灵数字人请求, 业务码校验, kling-avatar-request, business-code-check
- `DouyinStoreVisitService.fetchShuyan(url,init,apiKey)` — 带 Bearer 与 5 分钟超时的数眼 JSON 请求，一并带上调用方的请求头（万相异步头），非 2xx 抛 `SHUYAN_VIDEO_HTTP_<状态码>` 并保留对端报错 | keywords: 数眼探店请求, 错误体保留, shuyan-store-visit-request, preserve-error-body
- `DouyinStoreVisitService.requireChild(topicId,scope)` — 校验当前用户拥有的子选题（脚本） | keywords: 校验探店脚本, 操作所有权, require-store-visit-topic, operation-ownership
- `DouyinStoreVisitService.fail(id,message,detail?)` — 标记分段调用失败，`error` 为中文说明、`detail` 为原始信息 | keywords: 标记分段失败, 失败原因, mark-segment-failed, failure-reason
- `DouyinStoreVisitService.toView(row)` — 去掉数据库字段与请求正文后的分段调用视图，对口型只给阶段与跳过原因 | keywords: 分段调用视图, 隐藏请求, segment-operation-view, hide-request
- `concatShotVideos(req,id,dto)` — 校验并领取客户端合成，返回调用记录与有序片段，权限为 create DouyinWorkbench | keywords: 准备客户端合成接口, 分镜视频地址, prepare-client-concat-api, shot-video-urls
- `cloneStoreVisitVoice(req,id,file)` — `POST topics/:id/store-visit/voice`（`create DouyinWorkbench`，multipart `file` ≤10MB），录音临时传 OSS 交给百炼声音复刻、克隆完即删，音色 ID 写进脚本 | keywords: 克隆探店音色接口, 上传录音, clone-store-visit-voice-api, upload-voice-sample
- `generateStoreVisitLines(req,id,dto)` — `POST topics/:id/store-visit/lines`（`create DouyinWorkbench`），按场景与台词让 AI 写一版探店画外音台词，只返回不落库；选了门店的点位模式按重点推荐点位写，并为每段挑同一点位的 1～3 张参考图 | keywords: 探店台词接口, 画外音台词, store-visit-lines-api, voiceover-lines
- `generateStoreVisitVideo(req,id,dto)` — `POST topics/:id/store-visit/generate`（`create DouyinWorkbench`），每段生成原生声画，按生视频服务逐段扣费，返回各段调用记录；`voiceAnchor` 为真时第 1 段先出片，其余段等桌面端取出它的声音作参考音色 | keywords: 探店视频生成接口, 画外音生成, store-visit-video-api, voiceover-generation
- `listStoreVisitPresetVoices()` — `GET store-visit/voices`（`read DouyinWorkbench`），返回音色库 `voices`（名称、特质、性别、风格分类与方言）与分类目录 `categories` | keywords: 音色库接口, 探店音色库, preset-voices-api, store-visit-voice-library
- `designStoreVisitVoice(req,id,dto)` — `POST topics/:id/store-visit/voice/design`（`create DouyinWorkbench`），按声音描述定制音色并返回当前租户工作台 | keywords: 提示词定制音色接口, 声音设计, design-voice-api, voice-design
- `useStoreVisitPresetVoice(req,id,dto)` — `POST topics/:id/store-visit/voice/preset`（`update DouyinWorkbench`），选用音色库里的预置音色并返回当前租户工作台 | keywords: 选用系统音色接口, 保存预置音色, use-preset-voice-api, save-preset-voice
- `previewStoreVisitVoice(req,id,dto)` — `POST topics/:id/store-visit/voice/preview`（`read DouyinWorkbench`），合成一句音色库音色或本脚本克隆、定制音色的试听并返回地址 | keywords: 音色试听接口, 合成试听, voice-preview-api, synthesize-trial
- `generateStoreVisitSegment(req,id,segmentId,dto)` — `POST topics/:id/store-visit/segments/:segmentId/generate`（`create DouyinWorkbench`），重新生成探店某一段（及接它尾帧的续段），按生视频服务扣费；`voiceAnchor` 为真时用第 1 段的声音统一音色 | keywords: 重新生成探店分段接口, 单段重做, regenerate-store-visit-segment-api, single-segment-retry
- `generateStoreVisitKeyframe(req,id,segmentId,dto)` — `POST topics/:id/store-visit/segments/:segmentId/keyframe`（`create DouyinWorkbench`），为人物出镜段生成首帧，返回脚本、首帧与工作台 | keywords: 人物首帧接口, 人物进场景, segment-keyframe-api, person-in-scene
- `readSegmentId(value)` — 校验路由里的探店分段 ID | keywords: 解析探店分段ID, 路由校验, parse-segment-id, route-validation
- `DASHSCOPE_PROVIDER_CODE` — 百炼在「Ai提供商设置」里的提供商代码 `dashscope`，探店音色克隆与配音都走它 | keywords: 百炼提供商代码, 探店语音, dashscope-provider-code, store-visit-speech
- `DASHSCOPE_DEFAULT_BASE_URL` — 百炼提供商没填地址时的默认 OpenAI 兼容地址，CosyVoice 只取它的域名 | keywords: 百炼默认地址, 兼容模式, dashscope-default-base-url, compatible-mode
- `COSYVOICE_CLONE_MODEL` — 录音克隆音色默认绑定的合成模型 `cosyvoice-v3.5-plus`，节点填了模型时以节点为准 | keywords: 克隆音色模型, 声音复刻, cosyvoice-clone-model, voice-enrollment
- `COSYVOICE_PRESET_MODEL` — 系统音色使用的合成模型 `cosyvoice-v3-flash`（v3.5 不支持系统音色） | keywords: 系统音色模型, 预置音色, cosyvoice-preset-model, system-voice
- `COSYVOICE_SAMPLE_RATE` — 配音输出 24kHz WAV 16bit 单声道，时长可从文件头精确算出 | keywords: 配音采样率, 配音格式, tts-sample-rate, tts-format
- `COSYVOICE_VOICE_READY_TIMEOUT_MS` — 等待克隆音色审核通过的最长时间 | keywords: 音色审核等待, 克隆超时, voice-review-timeout, clone-timeout
- `CosyVoicePresetVoice` — 音色库里的一个预置音色（ID、名称、特质、性别、风格分类、可选方言） | keywords: 预置音色条目, 探店音色, cosyvoice-preset-voice, store-visit-voice
- `CosyVoicePresetCategory` — 音色库风格分类键：活力种草、温柔亲切、知性专业、方言特色 | keywords: 音色分类键, 音色风格, voice-category-key, voice-style
- `COSYVOICE_PRESET_CATEGORIES` — 音色库分类目录（键、名称、适用场景说明），每类都同时有男声和女声 | keywords: 音色分类目录, 男女声分类, voice-category-catalog, gender-balanced-category
- `COSYVOICE_PRESET_VOICES` — 探店音色库：适合口播的普通话男女声与两个方言音色，分到四个风格分类，每类男女声都有 | keywords: 系统音色目录, 探店音色库, cosyvoice-preset-catalog, store-visit-voice-library
- `DashScopeRuntime` — 百炼接口需要的运行配置（服务地址与 Key） | keywords: 百炼运行配置, 语音服务配置, dashscope-runtime, speech-runtime
- `resolveDashScopeOrigin(baseUrl)` — 取百炼服务域名：兼容模式地址或专属域名都只取 origin，没填或填错用默认域名 | keywords: 百炼服务域名, 去掉兼容路径, dashscope-origin, strip-compatible-path
- `buildCosyVoicePrefix(topicId)` — 克隆音色名称前缀：`aim` + 脚本 ID 的 36 进制，只含字母数字且不超过 10 个字符 | keywords: 克隆音色前缀, 音色命名, clone-voice-prefix, voice-naming
- `readWavSeconds(buffer)` — 按 `fmt ` 字节率与 `data` 块大小算 WAV 时长，流式占位按文件剩余长度算，非 WAV 返回 0 | keywords: WAV时长, 配音时长, wav-duration, voiceover-seconds
- `describeCosyVoiceFailure(raw)` — 百炼语音报错翻成中文：Key 无效、限流、音色与模型不匹配、录音不合格分别说明，其余带原始信息 | keywords: 百炼语音报错, 中文说明, cosyvoice-error-message, friendly-error
- `describeVoiceDesignFailure(raw)` — 声音设计报错翻成中文：描述没通过或不合要求时提示换个说法，超时提示重试，其余沿用通用语音报错 | keywords: 声音设计报错, 中文说明, voice-design-error-message, friendly-error
- `DouyinCosyVoiceService()` — 百炼 CosyVoice 客户端：声音复刻、按提示词设计音色与非实时语音合成 | keywords: 百炼CosyVoice, 声音复刻, 语音合成, dashscope-cosyvoice, voice-enrollment, speech-synthesis
- `DouyinCosyVoiceService.createVoice(runtime,input)` — 用公网可访问的录音创建克隆音色，返回音色 ID（可能还在审核） | keywords: 创建克隆音色, 声音复刻, create-cloned-voice, enroll-voice
- `DouyinCosyVoiceService.designVoice(runtime,input)` — 按声音描述（≤500 字）与试听文本（15～200 字）调百炼声音设计 `create_voice`，返回音色 ID（可能还在部署） | keywords: 提示词设计音色, 声音设计, design-voice-from-prompt, voice-design
- `DouyinCosyVoiceService.waitVoiceReady(runtime,voiceId,timeoutMs)` — 轮询克隆音色审核状态直到 `OK`，`UNDEPLOYED` 或超时抛错 | keywords: 等待音色审核, 克隆音色状态, wait-voice-ready, voice-review-status
- `DouyinCosyVoiceService.deleteVoice(runtime,voiceId)` — 删除一个克隆音色，失败不抛错 | keywords: 删除克隆音色, 清理旧音色, delete-cloned-voice, cleanup-old-voice
- `DouyinCosyVoiceService.synthesize(runtime,input)` — 按音色把一段文字合成 24kHz 单声道 WAV，下载回来并算出时长（百炼地址 24 小时有效，调用方自行转存） | keywords: 合成配音, 画外音配音, synthesize-voiceover, cosyvoice-tts
- `DouyinCosyVoiceService.synthesizePreview(runtime,input)` — 合成一句试听，只返回百炼 https 临时地址不下载 | keywords: 合成试听, 音色试听, synthesize-preview, voice-trial
- `DouyinCosyVoiceService.post(runtime,path,body)` — 调一次百炼语音接口（Bearer、1 分钟超时），非 2xx 或响应带 `code` 时抛 `DASHSCOPE_HTTP_<状态码>:<响应体>` | keywords: 百炼语音请求, 错误体保留, dashscope-speech-request, preserve-error-body
- `DOUYIN_STORE_VISIT_CLASSIFY_BATCH` — 一次 AI 归类最多交给视觉模型的图片数，另附最多 6 个已有点位的封面作对照 | keywords: 单批归类图片数, 视觉模型批量, classify-batch-size, vision-batch
- `DOUYIN_STORE_VISIT_SIMILARITY_LIMIT` — 一次相似度预归类最多处理的图片数 | keywords: 相似度预归类上限, 批量哈希, similarity-batch-limit, batch-hash
- `DOUYIN_STORE_VISIT_SIMILARITY_THRESHOLD` — 两张图的相似距离低于这个值（0～1）就预先归到一组，再交给 AI 判断 | keywords: 相似度阈值, 预归类阈值, similarity-threshold, pre-cluster-threshold
- `computeStoreVisitImageSignature(buffer)` — 用 sharp 算一张图的视觉签名：缩成 9×8 灰度比较相邻像素得 64 位 dHash，再缩成 4×4 取每格 RGB 平均色 | keywords: 计算视觉签名, 感知哈希, compute-visual-signature, perceptual-hash
- `storeVisitSignatureDistance(a,b)` — 两个视觉签名的距离（0 完全一样～1 完全不同）：dHash 汉明距离占 6 成、平均色差占 4 成 | keywords: 签名距离, 汉明距离, signature-distance, hamming-distance
- `clusterStoreVisitSignatures(items,threshold?)` — 按视觉签名做单链接聚类：任意两张距离低于阈值就并到同一组，返回按组大小降序、组内保持原顺序的 ID 分组（单张也成一组） | keywords: 相似图预归类, 单链接聚类, similar-image-clustering, single-linkage
- `clusterStoreVisitSignatures.find(index)` — 找到并压缩并查集的根 | keywords: 并查集根, 路径压缩, union-find-root, path-compression
- `readStoreVisitText(value)` — 把不可信的字段读成字符串：只认字符串与数字，其余（对象、空值）返回空串，避免把对象拼成「[object Object]」 | keywords: 读取文本字段, 不可信输入, read-text-field, untrusted-input
- `normalizeStoreVisitSpotName(value)` — 规整点位名称：压掉空白、去掉书名号引号，最多 30 字 | keywords: 规整点位名称, 点位命名, normalize-spot-name, spot-naming
- `clampStoreVisitSpotScore(value)` — 把精细度打分夹到 1～10 的整数，读不出时给 5 | keywords: 规整精细度分数, 分数范围, clamp-fineness-score, score-range
- `createStoreVisitClassifySession(context,emit?)` — 一批 AI 归类的会话：模型每调用一次归类工具就在这里校验（图片必须是本批的；点位用已有 key，或按名称找已有点位，找不到就新建并生成 \`new-\` 草稿键），校验通过立刻推事件给前端，并把剩下没归的图片告诉模型；校验不过返回原因让模型改了再调。同一张图再归一次就是改归到新点位 | keywords: 归类工具会话, 逐条校验推送, classify-tool-session, per-call-validation
- `createStoreVisitClassifySession.nameKey(value)` — 点位名统一成小写去空白，用来按名称找点位 | keywords: 点位名比对, 名称去重, spot-name-key, name-dedupe
- `createStoreVisitClassifySession.assign(input)` — 校验一次归类工具调用，通过就推事件，返回给模型看的结果 | keywords: 校验归类调用, 推送归类, validate-assign-call, emit-assignment
- `buildStoreVisitSpotClassificationBrief(input)` — 给视觉模型写归类任务：门店资料、已有点位（含本轮草稿）清单与封面对照、本批图片序号与相似度预分组，要求逐张调用归类工具 | keywords: 点位归类提示词, 视觉归类任务, spot-classification-brief, vision-classification-task
- `DouyinStoreVisitSpotService()` — 探店门店与点位：门店在租户内共享，点位由使用者确认命名；场景图库图片可先按视觉签名预归类，再交给视觉模型归入点位、写描述并打分，保存时把描述写回图库备注，高分图自动收藏 | keywords: 探店点位服务, 场景图库归类, store-visit-spot-service, scene-library-classification
- `DouyinStoreVisitSpotService.constructor(db,gallery,repository,workflowModels,agentService)` — 初始化门店集合与图库、视频库、模型依赖 | keywords: 初始化点位服务, 门店集合, init-spot-service, store-collection
- `DouyinStoreVisitSpotService.listStores(scope)` — 列出当前租户的门店与点位，最近改过的在前 | keywords: 查询探店门店, 门店列表, list-store-visit-stores, store-list
- `DouyinStoreVisitSpotService.requireStore(id,scope)` — 读取一家门店，不属于当前租户时报不存在 | keywords: 读取探店门店, 租户校验, get-store-visit-store, tenant-check
- `DouyinStoreVisitSpotService.createStore(input,scope)` — 新建门店：同租户里同名门店直接返回已有的那家，避免重复建店把点位拆散 | keywords: 新建探店门店, 同名去重, create-store-visit-store, dedupe-store-name
- `DouyinStoreVisitSpotService.updateStore(id,input,scope)` — 改门店名称或整体说明，改名撞上同租户另一家门店时拒绝 | keywords: 修改探店门店, 门店改名, update-store-visit-store, rename-store
- `DouyinStoreVisitSpotService.deleteStore(id,scope)` — 删除门店与它的点位记录（图库图片保留） | keywords: 删除探店门店, 保留图库, delete-store-visit-store, keep-gallery
- `DouyinStoreVisitSpotService.saveSpots(id,input,scope)` — 整体保存一家门店的点位：名称必填且店内不重名，图片与视频按租户校验并以库里的真实地址为准，一张图只归一个点位；描述有变化的图片写回图库备注，打分达到收藏线的图片在图库里自动收藏（不会取消用户自己的收藏） | keywords: 保存门店点位, 同步图库备注收藏, save-store-spots, sync-gallery-note-favorite
- `DouyinStoreVisitSpotService.similarity(storeId,imageIds,scope)` — 相似度预归类：逐张算视觉签名（dHash + 网格平均色）后单链接聚类；读不出的图片单独列出，不影响其余 | keywords: 相似图预归类, 图片相似度, pre-cluster-similar-images, image-similarity
- `DouyinStoreVisitSpotService.classify(storeId,input,scope,emit?)` — AI 归类一批图片：把本批图片（最多 8 张，缩到 768px）连同已有点位与本轮草稿点位的封面交给「探店场景归类」视觉模型（轻量 Agent，只挂归类工具），模型每看完一张就调用 \`store_visit_assign_image\` 把它归入点位或新建点位、写描述并打 1～10 分；每次调用校验通过立刻经 \`emit\` 推给前端，不合规的调用把原因返回给模型重来；一批结束推 \`done\`。不落库，前端确认点位命名后整体保存 | keywords: AI归类点位, 看图写描述打分, ai-classify-spots, vision-describe-score
- `DouyinStoreVisitSpotService.readImage(url)` — 读一张图库图片的文件内容：公网地址带 30 秒超时下载，站内地址读本地文件 | keywords: 读取图库图片, 本地或公网, read-gallery-image, local-or-remote
- `DouyinStoreVisitSpotService.toVisionImage(row)` — 把图片缩到长边 768px 的 JPEG data URL 交给视觉模型（本地与公网图片一样处理，省 token 也避免模型读不到站内地址），结果缓存 10 分钟 | keywords: 视觉模型入图, 缩图缓存, vision-image-input, preview-cache
- `DouyinStoreVisitSpotService.nextId()` — 生成全局递增的门店 ID | keywords: 门店自增ID, 计数器, next-store-id, counter
- `DouyinStoreVisitSpotService.tenantFilter(tenantId?)` — 构造租户过滤，母平台只访问无 tenantId 的平台数据 | keywords: 门店租户过滤, 母平台边界, store-tenant-filter, platform-boundary
- `DouyinStoreVisitSpotService.toView(row)` — 去掉 Mongo 主键生成门店视图 | keywords: 门店视图, 隐藏数据库ID, store-view, hide-database-id
- `buildStoreVisitSpotCatalog(spots,spotIds,sceneImages,sceneVideos?)` — 按重点推荐顺序整理点位目录：只收选题里已同步的参考图（打分高的在前），点位说明为空时用图片描述补；开场门头点位排第一 | keywords: 整理点位目录, 开场点位优先, build-spot-catalog, opening-spot-first
- `describeStoreVisitSpotCatalog(catalog)` — 把点位目录写成给模型看的资料：点位名、开场标记、说明，每张图的编号、打分与描述，实拍视频说明 | keywords: 点位目录文本, 图片编号打分, spot-catalog-text, image-number-score
- `parseStoreVisitSpotSegments(text,catalog)` — 解析按点位写的台词：每段第一行「【点位k｜图k.a,k.b】」，图片只认这个点位的编号（最多 3 张），没写或写错时按打分挑，同一点位分成几段时主图轮换；只有实拍视频的点位用它的第一段视频。最多 8 段 | keywords: 解析点位台词, 每段挑图, parse-spot-segments, per-segment-images
- `pickStoreVisitRecommendation(raw,context)` — 校验模型的人物与音色推荐：人物只认候选里的（要出镜时必须有形象图），音色只认音色库里的；不合规时按人物性别或「活力种草」兜底，声音描述优先用人物设定的音色 | keywords: 校验编排推荐, 推荐兜底, validate-plan-recommendation, recommendation-fallback
- `DouyinStoreVisitPlannerService()` — 探店 AI 编排：按门店与重点推荐点位先挑出镜人物与音色（用户可再换），再按点位写台词并为每段挑同一点位的 1～3 张参考图；结果都只返回、不落库，由前端应用并保存 | keywords: 探店AI编排, 点位台词, store-visit-ai-planner, spot-lines
- `DouyinStoreVisitPlannerService.constructor(repository,spots,personas,workflowModels,agentService)` — 注入选题、门店点位、预设人物与模型依赖 | keywords: 初始化编排服务, 编排依赖, init-planner-service, planner-dependencies
- `DouyinStoreVisitPlannerService.recommend(topicId,options,scope)` — AI 先替用户挑人物与音色：要出镜时从有形象图的预设人物里挑最搭这家店的一个，再从音色库挑一个音色（选了人物时跟人物性别与气质走），并写一句可直接用的声音描述（音色库不可用时前端改用它）。模型失败时按规则兜底，不阻断流程 | keywords: AI推荐人物音色, 编排推荐, ai-recommend-persona-voice, plan-recommendation
- `DouyinStoreVisitPlannerService.writeSpotLines(topicId,prompt,scope)` — 按重点推荐点位写探店台词：开场用门头点位报店名，之后按用户挑的顺序一段讲一个点位（内容多的点位可分两段），结尾引导下单；每段从该点位的参考图里挑 1～3 张（优先高分图）；只复述门店、点位与图片描述里的事实，编了数字或用了方言字时重写一次，仍有问题带核对提醒返回 | keywords: 按点位写台词, 每段挑参考图, write-spot-lines, pick-segment-images
- `DouyinStoreVisitPlannerService.loadContext(topicId,scope)` — 读取点位模式选题、门店与重点推荐点位目录，缺门店或点位时提示回到对应步骤 | keywords: 读取编排上下文, 点位目录, load-planner-context, spot-catalog
- `DouyinStoreVisitPlannerService.ask(scope,source,system,user,temperature)` — 用「探店编排推荐」节点（关思考、非流式）问一次模型并取出文本 | keywords: 编排模型调用, 读取文本, planner-llm-call, read-text
- `DOUYIN_STORE_VISIT_SPOT_LIMITS` — 探店门店与点位的上限：每租户门店不限，每店最多 40 个点位，每个点位最多 40 张图片、6 段实拍视频；点位名 30 字、点位说明 500 字、单张图片描述 300 字 | keywords: 探店点位上限, 点位图片上限, store-visit-spot-limits, spot-image-limit
- `DOUYIN_STORE_VISIT_SPOT_FAVORITE_SCORE` — AI 给图片打的精细度分数达到这一档（满分 10）就自动收藏，下次写台词、挑参考图时优先选用 | keywords: 自动收藏分数线, 精细度打分, auto-favorite-score, fineness-score
- `CreateDouyinStoreVisitStoreDto()` — 校验新建探店门店：名称必填（60 字内），整体说明选填（位置、人均、营业时间，2000 字内） | keywords: 新建门店参数, 门店名称, create-store-dto, store-name
- `UpdateDouyinStoreVisitStoreDto()` — 校验修改探店门店：可单独改名称或整体说明 | keywords: 修改门店参数, 门店说明, update-store-dto, store-description
- `DouyinStoreVisitSpotImageDto()` — 校验点位里的一张图片：图库图片 ID、AI 或用户写的描述（300 字内）与精细度打分（1～10） | keywords: 点位图片参数, 精细度打分, spot-image-dto, fineness-score
- `DouyinStoreVisitSpotVideoDto()` — 校验点位的一段补充实拍视频：视频库视频 ID 与说明（500 字内） | keywords: 点位视频参数, 补充素材, spot-video-dto, supplemental-footage
- `DouyinStoreVisitSpotDto()` — 校验一个点位：已有点位带 ID，名称必填（30 字内），说明 500 字内，最多 40 张图片、6 段视频 | keywords: 点位参数, 点位命名, spot-dto, spot-naming
- `SaveDouyinStoreVisitSpotsDto()` — 校验整体保存门店点位：最多 40 个点位 | keywords: 保存点位参数, 点位整体保存, save-spots-dto, replace-spots
- `DouyinStoreVisitSimilarityDto()` — 校验相似度预归类：1～60 张图库图片 ID | keywords: 相似度预归类参数, 图片ID列表, similarity-dto, image-id-list
- `DouyinStoreVisitDraftSpotDto()` — 校验 AI 归类时带上的本轮草稿点位：`new-` 开头的草稿键、建议名称、说明与封面图 | keywords: 草稿点位参数, 本轮新建点位, draft-spot-dto, round-new-spot
- `ClassifyDouyinStoreVisitSpotsDto()` — 校验一批 AI 归类：1～8 张图片、可选的相似度预分组与本轮草稿点位 | keywords: AI归类参数, 批量归类, classify-spots-dto, batch-classification
- `RecommendDouyinStoreVisitPlanDto()` — 校验 AI 编排推荐：视频开头是否有人出镜（决定要不要挑人物） | keywords: 编排推荐参数, 是否出镜, plan-recommend-dto, presenter-flag
- `listStoreVisitStores(req)` — `GET store-visit/stores`（`read DouyinWorkbench`），列出当前租户的探店门店与点位 | keywords: 门店列表接口, 探店点位, store-list-api, store-visit-spots
- `createStoreVisitStore(req,dto)` — `POST store-visit/stores`（`create DouyinWorkbench`），新建探店门店（同租户同名直接返回已有门店） | keywords: 新建门店接口, 同名去重, create-store-api, dedupe-store-name
- `updateStoreVisitStore(req,storeId,dto)` — `PATCH store-visit/stores/:storeId`（`update DouyinWorkbench`），修改探店门店名称或整体说明 | keywords: 修改门店接口, 门店改名, update-store-api, rename-store
- `deleteStoreVisitStore(req,storeId)` — `DELETE store-visit/stores/:storeId`（`delete DouyinWorkbench`），删除探店门店与它的点位（图库图片保留） | keywords: 删除门店接口, 保留图库, delete-store-api, keep-gallery
- `saveStoreVisitSpots(req,storeId,dto)` — `PUT store-visit/stores/:storeId/spots`（`update DouyinWorkbench`），整体保存门店点位，描述写回图库备注，高分图自动收藏 | keywords: 保存点位接口, 图库备注收藏, save-spots-api, gallery-note-favorite
- `storeVisitSpotSimilarity(req,storeId,dto)` — `POST store-visit/stores/:storeId/similarity`（`read DouyinWorkbench`），相似度预归类：按图片视觉签名把相似的图先分到一组 | keywords: 相似度预归类接口, 图片相似度, similarity-api, image-similarity
- `classifyStoreVisitSpots(req,storeId,dto,res)` — `POST store-visit/stores/:storeId/classify`（`create DouyinWorkbench`），AI 归类一批图片到点位，写描述并打分，不落库；按 NDJSON 逐行推送（模型每调用一次归类工具推一行 `spot` / `assign`，结束推 `done`，出错推 `error`），前端断开时中止模型 | keywords: AI归类接口, 看图归类, classify-spots-api, vision-classification
- `recommendStoreVisitPlan(req,id,dto)` — `POST topics/:id/store-visit/plan/recommend`（`create DouyinWorkbench`），探店 AI 编排推荐：按门店与重点推荐点位挑出镜人物（要出镜时）与音色，只返回不落库 | keywords: 编排推荐接口, 推荐人物音色, plan-recommend-api, recommend-persona-voice
- `storeVisitVoiceKey(setting)` — 当前音色的标识（音色 ID + 声音描述），音色锚点只在标识一致时使用 | keywords: 音色标识, 锚点作废判断, voice-key, anchor-stale-check
- `readStoreVisitVoiceAnchor(setting)` — 读取还能用的音色锚点：有地址且音色没换过才返回 | keywords: 读取音色锚点, 有效锚点, read-voice-anchor, valid-anchor
- `DOUYIN_VOICE_ANCHOR_MAX_BYTES` — 音色锚点录音上限 5MB（12 秒左右的单声道 WAV 远小于它） | keywords: 锚点录音上限, 参考音频大小, voice-anchor-size-limit, reference-audio-size
- `DouyinStoreVisitService.saveVoiceAnchor(topicId,input,file,scope)` — 保存音色锚点：桌面端从某一段（统一音色模式的第 1 段）出片视频里取出的 WAV 声音（2～15 秒），后面各段都拿它作参考音频；同一段同一个视频已经存过且音色没换就直接返回，几个续段同时上传不会重复写 | keywords: 保存音色锚点, 第一段声音, save-voice-anchor, first-segment-voice
- `DouyinWorkbenchRepositoryService.saveStoreVisitVoiceAnchor(id,anchor,scope)` — 写入探店音色锚点（第 1 段出片后取出的声音），后面各段用它作参考音频 | keywords: 保存音色锚点, 统一音色, save-voice-anchor, unified-voice
- `GenerateDouyinStoreVisitVideoDto()` — 校验探店生成：`voiceAnchor` 为真时第 1 段先出片，其余段等桌面端取出它的声音作参考音色 | keywords: 探店生成参数, 统一音色开关, store-visit-generate-dto, voice-anchor-flag
- `SaveDouyinStoreVisitVoiceAnchorDto()` — 校验音色锚点上传（multipart 文件字段 `file`）：取声音的分段 ID 与它当前的视频库 ID | keywords: 音色锚点参数, 第一段声音, voice-anchor-dto, first-segment-voice
- `saveStoreVisitVoiceAnchor(req,id,dto,file)` — `POST topics/:id/store-visit/voice-anchor`（`update DouyinWorkbench`，multipart 字段 `file` 最多 5MB），上传音色锚点：桌面端从第 1 段出片视频取出的 WAV 声音（2～15 秒），后面各段拿它作参考音色 | keywords: 音色锚点接口, 统一音色, voice-anchor-api, unified-voice

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 探店画面来源 | store-visit-visual-source |
| 旧数据兼容 | legacy-visual-source |
| 实景镜头起点 | real-scene-shot-start |
| 人物体验切换 | experience-shot-boundary |
| 实景保真约束 | real-scene-constraints |
| 稳定镜头 | stable-camera |
| 探店多图能力 | store-visit-multi-reference |
| 人物场景分图 | separate-person-scene |
| 人物体验提示词 | experience-video-prompt |
| 产品游玩动作 | product-play-action |
| 探店场景图 | store-visit-scene-image |
| 场景说明标签 | scene-description-tags |
| 规整探店场景图 | normalize-store-visit-scenes |
| 分段场景说明 | segment-scene-brief |
| 提示词定制音色 | design-store-visit-voice |
| 声音设计 | voice-design |
| 声音设计报错 | voice-design-error-message |
| 首帧图转公网地址 | publish-frame-image |
| 万相首帧公网地址 | wan-first-frame-public-url |
| 音色分类目录 | voice-category-catalog |
| 男女声分类 | gender-balanced-category |
| 音色库接口 | preset-voices-api |
| 场景起始判断 | scene-start-check |
| 台词场景分离 | dialogue-scene-separation |
| 共享场景首帧 | shared-scene-keyframe |
| 场景画面复用 | scene-frame-reuse |
| 尾帧衔接方案 | tail-frame-plan |
| 连续视频提示 | continuous-video-prompt |
| 解析衔接方案 | parse-continuity-plan |
| 视觉结果校验 | vision-result-check |
| 尾帧理解要求 | tail-frame-analysis |
| 场景衔接规划 | scene-continuity-planning |
| 连续生成状态 | continuity-status |
| 前置片段 | predecessor-segment |
| 续段生成参数 | continue-segment-dto |
| 尾帧编号 | tail-image-id |
| 续段失败参数 | continuation-failure-dto |
| 截帧错误 | frame-extraction-error |
| 续段生成接口 | continue-segment-api |
| 尾帧衔接 | tail-frame-continuity |
| 续段失败接口 | continuation-failure-api |
| 等待状态保护 | waiting-state-guard |
| 续段素材接口 | continuation-input-api |
| 前段视频鉴权 | predecessor-video-auth |
| 续接探店片段 | continue-store-visit-segment |
| 原子续段认领 | atomic-continuation-claim |
| 停止尾帧等待 | stop-tail-wait |
| 续段失败记录 | continuation-failure-record |
| 读取续段素材 | read-continuation-input |
| 校验尾帧素材 | require-tail-image |
| 图库归属 | gallery-ownership |
| 连续生成测试服务 | continuity-test-service |
| 原子认领测试 | atomic-claim-test |
| 续段作用域测试 | continuation-scope-test |
| 记录匹配 | record-match |
| 测试原子认领 | test-atomic-claim |
| 重复提交防护 | duplicate-submit-guard |
| 测试状态写入 | test-status-write |
| 续段记录 | continuation-record |

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
| 音色试听文本 | voice-preview-text |
| 克隆探店音色   | clone-store-visit-voice      |
| 探店台词生成   | store-visit-lines            |
| 探店分段 | store-visit-segment |
| 分段成片 | segment-video |
| 探店分段参数 | store-visit-segment-dto |
| 探店分段上限 | store-visit-segment-limit |
| 规整探店分段 | normalize-store-visit-segments |
| 合并探店分段 | merge-store-visit-segments |
| 更新探店分段 | update-store-visit-segment |
| 重新生成探店分段接口 | regenerate-store-visit-segment-api |
| 解析探店分段ID | parse-segment-id |
| 探店分段轮询间隔 | store-visit-segment-poll-interval |
| 探店分段超时 | store-visit-segment-timeout |
| 单段配音上限 | segment-audio-limit |
| 重新生成探店分段 | regenerate-store-visit-segment |
| 同步探店分段 | sync-store-visit-segment |
| 轮询探店分段 | poll-store-visit-segments |
| 分段配音 | segment-voiceover |
| 推进探店分段 | advance-store-visit-segment |
| 数眼探店请求 | shuyan-store-visit-request |
| 标记分段失败 | mark-segment-failed |
| 分段调用视图 | segment-operation-view |
| 探店画外音 | store-visit-voiceover |
| 空镜视频 | broll-video |
| 画外音台词 | voiceover-lines |
| 画外音生成 | voiceover-generation |
| 画外音片段 | voiceover-clip |
| 画外音测试服务 | voiceover-test-service |
| 空镜视频提示词 | broll-video-prompt |
| 定格补齐容差 | freeze-frame-tolerance |
| 探店分段失败说明 | store-visit-segment-failure |
| 探店出镜模板 | store-visit-template |
| 镜头编排 | shot-arrangement |
| 生成人物首帧 | generate-segment-keyframe |
| 人物进场景 | person-in-scene |
| 人物首帧提示词 | keyframe-prompt |
| 人物首帧接口 | segment-keyframe-api |
| 写入人物首帧 | save-segment-keyframe |
| 换人物作废首帧 | reset-presenter-keyframes |
| 读取对口型节点 | read-avatar-runtime |
| 解析对口型模式 | resolve-avatar-mode |
| 解析人物出镜引擎 | resolve-presenter-engine |
| 人物出镜视频提示词 | presenter-video-prompt |
| 正脸对镜头 | face-camera |
| 对口型阶段 | lip-sync-stage |
| 口型跳过原因 | lip-sync-skip-reason |
| 对口型公开状态 | lip-sync-public-state |
| 对口型内部状态 | lip-sync-internal-state |
| 原视频回退 | source-video-fallback |
| 对口型跳过标记 | lip-sync-skip-prefix |
| 跳过原因 | skip-reason |
| 对口型跳过说明 | lip-sync-skip-message |
| 对口型最短片段 | lip-sync-min-clip |
| 音频裁剪下限 | audio-clip-floor |
| 人脸出现占比 | face-coverage-threshold |
| 路人过滤 | passerby-filter |
| 候选人脸上限 | face-candidate-limit |
| 视觉比对数量 | vision-match-count |
| 识别到的人脸 | detected-face |
| 人脸时间段 | face-time-range |
| 对口型人脸片段 | lip-sync-face-clip |
| 配音时间窗 | audio-window |
| 对口型接口地址 | lip-sync-task-url |
| 人脸识别地址 | identify-face-url |
| 解析人脸识别 | parse-identify-face |
| 人脸会话 | face-session |
| 挑选主播人脸 | pick-presenter-face |
| 出现时长筛选 | coverage-filter |
| 人脸比对提示 | face-match-brief |
| 主播身份确认 | presenter-identity-check |
| 解析人脸比对 | parse-face-matches |
| 候选编号校验 | candidate-index-check |
| 对口型片段编排 | build-lip-sync-clips |
| 配音时间切分 | audio-time-split |
| 对口型状态视图 | lip-sync-view |
| 发起人物对口型 | start-presenter-lip-sync |
| 识别比对人脸 | identify-and-match-face |
| 比对主播人脸 | match-presenter-face |
| 视觉模型认人 | vision-face-match |
| 测试内存更新 | test-memory-set |
| 点号路径 | dotted-path |
| 对口型测试服务 | lip-sync-test-service |
| 人物段出片 | presenter-video-ready |
| 测试对口型认领 | test-lip-sync-claim |
| 防重复提交 | duplicate-submit-guard |
| 对口型记录 | lip-sync-record |
| 测试数眼替身 | test-shuyan-double |
| 可灵对口型替身 | kling-lip-sync-double |
| 测试数眼响应 | test-shuyan-response |
| 可灵对口型响应 | kling-lip-sync-response |
| 读取识别字段 | read-face-field |
| 文本字段 | text-field |
| 万相异步请求头 | wan-async-header |
| 百炼异步任务 | dashscope-async-task |
| 万相提示词上限 | wan-prompt-limit |
| 提示词截断 | prompt-truncate |
| 万相请求体 | wan-request-body |
| 首帧驱动音频 | first-frame-driving-audio |
| 万相驱动音频下限 | wan-driving-audio-min |
| 配音最短时长 | voiceover-min-seconds |
| 万相说话提示词 | wan-talking-prompt |
| 配音驱动画面 | audio-driven-video |
| 万相测试服务 | wan-test-service |
| 配音驱动人物段 | audio-driven-presenter |
| 测试万相替身 | test-wan-double |
| 百炼协议响应 | dashscope-protocol-response |
| 对口型任务地址 | avatar-task-url |
| 对口型状态映射 | map-avatar-status |
| 对口型配音时长 | avatar-audio-range |
| 可灵素材入参 | kling-media-input |
| 可灵数字人请求 | kling-avatar-request |
| 全部分段生成 | generate-all-segments |
| 提交单段画外音 | submit-segment-voiceover |
| 读取百炼节点配置 | read-dashscope-runtime |
| 读取探店画面节点 | read-broll-runtime |
| 音色参数 | store-visit-voice-dto |
| 选用系统音色 | use-preset-voice |
| 探店音色库 | store-visit-voice-library |
| 音色试听 | preview-voice |
| 音色试听接口 | voice-preview-api |
| 百炼提供商代码 | dashscope-provider-code |
| 百炼CosyVoice | dashscope-cosyvoice |
| 声音复刻 | voice-enrollment |
| 语音合成 | speech-synthesis |
| 合成配音 | synthesize-voiceover |
| 系统音色目录 | cosyvoice-preset-catalog |
| WAV时长 | wav-duration |
| 百炼语音报错 | cosyvoice-error-message |
| 保存配音文件 | save-audio-file |
| 公网存储可用 | public-storage-available |
| 脚本风格选项接口 | script-style-options-api |
| 脚本微调接口 | refine-script-api |
| 本机素材段 | local-material-segment |
| 免AI画面 | no-ai-footage |
| 可拼接分段 | mergeable-segment |
| 探店素材测试数据 | store-visit-material-fixture |
| 本机素材段 | local-segment-fixture |
| 本机素材测试服务 | local-material-test-service |
| 探店服务替身 | store-visit-service-double |
| 写台词测试服务 | lines-writer-test-service |
| LLM替身 | llm-double |
| 探店素材上限 | store-visit-material-limit |
| 图片视频合计 | image-video-total |
| 规整素材说明 | normalize-material-meta |
| 素材标签 | material-tags |
| 规整探店视频素材 | normalize-store-visit-videos |
| 视频素材说明 | video-material-meta |
| 规整开场素材 | normalize-opening-scene |
| 门头招牌 | storefront-sign |
| 本机运镜 | local-motion |
| 图片缓推 | image-ken-burns |
| 探店视频素材 | store-visit-scene-video |
| 实拍素材 | real-footage |
| 开场素材 | opening-scene |
| 探店视频素材参数 | store-visit-scene-video-dto |
| 素材说明 | material-description |
| 开场素材参数 | opening-scene-dto |
| 探店素材目录项 | store-visit-material-entry |
| 素材序号 | material-index |
| 探店素材目录 | store-visit-material-catalog |
| 开场素材排序 | opening-first |
| 素材清单提示词 | material-catalog-prompt |
| 解析分素材台词 | parse-material-segments |
| 素材标记 | material-marker |
| 台词数字核对 | verify-lines-numbers |
| 防编造价格 | prevent-fabricated-price |
| 数字规整 | normalize-number |
| 小数去零 | trim-decimal-zero |
| 探店台词核对 | verify-store-visit-lines |
| 台词提醒 | lines-warnings |
| 本机素材段时长上限 | local-segment-max-seconds |
| 台词最少字数 | lines-min-characters |
| 台词偏短提醒 | short-lines-warning |
| 难念字眼 | hard-to-voice-words |
| 方言词 | dialect-words |
| 台词好念规则 | plain-speech-rule |
| 普通话用词 | mandarin-wording |
| 难念字眼核对 | find-hard-to-voice-words |
| 方言词核对 | dialect-word-check |
| 多图参考提示词 | multi-reference-prompt |
| 图片说明加脚本 | image-legend-and-script |
| 人物融入场景 | person-in-scene-framing |
| 中景构图 | medium-shot |
| 实景默认动态 | scene-default-motion |
| 画面活起来 | living-scene |
| 参考音色能力 | reference-voice-support |
| 参考音频 | reference-audio |
| 参考音频时长 | reference-audio-range |
| 参考音色限制 | reference-voice-limit |
| 探店音色描述 | store-visit-voice-description |
| 原生声音 | native-sound |
| 探店原生声画 | store-visit-native-video |
| 台词音色提示 | dialogue-voice-prompt |
| 单批归类图片数 | classify-batch-size |
| 视觉模型批量 | vision-batch |
| 相似度预归类上限 | similarity-batch-limit |
| 批量哈希 | batch-hash |
| 相似度阈值 | similarity-threshold |
| 预归类阈值 | pre-cluster-threshold |
| 计算视觉签名 | compute-visual-signature |
| 感知哈希 | perceptual-hash |
| 签名距离 | signature-distance |
| 汉明距离 | hamming-distance |
| 相似图预归类 | similar-image-clustering |
| 单链接聚类 | single-linkage |
| 并查集根 | union-find-root |
| 路径压缩 | path-compression |
| 读取文本字段 | read-text-field |
| 不可信输入 | untrusted-input |
| 规整点位名称 | normalize-spot-name |
| 点位命名 | spot-naming |
| 规整精细度分数 | clamp-fineness-score |
| 分数范围 | score-range |
| 点位归类提示词 | spot-classification-brief |
| 视觉归类任务 | vision-classification-task |
| 探店点位服务 | store-visit-spot-service |
| 场景图库归类 | scene-library-classification |
| 初始化点位服务 | init-spot-service |
| 门店集合 | store-collection |
| 查询探店门店 | list-store-visit-stores |
| 门店列表 | store-list |
| 读取探店门店 | get-store-visit-store |
| 租户校验 | tenant-check |
| 新建探店门店 | create-store-visit-store |
| 同名去重 | dedupe-store-name |
| 修改探店门店 | update-store-visit-store |
| 门店改名 | rename-store |
| 删除探店门店 | delete-store-visit-store |
| 保留图库 | keep-gallery |
| 保存门店点位 | save-store-spots |
| 同步图库备注收藏 | sync-gallery-note-favorite |
| 图片相似度 | image-similarity |
| AI归类点位 | ai-classify-spots |
| 看图写描述打分 | vision-describe-score |
| 读取图库图片 | read-gallery-image |
| 本地或公网 | local-or-remote |
| 视觉模型入图 | vision-image-input |
| 缩图缓存 | preview-cache |
| 门店自增ID | next-store-id |
| 计数器 | counter |
| 门店租户过滤 | store-tenant-filter |
| 母平台边界 | platform-boundary |
| 门店视图 | store-view |
| 隐藏数据库ID | hide-database-id |
| 整理点位目录 | build-spot-catalog |
| 开场点位优先 | opening-spot-first |
| 点位目录文本 | spot-catalog-text |
| 图片编号打分 | image-number-score |
| 解析点位台词 | parse-spot-segments |
| 每段挑图 | per-segment-images |
| 校验编排推荐 | validate-plan-recommendation |
| 推荐兜底 | recommendation-fallback |
| 探店AI编排 | store-visit-ai-planner |
| 点位台词 | spot-lines |
| 初始化编排服务 | init-planner-service |
| 编排依赖 | planner-dependencies |
| AI推荐人物音色 | ai-recommend-persona-voice |
| 编排推荐 | plan-recommendation |
| 按点位写台词 | write-spot-lines |
| 每段挑参考图 | pick-segment-images |
| 读取编排上下文 | load-planner-context |
| 点位目录 | spot-catalog |
| 编排模型调用 | planner-llm-call |
| 读取文本 | read-text |
| 探店点位上限 | store-visit-spot-limits |
| 点位图片上限 | spot-image-limit |
| 自动收藏分数线 | auto-favorite-score |
| 精细度打分 | fineness-score |
| 新建门店参数 | create-store-dto |
| 门店名称 | store-name |
| 修改门店参数 | update-store-dto |
| 门店说明 | store-description |
| 点位图片参数 | spot-image-dto |
| 点位视频参数 | spot-video-dto |
| 补充素材 | supplemental-footage |
| 点位参数 | spot-dto |
| 保存点位参数 | save-spots-dto |
| 点位整体保存 | replace-spots |
| 相似度预归类参数 | similarity-dto |
| 图片ID列表 | image-id-list |
| 草稿点位参数 | draft-spot-dto |
| 本轮新建点位 | round-new-spot |
| AI归类参数 | classify-spots-dto |
| 批量归类 | batch-classification |
| 编排推荐参数 | plan-recommend-dto |
| 是否出镜 | presenter-flag |
| 门店列表接口 | store-list-api |
| 探店点位 | store-visit-spots |
| 新建门店接口 | create-store-api |
| 修改门店接口 | update-store-api |
| 删除门店接口 | delete-store-api |
| 保存点位接口 | save-spots-api |
| 图库备注收藏 | gallery-note-favorite |
| 相似度预归类接口 | similarity-api |
| AI归类接口 | classify-spots-api |
| 看图归类 | vision-classification |
| 编排推荐接口 | plan-recommend-api |
| 推荐人物音色 | recommend-persona-voice |
| 音色标识 | voice-key |
| 锚点作废判断 | anchor-stale-check |
| 读取音色锚点 | read-voice-anchor |
| 有效锚点 | valid-anchor |
| 锚点录音上限 | voice-anchor-size-limit |
| 参考音频大小 | reference-audio-size |
| 保存音色锚点 | save-voice-anchor |
| 第一段声音 | first-segment-voice |
| 统一音色 | unified-voice |
| 探店生成参数 | store-visit-generate-dto |
| 统一音色开关 | voice-anchor-flag |
| 音色锚点参数 | voice-anchor-dto |
| 音色锚点接口 | voice-anchor-api |
| 归类工具会话 | classify-tool-session |
| 逐条校验推送 | per-call-validation |
| 点位名比对 | spot-name-key |
| 名称去重 | name-dedupe |
| 校验归类调用 | validate-assign-call |
| 推送归类 | emit-assignment |

## 类型导出 (Type Exports)

- `DouyinPublishCopy` — 脚本发布文案（标题、正文、话题），子选题的 `publishCopy` 字段。
- `DouyinStoreVisitSetting` / `DouyinStoreVisitVoiceSample` / `DouyinStoreVisitSegment` — 探店设置（门店名称 `storeName`、出镜人物照与出镜模板 `DouyinStoreVisitTemplate`、独立场景图片与实拍视频素材及说明、开场素材 `openingScene`、录音样本信息、音色来源 clone / preset 与 ID、模型、提供商、台词与分段；分段带镜头类型 `shot`、视频素材 `sceneVideoId` 与入点 `clipStart`、本机运镜 `motion`、参考音色出声标记 `nativeAudio`，服务端写入人物首帧、视频、配音地址与时长、所用音色），子选题的 `storeVisit` 字段；子选题另有 `autoConcatShots`（全部出片后自动合成，探店分段同样使用）。调用记录视图带 `segmentId`（探店分段）。
- `DouyinConcatClip` / `DouyinConcatReport` — 客户端合成的有序片段（探店分段带配音地址与字幕）与结果回报；`DouyinOutputVideoMeta` — 供应商成片登记参数。
- `DouyinMediaReference` / `DouyinStoryboardShot` / `DouyinStoryboardPreference` / `DouyinVideoAudioSetting` / `DouyinScriptDraft` / `DouyinTopicEntity` / `DouyinWorkspaceGroup` / `DouyinOperationView` / `DouyinOperationEntity`。
- `DouyinScriptStyle` — 脚本风格键名联合类型，取值来自 `DOUYIN_SCRIPT_STYLES`。
- `DouyinGenerationJobKind` / `DouyinGenerationJobProgress` / `DouyinGenerationJobView` / `DouyinGenerationJobEntity` — 后台生成任务类型、真实进度（阶段含 `queued` / `imaging` + 已写入数或已出图数 + 总数）、前端视图（结果含候选脚本与处理时间）与持久化实体。
- `DouyinStoreVisitLipSyncView` / `DouyinStoreVisitLipSyncState` — 人物段对口型的公开阶段（`identifying` / `syncing` / `done` / `skipped` + 原因）与服务端状态（原视频、人脸会话、选中的脸、可灵任务）；`StoreVisitDetectedFace` / `StoreVisitLipSyncFace` — 识别到的脸与提交给可灵的脸和配音片段。
- `ShuyanVideoRoute` — 数眼视频原生路由 `seedance` / `hailuo-v2`（MiniMax-H3）/ `wan`（万相 wan2.7-i2v，百炼异步协议）。
- `CosyVoicePresetVoice` / `CosyVoicePresetCategory` / `DashScopeRuntime` — 音色库预置音色条目、风格分类键与百炼运行配置（服务地址、Key）。
- `DouyinStoreVisitSceneImage` — 探店场景图：图库引用 + `description` + `tags`。
- `DouyinStoreVisitSceneVideo` / `DouyinStoreVisitOpeningScene` / `DouyinStoreVisitMotion` — 探店实拍视频素材（视频库引用 + `description` + `tags` + `durationSeconds`）、开场素材（`type` + `id`）与照片本机运镜取值。
- `StoryboardImageCandidate` — 分镜自动配图的候选图（编号、名称、原图与缩略图地址、标签、描述、是否竖图）。
- `DouyinMediaReferenceDto` / `DouyinStoryboardShotDto` / `DouyinStoryboardPreferenceDto` / `DouyinVideoAudioDto` / `DouyinScriptDraftPickDto` / `ConfirmDouyinScriptDraftsDto` / `CreateDouyinMotherTopicDto` / `GenerateDouyinChildrenDto` / `UpdateDouyinTopicDto` / `GenerateDouyinStoryboardDto` / `GenerateDouyinVideoDto` / `GenerateDouyinShotImageDto` / `GenerateDouyinShotVideoDto` / `PublishDouyinVideoDto` / `CrawlDouyinDataDto` / `DouyinReferenceImageDto` / `RefineDouyinScriptDto` / `DouyinPublishCopyDto` / `DouyinStoreVisitDto` / `DouyinStoreVisitSegmentDto` / `ConcatDouyinShotVideosDto` / `GenerateDouyinStoreVisitLinesDto` / `DouyinStoreVisitVoiceDto`。
- `DouyinStoreVisitStoreEntity` / `DouyinStoreVisitStoreView` / `DouyinStoreVisitSpot` / `DouyinStoreVisitSpotImage` / `DouyinStoreVisitSpotVideo` — 探店门店（租户共享）与点位（名称、说明、开场标记 `opening`、图片描述与精细度打分 `score`、补充实拍视频）；`DouyinStoreVisitClassifyEvent` — AI 归类时逐条推送的事件（`spot` 新建点位、`assign` 图片归入点位、`done` 一批结束、`error`）。
- `StoreVisitImageSignature` — 相似度预归类用的视觉签名（16 位十六进制 dHash + 4×4 网格 48 个颜色值）；`StoreVisitAssignInput` — AI 归类工具的入参（图片 id、`spot_key` 或 `new_spot`、描述与打分）；`StoreVisitSpotCatalogEntry` — 写台词用的点位目录项（序号、点位、选题里的参考图与视频）。
- `DouyinStoreVisitSetting` 新增 `storeId` / `spotIds`（点位模式的门店与重点推荐点位），`DouyinStoreVisitSegment` 新增 `spotId` / `sceneImageIds`（本段点位与 1～3 张参考图）；`CreateDouyinStoreVisitStoreDto` / `UpdateDouyinStoreVisitStoreDto` / `DouyinStoreVisitSpotDto` / `DouyinStoreVisitSpotImageDto` / `DouyinStoreVisitSpotVideoDto` / `SaveDouyinStoreVisitSpotsDto` / `DouyinStoreVisitSimilarityDto` / `DouyinStoreVisitDraftSpotDto` / `ClassifyDouyinStoreVisitSpotsDto` / `RecommendDouyinStoreVisitPlanDto`。
- `DouyinStoreVisitVoiceAnchor` — 探店音色锚点（参考声音地址、时长、取声音的分段与视频、当时的音色标识 `voiceKey`），`DouyinStoreVisitSetting.voiceAnchor`；调用记录 `continuity.anchorSegmentId` 标出统一音色模式等的锚点段；`GenerateDouyinStoreVisitVideoDto` / `SaveDouyinStoreVisitVoiceAnchorDto`。

## 模块功能描述 (Module Feature Description)

**全段原生声画与文字音色**：每段必须先生成视频，音色样本仅供模型参考；不支持或无样本时使用声音提示词。PATCH 可写 voicePrompt，修改时清除旧音色 ID、分段成片和整片，防止旧声轨混用。旧数字人与万相驱动配音节点使用画面视频节点的原生声画模型。

**实景为主与按段体验**：实景展示和人物体验使用探店画面视频节点，只有人物讲解走人物对口型。original 直接使用已有实景图，不要求另选人物；references 将本段实景和人物身份照作为两张 reference_image 直接提交，限已接入的 Seedance 2.x / MiniMax-H3 型号，不支持或缺人物照时在扣费前拒绝；generated 才由用户主动生成并复用人物首帧。镜头用途或来源改变也算新镜头，直接切素材并跳过尾帧提取和视觉规划；同镜头续段保留严格尾帧与原图参考。最终视频提示始终追加实景保真、单一稳定镜头约束。AI 台词优先集中使用 2～3 个主画面，不强制用完图片，不虚构品尝与游玩经历。修改来源会使旧队列和依赖成片失效，改台词保留可复用合成图。回归覆盖无需生图的原图体验、多图角色、换图不规划、同镜头强制尾帧、前置能力校验及旧数据兼容。

**连续探店生成**：批量提交先生成第一段，其余持久化 queued / waiting，不提前配音或扣视频费用。鉴权 continuation-input 返回 requiresTailFrame：新素材、新用途或新来源直接切入对应原图、参考图或已合成首帧；同镜头续段才用本机 ffmpeg 截实际播放尾帧、上传图库，并由视觉模型结合尾帧和原图规划。continue 接口复核用户、租户、顺序和来源快照后原子认领；同镜头缺尾帧时在认领及扣费前拒绝，生成请求只用尾帧作严格 first_frame，不混入互斥的参考图。客户端关闭后等待队列可恢复，前段失败停止后续，旧数据保留兼容。重做中间段重建后续依赖；修改分段来源、用途、台词、素材或顺序会阻止旧成片重新绑定。

**新增选题即选择制作流程**：`POST topics` 可带 `productionMode=storyboard|store-visit`，缺省分镜模式。探店模式一次写入母题与空子题草稿，二者同为探店模式，草稿不含脚本或分镜；沿用既有租户用户隔离与接口权限，不创建生成任务。`storeVisit.sceneImages` 保存最多 4 张独立图库图片，按租户校验；`sceneDescription` 最多 2000 字，嵌套更新不覆盖音色。台词生成在没有正文或分镜时直接使用探店标题和场景说明；新探店选题提交生成前必须有场景图片，在供应商调用和扣费前校验。每段以自己选的场景图为首帧生成空镜，不再回退分镜图片。

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

**探店人物出镜与画外音**：探店支持实景展示 broll、人物体验 experience 和人物讲解 presenter 按段混排。体验段指定一项动作并配画外音，使用画面视频节点，不调用人物对口型节点。每段 visualSource 选择 original 原图、references 人物与场景分开给图、generated 主动合成。新选题默认实景画外音；旧模板键 bookend、opening、presenter-all、voiceover、custom 继续兼容。人物照仅分图参考和主动合成时必需。场景最多四张、台词最多八段，音色仍由既有克隆、选用和定制接口写入。

**探店节点配置**：音色走「工作流节点模型 · 抖音视频制作 · 音色克隆与配音」节点（`voice-clone`），必须指定提供商代码为 `dashscope` 的百炼提供商（没填地址时用 `DASHSCOPE_DEFAULT_BASE_URL`，CosyVoice 接口只取域名拼 `{origin}/api/v1/services/audio/tts/…`）；门店空镜走「探店画面视频」节点（`store-visit-video`），必须是数眼智能且型号已接入原生路由（Seedance / MiniMax-H3）；人物出镜走「探店人物对口型」节点（`store-visit-avatar`），必须是数眼智能：模型为 `kling-avatar-std` / `kling-avatar-pro` 时对口型，也可以先填 Seedance / MiniMax-H3 视频型号试效果（以人物首帧为第一帧图生视频，人物会动但嘴型不跟配音，单段时长受该型号上限约束）；人物首帧走「分镜画面」节点（`shot-image`）的生图模型。`GET video/options` 的 `storeVisit.voiceClone` / `storeVisit.video` / `storeVisit.avatar` 告诉前端各节点是否就绪及空镜可选秒数。

**探店音色**：`POST topics/:id/store-visit/voice`（`create DouyinWorkbench`，multipart `file` ≤10MB，WAV / MP3 / M4A）要求已配 OSS，否则在上传录音和调用百炼之前拒绝；录音临时传 OSS 拿公网地址交给百炼声音复刻（模型取节点模型，缺省 `COSYVOICE_CLONE_MODEL`），审核 `OK` 后立即删录音，审核不通过同样删录音与半成品音色并记失败审计，换音色时删掉本脚本之前克隆的旧音色。`GET store-visit/voices`（`read`）返回音色库 `COSYVOICE_PRESET_VOICES` 与分类目录 `COSYVOICE_PRESET_CATEGORIES`（活力种草 / 温柔亲切 / 知性专业 / 方言特色，每类男女声都有），`POST topics/:id/store-visit/voice/preset`（`update`）只接受目录里的音色、模型固定 `COSYVOICE_PRESET_MODEL`。`POST topics/:id/store-visit/voice/preview`（`read`）合成一句试听（音色库音色或本脚本克隆、定制的音色），返回百炼 24 小时临时地址，服务端缓存 20 小时。`POST topics/:id/store-visit/voice/design`（`create`）按 5～500 字声音描述调百炼声音设计（`voice-enrollment` / `create_voice`，`voice_prompt` + 固定试听句，模型取节点 v3 / v3.5 模型，否则 `COSYVOICE_CLONE_MODEL`），等音色可用后写成 `voiceSource=design` 并保存描述 `voicePrompt`，失败删半成品、保留原音色并记 `voice-design` 失败审计。克隆和定制音色属于创建时那个百炼账号，配音时优先用音色记录上的提供商取 Key；换音色时删掉本脚本之前克隆或定制的旧音色。

**探店场景说明**：`storeVisit.sceneImages[]` 与 `storeVisit.sceneVideos[]` 每个素材带 `description` 与 `tags`（照片说明即图库备注，视频说明即视频库备注）。`buildStoreVisitSceneBrief` 把这一段场景图的说明标签与门店整体说明 `sceneDescription` 拼起来写进人物首帧、续段衔接与视频提示词；`writeStoreVisitLines` 把素材按【素材k】序号（开场素材排第一）写进提示。生成前任何素材没写说明都会在扣费前拒绝。

**探店场景起始画面与分段生成**：只有主动选择 generated 的人物体验或讲解镜头需要生成首帧；同场景同用途复用，改台词保留。original 直接以所选图片为首帧，references 在支持的型号上直接带两张参考图，不调用生图服务。不同镜头直接切入本段素材，同镜头按连续探店流程接真实尾帧。最终存储再次复核来源、人物、素材、台词、音色和前段视频，避免旧生成覆盖修改后的编排。

**探店桌面端合成**：所有分段须有 videoId 且 nativeAudio=true。领取合成时只返回生成的视频与字幕，不返回配音、图片缓推或原始视频入点；客户端按真实视频时长保留音轨并烧字幕。

**人物段出片后对口型**：「探店人物对口型」节点填视频型号（Seedance / MiniMax-H3）时，人物讲解段先按首帧或同镜头上段尾帧生成固定机位的讲解画面（提示词要求大部分时间正脸对镜头、只有主播露正脸），出片后不立即入库，而是原子认领进入对口型：用同一数眼 Key 调可灵 `identify-face` 识别画面里的人脸；只有一张脸出现超过半段时直接当主播，否则把候选脸截图（按出现时长取前 6 张）和出镜人物照交给「探店尾帧衔接」节点的视觉模型比对，同一人被拆成多段时都选上，比对失败退回出现超过半段的最长那张；选中的脸按各自出现时间对上同一时段的配音（配音从第 0 秒铺，短于 2 秒的片段不提交），提交 `advanced-lip-sync` 后由后台轮询，完成后把对口型版本入库并绑定分段，下一段从它的尾帧接续。识别不到人脸、找不到主播、接口未开放或对口型失败时不让整段失败：保留原画面入库，调用记录的 `lipSync` 写 `skipped` 与中文原因，工作台在分段进度里标出。因为定格补齐的几秒嘴不会动，人物段配音不得超过视频型号最长秒数。对口型目前不单独向租户扣费，计入这段的一次生视频扣费。

**数眼万相路由（wan2.7-i2v）**：数眼把百炼原生协议挂在 `/ali/` 前缀下，用同一个数眼 Key：`POST /ali/api/v1/services/aigc/video-generation/video-synthesis`（必须带 `X-DashScope-Async: enable`）返回 `output.task_id`，`GET /ali/api/v1/tasks/{id}` 查 `output.task_status`（PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED / UNKNOWN）与 `output.video_url`。请求体为 `input.prompt` + `input.media`（`first_frame` 必传，`driving_audio` 可选）+ `parameters`（`resolution` 720P / 1080P、`duration` 2～15 秒、关闭提示词改写与水印），图片和音频都只收公网 http(s) 地址。分镜 / 整片 / 探店空镜都能选它（只能图生视频，必须有首帧）；「探店人物对口型」节点选它时，人物段以场景人物画面或上一段尾帧为首帧、这段配音为驱动音频，一次生成会动且口型跟配音的画面，不再走出片后对口型；人物段配音 2 秒到 15 秒、不给定格容差，没配 OSS 时在建队列和扣费前拒绝。后台模型列表按名字兜底分类时，`-i2v` / `-t2v` / `-r2v` / `-s2v` 归为视频模型。

**探店实拍素材与本机缓推**：照片与实拍视频都作为模型参考素材，每段均调用视频生成。旧 visualSource=local 自动按 original 生成声画；删除 submitLocalSegment，不再创建只配音完成记录。视频引用取当前租户视频库真实地址，不能直接剪入成片。

**探店台词按素材说明写、不编数字**：`writeStoreVisitLines` 对独立探店写一条完整的画外音口播（整条约 30～60 秒、每段 20～60 字，提示词附一段示例只示范写法与节奏）：第 1 段用开场门头素材，点出门店名称（「今天我们来到了 XX」）和这家店最吸引人的一点；后面每段讲一个素材，照说明用两三句短句介绍是什么、有什么、怎么玩、适合谁；说明里有团购价时要连同对象一起报（如「这份双人套餐，抖音团购只要 99 元」），不能单独甩出一个价格，也不必每段都报；结尾引导下单。语气口语、热情、自然，可用「家人们」这类常见称呼，不用「老铁」「兄弟」「整」这类江湖口吻（预设人物另有要求时按人物），段间可用「再来看看」这类口头衔接但不编画面里没有的动作。台词由配音或视频模型念出来，「好念」规则要求只用普通话常用词，不用方言词、方言音译字（「嘎哈」「咋整」「杠杠的」等）和网络谐音字（「酱紫」「木有」等）；人物设定或补充要求偏东北话、方言风格时只在语气节奏上体现，这条优先于人物设定（旧脚本改写旁白同样适用）。提示词禁止编造店名、菜品、项目、价格、份量、口感与亲身体验，价格一律阿拉伯数字且与说明一致，温度 0.4。台词里出现资料没有的数字、方言谐音字（店名或素材说明里本来就有的不算）或分段格式不对时，带着原输出和问题让模型重写一次；仍有问题或整条不到约 20 秒时，连同 `warnings`（没写过的数字、方言谐音字、中文数字价格、开场没报店名、台词偏短）返回给前端提醒核对。

**门店照片和人物照一起给（不生成首帧）**：人物段的门店照片作图1、正面全身人物照作图2，提示词先列素材说明再写动作与完整台词；声音在视频中生成，不再提交后期可灵对口型。

**画面动起来、人物站进场景**：实景约束不再要求固定机位、只许指定动作，改成「不新增、不改变画面里的东西，但原图里本来就有的灯光、屏幕、投影、布帘、热气要自然动起来」，实景画面默认镜头缓慢推近（`STORE_VISIT_SCENE_MOTION`）。人物首帧与多图参考提示词都加中景构图（`STORE_VISIT_PERSON_IN_SCENE`）：人物站在场景地面上、约占画面一半、和场景同光同影、脚下有影子，避免拍成大头贴贴在背景前；门店照片和人物照一起给时，图2 优先取人设的正面全身形象（面部特写会把人拍成大头）。

**人物参考音色亲口说（Seedance 2.0）**：所有画面段和人物段都由模型直接生成台词声音。Seedance 2.0、MiniMax-H3 可用音色样本时传 reference_audio，图片相应使用 reference_image，避免与 first_frame 冲突；样本只能作为音色参考，生成记录不写供合成替换的 audioUrl。没有样本或使用直接声音描述时用提示词生成声音。新记录统一 nativeAudio=true，完成后不追加对口型，按视频实际时长绑定分段。

**探店门店与点位（场景图库归类）**：探店素材改成「门店 → 点位」两层。门店存在 `douyin_store_visit_stores`，租户内共享、同名去重；点位是一个具体场景（一个游乐设备、一个打卡点、一道菜或门头），由多张场景图库图片（可加补充实拍视频）组成，每张图带描述与 1～10 的精细度打分。归类分两步：`POST store-visit/stores/:storeId/similarity` 用 sharp 给每张图算视觉签名（9×8 灰度差值哈希 + 4×4 网格平均色），距离低于 0.2 的单链接聚成一组；`POST store-visit/stores/:storeId/classify` 把一批最多 8 张图（缩到 768px 的 JPEG data URL）连同已有点位与本轮草稿点位的封面交给「探店场景归类」视觉节点（轻量 Agent，只挂一个工具 `store_visit_assign_image`，不挂文件系统等内置工具）：模型每看完一张就调用一次工具，归入已有点位填 `spot_key`，都对不上填 `new_spot`（中文名也行，按名称去重，服务端生成 `new-` 草稿键）；每次调用由 `createStoreVisitClassifySession` 校验，通过就立刻按 NDJSON 推一行 `spot` / `assign` 给前端，并把本批还没归的图片返回给模型，不合规（图片不在本批、点位不存在）就把原因返回给模型重来、不推送；一批结束推 `done`（归上与没归上的图片），一张都没归上推 `error`。前端断开时中止模型；中途出错但已有归上的图片时保留已推的结果。不落库。一次回复里允许连着调多次工具，避免每张图都重发整批图片。前端确认点位命名后 `PUT store-visit/stores/:storeId/spots` 整体保存：图片地址以图库记录为准、一张图只归一个点位，描述变化的写回图库备注，打分 ≥8 的在图库里自动收藏（不取消用户自己的收藏）。

**探店 AI 编排与点位台词**：选题的 `storeVisit` 新增 `storeId` 与最多 8 个 `spotIds`；前端把重点推荐点位按分数各取最多 4 张图同步成 `sceneImages`（说明写成「点位名：图片描述」），素材合计上限因此从 8 放宽到 32。`POST topics/:id/store-visit/plan/recommend` 用「探店编排推荐」节点按门店与点位挑出镜人物（只在要出镜时、且只挑有形象图的预设人物）和音色库音色，并写一句声音描述；模型失败或乱填时按人物性别 / 活力种草兜底。点位模式下 `POST topics/:id/store-visit/lines` 改走 `writeSpotLines`：开场用门头点位报店名，之后按用户挑的顺序一段讲一个点位，每段第一行写「【点位k｜图k.a,k.b】」挑 1～3 张同一点位的图（没写或写错按分数轮换兜底），编了数字或用了方言字时重写一次，仍有问题带核对提醒返回。

**一段多张参考图**：分段新增 `spotId` 与 `sceneImageIds`（第一张即 `sceneImageId`，最多 3 张，只收本选题素材里的图）。实景段生成时其余 1～2 张作 `reference_image` 一起交给视频模型（主图也改按参考图传、画幅固定 9:16），提示词说明「图1～图N 是同一个地方，以图1 为主画面，不拼贴不分屏」；人物出镜段与接尾帧的续段不加图。参考图组变化与台词、素材变化一样会作废这段成片，排队快照与续段复核也比较它。

**第 1 段的声音统一音色（音色锚点）**：以前每段都按自己的台词另合成一条参考音频（只填声音描述时干脆没有参考），各段音色容易不一样。现在 `POST topics/:id/store-visit/generate` 带 `voiceAnchor: true`（桌面端能取音频时前端才传）且模型支持参考音频、本批不止一段、还没有可用锚点时：本批第 1 段先提交，其余新镜头记成等待第 1 段的待衔接记录（`continuity.previousSegmentId` 与 `anchorSegmentId` 都是第 1 段），同镜头续段仍等上一段尾帧。第 1 段出片后 `GET operations/:id/store-visit/continuation-input` 返回 `voiceAnchor`（锚点段与视频地址），桌面端取出开头最多 12 秒的声音（24kHz 单声道 WAV）经 `POST topics/:id/store-visit/voice-anchor` 上传：只收 2～15 秒的 WAV，同一段同一个视频已有锚点就直接返回，写进 `storeVisit.voiceAnchor` 并记下当时的音色标识（音色 ID + 声音描述，换音色或改描述后锚点自动不用）。锚点声音上传前续段不认领、不扣费；有了锚点，等待的各段并行提交，提交时都把锚点作 `reference_audio`（本机地址读文件转 data URL），不再按台词另合成。不传 `voiceAnchor` 时照旧逐段排队；已有可用锚点时任何提交（含单段重做）都优先用它。锚点始终是整条视频的第 1 段：单段重做（`POST topics/:id/store-visit/segments/:segmentId/generate` 也收 `voiceAnchor`）时第 1 段已出片但还没取声音，就让重做的段先等第 1 段、客户端取声音后再提交。后台轮询（`refreshRow`）对等第 1 段声音的新镜头不要求它紧挨第 1 段，只在分段真被改动、删除或重排，或等的那段失败时才停；只等声音的段提交时不记第 1 段的视频，第 1 段以后重做也不会作废它。
