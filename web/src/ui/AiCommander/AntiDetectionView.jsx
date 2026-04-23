import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, Upload, X, Download, Loader2, ShieldCheck, Image as ImageIcon, Trash2, Cpu, Server,
} from 'lucide-react';
import {
  antiDetectionService,
  base64ToBlob,
  downloadBlob,
} from './antiDetectionService';
import { processInBrowser } from './browserAntiDetection';
import { showToast } from './blocks/shared';

/** 单次批量上限（与后端 BATCH_LIMIT 对齐） */
const MAX_BATCH = 20;
/** 单文件上限 20MB（与后端 FILE_SIZE_LIMIT 对齐） */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * @description 可读文件大小
 * @keyword-en format byte size human readable
 */
const formatSize = (n) => {
  const bytes = Number(n);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

/**
 * @description 图片去 AI 标识工具视图
 * @keyword-en anti detection tool view upload batch download
 */
const AntiDetectionView = ({ onBack }) => {
  const [queued, setQueued] = useState([]); // 待处理：{ file, previewUrl }
  const [results, setResults] = useState([]); // 已处理：{ originalName, outputName, mimeType, size, processed, blob, previewUrl, appliedParams }
  const [processing, setProcessing] = useState(false);
  const [strength, setStrength] = useState('standard');
  const [outputFormat, setOutputFormat] = useState('keep');
  /** 'browser' = 浏览器本地处理（不上传）；'server' = 服务器处理（sharp + mozjpeg） */
  const [engine, setEngine] = useState('browser');
  /** 处理进度：{ done, total } — 仅浏览器逐张处理时显示 */
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef(null);

  const canAddMore = queued.length < MAX_BATCH;

  /**
   * 收集用户选中的 File 列表；过滤非图片 / 超限 / 越界
   * @keyword-en accept files and filter
   */
  const handleAddFiles = useCallback((fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;
    const accepted = [];
    const rejected = [];
    for (const f of incoming) {
      if (!f.type?.startsWith('image/')) { rejected.push(`${f.name} (非图片)`); continue; }
      if (f.size > MAX_FILE_SIZE) { rejected.push(`${f.name} (超过 20MB)`); continue; }
      accepted.push(f);
    }
    setQueued((prev) => {
      const remain = MAX_BATCH - prev.length;
      const toAdd = accepted.slice(0, Math.max(0, remain));
      if (accepted.length > toAdd.length) {
        rejected.push(`已达批量上限 ${MAX_BATCH} 张`);
      }
      const mapped = toAdd.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...mapped];
    });
    if (rejected.length > 0) showToast(`部分文件跳过：${rejected.join('；')}`, 'error');
  }, []);

  const handleInputChange = (e) => {
    handleAddFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleAddFiles(e.dataTransfer?.files);
  };

  const removeQueued = (idx) => {
    setQueued((prev) => {
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const clearAllQueued = () => {
    queued.forEach((q) => q.previewUrl && URL.revokeObjectURL(q.previewUrl));
    setQueued([]);
  };

  const clearAllResults = () => {
    results.forEach((r) => r.previewUrl && URL.revokeObjectURL(r.previewUrl));
    setResults([]);
  };

  /**
   * 浏览器端处理：逐张本地 Canvas 管道处理，带进度
   * @keyword-en run process in browser locally
   */
  const runBrowserProcess = async (options) => {
    const total = queued.length;
    setProgress({ done: 0, total });
    const produced = [];
    const failed = [];
    for (let i = 0; i < queued.length; i++) {
      const item = queued[i];
      const res = await processInBrowser(item.file, options);
      if (!res.ok) {
        failed.push(`${item.file.name}: ${res.message}`);
      } else {
        produced.push({
          originalName: item.file.name,
          outputName: res.outputName,
          mimeType: res.mimeType,
          size: res.size,
          processed: res.processed,
          blob: res.blob,
          previewUrl: URL.createObjectURL(res.blob),
          appliedParams: res.appliedParams,
        });
      }
      setProgress({ done: i + 1, total });
    }
    if (produced.length > 0) setResults((prev) => [...produced.reverse(), ...prev]);
    if (failed.length > 0) showToast(`部分失败：${failed.slice(0, 3).join('；')}`, 'error');
    return produced.length;
  };

  /**
   * 服务器端处理：单张走单接口，多张走批量接口
   * @keyword-en run process on server via api
   */
  const runServerProcess = async (options) => {
    if (queued.length === 1) {
      const item = queued[0];
      const res = await antiDetectionService.processSingle(item.file, options);
      if (!res.ok) {
        showToast(`处理失败: ${res.message}`, 'error');
        return 0;
      }
      const previewUrl = URL.createObjectURL(res.blob);
      setResults((prev) => [
        {
          originalName: item.file.name,
          outputName: res.outputName,
          mimeType: res.mimeType,
          size: res.size,
          processed: res.processed,
          blob: res.blob,
          previewUrl,
        },
        ...prev,
      ]);
      return 1;
    }
    const res = await antiDetectionService.processBatch(
      queued.map((q) => q.file),
      options,
    );
    if (!res.ok) {
      showToast(`批量处理失败: ${res.message}`, 'error');
      return 0;
    }
    const newResults = (Array.isArray(res.items) ? res.items : []).map((it) => {
      const blob = base64ToBlob(it.dataBase64, it.mimeType);
      return {
        originalName: it.originalName,
        outputName: it.outputName,
        mimeType: it.mimeType,
        size: it.size,
        processed: it.processed,
        blob,
        previewUrl: URL.createObjectURL(blob),
        appliedParams: it.appliedParams,
      };
    });
    setResults((prev) => [...newResults, ...prev]);
    return newResults.length;
  };

  /**
   * 触发处理（按 engine 分流）
   * @keyword-en run processing dispatch by engine
   */
  const runProcess = async () => {
    if (queued.length === 0) {
      showToast('请先添加图片', 'error');
      return;
    }
    setProcessing(true);
    try {
      const options = { strength, outputFormat };
      const count = engine === 'browser'
        ? await runBrowserProcess(options)
        : await runServerProcess(options);
      if (count > 0) {
        clearAllQueued();
        showToast(`处理完成，共 ${count} 张`, 'success');
      }
    } finally {
      setProcessing(false);
      setProgress({ done: 0, total: 0 });
    }
  };

  const downloadOne = (r) => downloadBlob(r.blob, r.outputName);

  const downloadAll = async () => {
    if (results.length === 0) return;
    // 逐张触发下载，浏览器原生支持
    for (const r of results) {
      downloadBlob(r.blob, r.outputName);
      // 间隔一点避免部分浏览器拦截
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };

  const processedCount = useMemo(() => results.filter((r) => r.processed).length, [results]);

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-slate-100">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 truncate">图片去 AI 标识</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">批量上传图片，去除 AI 生图指纹（EXIF / 噪点 / 重采样 / gamma / JPEG 重编码）</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        {/* 选项面板 */}
        <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <ShieldCheck size={14} className="text-teal-500" />
            <span className="font-medium">处理选项</span>
          </div>

          {/* 处理引擎：浏览器（本地/不传图）/ 服务器（sharp + mozjpeg） */}
          <div>
            <div className="text-[11px] text-slate-500 mb-1.5">处理引擎</div>
            <div className="inline-flex rounded-full bg-white border border-slate-200 p-0.5 text-xs">
              <button
                onClick={() => setEngine('browser')}
                className={`px-3 py-1 rounded-full transition inline-flex items-center gap-1 ${
                  engine === 'browser' ? 'bg-teal-500 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Cpu size={11} />
                浏览器
              </button>
              <button
                onClick={() => setEngine('server')}
                className={`px-3 py-1 rounded-full transition inline-flex items-center gap-1 ${
                  engine === 'server' ? 'bg-teal-500 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Server size={11} />
                服务器
              </button>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 leading-5">
              {engine === 'browser'
                ? '本地 Canvas 处理，图片不上传；大图稍慢，JPEG 编码用浏览器内置。'
                : '上传至服务器用 sharp + mozjpeg 处理，压缩纹理更贴近截屏；受 20MB / 20 张上限。'}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-slate-500 mb-1.5">强度档位</div>
              <div className="inline-flex rounded-full bg-white border border-slate-200 p-0.5 text-xs">
                {[
                  { key: 'light', label: '轻度' },
                  { key: 'standard', label: '标准' },
                  { key: 'strong', label: '强' },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setStrength(t.key)}
                    className={`px-3 py-1 rounded-full transition ${
                      strength === t.key ? 'bg-teal-500 text-white' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-1.5">输出格式</div>
              <div className="inline-flex rounded-full bg-white border border-slate-200 p-0.5 text-xs">
                {[
                  { key: 'keep', label: '保持源格式' },
                  { key: 'jpeg', label: 'JPEG' },
                  { key: 'png', label: 'PNG' },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setOutputFormat(t.key)}
                    className={`px-3 py-1 rounded-full transition ${
                      outputFormat === t.key ? 'bg-teal-500 text-white' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 leading-5">
            强度说明：轻度 = 仅清元数据 + 微 gamma；标准 = 元数据 + 亮度/饱和度抖动 + 重采样 + 轻颗粒；强 = 全量（明显颗粒）。
          </div>
        </div>

        {/* 上传区 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-600 font-medium">待处理（{queued.length}/{MAX_BATCH}）</div>
            {queued.length > 0 && (
              <button
                onClick={clearAllQueued}
                className="text-[11px] text-slate-400 hover:text-red-500 transition"
              >
                清空
              </button>
            )}
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center bg-white hover:border-teal-300 transition"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleInputChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!canAddMore || processing}
              className="inline-flex items-center gap-1 text-sm px-4 py-1.5 rounded-full bg-teal-500 text-white hover:bg-teal-600 transition disabled:opacity-50"
            >
              <Upload size={14} />
              选择图片
            </button>
            <div className="text-[11px] text-slate-400 mt-2">
              或直接把图片拖到这里。单张 ≤ 20MB，最多 {MAX_BATCH} 张。
            </div>
          </div>

          {queued.length > 0 && (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mt-3">
              {queued.map((q, idx) => (
                <div key={idx} className="relative rounded-xl overflow-hidden bg-slate-100 aspect-square">
                  {q.previewUrl ? (
                    <img src={q.previewUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <ImageIcon size={18} />
                    </div>
                  )}
                  <button
                    onClick={() => removeQueued(idx)}
                    disabled={processing}
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition"
                    title="移除"
                  >
                    <X size={10} />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[10px] px-1.5 py-0.5 truncate">
                    {q.file.name}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-3">
            {processing && progress.total > 0 && (
              <span className="text-xs text-slate-500">
                处理中 {progress.done}/{progress.total}
              </span>
            )}
            <button
              onClick={runProcess}
              disabled={processing || queued.length === 0}
              className="text-sm px-5 py-1.5 rounded-full bg-slate-900 text-white hover:bg-slate-700 transition inline-flex items-center gap-2 disabled:opacity-50"
            >
              {processing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              开始处理
            </button>
          </div>
        </div>

        {/* 结果区 */}
        {results.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-slate-600 font-medium">
                处理结果（{results.length} 张 · 实际处理 {processedCount}）
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadAll}
                  className="text-[11px] px-3 py-1 rounded-full bg-teal-500 text-white hover:bg-teal-600 transition inline-flex items-center gap-1"
                >
                  <Download size={12} />
                  全部下载
                </button>
                <button
                  onClick={clearAllResults}
                  className="text-[11px] text-slate-400 hover:text-red-500 transition inline-flex items-center gap-1"
                >
                  <Trash2 size={12} />
                  清空
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {results.map((r, idx) => (
                <div key={idx} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                  <div className="w-full aspect-square bg-slate-100 overflow-hidden">
                    {r.previewUrl ? (
                      <img src={r.previewUrl} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <ImageIcon size={20} />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-xs font-medium text-slate-800 truncate" title={r.outputName}>
                      {r.outputName}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                      <span>{formatSize(r.size)}</span>
                      <span className={r.processed ? 'text-teal-500' : 'text-amber-500'}>
                        {r.processed ? '已处理' : '未处理'}
                      </span>
                    </div>
                    <button
                      onClick={() => downloadOne(r)}
                      className="mt-2 w-full text-[11px] px-3 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 transition inline-flex items-center justify-center gap-1"
                    >
                      <Download size={10} />
                      下载
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AntiDetectionView;
