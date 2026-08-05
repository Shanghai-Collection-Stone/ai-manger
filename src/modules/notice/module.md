# Notice Module

## 模块描述
通知模块(v2)，后台发起的站内通知管理：增删改查 + 发起(发布)/撤销；接收人视角的"我的通知/已读未读"(`notice_reads` 集合记录)。隶属租户，按后台 JWT + CASL 鉴权(subject `Notice` 管理、`NoticeRead` 接收人阅读状态)，租户隔离。通知状态机 `draft → published → revoked`；可定向接收人(`recipients` 用户列表，空 = 租户全体)。管理变更自动埋点审计(`notice.*` 动作)。
文件路径: `src/modules/notice`
路由前缀: `api/v2/notices`

## 功能描述及关键词

### services/notice.service.ts
通知服务，CRUD 与发布/撤销，接收人我的通知/已读未读，审计埋点。
- **关键词**: notice, notification, crud, publish, revoke, draft, status, read, unread, recipient, audit, tenant-isolation, mongo
- **函数**:
  - `ensureIndexes`: 初始化通知与已读记录索引/ensure notice indexes | keywords: ensure-notice-indexes
  - `list`: 通知列表(租户隔离，状态过滤)/list notices | keywords: list-notices
  - `get`: 获取单条通知/get notice by id | keywords: get-notice-by-id
  - `create`: 创建通知(草稿)/create notice | keywords: create-notice
  - `update`: 更新通知(草稿/已撤销可改)/update notice | keywords: update-notice
  - `remove`: 删除通知/delete notice | keywords: delete-notice
  - `publish`: 发起/发布通知(draft→published)/publish notice | keywords: publish-notice
  - `revoke`: 撤销通知(published→revoked)/revoke notice | keywords: revoke-notice
  - `mine`: 我的通知(已发布且可见，附带已读状态)/list my notices with read state | keywords: list-my-notices-with-read-state
  - `unreadCount`: 当前用户未读通知数/count unread notices | keywords: count-unread-notices
  - `markRead`: 标记通知已读(幂等)/mark notice as read | keywords: mark-notice-as-read
  - `visibleFilter`: 构建可见已发布通知过滤条件/build visible published filter | keywords: build-visible-published-filter

### controller/notice.controller.ts
通知控制器，`api/v2/notices` 下 CRUD、发布/撤销与我的通知/已读端点，逐入口挂 `@RequirePermission`。
- **关键词**: controller, notice, publish, revoke, mine, read, casl, jwt, v2, require-permission
- **函数**:
  - `list`: 通知列表端点/list notices endpoint | keywords: list-notices-endpoint
  - `create`: 创建通知端点/create notice endpoint | keywords: create-notice-endpoint
  - `mine`: 我的通知端点(接收人视角)/my notices endpoint | keywords: my-notices-endpoint
  - `unreadCount`: 未读数端点/unread count endpoint | keywords: unread-count-endpoint
  - `get`: 获取通知端点/get notice endpoint | keywords: get-notice-endpoint
  - `update`: 更新通知端点/update notice endpoint | keywords: update-notice-endpoint
  - `remove`: 删除通知端点/delete notice endpoint | keywords: delete-notice-endpoint
  - `publish`: 发布通知端点/publish notice endpoint | keywords: publish-notice-endpoint
  - `revoke`: 撤销通知端点/revoke notice endpoint | keywords: revoke-notice-endpoint
  - `markRead`: 标记已读端点/mark notice read endpoint | keywords: mark-notice-read-endpoint
  - `requireUser`: 读取当前登录后台用户/read current admin user | keywords: read-current-admin-user

### controller/notice.dto.ts
通知请求体 DTO 及校验(创建/更新/列表状态过滤/我的通知)。
- **关键词**: dto, class-validator, notice, recipients, status, only-unread

### entities/notice.entity.ts
通知实体与状态定义。
- **关键词**: entity, notice, notice-status
- **类型导出**: `NoticeEntity`, `NoticeStatus`

### entities/notice-read.entity.ts
通知已读记录实体，`(noticeId, userId)` 唯一。
- **关键词**: entity, notice-read, read-record
- **类型导出**: `NoticeReadEntity`

### constants/notice-audit.constants.ts
通知审计事件动作常量(`notice.<verb>`)。
- **关键词**: audit, action, namespace, notice
- **类型导出**: `NOTICE_AUDIT_ACTIONS`

### notice.module.ts
通知模块定义，导出 `NoticeService`。
- **关键词**: module, nest, export-service
