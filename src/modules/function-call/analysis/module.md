# Analysis Module

## 模块描述
Analysis模块：负责理解用户意图，通过Schema搜索与Mongo查询分析数据。
文件路径: `src/modules/function-call/analysis`

## 功能描述及关键词

### analysis.service.ts
数据分析服务。
- **关键词**: data analysis, schema search, mongo query, tenant scope, decision-card, tool aggregation, service
- **函数**:
  - `getAllDataSourceTools`: 聚合数据源工具/get all data source tools
  - `getHandle`: 获取句柄/getHandle
  - `buildCapabilityBrief`: 构建能力摘要/build capability brief
  - `shouldGenerateDecisionCard`: 决策触发判断/should generate decision card
  - `resolveAnalysisContext`: 解析分析上下文/resolve analysis context
