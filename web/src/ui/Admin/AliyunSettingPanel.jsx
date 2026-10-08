import React, { useEffect, useState } from 'react';
import { adminApi } from './adminApi';
import SmsSettingPanel from './SmsSettingPanel';

/**
 * @description OSS 设置表单初始值，字段与后端 AliyunOssSettingDto 一一对应（Secret 单独用密码框，不回填）
 * @keyword-cn OSS表单初值
 * @keyword-en empty-oss-form
 */
const EMPTY_OSS_FORM = {
  accessKeyId: '',
  region: '',
  bucket: '',
  endpoint: '',
  publicBaseUrl: '',
  rootDir: '',
};

/**
 * @description 后端校验错误码对应的中文提示
 * @keyword-cn 阿里云配置错误码
 * @keyword-en aliyun-error-codes
 */
const ALIYUN_ERROR_TEXT = {
  ALIYUN_OSS_REGION_INVALID: '地域格式不对，应类似 cn-shanghai 或 oss-cn-shanghai',
  ALIYUN_OSS_BUCKET_INVALID: 'Bucket 名称只能是小写字母、数字和短横线，3-63 位',
  ALIYUN_OSS_PUBLIC_BASE_URL_INVALID: '访问域名必须以 http:// 或 https:// 开头',
  ALIYUN_OSS_ROOT_DIR_INVALID: '根目录只能包含字母、数字、点、下划线、短横线和斜杠',
  OSS_NOT_CONFIGURED: 'OSS 还没配置完整（需要 OSS AccessKey + 地域 + Bucket）',
  OSS_PROBE_UNAVAILABLE: '对象存储模块未加载，无法自检',
};

/**
 * @description 把后端返回的错误码换成中文，未知内容原样返回
 * @keyword-cn 翻译错误码
 * @keyword-en describe-aliyun-error
 * @param {string} message 后端错误信息，可能带 `oss.` 前缀或多个码用逗号拼接。
 * @returns {string} 中文提示。
 */
function describeAliyunError(message) {
  const text = String(message || '');
  const hit = Object.keys(ALIYUN_ERROR_TEXT).filter((code) => text.includes(code));
  return hit.length ? hit.map((code) => ALIYUN_ERROR_TEXT[code]).join('；') : text;
}

/**
 * @description OSS 生效来源的展示文案与颜色
 * @keyword-cn OSS来源文案
 * @keyword-en oss-source-label
 */
const OSS_SOURCE_LABEL = {
  admin: { text: '使用后台配置', className: 'text-emerald-600' },
  env: {
    text: '使用服务器环境变量 OSS_*（后台填写完整后自动切换为后台配置）',
    className: 'text-blue-600',
  },
  none: { text: '未配置，视频库上传不可用', className: 'text-amber-600' },
};

/**
 * @description OSS 表单里除 AccessKey 外的普通字段
 * @keyword-cn OSS表单字段
 * @keyword-en oss-form-fields
 */
const OSS_FIELDS = [
  { key: 'region', label: '地域', placeholder: 'cn-shanghai（自动补 oss- 前缀）' },
  { key: 'bucket', label: 'Bucket', placeholder: 'my-bucket' },
  {
    key: 'endpoint',
    label: 'Endpoint（可选）',
    placeholder: '留空按地域推导，如 oss-cn-shanghai.aliyuncs.com',
  },
  {
    key: 'publicBaseUrl',
    label: '访问域名（可选）',
    placeholder: '绑定的 CDN 域名，如 https://cdn.example.com',
  },
  { key: 'rootDir', label: '根目录（可选）', placeholder: '默认 video-library' },
];

/**
 * @description 后台「阿里云配置」Tab：对象存储 OSS（含 OSS 专用 AccessKey）与短信验证码（含短信专用 AccessKey）集中维护（仅超管）；
 *   两边可能是不同的阿里云账号，AccessKey 各填各的。
 * @keyword-cn 阿里云配置面板, OSS访问密钥, 对象存储配置
 * @keyword-en aliyun-setting-panel, oss-access-key, oss-setting
 * @param {{ onNotice: (text: string) => void, onError: (text: string) => void }} props
 */
export default function AliyunSettingPanel({ onNotice, onError }) {
  const [setting, setSetting] = useState(null);
  const [ossForm, setOssForm] = useState(EMPTY_OSS_FORM);
  const [ossSecret, setOssSecret] = useState('');
  const [probeResult, setProbeResult] = useState(null);
  const [busy, setBusy] = useState('');

  /**
   * @description 用接口视图回填 OSS 表单，Secret 输入框始终留空
   * @keyword-cn 回填阿里云配置
   * @keyword-en apply-aliyun-setting
   * @param {object | null} next 配置视图。
   */
  const applySetting = (next) => {
    setSetting(next);
    setOssSecret('');
    setOssForm({
      accessKeyId: next?.oss?.accessKeyId || '',
      region: next?.oss?.region || '',
      bucket: next?.oss?.bucket || '',
      endpoint: next?.oss?.endpoint || '',
      publicBaseUrl: next?.oss?.publicBaseUrl || '',
      rootDir: next?.oss?.rootDir || '',
    });
  };

  useEffect(() => {
    adminApi
      .getAliyunSettings()
      .then((res) => applySetting(res.setting))
      .catch((err) => onError?.(describeAliyunError(err.message)));
  }, []);

  /**
   * @description 统一包装异步动作：置忙、错误码翻译后上抛
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
      onError?.(describeAliyunError(err.message));
    } finally {
      setBusy('');
    }
  };

  /**
   * @description 保存 OSS 设置与 OSS 专用 AccessKey；空字段表示清空，Secret 留空不改动
   * @keyword-cn 保存OSS设置
   * @keyword-en submit-oss-setting
   */
  const onSaveOss = () =>
    run('oss', async () => {
      const oss = Object.fromEntries(
        Object.entries(ossForm).map(([key, value]) => [key, value.trim()]),
      );
      if (ossSecret.trim()) oss.accessKeySecret = ossSecret.trim();
      const res = await adminApi.saveAliyunSettings({ oss });
      applySetting(res.setting);
      setProbeResult(null);
      onNotice?.('OSS 配置已保存');
    });

  /**
   * @description 清空已保存的 OSS AccessKey Secret（只影响 OSS，短信用自己的密钥）
   * @keyword-cn 清空OSS密钥
   * @keyword-en clear-oss-secret
   */
  const onClearSecret = () => {
    if (!window.confirm('清空后后台 OSS 配置不可用（会回落服务器环境变量 OSS_*），确定清空？')) {
      return;
    }
    run('clear', async () => {
      const res = await adminApi.saveAliyunSettings({ oss: { accessKeySecret: '' } });
      applySetting(res.setting);
      setProbeResult(null);
      onNotice?.('OSS AccessKey Secret 已清空');
    });
  };

  /**
   * @description 用当前生效的 OSS 配置写入再删除一个探测文件，验证密钥、Bucket 与权限
   * @keyword-cn 测试OSS连通, OSS自检
   * @keyword-en test-oss-connection, oss-probe
   */
  const onTestOss = () =>
    run('probe', async () => {
      setProbeResult(null);
      setProbeResult(await adminApi.testAliyunOss());
    });

  /**
   * @description 更新单个 OSS 表单字段
   * @keyword-cn 更新OSS字段
   * @keyword-en update-oss-field
   * @param {string} key 字段名。
   * @param {string} value 字段值。
   */
  const setOssField = (key, value) => setOssForm((prev) => ({ ...prev, [key]: value }));

  const ossSource = OSS_SOURCE_LABEL[setting?.oss?.effectiveSource || 'none'];

  return (
    <div className="space-y-4 pb-8">
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div>
            <h2 className="font-semibold text-slate-900">对象存储 OSS</h2>
            <p className="text-xs text-slate-500 mt-1">
              视频库等素材直传使用，AccessKey 只给 OSS 用，与下方短信的相互独立。当前：
              <span className={ossSource.className}>{ossSource.text}</span>
            </p>
            {setting?.oss?.publicUrlPrefix ? (
              <p className="text-xs text-slate-500 mt-1 break-all">
                访问地址前缀：<code>{setting.oss.publicUrlPrefix}</code>
              </p>
            ) : null}
          </div>
          <label className="block text-sm text-slate-800">
            AccessKey ID
            <input
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
              placeholder="LTAI...（OSS 专用）"
              value={ossForm.accessKeyId}
              onChange={(e) => setOssField('accessKeyId', e.target.value)}
            />
          </label>
          <label className="block text-sm text-slate-800">
            AccessKey Secret
            <input
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
              placeholder={
                setting?.oss?.hasAccessKeySecret
                  ? `已保存 ${setting.oss.accessKeySecretMasked}，留空不修改`
                  : '请输入 OSS 用的 AccessKey Secret'
              }
              value={ossSecret}
              onChange={(e) => setOssSecret(e.target.value)}
            />
          </label>
          {OSS_FIELDS.map((field) => (
            <label key={field.key} className="block text-sm text-slate-800">
              {field.label}
              <input
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                placeholder={field.placeholder}
                value={ossForm[field.key]}
                onChange={(e) => setOssField(field.key, e.target.value)}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={Boolean(busy)}
              onClick={onSaveOss}
              className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300"
            >
              {busy === 'oss' ? '保存中…' : '保存 OSS 配置'}
            </button>
            <button
              disabled={Boolean(busy)}
              onClick={onTestOss}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-sm rounded disabled:text-slate-300"
            >
              {busy === 'probe' ? '测试中…' : '测试 OSS'}
            </button>
            {setting?.oss?.hasAccessKeySecret ? (
              <button
                disabled={Boolean(busy)}
                onClick={onClearSecret}
                className="px-4 py-2 border border-red-200 text-red-600 text-sm rounded"
              >
                清空 Secret
              </button>
            ) : null}
          </div>
          {probeResult ? (
            <div
              className={`text-xs rounded p-2 ${
                probeResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {probeResult.ok
                ? `读写正常（${OSS_SOURCE_LABEL[probeResult.source]?.text || probeResult.source}）`
                : `测试失败：${describeAliyunError(probeResult.message)}`}
            </div>
          ) : null}
          <p className="text-xs text-slate-400">测试使用已保存的配置，修改后请先保存。</p>
          {setting?.updatedAt ? (
            <div className="text-xs text-slate-400">
              上次更新：{new Date(setting.updatedAt).toLocaleString()}
            </div>
          ) : null}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs text-slate-600">
          <h2 className="font-semibold text-slate-900 text-base">OSS 设置要点</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              建议为 OSS 单独建 RAM 用户，只开 OpenAPI 调用访问，授予目标 Bucket 的{' '}
              <code>oss:PutObject</code>、<code>oss:GetObject</code>、<code>oss:DeleteObject</code>
              （自定义策略限定到该 Bucket）。
            </li>
            <li>
              跨域设置（CORS）：来源填后台与工作台域名，桌面端再加 <code>app://workbench</code>；
              方法勾选 POST、PUT、GET、HEAD；允许 Headers 填 <code>*</code>；暴露 Headers 填
              <code>ETag</code>。
            </li>
            <li>
              读写权限设为公共读，或绑定 CDN 域名后填到「访问域名」，否则视频无法直接播放。
            </li>
            <li>服务器在内网代理后面时，确认 <code>.aliyuncs.com</code> 在 NO_PROXY 里。</li>
            <li>后台未填完整时继续使用服务器环境变量 OSS_*，已有部署不受影响。</li>
          </ul>
          <p className="space-x-3">
            <a
              className="text-blue-600 hover:underline"
              href="https://oss.console.aliyun.com/bucket"
              target="_blank"
              rel="noreferrer"
            >
              打开 OSS 控制台
            </a>
            <a
              className="text-blue-600 hover:underline"
              href="https://ram.console.aliyun.com/users"
              target="_blank"
              rel="noreferrer"
            >
              打开 RAM 访问控制台
            </a>
          </p>
        </div>
      </div>

      <SmsSettingPanel onNotice={onNotice} onError={onError} />
    </div>
  );
}
