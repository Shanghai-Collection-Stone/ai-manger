# AiCommander 模块

## 模块描述

该模块实现了 AI 指挥官的移动端 Bento UI 风格界面，包含仪表盘、决策流、AI 助理对话、任务中心及工具箱功能。
文件路径: `web/src/ui/AiCommander`

## 功能描述及关键词

### AiCommanderBento.jsx

AI 指挥官主界面容器，管理底部导航和视图切换。
底部菜单采用 "中间圆图标 + 左右两格" 布局，集成 AI 助理快捷入口。
支持左右滑动切换主标签页。

- **关键词**: AiCommanderBento, MainContainer, TabSwitch, BottomNavigation, SwipeNavigation

### DashboardView.jsx

仪表盘视图，自动加载后端 JSON 配置（`/dashboard-config/current`），按配置中的 Tabs + Blocks 网格渲染看板。
支持左右滑动切换看板子标签，所有区块通过 `blocks/BlockRegistry` 分发。

- **关键词**: DashboardView, JSON-config-driven, BentoGrid, TabNavigation, SwipeNavigation, useTabData

### dashboardApi.js

Dashboard 数据 API + 看板 JSON 配置获取接口 + 通用 Mongo 查询支持。

- `getRevenueOverview` — 营收总览（预置）
- `getDailyRevenue` — 日营收与人数（预置）
- `getPeopleStats` — 人数统计（预置）
- `getDemandChannel` — 需求与渠道（预置）
- `getEvents` — 活动与类型（预置）
- `getSales` — 销售与客户（预置）
- `getDashboardConfig` — 看板 JSON 配置
- `queryFetchers` — query key → 预置 fetcher 映射
- `timeRangeToWhere` — 中文时间范围 → Mongo Where DSL 转换
- `fetchMongoQuery` — 通用 Mongo 查询执行（消费 config.queries 定义）

- **关键词**: dashboardApi, dashboard-config, json, api, queryFetchers, mongo-query, timeRange, where-dsl

### blocks/

看板 Block 组件库子模块，详见 `blocks/module.md`。

- **关键词**: blocks, block-registry, shared, echart

### DecisionFeedView.jsx

决策流视图，展示待处理的 AI 决策建议卡片。目前包含空状态处理。

- **关键词**: DecisionFeedView, ActionCards, TaskList, EmptyState

### CanvasFeedView.jsx

Canvas 文章看板视图，支持按 canvasId 加载文章列表与详情，提供小红书风格文章卡片阅读体验。

- **关键词**: CanvasFeedView, canvas, article, xiaohongshu, detail, modal

### ChatBIView.jsx

AI 助理对话视图，提供自然语言数据查询和指令交互。支持按 `sessionType` 运行普通会话或思维链路会话。
支持在输入框上方显示“会话历史”按钮，并通过弹窗切换历史会话。

- **关键词**: ChatBIView, AIChat, DataQuery, RealtimeInteraction, SessionManagement, DrawerUI, thought-session, session-picker

### ThoughtRouteView.jsx

思维链路工具页，包含「对话」和「思维链表格管理」双Tab。
对话模式仅用于Schema理解和思维链生成，表格管理支持思维链增删改查。
页面头部使用轻量布局，不显示大标题区，仅保留返回操作与Tab切换。
表格管理在移动端改为卡片列表展示，在桌面端保留表格展示。

- **关键词**: ThoughtRouteView, thought-route, tab, schema, skill-thought, crud

### TaskCenterView.jsx

执行指挥中心视图，提供任务管理、派单和工单状态追踪。包含快捷调度入口和任务列表。

- 支持新建派单功能，通过模态框录入任务信息。
- 支持分类筛选功能，点击快捷入口可过滤任务列表。

- **关键词**: TaskCenterView, TaskManagement, WorkOrder, QuickActions, TabFilter, CreateTaskModal, CategoryFilter

### ToolsView.jsx

工具箱视图，集成 AI 图库与思维链路工具入口。
包含完整的 AI 图库管理功能：分组管理、图片上传、无限滚动加载、图片预览等。

- **关键词**: ToolsView, AIGallery, ThoughtRoute, ImageManagement, ToolBox, InfiniteScroll, FileUpload

### NavItem.jsx

底部导航栏按钮组件。

- **关键词**: NavItem, BottomNavigation

### chatService.js

封装 AI 聊天相关的 API 调用逻辑，包括会话创建、消息发送、历史记录获取以及远程会话列表管理，支持 `sessionType` 传递。

- **关键词**: ChatService, APIService, StreamChat, RemoteSessionManagement, sessionType

### store.js

AI Commander 全局状态管理，基于 nanostores 和 persistentAtom 实现状态持久化。

- **关键词**: store, nanostores, persistentAtom, GlobalState

### useSwipe.js

用于检测触摸滑动事件的 React Hook，支持左右滑动检测及防抖处理，优先响应水平滑动。

- **关键词**: useSwipe, TouchEvents, GestureDetection, Hook
