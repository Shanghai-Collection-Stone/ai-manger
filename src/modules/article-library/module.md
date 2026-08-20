# Article-Library Module

## 模块名称 (Module Name)
Article-Library

## 概述 (Overview)
文章库模块提供“库容器 + 文章”的两层结构，支持文章库 CRUD、文章入库、发布状态回写、FIFO 队列领取、二维码 token 推送入口，以及 task-token 专项接口。库和文章都使用 MongoDB 业务自增 ID，并在分配 ID 前校准 counter，避免计数器落后于既有数据后触发 duplicate key；二维码 token 唯一索引只约束真实字符串 token，空值不参与唯一性判断。

## 文件清单 (File List)
- `article-library.module.ts` — Nest 模块声明，导入 DataSource、Admin、Todo 模块并导出文章库服务。
- `entities/article-library.entity.ts` — 文章库容器、推送配置、发布状态、统计结果和输入类型定义。
- `entities/article.entity.ts` — 文章实体、内容载荷、入库输入、更新输入和租约领取结果定义。
- `services/article-library.service.ts` — 文章库容器 CRUD、二维码内容、统计、缩略图和库 ID counter 校准服务。
- `services/article.service.ts` — 文章入库、列表、更新、发布状态、FIFO 租约领取和文章 ID counter 校准服务。
- `controller/article-library.controller.ts` — 管理端文章库与文章 REST 接口。
- `controller/article-library-task.controller.ts` — task-token 与扫码 token 专项文章库接口。

## 函数清单 (Function List)
- `ArticleLibraryModule()` — 注册文章库模块依赖、控制器和服务 | keywords: article-library, module
- `ArticleLibraryService()` — 文章库容器服务 | keywords: article-library, service
- `ensureIndexes()` — 建立文章库索引并校准 article_libraries counter | keywords: article-library-counter, 文章库计数器校准
- `ensureQrTokenIndex()` — 重建二维码 token partial unique 索引并清理历史 null token | keywords: article-library-qr-index, 二维码索引
- `getMaxArticleLibraryId()` — 读取当前最大文章库业务 ID | keywords: article-library-counter, 文章库计数器校准
- `ensureCounterAtLeast(seq)` — 将 article_libraries counter 至少推进到指定下限 | keywords: article-library-counter, 文章库计数器校准
- `nextId()` — 分配新文章库业务 ID 前先校准 counter | keywords: article-library-counter, 文章库计数器校准
- `normalizePushConfig(input)` — 规范化文章库推送配置 | keywords: article-library, push-config
- `create(input)` — 创建文章库容器 | keywords: article-library, create-library
- `tenantScope(tenantId?)` — 构造强制租户作用域过滤，空 tenantId 收口到平台库 | keywords: tenant-scope-filter, mandatory-isolation, 租户作用域过滤
- `get(id,tenantId?)` — 按业务 ID 获取当前租户可见文章库 | keywords: article-library, get-library
- `ensureQrToken(id,tenantId?)` — 确保文章库存在并持久化二维码 token | keywords: article-library-qr, qr-token
- `resolveConfiguredXhsQrShortLink()` — 从环境变量读取小红书二维码短链模板 | keywords: article-library-qr, env-short-link
- `resolveXhsShortLinkRedirect(shortLink)` — 解析小红书短链跳转后的最终 qrcode URL | keywords: article-library-qr, short-link-redirect
- `rewriteXhsQrcodePParam(redirectUrl,qrContent)` — 将原二维码 JSON 写入小红书 miniapp qrcode 的 p 参数 | keywords: article-library-qr, p-param-rewrite
- `buildPushQrContent(input)` — 构建文章库二维码 payload 与可渲染内容 | keywords: article-library-qr, qr-content-build
- `getByQrToken(id,token)` — 通过文章库 ID 与二维码 token 获取文章库 | keywords: article-library-qr, get-by-token
- `list(params)` — 列出当前租户可见文章库 | keywords: article-library, list-libraries
- `update(input)` — 更新文章库基础信息和推送配置 | keywords: article-library, update-library
- `delete(id,tenantId?)` — 删除文章库并级联删除所属文章 | keywords: article-library, delete-library
- `getStats(libraryId)` — 聚合文章库内发布状态和租约占用统计 | keywords: article-library, stats
- `getThumbnailImages(libraryId,limit?)` — 读取文章库缩略图所需的最近文章首图 | keywords: article-library, thumbnail
- `ArticleService()` — 文章服务 | keywords: article, service
- `ensureIndexes()` — 建立文章及来源选题查询索引并校准 articles counter | keywords: article-id-counter, 文章入库, 计数器校准
- `getMaxArticleId()` — 读取当前最大文章业务 ID | keywords: article-id-counter, 文章入库, 计数器校准
- `ensureCounterAtLeast(seq)` — 将 articles counter 至少推进到指定下限 | keywords: article-id-counter, 文章入库, 计数器校准
- `nextId()` — 分配新文章业务 ID 前先校准 counter | keywords: article-id-counter, 文章入库, 计数器校准
- `create(input)` — 单篇文章入库 | keywords: article, create
- `bulkCreate(inputs)` — 批量文章入库 | keywords: article, bulk-create
- `get(id,tenantId?)` — 获取当前租户可见文章 | keywords: article, get
- `list(params)` — 按文章库、状态和 FIFO 顺序列出文章 | keywords: article, list
- `update(input)` — 更新文章字段和 meta | keywords: article, update
- `updatePublishStatus(id,status,tenantId?,leaseToken?,meta?)` — 更新发布状态并释放租约 | keywords: article, publish-status
- `moveToLibrary({id,fromLibraryId,toLibraryId,tenantId?})` — 把文章移动到同租户下的另一个文章库，租约未过期的在途文章拒绝移动 | keywords: 移动文章, 跨库转移, move-article-to-library, cross-library-transfer
- `delete(id,tenantId?)` — 删除单篇文章 | keywords: article, delete
- `leaseNext(params)` — 以 CAS 方式领取下一篇未发布文章并写入租约 | keywords: article, lease-next
- `releaseLease(id,tenantId?,leaseToken?)` — 主动释放文章租约 | keywords: article, release-lease
- `ArticleLibraryController()` — 管理端文章库控制器 | keywords: article-library, admin-controller
- `toAbsoluteImageUrl(url)` — 将相对图片路径拼接为完整地址 | keywords: prefix-image-url, app-base-url, 图片地址前缀拼接
- `resolveAuthScope(req)` — 解析管理端请求鉴权作用域 | keywords: article-library, auth-scope
- `createLibrary(body,req)` — 管理端创建文章库 | keywords: article-library, create-endpoint
- `listLibraries(type,limit,offset,req)` — 管理端列出文章库并返回统计和缩略图 | keywords: article-library, list-endpoint
- `getLibrary(libraryId,req)` — 管理端获取文章库详情 | keywords: article-library, get-endpoint
- `getPushQr(libraryId,req)` — 管理端获取文章库二维码内容 | keywords: article-library-qr, push-qr-endpoint
- `updateLibrary(libraryId,body,req)` — 管理端更新文章库 | keywords: article-library, update-endpoint
- `deleteLibrary(libraryId,req)` — 管理端删除文章库 | keywords: article-library, delete-endpoint
- `createArticle(libraryId,body,req)` — 管理端向文章库写入文章 | keywords: article, create-endpoint
- `listArticles(libraryId,status,limit,offset,req)` — 管理端列出文章库内文章 | keywords: article, list-endpoint
- `updateArticleStatus(libraryId,articleId,body,req)` — 管理端更新文章发布状态 | keywords: article, status-endpoint
- `moveArticleToLibrary(libraryId,articleId,body,req)` — 管理端把文章移动到当前用户的另一个文章库 | keywords: 移动文章, 跨库转移, move-article-to-library, cross-library-transfer
- `deleteArticle(libraryId,articleId,req)` — 管理端删除文章 | keywords: article, delete-endpoint
- `leaseNext(libraryId,req)` — 管理端测试领取下一篇文章 | keywords: article, lease-endpoint
- `ArticleLibraryTaskController()` — task-token 与扫码 token 控制器 | keywords: article-library, task-controller
- `resolveTodoForLibrary(todoId,taskToken,libraryId)` — 校验 task token 并确认 todo 绑定目标文章库 | keywords: task-api, todo-binding
- `resolveLibraryByQrToken(token,libraryId)` — 校验扫码 token 并获取文章库 | keywords: article-library-qr, token-auth
- `parseStatusMeta(meta)` — 解析状态回写 meta JSON 字符串 | keywords: article-status-meta, meta-json-parse, 文章状态元数据, JSON解析
- `getLibrary(todoId,libraryId,taskToken)` — task-api 获取文章库详情 | keywords: task-api, get-library
- `getPushUrl(todoId,libraryId,taskToken)` — task-api 获取推送链接与二维码内容 | keywords: task-api, push-url
- `getLibraryByToken(body)` — 扫码 token 获取文章库详情 | keywords: article-library-qr, detail-by-token
- `leaseNext(todoId,libraryId,taskToken)` — task-api 领取下一篇文章 | keywords: task-api, lease-next
- `leaseNextByToken(body)` — 扫码 token 领取下一篇文章 | keywords: article-library-qr, lease-by-token
- `toAbsoluteImageUrl(url)` — task-api 响应中拼接图片完整地址 | keywords: prefix-image-url, app-base-url, 图片地址前缀拼接
- `updateStatusByToken(articleId,body)` — 扫码 token 更新文章发布状态 | keywords: article-library-qr, status-by-token
- `releaseLeaseByToken(articleId,body)` — 扫码 token 主动释放租约 | keywords: article-library-qr, release-by-token
- `updateStatus(todoId,libraryId,articleId,taskToken,body)` — taskToken 兼容路由更新文章发布状态 | keywords: task-api, update-status
- `releaseLease(todoId,libraryId,articleId,taskToken,body)` — taskToken 兼容路由释放文章租约 | keywords: task-api, release-lease

## 关键词索引 (Keyword Index)
| 中文 | English |
|---|---|
| 文章库 | article-library |
| 文章 | article |
| 计数器校准 | article-library-counter |
| 文章入库计数器 | article-id-counter |
| 推送配置 | push-config |
| 二维码 | article-library-qr |
| 二维码索引 | article-library-qr-index |
| 小红书短链 | short-link-redirect |
| 租户隔离 | tenant-scope-filter |
| 强制隔离 | mandatory-isolation |
| 管理端接口 | admin-controller |
| 专项任务接口 | task-api |
| 扫码鉴权 | token-auth |
| 状态元数据 | article-status-meta |
| 队列领取 | lease-next |
| 移动文章 | move-article-to-library |
| 跨库转移 | cross-library-transfer |
| 主动释放租约 | release-lease |
| 缩略图 | thumbnail |

## 类型导出 (Type Exports)
- `ArticleLibraryScope` — 文章库作用域枚举 | keywords: article-library, scope
- `ArticlePublishStatus` — 文章发布状态枚举 | keywords: article, publish-status
- `ArticleLibraryPushConfig` — 文章库推送配置 | keywords: article-library, push-config
- `ArticleLibraryEntity` — 文章库容器实体 | keywords: article-library, entity
- `ArticleLibraryCreateInput` — 创建文章库输入 | keywords: article-library, create-input
- `ArticleLibraryUpdateInput` — 更新文章库输入 | keywords: article-library, update-input
- `ArticleLibraryStats` — 文章库统计结果 | keywords: article-library, stats
- `ArticleContent` — 文章内容载荷 | keywords: article, content
- `ArticleEntity` — 文章实体 | keywords: article, entity
- `ArticleCreateInput` — 文章入库输入 | keywords: article, create-input
- `ArticleUpdateInput` — 文章更新输入 | keywords: article, update-input
- `ArticleLeaseResult` — 文章领取返回结果 | keywords: article, lease-result

## 模块功能描述 (Module Feature Description)
管理端接口挂载在 `/api/article-library` 下，提供文章库创建、列表、详情、更新、删除、二维码内容获取、文章入库、文章列表、发布状态更新、文章跨库移动、文章删除和队列领取测试。跨库移动走 `PATCH /:libraryId/articles/:articleId/library`，校验来源库、目标库与文章都属于当前租户用户，源库与目标库相同返回 400，文章仍持有未过期租约返回 409。task 专项接口挂载在 `/task-api` 下，支持 todo 绑定资源鉴权与扫码 token 鉴权两种方式。

文章库容器使用 `article_libraries` 集合并对 `id` 建唯一索引；`pushConfig.qrToken` 使用 partial unique 索引，只索引字符串 token，历史 null token 会在索引初始化时清理。文章使用 `articles` 集合并对 `id` 建唯一索引，同时按租户、用户、来源与 `meta.xhsTopicId` 建组合索引，供选题工作台识别已经入库的来源子选题。两个服务在索引初始化和 ID 分配前都会读取集合现有最大业务 ID，并把对应 `counters` 记录推进到不低于该值，防止 counter 被清空、回滚或落后时重复分配已存在 ID。

队列领取只面向 `unpublished` 文章，按 `createdAt` FIFO 排序，并通过 `findOneAndUpdate` 原子写入 `lockExpireAt` 和 `lastLeaseToken`。发布状态回写成功或主动 release 会释放租约；自然过期后文章可再次领取。`published` 文章不再参与领取池。

二维码内容由文章库 `pushConfig.qrToken` 驱动，管理端可懒生成 token。默认二维码内容是包含 `token` 与 `articleLibraryId` 的 JSON 字符串；配置 `ARTICLE_LIBRARY_XHS_QR_SHORT_LINK` 或兼容环境变量时，会解析小红书短链落地 URL 并改写 miniapp qrcode 的 `p` 参数。
