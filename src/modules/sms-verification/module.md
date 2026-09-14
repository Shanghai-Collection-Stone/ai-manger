# 模块名称 (Module Name)

短信验证码模块（sms-verification）

## 概述 (Overview)

提供手机号短信验证码的发送、判定与作废能力，当前服务商为阿里云短信（Dysmsapi `SendSms`，RPC 签名 V1，直接 HTTP 调用不引入 SDK）。模块为 `@Global()`，任何控制器方法只需加一行 `@RequireSmsCode('<scene>')` 即接入验证码判定，无需 import 本模块、无需改业务 DTO。

平台级配置（AccessKey ID / Secret、签名、模板编码、模板变量名、启用开关）全平台一份，仅超管可在后台「短信验证码」Tab 维护。Secret 落库前 AES-256-GCM 加密（`SMS_ENCRYPTION_KEY`，回落 `BROWSER_AUTH_ENCRYPTION_KEY`，都缺失时明文降级并告警），接口只回 `****尾4位` 掩码。验证码只存 HMAC-SHA256 摘要（手机号与场景参与计算），有效期 5 分钟。

## 文件清单 (File List)

- `sms-verification.module.ts` — 全局模块入口，装配配置、加解密、阿里云客户端、验证码服务、判定守卫与作废拦截器。
- `entities/sms-verification.entity.ts` — 场景白名单、频控常量、配置/验证码文档、视图、运行配置与已验证请求类型。
- `services/sms-crypto.service.ts` — Secret 加解密与验证码摘要。
- `services/sms-config.service.ts` — 平台短信配置读写、掩码视图、运行配置解析与模拟模式判断。
- `services/aliyun-sms.service.ts` — 阿里云 SendSms 签名与调用。
- `services/sms-verification.service.ts` — 发码频控、校验、作废与后台测试发送。
- `guards/sms-code.guard.ts` — 按场景判定请求携带的验证码。
- `interceptors/sms-code-consume.interceptor.ts` — 业务成功后作废验证码。
- `decorators/require-sms-code.decorator.ts` — 接口接入验证码的组合装饰器。
- `controller/sms-verification.controller.ts` — 公开发码接口与超管配置接口。
- `controller/sms-verification.dto.ts` — 发码、保存配置、测试发送请求体。

## 函数清单 (Function List)

- `SmsVerificationModule()` — 注册全局短信验证码模块 | keywords: 短信验证码模块, 全局模块, sms-verification-module, global-module
- `RequireSmsCode(scene)` — 一行接入验证码：场景元数据 + 判定守卫 + 成功后作废 | keywords: 接入验证码, 验证码装饰器, require-sms-code, sms-code-decorator
- `SmsCodeGuard.canActivate(context)` — 按 @RequireSmsCode 场景校验验证码 | keywords: 校验请求验证码, 场景绑定, check-request-sms-code, scene-binding
- `SmsCodeGuard.readField(bodyValue,headerValue)` — body 优先、请求头兜底读取字段 | keywords: 读取验证字段, 请求头兜底, read-sms-field, header-fallback
- `SmsCodeConsumeInterceptor.intercept(context,next)` — 响应发出前作废已校验验证码 | keywords: 响应前作废, 一次性使用, consume-before-response, single-use
- `SmsVerificationService.ensureIndexes()` — 建立验证码 TTL 与频控查询索引 | keywords: 验证码索引, TTL清理, sms-code-indexes, ttl-cleanup
- `SmsVerificationService.send({phone,scene,ip})` — 场景与手机号校验、频控后落库并发送，失败删记录 | keywords: 发送验证码, 发送频控, send-sms-code, send-throttle
- `SmsVerificationService.verify({phone,scene,code})` — 只认最新一条，原子累加次数后比对，不作废 | keywords: 校验验证码, 防爆破, verify-sms-code, brute-force-guard
- `SmsVerificationService.consume(codeId)` — 作废验证码，重复作废返回 false | keywords: 作废验证码, 一次性使用, consume-sms-code, single-use
- `SmsVerificationService.testSend(rawPhone)` — 忽略启用开关真实测试发送并回服务商原始错误 | keywords: 测试发送短信, 配置自检, test-send-sms, config-probe
- `SmsVerificationService.assertSendQuota(phone,scene,ip)` — 60 秒重发间隔、单号日限额、单 IP 小时限额 | keywords: 发送频控, 重发间隔, send-throttle, resend-interval
- `SmsVerificationService.toPublicSendError(error)` — 服务商错误收敛为对外错误码 | keywords: 发送错误收敛, 服务商错误映射, map-send-error, provider-error-mapping
- `SmsVerificationService.normalizePhone(raw)` — 去空格与 +86 前缀并校验大陆手机号 | keywords: 手机号规范化, 大陆手机号, normalize-phone, mainland-mobile
- `SmsVerificationService.assertScene(scene)` — 校验场景在白名单内 | keywords: 场景校验, 场景白名单, assert-scene, scene-allowlist
- `SmsConfigService.ensureIndexes()` — 配置集合作用域唯一索引 | keywords: 配置索引, 作用域唯一, config-indexes, unique-scope
- `SmsConfigService.getView()` — 读取配置页视图，Secret 仅掩码 | keywords: 读取短信配置, 密钥掩码, read-sms-setting, masked-secret
- `SmsConfigService.save(input,operatorId)` — 保存配置，Secret 空串清空、不传不改 | keywords: 保存短信配置, 密钥更新, save-sms-setting, update-secret
- `SmsConfigService.resolveRuntime({requireEnabled?})` — 解析明文运行配置，默认要求已启用 | keywords: 解析发送配置, 启用开关, resolve-sms-runtime, enabled-switch
- `SmsConfigService.isMockMode()` — 非生产且 SMS_VERIFICATION_MOCK=true 时只打日志不发送 | keywords: 模拟发送模式, 本地调试, sms-mock-mode, local-debug
- `SmsConfigService.toRuntime(doc,secret)` — 组装运行配置，必填缺失返回 null | keywords: 组装运行配置, 必填校验, build-runtime-config, required-fields
- `SmsConfigService.findPlatform()` — 读取平台作用域配置文档 | keywords: 读取平台配置, find-platform-setting
- `SmsConfigService.mask(secret)` — Secret 掩码成尾 4 位 | keywords: 密钥掩码, 尾号展示, mask-secret, tail-digits
- `SmsCryptoService.encrypt(value)` — Secret 封装成加密信封 | keywords: 加密密钥, 生成信封, encrypt-secret, build-envelope
- `SmsCryptoService.decrypt(envelope?)` — 从信封还原 Secret，失败返回空串 | keywords: 解密密钥, 容错解包, decrypt-secret, tolerant-unwrap
- `SmsCryptoService.hashCode(phone,scene,code)` — 验证码 HMAC 摘要，绑定手机号与场景 | keywords: 验证码摘要, 场景绑定, sms-code-hash, scene-binding
- `SmsCryptoService.resolveKey()` — 解析 32 字节加密密钥 | keywords: 解析加密密钥, 环境变量, resolve-encryption-key, environment-key
- `AliyunSmsService.sendCode(config,phone,code)` — 模板发送验证码短信，失败抛 AliyunSmsError | keywords: 发送验证码短信, 模板短信, send-sms-code, template-sms
- `AliyunSmsService.buildSignedQuery(params,secret)` — RPC 签名 V1 生成已签名查询串 | keywords: RPC签名, HMAC-SHA1, rpc-signature, hmac-sha1
- `AliyunSmsService.percentEncode(value)` — RFC3986 百分号编码 | keywords: 百分号编码, RFC3986, percent-encode, rfc3986
- `AliyunSmsService.maskPhone(phone)` — 日志手机号脱敏 | keywords: 手机号脱敏, 日志安全, mask-phone, log-safety
- `AliyunSmsError(code,providerMessage)` — 阿里云返回码错误 | keywords: 阿里云短信错误, 服务商返回码, aliyun-sms-error, provider-code
- `SmsVerificationController.send(req,dto)` — POST /api/sms-verification/send 公开发码 | keywords: 发送验证码接口, 公开入口, send-sms-code-endpoint, public-endpoint
- `SmsVerificationController.getSettings()` — GET /api/sms-verification/settings(read SmsSetting) | keywords: 读取短信配置接口, get-sms-setting-endpoint
- `SmsVerificationController.saveSettings(req,dto)` — PUT /api/sms-verification/settings(update SmsSetting) | keywords: 保存短信配置接口, save-sms-setting-endpoint
- `SmsVerificationController.testSettings(dto)` — POST /api/sms-verification/settings/test(update SmsSetting) | keywords: 测试发送接口, 配置自检, test-sms-setting-endpoint, config-probe
- `SmsVerificationController.readClientIp(req)` — X-Forwarded-For 首段优先读取客户端 IP | keywords: 读取客户端IP, 代理转发, read-client-ip, forwarded-for
- `SmsVerificationController.requireUser(req)` — 读取当前后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `SendSmsCodeDto` — 发送验证码请求体 | keywords: 发送验证码请求体, send-sms-code-dto
- `SaveSmsSettingDto` — 保存短信配置请求体 | keywords: 保存短信配置请求体, 阿里云密钥, save-sms-setting-dto, aliyun-access-key
- `TestSmsSettingDto` — 测试发送请求体 | keywords: 测试发送请求体, test-sms-setting-dto

## 关键词索引 (Keyword Index)

| 中文           | English                  |
| -------------- | ------------------------ |
| 短信验证码模块 | sms-verification-module  |
| 全局模块       | global-module            |
| 接入验证码     | require-sms-code         |
| 验证码装饰器   | sms-code-decorator       |
| 验证码守卫     | sms-code-guard           |
| 验证码判定     | sms-code-check           |
| 成功后作废     | consume-on-success       |
| 一次性使用     | single-use               |
| 发送验证码     | send-sms-code            |
| 发送频控       | send-throttle            |
| 重发间隔       | resend-interval          |
| 校验验证码     | verify-sms-code          |
| 防爆破         | brute-force-guard        |
| 场景白名单     | scene-allowlist          |
| 场景绑定       | scene-binding            |
| 验证码摘要     | sms-code-hash            |
| 短信配置服务   | sms-config-service       |
| 阿里云密钥     | aliyun-access-key        |
| 密钥掩码       | masked-secret            |
| 加密存储       | encrypted-storage        |
| 模拟发送模式   | sms-mock-mode            |
| 阿里云短信客户端 | aliyun-sms-client      |
| RPC签名        | rpc-signature            |
| 测试发送短信   | test-send-sms            |
| 手机号规范化   | normalize-phone          |
| 可信手机号     | trusted-phone            |

## 类型导出 (Type Exports)

- `SMS_VERIFICATION_SCENES` — 场景白名单（当前 `register`） | keywords: 验证码场景, 场景白名单, sms-scene, scene-allowlist
- `SmsVerificationScene` — 场景类型
- `REQUIRE_SMS_CODE_KEY` — 场景元数据 key | keywords: 验证码元数据键, require-sms-code-metadata-key
- `SMS_PLATFORM_SCOPE_ID` / `SMS_DEFAULT_TEMPLATE_PARAM_NAME` — 平台作用域占位符 / 模板变量名缺省 `code`
- `SMS_CODE_TTL_SECONDS`(300) / `SMS_RESEND_INTERVAL_SECONDS`(60) / `SMS_PHONE_DAILY_LIMIT`(10) / `SMS_IP_HOURLY_LIMIT`(30) / `SMS_CODE_MAX_ATTEMPTS`(5) — 有效期与频控常量 | keywords: 发送频控, 防爆破, send-throttle, brute-force-guard
- `SmsSettingEntity` / `SmsSettingInput` / `SmsSettingView` — 配置文档、保存入参、配置页视图
- `SmsSecretEnvelope` — Secret 落库信封
- `AliyunSmsRuntimeConfig` — 明文运行配置
- `SmsCodeEntity` — 验证码记录
- `SmsVerifiedContext` / `SmsVerifiedRequest` — 守卫通过后挂在 `req.smsVerification` 的上下文
- `ALIYUN_SMS_ENDPOINT` — 阿里云短信接口地址 | keywords: 阿里云短信地址, aliyun-sms-endpoint

## 模块功能描述 (Module Description)

**接入方式**（任意模块控制器方法）：

1. 在 `SMS_VERIFICATION_SCENES` 登记场景值。
2. 方法上加 `@RequireSmsCode('<scene>')`（与 `@Post` 等路由装饰器同址；类级 `AdminAuthGuard` 等守卫先执行）。
3. 请求携带 `smsPhone` + `smsCode`（body 字段，或 `X-Sms-Phone` / `X-Sms-Code` 请求头）。守卫校验通过后从 body 删除这两个字段，业务 DTO 在 `forbidNonWhitelisted` 下也无需声明。
4. 方法内用 `req.smsVerification.phone` 读取已验证的可信手机号，不要信任 body 中其他手机号字段。
5. 方法成功返回后拦截器才作废验证码；参数校验失败或业务异常时验证码仍可重试（受 5 次校验上限约束）。

已接入：`POST /admin/auth/register`（场景 `register`）。

**入口鉴权**：

| 路由 | 权限 |
| ---- | ---- |
| `POST /api/sms-verification/send` | 公开免鉴权（未登录注册场景必需），依靠手机号 60 秒间隔、单号 24 小时 10 次、单 IP 1 小时 30 次频控 |
| `GET /api/sms-verification/settings` | `read SmsSetting`（仅超管） |
| `PUT /api/sms-verification/settings` | `update SmsSetting`（仅超管） |
| `POST /api/sms-verification/settings/test` | `update SmsSetting`（仅超管） |

**错误码**：`SMS_PHONE_INVALID`、`SMS_SCENE_INVALID`、`SMS_NOT_CONFIGURED`(503)、`SMS_SEND_TOO_FREQUENT`(429，带 `retryAfterSeconds`)、`SMS_PHONE_DAILY_LIMIT`(429)、`SMS_IP_HOURLY_LIMIT`(429)、`SMS_PROVIDER_RATE_LIMITED`(429)、`SMS_SEND_FAILED`(503)、`SMS_CODE_REQUIRED`、`SMS_CODE_INVALID`、`SMS_CODE_EXPIRED`、`SMS_CODE_TOO_MANY_ATTEMPTS`。

新增集合：`sms_settings`（`scopeId` 唯一）、`sms_verification_codes`（`expiresAt` TTL 24 小时、`phone+scene+createdAt`、`ip+createdAt`）。

环境变量：

| 变量 | 必需 | 说明 |
| ---- | ---- | ---- |
| `SMS_ENCRYPTION_KEY` | 否 | Secret 落库加密密钥，缺失回落 `BROWSER_AUTH_ENCRYPTION_KEY`；生产必须配置其一 |
| `SMS_VERIFICATION_MOCK` | 否 | 非生产环境设为 `true` 时验证码只打印到服务端日志，不调用阿里云 |

阿里云侧准备：开通短信服务 → 申请签名与验证码模板（模板形如 `您的验证码为${code}，5分钟内有效`，变量名与后台「模板变量名」一致）→ 创建 RAM 子账号并只授予 `AliyunDysmsFullAccess`，用其 AccessKey。
