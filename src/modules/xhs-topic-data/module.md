# 模块名称 (Module Name)

小红书子选题数据看板模块（xhs-topic-data）

## 概述 (Overview)

为小红书数据页的「数据总览 / 数据明细 / 抓取任务明细」三个 Tab 提供后端能力。抓取数据本身仍落在 `xhs_post_stats`（归 todo 模块所有），本模块补上它缺的那条链路：**子选题 ↔ 抓取任务 ↔ 抓取数据**。

链路改为发布事件驱动的线性工作流：`xhs-topic` 来源文章第一次进入 `published` 后写入专用表 `xhs_topic_crawl_schedules`，一条子选题只维护一条 `waiting → running → waiting` 调度记录。计划默认在发布后14天内生效，表内保存 `startAt/endAt`；到期进入 `completed`，人工取消进入 `cancelled`。调度器每分钟只通过 `status + nextRunAt` 索引原子领取最多 20 条到期记录，不再扫描 `xhs_topics` 或全部文章。每次到期只创建一个 `auto_execute` 单次 Todo（优先指派给 `module=super_claw_data_tracking` 的专用 Agent）和一条 `xhs_topic_crawl_tasks` 绑定记录；本次 Todo 完成后，调度表再按用户抓取频率等待并创建下一个全新 Todo。

每个单次抓取 Todo 创建前先读取文章库专属 `workspaceId`（历史文章库会懒补工作区），建立绑定该工作区的 `xhs-tracker` 会话，再把 `workspaceId/sessionKey` 写入 Todo。只有租户绑定节点已经确认创建该工作区后，平台才会下发 Todo。

**抓取对象只由 NoteId 决定，不靠关键词搜索。** `resolvePublishedNotes` 把子选题名下（`meta.xhsTopicId` 命中）全部带 `meta.NoteId` 的已发布文章收齐，一个 Todo 可能覆盖一篇也可能覆盖多篇；`meta.xhsTopicId` 缺失时回退到调度记录绑定的那一篇。一条 NoteId 都拿不到就不建任务（这属于发布链路的数据问题，不该退化成关键词搜索去猜文章）。`associatedResources` 按篇展开 `article` 与 `xhs_note`。

`aiPlan` 是「**沉淀脚本 → 开始抓取 → 回写数据**」三步：先在工作区找可复用的 Playwright 采集脚本，没有就建成「输入 NoteId 数组 → 输出统一结构数组」的参数化形态存下来，跑不通就读日志池原地修脚本；再把整份 NoteId 清单作为入参跑一次，单篇失败不中断整批；最后一次 `UpdateTask` 把本批全部成功笔记一起回写。只有零失败才能写 `status=done`；任一笔记失败或日志池进入 `failed/timeout` 都必须写 `status=failed`，通过 `abnormalReason` 语义化说明根因，并在 `taskResult` 中列出成功/失败篇数及各失败 NoteId 的可读原因。部分成功数据仍可随该次失败终态一起 bulk 回写。

扫码端重复回写同一个 `published` 状态不会重置调度时间；文章改回未发布或删除时暂停对应调度行。专用调度行使用短租约防止多实例重复领取，运行中的 Todo 只按 `currentTodoId` 定点对账。首次启用会通过迁移标记幂等回填既有已发布的 `xhs-topic` 文章，之后全部由发布状态变化增量维护。

**一个定时点、一个单次 Todo、一条抓取运行记录。** `recordCrawlRun` 只把本次 Todo 回传的帖子划给它已有的运行记录，不会因为再次传输而为同一个 Todo 新建运行；运行记录继承 Todo 的真实状态，在途数据回写不会提前标记完成，部分成功数据也不会覆盖 `failed` 终态。下一个采集批次必须由调度表在下一个到期点创建新的 Todo。帖子数据上的 `crawlRunId` 因而稳定代表一次单次任务，总览按它做环比和趋势分批。

同一次 Todo 即使因传输原因拆成几个请求，所有数据也只归入同一个 `crawlRunId`；不会生成下一次采集。HTTP 兼容入口和 SuperClaw gRPC `UpdateTask` 回写都通过 `ModuleRef` 按字符串令牌 `'XhsTopicCrawlService'` 取服务，避免 TodoModule 与本模块形成循环依赖；取不到时只跳过看板记账，不能拖垮采集数据回写主流程。

没有绑定记录的抓取 Todo（例如用户直接在聊天里让数据追踪 Agent 建的采集任务）拿不到归属子选题，数据照常入库但不进任何子选题的看板。`syncTaskStatuses` 退化成纯状态对账：把 Todo 已失败/取消/跑完却没回写数据的在途运行收进终态，免得列表里永远挂着「执行中」。

总览指标以「抓取批次」为最小单位：同一个抓取 Todo 回写的全部帖子算一批，环比取最近两批之差，趋势按批次时间铺开。曝光量 `viewCount` 与分享量 `shareCount` 是本次新增的采集字段，采集端取不到时**整个字段省略**而不是填 0，服务端据此把指标卡标成 `available: false`，前端渲染「待采集」——这样「真的是 0」和「还没采到」不会混成同一个显示。

舆论导向分析把抓到的 `topComments` 交给 Agent，只认工具写入的结构化结果（情感分布 / 关键词 / 结论 / 代表性评论），模型最终文本不参与解析；分析结果按最新采集时间缓存在 `xhs_topic_opinions`，数据没更新就直接复用，避免每次进页面都烧一次模型。Agent 不可用或没写全时回退到二字词词频统计，保证这一块永远有东西可展示。

抓取开关取消时会连带把在途 Todo 一起停掉，恢复时立即补跑一次抓取；历史数据在两个方向上都保留。

## 文件清单 (File List)

- `xhs-topic-data.module.ts` — NestJS 模块入口，装配后台鉴权、文章库工作区、会话、Todo、抓取机器人与选题仓储。
- `controller/xhs-topic-data.controller.ts` — 数据看板 HTTP 接口与权限声明。
- `controller/xhs-topic-data.dto.ts` — 分页、按天删除、抓取开关与抓取频率的入参校验。
- `entities/xhs-topic-data.entity.ts` — 抓取任务、总览指标、明细行、舆论分析与调度配置类型。
- `services/xhs-topic-crawl.service.ts` — 发布事件驱动的专用调度表、到期任务原子领取、抓取任务绑定、Todo 状态对账与抓取频率配置。
- `services/xhs-topic-data.service.ts` — 抓取批次聚合、总览指标、趋势、分页明细与按天删除。
- `services/xhs-topic-opinion.service.ts` — 舆论导向分析 Agent、结果缓存与词频兜底。

## 函数清单 (Function List)

- `XhsTopicDataPageDto({ page?, pageSize? })` — 校验分页参数，每页上限 100 条 | keywords: 分页参数校验, 页码条数, pagination-dto, page-size
- `DeleteXhsTopicDayDto({ day })` — 校验按自然日删除的日期参数 | keywords: 按天删除参数, 日期校验, delete-day-dto, date-validation
- `XhsTopicOpinionQueryDto({ force? })` — 校验舆论分析是否跳过缓存 | keywords: 舆论分析参数, 强制刷新, opinion-dto, force-refresh
- `UpdateXhsCrawlStatusDto({ status })` — 校验取消/恢复抓取的目标状态 | keywords: 抓取状态参数, 取消恢复, crawl-status-dto, cancel-resume
- `UpdateXhsCrawlSettingsDto({ intervalMinutes })` — 校验抓取频率分钟数 | keywords: 抓取频率参数, 调度间隔, crawl-settings-dto, schedule-interval
- `UpdateXhsCrawlWindowDto({ startAt,endAt })` — 校验单选题抓取区间起止时间 | keywords: 抓取区间参数, 起止时间, crawl-window-dto, start-end-time
- `XhsTopicDataController.topics(req)` — 返回看板左侧母/子选题列表，保留已存入文章库的子题 | keywords: 看板选题列表, 保留已入库子题, dashboard-topic-list, include-stored-topics
- `XhsTopicDataController.overview(req, topicId)` — 返回子选题数据总览 | keywords: 数据总览接口, 指标汇总, overview-endpoint, metric-summary
- `XhsTopicDataController.details(req, topicId, query)` — 分页返回抓取明细 | keywords: 数据明细接口, 分页明细, details-endpoint, paged-details
- `XhsTopicDataController.deleteDay(req, topicId, query)` — 删除某个自然日的抓取数据 | keywords: 按天删除接口, 清理抓取数据, delete-day-endpoint, purge-day-stats
- `XhsTopicDataController.crawlTasks(req, topicId, query)` — 分页返回抓取任务明细 | keywords: 抓取任务接口, 任务明细, crawl-tasks-endpoint, task-details
- `XhsTopicDataController.updateCrawlStatus(req,topicId,dto)` — 取消时暂停专用调度并停止在途 Todo，恢复时令既有调度立即到期 | keywords: 取消抓取接口, 恢复抓取, cancel-crawl-endpoint, resume-crawl
- `XhsTopicDataController.crawlNow(req, topicId)` — 立即发起一次抓取 | keywords: 手动抓取接口, 立即抓取, manual-crawl-endpoint, crawl-now
- `XhsTopicDataController.updateCrawlWindow(req,topicId,dto)` — 覆盖已发布子选题的默认两周抓取区间 | keywords: 设置抓取区间接口, 采集时限, update-crawl-window-endpoint, collection-deadline
- `XhsTopicDataController.opinion(req, topicId, query)` — 返回舆论导向分析 | keywords: 舆论分析接口, 情感关键词, opinion-endpoint, sentiment-keywords
- `XhsTopicDataController.readCrawlSettings(req)` — 读取生效的抓取频率 | keywords: 读取抓取频率, 调度设置, read-crawl-settings, schedule-config
- `XhsTopicDataController.saveCrawlSettings(req, dto)` — 保存抓取频率供调度器使用 | keywords: 保存抓取频率, 同步设置, save-crawl-settings, sync-interval
- `XhsTopicDataController.requireTopic(req, topicId)` — 校验子选题归属，越权按 404 处理 | keywords: 校验选题归属, 越权防护, require-owned-topic, ownership-guard
- `XhsTopicDataController.requireUser(req)` — 取出当前后台用户 | keywords: 当前后台用户, 登录校验, require-admin-user, auth-check
- `XhsTopicCrawlService.onModuleInit()` — 启动抓取调度轮询 | keywords: 启动调度, 定时轮询, start-scheduler, interval-tick
- `XhsTopicCrawlService.onModuleDestroy()` — 停止抓取调度轮询 | keywords: 停止调度, 释放定时器, stop-scheduler, clear-timer
- `XhsTopicCrawlService.ensureIndexes()` — 建立抓取任务与专用调度表索引并执行首次回填 | keywords: 抓取任务索引, 调度表初始化, crawl-task-indexes, schedule-table-init
- `XhsTopicCrawlService.backfillPublishedArticleSchedules()` — 首次启用时按迁移标记幂等回填既有已发布选题文章 | keywords: 已发布文章回填, 调度表迁移, published-article-backfill, schedule-table-migration
- `XhsTopicCrawlService.syncArticlePublishSchedule(input)` — 根据文章发布状态创建、激活或暂停专用调度行 | keywords: 发布触发调度, 同步采集计划, publish-triggered-schedule, sync-crawl-plan
- `XhsTopicCrawlService.pauseScheduleForTopic(topicId)` — 暂停子选题的周期采集计划 | keywords: 暂停采集计划, 取消调度, pause-crawl-schedule, cancel-schedule
- `XhsTopicCrawlService.resumeScheduleForTopic(topicId)` — 恢复已有采集计划并令其立即到期 | keywords: 恢复采集计划, 立即到期, resume-crawl-schedule, schedule-due-now
- `XhsTopicCrawlService.setScheduleWindow(topicId,startAt,endAt)` — 设置周期采集的开始和硬截止时间 | keywords: 设置抓取区间, 采集时限, set-crawl-window, collection-deadline
- `XhsTopicCrawlService.getNextRunAt(topicId)` — 从调度表读取真实的下次采集时间 | keywords: 下次采集时间, 调度表查询, next-crawl-time, schedule-table-query
- `XhsTopicCrawlService.getScheduleStatus(topicId)` — 返回调度状态、下次时间与最近阻断原因 | keywords: 查询调度诊断, 任务阻断原因, get-schedule-diagnostics, task-block-reason
- `XhsTopicCrawlService.readArticleTopicId(meta)` — 从文章元数据解析来源子选题 | keywords: 解析来源选题, 文章调度关联, parse-source-topic, article-schedule-binding
- `XhsTopicCrawlService.getIntervalMinutes(scope)` — 读取生效抓取间隔 | keywords: 读取抓取频率, 调度间隔, read-crawl-interval, schedule-interval
- `XhsTopicCrawlService.saveIntervalMinutes(intervalMinutes, scope)` — 保存抓取间隔 | keywords: 保存抓取频率, 同步设置, save-crawl-interval, sync-settings
- `XhsTopicCrawlService.listTasks(topicId, page, pageSize)` — 分页读取抓取任务明细 | keywords: 抓取任务明细, 分页任务, crawl-task-list, paged-tasks
- `XhsTopicCrawlService.countTasks(topicId)` — 统计抓取任务总数 | keywords: 抓取任务计数, 总览统计, crawl-task-count, overview-stat
- `XhsTopicCrawlService.getLatestTask(topicId)` — 读取最近一次抓取任务 | keywords: 最近抓取任务, 下次抓取, latest-crawl-task, next-crawl-at
- `XhsTopicCrawlService.syncTaskStatuses(topicId)` — 在途运行与 Todo 状态对账并收尾 | keywords: 抓取任务对账, 在途任务收尾, reconcile-crawl-tasks, settle-inflight-runs
- `XhsTopicCrawlService.recordCrawlRun(todoId)` — 把单次 Todo 的回写数据划入唯一运行并继承 Todo 真实终态 | keywords: 记录抓取运行, 每次抓取一条, 回写归属, record-crawl-run, per-crawl-record, write-attribution
- `XhsTopicCrawlService.hasTrackingAgent()` — 当前是否存在可用的数据追踪 Agent | keywords: 数据追踪可用性, 抓取前置条件, tracking-agent-available, crawl-precondition
- `XhsTopicCrawlService.createCrawlTask(topic,trigger,beforeTrigger?,deadline?)` — 基于文章库工作区建立任务会话，收齐 NoteId 后创建一次性 Todo 并等待绑定节点领取；没有任何带 NoteId 的已发布文章时不建任务 | keywords: 创建抓取任务, 指派数据追踪, create-crawl-task, assign-tracking-agent
- `XhsTopicCrawlService.cancelRunningTasks(topicId)` — 取消在途抓取任务 | keywords: 取消在途任务, 停止抓取, cancel-running-tasks, stop-crawl
- `XhsTopicCrawlService.tickScheduler()` — 按 nextRunAt 索引分批领取到期调度行 | keywords: 到期任务领取, 索引调度, due-task-claim, indexed-scheduling
- `XhsTopicCrawlService.claimDueSchedule()` — 原子领取最早到期调度行并写入多实例租约 | keywords: 原子领取调度, 多实例租约, atomic-schedule-claim, multi-instance-lease
- `XhsTopicCrawlService.processClaimedSchedule(schedule)` — 按等待态或运行态推进线性调度 | keywords: 推进线性调度, 运行态对账, advance-linear-schedule, running-state-reconcile
- `XhsTopicCrawlService.advanceScheduleAfterTodo(todoId,error?)` — 抓取结束后推进同一调度行的下次执行时间 | keywords: 完成调度周期, 推进下次执行, complete-schedule-cycle, advance-next-run
- `XhsTopicCrawlService.resolveTrackingAssignee()` — 挑出数据追踪 Agent 作为 assignee | keywords: 数据追踪代理, 指派解析, tracking-agent-lookup, assignee-resolve
- `XhsTopicCrawlService.buildCrawlPlan(topic,notes)` — 生成按 NoteId 采集并依失败情况写入 done/failed 互斥终态的三步计划 | keywords: 抓取执行计划, 沉淀采集脚本, crawl-plan, persist-collector-script
- `XhsTopicCrawlService.resolvePublishedNotes(topicId,schedule)` — 汇总子选题名下全部带 NoteId 的已发布文章作为抓取目标 | keywords: 汇总已发布笔记, 抓取目标清单, collect-published-notes, crawl-target-list
- `XhsTopicCrawlService.mapTodoStatus(status?)` — Todo 执行中或等待介入均映射为抓取运行中 | keywords: 任务状态映射, 待办状态, todo-status-mapping, task-status
- `XhsTopicCrawlService.toTaskView(task)` — 抓取任务实体转前端表格行 | keywords: 任务视图转换, 耗时计算, task-view-mapping, duration-calc
- `XhsTopicCrawlService.nextTaskId()` — 原子递增抓取任务 ID | keywords: 任务自增ID, 计数器, next-task-id, counter
- `XhsTopicDataService.buildOverview(topic)` — 聚合数据总览 | keywords: 数据总览, 指标聚合, 最后抓取时间, data-overview, metric-aggregation, last-crawled-at
- `XhsTopicDataService.listDetails(topicId, page, pageSize)` — 分页读取抓取明细 | keywords: 数据明细分页, 抓取记录表格, paged-details, crawl-record-table
- `XhsTopicDataService.deleteDay(topicId, day)` — 删除某自然日的抓取数据 | keywords: 按天删除数据, 清理某天抓取, delete-by-day, purge-day-stats
- `XhsTopicDataService.groupByBatch(stats)` — 按抓取任务分批，作为环比与趋势最小单位 | keywords: 抓取批次分组, 环比基准, batch-grouping, comparison-baseline
- `XhsTopicDataService.sumBatch(stats)` — 汇总批次指标并标记待采集字段 | keywords: 批次汇总, 待采集判定, batch-summary, availability-check
- `XhsTopicDataService.buildMetrics(batches)` — 生成核心指标卡与走势采样 | keywords: 指标卡, 环比增量, 走势采样, metric-cards, period-delta, trend-samples
- `XhsTopicDataService.countHotPosts(stats)` — 统计达到爆文阈值的笔记数 | keywords: 爆文统计, 互动阈值, hot-post-count, interaction-threshold
- `XhsTopicDataService.pickTopPost(stats)` — 挑出互动量最高的笔记 | keywords: 最高互动笔记, 榜首笔记, top-post, best-interaction
- `XhsTopicDataService.interactionOf(stat)` — 计算单条记录互动量 | keywords: 互动量计算, 单条互动, interaction-calc, per-record-interaction
- `XhsTopicDataService.toDetailRow(stat)` — 抓取记录转明细表格行 | keywords: 明细行转换, 自然日, detail-row-mapping, calendar-day
- `XhsTopicDataService.toLocalDay(date)` — 按本地时区格式化自然日 | keywords: 本地自然日, 日期格式化, local-day, date-format
- `XhsTopicOpinionService.ensureIndexes()` — 建立舆论分析缓存索引 | keywords: 舆论缓存索引, 唯一选题, opinion-cache-index, unique-topic
- `XhsTopicOpinionService.getOpinion(topic, force?)` — 读取舆论分析，数据未更新时复用缓存 | keywords: 舆论分析读取, 缓存复用, read-opinion, cache-reuse
- `XhsTopicOpinionService.analyze(topic, comments, latestDataAt?)` — 运行分析 Agent 并在失败时兜底 | keywords: 分析Agent, 工具写入, 词频兜底, analysis-agent, tool-write, frequency-fallback
- `XhsTopicOpinionService.collectComments(stats)` — 汇总去重热门评论 | keywords: 汇总热门评论, 评论去重, collect-comments, dedupe-comments
- `XhsTopicOpinionService.buildSystemPrompt(topic, comments)` — 构造分析提示词与评论样本 | keywords: 分析提示词, 评论样本, analysis-prompt, comment-sample
- `XhsTopicOpinionService.createSentimentTool(draft)` — 情感分布写入工具 | keywords: 情感分布工具, 极性计数, sentiment-tool, polarity-count
- `XhsTopicOpinionService.createKeywordTool(draft)` — 热点关键词写入工具 | keywords: 关键词工具, 词频权重, keyword-tool, frequency-weight
- `XhsTopicOpinionService.createConclusionTool(draft)` — 舆论结论写入工具 | keywords: 结论工具, 一句话结论, conclusion-tool, one-line-summary
- `XhsTopicOpinionService.createHighlightTool(draft)` — 代表性评论写入工具 | keywords: 代表评论工具, 样本引用, highlight-tool, sample-quote
- `XhsTopicOpinionService.normalizeSentiments(raw, comments)` — 情感条数归一化配平 | keywords: 情感归一化, 占比配平, normalize-sentiment, ratio-balance
- `XhsTopicOpinionService.fallbackKeywords(comments)` — 关键词词频兜底 | keywords: 关键词兜底, 词频统计, keyword-fallback, term-frequency
- `XhsTopicOpinionService.fallbackHighlights(comments)` — 代表性评论兜底 | keywords: 代表评论兜底, 高赞评论, highlight-fallback, top-liked-comments
- `XhsTopicOpinionService.toView(entity)` — 缓存文档转接口返回体 | keywords: 舆论缓存视图, 结果转换, opinion-cache-view, result-mapping

## 关键词索引 (Keyword Index)

| 中文              | English                    |
| ----------------- | -------------------------- |
| 数据看板接口      | topic-data-controller      |
| 子选题数据        | subtopic-dashboard         |
| 数据总览          | data-overview              |
| 指标聚合          | metric-aggregation         |
| 指标卡            | metric-cards               |
| 环比增量          | period-delta               |
| 走势采样          | trend-samples              |
| 待采集判定        | availability-check         |
| 抓取批次分组      | batch-grouping             |
| 数据明细分页      | paged-details              |
| 按天删除数据      | delete-by-day              |
| 爆文统计          | hot-post-count             |
| 互动量计算        | interaction-calc           |
| 抓取调度          | crawl-scheduler            |
| 发布触发调度      | publish-triggered-schedule |
| 专用调度表        | due-task-table             |
| 索引调度          | indexed-scheduling         |
| 原子领取调度      | atomic-schedule-claim      |
| 线性工作流        | linear-workflow            |
| 抓取区间          | crawl-window               |
| 两周时限          | two-week-deadline          |
| SuperClaw数据抓取 | super-claw-data-tracking   |
| 创建抓取任务      | create-crawl-task          |
| 抓取任务绑定      | crawl-task-binding         |
| 抓取任务对账      | reconcile-crawl-tasks      |
| 在途任务收尾      | settle-inflight-runs       |
| 记录抓取运行      | record-crawl-run           |
| 每次抓取一条      | per-crawl-record           |
| 回写归属          | write-attribution          |
| 数据追踪可用性    | tracking-agent-available   |
| 取消抓取          | cancel-crawl               |
| 恢复抓取          | resume-crawl               |
| 抓取频率配置      | crawl-settings             |
| 数据追踪代理      | tracking-agent-lookup      |
| 舆论导向分析      | opinion-analysis           |
| 情感分布          | sentiment-distribution     |
| 关键词工具        | keyword-tool               |
| 分析缓存          | analysis-cache             |
| 词频兜底          | frequency-fallback         |
| 校验选题归属      | require-owned-topic        |
| 看板选题列表      | dashboard-topic-list       |
| 保留已入库子题    | include-stored-topics      |

## 类型导出 (Type Exports)

- `XhsCrawlTaskStatus` / `XhsCrawlTaskTrigger` — 抓取任务状态与触发来源
- `XhsCrawlTaskEntity` / `XhsCrawlTaskView` — 单次 Todo 的抓取运行实体与前端表格行；兼容字段 `runIndex` 在新工作流中恒为 1
- `XhsCrawlScheduleStatus` / `XhsCrawlScheduleEntity` — 专用调度行状态与实体，保存 `startAt/endAt` 并以 `nextRunAt` 驱动线性采集工作流
- `XhsTopicMetricValue` / `XhsTopicTrendPoint` / `XhsTopicOverview` — 指标卡、趋势点与总览返回体
- `XhsTopicDetailRow` — 数据明细表格行
- `XhsOpinionSentiment` / `XhsTopicOpinion` / `XhsTopicOpinionEntity` — 舆论分析结果与缓存文档
- `XhsCrawlSettingsEntity` — 抓取频率配置文档
- `DEFAULT_CRAWL_INTERVAL_MINUTES` — 默认抓取间隔（30 分钟） | keywords: 默认抓取频率, 分钟间隔, default-crawl-interval, minute-frequency
- `DEFAULT_CRAWL_WINDOW_DAYS` — 发布后默认周期抓取时限（14天） | keywords: 默认抓取区间, 两周时限, default-crawl-window, two-week-deadline
- `HOT_POST_INTERACTION_THRESHOLD` — 爆文互动阈值（1000）

## 模块功能描述 (Module Description)

对外提供 `/api/xhs-topic-data` 下的一组接口，全部挂 `XhsTopic` 权限主体（与选题模块同一根 key，三种内置角色都已具备 `manage XhsTopic`）：

| 方法与路径                                                   | 权限            | 用途                              |
| ------------------------------------------------------------ | --------------- | --------------------------------- |
| `GET /api/xhs-topic-data/topics`                             | read XhsTopic   | 看板母/子选题列表（含已发文子题） |
| `GET /api/xhs-topic-data/:topicId/overview`                  | read XhsTopic   | 数据总览                          |
| `GET /api/xhs-topic-data/:topicId/details`                   | read XhsTopic   | 数据明细分页                      |
| `DELETE /api/xhs-topic-data/:topicId/details?day=YYYY-MM-DD` | delete XhsTopic | 删除某天数据                      |
| `GET /api/xhs-topic-data/:topicId/crawl-tasks`               | read XhsTopic   | 抓取任务明细分页                  |
| `POST /api/xhs-topic-data/:topicId/crawl-status`             | update XhsTopic | 取消 / 恢复抓取                   |
| `POST /api/xhs-topic-data/:topicId/crawl-now`                | create XhsTopic | 立即抓取一次                      |
| `PUT /api/xhs-topic-data/:topicId/crawl-window`              | update XhsTopic | 设置单选题抓取起止区间            |
| `GET /api/xhs-topic-data/:topicId/opinion`                   | read XhsTopic   | 舆论导向分析                      |
| `GET /api/xhs-topic-data/crawl-settings`                     | read XhsTopic   | 读取抓取频率                      |
| `PUT /api/xhs-topic-data/crawl-settings`                     | update XhsTopic | 保存抓取频率                      |

越权访问他人子选题一律返回 404 而不是 403，避免泄露选题的存在性。

`GET /:topicId/crawl-tasks` 额外返回 `agentAvailable`：没有已启用的 `xhs_data_tracking` 代理时调度器一条任务都建不出来，这个原因原本只落在服务端日志里，界面上只会看到一个空列表，所以要在接口上说清楚。

新增集合：`xhs_topic_crawl_schedules`（已发布文章驱动的周期调度表，每个子选题一行）、`xhs_topic_crawl_tasks`（单次 Todo 的抓取运行记录，一次任务一行）、`xhs_topic_crawl_settings`（租户用户级抓取频率）、`xhs_topic_opinions`（舆论分析缓存）。同时在既有集合上加了字段：`xhs_post_stats` 增加 `viewCount` / `shareCount` / `topicId` / `crawlRunId`，`xhs_topics` 增加 `crawl` 子文档（`status` / `lastCrawledAt` / `lastScheduledAt` / `cancelledAt`）。周期计划只负责按时创建新的单次 Todo，不承载业务执行，也不会复用旧 Todo。

依赖：`ArticleLibraryModule`（文章库专属工作区）、`ContextModule`（任务会话）、`TodoModule`（Todo 生命周期与 `XhsPostStatService`）、`XhsTopicModule`（选题仓储）、`AutoTaskRobotModule`（触发数据追踪 Agent）、`AiAgentModule`（舆论分析）、`AdminModule`（鉴权与 Agent 配置）。
