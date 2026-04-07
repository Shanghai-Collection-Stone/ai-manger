# Graph Module

## 模块描述
该模块提供“编排文章 -> 写入Canvas -> 图库向量配图/即时生成拼图与封面”的生成流程，并提供“从Canvas生成批量任务 -> 并行入队 -> 触发MCP运行”的发布流程，作为后端工作流编排的统一入口。
拼图与封面逻辑在文章生成（Canvas）阶段执行：每篇文章默认基于图库原始图片即时生成动态两图拼图（640x853）与浮动文字封面，不复用历史拼图或历史封面。
文件路径: `src/modules/graph`

## 功能描述及关键词

### graph.controller.ts
Graph控制器。
- **关键词**: graph, workflow, orchestration, langgraph, controller

### article-graph.service.ts
文章编排服务。
- **关键词**: articles, canvas, gallery, service
- **函数**:
  - `generateToCanvas`: 建立文章列表(blueprints)+预存根，立即返回 generating，后台并发生成正文+配图/async article canvas with pre-stub list
  - `runArticleGeneration`: 后台异步执行正文+配图生成并回写状态/run article generation in background
  - `planArticleTasks`: LLM规划文章蓝图列表/plan article blueprints
  - `generateArticlesAndImages`: 一次拉取图片池，内容生成与配图解析真正并发，合并回写/parallel content gen + image resolve from shared pool
  - `fetchArticleImagePool`: 按所有蓝图tag一次性拉取regular图片池/fetch article image pool by blueprint tags once
  - `resolveArticleImages`: 从共享池按article tag优先选图+拼图/封面生成，返回配图数据/resolve article images from shared pool with collage cover
  - `generateToCanvasBySubAgent`: 子代理生成并逐篇写入/subagent canvas generation
  - `collectArticleDataBySubAgent`: 子代理采集数据/collect data by subagent
  - `planBlueprintsBySubAgent`: 子代理规划蓝图/plan blueprints by subagent
  - `appendOneArticleToCanvas`: 单篇写入Canvas/append one article
  - `generateOneArticleFromBlueprint`: 单篇文章生成/generate one article
  - `saveGeneratedImageToGallery`: 本地生成图片写入图库/save generated image to gallery
  - `assignImagesForCanvasBySubAgent`: 子代理配图/assign images by subagent
  - `normalizeBlueprints`: 蓝图去机械化/normalize blueprints
  - `buildFallbackBlueprints`: 动态蓝图兜底/build fallback blueprints
  - `evaluateArticleQuality`: 文章质量分层校验/evaluate article quality
  - `polishArticleMarkdown`: 文章自动润色/polish markdown
  - `buildFallbackStandaloneMarkdown`: 独立软文兜底/build standalone fallback markdown

### batch-task-graph.service.ts
批量发布图服务。
- **关键词**: batch-task, publishing, mcp, task-it, todo-summary, service
- 发布封面渲染支持项目内自定义字体：默认读取 `public/fonts/cover-cjk.ttf`，并兼容 `dist/public/fonts/cover-cjk.ttf` 与 `web/public/fonts/cover-cjk.ttf`；也可通过环境变量 `COVER_FONT_PATH` 指定绝对/相对路径。若封面文案包含中文且字体文件不存在，则直接抛错（不再降级为豆腐块或随机回退）。

### graph.module.ts
Graph模块定义。
- **关键词**: module
