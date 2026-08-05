# 后台管理 API · v2(工作区 / 网盘 / 审计日志)

> **目标读者**:后台控制台前端 / 运营管理端
> **接口前缀**:`/api/v2`
> **版本**:v2
> **数据格式**:JSON,UTF-8;文件上传 `multipart/form-data`

本组接口面向**后台控制台**,管理多租户 SaaS 的:

- **工作区**(团队/项目空间,含名称、描述、容量设定、成员管理)
- **网盘**(租户级与工作区级文件/文件夹,真实文件上传下载、容量配额)
- **审计日志**(后台变更事件追踪,工作区/网盘操作自动埋点)
- **通知**(后台发起的站内通知,增删改查 + 发布/撤销)

> 与 `/api/v1`(财务对外接入,API Key + scope)不同,`/api/v2` 使用**后台账号 JWT + CASL 角色能力**鉴权,面向登录后台用户而非外部系统。

---

## 0. 快速开始

```bash
# 1. 后台账号登录,拿到 JWT
curl -X POST https://your-server/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "admin", "password": "your-password" }'
# → { "token": "eyJhbGciOi...", "user": { "id": "...", "username": "admin", "role": "super_admin", ... } }

# 2. 携带 token 调用 v2 接口
curl https://your-server/api/v2/workspaces \
  -H "Authorization: Bearer eyJhbGciOi..."
# → { "workspaces": [ { "id": "…", "name": "运营部", "capacityBytes": 0, "usedBytes": 0, ... } ] }
```

---

## 1. 鉴权(Authentication)

### Header

每次请求必须携带登录返回的 JWT:

```
Authorization: Bearer <token>
```

### 令牌管理(admin 模块)

| 方法 | 路径                 | 说明                               |
| ---- | -------------------- | ---------------------------------- |
| POST | `/admin/auth/login`  | 登录,返回 `{ token, user }`        |
| GET  | `/admin/auth/me`     | 当前登录用户(含 `tenantName`)      |
| POST | `/admin/auth/logout` | 注销当前会话                       |

令牌缺失 / 无效 / 过期 → `401 UNAUTHORIZED`。

### 角色能力(CASL)

每个入口按 `(action, subject)` 声明所需能力,能力不足 → `403 PERMISSION_DENIED`。角色能力矩阵(静态 RBAC):

| 能力(主体)          | super_admin | tenant_admin | operator |
| ------------------- | :---------: | :----------: | :------: |
| User 用户管理        | manage      | manage       | read     |
| Role 角色查看        | read        | read         | read     |
| Workspace 工作区     | manage      | manage       | read     |
| Netdisk 网盘         | manage      | manage       | manage   |
| AuditLog 审计日志    | read        | read         | —        |
| Notice 通知管理      | manage      | manage       | read     |
| NoticeRead 我的通知/已读 | manage   | manage       | manage   |

> `manage` 涵盖 create / read / update / delete。`super_admin` 实为 `manage all`(全部主体)。
> 前端可用 `GET /admin/roles` 拉取角色目录与权限矩阵,用于控制台菜单/按钮显隐。

### 租户隔离

- `tenant_admin` / `operator`:只能访问**本租户**的数据(列表自动过滤、跨租户资源返回 `403 CROSS_TENANT_FORBIDDEN`)。
- `super_admin`(无租户):可跨租户管理工作区;但**网盘为租户级资源,平台超管直接操作返回 `403 TENANT_CONTEXT_REQUIRED`**(需以租户内账号操作)。

---

## 2. 响应格式

### 成功

各资源**直接返回**对象或数组(无 `ok`/`data` 信封):

```json
{ "workspaces": [...] }      // 列表
{ "workspace": { ... } }     // 单条
{ "ok": true }               // 删除/注销等
```

### 分页(仅审计日志)

```json
{ "items": [...], "page": 1, "pageSize": 50, "total": 123 }
```

### 失败

全局统一返回 `{ message }`,HTTP 状态码见 §3 错误码表:

```json
{ "message": "PERMISSION_DENIED" }
```

参数校验失败(`400`)时 `message` 为校验明细拼接(如 `name must be a string`)。

---

## 3. 错误码 → HTTP 状态

| `message`                                  | HTTP | 说明                                        |
| ------------------------------------------ | ---- | ------------------------------------------- |
| `UNAUTHORIZED`                             | 401  | 未携带或 JWT 无效/过期                      |
| `PERMISSION_DENIED`                        | 403  | 当前角色不具备该入口能力                    |
| `CROSS_TENANT_FORBIDDEN`                   | 403  | 跨租户访问                                  |
| `TENANT_CONTEXT_REQUIRED`                  | 403  | 网盘需租户上下文(平台超管直接操作)          |
| `VALIDATION`(校验明细)                     | 400  | 入参校验失败(class-validator)               |
| `WORKSPACE_NOT_FOUND`                      | 404  | 工作区不存在                                |
| `WORKSPACE_NAME_ALREADY_EXISTS`            | 400  | 同租户内工作区重名                          |
| `CAPACITY_BELOW_USED`                      | 400  | 容量设定低于当前已用量                      |
| `WORKSPACE_NOT_EMPTY`                      | 400  | 工作区网盘非空,不可删除                    |
| `TENANT_ID_REQUIRED`                       | 400  | 平台超管创建需显式指定 `tenantId`           |
| `INVALID_WORKSPACE_ID` / `INVALID_USER_ID` | 400  | 非法的 ObjectId                             |
| `USER_NOT_FOUND`                           | 404  | 成员用户不存在                              |
| `MEMBER_ALREADY_EXISTS`                    | 400  | 成员已在该工作区                            |
| `MEMBER_NOT_FOUND`                         | 404  | 成员不存在                                  |
| `FILE_REQUIRED`                            | 400  | 上传请求缺少 `file` 字段                    |
| `FILE_NOT_FOUND`                           | 404  | 文件节点不存在或非文件                      |
| `NODE_NOT_FOUND`                           | 404  | 节点不存在                                  |
| `INVALID_NODE_ID` / `INVALID_PARENT_ID`    | 400  | 非法的 ObjectId                             |
| `INVALID_PARENT`                           | 400  | 父节点不存在或不是文件夹                    |
| `PARENT_SCOPE_MISMATCH`                    | 400  | 父节点与目标作用域不一致                    |
| `FOLDER_NOT_EMPTY`                         | 400  | 文件夹下有内容,不可删除                    |
| `INSUFFICIENT_TENANT_CAPACITY`             | 413  | 超出租户网盘总容量                          |
| `INSUFFICIENT_WORKSPACE_CAPACITY`          | 413  | 超出工作区容量                              |
| (multer 单文件超限)                        | 413  | 超出单文件大小上限                          |
| `NOTICE_NOT_FOUND`                         | 404  | 通知不存在                                  |
| `INVALID_NOTICE_ID`                        | 400  | 非法的 ObjectId                             |
| `PUBLISHED_NOTICE_LOCKED`                  | 400  | 已发布通知不可直接更新(须先撤销)            |
| `REVOKED_NOTICE_CANNOT_PUBLISH`            | 400  | 已撤销通知不可再次发布                      |
| `ONLY_PUBLISHED_CAN_REVOKE`                | 400  | 仅已发布通知可撤销                          |
| (未捕获异常)                               | 500  | 服务端异常                                  |

---

## 4. 工作区 `/api/v2/workspaces`

### 字段(Workspace)

| 字段            | 类型      | 说明                                       |
| --------------- | --------- | ------------------------------------------ |
| `id`            | string    | ObjectId                                   |
| `tenantId`      | string    | 归属租户                                   |
| `name`          | string    | 工作区名称(租户内唯一)                     |
| `description`   | string    | 可选,工作区描述                            |
| `capacityBytes` | integer   | 容量设定(字节),`0` = 不限                  |
| `usedBytes`     | integer   | 已用容量(字节),由网盘上传/删除维护         |
| `createdBy`     | string    | 创建者后台用户 ID                          |
| `createdAt`     | datetime  | 创建时间                                   |
| `updatedAt`     | datetime  | 更新时间                                   |

成员字段:`id` / `workspaceId` / `tenantId` / `userId` / `username` / `role`(`owner` | `editor` | `viewer`) / `addedBy` / `createdAt` / `updatedAt`。

### 端点

| 方法   | 路径                                  | 必需能力             | 返回               |
| ------ | ------------------------------------- | -------------------- | ------------------ |
| GET    | `/api/v2/workspaces`                  | read  Workspace      | `{ workspaces }`   |
| POST   | `/api/v2/workspaces`                  | create Workspace     | `{ workspace }`    |
| GET    | `/api/v2/workspaces/:id`              | read  Workspace      | `{ workspace }`    |
| PATCH  | `/api/v2/workspaces/:id`              | update Workspace     | `{ workspace }`    |
| DELETE | `/api/v2/workspaces/:id`              | delete Workspace     | `{ ok }`           |
| GET    | `/api/v2/workspaces/:id/members`      | read  Workspace      | `{ members }`      |
| POST   | `/api/v2/workspaces/:id/members`      | update Workspace     | `{ member }`       |
| PATCH  | `/api/v2/workspaces/:id/members/:userId` | update Workspace  | `{ member }`       |
| DELETE | `/api/v2/workspaces/:id/members/:userId` | update Workspace  | `{ ok }`           |

### 创建请求体(POST)

```json
{
  "name": "运营部",
  "description": "内容运营团队工作区",
  "capacityBytes": 10737418240,
  "tenantId": "65f…"          // 仅平台超管需要显式指定
}
```

`capacityBytes` 省略或 `0` 表示不限。

### 成员管理

```bash
# 添加成员(目标用户须为后台用户且与工作区同租户)
curl -X POST https://your-server/api/v2/workspaces/66a…/members \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "userId": "66b…", "role": "editor" }'

# 改角色
curl -X PATCH https://your-server/api/v2/workspaces/66a…/members/66b… \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "role": "viewer" }'
```

### 约束

- 修改容量设定不允许低于当前 `usedBytes`(`400 CAPACITY_BELOW_USED`)。
- 删除工作区要求其网盘为空(`usedBytes === 0`),否则 `400 WORKSPACE_NOT_EMPTY`。

---

## 5. 网盘 `/api/v2/netdisk`

### 字段(节点 DiskNode)

| 字段          | 类型     | 说明                                                        |
| ------------- | -------- | ----------------------------------------------------------- |
| `id`          | string   | ObjectId                                                    |
| `tenantId`    | string   | 归属租户                                                    |
| `workspaceId` | string   | 归属工作区;`null` = 租户级网盘,非 `null` = 工作区内容       |
| `parentId`    | string   | 父文件夹 ID;`null` = 所在作用域根                           |
| `type`        | `folder` / `file` | 节点类型                                          |
| `name`        | string   | 节点名(重命名可改)                                          |
| `sizeBytes`   | integer  | 文件大小(字节),文件夹恒为 `0`                              |
| `storageKey`  | string   | 物理存储相对键(仅 `file`)                                   |
| `mimeType`    | string   | MIME 类型(仅 `file`)                                        |
| `createdBy`   | string   | 创建者后台用户 ID                                           |
| `createdAt` / `updatedAt` | datetime | 时间戳                                        |

根(Root)字段:`id` / `tenantId` / `capacityBytes`(总容量,`0`=不限) / `usedBytes`(已用) / `createdAt` / `updatedAt`。

### 端点

| 方法   | 路径                                | 必需能力           | 返回            |
| ------ | ----------------------------------- | ------------------ | --------------- |
| GET    | `/api/v2/netdisk/root`              | read  Netdisk      | `{ root }`      |
| PATCH  | `/api/v2/netdisk/root`              | update Netdisk     | `{ root }`      |
| GET    | `/api/v2/netdisk/nodes`             | read  Netdisk      | `{ nodes }`     |
| POST   | `/api/v2/netdisk/folders`           | create Netdisk     | `{ node }`      |
| POST   | `/api/v2/netdisk/files`             | create Netdisk     | `{ node }`      |
| GET    | `/api/v2/netdisk/files/:id/download`| read  Netdisk      | 文件流           |
| PATCH  | `/api/v2/netdisk/nodes/:id`         | update Netdisk     | `{ node }`      |
| DELETE | `/api/v2/netdisk/nodes/:id`         | delete Netdisk     | `{ ok }`        |

### 列表与建夹

```bash
# 列出租户级网盘根目录下节点
GET /api/v2/netdisk/nodes

# 列出某工作区根目录下节点
GET /api/v2/netdisk/nodes?workspaceId=66a…

# 进入某文件夹(租户级)
GET /api/v2/netdisk/nodes?parentId=66c…

# 建文件夹(工作区内)
curl -X POST https://your-server/api/v2/netdisk/folders \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "name": "设计素材", "workspaceId": "66a…" }'
```

### 上传(multipart)

`POST /api/v2/netdisk/files`,字段名 `file`(单文件),可选表单字段 `workspaceId`、`parentId`:

```bash
curl -X POST https://your-server/api/v2/netdisk/files \
  -H "Authorization: Bearer <token>" \
  -F "file=@report.pdf" \
  -F "workspaceId=66a…"
# → { "node": { "id": "…", "type": "file", "name": "report.pdf", "sizeBytes": 204800, "workspaceId": "66a…", ... } }
```

### 下载

```bash
curl https://your-server/api/v2/netdisk/files/<id>/download \
  -H "Authorization: Bearer <token>" \
  --output report.pdf
# 响应带 Content-Disposition: attachment; filename=原文件名
```

### 配额规则

- **双层配额**:租户根总容量 + 工作区容量。上传同时占用两者;删除文件自动回滚。
- 超出租户总容量 → `413 INSUFFICIENT_TENANT_CAPACITY`;超出工作区容量 → `413 INSUFFICIENT_WORKSPACE_CAPACITY`。
- 修改容量低于已用 → `400 CAPACITY_BELOW_USED`。
- 单文件默认上限 **200MB**(服务端 `NETDISK_MAX_UPLOAD_BYTES` 可调),超限 → `413`。
- 删除文件夹要求为空,否则 `400 FOLDER_NOT_EMPTY`。

---

## 6. 审计日志 `/api/v2/audit-logs`

### 字段(AuditLog)

| 字段           | 类型     | 说明                                                        |
| -------------- | -------- | ----------------------------------------------------------- |
| `id`           | string   | ObjectId                                                    |
| `tenantId`     | string   | 事件所属租户(平台级操作可为空)                              |
| `actorUserId`  | string   | 操作者后台用户 ID                                           |
| `actorUsername`| string   | 操作者用户名                                                |
| `action`       | string   | 事件动作(`<module>.<verb>`)                                 |
| `targetType`   | `workspace` / `workspace_member` / `disk_node` / `disk_root` / `notice` | 目标类型 |
| `targetId`     | string   | 目标资源 ID(可选)                                          |
| `detail`       | object   | 事件明细(变更摘要,不含敏感原文)                             |
| `createdAt`    | datetime | 事件时间                                                    |

### 端点

| 方法 | 路径                       | 必需能力          | 返回                                    |
| ---- | -------------------------- | ----------------- | --------------------------------------- |
| GET  | `/api/v2/audit-logs`       | read AuditLog     | `{ items, page, pageSize, total }`      |

### 查询参数

| 参数         | 类型              | 说明                                  |
| ------------ | ----------------- | ------------------------------------- |
| `page`       | int               | 页码,默认 1                           |
| `pageSize`   | int               | 每页数量,默认 50,最大 200             |
| `action`     | string            | 按动作精确过滤                        |
| `targetType` | string            | 按目标类型过滤                        |
| `targetId`   | string            | 按目标 ID 过滤                        |
| `actorUserId`| string            | 按操作者过滤                          |
| `since`      | ISO 8601 datetime | 仅返回 `createdAt >= since`           |

> 租户用户只能查到**本租户**的事件;平台超管(无租户)可跨租户查看。`operator` 无 `read AuditLog` 能力,调用返回 `403`。

### 事件动作(自动埋点)

| 模块     | action                        | 触发操作                         |
| -------- | ----------------------------- | -------------------------------- |
| 工作区   | `workspace.create`            | 创建工作区                       |
| 工作区   | `workspace.update`            | 更新工作区(名称/描述/容量)       |
| 工作区   | `workspace.delete`            | 删除工作区                       |
| 工作区   | `workspace.memberAdd`         | 添加成员                         |
| 工作区   | `workspace.memberUpdate`      | 修改成员角色                     |
| 工作区   | `workspace.memberRemove`      | 移除成员                         |
| 网盘     | `netdisk.folderCreate`        | 创建文件夹                       |
| 网盘     | `netdisk.fileUpload`          | 上传文件                         |
| 网盘     | `netdisk.nodeRename`          | 重命名节点                       |
| 网盘     | `netdisk.nodeDelete`          | 删除节点                         |
| 网盘     | `netdisk.rootUpdate`          | 设置租户网盘总容量               |
| 通知     | `notice.create`               | 创建通知(草稿)                   |
| 通知     | `notice.update`               | 更新通知                         |
| 通知     | `notice.delete`               | 删除通知                         |
| 通知     | `notice.publish`              | 发起/发布通知                    |
| 通知     | `notice.revoke`               | 撤销通知                         |

### 示例

```bash
# 最近 50 条本租户事件
GET /api/v2/audit-logs

# 只看上传文件事件,时间倒序
GET /api/v2/audit-logs?action=netdisk.fileUpload

# 按工作区过滤 + 分页
GET /api/v2/audit-logs?targetType=workspace&targetId=66a…&page=1&pageSize=20
```

---

## 7. 通知 `/api/v2/notices`

### 字段(Notice)

| 字段          | 类型                       | 说明                                                  |
| ------------- | -------------------------- | ----------------------------------------------------- |
| `id`          | string                     | ObjectId                                              |
| `tenantId`    | string                     | 归属租户                                              |
| `title`       | string                     | 通知标题                                              |
| `content`     | string                     | 通知正文                                              |
| `type`        | string                     | 通知类型(自由分类,如 `system` / `announcement`)        |
| `status`      | `draft` / `published` / `revoked` | 生命周期状态                                    |
| `recipients`  | string[]                   | 定向接收人后台用户 ID 列表;`[]` = 租户全体             |
| `createdBy`   | string                     | 创建者后台用户 ID                                     |
| `publishedAt` | datetime                   | 发布/发起时间(仅 published)                           |
| `revokedAt`   | datetime                   | 撤销时间(仅 revoked)                                  |
| `createdAt` / `updatedAt` | datetime          | 时间戳                                                |

### 状态机

```
draft → published → revoked
```

- 创建默认 `draft`。
- `published` 不可直接更新,须先 `revoke` 回 `revoked` 再更新。
- `revoked` 不可再次发布。
- 删除任意状态可删。

### 端点

| 方法   | 路径                    | 必需能力       | 返回            |
| ------ | ----------------------- | -------------- | --------------- |
| GET    | `/api/v2/notices`       | read  Notice   | `{ notices }`   |
| POST   | `/api/v2/notices`       | create Notice  | `{ notice }`    |
| GET    | `/api/v2/notices/mine`  | read  NoticeRead | `{ notices }`(含 isRead/readAt) |
| GET    | `/api/v2/notices/unread-count` | read NoticeRead | `{ unreadCount }` |
| GET    | `/api/v2/notices/:id`   | read  Notice   | `{ notice }`    |
| PATCH  | `/api/v2/notices/:id`   | update Notice  | `{ notice }`    |
| DELETE | `/api/v2/notices/:id`   | delete Notice  | `{ ok }`        |
| POST   | `/api/v2/notices/:id/publish` | update Notice | `{ notice }` |
| POST   | `/api/v2/notices/:id/revoke`  | update Notice | `{ notice }` |
| POST   | `/api/v2/notices/:id/read`    | update NoticeRead | `{ ok, readAt }` |

### 已读未读(接收人视角)

- 每个后台用户看到的是**已发布且对本人可见**的通知(`recipients` 为空 = 全体,非空 = 定向含本人)。
- 已读状态存于 `notice_reads` 集合,`(noticeId, userId)` 唯一,`POST /:id/read` 幂等标记。
- `GET /notices/mine` 返回每条带 `isRead` / `readAt`;`?onlyUnread=true` 只回未读。
- `GET /notices/unread-count` 返回未读总数(前端角标)。

```bash
# 我的通知(含已读状态)
GET /api/v2/notices/mine
# → { "notices": [ { "id": "…", "title": "…", "isRead": false, ... }, ... ] }

# 仅未读
GET /api/v2/notices/mine?onlyUnread=true

# 未读数
GET /api/v2/notices/unread-count
# → { "unreadCount": 3 }

# 标记已读
POST /api/v2/notices/<id>/read
# → { "ok": true, "readAt": "2026-08-04T…" }
```

### 示例

```bash
# 列表(可按状态过滤)
GET /api/v2/notices?status=published

# 发起/发布一条面向全体的通知
curl -X POST https://your-server/api/v2/notices \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "title": "系统维护通知", "content": "本周六 2:00-4:00 例行维护。", "type": "system" }'
# → { "notice": { "id": "…", "status": "draft", "recipients": [], ... } }

curl -X POST https://your-server/api/v2/notices/<id>/publish \
  -H "Authorization: Bearer <token>"

# 定向给指定用户
curl -X POST https://your-server/api/v2/notices \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "title": "私有通知", "content": "仅你可见", "recipients": ["66b…"] }'

# 撤销
curl -X POST https://your-server/api/v2/notices/<id>/revoke \
  -H "Authorization: Bearer <token>"
```

---

## 8. 角色 / 权限目录

| 方法 | 路径           | 必需能力   | 返回     |
| ---- | -------------- | ---------- | -------- |
| GET  | `/admin/roles` | read Role  | `{ roles }` |

返回静态角色目录及权限矩阵(`permissions: [{ action, subject }]`),供前端渲染角色说明与能力。

---

## 9. 变更与联系

- 接口变更通过本文档同步更新,前缀 `/api/v2` 保证向后兼容。
- 重大不兼容变更启用 `/api/v3`,旧版保留。
- 问题反馈:联系系统管理员。
