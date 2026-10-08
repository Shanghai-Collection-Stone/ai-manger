import React, { useEffect, useState } from 'react';
import SmsCodeInput, {
  isSmsValueComplete,
  SMS_PHONE_PATTERN,
} from '../SmsVerification/SmsCodeInput.jsx';
import EmailCodeInput, {
  isEmailValueComplete,
} from '../EmailVerification/EmailCodeInput.jsx';
import {
  acceptInvite,
  describeInviteError,
  getInvite,
  registerWithInvite,
} from './tenantInviteApi.js';

/**
 * @description 邀请码允许的字符与长度格式
 * @keyword-cn 邀请码格式
 * @keyword-en invite-code-pattern
 */
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * @description 从当前页面查询参数读取邀请码
 * @keyword-cn 读取邀请码, 查询参数
 * @keyword-en read-invite-code, query-parameter
 * @returns {string} 邀请码。
 */
function readInviteCode() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('code')?.trim() || '';
}

/**
 * @description 把邀请有效期格式化为本地年月日时分
 * @keyword-cn 格式化有效期, 本地时间
 * @keyword-en format-expiry, local-time
 * @param {string} value ISO 时间字符串。
 * @returns {string} 格式化时间。
 */
function formatExpiresAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = {};
  for (const part of parts) values[part.type] = part.value;
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

/**
 * @description 邀请入驻网页应用，承载预览、注册和已有账号加入流程
 * @keyword-cn 邀请入驻页面, 团队加入
 * @keyword-en tenant-invite-app, team-join
 * @returns {JSX.Element} 邀请入驻界面。
 */
export default function InviteApp() {
  const [code] = useState(readInviteCode);
  const [pageState, setPageState] = useState(
    INVITE_CODE_PATTERN.test(code) ? 'loading' : 'invalid',
  );
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('register');
  const [smsValue, setSmsValue] = useState({ smsPhone: '', smsCode: '' });
  const [emailValue, setEmailValue] = useState({ email: '', emailCode: '' });
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [account, setAccount] = useState('');
  const [existingPassword, setExistingPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState(null);

  /**
   * @description 请求并应用当前邀请码的预览状态
   * @keyword-cn 加载邀请预览, 邀请状态
   * @keyword-en load-invite-preview, invite-state
   * @returns {Promise<void>}
   */
  async function requestInvitePreview() {
    try {
      const data = await getInvite(code);
      setInvite(data.invite);
      setPageState(data.invite?.valid ? 'ready' : 'unavailable');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '邀请信息加载失败');
      setPageState(error?.code === 'INVITE_NOT_FOUND' ? 'unavailable' : 'error');
    }
  }

  /**
   * @description React 挂载时启动邀请预览加载
   * @keyword-cn 初始化邀请页, 加载预览
   * @keyword-en initialize-invite-page, preview-loading
   */
  function loadInvitePreview() {
    if (INVITE_CODE_PATTERN.test(code)) void requestInvitePreview();
  }

  useEffect(loadInvitePreview, [code]);

  /**
   * @description 使用自定义协议唤起 AI 营销官客户端
   * @keyword-cn 唤起客户端, 自定义协议
   * @keyword-en open-desktop-client, custom-protocol
   * @param {boolean} includeCode 是否携带邀请码。
   */
  function openClient(includeCode) {
    window.location.href = includeCode
      ? `ai-marketing://invite?code=${encodeURIComponent(code)}`
      : 'ai-marketing://open';
  }

  /**
   * @description 携带邀请码唤起客户端邀请流程
   * @keyword-cn 打开客户端邀请, 携带邀请码
   * @keyword-en open-client-invite, include-invite-code
   */
  function openInviteClient() {
    openClient(true);
  }

  /**
   * @description 加入成功后唤起客户端首页
   * @keyword-cn 打开客户端首页, 加入后启动
   * @keyword-en open-client-home, post-join-launch
   */
  function openClientHome() {
    openClient(false);
  }

  /**
   * @description 切换注册与已有账号加入页签
   * @keyword-cn 切换加入方式, 页签切换
   * @keyword-en switch-join-method, tab-switch
   * @param {string} tab 目标页签。
   */
  function switchTab(tab) {
    setActiveTab(tab);
    setFormError('');
  }

  /**
   * @description 切换到新账号注册页签
   * @keyword-cn 切换注册页签
   * @keyword-en switch-registration-tab
   */
  function switchToRegister() {
    switchTab('register');
  }

  /**
   * @description 切换到已有账号加入页签
   * @keyword-cn 切换已有账号页签
   * @keyword-en switch-existing-account-tab
   */
  function switchToExisting() {
    switchTab('existing');
  }

  /**
   * @description 校验注册表单并返回首个错误提示
   * @keyword-cn 注册表单校验, 输入校验
   * @keyword-en validate-registration-form, input-validation
   * @returns {string} 错误提示，无错误时为空字符串。
   */
  function validateRegistration() {
    if (!isSmsValueComplete(smsValue)) return '请填写正确的手机号和 6 位验证码';
    if (!isEmailValueComplete(emailValue)) return '请填写正确的邮箱和 6 位邮箱验证码';
    if (displayName.trim() && displayName.trim().length < 2) return '昵称至少 2 个字符';
    if (displayName.trim().length > 60) return '昵称不能超过 60 个字符';
    if (password.length < 6 || password.length > 120) return '密码长度须为 6–120 个字符';
    if (password !== confirmPassword) return '两次输入的密码不一致';
    return '';
  }

  /**
   * @description 提交新账号注册并加入受邀团队
   * @keyword-cn 提交邀请注册, 新账号加入
   * @keyword-en submit-invite-registration, new-account-join
   * @param {React.FormEvent<HTMLFormElement>} event 表单事件。
   * @returns {Promise<void>}
   */
  async function submitRegistration(event) {
    event.preventDefault();
    const validationError = validateRegistration();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const data = await registerWithInvite({
        inviteCode: code,
        password,
        email: emailValue.email.trim(),
        emailCode: emailValue.emailCode,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...smsValue,
      });
      setSuccess({
        alreadyMember: false,
        tenantName: data.tenantName || invite.tenantName,
      });
    } catch (error) {
      setFormError(describeInviteError(error?.code));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * @description 提交已有账号凭据并加入受邀团队
   * @keyword-cn 提交已有账号, 凭据加入
   * @keyword-en submit-existing-account, credential-join
   * @param {React.FormEvent<HTMLFormElement>} event 表单事件。
   * @returns {Promise<void>}
   */
  async function submitAcceptance(event) {
    event.preventDefault();
    if (!SMS_PHONE_PATTERN.test(account)) {
      setFormError('请输入正确的手机号');
      return;
    }
    if (!existingPassword) {
      setFormError('请输入密码');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const data = await acceptInvite(code, {
        account,
        password: existingPassword,
      });
      setSuccess({
        alreadyMember: Boolean(data.alreadyMember),
        tenantName: data.tenantName || invite.tenantName,
      });
    } catch (error) {
      setFormError(describeInviteError(error?.code));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * @description 更新短信验证码受控值
   * @keyword-cn 更新短信值, 受控输入
   * @keyword-en update-sms-value, controlled-input
   * @param {{smsPhone: string, smsCode: string}} value 短信组件值。
   */
  function changeSmsValue(value) {
    setSmsValue(value);
  }

  /**
   * @description 更新邮箱与邮箱验证码受控值
   * @keyword-cn 更新邮箱, 表单输入
   * @keyword-en update-email, form-input
   * @param {{email: string, emailCode: string}} value 邮箱验证码组件值。
   */
  function changeEmailValue(value) {
    setEmailValue(value);
  }

  /**
   * @description 更新昵称输入值
   * @keyword-cn 更新昵称, 表单输入
   * @keyword-en update-display-name, form-input
   * @param {React.ChangeEvent<HTMLInputElement>} event 输入事件。
   */
  function changeDisplayName(event) {
    setDisplayName(event.target.value);
  }

  /**
   * @description 更新新账号密码
   * @keyword-cn 更新注册密码, 表单输入
   * @keyword-en update-registration-password, form-input
   * @param {React.ChangeEvent<HTMLInputElement>} event 输入事件。
   */
  function changePassword(event) {
    setPassword(event.target.value);
  }

  /**
   * @description 更新确认密码
   * @keyword-cn 更新确认密码, 表单输入
   * @keyword-en update-confirm-password, form-input
   * @param {React.ChangeEvent<HTMLInputElement>} event 输入事件。
   */
  function changeConfirmPassword(event) {
    setConfirmPassword(event.target.value);
  }

  /**
   * @description 更新已有账号手机号
   * @keyword-cn 更新账号手机号, 表单输入
   * @keyword-en update-account-phone, form-input
   * @param {React.ChangeEvent<HTMLInputElement>} event 输入事件。
   */
  function changeAccount(event) {
    setAccount(event.target.value.replace(/\D/g, ''));
  }

  /**
   * @description 更新已有账号密码
   * @keyword-cn 更新账号密码, 表单输入
   * @keyword-en update-account-password, form-input
   * @param {React.ChangeEvent<HTMLInputElement>} event 输入事件。
   */
  function changeExistingPassword(event) {
    setExistingPassword(event.target.value);
  }

  if (pageState === 'invalid') {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">邀请链接无效</h1>
          <p className="mt-2 text-sm text-slate-500">请检查链接是否完整，或联系团队管理员重新获取。</p>
        </section>
      </main>
    );
  }

  if (pageState === 'loading') {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-sm text-slate-500">正在加载邀请信息…</div>
      </main>
    );
  }

  if (pageState === 'unavailable' || pageState === 'error') {
    const reason = invite?.reason;
    const statusText =
      reason === 'INVITE_EXPIRED'
        ? '该邀请链接已过期'
        : reason === 'INVITE_REVOKED'
          ? '该邀请链接已被撤销'
          : pageState === 'error'
            ? loadError
            : '该邀请链接已失效';
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">{statusText}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {invite?.tenantName
              ? `该邀请链接已失效，请联系「${invite.tenantName}」的管理员重新获取链接`
              : '该邀请链接已失效，请联系管理员重新获取链接'}
          </p>
        </section>
      </main>
    );
  }

  if (success) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <section className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            {success.alreadyMember
              ? `你已经是「${success.tenantName}」的成员`
              : `已加入「${success.tenantName}」`}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            打开 AI 营销官客户端，使用手机号登录并选择「{success.tenantName}」即可开始使用
          </p>
          <button
            type="button"
            onClick={openClientHome}
            className="mt-6 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white"
          >
            在客户端中打开
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <section className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="bg-slate-900 px-5 py-7 text-white sm:px-7">
          <p className="text-xs font-medium tracking-widest text-sky-300">AI 营销官</p>
          <h1 className="mt-2 text-2xl font-bold leading-9">「{invite.tenantName}」邀请你加入 AI 营销官</h1>
          <p className="mt-2 text-sm text-slate-300">有效期至 {formatExpiresAt(invite.expiresAt)}</p>
          <button
            type="button"
            onClick={openInviteClient}
            className="mt-5 w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-white hover:bg-sky-400"
          >
            在客户端中打开
          </button>
          <p className="mt-3 text-xs leading-5 text-slate-300">
            未安装客户端或无法唤起？可直接在下方完成注册，之后在客户端用手机号登录即可。
          </p>
        </header>

        <div className="p-5 sm:p-7">
          <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={switchToRegister}
              className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              注册新账号
            </button>
            <button
              type="button"
              onClick={switchToExisting}
              className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === 'existing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              已有账号加入
            </button>
          </div>

          {formError ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600">{formError}</div>
          ) : null}

          {activeTab === 'register' ? (
            <form onSubmit={submitRegistration} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">手机号与验证码</label>
                <SmsCodeInput
                  scene="register"
                  value={smsValue}
                  onChange={changeSmsValue}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">邮箱与验证码</label>
                <EmailCodeInput
                  scene="register"
                  value={emailValue}
                  onChange={changeEmailValue}
                  disabled={submitting}
                  placeholder="用于接收注册与入驻通知"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">昵称（可选）</label>
                <input value={displayName} onChange={changeDisplayName} disabled={submitting} maxLength={60} placeholder="2–60 个字符" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">密码</label>
                <input type="password" required minLength={6} maxLength={120} autoComplete="new-password" value={password} onChange={changePassword} disabled={submitting} placeholder="6–120 个字符" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">确认密码</label>
                <input type="password" required minLength={6} maxLength={120} autoComplete="new-password" value={confirmPassword} onChange={changeConfirmPassword} disabled={submitting} placeholder="再次输入密码" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <button type="submit" disabled={submitting} className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {submitting ? '提交中…' : '注册并加入团队'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitAcceptance} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">手机号</label>
                <input type="tel" inputMode="numeric" required maxLength={11} autoComplete="tel" value={account} onChange={changeAccount} disabled={submitting} placeholder="请输入已注册手机号" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">密码</label>
                <input type="password" required autoComplete="current-password" value={existingPassword} onChange={changeExistingPassword} disabled={submitting} placeholder="请输入密码" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <button type="submit" disabled={submitting} className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {submitting ? '提交中…' : '加入团队'}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
