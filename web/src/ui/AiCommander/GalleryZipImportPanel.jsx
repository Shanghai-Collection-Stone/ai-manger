import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, RefreshCw, Trash2, XCircle, Loader2, FileArchive, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * @description 图库 ZIP 批量导入面板。右侧抽屉式弹层,包含上传表单(选 zip + tags + groupId) +
 *              任务历史列表(2s 轮询刷新 status / stage / progress / 错误明细)。
 * @keyword-en gallery zip import panel, drawer, upload form, polling, progress
 */
export default function GalleryZipImportPanel({ open, onClose, userId, groups, api, onCompleted }) {
  const [file, setFile] = useState(null);
  const [tags, setTags] = useState('');
  const [groupId, setGroupId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const fileRef = useRef(null);
  const pollRef = useRef(null);
  const completedReportedRef = useRef(new Set());

  const safeGroups = useMemo(
    () => (Array.isArray(groups) ? groups : []),
    [groups],
  );

  const refresh = useCallback(async () => {
    const data = await api.listGalleryZipImports({ userId: userId || 'default', limit: 30 });
    const list = Array.isArray(data?.jobs) ? data.jobs : [];
    setJobs(list);

    // 检测刚刚完成的任务,通知外部刷新图库
    if (typeof onCompleted === 'function') {
      for (const j of list) {
        if (!j?.id) continue;
        const isDone = j.status === 'done' || j.status === 'cancelled';
        const key = `${j.id}:${j.status}`;
        if (isDone && !completedReportedRef.current.has(key)) {
          completedReportedRef.current.add(key);
          if (j.status === 'done' && Number(j?.progress?.success) > 0) {
            onCompleted();
          }
        }
      }
    }
  }, [api, userId, onCompleted]);

  // 打开时立即拉一次,并启动 2s 轮询(仅当还有运行中任务时)
  useEffect(() => {
    if (!open) return undefined;
    refresh();
    pollRef.current = setInterval(() => {
      refresh();
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, refresh]);

  const hasRunning = useMemo(
    () =>
      Array.isArray(jobs) &&
      jobs.some((j) => j?.status === 'pending' || j?.status === 'extracting' || j?.status === 'importing'),
    [jobs],
  );

  const onPickFile = (e) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) {
      alert('只支持 .zip 文件');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setFile(f);
  };

  const onSubmit = async () => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      await api.uploadGalleryZip(file, {
        userId: userId || 'default',
        tags: tags || undefined,
        groupId: groupId || undefined,
      });
      setFile(null);
      setTags('');
      // groupId 故意保留,方便连续导入到同一个库
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } finally {
      setUploading(false);
    }
  };

  const onCancelJob = async (id) => {
    if (!id) return;
    await api.cancelGalleryZipImport(id);
    await refresh();
  };

  const onDeleteJob = async (id) => {
    if (!id) return;
    if (!confirm('确定删除这条任务记录?')) return;
    await api.deleteGalleryZipImport(id);
    await refresh();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <style>{`
        @keyframes zipPanelSlideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .zip-panel-slide-in { animation: zipPanelSlideInRight 0.25s ease-out forwards; }
      `}</style>
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
      />
      {/* 抽屉 */}
      <div className="relative ml-auto h-full w-full max-w-md bg-white shadow-2xl flex flex-col zip-panel-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileArchive size={18} className="text-slate-500" />
            <span className="text-sm font-semibold text-slate-800">ZIP 批量导入</span>
            {hasRunning && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" />
                有任务进行中
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full text-slate-500">
            <X size={16} />
          </button>
        </div>

        {/* Upload Form */}
        <div className="p-4 border-b border-slate-100 space-y-3 bg-slate-50">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">ZIP 文件 (≤ 1GB)</label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                ref={fileRef}
                onChange={onPickFile}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="px-3 py-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 whitespace-nowrap"
              >
                选择文件
              </button>
              <span className="text-xs text-slate-500 truncate flex-1" title={file?.name || ''}>
                {file?.name || '未选择'}
                {file?.size ? ` · ${formatBytes(file.size)}` : ''}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">导入到分组</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-blue-500"
            >
              <option value="">不指定(全部图片)</option>
              {safeGroups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name || `分组 #${g.id}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">标签 (逗号分隔)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例:风景, 旅行"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={onSubmit}
            disabled={!file || uploading}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? <RefreshCw className="animate-spin" size={14} /> : <Upload size={14} />}
            <span>{uploading ? '上传中...' : '开始上传'}</span>
          </button>
        </div>

        {/* Jobs History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">导入历史</span>
            <button
              onClick={() => refresh()}
              className="p-1 hover:bg-slate-100 rounded text-slate-400"
              title="刷新"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          {jobs.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-8">暂无任务</div>
          ) : (
            jobs.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                onCancel={() => onCancelJob(j.id)}
                onDelete={() => onDeleteJob(j.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * @description 单条任务卡片(状态徽章 + 进度条 + 错误折叠)
 * @keyword-en zip import job card with progress bar
 */
function JobCard({ job, onCancel, onDelete }) {
  const [showErrors, setShowErrors] = useState(false);
  const status = job?.status || 'pending';
  const progress = job?.progress || {};
  const total = Number(progress.total) || 0;
  const processed = Number(progress.processed) || 0;
  const success = Number(progress.success) || 0;
  const failed = Number(progress.failed) || 0;
  const pct = total > 0 ? Math.min(100, Math.floor((processed / total) * 100)) : 0;
  const errors = Array.isArray(job?.errors) ? job.errors : [];
  const isRunning = status === 'pending' || status === 'extracting' || status === 'importing';
  const isTerminal = status === 'done' || status === 'failed' || status === 'cancelled';

  return (
    <div className="border border-slate-100 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-slate-800 truncate" title={job?.originalName}>
            {job?.originalName || '未命名'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {job?.fileSize ? formatBytes(job.fileSize) : ''}
            {job?.createdAt ? ` · ${formatTime(job.createdAt)}` : ''}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Stage */}
      <div className="text-[11px] text-slate-500 mb-2 truncate" title={job?.stage}>
        {job?.stage || '—'}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1">
            <div
              className={`h-full transition-all ${
                status === 'failed' ? 'bg-rose-400' : status === 'cancelled' ? 'bg-slate-300' : 'bg-blue-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
            <span>
              {processed}/{total} 张 · 成功 {success}
              {failed > 0 ? ` · 失败 ${failed}` : ''}
            </span>
            <span className="font-mono">{pct}%</span>
          </div>
        </>
      )}

      {/* 标签/分组信息 */}
      {(job?.groupId !== undefined && job?.groupId !== null) || (Array.isArray(job?.tags) && job.tags.length > 0) ? (
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {job?.groupId !== undefined && job?.groupId !== null ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              分组 #{job.groupId}
            </span>
          ) : null}
          {(Array.isArray(job?.tags) ? job.tags : []).slice(0, 5).map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              #{t}
            </span>
          ))}
        </div>
      ) : null}

      {/* 错误明细折叠 */}
      {errors.length > 0 && (
        <div className="mt-1">
          <button
            onClick={() => setShowErrors((v) => !v)}
            className="text-[11px] text-rose-500 hover:underline flex items-center gap-1"
          >
            <AlertTriangle size={10} />
            {showErrors ? '收起' : '查看'} {errors.length} 条错误
          </button>
          {showErrors && (
            <div className="mt-1 max-h-32 overflow-y-auto text-[10px] text-rose-500 bg-rose-50 rounded p-2 space-y-1">
              {errors.slice(0, 50).map((er, idx) => (
                <div key={idx} className="truncate" title={`${er.fileName} :: ${er.reason}`}>
                  <span className="font-medium">{er.fileName}</span>: {er.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 操作 */}
      <div className="flex items-center justify-end gap-2 mt-2">
        {isRunning ? (
          <button
            onClick={onCancel}
            className="text-[11px] text-slate-500 hover:text-rose-500 flex items-center gap-1"
          >
            <XCircle size={11} />
            取消
          </button>
        ) : null}
        {isTerminal ? (
          <button
            onClick={onDelete}
            className="text-[11px] text-slate-400 hover:text-rose-500 flex items-center gap-1"
          >
            <Trash2 size={11} />
            删除
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @description 状态徽章(配色:进行中蓝、成功绿、失败红、取消灰)
 * @keyword-en status badge for zip import job
 */
function StatusBadge({ status }) {
  if (status === 'done') {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 flex items-center gap-1 flex-shrink-0">
        <CheckCircle2 size={10} /> 完成
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 flex items-center gap-1 flex-shrink-0">
        <AlertTriangle size={10} /> 失败
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 flex-shrink-0">
        已取消
      </span>
    );
  }
  const label = status === 'extracting' ? '解压中' : status === 'importing' ? '入库中' : '排队中';
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1 flex-shrink-0">
      <Loader2 size={10} className="animate-spin" />
      {label}
    </span>
  );
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(t) {
  try {
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}
