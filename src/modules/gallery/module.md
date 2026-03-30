# Gallery Module

## 模块描述
该模块基于MongoDB存储图片与图库组的元数据及向量Embedding，支持批量上传、按用户/标签/分组查询，并提供向量相似度检索（优先Atlas Vector Search，失败回退本地余弦相似度）。
文件路径: `src/modules/gallery`

## 功能描述及关键词

### gallery.controller.ts
图库控制器。
- **关键词**: gallery, image, group, groups, upload, pagination, cursor, embedding, vector-search, similarity, groupId, atlas, cosine, mongo, controller
- **函数**:
  - `upload`: 上传图片文件并写入图库记录（含压缩、缩略图生成、尺寸提取）
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
- **关键词**: image, service
- **函数**:
  - `ensureIndexes`: 初始化索引/ensure indexes
  - `createMany`: 批量创建图片（含 width/height/isPortrait）/create many images
  - `list`: 图片列表/list images
  - `findAccessibleImages`: 按租户可见性查找图片
  - `searchSimilar`: 向量相似检索/search similar
  - `rebuildEmbeddings`: 批量重建向量/rebuild embeddings
  - `resolveDefaultEmbeddingConfig`: 读取默认向量配置/resolve default embedding config
  - `generateThumbnail`: 生成缩略图
  - `sampleRandom`: 随机获取图片

### gallery-group.service.ts
图库组服务。
- **关键词**: group, service

### gallery-image.entity.ts
图片实体（字段：id, userId, scope, tenantId, groupId, originalName, fileName, url, thumbFileName, thumbUrl, absPath, mimeType, size, width, height, isPortrait, tags, description, isCollage, collageSourceImageIds, collageMeta, embedding, createdAt, updatedAt）。
- **关键词**: entity, image, width, height, isPortrait

### gallery-group.entity.ts
图库组实体。
- **关键词**: entity

### gallery.module.ts
图库模块定义。
- **关键词**: module
