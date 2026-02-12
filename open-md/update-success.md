# Update Success Log

Last Updated: 2026-02-04

## ✅ 已完成

### 1) Todo 待办模块：支持清单条目 + 完成说明

- 新增清单条目实体与存储：
  - [todo-item.entity.ts](file:///d:/a-remote-job/ai-mvp/src/modules/todo/entities/todo-item.entity.ts)
- TodoService 扩展清单条目 CRUD：
  - [todo.service.ts](file:///d:/a-remote-job/ai-mvp/src/modules/todo/services/todo.service.ts)
- REST 接口补齐（清单条目增删改查）：
  - [todo.controller.ts](file:///d:/a-remote-job/ai-mvp/src/modules/todo/controller/todo.controller.ts)

### 2) Batch-Task 批量任务模块：并行入队 + 待办池联动

- 批量任务实体与集合：
  - [batch-task.entity.ts](file:///d:/a-remote-job/ai-mvp/src/modules/batch-task/entities/batch-task.entity.ts)
- 并行入队、指数退避重试、回调状态同步，并同步写入 Todo 总览与 Todo Item：
  - [batch-task.service.ts](file:///d:/a-remote-job/ai-mvp/src/modules/batch-task/services/batch-task.service.ts)
- REST 接口：创建任务、打开 MCP、追加 posts、run、callback、查询列表：
  - [batch-task.controller.ts](file:///d:/a-remote-job/ai-mvp/src/modules/batch-task/controller/batch-task.controller.ts)

### 3) Gallery 图库模块：图片上传 + 向量检索

- 图片实体（含 embedding 向量字段）：
  - [gallery-image.entity.ts](file:///d:/a-remote-job/ai-mvp/src/modules/gallery/entities/gallery-image.entity.ts)
- 批量写入与相似检索（Atlas Vector Search 优先，失败回退本地余弦）：
  - [gallery.service.ts](file:///d:/a-remote-job/ai-mvp/src/modules/gallery/services/gallery.service.ts)
- 上传/列表/检索接口：
  - [gallery.controller.ts](file:///d:/a-remote-job/ai-mvp/src/modules/gallery/controller/gallery.controller.ts)

### 3.1) Gallery 图库组：CRUD + 向量检索

- 图库组实体（含 embedding 向量字段）：
  - [gallery-group.entity.ts](file:///d:/a-remote-job/ai-mvp/src/modules/gallery/entities/gallery-group.entity.ts)
- 图库组服务：创建/列表/更新/删除/相似检索（Atlas 优先，失败回退本地余弦）：
  - [gallery-group.service.ts](file:///d:/a-remote-job/ai-mvp/src/modules/gallery/services/gallery-group.service.ts)
- 控制器接口：groups CRUD + groups/search：
  - [gallery.controller.ts](file:///d:/a-remote-job/ai-mvp/src/modules/gallery/controller/gallery.controller.ts)

### 4) Canvas 模块：多文章存储与状态更新

- 画布与文章实体：
  - [canvas.entity.ts](file:///d:/a-remote-job/ai-mvp/src/modules/canvas/entities/canvas.entity.ts)
- 画布创建、文章追加、画布状态与文章图片字段更新：
  - [canvas.service.ts](file:///d:/a-remote-job/ai-mvp/src/modules/canvas/services/canvas.service.ts)
- REST 接口：创建画布、查询、列表、追加文章、更新状态：
  - [canvas.controller.ts](file:///d:/a-remote-job/ai-mvp/src/modules/canvas/controller/canvas.controller.ts)

### 5) 模块提示与关键词索引（可检索性增强）

- 已补齐/新增 tip：Batch-Task / Gallery / Canvas / Data-Source / Skill-Thought / Embedding / Checkpoint / Function-Call-Schema / Function-Call-Tools
  - 示例：
    - [batch-task.tip.ts](file:///d:/a-remote-job/ai-mvp/src/modules/batch-task/description/batch-task.tip.ts)
    - [gallery.tip.ts](file:///d:/a-remote-job/ai-mvp/src/modules/gallery/description/gallery.tip.ts)
    - [canvas.tip.ts](file:///d:/a-remote-job/ai-mvp/src/modules/canvas/description/canvas.tip.ts)
- 全局关键词索引已维护并覆盖新增 tip：
  - [module-keywords-index.tip.ts](file:///d:/a-remote-job/ai-mvp/src/modules/ai-context/description/module-keywords-index.tip.ts)

### 6) Graph 工作流：编排文章 + 批量发布

- Graph 控制器：文章编排与批量发布入口
  - [graph.controller.ts](file:///d:/a-remote-job/ai-mvp/src/modules/graph/controller/graph.controller.ts)
- 编排文章：调用 Agent 生成 3~5 篇，写入 Canvas，并基于图库向量检索自动配图
  - [article-graph.service.ts](file:///d:/a-remote-job/ai-mvp/src/modules/graph/services/article-graph.service.ts)
- 批量发布：从 Canvas 生成批量任务，并行入队并触发 MCP 运行（含 Todo 联动）
  - [batch-task-graph.service.ts](file:///d:/a-remote-job/ai-mvp/src/modules/graph/services/batch-task-graph.service.ts)

## ✅ 验证

- `npm run lint` 通过
- `npm test` 通过

## ⏳ 仍未完成（来自 update.md 规划中的后续模块）

（本轮已完成 A/B，下面列表待后续继续补齐。）

### C) 后续：更多前端能力

- Astro 页面与样式进一步拆分（目前以最小改动完成落地）
- 图库图片删除/更新（需要后端补齐对应 API）

## ✅ 本轮新增（前端）

### A) 前端重构：ai-chat.html → Astro + React 工程（/web）

- 新增 `/web` Astro+React 工程，并构建输出到 `public/pages`
- 访问路径兼容：`/pages/ai-chat.html`
- 产物入口：
  - [ai-chat.html](file:///d:/a-remote-job/ai-mvp/public/pages/ai-chat.html)
- 工程入口：
  - [ai-chat.astro](file:///d:/a-remote-job/ai-mvp/web/src/pages/ai-chat.astro)
  - [AiChatApp.jsx](file:///d:/a-remote-job/ai-mvp/web/src/ui/AiChatApp.jsx)

### B) ai-chat：右上角设置按钮 + 弹窗管理图库/图库组

- Header 新增设置按钮，打开弹窗
- 弹窗内提供图库组/图片基础管理（对接后端 Gallery API）：
  - 图库组：列表、创建、编辑、删除
  - 图片：列表、上传（可选 groupId、tags、description）
