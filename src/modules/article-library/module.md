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
  - `ArticleLibraryPushConfig`: 推送配置（statusFilter / pushUrl / qrToken）
  - `ArticleLibraryEntity`: 库容器实体
  - `ArticleLibraryCreateInput`: 创建入参
  - `ArticleLibraryUpdateInput`: 更新入参
  - `ArticleLibraryStats`: 库内文章数量统计（含当前租约占用数 occupiedCount）

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
  - `ensureQrToken`: 确保文章库有二维码 token/ensure qr token
  - `getByQrToken`: 通过二维码 token 获取文章库/get by qr token
  - `list`: 列表库/list libraries
  - `update`: 更新库（基础信息 / 推送配置）/update library
  - `delete`: 删除库（级联删除文章）/delete cascade
  - `getStats`: 状态统计与租约占用统计/stats aggregate with occupied leases
  - `getThumbnailImages`: 取前 N 篇首图做缩略图/thumbnail sources

### services/article.service.ts
文章服务：入库 / 列表 / 更新 / 状态切换 / FIFO 租约领取。
- **关键词**: article, service, crud, lease, fifo, cas, 15-min
- **函数**:
  - `ensureIndexes`: 建索引（含租约扫描索引）并把 articles counter 校准到当前最大文章 ID/ensure indexes lease counter calibration
  - `getMaxArticleId`: 读取 articles 集合当前最大业务 ID，用于修复 counter 落后导致的 duplicate key/article max id counter calibration
  - `ensureCounterAtLeast`: 将 articles counter 至少推进到指定下限，避免单篇入库撞上既有 id/article counter floor
  - `nextId`: 自增ID；分配前先校准 counter 到已有最大文章 ID/next id with counter calibration
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
  - `getPushQr`: 获取二维码内容 GET /api/article-library/:libraryId/push-qr
  - `updateLibrary`: 更新库 PATCH /api/article-library/:libraryId
  - `deleteLibrary`: 删除库 DELETE /api/article-library/:libraryId
  - `createArticle`: 文章入库 POST /api/article-library/:libraryId/articles
  - `listArticles`: 文章列表 GET /api/article-library/:libraryId/articles
  - `updateArticleStatus`: 更新文章状态 PATCH /api/article-library/:libraryId/articles/:articleId/status
  - `deleteArticle`: 删除文章 DELETE /api/article-library/:libraryId/articles/:articleId
  - `leaseNext`: 管理端队列领取测试 POST /api/article-library/:libraryId/articles/lease-next

### controller/article-library-task.controller.ts
task-token 专项控制器（对齐 TodoTaskController）；原 task-api 路由校验 todo.associatedResources 含目标库。扫码 token 路由校验文章库自身 qrToken。
- **关键词**: controller, task-api, task-token, article-library, lease
- **函数**:
  - `resolveTodoForLibrary`: 校验 token + 校验库已绑定 todo/resolve todo with library binding
  - `getLibrary`: 获取库 GET /task-api/:todoId/article-library/:libraryId
  - `getPushUrl`: 获取推送链接与二维码内容（`qrContent` 为 JSON 字符串：`{ token, articleLibraryId }`，token 为文章库 qrToken） GET .../push-url
  - `getLibraryByToken`: token 版获取库详情 POST `/task-api/article-library/detail`
  - `leaseNext`: 队列领取 POST .../lease-next
  - `leaseNextByToken`: token 版队列领取 POST `/task-api/article-library/lease-next`，请求体可直接传二维码 JSON
  - `updateStatusByToken`: token 版更新文章状态 PATCH `/task-api/article-library/articles/:articleId/status`
  - `releaseLeaseByToken`: token 版主动释放租约 POST `/task-api/article-library/articles/:articleId/release`
  - `updateStatus`: taskToken 兼容版更新文章状态 PATCH .../articles/:articleId/status
  - `releaseLease`: 释放租约 POST .../articles/:articleId/release

### article-library.module.ts
模块声明（导入 DataSource/Admin/Todo，导出 2 个 Service）。
- **关键词**: module, article-library

## 接口对应关系

| 需求接口 | 管理端 | task-api |
|---|---|---|
| 1. 库 CRUD | POST/GET/PATCH/DELETE `/api/article-library` | — |
| 2. 文章入库 | POST `/api/article-library/:libraryId/articles` | — |
| 3. 文章状态更新 | PATCH `/api/article-library/:libraryId/articles/:articleId/status` | PATCH `/task-api/article-library/articles/:articleId/status`（扫码 token）；兼容 PATCH `/task-api/:todoId/article-library/:libraryId/articles/:articleId/status` |
| 4. 队列顺序取出 | POST `/api/article-library/:libraryId/articles/lease-next` | POST `/task-api/:todoId/article-library/:libraryId/lease-next` |
| 5. 推送链接 / 二维码 | GET `/api/article-library/:libraryId/push-qr` | GET `/task-api/:todoId/article-library/:libraryId/push-url`（返回 `pushUrl`、`qrPayload`、`qrContent`；二维码内容为 `{"token":"...","articleLibraryId":1}`） |
| 6. 扫码 token 获取库/文章 | — | POST `/task-api/article-library/detail` 获取库详情；POST `/task-api/article-library/lease-next` 领取下一篇文章 |
| 7. 扫码 token 主动释放租约 | — | POST `/task-api/article-library/articles/:articleId/release` |

## 设计要点

- **队列租约**：领取时 `findOneAndUpdate` 固定过滤 `publishStatus: 'unpublished'`，并以 `sort: { createdAt: 1 }` + `$or: [lockExpireAt 不存在 / null / < now]` 作为租约过滤，原子写入 `lockExpireAt = now + 15min` 与 `lastLeaseToken`。已发送文章和租约未释放文章都不会再次被领取。释放方式：15 分钟自然过期；状态回写成功时释放；主动调用 release 接口释放。状态回写可携带 `leaseToken` 做乐观锁，防止过期任务反向覆盖新租约。
- **状态语义**：`unpublished`（未发布，唯一领取池）/`published`（已发布/已发送，永不参与 `leaseNext` 领取）。`statusFilter` 仅作为历史兼容配置保留，不允许把 `published` 文章重新放回领取池。
- **缩略图**：库实体不持有封面字段；`getThumbnailImages` 按 `createdAt` 倒序取前 N 篇文章的首图。
- **task-api 鉴权**：带 `todoId` 的 task-api 仍照搬 `TodoTaskController.resolveTodo` 模式 —— taskToken → todo → 校验 `todo.associatedResources` 含 `{ type: 'article-library', resourceId: libraryId }`。扫码场景使用文章库 `qrToken`，请求体传入 `{ token, articleLibraryId }`，后端按文章库 ID + token 校验后获取库、领取文章或回写发布状态，不需要绑定任务。
- **二维码内容**：管理端 `GET /api/article-library/:libraryId/push-qr` 会懒生成并持久化 `pushConfig.qrToken`，前端使用生产级二维码库把返回的 `qrContent` 渲染成二维码。
