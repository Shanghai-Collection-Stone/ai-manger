# Dashboard-Function-Call Module

## 模块描述
该模块为 AI 指挥官提供租户隔离的看板工具能力，包括数据表结构查询、租户物理表数据查询、看板 JSON 配置查看与 JSON Merge Patch 修改。
文件路径: `src/modules/function-call/dashboard`

## 功能描述及关键词

### services/dashboard-tools.service.ts
看板工具服务，注入 `DS_MONGO_DB` 与 `DashboardConfigService`，闭包内绑定 `scope.tenantId` 实现租户隔离。
- `getHandle(scope)` — 返回4个LangChain工具句柄
- `buildTenantPrefix(tenantId)` — 按rentantId构建四位集合前缀（与 sass.service 保持一致）
- **工具列表**:
  - `tenant_tables` — 列出 `sass_schema` 所有表结构（table/desc/fields）
  - `tenant_query` — 按逻辑表名查询租户物理表，自动前缀路由，支持 count/list 模式，最多100条
  - `dashboard_config_view` — 查看指定 dashboardCode 的当前配置JSON
  - `dashboard_config_patch` — JSON Merge Patch（RFC 7396）修改看板配置，落库到 `customConfig` 字段
- **关键词**: dashboard, tools, tenant-isolated, tenant_tables, tenant_query, config-patch, json-merge-patch

### dashboard.module.ts
看板工具模块定义，导入 `DataSourceModule`（提供 `DS_MONGO_DB`）与 `DashboardConfigModule`。
- **关键词**: module, dashboard, function-call
