# Ai-Agent Module

## 模块描述
AI Agent模块：使用DeepAgent统一封装多模型对话能力与子代理流式执行。
文件路径: `src/modules/ai-agent`

## 功能描述及关键词

### agent.service.ts
核心服务逻辑。
- **关键词**: agent, deepagent, service, run, build model, provider-runtime, glm, z.ai, zhipu, openai-compatible, db-config, message convert, handle, stream, image generation, send prompt
- **函数**:
  - `getHandle`: 函数句柄/handle
  - `buildChatModel`: 构建模型（GLM国际端z.ai走OpenAI兼容协议；baseUrl留空由resolveProviderDefaultBaseUrl兜底）/build model
  - `getCheckpointer`: 🆕 公开 MongoDBSaver 实例,供 chat.service supervisor graph 复用同一个 checkpointer + 同一个 thread_id,实现 multi-agent graph 多轮对话 state 持久化(否则 supervisor 每次只看一条用户消息会导致路由误判)/expose checkpointer for supervisor graph
  - `buildLLM`: 构建 BaseChatModel。**配置来源**: config 显式传入 provider+model 时优先用 config(如 keyword.service 的专用 LLM),否则回退 admin 默认 runtime —— 之前无条件用 resolveDefaultRuntime,导致 config 传入的 provider/model/apiKey/baseUrl 被忽略。启动时 logger.log 实际生效的 provider/model/baseUrl/source,便于排查 NVIDIA 等 OpenAI 兼容厂商 `404 page not found`(baseUrl 配错)问题/build llm with config override
  - `isImageOnlyModel`: 识别 model 名是否生图专用模型(gpt-image-* / dall-e* / seedream / flux- / stable-diffusion / midjourney),用于 buildLLM 入口防止用户把生图模型误配为 chat 默认运行时(会导致 wrapModelCall 返回非 AIMessage 触发 `expected AIMessage or Command, got object`)/detect image-only model
  - `resolveProviderDefaultBaseUrl`: 厂商默认baseUrl兜底（deepseek/nvidia/minimax/glm；glm默认走z.ai Coding Plan入口/api/coding/paas/v4）/resolve provider default base url
  - `buildOpenAICompatSanitizeMiddleware`: 构建 deep agent middleware(挂在 wrapModelCall 钩子最内层)，在每次 model 调用前清洗 messages，避免 GLM/z.ai/DeepSeek 等 OpenAI 兼容端被 thinking/reasoning 等非标准 content block 拒收(400 content[0].type type error)。**handler 返回值也经 ensureValidModelResponse 兜底**，避免下游 patchToolCallsMiddleware 报 `expected AIMessage or Command, got object`/build openai compat sanitize middleware
  - `buildSubagentSanitizeMiddleware`: 公开版,供 chat.service 在构造 subagent 时调用,把 sanitize+诊断 middleware 也注入到每个 subagent 的 middleware 列表(deepagents 1.8.2 默认不会把主 agent 的 customMiddleware 透传给 subagent 内部的 createAgent,subagent 自己的 model 调用得不到 sanitize 兜底/诊断 log,故必须通过 SubAgent.middleware 字段显式注入)/expose sanitize middleware factory for subagent injection
  - `sanitizeMessagesForOpenAICompat`: 清洗 messages content 数组——HumanMessage 保留多模态块(text/image_url/image/input_audio/file/data block)，其他角色只取 text 拍平字符串/sanitize messages for openai compat
  - `rebuildMessageWithContent`: 用原 message 同类型 constructor 重建消息(AIMessage/ToolMessage/SystemMessage/HumanMessage)，仅替换 content，保留 LangChain 内部 MESSAGE_SYMBOL 等 instance 标记，避免 wrapModelCall 链路报 `expected AIMessage or Command, got object`/rebuild message via constructor
  - `ensureValidModelResponse`: wrapModelCall handler 返回值类型适配。AIMessage/AIMessageChunk/Command/structuredResponse 原样放行;**`ChatMessage` / `ChatMessageChunk` 转为 `AIMessageChunk`** —— GLM/z.ai 等 OpenAI 兼容厂商在 cached_tokens 命中后的空 content chunk 中 `role` 字段不是 `"assistant"`,LangChain ChatOpenAI 用通用 ChatMessageChunk 包装(其 type === "generic" 不满足 `AIMessage.isInstance` 的 `type === "ai"` 检查),需要 rebuild 为 AIMessageChunk 保留 content/tool_calls/response_metadata/id/usage_metadata;其他未知类型把原始 result 完整 JSON 化(ctor name, keys) 用 logger.error 打印让框架自然抛错/convert ChatMessageChunk to AIMessageChunk for openai-compat providers
  - `resolveDefaultRuntime`: 解析默认运行时/resolve runtime
  - `resolveDefaultImageRuntime`: 解析默认生图运行时/resolve default image runtime
  - `resolveAvailableDefaultImageRuntime`: 解析可用默认生图运行时（无完整配置返回null）/resolve available default image runtime
  - `runAiCoverGenerateTool`: AI封面生成工具入口（默认模型与meitu复用同一最终prompt；请求底图编辑时优先走runtime编辑；runtime 返回 IMAGE_*_EDIT/GENERATE_FAILED 或 IMAGE_PROVIDER_NOT_SUPPORTED 时自动降级 meitu-cli）/ai cover generate tool
  - **`imageGenDispatcher`**: 生图专用 undici dispatcher(实例字段)。headersTimeout/bodyTimeout=15 分钟覆盖 undici 默认 5 分钟。**代理**: 生图 fetch 显式传 dispatcher 会覆盖 `enableProxyFromEnv` 设的全局 dispatcher,故本 dispatcher 自行叠加代理 —— 复用 `shared/network/proxy.ts` 的 `resolveProxyUriFromEnv()` 读 .env 统一代理配置(DEV_PROXY_ENABLED/DEV_HTTPS_PROXY 或 PROXY_ENABLED/HTTPS_PROXY),**不另开独立环境变量**。有代理→ProxyAgent(长超时),无代理→Agent(长超时直连)。constructor 启动 log 当前代理状态/image gen dispatcher reusing unified env proxy
  - `generateImageByRuntime`: 按默认提供商执行生图/图片编辑并返回图片。已对接 gemini / doubao(ark) / openai。doubao/ark 文生图与图生图共用 /images/generations（无 /images/edits），图生图通过 body 的 image 字段传单字符串（URL 或 data:<mime>;base64,<b64>）；size 严格按 Seedream 5.0 lite 规则归一化：档位 2K/3K 透传，合法像素透传，否则按宽高比匹配官方推荐 2K 档表（1:1→2048x2048、3:4→1728x2304、16:9→2848x1600 等），无识别项回退 2048x2048。openai gpt-image-1/2：文生图 POST /images/generations、图生图 POST /images/edits（multipart, image=底图二进制，n=1）；size 自动映射 1024x1024 / 1024x1536 / 1536x1024 / auto；**fetch 双层超时机制**: AbortSignal.timeout(10 分钟) + 实例级 `imageGenDispatcher` (undici Agent, headersTimeout/bodyTimeout=15 分钟) 覆盖 Node fetch 默认 undici 5 分钟 headersTimeout(否则 gpt-image 生图常在 5min 抛 `HeadersTimeoutError: UND_ERR_HEADERS_TIMEOUT`)；捕获 undici "fetch failed" 时把 error.cause 序列化(ConnectTimeoutError/SocketError/ENOTFOUND/CertificateError 等)落日志并抛 IMAGE_OPENAI_EDIT_NETWORK/IMAGE_OPENAI_GENERATE_NETWORK/generate image by configured runtime
  - `formatFetchCause`: 递归序列化 fetch error.cause 为可读字符串，定位 DNS/TLS/socket/连接超时类失败/format fetch error cause
  - `buildMeituEditPrompt`: 构建封面编辑提示词（上层传入选题/主副标题等元信息，本函数追加"硬性规格-必须严格遵守"的 7 条编号约束：任务/底图识别度/文案呈现/装饰元素/风格/尺寸/输出纯净度。识别度规则放宽：允许风格化重绘/动画化/夸张表情，只要主体身份与场景识别度保留即可）/build meitu image edit prompt with hard constraints
  - `resolveMeituEditableBaseImage`: 匹配可编辑底图（优先调用方传入候选）/resolve meitu editable base image
  - `generateImageByMeituSkill`: 使用 meitu-cli image-edit 执行封面编辑兜底（stdout 非 JSON 时走 parseMeituKeyValueText 扁平 key-value 兜底；result 字段取 http(s) URL 作为最终图片地址）/generate image by meitu image-edit fallback
  - `parseMeituKeyValueText`: 解析 meitu-cli "code: 0 message: success result: https://... progress: 1" 这类扁平键值空格串（即使加 --json CLI 仍可能如此输出）/parse meitu cli flat key value text
  - `sendPrompt`: 调用AI封面生成工具生图（入参为prompt/size/底图候选）/send prompt for image generation
  - `saveGeneratedImageBuffer`: AI 生图落盘前经 AntiDetectionService 抗AI识别处理（元数据剥离/像素扰动/噪点/重采样）/ persist generated image buffer with anti detection
  - `run`: 运行/run
  - `runWithMessages`: 消息运行/run with messages
  - `runSubAgentWithMessages`: 子代理消息运行/run subagent with messages
  - `normalizeMessages`: 规范消息/normalize messages
  - `extractStateMessages`: 提取消息/extract state messages
  - `parseStreamPayload`: 解析流式载荷/parse stream payload
  - `normalizeTools`: 规范工具/normalize tools
  - `normalizeContextSchema`: 规范上下文schema/normalize context schema
  - `toAsyncIterable`: 规范流式/normalize stream iterable
  - `toMessages`: 消息转换/message convert
  - `stream`: 流式;catch 用 this.logger.error 打完整 stack + 递归 cause chain(避免被 console.error 在某些 logger 环境下吞掉),确保后端日志能看到与前端 SSE 错误事件相同的完整诊断信息。**支持 `input.preBuiltAgent` 参数**:外部(chat.service supervisor 路径)可直接传入已构建的 LangGraph CompiledStateGraph(如 SupervisorGraph),跳过 buildChatModel,使 multi-agent graph 接入现有 [namespace, mode, data] 三元组 stream 事件处理逻辑。**🆕 isAIChunk 文本提取支持 Anthropic content block 数组** —— minimax 走 ChatAnthropic 返回 `[{type:'thinking',...},{type:'text',text:'...'}]`,旧代码 `typeof content==='string'` 失败 → textStr='' → fullText=0 → 前端"无内容";现按 string / block 数组分别提取(数组取 type==='text' 的 block,跳过 thinking)。**🆕 preBuiltAgent 模式**: (1) 所有 isAIChunk 一律按主输出处理(isSubagent 判定是为 deepagents task 子代理设计的,supervisor graph 节点输出都是主输出); (2) **只累加真正的流式增量 chunk,跳过完整 AIMessage**: chat.service 把完整历史 messages 注入 graph input,会被 messages streamMode 当完整 AIMessage emit,若累加会把上一轮 fence/文字"重放"进本轮 fullText。**⚠️ chunk 判定必须用 `message.constructor.name === 'AIMessageChunk'`,不能用 `message['type']`** —— message 是 AIMessageChunk 实例时 `['type']` 是 undefined(实例只有 `_getType()` 方法,无 type 属性),旧代码 `msgType!=='AIMessageChunk'` 恒真,把 preBuiltAgent 模式下**每个 token 都跳过** → fullText 永远 0 → 前端"无内容"(supervisor 直接回答 / chat_expert 闲聊全空的根因)/stream with pre-built agent main-output handling and history-replay guard
  - `collectCauseChain`: 递归提取 Error.cause 链(undici fetch failed / langchain MiddlewareError 等多层嵌套),格式化为 `Name:Code:Message <- ...`/collect error cause chain
  - `normalizeStreamError`: 把 raw error 归一化成 {code, message} 给前端;code 提取 regex 要求 ≥3 个大写字母+冒号(避免把句首字母 "I" 误当 code)/normalize stream error

### agent.types.ts
类型定义。
- **关键词**: types

### agent.enums.ts
枚举定义。
- **关键词**: enums
