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
  - `generateToCanvas`: 生成Canvas示例文章/generate canvas articles
  - `generateToCanvasBySubAgent`: 子代理生成并逐篇写入/subagent canvas generation
  - `collectArticleDataBySubAgent`: 子代理采集数据/collect data by subagent
  - `planBlueprintsBySubAgent`: 子代理规划蓝图/plan blueprints by subagent
  - `appendOneArticleToCanvas`: 单篇写入Canvas/append one article
  - `generateOneArticleFromBlueprint`: 单篇文章生成/generate one article
  - `assignImagesForCanvasBySubAgent`: 子代理配图/assign images by subagent
  - `normalizeBlueprints`: 蓝图去机械化/normalize blueprints
  - `buildFallbackBlueprints`: 动态蓝图兜底/build fallback blueprints
  - `evaluateArticleQuality`: 文章质量分层校验/evaluate article quality
  - `polishArticleMarkdown`: 文章自动润色/polish markdown
  - `buildFallbackStandaloneMarkdown`: 独立软文兜底/build standalone fallback markdown

### batch-task-graph.service.ts
批量发布图服务。
- **关键词**: batch-task, publishing, mcp, task-it, todo-summary, service
- 发布封面渲染采用跨平台策略：`sharp+SVG` 优先，失败时回退 `Jimp`，并对字体加载做容错，避免 Linux 环境因字体常量缺失导致封面生成失败。

### graph.module.ts
Graph模块定义。
- **关键词**: module
