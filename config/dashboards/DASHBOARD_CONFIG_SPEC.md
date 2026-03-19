/**
 * @description 看板 JSON 配置规范详细文档
 * @keyword-en dashboard config specification
 */

# Dashboard JSON 配置规范 v1.0

## 📋 目录
1. [核心概念](#核心概念)
2. [JSON 结构](#json-结构)
3. [Block 类型参考](#block-类型参考)
4. [Query 数据源](#query-数据源)
5. [布局系统](#布局系统)
6. [多租户配置](#多租户配置)
7. [常见示例](#常见示例)

---

## 核心概念

看板系统采用 **JSON 驱动** 的设计，核心要素为：

### 三层结构
```
Dashboard (看板)
  └─ Tab (标签页)
      └─ Block (数据卡片)
```

- **Dashboard**: 一个看板对应一个 JSON 配置文件
- **Tab**: 看板内的标签页，支持切换
- **Block**: Tab 内的最小单元，映射到具体的 React 组件

### 核心流程
1. 前端调用 `/dashboard-config/current?dashboardCode=ai-commander`
2. 后端根据租户 ID 查询配置映射，返回对应的 JSON 文件路径
3. 前端加载 JSON，按 Tab/Block 动态渲染组件
4. Block 根据 `query` 字段自动加载数据，然后渲染

---

## JSON 结构

### 顶层结构

```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "看板标题",
  "description": "看板描述（可选）",
  "timeRanges": ["今天", "本月"],
  "tabs": [
    { /* Tab 定义 */ }
  ]
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `dashboardCode` | string | ✓ | 看板代码，唯一标识 |
| `version` | number | ✓ | 配置版本（建议用整数，便于后续升级） |
| `title` | string | ✓ | 看板标题 |
| `description` | string | ✗ | 看板描述 |
| `timeRanges` | string[] | ✗ | 时间范围选项，会传给 `timeRange` 参数 |
| `tabs` | Tab[] | ✓ | Tab 列表 |

### Tab 结构

```json
{
  "id": "overview",
  "label": "总览",
  "keywordEn": "overview",
  "layout": {
    "cols": 2,
    "gap": 16
  },
  "blocks": [
    { /* Block 定义 */ }
  ]
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | ✓ | Tab ID，用于前端切换 |
| `label` | string | ✓ | Tab 显示文本 |
| `keywordEn` | string | ✗ | 英文关键词，用于代码识别 |
| `layout` | GridLayout | ✗ | 网格布局配置 |
| `blocks` | Block[] | ✗ | 该 Tab 下的 Block 列表 |

### Block 结构

```json
{
  "id": "revenue_main",
  "type": "revenue_overview_card",
  "query": "revenueOverview",
  "layout": {
    "colSpan": 2,
    "rowSpan": 1
  },
  "props": {
    "title": "实际总营收",
    "unit": "万元"
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | ✓ | Block 唯一 ID |
| `type` | string | ✓ | Block 类型（见下方类型表） |
| `query` | string | ✗ | 数据查询 key（可选，不同类型需求不同） |
| `layout` | BlockLayout | ✗ | 位置和尺寸配置 |
| `props` | object | ✗ | 组件参数（因 type 而异） |

### 布局配置

#### GridLayout（Tab 级网格）
```json
{
  "cols": 2,    // 列数 (1-6)
  "gap": 16     // 间距 (px, 0-48)
}
```

#### BlockLayout（Block 级位置）
```json
{
  "colSpan": 2, // 跨列数 (1-6，默认1)
  "rowSpan": 1  // 跨行数 (1-20，默认1)
}
```

---

## Block 类型参考

### 基础类型

#### `ai_progress` - AI 进度条
静态进度条，无需 query。
```json
{
  "type": "ai_progress",
  "layout": { "colSpan": 2 },
  "props": {
    "title": "AI 覆盖达成率",
    "value": 73
  }
}
```
| prop | 类型 | 说明 |
|------|------|------|
| `title` | string | 标题 |
| `value` | number | 百分比 (0-100) |

---

### 营收类型

#### `revenue_overview_card` - 营收概览大卡
```json
{
  "type": "revenue_overview_card",
  "query": "revenueOverview",
  "layout": { "colSpan": 2 },
  "props": {
    "title": "实际总营收",
    "unit": "万元"
  }
}
```
显示总营收、转化率、成功订单数/人数。

| prop | 类型 | 说明 |
|------|------|------|
| `title` | string | 卡片标题 |
| `unit` | string | 单位（如"万元"） |

#### `stat_card` - 通用指标卡
```json
{
  "type": "stat_card",
  "query": "revenueOverview",
  "props": {
    "label": "成功订单数量",
    "valuePath": "successOrderCount",
    "format": "wan",
    "suffix": "单"
  }
}
```
灵活显示任意数值指标。

| prop | 类型 | 说明 |
|------|------|------|
| `label` | string | 标签 |
| `valuePath` | string | 数据路径 (如 "conversionRate"，支持嵌套 "a.b.c") |
| `format` | string | 可选格式 ("wan" 表示除以10000) |
| `suffix` | string | 后缀 (如 "%", "单") |

---

### 人数/渠道类型

#### `people_total_card` - 总人数卡
```json
{
  "type": "people_total_card",
  "query": "peopleStats",
  "props": {
    "title": "总计人数"
  }
}
```

#### `people_pie_card` - 人数饼图
```json
{
  "type": "people_pie_card",
  "query": "peopleStats",
  "layout": { "colSpan": 1, "rowSpan": 2 },
  "props": {
    "title": "人数分析"
  }
}
```
展示人数分布，使用预设颜色。

#### `demand_channel_pie_card` - 渠道饼图
```json
{
  "type": "demand_channel_pie_card",
  "query": "demandChannel",
  "props": {
    "title": "各渠道进入数量",
    "topN": 5
  }
}
```
| prop | 类型 | 说明 |
|------|------|------|
| `title` | string | 标题 |
| `topN` | number | 显示前 N 个 (默认5) |

---

### 趋势图表类型

#### `daily_revenue_people_chart` - 日营收&人数趋势
```json
{
  "type": "daily_revenue_people_chart",
  "query": "dailyRevenue",
  "layout": { "colSpan": 2 },
  "props": {
    "title": "日人数&日营收趋势",
    "height": 160
  }
}
```
混合柱状图（人数）+ 折线图（营收）。

| prop | 类型 | 说明 |
|------|------|------|
| `title` | string | 标题 |
| `height` | number | 图表高度 (px) |

#### `daily_demand_trend_chart` - 每日需求趋势
```json
{
  "type": "daily_demand_trend_chart",
  "query": "demandChannel",
  "props": {
    "height": 150
  }
}
```

---

### 销售类型

#### `sales_ranking_inline` - 销售榜（精简版）
```json
{
  "type": "sales_ranking_inline",
  "query": "sales",
  "props": {
    "title": "销售榜",
    "topN": 5
  }
}
```
显示销售人员排名和完成度。

---

## Query 数据源

系统内置以下 Query，会自动根据 `timeRange` 请求后端接口：

| Query Key | 对应接口 | 说明 |
|-----------|---------|------|
| `revenueOverview` | `/dashboard/revenue-overview` | 营收总览 |
| `dailyRevenue` | `/dashboard/daily-revenue` | 每日营收&人数 |
| `peopleStats` | `/dashboard/people-stats` | 人数统计 |
| `demandChannel` | `/dashboard/demand-channel` | 需求&渠道 |
| `events` | `/dashboard/events` | 活动数据 |
| `sales` | `/dashboard/sales` | 销售数据 |

### 数据缓存策略
- 同一 Tab 内，相同 Query 只请求一次
- Query 请求会自动带上 `timeRange` 参数
- 前端自动处理 loading/error 状态

---

## 布局系统

### 网格布局规则

1. **Tab 级网格**：通过 `layout.cols` 定义列数（1-6）
2. **Block 级位置**：通过 `colSpan` 和 `rowSpan` 定义占位

#### 示例：2 列布局

```json
{
  "layout": { "cols": 2, "gap": 16 },
  "blocks": [
    {
      "type": "revenue_overview_card",
      "layout": { "colSpan": 2, "rowSpan": 1 }  // 占满 2 列
    },
    {
      "type": "people_pie_card",
      "layout": { "colSpan": 1, "rowSpan": 2 }  // 左半边，跨 2 行
    },
    {
      "type": "demand_channel_pie_card",
      "layout": { "colSpan": 1, "rowSpan": 2 }  // 右半边，跨 2 行
    }
  ]
}
```

---

## 多租户配置

### 后端配置映射

在 MongoDB `dashboard_config_mappings` 集合中存储：

```json
{
  "_id": ObjectId(...),
  "dashboardCode": "ai-commander",
  "tenantId": "super-party",
  "filePath": "config/dashboards/super-party.dashboard.json",
  "enabled": true,
  "createdAt": ISODate(...),
  "updatedAt": ISODate(...)
}
```

### 查询流程

1. 前端发送请求：`GET /dashboard-config/current?dashboardCode=ai-commander`
2. 后端根据请求的 Bearer Token 获取 `tenantId`
3. 查询映射表：
   - 先查找 `(dashboardCode, tenantId)` 的配置
   - 如果未找到，使用母平台配置（`tenantId` 为 null）
4. 返回对应的 JSON 文件内容

### 配置文件位置

所有配置文件必须放在 `config/dashboards/` 目录下（为安全考虑）：

```
config/dashboards/
├── platform.dashboard.json          # 母平台默认配置
├── super-party.dashboard.json       # 超级派对定制配置
└── other-tenant.dashboard.json      # 其他租户配置
```

---

## 常见示例

### 示例 1：最小化配置

```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "简单看板",
  "tabs": [
    {
      "id": "main",
      "label": "主页",
      "blocks": [
        {
          "id": "revenue",
          "type": "revenue_overview_card",
          "query": "revenueOverview"
        }
      ]
    }
  ]
}
```

### 示例 2：多 Tab 配置

```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "完整看板",
  "tabs": [
    {
      "id": "overview",
      "label": "总览",
      "layout": { "cols": 2, "gap": 16 },
      "blocks": [
        {
          "id": "revenue",
          "type": "revenue_overview_card",
          "query": "revenueOverview",
          "layout": { "colSpan": 2 }
        },
        {
          "id": "people",
          "type": "people_pie_card",
          "query": "peopleStats",
          "layout": { "colSpan": 1 }
        }
      ]
    },
    {
      "id": "sales",
      "label": "销售",
      "layout": { "cols": 1 },
      "blocks": [
        {
          "id": "ranking",
          "type": "sales_ranking_inline",
          "query": "sales",
          "props": { "topN": 10 }
        }
      ]
    }
  ]
}
```

### 示例 3：租户定制配置

为租户 `tenant-123` 配置专属看板：

1. 创建文件 `config/dashboards/tenant-123.dashboard.json`
2. 添加映射到 MongoDB：
   ```bash
   POST /admin/dashboard-config/mappings
   {
     "dashboardCode": "ai-commander",
     "tenantId": "tenant-123",
     "filePath": "config/dashboards/tenant-123.dashboard.json",
     "enabled": true
   }
   ```

---

## 最佳实践

### ✓ Do's

- ✓ 使用有意义的 Block ID（便于调试）
- ✓ 为复杂布局添加注释说明
- ✓ 定期检查配置文件的 JSON 格式（可用在线工具验证）
- ✓ 为每个租户创建独立的配置文件
- ✓ 在 `props` 中使用可读的字段名

### ✗ Don'ts

- ✗ 不要在 JSON 中包含注释（JSON 规范不支持）
- ✗ 不要手动修改 MongoDB 中的配置映射（使用管理 API）
- ✗ 不要使用超出范围的 `cols` 值（应为 1-6）
- ✗ 不要跨租户共享配置文件路径

---

## 管理 API

### 获取当前配置

```
GET /dashboard-config/current?dashboardCode=ai-commander
```

**响应**:
```json
{
  "dashboardCode": "ai-commander",
  "tenantId": "super-party",
  "filePath": "config/dashboards/super-party.dashboard.json",
  "config": { /* DashboardConfig 对象 */ }
}
```

### 列出配置映射（管理端）

```
GET /admin/dashboard-config/mappings
Authorization: Bearer <token>
```

### 创建/更新配置映射（管理端）

```
POST /admin/dashboard-config/mappings
Authorization: Bearer <token>
{
  "dashboardCode": "ai-commander",
  "tenantId": "tenant-123",
  "filePath": "config/dashboards/tenant-123.dashboard.json",
  "enabled": true
}
```

### 删除配置映射（管理端）

```
DELETE /admin/dashboard-config/mappings/:id
Authorization: Bearer <token>
```

---

## 版本管理

使用 `version` 字段跟踪配置版本。升级时：

1. 增加 `version` 号
2. 确保 Block 类型向后兼容（如果新增类型）
3. 更新文档和示例

---

## 常见问题

**Q: 如何为新租户添加定制看板？**
A: 在 `config/dashboards/` 创建新 JSON 文件，然后通过 `/admin/dashboard-config/mappings` API 添加映射。

**Q: 能否动态修改看板配置？**
A: 目前配置是静态的（从文件加载）。要实现动态修改，需要将配置存储在 MongoDB 中并修改加载逻辑。

**Q: 同一 Tab 可以混用多个 Query 吗？**
A: 可以。Block 会自动去重并合并 Query 请求。

**Q: colSpan/rowSpan 超出范围怎么办？**
A: 系统会自动约束到有效范围（colSpan: 1-6，rowSpan: 1-20）。
