import { resolveSmsApiBase } from '../SmsVerification/smsVerificationApi.js';

/**
 * @description 后端邮箱验证码错误码到中文提示的映射
 * @keyword-cn 邮箱验证码错误提示, 错误码映射
 * @keyword-en email-error-messages, error-code-map
 */
export const EMAIL_ERROR_MESSAGES = {
  EMAIL_ADDRESS_INVALID: '邮箱格式不正确',
  EMAIL_INVALID: '邮箱格式不正确',
  EMAIL_SCENE_INVALID: '验证码场景无效',
  EMAIL_NOT_CONFIGURED: '邮件服务暂未开通，请联系管理员',
  EMAIL_SEND_TOO_FREQUENT: '发送太频繁，请稍后再试',
  EMAIL_ADDRESS_DAILY_LIMIT: '该邮箱今日发送次数已达上限',
  EMAIL_IP_HOURLY_LIMIT: '当前网络发送次数过多，请稍后再试',
  EMAIL_SEND_FAILED: '邮件发送失败，请检查邮箱地址或稍后再试',
  EMAIL_CODE_REQUIRED: '请输入邮箱验证码',
  EMAIL_CODE_INVALID: '邮箱验证码错误',
  EMAIL_CODE_EXPIRED: '邮箱验证码已失效，请重新获取',
  EMAIL_CODE_TOO_MANY_ATTEMPTS: '邮箱验证码错误次数过多，请重新获取',
};

/**
 * @description 把后端邮箱验证码错误码转成中文提示，未知码原样返回
 * @keyword-cn 描述邮箱验证码错误, 中文提示
 * @keyword-en describe-email-error, chinese-message
 * @param {string} code 错误码。
 * @returns {string} 提示文案。
 */
export function describeEmailError(code) {
  return EMAIL_ERROR_MESSAGES[code] || code || '请求失败';
}

/**
 * @description 发送邮箱验证码（公开接口），失败抛出带 code / retryAfterSeconds 的 Error
 * @keyword-cn 发送邮箱验证码, 公开接口
 * @keyword-en send-email-code, public-api
 * @param {string} email 邮箱地址。
 * @param {string} scene 业务场景，与后端 EMAIL_VERIFICATION_SCENES 一致。
 * @returns {Promise<{ expiresInSeconds: number, resendAfterSeconds: number }>}
 */
export async function sendEmailCode(email, scene) {
  const res = await fetch(`${resolveSmsApiBase()}/api/email-verification/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, scene }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = Array.isArray(data.message)
      ? data.message[0]
      : data.message || `请求失败(${res.status})`;
    const error = new Error(describeEmailError(code));
    error.code = code;
    error.retryAfterSeconds = data.retryAfterSeconds;
    throw error;
  }
  return data;
}
