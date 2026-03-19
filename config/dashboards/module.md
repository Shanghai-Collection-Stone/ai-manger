# Dashboards Config

## 模块描述
看板配置文件目录：集中存放母平台与租户看板 JSON 配置，以及通用 Mongo JSON Filter 规范文档。
文件路径: `config/dashboards`

## 功能描述及关键词

### platform.dashboard.json
母平台默认看板 JSON 配置（预置 /dashboard/* 接口驱动）。
- **关键词**: dashboard, config, platform, preset

### sanshui.dashboard.json
三水集团（tenantId: `69a912dd3934b0f7363edcc9`）租户看板配置。
使用 `queries` 定义 Mongo 查询，前端客户端聚合。
数据源：`69a9_orders`、`69a9_order_usages`、`69a9_order_refunds`。
4 个 Tab：总览、订单分析、核销分析、退款分析。
- **关键词**: dashboard, sanshui, tenant, mongo-query, orders, usage, refund

### super-party.dashboard.json
超级派对租户看板配置示例。
- **关键词**: dashboard, config, super-party, tenant

### dashboard-config.spec.md
看板 JSON 配置规范（tabs + blocks + layout + queries）。
- **关键词**: dashboard, config, blocks, layout, cols, queries

### mongo-filter.spec.md
Mongo JSON Filter 查询规范（含 join / count / list）。
- **关键词**: mongo, json filter, join, lookup, spec
