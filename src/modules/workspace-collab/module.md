# Workspace-Collab Module

## 模块描述
工作区协作模块(v2)，为工作区内页提供三块真实数据：Agent 通讯录、会话与消息、任务与跟进记录。所有端点挂在 `api/v2/workspaces/:workspaceId` 下，按后台 JWT + CASL 鉴权(subject `WorkspaceAgent` / `WorkspaceConversation` / `WorkspaceTask`)，租户与工作区边界统一由 `WorkspaceCollabContextService.requireWorkspace` 复用 `WorkspaceService.get` 强制。附件不另存二进制，只引用租户网盘 `disk_nodes` 中的真实文件节点(前端先经 `/api/v2/netdisk/files` 上传)。增删改自动埋点审计(`workspaceAgent.*` / `workspaceConversation.*` / `workspaceTask.*`)。
文件路径: `src/modules/workspace-collab`
路由前缀: `api/v2/workspaces/:workspaceId`
集合: `workspace_agents`、`workspace_conversations`、`workspace_conversation_messages`、`workspace_tasks`、`workspace_task_followups`
已知限制:
- Agent 自动回复依赖 chat-main 运行时，只有 `aiEnabled=true` 的 Agent 才会生成回复(默认仅"通用助手")；模型服务未配置时接口返回 `replyError`，成员消息照常落库，不写入任何占位回复。
- 会话消息为同步请求-应答，未接 SSE 流式；流式可后续复用 `chat/stream`。
- 删除 Agent 不级联删除历史会话，历史会话保留冗余的 `agentName`。

## 功能描述及关键词

### services/workspace-collab-context.service.ts
协作公共服务：工作区归属校验、网盘附件解析、ObjectId 转换、审计埋点。
- **关键词**: workspace-scope, attachment, audit, tenant-isolation, mongo
- **函数**:
  - `requireWorkspace`: 读取工作区并校验租户边界/require workspace | keywords: require-workspace
  - `resolveAttachments`: 校验网盘节点并返回附件快照/resolve attachments | keywords: resolve-attachments
  - `toId`: 转换并校验 ObjectId/to object id | keywords: to-object-id
  - `displayName`: 展示用作者名/display name | keywords: display-name
  - `audit`: 协作审计埋点/write collab audit | keywords: write-collab-audit

### services/workspace-agent.service.ts
Agent 通讯录服务，租户级目录，首次读取写入默认 Agent 种子。
- **关键词**: agent, contacts, seed, tenant, crud
- **函数**:
  - `ensureIndexes`: 初始化 Agent 索引/ensure workspace agent indexes | keywords: ensure-workspace-agent-indexes
  - `list`: Agent 通讯录/list workspace agents | keywords: list-workspace-agents
  - `getByKey`: 按键读取 Agent/get workspace agent by key | keywords: get-workspace-agent-by-key
  - `create`: 新增 Agent/create workspace agent | keywords: create-workspace-agent
  - `update`: 更新 Agent(可用状态与 AI 开关)/update workspace agent | keywords: update-workspace-agent
  - `remove`: 删除 Agent/delete workspace agent | keywords: delete-workspace-agent
  - `ensureSeed`: 写入默认 Agent 目录/ensure workspace agent seed | keywords: ensure-workspace-agent-seed

### services/workspace-conversation.service.ts
会话服务，会话 CRUD 与消息落库；`aiEnabled` 的 Agent 经 chat-main 生成真实回复。
- **关键词**: conversation, message, agent-reply, chat-main, attachment
- **函数**:
  - `ensureIndexes`: 初始化会话索引/ensure conversation indexes | keywords: ensure-conversation-indexes
  - `list`: 会话列表/list workspace conversations | keywords: list-workspace-conversations
  - `create`: 新建会话/create workspace conversation | keywords: create-workspace-conversation
  - `get`: 获取会话/get workspace conversation | keywords: get-workspace-conversation
  - `remove`: 删除会话及消息/delete workspace conversation | keywords: delete-workspace-conversation
  - `listMessages`: 会话消息列表/list conversation messages | keywords: list-conversation-messages
  - `sendMessage`: 发送消息并按需取回 Agent 回复/send conversation message | keywords: send-conversation-message
  - `appendMessage`: 写入消息并同步会话计数/append conversation message | keywords: append-conversation-message
  - `requireConversation`: 校验会话归属/require conversation | keywords: require-conversation

### services/workspace-task.service.ts
任务服务，任务 CRUD、状态计数与跟进记录，承接方限本工作区成员或租户 Agent。
- **关键词**: task, followup, status-count, assignee, attachment
- **函数**:
  - `ensureIndexes`: 初始化任务索引/ensure workspace task indexes | keywords: ensure-workspace-task-indexes
  - `list`: 任务列表与状态计数/list workspace tasks | keywords: list-workspace-tasks
  - `create`: 创建任务/create workspace task | keywords: create-workspace-task
  - `update`: 更新任务/update workspace task | keywords: update-workspace-task
  - `remove`: 删除任务及跟进/delete workspace task | keywords: delete-workspace-task
  - `listFollowups`: 跟进记录列表/list task followups | keywords: list-task-followups
  - `addFollowup`: 追加跟进记录/add task followup | keywords: add-task-followup
  - `resolveAssignee`: 解析并校验承接方/resolve task assignee | keywords: resolve-task-assignee
  - `parseDueAt`: 解析截止时间/parse task due date | keywords: parse-task-due-date
  - `requireTask`: 校验任务归属/require workspace task | keywords: require-workspace-task

### controller/workspace-collab.controller.ts
协作控制器，Agent/会话/任务端点，逐入口挂 `@RequirePermission`。
- **关键词**: controller, casl, jwt, v2, require-permission, agent, conversation, task
- **函数**:
  - `listAgents`/`createAgent`/`updateAgent`/`removeAgent`: Agent 通讯录端点 | keywords: workspace-agent-endpoints
  - `listConversations`/`createConversation`/`removeConversation`: 会话端点 | keywords: workspace-conversation-endpoints
  - `listMessages`/`sendMessage`: 会话消息端点 | keywords: workspace-message-endpoints
  - `listTasks`/`createTask`/`updateTask`/`removeTask`: 任务端点 | keywords: workspace-task-endpoints
  - `listFollowups`/`addFollowup`: 跟进记录端点 | keywords: workspace-followup-endpoints
  - `requireUser`: 读取当前登录后台用户/read current admin user | keywords: read-current-admin-user

### controller/workspace-collab.dto.ts
Agent/会话/任务请求体 DTO 及校验，附件按 `IsMongoId` 校验网盘节点 ID。
- **关键词**: dto, class-validator, agent, conversation, task, attachment

### entities/workspace-collab.entity.ts
Agent、会话、消息、任务、跟进与附件实体定义。
- **关键词**: entity, agent, conversation, message, task, followup, attachment
- **类型导出**: `WorkspaceAgentEntity`, `WorkspaceConversationEntity`, `WorkspaceMessageEntity`, `WorkspaceMessageRole`, `WorkspaceTaskEntity`, `WorkspaceTaskFollowupEntity`, `WorkspaceTaskStatus`, `WorkspaceTaskAssigneeType`, `WorkspaceAttachment`

### constants/workspace-agent.constants.ts
默认 Agent 目录种子与 AI 运行时默认提供商/模型。
- **关键词**: agent, seed, default-catalog, provider, model
- **类型导出**: `DEFAULT_WORKSPACE_AGENTS`, `WORKSPACE_AGENT_DEFAULT_PROVIDER`, `WORKSPACE_AGENT_DEFAULT_MODEL`, `WorkspaceAgentSeed`

### constants/workspace-collab-audit.constants.ts
协作审计事件动作常量。
- **关键词**: audit, action, namespace, agent, conversation, task
- **类型导出**: `WORKSPACE_COLLAB_AUDIT_ACTIONS`

### workspace-collab.module.ts
模块定义，导入工作区与 chat-main 模块，导出 Agent 与任务服务。
- **关键词**: module, nest, export-service
