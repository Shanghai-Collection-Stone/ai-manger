import React, { useEffect, useRef, useState } from 'react';
import { sendSmsCode } from './smsVerificationApi';

/**
 * @description 中国大陆手机号格式
 * @keyword-cn 手机号格式
 * @keyword-en mainland-phone-pattern
 */
export const SMS_PHONE_PATTERN = /^1[3-9]\d{9}$/;

/**
 * @description 判断组件值是否已填完整，可用于提交按钮置灰
 * @keyword-cn 验证码值完整性, 提交校验
 * @keyword-en sms-value-complete, submit-check
 * @param {{ smsPhone?: string, smsCode?: string }} value 组件值。
 * @returns {boolean} 手机号与 6 位验证码是否齐全。
 */
export function isSmsValueComplete(value) {
  return (
    SMS_PHONE_PATTERN.test(value?.smsPhone || '') &&
    /^\d{6}$/.test(value?.smsCode || '')
  );
}

/**
 * @description 手机号 + 短信验证码受控组件。value 形如 `{ smsPhone, smsCode }`，
 *   提交时直接展开进需要验证码接口的请求体：`{ ...form, ...smsValue }`，后端 @RequireSmsCode 自动判定。
 * @keyword-cn 验证码输入组件, 受控组件, 倒计时
 * @keyword-en sms-code-input, controlled-component, countdown
 * @param {object} props
 * @param {string} props.scene 业务场景，与后端 SMS_VERIFICATION_SCENES 一致。
 * @param {{ smsPhone: string, smsCode: string }} props.value 当前值。
 * @param {(value: { smsPhone: string, smsCode: string }) => void} props.onChange 值变化回调。
 * @param {boolean} [props.disabled] 是否禁用。
 * @param {string} [props.className] 外层样式。
 */
export default function SmsCodeInput({
  scene,
  value,
  onChange,
  disabled = false,
  className = '',
}) {
  const current = {
    smsPhone: value?.smsPhone ?? '',
    smsCode: value?.smsCode ?? '',
  };
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
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
   * @description 合并局部字段并回调父组件
   * @keyword-cn 更新组件值
   * @keyword-en update-sms-value
   * @param {Partial<{ smsPhone: string, smsCode: string }>} patch 变更字段。
   */
  const update = (patch) => onChange?.({ ...current, ...patch });

  /**
   * @description 点击获取验证码：校验手机号 → 调发送接口 → 开始倒计时，频控时按后端剩余秒数倒计时
   * @keyword-cn 获取验证码, 发送频控
   * @keyword-en request-sms-code, send-throttle
   */
  const onSend = async () => {
    if (!SMS_PHONE_PATTERN.test(current.smsPhone)) {
      setError('请输入正确的手机号');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await sendSmsCode(current.smsPhone, scene);
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
        type="tel"
        inputMode="numeric"
        maxLength={11}
        autoComplete="tel"
        disabled={disabled}
        className="w-full border rounded px-3 py-2 text-sm"
        placeholder="手机号"
        value={current.smsPhone}
        onChange={(e) => update({ smsPhone: e.target.value.replace(/\D/g, '') })}
      />
      <div className="flex gap-2">
        <input
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          disabled={disabled}
          className="flex-1 min-w-0 border rounded px-3 py-2 text-sm"
          placeholder="6 位验证码"
          value={current.smsCode}
          onChange={(e) => update({ smsCode: e.target.value.replace(/\D/g, '') })}
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
    </div>
  );
}
