# 模块名称 (Module Name)

模型并发上限（model-concurrency）

## 概述 (Overview)

按「提供商 + 模型」限制全平台并发：一个模型同时在跑的任务数不超过后台设的上限，所有租户、所有工作流用到这个模型都算在里面；超出的任务排队，有空位后按先来先到交回业务提交。上限、名额与排队都存在 Mongo 里，多进程、重启后按同一份数据算。目前只有抖音生视频接入（见 [douyin-workbench](../douyin-workbench/module.md) 的 `DouyinVideoQueueService`）；没设上限的模型不限。与 [generation-queue](../generation-queue/module.md) 的区别：那边是进程内存里按业务通道 + 租户限并发，适合几分钟内结束的生成；这里按模型、持久化，适合提交给外部模型后要跑很久的任务。

## 文件清单 (File List)

- `model-concurrency.module.ts` — Nest 模块入口，导出 `ModelConcurrencyService`。
- `entities/model-concurrency.entity.ts` — 上限、名额、排队三类记录，模型标识、业务回调、概览类型与间隔 / 保护期 / 最大上限常量。
- `services/model-concurrency.service.ts` — 申请名额、排队、归还、排队位置、上限读写与概览；主进程定时回收名额并派发排队任务。
- `services/model-concurrency.service.spec.ts` — 不限放行、满了排队不插队、重复申请、模型互不占用、回收后先来先到派发、业务不用提交时归还、调高上限放行多个、保护期回收与补回排队登记单测。
- `controller/model-concurrency-admin.controller.ts` — 平台后台 `admin/model-concurrency` 接口。
- `controller/model-concurrency.dto.ts` — 设置上限的参数校验。

## 函数清单 (Function List)

- `ModelConcurrencyModule()` — 装配模型并发上限与持久化排队 | keywords: 模型并发模块, 超出排队, model-concurrency-module, queue-when-full
- `ModelConcurrencyLimitEntity` — 上限设置（`model_concurrency_limits`），按提供商 + 模型唯一，没有记录表示不限 | keywords: 模型并发上限, 全平台共用, model-concurrency-limit, platform-wide-limit
- `ModelConcurrencySlotEntity` — 名额（`model_concurrency_slots`），有上限时 `slot` 为序号、靠 `key + slot` 唯一索引防超额，不限时为 `free:<holder>` | keywords: 模型名额, 名额登记, model-slot, slot-ledger
- `ModelConcurrencyWaiterEntity` — 排队（`model_concurrency_waiters`），按 `enqueuedAt` 先来先到 | keywords: 模型排队, 先来先到, model-waiter, fifo-order
- `ModelConcurrencyTarget` — 要限并发的模型：提供商记录 ID + 模型编码 | keywords: 限流模型, 提供商模型, concurrency-target, provider-model
- `ModelConcurrencyKind` — 业务注册的任务种类：`dispatch` 提交排队任务、`inspect` 告诉哪些任务还占着模型 | keywords: 排队任务种类, 业务提交回调, concurrency-kind, dispatch-handler
- `ModelConcurrencyUsage` — 一个模型的上限、执行数与排队数 | keywords: 模型并发概览, 排队数量, model-concurrency-usage, waiting-count
- `MODEL_CONCURRENCY_TICK_MS` — 主进程检查名额与排队的间隔（5 秒） | keywords: 排队检查间隔, 派发周期, model-concurrency-tick-ms, dispatch-interval
- `MODEL_CONCURRENCY_SLOT_GRACE_MS` — 查不到任务的名额保留 10 分钟才回收 | keywords: 名额保护期, 提交中保护, slot-grace-ms, submitting-grace
- `MODEL_CONCURRENCY_MAX_LIMIT` — 后台能设的最大上限（100） | keywords: 并发上限最大值, 上限校验, max-concurrency-limit, limit-validation
- `isDuplicateKey(error)` — 判断 Mongo 唯一索引冲突 | keywords: 唯一索引冲突, 名额已被占, is-duplicate-key, slot-taken
- `ModelConcurrencyService()` — 按提供商 + 模型限全平台并发，超出排队 | keywords: 模型并发限制, 超出排队, 全平台并发上限, model-concurrency, queue-when-full, platform-concurrency-limit
- `ModelConcurrencyService.constructor(db)` — 初始化上限、名额与排队集合 | keywords: 初始化并发服务, 名额集合, init-model-concurrency, slot-collections
- `ModelConcurrencyService.onModuleInit()` — 建索引，主进程上启动定时回收与派发 | keywords: 启动排队派发, 建立名额索引, start-concurrency-dispatch, ensure-slot-indexes
- `ModelConcurrencyService.onModuleDestroy()` — 停止定时派发 | keywords: 停止排队派发, 模块销毁, stop-concurrency-dispatch, module-destroy
- `ModelConcurrencyService.ensureIndexes()` — 上限按模型唯一、名额 `key + slot` 唯一、排队按任务唯一 | keywords: 建立名额索引, 唯一约束, ensure-slot-indexes, unique-constraint
- `ModelConcurrencyService.keyOf(target)` — 名额与排队的分组键 `providerId:model` | keywords: 模型键, 名额分组, model-key, slot-group
- `ModelConcurrencyService.registerKind(kind,handler)` — 业务注册任务种类 | keywords: 注册排队任务种类, 业务提交回调, register-concurrency-kind, dispatch-handler
- `ModelConcurrencyService.readLimit(target)` — 读上限，没设返回 null | keywords: 读取并发上限, 未设置不限, read-concurrency-limit, unlimited-when-unset
- `ModelConcurrencyService.setLimit(target,limit,updatedBy?)` — 设置或清除上限 | keywords: 设置并发上限, 清除上限, set-concurrency-limit, clear-limit
- `ModelConcurrencyService.overview()` — 列出设了上限、正在跑或排队的模型 | keywords: 模型并发概览, 排队数量, list-concurrency-usage, waiting-count
- `ModelConcurrencyService.admit(kind,target,holder)` — 提交前申请名额：不限直接放行；有上限时前面没人排队且有空位才放行，否则登记排队返回 false；重复申请不重复占 | keywords: 申请模型名额, 满了排队, admit-model-slot, queue-when-full
- `ModelConcurrencyService.ensureWaiting(kind,target,holder,enqueuedAt)` — 补回丢了的排队登记，已拿到名额的不补 | keywords: 补回排队登记, 中断恢复, ensure-waiting, recover-lost-waiter
- `ModelConcurrencyService.release(holder)` — 归还名额并撤掉排队，重复调用无副作用 | keywords: 归还模型名额, 撤销排队, release-model-slot, cancel-waiting
- `ModelConcurrencyService.positions(holders)` — 排队任务前面还有几个 | keywords: 查询排队位置, 前面还有几个, query-queue-position, waiting-ahead
- `ModelConcurrencyService.tick()` — 主进程一轮：先回收再派发，不重入 | keywords: 排队派发一轮, 回收名额, concurrency-tick, reclaim-slots
- `ModelConcurrencyService.reclaim()` — 业务说已结束的立即回收，查不到的过保护期回收 | keywords: 回收已结束名额, 名额保护期, reclaim-finished-slots, slot-grace
- `ModelConcurrencyService.drain()` — 按排队先后派发，某模型满了就跳过它后面同模型的，其余模型照常 | keywords: 派发排队任务, 先来先到, drain-model-queue, fifo-order
- `ModelConcurrencyService.dispatch(handler,holder)` — 交给业务提交，失败或不用提交时归还名额 | keywords: 提交排队任务, 失败归还名额, dispatch-waiting-task, release-on-failure
- `ModelConcurrencyService.tryAcquire(kind,key,holder,limit)` — 已用数没到上限时从 0 起找空序号插入，唯一索引冲突就试下一个 | keywords: 占用名额, 唯一索引防超额, acquire-slot, unique-index-guard
- `ModelConcurrencyService.takeFreeSlot(kind,key,holder)` — 不限时登记统计用名额 | keywords: 登记统计名额, 不限并发, take-free-slot, unlimited-concurrency
- `ModelConcurrencyAdminController()` — 平台后台模型并发接口 | keywords: 模型并发后台接口, 平台配置, model-concurrency-admin-controller, platform-setting
- `ModelConcurrencyAdminController.list()` — `GET admin/model-concurrency` | keywords: 模型并发列表接口, 排队数量, list-model-concurrency-api, waiting-count
- `ModelConcurrencyAdminController.save(req,body)` — `PUT admin/model-concurrency`，`limit` 为空表示不限 | keywords: 设置并发上限接口, 清除上限, set-model-concurrency-api, clear-limit
- `ModelConcurrencyAdminController.requireUser(req)` — 读取后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `SetModelConcurrencyLimitDto()` — 校验提供商 ID、模型与 1～100 的上限（可为 null） | keywords: 设置并发上限参数, 清除上限, set-concurrency-limit-dto, clear-limit

## 关键词索引 (Keyword Index)

| 中文           | English                    |
| -------------- | -------------------------- |
| 模型并发限制   | model-concurrency          |
| 全平台并发上限 | platform-concurrency-limit |
| 超出排队       | queue-when-full            |
| 申请模型名额   | admit-model-slot           |
| 归还模型名额   | release-model-slot         |
| 模型名额       | model-slot                 |
| 模型排队       | model-waiter               |
| 先来先到       | fifo-order                 |
| 唯一索引防超额 | unique-index-guard         |
| 回收已结束名额 | reclaim-finished-slots     |
| 名额保护期     | slot-grace                 |
| 查询排队位置   | query-queue-position       |
| 设置并发上限   | set-concurrency-limit      |
| 排队任务种类   | concurrency-kind           |

## 类型导出 (Type Exports)

- `ModelConcurrencyLimitEntity` / `ModelConcurrencySlotEntity` / `ModelConcurrencyWaiterEntity`。
- `ModelConcurrencyTarget` / `ModelConcurrencyKind` / `ModelConcurrencyUsage`。
- `SetModelConcurrencyLimitDto`。

## 模块功能描述 (Module Feature Description)

**上限**：后台「工作流节点模型」页的生视频节点指定模型后出现「并发上限」，`PUT admin/model-concurrency` 按 `providerId + model` 保存（1～100，留空清除即不限）。同一模型不管被哪个节点、哪个租户用，都共用这一个上限。`GET admin/model-concurrency` 返回每个模型的上限、正在跑（名额数）与排队数。两个接口都挂 `AiProvider` 权限（平台 AI 配置，仅超管）。

**申请与排队**（`admit`）：业务在扣费、提交前申请。没设上限：写一条 `free:<任务ID>` 名额（只为统计，之后设了上限也能算上在跑的）直接放行。设了上限：同一模型前面有人排队就直接排到后面（不插队）；否则已用名额没到上限时从序号 0 起找空位插入，`key + slot` 唯一索引保证多个进程同时申请也不会超额；都没拿到就写一条排队记录返回 false，业务据此把任务存成排队状态。

**回收与派发**（主进程每 5 秒 `tick`）：先回收——按任务种类调业务的 `inspect`，已结束的任务立即归还名额；查不到的任务（刚拿到名额、业务记录还没写好）保留 10 分钟才回收。再派发——按排队先后逐个看，某个模型拿不到名额就跳过它后面同模型的任务，其他模型照常；拿到名额后先撤掉排队记录，再后台调业务的 `dispatch` 提交，`dispatch` 返回 false 或报错时归还名额。调高上限后下一轮就放行；调低上限不会打断已经在跑的任务，只是新任务要等降到上限以下。

**限制**：名额回收依赖业务 `inspect` 判断任务是否结束，结束到放出名额最多晚 5 秒。上线前已经在跑的任务没有名额记录，设上限后的第一批会多算一些空位。主进程派发中途退出时排队记录可能已撤、任务还没提交，由业务巡检用 `ensureWaiting` 补回。
