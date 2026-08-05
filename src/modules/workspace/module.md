# Workspace Module

## 模块描述
工作区模块(v2)，提供工作区(名称/描述/容量设定)CRUD 与成员管理。隶属租户，按后台 JWT + CASL 鉴权(subject `Workspace`)，租户隔离。工作区含 `capacityBytes`(容量设定)与 `usedBytes`(已用，由网盘模块维护)；网盘模块通过 `WorkspaceService.getForQuota` / `addUsedBytes` 做配额记账。所有增删改操作自动埋点到审计日志(`workspace.*` 动作)。
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
  - `create`: 创建工作区/create workspace | keywords: create-workspace
  - `update`: 更新工作区(名称/描述/容量)/update workspace | keywords: update-workspace
  - `remove`: 删除工作区及成员/delete workspace | keywords: delete-workspace
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
工作区与成员实体定义。
- **关键词**: entity, workspace, member, member-role
- **类型导出**: `WorkspaceEntity`, `WorkspaceMemberEntity`, `WorkspaceMemberRole`

### constants/workspace-audit.constants.ts
工作区审计事件动作常量(`workspace.<verb>`)。
- **关键词**: audit, action, namespace, workspace
- **类型导出**: `WORKSPACE_AUDIT_ACTIONS`

### workspace.module.ts
工作区模块定义，导出 `WorkspaceService`。
- **关键词**: module, nest, export-service
