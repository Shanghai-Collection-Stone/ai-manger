# 模块名称 (Module Name)

视频库模块（video-library）

## 概述 (Overview)

桌面端「AI 视频」板块的后端：视频素材的分组、标签、记录管理，以及**阿里云 OSS 直传票据**签发。

与图库（`../gallery`）最大的不同是**二进制不经过本服务**。图库那条 multipart 落盘的路对视频不成立：单个文件动辄几百 MB，会同时吃掉应用服务器的带宽、磁盘和请求超时预算。这里的分工是：前端向 `POST oss/signature` 换一张限定了对象键、大小上限与过期时间的票据，把文件直接 POST 给 OSS，传完再回一条带 `key` 的登记请求——本服务收到的最大请求也就几百字节。

文件路径: `src/modules/video-library`
路由前缀: `api/video-library`
前端调用方: `xhs-manger/src/workbench/views/video-library/`（桌面工作台，票据字段与 `ossDirectUpload.js` 逐字对应）
Mongo 集合: `videos`、`video_groups`（自增 ID 共用 `counters`）
环境变量: `OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_ENDPOINT`(可选，默认 `<region>.aliyuncs.com`)、`OSS_PUBLIC_BASE_URL`(可选 CDN / 自定义域名)、`OSS_VIDEO_LIBRARY_DIR`(默认 `video-library`)、`OSS_VIDEO_MAX_BYTES`(默认 2GB)、`OSS_POSTER_MAX_BYTES`(默认 10MB)、`OSS_SIGNATURE_EXPIRE_SECONDS`(默认 900，上限 3600)。

已知限制：不支持分片续传（单次 PostObject，断了要重传）；OSS 对象的清理是尽力而为，失败的键在删除响应的 `orphanKeys` 里，没有自动重试的对账任务；没有向量检索（视频没有可嵌入的文本内容，建了就是每次写入白跑一次 embedding）。

## 文件清单 (File List)

- `video-library.module.ts` — 模块定义，导入 `DataSourceModule`（`DS_MONGO_DB`）与 `AdminModule`（token 换用户）。
- `controller/video-library.controller.ts` — `api/video-library` 下的全部入口。
- `services/video-library.service.ts` — 视频记录的登记、游标分页查询、标签、更新与删除。
- `services/video-group.service.ts` — 分组 CRUD 与分组内视频计数。
- `services/oss-storage.service.ts` — OSS 直传票据签发、对象键生成、可访问地址与对象删除。
- `services/oss-storage.service.spec.ts` — 签名与对象键的回归测试。
- `controller/video-library.controller.spec.ts` — HTTP 契约测试：路由、鉴权、入参归一与响应形状（两个测试跑法：`npx jest src/modules/video-library`）。
- `entities/video.entity.ts` — 视频记录实体与出入参类型。
- `entities/video-group.entity.ts` — 视频分组实体与出入参类型。

## 函数清单 (Function List)

### controller/video-library.controller.ts

- `readString(value)` — 只认标量的字符串读取，避免 `String(unknown)` 把对象写成 `[object Object]` | keywords: 字符串读取, 入参归一, read-string, normalize-input
- `normalizeTags(input)` — 标签数组 / 分隔串归一去重 | keywords: 标签归一化, normalize-tags
- `parseOptionalNumber(value)` — 可选数字入参解析 | keywords: 数字入参解析, parse-optional-number
- `resolveAuthScope(req)` — Bearer token → `{tenantId, userId}` | keywords: 鉴权解析, 租户范围, resolve-auth-scope, tenant-scope
- `listGroups(req, limit?)` — `GET groups` 列出分组并附视频数 | keywords: 分组列表端点, list-video-groups-endpoint
- `createGroup(body, req)` — `POST groups` 新建分组 | keywords: 新建分组端点, create-video-group-endpoint
- `updateGroup(id, body, req)` — `POST groups/:id` 更新分组 | keywords: 更新分组端点, update-video-group-endpoint
- `deleteGroup(id, req)` — `POST groups/:id/delete` 删除分组，组内视频转未分组 | keywords: 删除分组端点, delete-video-group-endpoint
- `listTags(req, limit?)` — `GET tags` 列出已用标签 | keywords: 标签列表端点, list-video-tags-endpoint
- `listVideos(req, groupId?, tag?, cursorId?, limit?)` — `GET videos` 游标分页列表 | keywords: 视频列表端点, 游标分页, list-videos-endpoint, cursor-pagination
- `registerVideo(body, req)` — `POST videos` 直传后登记记录 | keywords: 登记视频端点, 直传回执, register-video-endpoint, upload-receipt
- `updateVideo(id, body, req)` — `POST videos/:id` 改名称 / 标签 / 分组 | keywords: 更新视频端点, update-video-endpoint
- `deleteVideo(id, req)` — `POST videos/:id/delete` 删记录并清 OSS | keywords: 删除视频端点, delete-video-endpoint
- `deleteVideosBatch(body, req)` — `POST videos/batch-delete` 批量删除 | keywords: 批量删除端点, batch-delete-videos-endpoint
- `createUploadTicket(body, req)` — `POST oss/signature` 签发直传票据 | keywords: 直传票据端点, OSS签名, upload-ticket-endpoint, oss-signature

### services/video-library.service.ts

- `ensureIndexes()` — 建索引与自增计数器 | keywords: 视频索引, ensure-video-indexes
- `nextId()` — 取视频自增 ID | keywords: 视频自增ID, next-video-id
- `buildTenantFilter(tenantId?)` — 租户可见性过滤，与图库同口径 | keywords: 租户过滤, build-tenant-filter
- `register(input)` — 登记记录，`url` 按对象键重算不采信前端 | keywords: 登记视频, 直传回执, register-video, upload-receipt
- `toNullableNumber(value)` — 数值字段收敛为 number 或 null | keywords: 数值归一, nullable-number
- `list(options?)` — 游标分页查询，`cursorId` 与 `/gallery` 同语义 | keywords: 视频列表, 游标分页, list-videos, cursor-pagination
- `listTags(options?)` — 租户内标签 distinct | keywords: 视频标签, list-video-tags
- `update(id, input, tenantId?)` — 改名称 / 标签 / 分组 | keywords: 更新视频, update-video
- `remove(input)` — 先删库记录再清 OSS，返回未清理的 `orphanKeys` | keywords: 删除视频, 清理OSS, 残留对象, delete-videos, cleanup-oss, orphan-objects

### services/video-group.service.ts

- `ensureIndexes()` — 建分组索引与自增计数器 | keywords: 分组索引, ensure-video-group-indexes
- `nextId()` — 取分组自增 ID | keywords: 分组自增ID, next-video-group-id
- `buildTenantFilter(tenantId?)` — 租户可见性过滤 | keywords: 租户过滤, build-tenant-filter
- `list(options?)` — 列分组并用一次聚合补上 `video_count` | keywords: 分组列表, 分组计数, list-video-groups, group-video-count
- `findById(id, tenantId?)` — 按业务 ID 读分组 | keywords: 读取分组, find-video-group
- `create(input)` — 新建分组 | keywords: 新建分组, create-video-group
- `update(id, input, tenantId?)` — 更新分组 | keywords: 更新分组, update-video-group
- `remove(id, tenantId?)` — 删分组，组内视频转未分组 | keywords: 删除分组, 视频转未分组, delete-video-group, detach-videos

### services/oss-storage.service.ts

- `readConfig()` — 读 OSS 环境变量 | keywords: OSS配置, oss-config
- `isConfigured()` — 判断配置是否齐全 | keywords: OSS已配置, oss-configured
- `requireConfig()` — 配置缺失直接 503，不降级本地磁盘 | keywords: OSS配置校验, require-oss-config
- `maxBytesOf(scene)` — 按场景取单文件上限 | keywords: 上传大小上限, max-upload-bytes
- `buildObjectKey(input)` — 生成对象键，文件名只留扩展名防穿越 | keywords: 对象键生成, 路径穿越防护, build-object-key, path-traversal-guard
- `publicUrl(key)` — 拼可访问地址，优先 CDN 域名 | keywords: 可访问地址, CDN域名, public-url, cdn-domain
- `createUploadTicket(input)` — 签发 PostObject 票据 | keywords: 直传票据, 直传签名, upload-ticket, post-policy-signature
- `readExpireSeconds()` — 读票据有效期 | keywords: 票据有效期, ticket-expire-seconds
- `normalizeContentType(value?)` — 归一化 Content-Type，非法值不进策略 | keywords: 内容类型归一化, normalize-content-type
- `deleteObjects(keys)` — 批量删对象，返回失败的键 | keywords: 删除对象, 清理OSS, delete-objects, cleanup-oss
- `deleteObject(key)` — V1 头签名的单对象 DELETE | keywords: 删除对象, 请求签名, delete-object, request-signature

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 视频库 | video-library |
| 视频记录 | video-record |
| 视频分组 | video-group |
| 直传票据 | upload-ticket |
| OSS签名 | oss-signature |
| 对象键生成 | build-object-key |
| 清理OSS | cleanup-oss |
| 残留对象 | orphan-objects |
| 游标分页 | cursor-pagination |
| 租户隔离 | tenant-isolation |
| 分组计数 | group-video-count |
| 路径穿越防护 | path-traversal-guard |

## 类型导出 (Type Exports)

- `VideoEntity` / `VideoCreateInput` / `VideoUpdateInput`（`entities/video.entity.ts`）。
- `VideoGroupEntity` / `VideoGroupCreateInput` / `VideoGroupUpdateInput` / `VideoGroupView`（`entities/video-group.entity.ts`）。
- `OssUploadScene` / `OssUploadTicket`（`services/oss-storage.service.ts`）——票据结构是与桌面端的接口契约，改字段要同步改 `xhs-manger` 的 `ossDirectUpload.js`。

## 模块功能描述 (Module Feature Description)

**接口一览**（全部走 Bearer token，路由前缀 `api/video-library`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `groups` | 分组列表，带 `video_count` |
| POST | `groups` | 新建分组 |
| POST | `groups/:id` | 更新分组 |
| POST | `groups/:id/delete` | 删除分组，组内视频转未分组 |
| GET | `tags` | 已用标签 |
| GET | `videos` | 游标分页列表（`groupId` / `tag` / `cursorId` / `limit`） |
| POST | `videos` | 直传后登记记录 |
| POST | `videos/:id` | 改名称 / 标签 / 分组 |
| POST | `videos/:id/delete` | 删记录 + 清 OSS |
| POST | `videos/batch-delete` | 批量删除 |
| POST | `oss/signature` | 签发直传票据 |

**鉴权说明**：全部入口走模块自有的 `resolveAuthScope(req)`（Bearer token → `AdminService.getUserByToken` → `{tenantId, userId}`，失败抛 `UnauthorizedException`），**不挂 CASL `@RequirePermission`**。这与 `gallery` 的结论一致：`@RequirePermission` 绑定 `AdminAuthGuard`，而权限注册中心里没有 VideoLibrary 主体，挂上会把桌面端这类租户侧调用方整个挡死。租户隔离靠 token 里的 `tenantId` 一路带进 Mongo 过滤条件——无 tenantId 视为母平台，只看得到没有 tenantId 的数据。

**登记时只认 `key`**：可播放地址由服务端按对象键重算，不采信前端传来的 `url` / `coverUrl`，否则任何人都能往库里写一条指向站外的"视频"。同理，展示名存数据库，对象键里只保留扩展名、主体换成 UUID——用户的原始文件名带中文、空格和 `..` 的都有，拼进对象键会同时踩上编码和路径穿越两个坑。

**删除顺序是先库后 OSS**，不能反过来：先清对象、后删库一旦中途失败，列表里会留下一条点开就是 404 的记录；先删库最坏只是多一个没人引用的对象，可以靠对账回收。清理失败的键回在 `orphanKeys` 里，不影响接口成功——记录已经没了，为残留对象判失败只会让用户以为视频还在。

**不引 ali-oss SDK**：这里只需要签一张 PostObject 策略（`base64(policyJSON)` + `HMAC-SHA1`）和发一个带签名头的 DELETE，加起来不到 60 行 `node:crypto`。要上分片续传时再换 SDK 也不迟，届时改的只有 `oss-storage.service.ts`。策略里逐条锁死 `key`、`content-length-range`、`success_action_status` 与 `Content-Type`：OSS 会拒收策略没覆盖的表单字段，而覆盖得越死，票据被拿去传别的东西的空间越小。

**部署前提**：桌面端页面的 origin 是 `app://workbench`（自定义协议注册时开了 `corsEnabled`）。OSS 存储桶的跨域规则必须放行这个来源、允许 `POST` 与 `PUT` 并暴露 `ETag`，否则直传请求会在响应阶段被浏览器拦掉，表现为"没有任何报错的失败"。`OSS_*` 环境变量缺任意一项，`oss/signature` 返回 503 `OSS_NOT_CONFIGURED`——**故意不降级到本地磁盘**：静默落盘会让"视频已入库"在没有对象存储的环境里也成立，等真正配好 OSS 时数据已经散在两处，对不上账。
