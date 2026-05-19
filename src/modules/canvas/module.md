# Canvas Module

## 模块描述
该模块基于MongoDB存储画布，支持两种 canvas 类型：
- **article**（默认）：图文拼盘，包含 articles 列表。
- **image-group**：图片组拼盘，根据文章 tag 批量匹配配图，按固定版式组合图组，异步生成。

文件路径: `src/modules/canvas`

## 固定版式（每组 6 张：1 封面 + 5 内页）
- **portrait-cover-5inner**: 1竖封面单图 + 5内页（拼图/竖图交替）
- **collage-cover-5inner**: 1横拼图封面 + 5竖内页单图

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
- `PATCH /canvas/:id/articles/:articleId/sent` — 标记文章已发送（写入 sentAt 时间戳）
- **关键词**: canvas, articles, image-group, outline, style, content-json, image-ids, status, sent-at, mongo, controller

### canvas.service.ts
Canvas服务。
- `create` — 创建图文 Canvas
- `createImageGroupCanvas` — 创建图片组 Canvas（异步生成，快速返回 ID）
- `generateImageGroupsForCanvas` — 在指定 canvasId 上复用图组生成逻辑并回写 imageGroups
- `runImageGroupGeneration` — 后台异步生成图片组并回写
- `updateImageGroups` — 回写图片组到 Canvas
- `get` / `list` / `addArticles` / `updateStatus` / `updateArticle` / `updateMeta` — 常用crud
- `list` — 支持 type / skip / tag 过滤 + skip 分页
- `markArticleSent` — 标记指定文章已发送（写入 sentAt），支持自定义时间
- **关键词**: service, image-group, async, sent-at, pagination

### canvas-image-group.service.ts
图片组生成服务。
- `generateImageGroups` — 根据文章 tag 严格匹配图库配图（**不再跨 tag 随机补图**），按版式分配图片组。**完成后调用 `gallery.markUsedBatch` 标记本批次所有源图为 isUsed=true,全局不再被默认查询命中**(由 [media-agent xhs 工具](../media-agent/module.md) 的 precheck 兜底拦截不足量场景)
- `generateCoverTexts` — LLM 批量生成封面主/副标题（{title, subtitle}[]）
- `isAiCoverEnabled` — 读取租户平台配置中的 AI 封面开关
- `buildAiCoverPrompt` — 构建封面元信息骨架（选题/文章标题/封面主/副标题/封面版式）+ 强化版封面视觉调性指令（13 条：风格定位/视觉张力/动画化改造/表情动作动画化/主体表达/动态视觉特效/装饰丰富度/色彩/光影质感/文案表现/构图/情绪锚定/严禁项），鼓励大胆改造与动画化重绘（2D 插画/3D Q版/港漫/手绘等），不调 LLM 推演主题；通用图生图硬约束由 AgentService.buildMeituEditPrompt 在下游补齐
- `tryGenerateAiCoverToGallery` — 调用封面生图工具生成封面并写入图库（透传prompt与底图候选，meitu兜底走image-edit）
- `fetchImagePool` — tag匹配取图（过滤默认动态封面/动态拼图分组）。**已移除"不足时补随机/相近标签"逻辑**,只严格按 tags 取池,不足由上游工具预检+用户决策
- `shuffleArray` — Fisher-Yates 洗牌打乱图片池顺序，避免封面/内页顺序性重复
- `pickPortrait` — 从池中选竖图（优先未使用，其次降级复用）
- `pickAndMakeCollage` — 选 2 张横图动态合成拼图（上下拼，640x853，等比缩放不裁切）
- `createDynamicCollageFile` — 动态合成双图拼图（使用 sharp）
- `persistGeneratedAssetToGallery` — 将动态封面/拼图文件写入 gallery_images（返回真实 imageId，避免 id=0 虚拟图）
- `resolveGeneratedUploadFileInfo` / `getImageDimensionsFromAbsPath` — 解析生成文件路径并补齐宽高元数据
- `burnCoverText` — 使用 sharp+SVG 将主副标题烧录到封面图（无背景框，白色描边文字）
- `loadCoverFontFaceCss` — 加载封面字体 base64 缓存（支持 public/dist/web 三条路径）
- `ensureFontconfigSetup` — 写入 /tmp/cover-fonts 并设置 FONTCONFIG_FILE，解决 Alpine/Linux 无字体问题
- `toGroupImage` — 图库实体转图组图片（含封面主/副标题）
- **关键词**: image-group, layout, tag-match, gallery, collage, font, linux-compat

### canvas.entity.ts
Canvas实体，含新类型定义。
- `CanvasType` — 'article' | 'image-group'
- `ImageGroupLayout` — 两种固定版式枚举（portrait-cover-5inner / collage-cover-5inner）
- `CanvasImageGroup` — 单个图片组实体
- `CanvasGroupImage` — 图组内单张图片（含版式角色 cover/inner-1~5、主副标题 text/subtitle）
- `CanvasImageGroupCreateInput` — 创建图片组入参
- `CanvasArticleEntity.sentAt` — 文章成功发送时间戳（null 表示未发送）
- `CanvasEntity.keywords` — 画布关键词（向量搜索/分类过滤）
- `CanvasEntity.embeddingVector` — 嵌入向量（语义相似度检索）
- **关键词**: entity, sent-at, keywords, embedding

### canvas.module.ts
Canvas模块定义，导入 GalleryModule。
- **关键词**: module

