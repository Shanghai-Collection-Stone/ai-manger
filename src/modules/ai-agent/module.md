# Ai-Agent Module

## 模块描述
AI Agent模块：使用DeepAgent统一封装多模型对话能力与子代理流式执行。
文件路径: `src/modules/ai-agent`

## 功能描述及关键词

### agent.service.ts
核心服务逻辑。
- **关键词**: agent, deepagent, service, run, build model, provider-runtime, db-config, message convert, handle, stream, image generation, send prompt
- **函数**:
  - `getHandle`: 函数句柄/handle
  - `buildChatModel`: 构建模型/build model
  - `resolveDefaultRuntime`: 解析默认运行时/resolve runtime
  - `resolveDefaultImageRuntime`: 解析默认生图运行时/resolve default image runtime
  - `resolveAvailableDefaultImageRuntime`: 解析可用默认生图运行时（无完整配置返回null）/resolve available default image runtime
  - `runAiCoverGenerateTool`: AI封面生成工具入口（默认模型与meitu复用同一最终prompt；请求底图编辑时优先走runtime编辑；runtime 返回 IMAGE_*_EDIT/GENERATE_FAILED 或 IMAGE_PROVIDER_NOT_SUPPORTED 时自动降级 meitu-cli）/ai cover generate tool
  - `generateImageByRuntime`: 按默认提供商执行生图/图片编辑并返回图片。doubao/ark 文生图与图生图共用 /images/generations（无 /images/edits），图生图通过 body 的 image 字段传单字符串（URL 或 data:<mime>;base64,<b64>）；size 严格按 Seedream 5.0 lite 规则归一化：档位 2K/3K 透传，合法像素透传，否则按宽高比匹配官方推荐 2K 档表（1:1→2048x2048、3:4→1728x2304、16:9→2848x1600 等），无识别项回退 2048x2048/generate image by configured runtime
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
  - `stream`: 流式/stream

### agent.types.ts
类型定义。
- **关键词**: types

### agent.enums.ts
枚举定义。
- **关键词**: enums
