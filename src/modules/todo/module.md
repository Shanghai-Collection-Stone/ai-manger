# Todo Module

## 模块描述
该模块基于MongoDB存储待办事项与其清单条目，包含AI考量、决策来源与执行计划字段，并提供REST接口供前端与工具使用。
文件路径: `src/modules/todo`

## 功能描述及关键词

### todo.controller.ts
Todo控制器。
- **关键词**: todo, tasks, todo-items, checklist, ai-plan, crud, mongo, controller
- **函数**:
  - `create`: 创建待办/create todo
  - `list`: 列表查询（支持 userId/assignee/category 过滤）/list todos
  - `get`: 获取待办/get todo
  - `update`: 更新待办/update todo
  - `remove`: 删除待办/delete todo
  - `createItem`: 创建清单/create todo item
  - `listItems`: 清单列表/list todo items
  - `listXhsStats`: 获取任务下所有帖子数据（前端鉴权）/list xhs stats by todo

### todo.service.ts
Todo服务。
- **关键词**: service
- **函数**:
  - `create`: 创建待办/create
  - `update`: 更新待办/update
  - `listByScope`: 范围查询（支持 category 过滤）/list by scope
  - `createItem`: 创建清单/create item
  - `buildTenantFilter`: 租户过滤/build tenant filter

### todo.module.ts
Todo模块定义。
- **关键词**: module

### todo-task.controller.ts
任务专项接口控制器，供 claw skill 通过 taskToken 鉴权后操作任务和执行节点（无需管理员登录态）。
- **路由前缀**: `/task-api`
- **关键词**: task-api, task-token, claw-skill, todo-item, callback, canvas, xhs-stats
- **函数**:
  - `getTask`: 获取任务详情/get task by token
  - `updateTask`: 更新任务字段/update task via token
  - `deleteTask`: 删除任务/delete task via token
  - `listItems`: 获取执行节点列表/list items by token
  - `getItem`: 获取单个执行节点/get item by token
  - `createItem`: 新增执行节点/create item via token
  - `updateItem`: 更新执行节点/update item via token
  - `deleteItem`: 删除执行节点/delete item via token
  - `getCanvasArticles`: 获取专项 Canvas 下所有文章（含图片完整路径）/get canvas articles by token
  - `listXhsStats`: 列出任务下所有帖子数据/list xhs stats by todo
  - `getXhsStat`: 获取单条帖子数据/get xhs post stat by id
  - `createXhsStat`: 新增一条帖子数据/create xhs post stat
  - `bulkUpsertXhsStats`: 批量新增/覆盖帖子数据/bulk upsert xhs stats
  - `updateXhsStat`: 更新帖子数据/update xhs post stat
  - `deleteXhsStat`: 删除帖子数据/delete xhs post stat

### todo.entity.ts
Todo实体。新增 `taskToken`、`deadline`、`category` 字段（任务专属token、长时任务截止时间、分类标签如xhs）。
- **关键词**: entity, deadline, long_task, category, xhs

### todo-item.entity.ts
清单实体。
- **关键词**: todo-item, entity

### xhs-post-stat.entity.ts
小红书帖子数据收集实体（关联 todoId，含互动数据与热门评论快照）。
- **关键词**: xhs, post-stat, entity, data-collection
- **接口**:
  - `XhsPostStatEntity`: 主实体（id, todoId, tag, postTitle, postHash, postUrl, authorUrl, likeCount, commentCount, collectCount, topComments, dataAt）
  - `XhsTopComment`: 热门评论快照（content, likeCount, replyCount）
  - `XhsPostStatCreateInput`: 创建输入
  - `XhsPostStatUpdateInput`: 更新输入

### xhs-post-stat.service.ts
小红书帖子数据收集服务。
- **关键词**: xhs, post-stat, service, mongo, data-collection
- **函数**:
  - `create`: 创建帖子数据记录/create post stat
  - `bulkUpsert`: 批量创建或覆盖（按 todoId+postHash 去重）/bulk upsert by hash
  - `update`: 更新记录/update by id
  - `delete`: 删除记录/delete by id
  - `get`: 按ID获取/get by id
  - `listByTodo`: 列出任务下所有记录/list by todoId
  - `getByHash`: 按hash获取/get by hash
  - `buildPostHash`: 基于标题+URL生成hash/generate post hash
