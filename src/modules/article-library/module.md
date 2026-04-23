# Article-Library Module

## 模块描述
文章库：容器（库）+ 文章的两层结构。支持库 CRUD、文章入库（可从 canvas 搬运）、发布状态更新，以及按 FIFO 顺序的队列领取（15 分钟租约、过期自动回池）。
同时提供 task-token 专项接口，供推送机器人 / 自动任务按 todo 关联资源方式调用。
文件路径: `src/modules/article-library`

## 功能描述及关键词

### entities/article-library.entity.ts
文章库容器实体与输入类型定义（含 push 配置、自由字符串 type）。
- **关键词**: article-library, entity, push-config, scope, tenant
- **类型**:
  - `ArticleLibraryScope`: 作用域枚举/platform tenant scope
  - `ArticlePublishStatus`: 发布状态枚举 unpublished/published
  - `ArticleLibraryPushConfig`: 推送配置（statusFilter / pushUrl）
  - `ArticleLibraryEntity`: 库容器实体
  - `ArticleLibraryCreateInput`: 创建入参
  - `ArticleLibraryUpdateInput`: 更新入参
  - `ArticleLibraryStats`: 库内文章数量统计

### entities/article.entity.ts
文章实体与输入类型，含租约字段。
- **关键词**: article, entity, lease, publish-status
- **类型**:
  - `ArticleContent`: 文章内容载荷（title/tags/contentJson/text/imageUrls）
  - `ArticleEntity`: 文章实体（publishStatus / lockExpireAt / lastLeaseToken 等）
  - `ArticleCreateInput`: 入库入参
  - `ArticleUpdateInput`: 更新入参
  - `ArticleLeaseResult`: 领取返回（article + leaseToken + leaseExpireAt）

### services/article-library.service.ts
文章库容器服务：CRUD、统计与缩略图取图。
- **关键词**: article-library, service, crud, stats, thumbnail, counter
- **函数**:
  - `ensureIndexes`: 建索引/ensure indexes
  - `nextId`: 自增ID/next id
  - `normalizePushConfig`: 推送配置规范化/normalize push config
  - `create`: 创建库/create library
  - `get`: 获取库/get by id
  - `list`: 列表库/list libraries
  - `update`: 更新库（基础信息 / 推送配置）/update library
  - `delete`: 删除库（级联删除文章）/delete cascade
  - `getStats`: 状态统计/stats aggregate
  - `getThumbnailImages`: 取前 N 篇首图做缩略图/thumbnail sources

### services/article.service.ts
文章服务：入库 / 列表 / 更新 / 状态切换 / FIFO 租约领取。
- **关键词**: article, service, crud, lease, fifo, cas, 15-min
- **函数**:
  - `ensureIndexes`: 建索引（含租约扫描索引）/ensure indexes lease
  - `nextId`: 自增ID/next id
  - `create`: 文章入库（单篇）/create put into library
  - `bulkCreate`: 批量入库（canvas 整份搬运）/bulk create
  - `get`: 获取文章/get
  - `list`: 列表（按状态过滤，FIFO 顺序）/list by library
  - `update`: 更新文章字段/update fields
  - `updatePublishStatus`: 更新发布状态（释放租约）/update publish status release
  - `delete`: 删除文章/delete
  - `leaseNext`: FIFO 原子抢占领取（CAS + 15min 租约）/lease next fifo cas
  - `releaseLease`: 主动释放租约/release lease

### controller/article-library.controller.ts
管理端控制器（Bearer token 鉴权，对齐 gallery.controller.resolveAuthScope）。
- **关键词**: controller, article-library, admin, crud, auth
- **函数**:
  - `resolveAuthScope`: 请求鉴权解析/resolve auth scope
  - `createLibrary`: 创建库 POST /api/article-library
  - `listLibraries`: 列表库 GET /api/article-library（含统计+缩略图）
  - `getLibrary`: 获取库详情 GET /api/article-library/:libraryId
  - `updateLibrary`: 更新库 PATCH /api/article-library/:libraryId
  - `deleteLibrary`: 删除库 DELETE /api/article-library/:libraryId
  - `createArticle`: 文章入库 POST /api/article-library/:libraryId/articles
  - `listArticles`: 文章列表 GET /api/article-library/:libraryId/articles
  - `updateArticleStatus`: 更新文章状态 PATCH /api/article-library/:libraryId/articles/:articleId/status
  - `deleteArticle`: 删除文章 DELETE /api/article-library/:libraryId/articles/:articleId
  - `leaseNext`: 管理端队列领取测试 POST /api/article-library/:libraryId/articles/lease-next

### controller/article-library-task.controller.ts
task-token 专项控制器（对齐 TodoTaskController）；校验 todo.associatedResources 含目标库。
- **关键词**: controller, task-api, task-token, article-library, lease
- **函数**:
  - `resolveTodoForLibrary`: 校验 token + 校验库已绑定 todo/resolve todo with library binding
  - `getLibrary`: 获取库 GET /task-api/:todoId/article-library/:libraryId
  - `getPushUrl`: 获取推送链接（二维码占位） GET .../push-url
  - `leaseNext`: 队列领取 POST .../lease-next
  - `updateStatus`: 更新文章状态 PATCH .../articles/:articleId/status
  - `releaseLease`: 释放租约 POST .../articles/:articleId/release

### article-library.module.ts
模块声明（导入 DataSource/Admin/Todo，导出 2 个 Service）。
- **关键词**: module, article-library

## 接口对应关系

| 需求接口 | 管理端 | task-api |
|---|---|---|
| 1. 库 CRUD | POST/GET/PATCH/DELETE `/api/article-library` | — |
| 2. 文章入库 | POST `/api/article-library/:libraryId/articles` | — |
| 3. 文章状态更新 | PATCH `/api/article-library/:libraryId/articles/:articleId/status` | PATCH `/task-api/:todoId/article-library/:libraryId/articles/:articleId/status` |
| 4. 队列顺序取出 | POST `/api/article-library/:libraryId/articles/lease-next` | POST `/task-api/:todoId/article-library/:libraryId/lease-next` |
| 5. 推送链接 / 二维码 | — | GET `/task-api/:todoId/article-library/:libraryId/push-url`（二维码暂以 pushUrl 占位） |

## 设计要点

- **队列租约**：领取时 `findOneAndUpdate` 以 `sort: { createdAt: 1 }` + `$or: [lockExpireAt 不存在 / null / < now]` 作为过滤，原子写入 `lockExpireAt = now + 15min` 与 `lastLeaseToken`。15 分钟内未完成状态回写即自动回池，允许下一个消费者再次抢占。状态回写可携带 `leaseToken` 做乐观锁，防止过期任务反向覆盖新租约。
- **状态语义**：`unpublished`（未发布，默认入队池）/`published`（已发布）。允许"已发布"重新入队池（`statusFilter` 可同时勾选两种，覆盖重复推送场景）。
- **缩略图**：库实体不持有封面字段；`getThumbnailImages` 按 `createdAt` 倒序取前 N 篇文章的首图。
- **task-api 鉴权**：照搬 `TodoTaskController.resolveTodo` 模式 —— token → todo → 校验 `todo.associatedResources` 含 `{ type: 'article-library', resourceId: libraryId }`，不引入新权限模型。
