import React, { useState } from 'react';
import { adminApi, resolveAdminPageHref, setAdminToken } from './adminApi';

/**
 * @description 后台登录界面
 * @keyword-en admin login app
 * @returns {JSX.Element}
 */
const AdminLoginApp = () => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      const data = await adminApi.login(username.trim(), password);
      setAdminToken(data.token);
      window.location.href = resolveAdminPageHref('admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">后台登录</h1>
        <p className="text-sm text-slate-500 mb-6">登录后进入新版后台管理</p>
        {error ? (
          <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
            {error}
          </div>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-4">
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
