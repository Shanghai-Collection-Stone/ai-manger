# Media Agent Module

## 模块描述
该模块提供基于 LangChain/DeepAgent 的媒体 Agent 能力，包括图库对话 Agent 和小红书专项 Agent。
文件路径: `src/modules/media-agent`

## 功能描述及关键词

### media-agent.service.ts
核心 Agent 服务，提供图库和小红书相关的 Agent 能力。
- **关键词**: media-agent, gallery-agent, xhs-agent, langchain, deepagent
- **函数**:
  - `getGalleryToolsHandle` - 获取图库工具句柄
  - `getXhsToolsHandle` - 获取 XHS 工具句柄

### gallery-tools.service.ts
图库工具服务，提供图库搜索和管理相关的 LangChain 工具。
- **关键词**: gallery, tools, langchain, image-search, groups
- **函数**:
  - `getHandle` - 获取图库工具列表（含 gallery_groups 工具）
  - `createSearchImagesTool` - 图片搜索工具（支持 tag/group_id 过滤）
  - `createListImagesTool` - 图片列表工具
  - `createListTagsTool` - 标签列表工具
  - `createRandomImagesTool` - 随机图片工具
  - `createListGroupsTool` - 列出图库分组工具
  - `createSearchGroupsTool` - 向量搜索图库分组工具

### xhs-tools.service.ts
小红书工具服务，提供 Canvas 和批量发布相关的 LangChain 工具。注入 `CanvasService` 与 `GalleryService` 实现真实数据读写 + 不足量预检。
- **关键词**: xhs, canvas, tools, langchain, image-group, tag-select, precheck, insufficient
- **函数**:
  - `getHandle` - 获取 XHS 工具列表（list、unused-image-groups、detail、create-image-group、**tag-select-request**）
  - `normalizeImageGroupArticles` - 对齐 groupCount 与 articles 数量（不强制 6-8 组）
  - `imageGroupRoleOrder(role)` - 将图组图片 role 映射为排序权重(cover=0/inner-N=N/未知=99)，回写前稳定排序防串位 | keywords: image-group-role-order, slot-alignment
  - `mergeImageGroupsToArticles` - 将图组结果回写到同一 Canvas 的文章字段，回写前按 role(cover→inner-1..5)排序确保封面恒在 imageUrls[0]、内页不串到封面下标(任务5)，并校验单篇图片 6-8 张目标 | keywords: slot-alignment, image-group-merge
  - `precheckImageCapacity` - **不足量预检**:聚合 articles 全部 tags,调 `gallery.countAvailableByTags`,按 `MIN_SOURCE_IMAGES_PER_GROUP=6 * groupCount` 阈值判定,返回 {sufficient, available, estimatedGroups, byTag} 用于 AI 自然语言反馈
  - `createListCanvasesTool` - 列出 Canvas 列表（xhs_list_canvases）
  - `createListUnusedImageGroupsTool` - 查询未被生文消费的图片组 Canvas（xhs_list_unused_image_groups），返回 unused group 列表；生图专家/生文专家询问可用图组时优先调用 | keywords: 未使用图组, unused-image-groups
  - `createGetCanvasDetailTool` - 获取 Canvas 详情（xhs_get_canvas_detail）
  - `createImageGroupCanvasTool` - 创建图片组 Canvas，或传入 canvasId 在同一 Canvas 生成并合并文章配图（xhs_create_image_group_canvas）。**两个分支都先 precheckImageCapacity(失败时降级放行避免阻断主链路):不足量直接返回 `status: 'insufficient_images'` 结构化结果给 LLM,让其用自然语言询问用户(降级/补图/取消),不调用生成链路**。**canvas-it fence 仅通过 `scope.earlyEmit` 直接推到前端 SSE,工具 return 字符串不再嵌入 fence(避免 LLM 在 streaming response 中复述长 JSON 触发 LangChain `patchToolCallsMiddleware: expected AIMessage or Command, got object` 解析问题)**
  - `createRegenerateCanvasCoverTool` - `xhs_regenerate_canvas_cover` 专用封面重生成工具；支持图文 Canvas 文章首图和图片组 Canvas role=cover，必须传多选图库 `image_ids`，一次请求合并参考图，只替换封面不改正文/标签/内页 | keywords: cover-regenerate, canvas-cover-only-tool
  - `createRegenerateArticleImagesTool` - **新增 `xhs_regenerate_article_images` 工具**：重新为 Canvas 中指定 `article_index`（0-based）的单篇文章生成配图；图源不足返回 `insufficient_images`；生成后调用 `updateArticleImages` 定点回写，不影响其他文章；通过 `earlyEmit` 推送 `canvas-it` fence
  - `createTagSelectRequestTool` - **新增 `tag_select_request` 工具**:用户请求生成图组/图文但未明确给 tags 时调用,内部查 `gallery.listTopTagsWithCount`(失败降级空 recommendTags) 取热门 tags 作为推荐,通过 `scope.earlyEmit` 推送 ` ```tag-select-it ``` ` fence 到聊天流。前端识别后渲染卡片 + 搜索弹窗(推荐 chips + 联想下拉),用户多选确认后以"我选定标签：#A #B"用户消息回传,AI 据此按场景继续调 topic_orchestrate(图文) 或 xhs_create_image_group_canvas(图组)。**工具描述强调用户已明确 tags 时跳过本工具,每次对话最多调用 1 次;return 字符串不带 fence,只让 LLM 用一句话告知用户卡片已弹出**

### media-agent.module.ts
模块定义。
- **关键词**: module, media-agent, nestjs
