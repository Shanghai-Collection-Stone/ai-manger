# Workspace Module

## 模块描述

工作区模块(v2)，提供工作区(名称/描述/容量设定)CRUD 与成员管理。工作区隶属租户，同时是 SuperClaw 的直接子资源：每个工作区保存 `superClawId` 并占用节点 1 个工作区槽位。租户切换节点时，其工作区整体迁移。工作区按后台 JWT + CASL 鉴权(subject `Workspace`)，保持租户隔离。`capacityBytes` 与 `usedBytes` 是独立网盘字节配额；网盘模块通过 `WorkspaceService.getForQuota` / `addUsedBytes` 做配额记账。所有增删改操作自动埋点到审计日志(`workspace.*` 动作)。
文件路径: `src/modules/workspace`
路由前缀: `api/v2/workspaces`
已知限制: 删除工作区要求 `usedBytes=0`(网盘为空)，网盘残留内容的级联清理留后续迭代。

## 功能描述及关键词

### services/workspace.service.ts

工作区服务，CRUD、成员管理、容量记账入口、审计埋点。

- **关键词**: workspace, member, crud, capacity, quota, audit, tenant-isolation, mongo
- **函数**:
  - `ensureIndexes`: 初始化工作区与成员索引/ensure workspace indexes | keywords: ensure-workspace-indexes
  - `list`: 工作区列表(租户隔离)/list workspaces | keywords: list-workspaces
  - `get`: 获取工作区(校验租户边界)/get workspace by id | keywords: get-workspace-by-id
  - `create(currentUser, input)`: 在租户所属 SuperClaw 下创建工作区并占用槽位 | keywords: 创建工作区, 占用节点槽位, create-workspace, reserve-super-claw-slot
  - `update`: 更新工作区(名称/描述/容量)/update workspace | keywords: update-workspace
  - `remove(currentUser, id)`: 删除工作区及成员并释放节点槽位 | keywords: 删除工作区, 释放节点槽位, delete-workspace, release-super-claw-slot
  - `listMembers`: 成员列表/list workspace members | keywords: list-workspace-members
  - `addMember`: 添加成员(校验同租户用户)/add workspace member | keywords: add-workspace-member
  - `updateMember`: 更新成员角色/update workspace member role | keywords: update-workspace-member-role
  - `removeMember`: 移除成员/remove workspace member | keywords: remove-workspace-member
  - `getForQuota`: 供网盘读取工作区做配额判断/get workspace for quota | keywords: get-workspace-for-quota
  - `addUsedBytes`: 原子增减已用容量/add workspace used bytes | keywords: add-workspace-used-bytes

### controller/workspace.controller.ts

工作区控制器，`api/v2/workspaces` 下 CRUD 与成员端点，逐入口挂 `@RequirePermission`。

- **关键词**: controller, workspace, member, casl, jwt, v2, require-permission
- **函数**:
  - `list`: 工作区列表端点/list workspaces endpoint | keywords: list-workspaces-endpoint
  - `create`: 创建工作区端点/create workspace endpoint | keywords: create-workspace-endpoint
  - `get`: 获取工作区端点/get workspace endpoint | keywords: get-workspace-endpoint
  - `update`: 更新工作区端点/update workspace endpoint | keywords: update-workspace-endpoint
  - `remove`: 删除工作区端点/delete workspace endpoint | keywords: delete-workspace-endpoint
  - `listMembers`: 成员列表端点/list workspace members endpoint | keywords: list-workspace-members-endpoint
  - `addMember`: 添加成员端点/add workspace member endpoint | keywords: add-workspace-member-endpoint
  - `updateMember`: 更新成员端点/update workspace member endpoint | keywords: update-workspace-member-endpoint
  - `removeMember`: 移除成员端点/remove workspace member endpoint | keywords: remove-workspace-member-endpoint
  - `requireUser`: 读取当前登录后台用户/read current admin user | keywords: read-current-admin-user

### controller/workspace.dto.ts

工作区与成员请求体 DTO 及校验。

- **关键词**: dto, class-validator, workspace, member

### entities/workspace.entity.ts

工作区与成员实体定义；`WorkspaceEntity.superClawId` 表示直接父节点。

- **关键词**: entity, workspace, member, member-role, super-claw-child
- **类型导出**: `WorkspaceEntity`, `WorkspaceMemberEntity`, `WorkspaceMemberRole`

### constants/workspace-audit.constants.ts

工作区审计事件动作常量(`workspace.<verb>`)。

- **关键词**: audit, action, namespace, workspace
- **类型导出**: `WORKSPACE_AUDIT_ACTIONS`

### workspace.module.ts

工作区模块定义，依赖 `SuperClawModule` 做槽位记账并导出 `WorkspaceService`。

- **关键词**: module, nest, export-service, super-claw-slot
