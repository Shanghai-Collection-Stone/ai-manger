# Canvas Module

## 模块描述
该模块基于MongoDB存储画布，支持两种 canvas 类型：
- **article**（默认）：图文拼盘，包含 articles 列表。
- **image-group**：图片组拼盘，根据文章 tag 批量匹配配图，按固定版式组合图组，异步生成。

文件路径: `src/modules/canvas`

## 固定版式
- **portrait-cover-2inner-collage**: 1竖封面单图 + 2内页拼图
- **collage-cover-2portrait-inner**: 1横拼图封面 + 2竖内页单图

## 功能描述及关键词

### canvas.controller.ts
Canvas控制器。
- `POST /canvas` — 创建图文 Canvas
- `POST /canvas/image-group` — 创建图片组 Canvas（异步，立即返回 generating）
- `GET /canvas/:id` — 获取单个 Canvas
- `GET /canvas` — 列表 Canvas
- `POST /canvas/:id/articles` — 追加文章
- `PATCH /canvas/:id/status` — 更新状态
- `PATCH /canvas/:id/articles/:articleId` — 更新文章
- **关键词**: canvas, articles, image-group, outline, style, content-json, image-ids, status, mongo, controller

### canvas.service.ts
Canvas服务。
- `create` — 创建图文 Canvas
- `createImageGroupCanvas` — 创建图片组 Canvas（异步生成）
- `runImageGroupGeneration` — 后台异步生成图片组并回写
- `updateImageGroups` — 回写图片组到 Canvas
- `get` / `list` / `addArticles` / `updateStatus` / `updateArticle` — 常用crud
- **关键词**: service, image-group, async

### canvas-image-group.service.ts
图片组生成服务。
- `generateImageGroups` — 根据文章 tag 批量匹配图库配图，按版式分配图片组
- `fetchImagePool` — tag匹配+随机补充图片池
- `pickImage` — 从池中按类型选未用图片
- `toGroupImage` — 图库实体转图组图片
- **关键词**: image-group, layout, tag-match, gallery, collage

### canvas.entity.ts
Canvas实体，含新类型定义。
- `CanvasType` — 'article' | 'image-group'
- `ImageGroupLayout` — 两种固定版式枚举
- `CanvasImageGroup` — 单个图片组实体
- `CanvasGroupImage` — 图组内单张图片（含版式角色）
- `CanvasImageGroupCreateInput` — 创建图片组入参
- **关键词**: entity

### canvas.module.ts
Canvas模块定义，导入 GalleryModule。
- **关键词**: module

