# Function-Call-Tools Module

## 模块描述

该模块负责聚合各Function-Call子模块与工具服务，统一对外导出工具提供者，并对不再使用的工具进行统一过滤，便于在Agent运行时以依赖注入方式加载。
文件路径: `src/modules/function-call/tools`

## 功能描述及关键词

### tools.service.ts

工具聚合服务。聚合所有子模块工具（含 dashboard、todo、analysis、article-library 等），统一向对话层暴露；`FunctionCallScope` 可携带 `workspaceId`，供工作区任务对话向下传递执行范围。

- **关键词**: tools, function-call, aggregation, thought-route, tool-whitelist, langchain, agent, service, dashboard, article-library
- **函数**:
  - `getHandle`: 获取工具集合/get handle
  - `getThoughtRouteTools`: 获取思维链路工具/get thought route tools
  - `buildArticleLibraryTools`: 构建文章库工具（列库 / 获取二维码 / Canvas 入库；二维码复用 article-library 的 XHS 短链改写逻辑）/build article library tools
  - `buildAccountPoolTool`: 构建账号池查询工具（仅 xhs）/build account pool tool, xhs only
  - `getXhsSubAgentSessionTools`: 发布/追踪子会话工具集（含账号池、canvas详情）/xhs sub-agent session tools
  - `getXhsSupervisorTools`: 小红书主专家自动路由工具池,合并小红书主入口、发布/追踪、生文、图库、XHS Canvas 与 graph workflow 工具并按名称去重 | keywords: 小红书专家, 意图路由, 工具池, xhs-supervisor-tools, intent-routing
  - `getXhsSubAgentSessionTools`: 追踪/发布/生图子会话工具集（todo + canvas搜索 + robot_list + 账号池 + 详情 + **xhs_list_unused_image_groups**）/xhs sub-agent session tools
  - `getXhsArticleExpertSessionTools`: 生文专家子会话工具集（todo + canvas搜索 + topic_orchestrate + xhs_get_canvas_detail + buildArticleLibraryTools + **xhs_regenerate_article_images** + **xhs_list_unused_image_groups**）/xhs article expert session tools

### services/graph-workflow.service.ts

图工作流工具服务，负责 Canvas 生成、单篇写入、发布编排。

- **关键词**: graph-workflow, topic_orchestrate, canvas_append_article, canvas_execute, xhs_batch_publish, image-group
- **函数**:
  - `normalizeRequestedArticleCount`: 归一化请求篇数（不强制 6-8）
  - `extractArticleCountFromText`: 从 userPrompt/dataSummary/topic 提取显式篇数，防止确认续跑被压成 1 篇 | keywords: 篇数提取, 意图延续, 图文生成, extract-article-count, continuation-intent, article-generation
  - `buildTopicOrchestrateDedupKey`: 选题编排去重键（含 userPrompt/dataSummary/writingStyle）
  - `normalizePlatformType`: 归一化平台标签（小红书别名→xhs，软纠正）/normalize platform type alias
  - `resolveTopicWritingStyle`: 从显式 writingStyle 或兼容的 style 对象中解析生文风格/resolve topic writing style
  - `getHandle`: 获取图工作流工具；topic_orchestrate 返回简短状态 + canvas-it,不再返回完整 canvas/articles/items JSON；缺少显式图库 tags 或配图预检不足时不创建 Canvas 且不输出 canvas-it；传 imageGroupCanvasIds 时复用未使用图组，成功配图后自动标记来源图组已使用；**新增 `dedup` 参数(默认去重;用户消息含"不去重/允许重复"传 false→取图不排除 isUsed),并计入 orchestrate 去重缓存 key**/get graph workflow tools | keywords: dedup

### tools.module.ts

工具模块定义。

- **关键词**: module
