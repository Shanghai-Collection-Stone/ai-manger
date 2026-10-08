# Gallery Module

## 模块描述

该模块基于MongoDB存储图片与图库组的元数据及向量Embedding，支持批量上传、按用户/标签/分组查询、按创建时间升降序分页，并提供向量相似度检索（优先Atlas Vector Search，失败回退本地余弦相似度）。

图库重构支持：图片统一返回收藏、备注与 AI 人脸保护字段；列表支持新旧排序、多标签且筛选、收藏筛选、随机换批与收藏 offset 分页；统计使用当前可见作用域精确计数；相似图优先复用图片向量并以共同标签兜底；标签库按租户作用域保存分类并统计未分类标签；标签转备注会批量移除标签并按行去重追加备注。
文件路径: `src/modules/gallery`

## 子模块

- `zip-import/` — ZIP 批量导入子模块，详见 `zip-import/module.md`。复用 `GalleryService.createMany` 入库，支持队列化、进度轮询、取消。
- `material-styles/` — AI 素材风格库子模块，详见 `material-styles/module.md`。给 `ai-material` 提供可选/随机的风格预设，只约束配色、笔触、描边与装饰语言；参考图打进桌面端安装包，服务端只存描述词。

## 功能描述及关键词

### gallery.controller.ts

图库控制器。

- **关键词**: gallery, image, group, groups, upload, pagination, cursor, embedding, vector-search, similarity, groupId, atlas, cosine, mongo, controller
- **函数**:
  - `GalleryController.upload(files, body, req)` — 上传图片并写入图库记录，先修正 multipart 中文原文件名乱码，支持批量写入备注与 AI 人脸保护状态；`clientPreprocess` 仍按文件下标和原名校验，命中后跳过重复压缩与尺寸读取 | keywords: 图库上传, 图片元数据, 上传文件名, gallery-upload, image-metadata, upload-filename
  - `listGroups`: 自动确保并置顶默认分组“动态封面/动态拼图”
  - `GalleryController.list({ userId?, tenantId?, groupId?, tag?, tags?, imageType?, cursorId?, limit?, sortOrder?, sort?, favoriteOnly?, offset? })` — 返回图库图片，兼容旧游标并支持多标签、随机和收藏优先排序 | keywords: 图库多条件排序, 多标签筛选, gallery-multi-sort, multi-tag-filter
  - `GalleryController.stats(req)` — 精确统计当前作用域图片、收藏、分组与标签数量 | keywords: 图库精确统计, 租户可见范围, gallery-exact-stats, tenant-visibility
  - `GalleryController.updateImagesMetaBatch(body, req)` — 批量更新可见图片的备注、收藏、人脸保护和标签 | keywords: 批量图片元数据, 作用域鉴权, batch-image-metadata, scope-authorization
  - `GalleryController.updateImageMeta(id, body, req)` — 更新单张可见图片的备注、收藏、人脸保护和标签 | keywords: 单图图片元数据, 作用域鉴权, single-image-metadata, scope-authorization
  - `GalleryController.similarImages(id, limit, req)` — 读取向量相似图并在向量不可用时按共同标签兜底 | keywords: 相似图片, 标签相似兜底, similar-images, tag-similarity-fallback
  - `GalleryController.getTagLibrary(req)` — 读取标签分类和未分类标签统计 | keywords: 读取标签库, 未分类标签, read-tag-library, uncategorized-tags
  - `GalleryController.replaceTagLibrary(body, req)` — 校验并整体替换当前作用域标签分类 | keywords: 替换标签库, 分类唯一性, replace-tag-library, category-uniqueness
  - `GalleryController.convertTagsToNote(body, req)` — 批量移除标签并把标签文字去重追加到备注 | keywords: 标签转备注, 批量迁移, tags-to-note, batch-migration
  - `createUploadThumbnails`: 批量生成缩略图
  - `extractUploadFileDimensions`: 提取上传文件尺寸
  - `getImageDimensionsFromFile`: 使用 jimp 读取图片尺寸
  - `deleteImage`: `POST images/:id/delete` 删除单张图片
  - `deleteImagesBatch`: `POST images/batch-delete` 批量删除图片(body `{ userId, ids[] }`),镜像 `images/tags/batch` 参数校验 | keywords: gallery batch delete images, 图库批量删除
  - `listMaterialStyles`: `GET material-styles` 列出 AI 素材可选的风格预设与分组，只下发 id/展示名/分组/气质概括，提示词留服务端，缩略图由安装包按同名 id 自带 | keywords: 素材风格列表, list-material-styles
  - `detectMaterialTextIntent(prompt)` — 判断用户描述是否明确要求或排除画面文字，未明确要求时回落到无字贴纸 | keywords: 文字意图识别, 素材文字需求, material-text-intent, detect-text-intent
  - `buildAiMaterialPrompt({ rawPrompt, stylePreset, referenceImageUrl, wantsText })` — 以用户原始描述为最高内容优先级拼装素材提示词，风格与默认贴纸规格只补足未说明部分 | keywords: 素材提示词, 描述优先, build-ai-material-prompt, prompt-first
  - `generateAiMaterial`: `POST ai-material` AI 生成素材并入图库（落盘入库委托 `GalleryAiImageService.persistGeneratedImage`）；输入提示词具有最高内容优先级，明确要求文字时必须逐字生成指定文案，未要求文字时默认单主体 + 纯色背景 + 无字贴纸；可选 `referenceImageUrl` 与 `stylePreset`（预设 id 或 `random`）只控制配色、笔触、描边与构成语言，不改变主体 | keywords: AI素材生成, 描述优先, ai-material-generate, prompt-first
  - `readUploadPreprocessManifest`: 读取并校验普通上传的 `clientPreprocess` 声明,返回按 multer filename 索引的可信尺寸 | keywords: 客户端预处理清单, client-preprocess-manifest
  - `resolveGeneratedMaterialFile`: 把生图返回的本地路径解析成 `public/uploads` 下的文件信息,拒绝外链与 `..` 穿越 | keywords: resolve generated material file, 素材落盘

### 常量

- `AI_MATERIAL_TAG` = `ai素材`：AI 生成素材的固定标签,与前端 `web/src/ui/AiCommander/design-editor/material-lab/MaterialPanel.jsx` 的同名常量必须逐字一致 | keywords: AI素材标签, ai-material-tag
- `GALLERY_COVER_TAGS` — 图库系统写入的封面类标签，供图片类型过滤与标签库排除复用 | keywords: 系统封面标签, 图库标签, system-cover-tags, gallery-tags

### gallery.constants.ts

图库跨服务复用的标签常量，避免筛选与入库重复写字面量。

- **函数**:
  - `AI_GENERATED_IMAGE_TAG` — AI 生成图片与素材面板共用的固定图库标签 | keywords: AI素材标签, ai-material-tag

### gallery-upload-filename.ts

普通上传与 ZIP 上传共用的 multipart 原文件名修正入口。

- **函数**:
  - `normalizeGalleryUploadFilename(name)` — 将 latin1 误解码的 UTF-8 中文文件名还原，已正确解码或转换无效时保留原值 | keywords: 上传文件名, 中文乱码修复, upload-filename, mojibake-repair

### 鉴权说明

`gallery` 控制器全部入口走模块自有的 `resolveAuthScope(req)`(Bearer token → `AdminService.getUserByToken` → tenantId/userId,失败抛 `UnauthorizedException`),不使用 admin 的 CASL `RequirePermission` 装饰器——后者绑定 `AdminAuthGuard` 且 subject 注册中心里没有 Gallery 主体,挂上会把租户侧调用方全部挡死。新增入口一律沿用 `resolveAuthScope`,与同模块既有 20+ 入口保持一致。

### filters/gallery-upload-exception.filter.ts

图库上传异常过滤器（拦截 Multer 上传错误并转换为前端可读消息）。

- **关键词**: upload, multer, exception, filter, file-count, file-size
- **函数**:
  - `catch`: 捕获并返回统一错误响应/catch and normalize upload exception response
  - `resolveMulterError`: 映射 Multer 错误码到业务文案/map multer codes to user-friendly message

### gallery-ai-image.service.ts

AI 生图入库通道：图库 AI 素材接口与抖音分镜画面重生成共用，把生图落盘结果登记为图库素材。

- **关键词**: ai-image, persist, gallery-intake, thumbnail, dimensions
- **函数**:
  - `AI_GENERATED_IMAGE_TAG` — AI 生成图片固定标签「ai素材」 | keywords: AI素材标签, ai-material-tag
  - `resolveGeneratedImageFile(imagePath)` — 生图相对地址转落盘文件信息，拒绝外链与穿越路径 | keywords: 解析生图落盘路径, 防目录穿越, resolve-generated-image-file, path-traversal-guard
  - `GalleryAiImageService()` — 生图入库服务 | keywords: 生图入库服务, 统一落盘通道, gallery-ai-image-service, unified-persist-pipeline
  - `persistGeneratedImage(input)` — 校验文件、补尺寸与缩略图、合并标签后写入图库 | keywords: 登记生成图片, 图库素材入库, persist-generated-image, gallery-image-intake
  - `readDimensions(absPath)` — jimp 读取像素尺寸，失败返回 null | keywords: 读取图片尺寸, 竖图判定, read-image-dimensions, portrait-detection
  - `isJimpLike(value)` — 判断动态导入的 jimp 可读图 | keywords: 判断jimp可用, 动态导入, detect-jimp-like, dynamic-import

### gallery.service.ts

图片服务。

- **关键词**: image, service, isUsed, capacity, mark-used, top-tags
- **函数**:
- `GalleryService.ensureIndexes()` — 初始化图库索引，覆盖租户标签去重与创建时间分页；收藏排序只保留含创建时间与业务 ID 的完整键，并删除较短前缀索引 | keywords: 图库索引, 收藏排序, gallery-indexes, favorite-sorting
  - `GalleryService.createMany(inputs)` — 批量创建图片并写入元数据默认值 | keywords: 图片批量创建, 元数据默认值, batch-image-create, metadata-defaults
  - `list`: 图片列表/list images
  - `GalleryService.findAccessibleImages(userId, tenantId?, options?)` — 按租户可见性过滤图片，兼容旧游标并支持多条件排序与筛选 | keywords: 租户图片查询, 图库多条件排序, tenant-image-query, gallery-multi-sort
  - `GalleryService.getAccessibleStats(userId, tenantId?)` — 精确统计可见图片、收藏与去重标签 | keywords: 图库精确统计, 可见范围计数, gallery-exact-stats, visibility-count
  - `GalleryService.updateImageMeta(input)` — 更新单张可见图片的元数据 | keywords: 单图元数据更新, 图片可见范围, single-image-metadata, image-visibility
  - `GalleryService.updateImagesMetaBatch(input)` — 批量更新可见图片并按行去重追加备注 | keywords: 批量元数据更新, 备注按行去重, batch-image-metadata, deduplicate-note-lines
  - `GalleryService.appendNoteLines(current, incoming)` — 追加非重复备注行并限制总长度 | keywords: 备注追加, 文本去重, append-note, text-deduplication
  - `GalleryService.findSimilarImages(input)` — 以已有向量检索相似图并按共同标签兜底 | keywords: 相似图片, 标签相似兜底, similar-images, tag-similarity-fallback
  - `GalleryService.convertTagsToNote(input)` — 把图片标签迁移为去重备注行 | keywords: 标签转备注, 图片批量迁移, tags-to-note, image-batch-migration
  - `GalleryService.toPublicImage(image)` — 补齐历史图片默认字段并移除 Mongo 主键 | keywords: 图片公开归一化, 历史默认值, public-image-normalization, legacy-defaults
  - `GalleryService.getSystemTags()` — 返回标签库统计需要排除的系统标签 | keywords: 系统标签列表, 标签库排除, system-tag-list, tag-library-exclusion
  - `GalleryService.normalizeTags(tags)` — 去井号、去空白并去重规整标签 | keywords: 标签规整, 标签去重, tag-normalization, tag-deduplication
  - `GalleryService.buildImageTypeFilter(imageType)` — 构造图片类型数据库过滤；普通图排除拼图、封面标签与 AI 素材 | keywords: 普通图筛选, AI素材排除, regular-image-filter, exclude-ai-material
  - `GalleryService.matchesImageType(image, imageType)` — 在相似图内存结果中执行同口径图片类型过滤 | keywords: 普通图内存筛选, AI素材排除, in-memory-image-filter, exclude-ai-material
  - `findAccessibleImagesByIds`: 按用户选择的图片 ID 精确读取当前租户可见图片，并按输入顺序返回，用于封面重生成/reference images by ids for cover regenerate
  - `searchSimilar`: 向量相似检索/search similar
  - `rebuildEmbeddings`: 批量重建向量/rebuild embeddings
  - `resolveDefaultEmbeddingConfig`: 读取默认向量配置/resolve default embedding config
  - `compressImageInPlace({ filePath, maxWidth?, maxHeight?, quality? })`: 原图保质量压缩就地替换(默认 1600x1600/q75,仅压缩收益>1KB 才原子替换,失败回滚)。普通批量上传(controller compressUploadFiles)与 ZIP 批量导入(zip-import runJob)共用同一压缩口径/compress image in place keep quality | keywords: compress image in place keep quality, 原图保质量压缩
  - `generateThumbnail`: 生成缩略图
  - `searchByTags`: 按 tags 查询(**默认排除 isUsed=true,传 includeUsed=true 关闭**)/search images by tags excluding used
  - `GalleryService.sampleRandom({ userId?, tenantId?, groupId?, tags?, imageType?, excludedGroupIds?, excludedTags?, limit?, includeUsed? })` — 从全部可见图片或所选标签并集随机采样；`imageType=regular` 排除拼图、封面标签与 AI 素材 | keywords: 图库随机采样, 标签随机取图, gallery-random-sample, tag-random-selection
  - `countAvailableByTags`: 统计指定 tags 当前可用图片数(**默认排除 isUsed,传 includeUsed=true 关闭**),返回 total + byTag,用于生成前的不足量预估(去重/不去重生成共用)/count available images by tags excluding used by default
  - `listTopTagsWithCount`: 列出租户可见的热门 tag(按图片数量倒序,排除 isUsed),用于 AI 推荐 tag 选择/list top tags by count for AI recommendation
  - `markUsedBatch`: 批量标记图片为已使用 (isUsed=true,usedAt=now),生成图组/拼图完成后调用,reset=true 可反向重置/mark images as used
  - `deleteImage`: 删除单张图片(记录+本地原图/缩略图文件)/delete one image
  - `deleteManyImages({ userId, ids })`: 批量删除图片,逐条复用单删逻辑互不阻断,返回 {deleted, failed, deletedIds} | keywords: gallery batch delete images, 图库批量删除

### gallery-group.service.ts

图库组服务。

- **关键词**: group, service, embedding, vector-search, admin-runtime
- `GalleryGroupService.ensureIndexes()` — 建立用户与租户分组时间线索引 | keywords: gallery, groups, mongo, group-timeline-index
- **函数**:
  - `findOrCreateDynamicCoverGroup`: 查找或创建“动态封面”默认分组
  - `findOrCreateDynamicCollageGroup`: 查找或创建“动态拼图”默认分组（兼容升级旧“拼图封面”）
  - `ensureDefaultDynamicGroups`: 确保默认动态分组存在
  - `getDefaultDynamicGroupIds`: 返回默认动态分组 ID（用于生成流程过滤）
  - `resolveDefaultEmbeddingConfig`: 读取 ai_providers em 记录作为向量运行时配置（apiKey/baseUrl/model）/resolve default embedding config
  - `safeEmbedText`: 安全文本向量化（失败兜底零向量，已接入 admin runtime 配置）/safe embed text with admin runtime
  - `searchSimilar`: 向量相似检索（透传 admin 默认 em 配置到 EmbeddingService）/vector similarity search
  - `GalleryGroupService.countAccessibleGroups(userId, tenantId?)` — 按现有分组列表口径精确计数 | keywords: 图库组精确统计, 分组可见范围, exact-group-count, group-visibility

### gallery-image.entity.ts

图片实体（字段：id, userId, scope, tenantId, groupId, originalName, fileName, url, thumbFileName, thumbUrl, absPath, mimeType, size, width, height, isPortrait, tags, description, **favorite**, **favoritedAt**, **note**, **aiFaceProtected**, isCollage, collageSourceImageIds, collageMeta, **isUsed**, **usedAt**, embedding, createdAt, updatedAt）。历史数据缺少 `favorite` / `note` / `aiFaceProtected` 时对外分别按 `false` / `''` / `false` 返回；`isUsed=true` 表示该图已被动态拼图/生图组消耗,默认 searchByTags/sampleRandom 不再命中。

图片类型口径：`imageType=regular` 同时排除 `isCollage=true`、系统封面标签与 `AI_GENERATED_IMAGE_TAG`（`ai素材`）；该过滤被图库列表、标签搜索、可用量统计、热门标签、随机采样与相似图结果共同复用，`collage` 口径不变。

- **关键词**: entity, image, width, height, isPortrait, isUsed, usedAt

### gallery.dto.ts

图库重构入口 DTO，使用 class-validator 校验图片元数据、标签库与标签转备注请求。

- **关键词**: dto, metadata, tag-library, validation
- **函数**:
  - `UpdateGalleryImageMetaDto()` — 校验单张图片元数据更新请求 | keywords: 图片元数据, 单图更新, image-metadata, single-image-update
  - `BatchUpdateGalleryImageMetaDto()` — 校验批量图片元数据更新请求 | keywords: 图片元数据, 批量更新, image-metadata, batch-image-update
  - `GalleryTagCategoryDto()` — 校验标签库分类请求项 | keywords: 标签分类, 标签库校验, tag-category, tag-library-validation
  - `ReplaceGalleryTagLibraryDto()` — 校验整体替换标签库请求 | keywords: 标签库替换, 分类校验, replace-tag-library, category-validation
  - `ConvertGalleryTagsToNoteDto()` — 校验标签转备注请求 | keywords: 标签转备注, 批量转换, tags-to-note, batch-conversion

### gallery-tag-library.entity.ts

标签库实体与分类类型，集合为 `gallery_tag_libraries`，每个 `scopeKey` 唯一。

- **关键词**: tag-library, entity, scope-key, category

### gallery-tag-library.service.ts

按图库图片可见作用域管理标签分类，并聚合实际使用但未分类的标签。

- **关键词**: tag-library, tenant-scope, uncategorized, aggregation
- **函数**:
  - `GalleryTagLibraryView` — 标签库接口响应：分类列表与按图片数降序的未分类标签 | keywords: 标签库响应, 未分类统计, tag-library-response, uncategorized-statistics
  - `GalleryTagLibraryService()` — 管理作用域标签库与未分类标签统计 | keywords: 图库标签库, 未分类标签, gallery-tag-library, uncategorized-tags
  - `GalleryTagLibraryService.constructor(db)` — 初始化标签库与图库图片集合 | keywords: 标签库初始化, 数据集合, tag-library-initialization, data-collections
  - `GalleryTagLibraryService.ensureIndexes()` — 创建作用域唯一索引 | keywords: 标签库索引, 作用域唯一, tag-library-index, unique-scope
  - `GalleryTagLibraryService.resolveScopeKey(tenantId?)` — 生成与图片可见性一致的作用域键 | keywords: 标签库作用域, 租户隔离, tag-library-scope, tenant-isolation
  - `GalleryTagLibraryService.buildImageScopeFilter(tenantId?)` — 构造图库图片租户过滤条件 | keywords: 图片可见范围, 租户过滤, image-visibility, tenant-filter
  - `GalleryTagLibraryService.defaultCategories()` — 返回首次使用时的默认三类标签 | keywords: 默认标签分类, 标签库初始化, default-tag-categories, tag-library-bootstrap
  - `GalleryTagLibraryService.get(tenantId, systemTags)` — 读取或初始化标签库并统计未分类标签 | keywords: 读取标签库, 未分类统计, read-tag-library, uncategorized-statistics
  - `GalleryTagLibraryService.replace(tenantId, categories, systemTags)` — 校验并整体替换标签分类 | keywords: 替换标签库, 标签唯一性, replace-tag-library, unique-tag-category

### gallery-group.entity.ts

图库组实体。

- **关键词**: entity

### gallery.module.ts

图库模块定义。导入 `AiAgentModule` 以复用 `AgentService` 的生图运行时(ai-agent 不反向依赖 gallery,无循环)。

- **关键词**: module, ai-agent, image-generate
