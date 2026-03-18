# Decision-Card Module

## 模块描述
决策卡模块：提供独立决策LLM编排、决策结果入库与按会话读取能力。
文件路径: `src/modules/decision-card`

## 功能描述及关键词

### services/decision-card.service.ts
决策卡服务。
- **关键词**: decision card, llm, strategy, recommendation, persist, session-scope
- **函数**:
  - `generateDecisionCard`: 生成并落库决策卡/generate and persist decision card
  - `listBySession`: 会话决策卡列表/list decision cards by session
  - `getById`: 决策卡详情/get decision card detail
  - `resolveDecisionRuntime`: 决策模型解析/resolve decision runtime model

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
