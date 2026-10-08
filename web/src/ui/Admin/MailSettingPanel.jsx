import React, { useEffect, useState } from 'react';
import { adminApi } from './adminApi';

/**
 * @description SMTP 发信配置表单初始值，与后端保存请求字段逐字对应
 * @keyword-cn 发信配置初值
 * @keyword-en empty-mail-setting-form
 */
const EMPTY_MAIL_FORM = {
  enabled: false,
  host: '',
  port: 465,
  secure: true,
  username: '',
  password: '',
  fromAddress: '',
  fromName: '',
};

/**
 * @description 后台「发信邮箱」面板，维护 SMTP 配置并向指定邮箱真实测试发信
 * @keyword-cn 发信邮箱面板, SMTP配置
 * @keyword-en mail-setting-panel, smtp-settings
 */
export default function MailSettingPanel({ onNotice, onError }) {
  const [setting, setSetting] = useState(null);
  const [form, setForm] = useState(EMPTY_MAIL_FORM);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState('');

  /**
   * @description 用接口视图回填 SMTP 表单，密码输入框始终留空
   * @keyword-cn 回填发信配置
   * @keyword-en apply-mail-setting
   */
  const applySetting = (next) => {
    setSetting(next);
    setForm({
      enabled: Boolean(next?.enabled),
      host: next?.host || '',
      port: next?.port || 465,
      secure: next?.secure !== false,
      username: next?.username || '',
      password: '',
      fromAddress: next?.fromAddress || '',
      fromName: next?.fromName || '',
    });
  };

  useEffect(() => {
    adminApi
      .getMailSettings()
      .then((res) => applySetting(res.setting))
      .catch((err) => onError?.(err.message));
  }, []);

  /**
   * @description 统一包装发信配置异步动作并维护忙碌状态
   * @keyword-cn 发信异步动作
   * @keyword-en mail-async-action
   */
  const run = async (key, action) => {
    setBusy(key);
    try {
      await action();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy('');
    }
  };

  /**
   * @description 更新 SMTP 表单的单个字段
   * @keyword-cn 更新发信字段
   * @keyword-en update-mail-field
   */
  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  /**
   * @description 保存 SMTP 配置，密码留空时不修改已保存密码
   * @keyword-cn 保存发信配置
   * @keyword-en submit-mail-setting
   */
  const onSave = () =>
    run('save', async () => {
      const payload = { ...form, port: Number(form.port) };
      if (!payload.password) delete payload.password;
      const res = await adminApi.saveMailSettings(payload);
      applySetting(res.setting);
      onNotice?.('发信邮箱配置已保存');
    });

  /**
   * @description 显式清空已保存的 SMTP 密码
   * @keyword-cn 清空邮箱密码
   * @keyword-en clear-mail-password
   */
  const onClearPassword = () =>
    run('clear', async () => {
      const res = await adminApi.saveMailSettings({
        ...form,
        port: Number(form.port),
        password: '',
      });
      applySetting(res.setting);
      onNotice?.('SMTP 密码已清空');
    });

  /**
   * @description 使用已保存配置向指定收件邮箱真实发送测试邮件
   * @keyword-cn 测试发送邮件
   * @keyword-en send-test-mail
   */
  const onTest = () =>
    run('test', async () => {
      setTestResult(null);
      const result = await adminApi.testMailSettings(testTo.trim());
      setTestResult(result);
      onNotice?.('测试邮件已发送');
    });

  return (
    <div className="grid lg:grid-cols-2 gap-4 pb-8">
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">发信邮箱配置</h2>
          <p className="text-xs text-slate-500 mt-1">
            用于入驻审批结果等通知邮件。状态：
            {setting?.ready ? (
              <span className="text-emerald-600">已就绪</span>
            ) : (
              <span className="text-amber-600">未就绪（需填写完整并启用）</span>
            )}
            {setting?.mockMode ? <span className="ml-2 text-violet-600">当前为模拟发信模式</span> : null}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setField('enabled', e.target.checked)} />
          启用邮件通知
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="sm:col-span-2 text-sm text-slate-800">
            SMTP 服务器
            <input className="mt-1 w-full border rounded px-3 py-2 text-sm" value={form.host} onChange={(e) => setField('host', e.target.value)} placeholder="smtp.example.com" />
          </label>
          <label className="text-sm text-slate-800">
            端口
            <input type="number" min="1" max="65535" className="mt-1 w-full border rounded px-3 py-2 text-sm" value={form.port} onChange={(e) => setField('port', e.target.value)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={form.secure} onChange={(e) => setField('secure', e.target.checked)} />
          使用 SSL/TLS
        </label>
        <label className="block text-sm text-slate-800">
          用户名
          <input className="mt-1 w-full border rounded px-3 py-2 text-sm" value={form.username} onChange={(e) => setField('username', e.target.value)} placeholder="通常为完整邮箱地址" />
        </label>
        <label className="block text-sm text-slate-800">
          密码
          <input type="password" autoComplete="new-password" className="mt-1 w-full border rounded px-3 py-2 text-sm" value={form.password} onChange={(e) => setField('password', e.target.value)} placeholder={setting?.hasPassword ? `已保存 ${setting.passwordMasked || '******'}，留空不修改` : '请输入 SMTP 密码或授权码'} />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm text-slate-800">
            发件地址
            <input type="email" className="mt-1 w-full border rounded px-3 py-2 text-sm" value={form.fromAddress} onChange={(e) => setField('fromAddress', e.target.value)} placeholder="notice@example.com" />
          </label>
          <label className="text-sm text-slate-800">
            发件人名称
            <input className="mt-1 w-full border rounded px-3 py-2 text-sm" value={form.fromName} onChange={(e) => setField('fromName', e.target.value)} placeholder="AI 营销官" />
          </label>
        </div>
        <div className="flex gap-2">
          <button disabled={Boolean(busy)} onClick={onSave} className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300">{busy === 'save' ? '保存中…' : '保存配置'}</button>
          {setting?.hasPassword ? <button disabled={Boolean(busy)} onClick={onClearPassword} className="px-4 py-2 border border-rose-200 text-rose-600 text-sm rounded">清空密码</button> : null}
        </div>
        {setting?.updatedAt ? <div className="text-xs text-slate-400">上次更新：{new Date(setting.updatedAt).toLocaleString()}</div> : null}
      </div>

      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div>
            <h2 className="font-semibold text-slate-900">测试发信</h2>
            <p className="text-xs text-slate-500 mt-1">使用已保存配置向该邮箱真实发送测试邮件。</p>
          </div>
          <input type="email" className="w-full border rounded px-3 py-2 text-sm" placeholder="收件邮箱" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button disabled={Boolean(busy) || !testTo.trim()} onClick={onTest} className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300">{busy === 'test' ? '发送中…' : '发送测试邮件'}</button>
          {testResult?.ok ? <div className="text-xs rounded p-2 bg-emerald-50 text-emerald-700">发送成功，消息 ID：{testResult.messageId}</div> : null}
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-1">
          <h3 className="font-semibold text-slate-800 mb-2">常用配置提示</h3>
          <p>阿里云企业邮箱：smtp.qiye.aliyun.com，端口 465，开启 SSL。</p>
          <p>阿里云邮件推送：smtpdm.aliyun.com，端口 465，开启 SSL。</p>
          <p>QQ 邮箱：smtp.qq.com，端口 465，开启 SSL；密码请填写授权码。</p>
        </div>
      </div>
    </div>
  );
}
