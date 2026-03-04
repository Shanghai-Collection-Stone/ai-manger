# Context Module

## 模块描述
基础上下文模块：会话与消息的持久化与读取能力。
文件路径: `src/modules/context`

## 功能描述及关键词

### context.service.ts
上下文服务，提供会话和消息的CRUD操作。
- **关键词**: context, service, create session, append message, get messages, clear session, build memory
- **函数**:
  - `createSession`: 创建会话/create session
  - `appendMessage`: 追加消息/append message
  - `getMessages`: 获取消息/get messages
  - `clearSession`: 清空会话/clear session
  - `buildMemory`: 构造内存/build memory

### message.entity.ts
消息实体定义。
- **关键词**: message, entity

### conversation.entity.ts
会话实体定义。
- **关键词**: conversation, entity

### context.enums.ts
枚举定义。
- **关键词**: enums

### context.types.ts
类型定义。
- **关键词**: types

### context.cache.ts
缓存层实现。
- **关键词**: cache

### context.controller.ts
控制器层。
- **关键词**: controller
