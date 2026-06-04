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

## 封面文案风格
- LLM 生成主标题（6-16汉字）+ 副标题（10-24汉字）
- 无黑色背景框，白色文字 + 黑色描边（paint-order:stroke）
- 主标题 ~41% 高度，副标题 ~54% 高度

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
- `createImageGroupCanvas` — 创建图片组 Canvas（异步生成，快速返回 ID）
- `generateImageGroupsForCanvas` — 在指定 canvasId 上复用图组生成逻辑并回写 imageGroups。**`append` 参数**: true=追加到现有图组(复用 Canvas 再生成新图组,xhs hasCanvasId 分支传 true);false/缺省=覆盖(新建 Canvas 首次生成,runImageGroupGeneration)
- `startArticleCoverRegeneration(input)` — 启动图文 Canvas 单篇封面重生成，立即置为 generating，后台仅替换 article.imageUrls/imageIds 的首项，参考图最多 4 张 | keywords: cover-regenerate, article-cover-only
- `startArticleImageRegeneration(input)` — 启动图文 Canvas 单篇文章指定图片槽位重生成，立即置为 generating，后台仅替换目标 imageUrls/imageIds 下标，参考图最多 4 张 | keywords: article-image-regenerate, image-slot-regenerate
- `startImageGroupCoverRegeneration(input)` — 启动图片组 Canvas 单组封面重生成，立即置为 generating，后台仅替换目标组 role=cover 图片，参考图最多 4 张 | keywords: cover-regenerate, image-group-cover-only
- `startImageGroupImageRegeneration(input)` — 启动图片组 Canvas 指定图片槽位重生成，立即置为 generating，后台仅替换目标组对应 role 图片，参考图最多 4 张 | keywords: image-slot-regenerate, image-group-image-slot
- `selectArticleCoverImage(input)` — 直接用图库图片替换图文 Canvas 单篇文章首图封面，不进入生成中状态 | keywords: cover-select, article-cover-only
- `selectArticleImage(input)` — 直接用图库图片替换图文 Canvas 单篇文章指定图片槽位，不进入生成中状态 | keywords: article-image-select, image-slot-select
- `selectImageGroupCoverImage(input)` — 直接用图库图片替换图组 Canvas 指定图组 role=cover 图片，不修改其他内页图 | keywords: cover-select, image-group-cover-only
- `selectImageGroupImage(input)` — 直接用图库图片替换图组 Canvas 指定 role 图片，不修改其他图片槽位 | keywords: image-slot-select, image-group-image-slot
- `normalizeCoverSourceIds(imageIds)` — 归一化图片槽位重生成素材图片 ID，去重并限制最多 4 张 | keywords: cover-regenerate, selected-source-images
- `loadSelectedCoverImage(input)` — 精确读取直接设封面所选的第一张当前租户可见图库图片 | keywords: cover-select, selected-cover-image
- `resolveGalleryImageUrl(image)` — 从图库图片解析可写回 Canvas 的原图或缩略图地址 | keywords: cover-select, selected-cover-image
- `toSelectedCoverGroupImage(image, currentCover?, articleTitle?)` — 将图库图片转换成图组 Canvas role=cover 图片结构并沿用原封面文案 | keywords: cover-select, image-group-cover-only
- `toSelectedGroupImage(image, role, currentImage?, articleTitle?)` — 将图库图片转换成图组 Canvas 指定 role 图片结构，封面会沿用原文案 | keywords: image-slot-select, image-group-image-slot
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
- `prepareImageGroupsForCanvas(input)` — 只准备指定 Canvas 的图片组源图分配，不生成封面/拼图文件，用于图文生成前置不足量拦截 | keywords: prepare, allocation, canvas
- `renderPreparedImageGroupsForCanvas(input)` — 根据预分配结果渲染图片组并回写 Canvas | keywords: render, prepared, image-group
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
- `regenerateCoverImage(input)` — 基于用户本次多选的最多 4 张图库图片一次性生成新的 3:4 Canvas 封面，不复用旧封面提示词/旧封面文案，写入动态封面图库 | keywords: cover-regenerate, selected-source-images
- `regenerateInnerImage(input)` — 基于用户本次多选的最多 4 张图库图片一次性生成新的 3:4 Canvas 内页，不复用旧内页提示词/旧内页文字，不添加封面标题并写入动态内页图库 | keywords: inner-regenerate, image-group-image-slot
- `prepareImageGroupSources(input)` — 只做图片组源图准备：统一取图、统一分配竖图/横图，不生成 AI 封面、带文封面或拼图文件 | keywords: prepare, source-allocation, no-render
- `renderPreparedImageGroups(input, preparation)` — 根据已完成的源图分配渲染图组；并发数由 `IMAGE_GROUP_RENDER_CONCURRENCY` 环境变量控制（默认 1） | keywords: render, prepared, image-group, concurrency
- `renderOnePlan(plan, input, preparation)` — 渲染单个图组计划（封面/内页/文案/AI封面/烧字），供并发调用 | keywords: render, single-plan, image-group, cover-text
- `planImageGroupAllocation(pool, articles)` — 在 Canvas 级一次性规划所有图组 source 图片，按版式统计竖图/横图需求，禁止跨组复用；自动版式可在竖图不足时切到全拼图版式 | keywords: plan, allocation, no-reuse
- `buildImageGroupAllocationRequests(articles, options?)` — 根据文章列表生成图组版式槽位需求，支持自动版式覆盖 | keywords: plan, allocation, layout
- `summarizeImageGroupAllocationStats(requestedGroups, availablePortrait, availableLandscape)` — 统计分配所需竖图/横图数量与素材缺口 | keywords: stats, allocation, shortage
- `allocateRequestedImageGroups(requestedGroups, portraitPool, landscapePool, stats)` — 按确认槽位实际领取源图并保证 Canvas 内不复用 | keywords: allocate, no-reuse, image-group
- `buildInsufficientImageGroups(articles)` — 构造图片不足时的 failed 空图组，供文章/Canvas 进入 requires_human 补图流程 | keywords: insufficient, requires-human, image-group
- `collectPlanSourceImages(plan)` — 收集图组分配计划中的全部源图，用于文章正文和封面文案共享图片语义 | keywords: collect, allocation, image-context
- `persistPlannedCollage(input)` — 将统一分配好的两张横图合成为动态拼图并入库 | keywords: collage, allocation, gallery
- `generateCoverTexts` — LLM 批量生成封面主/副标题（{title, subtitle}[]），内部 LLM 调用附加 `nostream`，避免跟随主 SSE token 流 | keywords: 封面文案, 工具内部非流, cover-text, internal-llm-nostream
- `isAiCoverEnabled` — 读取租户平台配置中的 AI 封面开关
- `sanitizeCopyrightRiskText(raw)` — 将封面文案/生图提示中的高风险 IP、商标和角色专名替换为版权安全泛化表达 | keywords: sanitize, copyright-safe, image-prompt
- `sanitizeCopyrightRiskList(items?)` — 清洗列表型封面上下文，去重后返回版权安全表达 | keywords: sanitize, copyright-safe, list
- `sanitizeCoverText(coverText)` — 清洗封面主副标题，避免可见文案携带 IP/商标专名 | keywords: sanitize, cover-copy, copyright-safe
- `buildAiCoverPrompt` — 构建封面元信息骨架（选题/文章标题/封面主/副标题/封面版式）+ 实景照片优先的封面视觉指令，限制动画化、漫画化、密集贴纸和夸张特效；通用图生图硬约束由 AgentService.buildMeituEditPrompt 在下游补齐
- `tryGenerateAiCoverToGallery` — 调用封面生图工具生成封面并写入图库（透传prompt与底图候选，meitu兜底走image-edit）
- `fetchImagePool` — tag匹配取图（过滤默认动态封面/动态拼图分组）。**已移除"不足时补随机/相近标签"逻辑**,只严格按 tags 取池,不足由上游工具预检+用户决策
- `shuffleArray` — Fisher-Yates 洗牌打乱图片池顺序，避免封面/内页顺序性重复
- `pickPortrait` — 从池中选竖图（必须全局未使用；不跨组复用，不降级为横图）
- `pickAndMakeCollage` — 仅选 2 张全局未使用横图动态合成拼图（上下拼，640x853，等比缩放不裁切；不跨组复用，不降级为竖图/任意方向）
- `createDynamicCollageFile` — 动态合成双图拼图（使用 sharp）
- `persistGeneratedAssetToGallery` — 将动态封面/拼图/内页文件写入 gallery_images（返回真实 imageId，避免 id=0 虚拟图）
- `resolveGeneratedUploadFileInfo` / `getImageDimensionsFromAbsPath` — 解析生成文件路径并补齐宽高元数据
- `burnCoverText` — 使用 sharp+SVG 将主副标题烧录到封面图（无背景框，白色描边文字）
- `loadCoverFontFaceCss` — 加载封面字体 base64 缓存（支持 public/dist/web 三条路径）
- `ensureFontconfigSetup` — 写入 /tmp/cover-fonts 并设置 FONTCONFIG_FILE，解决 Alpine/Linux 无字体问题
- `toGroupImage` — 图库实体转图组图片（含封面主/副标题）
- **关键词**: image-group, layout, tag-match, gallery, collage, font, linux-compat

### canvas.entity.ts
Canvas实体，含新类型定义。
- `CanvasType` — 'article' | 'image-group'
- `ImageGroupLayout` — 固定版式枚举（portrait-cover-5inner / collage-cover-5inner / collage-cover-5collage）
- `CanvasImageGroup` — 单个图片组实体
- `CanvasImageGroupUsage` — image-group Canvas 使用状态（unused/partial/used + usedGroupIds/usedAt/usedByCanvasId）
- `CanvasGroupImage` — 图组内单张图片（含版式角色 cover/inner-1~5、主副标题 text/subtitle）
- `CanvasImageGroupCreateInput` — 创建图片组入参
- `CanvasArticleEntity.sentAt` — 文章成功发送时间戳（null 表示未发送）
- `CanvasEntity.keywords` — 画布关键词（向量搜索/分类过滤）
- `CanvasEntity.embeddingVector` — 嵌入向量（语义相似度检索）
- **关键词**: entity, sent-at, keywords, embedding

### canvas.module.ts
Canvas模块定义，导入 GalleryModule。
- **关键词**: module
