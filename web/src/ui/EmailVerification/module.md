# 模块名称 (Module Name)

邮箱验证码前端组件（EmailVerification）

## 概述 (Overview)

提供可复用的「邮箱 + 邮箱验证码」受控组件与公开发码请求封装，对接后端 [email-verification 模块](../../../../src/modules/email-verification/module.md)。组件值形如 `{ email, emailCode }`，字段名与后端 `@RequireEmailCode` 判定守卫读取的字段逐字一致，提交时直接展开进请求体即可。

## 文件清单 (File List)

- `EmailCodeInput.jsx` — 邮箱 + 验证码输入、获取验证码按钮、重发倒计时、发送成功与错误提示。
- `emailVerificationApi.js` — 公开发码请求与错误码中文映射（接口基地址复用 `SmsVerification` 的 `resolveSmsApiBase()`）。

## 函数清单 (Function List)

- `EmailCodeInput({scene,value,onChange,disabled?,placeholder?,className?})` — 邮箱 + 邮箱验证码受控组件 | keywords: 邮箱验证码输入组件, 受控组件, 倒计时, email-code-input, controlled-component, countdown
- `startCountdown(seconds)` — 启动重发倒计时 | keywords: 启动倒计时, 重发间隔, start-countdown, resend-interval
- `update(patch)` — 合并字段并回调父组件，改邮箱时清掉已发送提示 | keywords: 更新组件值, update-email-value
- `onSend()` — 校验邮箱后发码，提示查收（含垃圾邮件箱），频控时按后端剩余秒数倒计时 | keywords: 获取邮箱验证码, 发送频控, request-email-code, send-throttle
- `isEmailValueComplete(value)` — 判断邮箱与 6 位验证码是否齐全 | keywords: 邮箱验证码值完整性, 提交校验, email-value-complete, submit-check
- `EMAIL_PATTERN` — 基础邮箱正则 | keywords: 邮箱格式, email-pattern
- `sendEmailCode(email,scene)` — 公开发码，失败抛带 code/retryAfterSeconds 的 Error | keywords: 发送邮箱验证码, 公开接口, send-email-code, public-api
- `describeEmailError(code)` — 错误码转中文提示 | keywords: 描述邮箱验证码错误, 中文提示, describe-email-error, chinese-message
- `EMAIL_ERROR_MESSAGES` — 后端错误码中文映射表 | keywords: 邮箱验证码错误提示, 错误码映射, email-error-messages, error-code-map

## 关键词索引 (Keyword Index)

| 中文 | English |
| --- | --- |
| 邮箱验证码输入组件 | email-code-input |
| 受控组件 | controlled-component |
| 倒计时 | countdown |
| 重发间隔 | resend-interval |
| 获取邮箱验证码 | request-email-code |
| 发送频控 | send-throttle |
| 提交校验 | submit-check |
| 发送邮箱验证码 | send-email-code |
| 公开接口 | public-api |
| 错误码映射 | error-code-map |
| 邮箱格式 | email-pattern |

## 模块功能描述 (Module Description)

**用法**：

- 父组件持有 `const [emailValue, setEmailValue] = useState({ email: '', emailCode: '' })`，渲染 `<EmailCodeInput scene="register" value={emailValue} onChange={setEmailValue} />`。
- 提交前用 `isEmailValueComplete(emailValue)` 校验，提交体展开 `{ ...form, ...emailValue }`；可与 `SmsCodeInput` 同时使用，例如邀请注册同时带 `{ smsPhone, smsCode, email, emailCode }`。

已接入：邀请入驻页 [TenantInvite](../TenantInvite/module.md) 的新账号注册。

发送成功后在组件内提示「验证码已发送，请查收邮件（没收到请看看垃圾邮件箱）」；验证码 10 分钟有效，重发间隔以后端返回的 `resendAfterSeconds` 为准。
