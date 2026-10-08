# 模块名称 (Module Name)

AI 生成排队（generation-queue）

## 概述 (Overview)

AI 生成的异步排队服务。每个业务注册一条通道（小红书文章 `xhs-article`、抖音生成 `douyin-generation`），各自读取「全平台总并发」与「租户并发」两级上限；拿不到名额的任务按先进先出等待，某个租户占满时后面其他租户的任务可以先执行。通道之间互不占用名额。单进程时登记簿在本进程；开启 [Node 多进程](../cluster-runtime/module.md) 后登记簿只在主进程一份，所有 worker 经 IPC 申请 / 归还名额、查询任务是否还在排队或执行，全平台上限对全部进程生效。

## 文件清单 (File List)

- `generation-queue.module.ts` — Nest 模块入口，导出 `GenerationQueueService`。
- `entities/generation-queue.entity.ts` — 并发上限、上限读取函数、队列快照、排队票据、进程间消息名与保底上限。
- `services/generation-queue-core.ts` — 纯同步的排队登记簿与先进先出分配算法（单进程在服务里、多进程在主进程里）。
- `services/generation-queue-primary.ts` — 多进程时主进程上的排队消息处理器。
- `services/generation-queue.service.ts` — 业务使用的排队服务：单进程走本地登记簿，多进程 worker 走 IPC。
- `services/generation-queue.service.spec.ts` — 单进程排队、业务键状态、读取失败保底、租户让位、worker 退出回收与调高上限单测。

## 函数清单 (Function List)

- `GenerationQueueModule()` — 装配 AI 生成排队服务 | keywords: AI生成排队模块, 并发控制, generation-queue-module, concurrency-control
- `GENERATION_QUEUE_FALLBACK_LIMITS` — 上限读取失败时的保底值（全平台 4、租户 2） | keywords: 保底并发上限, 读取失败回退, fallback-concurrency-limits, resolver-failure-fallback
- `GenerationQueueTicket` — 排队票据：通道、租户键、可选业务键与持有进程 | keywords: 排队票据, 业务键, queue-ticket, business-key
- `GENERATION_QUEUE_MESSAGES` — 进程间消息名 `generation-queue.slot.acquire / grant / release`、`generation-queue.lane.updateLimits / queryKeys / querySnapshot`、`generation-queue.key.queryState` | keywords: 排队消息名, 进程间消息, queue-message-types, ipc-message
- `GenerationQueueCore()` — 排队登记簿与名额分配算法（纯同步） | keywords: 排队登记簿, 名额分配算法, queue-registry, slot-allocation
- `GenerationQueueCore.enqueue(ticket,limits)` — 登记等待票据并记下上报的上限，返回新拿到名额的票据 | keywords: 登记等待票据, 上报上限, enqueue-ticket, report-limits
- `GenerationQueueCore.updateLimits(lane,tenantKey,limits)` — 更新租户与全平台上限后重新分配 | keywords: 更新并发上限, 上限调整生效, update-lane-limits, apply-new-limits
- `GenerationQueueCore.release(ticketId)` — 归还执行中票据或撤掉等待票据，重复归还无副作用 | keywords: 归还名额, 撤销等待票据, release-ticket, cancel-waiting-ticket
- `GenerationQueueCore.releaseOwner(owner)` — 归还某 worker 持有的全部票据 | keywords: 回收进程名额, worker退出回收, release-owner-tickets, worker-exit-cleanup
- `GenerationQueueCore.stateOf(lane,key)` — 查询业务键是排队中、执行中还是不在队列 | keywords: 查询业务键状态, 跨进程存活确认, query-key-state, cross-process-liveness
- `GenerationQueueCore.activeKeys(lane)` — 列出排队与执行中的业务键 | keywords: 列出活跃业务键, 跨进程存活确认, list-active-keys, cross-process-liveness
- `GenerationQueueCore.snapshot(lane)` — 读取执行数与等待数 | keywords: 队列快照, 排队数量, queue-snapshot, waiting-count
- `GenerationQueueCore.drain(lane)` — 先进先出分配，全平台满即停、租户满跳过 | keywords: 分配执行名额, 先进先出, drain-generation-queue, fifo-order
- `GenerationQueueCore.removeTicket(lane,match)` — 移除票据并归还租户计数 | keywords: 移除票据, 归还租户计数, remove-ticket, return-tenant-count
- `GenerationQueueCore.applyLimits(lane,tenantKey,limits)` — 记录上限并规整为不小于 1 的整数 | keywords: 记录并发上限, 上限规整, apply-limits, normalize-limits
- `GenerationQueueCore.lane(name)` — 取通道状态，没有按保底上限新建 | keywords: 读取通道状态, 懒创建通道, get-core-lane, lazy-create-lane
- `createGenerationQueuePrimaryHandler()` — 主进程排队处理器：持有全局登记簿，处理申请 / 归还 / 上限更新 / 状态查询并通知拿到名额的 worker，worker 退出回收票据 | keywords: 主进程排队处理器, 全局排队登记簿, primary-queue-handler, global-queue-registry
- `GenerationQueueService()` — 业务使用的排队服务，单进程本地登记簿、多进程经 IPC | keywords: AI生成排队, 全平台并发上限, 租户并发上限, generation-queue, global-concurrency-limit, tenant-concurrency-limit
- `GenerationQueueService.registerLane(lane,resolveLimits)` — 注册通道与上限读取函数 | keywords: 注册生成通道, 并发上限读取, register-generation-lane, limits-resolver
- `GenerationQueueService.acquire(lane,tenantId?,key?)` — 申请执行名额（可带业务键），返回幂等的释放函数 | keywords: 申请执行名额, 排队等待, acquire-generation-slot, wait-in-queue
- `GenerationQueueService.run(lane,tenantId,task,key?)` — 排队拿到名额后执行任务，结束自动释放 | keywords: 排队执行任务, 自动释放名额, run-in-queue, auto-release-slot
- `GenerationQueueService.requestDrain(lane,tenantId?)` — 读取该租户最新上限上报并重新分配，后台调高上限后立即生效 | keywords: 重新分配名额, 上限调整生效, redistribute-slots, apply-new-limits
- `GenerationQueueService.activeState(lane,key)` — 全部进程范围内查询业务键状态 | keywords: 查询业务键状态, 跨进程存活确认, query-key-state, cross-process-liveness
- `GenerationQueueService.activeKeys(lane)` — 全部进程范围内列出活跃业务键 | keywords: 列出活跃业务键, 跨进程存活确认, list-active-keys, cross-process-liveness
- `GenerationQueueService.snapshot(lane)` — 全部进程范围内读取执行数与等待数 | keywords: 队列快照, 排队数量, queue-snapshot, waiting-count
- `GenerationQueueService.createRelease(ticketId)` — 生成只生效一次的释放函数 | keywords: 释放执行名额, 幂等释放, release-generation-slot, idempotent-release
- `GenerationQueueService.grantLocal(granted)` — 单进程时放行本地登记簿新分配的申请 | keywords: 本地分配通知, 放行等待申请, grant-local-tickets, resolve-waiting-acquire
- `GenerationQueueService.readLimits(lane,tenantId?)` — 读取并规整上限，失败用保底值 | keywords: 读取并发上限, 读取失败回退, read-concurrency-limits, resolver-failure-fallback
- `GenerationQueueService.tenantKeyOf(tenantId?)` — 租户键，平台作用域为 `__platform__` | keywords: 租户键, 平台作用域, tenant-key, platform-scope
- `GenerationQueueService.requireLane(lane)` — 读取已注册通道的上限读取函数，未注册报错 | keywords: 读取生成通道, 未注册报错, require-generation-lane, unregistered-lane-error

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| AI生成排队 | generation-queue |
| 全平台并发上限 | global-concurrency-limit |
| 租户并发上限 | tenant-concurrency-limit |
| 排队登记簿 | queue-registry |
| 主进程排队处理器 | primary-queue-handler |
| 申请执行名额 | acquire-generation-slot |
| 释放执行名额 | release-generation-slot |
| 先进先出 | fifo-order |
| 跨进程存活确认 | cross-process-liveness |
| worker退出回收 | worker-exit-cleanup |
| 上限调整生效 | apply-new-limits |
| 保底并发上限 | fallback-concurrency-limits |

## 类型导出 (Type Exports)

- `GenerationQueueLimits` — `{ globalLimit, tenantLimit }` 两级并发上限。
- `GenerationQueueLimitResolver` — `(tenantId?) => Promise<GenerationQueueLimits>`，业务注册通道时提供。
- `GenerationQueueSnapshot` — `{ running, waiting }` 通道当前执行与等待数。
- `GenerationQueueTicket` — 排队票据。

## 模块功能描述 (Module Feature Description)

**通道与上限**：业务模块在构造时 `registerLane(lane, resolveLimits)`，上限由业务自己读后台配置：

| 通道 | 注册方 | 业务键 | 全平台上限（后台平台信息） | 租户上限（后台租户） | 默认 |
|---|---|---|---|---|---|
| `xhs-article` | `XhsArticleGenerationService` | `租户ID:子选题ID` | `xhsArticleGlobalConcurrencyLimit` | `xhsArticleConcurrencyLimit` | 4 / 2 |
| `douyin-generation` | `DouyinGenerationJobService`（候选脚本与分镜任务） | 生成任务 ID | `douyinGenerationGlobalConcurrencyLimit` | `douyinGenerationConcurrencyLimit` | 6 / 3 |

**调度规则**（`GenerationQueueCore.drain`）：按进入顺序逐张看等待票据：全平台执行数达到上限就停；该票据租户已达租户上限就跳过它继续看后面的（避免一个租户堵住所有人）；否则放行。上限不在登记簿里读库：每次 `acquire` 由申请方先按租户读好上限随票据带来，登记簿记下「最新的全平台上限」与「每个租户的上限」；`requestDrain(lane, tenantId)` 由业务的状态轮询调用，读该租户最新上限上报后重新分配，后台调高上限后下一次轮询就补位。上限读取失败时记警告并用 `GENERATION_QUEUE_FALLBACK_LIMITS`，通道不会停摆；同一进程内的申请经 Promise 链串行进入队列，保持调用顺序。

**单进程与多进程**：服务在构造时判断 `isClusterWorker()`。单进程：登记簿就是服务自己持有的 `GenerationQueueCore`，同步分配后放行等待的申请。多进程：worker 发 `generation-queue.slot.acquire`（带票据与上限）给主进程，主进程上的 `createGenerationQueuePrimaryHandler` 用唯一一份 `GenerationQueueCore` 分配，给拿到名额的 worker 回 `generation-queue.slot.grant`；释放发 `generation-queue.slot.release`；`activeState` / `activeKeys` / `snapshot` 是请求 / 应答。worker 崩溃时主进程调 `releaseOwner` 回收它持有的全部票据，名额不会被死进程占住。业务用 `activeState` / `activeKeys` 判断任务是否还活着——多进程时任务可能在别的 worker 上，只看本进程集合会把它误判为中断。

**限制**：登记簿只在内存里，服务重启会丢失排队中的任务（各业务的中断收敛逻辑负责把它们置为失败）；只覆盖同一容器内的多进程，多容器 / 多机横向扩容需改为 Mongo / Redis 实现。模块不含对外接口；进程间消息只在进程内 IPC 管道里流转，外部不可达，不挂权限声明。
