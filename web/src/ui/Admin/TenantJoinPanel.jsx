import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, buildTenantInviteUrl } from './adminApi';

/**
 * @description 入驻申请列表每页条数
 * @keyword-cn 入驻分页大小
 * @keyword-en tenant-join-page-size
 */
const PAGE_SIZE = 20;

/**
 * @description 入驻申请状态筛选选项
 * @keyword-cn 入驻状态选项
 * @keyword-en join-status-options
 */
const STATUS_OPTIONS = [
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部' },
];

/**
 * @description 邀请链接可选有效期天数
 * @keyword-cn 邀请有效期选项
 * @keyword-en invite-duration-options
 */
const INVITE_DAYS = [1, 3, 7, 14, 30];

/**
 * @description 格式化入驻模块时间，空值显示占位符
 * @keyword-cn 入驻时间格式化
 * @keyword-en tenant-join-time
 */
const formatTime = (value) => (value ? new Date(value).toLocaleString() : '—');

/**
 * @description 计算有效邀请链接距离过期的剩余天数与小时数
 * @keyword-cn 邀请剩余时间
 * @keyword-en invite-time-remaining
 */
const formatRemaining = (expiresAt) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return '即将过期';
  const hours = Math.ceil(ms / 3600000);
  return `剩 ${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
};

/**
 * @description 优先使用 Clipboard API 复制，失败时选中页面中的链接输入框供手动复制
 * @keyword-cn 复制邀请链接, 选中文本
 * @keyword-en copy-invite-link, select-text-fallback
 */
const copyTextWithFallback = async (text, inputId) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const input = document.getElementById(inputId);
    input?.focus();
    input?.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
};

/**
 * @description 入驻审批与邀请链接面板，按管理员角色限制租户过滤和邀请归属
 * @keyword-cn 入驻审批面板, 邀请链接管理
 * @keyword-en tenant-join-panel, invite-link-management
 */
export default function TenantJoinPanel({ currentRole, tenants, onNotice, onError }) {
  const superAdmin = currentRole === 'super_admin';
  const [applicationFilter, setApplicationFilter] = useState({ status: 'pending', tenantId: '', page: 1 });
  const [applications, setApplications] = useState([]);
  const [applicationMeta, setApplicationMeta] = useState({ total: 0, pendingCount: 0, pageSize: PAGE_SIZE });
  const [invites, setInvites] = useState([]);
  const [inviteTenantId, setInviteTenantId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [rejectDialog, setRejectDialog] = useState({ open: false, id: '', reason: '' });
  const [busy, setBusy] = useState('');

  /**
   * @description 统一包装入驻审批异步动作并向顶层上报错误
   * @keyword-cn 入驻异步动作
   * @keyword-en tenant-join-action
   */
  const run = useCallback(async (key, action, successText) => {
    setBusy(key);
    try {
      await action();
      if (successText) onNotice?.(successText);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy('');
    }
  }, [onError, onNotice]);

  /**
   * @description 按状态、租户与页码加载入驻申请
   * @keyword-cn 加载入驻申请
   * @keyword-en load-join-applications
   */
  const loadApplications = useCallback(async (next = applicationFilter) => {
    const res = await adminApi.listTenantJoinApplications({ ...next, pageSize: PAGE_SIZE });
    setApplications(res.items || []);
    setApplicationMeta({ total: res.total || 0, pendingCount: res.pendingCount || 0, pageSize: res.pageSize || PAGE_SIZE });
  }, [applicationFilter]);

  /**
   * @description 加载当前管理范围或所选租户的邀请链接
   * @keyword-cn 加载邀请链接
   * @keyword-en load-tenant-invites
   */
  const loadInvites = useCallback(async (tenantId = inviteTenantId) => {
    const res = await adminApi.listTenantInvites({ tenantId: superAdmin ? tenantId : undefined });
    setInvites(res.items || []);
  }, [inviteTenantId, superAdmin]);

  useEffect(() => {
    loadApplications().catch((err) => onError?.(err.message));
    loadInvites().catch((err) => onError?.(err.message));
  }, []);

  /**
   * @description 二次确认后通过申请并刷新申请列表
   * @keyword-cn 通过入驻申请
   * @keyword-en approve-join-application
   */
  const onApprove = (row) => {
    if (!window.confirm(`确认通过 ${row.displayName || row.phone} 的入驻申请？`)) return;
    run(`approve-${row.id}`, async () => {
      await adminApi.approveTenantJoinApplication(row.id);
      await loadApplications();
    }, '入驻申请已通过');
  };

  /**
   * @description 提交可选拒绝原因并刷新申请列表
   * @keyword-cn 拒绝入驻申请
   * @keyword-en reject-join-application
   */
  const onReject = () => run(`reject-${rejectDialog.id}`, async () => {
    await adminApi.rejectTenantJoinApplication(rejectDialog.id, rejectDialog.reason.trim());
    setRejectDialog({ open: false, id: '', reason: '' });
    await loadApplications();
  }, '入驻申请已拒绝');

  /**
   * @description 为当前租户生成指定有效期的邀请链接
   * @keyword-cn 生成邀请链接
   * @keyword-en generate-invite-link
   */
  const onCreateInvite = () => {
    if (superAdmin && !inviteTenantId) {
      onError?.('请先选择要生成邀请链接的租户');
      return;
    }
    run('create-invite', async () => {
      await adminApi.createTenantInvite({ expiresInDays: Number(expiresInDays), tenantId: superAdmin ? inviteTenantId : undefined });
      await loadInvites();
    }, '邀请链接已生成');
  };

  /**
   * @description 二次确认后撤销邀请链接并刷新列表
   * @keyword-cn 撤销邀请链接
   * @keyword-en revoke-invite-link
   */
  const onRevokeInvite = (row) => {
    if (!window.confirm('确认撤销该邀请链接？撤销后立即失效。')) return;
    run(`revoke-${row.id}`, async () => {
      await adminApi.revokeTenantInvite(row.id);
      await loadInvites();
    }, '邀请链接已撤销');
  };

  /**
   * @description 复制指定邀请码对应的同源网页地址
   * @keyword-cn 复制邀请地址
   * @keyword-en copy-invite-address
   */
  const onCopyInvite = async (row) => {
    const ok = await copyTextWithFallback(buildTenantInviteUrl(row.code), `invite-link-${row.id}`);
    onNotice?.(ok ? '邀请链接已复制' : '复制失败，已选中链接，请按 Ctrl+C 复制');
  };

  const totalPages = Math.max(1, Math.ceil(applicationMeta.total / applicationMeta.pageSize));
  const applicationStatus = {
    pending: ['待审批', 'bg-amber-50 text-amber-700'],
    approved: ['已通过', 'bg-emerald-50 text-emerald-700'],
    rejected: ['已拒绝', 'bg-rose-50 text-rose-700'],
  };
  const inviteStatus = {
    active: ['有效', 'bg-emerald-50 text-emerald-700'],
    expired: ['已过期', 'bg-amber-50 text-amber-700'],
    revoked: ['已撤销', 'bg-slate-100 text-slate-500'],
  };

  return (
    <div className="space-y-4 pb-8">
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-slate-900">入驻申请</h2><p className="text-xs text-slate-500 mt-1">当前待审批：<span className="font-semibold text-amber-700">{applicationMeta.pendingCount}</span> 条</p></div>
          <div className="flex flex-wrap gap-2">
            <select className="border rounded px-3 py-2 text-sm" value={applicationFilter.status} onChange={(e) => { const next = { ...applicationFilter, status: e.target.value, page: 1 }; setApplicationFilter(next); loadApplications(next).catch((err) => onError?.(err.message)); }}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {superAdmin ? <select className="border rounded px-3 py-2 text-sm" value={applicationFilter.tenantId} onChange={(e) => { const next = { ...applicationFilter, tenantId: e.target.value, page: 1 }; setApplicationFilter(next); loadApplications(next).catch((err) => onError?.(err.message)); }}><option value="">全部租户</option>{tenants.map((tenant) => <option key={tenant._id || tenant.id} value={tenant._id || tenant.id}>{tenant.name}</option>)}</select> : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b"><th className="py-2 pr-3">申请人</th><th className="py-2 pr-3">邮箱</th>{superAdmin ? <th className="py-2 pr-3">申请租户</th> : null}<th className="py-2 pr-3">留言</th><th className="py-2 pr-3">申请时间</th><th className="py-2 pr-3">状态</th><th className="py-2 pr-3">处理</th><th className="py-2 pr-3">邮件通知</th><th className="py-2 text-right">操作</th></tr></thead>
            <tbody>{applications.length ? applications.map((row) => { const status = applicationStatus[row.status] || [row.status, 'bg-slate-50']; return <tr key={row.id} className="border-b border-slate-100 align-top"><td className="py-3 pr-3"><div className="font-medium">{row.displayName || '未填写昵称'}</div><div className="text-xs text-slate-500">{row.phone}</div></td><td className="py-3 pr-3">{row.email}</td>{superAdmin ? <td className="py-3 pr-3">{row.tenantName}</td> : null}<td className="py-3 pr-3 max-w-[220px] break-words">{row.message || '—'}</td><td className="py-3 pr-3 whitespace-nowrap">{formatTime(row.createdAt)}</td><td className="py-3 pr-3"><span className={`px-2 py-1 rounded text-xs ${status[1]}`}>{status[0]}</span></td><td className="py-3 pr-3 text-xs"><div>{row.reviewerName || '—'}</div><div className="text-slate-400">{formatTime(row.reviewedAt)}</div>{row.rejectReason ? <div className="text-rose-500 mt-1">{row.rejectReason}</div> : null}</td><td className="py-3 pr-3 text-xs">{row.notifyStatus === 'sent' ? <span className="text-emerald-600">已发送</span> : row.notifyStatus === 'failed' ? <span className="text-rose-600 cursor-help" title={row.notifyError || ''}>失败</span> : row.notifyStatus === 'skipped' ? <span className="text-slate-500">未发送</span> : '—'}</td><td className="py-3 text-right whitespace-nowrap">{row.status === 'pending' ? <><button disabled={Boolean(busy)} onClick={() => onApprove(row)} className="px-2 py-1 text-xs rounded bg-emerald-600 text-white disabled:opacity-50">通过</button><button disabled={Boolean(busy)} onClick={() => setRejectDialog({ open: true, id: row.id, reason: '' })} className="ml-1 px-2 py-1 text-xs rounded border border-rose-200 text-rose-600 disabled:opacity-50">拒绝</button></> : '—'}</td></tr>; }) : <tr><td colSpan={superAdmin ? 9 : 8} className="py-8 text-center text-slate-400">暂无申请</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex justify-end items-center gap-2 text-xs text-slate-500"><button disabled={applicationFilter.page <= 1} className="px-2 py-1 border rounded disabled:opacity-40" onClick={() => { const next = { ...applicationFilter, page: applicationFilter.page - 1 }; setApplicationFilter(next); loadApplications(next).catch((err) => onError?.(err.message)); }}>上一页</button><span>{applicationFilter.page} / {totalPages}</span><button disabled={applicationFilter.page >= totalPages} className="px-2 py-1 border rounded disabled:opacity-40" onClick={() => { const next = { ...applicationFilter, page: applicationFilter.page + 1 }; setApplicationFilter(next); loadApplications(next).catch((err) => onError?.(err.message)); }}>下一页</button></div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div><h2 className="font-semibold text-slate-900">邀请入驻链接</h2><p className="text-xs text-slate-500 mt-1">链接有效期内不限人数使用；过期后需重新生成并发送。对方打开链接可在网页直接注册，或唤起 AI 营销官客户端完成注册。</p></div>
        <div className="flex flex-wrap gap-2 items-center">{superAdmin ? <select className="border rounded px-3 py-2 text-sm" value={inviteTenantId} onChange={(e) => { setInviteTenantId(e.target.value); loadInvites(e.target.value).catch((err) => onError?.(err.message)); }}><option value="">请选择租户</option>{tenants.map((tenant) => <option key={tenant._id || tenant.id} value={tenant._id || tenant.id}>{tenant.name}</option>)}</select> : null}<select className="border rounded px-3 py-2 text-sm" value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}>{INVITE_DAYS.map((day) => <option key={day} value={day}>{day} 天</option>)}</select><button disabled={Boolean(busy) || (superAdmin && !inviteTenantId)} onClick={onCreateInvite} className="px-3 py-2 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300">{busy === 'create-invite' ? '生成中…' : '生成邀请链接'}</button></div>
        <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-xs text-slate-500 border-b"><th className="py-2 pr-3">链接</th>{superAdmin ? <th className="py-2 pr-3">租户</th> : null}<th className="py-2 pr-3">状态</th><th className="py-2 pr-3">过期时间</th><th className="py-2 pr-3">已使用</th><th className="py-2 pr-3">创建人</th><th className="py-2 pr-3">创建时间</th><th className="py-2 text-right">操作</th></tr></thead><tbody>{invites.length ? invites.map((row) => { const url = buildTenantInviteUrl(row.code); const status = inviteStatus[row.status] || [row.status, 'bg-slate-50']; return <tr key={row.id} className="border-b border-slate-100"><td className="py-3 pr-3"><div className="flex items-center gap-2 max-w-[380px]"><input id={`invite-link-${row.id}`} readOnly value={url} className="min-w-0 flex-1 bg-transparent text-xs text-blue-600 truncate outline-none" /><button onClick={() => onCopyInvite(row)} className="px-2 py-1 text-xs border rounded">复制</button></div></td>{superAdmin ? <td className="py-3 pr-3">{row.tenantName}</td> : null}<td className="py-3 pr-3"><span className={`px-2 py-1 rounded text-xs ${status[1]}`}>{status[0]}</span></td><td className="py-3 pr-3 whitespace-nowrap"><div>{formatTime(row.expiresAt)}</div>{row.status === 'active' ? <div className="text-xs text-amber-600">{formatRemaining(row.expiresAt)}</div> : null}</td><td className="py-3 pr-3">{row.useCount || 0}</td><td className="py-3 pr-3">{row.createdByName || '—'}</td><td className="py-3 pr-3 whitespace-nowrap">{formatTime(row.createdAt)}</td><td className="py-3 text-right">{row.status === 'active' ? <button disabled={Boolean(busy)} onClick={() => onRevokeInvite(row)} className="px-2 py-1 text-xs border border-rose-200 text-rose-600 rounded">撤销</button> : '—'}</td></tr>; }) : <tr><td colSpan={superAdmin ? 8 : 7} className="py-8 text-center text-slate-400">暂无邀请链接</td></tr>}</tbody></table></div>
      </section>

      {rejectDialog.open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="bg-white rounded-xl w-full max-w-md p-4 space-y-3"><h3 className="font-semibold text-slate-900">拒绝入驻申请</h3><label className="block text-sm text-slate-700">拒绝原因（可选）<textarea maxLength={200} rows={4} value={rejectDialog.reason} onChange={(e) => setRejectDialog({ ...rejectDialog, reason: e.target.value })} className="mt-1 w-full border rounded px-3 py-2" placeholder="最多 200 字" /></label><div className="flex justify-end gap-2"><button onClick={() => setRejectDialog({ open: false, id: '', reason: '' })} className="px-3 py-2 text-sm border rounded">取消</button><button disabled={Boolean(busy)} onClick={onReject} className="px-3 py-2 text-sm bg-rose-600 text-white rounded disabled:opacity-50">确认拒绝</button></div></div></div> : null}
    </div>
  );
}
