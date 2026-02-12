toolName: todo_write

status: success

Todos updated: 7 items

toolName: search_codebase

status: success

query: 项目整体结构：入口、后端框架（Nest/Express/Fastify）、模块组织方式、数据库/ORM 使用情况、graph/flow 引擎位置

toolName: search_codebase

status: success

query: 待办(todo) 现有数据结构、集合名、CRUD接口、字段（状态/说明等）

toolName: search_codebase

status: success

query: 现有图片/文件上传相关：multer、static目录、image相关controller/service、向量字段使用示例

toolName: search_codebase

status: success

query: 现有 LangGraph / graph 工作流实现位置：编排、节点、checkpoint、graph runner

toolName: view_files

status: success

filePath: d:\a-remote-job\ai-mvp\src\modules\data-source\services\data-source.service.ts

toolName: file_search

status: success

file_pattern: \*\*/package.json

toolName: view_files

status: success

filePath: d:\a-remote-job\ai-mvp\package.json

toolName: view_files

status: success

filePath: d:\a-remote-job\ai-mvp\public\pages\ai-chat.html

toolName: search_by_regex

status: success

query: Settings|设置|gear|cog

toolName: search_codebase

status: success

query: 是否已有 canvas / post / batch_task / article / xiaohongshu 相关模块与集合

toolName: view_files

status: success

filePath: d:\a-remote-job\ai-mvp\src\modules\function-call\mcp\services\mcp.service.ts

toolName: view_files

status: success

filePath: d:\a-remote-job\ai-mvp\src\modules\function-call\mcp\services\mcp-adapter.service.ts

toolName: search_codebase

status: success

query: ToolsService 如何汇总工具：包括哪些 function-call 模块、命名方式、如何暴露给 Agent

toolName: view_folder

status: success

d:\a-remote-job\ai-mvp\src\modules

toolName: todo_write

status: failed

Todos updated: 0 items

toolName: todo_write

status: success

Todos updated: 7 items

toolName: todo_write

status: success

Todos updated: 7 items

**总体约束与现状基线**

- 后端是 NestJS + MongoDB（原生 driver），静态资源通过 [main.ts](file:///d:/a-remote-job/ai-mvp/src/main.ts#L72-L90) 将 `public/pages`（或 `dist/pages`）挂到 `/pages`，`public` 挂到 `/static`。
- 现有聊天前端是单文件 [ai-chat.html](file:///d:/a-remote-job/ai-mvp/public/pages/ai-chat.html)，浏览器端 CDN React + Babel + Tailwind，逻辑全内联。
- 已有模块：待办 [TodoModule](file:///d:/a-remote-job/ai-mvp/src/modules/todo/todo.module.ts)、MCP 工具桥接 [McpAdaptersService](file:///d:/a-remote-job/ai-mvp/src/modules/function-call/mcp/services/mcp-adapter.service.ts)、向量服务 [EmbeddingService](file:///d:/a-remote-job/ai-mvp/src/modules/shared/embedding/embedding.service.ts)（Atlas `$vectorSearch` 失败回退本地余弦相似度的实现可复用，[DataSourceService](file:///d:/a-remote-job/ai-mvp/src/modules/data-source/services/data-source.service.ts#L92-L173)）。
- 数据结构变更通过 migrate-mongo 执行（见 [package.json scripts](file:///d:/a-remote-job/ai-mvp/package.json#L8-L25)）。

---

## 1) `public/pages` 的 ai-chat.html → Astro 项目重构（`/web`）

**目标**

- 代码层：把单文件 React 应用拆成可维护组件与模块化依赖（不再浏览器 Babel 编译）。
- 部署层：Astro build 输出静态文件到 `public/pages`，Nest 继续用现有静态目录映射服务（不改访问路径，仍 `/pages/...`）。

**目录与构建方式**

- 在仓库根目录新建 `web/`（与 `src/` 同级），作为 Astro 子项目。
- Astro 配置 `outDir` 指向 `../public/pages`（或构建到 `../dist/pages`，再由发布流程同步到 `public/pages`；你已明确“pages 就用来存 astro 打包出来的”，优先直接输出到 `public/pages`）。
- 根项目新增脚本（计划层面）：`build:web`、`dev:web`、`build` 串联 `web build` + `nest build`，避免“后端 build 了但页面没更新”。

**组件拆分策略（以最小风险迁移）**

- 采用 Astro + React 集成：把现有 React 代码迁到 `web/src/components/*`，由一个 `App.tsx` 作为根组件，Astro 页面只负责壳与资源。
- 拆分顺序（先解耦再美化）：
  - `ChatLayout`：整体布局（header/sidebar/main）。
  - `ChatMessageList` / `ChatMessageItem`：消息渲染（含 Markdown、复制、截图等功能）。
  - `ChatComposer`：输入框、发送按钮、快捷键。
  - `ToolPanel`/`AttachmentPanel`：上传图片、引用图片等（与你后续图库集成强相关）。
  - `Modal` 体系：统一弹窗容器（后续图库/图库组管理复用）。
- 依赖迁移：
  - `marked`、`dompurify` 从 CDN 改为 npm 依赖。
  - Tailwind 改为 Astro 官方 Tailwind 集成（保留现有 className 风格，降低 UI 回归风险）。
- 路由：
  - `web/src/pages/ai-chat.astro` 产出 `/pages/ai-chat.html`（保证旧链接不变），或产出 `/pages/ai-chat/index.html` 再在 Nest 层做兼容跳转（二选一，优先“文件名不变”）。

---

## 2) 待办池：在“总览 Todo”下增加“具体待办事项管理 + 状态 + 完成说明”

**现状**

- 当前 `todos` 集合是“总览级”实体（title/description + AI 字段 + status），见 [TodoEntity](file:///d:/a-remote-job/ai-mvp/src/modules/todo/entities/todo.entity.ts) 与 [TodoService](file:///d:/a-remote-job/ai-mvp/src/modules/todo/services/todo.service.ts)。

**新增数据模型（建议）**

- 新增集合：`todo_items`
  - `id`：全局序号或“每 todo 自增序号”（二选一；为简单与可检索，优先全局序号 + `todoId` 外键）。
  - `todoId:number`：归属的总览待办。
  - `title:string` / `description?:string`
  - `status:'pending'|'in_progress'|'done'|'blocked'|'cancelled'`
  - `doneNote?:string`：完成说明（你要求的“具体完成说明”）。
  - `doneAt?:Date`、`createdAt/updatedAt`
  - 可选：`order:number`（用于前端排序拖拽，先预留）。
- 索引：
  - `{ todoId: 1, updatedAt: -1 }`
  - `{ status: 1, updatedAt: -1 }`

**API 规划（REST，贴合现有风格）**

- `POST /todo/:todoId/items` 创建 item
- `GET /todo/:todoId/items` 列表（可按 status 过滤）
- `PATCH /todo/items/:id` 更新（含 status、doneNote）
- `DELETE /todo/items/:id` 删除
- 保持现有 `/todo` CRUD 不变，避免破坏已有工具/前端调用。

**AI 工具层（Function-call）**

- 扩展现有 todo function-call（[TodoFunctionCallService](file:///d:/a-remote-job/ai-mvp/src/modules/function-call/todo/services/todo.service.ts)）增加 `todo_item_create / todo_item_update / todo_item_list` 等工具，便于后续 graphs 写入/更新执行状态。

---

## 3) 图库模块：图片 tag/说明/CRUD；图片组与图片都要向量字段

**目标**

- 既能当“管理后台”（增删改查、分组、标签），又能当“检索组件”（按 tag/语义向量快速找图给文章/批任务用）。

**数据模型（建议两集合 + 向量）**

- `image_groups`
  - `id:number`（可选序号）/ `_id:ObjectId`
  - `name:string`, `description?:string`, `tags:string[]`
  - `embedding:number[]`（由 name/description/tags 合并文本生成）
  - `createdAt/updatedAt`
- `images`
  - `_id:ObjectId` / `id:number`
  - `groupId?:ObjectId|number`
  - `url:string`（指向 `/static/uploads/...` 或你后续改成对象存储 URL）
  - `originalName?:string`, `fileName:string`, `mime?:string`, `size?:number`
  - `title?:string`, `description?:string`, `tags:string[]`
  - `embedding:number[]`（由 title/description/tags 合并文本生成）
  - `createdAt/updatedAt`

**上传与存储**

- 复用现有图片上传落盘模式（[ChatMainController upload-images](file:///d:/a-remote-job/ai-mvp/src/modules/chat-main/controller/chat.controller.ts#L32-L93)）：
  - 方案 A：图库模块自己提供 `POST /gallery/images/upload`（推荐，职责更清晰）。
  - 方案 B：继续用 `/chat/upload-images` 上传，图库只做“登记入库”（需要前端多一步调用）。
- 向量生成：
  - 写入/更新时调用 [EmbeddingService](file:///d:/a-remote-job/ai-mvp/src/modules/shared/embedding/embedding.service.ts)，并实现“Atlas `$vectorSearch` → 本地余弦”双通道（复用 [DataSourceService.searchSimilar](file:///d:/a-remote-job/ai-mvp/src/modules/data-source/services/data-source.service.ts#L92-L173) 的模式）。

**API 规划**

- 图片组：
  - `POST /gallery/groups`
  - `GET /gallery/groups`
  - `PATCH /gallery/groups/:id`
  - `DELETE /gallery/groups/:id`
  - `POST /gallery/groups/search`（keyword + vector search）
- 图片：
  - `POST /gallery/images`（纯元数据创建）
  - `POST /gallery/images/upload`（上传 + 入库）
  - `GET /gallery/images`（支持 groupId/tag/status/filter）
  - `PATCH /gallery/images/:id`
  - `DELETE /gallery/images/:id`
  - `POST /gallery/images/search`（keyword + vector search）

---

## 4) 重构后的 ai-chat：右上角设置图标 → 弹窗管理“图库/图库组”

**UI 交互规划**

- 在 header 右上角增加 `Settings` 图标按钮。
- 点击打开一个设置弹窗（Modal），包含两个入口：
  - “图库管理”：列表/筛选/上传/编辑 tags 与说明/删除。
  - “图库组管理”：创建/编辑/删除、为组设置 tags/说明。
- 弹窗内部直接调用第 3 点提供的 `/gallery/*` API。
- 组件落地（在 Astro/React 工程内）：
  - `SettingsButton` + `SettingsModal`
  - `GalleryManager`（复用通用表格/表单组件）
  - `GalleryGroupManager`

---

## 5) Canvas 表：存各类 AI 生成内容（先做小红书风格），内容 JSON；一个 canvas 可有多篇文章

**核心设计**

- “Canvas”是一个聚合容器 + 异步写入目标（你说的“异步链接”）：先创建空壳（pending），生成过程逐步往里写文章数组，最终标记 completed/failed。

**数据模型（建议）**

- `canvases`
  - `id:number`（可选序号）
  - `userId?:string`
  - `style:'xiaohongshu' | '...'`
  - `status:'pending'|'generating'|'completed'|'failed'|'requires_human'`
  - `outline?:string`（题目大纲原文）
  - `articles:Array<CanvasArticle>`
  - `createdAt/updatedAt`
- `CanvasArticle`（内嵌结构，先满足 3~5 篇的规模）
  - `articleId:string`（UUID）
  - `platform:'xiaohongshu'`
  - `title?:string`
  - `contentJson:object`（平台差异通过 JSON 结构适配）
  - `imageIds?:Array<string|ObjectId>`（引用图库图片）
  - `status:'draft'|'final'|'failed'`
  - `renderHints?:object`（用于前端模拟平台 UI 的必要字段）

**读取与渲染**

- 后端提供：
  - `POST /canvas` 创建 canvas（返回 canvasId）
  - `GET /canvas/:id` 获取详情（articles 数组）
  - `PATCH /canvas/:id`（内部写入用，可不对外暴露或加鉴权）
- 前端（ai-chat）读取 canvas 时：
  - 按 `style/platform` 选择渲染器，例如 `XhsPostRenderer`，把 `contentJson` 映射为“小红书卡片/笔记”视觉模拟。
  - 支持一个 canvas 多文章的切换/分页浏览。

---

## 6) 编排文章 graph：按平台风格+大纲生成 3~5 篇示例文章；缺数据可 HITL；生成时创建 canvas 并写入；图片按 tag 向量匹配

**输入与输出**

- 输入：`platformStyle(默认小红书)`、`outline`、`min=3 max=5`、`偏好tags/主题`、`userId`。
- 输出：`canvasId` + `status` + `requires_human`（如缺数据）。

**节点拆分（可直接映射为 LangGraph/自研流水线步骤）**

1. `ValidateInput`：解析大纲，抽取关键信息（受众、产品信息、禁用词、语气、长度）。
2. `DetectMissing`：判断缺失项（例如：产品卖点/目标人群/价格区间/可用图片标签范围），若缺失：
   - 产出 `requires_human=true` + `missing[]`，并可写入待办 item（对接第 2 点）。
3. `CreateCanvas`：创建 `canvases` 记录，`status=generating`，写入 outline/style。
4. `PlanArticles`：确定要生成 N 篇（3~5）文章的“题目+角度+标签+结构”。
5. `GenerateArticlesBatch`：尽可能在一次模型调用里批量生成 N 篇文章（结构化 `contentJson[]`），统一写入 canvas.articles，以提升上下文缓存击中率并减少重复提示词开销。
6. `MatchImages[i]`：对每篇文章的 tags 做图库向量检索，选出若干图片 id 写入文章（不足则标记文章 `requires_human` 或降级到仅文字）。
7. `FinalizeCanvas`：整体状态更新为 completed / requires_human / failed。

**实现落点**

- 依赖选择：
  - 如果要用 LangGraph：补齐 JS 端 `@langchain/langgraph` 依赖，并复用 Mongo checkpoint（你已有 [MongoCheckpointService](file:///d:/a-remote-job/ai-mvp/src/modules/checkpoint/services/checkpoint.service.ts) 能力）。
  - 若先快速交付：用“可中断的任务记录 + 分步执行器”（类似现有 frontend_jobs 的异步写入风格），后续再迁移到 LangGraph。
- 与 Agent 的边界：
  - 文章内容生成由 AgentService 负责（保证结构化 JSON 输出）。
  - 业务写入/检索由后端 service 负责（可控、可测）。

---

## 7) 批量任务 graph：按你给的时间范围排程；用 MCP 批量发图文

**目标**

- 给定“要发多少篇/两天内发完/间隔策略/随机延迟区间/回调 URL”，自动排程并调用 MCP：
  - `batch_task_open` → 得到任务 ID
  - 多次 `batch_task_add_post` → 把每篇图文按计划时间塞进去
  - `batch_task_run` 或 `batch_task_run_sync` → 启动执行

**数据模型（建议）**

- `batch_tasks`
  - `id:number`
  - `status:'draft'|'scheduled'|'running'|'completed'|'failed'`
  - `mcpServer?:string`（可选，用于区分多 MCP）
  - `mcpTaskId?:string`
  - `canvasId?:number|string`（示例文章来源）
  - `schedule:{ startAt,endAt,count,intervalPolicy,randomDelayMinSec,randomDelayMaxSec }`
  - `posts:Array<{ articleRef, imageIds, plannedAt, status, result? }>`
  - `createdAt/updatedAt`

**Graph 步骤**

1. `LoadSource`：从 canvas 读取示例文章（不足则返回 requires_human 或触发编排 graph）。
2. `SelectImages`：可复用编排阶段的匹配结果，也支持“选择类似的”（再跑一次向量检索补全）。
3. `BuildSchedule`：把 `count` 篇均匀分布到 `[startAt,endAt]`，必要时加随机抖动，输出每篇 `plannedAt`。
4. `OpenMcpBatchTask`：调用 `batch_task_open`，保存 `mcpTaskId`。
5. `AddPostsParallel`：并行批量调用 `batch_task_add_post` 以尽快入队（服务端并发池 + 失败重试 + 限流），payload 包含图文内容、图片 URL/ID、plannedAt。
6. `Run`：调用 `batch_task_run`（带 callbackUrl、随机延迟区间）或 `batch_task_run_sync`（无回调场景）。
7. `PersistAndMonitor`：落库状态，回调/轮询更新每条 post 状态。

**并行入队与 Token/缓存策略**

- 入队并行：优先在后端实现“并发池（可配置并发度）+ 分批（chunk）+ 指数退避重试”，避免由模型逐条工具调用导致的串行耗时。
- 内容生成：批量任务通常依赖示例文章，尽可能在同一个上下文中一次生成多篇（例如 3~5 篇），再复用同一批结果进行排程与入队，降低重复 prompt 与提升缓存击中。
- 代价控制：对“文章生成”和“入队调用”分离计费/重试策略；生成阶段不重复生成，入队失败只重试入队，不回滚并重算内容。

**待办池联动（批量任务 → 待办总览 + 具体清单）**

- 创建批量任务时同步创建一条“待办总览”（Todo）：标题可为“批量发布任务：{平台}/{主题}”，描述包含时间窗、篇数、来源 canvasId、mcpTaskId 等关键信息。
- 每一条发布（posts[i]）同步创建一条“具体待办清单”（Todo Item）：以 plannedAt/文章标题为主键展示信息，status 与批量任务单条状态保持一致（pending/in_progress/done/failed），并将 MCP 执行回执写入 doneNote（或 result 字段映射到 doneNote）。
- 状态回写：`PersistAndMonitor` 接到回调/轮询结果后，同时更新 batch_tasks.posts[i] 与对应 todo_items 的状态与完成说明，保证运营侧可直接在待办池看进度与失败原因。

**MCP 接入点**

- 通过现有 MCP 工具加载机制（[McpAdaptersService](file:///d:/a-remote-job/ai-mvp/src/modules/function-call/mcp/services/mcp-adapter.service.ts) 读取 `config/mcp.servers.json`）把你提供的 batch_task 工具暴露进来。
- 如需后端“非 Agent 直接调用 MCP 工具”，计划扩展 `McpAdaptersService` 暴露 `callTool(serverName, toolName, args)`（基于 `session()` 能力）以便 graph 稳定执行（不依赖模型决策顺序）。

---

## 里程碑、迁移顺序与验收

**推荐实施顺序（减少返工）**

- 第一阶段（打地基）：图库（3）→ 设置弹窗入口（4）→ Astro 基础壳与构建输出（1）。
- 第二阶段（内容容器）：Canvas 表与读取渲染（5）→ 编排文章 graph（6）（先跑通小红书）。
- 第三阶段（规模化发布）：批量任务 graph（7）+ MCP 接入与回调链路 → 待办细项（2）作为运营/人工介入入口。

**关键风险点**

- Astro 构建输出到 `public/pages`：需要确保不会覆盖你仍想保留的静态页面；解决方案是 Astro 输出仅包含明确页面（如 ai-chat），或输出到子目录再软链接/复制。
- Atlas 向量检索不可用：必须始终有本地余弦回退（你已有成熟样例）。
- Canvas/Batch 的“异步写入一致性”：需要明确状态机与幂等（同一 canvas/article 重跑如何覆盖/追加）。

**验收清单（按你的需求逐条对应）**

- `/pages/ai-chat.html` 仍可访问，但实现来自 Astro 构建产物（不再是手写单文件）。
- ai-chat 右上角设置按钮可打开“图库管理/图库组管理”弹窗，并完成 CRUD。
- 待办总览下可管理多个具体待办项，具备状态与完成说明字段。
- 图库：图片与图片组均支持 tags/说明/CRUD，且两者都有 embedding 字段并可检索。
- Canvas：可创建并存储小红书风格 JSON，多文章展示带平台模拟 UI。
- 编排文章：最少 3 篇最多 5 篇，缺数据时能要求人工介入，并以 canvasId 作为异步链接承载写入。
- 批量任务：可在给定时间窗内自动排程，并通过 MCP 执行 batch*task*\* 工具链完成发布。
