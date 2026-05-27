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
  - `searchSimilar`: 向量相似检索/search similar
  - `rebuildEmbeddings`: 批量重建向量/rebuild embeddings
  - `resolveDefaultEmbeddingConfig`: 读取默认向量配置/resolve default embedding config
  - `compressImageInPlace({ filePath, maxWidth?, maxHeight?, quality? })`: 原图保质量压缩就地替换(默认 1600x1600/q75,仅压缩收益>1KB 才原子替换,失败回滚)。普通批量上传(controller compressUploadFiles)与 ZIP 批量导入(zip-import runJob)共用同一压缩口径/compress image in place keep quality | keywords: compress image in place keep quality, 原图保质量压缩
  - `generateThumbnail`: 生成缩略图
  - `searchByTags`: 按 tags 查询(**默认排除 isUsed=true,传 includeUsed=true 关闭**)/search images by tags excluding used
  - `sampleRandom`: 随机获取图片(**默认排除 isUsed=true,传 includeUsed=true 关闭**)/random sample excluding used
  - `countAvailableByTags`: 统计指定 tags 当前可用图片数(已排除 isUsed),返回 total + byTag,用于生成前的不足量预估/count available images by tags
  - `listTopTagsWithCount`: 列出租户可见的热门 tag(按图片数量倒序,排除 isUsed),用于 AI 推荐 tag 选择/list top tags by count for AI recommendation
  - `markUsedBatch`: 批量标记图片为已使用 (isUsed=true,usedAt=now),生成图组/拼图完成后调用,reset=true 可反向重置/mark images as used

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
图库模块定义。
- **关键词**: module
