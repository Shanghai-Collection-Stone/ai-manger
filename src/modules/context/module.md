# Context Module

## 模块描述
基础上下文模块：会话与消息的持久化与读取能力。
文件路径: `src/modules/context`

## 功能描述及关键词

### context.service.ts
上下文服务，提供会话和消息的CRUD操作。
- **关键词**: context, service, create session, append message, get messages, clear session, build memory, session-type, thought
- **函数**:
  - `createSession`: 创建会话/create session
  - `createSessionWithScope`: 创建范围会话/create scoped session
  - `appendMessage`: 追加消息/append message
  - `getMessages`: 获取消息/get messages
  - `getScopedConversations`: 获取范围会话/get scoped conversations
  - `clearSessionWithScope`: 清空范围会话/clear scoped session
  - `clearSession`: 清空会话/clear session
  - `buildMemory`: 构造内存/build memory
  - `buildConversationsListFilter`: 构建会话列表过滤/build conversations list filter
  - `buildConversationsListReadFilter`: 构建会话列表读取过滤/build conversations list read filter
  - `buildConversationFilter`: 构建会话过滤/build conversation filter
  - `buildConversationReadFilter`: 构建会话读取过滤/build conversation read filter
  - `buildScopeReadOr`: 构建读取范围or/build read scope or condition
  - `isDuplicateKeyError`: 重复键检测/detect duplicate key error
  - `isConversationInScope`: 会话范围兼容校验/validate conversation scope compatibility

### message.entity.ts
消息实体定义。
- **关键词**: message, entity

### conversation.entity.ts
会话实体定义。
- **关键词**: conversation, entity, session-type

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
- **关键词**: controller, session-type-filter
