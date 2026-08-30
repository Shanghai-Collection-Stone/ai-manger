import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Image as ImageIcon, ChevronLeft, ChevronRight, Trash2, Pencil, Check, Plus, Library, Sparkles, Download, Copy, ClipboardList } from 'lucide-react';
import { chatService } from './chatService';
import { articleLibraryService, describeLibraryError } from './articleLibraryService';
import { showToast } from './blocks/shared';
import CoverRegenerateDialog from './CoverRegenerateDialog';

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

/**
 * @description 图文 Canvas 图片放大预览弹窗，支持左右切换和缩略图定位。
 * @param {{ images: string[]; startIndex?: number; title?: string; onClose: () => void }} props - 预览参数。
 * @returns {JSX.Element | null} 图片预览弹窗。
 * @keyword-cn 图片放大, 图文Canvas
 * @keyword-en image-lightbox
 * @keyword-en article-canvas-preview
 */
const ImageLightbox = ({ images, startIndex = 0, title = '', onClose }) => {
  const safeImages = useMemo(
    () =>
      (Array.isArray(images) ? images : [])
        .map((url) => String(url ?? '').trim())
        .filter((url) => url.length > 0),
    [images],
  );
  const [idx, setIdx] = useState(startIndex);

  useEffect(() => {
    const max = Math.max(0, safeImages.length - 1);
    setIdx(Math.max(0, Math.min(Number(startIndex) || 0, max)));
  }, [safeImages.length, startIndex]);

  /**
   * @description 在图片预览弹窗内切到上一张图片。
   * @returns {void}
   * @keyword-cn 图片放大, 图文Canvas
   * @keyword-en image-lightbox
   * @keyword-en article-canvas-preview
   */
  const goPrev = useCallback(() => {
    if (safeImages.length <= 1) return;
    setIdx((current) =>
      current <= 0 ? safeImages.length - 1 : current - 1,
    );
  }, [safeImages.length]);

  /**
   * @description 在图片预览弹窗内切到下一张图片。
   * @returns {void}
   * @keyword-cn 图片放大, 图文Canvas
   * @keyword-en image-lightbox
   * @keyword-en article-canvas-preview
   */
  const goNext = useCallback(() => {
    if (safeImages.length <= 1) return;
    setIdx((current) =>
      current >= safeImages.length - 1 ? 0 : current + 1,
    );
  }, [safeImages.length]);

  useEffect(() => {
    /**
     * @description 处理图片预览弹窗键盘快捷键。
     * @param {KeyboardEvent} event - 键盘事件。
     * @returns {void}
     * @keyword-cn 图片放大, 键盘切换
     * @keyword-en image-lightbox
     * @keyword-en keyboard-navigation
     */
    const handleKeyDown = (event) => {
      if (event.key === 'ArrowLeft') goPrev();
      if (event.key === 'ArrowRight') goNext();
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, onClose]);

  const activeImage = safeImages[idx] || '';
  if (!activeImage) return null;

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/85 flex flex-col items-center justify-center p-4"
      onClick={onClose}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <div className="absolute top-3 right-3 z-10">
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          aria-label="关闭"
        >
          <X size={20} />
        </button>
      </div>
      <div className="absolute top-3 left-3 z-10 max-w-[70vw]">
        <span className="inline-flex px-2 py-1 rounded-full bg-black/50 text-white text-xs truncate">
          {title || '图片预览'} · {idx + 1}/{safeImages.length}
        </span>
      </div>

      <div
        className="relative flex items-center justify-center max-w-full max-h-full px-10"
        onClick={(event) => event.stopPropagation()}
      >
        {safeImages.length > 1 && (
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-0 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
            aria-label="上一张"
          >
            <ChevronLeft size={24} />
          </button>
        )}
        <img
          src={activeImage}
          alt={title}
          className="max-h-[80dvh] max-w-full object-contain rounded-xl shadow-2xl"
        />
        {safeImages.length > 1 && (
          <button
            type="button"
            onClick={goNext}
            className="absolute right-0 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
            aria-label="下一张"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {safeImages.length > 1 && (
        <div
          className="flex gap-2 mt-4 px-4 max-w-full overflow-x-auto overscroll-x-contain"
          data-horizontal-scroll="true"
          onClick={(event) => event.stopPropagation()}
        >
          {safeImages.map((image, imageIndex) => (
            <button
              key={`${image}-${imageIndex}`}
              type="button"
              onClick={() => setIdx(imageIndex)}
              className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition ${
                imageIndex === idx ? 'border-white' : 'border-transparent opacity-60'
              }`}
              aria-label={`查看第 ${imageIndex + 1} 张`}
            >
              <img src={image} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CanvasFeedView = ({ canvasId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [canvas, setCanvas] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  // 编辑文章正文状态
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  // tag 编辑状态
  const [editingTagsId, setEditingTagsId] = useState(null);
  const [editTags, setEditTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  // 图片删除状态
  const [deletingImageIdx, setDeletingImageIdx] = useState(null);
  // 删除中状态
  const [deletingArticleId, setDeletingArticleId] = useState(null);
  const [deletingCanvas, setDeletingCanvas] = useState(false);
  // 存入文章库弹窗状态：target=null 关闭；target='all' 整份；target={articleId} 单篇
  const [libraryPickerFor, setLibraryPickerFor] = useState(null);
  const [imageDialogTarget, setImageDialogTarget] = useState(null);
  const [imageRegenerating, setImageRegenerating] = useState(false);
  const [imageSelecting, setImageSelecting] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const pollingRef = useRef(null);
  const canvasTouchStartRef = useRef(null);

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

  /**
   * @description 打开图文 Canvas 当前文章图片放大预览。
   * @param {number} startIndex - 初始图片下标。
   * @returns {void}
   * @keyword-cn 图片放大, 图文Canvas
   * @keyword-en image-lightbox
   * @keyword-en article-canvas-preview
   */
  const openArticleImageLightbox = useCallback((startIndex = detailImageIndex) => {
    if (selectedImages.length === 0) return;
    const max = Math.max(0, selectedImages.length - 1);
    setLightbox({
      images: selectedImages,
      startIndex: Math.max(0, Math.min(Number(startIndex) || 0, max)),
      title: selected?.title || '',
    });
  }, [detailImageIndex, selected?.title, selectedImages]);

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

  /**
   * @description 记录 Canvas 详情层触摸起点并阻断冒泡，避免外层卡片/Tab 手势被误触发。
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
   * @description Canvas 详情层内横向手势只在本层处理，不传给外层全局 swipe。
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
   * @description 清理 Canvas 详情层触摸状态并阻断触摸结束事件冒泡。
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

  /** 删除整个 Canvas */
  const handleDeleteCanvas = async () => {
    if (!window.confirm('确定要删除整个 Canvas 吗？此操作不可恢复。')) return;
    setDeletingCanvas(true);
    try {
      const res = await chatService.deleteCanvas(Number(canvasId));
      if (res.deleted) onClose?.();
    } finally {
      setDeletingCanvas(false);
    }
  };

  /** 删除单篇文章 */
  const handleDeleteArticle = async (articleId) => {
    if (!window.confirm('确定要删除这篇文章吗？')) return;
    setDeletingArticleId(articleId);
    try {
      const res = await chatService.deleteCanvasArticle(Number(canvasId), articleId);
      if (res.canvas) {
        setCanvas(res.canvas);
        if (String(selectedId) === String(articleId)) {
          const remaining = res.canvas.articles ?? [];
          setSelectedId(remaining[0]?.id ?? null);
        }
      }
    } finally {
      setDeletingArticleId(null);
    }
  };

  /** 开始编辑文章内容 */
  const handleStartEdit = (article) => {
    setEditingId(article.id);
    setEditContent(readMarkdown(article));
  };

  /** 保存编辑内容 */
  const handleSaveEdit = async (articleId) => {
    setEditSaving(true);
    try {
      const res = await chatService.updateCanvasArticle(Number(canvasId), articleId, {
        contentJson: { markdown: editContent },
      });
      if (res.canvas) setCanvas(res.canvas);
    } finally {
      setEditSaving(false);
      setEditingId(null);
    }
  };

  /** 开始编辑 tag */
  const handleStartEditTags = (article) => {
    setEditingTagsId(article.id);
    setEditTags(Array.isArray(article.tags) ? [...article.tags] : []);
    setTagInput('');
  };

  /** 移除单个 tag */
  const handleRemoveTag = (idx) => {
    setEditTags((prev) => prev.filter((_, i) => i !== idx));
  };

  /** 添加 tag（回车或失焦提交） */
  const handleAddTag = () => {
    const val = tagInput.trim().replace(/^#/, '');
    if (val && !editTags.includes(val)) {
      setEditTags((prev) => [...prev, val]);
    }
    setTagInput('');
  };

  /** 保存 tag */
  const handleSaveTags = async (articleId) => {
    setTagSaving(true);
    try {
      const res = await chatService.updateCanvasArticle(Number(canvasId), articleId, {
        tags: editTags,
      });
      if (res.canvas) setCanvas(res.canvas);
    } finally {
      setTagSaving(false);
      setEditingTagsId(null);
    }
  };

  /**
   * 把 canvas 文章转成文章库入库 payload
   * @keyword-en map canvas article to library payload
   */
  const toLibraryPayload = (article) => ({
    title: article?.title || `文章 #${article?.id ?? ''}`,
    tags: Array.isArray(article?.tags) ? article.tags : [],
    contentJson: article?.contentJson ?? {},
    imageUrls: Array.isArray(article?.imageUrls) ? article.imageUrls : [],
    imageIds: Array.isArray(article?.imageIds) ? article.imageIds : [],
    publishStatus: 'unpublished',
    source: 'canvas',
    sourceRef: { canvasId: Number(canvasId), canvasArticleId: article?.id },
  });

  /**
   * 执行入库（target: 'all' 整份 / { articleId }）
   * @keyword-en put canvas into library single or bulk
   */
  const handleStoreInto = async (libraryId, target) => {
    const batch = target === 'all'
      ? articles.map(toLibraryPayload)
      : [toLibraryPayload(articles.find((a) => a.id === target?.articleId))].filter(
          (x) => x && typeof x.title === 'string',
        );
    if (batch.length === 0) {
      showToast('没有可入库的文章', 'error');
      return;
    }
    const res = await articleLibraryService.putArticles(libraryId, batch);
    if (!res?.items) {
      showToast('入库失败', 'error');
      return;
    }
    showToast(`已入库 ${res.count} 篇`, 'success');
    setLibraryPickerFor(null);
  };

  /** 删除当前预览图 */
  const handleDeleteImage = async (article, imgIdx) => {
    setDeletingImageIdx(imgIdx);
    try {
      const currentUrls = readImages(article);
      const newUrls = currentUrls.filter((_, i) => i !== imgIdx);
      const res = await chatService.updateCanvasArticle(Number(canvasId), article.id, {
        imageUrls: newUrls,
      });
      if (res.canvas) {
        setCanvas(res.canvas);
        // 如果删除的是当前显示图，退回前一张
        setDetailImageIndex((prev) => Math.max(0, prev >= newUrls.length ? newUrls.length - 1 : prev));
      }
    } finally {
      setDeletingImageIdx(null);
    }
  };

  /**
   * @description 复制文本到剪贴板，navigator.clipboard 优先，失败回退 execCommand。
   * @param {string} text - 待复制文本。
   * @param {string} [label] - 提示用途名称。
   * @returns {Promise<void>}
   * @keyword-cn 复制文本, 复制标题正文
   * @keyword-en copy-text
   */
  const copyText = useCallback(async (text, label = '内容') => {
    const value = String(text ?? '');
    if (!value.trim()) {
      showToast(`${label}为空`, 'error');
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast(`${label}已复制`, 'success');
    } catch {
      showToast(`${label}复制失败`, 'error');
    }
  }, []);

  /**
   * @description 下载单个图片地址，优先 fetch→blob→a.download，失败回退直接链接。
   * @param {string} url - 图片地址。
   * @param {string} filename - 下载文件名。
   * @returns {Promise<boolean>} 是否触发下载。
   * @keyword-cn 图片下载, 图文Canvas下载
   * @keyword-en canvas-download, download-image
   */
  const downloadImageUrl = useCallback(async (url, filename) => {
    const src = String(url ?? '').trim();
    if (!src) return false;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
      return true;
    } catch {
      const a = document.createElement('a');
      a.href = src;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    }
  }, []);

  /**
   * @description 逐张下载当前文章的全部配图（封面+内页），文件名按 cover/inner 顺序命名。
   * @param {object} article - Canvas 文章。
   * @returns {Promise<void>}
   * @keyword-cn 图文Canvas下载, 下载全部图片
   * @keyword-en canvas-download, download-article-images
   */
  const downloadArticleImages = useCallback(async (article) => {
    const images = readImages(article);
    if (images.length === 0) {
      showToast('当前文章暂无图片', 'error');
      return;
    }
    const baseName =
      String(article?.title || `canvas-${canvasId}-article-${article?.id ?? ''}`)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .slice(0, 40) || 'image';
    showToast(`开始下载 ${images.length} 张图片`, 'info');
    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      const rawExt = (url.split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i)?.[1] || 'jpg').toLowerCase();
      const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
      const label = i === 0 ? 'cover' : `inner${i}`;
      // eslint-disable-next-line no-await-in-loop
      await downloadImageUrl(url, `${baseName}-${label}.${ext}`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 250));
    }
    showToast('图片下载完成', 'success');
  }, [canvasId, downloadImageUrl]);

  /**
   * @description 打开当前文章指定图片槽位重生成弹窗，并定位到该图片预览。
   * @param {object} article - Canvas 文章。
   * @param {number} imageIndex - 图片下标，0 为封面，1+ 为内页。
   * @returns {void}
   * @keyword-cn 图文内页重生成, 图片槽位重生成
   * @keyword-en article-image-regenerate
   * @keyword-en image-slot-regenerate
   */
  const openArticleImageRegenerateDialog = (article, imageIndex = 0) => {
    if (!article) return;
    const index = Math.max(0, Math.min(Number(imageIndex) || 0, readImages(article).length - 1));
    setSelectedId(article.id);
    setDetailImageIndex(index);
    setImageDialogTarget({ article, imageIndex: index });
  };

  /**
   * @description 提交文章指定图片槽位重生成请求，后端成功响应时 Canvas 已进入 generating。
   * @param {{ imageIds: number[]; prompt?: string }} payload - 参考图和提示词。
   * @returns {Promise<void>}
   * @keyword-cn 图文内页重生成, 图片槽位重生成
   * @keyword-en article-image-regenerate
   * @keyword-en image-slot-regenerate
   */
  const handleRegenerateArticleImage = async (payload) => {
    const article = imageDialogTarget?.article;
    const imageIndex = Number(imageDialogTarget?.imageIndex ?? 0);
    if (!article) return;
    const label = imageIndex === 0 ? '封面' : `内页${imageIndex}`;
    setImageRegenerating(true);
    try {
      const res = await chatService.regenerateCanvasArticleImage(
        Number(canvasId),
        article.id,
        imageIndex,
        payload,
      );
      if (res?.canvas) {
        setCanvas(res.canvas);
        setSelectedId(article.id);
        setDetailImageIndex(imageIndex);
        setImageDialogTarget(null);
        showToast(`${label}已开始重新生成`, 'success');
      } else {
        showToast(`${label}重生成启动失败`, 'error');
      }
    } finally {
      setImageRegenerating(false);
    }
  };

  /**
   * @description 直接将弹窗中第一张已选图库图片替换到当前文章指定图片槽位。
   * @param {{ imageId?: number; imageIds?: number[] }} payload - 选中的图库图片。
   * @returns {Promise<void>}
   * @keyword-cn 图文内页选择, 图片槽位替换
   * @keyword-en article-image-select
   * @keyword-en image-slot-select
   */
  const handleSelectArticleImage = async (payload) => {
    const article = imageDialogTarget?.article;
    const imageIndex = Number(imageDialogTarget?.imageIndex ?? 0);
    if (!article) return;
    const label = imageIndex === 0 ? '封面' : `内页${imageIndex}`;
    setImageSelecting(true);
    try {
      const res = await chatService.selectCanvasArticleImage(
        Number(canvasId),
        article.id,
        imageIndex,
        payload,
      );
      if (res?.canvas) {
        setCanvas(res.canvas);
        setSelectedId(article.id);
        setDetailImageIndex(imageIndex);
        setImageDialogTarget(null);
        showToast(`已设为${label}`, 'success');
      } else {
        showToast(`设置${label}失败`, 'error');
      }
    } finally {
      setImageSelecting(false);
    }
  };

  const dialogArticle = imageDialogTarget?.article;
  const dialogImageIndex = Number(imageDialogTarget?.imageIndex ?? 0);
  const dialogImageLabel = dialogImageIndex === 0 ? '封面' : `内页${dialogImageIndex}`;
  const dialogImages = dialogArticle ? readImages(dialogArticle) : [];
  const dialogCurrentUrl = dialogImages[dialogImageIndex] || '';
  const dialogIsCover = dialogImageIndex === 0;

  return (
    <div
      className="h-full flex flex-col bg-white animate-fade-in overscroll-x-contain"
      onTouchStart={handleCanvasTouchStart}
      onTouchMove={handleCanvasTouchMove}
      onTouchEnd={handleCanvasTouchEnd}
      onTouchCancel={handleCanvasTouchEnd}
    >
      {/* Header 区域 — 返回按钮、标题、删除 Canvas 按钮 */}
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
          {/* 存入文章库（整份） */}
          {!isGenerating && articles.length > 0 && (
            <button
              onClick={() => setLibraryPickerFor('all')}
              title="整份存入文章库"
              className="ml-auto p-2 rounded-full text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition"
            >
              <Library size={16} />
            </button>
          )}
          {/* 删除 Canvas 按钮 */}
          {!isGenerating && (
            <button
              onClick={handleDeleteCanvas}
              disabled={deletingCanvas}
              title="删除 Canvas"
              className={`${articles.length > 0 ? '' : 'ml-auto '}p-2 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition`}
            >
              {deletingCanvas ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </button>
          )}
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
            data-horizontal-scroll="true"
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
              const isDeleting = deletingArticleId === a.id;
              return (
                /* 文章卡片区域 — 封面图 + 标题预览 + 删除按钮 */
                <div
                  key={a.id}
                  className={`shrink-0 w-44 md:w-full flex flex-col text-left rounded-2xl overflow-hidden border transition relative ${
                    active
                      ? 'border-rose-300 shadow-md shadow-rose-100'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <button className="flex flex-col text-left w-full" onClick={() => setSelectedId(a.id)}>
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
                  {/* 删除文章按钮 */}
                  {img && !isPending && !isFailed && !isGenerating && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openArticleImageRegenerateDialog(a, 0); }}
                      title="重新生成封面"
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-rose-500 transition"
                    >
                      <Sparkles size={11} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteArticle(a.id); }}
                    disabled={isDeleting}
                    title="删除文章"
                    className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-red-500 transition"
                  >
                    {isDeleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto p-3 md:p-5 bg-[#f7f8fa] min-h-0">
            {selected ? (
              <div className="max-w-2xl mx-auto pb-6">
                <div className="rounded-3xl overflow-hidden border border-slate-100 bg-white shadow-sm">
                  {/* 图片轮播区域 — 含删除当前图按钮 */}
                  <div
                    className="relative h-48 md:h-60 bg-slate-100 flex items-center justify-center overflow-hidden"
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      const p = e.touches?.[0]?.clientX;
                      if (typeof p === 'number') setTouchStartX(p);
                    }}
                    onTouchMove={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
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
                    onTouchCancel={(e) => {
                      e.stopPropagation();
                      setTouchStartX(null);
                    }}
                  >
                    {activeImage ? (
                      <img
                        src={activeImage}
                        alt={selected.title || ''}
                        title="点击放大"
                        className="max-w-full max-h-full object-contain cursor-zoom-in"
                        onClick={() => openArticleImageLightbox(detailImageIndex)}
                      />
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
                    {/* 删除当前图片按钮 */}
                    {activeImage && !isGenerating && (
                      <button
                        type="button"
                        onClick={() => openArticleImageRegenerateDialog(selected, detailImageIndex)}
                        title={detailImageIndex === 0 ? '重新生成封面' : `重新生成内页${detailImageIndex}`}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-rose-500 transition"
                      >
                        <Sparkles size={12} />
                      </button>
                    )}
                    {activeImage && (
                      <button
                        type="button"
                        onClick={() => handleDeleteImage(selected, detailImageIndex)}
                        disabled={deletingImageIdx === detailImageIndex}
                        title="删除此图"
                        className={`absolute top-2 ${!isGenerating ? 'right-11' : 'right-2'} w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-500 transition`}
                      >
                        {deletingImageIdx === detailImageIndex
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Trash2 size={12} />}
                      </button>
                    )}
                  </div>
                  {/* 文章详情区域 — 标题、标签（含编辑）、正文（含编辑） */}
                  <div className="p-4 md:p-5">
                    <div className="flex items-start gap-2">
                      <h4 className="text-base md:text-lg font-semibold text-slate-900 flex-1">
                        {selected.title || `文章 #${selected.id}`}
                      </h4>
                      {/* 复制标题 */}
                      {editingId !== selected.id && (
                        <button
                          onClick={() => copyText(selected.title || '', '标题')}
                          title="复制标题"
                          className="p-1.5 rounded-full text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition shrink-0"
                        >
                          <Copy size={14} />
                        </button>
                      )}
                      {/* 复制正文 */}
                      {editingId !== selected.id && (
                        <button
                          onClick={() => copyText(readMarkdown(selected), '正文')}
                          title="复制正文"
                          className="p-1.5 rounded-full text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 transition shrink-0"
                        >
                          <ClipboardList size={14} />
                        </button>
                      )}
                      {/* 下载当前文章全部图片 */}
                      {editingId !== selected.id && readImages(selected).length > 0 && (
                        <button
                          onClick={() => downloadArticleImages(selected)}
                          title="下载当前文章全部图片"
                          className="p-1.5 rounded-full text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition shrink-0"
                        >
                          <Download size={14} />
                        </button>
                      )}
                      {/* 存入文章库（单篇） */}
                      {editingId !== selected.id && (
                        <button
                          onClick={() => setLibraryPickerFor({ articleId: selected.id })}
                          title="存入文章库"
                          className="p-1.5 rounded-full text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition shrink-0"
                        >
                          <Library size={14} />
                        </button>
                      )}
                      {/* 编辑正文按钮 */}
                      {editingId !== selected.id ? (
                        <button
                          onClick={() => handleStartEdit(selected)}
                          title="编辑正文"
                          className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
                        >
                          <Pencil size={14} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSaveEdit(selected.id)}
                          disabled={editSaving}
                          title="保存"
                          className="p-1.5 rounded-full text-emerald-500 hover:bg-emerald-50 transition shrink-0"
                        >
                          {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        </button>
                      )}
                    </div>
                    {/* Tag 编辑区域 — 支持删减和新增 */}
                    {editingTagsId === selected.id ? (
                      <div className="mt-2">
                        <div className="flex flex-wrap gap-1.5">
                          {editTags.map((tag, idx) => (
                            <span
                              key={`et-${idx}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-rose-100 text-rose-600"
                            >
                              #{tag}
                              <button
                                type="button"
                                onClick={() => handleRemoveTag(idx)}
                                className="ml-0.5 text-rose-400 hover:text-rose-700"
                              >
                                <X size={9} />
                              </button>
                            </span>
                          ))}
                          {/* 添加 tag 输入框 */}
                          <input
                            className="text-[11px] px-2 py-0.5 border border-rose-200 rounded-full outline-none focus:ring-1 focus:ring-rose-300 w-24"
                            placeholder="+ 添加"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                            onBlur={handleAddTag}
                          />
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => handleSaveTags(selected.id)}
                            disabled={tagSaving}
                            className="text-[11px] px-3 py-1 bg-rose-500 text-white rounded-full hover:bg-rose-600 transition flex items-center gap-1"
                          >
                            {tagSaving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTagsId(null)}
                            className="text-[11px] px-3 py-1 text-slate-500 hover:bg-slate-100 rounded-full transition"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                        {(Array.isArray(selected.tags) ? selected.tags : []).slice(0, 20).map((tag, idx) => (
                          <span
                            key={`${tag}-${idx}`}
                            className="px-2 py-0.5 text-[11px] rounded-full bg-rose-50 text-rose-500"
                          >
                            #{tag}
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => handleStartEditTags(selected)}
                          title="编辑标签"
                          className="w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition"
                        >
                          <Pencil size={10} />
                        </button>
                      </div>
                    )}
                    {/* 正文展示/编辑区域 */}
                    {editingId === selected.id ? (
                      <textarea
                        className="w-full mt-4 text-sm text-slate-700 border border-slate-200 rounded-xl p-3 leading-7 resize-y min-h-[200px] focus:outline-none focus:ring-1 focus:ring-rose-300"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <p className="text-sm text-slate-600 whitespace-pre-wrap leading-7 mt-4">
                        {readMarkdown(selected) || '暂无正文'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 存入文章库 — 库选择弹窗 */}
      {libraryPickerFor !== null && (
        <LibraryPickerDialog
          target={libraryPickerFor}
          onClose={() => setLibraryPickerFor(null)}
          onPick={(libraryId) => handleStoreInto(libraryId, libraryPickerFor)}
        />
      )}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          startIndex={lightbox.startIndex}
          title={lightbox.title}
          onClose={() => setLightbox(null)}
        />
      )}
      <CoverRegenerateDialog
        open={!!imageDialogTarget}
        title={`重新生成文章${dialogImageLabel}`}
        currentCoverUrl={dialogCurrentUrl}
        promptPlaceholder={dialogIsCover
          ? '本次封面提示词：主体、氛围、构图、色调'
          : '本次内页提示词：保留主体、画面调整、正文配图氛围'}
        submitLabel={`重新生成${dialogImageLabel}`}
        selectLabel={dialogIsCover ? '设为封面' : `设为${dialogImageLabel}`}
        submitting={imageRegenerating}
        selecting={imageSelecting}
        onClose={() => setImageDialogTarget(null)}
        onSubmit={handleRegenerateArticleImage}
        onSelectCover={handleSelectArticleImage}
      />
    </div>
  );
};

/**
 * @description 文章库选择器弹窗（支持新建），供 canvas 选库入库使用
 * @keyword-en library picker dialog for canvas store
 */
const LibraryPickerDialog = ({ target, onClose, onPick }) => {
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await articleLibraryService.listLibraries({ limit: 200 });
    setLibraries(Array.isArray(res?.items) ? res.items : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePick = async (libraryId) => {
    if (saving) return;
    setSaving(true);
    try {
      await onPick(libraryId);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      showToast('请输入文章库名称', 'error');
      return;
    }
    setCreating(true);
    const res = await articleLibraryService.createLibrary({ name, type: newType.trim() });
    setCreating(false);
    if (!res?.library) {
      showToast(describeLibraryError(res, '创建失败'), 'error');
      return;
    }
    setNewName('');
    setNewType('');
    await load();
    await handlePick(res.library.id);
  };

  const title = target === 'all' ? '整份存入文章库' : '单篇存入文章库';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="bg-white rounded-3xl p-5 w-full max-w-md shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-base font-semibold text-slate-900">{title}</h4>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        {/* 库列表 */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : libraries.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-6">还没有文章库，先新建一个</div>
          ) : (
            <div className="space-y-2">
              {libraries.map((lib) => (
                <button
                  key={lib.id}
                  onClick={() => handlePick(lib.id)}
                  disabled={saving}
                  className="w-full flex items-center gap-2 p-3 rounded-2xl border border-slate-100 hover:border-amber-200 hover:bg-amber-50 transition text-left"
                >
                  <Library size={16} className="text-amber-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800 truncate">{lib.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {lib.type ? `${lib.type} · ` : ''}{lib.stats?.publishedCount ?? 0} / {lib.stats?.total ?? 0}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 新建区 */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-2">或新建</div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="名称"
              className="flex-1 min-w-0 text-sm border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:ring-1 focus:ring-amber-300"
            />
            <input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              placeholder="类型"
              className="w-24 text-sm border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:ring-1 focus:ring-amber-300"
            />
            <button
              onClick={handleCreate}
              disabled={creating || saving}
              className="text-sm px-3 py-1.5 rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition inline-flex items-center gap-1"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              新建
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">新建后会自动把当前内容存入该库。</p>
        </div>
      </div>
    </div>
  );
};

export default CanvasFeedView;
