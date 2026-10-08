import React, { useEffect, useRef, useState } from 'react';
import { sendEmailCode } from './emailVerificationApi';

/**
 * @description 基础邮箱格式
 * @keyword-cn 邮箱格式
 * @keyword-en email-pattern
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @description 判断组件值是否已填完整，可用于提交前校验
 * @keyword-cn 邮箱验证码值完整性, 提交校验
 * @keyword-en email-value-complete, submit-check
 * @param {{ email?: string, emailCode?: string }} value 组件值。
 * @returns {boolean} 邮箱与 6 位验证码是否齐全。
 */
export function isEmailValueComplete(value) {
  return (
    EMAIL_PATTERN.test((value?.email || '').trim()) &&
    /^\d{6}$/.test(value?.emailCode || '')
  );
}

/**
 * @description 邮箱 + 邮箱验证码受控组件。value 形如 `{ email, emailCode }`，
 *   提交时直接展开进需要邮箱验证的请求体：`{ ...form, ...emailValue }`，后端 @RequireEmailCode 自动判定。
 * @keyword-cn 邮箱验证码输入组件, 受控组件, 倒计时
 * @keyword-en email-code-input, controlled-component, countdown
 * @param {object} props
 * @param {string} props.scene 业务场景，与后端 EMAIL_VERIFICATION_SCENES 一致。
 * @param {{ email: string, emailCode: string }} props.value 当前值。
 * @param {(value: { email: string, emailCode: string }) => void} props.onChange 值变化回调。
 * @param {boolean} [props.disabled] 是否禁用。
 * @param {string} [props.placeholder] 邮箱输入框占位文字。
 * @param {string} [props.className] 外层样式。
 */
export default function EmailCodeInput({
  scene,
  value,
  onChange,
  disabled = false,
  placeholder = '邮箱',
  className = '',
}) {
  const current = {
    email: value?.email ?? '',
    emailCode: value?.emailCode ?? '',
  };
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const timerRef = useRef(null);

  useEffect(() => () => clearInterval(timerRef.current), []);

  /**
   * @description 启动重发倒计时
   * @keyword-cn 启动倒计时, 重发间隔
   * @keyword-en start-countdown, resend-interval
   * @param {number} seconds 倒计时秒数。
   */
  const startCountdown = (seconds) => {
    clearInterval(timerRef.current);
    setCountdown(seconds);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /**
   * @description 合并局部字段并回调父组件；改邮箱时清掉已发送提示
   * @keyword-cn 更新组件值
   * @keyword-en update-email-value
   * @param {Partial<{ email: string, emailCode: string }>} patch 变更字段。
   */
  const update = (patch) => {
    if ('email' in patch) setHint('');
    onChange?.({ ...current, ...patch });
  };

  /**
   * @description 点击获取验证码：校验邮箱 → 调发送接口 → 提示查收并开始倒计时，频控时按后端剩余秒数倒计时
   * @keyword-cn 获取邮箱验证码, 发送频控
   * @keyword-en request-email-code, send-throttle
   */
  const onSend = async () => {
    const email = current.email.trim();
    if (!EMAIL_PATTERN.test(email)) {
      setError('请输入正确的邮箱地址');
      return;
    }
    setSending(true);
    setError('');
    setHint('');
    try {
      const res = await sendEmailCode(email, scene);
      setHint('验证码已发送，请查收邮件（没收到请看看垃圾邮件箱）');
      startCountdown(res?.resendAfterSeconds || 60);
    } catch (err) {
      setError(err.message);
      if (err.retryAfterSeconds) startCountdown(err.retryAfterSeconds);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <input
        type="email"
        autoComplete="email"
        disabled={disabled}
        className="w-full border rounded px-3 py-2 text-sm"
        placeholder={placeholder}
        value={current.email}
        onChange={(e) => update({ email: e.target.value })}
      />
      <div className="flex gap-2">
        <input
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          disabled={disabled}
          className="flex-1 min-w-0 border rounded px-3 py-2 text-sm"
          placeholder="6 位邮箱验证码"
          value={current.emailCode}
          onChange={(e) => update({ emailCode: e.target.value.replace(/\D/g, '') })}
        />
        <button
          type="button"
          disabled={disabled || sending || countdown > 0}
          onClick={onSend}
          className="shrink-0 px-3 py-2 text-sm rounded bg-slate-900 text-white disabled:bg-slate-300"
        >
          {sending ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
        </button>
      </div>
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      {!error && hint ? <div className="text-xs text-emerald-600">{hint}</div> : null}
    </div>
  );
}
