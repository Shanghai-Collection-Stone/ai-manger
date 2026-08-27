# 模块名称 (Module Name)

浏览器认证与任务人机交互模块（browser-auth）

## 概述 (Overview)

为 SuperClaw 执行浏览器任务提供两项同域能力：按租户、工作区、站点和浏览器 profile 加密保存 Playwright `storageState`，避免每次任务重复登录；当会话失效或任务需要用户补充少量信息时，创建二维码登录或简短文本交互，把 Todo 切换为 `waiting_user`，用户回调后按原执行租约是否仍有效恢复为 `in_progress` 或重新进入 `pending`。

Cookie、localStorage、二维码内容和用户回复均以 `BROWSER_AUTH_ENCRYPTION_KEY` 经 AES-256-GCM 加密后保存。明文仅在任务 Token 或后台登录态鉴权通过的单次调用响应中出现，不写入 Todo、任务结果或日志。浏览器会话集合为 `browser_sessions`，交互集合为 `browser_auth_interactions`。

## 文件清单 (File List)

- `browser-auth.module.ts` — NestJS 模块入口，装配加密、会话、交互服务与后台交互控制器。
- `entities/browser-auth.entity.ts` — 浏览器会话、加密信封、任务交互实体及安全视图类型。
- `services/browser-auth-crypto.service.ts` — AES-256-GCM 敏感值加解密与环境密钥解析。
- `services/browser-session.service.ts` — Playwright storageState 的作用域隔离、加密保存、读取与失效。
- `services/browser-auth-interaction.service.ts` — 二维码/短文本交互、超时、用户回调与 Todo 恢复。
- `controller/browser-auth-interaction.dto.ts` — 用户交互回复请求体校验。
- `controller/browser-auth-interaction.controller.ts` — 执行节点时间轴查询待处理交互与提交回复的后台接口。

## 函数清单 (Function List)

- `BrowserAuthModule()` — 装配浏览器登录态与任务人机交互能力 | keywords: 浏览器认证模块, 任务人机交互, browser-auth-module, human-in-the-loop
- `BrowserAuthCryptoService()` — 使用环境密钥保护浏览器认证敏感值 | keywords: 浏览器认证加密, 敏感值保护, browser-auth-encryption, secret-protection
- `BrowserAuthCryptoService.encrypt(value)` — 加密 Cookie storageState、二维码内容或用户回复 | keywords: 加密认证数据, AES-GCM, encrypt-auth-data, aes-gcm
- `BrowserAuthCryptoService.decrypt(envelope)` — 在受鉴权请求内临时解密认证敏感值 | keywords: 解密认证数据, 临时明文, decrypt-auth-data, transient-plaintext
- `BrowserAuthCryptoService.resolveKey()` — 解析浏览器认证环境密钥 | keywords: 解析浏览器密钥, 环境密钥, resolve-browser-key, environment-key
- `BrowserSessionService({ db,crypto })` — 按租户、工作区与站点管理加密 storageState | keywords: 浏览器会话存储, Cookie复用, browser-session-storage, cookie-reuse
- `BrowserSessionService.ensureIndexes()` — 建立浏览器会话唯一作用域与过期索引 | keywords: 浏览器会话索引, 作用域唯一, browser-session-indexes, unique-scope
- `BrowserSessionService.get(input)` — 读取有效浏览器会话供节点复用登录态 | keywords: 读取浏览器会话, 复用登录态, read-browser-session, reuse-login-state
- `BrowserSessionService.upsert(input)` — 加密保存当前任务作用域的 storageState | keywords: 保存浏览器会话, 加密Cookie, save-browser-session, encrypted-cookie
- `BrowserSessionService.invalidate(input)` — 删除失效或退出登录的浏览器会话 | keywords: 失效浏览器会话, 删除Cookie, invalidate-browser-session, delete-cookie
- `BrowserSessionService.normalizeKey(value,code)` — 规范会话必填键 | keywords: 规范会话键, 必填校验, normalize-session-key, required-validation
- `BrowserSessionService.normalizeProfile(value?)` — 规范浏览器 profile | keywords: 规范浏览器配置, 默认配置, normalize-browser-profile, default-profile
- `BrowserSessionService.validateStorageState(value)` — 校验 storageState JSON 结构和大小 | keywords: 校验会话状态, Cookie结构, validate-storage-state, cookie-structure
- `BrowserSessionService.readExpiry(value?)` — 解析登录会话过期时间 | keywords: 解析会话过期, 默认有效期, parse-session-expiry, default-ttl
- `BrowserAuthInteractionService({ db,crypto,todos,moduleRef })` — 管理任务等待用户和登录回调 | keywords: 任务等待用户, 登录回调, task-waiting-user, login-callback
- `BrowserAuthInteractionService.ensureIndexes()` — 建立任务交互和过期索引 | keywords: 任务交互索引, 交互过期, task-interaction-indexes, interaction-expiry
- `BrowserAuthInteractionService.create(todo,input)` — 创建交互并取消同任务旧交互 | keywords: 创建任务交互, 取消旧交互, create-task-interaction, cancel-stale-interaction
- `BrowserAuthInteractionService.getForTask(todo,interactionId?)` — 节点查询交互及用户回复 | keywords: 节点查询交互, 读取用户回复, node-read-interaction, read-user-response
- `BrowserAuthInteractionService.getActiveForUser(user,todoId)` — 后台读取当前待处理交互 | keywords: 用户读取交互, 登录窗口, user-read-interaction, login-window
- `BrowserAuthInteractionService.respond(user,id,response?)` — 提交回调并恢复原任务 | keywords: 提交任务回调, 恢复原任务, submit-task-callback, resume-original-task
- `BrowserAuthInteractionService.cancel(interactionId)` — 回滚未成功挂起的交互 | keywords: 回滚任务交互, 取消交互, rollback-task-interaction, cancel-interaction
- `BrowserAuthInteractionService.expireIfNeeded(row)` — 超时交互转为失败终态 | keywords: 交互超时失败, 等待用户超时, expire-interaction, user-wait-timeout
- `BrowserAuthInteractionService.requireScope(user,row)` — 校验交互租户与平台边界 | keywords: 校验交互租户, 平台交互保护, validate-interaction-tenant, platform-interaction-protection
- `BrowserAuthInteractionService.readKind(value?)` — 解析允许的交互类型 | keywords: 解析交互类型, 类型校验, parse-interaction-kind, kind-validation
- `BrowserAuthInteractionService.readExpiry(value?,kind)` — 解析二维码或短文本交互时限 | keywords: 解析交互时限, 二维码有效期, parse-interaction-expiry, qr-expiry
- `BrowserAuthInteractionService.toView(row,options)` — 裁剪敏感字段并转换交互视图 | keywords: 转换交互视图, 敏感字段裁剪, map-interaction-view, redact-sensitive-fields
- `BrowserAuthInteractionService.notifyTaskAvailable(todo)` — 通知节点重新投递已恢复任务 | keywords: 通知任务恢复, 重新投递, notify-task-resume, redispatch-task
- `RespondBrowserAuthInteractionDto({ response? })` — 校验扫码确认或简短回复 | keywords: 任务交互回复参数, 简短对话, task-interaction-response-dto, short-dialog
- `BrowserAuthInteractionController({ interactions })` — 暴露任务交互后台入口 | keywords: 任务交互控制器, 登录窗口, task-interaction-controller, login-window
- `BrowserAuthInteractionController.getActive(req,todoId)` — 获取 Todo 当前交互窗口 | keywords: 获取待处理交互, 任务窗口, get-pending-interaction, task-window
- `BrowserAuthInteractionController.respond(req,id,body)` — 提交交互回复并恢复任务 | keywords: 回复任务交互, 恢复任务, respond-task-interaction, resume-task
- `BrowserAuthInteractionController.requireUser(req)` — 读取后台鉴权用户 | keywords: 读取交互用户, 鉴权上下文, read-interaction-user, auth-context

## 关键词索引 (Keyword Index)

| 中文           | English                 |
| -------------- | ----------------------- |
| 浏览器登录会话 | browser-login-session   |
| Cookie复用     | cookie-reuse            |
| 工作区隔离     | workspace-isolation     |
| 浏览器认证加密 | browser-auth-encryption |
| 任务等待用户   | task-waiting-user       |
| 二维码登录     | qr-login                |
| 简短对话       | short-dialog            |
| 用户回调       | user-callback           |
| 恢复原任务     | resume-original-task    |
| 重新投递       | redispatch-task         |
| 登录窗口       | login-window            |
| 敏感字段裁剪   | redact-sensitive-fields |

## 类型导出 (Type Exports)

- `BrowserAuthSecretEnvelope` — AES-256-GCM 密文、随机向量、认证标签和密钥版本。
- `BrowserSessionEntity` / `BrowserSessionView` — 数据库存储实体与节点临时明文视图。
- `BrowserAuthInteractionKind` / `BrowserAuthInteractionStatus` — `qr_login | short_text` 类型与交互生命周期。
- `BrowserAuthInteractionEntity` / `BrowserAuthInteractionView` / `BrowserAuthInteractionEnvelope` — 任务交互存储、安全视图和可空响应。

## 模块功能描述 (Module Description)

后台入口挂载于 `/task-interactions`，使用 `AdminAuthGuard + AdminPoliciesGuard`，权限主体取注册中心 `WorkspaceTask`：

| 方法与路径                                   | 权限                 | 用途                                     |
| -------------------------------------------- | -------------------- | ---------------------------------------- |
| `GET /task-interactions/todo/:todoId/active` | read WorkspaceTask   | 在执行节点时间轴读取二维码或简短对话窗口 |
| `POST /task-interactions/:id/respond`        | update WorkspaceTask | 点击“已处理”后提交确认并恢复任务与对话   |

节点侧不通过这些后台接口读 Cookie，而是经 `superclaw.v1.SuperClawGateway` 的任务 Token 专属 RPC 访问。生产环境必须配置 `BROWSER_AUTH_ENCRYPTION_KEY`；建议使用 32 字节随机值的 Base64 或 64 位十六进制表示。密钥缺失时仅相关加解密操作失败，不阻断应用启动。
