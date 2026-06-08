# Featured-Article Module

## 模块名称 (Module Name)
Featured-Article

## 概述 (Overview)
精选文章模块负责保存前端工具菜单中的“精选文章”工作区与小红书帖子式页面草稿。它提供工作区选择、页面增删改、图片/标题/正文草稿持久化，并支持把当前页面转换为文章库文章后存入指定文章库；模块不再生成默认工作区数据。

## 文件清单 (File List)
- `featured-article.module.ts` — Nest 模块声明，注册控制器和服务。
- `controller/featured-article.controller.ts` — 管理端精选文章接口，负责工作区、页面和存入文章库入口。
- `services/featured-article.service.ts` — 精选文章工作区 CRUD、页面编辑和文章库入库服务。
- `entities/featured-article.entity.ts` — 精选文章工作区、页面、图片引用、输入类型和固定图片槽位参数。

## 函数清单 (Function List)
- `FeaturedArticleModule()` — 注册精选文章模块依赖、控制器和服务 | keywords: featured-article, module
- `FeaturedArticleController()` — 精选文章管理端控制器 | keywords: featured-article, admin-controller
- `requireScope(req)` — 从 AdminAuthGuard 注入的用户信息解析精选文章作用域 | keywords: featured-article, require-auth-scope
- `parseNumericId(value,errorCode)` — 把路径或请求体字段解析为正整数业务 ID | keywords: featured-article, parse-numeric-id
- `listWorkspaces(req,limit,offset)` — 列出当前作用域的精选文章工作区 | keywords: featured-article, list-workspaces-endpoint
- `createWorkspace(req,body)` — 创建精选文章工作区 | keywords: featured-article, create-workspace-endpoint
- `getWorkspace(req,workspaceId)` — 获取单个工作区详情 | keywords: featured-article, get-workspace-endpoint
- `updateWorkspace(req,workspaceId,body)` — 更新工作区基础信息 | keywords: featured-article, update-workspace-endpoint
- `deleteWorkspace(req,workspaceId)` — 删除工作区 | keywords: featured-article, delete-workspace-endpoint
- `createPage(req,workspaceId,body)` — 在工作区内新增精选文章页面 | keywords: featured-article, create-page-endpoint
- `updatePage(req,workspaceId,pageId,body)` — 更新工作区内的单个页面 | keywords: featured-article, update-page-endpoint
- `deletePage(req,workspaceId,pageId)` — 删除工作区内的单个页面 | keywords: featured-article, delete-page-endpoint
- `storePageToLibrary(req,workspaceId,pageId,body)` — 把页面转换为文章库文章并入库 | keywords: featured-article, store-to-library-endpoint
- `FeaturedArticleService()` — 精选文章工作区服务 | keywords: featured-article, workspace-service
- `ensureIndexes()` — 建立工作区集合索引和计数器 | keywords: featured-article, ensure-indexes
- `nextId()` — 生成下一个工作区业务 ID | keywords: featured-article, next-workspace-id
- `resolveScopeId(scope)` — 解析租户或用户作用域 ID | keywords: featured-article, resolve-scope-id
- `normalizeWorkspaceName(input,fallback)` — 规范化工作区名称 | keywords: featured-article, normalize-workspace
- `normalizeImageRef(input)` — 规范化页面图片引用 | keywords: featured-article, normalize-image-reference
- `normalizeImageMode(input)` — 规范化页面图片模式 | keywords: featured-article, normalize-image-mode
- `normalizePageInput(input,index,now)` — 规范化页面创建输入 | keywords: featured-article, normalize-page
- `patchPage(current,patch)` — 合并页面补丁并保留不可变字段 | keywords: featured-article, patch-page
- `toSummary(workspace)` — 生成工作区摘要并附带文章数量 | keywords: featured-article, workspace-summary
- `listWorkspaces(params)` — 查询当前作用域工作区列表 | keywords: featured-article, list-workspaces
- `createWorkspace(scope,input)` — 创建工作区文档 | keywords: featured-article, create-workspace
- `getWorkspace(scope,id)` — 获取工作区文档 | keywords: featured-article, get-workspace
- `updateWorkspace(scope,id,input)` — 更新工作区文档 | keywords: featured-article, update-workspace
- `deleteWorkspace(scope,id)` — 删除工作区文档 | keywords: featured-article, delete-workspace
- `createPage(scope,workspaceId,input)` — 新增页面子文档 | keywords: featured-article, create-page
- `updatePage(scope,workspaceId,pageId,patch)` — 更新页面子文档 | keywords: featured-article, update-page
- `deletePage(scope,workspaceId,pageId)` — 删除页面子文档 | keywords: featured-article, delete-page
- `readImageUrl(image)` — 读取图片引用的可展示地址 | keywords: featured-article, image-url
- `buildArticlePayload(params)` — 把精选文章页面转为文章库入库载荷 | keywords: featured-article, article-library-payload
- `storePageToLibrary(params)` — 存入文章库并回写页面入库记录 | keywords: featured-article, store-to-library

## 关键词索引 (Keyword Index)
| 中文 | English |
|---|---|
| 精选文章 | featured-article |
| 工作区服务 | workspace-service |
| 工作区列表 | list-workspaces |
| 页面输入 | page-input |
| 创建页面 | create-page |
| 更新页面 | update-page |
| 删除页面 | delete-page |
| 图片引用 | image-reference |
| 图片槽位 | image-slot-size |
| 图片模式 | image-layout |
| 存入文章库 | store-to-library |
| 文章库载荷 | article-library-payload |
| 鉴权作用域 | auth-scope |

## 类型导出 (Type Exports)
- `FeaturedArticleScope` — 精选文章可见作用域 | keywords: featured-article, workspace-scope
- `FeaturedArticleImageMode` — 页面图片布局模式 | keywords: featured-article, image-layout
- `FEATURED_ARTICLE_IMAGE_SLOT_SIZE` — 小红书竖图图片槽位标准尺寸 | keywords: featured-article, image-slot-size
- `FeaturedArticleImageRef` — 页面图片引用 | keywords: featured-article, image-reference
- `FeaturedArticlePage` — 工作区内单个文章页面 | keywords: featured-article, article-page
- `FeaturedArticleWorkspaceEntity` — 精选文章工作区实体 | keywords: featured-article, workspace-entity
- `FeaturedArticleWorkspaceCreateInput` — 创建工作区输入 | keywords: featured-article, workspace-create
- `FeaturedArticleWorkspaceUpdateInput` — 更新工作区输入 | keywords: featured-article, workspace-update
- `FeaturedArticlePageInput` — 页面创建或更新输入 | keywords: featured-article, page-input
- `FeaturedArticleAuthScope` — 后台用户解析出的作用域 | keywords: featured-article, auth-scope
- `FeaturedArticleWorkspaceSummary` — 工作区列表摘要 | keywords: featured-article, workspace-summary

## 模块功能描述 (Module Feature Description)
接口统一挂载在 `/api/featured-article` 下，并在每个外部入口同址声明 `AdminAuthGuard`。工作区按 `tenantId` 优先、无租户时按 `userId` 隔离，页面作为工作区内子文档保存，支持图片数组、拼图地址、标题、正文、选题和 AI 图片提示词。后端只返回真实保存的工作区，不自动创建默认演示数据。存入文章库时，服务会校验目标文章库属于当前租户，把页面转换为 `ArticleCreateInput` 并调用 `ArticleService.create`，随后把生成的文章 ID 回写到页面上。
