# Function-Call-Tools Module

## 模块描述
该模块负责聚合各Function-Call子模块与工具服务，统一对外导出工具提供者，并对不再使用的工具进行统一过滤，便于在Agent运行时以依赖注入方式加载。
文件路径: `src/modules/function-call/tools`

## 功能描述及关键词

### tools.service.ts
工具聚合服务。
- **关键词**: tools, function-call, aggregation, thought-route, tool-whitelist, langchain, agent, service
- **函数**:
  - `getHandle`: 获取工具集合/get handle
  - `getThoughtRouteTools`: 获取思维链路工具/get thought route tools

### services/graph-workflow.service.ts
图工作流工具服务，负责 Canvas 生成、单篇写入、发布编排。
- **关键词**: graph-workflow, topic_orchestrate, canvas_append_article, canvas_execute, xhs_batch_publish
- **函数**:
  - `getHandle`: 获取图工作流工具/get graph workflow tools

### tools.module.ts
工具模块定义。
- **关键词**: module
