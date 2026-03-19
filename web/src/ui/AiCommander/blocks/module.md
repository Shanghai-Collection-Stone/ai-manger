# blocks 模块

## 模块描述

看板 Block 组件库，提供 JSON 配置驱动的看板区块渲染能力。
每个 Block 类型对应一个 React 组件，通过 `BlockRegistry` 按 `block.type` 分发渲染。
分为两类：**预置平台 Block**（绑定 `/dashboard/*` 接口）和 **SaaS Mongo Block**（消费 `POST /mongo/query` 返回数据，支持客户端聚合）。
文件路径: `web/src/ui/AiCommander/blocks`

## 功能描述及关键词

### shared.jsx

共享基础组件：EChart 懒加载图表、LoadingBox、ErrorBox、ProgressBar、pieOption 生成器。

- `LoadingBox` — 加载占位框
- `ErrorBox` — 错误提示框
- `ProgressBar` — 进度条
- `pieOption` — 环形饼图 option 生成
- `EChart` — CDN 懒加载 ECharts 渲染组件
- `CARD` — 通用卡片样式常量

- **关键词**: shared, echart, loading, progress, pie, card-style

### BlockRegistry.jsx

所有 Block 组件定义 + 类型注册表 + BlockRenderer 分发器。

#### 预置平台 Block

- `AiProgressBlock` — AI 覆盖达成率进度条
- `RevenueOverviewBlock` — 营收总览卡片
- `StatCardBlock` — 通用统计卡片
- `PeopleTotalBlock` — 总计人数大数字卡片
- `PeoplePieBlock` — 人数分析饼图
- `DemandChannelPieBlock` — 渠道分布饼图
- `DemandTypePieBlock` — 需求类型饼图
- `DailyRevenuePeopleChartBlock` — 日营收人数趋势图
- `DailyDemandTrendBlock` — 每日需求趋势图
- `StaffDistributionBlock` — 客服接收占比
- `SalesRankingInlineBlock` — 销售榜内联版
- `ActivityTypeConversionBlock` — 活动类型成单率
- `ThemeRatioBlock` — 主题活动占比饼图
- `RoomRatioBlock` — 包厢占比饼图
- `ThemeRevenuePeopleChartBlock` — 主题收入人数图
- `RoomRevenuePeopleChartBlock` — 包厢收入人数图
- `SalesRankingBlock` — 销售榜完整版
- `CustomerTagCloudBlock` — 客户 TAG 词云
- `SalesRateGridBlock` — 人员成单率环形网格

#### SaaS Mongo 查询 Block

- `MongoCountCard` — Mongo 计数卡片（count 查询结果展示）
- `MongoSumCard` — Mongo 求和卡片（list 查询字段求和）
- `MongoRateCard` — Mongo 比率卡片（双 count 计算比率，依赖 dataMap）
- `MongoGroupPie` — Mongo 分组饼图（按字段分组计数）
- `MongoDailyTrend` — Mongo 日趋势折线图（按日期分组计数）
- `MongoDailyBar` — Mongo 日趋势柱状图（按日期分组，支持 sumField）
- `MongoRanking` — Mongo 排行榜（分组计数条形展示）
- `MongoRecentTable` — Mongo 最近记录表格（list 结果表格展示）

#### 核心导出

- `BLOCK_REGISTRY` — type → component 注册表
- `BlockRenderer` — 根据 block.type 分发渲染（支持 dataMap 透传）

- **关键词**: block-registry, renderer, ai_progress, revenue, stat, people, demand, chart, sales, tag-cloud, mongo, saas, count, sum, rate, pie, trend, ranking, table
