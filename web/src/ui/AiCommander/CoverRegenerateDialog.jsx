import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Loader2, Sparkles, Tags, X } from 'lucide-react';
import { chatService } from './chatService';

/**
 * @description 图片槽位重生成最多允许选择的参考图数量。
 * @keyword-cn 图片选择, 图片槽位重生成
 * @keyword-en selected-source-images
 * @keyword-en image-slot-regenerate
 */
const MAX_SOURCE_IMAGE_SELECTION = 4;

/**
 * @description 获取图库图片可展示的缩略图或原图地址。
 * @param {object} image - 图库图片实体。
 * @returns {string} 图片地址。
 * @keyword-cn 封面重生成, 图片选择
 * @keyword-en cover-regenerate
 * @keyword-en selected-source-images
 */
const readGalleryImageUrl = (image) =>
  String(image?.thumbUrl || image?.url || '').trim();

/**
 * @description 规整图库图片列表，过滤无效 ID 和无图地址的记录。
 * @param {unknown} value - 后端返回的图片列表。
 * @returns {object[]} 可展示图片列表。
 * @keyword-cn 封面重生成, 图片选择
 * @keyword-en cover-regenerate
 * @keyword-en selected-source-images
 */
const normalizeGalleryImages = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((image) => Number.isFinite(Number(image?.id)))
    .filter((image) => readGalleryImageUrl(image).length > 0);

/**
 * @description Canvas 封面重生成弹窗，支持多选参考图并输入提示词。
 * @param {object} props - 组件参数。
 * @returns {JSX.Element | null} 弹窗节点。
 * @keyword-cn 封面重生成, 图片选择
 * @keyword-en cover-regenerate
 * @keyword-en selected-source-images
 */
/**
 * @description 规整图库标签列表，兼容字符串和带 count 的对象结构。
 * @param {unknown} value - 后端返回的标签列表。
 * @returns {{ tag: string, count: number | null }[]} 可展示的标签列表。
 * @keyword-cn 封面重生成, 标签筛选
 * @keyword-en cover-regenerate
 * @keyword-en tag-filter
 */
const normalizeGalleryTags = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => {
      if (typeof item === 'string') return { tag: item.trim(), count: null };
      if (item && typeof item === 'object') {
        const record = item;
        const tag = String(record.tag ?? record.name ?? record.value ?? '').trim();
        const count = Number(record.count);
        return {
          tag,
          count: Number.isFinite(count) ? count : null,
        };
      }
      return { tag: '', count: null };
    })
    .filter((item) => item.tag.length > 0);

/**
 * @description Canvas 图片槽位重生成弹窗，支持最多 4 张参考图、标签筛选、多行本次提示词和直接设图。
 * @param {object} props - 组件参数。
 * @returns {JSX.Element | null} 弹窗节点。
 * @keyword-cn 图片槽位重生成, 图片选择
 * @keyword-en cover-regenerate
 * @keyword-en image-slot-regenerate
 * @keyword-en cover-select
 * @keyword-en selected-source-images
 */
const CoverRegenerateDialog = ({
  open,
  title,
  promptPlaceholder = '本次提示词：主体、氛围、构图、色调',
  submitLabel = '重新生成',
  submittingLabel = '生成中',
  selectLabel = '设为封面',
  selectingLabel = '设置中',
  currentCoverUrl,
  onClose,
  onSubmit,
  onSelectCover,
  submitting = false,
  selecting = false,
}) => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [prompt, setPrompt] = useState('');
  const swipeStartRef = useRef(null);

  /**
   * @description 打开弹窗时加载可作为参考图的图库图片。
   * @returns {Promise<void>}
   * @keyword-cn 封面重生成, 图片选择
   * @keyword-en cover-regenerate
   * @keyword-en selected-source-images
   */
  const loadImages = useCallback(async (tag) => {
    setLoading(true);
    try {
      const res = await chatService.listGalleryImages({
        imageType: 'all',
        tag: String(tag ?? '').trim() || undefined,
        limit: 120,
      });
      setImages(normalizeGalleryImages(res?.images));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * @description 加载图库标签，供封面重生成选择图片时按 tag 缩小图库范围。
   * @returns {Promise<void>}
   * @keyword-cn 封面重生成, 标签筛选
   * @keyword-en cover-regenerate
   * @keyword-en tag-filter
   */
  const loadTags = useCallback(async () => {
    setTagsLoading(true);
    try {
      const res = await chatService.listGalleryTags({ limit: 2000 });
      setTags(normalizeGalleryTags(res?.tags));
    } finally {
      setTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setPrompt('');
    setTagQuery('');
    void loadTags();
  }, [open, loadTags]);

  useEffect(() => {
    if (!open) return;
    void loadImages(selectedTag);
  }, [open, selectedTag, loadImages]);

  const selectedCount = selectedIds.size;
  const selectionFull = selectedCount >= MAX_SOURCE_IMAGE_SELECTION;
  const selectedImageIds = useMemo(
    () => Array.from(selectedIds).map((id) => Number(id)).slice(0, MAX_SOURCE_IMAGE_SELECTION),
    [selectedIds],
  );
  const visibleTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    return tags
      .filter((item) => !query || item.tag.toLowerCase().includes(query))
      .slice(0, 80);
  }, [tagQuery, tags]);

  /**
   * @description 记录弹窗内触摸起点并阻断手势冒泡，避免外层 Canvas 被左右滑开。
   * @param {React.TouchEvent} event - 触摸事件。
   * @returns {void}
   * @keyword-cn 封面重生成, 禁止左右滑动
   * @keyword-en cover-regenerate
   * @keyword-en block-horizontal-swipe
   */
  const handleDialogTouchStart = useCallback((event) => {
    const touch = event.touches?.[0];
    swipeStartRef.current = touch
      ? { x: touch.clientX, y: touch.clientY }
      : null;
    event.stopPropagation();
  }, []);

  /**
   * @description 弹窗内横向滑动时阻止默认滑动行为，保留纵向滚动与 tag 列表内部横向滚动。
   * @param {React.TouchEvent} event - 触摸事件。
   * @returns {void}
   * @keyword-cn 封面重生成, 禁止左右滑动
   * @keyword-en cover-regenerate
   * @keyword-en block-horizontal-swipe
   */
  const handleDialogTouchMove = useCallback((event) => {
    event.stopPropagation();
    const start = swipeStartRef.current;
    const touch = event.touches?.[0];
    if (!start || !touch) return;
    const target = event.target;
    if (target?.closest?.('[data-horizontal-scroll="true"]')) return;
    const dx = Math.abs(touch.clientX - start.x);
    const dy = Math.abs(touch.clientY - start.y);
    if (dx > 8 && dx > dy) {
      event.preventDefault();
    }
  }, []);

  /**
   * @description 清理弹窗触摸起点并阻断手势结束事件冒泡。
   * @param {React.TouchEvent} event - 触摸事件。
   * @returns {void}
   * @keyword-cn 封面重生成, 禁止左右滑动
   * @keyword-en cover-regenerate
   * @keyword-en block-horizontal-swipe
   */
  const handleDialogTouchEnd = useCallback((event) => {
    swipeStartRef.current = null;
    event.stopPropagation();
  }, []);

  /**
   * @description 切换参考图片选中状态，最多保留 4 张参考图。
   * @param {number|string} imageId - 图库图片 ID。
   * @returns {void}
   * @keyword-cn 封面重生成, 图片选择
   * @keyword-en cover-regenerate
   * @keyword-en selected-source-images
   */
  const toggleImage = (imageId) => {
    const id = Number(imageId);
    if (!Number.isFinite(id)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= MAX_SOURCE_IMAGE_SELECTION) return prev;
      else next.add(id);
      return next;
    });
  };

  /**
   * @description 提交图片槽位重生成请求，最多携带 4 张参考图和本次提示词。
   * @returns {Promise<void>}
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en cover-only-submit
   */
  const handleSubmit = async () => {
    if (selectedImageIds.length === 0 || submitting || selecting) return;
    await onSubmit?.({
      imageIds: selectedImageIds,
      prompt: prompt.trim(),
    });
  };

  /**
   * @description 将当前第一张已选图库图片直接设为封面。
   * @returns {Promise<void>}
   * @keyword-cn 直接设为封面, 图片选择
   * @keyword-en cover-select
   * @keyword-en selected-cover-image
   */
  const handleSelectCover = async () => {
    if (selectedImageIds.length === 0 || submitting || selecting) return;
    await onSelectCover?.({
      imageId: selectedImageIds[0],
      imageIds: selectedImageIds,
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/45 flex items-center justify-center p-3 overscroll-x-contain"
      onTouchStart={handleDialogTouchStart}
      onTouchMove={handleDialogTouchMove}
      onTouchEnd={handleDialogTouchEnd}
      onTouchCancel={handleDialogTouchEnd}
    >
      <div className="w-full max-w-3xl max-h-[88dvh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col overscroll-x-contain">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 truncate">
              {title || '重新生成封面'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              已选 {selectedCount}/{MAX_SOURCE_IMAGE_SELECTION} 张参考图
              {selectedCount >= 2 && (
                <span className="text-rose-500"> · 直接使用将合成 3:4 拼图</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 border-b border-slate-100 bg-slate-50/70">
          <div className="grid grid-cols-[72px_1fr] gap-3 items-center">
            <div className="w-[72px] h-[96px] rounded-xl bg-slate-100 overflow-hidden border border-slate-200 flex items-center justify-center">
              {currentCoverUrl ? (
                <img
                  src={currentCoverUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageIcon size={18} className="text-slate-300" />
              )}
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={promptPlaceholder}
              rows={3}
              className="w-full px-3 py-2 text-sm leading-6 rounded-xl border border-slate-200 bg-white outline-none resize-none focus:ring-2 focus:ring-rose-200 focus:border-rose-300"
            />
          </div>
          <div className="mt-3 flex items-start gap-2">
            <div className="h-9 px-2 rounded-xl bg-white border border-slate-200 text-slate-400 flex items-center gap-1.5 shrink-0">
              <Tags size={14} />
              <span className="text-xs">Tag</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <input
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  placeholder="筛选标签"
                  className="w-28 sm:w-40 px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-300"
                />
                <button
                  type="button"
                  onClick={() => setSelectedTag('')}
                  className={`px-3 py-2 text-xs rounded-xl border transition shrink-0 ${
                    selectedTag
                      ? 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      : 'border-rose-200 bg-rose-50 text-rose-500'
                  }`}
                >
                  全部
                </button>
              </div>
              <div className="mt-2 flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1" data-horizontal-scroll="true">
                {tagsLoading ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-400">
                    <Loader2 size={12} className="animate-spin" />
                    加载标签
                  </span>
                ) : visibleTags.length === 0 ? (
                  <span className="px-2.5 py-1 text-xs text-slate-400">
                    暂无匹配标签
                  </span>
                ) : (
                  visibleTags.map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => setSelectedTag(item.tag)}
                      title={item.count !== null ? `${item.tag} (${item.count})` : item.tag}
                      className={`shrink-0 px-2.5 py-1 text-xs rounded-full border transition ${
                        selectedTag === item.tag
                          ? 'border-rose-300 bg-rose-500 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:text-rose-500'
                      }`}
                    >
                      #{item.tag}
                      {item.count !== null ? ` ${item.count}` : ''}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-white">
          {loading ? (
            <div className="h-48 flex items-center justify-center text-slate-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : images.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-400">
              <ImageIcon size={22} className="mb-2" />
              <p className="text-sm">暂无可选图片</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {images.map((image) => {
                const id = Number(image.id);
                const selected = selectedIds.has(id);
                const disabled = !selected && selectionFull;
                const src = readGalleryImageUrl(image);
                return (
                  <button
                    type="button"
                    key={id}
                    disabled={disabled}
                    onClick={() => toggleImage(id)}
                    title={disabled ? `最多选择 ${MAX_SOURCE_IMAGE_SELECTION} 张参考图` : ''}
                    className={`relative aspect-square rounded-xl overflow-hidden border transition ${
                      selected
                        ? 'border-rose-400 ring-2 ring-rose-200'
                        : disabled
                          ? 'border-slate-100 opacity-45 cursor-not-allowed'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center">
                        <Check size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="order-1 px-3 py-2 text-xs rounded-xl text-slate-500 hover:bg-slate-100 transition"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selecting || selectedImageIds.length === 0}
            className="order-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {submitting ? submittingLabel : submitLabel}
          </button>
          {typeof onSelectCover === 'function' && (
            <button
              type="button"
              onClick={handleSelectCover}
              disabled={submitting || selecting || selectedImageIds.length === 0}
              className="order-2 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:text-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {selecting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {selecting
                ? selectingLabel
                : selectedCount >= 2
                  ? '合成拼图并使用'
                  : selectLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CoverRegenerateDialog;
