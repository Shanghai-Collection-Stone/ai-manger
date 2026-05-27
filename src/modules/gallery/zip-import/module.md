# Gallery-Zip-Import Module

## 模块描述
图库 ZIP 批量导入模块:接收单个 zip 包 → 写入 `gallery_zip_imports` 集合(pending 任务) → 立即返回 jobId → 进程内串行后台流水线(打开 zip → 流式逐张解压到 `public/uploads/` → 保质量压缩(同批量上传口径) → 调 `GalleryService.createMany` 分批入库 + 生成缩略图 + 写 embedding)→ 全程更新 `status / stage / progress`,前端 2s 轮询展示。

特点:
- **单进程串行**:同时只跑一个 zip,避免大包互相挤垮内存
- **流式解压**:基于 `node-stream-zip`,单 entry 落盘后再处理下一个,内存占用 O(1)
- **分批入库**:每 20 张一批走 `GalleryService.createMany`(含 embedding 批量调用)
- **可取消**:`POST :id/cancel` 写 `cancelRequested=true`,运行循环下一次轮询时中断并保留已入库数据
- **可指定库 + 全局 tag**:`groupId` 落到每张图的 `groupId` 字段,`tags` 落到 `tags` 字段
- **挂载点**:`/gallery/zip-import/*`,复用 `AdminAuthGuard`(Bearer token + tenant scope)
- **zip 上限**:1GB,zip 临时文件存 `public/uploads_zips/`,处理完(成功/失败/取消)自动 unlink

文件路径: `src/modules/gallery/zip-import`

## 功能描述及关键词

### entities/gallery-zip-import.entity.ts
任务实体定义。
- **关键词**: gallery zip import entity, status machine, progress, errors
- **类型**:
  - `GalleryZipImportStatus`: `'pending' | 'extracting' | 'importing' | 'done' | 'failed' | 'cancelled'`
  - `GalleryZipImportProgress`: `{ total, processed, success, failed }`
  - `GalleryZipImportErrorItem`: `{ fileName, reason }`
  - `GalleryZipImportEntity`: 主实体(含 `id` UUID 字符串、`stage`、`imageIds`、`cancelRequested` 等)
  - `GalleryZipImportCreateInput`: enqueue 入参

### services/gallery-zip-import.service.ts
后台任务调度 + 执行器。
- **关键词**: zip import service, queue, stream extract, batch import, cancellable
- **常量**: `IMAGE_EXT_SET`(jpg/jpeg/png/webp/gif/bmp)、`MAX_IMPORT_PER_BATCH=20`
- **函数**:
  - `ensureIndexes`: 建索引(id 唯一、userId+createdAt、tenantId+createdAt、status+createdAt) /ensure mongo indexes
  - `enqueue`: 写 pending 记录 + `setImmediate` 触发后台处理 /enqueue zip import job
  - `getById`: 单条查询(轮询入口)/get job by id
  - `listRecent`: 按 tenant scope 列出最近 N 条 /list recent jobs
  - `cancel`: 写 `cancelRequested=true`,pending 态直接置 cancelled /cancel job
  - `remove`: 删除一条任务记录(仅限完成/失败/取消态)/delete job record
  - `processJob`: 进程内串行入口(等待当前任务结束后才跑下一个)/sequential processing entry
  - `runJob`: 主流水线 — 打开 zip → 枚举图片 entry → 逐张解压 → 保质量压缩(`GalleryService.compressImageInPlace`,与普通批量上传同口径 1600x1600/q75) → 生成缩略图/读尺寸 → 累积到 batch → 每 20 张 flush 到 `GalleryService.createMany` /run zip import pipeline
  - `shouldCancel`: 实时从 db 取 `cancelRequested` 标志 /check cancel flag
  - `finalizeFailed` / `finalizeCancelled`: 写终态 + 清理 zip 临时文件 /finalize failed or cancelled
  - `isImageEntry`: 按扩展名筛选 zip 内的图片条目(忽略 `__MACOSX/` 和 `._` 元数据)/filter image entry
  - `extractEntry`: 单个 entry 流式解压到目标路径 /stream extract single entry
  - `closeZip` / `safeUnlink` / `statSize`: 资源/IO 工具 /resource and io helpers
  - `readImageDimensions`: jimp 读尺寸 /read image dimensions via jimp
  - `mimeTypeFromExt`: 扩展名 → mime /mime from ext
  - `loadStreamZip`: 懒加载 `node-stream-zip` 构造函数 /lazy load streamzip ctor

### controller/gallery-zip-import.controller.ts
HTTP 控制器(挂载 `/gallery/zip-import`)。
- **关键词**: zip import controller, multipart, list, cancel, bearer auth
- **常量**: `MAX_ZIP_BYTES = 1GB`
- **函数**:
  - `resolveAuthScope`: Bearer token → `{ tenantId, userId }` /resolve bearer token
  - `upload`: `POST /upload` 接收单 zip(multer disk + 1GB 限制)→ enqueue → 立即返回 jobId /upload and enqueue
  - `list`: `GET /list?limit=` 列出最近任务 /list recent jobs
  - `getById`: `GET /:id` 单条详情(前端轮询)/get job by id
  - `cancel`: `POST /:id/cancel` 请求取消 /cancel job
  - `remove`: `POST /:id/delete` 删除任务记录 /delete job record

### gallery-zip-import.module.ts
模块定义。
- **关键词**: zip import module, providers, controllers
- imports: `DataSourceModule`(DS_MONGO_DB)、`AdminModule`、`GalleryModule`(注入 `GalleryService`)
- providers: `GalleryZipImportService`(同名 export)
