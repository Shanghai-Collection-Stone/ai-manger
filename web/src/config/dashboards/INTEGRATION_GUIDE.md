/**
 * @description 看板 JSON 驱动系统 - 完整集成指南
 * @keyword-en dashboard json driven system integration guide
 */

# 看板 JSON 驱动系统 - 完整集成指南

## 📚 快速开始

### 第一步：运行迁移初始化配置映射

```bash
pnpm run migration:up
```

这会创建 `dashboard_config_mappings` 集合并添加默认配置映射。

### 第二步：确认配置文件存在

检查以下文件是否存在：
- `config/dashboards/platform.dashboard.json` - 母平台默认配置
- `config/dashboards/super-party.dashboard.json` - 超级派对租户配置

### 第三步：前端加载配置

前端在 `DashboardView.jsx` 中已自动集成，当用户访问看板时：

1. 调用 `getCurrentDashboardConfig('ai-commander')`
2. 后端根据用户租户 ID 返回对应配置
3. 前端按 JSON 动态渲染 Tab 和 Block

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────┐
│           前端 (DashboardView.jsx)              │
│  - 加载 JSON 配置                               │
│  - 动态渲染 Tab/Block                           │
│  - 管理状态和交互                               │
└────────────┬────────────────────────────────────┘
             │ GET /dashboard-config/current
             │
┌────────────▼────────────────────────────────────┐
│      后端 (DashboardConfigService)              │
│  - 解析请求范围（Bearer/API Key）              │
│  - 查询配置映射表                               │
│  - 加载 JSON 文件                               │
└────────────┬────────────────────────────────────┘
             │ 返回 DashboardConfig JSON
             │
┌────────────▼────────────────────────────────────┐
│      MongoDB & 文件系统                         │
│  - dashboard_config_mappings (映射表)          │
│  - config/dashboards/*.json (配置文件)         │
└─────────────────────────────────────────────────┘
```

---

## 📋 Block 组件注册系统

### 如何添加新的 Block 类型

在 `DashboardView.jsx` 中的 `BLOCK_COMPONENTS` 对象里添加：

```javascript
const BLOCK_COMPONENTS = {
  // ...existing types...
  
  my_custom_card: (props) => {
    const { block, queries, timeRange } = props;
    const q = queries?.[block?.query];
    
    if (!q || q.loading) return <LoadingBox />;
    if (q.error) return <ErrorBox msg={q.error} />;
    
    const data = q.data || {};
    const title = block?.props?.title || 'My Card';
    
    return (
      <div className="bg-white p-4 rounded-3xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
        <div className="text-sm font-medium text-slate-700 mb-2">{title}</div>
        {/* 你的组件内容 */}
      </div>
    );
  },
};
```

然后在 JSON 配置中使用：

```json
{
  "id": "my_custom",
  "type": "my_custom_card",
  "query": "revenueOverview",
  "props": {
    "title": "我的自定义卡片"
  }
}
```

### Block 组件的 Props 接口

```typescript
interface BlockComponentProps {
  block: DashboardBlock;        // Block 定义
  queries: Record<string, {     // Query 结果映射
    data: any;
    loading: boolean;
    error: string | null;
  }>;
  timeRange: string;            // 时间范围
}
```

---

## 🔧 如何为新租户添加定制看板

### 场景：为租户 "new-tenant" 配置专属看板

#### 1. 创建配置文件

创建 `config/dashboards/new-tenant.dashboard.json`：

```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "New Tenant Dashboard",
  "tabs": [
    {
      "id": "main",
      "label": "主页",
      "layout": { "cols": 2 },
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

#### 2. 添加配置映射（三种方式）

**方式 A：通过管理 API（推荐）**

访问管理后台，使用 `DashboardConfigManager` 组件：

```
POST /admin/dashboard-config/mappings
Authorization: Bearer <admin-token>

{
  "dashboardCode": "ai-commander",
  "tenantId": "new-tenant",
  "filePath": "config/dashboards/new-tenant.dashboard.json",
  "enabled": true
}
```

**方式 B：通过迁移**

创建新迁移文件 `migrations/YYYYMMDDHHMMSS-add-new-tenant-dashboard.js`：

```javascript
module.exports = {
  async up(db) {
    const mappings = db.collection('dashboard_config_mappings');
    await mappings.insertOne({
      dashboardCode: 'ai-commander',
      tenantId: 'new-tenant',
      filePath: 'config/dashboards/new-tenant.dashboard.json',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  },
  async down(db) {
    await db.collection('dashboard_config_mappings').deleteOne({
      dashboardCode: 'ai-commander',
      tenantId: 'new-tenant',
    });
  },
};
```

**方式 C：通过 MongoDB 直接操作**

```javascript
db.dashboard_config_mappings.insertOne({
  dashboardCode: 'ai-commander',
  tenantId: 'new-tenant',
  filePath: 'config/dashboards/new-tenant.dashboard.json',
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
```

#### 3. 验证

用该租户账号访问看板，应该看到定制的配置。

---

## 🎯 常见场景示例

### 场景 1：简单营收看板

**配置文件**：`config/dashboards/revenue-only.dashboard.json`

```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "营收专项看板",
  "tabs": [
    {
      "id": "revenue",
      "label": "营收",
      "layout": { "cols": 2, "gap": 16 },
      "blocks": [
        {
          "id": "total",
          "type": "revenue_overview_card",
          "query": "revenueOverview",
          "layout": { "colSpan": 2 }
        },
        {
          "id": "daily_chart",
          "type": "daily_revenue_people_chart",
          "query": "dailyRevenue",
          "layout": { "colSpan": 2 },
          "props": { "height": 200 }
        }
      ]
    }
  ]
}
```

### 场景 2：多指标仪表盘

**配置文件**：`config/dashboards/metrics-dashboard.dashboard.json`

```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "综合指标仪表盘",
  "tabs": [
    {
      "id": "kpis",
      "label": "KPI",
      "layout": { "cols": 3, "gap": 12 },
      "blocks": [
        {
          "id": "revenue",
          "type": "stat_card",
          "query": "revenueOverview",
          "props": {
            "label": "总营收",
            "valuePath": "totalRevenue",
            "format": "wan",
            "suffix": "万"
          }
        },
        {
          "id": "orders",
          "type": "stat_card",
          "query": "revenueOverview",
          "props": {
            "label": "成功订单",
            "valuePath": "successOrderCount",
            "suffix": "单"
          }
        },
        {
          "id": "conversion",
          "type": "stat_card",
          "query": "revenueOverview",
          "props": {
            "label": "转化率",
            "valuePath": "conversionRate",
            "suffix": "%"
          }
        }
      ]
    }
  ]
}
```

### 场景 3：按客户分组的看板

```json
{
  "dashboardCode": "ai-commander",
  "version": 1,
  "title": "客户分析看板",
  "tabs": [
    {
      "id": "overview",
      "label": "总览",
      "layout": { "cols": 2, "gap": 16 },
      "blocks": [
        {
          "id": "people_pie",
          "type": "people_pie_card",
          "query": "peopleStats",
          "layout": { "colSpan": 1, "rowSpan": 2 },
          "props": { "title": "客户分类" }
        },
        {
          "id": "channel_pie",
          "type": "demand_channel_pie_card",
          "query": "demandChannel",
          "layout": { "colSpan": 1, "rowSpan": 2 },
          "props": { "title": "订单来源", "topN": 6 }
        }
      ]
    }
  ]
}
```

---

## 🔄 数据更新流程

### 实时数据流

1. **用户选择时间范围** → 触发所有 Query 重新请求
2. **后端接收请求** → `/dashboard/revenue-overview?timeRange=本月`
3. **数据库查询** → 根据 timeRange 筛选数据
4. **返回到前端** → 前端自动更新所有 Block
5. **UI 重新渲染** → 用户看到最新数据

### Query 缓存策略

- 同一 Tab 内的相同 Query 只发一次请求
- Query 结果在内存中缓存
- 切换 Tab 时重新加载该 Tab 的 Query

---

## 🛡️ 安全考虑

### 配置文件路径限制

配置文件只能位于 `config/dashboards/` 目录下，防止目录遍历攻击：

```typescript
// 后端自动验证
private resolveConfigAbsPath(filePath: string): string {
  const abs = path.resolve(process.cwd(), filePath);
  const base = 'config/dashboards' + path.sep;
  if (!abs.startsWith(base)) {
    throw new BadRequestException('CONFIG_FILE_PATH_OUT_OF_SCOPE');
  }
  return abs;
}
```

### 租户隔离

- 租户账号只能查看/修改自己租户的配置映射
- 平台账号可以查看/修改所有配置

```typescript
// 管理 API 自动检查
if (user.tenantId && body.tenantId && body.tenantId !== user.tenantId) {
  throw new ForbiddenException('CROSS_TENANT_FORBIDDEN');
}
```

---

## 📊 监控和调试

### 查看配置加载情况

```bash
# 查询配置映射
db.dashboard_config_mappings.find({ dashboardCode: 'ai-commander' })

# 查看特定租户配置
db.dashboard_config_mappings.findOne({ 
  dashboardCode: 'ai-commander',
  tenantId: 'super-party'
})
```

### 常见问题排查

**Q: 看板显示"配置加载失败"**

A: 检查以下几点：
1. 配置映射是否存在：`db.dashboard_config_mappings.findOne({...})`
2. 配置文件是否存在：`ls config/dashboards/`
3. JSON 格式是否正确：使用在线 JSON 验证工具
4. 后端日志：`docker-compose logs backend`

**Q: Block 显示"未实现的Block"**

A: 检查 Block 类型是否在 `BLOCK_COMPONENTS` 中注册，或拼写是否正确

**Q: 数据显示为空**

A: 检查：
1. Query 对应的接口是否返回数据
2. `valuePath` 路径是否正确
3. 后端是否有该租户的数据

---

## 🚀 性能优化

### 1. 减少 Block 数量

避免在一个 Tab 中放太多 Block：

```json
// ✗ 不好：30+ 个 Block，加载慢
{ "blocks": [...30 items] }

// ✓ 好：5-10 个关键 Block
{ "blocks": [...8 items] }
```

### 2. 使用合适的图表高度

```json
// ✗ 太高：3000px 图表
{ "props": { "height": 3000 } }

// ✓ 合适：160-200px
{ "props": { "height": 180 } }
```

### 3. 按需加载数据

在 JSON 中只配置必要的 Query：

```json
// ✓ 好：只加载需要的数据
{
  "blocks": [
    { "query": "revenueOverview" },
    { "query": "dailyRevenue" }
  ]
}
```

---

## 📝 版本升级指南

### 升级配置版本

当需要添加新 Block 类型或修改结构时：

1. 更新 `BLOCK_COMPONENTS` 注册表
2. 增加 JSON 版本号：`"version": 2`
3. 更新现有配置文件，添加新 Block
4. 更新 `DASHBOARD_CONFIG_SPEC.md` 文档
5. 创建迁移文件更新所有租户映射（如需要）

### 向后兼容性

保持旧 Block 类型可用，新类型使用新的 `type` 值：

```javascript
// 不要修改现有类型
revenue_overview_card: (props) => { /* 保持不变 */ },

// 添加新版本
revenue_overview_card_v2: (props) => { /* 新功能 */ },
```

---

## 💡 最佳实践总结

✅ **推荐做法**
- 为每个主要租户创建独立配置文件
- 在版本控制中跟踪所有配置文件变更
- 定期备份 `dashboard_config_mappings` 集合
- 使用有意义的 Block ID 便于维护
- 编写注释说明复杂的布局

❌ **避免做法**
- 不要手动编辑数据库中的配置映射
- 不要在 JSON 中包含注释（JSON 规范不支持）
- 不要跨租户共享配置文件
- 不要创建过大的配置文件（>100KB）

---

## 🔗 相关文件和链接

- **规范文档**：`config/dashboards/DASHBOARD_CONFIG_SPEC.md`
- **示例配置**：
  - `config/dashboards/platform.dashboard.json`
  - `config/dashboards/super-party.dashboard.json`
- **前端实现**：`web/src/ui/AiCommander/DashboardView.jsx`
- **管理界面**：`web/src/ui/AiCommander/DashboardConfigManager.jsx`
- **后端服务**：`src/modules/dashboard-config/services/dashboard-config.service.ts`
- **类型定义**：`src/modules/dashboard-config/types/dashboard-config.types.ts`
- **迁移文件**：`migrations/20260305000000-init-dashboard-config-mappings.js`

---

## 📞 获取帮助

如有问题，请检查：
1. 配置文件 JSON 格式
2. 租户映射是否正确
3. 后端日志输出
4. 网络请求（浏览器 DevTools）
