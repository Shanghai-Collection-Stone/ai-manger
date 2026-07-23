# Graph Module

## 模块描述
该模块提供“编排文章 -> 写入Canvas -> 图库向量配图/即时生成拼图与封面”的生成流程，并提供“从Canvas生成批量任务 -> 并行入队 -> 触发MCP运行”的发布流程，作为后端工作流编排的统一入口。
拼图与封面逻辑在文章生成（Canvas）阶段执行：每篇文章默认基于图库原始图片即时生成动态两图拼图（640x853）与浮动文字封面；当租户平台配置开启 AI 封面时，优先走生图模型生成封面并入图库。
文件路径: `src/modules/graph`

## 功能描述及关键词

### graph.controller.ts
Graph控制器。
- **关键词**: graph, workflow, orchestration, langgraph, controller

### article-graph.service.ts
文章编排服务。
- **关键词**: articles, canvas, gallery, service
- **函数**:
  - `generateToCanvas`: imageMode=image-group 时先要求用户显式图库 tags 或指定 imageGroupCanvasIds；指定图组时跳过已 used 的 group 并记录被选中的 source canvas/groupIds，生文回写配图成功后自动标记源图组 partial/used；再规划文章 blueprints 并做创建前源图预检，预检通过后才创建 Canvas、预存根并立即返回 generating，预检不足则不创建空壳 Canvas。透传 `dedup`(false 时经 runArticleGeneration→fetchArticleImagePool 取图不排除 isUsed)/async article canvas with required explicit tags and preflight image-group allocation | keywords: dedup
  - `runArticleGeneration`: 后台异步执行正文+配图生成并回写状态/run article generation in background
  - `normalizeWritingStyle`: 归一化图文写作风格；未显式传入时按平台给出保守默认值/normalize article writing style
  - `buildLangChainInvokeOption(context)` — 组装 tool 内部 LLM 调用配置，附加 `nostream` tag 与空 callbacks，避免继承主 SSE token handler | keywords: 工具内部非流, 图文生成, internal-llm-nostream, invoke-option
  - `sanitizeCopyrightRiskText(raw)` — 将创作文案/生图提示词中的高风险 IP、商标、角色专名替换为版权安全的泛化表达 | keywords: sanitize, copyright-safe, image-prompt
  - `sanitizeCopyrightRiskList(items?)` — 清洗列表型创作提示，去重后返回版权安全表达 | keywords: sanitize, copyright-safe, list
  - `sanitizeBlueprintForCreativePrompt(blueprint)` — 为创作/生图提示词构造版权安全蓝图，保留业务主旨但泛化 IP 专名 | keywords: sanitize, blueprint, copyright-safe
  - `planArticleTasks(input)` — LLM规划文章蓝图列表；蓝图包含 title/mainIdea/imageIntent/requirements，并接收 userPrompt/dataSummary/writingStyle，显式图库标签必须透传到 tags 和 imageIntent；内部 LLM 调用不跟随主流 | keywords: plan, blueprint, explicit-tags
  - `extractExplicitImageTagsFromPrompt(input)` — 从最后用户要求中提取 tag带有/标签/#tag 等显式图库标签，作为 image-group 生文配图硬门槛 | keywords: extract, explicit-tags, image-group
  - `normalizeExplicitImageTag(raw)` — 清洗显式图库标签 token 并过滤连接词 | keywords: normalize, explicit-tags, token
  - `mergeExplicitImageTagsIntoBlueprints(blueprints, explicitTags)` — 将用户显式图库标签合并进每个选题蓝图 | keywords: merge, explicit-tags, blueprint
  - `generateArticlesAndImages(input)` — legacy 模式下并发正文+配图；image-group 模式复用创建前预检的源图分配或指定未使用图组，并发执行正文生成与图组渲染，运行期不足仍停止并要求补图，最后统一合并；指定图组消费完成后调用 CanvasService 标记来源图组已使用 | keywords: generate, image-group, pre-allocation, mark-used
  - `assignImageGroupsToCanvasArticles`: 在同一 Canvas 使用图组同源逻辑合并文章配图，并校验单篇 6-8 张目标/merge image-group results into article fields with per-article image count checks
  - `collectImageGroupsFromCanvases(input)` — 从指定 image-group Canvas 收集尚未 used 的 group，按输入顺序返回 group 与 source canvasId | keywords: 未使用图组, collect-image-group-source
  - `summarizeImageGroupUsageSources(items)` — 汇总被选中的 source canvas/groupIds，供生文消费完成后标记 partial/used | keywords: 图组已使用, source-summary
  - `fetchArticleImagePool`: 按所有蓝图tag一次性拉取regular图片池；`dedup===false` 时 searchByTags 传 includeUsed 命中已用图(不去重生成)/fetch article image pool by blueprint tags once | keywords: dedup, includeUsed
  - `resolveArticleImages`: 从共享池按article tag优先选图+拼图/封面生成，返回配图数据/resolve article images from shared pool with collage cover（**拼图必须使用横图 isPortrait !== true，且过滤默认动态封面/动态拼图分组**）
  - `isAiCoverEnabled`: 读取租户 AI 封面开关/resolve ai cover toggle
  - `buildAiCoverImagePrompt`: 根据文章类型与封面文案推演实景照片优先的生图提示词，并强制注入封面主/副标题浮动文字约束/build ai cover image prompt
  - `tryGenerateAiCoverImage`: 调用封面生图工具生成封面并入图库（透传prompt与底图候选，meitu兜底走image-edit）/try generate ai cover image
  - `generateToCanvasBySubAgent`: 子代理生成并逐篇写入/subagent canvas generation
  - `collectArticleDataBySubAgent`: 子代理采集数据/collect data by subagent
  - `planBlueprintsBySubAgent`: 子代理规划蓝图/plan blueprints by subagent
  - `appendOneArticleToCanvas`: 单篇写入Canvas/append one article
  - `generateOneArticleFromBlueprint`: 单篇文章生成（融合 userPrompt + dataSummary）/generate one article
  - `generateOneArticle(input)` — 根据单篇蓝图生成正文，并透传平台文风、主旨和配图意图；内部 LLM 调用不跟随主流 | keywords: generate, article, writing-style
  - `saveGeneratedImageToGallery`: 本地生成图片写入图库（cover/collage 均标记 isCollage=true，自动写入动态封面/动态拼图默认分组，并持久化 width/height）/save generated image to gallery
  - `assignImagesForCanvasBySubAgent`: 子代理配图/assign images by subagent
  - `normalizeBlueprints`: 蓝图去机械化/normalize blueprints
  - `buildFallbackBlueprints`: 动态蓝图兜底/build fallback blueprints
  - `evaluateArticleQuality`: 文章质量分层校验/evaluate article quality
  - `polishArticleMarkdown`: 文章自动润色/polish markdown
  - `buildFallbackStandaloneMarkdown`: 独立软文兜底/build standalone fallback markdown
  - `createDynamicCollageFile`: 生成双图动态拼图（640x853，上下拼图，横图等比缩放，不裁切）/create dynamic collage file
  - `pickMostDiversePair`: 在候选图中挑选差异度最高的一组拼图对（来源图必须为横图）/pick best diverse collage pair

### batch-task-graph.service.ts
批量发布图服务。
- **关键词**: batch-task, publishing, mcp, task-it, todo-summary, service
- 发布封面渲染支持项目内自定义字体：默认读取 `public/fonts/cover-cjk.ttf`，并兼容 `dist/public/fonts/cover-cjk.ttf` 与 `web/public/fonts/cover-cjk.ttf`；也可通过环境变量 `COVER_FONT_PATH` 指定绝对/相对路径。若封面文案包含中文且字体文件不存在，则直接抛错（不再降级为豆腐块或随机回退）。
- **拼图来源过滤**：动态拼图（发文/内容拼图）必须使用横图（isPortrait !== true），不允许竖图参与。

### graph.module.ts
Graph模块定义。
- **关键词**: module
