# 模块名称 (Module Name)

阿里云配置模块（aliyun-config）

## 概述 (Overview)

集中维护平台级对象存储 OSS 配置：OSS 专用 AccessKey 与 OSS 设置（地域、Bucket、Endpoint、访问域名、根目录）。短信与 OSS 可能属于不同的阿里云账号，所以短信 AccessKey 不在这里，由 sms-verification 模块自己保存。Secret 落库前用 AES-256-GCM 加密，接口只返回掩码。

每个进程内存缓存明文配置，供 OSS 签名这类同步路径直接读取。保存后本进程立即重载，再用 `aliyun-config.setting.changed` 广播到全部 worker；另有 60 秒定时刷新兜底。后台 OSS 配置不完整时，`readOssConfig()` 返回 null，对象存储继续用环境变量 `OSS_*`，已有部署不受影响。

## 文件清单 (File List)

- `aliyun-config.module.ts` — 模块入口，装配配置服务、加解密服务与超管接口，导出 `AliyunConfigService`。
- `entities/aliyun-config.entity.ts` — 平台作用域、变更广播消息名、密钥信封、OSS 设置与 OSS 子文档、配置文档、入参、视图与自检结果类型。
- `services/aliyun-config-crypto.service.ts` — Secret 加解密（与短信模块同一条加密密钥链）。
- `services/aliyun-config.service.ts` — OSS 配置与 OSS 专用密钥读写、进程内缓存、跨进程重载、OSS 生效来源判断与自检转发；导出 OSS 地域 / Endpoint 规整与环境变量摘要函数。
- `controller/aliyun-config.controller.ts` — 超管读取、保存与 OSS 自检接口。
- `controller/aliyun-config.dto.ts` — 保存请求体、OSS 字段与 OSS 专用 AccessKey 格式校验。

## 函数清单 (Function List)

- `AliyunConfigModule()` — 注册阿里云配置模块并导出配置服务 | keywords: 阿里云配置模块, OSS访问密钥, aliyun-config-module, oss-access-key
- `AliyunConfigService()` — 提供 OSS 专用密钥与 OSS 设置的读写和缓存 | keywords: 阿里云配置服务, OSS访问密钥, OSS设置, aliyun-config-service, oss-access-key, oss-setting
- `AliyunConfigService.onModuleInit()` — 建索引，首次加载并订阅变更广播与定时刷新 | keywords: 启动加载配置, 订阅配置变更, load-setting-on-init, subscribe-setting-change
- `AliyunConfigService.onModuleDestroy()` — 清理定时刷新 | keywords: 停止配置刷新, 定时器清理, stop-setting-refresh, timer-cleanup
- `AliyunConfigService.reload()` — 从库重载 OSS 专用明文密钥与 OSS 设置到进程缓存，失败沿用上次缓存 | keywords: 重载阿里云配置, 进程内缓存, reload-aliyun-setting, in-process-cache
- `AliyunConfigService.readOssConfig()` — 同步读取后台 OSS 运行配置，不完整返回 null | keywords: 读取OSS运行配置, 后台优先, read-oss-runtime-config, admin-first
- `AliyunConfigService.registerOssProbe(probe)` — 由对象存储服务注册写入自检，避免模块互相依赖 | keywords: 注册OSS自检, 反向解耦, register-oss-probe, dependency-inversion
- `AliyunConfigService.probeOss()` — 按生效来源调用已注册的 OSS 自检 | keywords: 测试OSS, 写入测试, probe-oss, write-test
- `AliyunConfigService.getView()` — 读取 OSS 视图（Secret 掩码）、生效来源与访问地址前缀 | keywords: 读取阿里云配置, 密钥掩码, read-aliyun-setting, masked-secret
- `AliyunConfigService.save(input,operatorId)` — 保存传入的 OSS 字段与密钥（未传字段不覆盖）、本进程重载并广播全部进程 | keywords: 保存阿里云配置, 配置变更广播, save-aliyun-setting, setting-changed-broadcast
- `AliyunConfigService.effectiveOssSource()` — 判断 OSS 生效来源 admin / env / none | keywords: OSS生效来源, 后台优先, effective-oss-source, admin-first
- `AliyunConfigService.publicUrlPrefix(source)` — 按生效来源拼对象访问地址前缀 | keywords: 访问地址前缀, 域名核对, public-url-prefix, domain-check
- `AliyunConfigService.normalizeOss(input)` — 规整地域、Endpoint、访问域名与根目录 | keywords: 规整OSS设置, 地域推导, normalize-oss-setting, derive-from-region
- `AliyunConfigService.findPlatform()` — 读取平台作用域配置 | keywords: 读取平台配置, find-platform-setting
- `AliyunConfigService.mask(secret)` — 将 Secret 掩码为尾四位 | keywords: 密钥掩码, 尾号展示, mask-secret, tail-digits
- `normalizeOssRegion(value?)` — 地域统一小写并补 `oss-` 前缀 | keywords: 规整OSS地域, 补地域前缀, normalize-oss-region, region-prefix
- `resolveOssEndpoint(endpoint,region)` — Endpoint 去协议与尾斜杠，留空按地域推导 | keywords: 规整OSS地址, 地域推导, normalize-oss-endpoint, derive-from-region
- `readEnvOssSummary()` — 读取环境变量 OSS 摘要与是否配置完整 | keywords: 环境变量OSS配置, 兜底配置, env-oss-configured, fallback-config
- `AliyunConfigCryptoService()` — 提供阿里云 Secret 加解密 | keywords: 阿里云密钥加密, 加密存储, aliyun-secret-encryption, encrypted-storage
- `AliyunConfigCryptoService.encrypt(value)` — 将 Secret 加密封装 | keywords: 加密密钥, 生成信封, encrypt-secret, build-envelope
- `AliyunConfigCryptoService.decrypt(envelope?)` — 容错解密 Secret | keywords: 解密密钥, 容错解包, decrypt-secret, tolerant-unwrap
- `AliyunConfigCryptoService.resolveKey()` — 解析 32 字节加密密钥 | keywords: 解析加密密钥, 环境变量, resolve-encryption-key, environment-key
- `AliyunConfigController()` — 超管阿里云配置接口 | keywords: 阿里云配置接口, 超管配置, aliyun-config-controller, super-admin-setting
- `AliyunConfigController.getSettings()` — 读取阿里云配置视图 | keywords: 读取阿里云配置接口, get-aliyun-setting-endpoint
- `AliyunConfigController.saveSettings(req,dto)` — 保存阿里云配置 | keywords: 保存阿里云配置接口, save-aliyun-setting-endpoint
- `AliyunConfigController.testOss()` — 用生效配置写入再删除探测文件 | keywords: 测试OSS接口, 写入测试, test-oss-endpoint, write-test
- `AliyunConfigController.requireUser(req)` — 读取当前后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `AliyunOssSettingDto()` — 校验 OSS 专用 AccessKey、地域、Bucket、访问域名与根目录格式 | keywords: OSS设置参数, 命名校验, OSS访问密钥, oss-setting-dto, naming-validation, oss-access-key
- `SaveAliyunSettingDto()` — 定义保存请求体，`oss.accessKeySecret` 空串清空、不传保持 | keywords: 保存阿里云配置参数, 阿里云密钥, save-aliyun-setting-dto, aliyun-access-key

## 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 阿里云配置模块 | aliyun-config-module |
| 阿里云配置服务 | aliyun-config-service |
| 阿里云配置接口 | aliyun-config-controller |
| 超管配置 | super-admin-setting |
| OSS访问密钥 | oss-access-key |
| OSS配置文档 | oss-setting-document |
| 阿里云访问密钥 | aliyun-credential |
| 阿里云密钥 | aliyun-access-key |
| OSS设置 | oss-setting |
| 对象存储 | object-storage |
| OSS运行配置 | oss-runtime-config |
| 读取OSS运行配置 | read-oss-runtime-config |
| 后台优先 | admin-first |
| OSS生效来源 | effective-oss-source |
| 环境变量OSS配置 | env-oss-configured |
| 兜底配置 | fallback-config |
| 规整OSS地域 | normalize-oss-region |
| 补地域前缀 | region-prefix |
| 规整OSS地址 | normalize-oss-endpoint |
| 规整OSS设置 | normalize-oss-setting |
| 地域推导 | derive-from-region |
| 访问地址前缀 | public-url-prefix |
| 域名核对 | domain-check |
| 测试OSS | probe-oss |
| 注册OSS自检 | register-oss-probe |
| 反向解耦 | dependency-inversion |
| OSS自检结果 | oss-probe-result |
| 写入测试 | write-test |
| 配置变更广播 | setting-changed-broadcast |
| 进程间消息 | ipc-message |
| 重载阿里云配置 | reload-aliyun-setting |
| 进程内缓存 | in-process-cache |
| 订阅配置变更 | subscribe-setting-change |
| 配置刷新间隔 | setting-refresh-interval |
| 兜底刷新 | fallback-refresh |
| 密钥信封 | secret-envelope |
| 加密存储 | encrypted-storage |
| 密钥掩码 | masked-secret |
| 平台作用域 | platform-scope |

## 类型导出 (Type Exports)

- `ALIYUN_PLATFORM_SCOPE_ID` — 平台作用域 `__platform__` | keywords: 平台作用域, 阿里云配置, platform-scope, aliyun-setting
- `ALIYUN_CONFIG_CHANGED_MESSAGE` — 进程间变更广播名 `aliyun-config.setting.changed` | keywords: 配置变更广播, 进程间消息, setting-changed-broadcast, ipc-message
- `ALIYUN_CONFIG_REFRESH_MS` — 60 秒兜底刷新间隔 | keywords: 配置刷新间隔, 兜底刷新, setting-refresh-interval, fallback-refresh
- `AliyunSecretEnvelope` — Secret 落库信封（plain / aes-256-gcm） | keywords: 密钥信封, 加密存储, secret-envelope, encrypted-storage
- `AliyunOssSetting` — OSS 设置字段 | keywords: OSS设置, 对象存储, oss-setting, object-storage
- `AliyunOssSettingDocument` — 落库 OSS 子文档（设置 + OSS 专用 AccessKey 与 Secret 信封） | keywords: OSS配置文档, OSS访问密钥, oss-setting-document, oss-access-key
- `AliyunSettingEntity` — `aliyun_settings` 配置文档 | keywords: 阿里云配置实体, aliyun-setting-entity
- `AliyunSettingInput` — 保存入参（OSS 字段与 OSS 专用密钥都在 `oss` 下） | keywords: 阿里云配置入参, aliyun-setting-input
- `AliyunCredential` — 明文 AccessKey | keywords: 阿里云访问密钥, OSS访问密钥, aliyun-credential, oss-access-key
- `AliyunOssRuntimeConfig` — 后台 OSS 明文运行配置 | keywords: OSS运行配置, 后台优先, oss-runtime-config, admin-first
- `AliyunSettingView` — 配置页掩码视图，`oss` 下含 AccessKey ID、Secret 掩码、`effectiveSource` 与 `publicUrlPrefix` | keywords: 阿里云配置视图, 密钥掩码, aliyun-setting-view, masked-secret
- `AliyunOssProbeResult` — OSS 自检结果 | keywords: OSS自检结果, 写入测试, oss-probe-result, write-test

## 模块功能描述 (Module Description)

平台超管在后台「阿里云配置」Tab 维护两块内容：对象存储 OSS（本模块，含 OSS 专用 AccessKey）、短信验证码（[sms-verification 模块](../sms-verification/module.md)，含短信专用 AccessKey）。两边的 AccessKey 各自保存、互不读取，可以属于不同的阿里云账号。

**使用方**：`video-library` 的 `OssStorageService` 可选注入本服务。`readConfig()` 先取 `readOssConfig()`，为 null 时回落环境变量 `OSS_*`。构造时通过 `registerOssProbe()` 注册写入自检，所以本模块不需要反向 import `video-library`。

**存储结构**：OSS 专用 AccessKey 与 OSS 设置都在 `aliyun_settings` 平台文档的 `oss` 子文档里（`oss.accessKeyId`、`oss.accessKeySecret` 加密信封）。保存时读出当前子文档合并后整体写回；请求里未传或为 undefined 的字段不覆盖，`oss.accessKeySecret` 空串清空。

**OSS 生效规则**：OSS 专用密钥齐全，且 Bucket 与 Endpoint（留空时按地域推导）都有值，才用后台配置（`effectiveSource: 'admin'`）；否则环境变量齐全时为 `env`，都不齐为 `none`。地域可写 `cn-shanghai` 或 `oss-cn-shanghai`，保存时统一补成 `oss-` 前缀。

**RAM 权限**：OSS AccessKey 所属的 RAM 用户需要目标 Bucket 的 `oss:PutObject` / `oss:GetObject` / `oss:DeleteObject`。短信所需权限见 sms-verification 模块。

**入口鉴权**：

| 路由 | 权限 |
| --- | --- |
| `GET /api/aliyun-config/settings` | `read AliyunSetting`（仅超管） |
| `PUT /api/aliyun-config/settings` | `update AliyunSetting`（仅超管） |
| `POST /api/aliyun-config/oss/test` | `update AliyunSetting`（仅超管），在 `<rootDir>/.probe/` 写入并删除一个探测文件 |

错误码：`ALIYUN_OSS_REGION_INVALID`、`ALIYUN_OSS_BUCKET_INVALID`、`ALIYUN_OSS_PUBLIC_BASE_URL_INVALID`、`ALIYUN_OSS_ROOT_DIR_INVALID`（400）；自检结果 `message`：`OSS_NOT_CONFIGURED`、`OSS_PROBE_UNAVAILABLE` 或写入 / 删除失败原文。

**进程间消息**：`aliyun-config.setting.changed`（`target: 'all'`），收到后重载缓存。

集合：`aliyun_settings`（`scopeId` 唯一索引 `aliyun_setting_scope_unique`）。

环境变量：

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `SMS_ENCRYPTION_KEY` | 否 | Secret 加密密钥，缺失回落 `BROWSER_AUTH_ENCRYPTION_KEY`；生产必须配置其一 |
| `OSS_REGION` / `OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_ENDPOINT` / `OSS_PUBLIC_BASE_URL` / `OSS_VIDEO_LIBRARY_DIR` | 否 | 后台 OSS 配置不完整时的兜底 |
