# Chat-Main Module

## 模块描述
主对话模块：支持流式与非流式交互，并提供上下文会话的增删改查能力；流式工具调用带超时保护，但 topic_orchestrate 不做超时限制。针对生图/图组等工具密集链路，支持 updates-only 流模式与连接关闭后的中断保护。topic_orchestrate_subagent 支持数据收集链路（analysis_subagent/task + data_analysis + duckduckgo 类 MCP 搜索）后再发起编排。主 LLM 与小红书生文专家支持文章库工具（列库、按标题/ID取二维码、Canvas 入库）。
**canvas-it 提前推送**：stream 路径在 finalScope 上注入 `earlyEmit(text)` 函数，xhs_create_image_group_canvas tool 在 createCanvas 成功的瞬间直接调用 earlyEmit，把 canvas-it 代码块作为 `token` 事件 push 到前端 SSE，并累加到 fullText；不再依赖子代理/主 agent 的 LLM 二次解码，首屏几乎零延迟。按 canvasId 去重，避免重复推送；gallery_subagent prompt 明确告知 tool 已推送，禁止再输出 canvas-it 块；最终落库由 `appendCanvasItIfNeeded` 兜底确保只保留一份 canvas-it。
文件路径: `src/modules/chat-main`

## 功能描述及关键词

### chat.service.ts
主对话服务。
- **关键词**: chat main, streaming, non-streaming, context, service, session-type, thought-route, tool-whitelist, article-library
- **函数**:
  - `send`: 非流式发送/send
  - `stream`: 流式发送;收到 agent 的 error 事件时,除了 safeSend 给前端,**额外 this.logger.error 完整打印 code + message + stack**,确保后端日志能看到与前端一致的诊断信息/stream with full error log
  - `createSession`: 创建会话/create session
  - `appendUser`: 追加用户/append user
  - `appendAssistant`: 追加助手/append assistant
  - `getMessages`: 获取消息（对 assistant content 幂等重建 canvas-it/task-it/decision-it 块，stream 中断导致 MongoDB 未保存 content 时从 checkpoint tool_results 兜底）/get messages
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
  - `buildGallerySubagent`: 构建图库子代理(仅负责图库搜图/详情查询;**图组 Canvas 创建已改为主 agent 直接调 xhs_create_image_group_canvas**,避免 subagent LLM 推理阻塞 canvas-it earlyEmit 推送)/build gallery subagent
  - `buildDefaultSubagents`: 子代理配置;**统一通过 `injectMiddleware` 给每个 SubAgent 注入 `agent.buildSubagentSanitizeMiddleware()`** —— deepagents 1.8.2 不会把主 agent customMiddleware 透传给 subagent 的内部 createAgent,subagent 自己 model 调用就拿不到 sanitize/诊断 log,出错时只看到 patchToolCallsMiddleware 抛 `expected AIMessage or Command, got object` 而没有原始数据,故必须显式注入到每个 SubAgent.middleware 字段/build default subagents with sanitize middleware injection
  - `filterSubagentOnlyTools`: subagentOnly 集合中**只保留 topic_orchestrate / xhs_list_canvases / xhs_get_canvas_detail**;xhs_create_image_group_canvas 故意从 subagentOnly 移除,允许主 agent 直接调,工具内部 fire-and-forget 异步生图 + earlyEmit 即时推 canvas-it,主 agent 路径无 LLM 阻塞/filter subagent only tools
  - `buildDefaultSubagents`: 子代理配置（xhs-specialist新增：xhs_data_tracking/xhs_publish）/build default subagents
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
