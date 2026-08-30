# 模块名称 (Module Name)

SuperClaw 平台接入模块（super-claw）

## 概述 (Overview)

为平台专属 SuperClaw 提供节点管理、一次性 Token 签发与轮换、gRPC 注册/心跳、租户对话、工作区创建下发、平台主动任务推送、任务 Token CRUD、浏览器登录态复用和任务人机交互。平台数据库保存租户到节点的唯一归属：一个租户只绑定一个节点，但可在该节点下拥有多个独立容量工作区。工作区创建先落库为 `pending`，再通过 `OpenTaskChannel` 下发给绑定节点；节点 ACK 后转为 `provisioned`。Todo 必须携带 `workspaceId/sessionId`，且只会下发到已同步工作区所属节点。

浏览器任务通过任务 Token 读取或更新 `browser-auth` 模块按租户、工作区、站点隔离并加密保存的 Playwright `storageState`。登录态失效时，节点可创建 `qr_login` 或 `short_text` 交互，把 Todo 置为 `waiting_user`；节点保持执行租约并轮询交互结果，用户回调后恢复执行。Cookie、二维码与回复不进入 Todo 结果和日志。

SuperClaw 容量采用工作区槽位数：`capacity` 是节点最多可承载的工作区数量，`allocatedCapacity` 是当前工作区数量。每创建一个工作区原子占用 1 个槽位，删除时释放；更换租户节点会把该租户全部工作区整体迁移并按工作区数量检查目标节点容量。`Workspace.capacityBytes/usedBytes` 仍是独立的网盘字节配额，不与节点槽位混用。

长时任务防重复领取：节点断线时**已 ACK** 的投递不再立刻退回 `pending`，而是摘到保留区（`detachedDeliveries`）保留一个租约时长；同一节点重连会把保留投递挂回新任务流，节点续约后继续跑本地任务，不会被重投而重复启动抓取。节点确实不再回来时由保留租约到期回收。同一任务被节点 ACK 并开始执行的次数由 `Todo.taskExecutionAttempts` 记录，达到 `SUPER_CLAW_MAX_DISPATCH_ATTEMPTS` 后平台停止重投并把任务判为 `failed`。

长时任务的查看入口**不在本平台后台**，而在 SuperClaw 节点自己的界面（`super-claw` 仓库 `public/` 的「长时任务」区）：节点执行、事件流和对话都在节点本地，平台侧只保留投递与租约状态。平台通过 `SuperClawTaskDispatch.attempt` 把"第几次投递"带给节点，节点据此在本地页面标出被重复领取的任务。

## 文件清单 (File List)

- `super-claw.module.ts` — NestJS 模块入口，装配后台管理、gRPC 控制器、Token 守卫和服务。
- `super-claw-grpc.options.ts` — gRPC 监听、协议路径与 proto-loader 启动配置。
- `controller/super-claw-admin.controller.ts` — 平台节点 CRUD、Token 轮换、租户节点归属和工作区迁移接口。
- `controller/super-claw-grpc.controller.ts` — SuperClaw 注册、心跳、租户对话、工作区与任务 gRPC 入口。
- `controller/super-claw.dto.ts` — 节点和租户配额请求体校验。
- `entities/super-claw.entity.ts` — 节点实体、后台安全视图与 gRPC 消息类型。
- `entities/super-claw-grpc.entity.ts` — 租户对话、工作区、任务下发与任务 Token CRUD 消息类型。
- `guards/super-claw-token.guard.ts` — 从 gRPC metadata 校验平台签发 Token 并注入节点身份。
- `services/super-claw.service.ts` — 节点、密钥、连接状态、容量原子预留和租户分配逻辑。
- `services/super-claw-gateway.service.ts` — 节点租户隔离、对话调用、工作区查询、任务原子领取与任务 Token CRUD。
- `services/super-claw-task-channel.service.ts` — 维护平台主动推送双向流、单槽位投递、ACK、执行租约、断线摘挂与 Token 轮换。
- `proto/super-claw.proto` — `superclaw.v1.SuperClawGateway` 服务协议。
- `proto/grpc-protocol.md` — gRPC 鉴权、调用时序、字段语义、错误处理和兼容性基线文档。

## 函数清单 (Function List)

- `SuperClawModule()` — 装配节点管理、gRPC 接入、守卫与服务 | keywords: 节点模块, 平台接入, node-module, platform-onboarding
- `SuperClawService({ db,adminService })` — 提供节点、令牌、连接、专用 Agent 和工作区槽位能力 | keywords: 节点服务, 工作区容量, node-service, workspace-capacity
- `SuperClawTokenGuard({ superClawService })` — 校验 gRPC metadata Token | keywords: 令牌守卫, 元数据鉴权, token-guard, metadata-authentication
- `SuperClawGrpcController({ superClawService,gatewayService,taskChannelService })` — 暴露控制面与租户数据面 gRPC 入口 | keywords: gRPC控制器, 节点接入, grpc-controller, node-onboarding
- `SuperClawGatewayService({ superClawService,contextService,chatService,todoService,xhsPostStatService,adminService,moduleRef,browserSessions,browserInteractions })` — 提供租户对话、工作区、任务、浏览器会话与人机交互能力 | keywords: SuperClaw数据面, gRPC任务服务, super-claw-data-plane, grpc-task-service
- `SuperClawTaskChannelService({ gatewayService,superClawService })` — 维护节点双向任务流及服务端投递租约 | keywords: 主动任务通道, 服务端任务租约, active-task-channel, server-task-lease
- `SuperClawTaskChannelService.notifyTenant(tenantId)` — 新任务入队时通知租户所属在线节点 | keywords: 通知租户新任务, 事件驱动推送, notify-tenant-task, event-driven-push
- `SuperClawTaskChannelService.notifyWorkspace(workspaceId)` — 按平台工作区固定节点触发任务推送 | keywords: 通知工作区任务, 平台任务推送, notify-workspace-task, platform-task-push
- `SuperClawTaskChannelService.notifyWorkspaceProvision(workspace)` — 工作区落库后通知绑定节点创建，离线时等待补发 | keywords: 通知创建工作区, 离线补发, notify-workspace-provision, offline-provision-replay
- `SuperClawTaskChannelService.openTaskChannel(superClawId,call)` — 注册节点任务流并替换同节点旧连接 | keywords: 打开任务通道, 替换旧连接, open-task-channel, replace-stale-channel
- `SuperClawTaskChannelService.handleMessage(state,message)` — 串行处理 Ready、ACK、NACK、租约与完成消息 | keywords: 处理通道消息, 串行协议状态, handle-channel-message, serialized-protocol-state
- `SuperClawTaskChannelService.pushNext(state)` — 从平台所辖租户中预留并推送下一任务 | keywords: 推送下一任务, 平台租户路由, push-next-task, platform-tenant-routing
- `SuperClawTaskChannelService.flushWorkspaceProvisions(state)` — 节点上线后补发全部 pending 工作区 | keywords: 补发待创建工作区, 节点上线同步, flush-pending-workspaces, node-online-sync
- `SuperClawTaskChannelService.sendWorkspaceProvision(state,workspace)` — 下发单个工作区创建命令并等待 ACK | keywords: 下发工作区创建, 等待节点确认, send-workspace-provision, await-node-ack
- `SuperClawTaskChannelService.matchDelivery(state,deliveryId,taskId)` — 校验消息匹配当前内存投递 | keywords: 匹配任务投递, 防止串线, match-task-delivery, prevent-cross-delivery
- `SuperClawTaskChannelService.armLeaseTimer(state,delivery)` — 重置任务租约超时回收计时器 | keywords: 重置租约计时, 超时回收, reset-lease-timer, timeout-reclaim
- `SuperClawTaskChannelService.releaseDelivery(state,delivery,reason)` — 释放投递并轮换旧任务 Token | keywords: 释放通道投递, 轮换旧令牌, release-channel-delivery, rotate-stale-token
- `SuperClawTaskChannelService.removeDelivery(state,deliveryId)` — 清理单条投递的计时器与内存状态 | keywords: 清理投递状态, 释放计时器, clear-delivery-state, release-timer
- `SuperClawTaskChannelService.closeChannel(state,reason)` — 关闭流：未 ACK 投递立刻回收，已执行投递摘下保留 | keywords: 关闭任务通道, 断线保留租约, close-task-channel, keep-lease-on-disconnect
- `SuperClawTaskChannelService.detachDelivery(superClawId,delivery)` — 摘下执行中投递并按租约安排兜底回收 | keywords: 摘下执行中投递, 保留租约回收, detach-running-delivery, retained-lease-reclaim
- `SuperClawTaskChannelService.adoptDetachedDeliveries(state)` — 节点重连后把保留投递挂回新任务流并立即续约 | keywords: 挂回执行中投递, 重连续跑, adopt-detached-delivery, resume-after-reconnect
- `SuperClawTaskChannelService.onModuleInit()` — 启动空闲通道巡检定时器 | keywords: 启动空闲巡检, 兜底唤醒, start-idle-sweep, fallback-wakeup
- `SuperClawTaskChannelService.onModuleDestroy()` — 停止空闲通道巡检定时器 | keywords: 停止空闲巡检, 定时器清理, stop-idle-sweep, timer-cleanup
- `SuperClawTaskChannelService.sweepIdleChannels()` — 周期性给空闲在线通道补一次推送机会 | keywords: 巡检空闲通道, 补发推送机会, sweep-idle-channels, retry-push-window
- `SuperClawTaskChannelService.failChannel(state,error)` — 记录协议异常并安全关闭任务流 | keywords: 通道异常处理, 安全关闭, channel-error-handling, safe-close
- `SuperClawTaskChannelService.nextLeaseExpiry()` — 按服务端时间计算下一租约截止 | keywords: 计算租约截止, 服务端时间, calculate-lease-expiry, server-time
- `SUPER_CLAW_MAX_DISPATCH_ATTEMPTS` — 同一任务允许被节点 ACK 执行的最大次数 | keywords: 重复领取上限, 重投封顶, max-execution-attempts, redelivery-cap
- `SUPER_CLAW_BROWSER_INTERVENTION_GUIDANCE` — 随任务下发二维码登录、等待回调和会话复用指引 | keywords: 二维码登录指引, 任务介入链路, qr-login-guidance, task-intervention-flow
- `SuperClawGatewayService.listConversations(superClawId,request)` — 返回节点所辖租户对话 | keywords: 获取租户对话, 节点会话列表, list-tenant-conversations, node-session-list
- `SuperClawGatewayService.startConversation(superClawId,request)` — 发起租户非流式 AI 对话 | keywords: 发起gRPC对话, 租户AI回复, start-grpc-conversation, tenant-ai-response
- `SuperClawGatewayService.listWorkspaces(superClawId,request)` — 返回节点租户工作区 | keywords: 获取租户工作区, gRPC工作区, list-tenant-workspaces, grpc-workspaces
- `SuperClawGatewayService.dispatchTask(superClawId,request)` — 原子领取专用数据抓取任务 | keywords: 下发数据抓取任务, 原子领取, dispatch-data-task, atomic-claim
- `SuperClawGatewayService.reserveTaskDelivery(superClawId,input)` — 从节点所辖租户的已同步工作区中预留主动推送任务 | keywords: 预留主动推送任务, 服务端租户选择, reserve-active-push-task, server-tenant-selection
- `SuperClawGatewayService.acknowledgeTaskDelivery(superClawId,input)` — 确认投递并启动平台任务租约 | keywords: 确认主动推送, 启动任务租约, acknowledge-active-push, start-task-lease
- `SuperClawGatewayService.renewTaskDelivery(superClawId,input)` — 续期节点执行中的服务端租约 | keywords: 续期主动任务, 执行租约心跳, renew-active-task, execution-lease-heartbeat
- `SuperClawGatewayService.releaseTaskDelivery(superClawId,input)` — 回收投递并失效旧任务 Token | keywords: 释放主动任务, 失效任务令牌, release-active-task, invalidate-task-token
- `SuperClawGatewayService.isTaskDeliveryComplete(superClawId,input)` — 释放执行槽位前确认任务已经写入终态 | keywords: 确认任务终态, 防止提前完成, confirm-task-terminal, prevent-early-completion
- `SuperClawGatewayService.failNonTerminalDelivery(superClawId,input)` — 节点报告完成但任务未到终态时判为 failed 防止重新领取 | keywords: 标记未终态任务失败, 防止异常重投, fail-non-terminal-delivery, prevent-abnormal-redelivery
- `SuperClawGatewayService.createTask(superClawId,request)` — 节点创建任务并取得 Token | keywords: gRPC创建任务, 返回任务令牌, create-grpc-task, return-task-token
- `SuperClawGatewayService.listTasks(superClawId,request)` — 租户任务列表不暴露 Token | keywords: 列出租户任务, 隐藏令牌, list-tenant-tasks, hide-tokens
- `SuperClawGatewayService.getTask(superClawId,request)` — 使用 Token 获取单个任务 | keywords: 获取令牌任务, 单任务读取, get-token-task, single-task-read
- `SuperClawGatewayService.updateTask(superClawId,request)` — 使用 Token 更新任务状态与结果，并在终态落库后归属批量采集数据 | keywords: 更新令牌任务, 任务状态回写, update-token-task, task-status-writeback
- `SuperClawGatewayService.getBrowserSession(superClawId,request)` — 读取当前任务工作区的浏览器登录态 | keywords: 读取任务浏览器会话, 工作区登录态, read-task-browser-session, workspace-login-state
- `SuperClawGatewayService.upsertBrowserSession(superClawId,request)` — 加密保存当前任务工作区 storageState | keywords: 保存任务浏览器会话, 持久化Cookie, save-task-browser-session, persist-cookie
- `SuperClawGatewayService.invalidateBrowserSession(superClawId,request)` — 删除当前任务工作区失效登录态 | keywords: 删除任务浏览器会话, 登录态失效, invalidate-task-browser-session, login-state-expiry
- `SuperClawGatewayService.createTaskInteraction(superClawId,request)` — 创建二维码或短回复交互并进入 waiting_user | keywords: 创建任务登录交互, 等待用户状态, create-task-login-interaction, waiting-user-status
- `SuperClawGatewayService.getTaskInteraction(superClawId,request)` — 查询交互状态和用户回调 | keywords: 查询任务登录交互, 获取用户回调, get-task-login-interaction, fetch-user-callback
- `SuperClawGatewayService.callBrowserAuthOperation(operation)` — 把浏览器认证领域异常映射为稳定 gRPC 状态 | keywords: 转换浏览器认证错误, 协议错误映射, map-browser-auth-error, grpc-error-mapping
- `SuperClawGatewayService.deleteTask(superClawId,request)` — 使用 Token 删除任务 | keywords: 删除令牌任务, gRPC任务删除, delete-token-task, grpc-task-delete
- `SuperClawGatewayService.requireTenant(superClawId,rawTenantId)` — 校验节点租户边界 | keywords: 校验gRPC租户, 节点边界, validate-grpc-tenant, node-boundary
- `SuperClawGatewayService.requireTokenTask(superClawId,request)` — 校验节点、租户、任务与 Token | keywords: 校验任务令牌, 四重任务鉴权, validate-task-token, four-way-task-auth
- `SuperClawGatewayService.getDataTrackingAssignees()` — 查询专用数据抓取 Agent assignee | keywords: 查询专用抓取Agent, 任务指派标识, list-data-tracking-agents, task-assignee-id
- `SuperClawGatewayService.toXhsPostStatInput(item)` — 校验并转换 gRPC 小红书指标 | keywords: 转换小红书指标, 校验采集回传, map-xhs-stats, validate-collection-writeback
- `SuperClawGatewayService.readNonNegativeInteger(value,field)` — 解析非负安全整数指标 | keywords: 解析采集计数, 非负整数校验, parse-stat-count, nonnegative-integer-validation
- `SuperClawGatewayService.recordXhsCrawlRun(todoId)` — gRPC 回写后记录抓取运行与数据批次 | keywords: 记录gRPC抓取运行, 回写批次归属, record-grpc-crawl-run, writeback-batch-attribution
- `SuperClawGatewayService.toTaskView(todo)` — 转换不含敏感字段的任务协议视图，并注入登录介入执行指引 | keywords: 转换任务协议, 隐藏敏感字段, map-task-protocol, hide-sensitive-fields
- `SuperClawGatewayService.readSessionType(value)` — 校验 gRPC 会话类型 | keywords: 解析会话类型, 协议枚举校验, parse-session-type, protocol-enum-validation
- `SuperClawGatewayService.readDeadline(value)` — 解析任务截止时间 | keywords: 解析任务时限, 截止时间校验, parse-task-deadline, deadline-validation
- `SuperClawGatewayService.throwInvalid(message)` — 抛出稳定参数错误 | keywords: 无效协议参数, 稳定错误码, invalid-protocol-argument, stable-error-code
- `SuperClawGatewayService.throwNotFound(message)` — 抛出稳定资源不存在错误 | keywords: 协议资源不存在, 稳定错误码, protocol-resource-not-found, stable-error-code
- `SuperClawAdminController({ superClawService })` — 暴露平台管理和租户分配 HTTP 入口 | keywords: 后台控制器, 租户分配, admin-controller, tenant-allocation
- `CreateSuperClawDto({ name, description?, capacity })` — 校验创建节点请求 | keywords: 创建节点参数, 容量校验, create-node-dto, capacity-validation
- `UpdateSuperClawDto({ name?, description?, capacity? })` — 校验更新节点请求 | keywords: 更新节点参数, 容量校验, update-node-dto, capacity-validation
- `AssignTenantSuperClawDto({ superClawId? })` — 校验租户节点归属请求 | keywords: 租户节点参数, 归属校验, tenant-node-dto, assignment-validation
- `createSuperClawGrpcOptions()` — 创建 gRPC 微服务启动配置 | keywords: gRPC启动配置, 节点监听, grpc-bootstrap-options, node-listener
- `resolveSuperClawProtoPath()` — 兼容源码和编译目录解析协议路径 | keywords: 协议路径, 运行时布局, proto-path, runtime-layout
- `SuperClawService.onModuleInit()` — 初始化索引并校准节点已分配容量 | keywords: 初始化索引, 容量校准, initialize-indexes, capacity-reconciliation
- `SuperClawService.ensureDataTrackingAgent()` — 幂等创建 SuperClaw 专用数据抓取 Agent | keywords: 创建专用抓取Agent, SuperClaw任务代理, ensure-data-tracking-agent, super-claw-task-agent
- `SuperClawService.requireTenantAssignment(superClawId,tenantId)` — 校验租户归属于当前 gRPC 节点 | keywords: 校验租户节点归属, gRPC租户隔离, require-tenant-assignment, grpc-tenant-isolation
- `SuperClawService.listAssignedTenantIds(superClawId)` — 由平台查询节点所辖租户用于主动推送 | keywords: 查询节点租户, 主动推送路由, list-node-tenants, active-push-routing
- `SuperClawService.listPendingWorkspaceProvisions(superClawId)` — 查询节点尚未确认创建的工作区 | keywords: 查询待创建工作区, 节点重连补发, list-pending-workspaces, reconnect-provision-replay
- `SuperClawService.listProvisionedWorkspaceIds(superClawId)` — 查询节点已同步工作区供任务过滤 | keywords: 查询已同步工作区, 任务工作区过滤, list-provisioned-workspaces, task-workspace-filter
- `SuperClawService.confirmWorkspaceProvision(input)` — 保存节点工作区创建 ACK 结果 | keywords: 确认工作区同步, 记录创建结果, confirm-workspace-provision, record-provision-result
- `SuperClawService.getAssignedSuperClawId(tenantId)` — 查询租户归属节点用于定位在线通道 | keywords: 查询租户节点, 任务推送定位, resolve-tenant-node, task-push-location
- `SuperClawService.getWorkspaceSuperClawId(workspaceId)` — 查询平台工作区固定承载节点 | keywords: 查询工作区节点, 平台任务定位, resolve-workspace-node, platform-task-routing
- `SuperClawService.listTenantWorkspaces(superClawId,tenantId)` — 返回节点与租户双重过滤的工作区 | keywords: gRPC工作区列表, 节点租户过滤, grpc-workspace-list, node-tenant-filter
- `SuperClawService.ensureIndexes()` — 建立节点名称、Token 和心跳索引 | keywords: 节点索引, 令牌唯一, node-indexes, unique-token
- `SuperClawService.list()` — 返回不含 Token 哈希的节点列表与剩余容量 | keywords: 节点列表, 剩余容量, list-nodes, remaining-capacity
- `SuperClawService.create({ name, description?, capacity })` — 创建节点并返回一次性明文 Token | keywords: 创建节点, 一次性令牌, create-node, one-time-token
- `SuperClawService.update(id, { name?, description?, capacity? })` — 更新节点并保护已分配容量 | keywords: 更新节点, 缩容保护, update-node, capacity-shrink-guard
- `SuperClawService.remove(id)` — 删除无租户占用的节点 | keywords: 删除节点, 占用保护, delete-node, allocation-guard
- `SuperClawService.rotateToken(id)` — 轮换节点 Token 并使旧密钥失效 | keywords: 轮换令牌, 密钥失效, rotate-token, secret-revocation
- `SuperClawService.assignTenant(tenantId, superClawId?)` — 调整租户节点并整体迁移工作区 | keywords: 分配租户节点, 迁移工作区, assign-tenant-node, migrate-workspaces
- `SuperClawService.reserveWorkspaceForTenant(tenantId)` — 创建工作区前占用所属节点槽位，节点已删与槽位已满分开报错 | keywords: 占用工作区槽位, 租户节点归属, reserve-workspace-slot, tenant-node-assignment
- `SuperClawService.reserveWorkspaceForPlatform()` — 为平台工作区选择在线有余量节点并占用槽位，失败按未配置/离线/满槽分别报错 | keywords: 分配平台工作区, 选择在线节点, 节点不可用诊断, reserve-platform-workspace, select-online-node, node-availability-diagnosis
- `SuperClawService.releaseWorkspace(superClawId)` — 删除工作区或创建失败时释放节点槽位 | keywords: 释放工作区槽位, 容量归还, release-workspace-slot, capacity-return
- `SuperClawService.authenticateToken(token)` — 校验 gRPC Token 并解析节点身份 | keywords: 校验令牌, 节点身份, authenticate-token, node-identity
- `SuperClawService.register(superClawId, request)` — 注册实例并建立在线连接 | keywords: 注册实例, 建立连接, register-instance, establish-connection
- `SuperClawService.heartbeat(superClawId, request)` — 接收心跳并续期在线状态 | keywords: 接收心跳, 连接续期, receive-heartbeat, renew-connection
- `SuperClawService.unassignTenant(tenant, workspaceCount)` — 仅允许空租户解除节点归属 | keywords: 解除租户节点, 工作区保护, unassign-tenant-node, workspace-guard
- `SuperClawService.reserveCapacity(id, delta)` — 原子预留节点容量 | keywords: 原子预留, 容量上限, atomic-reservation, capacity-limit
- `SuperClawService.releaseCapacity(id, capacity)` — 归还节点容量并支持失败回滚 | keywords: 归还容量, 配额回滚, release-capacity, quota-rollback
- `SuperClawService.reconcileAllocatedCapacity()` — 同步工作区归属并按工作区数量校准槽位 | keywords: 容量校准, 工作区汇总, capacity-reconciliation, workspace-aggregation
- `SuperClawService.toView(row)` — 隐藏 Token 哈希并按心跳计算在线状态 | keywords: 安全视图, 离线判定, safe-view, offline-detection
- `SuperClawService.generateToken()` — 生成带前缀的高熵 Token | keywords: 生成令牌, 随机密钥, generate-token, random-secret
- `SuperClawService.hashToken(token)` — 对 Token 做 SHA-256 哈希 | keywords: 令牌哈希, 安全存储, hash-token, secure-storage
- `SuperClawService.toObjectId(value, errorCode)` — 校验 Mongo ObjectId 参数 | keywords: 对象标识校验, 参数错误, object-id-validation, invalid-parameter
- `SuperClawTokenGuard.canActivate(context)` — 校验 gRPC metadata 并注入节点身份 | keywords: 校验调用, 注入身份, authorize-call, inject-identity
- `SuperClawGrpcController.register(request, metadata, call)` — SuperClaw 注册 gRPC 端点 | keywords: 注册端点, 建立连接, register-endpoint, establish-connection
- `SuperClawGrpcController.heartbeat(request, metadata, call)` — SuperClaw 心跳 gRPC 端点 | keywords: 心跳端点, 连接续期, heartbeat-endpoint, connection-renewal
- `SuperClawGrpcController.listConversations(request,metadata,call)` — 租户对话列表端点 | keywords: 租户对话列表端点, gRPC会话查询, tenant-conversation-list-endpoint, grpc-session-query
- `SuperClawGrpcController.startConversation(request,metadata,call)` — 发起租户非流式 AI 对话 | keywords: 发起租户对话端点, gRPCAI对话, start-tenant-conversation-endpoint, grpc-ai-chat
- `SuperClawGrpcController.listWorkspaces(request,metadata,call)` — 租户工作区列表端点 | keywords: 租户工作区端点, gRPC工作区查询, tenant-workspace-endpoint, grpc-workspace-query
- `SuperClawGrpcController.openTaskChannel(call)` — 建立平台主动推送任务的双向流 | keywords: 主动任务通道端点, 服务端租户路由, active-task-channel-endpoint, server-tenant-routing
- `SuperClawGrpcController.dispatchTask(request,metadata,call)` — 原子下发任务并返回任务专用 Token | keywords: 下发任务端点, 任务专用令牌, dispatch-task-endpoint, dedicated-task-token
- `SuperClawGrpcController.createTask(request,metadata,call)` — 节点创建任务并返回 Token | keywords: 创建任务端点, 返回任务令牌, create-task-endpoint, return-task-token
- `SuperClawGrpcController.listTasks(request,metadata,call)` — 按租户列出任务且隐藏 Token | keywords: 任务列表端点, 隐藏任务令牌, list-tasks-endpoint, hide-task-tokens
- `SuperClawGrpcController.getTask(request,metadata,call)` — 使用任务 Token 获取任务 | keywords: 获取任务端点, 任务令牌鉴权, get-task-endpoint, task-token-auth
- `SuperClawGrpcController.updateTask(request,metadata,call)` — 使用任务 Token 更新任务 | keywords: 更新任务端点, 任务状态回写, update-task-endpoint, task-status-writeback
- `SuperClawGrpcController.getBrowserSession(request,metadata,call)` — 读取工作区浏览器登录态 | keywords: 读取浏览器会话端点, 工作区登录态, get-browser-session-endpoint, workspace-login-state
- `SuperClawGrpcController.upsertBrowserSession(request,metadata,call)` — 加密保存工作区浏览器登录态 | keywords: 保存浏览器会话端点, 加密Cookie, upsert-browser-session-endpoint, encrypted-cookie
- `SuperClawGrpcController.invalidateBrowserSession(request,metadata,call)` — 删除失效工作区浏览器登录态 | keywords: 失效浏览器会话端点, 删除Cookie, invalidate-browser-session-endpoint, delete-cookie
- `SuperClawGrpcController.createTaskInteraction(request,metadata,call)` — 创建二维码或简短文本交互窗口 | keywords: 创建任务交互端点, 二维码窗口, create-task-interaction-endpoint, qr-window
- `SuperClawGrpcController.getTaskInteraction(request,metadata,call)` — 查询交互状态与用户回调 | keywords: 查询任务交互端点, 用户回调, get-task-interaction-endpoint, user-callback
- `SuperClawGrpcController.deleteTask(request,metadata,call)` — 使用任务 Token 删除任务 | keywords: 删除任务端点, 令牌删除, delete-task-endpoint, token-authorized-delete
- `SuperClawGrpcController.requireSuperClawId(call)` — 读取认证后的节点身份 | keywords: 读取节点身份, 鉴权上下文, read-node-identity, auth-context
- `SuperClawAdminController.list()` — 节点列表后台端点 | keywords: 节点列表端点, 平台管理, list-nodes-endpoint, platform-management
- `SuperClawAdminController.create(body)` — 创建节点并返回一次性 Token | keywords: 创建节点端点, 一次性令牌, create-node-endpoint, one-time-token
- `SuperClawAdminController.update(id, body)` — 更新节点容量和信息 | keywords: 更新节点端点, 容量上限, update-node-endpoint, capacity-limit
- `SuperClawAdminController.remove(id)` — 删除空闲节点 | keywords: 删除节点端点, 占用保护, delete-node-endpoint, allocation-guard
- `SuperClawAdminController.rotateToken(id)` — 轮换连接密钥 | keywords: 轮换令牌端点, 密钥管理, rotate-token-endpoint, secret-management
- `SuperClawAdminController.assignTenant(tenantId, body)` — 设置租户节点并迁移工作区 | keywords: 租户节点端点, 工作区迁移, tenant-node-endpoint, workspace-migration

## 关键词索引 (Keyword Index)

| 中文          | English                   |
| ------------- | ------------------------- |
| SuperClaw节点 | super-claw-node           |
| 平台接入      | platform-onboarding       |
| gRPC注册      | grpc-registration         |
| 连接心跳      | connection-heartbeat      |
| Token鉴权     | token-authentication      |
| 一次性令牌    | one-time-token            |
| 密钥轮换      | secret-rotation           |
| 工作区总槽位  | total-workspace-slots     |
| 已占用槽位    | allocated-workspace-slots |
| 防止超分      | prevent-overcommit        |
| 租户节点归属  | tenant-node-assignment    |
| 工作区迁移    | workspace-migration       |
| 容量校准      | capacity-reconciliation   |
| 租户对话      | tenant-conversation       |
| 任务下发      | task-dispatch             |
| 主动任务通道  | active-task-channel       |
| 工作区创建下发| workspace-provision       |
| 服务端任务租约| server-task-lease         |
| 任务专用令牌  | dedicated-task-token      |
| 浏览器会话复用| browser-session-reuse     |
| 二维码登录    | qr-login                  |
| 等待用户状态  | waiting-user-status       |
| 任务人机交互  | task-human-interaction    |
| 数据抓取Agent | super-claw-data-tracking  |
| 断线保留租约  | keep-lease-on-disconnect  |
| 重连挂回投递  | adopt-detached-delivery   |
| 重复领取上限  | max-execution-attempts    |
| 异常阻断重投  | abnormal-block-redelivery |

## 类型导出 (Type Exports)

- `SuperClawConnectionStatus` — 节点连接状态：`pending` / `online` / `offline`
- `SuperClawEntity` / `SuperClawView` — 数据库节点实体与隐藏密钥哈希的后台视图
- `SuperClawRegisterRequest` / `SuperClawRegisterResponse` — gRPC 注册消息
- `SuperClawHeartbeatRequest` / `SuperClawHeartbeatResponse` — gRPC 心跳消息
- `AuthenticatedSuperClawCall` — 注入已认证节点 ID 的 gRPC 调用上下文
- `SUPER_CLAW_HEARTBEAT_INTERVAL_SECONDS` — 服务端建议心跳间隔（30 秒）
- `SuperClawTenantRequest` / `SuperClawStartConversationRequest` / `SuperClawConversationView` — 租户对话协议类型
- `SuperClawWorkspaceView` — 工作区 gRPC 安全视图
- `SuperClawTaskView` / `SuperClawTaskEnvelope` / `SuperClawTaskTokenRequest` — 任务下发、`executionGuidance` 与专用 Token CRUD 类型
- `SuperClawTaskChannelRequest` / `SuperClawTaskChannelEvent` / `SuperClawTaskDispatch` — 主动任务双向流、投递确认与租约消息类型
- `SuperClawWorkspaceProvision` / `SuperClawWorkspaceProvisionAck` — 平台工作区创建命令与节点确认类型
- `SuperClawTaskResourceMessage` / `SuperClawCreateTaskRequest` / `SuperClawListTasksRequest` / `SuperClawUpdateTaskRequest` — 任务资源、创建、列表与更新协议类型
- `SuperClawBrowserSessionRequest` / `SuperClawUpsertBrowserSessionRequest` — 工作区浏览器会话读取、保存和失效请求
- `SuperClawCreateTaskInteractionRequest` / `SuperClawGetTaskInteractionRequest` — 二维码登录和简短回复交互请求
- `SuperClawXhsTopCommentMessage` / `SuperClawXhsPostStatMessage` — SuperClaw 数据抓取 Agent 的结构化评论与帖子指标回传类型
- `SUPER_CLAW_MAX_DISPATCH_ATTEMPTS` — 同一任务允许被节点 ACK 执行的最大次数（3）

## 模块功能描述 (Module Description)

后台入口挂载在 `/admin/super-claws`，仅具备 `SuperClaw` 权限的用户可访问；当前静态角色目录只有平台 `super_admin` 的 `manage all` 可命中。

| 方法与路径                                            | 权限             | 用途                          |
| ----------------------------------------------------- | ---------------- | ----------------------------- |
| `GET /admin/super-claws`                              | read SuperClaw   | 节点、连接状态和工作区槽位    |
| `POST /admin/super-claws`                             | create SuperClaw | 创建节点并返回一次性 Token    |
| `PATCH /admin/super-claws/:id`                        | update SuperClaw | 更新名称、描述和容量          |
| `DELETE /admin/super-claws/:id`                       | delete SuperClaw | 删除无租户分配的节点          |
| `POST /admin/super-claws/:id/token/rotate`            | update SuperClaw | 轮换 Token，旧 Token 立即失效 |
| `PUT /admin/super-claws/tenant-allocations/:tenantId` | update SuperClaw | 设置租户节点并整体迁移工作区  |


gRPC 监听地址由 `SUPER_CLAW_GRPC_URL` 配置，默认 `0.0.0.0:50051`；`SUPER_CLAW_GRPC_ENABLED=false` 可关闭。节点注册后打开 `OpenTaskChannel`。平台先把租户绑定节点下 `pending` 的工作区作为 `WorkspaceProvision` 下发，节点创建本地工作区并回复 ACK；只有状态为 `provisioned` 的工作区，其单次 Todo 才能携带 `workspaceId/sessionId/taskToken` 下发。工作区容量单位为字节，`0` 表示无上限。

任务生命周期：ACK 超时、NACK 会立刻恢复 `pending` 并轮换 Token；**断线不会**立刻回收已执行投递，而是保留一个租约时长（`TASK_LEASE_SECONDS=120s`）等待同一节点重连挂回，真正超时才恢复 `pending` 并轮换 Token。节点重连时 `Ready.available_slots` 必须如实反映本地是否仍在执行，并对保留投递补发一次 `Lease`。服务端每 30 秒巡检一次空闲通道补推送机会。
