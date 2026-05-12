import React, { useEffect, useState } from 'react';
import {
  adminApi,
  resolveAdminPageHref,
  resolveFrontendPageHref,
  setAdminToken,
} from './adminApi';

/**
 * @description 判断是否具备后台全量权限
 * @keyword-en check admin full access
 * @param {string} role
 * @returns {boolean}
 */
const hasAdminFullAccess = (role) =>
  role === 'super_admin' || role === 'tenant_admin';

/**
 * @description 读取登录来源参数
 * @keyword-en read login redirect intent
 * @returns {{from: string, next: string}}
 */
const readLoginIntent = () => {
  if (typeof window === 'undefined') {
    return { from: '', next: '' };
  }
  const params = new URLSearchParams(window.location.search || '');
  return {
    from: (params.get('from') || '').trim(),
    next: (params.get('next') || '').trim(),
  };
};

/**
 * @description 规范化前台页面标识
 * @keyword-en normalize frontend page name
 * @param {string} value
 * @returns {string}
 */
const normalizeFrontendPageName = (value) => {
  const raw = (value || '').trim();
  if (!raw) return '';
  const noExt = raw.endsWith('.html') ? raw.slice(0, -5) : raw;
  if (!/^[a-zA-Z0-9-_]+$/.test(noExt)) return '';
  return noExt;
};

/**
 * @description 根据来源与权限计算登录后目标页
 * @keyword-en resolve post login target
 * @param {{role?: string}} user
 * @returns {string}
 */
const resolvePostLoginTarget = (user) => {
  const intent = readLoginIntent();
  const nextPage = normalizeFrontendPageName(intent.next);
  const wantsAdmin = nextPage === 'admin' || intent.from === 'admin';
  if (wantsAdmin && hasAdminFullAccess(user?.role)) {
    return resolveAdminPageHref('admin');
  }
  if (nextPage && nextPage !== 'admin') {
    return resolveFrontendPageHref(nextPage);
  }
  return resolveFrontendPageHref('ai-commander');
};

/**
 * @description 后台登录界面
 * @keyword-en admin login app
 * @returns {JSX.Element}
 */
const AdminLoginApp = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantOptions, setTenantOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /**
   * @description 加载登录租户选项
   * @keyword-en load login tenant options
   * @returns {Promise<void>}
   */
  const loadTenantOptions = async () => {
    try {
      const data = await adminApi.listLoginTenants();
      setTenantOptions(Array.isArray(data?.tenants) ? data.tenants : []);
    } catch {
      setTenantOptions([]);
    }
  };

  useEffect(() => {
    void loadTenantOptions();
  }, []);

  /**
   * @description 提交登录
   * @keyword-en submit login
   * @param {React.FormEvent<HTMLFormElement>} event
   * @returns {Promise<void>}
   */
  const onSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.login(username.trim(), password, tenantId);
      setAdminToken(data.token);
      const me = await adminApi.me();
      window.location.href = resolvePostLoginTarget(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        {/* 登录头部区域 | @keyword-en login header section */}
        <h1 className="text-2xl font-bold text-slate-900 mb-2">后台登录</h1>
        <p className="text-sm text-slate-500 mb-6">登录后进入新版后台管理</p>
        {error ? (
          <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
            {error}
          </div>
        ) : null}
        {/* 登录表单区域 | @keyword-en login form section */}
        <form onSubmit={onSubmit} className="space-y-4">
          {/* 租户选择区域 | @keyword-en tenant select section */}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">
              租户
            </label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            >
              <option value="">平台端用户（无租户）</option>
              {tenantOptions.map((tenant) => (
                <option key={String(tenant._id)} value={String(tenant._id)}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">
              用户名
            </label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">
              密码
            </label>
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 text-white text-sm py-2.5 disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminLoginApp;
