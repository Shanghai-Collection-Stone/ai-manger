# Chat-Main Module

## 模块描述
主对话模块：支持流式与非流式交互，并提供上下文会话的增删改查能力；流式工具调用带超时保护，但 topic_orchestrate 不做超时限制。
文件路径: `src/modules/chat-main`

## 功能描述及关键词

### chat.service.ts
主对话服务。
- **关键词**: chat main, streaming, non-streaming, context, service, image upload, tool call, timeout, topic_orchestrate, task-it, xhs_batch_publish
- **函数**:
  - `send`: 发送/send
  - `stream`: 流式/stream
  - `getSmartContext`: 智能上下文/getSmartContext
  - `createSession`: 创建会话/createSession
  - `appendUser`: 追加用户/appendUser
  - `appendAssistant`: 追加助手/appendAssistant
  - `getMessages`: 获取消息/getMessages
  - `clearSession`: 清空会话/clearSession

### chat.controller.ts
主对话控制器。
- **关键词**: controller

### chat.types.ts
类型定义。
- **关键词**: types
