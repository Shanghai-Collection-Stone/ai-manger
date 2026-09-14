/**
 * @description 解析接口基地址（本地 4322 开发端口直连后端 3011，其余同源）
 * @keyword-cn 接口基地址, 本地开发直连
 * @keyword-en resolve-api-base, local-dev-direct
 */
export function resolveSmsApiBase() {
  if (typeof window === 'undefined') return '';
  return window.location.port === '4322'
    ? 'http://localhost:3011'
    : window.location.origin;
}

/**
 * @description 后端验证码错误码到中文提示的映射
 * @keyword-cn 验证码错误提示, 错误码映射
 * @keyword-en sms-error-messages, error-code-map
 */
export const SMS_ERROR_MESSAGES = {
  SMS_PHONE_INVALID: '手机号格式不正确',
  SMS_SCENE_INVALID: '验证码场景无效',
  SMS_NOT_CONFIGURED: '短信服务暂未开通，请联系管理员',
  SMS_SEND_TOO_FREQUENT: '发送太频繁，请稍后再试',
  SMS_PHONE_DAILY_LIMIT: '该手机号今日发送次数已达上限',
  SMS_IP_HOURLY_LIMIT: '当前网络发送次数过多，请稍后再试',
  SMS_PROVIDER_RATE_LIMITED: '短信发送受限，请稍后再试',
  SMS_SEND_FAILED: '短信发送失败，请稍后再试',
  SMS_CODE_REQUIRED: '请输入短信验证码',
  SMS_CODE_INVALID: '验证码错误',
  SMS_CODE_EXPIRED: '验证码已失效，请重新获取',
  SMS_CODE_TOO_MANY_ATTEMPTS: '验证码错误次数过多，请重新获取',
};

/**
 * @description 把后端错误码转成中文提示，未知码原样返回
 * @keyword-cn 描述验证码错误, 中文提示
 * @keyword-en describe-sms-error, chinese-message
 * @param {string} code 错误码。
 * @returns {string} 提示文案。
 */
export function describeSmsError(code) {
  return SMS_ERROR_MESSAGES[code] || code || '请求失败';
}

/**
 * @description 发送短信验证码（公开接口），失败抛出带 code / retryAfterSeconds 的 Error
 * @keyword-cn 发送短信验证码, 公开接口
 * @keyword-en send-sms-code, public-api
 * @param {string} phone 手机号。
 * @param {string} scene 业务场景，与后端 SMS_VERIFICATION_SCENES 一致。
 * @returns {Promise<{ expiresInSeconds: number, resendAfterSeconds: number }>}
 */
export async function sendSmsCode(phone, scene) {
  const res = await fetch(`${resolveSmsApiBase()}/api/sms-verification/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, scene }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = Array.isArray(data.message)
      ? data.message[0]
      : data.message || `请求失败(${res.status})`;
    const error = new Error(describeSmsError(code));
    error.code = code;
    error.retryAfterSeconds = data.retryAfterSeconds;
    throw error;
  }
  return data;
}
