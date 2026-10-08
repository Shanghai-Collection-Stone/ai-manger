import React, { useEffect, useState } from 'react';
import { adminApi } from './adminApi';

/**
 * @description 短信配置表单初始值，包含短信专用 AccessKey 与 Dysms / Dypns 两套独立字段
 * @keyword-cn 短信配置表单初值
 * @keyword-en empty-sms-setting-form
 */
const EMPTY_SMS_FORM = {
  provider: 'aliyun_dysms',
  enabled: false,
  accessKeyId: '',
  accessKeySecret: '',
  signName: '',
  templateCode: '',
  templateParamName: 'code',
  dypnsSignName: '',
  dypnsTemplateCode: '',
  dypnsTemplateParam: '{"code":"##code##","min":"5"}',
  dypnsSchemeName: '',
};

/**
 * @description 「阿里云配置」Tab 里的短信验证码区块：维护短信专用 AccessKey（可与 OSS 不是同一个阿里云账号），
 *   选择 Dysms 或 Dypns 接口并维护各自签名与模板（仅超管）。
 * @keyword-cn 短信配置面板, 短信接口类型
 * @keyword-en sms-setting-panel, sms-provider
 * @param {{ onNotice: (text: string) => void, onError: (text: string) => void }} props
 */
export default function SmsSettingPanel({ onNotice, onError }) {
  const [setting, setSetting] = useState(null);
  const [form, setForm] = useState(EMPTY_SMS_FORM);
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState('');

  /**
   * @description 用接口视图回填 AccessKey 与两套服务商配置，Secret 输入框始终留空
   * @keyword-cn 回填短信配置
   * @keyword-en apply-sms-setting
   * @param {object | null} next 配置视图。
   */
  const applySetting = (next) => {
    setSetting(next);
    setForm({
      provider: next?.provider || 'aliyun_dysms',
      enabled: Boolean(next?.enabled),
      accessKeyId: next?.accessKeyId || '',
      accessKeySecret: '',
      signName: next?.signName || '',
      templateCode: next?.templateCode || '',
      templateParamName: next?.templateParamName || 'code',
      dypnsSignName: next?.dypnsSignName || '',
      dypnsTemplateCode: next?.dypnsTemplateCode || '',
      dypnsTemplateParam:
        next?.dypnsTemplateParam || '{"code":"##code##","min":"5"}',
      dypnsSchemeName: next?.dypnsSchemeName || '',
    });
  };

  useEffect(() => {
    adminApi
      .getSmsSettings()
      .then((res) => applySetting(res.setting))
      .catch((err) => onError?.(err.message));
  }, []);

  /**
   * @description 统一包装异步动作：置忙、失败上抛、成功提示
   * @keyword-cn 异步动作包装
   * @keyword-en async-action-wrapper
   * @param {string} key 忙碌标识。
   * @param {() => Promise<void>} fn 动作。
   */
  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy('');
    }
  };

  /**
   * @description 保存接口类型、启用开关、短信专用 AccessKey、签名与模板；Secret 留空不改动已保存值
   * @keyword-cn 保存短信配置
   * @keyword-en submit-sms-setting
   */
  const onSave = () =>
    run('save', async () => {
      const payload = { ...form, accessKeyId: form.accessKeyId.trim() };
      if (form.accessKeySecret.trim()) payload.accessKeySecret = form.accessKeySecret.trim();
      else delete payload.accessKeySecret;
      const res = await adminApi.saveSmsSettings(payload);
      applySetting(res.setting);
      onNotice?.('短信验证码配置已保存');
    });

  /**
   * @description 清空已保存的短信 AccessKey Secret（只影响短信，OSS 用自己的密钥）
   * @keyword-cn 清空短信密钥
   * @keyword-en clear-sms-secret
   */
  const onClearSecret = () => {
    if (!window.confirm('清空后短信验证码将无法发送，确定清空？')) return;
    run('clear', async () => {
      const res = await adminApi.saveSmsSettings({ accessKeySecret: '' });
      applySetting(res.setting);
      onNotice?.('短信 AccessKey Secret 已清空');
    });
  };

  /**
   * @description 用已保存配置向测试手机号真实发送一条验证码
   * @keyword-cn 测试发送短信
   * @keyword-en test-send-sms
   */
  const onTest = () =>
    run('test', async () => {
      setTestResult(null);
      setTestResult(await adminApi.testSmsSettings(testPhone.trim()));
    });

  /**
   * @description 更新单个表单字段
   * @keyword-cn 更新表单字段
   * @keyword-en update-form-field
   * @param {string} key 字段名。
   * @param {unknown} value 字段值。
   */
  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const providerFields =
    form.provider === 'aliyun_dypns'
      ? [
          {
            key: 'dypnsSignName',
            label: '赠送签名',
            placeholder: '「签名配置」页签里的签名名称，如 速通互联验证码（不是模板名称）',
          },
          {
            key: 'dypnsTemplateCode',
            label: '赠送模板编码',
            placeholder: '「模板配置」页签里的模板 CODE，如 100001',
          },
          {
            key: 'dypnsSchemeName',
            label: '方案名称（可选）',
            placeholder: 'SchemeName，不使用可留空',
          },
        ]
      : [
          {
            key: 'signName',
            label: '短信签名',
            placeholder: '在阿里云短信控制台审核通过的签名',
          },
          { key: 'templateCode', label: '模板编码', placeholder: 'SMS_123456789' },
          {
            key: 'templateParamName',
            label: '模板变量名',
            placeholder: 'code（模板中 ${code} 的变量名）',
          },
        ];
  const selectedReady = setting?.provider === form.provider && setting?.ready;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">短信验证码</h2>
          <p className="text-xs text-slate-500 mt-1">
            用于注册等接口的手机号验证码。状态：
            {selectedReady ? (
              <span className="text-emerald-600">已就绪</span>
            ) : (
              <span className="text-amber-600">未就绪（需填写完整并启用）</span>
            )}
            {setting && !(setting.accessKeyId && setting.hasAccessKeySecret) ? (
              <span className="ml-2 text-red-600">缺少短信 AccessKey</span>
            ) : null}
            {setting?.mockMode ? (
              <span className="ml-2 text-violet-600">当前为模拟发送模式，验证码仅打印在服务端日志</span>
            ) : null}
          </p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">接口类型</legend>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="sms-provider"
              value="aliyun_dysms"
              checked={form.provider === 'aliyun_dysms'}
              onChange={(e) => setField('provider', e.target.value)}
            />
            <span>阿里云短信服务（Dysms · 需自有签名与模板）</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="sms-provider"
              value="aliyun_dypns"
              checked={form.provider === 'aliyun_dypns'}
              onChange={(e) => setField('provider', e.target.value)}
            />
            <span>阿里云号码认证 · 短信认证（Dypns · 可用系统赠送签名与模板）</span>
          </label>
        </fieldset>
        <div className="rounded bg-slate-50 p-3 text-xs text-slate-600">
          {form.provider === 'aliyun_dypns' ? (
            <>
              在号码认证控制台「短信认证参数配置」页：签名名称看「签名配置」页签，模板 CODE 看「模板配置」页签（「登录/注册模板」是模板名称，不是签名），赠送签名与赠送模板须配套使用；模板参数 JSON
              中验证码位置写 <code>##code##</code>。AccessKey 所属 RAM 用户需授予{' '}
              <code>AliyunDypnsFullAccess</code>。{' '}
              <a
                className="text-blue-600 hover:underline"
                href="https://dypns.console.aliyun.com/smsServiceOverview"
                target="_blank"
                rel="noreferrer"
              >
                打开号码认证控制台
              </a>
            </>
          ) : (
            <>
              请先在短信服务控制台申请并审核通过签名和验证码模板。AccessKey 所属 RAM 用户需授予{' '}
              <code>AliyunDysmsFullAccess</code>。{' '}
              <a
                className="text-blue-600 hover:underline"
                href="https://dysms.console.aliyun.com/"
                target="_blank"
                rel="noreferrer"
              >
                打开短信服务控制台
              </a>
            </>
          )}
        </div>
        <label className="block text-sm text-slate-800">
          AccessKey ID
          <input
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            placeholder="LTAI...（短信专用，可与 OSS 不同账号）"
            value={form.accessKeyId}
            onChange={(e) => setField('accessKeyId', e.target.value)}
          />
        </label>
        <label className="block text-sm text-slate-800">
          AccessKey Secret
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            placeholder={
              setting?.hasAccessKeySecret
                ? `已保存 ${setting.accessKeySecretMasked}，留空不修改`
                : '请输入短信用的 AccessKey Secret'
            }
            value={form.accessKeySecret}
            onChange={(e) => setField('accessKeySecret', e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setField('enabled', e.target.checked)}
          />
          启用短信验证码
        </label>
        {providerFields.map((field) => (
          <label key={field.key} className="block text-sm text-slate-800">
            {field.label}
            <input
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
              placeholder={field.placeholder}
              value={form[field.key]}
              onChange={(e) => setField(field.key, e.target.value)}
            />
          </label>
        ))}
        {form.provider === 'aliyun_dypns' ? (
          <label className="block text-sm text-slate-800">
            模板参数 JSON
            <textarea
              rows={3}
              className="mt-1 w-full border rounded px-3 py-2 text-sm font-mono"
              placeholder={'{"code":"##code##","min":"5"}'}
              value={form.dypnsTemplateParam}
              onChange={(e) => setField('dypnsTemplateParam', e.target.value)}
            />
          </label>
        ) : null}
        <div className="flex gap-2">
          <button
            disabled={Boolean(busy)}
            onClick={onSave}
            className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300"
          >
            {busy === 'save' ? '保存中…' : '保存短信配置'}
          </button>
          {setting?.hasAccessKeySecret ? (
            <button
              disabled={Boolean(busy)}
              onClick={onClearSecret}
              className="px-4 py-2 border border-red-200 text-red-600 text-sm rounded"
            >
              清空 Secret
            </button>
          ) : null}
        </div>
        {setting?.updatedAt ? (
          <div className="text-xs text-slate-400">
            上次更新：{new Date(setting.updatedAt).toLocaleString()}
          </div>
        ) : null}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">测试发送</h2>
          <p className="text-xs text-slate-500 mt-1">
            使用已保存的配置（忽略启用开关）向该手机号真实发送一条验证码，会产生短信费用。
          </p>
        </div>
        <input
          type="tel"
          maxLength={11}
          className="w-full border rounded px-3 py-2 text-sm"
          placeholder="接收测试短信的手机号"
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value.replace(/\D/g, ''))}
        />
        <button
          disabled={Boolean(busy) || testPhone.length !== 11}
          onClick={onTest}
          className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300"
        >
          {busy === 'test' ? '发送中…' : '发送测试短信'}
        </button>
        {testResult ? (
          <div
            className={`text-xs rounded p-2 ${
              testResult.ok
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {testResult.ok
              ? `发送成功，回执 ID：${testResult.bizId || '-'}`
              : `发送失败：${testResult.code} ${testResult.message || ''}`}
          </div>
        ) : null}
      </div>
    </div>
  );
}
