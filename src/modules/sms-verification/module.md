# 模块名称 (Module Name)

短信验证码模块（sms-verification）

## 概述 (Overview)

提供手机号短信验证码的发送、判定与作废能力。平台超管可选择阿里云短信服务 Dysmsapi `SendSms`，或阿里云号码认证服务 Dypnsapi 的短信认证接口；两者均使用 RPC 签名 V1 直接 HTTP 调用，不引入 SDK。本模块保存短信专用 AccessKey（可与 [aliyun-config 模块](../aliyun-config/module.md) 的 OSS AccessKey 属于不同阿里云账号，两边不共用）和两套签名与模板配置，切换接口类型不会丢失另一套配置。

模块为 `@Global()`，业务控制器通过 `@RequireSmsCode('<scene>')` 接入验证码判定。Dysms 验证码由本服务生成并仅保存 HMAC-SHA256 摘要；Dypns 验证码由阿里云生成，优先使用回传验证码转为本地摘要校验，未回传时走服务商校验，同时保留本地尝试次数、过期与一次性作废控制。

## 文件清单 (File List)

- `sms-verification.module.ts` — 全局模块入口，装配配置、加解密、两类阿里云客户端、验证码服务、守卫与拦截器。
- `entities/sms-verification.entity.ts` — 服务商、场景、频控、配置、运行配置、验证码记录与请求上下文类型。
- `services/sms-crypto.service.ts` — 短信 AccessKey Secret 加解密与验证码 HMAC 摘要。
- `services/sms-config.service.ts` — 平台短信配置读写（含短信专用 AccessKey，Secret 仅掩码）、分服务商运行配置解析与模拟模式判断。
- `services/aliyun-sms.service.ts` — Dysms `SendSms` 调用与可复用 RPC V1 签名。
- `services/aliyun-dypns.service.ts` — Dypns `SendSmsVerifyCode`、`CheckSmsVerifyCode` 调用。
- `services/sms-verification.service.ts` — 分服务商发码与校验、频控、作废及后台测试发送。
- `guards/sms-code.guard.ts` — 按场景判定请求携带的验证码。
- `interceptors/sms-code-consume.interceptor.ts` — 业务成功后作废验证码。
- `decorators/require-sms-code.decorator.ts` — 接口接入验证码的组合装饰器。
- `controller/sms-verification.controller.ts` — 公开发码接口与超管配置接口。
- `controller/sms-verification.dto.ts` — 发码、保存配置（含短信专用 AccessKey）、测试发送请求体及 Dypns 模板参数校验。

## 函数清单 (Function List)

- `SmsVerificationModule()` — 注册全局短信验证码模块 | keywords: 短信验证码模块, 全局模块, sms-verification-module, global-module
- `RequireSmsCode(scene)` — 一行接入验证码场景、判定守卫与成功后作废 | keywords: 接入验证码, 验证码装饰器, require-sms-code, sms-code-decorator
- `SmsCodeGuard.canActivate(context)` — 按场景校验请求验证码 | keywords: 校验请求验证码, 场景绑定, check-request-sms-code, scene-binding
- `SmsCodeGuard.readField(bodyValue,headerValue)` — 从 body 优先、请求头兜底读取字段 | keywords: 读取验证字段, 请求头兜底, read-sms-field, header-fallback
- `SmsCodeConsumeInterceptor.intercept(context,next)` — 响应前作废已校验验证码 | keywords: 响应前作废, 一次性使用, consume-before-response, single-use
- `SmsVerificationService.ensureIndexes()` — 建立验证码 TTL 与频控查询索引 | keywords: 验证码索引, TTL清理, sms-code-indexes, ttl-cleanup
- `SmsVerificationService.send({phone,scene,ip})` — 按所选服务商先落记录再发送，失败删除记录 | keywords: 发送验证码, 发送频控, send-sms-code, send-throttle
- `SmsVerificationService.verify({phone,scene,code})` — 本地或服务商校验前原子累加尝试次数 | keywords: 校验验证码, 防爆破, verify-sms-code, brute-force-guard
- `SmsVerificationService.consume(codeId)` — 作废验证码，重复作废返回 false | keywords: 作废验证码, 一次性使用, consume-sms-code, single-use
- `SmsVerificationService.testSend(rawPhone)` — 按所选服务商测试发送并返回原始错误 | keywords: 测试发送短信, 配置自检, test-send-sms, config-probe
- `SmsVerificationService.assertSendQuota(phone,scene,ip)` — 执行重发、手机号日限额与 IP 小时限额 | keywords: 发送频控, 重发间隔, send-throttle, resend-interval
- `SmsVerificationService.toPublicSendError(error)` — 收敛服务商发送错误并识别 Dypns 限流码 | keywords: 发送错误收敛, 服务商错误映射, map-send-error, provider-error-mapping
- `SmsVerificationService.normalizePhone(raw)` — 规范化并校验大陆手机号 | keywords: 手机号规范化, 大陆手机号, normalize-phone, mainland-mobile
- `SmsVerificationService.assertScene(scene)` — 校验场景在白名单内 | keywords: 场景校验, 场景白名单, assert-scene, scene-allowlist
- `SmsConfigService()` — 平台短信配置服务，保存接口类型、短信专用 AccessKey、签名与模板 | keywords: 短信配置服务, 阿里云密钥, sms-config-service, aliyun-access-key
- `SmsConfigService.ensureIndexes()` — 建立平台配置唯一索引 | keywords: 配置索引, 作用域唯一, config-indexes, unique-scope
- `SmsConfigService.getView()` — 读取短信专用 AccessKey（Secret 仅掩码）与两套服务商字段 | keywords: 读取短信配置, 密钥掩码, read-sms-setting, masked-secret
- `SmsConfigService.save(input,operatorId)` — 保存接口类型、启用开关、短信专用 AccessKey（Secret 空串清空、不传不改）与两套独立模板配置 | keywords: 保存短信配置, 签名模板, 密钥更新, save-sms-setting, sign-and-template, update-secret
- `SmsConfigService.resolveRuntime({requireEnabled?})` — 解析当前服务商的明文运行配置 | keywords: 解析发送配置, 启用开关, resolve-sms-runtime, enabled-switch
- `SmsConfigService.isMockMode()` — 判断非生产环境模拟发送模式 | keywords: 模拟发送模式, 本地调试, sms-mock-mode, local-debug
- `SmsConfigService.toRuntime(doc,secret)` — 按服务商检查 AccessKey 与必填项并组装运行配置 | keywords: 组装运行配置, 必填校验, build-runtime-config, required-fields
- `SmsConfigService.findPlatform()` — 读取平台作用域配置 | keywords: 读取平台配置, find-platform-setting
- `SmsConfigService.mask(secret)` — Secret 掩码成尾 4 位 | keywords: 密钥掩码, 尾号展示, mask-secret, tail-digits
- `SmsCryptoService.encrypt(value)` — 将 Secret 加密封装 | keywords: 加密密钥, 生成信封, encrypt-secret, build-envelope
- `SmsCryptoService.decrypt(envelope?)` — 容错解密 Secret | keywords: 解密密钥, 容错解包, decrypt-secret, tolerant-unwrap
- `SmsCryptoService.hashCode(phone,scene,code)` — 生成绑定手机号与场景的验证码摘要 | keywords: 验证码摘要, 场景绑定, sms-code-hash, scene-binding
- `SmsCryptoService.resolveKey()` — 解析 32 字节加密密钥 | keywords: 解析加密密钥, 环境变量, resolve-encryption-key, environment-key
- `AliyunSmsService.sendCode(config,phone,code)` — 调用 Dysms 模板短信发送验证码 | keywords: 发送验证码短信, 模板短信, send-sms-code, template-sms
- `AliyunSmsService.buildSignedQuery(params,secret)` — 生成可供两类阿里云接口复用的 RPC V1 签名查询串 | keywords: RPC签名, HMAC-SHA1, rpc-signature, hmac-sha1
- `AliyunSmsService.percentEncode(value)` — 执行 RFC3986 百分号编码 | keywords: 百分号编码, RFC3986, percent-encode, rfc3986
- `AliyunSmsService.maskPhone(phone)` — 对日志手机号脱敏 | keywords: 手机号脱敏, 日志安全, mask-phone, log-safety
- `AliyunSmsError(code,providerMessage)` — 承载阿里云返回码与原始说明 | keywords: 阿里云短信错误, 服务商返回码, aliyun-sms-error, provider-code
- `AliyunDypnsService()` — 提供号码认证短信发送与服务商校验 | keywords: 号码认证短信客户端, 服务商校验, aliyun-dypns-client, provider-verification
- `AliyunDypnsService.constructor(signer)` — 注入共用的阿里云 RPC V1 签名实现 | keywords: 共用签名实现, 依赖注入, shared-rpc-signer, dependency-injection
- `AliyunDypnsService.sendVerifyCode(config,phone,{outId})` — 调用 SendSmsVerifyCode 并读取回传验证码与回执 | keywords: 号码认证发送验证码, 回传验证码, dypns-send-code, return-verify-code
- `AliyunDypnsService.checkVerifyCode(config,phone,code,{outId})` — 调用 CheckSmsVerifyCode 判断验证码是否通过 | keywords: 号码认证校验验证码, 服务商校验, dypns-check-code, provider-verification
- `AliyunDypnsService.request(config,actionParams,phone)` — 签名并执行十秒超时的 Dypnsapi 请求 | keywords: 号码认证请求, RPC签名, dypns-request, rpc-signature
- `AliyunDypnsService.maskPhone(phone)` — 对 Dypns 日志手机号脱敏 | keywords: 手机号脱敏, 日志安全, mask-phone, log-safety
- `SmsVerificationController.send(req,dto)` — 公开发送验证码 | keywords: 发送验证码接口, 公开入口, send-sms-code-endpoint, public-endpoint
- `SmsVerificationController.getSettings()` — 读取短信配置视图 | keywords: 读取短信配置接口, get-sms-setting-endpoint
- `SmsVerificationController.saveSettings(req,dto)` — 保存短信配置 | keywords: 保存短信配置接口, save-sms-setting-endpoint
- `SmsVerificationController.testSettings(dto)` — 测试发送短信 | keywords: 测试发送接口, 配置自检, test-sms-setting-endpoint, config-probe
- `SmsVerificationController.readClientIp(req)` — 读取代理链首个客户端 IP | keywords: 读取客户端IP, 代理转发, read-client-ip, forwarded-for
- `SmsVerificationController.requireUser(req)` — 读取当前后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `SendSmsCodeDto()` — 定义发码请求体 | keywords: 发送验证码请求体, send-sms-code-dto
- `SaveSmsSettingDto()` — 定义短信专用 AccessKey、两类接口配置与 Dypns JSON 参数校验 | keywords: 保存短信配置请求体, 阿里云密钥, 签名模板, save-sms-setting-dto, aliyun-access-key, sign-and-template
- `TestSmsSettingDto()` — 定义测试发送请求体 | keywords: 测试发送请求体, test-sms-setting-dto
- `DypnsTemplateParamConstraint()` — 校验 Dypns 模板参数为含验证码占位符的 JSON 对象 | keywords: 号码认证模板校验, 验证码占位符, dypns-template-validation, code-placeholder
- `DypnsTemplateParamConstraint.validate(value)` — 解析模板参数并检查顶层值中的验证码占位符 | keywords: 校验模板参数, JSON对象, validate-template-param, json-object

## 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 短信验证码模块 | sms-verification-module |
| 全局模块 | global-module |
| 接入验证码 | require-sms-code |
| 验证码装饰器 | sms-code-decorator |
| 验证码守卫 | sms-code-guard |
| 验证码判定 | sms-code-check |
| 成功后作废 | consume-on-success |
| 短信服务商、接口类型 | sms-provider, api-type |
| 阿里云短信服务 | aliyun-sms-client |
| 号码认证短信地址 | aliyun-dypns-endpoint |
| 号码认证短信客户端 | aliyun-dypns-client |
| 号码认证运行配置 | dypns-runtime-config |
| 号码认证发送验证码 | dypns-send-code |
| 号码认证校验验证码 | dypns-check-code |
| 号码认证请求 | dypns-request |
| 服务商校验 | provider-verification |
| 回传验证码 | return-verify-code |
| 号码认证模板参数 | dypns-template-param |
| 号码认证模板校验 | dypns-template-validation |
| 校验模板参数 | validate-template-param |
| 验证码占位符 | code-placeholder |
| JSON对象 | json-object |
| RPC签名 | rpc-signature |
| 共用签名实现 | shared-rpc-signer |
| 发送验证码 | send-sms-code |
| 发送频控 | send-throttle |
| 重发间隔 | resend-interval |
| 校验验证码 | verify-sms-code |
| 防爆破 | brute-force-guard |
| 一次性使用 | single-use |
| 场景白名单 | scene-allowlist |
| 场景绑定 | scene-binding |
| 验证码摘要 | sms-code-hash |
| 模拟发送模式 | sms-mock-mode |
| 短信配置服务 | sms-config-service |
| 阿里云密钥 | aliyun-access-key |
| 密钥掩码 | masked-secret |
| 尾号展示 | tail-digits |
| 密钥更新 | update-secret |
| 签名模板 | sign-and-template |
| 加密存储 | encrypted-storage |
| 测试发送短信 | test-send-sms |
| 手机号规范化 | normalize-phone |
| 可信手机号 | trusted-phone |

## 类型导出 (Type Exports)

- `SMS_PROVIDERS` — `aliyun_dysms`、`aliyun_dypns` 可选接口类型 | keywords: 短信服务商, 接口类型, sms-provider, api-type
- `SMS_DYPNS_DEFAULT_TEMPLATE_PARAM` — Dypns 模板参数默认 JSON | keywords: 号码认证模板参数, 验证码占位符, dypns-template-param, code-placeholder
- `SMS_VERIFICATION_SCENES` — 场景白名单（当前 `register`） | keywords: 验证码场景, 场景白名单, sms-scene, scene-allowlist
- `SmsVerificationScene` — 验证码场景类型 | keywords: 验证码场景类型, sms-scene-type
- `REQUIRE_SMS_CODE_KEY` — 场景元数据 key | keywords: 验证码元数据键, require-sms-code-metadata-key
- `SMS_PLATFORM_SCOPE_ID` / `SMS_DEFAULT_TEMPLATE_PARAM_NAME` — 平台作用域与 Dysms 模板变量名默认值。
- `SMS_CODE_TTL_SECONDS`(300) / `SMS_RESEND_INTERVAL_SECONDS`(60) / `SMS_PHONE_DAILY_LIMIT`(10) / `SMS_IP_HOURLY_LIMIT`(30) / `SMS_CODE_MAX_ATTEMPTS`(5) — 有效期、重发间隔与频控常量。
- `SmsProvider` — 短信接口类型 | keywords: 短信服务商, sms-provider
- `SmsSettingEntity` / `SmsSettingInput` / `SmsSettingView` — 配置文档（含短信专用 `accessKeyId` / `accessKeySecret` 信封）、保存入参（`accessKeySecret` 空串清空、不传不改）与配置页视图（Secret 仅掩码）。
- `SmsSecretEnvelope` — 短信 AccessKey Secret 落库信封。
- `AliyunSmsRuntimeConfig` — Dysms 明文运行配置 | keywords: 阿里云运行配置, aliyun-runtime-config
- `AliyunDypnsRuntimeConfig` — Dypns 明文运行配置 | keywords: 号码认证运行配置, dypns-runtime-config
- `SmsRuntimeConfig` — 当前接口类型的判别联合运行配置 | keywords: 短信运行配置, sms-runtime-config
- `SmsCodeEntity` — 含 `verifyVia: 'local' | 'provider'` 的验证码记录。
- `SmsVerifiedContext` / `SmsVerifiedRequest` — 守卫通过后的可信验证码上下文。
- `ALIYUN_SMS_ENDPOINT` — Dysms 接口地址 | keywords: 阿里云短信地址, aliyun-sms-endpoint
- `ALIYUN_DYPNS_ENDPOINT` — Dypns 接口地址 | keywords: 号码认证短信地址, aliyun-dypns-endpoint

## 模块功能描述 (Module Description)

平台超管在后台「阿里云配置」Tab 的短信验证码区块选择接口类型。AccessKey 是短信专用的一对，保存在本集合平台文档的 `accessKeyId` / `accessKeySecret`（加密信封），不读 OSS 的 AccessKey；短信与 OSS 可能属于不同阿里云账号。Dysms 使用 `signName`、`templateCode`、`templateParamName`，Dypns 使用 `dypnsSignName`、`dypnsTemplateCode`、`dypnsTemplateParam`、可选 `dypnsSchemeName`。保存时只更新传入字段，切换服务商不清空另一套配置；旧文档缺少 `provider` 时按 `aliyun_dysms` 解析。

Dysms 侧需开通短信服务、申请签名和验证码模板，并给 RAM 子账号授予 `AliyunDysmsFullAccess`。Dypns 侧在号码认证控制台「短信认证参数配置」页查看：签名名称在「签名配置」页签，模板 CODE 在「模板配置」页签（模板名称如「登录/注册模板」不能当签名填，否则返回 `isv.INVALID_PARAMETERS`），赠送签名与赠送模板须配套使用，模板参数 JSON 至少一个值必须为 `##code##`，并给 RAM 子账号授予 `AliyunDypnsFullAccess`。

Dypns 发码先写入带占位摘要的本地记录，再调用 `SendSmsVerifyCode`。响应含 `Model.VerifyCode` 时更新 HMAC 摘要并设置 `verifyVia: 'local'`；未回传时设置 `verifyVia: 'provider'`，校验阶段调用 `CheckSmsVerifyCode`。两条路径均由本地执行五次尝试上限、五分钟有效期、消费作废与只认最新一条记录。发送失败删除预写记录。模拟模式对两类服务商都只打印验证码，不访问阿里云。

**接入方式**（任意模块控制器方法）：

1. 在 `SMS_VERIFICATION_SCENES` 登记场景值。
2. 方法上加 `@RequireSmsCode('<scene>')`，与 `@Post` 等路由装饰器同址。
3. 请求携带 `smsPhone` + `smsCode`，也可使用 `X-Sms-Phone` / `X-Sms-Code` 请求头。守卫校验后从 body 删除这两个字段。
4. 业务方法从 `req.smsVerification.phone` 读取可信手机号，不信任 body 内其他手机号字段。
5. 业务成功返回后拦截器才作废验证码；参数或业务失败仍可在五次尝试限制内重试。

已接入：`POST /admin/auth/register`（场景 `register`）。

**入口鉴权**：

| 路由 | 权限 |
| --- | --- |
| `POST /api/sms-verification/send` | 公开免鉴权；手机号 60 秒间隔、单号 24 小时 10 次、单 IP 1 小时 30 次防刷 |
| `GET /api/sms-verification/settings` | `read SmsSetting`（仅超管） |
| `PUT /api/sms-verification/settings` | `update SmsSetting`（仅超管） |
| `POST /api/sms-verification/settings/test` | `update SmsSetting`（仅超管） |

错误码：`SMS_PHONE_INVALID`、`SMS_SCENE_INVALID`、`SMS_NOT_CONFIGURED`(503)、`SMS_DYPNS_TEMPLATE_PARAM_INVALID`(400)、`SMS_SEND_TOO_FREQUENT`(429)、`SMS_PHONE_DAILY_LIMIT`(429)、`SMS_IP_HOURLY_LIMIT`(429)、`SMS_PROVIDER_RATE_LIMITED`(429)、`SMS_SEND_FAILED`(503)、`SMS_CODE_REQUIRED`、`SMS_CODE_INVALID`、`SMS_CODE_EXPIRED`、`SMS_CODE_TOO_MANY_ATTEMPTS`。

集合：`sms_settings`（`scopeId` 唯一）、`sms_verification_codes`（`expiresAt` TTL 24 小时、`phone+scene+createdAt`、`ip+createdAt`）。

环境变量：

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `SMS_ENCRYPTION_KEY` | 否 | Secret 加密密钥（与阿里云配置共用），缺失回落 `BROWSER_AUTH_ENCRYPTION_KEY`；生产必须配置其一 |
| `SMS_VERIFICATION_MOCK` | 否 | 非生产环境设为 `true` 时验证码只打印到服务端日志，不调用阿里云 |
