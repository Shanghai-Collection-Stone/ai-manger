# 模块名称 (Module Name)

Node 多进程运行时（cluster-runtime）

## 概述 (Overview)

让后端以 Node `cluster` 多进程方式运行：主进程只负责跑一次启动迁移、派生 worker、转发进程间消息并持有需要全局唯一的状态（生成排队登记簿），不加载 Nest 应用；worker 各跑一份完整应用、共享 HTTP 端口。1 号 worker 为 leader，独占 SuperClaw gRPC 长连接与全部后台定时任务，其余 follower 只处理 HTTP 请求。`CLUSTER_WORKERS` 未设置或不大于 1 时整套逻辑不生效，按单进程运行（本地开发默认如此），单进程视为 leader。

## 文件清单 (File List)

- `entities/cluster-runtime.entity.ts` — 进程间消息信封、主进程处理器接口、进程角色、环境变量名与应答消息名。
- `services/cluster-role.ts` — 读取 worker 数、判断是否 worker / leader。
- `services/cluster-ipc.ts` — worker 侧进程间消息：订阅、发送（可指定转发给 leader / 全体）、请求主进程并等待应答。
- `services/cluster-primary.ts` — 主进程：启动前任务、派生与崩溃重派生、消息路由、优雅退出；worker 侧主进程断开即退出。
- `services/cluster-memory.ts` — 防 OOM：内存预算与每个 worker 的堆上限、worker 调高 OOM 分值、sharp 原生内存限制、内存上报与主进程告警。
- `services/cluster-memory.spec.ts` — 内存预算规划单测。

## 函数清单 (Function List)

- `ClusterEnvelope` — 进程间消息信封（消息名、内容、请求 ID、转发目标） | keywords: 进程间消息, 消息信封, cluster-envelope, ipc-message
- `ClusterPrimaryHandler` — 主进程消息处理器：认领消息名前缀，处理消息并在 worker 退出时回收资源 | keywords: 主进程消息处理, worker退出回收, primary-message-handler, worker-exit-cleanup
- `ClusterPrimaryApi` — 主进程处理器的发送能力：发给指定 worker、应答请求 | keywords: 主进程发送能力, 请求应答, primary-send-api, request-reply
- `ClusterRole` — 进程角色 `leader` / `follower` | keywords: 进程角色, 主工作进程, cluster-role, leader-worker
- `CLUSTER_ENV` — 进程数、角色、序号、实际 worker 总数的环境变量名 | keywords: 进程角色环境变量, worker序号, cluster-role-env, worker-index-env
- `CLUSTER_REPLY_TYPE` — 主进程应答消息名 `cluster-runtime.request.reply` | keywords: 请求应答消息, 进程间应答, request-reply-message, ipc-reply
- `readClusterWorkerCount()` — 读取 worker 数：正整数照用（上限 32），`auto` 按 CPU 核数，其余为 1（单进程） | keywords: 读取进程数, 多进程开关, read-cluster-workers, cluster-switch
- `isClusterWorker()` — 是否为多进程 worker | keywords: 判断worker进程, 进程间通道, is-cluster-worker, ipc-channel
- `readClusterRole()` — 读取进程角色，单进程视为 leader | keywords: 读取进程角色, 主工作进程, read-cluster-role, leader-worker
- `isLeaderProcess()` — 是否负责 gRPC 与后台定时任务 | keywords: 是否主工作进程, 后台任务归属, is-leader-process, background-task-owner
- `attachListener()` — worker 上挂一次消息监听并分发 | keywords: 挂载进程消息, 消息分发, attach-ipc-listener, message-dispatch
- `onClusterMessage(type,listener)` — 订阅主进程发来的某类消息，非 worker 忽略 | keywords: 订阅进程消息, 进程间通知, on-cluster-message, ipc-subscribe
- `sendClusterMessage(envelope)` — 向主进程发消息（`target` 为 leader / all 时由主进程转发） | keywords: 发送进程消息, 转发到主工作进程, send-cluster-message, forward-to-leader
- `requestPrimary(type,payload,timeoutMs?)` — 请求主进程并等待应答，超时报错 | keywords: 请求主进程, 进程间应答, request-primary, ipc-reply
- `CLUSTER_RESPAWN_DELAY_MS` — worker 意外退出后重新派生前等待 1 秒 | keywords: 重新派生延迟, 崩溃退避, respawn-delay, crash-backoff
- `CLUSTER_CRASH_LOOP_LIMIT` — 一分钟内意外退出超过 10 次判定崩溃循环，主进程退出交给容器重启 | keywords: 崩溃循环上限, 容器重启, crash-loop-limit, container-restart
- `CLUSTER_SHUTDOWN_TIMEOUT_MS` — 收到停止信号后最多等 worker 10 秒 | keywords: 优雅退出等待, 停止信号, graceful-shutdown-timeout, stop-signal
- `runClusterPrimary({workers,workerExecArgv?,beforeFork?,handlers})` — 主进程：跑启动前任务、按 `workerExecArgv`（堆上限）派生 worker（1 号 leader）、路由消息、崩溃按原序号与角色重派生、收到 SIGTERM / SIGINT 优雅退出 | keywords: 多进程主进程, 派生worker, 进程间转发, cluster-primary, fork-workers, ipc-routing
- `exitWhenPrimaryGone()` — worker 在主进程断开时自行退出，避免孤儿进程 | keywords: 主进程断开退出, 孤儿进程, exit-on-primary-disconnect, orphan-worker
- `ClusterMemoryPlan` — 内存规划：预算及来源、配置与实际 worker 数、每个 worker 的堆上限与 RSS 告警线 | keywords: 内存预算规划, 堆上限计算, memory-budget-plan, heap-limit-calc
- `ClusterMemoryReport` — worker 上报的内存用量（MB） | keywords: 内存用量上报, 内存监控, memory-usage-report, memory-monitoring
- `CLUSTER_HEAP_SHARE` — 预算里分给 V8 堆的比例 0.6，其余留给 Buffer 与 sharp 原生内存 | keywords: 堆内存占比, 原生内存余量, heap-share, native-memory-headroom
- `CLUSTER_HOST_MEMORY_SHARE` — 没有容器上限也没配置时按整机内存的 0.5 算预算 | keywords: 整机内存占比, 默认内存预算, host-memory-share, default-memory-budget
- `CLUSTER_MIN_HEAP_MB` — 每个 worker 堆上限下限 384MB，不够就减 worker | keywords: 最小堆上限, 自动减进程, min-worker-heap, auto-reduce-workers
- `CLUSTER_WORKER_OOM_SCORE_ADJ` — worker 的 OOM 分值调整 500 | keywords: OOM优先级, 优先杀worker, oom-score-adj, kill-worker-first
- `CLUSTER_MEMORY_REPORT_MS` — worker 每 30 秒上报一次内存 | keywords: 内存上报间隔, 内存监控, memory-report-interval, memory-monitoring
- `readPositiveIntEnv(name)` — 读取正整数环境变量 | keywords: 读取整数配置, 环境变量, read-int-env, env-config
- `resolveMemoryPlan(requestedWorkers)` — 预算取 `CLUSTER_MEMORY_BUDGET_MB` → 容器上限 → 整机一半；堆上限 = 预算 × 0.6 ÷ worker 数（256–4096MB，`WORKER_MAX_OLD_SPACE_MB` 可指定），低于 384MB 时减 worker | keywords: 内存预算规划, 堆上限计算, 自动减进程, memory-budget-plan, heap-limit-calc, auto-reduce-workers
- `raiseOwnOomScore()` — worker 把自己的 `oom_score_adj` 调到 500（仅 Linux） | keywords: OOM优先级, 优先杀worker, raise-oom-score, kill-worker-first
- `applySharpMemoryLimits()` — sharp 线程数按「核数 ÷ worker 数」（`SHARP_CONCURRENCY` 可覆盖），缓存 32MB / 10 文件 / 50 项 | keywords: 限制图片处理内存, sharp并发, limit-sharp-memory, sharp-concurrency
- `startMemoryReporting()` — worker 定时上报 RSS、堆已用 / 上限、外部与 ArrayBuffer 内存 | keywords: 上报内存用量, 内存监控, report-memory-usage, memory-monitoring
- `CLUSTER_MEMORY_REPORT_TYPE` — 内存上报消息名 `cluster-runtime.memory.report` | keywords: 内存上报消息, 进程间消息, memory-report-message, ipc-message
- `createMemoryWatchHandler(plan)` — 主进程内存看护：堆超上限 85% 或 RSS 超人均预算 90% 告警（每 worker 5 分钟一次），每 10 分钟汇总 | keywords: 内存看护, 内存告警, memory-watchdog, memory-alert

## 关键词索引 (Keyword Index)

| 中文 | English |
|---|---|
| 多进程主进程 | cluster-primary |
| 主工作进程 | leader-worker |
| 进程角色 | cluster-role |
| 多进程开关 | cluster-switch |
| 进程间消息 | ipc-message |
| 转发到主工作进程 | forward-to-leader |
| 请求主进程 | request-primary |
| 崩溃退避 | crash-backoff |
| 优雅退出等待 | graceful-shutdown-timeout |
| 后台任务归属 | background-task-owner |
| 内存预算规划 | memory-budget-plan |
| 堆上限计算 | heap-limit-calc |
| 优先杀worker | kill-worker-first |
| 限制图片处理内存 | limit-sharp-memory |
| 内存看护 | memory-watchdog |

## 类型导出 (Type Exports)

- `ClusterEnvelope` / `ClusterPrimaryHandler` / `ClusterPrimaryApi` / `ClusterRole` / `ClusterMemoryPlan` / `ClusterMemoryReport`。

## 模块功能描述 (Module Feature Description)

**开关与启动流程**：`src/main.ts` 的 `main()` 读 `CLUSTER_WORKERS`。大于 1 且是主进程时调用 `runClusterPrimary`：先跑一次 Mongo 迁移（`beforeFork`，避免 N 个进程同时迁移），再用 `cluster.fork` 派生 N 个 worker，写入 `CLUSTER_ROLE`（1 号 `leader`，其余 `follower`）与 `CLUSTER_WORKER_INDEX`。worker 进入 `bootstrap()`：跳过迁移、注册 `exitWhenPrimaryGone`、创建 Nest 应用并 `listen(3011)`——HTTP 端口由 Node cluster 在主进程上共享、轮询分发给各 worker；只有 leader 调 `connectMicroservice` 监听 SuperClaw gRPC（默认 50051），所以全部节点长连接都落在 leader。部署时在 compose 里设 `CLUSTER_WORKERS`（默认 2），本地 `start:dev` 不设即单进程。

**进程角色约定**：凡是「整个服务只能有一份」的后台工作，都用 `isLeaderProcess()` 守住，只在 leader 上跑：小红书抓取调度（xhs-topic-data）、选题与草稿清理（xhs-topic）、PixMax / 数眼视频生成轮询（douyin-workbench）、批量发布队列 worker（graph）、SuperClaw gRPC 与其空闲巡检（super-claw）。单进程时 `isLeaderProcess()` 恒为 true，行为不变。新增定时任务或进程内全局状态时必须按这个约定处理。

**进程间消息**：消息名一律 `<模块目录名>.<对象>.<动作>` 三段式。worker 发给主进程的消息先按前缀交给主进程处理器（目前只有 [生成排队](../generation-queue/module.md) 认领 `generation-queue.`）；没有处理器认领、且带 `target: 'leader' | 'all'` 的消息由主进程原样转发（SuperClaw 用 `super-claw.channel.notify` 把 follower 上的通道通知转给 leader）。请求 / 应答用 `requestId` 配对，应答名为 `cluster-runtime.request.reply`，默认 10 秒超时。这些消息只走进程内 IPC 管道，外部调用方不可达，按项目规则属于无需鉴权声明的内部入口。

**容错**：worker 意外退出时，主进程先通知各处理器回收它占用的资源（排队名额），1 秒后按原序号与角色重新派生（leader 挂了会重派生出新的 leader，期间 gRPC 节点会断线重连）；一分钟内意外退出超过 10 次视为崩溃循环，主进程退出交给容器重启。主进程收到 SIGTERM / SIGINT 时不再重派生，给全部 worker 发 SIGTERM，全部退出或 10 秒后退出。注意 `server/Dockerfile` 的 CMD 没有用 `exec`，`docker stop` 的信号先到 sh，会在超时后被强杀，与单进程时一致；`Dockerfile.prebuilt` / `Dockerfile.pure` 用了 `exec`，主进程能收到信号。

**防 OOM**：主进程启动时用 `resolveMemoryPlan` 定内存预算——优先 `CLUSTER_MEMORY_BUDGET_MB`，其次容器内存上限（`process.constrainedMemory()`，即 compose 的 `mem_limit`），都没有时取整机内存一半（同机还有 Mongo 等服务）。预算的 60% 平分给各 worker 作为 V8 堆上限（`--max-old-space-size`，经 `cluster.setupPrimary` 的 execArgv 下发，范围 256–4096MB），剩下 40% 留给代码、Buffer、sharp/libvips 等堆外内存；平分后低于 384MB 就自动少开 worker 并告警。这样内存泄漏或大请求只会让单个 worker 触顶自行崩溃、被主进程重拉，而不是把整台机器拖进内核 OOM。worker 启动时把自己的 `oom_score_adj` 调到 500（compose 里 Mongo 设为 -500），真到机器内存耗尽时内核先杀 worker，主进程与数据库活下来。sharp 是进程内单例，启动时把线程数限制为「核数 ÷ worker 数」、缓存压到 32MB，避免 N 个 worker 各开满核线程和缓存。worker 每 30 秒上报内存，主进程在堆超上限 85% 或 RSS 超人均预算 90% 时告警，每 10 分钟打一次汇总日志，便于据此调 worker 数或预算。堆上限管不住堆外内存，给应用容器设 `mem_limit` 后预算会自动跟随，且超限时内核在容器内只杀分值最高的 worker。

**代价与限制**：每个 worker 都加载完整应用，内存约按 worker 数成倍增长；MCP stdio 服务（如 DuckDuckGo 搜索）每个 worker 各启一份子进程。多进程只提升并发吞吐与抗阻塞能力，单个请求 / 单篇文章的耗时不会变短。这里只解决同一台机器、同一容器内的多进程；多容器 / 多机横向扩容时主进程里的登记簿不跨机，需另行把排队登记簿换成 Mongo / Redis 实现。
