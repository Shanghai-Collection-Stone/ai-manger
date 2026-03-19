# 看板 JSON 配置规范（tabs + blocks + layout）

## 目标
- 看板内容配置化：一个租户一个 JSON 文件
- 配置可描述：
  - Tab 列表
  - Tab 内每个区块（block）的类型与数据来源
  - 网格布局：列数（cols）与 block 的 colSpan/rowSpan

## 核心结构
```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "AI Commander 看板（母平台）",
  "timeRanges": ["今天", "本周", "本月"],
  "tabs": [
    {
      "id": "overview",
      "label": "总览",
      "keywordEn": "overview",
      "layout": { "cols": 2, "gap": 16 },
      "blocks": [
        {
          "id": "revenue_main",
          "type": "revenue_overview_card",
          "query": "revenueOverview",
          "layout": { "colSpan": 2, "rowSpan": 1 },
          "props": { "title": "实际总营收", "unit": "万元" }
        }
      ]
    }
  ]
}
```

## Tab 字段
- `id`: string，tab 标识（前端用于切换）
- `label`: string，tab 文案
- `keywordEn`: string，可选
- `layout`: object，可选
  - `cols`: number，网格列数（建议 1~4，当前实现支持 1~6）
  - `gap`: number，网格间距 px（0~48）
- `blocks`: array，可选，tab 内区块列表

## Block 字段
- `id`: string，区块标识（建议唯一）
- `type`: string，区块类型（见下方“支持的 Block 类型”）
- `query`: string，可选，数据查询 key（见下方“支持的 query”）
- `layout`: object，可选
  - `colSpan`: number，跨列（默认 1）
  - `rowSpan`: number，跨行（默认 1）
- `props`: object，可选，区块参数（不同 type 可能使用不同字段）

## 支持的 query（数据源）
这些 query 会自动带上 `timeRange` 调用后端接口：
- `revenueOverview` → `/dashboard/revenue-overview`
- `dailyRevenue` → `/dashboard/daily-revenue`
- `peopleStats` → `/dashboard/people-stats`
- `demandChannel` → `/dashboard/demand-channel`
- `events` → `/dashboard/events`
- `sales` → `/dashboard/sales`

## 支持的 Block 类型（当前实现）
### 基础
- `ai_progress`: 静态进度条
  - `props.title`: string
  - `props.value`: number（0~100）

### 总览/营收
- `revenue_overview_card`: 总营收大卡片（含转化率、成功单/人数）
- `revenue_total_card`: 累计营收卡片
- `stat_card`: 通用指标卡
  - `props.label`: string
  - `props.valuePath`: string（从 query.data 取值路径）
  - `props.format`: `"wan"` 可选
  - `props.suffix`: string 可选
- `conversion_rate_card`: 转化率卡
  - `props.label`: string
  - `props.valuePath`: string（默认 `conversionRate`）

### 人数/渠道
- `people_total_card`: 总计人数
- `people_pie_card`: 人数饼图
- `demand_channel_pie_card`: 渠道饼图
  - `props.topN`: number（默认 5）
- `demand_type_pie_card`: 需求类型饼图
  - `props.topN`: number（默认 4）
- `daily_revenue_people_chart`: 日人数&日营收趋势
  - `props.height`: number
- `daily_demand_trend_chart`: 每日需求趋势
  - `props.height`: number
- `staff_distribution_card`: 客服接收占比
  - `props.topN`: number

### 活动/销售
- `activity_type_conversion_card`: 活动类型成单率
- `theme_ratio_card`: 主题占比
- `room_ratio_card`: 包厢占比
- `theme_revenue_people_chart`: 主题收入&人数
- `room_revenue_people_chart`: 包厢收入&人数
- `sales_ranking_card`: 销售榜（完整）
- `sales_ranking_inline`: 销售榜（精简版）
  - `props.topN`: number
- `customer_tag_cloud_card`: 客户 TAG 词云
  - `props.height`: number
- `sales_rate_grid_card`: 人员成单率网格

