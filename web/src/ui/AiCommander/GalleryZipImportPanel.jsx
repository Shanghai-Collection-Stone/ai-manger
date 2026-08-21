import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, RefreshCw, Trash2, XCircle, Loader2, FileArchive, CheckCircle2, AlertTriangle } from 'lucide-react';

const MAX_CLIENT_ZIP_BYTES = 300 * 1024 * 1024;

/**
 * @description 在独立 Worker 中解包并优化 ZIP 图片，返回带尺寸清单的新 ZIP 文件。
 * @param {File} file 用户选择的原始 ZIP。
 * @param {(progress: Record<string, unknown>) => void} onProgress 本地处理进度回调。
 * @param {(worker: Worker | null) => void} onWorker Worker 生命周期回调。
 * @returns {Promise<{file: File, summary: Record<string, number>}>} 优化后的 ZIP 和体积统计。
 * @keyword-cn ZIP本地优化, Worker图片压缩
 * @keyword-en local-zip-optimization, worker-image-compression
 */
function preprocessGalleryZip(file, onProgress, onWorker) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./galleryZipPreprocess.worker.js', import.meta.url),
      { type: 'module' },
    );
    onWorker(worker);

    worker.addEventListener('message', (event) => {
      const message = event?.data || {};
      if (message.type === 'progress') {
        onProgress(message);
        return;
      }
      worker.terminate();
      onWorker(null);
      if (message.type === 'error') {
        reject(new Error(message.message || 'ZIP 客户端优化失败'));
        return;
      }
      if (message.type !== 'done' || !(message.buffer instanceof ArrayBuffer)) {
        reject(new Error('ZIP 客户端优化返回无效'));
        return;
      }
      resolve({
        file: new File([message.buffer], message.name || 'gallery.optimized.zip', {
          type: 'application/zip',
          lastModified: Date.now(),
        }),
        summary: message.summary || {},
      });
    });
    worker.addEventListener('error', (event) => {
      worker.terminate();
      onWorker(null);
      reject(new Error(event?.message || 'ZIP 客户端优化 Worker 运行失败'));
    });
    worker.postMessage({ file });
  });
}

/**
 * @description 图库 ZIP 批量导入面板。上传前在 Worker 中逐张压缩图片并生成尺寸清单，再上传优化 ZIP；任务轮询等待上一请求成功完成后再调度下一次。
 * @keyword-cn 图库ZIP导入, ZIP本地优化, 串行轮询
 * @keyword-en gallery-zip-import, local-zip-optimization, sequential-polling
 */
export default function GalleryZipImportPanel({ open, onClose, userId, groups, api, onCompleted }) {
  const [file, setFile] = useState(null);
  const [tags, setTags] = useState('');
  const [groupId, setGroupId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState('idle');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [preprocessProgress, setPreprocessProgress] = useState(null);
  const [preprocessSummary, setPreprocessSummary] = useState(null);
  const [jobs, setJobs] = useState([]);
  const fileRef = useRef(null);
  const pollRef = useRef(null);
  const refreshInFlightRef = useRef(null);
  const uploadSampleRef = useRef({ loaded: 0, at: 0, speed: 0 });
  const preprocessWorkerRef = useRef(null);
  const completedReportedRef = useRef(new Set());

  const safeGroups = useMemo(
    () => (Array.isArray(groups) ? groups : []),
    [groups],
  );

  /**
   * @description 读取 ZIP 导入任务；已有请求运行时复用同一个 Promise，避免轮询、手动刷新和操作后刷新并发。
   * @returns {Promise<boolean>} 接口成功返回任务数组时返回 true。
   * @keyword-cn 串行轮询刷新, 导入任务数据
   * @keyword-en sequential-poll-refresh, import-job-data
   */
  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return await refreshInFlightRef.current;
    }

    const request = (async () => {
      const data = await api.listGalleryZipImports({ userId: userId || 'default', limit: 30 });
      if (!Array.isArray(data?.jobs)) return false;

      const list = data.jobs;
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
      return true;
    })();

    refreshInFlightRef.current = request;
    try {
      return await request;
    } finally {
      if (refreshInFlightRef.current === request) {
        refreshInFlightRef.current = null;
      }
    }
  }, [api, userId, onCompleted]);

  // 打开时立即拉一次；上一次请求完成并成功处理数据后，才等待 2s 发起下一次。
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;

    /**
     * @description 串行执行 ZIP 导入任务轮询，确保相邻请求之间没有重叠。
     * @returns {Promise<void>}
     * @keyword-cn 串行任务轮询, 请求完成后调度
     * @keyword-en sequential-job-polling, post-response-scheduling
     */
    const poll = async () => {
      const succeeded = await refresh();
      if (cancelled || !succeeded) return;
      pollRef.current = setTimeout(() => {
        void poll();
      }, 2000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
    };
  }, [open, refresh]);

  const hasRunning = useMemo(
    () =>
      Array.isArray(jobs) &&
      jobs.some((j) => j?.status === 'pending' || j?.status === 'extracting' || j?.status === 'importing'),
    [jobs],
  );

  /**
   * @description 根据连续上传字节采样计算平滑实时速度，并更新上传百分比。
   * @param {{ loaded: number, total: number }} progress 上传字节进度。
   * @returns {void}
   * @keyword-cn 上传速度计算, 上传进度显示
   * @keyword-en upload-speed-calculation, upload-progress-display
   */
  const handleUploadProgress = useCallback((progress) => {
    const now = performance.now();
    const loaded = Math.max(0, Number(progress?.loaded) || 0);
    const total = Math.max(0, Number(progress?.total) || 0);
    const previous = uploadSampleRef.current;
    const elapsedSeconds = Math.max(0, (now - previous.at) / 1000);
    const instantSpeed = elapsedSeconds > 0 ? Math.max(0, loaded - previous.loaded) / elapsedSeconds : 0;
    const speed = previous.speed > 0 && instantSpeed > 0
      ? previous.speed * 0.65 + instantSpeed * 0.35
      : instantSpeed || previous.speed;
    uploadSampleRef.current = { loaded, at: now, speed };
    setUploadProgress({
      loaded,
      total,
      speed,
      percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
    });
  }, []);

  const onPickFile = (e) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) {
      alert('只支持 .zip 文件');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (Number(f.size) > MAX_CLIENT_ZIP_BYTES) {
      alert('浏览器本地优化单包上限为 300MB，请拆分 ZIP 后重试');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setFile(f);
    setUploadProgress(null);
    setPreprocessProgress(null);
    setPreprocessSummary(null);
  };

  const onSubmit = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setUploadPhase('preprocessing');
    setUploadProgress(null);
    setPreprocessSummary(null);
    try {
      const optimized = await preprocessGalleryZip(
        file,
        setPreprocessProgress,
        (worker) => {
          preprocessWorkerRef.current = worker;
        },
      );
      setPreprocessSummary(optimized.summary);
      setUploadPhase('uploading');
      uploadSampleRef.current = { loaded: 0, at: performance.now(), speed: 0 };
      setUploadProgress({ loaded: 0, total: Number(optimized.file.size) || 0, speed: 0, percent: 0 });
      const result = await api.uploadGalleryZip(optimized.file, {
        userId: userId || 'default',
        tags: tags || undefined,
        groupId: groupId || undefined,
      }, handleUploadProgress);
      if (!result?.job) return;
      setFile(null);
      setTags('');
      // groupId 故意保留,方便连续导入到同一个库
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'ZIP 客户端优化失败');
    } finally {
      preprocessWorkerRef.current?.terminate();
      preprocessWorkerRef.current = null;
      setUploading(false);
      setUploadPhase('idle');
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
            <label className="block text-xs font-medium text-slate-600 mb-1">ZIP 文件 (客户端优化 ≤ 300MB)</label>
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
            <span>
              {uploadPhase === 'preprocessing'
                ? '本地压缩中...'
                : uploadPhase === 'uploading'
                  ? '上传中...'
                  : '优化并上传'}
            </span>
          </button>
          {uploadPhase === 'preprocessing' && preprocessProgress ? (
            <div className="rounded-md border border-violet-100 bg-violet-50/70 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-[11px] text-violet-700">
                <span>
                  {preprocessProgress.phase === 'reading'
                    ? '正在读取 ZIP'
                    : preprocessProgress.phase === 'packing'
                      ? '正在重新打包'
                      : `正在优化图片 ${Number(preprocessProgress.processed) || 0}/${Number(preprocessProgress.total) || 0}`}
                </span>
                {Number(preprocessProgress.total) > 0 ? (
                  <span className="font-mono">
                    {Math.min(100, Math.round((Number(preprocessProgress.processed) / Number(preprocessProgress.total)) * 100))}%
                  </span>
                ) : null}
              </div>
              {preprocessProgress.currentName ? (
                <div className="truncate text-[10px] text-violet-500" title={preprocessProgress.currentName}>
                  {preprocessProgress.currentName}
                </div>
              ) : null}
            </div>
          ) : null}
          {preprocessSummary ? (
            <div className="text-[11px] text-emerald-700 bg-emerald-50 rounded-md px-2.5 py-2">
              本地处理 {Number(preprocessSummary.imageCount) || 0} 张，压缩 {Number(preprocessSummary.optimizedCount) || 0} 张；
              上传包 {formatBytes(preprocessSummary.originalZipBytes) || '0 B'} → {formatBytes(preprocessSummary.outputZipBytes) || '0 B'}
            </div>
          ) : null}
          {uploadPhase === 'uploading' && uploadProgress ? (
            <div className="rounded-md border border-blue-100 bg-blue-50/70 p-2.5 space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full bg-blue-500 transition-[width] duration-200"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-[11px] text-blue-700">
                <span>
                  {formatBytes(uploadProgress.loaded) || '0 B'} / {formatBytes(uploadProgress.total) || '未知大小'}
                </span>
                <span className="font-mono whitespace-nowrap">
                  {uploadProgress.percent}% · {formatBytes(uploadProgress.speed) || '计算中'}/s
                </span>
              </div>
              {uploadProgress.percent >= 100 ? (
                <div className="text-[10px] text-blue-500">文件已传完，等待服务器确认…</div>
              ) : null}
            </div>
          ) : null}
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
