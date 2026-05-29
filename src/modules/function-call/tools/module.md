# Function-Call-Tools Module

## 模块描述
该模块负责聚合各Function-Call子模块与工具服务，统一对外导出工具提供者，并对不再使用的工具进行统一过滤，便于在Agent运行时以依赖注入方式加载。
文件路径: `src/modules/function-call/tools`

## 功能描述及关键词

### tools.service.ts
工具聚合服务。聚合所有子模块工具（含 dashboard、todo、analysis、article-library 等），统一向对话层暴露。
- **关键词**: tools, function-call, aggregation, thought-route, tool-whitelist, langchain, agent, service, dashboard, article-library
- **函数**:
  - `getHandle`: 获取工具集合/get handle
  - `getThoughtRouteTools`: 获取思维链路工具/get thought route tools
  - `buildArticleLibraryTools`: 构建文章库工具（列库 / 获取二维码 / Canvas 入库）/build article library tools
  - `buildAccountPoolTool`: 构建账号池查询工具（仅 xhs）/build account pool tool, xhs only
  - `getXhsSubAgentSessionTools`: 发布/追踪子会话工具集（含账号池、canvas详情）/xhs sub-agent session tools
  - `getXhsArticleExpertSessionTools`: 生文专家子会话工具集（todo + canvas搜索 + topic_orchestrate + xhs_get_canvas_detail + buildArticleLibraryTools + **xhs_regenerate_article_images**）/xhs article expert session tools

### services/graph-workflow.service.ts
图工作流工具服务，负责 Canvas 生成、单篇写入、发布编排。
- **关键词**: graph-workflow, topic_orchestrate, canvas_append_article, canvas_execute, xhs_batch_publish, image-group
- **函数**:
  - `normalizeRequestedArticleCount`: 归一化请求篇数（不强制 6-8）
  - `buildTopicOrchestrateDedupKey`: 选题编排去重键（含 userPrompt/dataSummary/writingStyle）
  - `normalizePlatformType`: 归一化平台标签（小红书别名→xhs，软纠正）/normalize platform type alias
  - `resolveTopicWritingStyle`: 从显式 writingStyle 或兼容的 style 对象中解析生文风格/resolve topic writing style
  - `getHandle`: 获取图工作流工具/get graph workflow tools

### tools.module.ts
工具模块定义。
- **关键词**: module
