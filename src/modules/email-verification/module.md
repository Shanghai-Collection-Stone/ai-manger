# 模块名称 (Module Name)

邮箱验证码模块（email-verification）

## 概述 (Overview)

提供邮箱验证码的发送、判定与作废能力，验证码邮件经全局 [mail 模块](../mail/module.md) 的平台发信邮箱按统一版式发送。验证码只保存绑定邮箱与场景的 HMAC-SHA256 摘要，校验时原子累加尝试次数，业务成功后才作废。

模块为 `@Global()`，业务控制器通过 `@RequireEmailCode('<scene>')` 接入，写法与 [sms-verification 模块](../sms-verification/module.md) 的 `@RequireSmsCode` 一致，两者可叠加在同一接口上。

## 文件清单 (File List)

- `email-verification.module.ts` — 全局模块入口，装配发码接口、验证码服务、守卫与拦截器。
- `entities/email-verification.entity.ts` — 场景白名单、场景文案、元数据键、有效期与频控常量、验证码记录与请求上下文类型。
- `services/email-verification.service.ts` — 发码频控、验证码邮件文案、摘要校验、作废与发信错误收敛。
- `guards/email-code.guard.ts` — 按场景用请求体 `email` + `emailCode` 判定邮箱验证码。
- `interceptors/email-code-consume.interceptor.ts` — 业务成功后作废邮箱验证码。
- `decorators/require-email-code.decorator.ts` — 接口接入邮箱验证码的组合装饰器。
- `controller/email-verification.controller.ts` — 公开发码接口。
- `controller/email-verification.dto.ts` — 发码请求体校验。

## 函数清单 (Function List)

- `EmailVerificationModule()` — 注册全局邮箱验证码模块 | keywords: 邮箱验证码模块, 全局模块, email-verification-module, global-module
- `RequireEmailCode(scene)` — 一行接入邮箱验证码场景、判定守卫与成功后作废 | keywords: 接入邮箱验证码, 邮箱验证码装饰器, require-email-code, email-code-decorator
- `EmailCodeGuard()` — 邮箱验证码判定守卫 | keywords: 邮箱验证码守卫, 验证码判定, email-code-guard, email-code-check
- `EmailCodeGuard.canActivate(context)` — 校验后移除 `emailCode`、邮箱换成规范化值并挂 `req.emailVerification` | keywords: 校验请求邮箱验证码, 场景绑定, check-request-email-code, scene-binding
- `EmailCodeGuard.readCode(bodyValue,headerValue)` — body 优先、`X-Email-Code` 头兜底读取验证码 | keywords: 读取邮箱验证码, 请求头兜底, read-email-code, header-fallback
- `EmailCodeConsumeInterceptor()` — 业务成功后作废邮箱验证码 | keywords: 成功后作废, 邮箱验证码拦截器, consume-on-success, email-code-interceptor
- `EmailCodeConsumeInterceptor.intercept(context,next)` — 响应前作废已校验验证码 | keywords: 响应前作废, 一次性使用, consume-before-response, single-use
- `EmailVerificationService()` — 邮箱验证码发送、校验与作废 | keywords: 邮箱验证码服务, 发送频控, 验证码校验, email-verification-service, send-throttle, verify-email-code
- `EmailVerificationService.ensureIndexes()` — 建立 TTL 与邮箱 / IP 频控索引 | keywords: 邮箱验证码索引, TTL清理, email-code-indexes, ttl-cleanup
- `EmailVerificationService.send({email,scene,ip})` — 频控后先落库再发信，失败删除记录 | keywords: 发送邮箱验证码, 发送频控, send-email-code, send-throttle
- `EmailVerificationService.verify({email,scene,code})` — 只认最新一条，原子累加尝试次数后比对摘要 | keywords: 校验邮箱验证码, 防爆破, verify-email-code, brute-force-guard
- `EmailVerificationService.consume(codeId)` — 作废验证码，重复作废返回 false | keywords: 作废邮箱验证码, 一次性使用, consume-email-code, single-use
- `EmailVerificationService.buildCodeMail(scene,code)` — 组装用途说明、验证码框、有效期与防诈骗提示 | keywords: 验证码邮件文案, 防诈骗提示, code-mail-copy, anti-fraud-notice
- `EmailVerificationService.assertSendQuota(email,scene,ip)` — 60 秒重发间隔、邮箱日限额与 IP 小时限额 | keywords: 发送频控, 重发间隔, send-throttle, resend-interval
- `EmailVerificationService.toPublicSendError(error)` — 未配置映射为 `EMAIL_NOT_CONFIGURED`，SMTP 原始错误只进日志 | keywords: 发送错误收敛, 隐藏服务商错误, map-send-error, hide-provider-error
- `EmailVerificationService.hashCode(email,scene,code)` — 生成绑定邮箱与场景的 HMAC 摘要 | keywords: 邮箱验证码摘要, 场景绑定, email-code-hash, scene-binding
- `EmailVerificationService.normalizeEmail(raw)` — 去空格转小写并校验格式与长度 | keywords: 邮箱规范化, 邮箱格式校验, normalize-email, email-format-check
- `EmailVerificationService.assertScene(scene)` — 校验场景在白名单内 | keywords: 场景校验, 场景白名单, assert-scene, scene-allowlist
- `EmailVerificationController()` — 邮箱验证码公开接口 | keywords: 邮箱验证码接口, 公开入口, email-verification-controller, public-endpoint
- `EmailVerificationController.send(req,dto)` — `POST /api/email-verification/send` 公开发码 | keywords: 发送邮箱验证码接口, 公开入口, send-email-code-endpoint, public-endpoint
- `EmailVerificationController.readClientIp(req)` — 读取代理链首个客户端 IP | keywords: 读取客户端IP, 代理转发, read-client-ip, forwarded-for
- `SendEmailCodeDto()` — 发码请求体 | keywords: 发送邮箱验证码请求体, send-email-code-dto

## 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 邮箱验证码模块 | email-verification-module |
| 全局模块 | global-module |
| 接入邮箱验证码 | require-email-code |
| 邮箱验证码装饰器 | email-code-decorator |
| 邮箱验证码守卫 | email-code-guard |
| 邮箱验证码拦截器 | email-code-interceptor |
| 成功后作废 | consume-on-success |
| 一次性使用 | single-use |
| 邮箱验证码服务 | email-verification-service |
| 发送邮箱验证码 | send-email-code |
| 校验邮箱验证码 | verify-email-code |
| 作废邮箱验证码 | consume-email-code |
| 发送频控 | send-throttle |
| 重发间隔 | resend-interval |
| 防爆破 | brute-force-guard |
| 验证码邮件文案 | code-mail-copy |
| 防诈骗提示 | anti-fraud-notice |
| 隐藏服务商错误 | hide-provider-error |
| 邮箱验证码摘要 | email-code-hash |
| 场景绑定 | scene-binding |
| 邮箱规范化 | normalize-email |
| 场景白名单 | scene-allowlist |
| 可信邮箱 | trusted-email |
| 公开入口 | public-endpoint |

## 类型导出 (Type Exports)

- `EMAIL_VERIFICATION_SCENES` — 场景白名单（当前 `register`） | keywords: 邮箱验证码场景, 场景白名单, email-code-scene, scene-allowlist
- `EmailVerificationScene` — 邮箱验证码场景类型 | keywords: 邮箱验证码场景类型, email-code-scene-type
- `EMAIL_SCENE_ACTIONS` — 场景在验证码邮件里的操作说明 | keywords: 场景操作说明, 验证码邮件文案, scene-action-label, code-mail-copy
- `REQUIRE_EMAIL_CODE_KEY` — 场景元数据 key | keywords: 邮箱验证码元数据键, require-email-code-metadata-key
- `EMAIL_CODE_TTL_SECONDS`(600) — 有效期 | keywords: 邮箱验证码有效期, email-code-ttl
- `EMAIL_RESEND_INTERVAL_SECONDS`(60) — 重发间隔 | keywords: 邮箱重发间隔, email-resend-interval
- `EMAIL_ADDRESS_DAILY_LIMIT`(10) — 单邮箱 24 小时上限 | keywords: 邮箱日限额, email-daily-limit
- `EMAIL_IP_HOURLY_LIMIT`(30) — 单 IP 1 小时上限 | keywords: IP小时限额, ip-hourly-limit
- `EMAIL_CODE_MAX_ATTEMPTS`(5) — 单条验证码最多校验次数 | keywords: 最大尝试次数, 防爆破, max-attempts, brute-force-guard
- `EmailCodeEntity` — `email_verification_codes` 验证码记录 | keywords: 邮箱验证码记录, email-code-entity
- `EmailVerifiedContext` — 守卫通过后的上下文 | keywords: 邮箱验证通过上下文, email-verified-context
- `EmailVerifiedRequest` — 携带 `emailVerification` 的请求 | keywords: 已验证请求, 可信邮箱, email-verified-request, trusted-email

## 模块功能描述 (Module Description)

**接入方式**（任意模块控制器方法）：

1. 在 `EMAIL_VERIFICATION_SCENES` 登记场景值，并在 `EMAIL_SCENE_ACTIONS` 写上验证码邮件里的操作说明。
2. 方法上加 `@RequireEmailCode('<scene>')`，与 `@Post` 等路由装饰器同址；可与 `@RequireSmsCode` 叠加。
3. 请求体携带业务字段 `email` 与 `emailCode`（验证码也可放 `X-Email-Code` 头）。守卫校验后删除 `emailCode`，并把 `email` 改写为规范化值（去空格、小写）。
4. 业务方法从 `req.emailVerification.email` 读取可信邮箱。
5. 业务成功返回后拦截器才作废验证码；参数或业务失败仍可在五次尝试限制内重试。

已接入：`POST /api/tenant-join/register`、`POST /admin/auth/register`（场景 `register`，均同时要求短信验证码）。

**发码流程**：规范化邮箱与场景 → 频控 → 写入带摘要的记录 → `MailService.sendTemplate()` 发送验证码邮件（统一版式：用途说明、大号验证码框、10 分钟有效期、防诈骗提示）。发信失败删除记录，不占频控额度。发信邮箱未配置返回 `EMAIL_NOT_CONFIGURED`；SMTP 失败统一返回 `EMAIL_SEND_FAILED`，服务商原始错误只写日志，不对公开接口泄露。`MAIL_MOCK=true`（非生产）时验证码写在模拟发信日志里。

**校验规则**：只认该邮箱该场景最新一条；已作废或过期返回 `EMAIL_CODE_EXPIRED`；先原子累加 `attempts` 再比对摘要，第 6 次起返回 `EMAIL_CODE_TOO_MANY_ATTEMPTS`。摘要 pepper 依次取 `MAIL_ENCRYPTION_KEY`、`SMS_ENCRYPTION_KEY`、`BROWSER_AUTH_ENCRYPTION_KEY`、`ADMIN_JWT_SECRET`。

**入口鉴权**：

| 路由 | 权限 |
| --- | --- |
| `POST /api/email-verification/send` | 公开免鉴权（注册前用户未登录）；同邮箱 60 秒间隔、单邮箱 24 小时 10 次、单 IP 1 小时 30 次防刷 |

错误码：`EMAIL_ADDRESS_INVALID`、`EMAIL_SCENE_INVALID`（400）、`EMAIL_NOT_CONFIGURED`(503)、`EMAIL_SEND_TOO_FREQUENT`(429，带 `retryAfterSeconds`)、`EMAIL_ADDRESS_DAILY_LIMIT`(429)、`EMAIL_IP_HOURLY_LIMIT`(429)、`EMAIL_SEND_FAILED`(503)、`EMAIL_CODE_REQUIRED`、`EMAIL_CODE_INVALID`、`EMAIL_CODE_EXPIRED`、`EMAIL_CODE_TOO_MANY_ATTEMPTS`。

集合：`email_verification_codes`（`expiresAt` TTL 24 小时、`email+scene+createdAt`、`ip+createdAt`）。

前端组件见 [web EmailVerification](../../../web/src/ui/EmailVerification/module.md)。
