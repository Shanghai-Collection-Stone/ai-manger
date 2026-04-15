# Chat-Main Module

## 模块描述
主对话模块：支持流式与非流式交互，并提供上下文会话的增删改查能力；流式工具调用带超时保护，但 topic_orchestrate 不做超时限制。针对生图/图组等工具密集链路，支持 updates-only 流模式与连接关闭后的中断保护。topic_orchestrate_subagent 支持数据收集链路（analysis_subagent/task + data_analysis + duckduckgo 类 MCP 搜索）后再发起编排。
文件路径: `src/modules/chat-main`

## 功能描述及关键词

### chat.service.ts
主对话服务。
- **关键词**: chat main, streaming, non-streaming, context, service, session-type, thought-route, tool-whitelist
- **函数**:
  - `send`: 非流式发送/send
  - `stream`: 流式发送/stream
  - `createSession`: 创建会话/create session
  - `appendUser`: 追加用户/append user
  - `appendAssistant`: 追加助手/append assistant
  - `getMessages`: 获取消息/get messages
  - `deleteMessages`: 删除消息/delete messages
  - `clearSession`: 清空会话/clear session
  - `buildErrorDiagnostics`: 错误诊断/build error diagnostics
  - `buildStreamDebugSnapshot`: 调试快照/build stream debug snapshot
  - `awaitNextStreamEvent`: 等待流事件/await next stream event
  - `toCheckpointMessages`: 转换消息/checkpoint messages
  - `extractText`: 提取文本/extract text
  - `sanitizeFinalText`: 清洗文本/sanitize text
  - `ensureStringArray`: 规范数组/ensure string array
  - `provisionalTitle`: 预置标题/provisional title
  - `getDataAnalysisPromptCN`: 系统提示/data analysis prompt
  - `getSystemPromptCN`: 模式提示/system prompt
  - `getThoughtPromptCN`: 思维链提示/thought prompt
  - `buildGallerySubagent`: 构建图库子代理/build gallery subagent
  - `buildDefaultSubagents`: 子代理配置（xhs-specialist新增：xhs_data_tracking/xhs_account_nurturing/xhs_publish）/build default subagents
  - `getTools`: 获取工具/get tools
  - `getRequestScope`: 解析租户范围/get request scope
  - `getToolsForInput`: 工具过滤/get tools for input
  - `buildDefaultSubagents`: 子代理配置/build default subagents
  - `normalizeSubagentTools`: 规范工具/normalize subagent tools
  - `isBatchPublishIntent`: 批量发布意图/batch publish intent
  - `isTopicOrchestrateIntent`: 选题编排意图/topic orchestrate intent
  - `shouldUseUpdatesOnlyStreamForInput`: updates-only 流模式判定/updates-only stream intent
  - `parseCanvasExecuteCanvasId`: 解析画布ID/parse canvas id
  - `extractCanvasItItems`: 解析画布块/extract canvas items
  - `extractTaskItItems`: 解析待办块/extract task items
  - `buildTaskItBlock`: 构建待办块/build task block
  - `appendTaskItIfNeeded`: 追加待办块/append task block
  - `buildCanvasItBlock`: 构建画布块/build canvas block
  - `appendCanvasItIfNeeded`: 追加画布块/append canvas block
  - `extractDecisionItems`: 解析决策块/extract decision items
  - `buildDecisionItBlock`: 构建决策块/build decision block
  - `appendDecisionSummaryIfNeeded`: 追加决策摘要/append decision summary
  - `appendDecisionItIfNeeded`: 追加决策块/append decision block
  - `shouldUseAnalysis`: 判断分析意图/should use analysis
  - `shouldUseFrontend`: 判断前端意图/should use frontend
  - `extractKeywordsFast`: 快速抽词/extract keywords
  - `getDefaultRecursionLimit`: 递归限制/default recursion limit

### chat.controller.ts
主对话控制器。
- **关键词**: controller, session-type
- **函数**:
  - `send`: 非流式发送/send
  - `stream`: 流式发送/stream
  - `createSession`: 创建会话/create session
  - `getMessages`: 获取消息/get messages
  - `deleteMessages`: 删除消息/delete messages

### chat.types.ts
类型定义。
- **关键词**: types
