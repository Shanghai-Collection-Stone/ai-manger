# AiCommander 模块

前端 AI 指挥台页面模块，包含多个子视图。

## 文件清单

### AiCommanderBento.jsx

AI 指挥官 Bento 风格主界面组件。负责底部主导航、顶部控制台、工具内部页全屏状态和各主 Tab 的常驻渲染；当工具页进入内部视图时隐藏顶部控制台与底部导航，并取消底部安全区占位。

- **关键词**: ai-commander-bento, full-screen-tools
- **函数**:
  - `AiCommanderBento()` — 渲染 AI 指挥官主壳并控制工具内部页全屏导航隐藏 | keywords: ai-commander-bento, full-screen-tools

### ChatBIView.jsx

AI 对话交互主视图。支持 canvas-it、task-it、decision-it、**tag-select-it**、**handoff-it** 内联卡片（含异步轮询/详情 Modal/选标签弹窗/supervisor 路由切换胶囊）。底部输入区在 flex 流内占位，textarea 变高时消息列表自动让出高度，避免最后一段上下文被遮挡。`handleSend(overrideText?)` 接受可选参数,卡片回写时直接调用以用户消息形式发送 tags("我选定标签：#A #B")。

- **关键词**: chat, ai, bi, commander, stream, canvas-it, task-it, tag-select-it, handoff-it, supervisor, quick-message
- **函数**:
  - `extractAllCanvasItBlocks` / `extractAllTaskItBlocks` / `extractAllTagSelectBlocks` / `extractAllHandoffBlocks`: 从消息文本提取对应 fence JSON 块
  - `TagSelectCard`: tag 选择卡片(琥珀色徽章),展示标题/提示/推荐 chips 预览,点击触发 `TagSelectModal` 弹窗;确认后显示已选 chips 状态
  - `TagSelectModal`: 顶部搜索框 + 已选 chips + 内容区(无输入显示推荐计数 chips,有输入显示联想下拉),底部确认按钮校验 minTags/maxTags;`chatService.listGalleryTags` 拉全量 tags 用于联想
  - `HandoffCard`: 🆕 意图识别 → expert 路由胶囊。展示`→ 已切换至 {专家名} + reason 副标题`,6 个专家映射颜色(image/violet, article/sky, data/emerald, frontend/indigo, publisher/amber, task/rose)+ 图标；若后端 handoff-it 传入 `expertLabel/icon`,优先使用自定义展示名与图标（用于小红书专属专家）。后端意图识别路由到业务专家时通过 earlyEmit 推送 `\`\`\`handoff-it\`\`\`` fence 到主 SSE,前端即时渲染让用户感知到路由切换
  - `AIMessage`: 多卡片渲染,strip 四种 fence 后走 markdown;新增 `onSubmitQuickMessage(text)` prop 用于卡片向 AI 回写用户消息
  - `handleSend(overrideText?)`: 支持 override 参数,无 override 时取 inputValue;TagSelectCard 通过该回调把所选 tags 拼成自然语言消息发回 AI

### XhsSpecialistView.jsx

小红书专家页面。任务列表（按 category=xhs 过滤）、AI 对话、Canvas 列表、任务详情全屏页面（含任务信息/执行节点/小红书数据三个 Tab）。前端保留子专家下拉: `小红书专家` 主入口使用 `xhs-specialist` 并由后端 supervisor 自动路由到小红书数据追踪/生文/生图/发文/任务/可视化专家；专业用户也可手动切到数据追踪/发文执行/生文专家/生图专家会话。

- **关键词**: xhs, specialist, subagent, task, xiaohongshu, chart, intent-routing
- **函数**:
  - `loadTasks`: 加载任务列表（主视图 category=xhs / 子代理按 assignee）
  - `handleTaskClick`: 打开任务详情
  - `handleCloseDetail`: 关闭详情页
  - `renderDetailInfo`: 任务信息 Tab
  - `renderDetailTimeline`: 执行节点时间轴 Tab
  - `renderTaskDetail`: 详情全屏页面入口

### XhsDataTab.jsx

小红书数据 Tab 组件，在任务详情中展示 xhs_post_stats。

- **关键词**: xhs, data, tab, chart, table, post-stats, trend
- **函数**:
  - `BarChartSVG`: 最近N条数据柱状对比图（纯SVG）
  - `TrendChartSVG`: 按 postHash 聚合的文章趋势折线图（纯SVG）

### TaskDetailPage.jsx

通用任务详情页面。

- **关键词**: task, detail, page, timeline, info

### ToolsView.jsx

工具入口页。包含 AI 图库(GalleryView)、思维链路、Canvas管理、小红书专家、文章库、精选文章入口。Canvas管理支持类型过滤(图文/图组)、标签筛选、无限滚动分页、缩略图卡片展示，点击打开 CanvasFeedView(图文) 或 ImageGroupCanvasView(图组) 内部覆盖层。GalleryView 顶栏提供"ZIP 导入"按钮,打开 [GalleryZipImportPanel](GalleryZipImportPanel.jsx) 右侧抽屉,任务完成后自动 reload 图库 / 分组 / 标签。GalleryView Header 采用**双行布局**(让操作元素呼吸开): 第一行=返回+4 tabs+(右)上传主按钮 / batch 模式右侧显示"已选 N/M"; 第二行=标签筛选+上传标签输入(flex-1 自适应宽度)+批量选择+ZIP 导入按钮, batch 模式下整行替换为 全选/批量改标签(N)/退出。第二行 flex-wrap 容许窄屏自动换行,杜绝硬塞一行导致按钮被裁剪。

- **关键词**: tools, gallery, canvas, image-group, infinite-scroll, type-filter, tag-filter, thumbnail, article-library, featured-article, zip-import, responsive, icon-collapse
- **函数**:
  - `GalleryView`: 图库管理视图（含对话/图库/拼图/封面 Tab、ZIP 批量导入抽屉入口、单行响应式紧凑 Header）
  - `TagFilterDropdown`: 标签筛选下拉（窄屏 w-20 / 宽屏 w-28 自适应）
  - `ToolsView(onThoughtRouteChange?)` — 工具首页，子视图切换（list/gallery/thought/canvas/xhs-specialist/article-library/featured-article） | keywords: tools-view, tools, gallery, canvas, xhs-specialist, featured-article
  - `loadCanvases`: 加载 Canvas 列表，支持追加分页（append=true）、类型/标签过滤
- **api 对象新增 ZIP 导入方法**: `uploadGalleryZip`、`listGalleryZipImports`、`cancelGalleryZipImport`、`deleteGalleryZipImport`(对接 `/gallery/zip-import/*` 后端)

### CanvasFeedView.jsx

图文类型 Canvas 详情视图。展示文章列表与文章详情（含图片轮播和 ImageLightbox 点击放大）；头部提供"整份存入文章库"按钮，单篇详情提供"存入文章库"按钮，弹出 LibraryPickerDialog 选择目标库或新建。文章封面和详情轮播内页共用图片槽位重生成弹窗，可基于图库多选 + 提示词重新生成目标图片槽位，也可直接把已选图库图片设为当前封面/内页。

- **关键词**: canvas, article, feed, image, detail, store-into-library, cover-regenerate, cover-select, article-image-regenerate, image-slot-regenerate, article-image-select, image-slot-select, image-lightbox
- **函数**:
  - `ImageLightbox`: 图文 Canvas 图片放大预览弹窗，支持左右切换和缩略图定位
  - `openArticleImageLightbox`: 打开当前文章图片放大预览
  - `toLibraryPayload`: canvas 文章 → 文章库入库 payload
  - `handleStoreInto`: 执行入库（整份 / 单篇）
  - `openArticleImageRegenerateDialog`: 打开文章指定图片槽位重生成弹窗，imageIndex=0 为封面、1+ 为内页
  - `handleRegenerateArticleImage`: 调用文章指定图片槽位重生成接口，成功响应时 Canvas 已进入 generating
  - `handleSelectArticleImage`: 直接将弹窗中第一张已选图库图片替换到当前文章指定图片槽位
  - `handleCanvasTouchStart` / `handleCanvasTouchMove` / `handleCanvasTouchEnd`: 阻断 Canvas 详情层横向手势冒泡，避免图片滑动误触发外层切换
  - `LibraryPickerDialog`: 文章库选择器弹窗（支持即时新建）

### CoverRegenerateDialog.jsx

Canvas 图片槽位重生成弹窗。进入后拉取图库图片和图库标签，支持按 tag 筛选图片、最多 4 张参考图与多行本次提示词；封面与内页共用同一组件，可把多张图片 ID 合并成一次重生成请求，也可把第一张已选图直接设为目标图片槽位。

- **关键词**: cover-regenerate, cover-select, image-slot-regenerate, selected-source-images, tag-filter, cover-only-submit
- **函数**:
  - `readGalleryImageUrl`: 读取图库图片缩略图或原图地址
  - `normalizeGalleryImages`: 规整图库列表并过滤无效图片
  - `normalizeGalleryTags`: 规整图库标签列表，兼容字符串和带 count 的对象结构
  - `CoverRegenerateDialog`: 图片槽位重生成弹窗组件，封面和内页都使用本次提示词并最多选择 4 张参考图
  - `loadImages`: 拉取可作为参考图的图库图片
  - `loadTags`: 拉取图库标签用于封面图片筛选
  - `toggleImage`: 切换参考图选中状态，最多保留 4 张参考图
  - `handleDialogTouchStart` / `handleDialogTouchMove` / `handleDialogTouchEnd`: 阻断弹窗横向滑动冒泡，避免外层 Canvas 被左右滑开
  - `handleSubmit`: 提交 `{ imageIds, prompt }`，其中 imageIds 最多 4 个且 prompt 为本次输入
  - `handleSelectCover`: 提交 `{ imageId, imageIds }`，将第一张已选图库图片直接设为封面

### ImageGroupCanvasView.jsx

图片组类型 Canvas 详情视图。展示图片组版式与图片预览（ImageLightbox），识别全拼图版式 collage-cover-5collage；每张 role=cover/inner-1~5 图片右上角共用同一个重生成入口，提交后可重新生成目标图片槽位或直接使用已选图库图片替换该槽位。

- **关键词**: canvas, image-group, layout, lightbox, preview, cover-regenerate, cover-select, image-slot-regenerate
- **函数**:
  - `openGroupImageRegenerateDialog`: 打开图片组指定图片槽位重生成弹窗
  - `handleRegenerateGroupImage`: 调用图片组指定 role 重生成接口，成功响应后使用后端返回的 generating Canvas
  - `handleSelectGroupImage`: 直接将弹窗中第一张已选图库图片替换到当前图组指定 role 槽位
  - `handleCanvasTouchStart` / `handleCanvasTouchMove` / `handleCanvasTouchEnd`: 阻断图组详情层横向手势冒泡，避免图片滑动误触发外层切换

### ArticleLibraryView.jsx

文章库工具主视图。库列表网格（2×2 缩略图拼合，展示已发布/总数/占用中）+ 详情页（文章 / 基础信息 / 推送二维码 三个 Tab），支持刷新实时统计。

- **关键词**: article-library, grid, thumbnail-mosaic, tabs, push-config, queue, qrcode, occupied-count, refresh
- **函数**:
  - `ThumbnailMosaic`: 2×2 缩略图网格
  - `LibraryFormDialog`: 新建/编辑库弹窗
  - `BasicInfoTab`: 基础信息 Tab（名称/类型）
  - `PushConfigTab`: 推送二维码 Tab（取文范围说明 + 数据历史 + 占用中统计 + SVG 二维码）
  - `ArticleListTab`: 文章列表 Tab（状态切换、发布状态切换、占用中标识、删除）
  - `LibraryDetailView`: 库详情页
  - `ArticleLibraryView`: 文章库主入口

### FeaturedArticleView.jsx

精选文章工具主视图。先展示全屏工作区选择，工作区卡片显示名称和文章数量；进入后左侧是更宽的小红书帖子式缩略页列表：封面图占满卡片、底部显示标题、右上角提供删除图标；右侧按"选题 → 图片选择 → 标题 → 正文内容 → 保存/存入文章库"纵向组织且内容区占满可用宽度。图片选择使用固定小格宫格，点击格子可放大预览，也可弹窗复用图库图片与 tag 筛选，支持多选、直接用图、本地拼图预览和 AI 提示词草稿；选题重选打开 AI 对话式弹窗，输入方向后返回候选选题；存入文章库弹窗支持选择已有库或新建库。

- **关键词**: featured-article, workspace-picker, workspace-editor, article-page, image-picker-dialog, gallery-image-select, image-tag-filter, collage-preview, markdown-toolbar, ai-title-draft, ai-body-draft, ai-image-prompt, selected-image-apply, image-slot-size, image-grid-cell, image-lightbox, slide-page-list, workspace-storage, topic-selector, topic-dialog, ai-topic-options, library-picker, store-into-library
- **函数**:
  - `FEATURED_IMAGE_SLOT_SIZE({ width, height })` — 精选文章图片槽位固定尺寸参数 | keywords: featured-article, image-slot-size
  - `FEATURED_IMAGE_GRID_CELL_SIZE({ width, height })` — 精选文章图片宫格单元格固定尺寸 | keywords: featured-article, image-grid-cell
  - `buildFeaturedTopicOptions(input, workspace)` — 根据用户输入和工作区生成 AI 选题候选项 | keywords: featured-article, ai-topic-options
  - `readFeaturedGalleryImageUrl(image)` — 读取图库图片缩略图或原图地址 | keywords: featured-article, gallery-image-select
  - `normalizeFeaturedGalleryImages(value)` — 规整弹窗图库图片并过滤无效项 | keywords: featured-article, gallery-image-select
  - `normalizeFeaturedGalleryTags(value)` — 规整弹窗图库标签列表 | keywords: featured-article, image-tag-filter
  - `createFeaturedPage(index)` — 创建一个空白精选文章页面 | keywords: featured-article, article-page
  - `createDefaultFeaturedWorkspaces()` — 返回空工作区兜底数据，避免生成默认演示工作区 | keywords: featured-article, workspace-picker
  - `isLegacyDefaultWorkspace(workspace)` — 判断并清理旧版本内置默认工作区 | keywords: featured-article, workspace-storage
  - `normalizeFeaturedWorkspace(workspace)` — 规整后端或本地缓存返回的精选文章工作区 | keywords: featured-article, workspace-storage
  - `loadFeaturedWorkspaces()` — 从浏览器本地缓存读取工作区 | keywords: featured-article, workspace-storage
  - `saveFeaturedWorkspaces(workspaces)` — 将工作区写入浏览器本地缓存 | keywords: featured-article, workspace-storage
  - `countFeaturedWorkspaceArticles(workspace)` — 统计工作区文章数量 | keywords: featured-article, workspace-picker
  - `buildFeaturedTitleDraft(page, workspace)` — 生成标题 AI 草稿 | keywords: featured-article, ai-title-draft
  - `buildFeaturedBodyDraft(page, workspace)` — 生成正文 AI 草稿 | keywords: featured-article, ai-body-draft
  - `buildFeaturedImagePrompt(page, workspace)` — 生成图片提示词 AI 草稿 | keywords: featured-article, ai-image-prompt
  - `buildFeaturedArticleLibraryPayload(page, workspace)` — 将当前页面转换为文章库入库 payload | keywords: featured-article, store-into-library
  - `insertTextAtCursor(input)` — 在正文光标位置插入 Markdown 或 Emoji | keywords: featured-article, markdown-toolbar
  - `loadFeaturedImageElement(src)` — 加载可绘制到 Canvas 的图片元素 | keywords: featured-article, collage-preview
  - `createFeaturedCollagePreview(images)` — 将多张图库图片合成本地拼图预览 | keywords: featured-article, collage-preview
  - `FeaturedImagePickerDialog(props)` — 图片选择弹窗组件 | keywords: featured-article, image-picker-dialog
  - `loadImages(tag)` — 拉取弹窗内可选择图库图片 | keywords: featured-article, gallery-image-select
  - `loadTags()` — 拉取弹窗内图库标签 | keywords: featured-article, image-tag-filter
  - `toggleImage(imageId)` — 切换弹窗图片多选状态 | keywords: featured-article, gallery-image-select
  - `handleUseSelected()` — 将已选图片直接写入图片槽位 | keywords: featured-article, selected-image-apply
  - `handleGeneratePrompt()` — 触发当前页面图片提示词草稿生成 | keywords: featured-article, ai-image-prompt
  - `handleCreateCollage()` — 将已选图片生成拼图预览 | keywords: featured-article, collage-preview
  - `FeaturedTopicDialog(props)` — AI 对话式选题重选弹窗 | keywords: featured-article, topic-dialog
  - `handleAskAi()` — 根据输入刷新 AI 候选选题 | keywords: featured-article, ai-topic-options
  - `handlePickTopic(topic)` — 选中 AI 返回的候选选题 | keywords: featured-article, topic-selector
  - `FeaturedLibraryPickerDialog(props)` — 存入文章库的库选择弹窗 | keywords: featured-article, library-picker
  - `loadLibraries()` — 加载可存入的文章库列表 | keywords: featured-article, library-picker
  - `handleCreateLibrary()` — 新建文章库并存入当前精选文章 | keywords: featured-article, store-into-library
  - `FeaturedArticleView(props)` — 精选文章工具主组件 | keywords: featured-article, workspace-editor
  - `handleSelectWorkspace(workspaceId)` — 进入指定工作区并定位第一页 | keywords: featured-article, workspace-picker
  - `handleBackToWorkspaces()` — 返回工作区选择页 | keywords: featured-article, workspace-picker
  - `updateCurrentPage(patch)` — 更新当前精选文章页面字段 | keywords: featured-article, article-page
  - `handleAddPage()` — 在当前工作区新增页面 | keywords: featured-article, article-page
  - `handleSelectPage(pageId)` — 选中左侧缩略页 | keywords: featured-article, slide-page-list
  - `handleDeletePage(pageId)` — 删除左侧缩略页并切换当前选中页 | keywords: featured-article, slide-page-list
  - `handleSelectTopic(topic)` — 更新当前页面选题 | keywords: featured-article, topic-selector
  - `handleOpenTopicDialog()` — 打开 AI 选题重选弹窗 | keywords: featured-article, topic-dialog
  - `handleInsertMarkdown(value, suffix)` — 向正文编辑区插入 Markdown 或 Emoji | keywords: featured-article, markdown-toolbar
  - `handleAiTitle()` — 写入标题 AI 草稿 | keywords: featured-article, ai-title-draft
  - `handleAiBody()` — 写入正文 AI 草稿 | keywords: featured-article, ai-body-draft
  - `handleAiImagePrompt()` — 写入图片提示词 AI 草稿 | keywords: featured-article, ai-image-prompt
  - `handleApplySelectedImages(images)` — 应用弹窗直接选择的图库图片 | keywords: featured-article, selected-image-apply
  - `handleApplyCollageImage(input)` — 应用弹窗生成的拼图预览 | keywords: featured-article, collage-preview
  - `handleRemoveImage(imageId)` — 从当前页面图片列表移除指定图片 | keywords: featured-article, selected-image-apply
  - `handleOpenImagePreview(image)` — 打开精选文章图片放大预览层 | keywords: featured-article, image-lightbox
  - `handleCloseImagePreview()` — 关闭精选文章图片放大预览层 | keywords: featured-article, image-lightbox
  - `handleSavePage()` — 保存当前精选文章草稿到后端工作区页面 | keywords: featured-article, workspace-storage
  - `handleOpenLibraryDialog()` — 打开文章库选择弹窗准备入库 | keywords: featured-article, store-into-library
  - `handleStoreIntoLibrary(libraryId)` — 将当前精选文章存入指定文章库 | keywords: featured-article, store-into-library
  - `handleCreateWorkspace()` — 新建空的精选文章工作区 | keywords: featured-article, workspace-picker
- **关键词索引**:
  - `featured-article` / 精选文章
  - `workspace-picker` / 工作区选择
  - `workspace-editor` / 工作区编辑器
  - `article-page` / 文章页面
  - `image-picker-dialog` / 图片选择弹窗
  - `gallery-image-select` / 图库选图
  - `image-tag-filter` / 图片标签筛选
  - `collage-preview` / 拼图预览
  - `markdown-toolbar` / Markdown 工具条
  - `ai-title-draft` / AI 标题草稿
  - `ai-body-draft` / AI 正文草稿
  - `ai-image-prompt` / AI 图片提示词
  - `selected-image-apply` / 选图应用
  - `image-slot-size` / 图片槽位尺寸
  - `image-grid-cell` / 图片宫格单元
  - `image-lightbox` / 图片放大预览
  - `slide-page-list` / 缩略页列表
  - `workspace-storage` / 工作区缓存
  - `topic-selector` / 选题选择
  - `topic-dialog` / 选题弹窗
  - `ai-topic-options` / AI 选题候选
  - `library-picker` / 文章库选择
  - `store-into-library` / 存入文章库

### featuredArticleService.js

精选文章前端 API client，对接 `/api/featured-article` 工作区、页面和存入文章库接口。
- **关键词**: featured-article, api-client, workspace-picker, workspace-editor, article-page, slide-page-list, store-into-library
- **函数**:
  - `getAuthHeaders()` — 构建精选文章 API 登录态请求头 | keywords: featured-article, api-client
  - `request(path, options)` — 封装精选文章 JSON 请求和错误响应 | keywords: featured-article, api-client
  - `listWorkspaces(params)` — 列出精选文章工作区 | keywords: featured-article, workspace-picker
  - `createWorkspace(input)` — 新建精选文章工作区 | keywords: featured-article, workspace-picker
  - `getWorkspace(workspaceId)` — 获取单个精选文章工作区 | keywords: featured-article, workspace-editor
  - `updateWorkspace(workspaceId, patch)` — 更新精选文章工作区 | keywords: featured-article, workspace-editor
  - `deleteWorkspace(workspaceId)` — 删除精选文章工作区 | keywords: featured-article, workspace-editor
  - `createPage(workspaceId, page)` — 新建工作区页面 | keywords: featured-article, article-page
  - `updatePage(workspaceId, pageId, patch)` — 更新工作区页面 | keywords: featured-article, article-page
  - `deletePage(workspaceId, pageId)` — 删除工作区页面 | keywords: featured-article, slide-page-list
  - `storePageToLibrary(workspaceId, pageId, libraryId)` — 把精选文章页面存入文章库 | keywords: featured-article, store-into-library

### qrCodeSvg.js

浏览器端二维码 SVG 生成器。基于生产级 `qrcode` 库，输入后端返回的 `qrContent`，输出可直接嵌入页面的 SVG 字符串。

- **关键词**: qrcode, svg, production-library, article-library
- **函数**:
  - `createQrCodeSvg`: 将 JSON 字符串生成 SVG 二维码

### chatService.js

AI Commander 前端 API client，封装 Canvas、图库、会话等接口。

- **关键词**: api-client, canvas, gallery, cover-regenerate, article-image-regenerate, image-slot-regenerate
- **函数**:
  - `listGalleryTags`: 拉取图库标签列表，供封面重生成和标签选择弹窗筛选使用
  - `listGalleryImages`: 拉取图库图片列表，供封面重生成弹窗选择参考图
  - `regenerateCanvasArticleCover`: 调用图文 Canvas 单篇封面重生成接口
  - `selectCanvasArticleCover`: 调用图文 Canvas 单篇封面直接设图接口
  - `regenerateCanvasArticleImage`: 调用图文 Canvas 指定文章图片下标重生成接口 | keywords: article-image-regenerate, image-slot-regenerate
  - `selectCanvasArticleImage`: 调用图文 Canvas 指定文章图片下标直接设图接口 | keywords: article-image-select, image-slot-select
  - `regenerateCanvasImageGroupCover`: 调用图片组 Canvas 单组封面重生成接口
  - `selectCanvasImageGroupCover`: 调用图片组 Canvas 单组封面直接设图接口
  - `regenerateCanvasImageGroupImage`: 调用图片组 Canvas 指定 role 图片槽位重生成接口 | keywords: image-slot-regenerate, image-group-image-slot
  - `selectCanvasImageGroupImage`: 调用图片组 Canvas 指定 role 图片槽位直接设图接口 | keywords: image-slot-select, image-group-image-slot

### articleLibraryService.js

文章库前端 API client（对接 `/api/article-library` 系列接口）。

- **关键词**: article-library, api-client, fetch, bearer, crud, lease, qrcode
- **函数**:
  - `listLibraries` / `getLibrary` / `createLibrary` / `updateLibrary` / `deleteLibrary`: 库 CRUD
  - `getPushQr`: 获取二维码 payload 与 `qrContent`
  - `listArticles` / `putArticles` / `updateArticleStatus` / `deleteArticle`: 文章 CRUD + 状态更新
  - `leaseNext`: 管理端队列领取（测试用）

### GalleryZipImportPanel.jsx

图库 ZIP 批量导入右侧抽屉面板。包含上传表单(选 zip + 分组下拉 + 标签输入)和任务历史列表(2s 轮询拉 `/gallery/zip-import/list`,展示 status / stage / progress / 错误明细;可取消运行中、删除完成态)。完成态触发 `onCompleted` 通知外部刷新图库与分组。

- **关键词**: gallery-zip-import, drawer, multipart upload, polling, progress-bar, cancel, status-badge
- **函数**:
  - `GalleryZipImportPanel`: 主组件,props: `{ open, onClose, userId, groups, api, onCompleted }` /panel main entry
  - `JobCard`: 单条任务卡片(状态徽章 + 进度条 + 错误折叠)/job card with progress
  - `StatusBadge`: 状态徽章(进行中蓝 / 成功绿 / 失败红 / 取消灰)/status badge
  - `formatBytes` / `formatTime`: 显示格式化 helpers

### AntiDetectionView.jsx

图片去 AI 标识工具视图。支持拖拽 / 多选批量上传（≤20 张，单张 ≤20MB），可选**处理引擎**（浏览器本地 / 服务器）、强度档位 + 输出格式。浏览器模式逐张本地处理并显示进度；服务器模式单张走二进制接口、批量走 base64 JSON 接口。支持单张下载 / 全部下载（a.download 逐个触发）。

- **关键词**: anti-detection, remove-ai-fingerprint, upload, batch, drag-drop, download, engine-toggle, browser-local, server
- **函数**:
  - `handleAddFiles` / `handleDrop` / `handleInputChange`: 文件收集与过滤（类型 / 大小 / 数量）
  - `runBrowserProcess`: 浏览器逐张本地处理（带进度）
  - `runServerProcess`: 服务器处理（单张二进制 / 批量 base64）
  - `runProcess`: 按 engine 开关分流
  - `downloadOne` / `downloadAll`: 下载单张 / 全部结果
  - `AntiDetectionView`: 主组件

### antiDetectionService.js

图片去 AI 标识前端 API client + 工具函数。

- **关键词**: anti-detection, api-client, multipart, blob, base64, download
- **函数**:
  - `processSingle`: 单张接口，返回 Blob + headers 元信息
  - `processBatch`: 批量接口，返回 JSON
  - `base64ToBlob`: base64 → Blob
  - `downloadBlob`: 触发浏览器下载

### browserAntiDetection.js

浏览器端抗 AI 识别算法（纯 Canvas 实现，对齐后端 AntiDetectionService 5 层流水线）。不上传图片、不消耗服务器资源；EXIF/XMP/ICC 经 canvas.toBlob 天然剥离；JPEG 编码用浏览器内置（无 mozjpeg）。

- **关键词**: browser, canvas, offscreen-canvas, anti-detection, gamma-lut, noise-svg, resample, no-upload
- **函数**:
  - `processInBrowser`: 主入口（解码 → resize → color ops → 噪点 → 编码）
  - `pickParams`: 与后端同口径的参数随机化
  - `applyColorOps`: gamma LUT + 亮度 + 线性近似饱和度
  - `buildNoiseSvg` / `loadSvgAsImage`: 噪点 SVG 构建与加载
  - `decodeImage` / `makeCanvas` / `canvasToBlob`: createImageBitmap / OffscreenCanvas 兼容封装
  - `resolveFinalFormat` / `deriveOutName`: 格式与文件名推导
