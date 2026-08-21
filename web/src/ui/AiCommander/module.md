# AiCommander 模块

前端 AI 指挥台页面模块，包含多个子视图。

## 文件清单

### design-editor/DesignEditorView.jsx

在线设计编辑器视图，使用左侧模板/图片/文字工具栏、中间可拖拽画布与右侧图层面板，支持中心基线吸附、图层排序与 PNG 导出；从文章进入时按图片生成无模板原图画板，封面主副标题按独立文字图层加载，模板仅在用户主动选择后应用。

- **关键词**: design-editor, layer-management, baseline-snap, export-image
- **函数**:
  - `DesignEditorView(props)` — 渲染在线设计编辑器，并将文章图片初始化为无模板画板及可编辑封面文字图层 | keywords: design-editor, layer-management
  - `handleSelectTemplate(template)` — 应用选定模板 | keywords: select-template
  - `handleSelectImage(image)` — 从素材列表选择图片 | keywords: image-picker
  - `handlePointerMove(event)` — 拖拽图层并执行中心与相邻图层吸附 | keywords: baseline-snap, neighbour-snap
  - `handleEditorKeyDown(event)` — 用方向键微调选中图层 | keywords: keyboard-nudge
  - `handleExport()` — 导出画布为 PNG | keywords: export-image

### AiCommanderBento.jsx

AI 指挥官 Bento 风格主界面组件。负责底部主导航、顶部控制台、工具内部页全屏状态和各主 Tab 的常驻渲染；常规主 Tab 的底部安全区与固定底部导航高度对齐，避免工具页底部出现过大留白；当工具页进入内部视图时隐藏顶部控制台与底部导航，并取消底部安全区占位。

**代码分割**: 除首屏 `DashboardView` 外，决策 / 对话 / 任务 / 工具 / Canvas 五个主 Tab 视图都通过 `lazyTabView` 走 `React.lazy` + `Suspense`，切到该 Tab 才下载对应 chunk，首屏包由 468 KB 降到 50 KB。

- **关键词**: ai-commander-bento, full-screen-tools, lazy-import, code-splitting
- **函数**:
  - `lazyTabView(loader)` — 主 Tab 视图懒加载包装器，切到该 Tab 才下载 chunk | keywords: lazy-import, code-splitting
  - `AiCommanderBento()` — 渲染 AI 指挥官主壳并控制工具内部页全屏导航隐藏 | keywords: ai-commander-bento, full-screen-tools
  - `normalizeCommanderTabParam(value)` — 归一化 AI 指挥官主导航 URL 参数 | keywords: url-route, main-tab
  - `normalizeCommanderPopupParam(value)` — 归一化顶部控制台弹窗 URL 参数 | keywords: url-route, commander-popup
  - `readCommanderRouteParams()` — 读取 URL 参数并推导主导航、弹窗、Canvas/决策焦点 | keywords: url-route, commander-state
  - `updateCommanderSearchParams(patch, options?)` — 同步底部菜单和顶部弹窗状态到 URL 查询参数 | keywords: url-route, query-sync
  - `selectMainTab(nextTab)` — 切换底部主 Tab 并写入 URL 参数 | keywords: url-route, main-tab
  - `openHeaderPopup(popup)` — 打开顶部控制台弹窗并写入 URL 参数 | keywords: url-route, commander-popup
  - `handleChatDrawerToggle(open)` — 切换历史会话抽屉并同步 URL 弹窗参数 | keywords: url-route, commander-popup
  - `selectTimeRange(nextRange)` — 选择看板时间维度并同步 URL 参数 | keywords: url-route, time-range
  - `applyCommanderRouteParams()` — 将 URL 参数应用到主导航、顶部弹窗和焦点目标 | keywords: url-route, commander-state

### ChatBIView.jsx

AI 对话交互主视图。支持 canvas-it、task-it、decision-it、**tag-select-it**、**handoff-it** 内联卡片（含异步轮询/详情 Modal/选标签弹窗/supervisor 路由切换胶囊）。底部输入区在 flex 流内占位，textarea 变高时消息列表自动让出高度，避免最后一段上下文被遮挡。`handleSend(overrideText?)` 接受可选参数,卡片回写时直接调用以用户消息形式发送 tags("我选定标签：#A #B（去重/不去重…）",附带去重偏好供 AI 解析)。

- **关键词**: chat, ai, bi, commander, stream, canvas-it, task-it, tag-select-it, handoff-it, supervisor, quick-message
- **函数**:
  - `extractAllCanvasItBlocks` / `extractAllTaskItBlocks` / `extractAllTagSelectBlocks` / `extractAllHandoffBlocks`: 从消息文本提取对应 fence JSON 块
  - `TagSelectCard`: tag 选择卡片(琥珀色徽章),展示标题/提示/推荐 chips 预览,内置**去重开关**(默认去重=每张图只用一次;关=不去重允许重复取图),点击触发 `TagSelectModal` 弹窗;确认后显示已选 chips + 去重模式状态,回写消息附带"（去重/不去重…）"供 AI 解析为 dedup 参数 | keywords: dedup, tag-select
  - `TagSelectModal`: 顶部搜索框 + 已选 chips + 内容区(无输入显示推荐计数 chips,有输入显示联想下拉),底部确认按钮校验 minTags/maxTags;`chatService.listGalleryTags` 拉全量 tags 用于联想
  - `HandoffCard`: 🆕 意图识别 → expert 路由胶囊。展示`→ 已切换至 {专家名} + reason 副标题`,6 个专家映射颜色(image/violet, article/sky, data/emerald, frontend/indigo, publisher/amber, task/rose)+ 图标；若后端 handoff-it 传入 `expertLabel/icon`,优先使用自定义展示名与图标（用于小红书专属专家）。后端意图识别路由到业务专家时通过 earlyEmit 推送 `\`\`\`handoff-it\`\`\`` fence 到主 SSE,前端即时渲染让用户感知到路由切换
  - `AIMessage`: 多卡片渲染,strip 四种 fence 后走 markdown;新增 `onSubmitQuickMessage(text)` prop 用于卡片向 AI 回写用户消息
  - `handleSend(overrideText?)`: 支持 override 参数,无 override 时取 inputValue;TagSelectCard 通过该回调把所选 tags 拼成自然语言消息发回 AI

### XhsWorkspaceShell.jsx

小红书内容创作助手的固定页面外壳。统一承载顶部标题、返回入口、选题/发文/数据导航及左下团队与设置入口，业务 Tab 切换时只替换右侧内容槽，避免重复渲染两套导航产生跳页感。

- **关键词**: fixed-workspace-shell, unified-sidebar, content-switching
- **函数**:
  - `XhsWorkspaceShell(props)` — 为选题、发文和数据工作区提供固定不切换的顶部标题与左侧导航外壳 | keywords: 固定工作区外壳, 统一侧边导航, 内容区域切换, fixed-workspace-shell, unified-sidebar, content-switching

### XhsSpecialistView.jsx

小红书专家页面。固定复用 `XhsWorkspaceShell` 的顶部标题与左侧导航，只在选题、发文、数据切换时替换右侧业务内容。默认入口从 MongoDB 接口加载当前用户的母题/子题及已生成文章，移除演示数据；选题页采用紧凑母题列、可搜索子题列和自适应创作区，双列表固定占满可用高度并各自支持内部滚动与分页。生成弹窗左侧填写提示词并调用 Todo 驱动的 AI 选题接口，右侧以普通文字列表多选带题目类型的候选，确认后才批量写入数据库。文章未生成时右侧预览与图库保持遮罩锁定；点击“生成文章”后，后端 Agent 只通过工具调整内存标题、正文和标签，完整落库后才自动解锁。关闭选题弹窗不会清除提示词、候选或勾选状态。

页面不再内置标题、正文、标签、图片或账号名模拟内容。帖子预览只使用数据库文章；真实图库选图、上传图片、标题与正文失焦编辑、标签增删和发布形式切换都会写回文章数据。
选题数据尚未加载、未选择子选题或子选题没有文章时，正文操作区使用空态守卫，不会在遮罩显示前读取不存在的选题标识。
文章生成采用后台 Todo 异步执行，不同子选题可同时运行；前端按子选题轮询状态，只禁用正在生成的那一条。失败时接口返回的 `code` 与中文 `message` 会显示在对应子选题条目下方的可关闭红色提示中，重生成请求若启动失败也会在弹层展示同一条原因（例如所选图库标签下源图不足）。

- **关键词**: xhs, specialist, subagent, task, xiaohongshu, chart, intent-routing, topic-workspace, post-preview, dual-list, inspiration-canvas, topic-generation, text-candidate-list, mother-topic-generation, multi-select, gallery-picker, article-editor, surface-failure-reason
- **函数**:
  - `XhsSpecialistView(props)` — 在固定公共外壳中组织真实选题、文章库发文与数据工作台三个业务内容区 | keywords: 小红书专家, 选题发文, 数据工作台, xhs-specialist, topic-publishing, data-workspace
  - `TopicCandidateDialog(props)` — 渲染可切换蓝色/玫红主题、支持 AI 推荐提示词的左侧输入与右侧候选多选列表 | keywords: AI选题弹层, 多项选择, 文字候选列表, ai-topic-dialog, multi-select, text-candidate-list
  - `ArticleRegenerateDialog(props)` — 输入当前文章的局部修改或完全重写要求，并提交给具备读取工具的 Agent | keywords: 文章重新生成弹层, 读取当前文章, article-regenerate-dialog, read-current-article
  - `readGeneratedTopicCandidates(response)` — 从接口结果或 Todo taskResult 读取题目与题目类型 | keywords: 读取选题结果, 题目类型, read-topic-result, topic-type
  - `resizeArticleBodyTextarea(element)` — 按正文实际高度自动撑开输入框并移除内部滚动 | keywords: 正文自动撑高, 平铺内容, auto-grow-article-body, flat-content
  - `loadTasks`: 加载任务列表（主视图 category=xhs / 子代理按 assignee）
  - `handleTaskClick`: 打开任务详情
  - `handleCloseDetail`: 关闭详情页
  - `renderDetailInfo`: 任务信息 Tab
  - `renderDetailTimeline`: 执行节点时间轴 Tab
  - `renderTaskDetail`: 详情全屏页面入口
  - `toggleCandidateSelection(setSelected, value)` — 切换 AI 选题弹层中纯文字候选题目的多选状态 | keywords: topic-candidates, multi-select
  - `applyTopicWorkspace(groups)` — 应用真实母子选题列表并尽量保持当前选择 | keywords: 应用真实选题, 保持选择, apply-persisted-topics, preserve-selection
  - `loadTopicWorkspace()` — 从数据库接口加载当前用户选题工作台 | keywords: 加载真实选题, 数据库列表, load-persisted-topics, database-list
  - `applyArticleGenerationStates(generations)` — 合并逐条文章生成状态并识别刚完成的后台任务 | keywords: 合并文章生成状态, 识别生成完成, merge-article-generation-state, detect-generation-completion
  - `syncArticleGenerationStates(refreshWorkspaceOnCompletion?)` — 轮询每条子选题的生成状态并在完成后刷新文章 | keywords: 轮询文章生成状态, 完成后刷新文章, poll-article-generation-state, refresh-completed-article
  - `dismissArticleGenerationError(topicId)` — 只关闭对应子选题的生成错误并保留其他并发任务 | keywords: 关闭单条生成错误, 保留并发任务, dismiss-topic-generation-error, preserve-concurrent-tasks
  - `handleGenerateChildTopicCandidates(parentTopic)` — 调用 Todo 选题接口生成子选题候选 | keywords: 生成子选题, 待办候选, generate-child-topics, todo-candidates
  - `handleRecommendChildTopicPrompt(parentTopic)` — 根据当前母题请求并填入一条可编辑的 AI 推荐提示词 | keywords: 子选题提示词推荐, 母题上下文, child-topic-prompt-recommendation, parent-topic-context
  - `openChildTopicGenerator(parentId)` — 同一母题保留候选，切换母题时隔离草稿并请求新推荐提示词 | keywords: 保留子题弹窗, 母题隔离, 子选题提示词推荐, preserve-child-dialog, parent-isolation, child-topic-prompt-recommendation
  - `handleGenerateMotherTopicCandidates()` — 调用 Todo 选题接口生成母选题候选 | keywords: 生成母选题, 待办候选, generate-mother-topics, todo-candidates
  - `handleSaveMotherTopicCandidates()` — 批量保存弹窗选中的母选题 | keywords: 保存母选题, 批量入库, save-mother-topics, bulk-persistence
  - `handleSaveChildTopicCandidates(parentId)` — 批量保存当前母题下选中的子选题 | keywords: 保存子选题, 父题关联, save-child-topics, parent-relation
  - `handleDeleteSelectedMotherTopics()` — 删除勾选母题并由服务端级联子题 | keywords: 删除母选题, 级联子题, delete-mother-topics, cascade-children
  - `handleGenerateArticleForTopic(topicId, prompt?)` — 异步启动对应子选题的文章任务，并把启动状态或错误写入该选题状态桶 | keywords: 异步生成真实文章, 并发生成, 单条失败原因, start-persisted-article, concurrent-generation, per-topic-failure
  - `openArticleRegenerator(topicId?)` — 打开绑定目标文章的重新生成提示词弹层 | keywords: 打开文章重生成, 文章提示词, open-article-regenerator, article-rewrite-prompt
  - `handleRegenerateCurrentArticle()` — 提交修改提示词并要求 Agent 读取当前文章后执行 | keywords: 提交文章重生成, 读取当前文章, submit-article-regeneration, read-current-article
  - `persistCurrentArticle(patch)` — 将当前文章编辑补丁写回数据库 | keywords: 保存真实文章, 数据库编辑, persist-article-edit, database-update
  - `handleSelectArticleImage(sourceUrl)` — 选择真实图库图片并保存文章图组，整张换掉拼图时同步清掉该槽位的拼图画布格式 | keywords: 选择真实配图, 保存文章图组, 拼图画布格式, select-persisted-image, save-article-images, collage-canvas-format
  - `handleSelectPreviewContentType(contentType)` — 切换文章发布形式并持久化 | keywords: 更新发布形式, 保存真实文章, update-content-type, persist-article-edit
  - `handleRemoveArticleTag(tag)` — 删除文章真实标签并持久化 | keywords: 删除真实标签, 保存文章标签, remove-persisted-tag, save-article-tags
  - `handleArticleTagKeyDown(event)` — 回车添加真实标签并持久化 | keywords: 添加真实标签, 保存文章标签, add-persisted-tag, save-article-tags
  - `renderTopicWorkspace()` — 渲染紧凑母题/子题双列表、可搜索子题、三项创作引导空态、带封面图层预览的可编辑帖子、图库选择与灵感画布入口 | keywords: 选题工作台, 帖子预览, 双列表, 灵感画布, 选题生成, 文字候选列表, 母选题生成, 多选, 图库选择, 文章编辑, topic-workspace, post-preview, dual-list, inspiration-canvas, topic-generation, text-candidate-list, mother-topic-generation, multi-select, gallery-picker, article-editor
  - `visibleArticleGalleryTags` — 按搜索词过滤图库标签并截断成可见胶囊列表 | keywords: gallery-picker, image-tag-filter, tag-search
  - `loadMoreArticleGallery()` — 以列表末尾图片 id 作游标追加下一页图库图片并按 id 去重 | keywords: gallery-picker, infinite-scroll, cursor-pagination
  - `handleArticleGalleryScroll(event)` — 图库列表滚到底部附近时预取下一页 | keywords: gallery-picker, infinite-scroll

未选择子选题或所选子选题尚无数据库文章时，帖子详情与图库区域保持遮罩锁定。只有 Agent 完成内存文章并成功落库后才解除遮罩；生成失败不会伪造 `generated` 状态。

图库在宽屏下为独立右栏，并使用单列 4:5 大图卡片滚动展示，避免选图缩略图过度拥挤；中部子选题列相应收窄，为编辑与图库预留空间。

选题页采用参考稿的四区层级：固定导航栏展示选题/发文/数据及团队入口；母题栏使用固定紧凑宽度；子题栏使用剩余中栏宽度；右侧编辑与图库共同组成自适应创作区。未选子题、文章生成中或尚未生成文章时，创作区使用大面积白色毛玻璃引导层，并以白色实底卡片展示快速预览、开始创作、效果预测三项能力提示。

子选题栏采用紧凑纵向布局：栏头把实时搜索框放在“子选题”标题右侧，并把“再来一组 / 重新生成选题”放在标题下方；搜索同时匹配题目与类型，切换母题时清空查询。列表项使用较小标题与类型标签，文章状态及“生成文章 / 重新生成”操作统一落在选题正文下方，避免窄栏内横向挤压和碎片化换行。

子选题生成弹层使用与小红书工作台一致的玫红主题。切换母题首次打开时，前端调用 `recommendXhsChildTopicPrompt` 让 AI 根据母题推荐一条可编辑提示词；用户也可点击“换一条 AI 推荐”，调整提示词后再生成候选。

正文内容标题右上角和已生成文章的列表操作都提供“重新生成”入口。弹层接收局部修改或完全重写提示词；后端 Agent 必须先调用 `xhs_article_read_current` 读取当前文章，再写入修改结果，现有配图和画板默认保留。

图库默认以 `imageType=all` 加载普通图片和已生成拼图，拼图卡片显示“拼图”标识；卡片预览优先使用缩略图，选择后写入文章图组的仍是原图地址。

图库选择栏头部带**类型档位切换**（`GALLERY_TYPE_TABS`：全部 / 普通图 / 拼图），直接对应后端 `imageType`，切换即回到第一页重拉。**「普通图」不只是排掉拼图**：后端 `buildImageTypeFilter('regular')` 同时排掉 `isCollage=true` 和全部封面标签（`COVER_TAGS` = 封面/拼图封面/自动封面/canvas封面），所以这一档等于「只看自己上传的照片」，系统生成的封面也一并不显示。默认仍是「全部」，不改变原有行为。

图库选择栏头部带**标签快速筛选**：搜索框即时过滤已拉到的标签（`visibleArticleGalleryTags`，最多铺 `GALLERY_TAG_CHIP_LIMIT`(60) 个胶囊，避免标签成百上千时全渲染），点胶囊按标签重新拉图、再点一次取消，「全部」回到不筛；没搜索词时当前选中标签会被顶到列表最前，保证它不被截断挤掉。标签本身由 `chatService.listGalleryTags({ limit: 2000 })` 在挂载时拉一次。**这条是为了让普通图片翻得到**：图库里生成出来的拼图/封面图会按时间挤在最前，原本只拉 36 张且无从筛选时，用户自己上传的普通照片实际上被埋在列表之外。空态文案也区分「该标签下没有图」和「图库整个是空的」，前者给一个「查看全部图片」的出口而不是引导上传。

图片列表是**上拉加载**而不是一次性拉一个大 `limit`：后端 `GET /gallery` 是游标分页（`id: { $lt: cursorId }` + `sort({ id: -1 })`，单页上限 200），前端每页取 `GALLERY_PAGE_SIZE`(40)，`handleArticleGalleryScroll` 在距底 `GALLERY_SCROLL_THRESHOLD`(240px) 内触发 `loadMoreArticleGallery`，以**列表末尾图片的 `id`** 作游标向后取，返回不足一页即 `hasMore=false`。追加时按 `id` 去重，因为上传成功会把新图 unshift 进列表、和分页结果可能重合。切标签走首页 effect 重置列表与 `hasMore`。底部常驻一条状态行：加载中转圈、还有更多给「加载更多」按钮兜底（滚动没触发时可手点）、到底显示「没有更多了」。**滚动容器和 grid 是两层**：`grid-auto-rows: 220px` 会把底部状态行也撑成 220px 高，所以外层只负责 `overflow-y-auto` 和滚动监听，内层才是 grid，状态行作为 grid 的兄弟节点。

中间双列表可随可用空间收缩，避免整页横向溢出；图库栏采用标准双列网格，使用显式最小行高放大预览并避免上下图片堆叠，同时在右栏内独立纵向滚动。

帖子编辑与图库选择栏仅允许纵向滚动，并显式隐藏横向溢出，避免宽屏双列图库产生横向滚动条。

帖子预览卡片的宽度由预览栏宽度推导（`w-[calc(100%-24px)]`）而不再写死像素，左右各留 12px 间距，杜绝卡片比预览栏更宽时右边缘和滚动条被 `overflow-hidden` 裁掉；预览卡片同时带 `min-h-0`，内容超高时在卡片内部纵向滚动，而不是溢出预览栏底部被裁掉标签行与发布信息。

文章主图区域采用与生文图组一致的 3:4 竖版比例，并使用 `object-contain` 完整显示图片高度，不再按横向容器裁掉图片上下内容。

正文输入框根据真实正文高度自动撑开，内容完整平铺展示，不出现正文输入框自身的纵向滚动条。

### XhsPublishingView.jsx

小红书发文工作台内容区，不再重复渲染顶部标题与左侧导航，由 `XhsWorkspaceShell` 提供固定页面外壳。左栏把真实母选题映射为母题文章库，并列出用户新建的自定义库；中栏按“未保存 / 已保存 / 已发布”组织真实子选题文章，支持选择、批量入库、删除与分页；右栏复用文章库扫码取文二维码，展示未保存、已保存、已发布统计和最近发布时间。母题库只在首次保存文章时按需创建真实文章库，浏览页面不会产生空库；文章入库通过 `meta.xhsTopicId` 保留来源子选题关联，避免同一选题重复保存。

- **关键词**: xhs-publishing-workspace, article-library, mother-library, custom-library, qr-publishing, publish-status
- **函数**:
  - `formatPublishTime(value)` — 将日期格式化为发文工作台使用的年月日时分文本 | keywords: 格式化发文时间, 日期展示, format-publish-time, date-display
  - `readSourceTopicId(article)` — 从库内文章元数据读取来源子选题 ID 供去重 | keywords: 读取来源子选题, 文章去重, read-source-topic, deduplicate-library-article
  - `buildTopicArticlePayload(topic)` — 将真实子选题文章转换为保留选题关联的入库载荷 | keywords: 构造文章入库载荷, 保留选题关联, build-library-article, preserve-topic-binding
  - `XhsPublishingView(props)` — 渲染公共固定外壳右侧、连接真实母子选题、文章库、二维码与发布状态的三栏发文内容区 | keywords: 小红书发文工作台, 文章库入库, 扫码发布, xhs-publishing-workspace, store-topic-articles, qr-publishing
  - `loadLibraries()` — 加载发文页可见文章库并映射母题库 | keywords: 加载发文文章库, 母题库映射, load-publishing-libraries, map-mother-libraries
  - `loadLibraryContent(libraryId)` — 加载文章库详情、全部文章和扫码二维码 | keywords: 加载文章库发文详情, 加载扫码二维码, load-library-publishing-detail, load-publish-qr
  - `toggleRow(rowKey)` — 切换发文列表单行选择 | keywords: 切换发文行选择, 批量选择, toggle-publish-row, batch-selection
  - `toggleCurrentPage()` — 切换当前页全部发文条目的选择状态 | keywords: 全选当前发文页, 批量选择, select-publish-page, batch-selection
  - `ensureActiveLibrary()` — 按需创建母题发文库并返回真实文章库 ID | keywords: 按需创建发文库, 获取真实文章库, ensure-publishing-library, resolve-library-id
  - `saveSelectedTopics()` — 将勾选的真实子选题文章批量保存到当前文章库 | keywords: 保存选题到文章库, 批量文章入库, save-topics-to-library, bulk-store-articles
  - `deleteSelectedArticles()` — 批量删除当前文章库中勾选的文章并刷新 | keywords: 批量删除库内文章, 刷新文章库, delete-library-articles, refresh-library-content
  - `deleteArticleRow(articleId)` — 删除单篇库内文章并刷新统计 | keywords: 删除单篇库内文章, 刷新文章库, delete-library-article, refresh-library-content
  - `createCustomLibrary()` — 新建小红书自定义文章库并切换到新库 | keywords: 新建自定义文章库, 切换新文章库, create-custom-library, select-created-library
  - `refreshCurrentLibrary()` — 刷新当前库文章、二维码与统计 | keywords: 刷新发文文章库, 刷新二维码统计, refresh-publishing-library, refresh-qr-stats
  - `renameActiveLibrary()` — 重命名当前发文库，虚拟母题库会先按需持久化 | keywords: 重命名发文文章库, 按需持久化母题库, rename-publishing-library, persist-mother-library

### XhsDataTab.jsx

小红书数据 Tab 组件，在任务详情中展示 xhs_post_stats。

- **关键词**: xhs, data, tab, chart, table, post-stats, trend
- **函数**:
  - `BarChartSVG`: 最近N条数据柱状对比图（纯SVG）
  - `TrendChartSVG`: 按 postHash 聚合的文章趋势折线图（纯SVG）

### DouyinSpecialistView.jsx

抖音专家模拟页面。仿照小红书专家工具页的右侧工作区，提供模拟聊天记录、生成视频草稿和抖音数据三个 Tab，用于演示抖音短视频运营、本地生活转化和内容表现复盘。

- **关键词**: douyin-specialist, mock-chat, mock-video, douyin-data, metric-card
- **函数**:
  - `getMetricTone(tone)` — 读取抖音数据卡片的 Tailwind 色彩类 | keywords: douyin-specialist, metric-card
  - `MetricCard(metric)` — 渲染抖音数据指标卡片 | keywords: douyin-specialist, metric-card
  - `ChatBubble(message)` — 渲染抖音专家模拟聊天气泡 | keywords: douyin-specialist, mock-chat
  - `VideoCard(video)` — 渲染抖音模拟生成视频卡片 | keywords: douyin-specialist, mock-video
  - `DouyinSpecialistView(onBack?)` — 抖音专家页面入口，切换模拟聊天、生成视频和抖音数据 Tab | keywords: douyin-specialist, mock-chat, mock-video, douyin-data

### TaskDetailPage.jsx

通用任务详情页面。

- **关键词**: task, detail, page, timeline, info

### ToolsView.jsx

工具入口页。包含 AI 图库(GalleryView)、思维链路、Canvas管理、小红书专家、抖音专家、文章库、精选文章入口。Canvas管理支持类型过滤(图文/图组)、标签筛选、无限滚动分页、缩略图卡片展示，点击打开 CanvasFeedView(图文) 或 ImageGroupCanvasView(图组) 内部覆盖层。GalleryView 顶栏提供"ZIP 导入"按钮,打开 [GalleryZipImportPanel](GalleryZipImportPanel.jsx) 右侧抽屉,任务完成后自动 reload 图库 / 分组 / 标签。GalleryView Header 采用**双行布局**(让操作元素呼吸开): 第一行=返回+4 tabs+(右)上传主按钮 / batch 模式右侧显示"已选 N/M"; 第二行=标签筛选+上传标签输入(flex-1 自适应宽度)+批量选择+ZIP 导入按钮, batch 模式下整行替换为 全选/批量改标签(N)/退出。第二行 flex-wrap 容许窄屏自动换行,杜绝硬塞一行导致按钮被裁剪。图库上拉分页使用同步请求锁与哨兵离开后再武装策略,保证一次上拉只触发一次追加请求。

**代码分割**: 11 个子视图(思维链路 / 小红书 / 抖音 / Canvas / 图组 / ChatBI / 文章库 / 精选文章 / 防检测 / 设计编辑器 / ZIP 导入面板)全部通过 `lazyView` 走 `React.lazy` + `Suspense`，调用处写法不变，进入子视图时才下载对应 chunk。

- **关键词**: tools, gallery, canvas, image-group, infinite-scroll, type-filter, tag-filter, thumbnail, xhs-specialist, douyin-specialist, article-library, featured-article, zip-import, responsive, icon-collapse, lazy-import, code-splitting
- **函数**:
  - `lazyView(loader)` — 子视图懒加载包装器，自带 Suspense 加载态 | keywords: lazy-import, code-splitting
  - `GalleryView(onBack)` — 图库管理视图（含对话/图库/拼图/封面 Tab、ZIP 批量导入抽屉入口、上拉分页单次触发锁） | keywords: gallery, gallery-view, infinite-scroll
  - `normalizeToolViewParam(value)` — 归一化效能工具视图 URL 参数 | keywords: url-route, tool-view
  - `normalizeGalleryTabParam(value)` — 归一化图库内部 Tab URL 参数 | keywords: url-route, gallery-tab
  - `normalizeToolPopupParam(value)` — 归一化工具弹层 URL 参数 | keywords: url-route, tool-popup
  - `readToolsRouteParams()` — 读取工具页 URL 参数并推导工具视图、内部 Tab 和弹层 | keywords: url-route, tool-state
  - `updateToolsSearchParams(patch, options?)` — 同步工具卡片、内部 Tab 和弹层状态到 URL 查询参数 | keywords: url-route, query-sync
  - `selectGalleryTab(nextTab)` — 切换图库内部 Tab 并同步 URL 参数 | keywords: url-route, gallery-tab
  - `openGalleryPopup(popup)` — 打开图库工具弹层并同步 URL 参数 | keywords: url-route, tool-popup
  - `closeGalleryPopup(popup)` — 关闭图库工具弹层并清理 URL 参数 | keywords: url-route, tool-popup
  - `loadImages({ append?, imageType? })` — 加载图库图片并用同步锁保证单次上拉只触发一次追加请求 | keywords: gallery, infinite-scroll, pagination
  - `TagFilterDropdown`: 标签筛选下拉（窄屏 w-20 / 宽屏 w-28 自适应）
  - `ToolsView(onThoughtRouteChange?)` — 工具首页，子视图切换（list/gallery/thought/canvas/xhs-specialist/douyin-specialist/article-library/featured-article） | keywords: tools-view, tools, gallery, canvas, xhs-specialist, douyin-specialist, featured-article
  - `handleToolRoutePatch(patch)` — 合并更新工具页 URL 参数并刷新本地路由快照 | keywords: url-route, query-sync
  - `applyToolsRouteParams()` — 将 URL 参数应用到效能工具入口、内部 Tab 和弹层 | keywords: url-route, tool-state
  - `selectToolView(nextView)` — 切换效能工具卡片并同步 URL 参数 | keywords: url-route, tool-view
  - `loadCanvases`: 加载 Canvas 列表，支持追加分页（append=true）、类型/标签过滤
  - `onBatchDelete`: 批量删除已选图库图片(window.confirm 二次确认 → `api.batchDeleteGalleryImages` → 刷新图库/标签),与"批量改标签"同处 batch 工具条 | keywords: gallery, batch-delete
  - `api.uploadGalleryZip(file, body, onProgress?)` — 使用 XHR 上传 ZIP 并按真实字节进度回调，服务端接收后进入后台队列 | keywords: ZIP上传, 上传速度, zip-upload, upload-speed
- **api 对象新增 ZIP 导入方法**: `uploadGalleryZip`、`listGalleryZipImports`、`cancelGalleryZipImport`、`deleteGalleryZipImport`(对接 `/gallery/zip-import/*` 后端)
- **api 对象新增批量删除方法**: `batchDeleteGalleryImages({ userId, ids })`(对接 `POST /gallery/images/batch-delete`) | keywords: gallery, batch-delete

### CanvasFeedView.jsx

图文类型 Canvas 详情视图。展示文章列表与文章详情（含图片轮播和 ImageLightbox 点击放大）；头部提供"整份存入文章库"按钮，单篇详情提供"存入文章库"按钮，弹出 LibraryPickerDialog 选择目标库或新建。文章封面和详情轮播内页共用图片槽位重生成弹窗，可基于图库多选 + 提示词重新生成目标图片槽位，也可直接把已选图库图片设为当前封面/内页。

- **关键词**: canvas, article, feed, image, detail, store-into-library, cover-regenerate, cover-select, article-image-regenerate, image-slot-regenerate, article-image-select, image-slot-select, image-lightbox, canvas-download, copy-text
- **函数**:
  - `copyText(text, label?)`: 复制文本到剪贴板(navigator.clipboard 优先,失败回退 execCommand),用于复制标题/正文 | keywords: copy-text
  - `downloadImageUrl(url, filename)`: 下载单个图片地址(fetch→blob→a.download,失败回退直接链接) | keywords: canvas-download, download-image
  - `downloadArticleImages(article)`: 逐张下载当前文章全部配图(封面 cover/内页 inner 顺序命名) | keywords: canvas-download, download-article-images
  - `ImageLightbox`: 图文 Canvas 图片放大预览弹窗，支持左右切换和缩略图定位
  - `openArticleImageLightbox`: 打开当前文章图片放大预览
  - `toLibraryPayload`: canvas 文章 → 文章库入库 payload
  - `handleStoreInto`: 执行入库（整份 / 单篇）
  - `openArticleImageRegenerateDialog`: 打开文章指定图片槽位重生成弹窗，imageIndex=0 为封面、1+ 为内页
  - `handleRegenerateArticleImage`: 调用文章指定图片槽位重生成接口，成功响应时 Canvas 已进入 generating
  - `handleSelectArticleImage`: 直接将弹窗中第一张已选图库图片替换到当前文章指定图片槽位
  - `handleCanvasTouchStart` / `handleCanvasTouchMove` / `handleCanvasTouchEnd`: 阻断 Canvas 详情层横向手势冒泡，避免图片滑动误触发外层切换
  - `LibraryPickerDialog`: 文章库选择器弹窗（支持即时新建）

### CoverRegenerateDialog.jsx

Canvas 图片槽位重生成弹窗。进入后拉取图库图片和图库标签，支持按 tag 筛选图片、最多 4 张参考图与多行本次提示词；封面与内页共用同一组件，可把多张图片 ID 合并成一次重生成请求，也可把第一张已选图直接设为目标图片槽位。含"使用系统自带提示词"勾选(默认勾选)：勾选时后端按目标类型补封面/内页规格；取消勾选则只用本次提示词且提示词必填，置 `includeSystemPrompt` 随 payload 提交。

- **关键词**: cover-regenerate, cover-select, image-slot-regenerate, selected-source-images, tag-filter, cover-only-submit, system-prompt-toggle
- **函数**:
  - `readGalleryImageUrl`: 读取图库图片缩略图或原图地址
  - `normalizeGalleryImages`: 规整图库列表并过滤无效图片
  - `normalizeGalleryTags`: 规整图库标签列表，兼容字符串和带 count 的对象结构
  - `CoverRegenerateDialog`: 图片槽位重生成弹窗组件，封面和内页都使用本次提示词并最多选择 4 张参考图；含"使用系统自带提示词"开关(默认开)，关闭时提示词必填并提交 includeSystemPrompt
  - `loadImages`: 拉取可作为参考图的图库图片
  - `loadTags`: 拉取图库标签用于封面图片筛选
  - `toggleImage`: 切换参考图选中状态，最多保留 4 张参考图
  - `handleDialogTouchStart` / `handleDialogTouchMove` / `handleDialogTouchEnd`: 阻断弹窗横向滑动冒泡，避免外层 Canvas 被左右滑开
  - `handleSubmit`: 提交 `{ imageIds, prompt }`，其中 imageIds 最多 4 个且 prompt 为本次输入
  - `handleSelectCover`: 提交 `{ imageId, imageIds }`，将已选图库图片直接设为封面/内页；选 ≥2 张时按钮显示"合成拼图并使用"、由后端 `composeSelectedCollage` 合成 3:4 拼图后设入槽位 | keywords: cover-select, multi-collage

### ImageGroupCanvasView.jsx

图片组类型 Canvas 详情视图。展示图片组版式与图片预览（ImageLightbox），识别全拼图版式 collage-cover-5collage；每张 role=cover/inner-1~5 图片右上角共用同一个重生成入口，提交后可重新生成目标图片槽位或直接使用已选图库图片替换该槽位。

- **关键词**: canvas, image-group, layout, lightbox, preview, cover-regenerate, cover-select, image-slot-regenerate
- **函数**:
  - `openGroupImageRegenerateDialog`: 打开图片组指定图片槽位重生成弹窗
  - `handleRegenerateGroupImage`: 调用图片组指定 role 重生成接口，成功响应后使用后端返回的 generating Canvas
  - `handleSelectGroupImage`: 直接将弹窗中第一张已选图库图片替换到当前图组指定 role 槽位
  - `handleCanvasTouchStart` / `handleCanvasTouchMove` / `handleCanvasTouchEnd`: 阻断图组详情层横向手势冒泡，避免图片滑动误触发外层切换

### ArticleLibraryView.jsx

文章库工具主视图。库列表网格（2×2 缩略图拼合，展示已发布/总数/占用中）+ 详情页（文章 / 基础信息 / 推送二维码 三个 Tab），支持刷新实时统计。

- **关键词**: article-library, grid, thumbnail-mosaic, tabs, push-config, queue, qrcode, occupied-count, refresh
- **函数**:
  - `normalizeArticleLibraryTabParam(value)` — 归一化文章库详情 Tab URL 参数 | keywords: url-route, article-library-tab
  - `ThumbnailMosaic`: 2×2 缩略图网格
  - `LibraryFormDialog`: 新建/编辑库弹窗
  - `BasicInfoTab`: 基础信息 Tab（名称/类型）
  - `PushConfigTab`: 推送二维码 Tab（取文范围说明 + 数据历史 + 占用中统计 + SVG 二维码）
  - `ArticleListTab`: 文章列表 Tab（状态切换、发布状态切换、占用中标识、删除）
  - `LibraryDetailView`: 库详情页
  - `selectDetailTab(nextTab)` — 切换文章库详情 Tab 并同步 URL 参数 | keywords: url-route, article-library-tab
  - `ArticleLibraryView`: 文章库主入口
  - `openLibraryDetail(libraryId)` — 打开文章库详情并同步 URL 参数 | keywords: url-route, article-library-detail
  - `backToLibraryList()` — 返回文章库列表并清理详情 URL 参数 | keywords: url-route, article-library-detail
  - `openCreateDialog()` — 打开文章库新建弹窗并同步 URL 参数 | keywords: url-route, tool-popup
  - `closeCreateDialog()` — 关闭文章库新建弹窗并清理 URL 弹层参数 | keywords: url-route, tool-popup
  - `openEditDialog(library)` — 打开文章库编辑弹窗并同步 URL 参数 | keywords: url-route, tool-popup
  - `closeEditDialog()` — 关闭文章库编辑弹窗并清理 URL 弹层参数 | keywords: url-route, tool-popup

### FeaturedArticleView.jsx

精选文章工具主视图。先展示全屏工作区选择，工作区卡片显示名称和文章数量；进入后左侧是更宽的小红书帖子式缩略页列表：封面图占满卡片、底部显示标题、右上角提供删除图标；右侧按"选题 → 图片选择 → 标题 → 正文内容 → 保存/存入文章库"纵向组织且内容区占满可用宽度。图片选择使用固定小格宫格，点击格子可放大预览，也可弹窗复用图库图片与 tag 筛选，支持多选、直接用图、本地拼图预览和 AI 提示词草稿；选题重选打开 AI 对话式弹窗，输入方向后返回候选选题；存入文章库弹窗支持选择已有库或新建库。

- **关键词**: featured-article, workspace-picker, workspace-editor, article-page, image-picker-dialog, gallery-image-select, image-tag-filter, collage-preview, markdown-toolbar, ai-title-draft, ai-body-draft, ai-image-prompt, selected-image-apply, image-slot-size, image-grid-cell, image-lightbox, slide-page-list, workspace-storage, topic-selector, topic-dialog, ai-topic-options, library-picker, store-into-library
- **函数**:
  - `FEATURED_IMAGE_SLOT_SIZE({ width, height })` — 精选文章图片槽位固定尺寸参数 | keywords: featured-article, image-slot-size
  - `FEATURED_IMAGE_GRID_CELL_SIZE({ width, height })` — 精选文章图片宫格单元格固定尺寸 | keywords: featured-article, image-grid-cell
  - `buildFeaturedTopicOptions(input, workspace)` — 根据用户输入和工作区生成 AI 选题候选项 | keywords: featured-article, ai-topic-options
  - `readFeaturedGalleryImageUrl(image)` — 读取图库图片缩略图或原图地址 | keywords: featured-article, gallery-image-select
  - `normalizeFeaturedGalleryImages(value)` — 规整弹窗图库图片并过滤无效项 | keywords: featured-article, gallery-image-select
  - `normalizeFeaturedGalleryTags(value)` — 规整弹窗图库标签列表 | keywords: featured-article, image-tag-filter
  - `createFeaturedPage(index)` — 创建一个空白精选文章页面 | keywords: featured-article, article-page
  - `createDefaultFeaturedWorkspaces()` — 返回空工作区兜底数据，避免生成默认演示工作区 | keywords: featured-article, workspace-picker
  - `isLegacyDefaultWorkspace(workspace)` — 判断并清理旧版本内置默认工作区 | keywords: featured-article, workspace-storage
  - `normalizeFeaturedWorkspace(workspace)` — 规整后端或本地缓存返回的精选文章工作区 | keywords: featured-article, workspace-storage
  - `loadFeaturedWorkspaces()` — 从浏览器本地缓存读取工作区 | keywords: featured-article, workspace-storage
  - `saveFeaturedWorkspaces(workspaces)` — 将工作区写入浏览器本地缓存 | keywords: featured-article, workspace-storage
  - `countFeaturedWorkspaceArticles(workspace)` — 统计工作区文章数量 | keywords: featured-article, workspace-picker
  - `buildFeaturedTitleDraft(page, workspace)` — 生成标题 AI 草稿 | keywords: featured-article, ai-title-draft
  - `buildFeaturedBodyDraft(page, workspace)` — 生成正文 AI 草稿 | keywords: featured-article, ai-body-draft
  - `buildFeaturedImagePrompt(page, workspace)` — 生成图片提示词 AI 草稿 | keywords: featured-article, ai-image-prompt
  - `buildFeaturedArticleLibraryPayload(page, workspace)` — 将当前页面转换为文章库入库 payload | keywords: featured-article, store-into-library
  - `insertTextAtCursor(input)` — 在正文光标位置插入 Markdown 或 Emoji | keywords: featured-article, markdown-toolbar
  - `loadFeaturedImageElement(src)` — 加载可绘制到 Canvas 的图片元素 | keywords: featured-article, collage-preview
  - `createFeaturedCollagePreview(images)` — 将多张图库图片合成本地拼图预览 | keywords: featured-article, collage-preview
  - `FeaturedImagePickerDialog(props)` — 图片选择弹窗组件 | keywords: featured-article, image-picker-dialog
  - `loadImages(tag)` — 拉取弹窗内可选择图库图片 | keywords: featured-article, gallery-image-select
  - `loadTags()` — 拉取弹窗内图库标签 | keywords: featured-article, image-tag-filter
  - `toggleImage(imageId)` — 切换弹窗图片多选状态 | keywords: featured-article, gallery-image-select
  - `handleUseSelected()` — 将已选图片直接写入图片槽位 | keywords: featured-article, selected-image-apply
  - `handleGeneratePrompt()` — 触发当前页面图片提示词草稿生成 | keywords: featured-article, ai-image-prompt
  - `handleCreateCollage()` — 将已选图片生成拼图预览 | keywords: featured-article, collage-preview
  - `FeaturedTopicDialog(props)` — AI 对话式选题重选弹窗 | keywords: featured-article, topic-dialog
  - `handleAskAi()` — 根据输入刷新 AI 候选选题 | keywords: featured-article, ai-topic-options
  - `handlePickTopic(topic)` — 选中 AI 返回的候选选题 | keywords: featured-article, topic-selector
  - `FeaturedLibraryPickerDialog(props)` — 存入文章库的库选择弹窗 | keywords: featured-article, library-picker
  - `loadLibraries()` — 加载可存入的文章库列表 | keywords: featured-article, library-picker
  - `handleCreateLibrary()` — 新建文章库并存入当前精选文章 | keywords: featured-article, store-into-library
  - `FeaturedArticleView(props)` — 精选文章工具主组件 | keywords: featured-article, workspace-editor
  - `handleSelectWorkspace(workspaceId)` — 进入指定工作区并定位第一页 | keywords: featured-article, workspace-picker
  - `handleBackToWorkspaces()` — 返回工作区选择页 | keywords: featured-article, workspace-picker
  - `updateCurrentPage(patch)` — 更新当前精选文章页面字段 | keywords: featured-article, article-page
  - `handleAddPage()` — 在当前工作区新增页面 | keywords: featured-article, article-page
  - `handleSelectPage(pageId)` — 选中左侧缩略页 | keywords: featured-article, slide-page-list
  - `handleDeletePage(pageId)` — 删除左侧缩略页并切换当前选中页 | keywords: featured-article, slide-page-list
  - `handleSelectTopic(topic)` — 更新当前页面选题 | keywords: featured-article, topic-selector
  - `handleOpenTopicDialog()` — 打开 AI 选题重选弹窗 | keywords: featured-article, topic-dialog
  - `handleInsertMarkdown(value, suffix)` — 向正文编辑区插入 Markdown 或 Emoji | keywords: featured-article, markdown-toolbar
  - `handleAiTitle()` — 写入标题 AI 草稿 | keywords: featured-article, ai-title-draft
  - `handleAiBody()` — 写入正文 AI 草稿 | keywords: featured-article, ai-body-draft
  - `handleAiImagePrompt()` — 写入图片提示词 AI 草稿 | keywords: featured-article, ai-image-prompt
  - `handleApplySelectedImages(images)` — 应用弹窗直接选择的图库图片 | keywords: featured-article, selected-image-apply
  - `handleApplyCollageImage(input)` — 应用弹窗生成的拼图预览 | keywords: featured-article, collage-preview
  - `handleRemoveImage(imageId)` — 从当前页面图片列表移除指定图片 | keywords: featured-article, selected-image-apply
  - `handleOpenImagePreview(image)` — 打开精选文章图片放大预览层 | keywords: featured-article, image-lightbox
  - `handleCloseImagePreview()` — 关闭精选文章图片放大预览层 | keywords: featured-article, image-lightbox
  - `handleSavePage()` — 保存当前精选文章草稿到后端工作区页面 | keywords: featured-article, workspace-storage
  - `handleOpenLibraryDialog()` — 打开文章库选择弹窗准备入库 | keywords: featured-article, store-into-library
  - `handleStoreIntoLibrary(libraryId)` — 将当前精选文章存入指定文章库 | keywords: featured-article, store-into-library
  - `handleCreateWorkspace()` — 新建空的精选文章工作区 | keywords: featured-article, workspace-picker
- **关键词索引**:
  - `featured-article` / 精选文章
  - `workspace-picker` / 工作区选择
  - `workspace-editor` / 工作区编辑器
  - `article-page` / 文章页面
  - `image-picker-dialog` / 图片选择弹窗
  - `gallery-image-select` / 图库选图
  - `image-tag-filter` / 图片标签筛选
  - `collage-preview` / 拼图预览
  - `markdown-toolbar` / Markdown 工具条
  - `ai-title-draft` / AI 标题草稿
  - `ai-body-draft` / AI 正文草稿
  - `ai-image-prompt` / AI 图片提示词
  - `selected-image-apply` / 选图应用
  - `image-slot-size` / 图片槽位尺寸
  - `image-grid-cell` / 图片宫格单元
  - `image-lightbox` / 图片放大预览
  - `slide-page-list` / 缩略页列表
  - `workspace-storage` / 工作区缓存
  - `topic-selector` / 选题选择
  - `topic-dialog` / 选题弹窗
  - `ai-topic-options` / AI 选题候选
  - `library-picker` / 文章库选择
  - `store-into-library` / 存入文章库
  - `douyin-specialist` / 抖音专家
  - `mock-chat` / 模拟聊天
  - `mock-video` / 模拟视频
  - `douyin-data` / 抖音数据
  - `metric-card` / 指标卡片
  - `url-route` / URL 路由
  - `main-tab` / 主导航
  - `commander-popup` / 顶部弹窗
  - `commander-state` / 指挥官路由状态
  - `query-sync` / 查询参数同步
  - `time-range` / 时间维度
  - `tool-view` / 工具视图
  - `gallery-tab` / 图库标签页
  - `tool-popup` / 工具弹层
  - `tool-state` / 工具路由状态
  - `article-library-tab` / 文章库标签页
  - `article-library-detail` / 文章库详情

### featuredArticleService.js

精选文章前端 API client，对接 `/api/featured-article` 工作区、页面和存入文章库接口。

- **关键词**: featured-article, api-client, workspace-picker, workspace-editor, article-page, slide-page-list, store-into-library
- **函数**:
  - `getAuthHeaders()` — 构建精选文章 API 登录态请求头 | keywords: featured-article, api-client
  - `request(path, options)` — 封装精选文章 JSON 请求和错误响应 | keywords: featured-article, api-client
  - `listWorkspaces(params)` — 列出精选文章工作区 | keywords: featured-article, workspace-picker
  - `createWorkspace(input)` — 新建精选文章工作区 | keywords: featured-article, workspace-picker
  - `getWorkspace(workspaceId)` — 获取单个精选文章工作区 | keywords: featured-article, workspace-editor
  - `updateWorkspace(workspaceId, patch)` — 更新精选文章工作区 | keywords: featured-article, workspace-editor
  - `deleteWorkspace(workspaceId)` — 删除精选文章工作区 | keywords: featured-article, workspace-editor
  - `createPage(workspaceId, page)` — 新建工作区页面 | keywords: featured-article, article-page
  - `updatePage(workspaceId, pageId, patch)` — 更新工作区页面 | keywords: featured-article, article-page
  - `deletePage(workspaceId, pageId)` — 删除工作区页面 | keywords: featured-article, slide-page-list
  - `storePageToLibrary(workspaceId, pageId, libraryId)` — 把精选文章页面存入文章库 | keywords: featured-article, store-into-library

### qrCodeSvg.js

浏览器端二维码 SVG 生成器。基于生产级 `qrcode` 库，输入后端返回的 `qrContent`，输出可直接嵌入页面的 SVG 字符串。

- **关键词**: qrcode, svg, production-library, article-library
- **函数**:
  - `createQrCodeSvg`: 将 JSON 字符串生成 SVG 二维码

### chatService.js

AI Commander 前端 API client，封装 Canvas、图库、会话以及小红书选题与真实文章生成、读取和更新接口。

- **关键词**: api-client, canvas, gallery, cover-regenerate, article-image-regenerate, image-slot-regenerate
- **函数**:
  - `generateXhsTopicCandidates({ kind, prompt?, parentTopic?, count?, useSearch? })` — 生成母/子选题并返回已写入候选 taskResult 的 Todo | keywords: AI选题生成, 待办结果, xhs-topic-generation, todo-result
  - `recommendXhsChildTopicPrompt(parentTopic)` — 根据当前母题请求可编辑的子选题推荐提示词 | keywords: 子选题提示词推荐, 母题上下文, child-topic-prompt-recommendation, parent-topic-context
  - `listXhsTopics()` — 读取当前用户已入库的真实母子选题 | keywords: 真实选题列表, 数据库存储, persisted-topic-list, database-storage
  - `createXhsTopics({ kind, parentId?, sourceTodoId?, candidates })` — 批量保存用户确认的候选 | keywords: 保存真实选题, 批量入库, persist-selected-topics, bulk-persistence
  - `deleteXhsTopics({ ids })` — 批量删除真实选题并由服务端级联子题 | keywords: 删除真实选题, 级联删除, delete-persisted-topics, cascade-delete
  - `updateXhsTopic(id, patch)` — 修改真实选题标题、类型或发布状态 | keywords: 更新真实选题, 发布状态, update-persisted-topic, publish-status
  - `generateXhsArticle(topicId, input)` — 异步启动真实文章生成或改写并立即返回运行中的 Todo | keywords: 生成真实文章, 读取当前文章, 文章改写, 异步生成文章, generate-persisted-article, read-current-article, article-rewrite, start-article-generation
  - `listXhsArticleGenerations()` — 拉取每个子选题最近一次生成任务的进度与失败原因 | keywords: 文章生成状态, 逐条进度, article-generation-state, per-topic-progress
  - `updateXhsArticle(topicId, patch)` — 保存真实文章内容与真实图库配图 | keywords: 更新真实文章, 真实配图, update-persisted-article, persisted-images
  - `listGalleryTags`: 拉取图库标签列表，供封面重生成和标签选择弹窗筛选使用
  - `listGalleryImages`: 拉取图库图片列表，供封面重生成弹窗选择参考图
  - `regenerateCanvasArticleCover`: 调用图文 Canvas 单篇封面重生成接口
  - `selectCanvasArticleCover`: 调用图文 Canvas 单篇封面直接设图接口
  - `regenerateCanvasArticleImage`: 调用图文 Canvas 指定文章图片下标重生成接口 | keywords: article-image-regenerate, image-slot-regenerate
  - `selectCanvasArticleImage`: 调用图文 Canvas 指定文章图片下标直接设图接口 | keywords: article-image-select, image-slot-select
  - `regenerateCanvasImageGroupCover`: 调用图片组 Canvas 单组封面重生成接口
  - `selectCanvasImageGroupCover`: 调用图片组 Canvas 单组封面直接设图接口
  - `regenerateCanvasImageGroupImage`: 调用图片组 Canvas 指定 role 图片槽位重生成接口 | keywords: image-slot-regenerate, image-group-image-slot
  - `selectCanvasImageGroupImage`: 调用图片组 Canvas 指定 role 图片槽位直接设图接口 | keywords: image-slot-select, image-group-image-slot

### articleLibraryService.js

文章库前端 API client（对接 `/api/article-library` 系列接口）。

- **关键词**: article-library, api-client, fetch, bearer, crud, lease, qrcode
- **函数**:
  - `listLibraries` / `getLibrary` / `createLibrary` / `updateLibrary` / `deleteLibrary`: 库 CRUD
  - `getPushQr`: 获取二维码 payload 与 `qrContent`
  - `listArticles` / `putArticles` / `updateArticleStatus` / `deleteArticle`: 文章 CRUD + 状态更新
  - `leaseNext`: 管理端队列领取（测试用）

### GalleryZipImportPanel.jsx

图库 ZIP 批量导入右侧抽屉面板。选择不超过 300MB 的 ZIP 后，先调用独立 Worker 解包、逐张压缩并生成尺寸清单，再上传优化后的 ZIP；展示本地处理进度、压缩前后体积、真实字节上传进度与平滑实时速度。任务历史轮询采用请求完成后递归调度，上一轮成功返回并处理数据后才等待 2s 拉取 `/gallery/zip-import/list`，不会产生重叠请求；展示 status / stage / progress / 错误明细，可取消运行中、删除完成态。完成态触发 `onCompleted` 通知外部刷新图库与分组。

- **关键词**: gallery-zip-import, local-zip-optimization, worker-image-compression, image-dimension-manifest, upload-speed, sequential-polling
- **函数**:
  - `preprocessGalleryZip(file, onProgress, onWorker)` — 在 Worker 中优化图片并返回带尺寸清单的新 ZIP | keywords: ZIP本地优化, Worker图片压缩, local-zip-optimization, worker-image-compression
  - `GalleryZipImportPanel({ open, onClose, userId, groups, api, onCompleted })` — ZIP 本地优化、上传与串行轮询主组件 | keywords: 图库ZIP导入, ZIP本地优化, 串行轮询, gallery-zip-import, local-zip-optimization, sequential-polling
  - `refresh()` — 复用正在执行的列表请求，并在成功返回任务数据后更新界面 | keywords: 串行轮询刷新, 导入任务数据, sequential-poll-refresh, import-job-data
  - `poll()` — 上一轮刷新成功完成后再调度下一次请求 | keywords: 串行任务轮询, 请求完成后调度, sequential-job-polling, post-response-scheduling
  - `handleUploadProgress({ loaded, total })` — 根据连续字节采样计算平滑上传速度并更新进度 | keywords: 上传速度计算, 上传进度显示, upload-speed-calculation, upload-progress-display
  - `JobCard`: 单条任务卡片(状态徽章 + 进度条 + 错误折叠)/job card with progress
  - `StatusBadge`: 状态徽章(进行中蓝 / 成功绿 / 失败红 / 取消灰)/status badge
  - `formatBytes` / `formatTime`: 显示格式化 helpers

### galleryZipPreprocess.worker.js

浏览器 ZIP 图片预处理 Worker。使用 `fflate` 仅解出图片 entry，JPEG/WebP/PNG 通过 `OffscreenCanvas` 最大边缩到 1600、质量 0.75，只有体积至少缩小 5% 才替换；GIF/BMP 保持原字节。重新打包时写入 `_gallery_manifest.json`，供服务端复用可信宽高并跳过重复压缩。

- **关键词**: client-zip-preprocess, client-image-compression, image-dimension-manifest, preserve-animation
- **函数**:
  - `extensionOf(name)` — 提取 ZIP 图片 entry 的小写扩展名 | keywords: 图片扩展名, ZIP条目, image-extension, zip-entry
  - `mimeTypeOf(extension)` — 把图片扩展名映射为浏览器编码 MIME | keywords: 图片媒体类型, 浏览器编码, image-mime, browser-encode
  - `encodeOptimizedImage(bitmap, mimeType)` — 使用 OffscreenCanvas 等比缩放并编码图片 | keywords: 客户端图片压缩, 等比缩放, client-image-compression, proportional-resize
  - `preprocessImage(entryName, bytes)` — 优化单图并保留 GIF/BMP 原始内容 | keywords: 单图预处理, 保留动图, single-image-preprocess, preserve-animation
  - `preprocessZip(file)` — 解包、逐图处理、写尺寸清单并重新打包 | keywords: ZIP客户端预处理, 图片尺寸清单, client-zip-preprocess, image-dimension-manifest
  - `handleMessage(event)` — 处理 Worker 请求并转移新 ZIP ArrayBuffer | keywords: Worker消息处理, ZIP结果传输, worker-message-handler, zip-result-transfer

### AntiDetectionView.jsx

图片去 AI 标识工具视图。支持拖拽 / 多选批量上传（≤20 张，单张 ≤20MB），可选**处理引擎**（浏览器本地 / 服务器）、强度档位 + 输出格式。浏览器模式逐张本地处理并显示进度；服务器模式单张走二进制接口、批量走 base64 JSON 接口。支持单张下载 / 全部下载（a.download 逐个触发）。

- **关键词**: anti-detection, remove-ai-fingerprint, upload, batch, drag-drop, download, engine-toggle, browser-local, server
- **函数**:
  - `handleAddFiles` / `handleDrop` / `handleInputChange`: 文件收集与过滤（类型 / 大小 / 数量）
  - `runBrowserProcess`: 浏览器逐张本地处理（带进度）
  - `runServerProcess`: 服务器处理（单张二进制 / 批量 base64）
  - `runProcess`: 按 engine 开关分流
  - `downloadOne` / `downloadAll`: 下载单张 / 全部结果
  - `AntiDetectionView`: 主组件

### antiDetectionService.js

图片去 AI 标识前端 API client + 工具函数。

- **关键词**: anti-detection, api-client, multipart, blob, base64, download
- **函数**:
  - `processSingle`: 单张接口，返回 Blob + headers 元信息
  - `processBatch`: 批量接口，返回 JSON
  - `base64ToBlob`: base64 → Blob
  - `downloadBlob`: 触发浏览器下载

### browserAntiDetection.js

浏览器端抗 AI 识别算法（纯 Canvas 实现，对齐后端 AntiDetectionService 5 层流水线）。不上传图片、不消耗服务器资源；EXIF/XMP/ICC 经 canvas.toBlob 天然剥离；JPEG 编码用浏览器内置（无 mozjpeg）。

- **关键词**: browser, canvas, offscreen-canvas, anti-detection, gamma-lut, noise-svg, resample, no-upload
- **函数**:
  - `processInBrowser`: 主入口（解码 → resize → color ops → 噪点 → 编码）
  - `pickParams`: 与后端同口径的参数随机化
  - `applyColorOps`: gamma LUT + 亮度 + 线性近似饱和度
  - `buildNoiseSvg` / `loadSvgAsImage`: 噪点 SVG 构建与加载
  - `decodeImage` / `makeCanvas` / `canvasToBlob`: createImageBitmap / OffscreenCanvas 兼容封装
  - `resolveFinalFormat` / `deriveOutName`: 格式与文件名推导
