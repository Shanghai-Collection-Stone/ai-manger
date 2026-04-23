# auto-task-robot 模块

## 功能描述

自动任务机器人调度模块，负责将 Todo 任务按 assignee 字段分发给对应的 Robot/Agent 执行器。支持两种指派格式：

- `agent:<24-hex-id>` — 新格式，读取后台 agent 配置后路由到对应模块（xhs_publisher / claw 等）
- `robot:<code>` — 旧格式，直接映射到内置 robot（向后兼容）

## 文件结构

| 相对路径 | 描述 |
|---|---|
| `auto-task-robot.module.ts` | NestJS 模块声明，导出 `RobotRegistryService` |
| `services/robot-registry.service.ts` | Robot/Agent 调度服务，核心入口 |

---

## services/robot-registry.service.ts

### 对外接口

| 函数名 | 关键词描述 |
|---|---|
| `listRobots()` | 返回所有可用 robot 技术描述列表（code/name/description） |
| `listAgentConfigs()` | 查询 AdminService 返回所有已启用 agent 配置（id/name/module），供 LLM 选择指派 |
| `parseRobotCode(assignee)` | 解析 `robot:code` 格式的 assignee，返回 robotCode |
| `parseAgentId(assignee)` | 解析 `agent:<24-hex-id>` 格式，返回 agentId |
| `triggerIfRobotAssigned({ todo })` | 联合触发：优先 agent 格式，兼容 legacy robot 格式 |

### 私有方法

| 函数名 | 关键词描述 |
|---|---|
| `triggerByAgentId(todo, agentId)` | 读取 agent 配置后分发到 xhs_publisher / claw handler |
| `handleXhsPublisher(todo, agentCtx?)` | 小红书发布 robot 处理器，可携带 AgentContext |
| `handleClawRobot(todo, agentConfig, agentCtx)` | OpenClaw 兼容 API 调用，处理会话持久化与结果写入 |
| `markTodoAcceptedForRobot(todo, robotName, robotCode)` | 更新 todo 为 in_progress 并写入接单节点 |
| `markTodoFailedForRobot(todo, robotName, rawError)` | 更新 todo 为 failed 并写入失败节点 |
| `safeMarkFailed(todo, robotName, error)` | 安全调用 markTodoFailedForRobot，吞掉二次错误 |
| `extractCanvasId(todo)` | 从 todo 文本提取 Canvas ID |
| `extractTaskCount(todo)` | 从 todo 文本提取任务数量 |
| `findRobotName(code)` | 通过 robot code 查找显示名称 |
| `logRobot(event, extra?)` | 结构化日志 |

### 导出接口类型

| 类型名 | 描述 |
|---|---|
| `AutoTaskRobotDescriptor` | Robot 描述对象 `{ code, name, description }` |
| `AgentContext` | Agent 上下文 `{ agentId, name, prompt? }`，随任务传递到 handler |

---

## 与外部模块的依赖关系

- **AdminService** (`admin` 模块) — 通过 `ModuleRef.get(strict: false)` 获取 agent/claw 配置
- **TodoService** (`todo` 模块) — 更新 todo 状态、写入 todo item
- **BatchTaskGraphService** (`graph` 模块) — xhs_publisher 的实际执行入口

## OpenClaw 接入说明

- API: `POST <serviceUrl>/v1/chat/completions`（OpenAI 兼容协议）
- 认证: `Authorization: Bearer <token>` + `x-openclaw-agent-id: <agentId>` header
- 会话: `user` 字段传 `todo.sessionKey ?? task-<todoId>`，openclaw 据此派生固定会话键
- 结果: 写入 todo item，并更新 todo 状态为 `done`
