# AiCommander 模块

前端 AI 指挥台页面模块，包含多个子视图。

## 文件清单

### ChatBIView.jsx
AI 对话交互主视图。支持 canvas-it、task-it、decision-it 内联卡片（含异步轮询/详情 Modal）。
- **关键词**: chat, ai, bi, commander, stream, canvas-it, task-it

### XhsSpecialistView.jsx
小红书专家页面。任务列表（按 category=xhs 过滤）、子代理管理（主专家/数据追踪/发文执行/生文专家/生图专家）、AI 对话、任务详情全屏页面（含任务信息/执行节点/小红书数据三个 Tab）。
- **子代理列表**: main(小红书专家), tracker(数据追踪), publish(发文执行), article-expert(生文专家), image-expert(生图专家)
- **关键词**: xhs, specialist, subagent, task, xiaohongshu, chart
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
工具入口页。包含 AI 图库(GalleryView)、思维链路、Canvas管理、小红书专家、文章库入口五大模块。Canvas管理支持类型过滤(图文/图组)、标签筛选、无限滚动分页、缩略图卡片展示，点击打开 CanvasFeedView(图文) 或 ImageGroupCanvasView(图组) 内部覆盖层。
- **关键词**: tools, gallery, canvas, image-group, infinite-scroll, type-filter, tag-filter, thumbnail, article-library
- **函数**:
  - `GalleryView`: 图库管理视图（含对话/图库/拼图/封面 Tab）
  - `ToolsView`: 工具首页，子视图切换（list/gallery/thought/canvas/xhs-specialist/article-library）
  - `loadCanvases`: 加载 Canvas 列表，支持追加分页（append=true）、类型/标签过滤

### CanvasFeedView.jsx
图文类型 Canvas 详情视图。展示文章列表与文章详情（含图片轮播）；头部提供"整份存入文章库"按钮，单篇详情提供"存入文章库"按钮，弹出 LibraryPickerDialog 选择目标库或新建。
- **关键词**: canvas, article, feed, image, detail, store-into-library
- **函数**:
  - `toLibraryPayload`: canvas 文章 → 文章库入库 payload
  - `handleStoreInto`: 执行入库（整份 / 单篇）
  - `LibraryPickerDialog`: 文章库选择器弹窗（支持即时新建）

### ImageGroupCanvasView.jsx
图片组类型 Canvas 详情视图。展示图片组版式与图片预览（ImageLightbox）。
- **关键词**: canvas, image-group, layout, lightbox, preview

### ArticleLibraryView.jsx
文章库工具主视图。库列表网格（2×2 缩略图拼合）+ 详情页（文章 / 基础信息 / 推送二维码 三个 Tab）。
- **关键词**: article-library, grid, thumbnail-mosaic, tabs, push-config, status-filter, queue
- **函数**:
  - `ThumbnailMosaic`: 2×2 缩略图网格
  - `LibraryFormDialog`: 新建/编辑库弹窗
  - `BasicInfoTab`: 基础信息 Tab（名称/类型）
  - `PushConfigTab`: 推送二维码 Tab（状态多选 + 数据历史 + 二维码占位 + "已发布/总数"）
  - `ArticleListTab`: 文章列表 Tab（状态切换、发布状态切换、删除）
  - `LibraryDetailView`: 库详情页
  - `ArticleLibraryView`: 文章库主入口

### articleLibraryService.js
文章库前端 API client（对接 `/api/article-library` 系列接口）。
- **关键词**: article-library, api-client, fetch, bearer, crud, lease
- **函数**:
  - `listLibraries` / `getLibrary` / `createLibrary` / `updateLibrary` / `deleteLibrary`: 库 CRUD
  - `listArticles` / `putArticles` / `updateArticleStatus` / `deleteArticle`: 文章 CRUD + 状态更新
  - `leaseNext`: 管理端队列领取（测试用）

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
