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
  - `runAiCoverGenerateTool`: AI封面生成工具入口（默认模型与meitu复用同一最终prompt；请求底图编辑时优先走runtime编辑）/ai cover generate tool
  - `generateImageByRuntime`: 按默认提供商执行生图/图片编辑并返回图片/generate image by configured runtime
  - `buildMeituEditPrompt`: 构建封面编辑增强提示词（复用于默认模型与meitu，强调标题浮动文字与小红书风格）/build meitu image edit prompt
  - `resolveMeituEditableBaseImage`: 匹配可编辑底图（优先调用方传入候选）/resolve meitu editable base image
  - `generateImageByMeituSkill`: 使用 meitu-cli image-edit 执行封面编辑兜底/generate image by meitu image-edit fallback
  - `sendPrompt`: 调用AI封面生成工具生图（入参为prompt/size/底图候选）/send prompt for image generation
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
