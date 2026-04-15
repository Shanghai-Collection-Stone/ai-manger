# AiCommander 模块

前端 AI 指挥台页面模块，包含多个子视图。

## 文件清单

### ChatBIView.jsx
AI 对话交互主视图。
- **关键词**: chat, ai, bi, commander, stream

### XhsSpecialistView.jsx
小红书专家页面。任务列表（按 category=xhs 过滤）、子代理管理、AI 对话、任务详情全屏页面（含任务信息/执行节点/小红书数据三个 Tab）。
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
