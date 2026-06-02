import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  X,
  Loader2,
  Images,
  Download,
  CheckSquare,
  Square,
  RefreshCw,
  Clock,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { chatService } from './chatService';
import { showToast } from './blocks/shared';
import CoverRegenerateDialog from './CoverRegenerateDialog';

/* ━━━ 版式标签映射 ━━━ */
const LAYOUT_LABEL = {
  'portrait-cover-5inner': '竖封面 + 5 内页',
  'collage-cover-5inner': '拼图封面 + 5 内页',
  'collage-cover-5collage': '拼图封面 + 5 拼图内页',
  'portrait-cover-2inner-collage': '竖封面 + 内页拼图',
  'collage-cover-2portrait-inner': '横拼图封面 + 竖内页',
};

/* ━━━ 角色标签映射 ━━━ */
const ROLE_LABEL = {
  cover: '封面',
  'inner-1': '内页1',
  'inner-2': '内页2',
  'inner-3': '内页3',
  'inner-4': '内页4',
  'inner-5': '内页5',
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ImageLightbox 图片预览弹窗
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * @description 全屏图片预览，支持左右切换
 * @keyword-en image lightbox preview
 */
const ImageLightbox = ({ images, startIndex, onClose }) => {
  const [idx, setIdx] = useState(startIndex ?? 0);
  const img = images[idx];

  const prev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const next = () => setIdx((i) => (i + 1) % images.length);

  /* 键盘导航 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    /* 遮罩层 */
    <div
      className="fixed inset-0 z-[80] bg-black/85 flex flex-col items-center justify-center"
      onClick={onClose}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      {/* 顶部关闭按钮 + 角色标签 */}
      <div className="absolute top-3 right-3 z-10">
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
        >
          <X size={20} />
        </button>
      </div>
      <div className="absolute top-3 left-3 z-10">
        <span className="px-2 py-1 rounded-full bg-black/50 text-white text-xs">
          {ROLE_LABEL[img?.role] || img?.role} · {idx + 1}/{images.length}
        </span>
      </div>

      {/* 主图片区域 */}
      <div
        className="relative flex items-center justify-center max-w-full max-h-full px-12"
        onClick={(e) => e.stopPropagation()}
      >
        {images.length > 1 && (
          <button
            type="button"
            onClick={prev}
            className="absolute left-0 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          >
            <ChevronLeft size={24} />
          </button>
        )}
        {img?.url || img?.thumbUrl ? (
          <img
            src={img.url || img.thumbUrl}
            alt={ROLE_LABEL[img.role] || ''}
            className="max-h-[80dvh] max-w-full object-contain rounded-xl shadow-2xl"
          />
        ) : (
          <div className="w-64 h-64 rounded-xl bg-slate-700 flex items-center justify-center">
            <Images size={36} className="text-slate-500" />
          </div>
        )}
        {images.length > 1 && (
          <button
            type="button"
            onClick={next}
            className="absolute right-0 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* 底部缩略图条 */}
      {images.length > 1 && (
        <div
          className="flex gap-2 mt-4 px-4 overflow-x-auto overscroll-x-contain"
          data-horizontal-scroll="true"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((im, i) => (
            <button
              key={im.imageId ?? i}
              type="button"
              onClick={() => setIdx(i)}
              className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition ${
                i === idx ? 'border-white' : 'border-transparent opacity-60'
              }`}
            >
              <img
                src={im.thumbUrl || im.url}
                alt=""
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ━━━━━━━━━━━━━━━━━━━━
   GroupCard 单图组卡片
   ━━━━━━━━━━━━━━━━━━━━ */

/**
 * @description 单个图片组卡片，展示版式、图片缩略图和角色标签；点击图片触发预览
 * @keyword-en image group card component
 */
const GroupCard = ({ group, selected, onToggle, onImageClick, onDeleteImage, deletingImageId, onRegenerateCover }) => {
  const images = Array.isArray(group.images) ? group.images : [];
  const isFailed = group.status === 'failed';

  return (
    /* 卡片容器：选中时边框高亮 */
    <div
      className={`rounded-2xl border overflow-hidden transition-all ${
        selected
          ? 'border-rose-400 shadow-lg shadow-rose-100'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* 卡片顶部：文章标题 + 版式 + 选择框 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-100">
        <button
          type="button"
          onClick={() => onToggle(group.id)}
          className="shrink-0 text-slate-400 hover:text-rose-500 transition"
          disabled={isFailed}
          aria-label={selected ? '取消选择' : '选择该图组'}
        >
          {selected ? (
            <CheckSquare size={16} className="text-rose-500" />
          ) : (
            <Square size={16} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-800 truncate">
            {group.articleTitle || `图组 #${group.id}`}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {LAYOUT_LABEL[group.layout] || group.layout}
            {isFailed && ' · 图片不足，生成失败'}
          </p>
        </div>
      </div>

      {/* 图片网格：按版式排列 */}
      <div className="grid grid-cols-3 gap-1 p-2 bg-[#f8f9fa]">
        {images.map((img, idx) => {
          const isImgDeleting = deletingImageId === img.imageId;
          return (
            /* 单张图片缩略图 + 角色标签 + 删除按钮 */
            <div
              key={img.imageId ?? idx}
              className="relative aspect-square cursor-pointer group"
              onClick={() => typeof onImageClick === 'function' && onImageClick(images, idx)}
            >
              {img.thumbUrl || img.url ? (
                <img
                src={img.thumbUrl || img.url}
                alt={ROLE_LABEL[img.role] || img.role}
                className="w-full h-full object-cover rounded-lg hover:brightness-90 transition"
              />
            ) : (
              <div className="w-full h-full rounded-lg bg-slate-200 flex items-center justify-center">
                <Images size={14} className="text-slate-400" />
              </div>
            )}
            {/* 角色标签 */}
            <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded text-[9px] bg-black/50 text-white pointer-events-none">
              {ROLE_LABEL[img.role] || img.role}
            </span>
            {/* 拼图标记 */}
            {img.isCollage && (
              <span
                className={`absolute top-1 ${img.role === 'cover' && typeof onRegenerateCover === 'function' ? 'right-7' : 'right-1'} w-3 h-3 rounded-full bg-indigo-500 pointer-events-none`}
                title="拼图"
              />
            )}
            {img.role === 'cover' && typeof onRegenerateCover === 'function' && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRegenerateCover(group); }}
                title="重新生成封面"
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-amber-500 transition"
              >
                <Sparkles size={9} />
              </button>
            )}
            {/* 删除图片按钮 — hover 时显示 */}
            {typeof onDeleteImage === 'function' && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteImage(group.id, img.imageId); }}
                disabled={isImgDeleting}
                title="删除图片"
                className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition"
              >
                {isImgDeleting ? <Loader2 size={8} className="animate-spin" /> : <Trash2 size={8} />}
              </button>
            )}
          </div>
          );
        })}
        {/* 图片数量不足时的占位格 */}
        {Array.from({ length: Math.max(0, 6 - images.length) }).map((_, i) => (
          <div
            key={`placeholder-${i}`}
            className="aspect-square rounded-lg bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center"
          >
            <Images size={12} className="text-slate-300" />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ImageGroupCanvasView 主组件
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * @description 图片组 Canvas 专属视图，以文章为单位展示图组，支持选择和批量下载图片
 * @param {{ canvasId: number|string, onClose: () => void }} props
 * @keyword-en ImageGroupCanvasView, image-group, canvas, download
 */
const ImageGroupCanvasView = ({ canvasId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [canvas, setCanvas] = useState(null);
  /** @description 已选中的图组 id 集合 */
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  /** @description 是否正在轮询（generating 状态） */
  const [polling, setPolling] = useState(false);
  /** @description 灯箱状态：{ images, startIndex } */
  const [lightbox, setLightbox] = useState(null);
  /** @description 正在删除中的图片 imageId */
  const [deletingImageId, setDeletingImageId] = useState(null);
  /** @description 封面重生成弹窗目标图组 */
  const [coverDialogTarget, setCoverDialogTarget] = useState(null);
  /** @description 封面重生成提交状态 */
  const [coverRegenerating, setCoverRegenerating] = useState(false);
  /** @description 直接设封面提交状态 */
  const [coverSelecting, setCoverSelecting] = useState(false);
  const canvasTouchStartRef = useRef(null);

  /* 加载 canvas 数据 */
  const loadCanvas = useCallback(async () => {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return;
    try {
      const res = await chatService.getCanvas(cid);
      const next = res?.canvas && typeof res.canvas === 'object' ? res.canvas : null;
      setCanvas(next);
      return next;
    } catch {
      return null;
    }
  }, [canvasId]);

  useEffect(() => {
    const cid = Number(canvasId);
    if (!Number.isFinite(cid)) return;
    setLoading(true);
    loadCanvas().finally(() => setLoading(false));
  }, [canvasId, loadCanvas]);

  /* 如果是 generating 状态，每 5 秒轮询一次 */
  useEffect(() => {
    if (canvas?.status !== 'generating') {
      setPolling(false);
      return;
    }
    setPolling(true);
    const timer = setInterval(async () => {
      const next = await loadCanvas();
      if (next?.status !== 'generating') {
        clearInterval(timer);
        setPolling(false);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [canvas?.status, loadCanvas]);

  const imageGroups = useMemo(
    () => (Array.isArray(canvas?.imageGroups) ? canvas.imageGroups : []),
    [canvas],
  );

  /* 是否全选 */
  const allSelected = imageGroups.length > 0 && selectedIds.size === imageGroups.filter((g) => g.status === 'done').length;

  /* 切换单组选中 */
  const toggleGroup = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* 全选/取消全选 */
  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(imageGroups.filter((g) => g.status === 'done').map((g) => g.id)));
    }
  }, [allSelected, imageGroups]);

  /* 下载选中图片（逐图打开新标签页） */
  const handleDownload = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    try {
      const selected = imageGroups.filter((g) => selectedIds.has(g.id));
      for (const group of selected) {
        for (const img of group.images ?? []) {
          if (!img.url) continue;
          const a = document.createElement('a');
          a.href = img.url;
          a.download = `canvas-${canvas?.id ?? ''}-group${group.id}-${img.role}.jpg`;
          a.target = '_blank';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // 避免触发弹窗拦截
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    } finally {
      setDownloading(false);
    }
  }, [selectedIds, imageGroups, canvas]);

  const isGenerating = canvas?.status === 'generating';

  /**
   * @description 记录图组 Canvas 详情层触摸起点并阻断冒泡，避免外层全局 swipe 被误触发。
   * @param {React.TouchEvent} event - 触摸事件。
   * @returns {void}
   * @keyword-cn Canvas详情, 禁止左右滑动冒泡
   * @keyword-en canvas-detail-touch
   * @keyword-en block-horizontal-swipe
   */
  const handleCanvasTouchStart = useCallback((event) => {
    const touch = event.touches?.[0];
    canvasTouchStartRef.current = touch
      ? { x: touch.clientX, y: touch.clientY }
      : null;
    event.stopPropagation();
  }, []);

  /**
   * @description 图组 Canvas 详情层内横向手势只在本层处理，不传给外层全局 swipe。
   * @param {React.TouchEvent} event - 触摸事件。
   * @returns {void}
   * @keyword-cn Canvas详情, 禁止左右滑动冒泡
   * @keyword-en canvas-detail-touch
   * @keyword-en block-horizontal-swipe
   */
  const handleCanvasTouchMove = useCallback((event) => {
    event.stopPropagation();
    const target = event.target;
    if (target?.closest?.('[data-horizontal-scroll="true"]')) return;
    const start = canvasTouchStartRef.current;
    const touch = event.touches?.[0];
    if (!start || !touch) return;
    const dx = Math.abs(touch.clientX - start.x);
    const dy = Math.abs(touch.clientY - start.y);
    if (dx > 8 && dx > dy) {
      event.preventDefault();
    }
  }, []);

  /**
   * @description 清理图组 Canvas 详情层触摸状态并阻断触摸结束事件冒泡。
   * @param {React.TouchEvent} event - 触摸事件。
   * @returns {void}
   * @keyword-cn Canvas详情, 禁止左右滑动冒泡
   * @keyword-en canvas-detail-touch
   * @keyword-en block-horizontal-swipe
   */
  const handleCanvasTouchEnd = useCallback((event) => {
    canvasTouchStartRef.current = null;
    event.stopPropagation();
  }, []);

  /**
   * @description 打开图片组封面重生成弹窗，保留目标图组上下文。
   * @keyword-cn 封面重生成, 图片组封面
   * @keyword-en cover-regenerate
   * @keyword-en image-group-cover-only
   */
  const openGroupCoverRegenerateDialog = useCallback((group) => {
    if (!group || isGenerating) return;
    setCoverDialogTarget(group);
  }, [isGenerating]);

  /**
   * @description 提交图片组封面重生成请求，只让后端替换目标图组 role=cover 图片。
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en image-group-cover-only
   */
  const handleRegenerateGroupCover = useCallback(async (payload) => {
    if (!coverDialogTarget?.id) return;
    setCoverRegenerating(true);
    try {
      const res = await chatService.regenerateCanvasImageGroupCover(
        Number(canvasId),
        coverDialogTarget.id,
        payload,
      );
      if (res?.canvas) {
        setCanvas(res.canvas);
        setCoverDialogTarget(null);
        showToast('封面已开始重新生成', 'success');
      } else {
        showToast('封面重生成启动失败', 'error');
      }
    } finally {
      setCoverRegenerating(false);
    }
  }, [canvasId, coverDialogTarget]);

  /**
   * @description 直接将弹窗中第一张已选图库图片设为当前图组封面。
   * @keyword-cn 直接设为封面, 图片组封面
   * @keyword-en cover-select
   * @keyword-en image-group-cover-only
   */
  const handleSelectGroupCover = useCallback(async (payload) => {
    if (!coverDialogTarget?.id) return;
    setCoverSelecting(true);
    try {
      const res = await chatService.selectCanvasImageGroupCover(
        Number(canvasId),
        coverDialogTarget.id,
        payload,
      );
      if (res?.canvas) {
        setCanvas(res.canvas);
        setCoverDialogTarget(null);
        showToast('已设为封面', 'success');
      } else {
        showToast('设置封面失败', 'error');
      }
    } finally {
      setCoverSelecting(false);
    }
  }, [canvasId, coverDialogTarget]);

  /** 删除图片组中的一张图片 */
  const handleDeleteImage = useCallback(async (groupId, imageId) => {
    if (!window.confirm('确定要删除这张图片吗？')) return;
    setDeletingImageId(imageId);
    try {
      const res = await chatService.deleteCanvasGroupImage(Number(canvasId), groupId, imageId);
      if (res.canvas) setCanvas(res.canvas);
    } finally {
      setDeletingImageId(null);
    }
  }, [canvasId]);

  return (
    /* 主容器 */
    <div
      className="h-full flex flex-col bg-white animate-fade-in overscroll-x-contain"
      onTouchStart={handleCanvasTouchStart}
      onTouchMove={handleCanvasTouchMove}
      onTouchEnd={handleCanvasTouchEnd}
      onTouchCancel={handleCanvasTouchEnd}
    >
      {/* 顶部标题栏 */}
      <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90 shrink-0">
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
          aria-label="关闭"
        >
          <X size={22} />
        </button>
        <div className="min-w-0 flex-1 pr-2">
          <h3 className="text-sm font-bold text-slate-900 truncate flex items-center gap-1.5">
            {canvas?.topic || `图组看板 #${canvasId}`}
            {isGenerating && (
              <Clock size={12} className="text-amber-500 animate-pulse" />
            )}
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {`Canvas#${canvas?.id ?? canvasId} · ${imageGroups.length} 组 · ${
              isGenerating ? '生成中…' : canvas?.status || 'unknown'
            }`}
          </p>
        </div>
        {/* 刷新按钮（generating 时显示） */}
        {isGenerating && (
          <button
            type="button"
            onClick={() => loadCanvas()}
            className="p-2 hover:bg-slate-100 rounded-full transition text-amber-500"
            title="手动刷新"
          >
            <RefreshCw size={16} className={polling ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* 操作栏：全选 + 批量下载 */}
      {imageGroups.length > 0 && !isGenerating && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-100 bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition"
          >
            {allSelected ? (
              <CheckSquare size={14} className="text-rose-500" />
            ) : (
              <Square size={14} />
            )}
            {allSelected ? '取消全选' : '全选'}
          </button>
          <span className="text-slate-300">|</span>
          <button
            type="button"
            onClick={handleDownload}
            disabled={selectedIds.size === 0 || downloading}
            className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {downloading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            下载选中 ({selectedIds.size} 组)
          </button>
        </div>
      )}

      {/* 内容区 */}
      {loading ? (
        /* 加载中 */
        <div className="flex-1 flex items-center justify-center bg-[#f7f8fa]">
          <Loader2 size={26} className="animate-spin text-slate-400" />
        </div>
      ) : isGenerating && imageGroups.length === 0 ? (
        /* 生成中空状态 */
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-[#f7f8fa] gap-3">
          <Loader2 size={28} className="animate-spin text-amber-400" />
          <p className="text-sm font-medium text-amber-600">图片组生成中，请稍候…</p>
          <p className="text-xs text-slate-400">每 5 秒自动刷新</p>
        </div>
      ) : imageGroups.length === 0 ? (
        /* 无图组 */
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-[#f7f8fa]">
          <Images size={24} className="text-slate-300 mb-2" />
          <p className="text-sm">该 Canvas 暂无图片组</p>
        </div>
      ) : (
        /* 图组网格 */
        <div className="flex-1 overflow-y-auto p-3 md:p-4 bg-[#f7f8fa]">
          {/* 生成中提示条 */}
          {isGenerating && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
              <Loader2 size={14} className="animate-spin shrink-0" />
              <p className="text-xs">图片组正在生成中，已显示部分结果，每 5 秒自动更新…</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {imageGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                selected={selectedIds.has(group.id)}
                onToggle={toggleGroup}
                onImageClick={(images, idx) => setLightbox({ images, startIndex: idx })}
                onDeleteImage={handleDeleteImage}
                deletingImageId={deletingImageId}
                onRegenerateCover={isGenerating ? undefined : openGroupCoverRegenerateDialog}
              />
            ))}
          </div>
        </div>
      )}

      {/* 图片灯箱：点击图片预览 */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          startIndex={lightbox.startIndex}
          onClose={() => setLightbox(null)}
        />
      )}

      <CoverRegenerateDialog
        open={!!coverDialogTarget}
        title="重新生成图组封面"
        currentCoverUrl={
          (coverDialogTarget?.images ?? []).find((img) => img.role === 'cover')?.url
          || (coverDialogTarget?.images ?? []).find((img) => img.role === 'cover')?.thumbUrl
          || ''
        }
        submitting={coverRegenerating}
        selecting={coverSelecting}
        onClose={() => setCoverDialogTarget(null)}
        onSubmit={handleRegenerateGroupCover}
        onSelectCover={handleSelectGroupCover}
      />
    </div>
  );
};

export default ImageGroupCanvasView;
