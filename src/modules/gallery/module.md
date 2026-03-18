# Gallery Module

## 模块描述
该模块基于MongoDB存储图片与图库组的元数据及向量Embedding，支持批量上传、按用户/标签/分组查询，并提供向量相似度检索（优先Atlas Vector Search，失败回退本地余弦相似度）。
文件路径: `src/modules/gallery`

## 功能描述及关键词

### gallery.controller.ts
图库控制器。
- **关键词**: gallery, image, group, groups, upload, pagination, cursor, embedding, vector-search, similarity, groupId, atlas, cosine, mongo, controller

### gallery.service.ts
图片服务。
- **关键词**: image, service
- **函数**:
  - `ensureIndexes`: 初始化索引/ensure indexes
  - `createMany`: 批量创建图片/create many images
  - `list`: 图片列表/list images
  - `searchSimilar`: 向量相似检索/search similar
  - `rebuildEmbeddings`: 批量重建向量/rebuild embeddings
  - `resolveDefaultEmbeddingConfig`: 读取默认向量配置/resolve default embedding config

### gallery-group.service.ts
图库组服务。
- **关键词**: group, service

### gallery-image.entity.ts
图片实体。
- **关键词**: entity

### gallery-group.entity.ts
图库组实体。
- **关键词**: entity

### gallery.module.ts
图库模块定义。
- **关键词**: module
