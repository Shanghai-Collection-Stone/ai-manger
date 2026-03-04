# Graph Module

## 模块描述
该模块提供“编排文章 -> 写入Canvas -> 图库向量配图”的生成流程，并提供“从Canvas生成批量任务 -> 并行入队 -> 触发MCP运行”的发布流程，作为后端工作流编排的统一入口。
文件路径: `src/modules/graph`

## 功能描述及关键词

### graph.controller.ts
Graph控制器。
- **关键词**: graph, workflow, orchestration, langgraph, controller

### article-graph.service.ts
文章编排服务。
- **关键词**: articles, canvas, gallery, service

### batch-task-graph.service.ts
批量发布图服务。
- **关键词**: batch-task, publishing, mcp, task-it, todo-summary, service

### graph.module.ts
Graph模块定义。
- **关键词**: module
