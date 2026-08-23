# Gallery Module

## 模块描述
该模块基于MongoDB存储图片与图库组的元数据及向量Embedding，支持批量上传、按用户/标签/分组查询，并提供向量相似度检索（优先Atlas Vector Search，失败回退本地余弦相似度）。
文件路径: `src/modules/gallery`

## 子模块
- `zip-import/` — ZIP 批量导入子模块，详见 `zip-import/module.md`。复用 `GalleryService.createMany` 入库，支持队列化、进度轮询、取消。
- `material-styles/` — AI 素材风格库子模块，详见 `material-styles/module.md`。给 `ai-material` 提供可选/随机的风格预设，只约束配色、笔触、描边与装饰语言；参考图打进桌面端安装包，服务端只存描述词。

## 功能描述及关键词

### gallery.controller.ts
图库控制器。
- **关键词**: gallery, image, group, groups, upload, pagination, cursor, embedding, vector-search, similarity, groupId, atlas, cosine, mongo, controller
- **函数**:
  - `upload`: 上传图片文件并写入图库记录（含压缩、缩略图生成、尺寸提取、cover/collage 自动识别）。表单可带 `clientPreprocess` 声明前端已按同口径（1600×1600 / q75）压过，命中后**同时跳过压缩和尺寸读取**；与 ZIP 导入的 `_gallery_manifest.json` 同一套校验，但按**下标**对齐并额外比对 `originalname`——同批可能有同名文件，按名字匹配会把尺寸安到错误的那张上 | keywords: 客户端预处理清单, 跳过重复压缩, client-preprocess-manifest, skip-duplicate-compression
  - `listGroups`: 自动确保并置顶默认分组“动态封面/动态拼图”
  - `createUploadThumbnails`: 批量生成缩略图
  - `extractUploadFileDimensions`: 提取上传文件尺寸
  - `getImageDimensionsFromFile`: 使用 jimp 读取图片尺寸
  - `deleteImage`: `POST images/:id/delete` 删除单张图片
  - `deleteImagesBatch`: `POST images/batch-delete` 批量删除图片(body `{ userId, ids[] }`),镜像 `images/tags/batch` 参数校验 | keywords: gallery batch delete images, 图库批量删除
  - `listMaterialStyles`: `GET material-styles` 列出 AI 素材可选的风格预设与分组，只下发 id/展示名/分组/气质概括，提示词留服务端，缩略图由安装包按同名 id 自带 | keywords: 素材风格列表, list-material-styles
  - `detectMaterialTextIntent(prompt)` — 判断用户描述是否明确要求或排除画面文字，未明确要求时回落到无字贴纸 | keywords: 文字意图识别, 素材文字需求, material-text-intent, detect-text-intent
  - `buildAiMaterialPrompt({ rawPrompt, stylePreset, referenceImageUrl, wantsText })` — 以用户原始描述为最高内容优先级拼装素材提示词，风格与默认贴纸规格只补足未说明部分 | keywords: 素材提示词, 描述优先, build-ai-material-prompt, prompt-first
  - `generateAiMaterial`: `POST ai-material` AI 生成素材并入图库；输入提示词具有最高内容优先级，明确要求文字时必须逐字生成指定文案，未要求文字时默认单主体 + 纯色背景 + 无字贴纸；可选 `referenceImageUrl` 与 `stylePreset`（预设 id 或 `random`）只控制配色、笔触、描边与构成语言，不改变主体 | keywords: AI素材生成, 描述优先, ai-material-generate, prompt-first
  - `readUploadPreprocessManifest`: 读取并校验普通上传的 `clientPreprocess` 声明,返回按 multer filename 索引的可信尺寸 | keywords: 客户端预处理清单, client-preprocess-manifest
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
