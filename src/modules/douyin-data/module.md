# 模块名称 (Module Name)

抖音作品数据监控（douyin-data）

## 概述 (Overview)

抖音工作台「抓取数据」区的后端，对应小红书的 `xhs-topic-data` 数据监控。以视频发布库（`douyin-publish`）里的**已发布作品**为监控对象：每个作品可开启 / 取消监控，开启后 14 天内由 leader 进程按固定间隔（默认 6 小时）经 TikHub 按抖音作品 ID 抓取互动数据并写快照，满 14 天自动结束；监控中的作品也能立即抓取一次。抓取目标作品 ID 取「用户绑定的链接」优先，其次是小程序发布回写的 `douyinVideoId`（只认纯数字作品 ID，加密 ID 需要绑定链接）。「新增链接」可按抖音链接直接在发布库里建一条已发布作品并开启监控。TikHub Key 与小红书共用，不另设配置。

## 文件清单 (File List)

- `douyin-data.module.ts` — Nest 模块声明，装配后台鉴权、发布库作品服务、TikHub 抖音采集、控制器与服务。
- `entities/douyin-data.entity.ts` — 监控时长 / 间隔 / 冷却常量，监控行与抓取快照实体，接口视图类型。
- `services/douyin-aweme-link.ts` — 抖音作品 ID 解析、分享口令取链接、短链跟随跳转（只跟随抖音域名）与抓取目标选择。
- `services/douyin-aweme-link.spec.ts` — 作品 ID 解析与抓取目标优先级回归测试。
- `services/douyin-data.service.ts` — 发布库作品列表拼监控状态与区间指标、开启 / 取消监控、绑定链接、新增链接。
- `services/douyin-data-crawl.service.ts` — 立即抓取、leader 进程定时调度、原子抓取锁、快照写入与失败原因。
- `controller/douyin-data.controller.ts` — `/api/douyin-data` 管理端接口。
- `controller/douyin-data.dto.ts` — 监控开关、绑定链接、新增链接请求体校验。

## 函数清单 (Function List)

- `DouyinDataModule()` — 装配抖音作品数据监控 | keywords: 抖音数据监控模块, 作品数据抓取, douyin-data-module, work-data-crawl
- `DOUYIN_DATA_MONITOR_DAYS` — 一次开启监控最长 14 天 | keywords: 监控时长上限, 两周监控, monitor-window-days, two-week-monitor
- `DOUYIN_DATA_DEFAULT_INTERVAL_MINUTES` — 定时抓取默认间隔 360 分钟 | keywords: 默认抓取间隔, 定时抓取, default-crawl-interval, scheduled-crawl
- `DOUYIN_DATA_MANUAL_COOLDOWN_MS` — 同一作品手动抓取最短间隔 60 秒 | keywords: 手动抓取冷却, 防重复计费, manual-crawl-cooldown, duplicate-charge-guard
- `parseDouyinAwemeId(text)` — 从作品链接、`modal_id` 参数或裸 ID 解析 15-21 位作品 ID，短链返回空串 | keywords: 解析抖音作品ID, 链接解析, parse-douyin-aweme-id, link-parse
- `extractDouyinUrl(text)` — 从分享口令里取出第一个抖音域名链接 | keywords: 提取抖音链接, 分享口令, extract-douyin-url, share-text
- `isDouyinHost(url)` — 判断链接是否属于允许跟随跳转的抖音域名 | keywords: 抖音域名白名单, 防止外发, douyin-host-allowlist, exfiltration-guard
- `resolveDouyinAwemeId(text)` — 能直接解析就不发请求，短链逐跳读 Location（最多 3 跳、只跟随抖音域名） | keywords: 解析抖音短链, 跟随跳转, resolve-douyin-short-link, follow-redirect
- `resolveCrawlTarget(douyinVideoId,boundAwemeId)` — 绑定链接优先、其次纯数字 douyinVideoId，都不可用返回 null | keywords: 抓取目标作品ID, 绑定链接优先, resolve-crawl-target, bound-link-first
- `DouyinDataService()` — 数据监控列表、监控开关、绑定链接与新增链接 | keywords: 抖音数据监控服务, 作品监控, douyin-data-service, work-monitor
- `DouyinDataService.ensureIndexes()` — 建立作品唯一、调度到期与快照时间线索引 | keywords: 数据监控索引, 调度到期索引, douyin-data-indexes, due-schedule-index
- `DouyinDataService.intervalMinutes()` — 读取 `DOUYIN_DATA_CRAWL_INTERVAL_MINUTES`（30-1440），非法用默认 | keywords: 抓取间隔, 环境变量, crawl-interval, environment-config
- `DouyinDataService.listLibraryWorks(libraryId,range,scope)` — 列出库内已发布作品、监控状态、区间最近指标、抓取目标、未发布数与采集通道状态 | keywords: 数据监控作品列表, 区间指标, list-monitor-works, ranged-metrics
- `DouyinDataService.setMonitoring(workId,monitoring,scope)` — 开启时要求有抓取目标并重计 14 天窗口、立即排第一次抓取；取消时停止调度 | keywords: 切换作品监控, 开启取消监控, toggle-work-monitor, start-stop-monitor
- `DouyinDataService.bindLink(workId,url,scope)` — 解析并保存作品 ID，监控中的作品立即按新 ID 重抓 | keywords: 绑定作品链接, 解析抖音作品ID, bind-work-link, parse-douyin-aweme-id
- `DouyinDataService.createManualLink(input,scope)` — 按链接在发布库建已发布作品并直接开启监控 | keywords: 新增抖音链接, 手动添加作品, add-douyin-link, manual-douyin-work
- `DouyinDataService.requirePublishedWork(workId,scope)` — 读取作用域内已发布作品，不存在 404、未发布 400 | keywords: 要求已发布作品, 作用域校验, require-published-work, scope-check
- `DouyinDataService.toMonitorView(entity)` — 监控实体转接口视图 | keywords: 监控视图转换, monitor-view-mapping
- `DouyinDataService.toMetricsView(snapshot)` — 快照转指标，互动总量为点赞评论收藏分享之和，有播放量时算互动率 | keywords: 快照转指标, 互动率计算, snapshot-to-metrics, interaction-rate-calc
- `DouyinDataService.latestMetrics(workIds,range)` — 聚合取每个作品区间内最近一次快照 | keywords: 区间最近快照, 聚合取最新, latest-snapshot-in-range, aggregate-latest
- `DouyinDataService.upsertMonitor(work,set)` — 写入或新建监控行，新行默认未监控 | keywords: 写入监控行, 默认未监控, upsert-monitor, default-stopped
- `DouyinDataCrawlService()` — 立即抓取与定时抓取调度 | keywords: 抖音数据抓取, 定时抓取调度, douyin-data-crawl, scheduled-crawl
- `DouyinDataCrawlService.onModuleInit()` — 只在 leader 进程启动每分钟一次的调度轮询 | keywords: 启动抖音抓取调度, 定时轮询, start-douyin-crawl-scheduler, interval-tick
- `DouyinDataCrawlService.onModuleDestroy()` — 停止调度轮询 | keywords: 停止抖音抓取调度, 释放定时器, stop-douyin-crawl-scheduler, clear-timer
- `DouyinDataCrawlService.crawlNow(workId,scope)` — 监控中作品立即抓一次，不改定时计划；冷却 429、并发 409 | keywords: 立即抓取, 手动触发抓取, crawl-now, manual-crawl-trigger
- `DouyinDataCrawlService.tickScheduler()` — 每轮最多原子领取 20 条到期监控逐个处理 | keywords: 领取到期监控, 批量调度, claim-due-monitors, batch-scheduling
- `DouyinDataCrawlService.processScheduled(monitor)` — 满 14 天结束、作品删除即停止、缺目标或 Key 记原因，否则抓取 | keywords: 处理到期监控, 监控到期结束, process-due-monitor, monitor-expiry
- `DouyinDataCrawlService.runCrawl(monitor,awemeId,trigger)` — 抓取并写快照、刷新封面与最后抓取时间，失败记中文原因 | keywords: 执行抓取, 写入快照, run-crawl, write-snapshot
- `DouyinDataCrawlService.claim(filter,extraSet?)` — 原子领取未上锁的监控行并写锁令牌 | keywords: 原子领取监控, 抓取锁, atomic-monitor-claim, crawl-lock
- `DouyinDataCrawlService.release(monitor,set)` — 按锁令牌释放锁并写入结果字段 | keywords: 释放抓取锁, 写入结果, release-crawl-lock, write-result
- `DouyinDataCrawlService.describeError(error)` — 把 TikHub 401/402/429/超时转成中文原因 | keywords: 抓取失败原因, 错误可读化, crawl-failure-reason, readable-error
- `DouyinDataCrawlService.scopeOf(monitor)` — 由监控行还原租户用户作用域 | keywords: 还原抓取作用域, monitor-scope
- `DouyinDataController()` — `/api/douyin-data` 接口，统一 DouyinWorkbench 权限主体 | keywords: 抖音数据监控接口, 管理端鉴权, douyin-data-controller, admin-authorization
- `DouyinDataController.listWorks(libraryId,start,end,req)` — 发布库数据监控列表接口 | keywords: 数据监控作品列表接口, list-monitor-works-endpoint
- `DouyinDataController.setMonitor(workId,body,req)` — 监控开关接口 | keywords: 监控开关接口, set-monitor-endpoint
- `DouyinDataController.bindLink(workId,body,req)` — 绑定作品链接接口 | keywords: 绑定作品链接接口, bind-work-link-endpoint
- `DouyinDataController.crawlNow(workId,req)` — 立即抓取接口 | keywords: 立即抓取接口, crawl-now-endpoint
- `DouyinDataController.createManualLink(body,req)` — 新增链接接口 | keywords: 新增链接接口, create-manual-link-endpoint
- `DouyinDataController.requireUser(req)` — 读取后台鉴权用户 | keywords: 读取数据监控用户, read-data-monitor-user
- `DouyinDataController.scopeOf(user)` — 构造租户用户作用域 | keywords: 构造数据监控作用域, build-data-monitor-scope
- `DouyinDataController.parseTime(value)` — 解析 ISO 区间时间，非法 400 | keywords: 解析区间时间, parse-range-time
- `SetDouyinDataMonitorDto()` — 校验 `monitoring` 布尔值 | keywords: 监控开关参数, set-monitor-dto
- `BindDouyinDataLinkDto()` — 校验链接 1-2000 字 | keywords: 绑定作品链接参数, bind-work-link-dto
- `CreateDouyinDataManualLinkDto()` — 校验发布库 ID、标题 1-60 字与链接 | keywords: 新增链接参数, create-manual-link-dto

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 抖音数据监控模块 | douyin-data-module |
| 抖音数据监控服务 | douyin-data-service |
| 抖音数据抓取 | douyin-data-crawl |
| 数据监控作品列表 | list-monitor-works |
| 区间指标 | ranged-metrics |
| 切换作品监控 | toggle-work-monitor |
| 绑定作品链接 | bind-work-link |
| 新增抖音链接 | add-douyin-link |
| 解析抖音作品ID | parse-douyin-aweme-id |
| 解析抖音短链 | resolve-douyin-short-link |
| 抓取目标作品ID | resolve-crawl-target |
| 抖音域名白名单 | douyin-host-allowlist |
| 立即抓取 | crawl-now |
| 定时抓取调度 | scheduled-crawl |
| 监控到期结束 | monitor-expiry |
| 原子领取监控 | atomic-monitor-claim |
| 抓取锁 | crawl-lock |
| 写入快照 | write-snapshot |
| 区间最近快照 | latest-snapshot-in-range |
| 互动率计算 | interaction-rate-calc |
| 手动抓取冷却 | manual-crawl-cooldown |
| 两周监控 | two-week-monitor |
| 抓取失败原因 | crawl-failure-reason |

## 类型导出 (Type Exports)

- `DouyinDataScope` — 租户与用户作用域 | keywords: 数据监控作用域, douyin-data-scope
- `DouyinDataMonitorStatus` — `monitoring` / `stopped` / `finished` | keywords: 作品监控状态, work-monitor-status
- `DouyinDataMonitorEntity` — 监控行，集合 `douyin_data_monitors` | keywords: 作品监控实体, 抓取调度, work-monitor-entity, crawl-schedule
- `DouyinDataSnapshotEntity` — 抓取快照，集合 `douyin_data_snapshots` | keywords: 抓取快照, 互动指标, crawl-snapshot, interaction-metrics
- `DouyinDataMonitorView` — 监控状态视图 | keywords: 监控状态视图, monitor-view
- `DouyinDataMetricsView` — 区间指标视图 | keywords: 作品指标视图, 互动率, work-metrics-view, interaction-rate
- `DouyinDataWorkItemView` — 表格一行：作品、监控、指标、抓取目标 | keywords: 数据监控行视图, data-monitor-row-view
- `DouyinDataCollectorView` — 采集通道可用性与抓取间隔 | keywords: 采集通道状态, collector-status
- `DouyinDataCrawlResult` — 立即抓取结果 | keywords: 立即抓取结果, crawl-now-result

## 模块功能描述 (Module Description)

**入口鉴权**（全部 `AdminAuthGuard` + `AdminPoliciesGuard`，权限主体与抖音工作台、发布库一致为 `DouyinWorkbench`）：

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | `/api/douyin-data/libraries/:libraryId/works?start=&end=` | read DouyinWorkbench | 发布库已发布作品 + 监控状态 + 区间最近指标 |
| POST | `/api/douyin-data/works/:workId/monitor` | update DouyinWorkbench | 开启 / 取消监控，body `{ monitoring }` |
| PUT | `/api/douyin-data/works/:workId/link` | update DouyinWorkbench | 绑定作品链接，body `{ url }` |
| POST | `/api/douyin-data/works/:workId/crawl-now` | create DouyinWorkbench | 立即抓取一次 |
| POST | `/api/douyin-data/manual-links` | create DouyinWorkbench | 按链接新增已发布作品并开启监控，body `{ libraryId, title, url }` |

发布库列表、作品换库与删除直接复用 `/api/douyin-publish`，本模块不重复实现。列表接口返回 `{ items, total, unpublishedCount, collector }`：`items[]` 为 `{ work, monitor, metrics, crawlTarget }`，`monitor` 为 null 表示从未开启过；`metrics` 为 `start`~`end`（ISO 时间，缺省为全部）内最近一次快照，互动数是累计值，所以区间内最近一次即区间末的数据；`collector.available=false` 时带中文 `reason`。一个库最多读 500 个已发布作品。

**抓取**：`DouyinDataCrawlService` 在 leader 进程（`isLeaderProcess()`）每分钟轮询一次，按 `nextCrawlAt` 原子领取到期的监控行（`lockToken` + 2 分钟 `lockUntil`，崩溃后锁过期可接管），每轮最多 20 条、相邻调用间隔 300ms。成功写 `douyin_data_snapshots`、刷新 `lastCrawledAt` 与 TikHub 返回的封面（手动链接作品没有视频快照，界面用它展示），下一次为间隔之后；失败记中文 `lastError`，30 分钟后重试。满 14 天改为 `finished`；作品被删除或不再是已发布改为 `stopped`；缺抓取目标或 TikHub Key 时记原因等下一个间隔，不调用上游。立即抓取只允许监控中的作品，写 `trigger=manual` 快照、不改定时计划，一分钟内重复返回 429，同一作品已在抓返回 409。

**作品 ID**：抖音小程序发布回写的 `videoId` 可能是加密 ID，TikHub 只接受纯数字 aweme_id，所以监控行可单独保存用户绑定的链接（`awemeId` / `linkUrl`）且优先使用。链接解析支持 `douyin.com/video|note/<id>`、`iesdouyin.com/share/video/<id>`、`?modal_id=<id>`、裸 ID；`v.douyin.com` 短链与分享口令由服务端逐跳读 `Location`，只跟随抖音域名，避免被当作任意地址代理。

错误码：`DOUYIN_DATA_TARGET_MISSING`（400，还没有可抓取的作品 ID）、`DOUYIN_DATA_LINK_INVALID`（400，链接解析不到作品 ID）、`DOUYIN_DATA_NOT_MONITORING`（400）、`DOUYIN_DATA_TIKHUB_KEY_MISSING`（400）、`DOUYIN_DATA_WORK_UNPUBLISHED`（400）、`DOUYIN_DATA_RANGE_INVALID`（400）、`DOUYIN_DATA_CRAWL_TOO_FREQUENT`（429）、`DOUYIN_DATA_CRAWL_RUNNING`（409），以及透传的 `DOUYIN_PUBLISH_WORK_NOT_FOUND`（404）、`DOUYIN_PUBLISH_LIBRARY_NOT_FOUND`（404）、`DOUYIN_PUBLISH_WORK_EXISTS`（409，同库同作品 ID 已存在）。

集合：`douyin_data_monitors`（`workId` 唯一、`{status, nextCrawlAt}`）、`douyin_data_snapshots`（`{workId, crawledAt}`）。环境变量：`DOUYIN_DATA_CRAWL_INTERVAL_MINUTES`（可选，30-1440，默认 360）。依赖：`AdminModule`、`DataSourceModule`、`DouyinPublishModule`（`findWork` / `list` / `createFromLink`）、`TikhubModule`（`TikhubDouyinService`）。
