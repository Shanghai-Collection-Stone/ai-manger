# 模块名称 (Module Name)

SuperClaw 平台接入模块（super-claw）

## 概述 (Overview)

为平台专属 SuperClaw 提供节点管理、一次性 Token 签发与轮换、gRPC 注册/心跳、工作区槽位容量和租户节点归属。层级是 `SuperClaw → Workspace → 租户成员/业务数据`：租户只保存默认节点归属，工作区实体保存实际 `superClawId`。Token 明文仅在创建或轮换时返回一次，数据库只保存 SHA-256 哈希。

SuperClaw 容量采用工作区槽位数：`capacity` 是节点最多可承载的工作区数量，`allocatedCapacity` 是当前工作区数量。每创建一个工作区原子占用 1 个槽位，删除时释放；更换租户节点会把该租户全部工作区整体迁移并按工作区数量检查目标节点容量。`Workspace.capacityBytes/usedBytes` 仍是独立的网盘字节配额，不与节点槽位混用。

## 文件清单 (File List)

- `super-claw.module.ts` — NestJS 模块入口，装配后台管理、gRPC 控制器、Token 守卫和服务。
- `super-claw-grpc.options.ts` — gRPC 监听、协议路径与 proto-loader 启动配置。
- `controller/super-claw-admin.controller.ts` — 平台节点 CRUD、Token 轮换、租户节点归属和工作区迁移接口。
- `controller/super-claw-grpc.controller.ts` — SuperClaw `Register` / `Heartbeat` gRPC 入口。
- `controller/super-claw.dto.ts` — 节点和租户配额请求体校验。
- `entities/super-claw.entity.ts` — 节点实体、后台安全视图与 gRPC 消息类型。
- `guards/super-claw-token.guard.ts` — 从 gRPC metadata 校验平台签发 Token 并注入节点身份。
- `services/super-claw.service.ts` — 节点、密钥、连接状态、容量原子预留和租户分配逻辑。
- `proto/super-claw.proto` — `superclaw.v1.SuperClawGateway` 服务协议。
- `proto/grpc-protocol.md` — gRPC 鉴权、调用时序、字段语义、错误处理和兼容性基线文档。

## 函数清单 (Function List)

- `SuperClawModule()` — 装配节点管理、gRPC 接入、守卫与服务 | keywords: 节点模块, 平台接入, node-module, platform-onboarding
- `SuperClawService({ db })` — 提供节点、令牌、连接和工作区槽位能力 | keywords: 节点服务, 工作区容量, node-service, workspace-capacity
- `SuperClawTokenGuard({ superClawService })` — 校验 gRPC metadata Token | keywords: 令牌守卫, 元数据鉴权, token-guard, metadata-authentication
- `SuperClawGrpcController({ superClawService })` — 暴露注册和心跳 gRPC 入口 | keywords: gRPC控制器, 节点接入, grpc-controller, node-onboarding
- `SuperClawAdminController({ superClawService })` — 暴露平台管理和租户分配 HTTP 入口 | keywords: 后台控制器, 租户分配, admin-controller, tenant-allocation
- `CreateSuperClawDto({ name, description?, capacity })` — 校验创建节点请求 | keywords: 创建节点参数, 容量校验, create-node-dto, capacity-validation
- `UpdateSuperClawDto({ name?, description?, capacity? })` — 校验更新节点请求 | keywords: 更新节点参数, 容量校验, update-node-dto, capacity-validation
- `AssignTenantSuperClawDto({ superClawId? })` — 校验租户节点归属请求 | keywords: 租户节点参数, 归属校验, tenant-node-dto, assignment-validation
- `createSuperClawGrpcOptions()` — 创建 gRPC 微服务启动配置 | keywords: gRPC启动配置, 节点监听, grpc-bootstrap-options, node-listener
- `resolveSuperClawProtoPath()` — 兼容源码和编译目录解析协议路径 | keywords: 协议路径, 运行时布局, proto-path, runtime-layout
- `SuperClawService.onModuleInit()` — 初始化索引并校准节点已分配容量 | keywords: 初始化索引, 容量校准, initialize-indexes, capacity-reconciliation
- `SuperClawService.ensureIndexes()` — 建立节点名称、Token 和心跳索引 | keywords: 节点索引, 令牌唯一, node-indexes, unique-token
- `SuperClawService.list()` — 返回不含 Token 哈希的节点列表与剩余容量 | keywords: 节点列表, 剩余容量, list-nodes, remaining-capacity
- `SuperClawService.create({ name, description?, capacity })` — 创建节点并返回一次性明文 Token | keywords: 创建节点, 一次性令牌, create-node, one-time-token
- `SuperClawService.update(id, { name?, description?, capacity? })` — 更新节点并保护已分配容量 | keywords: 更新节点, 缩容保护, update-node, capacity-shrink-guard
- `SuperClawService.remove(id)` — 删除无租户占用的节点 | keywords: 删除节点, 占用保护, delete-node, allocation-guard
- `SuperClawService.rotateToken(id)` — 轮换节点 Token 并使旧密钥失效 | keywords: 轮换令牌, 密钥失效, rotate-token, secret-revocation
- `SuperClawService.assignTenant(tenantId, superClawId?)` — 调整租户节点并整体迁移工作区 | keywords: 分配租户节点, 迁移工作区, assign-tenant-node, migrate-workspaces
- `SuperClawService.reserveWorkspaceForTenant(tenantId)` — 创建工作区前占用所属节点槽位 | keywords: 占用工作区槽位, 租户节点归属, reserve-workspace-slot, tenant-node-assignment
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

## 类型导出 (Type Exports)

- `SuperClawConnectionStatus` — 节点连接状态：`pending` / `online` / `offline`
- `SuperClawEntity` / `SuperClawView` — 数据库节点实体与隐藏密钥哈希的后台视图
- `SuperClawRegisterRequest` / `SuperClawRegisterResponse` — gRPC 注册消息
- `SuperClawHeartbeatRequest` / `SuperClawHeartbeatResponse` — gRPC 心跳消息
- `AuthenticatedSuperClawCall` — 注入已认证节点 ID 的 gRPC 调用上下文
- `SUPER_CLAW_HEARTBEAT_INTERVAL_SECONDS` — 服务端建议心跳间隔（30 秒）

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

gRPC 监听地址由 `SUPER_CLAW_GRPC_URL` 配置，默认 `0.0.0.0:50051`；`SUPER_CLAW_GRPC_ENABLED=false` 可关闭。服务名为 `superclaw.v1.SuperClawGateway`，提供 `Register` 和 `Heartbeat`。客户端在 metadata 传 `authorization: Bearer <token>` 或 `x-super-claw-token: <token>`。两个入口均同址声明 `update SuperClaw` 权限，并由专用 Token 守卫执行平台节点身份鉴权。
