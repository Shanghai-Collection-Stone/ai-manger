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
  - `getMessages`: 获取消息;checkpoint 存在但 channel_values.messages 为空、或 mongo 已有 assistant 消息时,**优先用 mongo storedMessages**(其 content 含 earlyEmit 旁路 fence canvas-it/handoff-it/tag-select-it,checkpoint 的 LLM messages 不含)。⚠️ **查 messages 集合时必须 delete 掉 sessionType 过滤** —— appendMessage 历史未写 sessionType 字段,带 sessionType 过滤会永远查空导致兜底失效;sessionId 全局唯一,sessionId+tenant+user 足够/get messages with storedMessages priority
  - `appendMessage`: 追加消息;**写入 messages doc 时带 sessionType 字段**(normalizeSessionType(scope.sessionType)),新数据自带会话类型;历史 doc 无此字段,getMessages 已去掉 sessionType 过滤兼容/append message with session type
  - `getConversation`: 获取会话元信息(返回 sessionId/sessionType/**actionSession**/title/lastCheckpointId)/get conversation meta
  - `setActionSession`: 🆕 持久化自动路由模式下最近一次路由到的专家(image/article/data/frontend/publisher/task),传 null 清空。sessionType 是会话隔离边界不能改,actionSession 是会话内部"当前激活专家"标记,供 chat-main 对确认、追问、补字段、补口径、tag 选择等短句做确定性承上路由;chat 路由会清空该状态/persist last routed expert as intent context hint
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

- **关键词**: message, entity, session-type
- `sessionType` 字段: 可选,新消息由 appendMessage 写入;历史 doc 无此字段

### conversation.entity.ts

会话实体定义。

- **关键词**: conversation, entity, session-type, action-session
- **字段**:
  - `sessionType` (`ConversationSessionType`): 会话隔离边界(default/thought/xhs-\* 等),决定会话历史/agent 路径
  - `actionSession` (`ConversationActionSession`) 🆕: 自动路由模式下最近一次路由到的专家(image/article/data/frontend/publisher/task),跨多轮持久化。sessionType 不变,actionSession 是会话内部"当前激活专家"标记,用于短句承上、业务追问、标签选择等确定性路由,chat 路由时清空

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
