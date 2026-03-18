# Ai-Agent Module

## 模块描述
AI Agent模块：使用DeepAgent统一封装多模型对话能力与子代理流式执行。
文件路径: `src/modules/ai-agent`

## 功能描述及关键词

### agent.service.ts
核心服务逻辑。
- **关键词**: agent, deepagent, service, run, build model, provider-runtime, db-config, message convert, handle, stream
- **函数**:
  - `getHandle`: 函数句柄/handle
  - `buildChatModel`: 构建模型/build model
  - `resolveDefaultRuntime`: 解析默认运行时/resolve runtime
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
