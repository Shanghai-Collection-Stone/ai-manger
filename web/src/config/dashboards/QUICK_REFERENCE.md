# 看板 JSON 驱动系统 - 快速参考

## 🚀 一分钟快速开始

### 1️⃣ 运行迁移初始化
```bash
pnpm run migration:up
```

### 2️⃣ 验证配置文件
```bash
pnpm run validate:dashboard-config
```

### 3️⃣ 访问看板
前端自动加载 JSON 配置并渲染

---

## 📝 JSON 配置最小示例

```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "我的看板",
  "tabs": [
    {
      "id": "main",
      "label": "主页",
      "layout": { "cols": 2, "gap": 16 },
      "blocks": [
        {
          "id": "revenue",
          "type": "revenue_overview_card",
          "query": "revenueOverview",
          "layout": { "colSpan": 2 }
        }
      ]
    }
  ]
}
```

---

## 🔧 核心概念

| 概念 | 说明 | 位置 |
|------|------|------|
| **Dashboard** | 一个看板对应一个 JSON 文件 | `config/dashboards/` |
| **Tab** | 看板内的标签页 | JSON 的 `tabs` 数组 |
| **Block** | Tab 内的数据卡片 | JSON 的 `blocks` 数组 |
| **Query** | 数据查询 key | Block 的 `query` 字段 |
| **Block Type** | 组件类型 | Block 的 `type` 字段 |
| **Layout** | 网格布局配置 | `layout` 和 `props` |

---

## 📦 支持的 Block 类型

### 基础
- `ai_progress` - 进度条
- `stat_card` - 通用指标卡

### 营收
- `revenue_overview_card` - 营收大卡
- `revenue_total_card` - 累计营收

### 人数/渠道
- `people_total_card` - 总人数
- `people_pie_card` - 人数饼图
- `demand_channel_pie_card` - 渠道饼图
- `demand_type_pie_card` - 需求类型饼图

### 趋势/销售
- `daily_revenue_people_chart` - 日营收趋势
- `daily_demand_trend_chart` - 每日需求趋势
- `sales_ranking_inline` - 销售榜

---

## 🔌 支持的 Query 数据源

| Query Key | 说明 |
|-----------|------|
| `revenueOverview` | 营收总览 |
| `dailyRevenue` | 每日营收&人数 |
| `peopleStats` | 人数统计 |
| `demandChannel` | 需求&渠道 |
| `events` | 活动数据 |
| `sales` | 销售数据 |

---

## 🎨 布局参数

### Tab 级 (`layout`)
```json
{
  "cols": 2,    // 列数 (1-6)
  "gap": 16     // 间距 (px, 0-48)
}
```

### Block 级 (`layout`)
```json
{
  "colSpan": 2, // 跨列 (1-6，默认1)
  "rowSpan": 1  // 跨行 (1-20，默认1)
}
```

---

## 👥 多租户配置

### 新增租户配置（3 步）

**1️⃣ 创建配置文件**
```
config/dashboards/tenant-name.dashboard.json
```

**2️⃣ 添加映射**
```bash
POST /admin/dashboard-config/mappings
{
  "dashboardCode": "ai-commander",
  "tenantId": "tenant-name",
  "filePath": "config/dashboards/tenant-name.dashboard.json",
  "enabled": true
}
```

**3️⃣ 验证**
```bash
pnpm run validate:dashboard-config
```

---

## 📊 常见 Block 配置示例

### 营收卡片
```json
{
  "type": "revenue_overview_card",
  "query": "revenueOverview",
  "props": {
    "title": "实际总营收",
    "unit": "万元"
  }
}
```

### 通用指标卡
```json
{
  "type": "stat_card",
  "query": "revenueOverview",
  "props": {
    "label": "成功订单数",
    "valuePath": "successOrderCount",
    "suffix": "单"
  }
}
```

### 饼图
```json
{
  "type": "people_pie_card",
  "query": "peopleStats",
  "props": {
    "title": "人数分析"
  }
}
```

### 趋势图
```json
{
  "type": "daily_revenue_people_chart",
  "query": "dailyRevenue",
  "props": {
    "title": "日营收趋势",
    "height": 160
  }
}
```

---

## 🛠️ 常用命令

```bash
# 验证所有配置文件
pnpm run validate:dashboard-config

# 初始化数据库
pnpm run migration:up

# 查看迁移状态
pnpm run migration:status

# 开发服务器
pnpm run start:dev

# 构建前端
cd web && pnpm run build
```

---

## 📍 关键文件位置

| 文件 | 用途 |
|------|------|
| `config/dashboards/*.json` | 看板配置文件 |
| `config/dashboards/DASHBOARD_CONFIG_SPEC.md` | 完整规范 |
| `config/dashboards/INTEGRATION_GUIDE.md` | 集成指南 |
| `web/src/ui/AiCommander/DashboardView.jsx` | 前端渲染 |
| `web/src/ui/AiCommander/DashboardConfigManager.jsx` | 管理界面 |
| `src/modules/dashboard-config/` | 后端服务 |
| `migrations/20260305000000-init-dashboard-config-mappings.js` | 初始化迁移 |

---

## ❓ 常见问题

**Q: 如何添加新的 Block 类型？**
A: 在 `DashboardView.jsx` 的 `BLOCK_COMPONENTS` 注册表中添加，参考现有 Block 的实现方式。

**Q: 如何修改看板配置？**
A: 编辑对应的 JSON 文件，刷新页面即可加载新配置。

**Q: 如何为不同租户配置不同的看板？**
A: 创建租户专属 JSON 文件，通过管理 API 添加映射，系统会自动按租户加载。

**Q: 看板显示"未实现的Block"是什么意思？**
A: Block type 未在 `BLOCK_COMPONENTS` 中注册，检查拼写或添加新的组件。

**Q: 数据如何实时更新？**
A: 用户切换时间范围时，所有 Query 会重新请求数据并更新 Block。

---

## 🔐 安全特性

✅ 配置文件路径限制在 `config/dashboards/` 目录下  
✅ 租户隔离：租户账号只能访问自己的配置  
✅ 管理 API 需要 Bearer Token 认证  
✅ 所有输入都经过验证和清理

---

## 📚 深度学习

- 详细规范：`config/dashboards/DASHBOARD_CONFIG_SPEC.md`
- 集成指南：`config/dashboards/INTEGRATION_GUIDE.md`
- 后端代码：`src/modules/dashboard-config/`
- 前端代码：`web/src/ui/AiCommander/DashboardView.jsx`

---

## 🎯 下一步

1. ✅ 运行 `pnpm run migration:up` 初始化数据库
2. ✅ 运行 `pnpm run validate:dashboard-config` 验证配置
3. ✅ 访问看板，检查是否正常加载
4. ✅ 为新租户添加定制配置（如需要）
5. ✅ 根据需求添加新的 Block 类型

---

**完成！🎉 现在你已经有了一个完整的 JSON 驱动看板系统，支持多租户和动态渲染。**
