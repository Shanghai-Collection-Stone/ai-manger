# 模块名称 (Module Name)

租户邀请入驻（TenantInvite）

## 概述 (Overview)

提供公开邀请链接的预览、桌面客户端唤起、新账号短信注册和已有账号加入能力。页面不读取或发送后台登录令牌。

## 文件清单 (File List)

- `../../pages/invite.astro` — `/pages/invite.html` 页面壳、页面标题与全局样式入口。
- `InviteApp.jsx` — 邀请预览、失效状态、双页签加入表单、成功反馈与桌面客户端唤起。
- `tenantInviteApi.js` — 租户邀请公开接口请求、错误状态封装和中文错误提示。

## 函数清单 (Function List)

- `INVITE_CODE_PATTERN` — 邀请码允许的字符与长度格式 | keywords: 邀请码格式, invite-code-pattern
- `readInviteCode()` — 从当前页面查询参数读取邀请码 | keywords: 读取邀请码, 查询参数, read-invite-code, query-parameter
- `formatExpiresAt(value)` — 把邀请有效期格式化为本地年月日时分 | keywords: 格式化有效期, 本地时间, format-expiry, local-time
- `InviteApp()` — 承载邀请预览、注册和已有账号加入流程 | keywords: 邀请入驻页面, 团队加入, tenant-invite-app, team-join
- `requestInvitePreview()` — 请求并应用当前邀请码的预览状态 | keywords: 加载邀请预览, 邀请状态, load-invite-preview, invite-state
- `loadInvitePreview()` — React 挂载时启动邀请预览加载 | keywords: 初始化邀请页, 加载预览, initialize-invite-page, preview-loading
- `openClient(includeCode)` — 使用自定义协议唤起桌面客户端 | keywords: 唤起客户端, 自定义协议, open-desktop-client, custom-protocol
- `openInviteClient()` — 携带邀请码唤起客户端邀请流程 | keywords: 打开客户端邀请, 携带邀请码, open-client-invite, include-invite-code
- `openClientHome()` — 加入成功后唤起客户端首页 | keywords: 打开客户端首页, 加入后启动, open-client-home, post-join-launch
- `switchTab(tab)` — 切换注册与已有账号加入页签 | keywords: 切换加入方式, 页签切换, switch-join-method, tab-switch
- `switchToRegister()` — 切换到新账号注册页签 | keywords: 切换注册页签, switch-registration-tab
- `switchToExisting()` — 切换到已有账号加入页签 | keywords: 切换已有账号页签, switch-existing-account-tab
- `validateRegistration()` — 校验短信验证码、邮箱验证码、昵称及两次密码 | keywords: 注册表单校验, 输入校验, validate-registration-form, input-validation
- `submitRegistration(event)` — 提交新账号注册并加入团队 | keywords: 提交邀请注册, 新账号加入, submit-invite-registration, new-account-join
- `submitAcceptance(event)` — 提交已有账号凭据并加入团队 | keywords: 提交已有账号, 凭据加入, submit-existing-account, credential-join
- `changeSmsValue(value)` — 更新短信验证码受控值 | keywords: 更新短信值, 受控输入, update-sms-value, controlled-input
- `changeEmailValue(value)` — 更新邮箱与邮箱验证码受控值 | keywords: 更新邮箱, 表单输入, update-email, form-input
- `changeDisplayName(event)` — 更新昵称输入值 | keywords: 更新昵称, 表单输入, update-display-name, form-input
- `changePassword(event)` — 更新新账号密码 | keywords: 更新注册密码, 表单输入, update-registration-password, form-input
- `changeConfirmPassword(event)` — 更新确认密码 | keywords: 更新确认密码, 表单输入, update-confirm-password, form-input
- `changeAccount(event)` — 更新已有账号手机号 | keywords: 更新账号手机号, 表单输入, update-account-phone, form-input
- `changeExistingPassword(event)` — 更新已有账号密码 | keywords: 更新账号密码, 表单输入, update-account-password, form-input
- `INVITE_ERROR_MESSAGES` — 租户邀请错误码到中文提示的映射 | keywords: 邀请错误提示, 错误码映射, invite-error-messages, error-code-map
- `describeInviteError(code)` — 把租户邀请错误码（含 SMS_ / EMAIL_ 验证码错误）转换为中文提示 | keywords: 描述邀请错误, 中文提示, describe-invite-error, chinese-message
- `extractErrorCode(data,status)` — 从后端响应中提取首个错误码 | keywords: 提取错误码, 接口错误, extract-error-code, api-error
- `parseResponse(response)` — 解析 JSON 响应并容错非 JSON 内容 | keywords: 解析接口响应, 容错处理, parse-api-response, fault-tolerance
- `requestPublic(path,options?)` — 发起无需登录令牌的邀请公开请求 | keywords: 邀请公开请求, 无令牌请求, invite-public-request, tokenless-request
- `getInvite(code)` — 获取邀请码对应的团队和有效期预览 | keywords: 邀请预览, 公开接口, invite-preview, public-api
- `registerWithInvite(payload)` — 注册新账号并通过邀请码加入团队 | keywords: 邀请注册, 短信验证, invite-registration, sms-verification
- `acceptInvite(code,credentials)` — 使用已有手机号账号接受邀请 | keywords: 已有账号加入, 邀请接受, existing-account-join, invite-acceptance

## 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 邀请入驻页面 | tenant-invite-app |
| 团队加入 | team-join |
| 邀请码格式 | invite-code-pattern |
| 邀请预览 | invite-preview |
| 邀请注册 | invite-registration |
| 已有账号加入 | existing-account-join |
| 短信验证 | sms-verification |
| 唤起客户端 | open-desktop-client |
| 自定义协议 | custom-protocol |
| 邀请公开请求 | invite-public-request |
| 无令牌请求 | tokenless-request |
| 邀请错误提示 | invite-error-messages |
| 错误码映射 | error-code-map |

## 模块功能描述 (Module Description)

- 页面地址为 `/pages/invite.html?code=<code>`；邀请码必须符合 `[A-Za-z0-9_-]` 字符集且长度为 16–64。
- 页面先调用公开免鉴权的 `GET /api/tenant-join/invites/:code` 展示团队、有效期，以及不存在、过期或撤销状态。
- 第一条路径通过 `ai-marketing://invite?code=<code>` 唤起桌面客户端；加入成功后通过 `ai-marketing://open` 再次唤起。
- 第二条路径使用 `SmsCodeInput` 与 [EmailCodeInput](../EmailVerification/module.md) 的 `register` 场景（手机号与邮箱都要先收验证码），调用公开免鉴权的 `POST /api/tenant-join/register` 注册新账号并直接加入受邀团队，成功后后端给该邮箱发注册成功邮件。
- 第三条路径调用公开免鉴权的 `POST /api/tenant-join/invites/:code/accept`，使用已有账号的手机号和密码加入团队。
- 邀请和账号错误由 `INVITE_ERROR_MESSAGES` 转为中文提示；`SMS_*` 错误交由 `describeSmsError` 处理，未知错误显示通用提示。
- 覆盖 `PHONE_ALREADY_REGISTERED`、`INVITE_NOT_FOUND`、`INVITE_EXPIRED`、`INVITE_REVOKED`、`INVALID_CREDENTIALS`、`ACCOUNT_DELETED`、`APPLICATION_NOT_FOUND`、`APPLICATION_NOT_PENDING`、`CROSS_TENANT_FORBIDDEN` 和 SMS 系列错误码。
