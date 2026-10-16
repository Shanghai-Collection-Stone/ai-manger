# 模块名称 (Module Name)

图库 ZIP 导入（zip-import）

## 概述 (Overview)

图库 ZIP 批量导入模块:接收单个 zip 包 → 写入 `gallery_zip_imports` 集合(pending 任务) → 立即返回 jobId → 进程内串行后台流水线(打开 zip → 读取可选客户端预处理清单 → 流式逐张解压到 `public/uploads/` → 旧 ZIP 或处理失败图片走服务端保质量压缩 → 调 `GalleryService.createMany` 分批入库 + 生成缩略图 + 写 embedding)→ 全程更新 `status / stage / progress`,前端 2s 轮询展示。

## 文件清单 (File List)

- `controller/gallery-zip-import.controller.ts`
- `entities/gallery-zip-import.entity.ts`
- `gallery-zip-import.module.ts`
- `services/gallery-zip-import.service.spec.ts`
- `services/gallery-zip-import.service.ts`

## 函数清单 (Function List)

- `matches(doc,filter)` — 匹配恢复扫描的过滤条件 | keywords: 恢复条件测试, 过滤匹配, recovery-filter-test, filter-matching
- `createFakeDb(docs)` — 建立内存数据库替身 | keywords: 恢复数据库替身, 内存测试, recovery-db-stub, in-memory-test
- `minutesAgo(minutes)` — 构造过期心跳时间 | keywords: 心跳测试时间, 过期时间, heartbeat-test-time, stale-time
- `tempZip(name)` — 创建恢复任务测试文件 | keywords: 临时ZIP测试, 恢复文件, temporary-zip-test, recovery-file

- `onModuleInit()` — 启动任务心跳与中断任务扫描 | keywords: ZIP任务恢复, 心跳续期, zip-job-recovery, heartbeat-renewal
- `onModuleDestroy()` — 停止心跳与扫描定时器 | keywords: 停止定时器, ZIP任务恢复, stop-timers, zip-job-recovery
- `renewHeartbeats()` — 为本进程拥有的未完成任务续期 | keywords: 心跳续期, 任务归属, heartbeat-renewal, job-ownership
- `buildOrphanFilter(now)` — 按心跳或旧任务更新时间筛选中断任务 | keywords: 中断任务判定, 心跳过期, orphaned-job-filter, stale-heartbeat
- `recoverOrphanedJobs()` — 接手排队任务并为中断或取消任务收尾 | keywords: ZIP任务恢复, 中断任务接手, zip-job-recovery, take-over-pending-job, fail-interrupted-job
- `scheduleJob(id)` — 登记本进程任务并排入串行处理链 | keywords: 登记本进程任务, 串行处理, register-owned-job, sequential-processing
- `readClientPreprocessManifest(zip)` — 校验前端尺寸清单并索引可跳过重复处理的图片 | keywords: 客户端预处理清单, 跳过重复压缩, client-preprocess-manifest, skip-duplicate-compression
- `GalleryZipImportController.upload(file, body, req)` — `POST /upload` 接收单个 ZIP，修正 multipart 中文原文件名后入队并立即返回任务；归属用户只取 token，不读请求体 userId | keywords: ZIP上传, 文件名修复, zip-upload, filename-repair

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| ZIP任务恢复 | zip-job-recovery |
| 心跳续期 | heartbeat-renewal |
| 停止定时器 | stop-timers |
| 任务归属 | job-ownership |
| 中断任务判定 | orphaned-job-filter |
| 心跳过期 | stale-heartbeat |
| 中断任务接手 | take-over-pending-job |
| 中断任务判失败 | fail-interrupted-job |
| 登记本进程任务 | register-owned-job |
| 串行处理 | sequential-processing |
| 客户端预处理清单 | client-preprocess-manifest |
| 跳过重复压缩 | skip-duplicate-compression |
| ZIP上传 | zip-upload |
| 文件名修复 | filename-repair |

## 类型导出 (Type Exports)

`GalleryZipImportEntity`、`GalleryZipImportCreateInput`、`GalleryZipImportStatus`、`GalleryZipImportProgress`、`GalleryZipImportErrorItem`；实体兼容可选 `ownerId` 与 `heartbeatAt`。

## 模块功能描述 (Module Feature Description)

**模块描述**
图库 ZIP 批量导入模块:接收单个 zip 包 → 写入 `gallery_zip_imports` 集合(pending 任务) → 立即返回 jobId → 进程内串行后台流水线(打开 zip → 读取可选客户端预处理清单 → 流式逐张解压到 `public/uploads/` → 旧 ZIP 或处理失败图片走服务端保质量压缩 → 调 `GalleryService.createMany` 分批入库 + 生成缩略图 + 写 embedding)→ 全程更新 `status / stage / progress`,前端 2s 轮询展示。

特点:
- **单进程串行**:同时只跑一个 zip,避免大包互相挤垮内存
- **流式解压**:基于 `node-stream-zip`,单 entry 落盘后再处理下一个,内存占用 O(1)
- **分批入库**:每 20 张一批走 `GalleryService.createMany`(含 embedding 批量调用)
- **可取消**:`POST :id/cancel` 写 `cancelRequested=true`,运行循环下一次轮询时中断并保留已入库数据
- **可指定库 + 全局 tag**:`groupId` 落到每张图的 `groupId` 字段,`tags` 落到 `tags` 字段
- **挂载点**:`/gallery/zip-import/*`,复用 `AdminAuthGuard`(Bearer token + tenant scope)
- **zip 上限**:1GB,zip 临时文件存 `public/uploads_zips/`,处理完(成功/失败/取消)自动 unlink
- **客户端预处理兼容**:识别根目录 `_gallery_manifest.json`;清单有效的图片复用前端宽高并跳过服务端重复压缩/尺寸读取，无清单或单图处理失败时自动回退原流水线
- **重启恢复**：任务带 `ownerId` 与 `heartbeatAt`，负责进程每 30 秒续期。启动 5 秒后及每分钟扫描一次，心跳超过 2 分钟的任务才接手；旧任务没有心跳则以 `updatedAt` 超过 10 分钟判定。排队任务原子接手继续执行，中断的解压/入库任务置失败并保留已入库图片，取消请求按取消收尾，同时清理临时 ZIP。活跃进程的任务不受影响。

文件路径: `src/modules/gallery/zip-import`

**功能描述及关键词**

**entities/gallery-zip-import.entity.ts**
任务实体定义。
- **关键词**: gallery zip import entity, status machine, progress, errors
- **类型**:
  - `GalleryZipImportStatus`: `'pending' | 'extracting' | 'importing' | 'done' | 'failed' | 'cancelled'`
  - `GalleryZipImportProgress`: `{ total, processed, success, failed }`
  - `GalleryZipImportErrorItem`: `{ fileName, reason }`
  - `GalleryZipImportEntity`: 主实体(含 `id` UUID 字符串、`stage`、`imageIds`、`cancelRequested` 等)
  - `GalleryZipImportCreateInput`: enqueue 入参

**services/gallery-zip-import.service.ts**
后台任务调度 + 执行器。
- **关键词**: zip import service, queue, stream extract, batch import, cancellable
- **常量**: `IMAGE_EXT_SET`(jpg/jpeg/png/webp/gif/bmp)、`MAX_IMPORT_PER_BATCH=20`
- **函数**:
  - `onModuleInit()` — 启动任务心跳与中断任务扫描 | keywords: ZIP任务恢复, 心跳续期, zip-job-recovery, heartbeat-renewal
  - `onModuleDestroy()` — 停止心跳与扫描定时器 | keywords: 停止定时器, ZIP任务恢复, stop-timers, zip-job-recovery
  - `renewHeartbeats()` — 为本进程拥有的未完成任务续期 | keywords: 心跳续期, 任务归属, heartbeat-renewal, job-ownership
  - `buildOrphanFilter(now)` — 按心跳或旧任务更新时间筛选中断任务 | keywords: 中断任务判定, 心跳过期, orphaned-job-filter, stale-heartbeat
  - `recoverOrphanedJobs()` — 接手排队任务并为中断或取消任务收尾 | keywords: ZIP任务恢复, 中断任务接手, zip-job-recovery, take-over-pending-job, fail-interrupted-job
  - `scheduleJob(id)` — 登记本进程任务并排入串行处理链 | keywords: 登记本进程任务, 串行处理, register-owned-job, sequential-processing
  - `ensureIndexes`: 建索引(id 唯一、userId+createdAt、tenantId+createdAt、status+createdAt) /ensure mongo indexes
  - `enqueue`: 写 pending 记录 + `setImmediate` 触发后台处理 /enqueue zip import job
  - `getById`: 单条查询(轮询入口)/get job by id
  - `listRecent`: 按 tenant scope 列出最近 N 条 /list recent jobs
  - `cancel`: 写 `cancelRequested=true`,pending 态直接置 cancelled /cancel job
  - `remove`: 删除一条任务记录(仅限完成/失败/取消态)/delete job record
  - `processJob`: 进程内串行入口(等待当前任务结束后才跑下一个)/sequential processing entry
  - `runJob`: 主流水线 — 打开 zip → 读取客户端清单 → 枚举图片 entry → 逐张解压 → 按清单跳过或回退服务端压缩/读尺寸 → 生成缩略图 → 每 20 张 flush 到 `GalleryService.createMany` /run zip import pipeline
  - `shouldCancel`: 实时从 db 取 `cancelRequested` 标志 /check cancel flag
  - `finalizeFailed` / `finalizeCancelled`: 写终态 + 清理 zip 临时文件 /finalize failed or cancelled
  - `isImageEntry`: 按扩展名筛选 zip 内的图片条目(忽略 `__MACOSX/` 和 `._` 元数据)/filter image entry
  - `extractEntry`: 单个 entry 流式解压到目标路径 /stream extract single entry
  - `closeZip` / `safeUnlink` / `statSize`: 资源/IO 工具 /resource and io helpers
  - `readImageDimensions`: jimp 读尺寸 /read image dimensions via jimp
  - `readClientPreprocessManifest(zip)` — 校验前端尺寸清单并索引可跳过重复处理的图片 | keywords: 客户端预处理清单, 跳过重复压缩, client-preprocess-manifest, skip-duplicate-compression
  - `mimeTypeFromExt`: 扩展名 → mime /mime from ext
  - `loadStreamZip`: 懒加载 `node-stream-zip` 构造函数 /lazy load streamzip ctor

**controller/gallery-zip-import.controller.ts**
HTTP 控制器(挂载 `/gallery/zip-import`)。
- **关键词**: zip import controller, multipart, list, cancel, bearer auth
- **常量**: `MAX_ZIP_BYTES = 1GB`
- **函数**:
  - `resolveAuthScope`: Bearer token → `{ tenantId, userId }` /resolve bearer token
  - `GalleryZipImportController.upload(file, body, req)` — `POST /upload` 接收单个 ZIP，修正 multipart 中文原文件名后入队并立即返回任务；归属用户只取 token，不读请求体 userId | keywords: ZIP上传, 文件名修复, zip-upload, filename-repair
  - `list`: `GET /list?limit=` 列出 token 用户最近任务(不读查询参数 userId) /list recent jobs
  - `getById`: `GET /:id` 单条详情(前端轮询)/get job by id
  - `cancel`: `POST /:id/cancel` 请求取消 /cancel job
  - `remove`: `POST /:id/delete` 删除任务记录 /delete job record

**gallery-zip-import.module.ts**
模块定义。
- **关键词**: zip import module, providers, controllers
- imports: `DataSourceModule`(DS_MONGO_DB)、`AdminModule`、`GalleryModule`(注入 `GalleryService`)
- providers: `GalleryZipImportService`(同名 export)

恢复测试文件 `services/gallery-zip-import.service.spec.ts` 覆盖中断任务失败、已入库图片保留、排队接手、缺失 ZIP、取消收尾、活跃任务排除及旧任务兼容。任务实体新增 `ownerId?: string` 与 `heartbeatAt?: Date`。

| 中文 | English |
|---|---|
| ZIP任务恢复 | zip-job-recovery |
| 心跳续期 | heartbeat-renewal |
| 停止定时器 | stop-timers |
| 任务归属 | job-ownership |
| 中断任务判定 | orphaned-job-filter |
| 心跳过期 | stale-heartbeat |
| 中断任务接手 | take-over-pending-job |
| 中断任务判失败 | fail-interrupted-job |
| 登记本进程任务 | register-owned-job |
| 串行处理 | sequential-processing |
