import {
  describeSmsError,
  resolveSmsApiBase,
} from '../SmsVerification/smsVerificationApi.js';
import { describeEmailError } from '../EmailVerification/emailVerificationApi.js';

/**
 * @description 租户邀请接口错误码到中文提示的映射
 * @keyword-cn 邀请错误提示, 错误码映射
 * @keyword-en invite-error-messages, error-code-map
 */
export const INVITE_ERROR_MESSAGES = {
  PHONE_ALREADY_REGISTERED: '该手机号已注册，请使用“已有账号加入”',
  INVITE_NOT_FOUND: '邀请链接不存在',
  INVITE_EXPIRED: '邀请链接已过期',
  INVITE_REVOKED: '邀请链接已被撤销',
  INVALID_CREDENTIALS: '手机号或密码错误',
  ACCOUNT_DELETED: '该账号已被停用或删除',
  TOO_MANY_ATTEMPTS: '尝试次数过多，请稍后再试',
  APPLICATION_NOT_FOUND: '入驻申请不存在',
  APPLICATION_NOT_PENDING: '该入驻申请已处理',
  CROSS_TENANT_FORBIDDEN: '无权操作其他团队的数据',
};

/**
 * @description 把租户邀请错误码（含 SMS_ / EMAIL_ 验证码错误）转换为用户可读的中文提示
 * @keyword-cn 描述邀请错误, 中文提示
 * @keyword-en describe-invite-error, chinese-message
 * @param {string} code 后端错误码。
 * @returns {string} 中文提示。
 */
export function describeInviteError(code) {
  if (INVITE_ERROR_MESSAGES[code]) return INVITE_ERROR_MESSAGES[code];
  if (typeof code === 'string' && code.startsWith('SMS_')) {
    const message = describeSmsError(code);
    return message === code ? '请求失败，请稍后重试' : message;
  }
  if (typeof code === 'string' && code.startsWith('EMAIL_')) {
    const message = describeEmailError(code);
    return message === code ? '请求失败，请稍后重试' : message;
  }
  return '请求失败，请稍后重试';
}

/**
 * @description 从后端响应中提取首个错误码
 * @keyword-cn 提取错误码, 接口错误
 * @keyword-en extract-error-code, api-error
 * @param {unknown} data 后端响应体。
 * @param {number} status HTTP 状态码。
 * @returns {string} 错误码或状态提示。
 */
function extractErrorCode(data, status) {
  const message = data && typeof data === 'object' ? data.message : '';
  if (Array.isArray(message)) return String(message[0] || '');
  return typeof message === 'string' && message
    ? message
    : `请求失败(${status})`;
}

/**
 * @description 解析 JSON 响应，非 JSON 响应按空对象处理
 * @keyword-cn 解析接口响应, 容错处理
 * @keyword-en parse-api-response, fault-tolerance
 * @param {Response} response Fetch 响应。
 * @returns {Promise<Record<string, unknown>>} 响应对象。
 */
async function parseResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * @description 发起无需登录令牌的租户邀请公开请求
 * @keyword-cn 邀请公开请求, 无令牌请求
 * @keyword-en invite-public-request, tokenless-request
 * @param {string} path 接口路径。
 * @param {RequestInit} [options] Fetch 配置。
 * @returns {Promise<Record<string, unknown>>} 后端响应。
 */
async function requestPublic(path, options = {}) {
  const response = await fetch(`${resolveSmsApiBase()}${path}`, options);
  const data = await parseResponse(response);
  if (!response.ok) {
    const code = extractErrorCode(data, response.status);
    const error = new Error(describeInviteError(code));
    error.code = code;
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * @description 获取邀请码对应的团队与有效期预览
 * @keyword-cn 邀请预览, 公开接口
 * @keyword-en invite-preview, public-api
 * @param {string} code 邀请码。
 * @returns {Promise<{invite: {tenantId: string, tenantName: string, expiresAt: string, valid: boolean, reason?: string}}>} 邀请预览。
 */
export function getInvite(code) {
  return requestPublic(`/api/tenant-join/invites/${encodeURIComponent(code)}`);
}

/**
 * @description 注册新账号并通过邀请码直接加入团队
 * @keyword-cn 邀请注册, 短信验证
 * @keyword-en invite-registration, sms-verification
 * @param {{inviteCode: string, password: string, email: string, emailCode: string, displayName?: string, smsPhone: string, smsCode: string}} payload 注册请求体。
 * @returns {Promise<Record<string, unknown>>} 注册与加入结果。
 */
export function registerWithInvite(payload) {
  return requestPublic('/api/tenant-join/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * @description 使用已有手机号账号接受团队邀请
 * @keyword-cn 已有账号加入, 邀请接受
 * @keyword-en existing-account-join, invite-acceptance
 * @param {string} code 邀请码。
 * @param {{account: string, password: string}} credentials 登录凭据。
 * @returns {Promise<Record<string, unknown>>} 加入结果。
 */
export function acceptInvite(code, credentials) {
  return requestPublic(
    `/api/tenant-join/invites/${encodeURIComponent(code)}/accept`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    },
  );
}
