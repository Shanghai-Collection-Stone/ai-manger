# Chat-Main Module

## 模块描述

主对话模块：支持流式与非流式交互，并提供上下文会话的增删改查能力；流式工具调用带超时保护，但 topic_orchestrate 不做超时限制。针对生图/图组等工具密集链路，支持 updates-only 流模式与连接关闭后的中断保护。topic_orchestrate_subagent 支持 tag_select_request 收集 tags，并支持数据收集链路（analysis_subagent/task + data_analysis + duckduckgo 类 MCP 搜索）后再发起编排。主 LLM 与小红书生文专家支持文章库工具（列库、按标题/ID取二维码、Canvas 入库）。

**🆕 LangGraph Supervisor 架构(仅 default 模式)**：

- default 模式不再用 deepagents 的 task-tool 合流式 subagent,改用 LangGraph `StateGraph` + `Command(goto, graph=PARENT)` 真正切换控制权
- supervisor 节点(轻量 createReactAgent + 仅 1 个 `handoff_to_expert` 工具)只做路由,**不持有任何业务工具**
- default 模式 6 个专家节点: image_expert / article_expert / data_expert / frontend_expert / publisher_expert / task_expert,各自复用现有 SubAgent 的 prompt+tools(零重复代码,通过 `mapSubagentsToExpertSpecs` 映射)；xhs-specialist 同样走 supervisor,但映射到小红书专属数据追踪/生文/生图/发文/任务/可视化专家
- 专家完成后 goto END,主 agent 不二次推理,避免上一轮"主 agent 不信任 subagent 结果继续重做"的死循环
- **🆕 跨领域切换优先的 supervisor 意图识别**:default/xhs-specialist 模式每条用户消息先由代码层按固定优先级处理: 指挥官元问题/显式退出 → chat;tag 选择链路 → 延续当前 image/article 专家;明确命中不同业务领域关键词 → 直接切换对应专家;没有明确新领域但命中确认、追问、补字段、补口径等弱短句 → 延续当前 actionSession;仍不确定才调用轻量 LLM 分类;最后才落到 chat。业务专家命中会持久化 actionSession,chat 命中会清空 actionSession,避免 chat 兜底无限残留业务状态。
- 其他 sessionType (xhs-image-expert / xhs-tracker 等)保持原 deepagents 路径不动

**canvas-it 提前推送**：stream 路径在 finalScope 上注入 `earlyEmit(text)` 函数，xhs_create_image_group_canvas tool 在 createCanvas 成功的瞬间直接调用 earlyEmit，把 canvas-it 代码块作为 `token` 事件 push 到前端 SSE，并累加到 fullText；不再依赖子代理/主 agent 的 LLM 二次解码，首屏几乎零延迟。按 canvasId 去重，避免重复推送；最终落库由 `appendCanvasItIfNeeded` 兜底确保只保留一份 canvas-it。supervisor graph 模式下 earlyEmit 同样透传(scope 注入到所有 expert 节点的 tool 实例)。
图文生成专家在调用 topic_orchestrate 前必须确认生文风格；若最后一条用户要求未明确平台/文风，则先向用户询问“小红书/知乎/公众号/通用专业”等文风选择，并将确认后的 writingStyle 透传到选题与生文节点；小红书生文专家固定使用“小红书真实分享文风”，不再追问知乎/公众号/通用专业等文风。
文件路径: `src/modules/chat-main`

## 功能描述及关键词

### chat.service.ts

主对话服务。

- **关键词**: chat main, streaming, non-streaming, context, service, session-type, thought-route, tool-whitelist, article-library
- **函数**:
  - `send`: 非流式发送/send
  - `stream`: 流式发送;收到 agent 的 error 事件时,除了 safeSend 给前端,**额外 this.logger.error 完整打印 code + message + stack**。**stream 看门狗**: 启动 setInterval 监控,连续 3 分钟(STREAM_IDLE_TIMEOUT_MS)无任何 stream 事件视为 silent hang,主动 abortController.abort() → 前端收到 error 而非永久卡死。**🆕 中断补落库**: `fullText`(含 earlyEmit 推送的 canvas-it/handoff-it/tag-select-it fence)与 `assistantPersisted` 标记提到 try 外;stream 正常结束 appendMessage 后置 assistantPersisted=true;catch 分支若 assistantPersisted=false,把 sanitizeFinalText(fullText) 补写入 mongo —— 解决 stream 中断时 assistant 从不落库导致"用户已看到的卡片刷新后全消失"的根因/stream with watchdog and partial-persist on interruption
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
  - `sanitizeFinalText`: 清洗文本,剥离工具 JSON 头和可见伪工具调用(`[TOOL_CALL]`/minimax 私有标记)/sanitize text
  - `ensureStringArray`: 规范数组/ensure string array
  - `provisionalTitle`: 预置标题/provisional title
  - `getDataAnalysisPromptCN`: 系统提示;约束工具必须走结构化 tool call,禁止输出 `[TOOL_CALL]`/minimax/XML/JSON 伪工具调用文本/data analysis prompt
  - `getSystemPromptCN`: 模式提示/system prompt
  - `getThoughtPromptCN`: 思维链提示/thought prompt
  - `getXhsSpecialistPromptCN()`: 小红书主专家提示词,仅保留简单对话/能力说明/路由入口职责,禁止直接执行业务工具 | keywords: 小红书专家, 能力介绍, xhs-specialist, routing-entry
  - `getXhsArticleExpertPromptCN()`: 小红书生文专家提示词,固定使用小红书真实分享文风,不再追问知乎/公众号/通用专业文风；支持 xhs_list_unused_image_groups 查询未使用图组，指定 imageGroupCanvasIds 生文后由工作流自动标记源图组已使用 | keywords: 小红书生文, 固定文风, 未使用图组, xhs-article-expert, writing-style
  - `getXhsImageExpertPromptCN()`: 小红书生图专家提示词,创建/查询图组 Canvas，并支持 xhs_list_unused_image_groups 查询未被生文消费的可用图组 | keywords: 小红书生图, 未使用图组, xhs-image-expert, image-group
  - `buildGallerySubagent`: 构建图库子代理(仅负责图库搜图/详情查询;**图组 Canvas 创建已改为主 agent 直接调 xhs_create_image_group_canvas**,避免 subagent LLM 推理阻塞 canvas-it earlyEmit 推送;明确图文/正文/全套请求交给图文生成专家)/build gallery subagent
  - `buildDefaultSubagents`: 子代理配置。default 模式 6 个子代理: analysis_subagent(数据查询/分析 + 决策卡)、topic_orchestrate_subagent(文章)、frontend_subagent(图表/看板)、ops_subagent(批量发布/robot 发布执行)、task_subagent(任务编排)、gallery_subagent(图组/图库)；xhs-specialist 模式改为小红书专属 6 个专家: xhs_data_tracker_subagent、xhs_article_expert_subagent、xhs_image_expert_subagent、xhs_publish_subagent、xhs_task_subagent、xhs_visual_report_subagent。统一通过 `injectMiddleware` 给每个 SubAgent 注入 `agent.buildSubagentSanitizeMiddleware()`/build default subagents with xhs specialist dispatch
  - `buildXhsSpecialistSubagents(envStr, allTools, toolSets)`: 构建小红书主专家自动路由的 6 个专属专家定义,并按数据追踪/生文/生图/发文/任务/可视化切分工具池；生文/生图专家工具池包含 xhs_list_unused_image_groups | keywords: 小红书专家, 专家直派, 子领域路由, 未使用图组, xhs-specialist-subagents, expert-dispatch
  - `resolveSubagentToolSets`: 把全量工具切成各专家工具集 —— analysis(数据源+搜索+决策卡)、topicOrchestrate(topic*orchestrate + tag_select_request + 数据收集/搜索)、frontend、ops(robot_list+dashboard_config_patch+剩余 MCP,\*\*不含 todo*\*\_)、task(`todo\__` 全家桶)、gallery/resolve subagent tool sets
  - `loadHistoryAsBaseMessages(sid, scope)`: 🆕 从 ctx 拉对话历史(ContextMessage[]) 转 BaseMessage[](user→HumanMessage / assistant→AIMessage, system 不复用)。default 模式下完整历史喂给业务专家执行;其他 sessionType 保持 deepagents checkpoint 自动加载/load history as base messages
  - `simplifyHistoryForRouting(history)`: 🆕 把历史"简化"成纯自然语言对话 —— 剥掉 AI 消息里的 earlyEmit 卡片 fence(canvas-it/handoff-it/tag-select-it/task-it/decision-it,含未闭合兜底)和 minimax 私有工具调用伪文本(`<minimax:tool_call>`/`<invoke>`/`<parameter>`),清洗后为空的纯卡片回复直接丢弃;用户消息保持原样。**意图识别 + chat 专家用简化历史**(否则 minimax 看到历史里的卡片/工具调用会被带偏,把自己当执行者去虚拟造一个 tag-select 卡片或 tool_call,而非老实分类/闲聊);业务专家用完整历史/simplify history strip cards and tool-call artifacts
  - `getSupervisorPromptCN(envContext, currentActionSession?)`: 🆕 意图识别 LLM 系统提示词。**固定格式输出**: 强约束 LLM **整条回复只能是一个路由词**(image/article/data/frontend/publisher/task/chat),不带标点/解释/前后缀;输入是一条 JSON 化 user 消息(currentActionSession/latestUserMessage/fullDialog/recentDialog),要求优先判定 latestUserMessage,再结合完整历史与最近片段判断延续;**明确"只做分类不执行",严禁输出 tag-select/canvas-it 等代码块/卡片/工具调用,哪怕历史里有也不模仿**。归类规则: 闲聊/问指挥官/与 6 专家无关 → chat;明确图文/正文/文章/全套/也写文时 → article,即便同时出现配图/图组;纯图组/配图/封面 → image;tag-select 回传延续上一轮 image/article 专家;其他 6 类业务请求 → 对应专家词(data 含方案/决策/策略;publisher=批量发布,task=任务编排,两者区分);延续上轮任务 → 对应专家词/intent recognition fixed-format prompt
  - `getSupervisorPromptBySession(sessionType, envContext, currentActionSession?)`: 按 sessionType 选择指挥官或小红书专家的意图识别提示词 | keywords: 意图识别, 小红书路由, supervisor-prompt, xhs-routing
  - `getXhsSupervisorPromptCN(envContext, currentActionSession?)`: 小红书专家意图识别提示词,固定输出 image/article/data/frontend/publisher/task/chat,结合 fullDialog 承上判断；小红书主专家仅做简单对话,业务必须路由给小红书专属专家,并禁止伪工具调用 | keywords: 小红书意图识别, 专家直派, xhs-intent-routing, expert-dispatch
  - `getChatExpertPromptCN(envContext)`: 🆕 chat 兜底入口提示词。只允许接待、简单闲聊、能力说明和单问题澄清;空工具,禁止业务执行口吻和伪工具调用,业务能力交由对应专家完成/build chat expert prompt
  - `getChatExpertPromptBySession(sessionType, envContext)`: 按 sessionType 选择普通 chat 专家或小红书通用对话专家提示词 | keywords: 闲聊专家, 小红书专家, chat-expert-prompt, xhs-chat
  - `getXhsChatExpertPromptCN(envContext)`: 小红书专家 chat 兜底入口提示词,只做闲聊/能力说明/澄清,禁止直接生成图文、图片方案、数据结论、发布计划或伪工具调用 | keywords: 小红书闲聊, 能力介绍, xhs-chat-expert, capability-intro
  - `getHandoffDisplayMeta(sessionType, route)`: 生成 handoff-it 卡片的专家标签、图标和原因前缀,支持小红书专属专家展示名 | keywords: 路由胶囊, 小红书专家, handoff-display, xhs-routing
  - `mapSubagentsToExpertSpecs`: 🆕 把 buildDefaultSubagents 返回的 SubAgent 数组按 `name → ExpertName` 映射成 ExpertSpec 数组 (analysis_subagent→data, topic_orchestrate_subagent→article, frontend_subagent→frontend, ops_subagent→publisher, task_subagent→task, gallery_subagent→image；小红书 xhs_data_tracker_subagent/xhs_article_expert_subagent/xhs_image_expert_subagent/xhs_publish_subagent/xhs_task_subagent/xhs_visual_report_subagent 映射到对应专家),**零重复代码,直接复用现有 prompt+tools**/map subagents to expert specs

### supervisor-graph.service.ts 🆕

意图识别 + 专家直派服务(**不再使用 LangGraph StateGraph**)。

- **关键词**: 意图识别, 路由, 专家直派, intent, route-token, react-agent, early-emit
- **类型**:
  - `ExpertName`: 6 个业务专家联合类型('image'|'article'|'data'|'frontend'|'publisher'|'task');data 含决策卡,publisher=批量发布,task=任务编排(待办/工单)
  - `RouteTarget`: 意图识别路由目标 = ExpertName | 'chat'
  - `ExpertSpec`: 专家配置 ({ name, description, systemPrompt, tools })
  - `RecognizeIntentOptions`: recognizeIntent 入参 (systemPrompt + 清洗历史 + llm + currentActionSession;内部构造 fullDialog 完整历史与 recentDialog 最近上下文)
  - `BuildExpertAgentOptions`: buildExpertAgent 入参 (route + experts + chatExpertPrompt + expertLLM + chatLLM + checkpointer)
- **函数(模块级)**:
  - `parseRouteToken(text)`: 从意图识别 LLM 纯文本回复硬解析路由 token(先 trim+lowercase 整体比对;非精确回复只在全文唯一出现一个 route 词时采信,多路由词解释返回 null)
  - `inferExpertByKeyword(text)`: 关键词规则推断专家(图组/文章/数据+决策/营业额/营收/需求工作流/图表/批量发布/任务编排),LLM 没吐出可识别 token 时兜底；图文/正文/文章/全套 等生文意图优先于配图/图组关键词
  - `isCommanderMetaQuestion(text)`: 识别"你能干嘛/你能做什么/怎么用"等指挥官元问题,强制走 chat | keywords: 指挥官元问题, 能力询问, 意图识别, commander-meta-question, capability-query, intent-routing
  - `truncateIntentText(text, maxLength)` / `buildDialogTurns(history)` / `buildRecentDialogTurns(history)` / `isTagWorkflowText(text)` / `buildIntentContextMessage(history, currentActionSession)`: 把完整清洗历史与最近 10 组对话整理为一条 JSON user message 供意图识别,并识别 tag/标签选择链路的承接意图 | keywords: 意图识别, 结构化上下文, 标签选择, intent-context, full-json-history, recent-json-history, tag-workflow
  - `isActionExitText(text)` — 识别用户明确结束当前业务链路或切回普通对话 | keywords: 退出业务, 闲聊切换, 意图识别, action-exit, chat-switch, intent-routing
  - `isBusinessFollowUpText(text)` — 识别业务链路里的追问、核对、补字段、补口径等短句承接 | keywords: 业务追问, 专家承接, 意图识别, business-follow-up, action-continuation, intent-routing
  - `isContinuationText(text)` — 识别确认、继续、开始生成、时间范围补充等承接口吻 | keywords: 意图承接, 专家延续, continuation-intent, intent-routing
  - `shouldContinueCurrentAction(text, currentActionSession)` — 有 actionSession 时判断是否优先延续上一轮专家 | keywords: 意图识别, 专家延续, 上下文路由, action-continuation, intent-routing
  - `extractMessageText(content)` — 从 string 或多模态消息数组提取纯文本 | keywords: extract plain text from message content
- **类方法**:
  - `recognizeIntent(opts)`: 🆕 **第一步:意图识别**。优先级固定为: 元问题/显式退出 → chat;tag 选择链路 → 当前 image/article 专家;明确跨领域关键词 → 新专家;弱短句承上/业务追问 → 当前 actionSession;仍不确定才调用轻量 LLM `invoke([SystemMessage(prompt), HumanMessage(JSON化 fullDialog/recentDialog)])`;解析不到再兜底 chat。**永远返回有效 RouteTarget,绝不抛错**/recognize intent via standalone llm call
  - `buildExpertAgent(opts)`: 🆕 **第二步:专家直派**。按 route 在代码层选定单个专家,构建 `createReactAgent` 实例(route='chat'→chatLLM+空工具+chatExpertPrompt;业务专家→expertLLM+spec.tools+spec.systemPrompt;绑 checkpointer)。返回值交给 `AgentService.stream` 当 `preBuiltAgent` 正常流式消费,**原有 stream 处理逻辑(token 累加/SSE/落库)完全不变**。放弃 StateGraph: supervisor 作图节点时 minimax 会被多代理执行上下文带偏(模仿历史里的工具调用文本、不老实输出路由词),拆成"独立意图调用+代码选专家"后路由层与执行层彻底解耦/build single expert agent by route
  - `shouldUseSupervisor(sessionType)`: 'default' 与 'xhs-specialist' 返回 true,其他显式专家 sessionType 保留原 deepagents 路径
  - `filterSubagentOnlyTools`: subagentOnly 集合中**只保留 topic_orchestrate / xhs_list_canvases / xhs_get_canvas_detail**;xhs_create_image_group_canvas 故意从 subagentOnly 移除,允许主 agent 直接调,工具内部 fire-and-forget 异步生图 + earlyEmit 即时推 canvas-it,主 agent 路径无 LLM 阻塞/filter subagent only tools
  - `buildDefaultSubagents`: 子代理配置（xhs-specialist 使用小红书专属 6 专家自动路由）/build default subagents
  - `getTools`: 获取工具/get tools
  - `getRequestScope`: 解析租户范围/get request scope
  - `getToolsForInput`: 工具过滤；图文/文章意图保留 topic_orchestrate + tag_select_request/get tools for input
  - `buildDefaultSubagents`: 子代理配置/build default subagents
  - `normalizeSubagentTools`: 规范工具/normalize subagent tools
  - `isBatchPublishIntent`: 批量发布意图/batch publish intent
  - `isTopicOrchestrateIntent`: 选题/图文/正文/文章编排意图/topic orchestrate intent
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
