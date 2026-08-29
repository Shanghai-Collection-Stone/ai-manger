# Canvas Module

## 模块描述
该模块基于MongoDB存储画布，支持两种 canvas 类型：
- **article**（默认）：图文拼盘，包含 articles 列表。
- **image-group**：图片组拼盘，根据文章 tag 批量匹配配图，按固定版式组合图组，异步生成。

文件路径: `src/modules/canvas`

## 固定版式（每组 6 张：1 封面 + 5 内页）
- **portrait-cover-5inner**: 1竖封面单图 + 5内页（拼图/竖图交替）
- **collage-cover-5inner**: 1横拼图封面 + 5竖内页单图
- **collage-cover-5collage**: 1横拼图封面 + 5横拼图内页；自动版式下竖图不足但横图充足时优先回退到该版式
- 横图只允许进入拼图/拼图封面；单张封面和单张内页只接受竖图，图片不足时进入不足/失败流程，不降级为单张横图。
- **封面优先拼图（`preferCollageCover`）**：入参打开后，文章没有显式 `layout` 时先按 `collage-cover-5inner` 试算，图片池够就用拼图当封面底图；不够则原样回落交替版式，再由既有的全拼图回退兜底，**不会因为这个偏好而让生成失败**。该版式相比默认 `portrait-cover-5inner` 只多要 1 张竖图、少要 2 张横图，多数图库能直接满足。小红书专家生文链路默认开启。

## 封面文案风格
- LLM 生成主标题（6-16汉字）+ 副标题（10-24汉字）作为结构化元数据
- `ai-direct` 封面图片仅生成无字底图，不再调用字体库或 SVG 烧字
- `ai-direct` 的主副标题由调用方按画布格式转换为独立可编辑文字图层；`ai-overlay` 则把主副标题直接生成到文字海报素材中

## AI 封面策略（coverStrategy）
- **ai-direct**（默认，canvas 发文链路）：把封面源图当底图丢给生图模型做二次编辑，模型产出物**直接作为封面成品**。走 `/images/edits`，`buildAiCoverPrompt` 的视觉指令 + `AgentService.buildMeituEditPrompt` 的封面硬性规格叠加下发。
- **ai-overlay**（小红书专家链路）：AI 产出**文字与装饰融合的海报素材层**，指定主副标题直接成为素材像素的一部分，真实照片主体不经过模型重绘。默认视觉语言采用亮粉/明黄/天蓝/奶白、粗黑描边的高对比波普贴纸风；服务端同时保存合成预览图、原照片底图、绿幕原素材和去底 PNG，进入灵感画布后还原成“照片 + 可加特效的文字海报素材”两个独立图层。素材默认按画布宽高的 70% 居中摆放，不再铺满画布，也不重复创建原生文字层。
- 装饰层固定生成**纯绿色 `#00FF00` 实底**，不请求、不依赖任何模型的透明通道；前景装饰禁止使用绿色系，避免与绿幕混淆。
- 合成前由 sharp 按绿色通道优势度生成软边 alpha 色键，再统一以 `over` 模式叠到真实照片上。
- 文字海报素材可用性两道闸，任一不过就回退到未叠加的真实照片封面：① 绿幕像素占比 `<0.30`；② 色键后的前景占比 `>0.68`。
- `ai-direct` 是模型重画整张图，产出物不是拼图，`collage` 恒为空。
- **拼图只是底图，浮在上面的 AI 素材照旧**：素材是独立文生图产出的，prompt 不看底图；两道质量闸算的是素材自身像素；素材元数据的 `canvasWidth/canvasHeight` 与 `buildCollageLayout` 的拼图画布尺寸**同为 640×853**，所以合成时底图 resize 对拼图是空操作、编辑器里两者按同一比例缩放，素材始终居中占 70%。改 `AI_OVERLAY_*` 或拼图尺寸时必须让这两个参照系保持一致。拼图封面出图仍是 640×853 竖版 3:4（`collage-cover-*` 里的"横拼图"指源图是横图），换成拼图封面不改变封面比例。
- `ai-overlay` 只在真实照片上叠一层贴纸、底图像素不被重绘，所以**封面底图是拼图时会把拼图画布格式一起带下去**：`editableBase` 指向未合成的拼图原图，`collage` 的格子逐格与它对齐，进设计编辑器后拼图仍可逐张换图，海报素材是叠在上面的独立图层。

## 拼图画布格式
- 拼图除了产出合成好的 PNG，还在 `CanvasGroupImage.collage` 上带一份画布格式：拼图画布尺寸 + 每张源图的格子（`imageId` / `url` / `x` / `y` / `width` / `height` / `objectFit`）
- 格子坐标与 sharp 合成时用的网格逐格一致（`resolveMultiCollageCells`，2=上下 / 3=上1下2 / 4=2x2）
- 合成图仍是发布与预览用的单张图；画布格式只供设计编辑器把拼图还原成逐格图层，后续可以单独换掉其中某一张图
- `ai-direct` 封面、单张竖图与重生成产出的图不是拼图，`collage` 为空；`ai-overlay` 封面在底图本身是拼图时保留 `collage`

## 功能描述及关键词

### canvas.controller.ts
Canvas控制器。
- `POST /canvas` — 创建图文 Canvas
- `POST /canvas/image-group` — 创建图片组 Canvas（异步，立即返回 generating）
- `GET /canvas/:id` — 获取单个 Canvas
- `GET /canvas` — 列表 Canvas（支持 type/skip/tag 参数分页过滤）
- `POST /canvas/:id/articles` — 追加文章 
- `PATCH /canvas/:id/status` — 更新状态
- `PATCH /canvas/:id/articles/:articleId` — 更新文章
- `POST /canvas/:id/articles/:articleId/cover/regenerate` — 选择一张或多张图库图片重新生成图文 Canvas 单篇封面；仅替换首图并把 Canvas 暂置为 generating | keywords: cover-regenerate, article-cover-only
- `POST /canvas/:id/articles/:articleId/cover/select` — 直接使用一张图库图片设为图文 Canvas 单篇封面；仅替换首图且不进入 generating | keywords: cover-select, article-cover-only
- `POST /canvas/:id/articles/:articleId/images/:imageIndex/regenerate` — 选择一张或多张图库图片重新生成图文 Canvas 单篇文章指定图片槽位，imageIndex=0 为封面、1+ 为内页；立即把 Canvas 暂置为 generating | keywords: article-image-regenerate, image-slot-regenerate
- `POST /canvas/:id/articles/:articleId/images/:imageIndex/select` — 直接使用一张图库图片替换图文 Canvas 单篇文章指定图片槽位，imageIndex=0 为封面、1+ 为内页；不进入 generating | keywords: article-image-select, image-slot-select
- `POST /canvas/:id/image-groups/:groupId/cover/regenerate` — 选择一张或多张图库图片重新生成图片组 Canvas 指定图组 role=cover；仅替换封面并把 Canvas 暂置为 generating | keywords: cover-regenerate, image-group-cover-only
- `POST /canvas/:id/image-groups/:groupId/cover/select` — 直接使用一张图库图片设为图片组 Canvas 指定图组 role=cover；不修改其他内页图 | keywords: cover-select, image-group-cover-only
- `POST /canvas/:id/image-groups/:groupId/images/:role/regenerate` — 选择一张或多张图库图片重新生成图片组 Canvas 指定 role（cover/inner-1~5）；立即把 Canvas 暂置为 generating 且仅替换目标图片槽位 | keywords: image-slot-regenerate, image-group-image-slot
- `POST /canvas/:id/image-groups/:groupId/images/:role/select` — 直接使用一张图库图片替换图片组 Canvas 指定 role（cover/inner-1~5）；不修改其他图片槽位 | keywords: image-slot-select, image-group-image-slot
- `PATCH /canvas/:id/articles/:articleId/sent` — 标记文章已发送（写入 sentAt 时间戳）
- **关键词**: canvas, articles, image-group, outline, style, content-json, image-ids, status, sent-at, mongo, controller

### canvas.service.ts
Canvas服务。
- `create` — 创建图文 Canvas
- `createImageGroupCanvas` — 创建图片组 Canvas（异步生成，快速返回 ID）。透传 `dedup` 到后台 runImageGroupGeneration
- `generateArticleImageGroups(input)` — 不创建独立 Canvas，直接复用生文图片阶段按相关 tag 生成封面、五张内页、动态拼图与可选 AI 封面；封面走 `input.coverStrategy`，`ai-overlay` 可用 `input.coverStyle` 选择素材风格预设或随机，`input.preferCollageCover` 让封面优先用拼图底图 | keywords: 生文配图工作流, 文章图组, 封面策略, 封面优先拼图, article-image-workflow, generated-image-group, cover-strategy, prefer-collage-cover
- `generateImageGroupsForCanvas` — 在指定 canvasId 上复用图组生成逻辑并回写 imageGroups。**`append` 参数**: true=追加到现有图组(复用 Canvas 再生成新图组,xhs hasCanvasId 分支传 true);false/缺省=覆盖(新建 Canvas 首次生成,runImageGroupGeneration)。**`dedup` 参数**: 缺省/true=去重(排除 isUsed+生成后 markUsed);false=不去重(命中已用图、随机取图、不写 isUsed) | keywords: dedup, includeUsed
- `startArticleCoverRegeneration(input)` — 启动图文 Canvas 单篇封面重生成，立即置为 generating，后台仅替换 article.imageUrls/imageIds 的首项，参考图最多 4 张 | keywords: cover-regenerate, article-cover-only
- `startArticleImageRegeneration(input)` — 启动图文 Canvas 单篇文章指定图片槽位重生成，立即置为 generating，后台仅替换目标 imageUrls/imageIds 下标，参考图最多 4 张；透传 `includeSystemPrompt`(默认 true) 决定是否叠加系统自带封面/内页提示词 | keywords: article-image-regenerate, image-slot-regenerate, system-prompt-toggle
- `startImageGroupCoverRegeneration(input)` — 启动图片组 Canvas 单组封面重生成，立即置为 generating，后台仅替换目标组 role=cover 图片，参考图最多 4 张 | keywords: cover-regenerate, image-group-cover-only
- `startImageGroupImageRegeneration(input)` — 启动图片组 Canvas 指定图片槽位重生成，立即置为 generating，后台仅替换目标组对应 role 图片，参考图最多 4 张；透传 `includeSystemPrompt`(默认 true) 决定是否叠加系统自带封面/内页提示词 | keywords: image-slot-regenerate, image-group-image-slot, system-prompt-toggle
- `selectArticleCoverImage(input)` — 直接用图库图片替换图文 Canvas 单篇文章首图封面，不进入生成中状态 | keywords: cover-select, article-cover-only
- `selectArticleImage(input)` — 直接用图库图片替换图文 Canvas 单篇文章指定图片槽位，不进入生成中状态 | keywords: article-image-select, image-slot-select
- `selectImageGroupCoverImage(input)` — 直接用图库图片替换图组 Canvas 指定图组 role=cover 图片，不修改其他内页图 | keywords: cover-select, image-group-cover-only
- `selectImageGroupImage(input)` — 直接用图库图片替换图组 Canvas 指定 role 图片，不修改其他图片槽位 | keywords: image-slot-select, image-group-image-slot
- `normalizeCoverSourceIds(imageIds)` — 归一化图片槽位重生成素材图片 ID，去重并限制最多 4 张 | keywords: cover-regenerate, selected-source-images
- `loadSelectedCoverImage(input)` — 读取直接设图所选图库图片：选 1 张返回 `{ image }`；选 2-4 张实时合成 3:4 拼图(composeSelectedCollage)并返回 `{ image, collage }`，让"直接使用"即拼即用且拼图带画布格式，合成失败回退首图 | keywords: cover-select, selected-cover-image, multi-collage, collage-canvas-format
- `resolveGalleryImageUrl(image)` — 从图库图片解析可写回 Canvas 的原图或缩略图地址 | keywords: cover-select, selected-cover-image
- `toSelectedCoverGroupImage(image, currentCover?, articleTitle?)` — 将图库图片转换成图组 Canvas role=cover 图片结构并沿用原封面文案 | keywords: cover-select, image-group-cover-only
- `toSelectedGroupImage(image, role, currentImage?, articleTitle?, collage?)` — 将图库图片转换成图组 Canvas 指定 role 图片结构，封面会沿用原文案，实时合成的拼图带画布格式 | keywords: image-slot-select, image-group-image-slot, collage-canvas-format
- `normalizeImageGroupImageRole(role)` — 校验图片组 role，仅允许 cover 与 inner-1~5 | keywords: image-slot-regenerate, image-group-image-slot
- `normalizeArticleImageIndex(imageIndex)` — 校验并归一化图文文章图片下标，当前允许 0-8 | keywords: article-image-regenerate, image-slot-regenerate
- `assertArticleImageSlotExists(article, imageIndex)` — 校验图文文章图片槽位存在，封面槽位允许从空首图开始生成 | keywords: article-image-regenerate, image-slot-regenerate
- `toArticleInnerRole(imageIndex)` — 将图文文章图片下标映射到内页重生成 role | keywords: article-image-regenerate, inner-regenerate
- `runArticleCoverRegeneration(input)` — 后台执行图文文章封面重生成包装逻辑，复用 imageIndex=0 的图片槽位重生成 | keywords: cover-regenerate, article-cover-only
- `runArticleImageRegeneration(input)` — 后台执行图文文章指定图片槽位重生成，成功后恢复原状态，失败时标记 requires_human | keywords: article-image-regenerate, image-slot-regenerate
- `runImageGroupCoverRegeneration(input)` — 后台执行图片组封面重生成包装逻辑，复用 role=cover 的图片槽位重生成 | keywords: cover-regenerate, image-group-cover-only
- `runImageGroupImageRegeneration(input)` — 后台执行图片组指定图片槽位重生成，成功后恢复原状态，失败时标记 requires_human | keywords: image-slot-regenerate, image-group-image-slot
- `readArticleTagsForImageGroup(canvas, group)` — 读取图组对应文章标签，供内页重生成提示词补充语义 | keywords: inner-regenerate, image-group-image-slot
- `replaceCoverImage(images, cover)` — 替换图片组内 role=cover 图片；原组没有封面时插入到第一位 | keywords: cover-regenerate, replace-cover-image
- `replaceGroupImageByRole(images, nextImage)` — 按 role 替换图片组中的指定图片槽位，原槽位不存在时插入合适位置 | keywords: image-slot-regenerate, replace-image-slot
- `prepareImageGroupsForCanvas(input)` — 只准备指定 Canvas 的图片组源图分配，不生成封面/拼图文件，用于图文生成前置不足量拦截；透传 `dedup` | keywords: prepare, allocation, canvas, dedup
- `renderPreparedImageGroupsForCanvas(input)` — 根据预分配结果渲染图片组并回写 Canvas；透传 `dedup`(false 时不 markUsed) | keywords: render, prepared, image-group, dedup
- `runImageGroupGeneration` — 后台异步生成图片组并回写；当统一分配发现图片不足或图组失败时将 Canvas 标记为 requires_human
- `updateImageGroups` — 回写图片组到 Canvas。`append=false`(默认)整组 `$set` 覆盖;`append=true` 读出现有 imageGroups + 新图组 id 接续最大 id 重编号后拼接(复用 Canvas 再生成时**追加不覆盖**,修复"再来一组"重置上一组结果的 bug)
- `get` / `list` / `addArticles` / `updateStatus` / `updateArticle` / `updateMeta` — 常用crud
- `list` — 支持 type / skip / tag 过滤 + skip 分页
- `listUnusedImageGroupCanvases(input)` — 查询未被生文消费的 image-group Canvas；旧数据无 imageGroupUsage 时按 unused 处理，仅返回 completed 且含图组的 Canvas | keywords: 未使用图组, unused-image-groups
- `markImageGroupCanvasesUsed(input)` — 生文消费指定图组后按 groupIds 累计标记 imageGroupUsage=partial/used，记录 usedByCanvasId/usedByArticleIds | keywords: 图组已使用, mark-image-group-used
- `markArticleSent` — 标记指定文章已发送（写入 sentAt），支持自定义时间
- **关键词**: service, image-group, async, sent-at, pagination

### canvas-image-group.service.ts
图片组生成服务。
- `generateImageGroups` — 根据文章 tag 严格匹配图库配图（**不再跨 tag 随机补图**），先在 Canvas 级统一分配所有图组所需竖图/横图源图并严格全局去重；图片不足时返回 failed 图组，让上游提示用户补充图片。**完成后调用 `gallery.markUsedBatch` 标记本批次实际消耗源图为 isUsed=true,全局不再被默认查询命中**(由 [media-agent xhs 工具](../media-agent/module.md) 的 precheck 兜底拦截基础不足量场景)
- `regenerateCoverImage(input)` — 基于用户本次多选的最多 4 张图库图片一次性生成新的 3:4 Canvas 封面，不复用旧封面提示词/旧封面文案，写入动态封面图库；`includeSystemPrompt=false` 时只用用户提示词(必填)并向下游传 kind=cover | keywords: cover-regenerate, selected-source-images, system-prompt-toggle
- `regenerateInnerImage(input)` — 基于用户本次多选的最多 4 张图库图片一次性生成新的 3:4 Canvas 内页，不复用旧内页提示词/旧内页文字，不添加封面标题并写入动态内页图库；走内页专属规格(少文字重内容,kind=inner)，`includeSystemPrompt=false` 时只用用户提示词(必填) | keywords: inner-regenerate, image-group-image-slot, system-prompt-toggle
- `prepareImageGroupSources(input)` — 只做图片组源图准备：统一取图、统一分配竖图/横图，不生成 AI 封面、带文封面或拼图文件 | keywords: prepare, source-allocation, no-render
- `renderPreparedImageGroups(input, preparation)` — 根据已完成的源图分配渲染图组；`ai-direct` 输出无字封面底图，`ai-overlay` 输出含字海报素材封面；并发数由 `IMAGE_GROUP_RENDER_CONCURRENCY` 环境变量控制（默认 1）。**`input.dedup===false` 时跳过 markUsedBatch**，源图保留可无限复用 | keywords: render, prepared, image-group, concurrency, dedup
- `renderOnePlan(plan, input, preparation)` — 渲染单个图组计划（封面底图或按预设风格生成的含字素材/内页/封面文案元数据），供并发调用 | keywords: render, single-plan, image-group, cover-text
- `planImageGroupAllocation(pool, articles, options?)` — 在 Canvas 级一次性规划所有图组 source 图片，按版式统计竖图/横图需求，禁止跨组复用；`options.preferCollageCover` 先试拼图封面版式、池子不够即回落，自动版式还可在竖图不足时切到全拼图版式 | keywords: plan, allocation, no-reuse, 封面优先拼图, prefer-collage-cover
- `PREFERRED_COLLAGE_COVER_LAYOUT` — 「封面优先拼图」命中的版式常量（`collage-cover-5inner`） | keywords: 封面优先拼图, 拼图封面, prefer-collage-cover, collage-cover
- `buildImageGroupAllocationRequests(articles, options?)` — 根据文章列表生成图组版式槽位需求，支持自动版式覆盖 | keywords: plan, allocation, layout
- `summarizeImageGroupAllocationStats(requestedGroups, availablePortrait, availableLandscape)` — 统计分配所需竖图/横图数量与素材缺口 | keywords: stats, allocation, shortage
- `allocateRequestedImageGroups(requestedGroups, portraitPool, landscapePool, stats)` — 按确认槽位实际领取源图并保证 Canvas 内不复用 | keywords: allocate, no-reuse, image-group
- `buildInsufficientImageGroups(articles)` — 构造图片不足时的 failed 空图组，供文章/Canvas 进入 requires_human 补图流程 | keywords: insufficient, requires-human, image-group
- `collectPlanSourceImages(plan)` — 收集图组分配计划中的全部源图，用于文章正文和封面文案共享图片语义 | keywords: collect, allocation, image-context
- `persistPlannedCollage(input)` — 将统一分配好的两张横图合成为动态拼图并入库，同时返回拼图画布格式 | keywords: collage, allocation, gallery, collage-canvas-format
- `generateCoverTexts` — LLM 批量生成封面主/副标题（{title, subtitle}[]），内部 LLM 调用附加 `nostream`，避免跟随主 SSE token 流；内容优先级为「文章标题 > 配图语义」，主标题只能提炼文章标题，配图标签/描述降级为方向参考（标签上限 8 条）且冲突时丢弃 | keywords: 封面文案, 工具内部非流, 标题优先, cover-text, internal-llm-nostream, title-first
- `isAiCoverEnabled` — 读取租户平台配置中的 AI 封面开关
- `sanitizeCopyrightRiskText(raw)` — 将封面文案/生图提示中的高风险 IP、商标和角色专名替换为版权安全泛化表达 | keywords: sanitize, copyright-safe, image-prompt
- `sanitizeCopyrightRiskList(items?)` — 清洗列表型封面上下文，去重后返回版权安全表达 | keywords: sanitize, copyright-safe, list
- `sanitizeCoverText(coverText)` — 清洗封面主副标题，避免可见文案携带 IP/商标专名 | keywords: sanitize, cover-copy, copyright-safe
- `buildAiCoverPrompt` — 构建封面元信息骨架与实景照片优先的无字底图视觉指令，文案仅用于理解主题和预留构图空间，明确禁止生成任何文字；通用图生图硬约束由 AgentService.buildMeituEditPrompt 在下游补齐
- `tryGenerateAiCoverToGallery` — `ai-direct` 策略:调用封面生图工具生成封面并写入图库（透传prompt与底图候选，meitu兜底走image-edit）
- `buildAiCoverOverlayPrompt({ topic?, articleTitle?, coverText, coverStyle? })` — 按素材风格预设或旧版默认视觉构建纯绿实底文字海报素材提示词 | keywords: 文字海报素材, 绿色素材层, typography-poster-material, green-screen-material
- `tryComposeAiOverlayCoverToGallery(input)` — 生成装饰素材，同时返回合成预览、原照片底图和默认占画布 70% 的居中可回改素材层，并把透明文字海报以 `ai素材` 标签同步入图库 | keywords: 装饰素材叠加, 图层分离, 可编辑装饰素材, decoration-overlay-cover, separated-layers, editable-decoration-material
- `buildGeneratedAssetTags(generatedKind, sourceImages?)` — 为封面、拼图、内页或 AI 文字海报素材生成隔离的图库标签 | keywords: AI素材标签, 生成素材标签, ai-material-tag, generated-asset-tags
- `composeCoverWithOverlay(basePath, overlayPath)` — sharp 对纯绿素材做软边色键，将透明 PNG 缩至画布 70% 并居中叠加，同时输出素材与 640x853 合成预览 | keywords: 装饰素材叠加, 绿幕色键, 可编辑装饰素材, composite-overlay-on-photo, green-screen-keying, editable-decoration-material
- `fetchImagePool` — tag匹配取图（过滤默认动态封面/动态拼图分组）。**已移除"不足时补随机/相近标签"逻辑**,只严格按 tags 取池,不足由上游工具预检+用户决策。`dedup===false` 时传 `includeUsed=true` 命中已用图(取池后由 shuffleArray 随机取图) | keywords: dedup, includeUsed
- `shuffleArray` — Fisher-Yates 洗牌打乱图片池顺序，避免封面/内页顺序性重复
- `pickPortrait` — 从池中选竖图（必须全局未使用；不跨组复用，不降级为横图）
- `pickAndMakeCollage` — 仅选 2 张全局未使用横图动态合成拼图（上下拼，640x853，等比缩放不裁切；不跨组复用，不降级为竖图/任意方向）
- `createDynamicCollageFile` — 动态合成双图拼图（使用 sharp，640x853 上下拼）
- `resolveMultiCollageCells(count)` — 计算 2/3/4 张拼图在 640x853(3:4) 画布上的网格单元格（2=上下/3=上1下2/4=2x2） | keywords: multi-collage, collage-layout
- `buildCollageLayout(images)` — 按合成网格把 2-4 张源图描述成拼图画布格式(画布尺寸 + 各源图格子)，供编辑器还原成可逐张替换的图层 | keywords: collage-canvas-format, swappable-collage
- `createMultiCollageFile(images)` — 将 2/3/4 张图库图合成固定 640x853(3:4) 竖版拼图(fit:cover 充满,不烧字),2 张复用 createDynamicCollageFile | keywords: multi-collage, collage-compose
- `composeSelectedCollage({ userId, tenantId, sourceImageIds(2-4), generatedKind?, groupId? })` — 把用户多选的 2-4 张图合成 3:4 拼图并写入动态拼图图库,返回 `{ image, collage }`(持久化图片 + 拼图画布格式),供"直接设图"槽位复用 | keywords: multi-collage, select-collage, collage-canvas-format
- `persistGeneratedAssetToGallery(input)` — 将动态封面、拼图、内页或 AI 文字海报素材写入 gallery_images，素材不混入动态封面分组 | keywords: 生成素材入库, AI素材同步, persist-generated-asset, sync-ai-material
- `resolveGeneratedUploadFileInfo` / `getImageDimensionsFromAbsPath` — 解析生成文件路径并补齐宽高元数据
- `burnCoverText` / `burnCollageCoverText` — 仅保留给历史兼容的 sharp+SVG 烧字实现；当前封面生成链路不再调用
- `loadCoverFontFaceCss` — 历史烧字兼容方法使用的封面字体 base64 缓存；当前封面链路不加载
- `ensureFontconfigSetup` — 历史烧字兼容方法使用的 Linux 字体配置；当前封面链路不执行
- `toGroupImage(img, role, coverCopy?, collage?)` — 图库实体转图组图片（含封面主/副标题与拼图画布格式） | keywords: collage-canvas-format
- **关键词**: image-group, layout, tag-match, gallery, collage, collage-canvas-format, font, linux-compat

### canvas.entity.ts
Canvas实体，含新类型定义。
- `CanvasType` — 'article' | 'image-group'
- `ImageGroupLayout` — 固定版式枚举（portrait-cover-5inner / collage-cover-5inner / collage-cover-5collage）
- `CanvasImageGroup` — 单个图片组实体
- `CanvasImageGroupUsage` — image-group Canvas 使用状态（unused/partial/used + usedGroupIds/usedAt/usedByCanvasId）
- `CanvasCollageCell` — 拼图内单张源图的格子（imageId/url/x/y/width/height/objectFit）
- `CanvasCollageLayout` — 拼图画布格式（画布宽高 + 2-4 个源图格子），供编辑器把拼图拆成可换图的图层
- `CanvasGroupImage` — 图组内单张图片；封面可带 `editableBase` 原照片、`materials` 独立素材、封面文案元数据和拼图格式。
- `CanvasEditableCoverBase` — 合成预览对应的原始照片底图 | keywords: 可编辑封面底图, 图层分离, editable-cover-base, separated-layers
- `CanvasEditableMaterialLayer` — 保留透明素材、绿幕原图、坐标、特效参数及 `includesText` 文字融合标记的可编辑素材层 | keywords: 可编辑装饰素材, 图层分离, editable-decoration-material, separated-layers
- `CanvasImageGroupCreateInput` — 创建图片组入参（含可选 `dedup?: boolean` 去重开关，默认 true；`coverStrategy?: CanvasCoverStrategy` 封面策略，默认 ai-direct）
- `CanvasCoverStrategy` — 封面生成策略：`ai-direct` 直接生成成品；`ai-overlay` 同时产出合成预览和照片/素材分层元数据 | keywords: 封面策略, 装饰素材叠加, cover-strategy, decoration-overlay
- `CanvasArticleEntity.sentAt` — 文章成功发送时间戳（null 表示未发送）
- `CanvasEntity.keywords` — 画布关键词（向量搜索/分类过滤）
- `CanvasEntity.embeddingVector` — 嵌入向量（语义相似度检索）
- **关键词**: entity, sent-at, keywords, embedding

### canvas.module.ts
Canvas模块定义，导入 GalleryModule。
- **关键词**: module
