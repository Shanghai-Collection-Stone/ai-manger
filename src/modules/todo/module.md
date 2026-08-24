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

### task-callback.service.ts
Todo回调事件处理服务，异步处理任务完成/失败时的回调事件列表。
- `processCallbacks` — 非阻塞触发所有回调（status 变为 done/failed 时由 TodoService 调用）
- `handleUpdateProcessTask` — 处理 `update_process_task` 事件：更新目标任务 assignee，触发 robot 执行
- **关键词**: callback, update-process-task, async, robot-trigger

### todo.module.ts
Todo模块定义。
- **关键词**: module

### todo-task.controller.ts
任务专项接口控制器，供 claw skill 通过 taskToken 鉴权后操作任务和执行节点（无需管理员登录态）。

帖子数据的两个写入口（单条 `createXhsStat` 与批量 `bulkUpsertXhsStats`）写完都会调 `recordXhsCrawlRun`，在 [xhs-topic-data 模块](../xhs-topic-data/module.md) 落一条抓取运行记录——**每回写一次就是一次抓取**，长时采集任务同一个 todoId 下会记成多次。记账放在写入口而不是读取时惰性补，是因为只有写入那一刻才分得清「这批数据属于第几次抓取」。
- **路由前缀**: `/task-api`
- **关键词**: task-api, task-token, claw-skill, todo-item, callback, canvas, xhs-stats, record-crawl-run
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
  - `markCanvasArticleSent`: 标记 Canvas 文章已发送（写入 sentAt）/mark canvas article as sent
  - `listXhsStats`: 列出任务下所有帖子数据/list xhs stats by todo
  - `getXhsStat`: 获取单条帖子数据/get xhs post stat by id
  - `createXhsStat`: 新增一条帖子数据/create xhs post stat
  - `bulkUpsertXhsStats`: 批量新增/覆盖帖子数据/bulk upsert xhs stats
  - `recordXhsCrawlRun(todoId)` — 回写后在数据看板落一条抓取运行记录；走 ModuleRef 取服务，看板模块缺席就静默跳过 | keywords: 记录抓取运行, 回写后记账, record-crawl-run, post-write-bookkeeping
  - `updateXhsStat`: 更新帖子数据/update xhs post stat
  - `deleteXhsStat`: 删除帖子数据/delete xhs post stat

### todo.entity.ts
Todo实体。新增 `taskToken`、`deadline`、`category`、`callbacks` 字段（任务专属token、长时任务截止时间、分类标签如xhs、完成/失败回调列表）。
- `TodoCallback` — 回调事件接口（event + params），支持 `update_process_task` 事件（自动指派+触发目标任务）
- **关键词**: entity, deadline, long_task, category, xhs, callbacks

### todo-item.entity.ts
清单实体。
- **关键词**: todo-item, entity

### xhs-post-stat.entity.ts
小红书帖子数据收集实体（关联 todoId 与抓取运行 crawlRunId，含互动数据与热门评论快照）。
- **关键词**: xhs, post-stat, entity, data-collection
- **接口**:
  - `XhsPostStatEntity`: 主实体（id, todoId, topicId, tag, postTitle, postHash, postUrl, authorUrl, likeCount, commentCount, collectCount, viewCount, shareCount, topComments, dataAt）。`viewCount` / `shareCount` 采集端取不到时整个字段省略而不是填 0，看板据此区分「真的是 0」和「还没采到」；`topicId` / `crawlRunId` 由 xhs-topic-data 模块在**回写那一刻**划归——每次回写算一次抓取，长时采集任务同一个 todoId 下会分成多个 `crawlRunId`
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
  - `assignCrawlRun(todoId, topicId, crawlRunId)` — 把该 Todo 下尚未归属运行的数据划给指定抓取运行与子选题 | keywords: 回填抓取运行, 归属子选题, 分批划归, assign-crawl-run, backfill-topic-id, batch-attribution
  - `listByTopicPaged(topicId, page, pageSize)` — 按子选题分页读取抓取明细 | keywords: 选题抓取明细, 分页查询, topic-stat-details, paged-query
  - `listByTopic(topicId)` — 读取子选题全部抓取明细供聚合与舆论分析 | keywords: 选题全部数据, 聚合数据源, topic-all-stats, aggregation-source
  - `deleteByTopicDay(topicId, dayStart, dayEnd)` — 删除子选题某自然日的全部数据 | keywords: 按天删除数据, 清理抓取记录, delete-stats-by-day, purge-crawl-records
  - `deleteByTopic(topicId)` — 删除子选题全部抓取数据 | keywords: 清空选题数据, 删除全部记录, purge-topic-stats, delete-all-records
  - `buildPostHash`: 基于标题+URL生成hash/generate post hash
