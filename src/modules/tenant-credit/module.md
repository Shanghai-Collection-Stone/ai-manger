# 模块名称 (Module Name)

租户 Credit 分配模块（tenant-credit）

## 概述 (Overview)

租户的 Credit 不再全员共用，而是统一分配给成员：超管给租户充值进「待分配额度」，租户管理员把待分配额度分给（或收回）成员、设置新成员加入时的赠送额度；超管可把旧的全员共用租户迁移为分配模式（每个成员各得一份原余额全额，或保留原余额作待分配额度），并给手机号账号的个人额度充值。个人额度跨租户通用，成员在某租户分到的额度只在该租户可用。桌面端账户中心读取的当前成员额度接口 `GET /admin/auth/credit-account` 也由本模块提供。

文件路径: `src/modules/tenant-credit`
钱包与扣费底层见 [ai-billing 模块](../ai-billing/module.md)。

## 文件清单 (File List)

- `tenant-credit.module.ts` — NestJS 模块装配，导入后台鉴权、计费钱包与数据源。
- `entities/tenant-credit.entity.ts` — 额度总览、成员额度、当前额度拆分与当前 Credit 账户视图类型。
- `services/tenant-credit.service.ts` — 租户边界与角色校验、成员额度总览、分配 / 回收、新成员赠送设置、模式切换与旧余额迁移、个人额度充值、当前成员额度。
- `controller/tenant-credit.controller.ts` — 后台接口，全部挂 `AdminAuthGuard` + `AdminPoliciesGuard` 与 `@RequirePermission`。
- `controller/tenant-credit.dto.ts` — 流水分页、总览查询、分配、赠送设置、模式切换与个人充值 / 调账请求校验。

## 函数清单 (Function List)

### tenant-credit.module.ts

- `TenantCreditModule` — 装配租户额度控制器与服务并导出服务 | keywords: 租户额度模块, 成员额度分配, tenant-credit-module, member-credit-allocation

### controller/tenant-credit.controller.ts

- `TenantCreditController` — 租户额度后台接口，统一鉴权 | keywords: 租户额度接口, 入口鉴权, tenant-credit-controller, endpoint-authorization
- `TenantCreditController(credits)` — 注入租户额度服务 | keywords: 额度接口初始化, 服务注入, tenant-credit-controller-init, service-injection
- `TenantCreditController.getCurrentCreditAccount(req,query)` — 当前成员合计额度、拆分与流水（沿用旧路径） | keywords: 当前Credit账户, 自身流水, current-credit-account, own-transaction-list
- `TenantCreditController.getOverview(req,query)` — 租户额度总览与成员额度列表 | keywords: 成员额度总览接口, 待分配额度, member-credit-overview-endpoint, pool-credit
- `TenantCreditController.updateSettings(req,tenantId,dto)` — 设置新成员赠送 | keywords: 新成员赠送设置接口, 租户额度设置, update-credit-settings-endpoint, new-member-grant
- `TenantCreditController.switchMode(req,tenantId,dto)` — 超管切分配模式并可迁移旧余额 | keywords: 切换分配模式接口, 旧余额迁移, switch-credit-mode-endpoint, legacy-credit-migration
- `TenantCreditController.allocate(req,tenantId,memberId,dto)` — 分配或回收成员额度 | keywords: 分配成员额度接口, 回收额度, allocate-member-credit-endpoint, reclaim-credit
- `TenantCreditController.listMemberTransactions(req,tenantId,memberId,query)` — 成员本租户额度流水 | keywords: 成员额度流水接口, 租户边界, member-credit-ledger-endpoint, tenant-boundary
- `TenantCreditController.getPersonalAccount(req,accountId,query)` — 超管查个人额度与流水 | keywords: 个人额度查询接口, 个人流水, personal-credit-query-endpoint, personal-ledger
- `TenantCreditController.rechargePersonal(req,accountId,dto)` — 超管个人额度正数充值 | keywords: 个人充值接口, 跨租户通用, personal-recharge-endpoint, cross-tenant-credit
- `TenantCreditController.adjustPersonal(req,accountId,dto)` — 超管个人额度正负调账 | keywords: 个人调账接口, 余额增减, personal-adjustment-endpoint, balance-change
- `TenantCreditController.requireUser(req)` — 读取已鉴权后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context

### controller/tenant-credit.dto.ts

- `CreditLedgerQueryDto` — 流水 limit / before 游标 | keywords: 流水分页参数, 时间游标, credit-ledger-query-dto, time-cursor
- `TenantCreditOverviewQueryDto` — 总览目标租户 | keywords: 额度总览查询, 目标租户, tenant-credit-overview-query-dto, target-tenant
- `AllocateMemberCreditDto` — 非零分配数量与原因 | keywords: 成员额度分配请求体, 回收额度, allocate-member-credit-dto, reclaim-credit
- `UpdateTenantCreditSettingsDto` — 新成员赠送额度 | keywords: 新成员赠送设置, 租户额度设置, tenant-credit-settings-dto, new-member-grant
- `SwitchTenantCreditModeDto` — 是否迁移旧余额 | keywords: 切换分配模式请求体, 旧余额迁移, switch-credit-mode-dto, legacy-credit-migration
- `RechargePersonalCreditDto` — 个人额度正数充值 | keywords: 个人充值请求体, 外部单号, personal-recharge-dto, reference-id
- `AdjustPersonalCreditDto` — 个人额度非零调账 | keywords: 个人调账请求体, 非零变动, personal-adjustment-dto, nonzero-change

### services/tenant-credit.service.ts

- `UNIT_SCALE` — 一个 Credit 的整数最小计费单位 | keywords: 额度计费精度, 最小计费单位, tenant-credit-unit-scale, billing-unit-scale
- `WALLET_BUSINESS_ERRORS` — 需原样转成 400 的钱包业务错误码 | keywords: 钱包业务错误, 错误透传, wallet-business-errors, error-passthrough
- `TenantCreditService` — 租户额度分配服务 | keywords: 租户额度分配服务, 成员额度, tenant-credit-service, member-credit
- `TenantCreditService(db,wallet)` — 注入数据源库与钱包服务 | keywords: 额度服务初始化, 钱包依赖, tenant-credit-service-init, wallet-dependency
- `getCurrentAccount(user,input)` — 当前成员合计额度（tenant.credit 换成合计）、拆分与流水 | keywords: 当前Credit账户, 额度拆分, current-credit-account, credit-breakdown
- `getOverview(user,requestedTenantId?)` — 额度总览与成员额度，超管附个人额度 | keywords: 成员额度总览, 待分配额度, member-credit-overview, pool-credit
- `allocate(user,tenantId,memberId,input)` — 正数从待分配额度划给成员，负数收回 | keywords: 分配成员额度, 回收成员额度, allocate-member-credit, reclaim-member-credit
- `updateSettings(user,tenantId,input)` — 设置新成员赠送额度 | keywords: 新成员赠送设置, 注册发放额度, update-new-member-grant, registration-grant-setting
- `switchMode(user,tenantId,input)` — 超管切分配模式，migrate 时每人一份全额 | keywords: 切换分配模式, 旧余额迁移, switch-credit-mode, legacy-credit-migration
- `listMemberTransactions(user,tenantId,memberId,input)` — 成员本租户额度流水 | keywords: 成员额度流水, 租户边界, member-credit-ledger, tenant-boundary
- `getPersonalAccount(user,accountId,input)` — 超管读个人额度与流水 | keywords: 个人额度查询, 个人流水, personal-credit-query, personal-ledger
- `changePersonalCredit(user,accountId,type,input)` — 超管个人额度充值或调账 | keywords: 个人额度充值, 跨租户通用, change-personal-credit, cross-tenant-credit
- `grantNewMember(memberId)` — 新成员加入后按租户设置赠送，失败只记日志（供 tenant-join 调用） | keywords: 新成员赠送, 注册发放, grant-new-member, registration-grant
- `toSummary(tenant)` — 租户文档转额度总览 | keywords: 额度总览视图, 租户模式, tenant-credit-summary-view, tenant-mode
- `tenantUnits(tenant)` — 读取租户余额单位并兼容历史文档 | keywords: 租户余额单位, 历史兼容, tenant-balance-units, legacy-compat
- `assertAllocatable(tenant)` — 只允许分配模式的有限额度租户 | keywords: 可分配校验, 共用模式拒绝, assert-allocatable, shared-mode-reject
- `resolveTenantId(user,requested?)` — 操作员无权、租户管理员限本租户、超管须指定 | keywords: 额度租户范围, 跨租户禁止, credit-tenant-scope, cross-tenant-forbidden
- `isSuperAdmin(user)` — 平台超管判断 | keywords: 平台超管, 角色判断, platform-super-admin, role-check
- `assertSuperAdmin(user)` — 非平台超管拒绝 | keywords: 超管校验, 权限拒绝, assert-super-admin, permission-denied
- `requireTenant(tenantId)` — 读取租户 | keywords: 读取租户, 租户不存在, require-tenant, tenant-not-found
- `requireMember(tenantId,memberId)` — 读取本租户未注销成员 | keywords: 读取租户成员, 成员不存在, require-tenant-member, member-not-found
- `requireAccount(accountId)` — 读取手机号账号 | keywords: 读取手机号账号, 账号不存在, require-account, account-not-found
- `operatorOf(user)` — 流水操作人 | keywords: 流水操作人, 后台操作, ledger-operator, admin-operation
- `runWallet(action)` — 钱包业务错误转 400 | keywords: 钱包错误转换, 业务错误码, wallet-error-mapping, business-error-code

## 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 租户额度分配 | tenant-credit |
| 成员额度 | member-credit |
| 待分配额度 | pool-credit |
| 分配成员额度 | allocate-member-credit |
| 回收额度 | reclaim-credit |
| 新成员赠送 | new-member-grant |
| 注册发放 | registration-grant |
| 切换分配模式 | switch-credit-mode |
| 旧余额迁移 | legacy-credit-migration |
| 个人额度充值 | change-personal-credit |
| 跨租户通用 | cross-tenant-credit |
| 当前Credit账户 | current-credit-account |
| 额度拆分 | credit-breakdown |
| 额度租户范围 | credit-tenant-scope |
| 跨租户禁止 | cross-tenant-forbidden |

## 类型导出 (Type Exports)

- `TenantCreditSummaryView` — 模式、待分配额度（无限为 -1）、新成员赠送、迁移时间。
- `MemberCreditView` — 成员本租户额度；`personalCredit` 仅超管可见，其余为 null。
- `CurrentCreditWalletView` — 当前成员 `tenantCredit + personalCredit = totalCredit`，无限额度均为 -1。
- `CurrentCreditAccountView` — `{ tenant, transactions }`，`tenant.credit` 为合计额度，拆分在 `tenant.creditWallet`。

## 模块功能描述 (Module Feature Description)

**额度模式**

- 分配模式（`creditMode: 'allocated'`，新建租户默认）：租户余额只是待分配额度，成员不能直接用；成员用的是分给自己的本租户额度，不够再扣自己的个人额度。
- 全员共用（缺省 / `'shared'`，旧租户）：保持旧行为，成员共用租户余额，不够再扣个人额度。超管在后台「成员 Credit」里二选一切换：**迁移**——原子切模式并清零租户余额，每个启用成员各发一份原余额全额（流水类型 `migration`）；**直接切换**——原余额留作待分配额度，成员额度从 0 开始逐个分。
- 无限额度租户（-1）成员不扣费，不允许分配。

**分配与赠送**

租户管理员（或超管）可以给本租户成员分配（从待分配额度划出）或回收（退回待分配额度），出入两笔 `allocation` 流水，待分配额度不足报 `CREDIT_POOL_INSUFFICIENT`，成员额度不足报 `MEMBER_CREDIT_INSUFFICIENT`。新成员赠送额度（`memberCreditGrant`）在成员通过注册（随便逛逛 / 邀请码）、已有账号接受邀请、入驻申请审批通过加入租户时由 tenant-join 调 `grantNewMember` 发放：只对分配模式生效，同一成员只发一次，待分配额度不足时不发且不影响注册。

**个人额度**

挂在手机号账号上（`account:<账号ID>`），该账号加入的所有租户都能用。当前没有在线支付，由超管在后台入账（充值或正负调账，外部单号幂等）。

**当前成员额度**

`GET /admin/auth/credit-account` 从 admin 模块迁到本模块，路径与 `{ tenant, transactions }` 形状不变：`tenant.credit` / `creditUnits` 换成当前成员可用合计（本租户额度 + 个人额度），`tenant.creditWallet` 给出拆分；流水在分配模式下是成员钱包 + 个人钱包，共用模式下是租户钱包 + 个人钱包。旧桌面客户端直接显示 `tenant.credit` 也是对的。

**入口鉴权**

| 路由 | 权限 | 服务层限制 |
| --- | --- | --- |
| `GET /admin/auth/credit-account` | `read User` | 只按登录成员返回 |
| `GET /admin/tenant-credits?tenantId=` | `read User` | 操作员拒绝；租户管理员限本租户；超管须指定 |
| `PATCH /admin/tenant-credits/:tenantId/settings` | `update User` | 同上 |
| `POST /admin/tenant-credits/:tenantId/mode` | `update User` | 仅平台超管 |
| `POST /admin/tenant-credits/:tenantId/members/:memberId/allocate` | `update User` | 租户边界 + 分配模式 + 有限额度 |
| `GET /admin/tenant-credits/:tenantId/members/:memberId/transactions` | `read User` | 租户边界 |
| `GET /admin/credit-accounts/:accountId` | `read User` | 仅平台超管 |
| `POST /admin/credit-accounts/:accountId/recharge` | `update User` | 仅平台超管 |
| `POST /admin/credit-accounts/:accountId/adjust` | `update User` | 仅平台超管 |

全部接口挂 `AdminAuthGuard` + `AdminPoliciesGuard`，`subject` 取自 `ADMIN_SUBJECTS` 的 `User`，与原有租户充值接口一致。

**错误码**

`TENANT_REQUIRED`、`INVALID_TENANT_ID`、`TENANT_NOT_FOUND`、`MEMBER_NOT_FOUND`、`ACCOUNT_NOT_FOUND`、`ACCOUNT_DELETED`、`CROSS_TENANT_FORBIDDEN`、`PERMISSION_DENIED`、`CREDIT_AMOUNT_INVALID`、`CREDIT_POOL_INSUFFICIENT`、`MEMBER_CREDIT_INSUFFICIENT`、`CREDIT_OVERDRAFT`、`TENANT_CREDIT_SHARED_MODE`、`TENANT_CREDIT_ALREADY_ALLOCATED`、`UNLIMITED_CREDIT_CANNOT_ALLOCATE`。
