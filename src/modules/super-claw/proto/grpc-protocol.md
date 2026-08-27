# SuperClaw gRPC 接入协议

本文是 SuperClaw 节点接入平台的规范性协议文档。当前稳定协议为 `superclaw.v1`。

协议的线格式以同目录的 `super-claw.proto` 为准，字段含义、调用时序、鉴权、错误处理和兼容性规则以本文为准。两者不一致时视为实现缺陷，不允许客户端自行猜测。

## 1. 协议范围

V1 同时处理 SuperClaw 节点控制面连接、平台主动任务推送与节点调用的平台数据面：

- 使用平台签发的节点 Token 鉴权。
- 注册或刷新一个节点实例的信息。
- 通过心跳维持在线状态并上报节点观测值。
- 从平台接收工作区槽位总量和已分配数量。
- 获取节点所辖租户的对话和工作区列表，并发起非流式 AI 对话。
- 节点建立双向任务通道后，租户任务按租户绑定、平台任务按工作区固定节点主动推送，投递携带该任务专用 Token。
- 通过 gRPC 创建、列出、读取、更新和删除任务。

V1 不包含工作区文件读写、文件迁移或租户改绑。租户默认节点变化和工作区迁移属于平台管理面；客户端不得把 `Register` 或 `Heartbeat` 理解为迁移指令。

## 2. 服务标识

| 项目           | 值                                             |
| -------------- | ---------------------------------------------- |
| Proto syntax   | `proto3`                                       |
| Package        | `superclaw.v1`                                 |
| Service        | `SuperClawGateway`                             |
| 完整服务名     | `superclaw.v1.SuperClawGateway`                |
| RPC 类型       | Unary RPC + 双向流 `OpenTaskChannel`           |
| 默认监听地址   | `0.0.0.0:50051`                                |
| 服务端地址配置 | `SUPER_CLAW_GRPC_URL`                          |
| 启用配置       | `SUPER_CLAW_GRPC_ENABLED`，设为 `false` 时关闭 |

默认配置未在 gRPC 进程内启用 TLS。生产环境必须通过受信网络、服务网格或 TLS 代理保护连接，禁止把明文端口直接暴露到公网。

## 3. 鉴权

每次 RPC 都必须携带平台为该 SuperClaw 节点签发的 Token。支持以下任一 metadata：

| Metadata key         | 值格式           | 推荐程度 |
| -------------------- | ---------------- | -------- |
| `authorization`      | `Bearer <token>` | 推荐     |
| `x-super-claw-token` | `<token>`        | 兼容     |

规则：

- metadata key 按 gRPC 规范使用小写 ASCII。
- 同时提供两种 metadata 时，服务端优先使用合法格式的 `authorization`。
- Token 与一个平台 SuperClaw 节点一一对应，身份以 Token 为准，客户端不提交 `super_claw_id`。
- Token 轮换后旧 Token 立即失效，客户端必须安全替换并重新注册。
- Token 是长期机密，不得写入日志、指标标签、错误信息或仓库。

任务接口使用第二层任务专用 Token：

- `OpenTaskChannel` 的 `TaskDispatch`、兼容接口 `DispatchTask` 和 `CreateTask` 返回的 `task_token` 只授权对应的单个任务。
- `GetTask`、`UpdateTask`、`DeleteTask` 必须同时提交 `tenant_id`、`task_id`、`task_token`。
- 服务端同时校验节点归属、租户、任务 ID 和任务 Token；任意一项不匹配均拒绝。
- `ListTasks` 仅依赖节点 Token 和租户归属，响应永不返回任何任务 Token。
- 任务 Token 不得复用为节点 Token，也不得用于访问其他任务。

## 4. 连接生命周期

1. 平台管理员创建 SuperClaw 节点，取得仅展示一次的 Token。
2. 节点启动后调用 `Register`。
3. 注册成功后，节点打开 `OpenTaskChannel`，收到 `hello` 后发送 `ready.available_slots=1`，表示当前执行器可接收一个任务。
4. 节点同时按响应中的 `heartbeat_interval_seconds` 调用 `Heartbeat`；心跳用于管理面在线状态，不负责领取任务。
5. 心跳连续中断超过 3 个建议间隔时，平台管理面将节点判定为离线。V1 当前建议间隔为 30 秒，因此当前离线判定窗口为约 90 秒。
6. 网络恢复、进程重启、Token 更新或实例信息发生变化后，节点应再次调用 `Register`，恢复心跳并重新建立任务通道。

`Register` 和 `Heartbeat` 都允许安全重试。重试不会新增平台节点；同一个 Token 始终定位到同一个 SuperClaw。并发请求采用服务端最后成功写入的信息。

建议客户端为 `Register` 设置 5 秒 deadline，为 `Heartbeat` 设置 3 秒 deadline，并使用带随机抖动的指数退避。客户端不得以低于服务端返回间隔的频率持续发送心跳。

## 5. RPC：Register

方法全名：`superclaw.v1.SuperClawGateway/Register`

用途：验证节点身份、登记当前运行实例，并将节点连接状态刷新为在线。

### RegisterRequest

| 字段          | tag | 类型     | 必填 | 约束与语义                                                                                                    |
| ------------- | --: | -------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `instance_id` |   1 | `string` | 是   | 当前进程或部署实例的稳定标识；去除首尾空白后不可为空。建议使用 UUID 或编排平台实例 ID。进程重建可以生成新值。 |
| `endpoint`    |   2 | `string` | 否   | 节点对外服务地址，仅用于登记和诊断；空字符串按未提供处理。V1 平台不会主动拨号该地址。                         |
| `version`     |   3 | `string` | 否   | SuperClaw 程序版本，建议使用 SemVer 或不可变构建版本；空字符串按未提供处理。                                  |

### RegisterResponse

| 字段                         | tag | 类型     | 语义                                                                          |
| ---------------------------- | --: | -------- | ----------------------------------------------------------------------------- |
| `super_claw_id`              |   1 | `string` | 平台节点 ID，仅用于日志关联和诊断，不作为后续鉴权凭据。                       |
| `registered`                 |   2 | `bool`   | `true` 表示本次注册已被接受。RPC 返回 OK 时当前恒为 `true`。                  |
| `capacity`                   |   3 | `int32`  | 平台配置的工作区槽位总数。每个实际绑定到此节点的工作区占用一个槽位。          |
| `allocated_capacity`         |   4 | `int32`  | 平台根据工作区绑定关系计算的已占用槽位，是调度与限额判断的权威值。            |
| `heartbeat_interval_seconds` |   5 | `int32`  | 服务端建议心跳间隔，客户端必须以响应值为准。                                  |
| `server_time`                |   6 | `string` | 服务端 UTC 时间，RFC 3339/ISO 8601 格式。仅用于诊断，不用于替代本地单调时钟。 |

示例请求：

```json
{
  "instanceId": "sc-prod-a-01",
  "endpoint": "https://superclaw-a.internal.example",
  "version": "1.4.2"
}
```

示例响应：

```json
{
  "superClawId": "66cabc1234567890abcdef12",
  "registered": true,
  "capacity": 100,
  "allocatedCapacity": 37,
  "heartbeatIntervalSeconds": 30,
  "serverTime": "2026-08-24T08:30:00.000Z"
}
```

## 6. RPC：Heartbeat

方法全名：`superclaw.v1.SuperClawGateway/Heartbeat`

用途：续期节点在线状态，并可更新实例标识和节点侧容量观测值。

节点必须先成功调用 `Register`。服务端当前会接受持有有效 Token 的心跳，但客户端不得依赖“用心跳代替注册”的实现细节。

### HeartbeatRequest

| 字段            | tag | 类型     | 必填 | 约束与语义                                                                                         |
| --------------- | --: | -------- | ---- | -------------------------------------------------------------------------------------------------- |
| `instance_id`   |   1 | `string` | 建议 | 应与最近一次注册一致。非空时服务端更新登记值；空字符串时保留原值。                                 |
| `used_capacity` |   2 | `int32`  | 是   | 节点自身观测到的已使用工作区槽位数，必须为非负整数。该值只用于监控和差异诊断，不参与平台限额计算。 |

由于 V1 使用 proto3 普通标量，省略 `used_capacity` 在线格式上等价于传入 `0`。客户端必须显式填写真实观测值。

### HeartbeatResponse

| 字段                 | tag | 类型     | 语义                                                   |
| -------------------- | --: | -------- | ------------------------------------------------------ |
| `accepted`           |   1 | `bool`   | `true` 表示心跳已接受。RPC 返回 OK 时当前恒为 `true`。 |
| `capacity`           |   2 | `int32`  | 平台配置的工作区槽位总数。                             |
| `allocated_capacity` |   3 | `int32`  | 平台计算的已占用工作区槽位数。                         |
| `server_time`        |   4 | `string` | 服务端 UTC 时间，RFC 3339/ISO 8601 格式。              |

`used_capacity` 与响应中的 `allocated_capacity` 不一致时，客户端只能记录告警，不得自行创建、删除或迁移工作区。平台值是控制面权威值，差异需要通过管理面处理。

示例请求：

```json
{
  "instanceId": "sc-prod-a-01",
  "usedCapacity": 37
}
```

示例响应：

```json
{
  "accepted": true,
  "capacity": 100,
  "allocatedCapacity": 37,
  "serverTime": "2026-08-24T08:30:30.000Z"
}
```

## 7. 租户对话与工作区

所有请求都必须提供 `tenant_id`，且该租户必须分配给当前节点 Token 对应的 SuperClaw。

| RPC                 | 请求重点                                                           | 响应与语义                                                                            |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `ListConversations` | `tenant_id`                                                        | 按更新时间倒序返回该租户全部会话元信息，不返回消息正文。                              |
| `StartConversation` | `tenant_id`、`input`；可选 `user_id`、`session_id`、`session_type`、`workspace_id` | 创建或续接工作区会话，执行一次非流式 AI 对话，返回 `session_id` 与助手文本。 |
| `ListWorkspaces`    | `tenant_id`                                                        | 仅返回同时匹配该租户与当前 SuperClaw 节点的工作区。容量字段单位为字节并使用 `int64`。 |

`session_type` 缺省为 `default`。`workspace_id` 提供时必须属于当前租户及节点，会话会固定记录该工作区。`user_id` 缺省时使用节点服务身份 `superclaw:<node-id>`。

## 8. 主动任务通道

方法全名：`superclaw.v1.SuperClawGateway/OpenTaskChannel`

这是节点发起连接、平台主动下发任务的双向流。租户到 SuperClaw 的归属只保存在平台数据库中，节点不得持久化租户列表，也不得遍历租户领取任务。平台仅从当前认证节点所辖租户中选择指派给已启用 `module=super_claw_data_tracking` Agent、状态为 `pending` 且未过 deadline 的最早任务。

工作区创建时序：

1. 平台创建工作区时写入 `super_claw_id`，状态为 `pending`：租户工作区使用租户唯一绑定节点；无 `tenant_id` 的平台工作区从在线且有剩余槽位的节点中选择。工作区一旦创建便固定到该节点。
2. 在线节点收到 `WorkspaceProvision`，按消息中的 `workspace_id`、`tenant_id`、名称和容量幂等创建本地工作区。
3. 节点返回 `workspace_ack`。成功后平台状态改为 `provisioned`；失败或超时保持 `pending`，节点重连后补发。
4. `capacity_bytes=0` 表示无上限；正整数表示该工作区独立字节容量。该值与节点的工作区槽位数不是同一单位。

单槽位任务时序：

1. 服务端先发送 `hello`，声明 ACK 超时和执行租约秒数。
2. 节点空闲时发送 `ready.available_slots=1`；本地仍在执行（含断线重连后仍在跑）时必须发送 `ready.available_slots=0`。
3. 服务端原子预留当前节点可执行的任务：租户任务必须属于节点所辖租户，平台任务必须绑定到该节点已 `provisioned` 的工作区。服务端为本次投递轮换任务 Token，并发送 `task`；平台任务的 `tenant_id` 为空字符串。
4. 节点把任务与 Token 仅保存在当前进程内存，立即发送 `ack`。服务端收到有效 ACK 后才把任务推进为 `in_progress`。
5. 执行期间节点按小于租约的间隔发送 `lease`；平台以自己的时间续期，客户端时间不参与授权判断。
6. 节点使用该次投递的 `task_token` 调用 `UpdateTask` 写入最终状态和结果，成功后发送 `completed`，平台才会推送下一条任务。

ACK 超时、执行租约超时或 NACK 时，平台将普通未完成任务恢复为 `pending`，清除投递归属并轮换任务 Token；已进入 `waiting_user` 的任务保持等待介入状态，直到用户回调或交互超时。旧执行器即使恢复也不能继续更新任务。

**流断开的处理与上述三种不同**（`1.5.0` 起）：平台不再立刻回收已 ACK 的投递，而是把它摘到保留区并保留一个完整执行租约（`hello.lease_seconds`，当前 120 秒）。语义与节点义务：

1. 节点**不应**因为流断开就中止本地执行；只有用户主动断开、修改连接配置、`UNAUTHENTICATED` / `INVALID_ARGUMENT` 这类不会自动重连的错误才必须中止。
2. 心跳失败不等于断线。`Heartbeat` 只有 3 秒 deadline，节点必须容忍数次连续失败后才按断线处理，否则一次网络抖动就会中断长时任务。
3. 节点重连后，`ready.available_slots` **必须如实反映**本地是否仍在执行：仍在跑时上报 `0`，空闲才上报 `1`。
4. 同一节点重连时，平台会把保留投递挂回新任务流；节点必须立即对保留投递补发一次 `lease`，并恢复续约心跳，之后 `lease` / `completed` 会照常匹配。
5. 保留租约内节点没有回来，平台才把任务恢复为 `pending` 并轮换 Token。
6. 若平台仍重投了同一 `task.id`（例如保留租约已到期），节点**必须**只把新的 `delivery_id` / `task_token` 换到正在执行的任务上并重新 `ack`，不得再启动一次执行。
7. 一个 `task.id` 同一时间只允许一次本机执行。节点若在 `ack` 前发现本机已有该任务在跑（连接层重建、进程重连都会出现这种情况），必须回 `nack{ reason: "TASK_ALREADY_RUNNING", retryable: true }` 拒收，既不 `ack` 也不启动，更不得写失败态把正在跑的执行判死。只有上次执行异常中断（进程重启留下的未结束记录）才允许重新启动。
8. 本地任务写完终态后，若期间换过任务流导致 `completed` 无法匹配，节点应补发一次 `ready.available_slots=1` 重新声明空槽。

同一任务被节点 `ack` 并开始执行的次数由平台累计。达到平台上限（当前 3 次）后平台停止重投，并把任务判为 `failed`，`abnormal_reason` 以 `SUPER_CLAW_REDELIVERY_EXHAUSTED:` 开头。

`TaskDispatch.attempt` 是平台累计第几次投递本任务，节点应把它连同 `delivery_id` 一起落到本地任务记录里 —— SuperClaw 节点界面的「长时任务」区据此标出被重复领取的任务。平台后台不提供长时任务查询页，执行过程只在节点本地可见。

`DispatchTask` 拉取路径不会领走主动推送已预留但未 ACK 的任务，两条路径不会重复领取同一条任务。

SuperClaw 不落盘保存租户路由、待领队列或任务 Token。允许持久化的业务数据是平台明确下发的工作区内容；本地目录使用平台 `workspace_id`，租户身份只用于隔离执行元数据。工作区归属以平台数据库中的“租户绑定节点 + 工作区 superClawId”为权威。

`DispatchTask` 保留为旧节点兼容接口，不再是推荐工作流。新客户端不得配置租户列表或轮询该接口。

## 9. 任务 CRUD

| RPC          | 鉴权                      | 语义                                                 |
| ------------ | ------------------------- | ---------------------------------------------------- |
| `CreateTask` | 节点 Token + 租户归属     | 必须指定已同步 `workspace_id`，建立或复用工作区会话并返回任务专用 Token。 |
| `ListTasks`  | 节点 Token + 租户归属     | 列出租户任务，可用 `status` 精确过滤；不返回 Token。 |
| `GetTask`    | 节点 Token + `task_token` | 获取 Token 唯一绑定的任务。                          |
| `UpdateTask` | 节点 Token + `task_token` | 更新任务字段，并可批量回传小红书结构化指标。         |
| `DeleteTask` | 节点 Token + `task_token` | 删除 Token 唯一绑定的任务。                          |
| `GetBrowserSession` | 节点 Token + `task_token` | 读取任务工作区、站点和 profile 对应的加密登录态。 |
| `UpsertBrowserSession` | 节点 Token + `task_token` | 加密保存 Playwright `storage_state_json`。 |
| `InvalidateBrowserSession` | 节点 Token + `task_token` | 删除已经失效的工作区登录态。 |
| `CreateTaskInteraction` | 节点 Token + `task_token` | 创建二维码或短回复执行节点，并把任务挂起等待介入。 |
| `GetTaskInteraction` | 节点 Token + `task_token` | 查询介入状态与用户回复。 |

任务状态只允许 `pending`、`in_progress`、`waiting_user`、`done`、`failed`、`cancelled`。`waiting_user` 在界面显示为“等待介入中”，只能由 `CreateTaskInteraction` 创建，不能直接通过 `UpdateTask` 设置。SuperClaw 执行任务必须同时具备 `workspace_id` 与 `session_id`；没有工作区的历史任务不会进入主动下发队列。任务 CRUD 的 `tenant_id` 在租户任务中为真实租户 ID，在平台任务中为空字符串；后者改为校验任务工作区是否固定在当前节点。`UpdateTask` 使用 proto3 `optional` 字段区分“不修改”与“写入空字符串”。

平台在每个下发 `Task` 中提供 `execution_guidance`，明确告知节点可按浏览器会话与二维码人工介入链路完成登录。为兼容尚未读取该新增字段的节点，同一指引也会附加在下发视图的 `ai_plan` 末尾；数据库中的原始 Todo `aiPlan` 不会被改写。

终态必须忠实表达执行结果：只有执行过程无错误且目标全部成功时才能写 `done`；任一目标失败，或发生超时、登录、鉴权、脚本、网络等错误时必须写 `failed`，不得因为流程已经停止或存在部分成功结果而写 `done`。写 `failed` 时必须同时提供语义化 `abnormal_reason`，用可读语言概括根因和影响范围；`task_result` 应说明成功数、失败数，并列出失败目标及原因，不能只保存错误码或原始堆栈。数据抓取 Agent 可将部分成功的帖子放入同一次 `xhs_stats`，与 `failed` 终态一起回写；服务端仍会校验所有计数为非负安全整数、热门评论最多保留 5 条，并记录有效数据的抓取运行和数据批次。

浏览器登录态与人工介入流程：

1. 节点执行浏览器任务前调用 `GetBrowserSession`。平台按任务的租户、`workspace_id`、`site`、`profile` 精确查找；找到时仅在该受鉴权响应中返回解密后的 Playwright `storage_state_json`。
2. 登录态有效时节点继续任务；登录成功或 Cookie 刷新后调用 `UpsertBrowserSession`。数据库只保存 AES-256-GCM 密文，密钥来自 `BROWSER_AUTH_ENCRYPTION_KEY`。
3. 登录态失效时节点先调用 `InvalidateBrowserSession`，再从浏览器取得二维码内容并调用 `CreateTaskInteraction(kind=qr_login)`。平台把任务置为 `waiting_user`，在“执行节点信息”时间轴显示二维码与“等待介入中”。简短确认使用 `kind=short_text`。
4. 等待期间节点继续发送 `lease`，并轮询 `GetTaskInteraction`，不得发送 `completed`，也不得把等待登录判成 `failed`。二维码、Cookie、用户回复均不得写入 Todo、任务结果或日志。
5. 用户在执行节点点击“已处理”后，平台把交互置为 `answered`。有效执行租约恢复为 `in_progress`；若节点已经断线或租约过期，则任务保持挂起直到回调，回调时轮换任务 Token 并恢复为 `pending` 重新投递。
6. 页面点击“已处理”后切回 Todo 的 `session_id` 对话；节点从 `GetTaskInteraction.response` 取得确认或短回复并继续原任务。

## 10. 周期数据抓取 Agent

平台启动时幂等确保存在 `SuperClaw 数据抓取 Agent`，模块标识为 `super_claw_data_tracking`。已发布小红书文章产生的周期采集任务会指派给该 Agent：租户任务通知租户绑定节点，平台任务通知文章库工作区的固定节点；无在线通道时任务保持 `pending`，等待节点重连后由平台推送。

周期计划默认生效14天，调度记录保存 `startAt` / `endAt`。每个到期点只创建一个 `auto_execute` 单次 Todo；该 Todo 完成后，调度行按抓取频率计算下一次到期时间并创建一个全新的 Todo，不会让同一个 Todo 周期运行或跨天反复采集。Todo 保存 `deadline=endAt` 只是保证单次执行不越过整个计划的硬截止时间。调度取消后不再下发，到达 `endAt` 后进入完成态，也不再创建新 Todo；超过 deadline 的 `xhs_stats` 回写返回 `FAILED_PRECONDITION / TASK_DEADLINE_EXPIRED`。

## 11. 错误处理

客户端必须先判断 gRPC status；非 `OK` 时不得使用响应消息中的默认值。

| gRPC status           | 稳定错误标识                                | 场景                                 | 客户端处理                             |
| --------------------- | ------------------------------------------- | ------------------------------------ | -------------------------------------- |
| `UNAUTHENTICATED`     | `INVALID_SUPER_CLAW_TOKEN`                  | Token 缺失、格式错误、已轮换或不存在 | 停止重试，刷新凭据后重新注册。         |
| `INVALID_ARGUMENT`    | `INSTANCE_ID_REQUIRED`                      | 注册请求缺少有效 `instance_id`       | 修正配置后重试。                       |
| `INVALID_ARGUMENT`    | `TENANT_ID_REQUIRED` / `INVALID_TENANT_ID`  | 租户参数缺失或格式错误               | 修正请求后重试。                       |
| `INVALID_ARGUMENT`    | `INVALID_TASK_ID` / `INVALID_TASK_STATUS`   | 任务参数非法                         | 修正请求后重试。                       |
| `INVALID_ARGUMENT`    | `USE_CREATE_TASK_INTERACTION`               | 试图通过 UpdateTask 直接写 waiting_user | 改用 CreateTaskInteraction。        |
| `INVALID_ARGUMENT`    | `DONE_TASK_CANNOT_HAVE_ABNORMAL_REASON`     | 已完成任务同时携带失败原因           | 改为 `failed`，并保留语义化失败原因。  |
| `INVALID_ARGUMENT`    | `FAILED_TASK_REASON_REQUIRED`               | 失败任务没有语义化失败原因           | 补充可读的 `abnormal_reason` 后重试。   |
| `INVALID_ARGUMENT`    | `INVALID_BROWSER_STORAGE_STATE`             | storageState 不是有效 JSON 或超过限制 | 修正浏览器会话后重试。              |
| `FAILED_PRECONDITION` | `TASK_NOT_RUNNING`                          | 非执行中任务请求人工介入             | 重新核对任务生命周期。                 |
| `INVALID_ARGUMENT`    | `XHS_POST_TITLE_REQUIRED` / `INVALID_XHS_*` | 帖子指标字段或计数非法               | 修正采集结果后重试。                   |
| `FAILED_PRECONDITION` | `TASK_DEADLINE_EXPIRED`                     | 抓取任务已超过硬截止时间             | 停止采集，不再回传帖子指标。           |
| `PERMISSION_DENIED`   | `TENANT_NOT_ASSIGNED_TO_SUPER_CLAW`         | 租户不属于当前节点                   | 停止调用并检查平台分配。               |
| `PERMISSION_DENIED`   | `INVALID_TASK_TOKEN`                        | Token、任务、租户或节点不匹配        | 停止调用并刷新任务上下文。             |
| `UNAVAILABLE`         | 无固定业务标识                              | 服务未启动、网络中断或服务暂时不可达 | 按退避策略重试。                       |
| `DEADLINE_EXCEEDED`   | 无固定业务标识                              | 请求超过客户端 deadline              | 按退避策略重试。                       |
| `INTERNAL`            | 无固定业务标识                              | 未预期服务端错误                     | 记录 request context，退避重试并告警。 |

稳定错误标识位于 gRPC error message。客户端可以用于诊断和分类，但不得解析自然语言错误文本。

## 12. 兼容性规则

`superclaw.v1` 的演进必须遵守以下规则：

- 已发布字段 tag 永不改变、永不复用；删除字段时必须在 `.proto` 中使用 `reserved` 保留字段号和名称。
- V1 只能新增可选请求字段、响应字段或新 RPC；不得改变已有字段类型、单位、必填性或语义。
- 客户端必须忽略未知响应字段；服务端必须接受缺失的新可选请求字段。
- 不得把字段改为含义不同但类型相同的新用途。
- 需要破坏性变更时新建 `superclaw.v2` package，并保留 V1 迁移窗口。
- 节点 `capacity` / `allocated_capacity` / `used_capacity` 的单位是“工作区槽位数”；工作区 `capacity_bytes` / `used_bytes` 的单位是字节，两类容量不得混用。
- 节点槽位数使用 `int32`；工作区字节数、任务 ID 和帖子指标使用 `int64`。Node.js 客户端必须按十进制字符串解码 `int64`，服务端写库前再校验帖子指标是非负安全整数。

## 13. 发布与变更流程

任何协议变更必须在同一个变更中完成：

1. 修改 `super-claw.proto`。
2. 修改本文档对应字段、时序或错误说明。
3. 更新服务端类型和实现。
4. 增加或更新兼容性测试。
5. 在本文版本记录中说明兼容性影响。

未经上述同步，不得把新字段或新行为用于生产客户端。

## 14. 本地联调

服务启用后，可以使用 `grpcurl` 调用。默认监听未配置 TLS，因此本地示例使用 `-plaintext`：

```bash
grpcurl -plaintext \
  -H "authorization: Bearer <super-claw-token>" \
  -import-path src/modules/super-claw/proto \
  -proto super-claw.proto \
  -d '{"instanceId":"sc-local-01","endpoint":"http://127.0.0.1:7000","version":"dev"}' \
  127.0.0.1:50051 superclaw.v1.SuperClawGateway/Register
```

```bash
grpcurl -plaintext \
  -H "authorization: Bearer <super-claw-token>" \
  -import-path src/modules/super-claw/proto \
  -proto super-claw.proto \
  -d '{"instanceId":"sc-local-01","usedCapacity":0}' \
  127.0.0.1:50051 superclaw.v1.SuperClawGateway/Heartbeat
```

旧节点兼容领取示例（新客户端应使用 `OpenTaskChannel`；`grpcurl` 不适合完整模拟双向流状态机）：

```bash
grpcurl -plaintext \
  -H "authorization: Bearer <super-claw-token>" \
  -import-path src/modules/super-claw/proto \
  -proto super-claw.proto \
  -d '{"tenantId":"<tenant-object-id>"}' \
  127.0.0.1:50051 superclaw.v1.SuperClawGateway/DispatchTask
```

抓取完成并回写任务与帖子指标示例：

```bash
grpcurl -plaintext \
  -H "authorization: Bearer <super-claw-token>" \
  -import-path src/modules/super-claw/proto \
  -proto super-claw.proto \
  -d '{"tenantId":"<tenant-object-id>","taskId":"42","taskToken":"<task-token>","status":"done","taskResult":"采集完成","xhsStats":[{"postTitle":"示例笔记","postUrl":"https://www.xiaohongshu.com/explore/...","likeCount":"128","commentCount":"16","collectCount":"32","viewCount":"2048","topComments":[{"content":"示例热门评论","likeCount":"9","replyCount":"2"}]}]}' \
  127.0.0.1:50051 superclaw.v1.SuperClawGateway/UpdateTask
```

抓取发生错误时，任务必须回写失败终态；若有部分成功数据，可在同一次请求中携带：

```bash
grpcurl -plaintext \
  -H "authorization: Bearer <super-claw-token>" \
  -import-path src/modules/super-claw/proto \
  -proto super-claw.proto \
  -d '{"tenantId":"<tenant-object-id>","taskId":"42","taskToken":"<task-token>","status":"failed","abnormalReason":"小红书会话未登录，1 篇笔记无法取得访问参数。","taskResult":"采集失败：成功 0 篇，失败 1 篇；NoteId 6a66d52f0000000001030c48：小红书会话未登录，无法取得访问参数。","xhsStats":[]}' \
  127.0.0.1:50051 superclaw.v1.SuperClawGateway/UpdateTask
```

## 15. 版本记录

| 协议版本       | 文档版本 | 日期       | 变更                                                                   |
| -------------- | -------- | ---------- | ---------------------------------------------------------------------- |
| `superclaw.v1` | `1.0.0`  | 2026-08-24 | 固化 Token 鉴权、注册、心跳、容量语义、错误分类和兼容性规则。          |
| `superclaw.v1` | `1.1.0`  | 2026-08-25 | 新增租户对话、工作区、任务下发、任务 Token CRUD 与专用数据抓取 Agent。 |
| `superclaw.v1` | `1.2.0`  | 2026-08-25 | 新增平台主动任务双向流、ACK/租约/断线回收与无状态执行器约束。          |
| `superclaw.v1` | `1.3.0`  | 2026-08-25 | 新增租户绑定节点的工作区创建下发、容量语义及任务工作区/会话绑定。      |
| `superclaw.v1` | `1.4.0`  | 2026-08-25 | 支持平台级工作区选择空闲节点并按固定工作区主动推送平台任务。          |
| `superclaw.v1` | `1.5.0`  | 2026-08-26 | 断线保留已 ACK 投递并支持重连挂回；心跳容忍、真实空槽上报、重投续用与重复领取封顶。 |
| `superclaw.v1` | `1.5.1`  | 2026-08-26 | 明确任务成功与失败互斥终态，以及失败原因和部分成功数据的单次回写语义。 |
| `superclaw.v1` | `1.6.0`  | 2026-08-26 | 新增加密浏览器会话复用、等待介入状态、二维码/短回复执行节点与任务恢复回调。 |
| `superclaw.v1` | `1.6.1`  | 2026-08-26 | 任务下发新增 `execution_guidance`，并向兼容节点的 `ai_plan` 注入二维码登录介入链路。 |
