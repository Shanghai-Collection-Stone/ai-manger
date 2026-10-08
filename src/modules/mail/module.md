# 模块名称 (Module Name)

发信邮箱模块（mail）

## 概述 (Overview)

提供平台级 SMTP 配置、密码加密存储、超管配置接口、真实测试发送、统一品牌版式的邮件模板，以及供业务模块调用的发信服务。模块为 `@Global()`，配置全平台唯一；密码使用 AES-256-GCM 信封落库，接口只返回尾四位掩码。非生产环境可通过 `MAIL_MOCK=true` 开启模拟发信。

## 文件清单 (File List)

- `mail.module.ts` — 全局模块入口，装配控制器、配置服务、加解密服务、模板服务与发信服务，并导出 `MailService`。
- `entities/mail.entity.ts` — 平台作用域常量、品牌名、配置实体、密码信封、配置视图、运行配置、发信参数与模板内容类型。
- `services/mail-crypto.service.ts` — SMTP 密码 AES-256-GCM 加解密与无密钥明文降级告警。
- `services/mail-config.service.ts` — 平台 SMTP 配置读写、尾四位掩码、运行配置解析与模拟模式判断。
- `services/mail-template.service.ts` — 统一品牌版式渲染（HTML + 纯文本）、HTML 转义，以及邮件时间格式化与手机号脱敏函数。
- `services/mail.service.ts` — SMTP 发信、模板邮件发送、就绪检查、测试发送、日志脱敏与 transporter 指纹缓存。
- `controller/mail.controller.ts` — 超管发信邮箱配置与测试发送接口。
- `controller/mail.dto.ts` — 保存配置与测试发送请求体校验。

## 函数清单 (Function List)

- `MailModule()` — 注册全局发信邮箱模块并导出发信服务 | keywords: 发信邮箱模块, 全局模块, mail-module, global-module
- `MailCryptoService()` — 提供 SMTP 密码信封加解密能力 | keywords: 邮箱密码加密, 加密信封, mail-password-encryption, encryption-envelope
- `MailCryptoService.encrypt(value)` — 把 SMTP 密码明文封装成落库信封 | keywords: 加密密码, 生成信封, encrypt-password, build-envelope
- `MailCryptoService.decrypt(envelope?)` — 从信封容错还原 SMTP 密码 | keywords: 解密密码, 容错解包, decrypt-password, tolerant-unwrap
- `MailCryptoService.resolveKey()` — 按邮箱、短信、浏览器认证的顺序解析加密密钥 | keywords: 解析加密密钥, 环境变量, resolve-encryption-key, environment-key
- `MailConfigService()` — 管理平台 SMTP 配置、掩码和运行配置 | keywords: 邮箱配置服务, SMTP配置, mail-config-service, smtp-setting
- `MailConfigService.ensureIndexes()` — 建立平台作用域唯一索引 | keywords: 配置索引, 作用域唯一, config-indexes, unique-scope
- `MailConfigService.getView()` — 读取仅含密码掩码的配置视图 | keywords: 读取邮箱配置, 密码掩码, read-mail-setting, masked-password
- `MailConfigService.save(input,operatorId)` — 保存配置，支持密码不传保持与空串清除 | keywords: 保存邮箱配置, 密码更新, save-mail-setting, update-password
- `MailConfigService.resolveRuntime({requireEnabled?})` — 解析明文 SMTP 运行配置 | keywords: 解析发信配置, 启用开关, resolve-mail-runtime, enabled-switch
- `MailConfigService.isMockMode()` — 判断非生产环境模拟发信开关 | keywords: 模拟发信模式, 本地调试, mail-mock-mode, local-debug
- `MailConfigService.toRuntime(doc,password)` — 组装运行配置并校验必填项 | keywords: 组装发信配置, 必填校验, build-runtime-config, required-fields
- `MailConfigService.findPlatform()` — 读取平台作用域配置文档 | keywords: 读取平台配置, find-platform-setting
- `MailConfigService.mask(password)` — 把密码掩码为尾四位展示 | keywords: 密码掩码, 尾号展示, mask-password, tail-digits
- `MailService()` — 提供 SMTP 真实发送、模拟发送与 transporter 缓存 | keywords: SMTP发信服务, 邮件发送, mail-service, smtp-send
- `MailService.send({to,subject,text,html?})` — 使用已启用配置发送业务邮件 | keywords: 发送邮件, 模拟发信, send-mail, mock-mail
- `MailService.sendTemplate(to,content)` — 按统一版式渲染后发送，业务只提供文案结构 | keywords: 发送模板邮件, 统一版式, send-template-mail, unified-layout
- `MailService.isReady()` — 判断发信配置是否齐全且启用 | keywords: 发信就绪检查, 配置完整性, mail-ready-check, config-completeness
- `MailService.testSend(to)` — 忽略启用开关并真实发送统一版式的测试邮件（附发信服务器、发件地址与发送时间） | keywords: 测试发送邮件, 配置自检, test-send-mail, config-probe
- `MailService.deliver(runtime,input)` — 执行 SMTP 发送并收敛服务商错误 | keywords: 执行SMTP发送, 发送错误, deliver-smtp-mail, send-error
- `MailService.getTransporter(runtime)` — 按配置指纹复用或重建 transporter | keywords: 传输器缓存, 配置指纹, transporter-cache, config-fingerprint
- `MailService.formatFrom(runtime)` — 生成带可选显示名的发件人字段 | keywords: 格式化发件人, 显示名称, format-mail-from, display-name
- `MailService.maskAddress(address)` — 对日志中的收件地址脱敏 | keywords: 邮件地址脱敏, 日志安全, mask-email-address, log-safety
- `MailService.extractErrorMessage(error)` — 提取 SMTP 服务商原始错误文本 | keywords: 提取错误信息, 服务商错误, extract-error-message, provider-error
- `MailTemplateService()` — 渲染统一品牌版式邮件 | keywords: 邮件模板服务, 统一版式, mail-template-service, unified-layout
- `MailTemplateService.render(content)` — 主题加品牌前缀并生成 HTML 与纯文本 | keywords: 渲染模板邮件, 主题前缀, render-mail-template, subject-prefix
- `MailTemplateService.renderText(content)` — 生成纯文本版本 | keywords: 纯文本邮件, 降级展示, plain-text-mail, text-fallback
- `MailTemplateService.renderHtml(subject,content)` — 生成页眉、正文、验证码框、信息表格、提示框与页脚 | keywords: 邮件HTML版式, 品牌页眉, mail-html-layout, brand-header
- `MailTemplateService.escapeHtml(value)` — 转义文案防止标签注入 | keywords: HTML转义, 邮件安全, html-escape, email-safety
- `formatMailDateTime(date)` — 北京时间 `YYYY-MM-DD HH:mm` | keywords: 邮件时间格式, 北京时间, mail-datetime-format, beijing-time
- `maskMailPhone(phone)` — 手机号中间四位脱敏 | keywords: 邮件手机号脱敏, 手机号脱敏, mask-mail-phone, masked-phone
- `MailController()` — 提供平台 SMTP 配置与测试发送接口 | keywords: 邮箱配置接口, SMTP测试接口, mail-setting-controller, smtp-test-endpoint
- `MailController.getSettings()` — GET /api/mail/settings 读取配置 | keywords: 读取邮箱配置接口, get-mail-setting-endpoint
- `MailController.saveSettings(req,dto)` — PUT /api/mail/settings 保存配置 | keywords: 保存邮箱配置接口, save-mail-setting-endpoint
- `MailController.testSettings(dto)` — POST /api/mail/settings/test 真实测试发信 | keywords: 测试发信接口, 配置自检, test-mail-setting-endpoint, config-probe
- `MailController.requireUser(req)` — 读取当前鉴权后台用户 | keywords: 读取后台用户, 鉴权上下文, read-admin-user, auth-context
- `SaveMailSettingDto()` — 校验平台发信邮箱配置请求体 | keywords: 保存邮箱配置请求体, SMTP配置, save-mail-setting-dto, smtp-setting
- `TestMailSettingDto()` — 校验测试发信收件地址 | keywords: 测试发信请求体, test-mail-setting-dto

## 关键词索引 (Keyword Index)

| 中文 | English |
| ---- | ------- |
| 发信邮箱模块 | mail-module |
| 全局模块 | global-module |
| 邮箱密码加密 | mail-password-encryption |
| 加密信封 | encryption-envelope |
| 邮箱配置服务 | mail-config-service |
| SMTP配置 | smtp-setting |
| 密码掩码 | masked-password |
| 模拟发信模式 | mail-mock-mode |
| SMTP发信服务 | mail-service |
| 邮件发送 | smtp-send |
| 发送邮件 | send-mail |
| 发信就绪检查 | mail-ready-check |
| 测试发送邮件 | test-send-mail |
| 传输器缓存 | transporter-cache |
| 配置指纹 | config-fingerprint |
| 邮件地址脱敏 | mask-email-address |
| 邮箱配置接口 | mail-setting-controller |
| SMTP测试接口 | smtp-test-endpoint |
| 邮件模板服务 | mail-template-service |
| 统一版式 | unified-layout |
| 发送模板邮件 | send-template-mail |
| 渲染模板邮件 | render-mail-template |
| 主题前缀 | subject-prefix |
| 纯文本邮件 | plain-text-mail |
| 邮件HTML版式 | mail-html-layout |
| HTML转义 | html-escape |
| 邮件时间格式 | mail-datetime-format |
| 邮件手机号脱敏 | mask-mail-phone |

## 类型导出 (Type Exports)

- `MAIL_PLATFORM_SCOPE_ID` — 平台作用域占位符 `__platform__` | keywords: 平台作用域, 邮箱配置, platform-scope, mail-setting
- `MailPasswordEnvelope` — SMTP 密码 AES-256-GCM 或明文降级信封 | keywords: 密码信封, 加密存储, password-envelope, encrypted-storage
- `MailSettingEntity` — `mail_settings` 配置文档 | keywords: 邮箱配置实体, mail-setting-entity
- `MailSettingInput` — 保存入参 | keywords: 邮箱配置入参, mail-setting-input
- `MailSettingView` — 配置页视图，密码只回掩码 | keywords: 邮箱配置视图, 密码掩码, mail-setting-view, masked-password
- `MailRuntimeConfig` — Nodemailer 使用的明文 SMTP 运行配置 | keywords: SMTP运行配置, smtp-runtime-config
- `MailSendInput` — 业务发信参数 | keywords: 发信参数, mail-send-input
- `MailSendResult` — 消息 ID 结果 | keywords: 发信结果, mail-send-result
- `MAIL_BRAND_NAME` — 邮件品牌名「AI 营销官」 | keywords: 邮件品牌名, 主题前缀, mail-brand-name, subject-prefix
- `MailTemplateContent` — 模板邮件文案结构 | keywords: 模板邮件内容, 统一版式, mail-template-content, unified-layout
- `MailTemplateDetail` — 信息表格一行 | keywords: 邮件信息行, mail-detail-row
- `MailRenderedContent` — 渲染结果（主题、纯文本、HTML） | keywords: 模板渲染结果, mail-rendered-content

## 模块功能描述 (Module Description)

**入口鉴权**

| 路由 | 权限 |
| ---- | ---- |
| `GET /api/mail/settings` | `read MailSetting`（仅超管） |
| `PUT /api/mail/settings` | `update MailSetting`（仅超管） |
| `POST /api/mail/settings/test` | `update MailSetting`（仅超管） |

`GET /api/mail/settings` 返回 `{ setting: MailSettingView }`。`PUT /api/mail/settings` 接收 `enabled`、`host`、`port`、`secure`、`username`、可选 `password`、`fromAddress`、可选 `fromName`；`password` 不传保持原值，传空串清空。`POST /api/mail/settings/test` 接收 `{ to }`，忽略启用开关并真实发送主题为「【AI 营销官】发信配置测试」的统一版式邮件（附发信服务器、发件地址与发送时间），成功返回 `{ ok: true, messageId }`。

**错误码**：`MAIL_NOT_CONFIGURED`（503，SMTP 必填配置不完整；业务发信还包括未启用）、`MAIL_SEND_FAILED`（503，响应 `message` 保留 SMTP 服务商原始错误文本）。

**集合**：`mail_settings`，`scopeId` 唯一，全平台固定使用 `__platform__`。

**环境变量**

| 变量 | 必需 | 说明 |
| ---- | ---- | ---- |
| `MAIL_ENCRYPTION_KEY` | 否 | SMTP 密码首选加密密钥；缺失时依次回落 `SMS_ENCRYPTION_KEY`、`BROWSER_AUTH_ENCRYPTION_KEY`，全部缺失则明文降级并告警。 |
| `MAIL_MOCK` | 否 | 非生产环境设为 `true` 时，业务发信只记录收件人脱敏值、主题和正文前 200 字并返回 `mock-<时间戳>`；测试发送仍强制真实发信。 |

常见 SMTP 配置：阿里云企业邮箱使用 `smtp.qiye.aliyun.com:465` 并开启 SSL；阿里云邮件推送使用 `smtpdm.aliyun.com:465`；QQ 邮箱使用 `smtp.qq.com:465` 并以授权码作为密码。

**统一版式**：业务通知一律用 `MailService.sendTemplate(to, content)`，只传 `MailTemplateContent`（主题、预览摘要、标题、称呼、段落、可选验证码与说明、信息表格、补充段落、提示框），由 `MailTemplateService` 渲染成统一品牌版式：深色品牌页眉 + 蓝色细条、标题、正文、大号等宽验证码框、键值信息表格、琥珀色提示框、「AI 营销官团队」落款与「系统自动发送，请勿直接回复」页脚。HTML 为 600px 表格布局 + 全内联样式、无外链资源，兼容 Outlook / QQ 邮箱 / Gmail；同时生成纯文本版本。所有文案先 HTML 转义。主题统一加「【AI 营销官】」前缀。

当前使用方：测试邮件（本模块）、邮箱验证码（[email-verification](../email-verification/module.md)）、注册成功（admin `AdminService.notifyRegistered`）、入驻审核通过 / 未通过（[tenant-join](../tenant-join/module.md)）。

其他模块通过 `src/modules/mail/services/mail.service.ts` 导入 `MailService` 并注入使用；调用 `MailService.sendTemplate(to, content)` 或底层 `MailService.send({ to, subject, text, html? })`，返回 `{ messageId }`。由于 `MailModule` 是全局模块且导出 `MailService`，应用根模块注册一次后业务模块无需重复导入。
