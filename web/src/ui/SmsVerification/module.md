# 模块名称 (Module Name)

短信验证码前端组件（SmsVerification）

## 概述 (Overview)

提供可复用的「手机号 + 短信验证码」受控组件与公开发码请求封装，对接后端 [sms-verification 模块](../../../../src/modules/sms-verification/module.md)。组件值形如 `{ smsPhone, smsCode }`，字段名与后端 `@RequireSmsCode` 判定守卫读取的字段逐字一致，提交时直接展开进请求体即可，不需要额外映射。

## 文件清单 (File List)

- `SmsCodeInput.jsx` — 手机号 + 验证码输入、获取验证码按钮、重发倒计时与错误提示。
- `smsVerificationApi.js` — 接口基地址解析、公开发码请求、错误码中文映射。

## 函数清单 (Function List)

- `SmsCodeInput({scene,value,onChange,disabled?,className?})` — 手机号 + 短信验证码受控组件 | keywords: 验证码输入组件, 受控组件, 倒计时, sms-code-input, controlled-component, countdown
- `startCountdown(seconds)` — 启动重发倒计时 | keywords: 启动倒计时, 重发间隔, start-countdown, resend-interval
- `update(patch)` — 合并字段并回调父组件 | keywords: 更新组件值, update-sms-value
- `onSend()` — 校验手机号后发码，频控时按后端剩余秒数倒计时 | keywords: 获取验证码, 发送频控, request-sms-code, send-throttle
- `isSmsValueComplete(value)` — 判断手机号与 6 位验证码是否齐全 | keywords: 验证码值完整性, 提交校验, sms-value-complete, submit-check
- `SMS_PHONE_PATTERN` — 大陆手机号正则 | keywords: 手机号格式, mainland-phone-pattern
- `resolveSmsApiBase()` — 本地 4322 端口直连 3011，其余同源 | keywords: 接口基地址, 本地开发直连, resolve-api-base, local-dev-direct
- `sendSmsCode(phone,scene)` — 公开发码，失败抛带 code/retryAfterSeconds 的 Error | keywords: 发送短信验证码, 公开接口, send-sms-code, public-api
- `describeSmsError(code)` — 错误码转中文提示 | keywords: 描述验证码错误, 中文提示, describe-sms-error, chinese-message
- `SMS_ERROR_MESSAGES` — 后端错误码中文映射表 | keywords: 验证码错误提示, 错误码映射, sms-error-messages, error-code-map

## 关键词索引 (Keyword Index)

| 中文           | English              |
| -------------- | -------------------- |
| 验证码输入组件 | sms-code-input       |
| 受控组件       | controlled-component |
| 倒计时         | countdown            |
| 重发间隔       | resend-interval      |
| 获取验证码     | request-sms-code     |
| 发送频控       | send-throttle        |
| 提交校验       | submit-check         |
| 发送短信验证码 | send-sms-code        |
| 公开接口       | public-api           |
| 错误码映射     | error-code-map       |
| 接口基地址     | resolve-api-base     |

## 模块功能描述 (Module Description)

用法：

- 父组件持有 `const [sms, setSms] = useState({ smsPhone: '', smsCode: '' })`，渲染 `<SmsCodeInput scene="register" value={sms} onChange={setSms} />`。
- 提交按钮用 `isSmsValueComplete(sms)` 控制可用，提交体为 `{ ...form, ...sms }`，例如注册调用 `adminApi.register({ tenantName, username, password, ...sms })`。
- `scene` 必须与后端 `SMS_VERIFICATION_SCENES` 中登记的值一致。
- 发码为公开接口，不带登录 token；后端返回 `SMS_SEND_TOO_FREQUENT` 时组件按 `retryAfterSeconds` 自动倒计时。
- 样式使用 Tailwind 类名，与后台其他页面一致。
