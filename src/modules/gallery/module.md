# Gallery Module

## 模块描述
该模块基于MongoDB存储图片与图库组的元数据及向量Embedding，支持批量上传、按用户/标签/分组查询，并提供向量相似度检索（优先Atlas Vector Search，失败回退本地余弦相似度）。
文件路径: `src/modules/gallery`

## 子模块
- `zip-import/` — ZIP 批量导入子模块，详见 `zip-import/module.md`。复用 `GalleryService.createMany` 入库，支持队列化、进度轮询、取消。

## 功能描述及关键词

### gallery.controller.ts
图库控制器。
- **关键词**: gallery, image, group, groups, upload, pagination, cursor, embedding, vector-search, similarity, groupId, atlas, cosine, mongo, controller
- **函数**:
  - `upload`: 上传图片文件并写入图库记录（含压缩、缩略图生成、尺寸提取、cover/collage 自动识别）
  - `listGroups`: 自动确保并置顶默认分组“动态封面/动态拼图”
  - `createUploadThumbnails`: 批量生成缩略图
  - `extractUploadFileDimensions`: 提取上传文件尺寸
  - `getImageDimensionsFromFile`: 使用 jimp 读取图片尺寸
  - `deleteImage`: `POST images/:id/delete` 删除单张图片
  - `deleteImagesBatch`: `POST images/batch-delete` 批量删除图片(body `{ userId, ids[] }`),镜像 `images/tags/batch` 参数校验 | keywords: gallery batch delete images, 图库批量删除
  - `generateAiMaterial`: `POST ai-material` AI 生成贴纸素材并入图库；支持可选 `referenceImageUrl`，参考图只约束配色、字体气质、描边与构成语言，不复制具体内容；输出仍强制单主体 + 纯色背景 + 无文字，供前端 GPU 去底 | keywords: AI素材生成, ai-material-generate
  - `resolveGeneratedMaterialFile`: 把生图返回的本地路径解析成 `public/uploads` 下的文件信息,拒绝外链与 `..` 穿越 | keywords: resolve generated material file, 素材落盘

### 常量
- `AI_MATERIAL_TAG` = `ai素材`：AI 生成素材的固定标签,与前端 `web/src/ui/AiCommander/design-editor/material-lab/MaterialPanel.jsx` 的同名常量必须逐字一致 | keywords: ai material tag, AI素材标签

### 鉴权说明
`gallery` 控制器全部入口走模块自有的 `resolveAuthScope(req)`(Bearer token → `AdminService.getUserByToken` → tenantId/userId,失败抛 `UnauthorizedException`),不使用 admin 的 CASL `RequirePermission` 装饰器——后者绑定 `AdminAuthGuard` 且 subject 注册中心里没有 Gallery 主体,挂上会把租户侧调用方全部挡死。新增入口一律沿用 `resolveAuthScope`,与同模块既有 20+ 入口保持一致。

### filters/gallery-upload-exception.filter.ts
图库上传异常过滤器（拦截 Multer 上传错误并转换为前端可读消息）。
- **关键词**: upload, multer, exception, filter, file-count, file-size
- **函数**:
  - `catch`: 捕获并返回统一错误响应/catch and normalize upload exception response
  - `resolveMulterError`: 映射 Multer 错误码到业务文案/map multer codes to user-friendly message

### gallery.service.ts
图片服务。
- **关键词**: image, service, isUsed, capacity, mark-used, top-tags
- **函数**:
  - `ensureIndexes`: 初始化索引/ensure indexes
  - `createMany`: 批量创建图片（含 width/height/isPortrait）/create many images
  - `list`: 图片列表/list images
  - `findAccessibleImages`: 按租户可见性查找图片
  - `findAccessibleImagesByIds`: 按用户选择的图片 ID 精确读取当前租户可见图片，并按输入顺序返回，用于封面重生成/reference images by ids for cover regenerate
  - `searchSimilar`: 向量相似检索/search similar
  - `rebuildEmbeddings`: 批量重建向量/rebuild embeddings
  - `resolveDefaultEmbeddingConfig`: 读取默认向量配置/resolve default embedding config
  - `compressImageInPlace({ filePath, maxWidth?, maxHeight?, quality? })`: 原图保质量压缩就地替换(默认 1600x1600/q75,仅压缩收益>1KB 才原子替换,失败回滚)。普通批量上传(controller compressUploadFiles)与 ZIP 批量导入(zip-import runJob)共用同一压缩口径/compress image in place keep quality | keywords: compress image in place keep quality, 原图保质量压缩
  - `generateThumbnail`: 生成缩略图
  - `searchByTags`: 按 tags 查询(**默认排除 isUsed=true,传 includeUsed=true 关闭**)/search images by tags excluding used
  - `sampleRandom`: 随机获取图片(**默认排除 isUsed=true,传 includeUsed=true 关闭**)/random sample excluding used
  - `countAvailableByTags`: 统计指定 tags 当前可用图片数(**默认排除 isUsed,传 includeUsed=true 关闭**),返回 total + byTag,用于生成前的不足量预估(去重/不去重生成共用)/count available images by tags excluding used by default
  - `listTopTagsWithCount`: 列出租户可见的热门 tag(按图片数量倒序,排除 isUsed),用于 AI 推荐 tag 选择/list top tags by count for AI recommendation
  - `markUsedBatch`: 批量标记图片为已使用 (isUsed=true,usedAt=now),生成图组/拼图完成后调用,reset=true 可反向重置/mark images as used
  - `deleteImage`: 删除单张图片(记录+本地原图/缩略图文件)/delete one image
  - `deleteManyImages({ userId, ids })`: 批量删除图片,逐条复用单删逻辑互不阻断,返回 {deleted, failed, deletedIds} | keywords: gallery batch delete images, 图库批量删除

### gallery-group.service.ts
图库组服务。
- **关键词**: group, service, embedding, vector-search, admin-runtime
- **函数**:
  - `findOrCreateDynamicCoverGroup`: 查找或创建“动态封面”默认分组
  - `findOrCreateDynamicCollageGroup`: 查找或创建“动态拼图”默认分组（兼容升级旧“拼图封面”）
  - `ensureDefaultDynamicGroups`: 确保默认动态分组存在
  - `getDefaultDynamicGroupIds`: 返回默认动态分组 ID（用于生成流程过滤）
  - `resolveDefaultEmbeddingConfig`: 读取 ai_providers em 记录作为向量运行时配置（apiKey/baseUrl/model）/resolve default embedding config
  - `safeEmbedText`: 安全文本向量化（失败兜底零向量，已接入 admin runtime 配置）/safe embed text with admin runtime
  - `searchSimilar`: 向量相似检索（透传 admin 默认 em 配置到 EmbeddingService）/vector similarity search

### gallery-image.entity.ts
图片实体（字段：id, userId, scope, tenantId, groupId, originalName, fileName, url, thumbFileName, thumbUrl, absPath, mimeType, size, width, height, isPortrait, tags, description, isCollage, collageSourceImageIds, collageMeta, **isUsed**, **usedAt**, embedding, createdAt, updatedAt）。`isUsed=true` 表示该图已被动态拼图/生图组消耗,默认 searchByTags/sampleRandom 不再命中。
- **关键词**: entity, image, width, height, isPortrait, isUsed, usedAt

### gallery-group.entity.ts
图库组实体。
- **关键词**: entity

### gallery.module.ts
图库模块定义。导入 `AiAgentModule` 以复用 `AgentService` 的生图运行时(ai-agent 不反向依赖 gallery,无循环)。
- **关键词**: module, ai-agent, image-generate
