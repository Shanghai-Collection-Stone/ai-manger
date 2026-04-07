import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Image as ImageIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { chatService } from './chatService';

const toTextPreview = (value) => {
  const s = String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_\-\[\]\(\)`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, 180);
};

const readMarkdown = (article) => {
  const content = article?.contentJson;
  if (!content || typeof content !== 'object') return '';
  const md = content['markdown'];
  return typeof md === 'string' ? md : '';
};

const readImages = (article) => {
  const urls = Array.isArray(article?.imageUrls) ? article.imageUrls : [];
  return urls
    .map((x) => String(x ?? '').trim())
    .filter((x) => x.length > 0)
    .slice(0, 9);
};

const readImage = (article) => {
  const images = readImages(article);
  return images[0] || '';
};

const CanvasFeedView = ({ canvasId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [canvas, setCanvas] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const pollingRef = useRef(null);

  const loadCanvas = useCallback(async () => {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return null;
    try {
      const res = await chatService.getCanvas(cid);
      return res?.canvas && typeof res.canvas === 'object' ? res.canvas : null;
    } catch {
      return null;
    }
  }, [canvasId]);

  useEffect(() => {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return;
    setLoading(true);
    loadCanvas()
      .then((next) => {
        setCanvas(next);
        const firstId = Array.isArray(next?.articles) && next.articles.length > 0
          ? next.articles[0]?.id
          : null;
        setSelectedId(firstId ?? null);
      })
      .finally(() => setLoading(false));
  }, [canvasId, loadCanvas]);

  /* generating 时每 5 秒轮询，直到 canvas 完成 */
  useEffect(() => {
    if (canvas?.status !== 'generating') {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }
    pollingRef.current = setInterval(async () => {
      const next = await loadCanvas();
      if (!next) return;
      setCanvas(next);
      if (next.status !== 'generating') clearInterval(pollingRef.current);
    }, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [canvas?.status, loadCanvas]);

  const articles = useMemo(
    () => (Array.isArray(canvas?.articles) ? canvas.articles : []),
    [canvas],
  );

  /* 进度统计（generating 阶段实时聚合） */
  const doneCount = useMemo(() => articles.filter((a) => a.status === 'done' || a.status === 'requires_human').length, [articles]);
  const failedCount = useMemo(() => articles.filter((a) => a.status === 'failed').length, [articles]);
  const isGenerating = canvas?.status === 'generating';
  const selected = useMemo(
    () =>
      articles.find((a) => String(a?.id ?? '') === String(selectedId ?? '')) ||
      articles[0] ||
      null,
    [articles, selectedId],
  );
  const selectedImages = useMemo(() => readImages(selected), [selected]);

  useEffect(() => {
    setDetailImageIndex(0);
  }, [selectedId]);

  const activeImage =
    selectedImages.length > 0
      ? selectedImages[Math.max(0, Math.min(detailImageIndex, selectedImages.length - 1))]
      : '';

  const goPrevImage = () => {
    if (selectedImages.length <= 1) return;
    setDetailImageIndex((prev) =>
      prev <= 0 ? selectedImages.length - 1 : prev - 1,
    );
  };

  const goNextImage = () => {
    if (selectedImages.length <= 1) return;
    setDetailImageIndex((prev) =>
      prev >= selectedImages.length - 1 ? 0 : prev + 1,
    );
  };

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      {/* Header matching other tools */}
      <div className="flex flex-col border-b border-slate-100 bg-white/90">
        <div className="flex items-center gap-2 p-3 md:p-4">
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
          >
            <X size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900 truncate">
              {canvas?.topic || `Canvas #${canvasId}`}
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
              <span>{`Canvas#${canvas?.id ?? canvasId} · ${articles.length} 篇`}</span>
              {isGenerating && (
                <span className="inline-flex items-center gap-0.5 text-amber-500">
                  <Loader2 size={9} className="animate-spin" />
                  {doneCount > 0 ? `已完成 ${doneCount}/${articles.length}` : '生成中…'}
                  {failedCount > 0 && (
                    <span className="text-red-400 ml-1">{failedCount} 篇失败</span>
                  )}
                </span>
              )}
              {!isGenerating && failedCount > 0 && (
                <span className="text-red-400">{failedCount} 篇失败</span>
              )}
            </p>
          </div>
        </div>
        {/* 进度条：generating 时显示 */}
        {isGenerating && articles.length > 0 && (
          <div className="h-0.5 bg-slate-100 mx-4 mb-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-all duration-500 rounded-full"
              style={{ width: `${Math.max(4, (doneCount / articles.length) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex-1 min-h-0 flex items-center justify-center bg-[#f7f8fa]">
          <Loader2 size={26} className="animate-spin text-slate-400" />
        </div>
      ) : articles.length === 0 ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-slate-500 bg-[#f7f8fa]">
          <ImageIcon size={24} className="text-slate-300 mb-2" />
          <p className="text-sm">
            {canvas?.status === 'generating' ? '文章生成中，请稍候…' : '该 Canvas 暂无文章'}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[320px_1fr] bg-[#f7f8fa]">
          <style>{`
            .canvas-hide-scrollbar::-webkit-scrollbar { display: none; }
            .canvas-hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          `}</style>
          <div
            className="md:border-r border-b md:border-b-0 border-slate-100 overflow-x-auto md:overflow-y-auto p-3 flex md:flex-col gap-3 bg-white shrink-0 canvas-hide-scrollbar"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {articles.map((a) => {
              const active = String(a?.id ?? '') === String(selected?.id ?? '');
              const img = readImage(a);
              const preview = toTextPreview(readMarkdown(a));
              const isPending = a.status === 'pending' || !a.status;
              const isFailed = a.status === 'failed';
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`shrink-0 w-44 md:w-full flex flex-col text-left rounded-2xl overflow-hidden border transition ${
                    active
                      ? 'border-rose-300 shadow-md shadow-rose-100'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* 封面图/占位：pending 时显示骨架动画 */}
                  <div className="h-28 md:h-36 bg-slate-100 w-full shrink-0 flex items-center justify-center overflow-hidden relative">
                    {img ? (
                      <img src={img} alt={a.title || ''} className="max-w-full max-h-full object-contain" />
                    ) : isPending ? (
                      <div className="w-full h-full bg-slate-200/70 animate-pulse" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <ImageIcon size={20} />
                      </div>
                    )}
                    {/* 状态角标 */}
                    {(isPending || isFailed) && (
                      <span className={`absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                        isFailed ? 'bg-red-100 text-red-500' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {isFailed ? '失败' : '生成中'}
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 md:p-3 bg-white flex-1 w-full flex flex-col">
                    <h4 className="text-xs md:text-sm font-semibold text-slate-900 line-clamp-2">
                      {a.title || `文章 #${a.id}`}
                    </h4>
                    <p className="text-[10px] md:text-xs text-slate-500 mt-1 line-clamp-2 flex-1">
                      {preview || (isPending ? '正文生成中…' : '暂无正文预览')}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto p-3 md:p-5 bg-[#f7f8fa] min-h-0">
            {selected ? (
              <div className="max-w-2xl mx-auto pb-6">
                <div className="rounded-3xl overflow-hidden border border-slate-100 bg-white shadow-sm">
                  {/* Detail image carousel area */}
                  <div
                    className="relative h-48 md:h-60 bg-slate-100 flex items-center justify-center overflow-hidden"
                    onTouchStart={(e) => {
                      const p = e.touches?.[0]?.clientX;
                      if (typeof p === 'number') setTouchStartX(p);
                    }}
                    onTouchEnd={(e) => {
                      const endX = e.changedTouches?.[0]?.clientX;
                      if (typeof endX !== 'number' || typeof touchStartX !== 'number') {
                        setTouchStartX(null);
                        return;
                      }
                      const diff = endX - touchStartX;
                      if (Math.abs(diff) >= 35) {
                        if (diff > 0) goPrevImage();
                        else goNextImage();
                      }
                      setTouchStartX(null);
                    }}
                  >
                    {activeImage ? (
                      <img src={activeImage} alt={selected.title || ''} className="max-w-full max-h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <ImageIcon size={24} />
                      </div>
                    )}
                    {selectedImages.length > 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={goPrevImage}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/45 text-white flex items-center justify-center"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={goNextImage}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/45 text-white flex items-center justify-center"
                        >
                          <ChevronRight size={16} />
                        </button>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/45 text-white text-[10px]">
                          {detailImageIndex + 1}/{selectedImages.length}
                        </div>
                      </>
                    ) : null}
                  </div>
                  <div className="p-4 md:p-5">
                    <h4 className="text-base md:text-lg font-semibold text-slate-900">
                      {selected.title || `文章 #${selected.id}`}
                    </h4>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(Array.isArray(selected.tags) ? selected.tags : []).slice(0, 12).map((tag, idx) => (
                        <span
                          key={`${tag}-${idx}`}
                          className="px-2 py-0.5 text-[11px] rounded-full bg-rose-50 text-rose-500"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap leading-7 mt-4">
                      {readMarkdown(selected) || '暂无正文'}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default CanvasFeedView;
