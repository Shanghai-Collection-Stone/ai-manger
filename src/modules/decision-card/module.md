# Decision-Card Module

## 模块描述
决策卡模块：提供独立决策LLM编排、决策结果入库与按会话读取能力。
文件路径: `src/modules/decision-card`

## 功能描述及关键词

### services/decision-card.service.ts
决策卡服务。
- **关键词**: decision card, llm, strategy, recommendation, persist, session-scope, assignee-format, robots-agents-users, background-detail-fill
- **函数**:
  - `generateDecisionCard`: 生成并落库决策卡；prompt 内嵌可指派对象清单与 actions 三要素约束/generate and persist decision card
  - `buildCapabilityBrief`: 构建能力清单（含 robots/agents/users 三类可指派对象 + assignee 格式约定），供生成与执行两阶段共用/build capability brief with assignable robots agents users
  - `listAssignableUsers`: 按租户拉取可指派用户（user:<id> 格式）/list assignable users for decision assignee
  - `applyDecision`: 应用决策；阶段 A 基于大纲立即创建粗粒度 todo 并返回（首屏快），阶段 B 后台异步补详情+延后触发 robot/apply decision two-phase fast-return
  - `fillTodoDetailsInBackground`: 后台批量为 todo 生成执行详情，逐条 update；详情就绪后再触发 robot/agent/fill todo details in background
  - `listBySession`: 会话决策卡列表/list decision cards by session
  - `getById`: 决策卡详情/get decision card detail
  - `resolveDecisionRuntime`: 决策模型解析/resolve decision runtime model
- **约定**:
  - `assignee` 字段统一使用 `robot:<code>` / `agent:<id>` / `user:<id>` 三种格式之一，或留空
  - 待办 `aiPlan` 值为 `⏳ 执行细节正在 AI 生成中…` 时代表详情 pending（可作前端 loading 态判据）

### controller/decision-card.controller.ts
决策卡控制器。
- **关键词**: controller, decision-card, session
- **函数**:
  - `listBySession`: 会话查询/list by session
  - `getById`: 详情查询/get by id

### entities/decision-card.entity.ts
决策卡实体定义。
- **关键词**: entity, decision, recommendation, risk, action

### decision-card.module.ts
模块定义。
- **关键词**: module
