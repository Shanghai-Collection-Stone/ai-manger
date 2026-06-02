# AiCommander 模块

前端 AI 指挥台页面模块，包含多个子视图。

## 文件清单

### ChatBIView.jsx
AI 对话交互主视图。支持 canvas-it、task-it、decision-it、**tag-select-it**、**handoff-it** 内联卡片（含异步轮询/详情 Modal/选标签弹窗/supervisor 路由切换胶囊）。底部输入区在 flex 流内占位，textarea 变高时消息列表自动让出高度，避免最后一段上下文被遮挡。`handleSend(overrideText?)` 接受可选参数,卡片回写时直接调用以用户消息形式发送 tags("我选定标签：#A #B")。
- **关键词**: chat, ai, bi, commander, stream, canvas-it, task-it, tag-select-it, handoff-it, supervisor, quick-message
- **函数**:
  - `extractAllCanvasItBlocks` / `extractAllTaskItBlocks` / `extractAllTagSelectBlocks` / `extractAllHandoffBlocks`: 从消息文本提取对应 fence JSON 块
  - `TagSelectCard`: tag 选择卡片(琥珀色徽章),展示标题/提示/推荐 chips 预览,点击触发 `TagSelectModal` 弹窗;确认后显示已选 chips 状态
  - `TagSelectModal`: 顶部搜索框 + 已选 chips + 内容区(无输入显示推荐计数 chips,有输入显示联想下拉),底部确认按钮校验 minTags/maxTags;`chatService.listGalleryTags` 拉全量 tags 用于联想
  - `HandoffCard`: 🆕 意图识别 → expert 路由胶囊。展示`→ 已切换至 {专家名} + reason 副标题`,6 个专家映射颜色(image/violet, article/sky, data/emerald, frontend/indigo, publisher/amber, task/rose)+ emoji 图标(🎨/✍️/📊/📈/🚀/🗂️)。后端意图识别路由到业务专家时通过 earlyEmit 推送 `\`\`\`handoff-it\`\`\`` fence 到主 SSE,前端即时渲染让用户感知到路由切换
  - `AIMessage`: 多卡片渲染,strip 四种 fence 后走 markdown;新增 `onSubmitQuickMessage(text)` prop 用于卡片向 AI 回写用户消息
  - `handleSend(overrideText?)`: 支持 override 参数,无 override 时取 inputValue;TagSelectCard 通过该回调把所选 tags 拼成自然语言消息发回 AI

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
工具入口页。包含 AI 图库(GalleryView)、思维链路、Canvas管理、小红书专家、文章库入口五大模块。Canvas管理支持类型过滤(图文/图组)、标签筛选、无限滚动分页、缩略图卡片展示，点击打开 CanvasFeedView(图文) 或 ImageGroupCanvasView(图组) 内部覆盖层。GalleryView 顶栏提供"ZIP 导入"按钮,打开 [GalleryZipImportPanel](GalleryZipImportPanel.jsx) 右侧抽屉,任务完成后自动 reload 图库 / 分组 / 标签。GalleryView Header 采用**双行布局**(让操作元素呼吸开): 第一行=返回+4 tabs+(右)上传主按钮 / batch 模式右侧显示"已选 N/M"; 第二行=标签筛选+上传标签输入(flex-1 自适应宽度)+批量选择+ZIP 导入按钮, batch 模式下整行替换为 全选/批量改标签(N)/退出。第二行 flex-wrap 容许窄屏自动换行,杜绝硬塞一行导致按钮被裁剪。
- **关键词**: tools, gallery, canvas, image-group, infinite-scroll, type-filter, tag-filter, thumbnail, article-library, zip-import, responsive, icon-collapse
- **函数**:
  - `GalleryView`: 图库管理视图（含对话/图库/拼图/封面 Tab、ZIP 批量导入抽屉入口、单行响应式紧凑 Header）
  - `TagFilterDropdown`: 标签筛选下拉（窄屏 w-20 / 宽屏 w-28 自适应）
  - `ToolsView`: 工具首页，子视图切换（list/gallery/thought/canvas/xhs-specialist/article-library）
  - `loadCanvases`: 加载 Canvas 列表，支持追加分页（append=true）、类型/标签过滤
- **api 对象新增 ZIP 导入方法**: `uploadGalleryZip`、`listGalleryZipImports`、`cancelGalleryZipImport`、`deleteGalleryZipImport`(对接 `/gallery/zip-import/*` 后端)

### CanvasFeedView.jsx
图文类型 Canvas 详情视图。展示文章列表与文章详情（含图片轮播和 ImageLightbox 点击放大）；头部提供"整份存入文章库"按钮，单篇详情提供"存入文章库"按钮，弹出 LibraryPickerDialog 选择目标库或新建。文章首图封面右上角提供重生成入口，打开图库多选 + 提示词弹窗后可重新生成封面或直接设为封面。
- **关键词**: canvas, article, feed, image, detail, store-into-library, cover-regenerate, cover-select, image-lightbox
- **函数**:
  - `ImageLightbox`: 图文 Canvas 图片放大预览弹窗，支持左右切换和缩略图定位
  - `openArticleImageLightbox`: 打开当前文章图片放大预览
  - `toLibraryPayload`: canvas 文章 → 文章库入库 payload
  - `handleStoreInto`: 执行入库（整份 / 单篇）
  - `openCoverRegenerateDialog`: 打开文章封面重生成弹窗并定位到首图预览
  - `handleRegenerateCover`: 调用文章封面重生成接口，成功后让 Canvas 进入 generating
  - `handleSelectCover`: 直接将弹窗中第一张已选图库图片设为当前文章封面
  - `handleCanvasTouchStart` / `handleCanvasTouchMove` / `handleCanvasTouchEnd`: 阻断 Canvas 详情层横向手势冒泡，避免图片滑动误触发外层切换
  - `LibraryPickerDialog`: 文章库选择器弹窗（支持即时新建）

### CoverRegenerateDialog.jsx
Canvas 封面重生成弹窗。进入后拉取图库图片和图库标签，支持按 tag 筛选图片、多选参考图与多行提示词；可把多张图片 ID 合并成一次封面重生成请求，也可把第一张已选图直接设为封面。
- **关键词**: cover-regenerate, cover-select, selected-source-images, tag-filter, cover-only-submit
- **函数**:
  - `readGalleryImageUrl`: 读取图库图片缩略图或原图地址
  - `normalizeGalleryImages`: 规整图库列表并过滤无效图片
  - `normalizeGalleryTags`: 规整图库标签列表，兼容字符串和带 count 的对象结构
  - `CoverRegenerateDialog`: 封面重生成弹窗组件
  - `loadImages`: 拉取可作为参考图的图库图片
  - `loadTags`: 拉取图库标签用于封面图片筛选
  - `toggleImage`: 切换参考图选中状态
  - `handleDialogTouchStart` / `handleDialogTouchMove` / `handleDialogTouchEnd`: 阻断弹窗横向滑动冒泡，避免外层 Canvas 被左右滑开
  - `handleSubmit`: 提交 `{ imageIds, prompt }`
  - `handleSelectCover`: 提交 `{ imageId, imageIds }`，将第一张已选图库图片直接设为封面

### ImageGroupCanvasView.jsx
图片组类型 Canvas 详情视图。展示图片组版式与图片预览（ImageLightbox），识别全拼图版式 collage-cover-5collage；每组 role=cover 图片右上角提供重生成入口，提交后可重新生成封面或直接使用已选图库图片替换目标图组封面。
- **关键词**: canvas, image-group, layout, lightbox, preview, cover-regenerate, cover-select
- **函数**:
  - `openGroupCoverRegenerateDialog`: 打开图片组封面重生成弹窗
  - `handleRegenerateGroupCover`: 调用图片组封面重生成接口，成功后让 Canvas 进入 generating
  - `handleSelectGroupCover`: 直接将弹窗中第一张已选图库图片设为当前图组封面
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

### qrCodeSvg.js
浏览器端二维码 SVG 生成器。基于生产级 `qrcode` 库，输入后端返回的 `qrContent`，输出可直接嵌入页面的 SVG 字符串。
- **关键词**: qrcode, svg, production-library, article-library
- **函数**:
  - `createQrCodeSvg`: 将 JSON 字符串生成 SVG 二维码

### chatService.js
AI Commander 前端 API client，封装 Canvas、图库、会话等接口。
- **关键词**: api-client, canvas, gallery, cover-regenerate
- **函数**:
  - `listGalleryTags`: 拉取图库标签列表，供封面重生成和标签选择弹窗筛选使用
  - `listGalleryImages`: 拉取图库图片列表，供封面重生成弹窗选择参考图
  - `regenerateCanvasArticleCover`: 调用图文 Canvas 单篇封面重生成接口
  - `selectCanvasArticleCover`: 调用图文 Canvas 单篇封面直接设图接口
  - `regenerateCanvasImageGroupCover`: 调用图片组 Canvas 单组封面重生成接口
  - `selectCanvasImageGroupCover`: 调用图片组 Canvas 单组封面直接设图接口

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
