# 批量发布工作流重构说明（LangGraph / XHS）

更新时间：2026-02-06

## 跟踪

- [x] 恢复对话层可用的小红书批量发布工具（xhs_batch_publish）。
- [x] 对话层屏蔽 MCP 直出批量发布工具（batch_task_*）。
- [x] 恢复 tool_start/tool_end 事件结构，保证能看到 input。

## 目标与范围

- 目标：以 LangGraph 形式重构“批量发布”工作流，基于 CanvasId 获取示例文章内容，生成发布任务并通过 MCP 批量发布。
- 范围：仅支持小红书（XHS）链路；对话层仅暴露 xhs_batch_publish，MCP 原生 batch_task_* 仅在后端编排内部使用。
- 非目标：不引入随机延迟区间；发布调度依赖 add_post 的 schedule_at / plannedAt。

## 现有模块关联（用于对照）

- Graph 工具入口：GraphWorkflowFunctionCallService（xhs_batch_publish / batch_publish）。
- 批量发布编排：BatchTaskGraphService（runFromCanvas / openAndStartXhsFromCanvas）。
- MCP 调度：BatchTaskService（openMcpTask / addPostsParallel / run / handleCallback）。
- 待办清单：Todo + TodoItem 与批量任务联动。

## 重构后的工作流设计

### 1) Tool 层：先返回 task-it，再异步执行 Graph

- 输入：canvasId、userId、平台（默认 xhs）、任务数量、回调 URL（暂作为 TODO 记录）。
- 行为：
  - 先创建待办并通过 LLM 生成中文描述（包含任务数、任务简介、canvasId、taskId、todoId）。
  - 由 xhs_batch_publish 内部调用 batch_task_open 获取 taskId。
  - 将 todoId 与 taskId 写入待办描述与批量任务摘要。
  - 立即返回 task-it 与任务总览，异步启动 Graph 执行。
- 返回：
  - 任务概览（taskId / todoId / taskCount / tasksPreview）。
  - task-it 卡片（指向待办详情页）。
  - 主 LLM 可直接提示：“任务已开始，您可以随时点击待办事项查看进度”。
- 说明：Tool 返回必须先于 Graph 异步执行，避免用户等待。

### 2) Graph State 设计

- 必备字段：taskId、todoId、taskCount、canvasId、userId、platform。
- 运行上下文：
  - canvas 文章列表仅用于参考（为生文节点提供示例文章与风格）。
  - 实际生成篇数以任务数量为准，不依赖 canvas 文章数量。
  - 待办清单项列表（用于任务状态回写）。
  - 图库可用 tag 列表（传递到生文节点）。

### 3) Graph 节点（推荐顺序）

1. 读取上下文节点
   - 通过 canvasId 拉取文章内容与示例文章。
   - 通过 todoId 读取待办清单项（用于任务状态更新）。
   - 基于任务数量生成任务清单（任务数=生文篇数）。

2. 图库标签准备节点
   - 读取图库可用 tag 列表。
   - 作为输入传递给生文节点，以便挑选匹配标签。

3. 生文与入队节点（循环/并行）
   - 基于 canvas 示例文章进行模拟微调与重新配图。
   - 每完成一篇生文，调用 batch_task_add_post 追加到 MCP 任务队列。
   - 同步更新对应清单项：
     - status 置为“进行中”或“已完成生成”。
     - stage 记录细粒度过程（例如：文章已完成生成）。

4. 批量运行节点
   - 等待所有生文完成后，调用 batch_task_run。
   - 不填写随机延迟区间，计划时间依赖 add_post 的 schedule_at / plannedAt。

## 待办清单字段调整建议

### 现有问题

- 任务状态变化多样，目前 status 枚举固定，无法覆盖中间阶段。

### 调整建议（不改变已有逻辑的最小改造）

- status 固定为两态：
  - pending（未开始）
  - done（完成）
- 新增或强化 stage 字段：用于记录过程性状态，例如“文章已完成生成”“等待发布”“发布失败重试”等。
- 保留 doneNote / result：用于最终结果或失败说明。

## MCP 调用与数据流

- batch_task_open
  - 入参：空对象
  - 出参：taskId
  - 触发点：后端编排内部（对话层不直接暴露）

- batch_task_add_post
  - 入参：taskId、postId、title、plannedAt、payload
  - 触发点：生文节点
  - 说明：plannedAt 由 schedule_at 统一调度，不再设置随机间隔

- batch_task_run
  - 入参：taskId、callbackUrl（暂做 TODO 记录）
  - 触发点：所有生文完成后

## 回调 URL 处理（暂不实现）

- 在待办描述中记录 callbackUrl 占位说明：
  - “回调 URL 校验/签名与更细粒度状态同步：TODO”。
- 后续补齐：
  - 回调验签
  - 回调映射到 todoItem 与 batchTaskPost 的状态回写

## 对话层工具暴露策略

- 原则：对话层不直接调用 MCP 原生 batch_task_*，统一通过 xhs_batch_publish 走后端编排。
- 目的：避免 LLM 直接绕过本地编排（待办联动/错误处理/异步执行），同时减少 tool 集合噪音。

## 产出物与交付内容

- 重构后 Graph 仅支持 XHS。
- Tool 返回包含：taskId、todoId、任务总览、task-it 卡片。
- 任务执行过程中，每篇文章入队即更新对应清单项。

## 迁移步骤（建议顺序）

1. 在 Graph 层补齐“读取上下文 + 生文入队 + 运行”链路。
2. 将待办清单 status 收敛为两态，并用 stage 覆盖过程状态。
3. 在 Tool 层返回 task-it 卡片与任务总览。
4. 预留 callbackUrl TODO，等待后续实现。

## 完成进度

- 2026-02-05：Tool 层改为接收 taskCount 并先返回 task-it，Graph 异步执行；待办描述由 LLM 生成中文概览；Canvas 文章仅作参考并在 Graph 内按任务数轮换；更新模块提示与本文档进度。
- 2026-02-06：恢复对话层 xhs_batch_publish；过滤 MCP 直出 batch_task_*；修复 SSE 事件结构与 tool_start input 传递。
