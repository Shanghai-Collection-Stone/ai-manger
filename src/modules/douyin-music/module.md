# 模块名称 (Module Name)

抖音背景音乐（douyin-music）

## 概述 (Overview)

提供短视频成片的背景音乐来源：后台维护的已授权曲库（租户共享，母平台可公开给所有租户）和工作台成员上传的音乐（租户内共享，上传者和管理员可删）。
脚本在 [douyin-workbench 模块](../douyin-workbench/module.md) 上保存选中的曲目与音量，合成时由服务端解析出真实地址交给桌面端混音，不信任前端传来的音乐地址。

## 文件清单 (File List)

- `douyin-music.module.ts` — NestJS 模块入口，导出仓储给工作台合成链路。
- `controller/douyin-music.controller.ts` — 曲库管理与个人上传的鉴权 REST 接口。
- `controller/douyin-music.dto.ts` — 新增与更新曲库曲目的输入校验。
- `entities/douyin-music.entity.ts` — 分类登记表、上传限制、默认音量、音乐实体与视图。
- `services/douyin-music-repository.service.ts` — MongoDB 音乐持久化、租户数据边界与上传删除权限。
- `services/douyin-music-repository.service.spec.ts` — 上传租户内共享、跨租户隔离、每人配额与删除权限回归。
- `services/douyin-music-rules.ts` — 分类与音乐设置规整、文件头识别、上传文件名还原。
- `services/douyin-music-rules.spec.ts` — 格式识别、设置规整与中文文件名回归。
- `services/douyin-music.service.ts` — 上传校验、对象存储写入与回收、删除清理。
- `seed/freepd-tracks.json` — 预置曲目清单：15 首 FreePD CC0 曲目的曲名、分类、时长与官方原文件摘要。
- `seed/seed-douyin-music.mjs` — 预置曲库导入命令：校验文件哈希后经曲库接口上传为平台公开曲目，可重复执行。

## 函数清单 (Function List)

- `DOUYIN_MUSIC_CATEGORIES` — 曲库分类登记表，前后端取值唯一来源 | keywords: 曲库分类, 音乐风格, music-categories, music-style
- `DouyinMusicCategory` — 曲库分类键名 | keywords: 曲库分类键, 分类枚举, music-category-key, category-enum
- `DouyinMusicSource` — 音乐来源：曲库或用户上传 | keywords: 音乐来源, 曲库或上传, music-source, library-or-upload
- `DOUYIN_MUSIC_MAX_BYTES` — 单个音乐文件上限 30MB | keywords: 音乐大小上限, 上传限制, music-max-bytes, upload-limit
- `DOUYIN_MUSIC_USER_UPLOAD_LIMIT` — 每人最多保留 50 首自传音乐 | keywords: 自传音乐上限, 存储保护, user-upload-limit, storage-guard
- `DOUYIN_MUSIC_DEFAULT_VOLUME` — 背景音乐默认音量 | keywords: 默认音乐音量, 背景音量, default-music-volume, bed-volume
- `DouyinBackgroundMusicSetting` — 脚本的曲目、音量与改动时间，`trackId=0` 表示不用音乐 | keywords: 脚本背景音乐, 音乐设置, background-music-setting, topic-music
- `DouyinMusicEntity` — 音乐持久化实体 | keywords: 音乐实体, 曲库曲目, douyin-music-entity, library-track
- `DouyinMusicView` — 去掉数据库 ID、对象键与上传者 ID 的前端视图，带 `mine` 与 `canDelete` | keywords: 音乐视图, 试听地址, douyin-music-view, preview-url
- `normalizeMusicCategory(input?)` — 未登记分类回退为其他 | keywords: 规整音乐分类, 默认分类, normalize-music-category, default-category
- `normalizeBackgroundMusic(input,current?,now?)` — 规整曲目与音量，没变化时沿用改动时间 | keywords: 规整背景音乐, 音乐改动时间, normalize-background-music, music-change-time
- `sniffMusicFormat(buffer)` — 按文件头识别 MP3、WAV、M4A | keywords: 识别音频格式, 文件头校验, sniff-music-format, magic-bytes
- `ascii(start,end)` — 按单字节读取文件头片段 | keywords: 读取文件头, 单字节文本, read-file-header, latin1-slice
- `musicNameFromFile(originalName)` — 还原 multer 解错的中文文件名并生成展示名 | keywords: 音乐展示名, 中文文件名还原, music-display-name, decode-upload-name
- `header(head)` — 测试用音频文件头 | keywords: 构造音频文件头, 测试素材, build-audio-header, test-fixture
- `DouyinMusicScope` — 仓储使用的租户用户作用域，`canManageUploads` 表示管理员 | keywords: 音乐作用域, 租户用户, music-scope, tenant-user
- `DouyinMusicRepositoryService()` — 持久化曲库与租户共享的上传音乐并强制数据边界 | keywords: 音乐仓储, 租户边界, douyin-music-repository, tenant-boundary
- `DouyinMusicRepositoryService.constructor(db,oss)` — 初始化集合、计数器与索引 | keywords: 初始化音乐仓储, 音乐集合, init-music-repository, music-collection
- `ensureIndexes()` — 创建业务 ID、租户曲库、公开曲目与个人上传索引 | keywords: 音乐索引, 曲库查询, music-indexes, library-query
- `list(scope,options?)` — 列出本租户曲库、平台公开曲库与租户成员上传 | keywords: 查询音乐列表, 可用音乐, list-douyin-music, usable-tracks
- `getUsable(id,scope)` — 读取当前用户能用的一首音乐 | keywords: 读取可用音乐, 选用校验, get-usable-music, selection-check
- `urlOf(row)` — 拼音乐下载地址 | keywords: 音乐地址, 对象存储地址, music-url, oss-public-url
- `countUploads(scope)` — 统计本人上传数量 | keywords: 统计自传音乐, 上传配额, count-user-uploads, upload-quota
- `create(input,scope)` — 写入一条音乐记录 | keywords: 新建音乐记录, 音乐入库, create-music-record, persist-track
- `updateLibrary(id,input,scope)` — 更新本租户曲库曲目 | keywords: 更新曲库曲目, 归档曲目, update-library-track, archive-track
- `removeLibrary(id,scope)` — 删除本租户曲库曲目并返回原记录 | keywords: 删除曲库曲目, 清理记录, remove-library-track, cleanup-record
- `removeUpload(id,scope)` — 成员删自己传的、管理员删本租户任意上传，返回原记录 | keywords: 删除自传音乐, 上传者校验, remove-user-upload, uploader-check
- `removeOne(filter)` — 按条件读出并删除一条记录 | keywords: 读取并删除, 单条删除, find-and-remove, remove-one
- `nextId()` — 生成音乐业务自增 ID | keywords: 音乐自增ID, 计数器, next-music-id, counter
- `tenantFilter(tenantId?)` — 构造租户或母平台过滤 | keywords: 音乐租户过滤, 母平台边界, music-tenant-filter, platform-boundary
- `publicFilter()` — 构造平台公开曲库过滤 | keywords: 平台公开曲库, 公开过滤, public-library-filter, platform-public
- `uploadFilter(scope)` — 构造本租户成员上传过滤，查询与选用共用 | keywords: 租户上传过滤, 租户共享上传, tenant-upload-filter, tenant-shared-upload
- `ownUploadFilter(scope)` — 构造本人上传过滤，用于配额与成员删除 | keywords: 本人上传过滤, 上传者边界, own-upload-filter, uploader-boundary
- `matches(row,filter)` — 测试用内存查询匹配 | keywords: 匹配音乐查询, 内存集合, match-music-query, in-memory-collection
- `track(patch)` — 测试用音乐记录 | keywords: 构造音乐记录, 测试素材, build-music-row, test-fixture
- `build()` — 测试用内存仓储 | keywords: 构造音乐仓储, 内存集合, build-music-repository, in-memory-collection
- `libraryFilter(id,scope)` — 构造本租户曲目过滤 | keywords: 本租户曲目过滤, 曲库归属, own-library-filter, library-ownership
- `assertPublicToggle(scope,isPublic?)` — 公开开关只允许母平台设置 | keywords: 音乐公开校验, 公开仅限平台, music-public-guard, public-platform-only
- `toView(row,tenantId?)` — 生成前端视图并隐藏对象键 | keywords: 音乐视图转换, 隐藏对象键, to-music-view, hide-object-key
- `DouyinMusicFile` — multer 内存文件结构 | keywords: 音乐上传文件, 内存文件, music-upload-file, memory-file
- `DouyinMusicService()` — 音乐上传与删除 | keywords: 音乐服务, 音乐上传, douyin-music-service, music-upload
- `DouyinMusicService.constructor(repository,oss)` — 注入仓储与对象存储 | keywords: 初始化音乐服务, 依赖注入, init-music-service, dependency-injection
- `addLibraryTrack(file,input,scope)` — 新增曲库曲目，必须写授权来源 | keywords: 新增曲库曲目, 授权来源, add-library-track, license-source
- `addUpload(file,scope)` — 上传个人音乐并校验数量上限 | keywords: 上传个人音乐, 上传配额, add-user-upload, upload-quota
- `removeLibraryTrack(id,scope)` — 删除曲库曲目并清理文件 | keywords: 删除曲库音乐, 清理文件, delete-library-track, cleanup-object
- `DouyinMusicService.removeUpload(id,scope)` — 按删除权限移除上传音乐并清理文件 | keywords: 删除个人音乐, 清理文件, delete-user-upload, cleanup-object
- `checkFile(file)` — 校验文件存在、大小与真实格式 | keywords: 校验音乐文件, 格式大小校验, check-music-file, format-size-check
- `storeAndRecord(checked,fields,scope)` — 写对象存储并入库，失败回收对象 | keywords: 保存音乐文件, 失败回收, store-music-file, rollback-object
- `finishRemoval(row)` — 记录删除后清理对象，残留只记日志 | keywords: 完成音乐删除, 残留对象日志, finish-music-removal, orphan-object-log
- `CATEGORY_KEYS` — DTO 允许的分类键名 | keywords: 分类校验键, 曲库分类, category-keys, music-category
- `toFormBoolean({value})` — multipart 布尔字符串转布尔 | keywords: 表单布尔转换, 公开开关, form-boolean-transform, public-toggle
- `CreateDouyinMusicDto()` — 校验新增曲目，授权来源必填 | keywords: 新增曲目参数, 授权来源必填, create-music-dto, license-required
- `UpdateDouyinMusicDto()` — 校验更新曲目 | keywords: 更新曲目参数, 归档曲目, update-music-dto, archive-track
- `DouyinMusicController()` — 背景音乐鉴权接口 | keywords: 背景音乐接口, 曲库管理接口, douyin-music-controller, music-library-api
- `DouyinMusicController.constructor(repository,music)` — 注入仓储与服务 | keywords: 初始化音乐接口, 依赖注入, init-music-controller, dependency-injection
- `DouyinMusicController.list(req,includeArchived?,source?)` — `GET /api/douyin-music` | keywords: 查询音乐接口, 可用音乐, list-music-api, usable-tracks
- `options()` — `GET /api/douyin-music/options` | keywords: 音乐选项接口, 分类登记表, music-options-api, category-registry
- `DouyinMusicController.create(req,file,body)` — `POST /api/douyin-music`，权限 `create DouyinMusic` | keywords: 新增曲目接口, 上传曲库音乐, create-library-track-api, upload-library-music
- `upload(req,file)` — `POST /api/douyin-music/uploads`，权限 `create DouyinWorkbench` | keywords: 上传个人音乐接口, 自传音乐, upload-user-music-api, personal-music
- `DouyinMusicController.removeUpload(req,id)` — `DELETE /api/douyin-music/uploads/:id`，权限 `delete DouyinWorkbench` | keywords: 删除个人音乐接口, 移除自传音乐, delete-user-music-api, remove-personal-music
- `update(req,id,body)` — `PATCH /api/douyin-music/:id`，权限 `update DouyinMusic` | keywords: 更新曲目接口, 归档曲目, update-library-track-api, archive-track
- `remove(req,id)` — `DELETE /api/douyin-music/:id`，权限 `delete DouyinMusic` | keywords: 删除曲目接口, 移除曲库音乐, delete-library-track-api, remove-library-music
- `readId(value)` — 解析路由音乐 ID | keywords: 解析音乐ID, 路由校验, parse-music-id, route-validation
- `requireUser(req)` — 读取登录用户 | keywords: 读取音乐接口用户, 拒绝匿名, require-music-user, reject-anonymous
- `scopeOf(user)` — 构造租户用户作用域，超管与租户管理员可管理成员上传 | keywords: 构造音乐作用域, 租户边界, build-music-scope, tenant-boundary
- `DouyinMusicModule()` — 装配背景音乐能力并导出仓储 | keywords: 背景音乐模块, 曲库能力装配, douyin-music-module, music-library-wiring
- `SEED_DIR` — 预置曲目清单所在目录 | keywords: 预置曲目目录, 清单位置, seed-directory, manifest-location
- `DEFAULT_AUDIO_DIR` — 本地预置音频目录，文件哈希一致时直接上传 | keywords: 本地预置音频, 免重复下载, local-seed-audio, skip-redownload
- `SOURCE_BASES` — 曲目下载来源：公开镜像与官方存档 | keywords: 曲目下载来源, 官方存档回退, seed-download-sources, official-archive-fallback
- `DOWNLOAD_TIMEOUT_MS` — 单次下载超时 | keywords: 曲目下载超时, 网络保护, seed-download-timeout, network-guard
- `toBase32(bytes)` — 按互联网档案馆摘要格式编码 | keywords: Base32编码, 文件摘要格式, base32-encode, digest-format
- `isVerifiedAudio(bytes,track)` — 判断文件是否为校验过的官方原文件 | keywords: 校验曲目哈希, 官方原文件, verify-track-hash, official-original
- `licenseNoteOf(track)` — 生成写入曲库的授权来源 | keywords: 预置授权说明, 曲目授权来源, seed-license-note, track-license-source
- `loadVerifiedAudio(track,options)` — 取得校验通过的曲目，绝不上传未校验文件 | keywords: 获取校验曲目, 拒绝未校验文件, load-verified-audio, reject-unverified-file
- `callMusicApi(path,init,options)` — 调用曲库接口并翻译鉴权失败，令牌只发给曲库接口 | keywords: 调用曲库接口, 鉴权失败说明, call-music-api, auth-failure-message
- `uploadSeedTrack(track,bytes,options)` — 上传为平台公开曲目 | keywords: 上传预置曲目, 平台公开曲目, upload-seed-track, platform-public-track
- `seedMusicLibrary(input)` — 导入预置曲库，同名跳过，可只校验不写入 | keywords: 导入预置曲库, 重复执行跳过, seed-music-library, idempotent-import
- `main()` — 导入命令入口，读取令牌、后端地址与参数 | keywords: 曲库导入命令, 超管令牌, seed-music-cli, super-admin-token

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 背景音乐模块 | douyin-music-module |
| 曲库分类 | music-categories |
| 曲库曲目 | library-track |
| 音乐来源 | music-source |
| 脚本背景音乐 | background-music-setting |
| 规整背景音乐 | normalize-background-music |
| 音乐改动时间 | music-change-time |
| 识别音频格式 | sniff-music-format |
| 中文文件名还原 | decode-upload-name |
| 可用音乐 | usable-tracks |
| 授权来源 | license-source |
| 上传配额 | upload-quota |
| 失败回收 | rollback-object |
| 平台公开曲库 | public-library-filter |
| 本人上传过滤 | own-upload-filter |
| 租户上传过滤 | tenant-upload-filter |
| 租户共享上传 | tenant-shared-upload |
| 背景音乐接口 | douyin-music-controller |
| 导入预置曲库 | seed-music-library |
| 校验曲目哈希 | verify-track-hash |
| 拒绝未校验文件 | reject-unverified-file |
| 预置授权说明 | seed-license-note |

## 类型导出 (Type Exports)

- `DouyinMusicCategory` — 曲库分类键名。
- `DouyinMusicSource` — 音乐来源。
- `DouyinBackgroundMusicSetting` — 脚本的背景音乐设置。
- `DouyinMusicEntity` — 音乐持久化实体。
- `DouyinMusicView` — 前端音乐视图。
- `DouyinMusicScope` — 租户用户作用域。
- `DouyinMusicFile` — 上传文件结构。

## 模块功能描述 (Module Feature Description)

**曲库**：管理员在后台「背景音乐曲库」上传曲目并写明授权来源，曲目在租户内共享；母平台可公开给所有租户，租户对平台曲目只读。归档后工作台不再列出，已选用它的脚本继续可用。

**团队上传**：工作台成员可上传 MP3、WAV、M4A（单个 30MB 内，每人最多 50 首），格式按文件头判断。上传后租户内成员都能看到、试听和选用，其他租户不可见。只有上传者本人和管理员能删除；删除后，已选用它的脚本下次拼接时没有配乐并提示重选。

**权限**：曲库增删改用 `DouyinMusic`（租户管理员 `manage`，操作员 `read`）；团队上传和删除走 `DouyinWorkbench`，这样操作员能上传音乐，但改不了曲库。

**合成**：脚本只存曲目 ID 与音量，合成时 `getUsable` 按当前用户重新校验并取真实地址。曲目已被删除或取消公开时不拦合成，避免托管流程卡住，成片没有配乐并提示用户重新选择。

**预置曲库**：`npm run seed:douyin-music` 把 15 首 FreePD CC0 曲目导入为平台公开曲目，需要 `DOUYIN_MUSIC_TOKEN`（超管令牌），`DOUYIN_MUSIC_API` 指定后端，`--dry-run` 只校验。命令优先读取本地 `seed/audio/`（已被 `seed/.gitignore` 排除，不进 Git），缺文件时再下载。FreePD 官网已关停，下载来源是公开镜像或互联网档案馆，上传前都必须与清单里的官方原文件摘要一致。分类来自 FreePD 原分类，暂无可确认的国风曲目。
