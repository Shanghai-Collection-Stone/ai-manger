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
工具入口页。包含 AI 图库(GalleryView)、思维链路、Canvas管理、小红书专家入口四大模块。Canvas管理支持类型过滤(图文/图组)、标签筛选、无限滚动分页、缩略图卡片展示，点击打开 CanvasFeedView(图文) 或 ImageGroupCanvasView(图组) 内部覆盖层。
- **关键词**: tools, gallery, canvas, image-group, infinite-scroll, type-filter, tag-filter, thumbnail
- **函数**:
  - `GalleryView`: 图库管理视图（含对话/图库/拼图/封面 Tab）
  - `ToolsView`: 工具首页，子视图切换（list/gallery/thought/canvas/xhs-specialist）
  - `loadCanvases`: 加载 Canvas 列表，支持追加分页（append=true）、类型/标签过滤

### CanvasFeedView.jsx
图文类型 Canvas 详情视图。展示文章列表与文章详情（含图片轮播）。
- **关键词**: canvas, article, feed, image, detail

### ImageGroupCanvasView.jsx
图片组类型 Canvas 详情视图。展示图片组版式与图片预览（ImageLightbox）。
- **关键词**: canvas, image-group, layout, lightbox, preview
