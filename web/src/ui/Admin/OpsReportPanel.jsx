import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from './adminApi';

/**
 * @description 运维上报列表每页条数
 * @keyword-cn 上报分页大小
 * @keyword-en ops-report-page-size
 */
const PAGE_SIZE = 20;

/**
 * @description 运维上报状态筛选选项
 * @keyword-cn 上报状态选项
 * @keyword-en ops-report-status-options
 */
const STATUS_OPTIONS = [
  { value: 'open', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'all', label: '全部' },
];

/**
 * @description 格式化运维上报时间，空值显示占位符
 * @keyword-cn 上报时间格式化
 * @keyword-en ops-report-time
 */
const formatTime = (value) => (value ? new Date(value).toLocaleString() : '—');

/**
 * @description 把客户端信息对象整理为便于阅读的键值文本
 * @keyword-cn 客户端信息文本
 * @keyword-en client-info-text
 */
const formatClient = (client = {}) => Object.entries(client)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => `${{
    appVersion: '应用版本',
    shellVersion: '桌面外壳版本',
    workbenchVersion: '工作台版本',
    platform: '操作系统平台',
    arch: '系统架构',
    osVersion: '系统版本',
    page: '所在页面',
    boardId: '工作区编号',
  }[key] || key}：${value}`)
  .join('\n');

/**
 * @description 把运维日志条目格式化为可复制的纯文本
 * @keyword-cn 复制日志文本
 * @keyword-en copyable-log-text
 */
const formatLogs = (report) => [
  `上报编号: ${report.id}`,
  `提交时间: ${formatTime(report.createdAt)}`,
  `租户: ${report.tenantName || report.tenantId}`,
  `提交人: ${report.displayName || report.username}`,
  `问题描述: ${report.description}`,
  `联系方式: ${report.contact || '—'}`,
  `客户端信息：\n${formatClient(report.client) || '—'}`,
  '',
  ...(report.entries || []).map((entry, index) => {
    const http = [entry.method, entry.status, entry.url].filter((value) => value !== undefined && value !== '').join(' ');
    return `#${index + 1} ${entry.ts} [${entry.kind}/${entry.level}]${http ? ` ${http}` : ''}\n${entry.message}${entry.stack ? `\n调用堆栈：\n${entry.stack}` : ''}`;
  }),
].join('\n');

/**
 * @description 运维上报列表与详情面板，超管可处理、租户管理员只读
 * @keyword-cn 运维上报面板, 日志详情
 * @keyword-en ops-report-panel, log-detail
 */
export default function OpsReportPanel({ currentRole, tenants, onNotice, onError }) {
  const superAdmin = currentRole === 'super_admin';
  const [filter, setFilter] = useState({ status: 'open', tenantId: '', keyword: '', page: 1 });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState(null);
  const [handlerForm, setHandlerForm] = useState({ status: 'open', handlerNote: '' });
  const [busy, setBusy] = useState('');

  /**
   * @description 按筛选条件分页加载运维上报摘要
   * @keyword-cn 加载运维上报
   * @keyword-en load-ops-reports
   */
  const loadReports = useCallback(async (next = filter) => {
    const res = await adminApi.listOpsReports({ ...next, tenantId: superAdmin ? next.tenantId : undefined, pageSize: PAGE_SIZE });
    setRows(res.items || []);
    setTotal(res.total || 0);
  }, [filter, superAdmin]);

  useEffect(() => {
    loadReports().catch((err) => onError?.(err.message));
  }, []);

  /**
   * @description 读取完整上报并打开详情弹窗
   * @keyword-cn 打开上报详情
   * @keyword-en open-report-detail
   */
  const openDetail = async (id) => {
    setBusy(`detail-${id}`);
    try {
      const res = await adminApi.getOpsReport(id);
      setDetail(res.report);
      setHandlerForm({ status: res.report.status, handlerNote: res.report.handlerNote || '' });
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy('');
    }
  };

  /**
   * @description 超管保存上报处理状态和处理备注
   * @keyword-cn 处理运维上报
   * @keyword-en handle-ops-report
   */
  const onUpdateReport = async () => {
    setBusy('update');
    try {
      const res = await adminApi.updateOpsReport(detail.id, {
        status: handlerForm.status,
        handlerNote: handlerForm.handlerNote.trim() || undefined,
      });
      setDetail(res.report);
      await loadReports();
      onNotice?.('运维上报处理状态已更新');
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy('');
    }
  };

  /**
   * @description 将当前详情中的问题与全部日志复制到剪贴板
   * @keyword-cn 复制全部日志
   * @keyword-en copy-all-logs
   */
  const onCopyLogs = async () => {
    const text = formatLogs(detail);
    try {
      await navigator.clipboard.writeText(text);
      onNotice?.('全部日志已复制');
    } catch {
      window.prompt('复制失败，请手动复制以下日志', text);
    }
  };

  /**
   * @description 应用筛选条件并回到第一页
   * @keyword-cn 筛选运维上报
   * @keyword-en filter-ops-reports
   */
  const applyFilter = (patch) => {
    const next = { ...filter, ...patch, page: 1 };
    setFilter(next);
    loadReports(next).catch((err) => onError?.(err.message));
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusBadge = {
    open: ['待处理', 'bg-amber-50 text-amber-700'],
    processing: ['处理中', 'bg-blue-50 text-blue-700'],
    resolved: ['已解决', 'bg-emerald-50 text-emerald-700'],
  };

  return (
    <div className="space-y-4 pb-8">
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-semibold text-slate-900">运维上报</h2><p className="text-xs text-slate-500 mt-1">查看客户端提交的问题描述与错误日志。</p></div>
          <div className="flex flex-wrap gap-2">
            <select className="border rounded px-3 py-2 text-sm" value={filter.status} onChange={(e) => applyFilter({ status: e.target.value })}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            {superAdmin ? <select className="border rounded px-3 py-2 text-sm" value={filter.tenantId} onChange={(e) => applyFilter({ tenantId: e.target.value })}><option value="">全部租户</option>{tenants.map((tenant) => <option key={tenant._id || tenant.id} value={tenant._id || tenant.id}>{tenant.name}</option>)}</select> : null}
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); applyFilter({ keyword: filter.keyword }); }}><input className="border rounded px-3 py-2 text-sm" value={filter.keyword} onChange={(e) => setFilter({ ...filter, keyword: e.target.value })} placeholder="搜索描述、提交人" /><button className="px-3 py-2 bg-slate-900 text-white text-sm rounded">搜索</button></form>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b"><th className="py-2 pr-3">提交时间</th><th className="py-2 pr-3">租户</th><th className="py-2 pr-3">提交人</th><th className="py-2 pr-3">问题描述</th><th className="py-2 pr-3">客户端</th><th className="py-2 pr-3">日志</th><th className="py-2">状态</th></tr></thead>
            <tbody>{rows.length ? rows.map((row) => { const status = statusBadge[row.status] || [row.status, 'bg-slate-50']; return <tr key={row.id} tabIndex={0} onClick={() => openDetail(row.id)} onKeyDown={(e) => { if (e.key === 'Enter') openDetail(row.id); }} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"><td className="py-3 pr-3 whitespace-nowrap">{formatTime(row.createdAt)}</td><td className="py-3 pr-3">{row.tenantName || row.tenantId}</td><td className="py-3 pr-3"><div>{row.displayName || row.username}</div><div className="text-xs text-slate-400">{row.username}</div></td><td className="py-3 pr-3 max-w-[320px]"><div className="truncate" title={row.description}>{row.description}</div></td><td className="py-3 pr-3 text-xs"><div>{row.client?.appVersion || '—'}</div><div className="text-slate-400">{row.client?.platform || '—'}</div></td><td className="py-3 pr-3">{row.entryCount || 0}</td><td className="py-3"><span className={`px-2 py-1 rounded text-xs ${status[1]}`}>{status[0]}</span>{busy === `detail-${row.id}` ? <span className="ml-2 text-xs text-slate-400">加载中…</span> : null}</td></tr>; }) : <tr><td colSpan="7" className="py-8 text-center text-slate-400">暂无上报</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex justify-end items-center gap-2 text-xs text-slate-500"><button disabled={filter.page <= 1} className="px-2 py-1 border rounded disabled:opacity-40" onClick={() => { const next = { ...filter, page: filter.page - 1 }; setFilter(next); loadReports(next).catch((err) => onError?.(err.message)); }}>上一页</button><span>{filter.page} / {totalPages}</span><button disabled={filter.page >= totalPages} className="px-2 py-1 border rounded disabled:opacity-40" onClick={() => { const next = { ...filter, page: filter.page + 1 }; setFilter(next); loadReports(next).catch((err) => onError?.(err.message)); }}>下一页</button></div>
      </section>

      {detail ? <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}><div className="bg-white h-full w-full max-w-4xl shadow-xl flex flex-col"><div className="px-5 py-4 border-b flex justify-between items-start"><div><h3 className="font-semibold text-slate-900">运维上报详情</h3><p className="text-xs text-slate-500 mt-1">{detail.id} · {formatTime(detail.createdAt)}</p></div><button onClick={() => setDetail(null)} className="text-xl text-slate-400" aria-label="关闭">×</button></div><div className="flex-1 overflow-y-auto p-5 space-y-4"><div className="grid md:grid-cols-2 gap-4"><div className="border rounded-lg p-3"><h4 className="text-xs font-semibold text-slate-500 mb-2">问题描述</h4><p className="text-sm whitespace-pre-wrap">{detail.description}</p><div className="text-xs text-slate-500 mt-3">联系方式：{detail.contact || '未填写'}</div></div><div className="border rounded-lg p-3"><h4 className="text-xs font-semibold text-slate-500 mb-2">客户端信息</h4><pre className="text-xs whitespace-pre-wrap font-mono text-slate-700">{formatClient(detail.client) || '—'}</pre></div></div><div className="flex justify-between items-center"><h4 className="font-semibold text-slate-900">日志条目（{detail.entries?.length || 0}）</h4><button onClick={onCopyLogs} className="px-3 py-1.5 text-xs border rounded">复制全部日志</button></div><div className="overflow-x-auto border rounded-lg"><table className="min-w-full text-xs"><thead><tr className="text-left text-slate-500 border-b bg-slate-50"><th className="p-2">时间</th><th className="p-2">类型</th><th className="p-2">级别</th><th className="p-2">HTTP</th><th className="p-2">消息</th></tr></thead><tbody>{(detail.entries || []).map((entry, index) => <tr key={`${entry.ts}-${index}`} className="border-b align-top"><td className="p-2 whitespace-nowrap font-mono">{entry.ts}</td><td className="p-2 font-mono">{entry.kind}</td><td className={`p-2 font-mono ${entry.level === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>{entry.level}</td><td className="p-2 font-mono max-w-[280px]"><div>{[entry.method, entry.status].filter(Boolean).join(' ') || '—'}</div><div className="break-all text-slate-500">{entry.url || entry.page || entry.source || ''}</div>{entry.durationMs !== undefined ? <div className="text-slate-400">{entry.durationMs} ms</div> : null}</td><td className="p-2 font-mono min-w-[260px]"><div className="whitespace-pre-wrap break-words">{entry.message}</div>{entry.stack ? <details className="mt-2"><summary className="cursor-pointer text-blue-600">展开 stack</summary><pre className="mt-1 whitespace-pre-wrap break-words text-rose-700">{entry.stack}</pre></details> : null}</td></tr>)}</tbody></table></div>{superAdmin ? <div className="border rounded-lg p-4 space-y-3"><h4 className="font-semibold text-slate-900">处理上报</h4><select className="w-full border rounded px-3 py-2 text-sm" value={handlerForm.status} onChange={(e) => setHandlerForm({ ...handlerForm, status: e.target.value })}>{STATUS_OPTIONS.filter((option) => option.value !== 'all').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><textarea maxLength={500} rows={4} className="w-full border rounded px-3 py-2 text-sm" placeholder="处理备注（最多 500 字）" value={handlerForm.handlerNote} onChange={(e) => setHandlerForm({ ...handlerForm, handlerNote: e.target.value })} /><button disabled={busy === 'update'} onClick={onUpdateReport} className="px-4 py-2 bg-slate-900 text-white text-sm rounded disabled:bg-slate-300">{busy === 'update' ? '保存中…' : '保存处理结果'}</button></div> : <div className="border rounded-lg p-4 text-sm text-slate-600"><div>状态：{statusBadge[detail.status]?.[0] || detail.status}</div><div className="mt-1">处理备注：{detail.handlerNote || '—'}</div><div className="mt-1 text-xs text-slate-400">处理人：{detail.handledByName || '—'} · {formatTime(detail.handledAt)}</div></div>}</div></div></div> : null}
    </div>
  );
}
