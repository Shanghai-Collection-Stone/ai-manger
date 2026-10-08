# 模块名称 (Module Name)

## 概述 (Overview)

租户入驻模块负责默认或邀请注册（短信验证码 + 邮箱验证码，成功后发注册成功邮件）、租户入驻申请审批、审批邮件通知和不限人数的限时邀请链接。模块以平台手机号账号为申请主体，以租户成员身份作为审批或邀请成功后的落点，并严格隔离租户管理员的数据范围。

## 文件清单 (File List)

- `tenant-join.module.ts` — NestJS 模块装配，导入后台、数据源和 SaaS 租户能力。
- `entities/tenant-join.entity.ts` — 入驻申请、邀请、通知结果和接口视图类型。
- `services/tenant-join-application.service.ts` — 两种注册模式、申请分页、审批和通知状态回写。
- `services/tenant-invite.service.ts` — 邀请生成、预览、接受、撤销、使用计数和公开入口限流。
- `services/tenant-join-notify.service.ts` — 审批邮件文案（按 mail 模块统一版式发送）、称呼兜底和失败收敛。
- `controller/tenant-join.controller.ts` — 公开注册/邀请接口与受权限保护的管理接口。
- `controller/tenant-join.dto.ts` — 注册、审批、邀请和分页请求校验。

## 函数清单 (Function List)

- `TenantJoinModule()` — 装配租户入驻控制器与服务 | keywords: 租户入驻模块, 邀请入驻, tenant-join-module, invite-onboarding
- `TenantJoinController()` — 提供公开注册邀请与受保护的申请审批、邀请管理入口 | keywords: 租户入驻接口, 入口鉴权, tenant-join-controller, endpoint-authorization
- `TenantJoinController.previewInvite(code)` — 公开预览邀请码实时状态 | keywords: 邀请预览接口, 公开免鉴权, invite-preview-endpoint, public-no-auth
- `TenantJoinController.register(req,dto)` — 使用短信可信手机号与邮箱验证码可信邮箱执行目标租户注册 | keywords: 租户注册接口, 短信验证码, 邮箱验证码, tenant-register-endpoint, sms-verification, email-verification
- `TenantJoinController.acceptInvite(req,code,dto)` — 已有账号凭密码接受邀请并执行防刷 | keywords: 接受邀请接口, 防暴力尝试, accept-invite-endpoint, brute-force-throttle
- `TenantJoinController.listApplications(req,query)` — 分页读取可见租户范围的申请 | keywords: 申请列表接口, 租户范围, application-list-endpoint, tenant-scope
- `TenantJoinController.approveApplication(req,id)` — 审批通过本租户申请 | keywords: 通过申请接口, 更新入驻权限, approve-application-endpoint, update-tenant-join
- `TenantJoinController.rejectApplication(req,id,dto)` — 拒绝本租户申请并记录原因 | keywords: 拒绝申请接口, 更新入驻权限, reject-application-endpoint, update-tenant-join
- `TenantJoinController.listInvites(req,query)` — 读取当前或指定租户邀请 | keywords: 邀请列表接口, 读取入驻权限, invite-list-endpoint, read-tenant-join
- `TenantJoinController.createInvite(req,dto)` — 创建租户限时邀请 | keywords: 创建邀请接口, 创建入驻权限, create-invite-endpoint, create-tenant-join
- `TenantJoinController.revokeInvite(req,id)` — 撤销租户邀请 | keywords: 撤销邀请接口, 删除入驻权限, revoke-invite-endpoint, delete-tenant-join
- `TenantJoinController.readClientIp(req)` — 从转发头或连接读取客户端 IP | keywords: 读取客户端IP, 代理转发, read-client-ip, forwarded-for
- `TenantJoinController.requireUser(req)` — 从请求获取已鉴权后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `TenantJoinApplicationService()` — 编排注册模式、申请审批与通知回写 | keywords: 入驻申请服务, 两种注册模式, join-application-service, registration-modes
- `TenantJoinApplicationService.onModuleInit()` — 建立申请集合索引 | keywords: 申请索引, 待审批唯一, application-indexes, unique-pending-application
- `TenantJoinApplicationService.register(input)` — 按默认或邀请模式注册可信手机号，成功后发注册成功邮件 | keywords: 租户目标注册, 可信手机号, tenant-target-registration, trusted-phone
- `TenantJoinApplicationService.registerByInvite(input)` — 邀请模式建账号并在加成员失败时回滚，成功后发带团队名的注册成功邮件 | keywords: 邀请模式注册, 失败回滚账号, invite-mode-registration, account-rollback
- `TenantJoinApplicationService.list(user,input)` — 分页查询申请与当前范围待审总数 | keywords: 申请分页列表, 待审数量, paged-application-list, pending-count
- `TenantJoinApplicationService.approve(user,id)` — 加入租户后落审批结果并独立通知 | keywords: 通过入驻申请, 审批后通知, approve-join-application, notify-after-approval
- `TenantJoinApplicationService.reject(user,id,reason?)` — 落拒绝结果后独立通知 | keywords: 拒绝入驻申请, 拒绝后通知, reject-join-application, notify-after-rejection
- `TenantJoinApplicationService.persistNotifyResult(application,notify)` — 回写邮件通知状态且不回滚审批 | keywords: 回写通知结果, 邮件失败不回滚, persist-notify-result, no-approval-rollback
- `TenantJoinApplicationService.requireApplication(user,id)` — 读取申请并校验租户边界 | keywords: 读取入驻申请, 跨租户禁止, require-join-application, cross-tenant-forbidden
- `TenantJoinApplicationService.buildScope(user,requestedTenantId?)` — 构建超管或租户管理员可见范围 | keywords: 申请可见范围, 租户隔离, application-visibility-scope, tenant-isolation
- `TenantJoinApplicationService.toView(row)` — 转换申请接口视图与 ISO 时间 | keywords: 申请视图转换, ISO时间, application-view-mapping, iso-timestamp
- `TenantInviteService()` — 管理邀请生命周期、使用计数与公开入口限流 | keywords: 租户邀请服务, 公开入口限流, tenant-invite-service, public-endpoint-throttle
- `TenantInviteService.onModuleInit()` — 建立邀请码唯一和租户列表索引，以及尝试计数窗口的过期索引 | keywords: 邀请索引, 邀请码唯一, invite-indexes, unique-invite-code
- `TenantInviteService.preview(code)` — 返回邀请有效性和失效原因 | keywords: 邀请预览, 邀请有效性, invite-preview, invite-validity
- `TenantInviteService.requireUsable(code)` — 校验邀请存在、未撤销且未过期 | keywords: 校验有效邀请, 邀请错误码, assert-valid-invite, invite-error-code
- `TenantInviteService.markUsed(inviteId)` — 原子增加使用次数并记录最近使用时间 | keywords: 邀请使用计数, 原子更新, invite-use-count, atomic-update
- `TenantInviteService.accept(input)` — 已有账号验证密码并加入邀请租户 | keywords: 已有账号接受邀请, 邀请加入租户, existing-account-accept-invite, invite-join-tenant
- `TenantInviteService.list(user,requestedTenantId?)` — 按租户边界列出邀请 | keywords: 邀请列表, 租户数据边界, invite-list, tenant-data-boundary
- `TenantInviteService.create(user,input)` — 创建默认七天或指定期限邀请 | keywords: 创建租户邀请, 邀请有效期, create-tenant-invite, invite-expiry
- `TenantInviteService.revoke(user,id)` — 在租户边界内撤销邀请 | keywords: 撤销租户邀请, 立即失效, revoke-tenant-invite, immediate-invalidation
- `TenantInviteService.resolveTenantScope(user,requestedTenantId,requireSuperAdminTenant)` — 解析邀请管理目标租户 | keywords: 租户范围解析, 超管指定租户, resolve-tenant-scope, super-admin-tenant-selection
- `TenantInviteService.assertTenantAccess(user,tenantId)` — 禁止非超管跨租户操作邀请 | keywords: 邀请租户鉴权, 跨租户禁止, invite-tenant-authorization, cross-tenant-forbidden
- `TenantInviteService.assertAttemptLimit(key,windowMs)` — 每个限流窗口最多允许十次尝试，计数存 Mongo `tenant_invite_attempts`，多进程共用 | keywords: 共享限流计数, 尝试次数限制, shared-rate-limit, attempt-limit
- `TenantInviteService.toView(row)` — 计算实时邀请状态并转换视图 | keywords: 邀请视图转换, 实时邀请状态, invite-view-mapping, computed-invite-status
- `TenantJoinNotifyService()` — 按统一版式拼装审批邮件并把失败收敛成状态 | keywords: 入驻邮件通知, 审批解耦, join-email-notification, approval-decoupling
- `TenantJoinNotifyService.sendApproved(input)` — 发送含团队名、脱敏登录账号、审核时间与登录指引的申请通过邮件 | keywords: 申请通过邮件, 手机号脱敏, approval-email, masked-phone
- `TenantJoinNotifyService.sendRejected(input)` — 发送含团队名、审核结果与拒绝原因的申请未通过邮件 | keywords: 申请拒绝邮件, 拒绝原因, rejection-email, rejection-reason
- `TenantJoinNotifyService.greeting(displayName)` — 生成称呼，昵称为空时退回通用称呼 | keywords: 邮件称呼, 昵称兜底, mail-greeting, display-name-fallback
- `TenantJoinNotifyService.sendSafely(to,content)` — 按统一版式发送并捕获全部发送异常 | keywords: 安全发送邮件, 通知失败记录, safe-mail-send, notification-failure-record
- `TenantJoinRegisterDto()` — 校验邀请码或默认租户注册请求 | keywords: 租户入驻注册请求体, tenant-join-register-dto
- `AcceptInviteDto()` — 校验已有账号接受邀请请求 | keywords: 接受邀请请求体, accept-invite-dto
- `ApplicationListQueryDto()` — 校验申请列表分页查询 | keywords: 入驻申请查询参数, join-application-query-dto
- `RejectApplicationDto()` — 校验拒绝原因 | keywords: 拒绝申请请求体, reject-application-dto
- `InviteListQueryDto()` — 校验邀请列表租户筛选 | keywords: 邀请列表查询参数, invite-list-query-dto
- `CreateInviteDto()` — 校验邀请期限与目标租户 | keywords: 创建租户邀请请求体, create-invite-dto

## 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 租户入驻 | tenant-join |
| 两种注册模式 | registration-modes |
| 入驻申请 | join-application |
| 申请审批 | application-approval |
| 邀请入驻 | invite-onboarding |
| 邀请码 | invite-code |
| 邀请有效期 | invite-expiry |
| 审批邮件 | approval-email |
| 租户隔离 | tenant-isolation |
| 跨租户禁止 | cross-tenant-forbidden |
| 公开入口限流 | public-endpoint-throttle |
| 短信验证码 | sms-verification |
| 邮箱验证码 | email-verification |
| 注册成功邮件 | registration-success-email |
| 可信手机号 | trusted-phone |
| 手机号脱敏 | masked-phone |
| 通知失败不回滚 | no-approval-rollback |

## 类型导出 (Type Exports)

- `TenantJoinApplicationStatus` — 入驻申请状态：`pending`、`approved`、`rejected`。
- `TenantJoinNotifyStatus` — 邮件通知状态：`sent`、`failed`、`skipped`。
- `TenantJoinApplicationEntity` — `tenant_join_applications` 集合文档。
- `TenantInviteEntity` — `tenant_invites` 集合文档。
- `ApplicationView` — 申请列表和审批响应视图。
- `InviteView` — 邀请列表和创建响应视图，状态实时计算。
- `JoinNotifyResult` — 不抛异常的邮件通知结果。

## 模块功能描述 (Module Description)

**两种注册模式**

- `default`：不带邀请码时，沿用默认注册并立即加入默认租户「其他」。
- `invite`：先校验邀请有效，再创建平台账号并直接以 `operator` 加入邀请租户，不加入默认租户；加入成员失败会删除本次刚创建且 ID 精确匹配的平台账号作为补偿回滚。

注册时选择租户的能力已下线，系统不对外暴露租户列表。申请审批接口与后台列表保留备用，当前没有创建申请的入口。

**注册验证与注册成功邮件**

注册同时要求短信验证码（可信手机号）与邮箱验证码（可信邮箱，见 [email-verification 模块](../email-verification/module.md)），账号邮箱取 `req.emailVerification.email`。注册成功后由 `AdminService.notifyRegistered()` 异步发送「账号注册成功」邮件：默认模式列出登录账号（脱敏手机号）、绑定邮箱与注册时间；邀请模式额外写明已加入的团队。邮件失败只记日志，不影响注册结果。

**审批与邮件通知**

租户管理员只能审批本人租户，超管不受租户限制。通过审批时先加入目标租户并原子落审批状态，再发送通过邮件；拒绝同样先落审批状态再发邮件。两封邮件都用 mail 模块统一版式：通过邮件含团队名称、登录账号（脱敏）、审核结果、审核时间与登录指引；未通过邮件含团队名称、审核结果、原因说明（未填写时显示「管理员未填写」）与审核时间。邮件为空返回 `skipped`，发送失败返回 `failed` 并写入 `notifyError`，不回滚已完成审批。申请视图完整返回手机号供租户管理员审核；日志文案不记录手机号，邮件内手机号显示为中间四位脱敏。

**邀请链接规则**

邀请码使用 `crypto.randomBytes(16).toString('base64url')`，固定 22 位且字符集为 `[A-Za-z0-9_-]`。默认有效期 7 天，可选 1 至 30 天；有效期内不限使用人数，每次新成员加入时原子增加 `useCount`，已有成员再次接受不计数。过期后必须重新生成，撤销后立即失效。网页地址由前端按同源拼接 `/pages/invite.html?code=<code>`；客户端唤起协议为 `ai-marketing://invite?code=<code>`。

**入口鉴权**

| 路由 | 权限或公开防刷手段 |
| --- | --- |
| `GET /api/tenant-join/invites/:code` | 公开免鉴权；仅按高熵 22 位邀请码返回租户名、到期时间和有效状态。 |
| `POST /api/tenant-join/register` | 公开免鉴权；`@RequireSmsCode('register')` 与 `@RequireEmailCode('register')` 分别负责短信 / 邮箱验证码的有效期、尝试次数与发送侧频控，业务只信任 `req.smsVerification.phone` 与 `req.emailVerification.email`。 |
| `POST /api/tenant-join/invites/:code/accept` | 公开免鉴权；同一 IP 每分钟最多 10 次、同一账号每 10 分钟最多 10 次，进程内尽力而为，多实例之间不共享计数。 |
| `GET /api/tenant-join/applications` | `read TenantJoin`，`AdminAuthGuard` + `AdminPoliciesGuard`。 |
| `POST /api/tenant-join/applications/:id/approve` | `update TenantJoin`，`AdminAuthGuard` + `AdminPoliciesGuard`。 |
| `POST /api/tenant-join/applications/:id/reject` | `update TenantJoin`，`AdminAuthGuard` + `AdminPoliciesGuard`。 |
| `GET /api/tenant-join/invites` | `read TenantJoin`，`AdminAuthGuard` + `AdminPoliciesGuard`。 |
| `POST /api/tenant-join/invites` | `create TenantJoin`，`AdminAuthGuard` + `AdminPoliciesGuard`。 |
| `DELETE /api/tenant-join/invites/:id` | `delete TenantJoin`，`AdminAuthGuard` + `AdminPoliciesGuard`。 |

**错误码**

- 注册：`PHONE_ALREADY_REGISTERED`，以及 `SMS_*`、`EMAIL_*` 验证码系列。
- 邀请：`INVITE_NOT_FOUND`、`INVITE_EXPIRED`、`INVITE_REVOKED`、`TENANT_NOT_FOUND`、`TENANT_REQUIRED`、`TOO_MANY_ATTEMPTS`、`INVALID_CREDENTIALS`、`ACCOUNT_DELETED`。
- 审批与隔离：`APPLICATION_NOT_FOUND`、`APPLICATION_NOT_PENDING`、`CROSS_TENANT_FORBIDDEN`。

**集合与索引**

- `tenant_join_applications`：`{ tenantId: 1, status: 1, createdAt: -1 }`、`{ accountId: 1 }`，以及仅对 `status: 'pending'` 生效的 `{ accountId: 1, tenantId: 1 }` 唯一偏索引。
- `tenant_invites`：`{ code: 1 }` 唯一索引、`{ tenantId: 1, createdAt: -1 }` 列表索引。
