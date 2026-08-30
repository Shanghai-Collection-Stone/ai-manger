import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Check,
  ChevronLeft,
  FileText,
  Hash,
  Heading2,
  Image as ImageIcon,
  Images,
  Italic,
  Layers,
  List,
  Loader2,
  Maximize2,
  Plus,
  Quote,
  RefreshCw,
  Search,
  SendHorizontal,
  Smile,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { chatService } from './chatService';
import { articleLibraryService, describeLibraryError } from './articleLibraryService';
import { featuredArticleService } from './featuredArticleService';
import { showToast } from './blocks/shared';

/**
 * @description 精选文章图片槽位的固定尺寸参数，后续可集中调整。
 * @keyword-en featured-article
 * @keyword-en image-slot-size
 */
export const FEATURED_IMAGE_SLOT_SIZE = {
  width: 900,
  height: 1200,
};

/**
 * @description 精选文章图片宫格单元格固定尺寸。
 * @keyword-en featured-article
 * @keyword-en image-grid-cell
 */
export const FEATURED_IMAGE_GRID_CELL_SIZE = {
  width: 132,
  height: 176,
};

const FEATURED_WORKSPACES_STORAGE_KEY = 'ai_commander_featured_article_workspaces';
const FEATURED_IMAGE_PICK_LIMIT = 6;
const LEGACY_DEFAULT_WORKSPACE_IDS = new Set([
  'daily-featured',
  'campaign-featured',
  'product-seeding',
]);
const LEGACY_DEFAULT_WORKSPACE_NAMES = new Set([
  '每日精选',
  '活动专题',
  '种草选题',
]);
const EMOJI_PRESETS = ['😊', '✨', '🔥', '✅', '💡', '📌', '🌿', '🎯'];
const MARKDOWN_ACTIONS = [
  { key: 'h2', label: 'H2', icon: Heading2, insert: '## ', suffix: '' },
  { key: 'bold', label: 'B', icon: Bold, insert: '**', suffix: '**' },
  { key: 'italic', label: 'I', icon: Italic, insert: '*', suffix: '*' },
  { key: 'list', label: 'List', icon: List, insert: '- ', suffix: '' },
  { key: 'quote', label: 'Quote', icon: Quote, insert: '> ', suffix: '' },
  { key: 'tag', label: '#', icon: Hash, insert: '#', suffix: '' },
];

/**
 * @description 根据用户输入和工作区生成 AI 选题候选项。
 * @param {string} input - 用户对选题方向的描述。
 * @param {object} workspace - 当前工作区。
 * @returns {string[]} 选题候选项。
 * @keyword-en featured-article
 * @keyword-en ai-topic-options
 */
const buildFeaturedTopicOptions = (input, workspace) => {
  const text = String(input || '').trim();
  const base = text || String(workspace?.name || '').trim() || '精选内容';
  const cleaned = base.replace(/[，,。.!！?？]/g, ' ').replace(/\s+/g, ' ').trim();
  const core = cleaned.length > 12 ? cleaned.slice(0, 12) : cleaned;
  return [
    `${core}种草清单`,
    `${core}场景灵感`,
    `${core}避坑指南`,
    `${core}真实体验`,
    `${core}收藏攻略`,
    `${core}高光复盘`,
  ];
};

/**
 * @description 获取图库图片可展示的缩略图或原图地址。
 * @param {object} image - 图库图片实体。
 * @returns {string} 图片地址。
 * @keyword-en featured-article
 * @keyword-en gallery-image-select
 */
const readFeaturedGalleryImageUrl = (image) =>
  String(image?.thumbUrl || image?.url || '').trim();

/**
 * @description 规整精选文章选图弹窗内的图库图片列表。
 * @param {unknown} value - 后端返回的图片列表。
 * @returns {object[]} 可展示图片列表。
 * @keyword-en featured-article
 * @keyword-en gallery-image-select
 */
const normalizeFeaturedGalleryImages = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((image) => Number.isFinite(Number(image?.id)))
    .filter((image) => readFeaturedGalleryImageUrl(image).length > 0);

/**
 * @description 规整精选文章选图弹窗内的图库标签列表。
 * @param {unknown} value - 后端返回的标签列表。
 * @returns {{ tag: string, count: number | null }[]} 可展示标签列表。
 * @keyword-en featured-article
 * @keyword-en image-tag-filter
 */
const normalizeFeaturedGalleryTags = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => {
      if (typeof item === 'string') return { tag: item.trim(), count: null };
      if (item && typeof item === 'object') {
        const tag = String(item.tag ?? item.name ?? item.value ?? '').trim();
        const count = Number(item.count);
        return { tag, count: Number.isFinite(count) ? count : null };
      }
      return { tag: '', count: null };
    })
    .filter((item) => item.tag.length > 0);

/**
 * @description 创建精选文章工作区中的一个空白页面。
 * @param {number} index - 页面序号。
 * @returns {object} 页面实体。
 * @keyword-en featured-article
 * @keyword-en article-page
 */
const createFeaturedPage = (index = 1) => ({
  id: `page-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  topic: '',
  imageMode: 'empty',
  images: [],
  collageUrl: '',
  imagePrompt: '',
  title: '',
  body: '',
});

/**
 * @description 返回空的精选文章工作区兜底数据，避免继续生成旧默认工作区。
 * @returns {object[]} 工作区列表。
 * @keyword-en featured-article
 * @keyword-en workspace-picker
 */
const createDefaultFeaturedWorkspaces = () => [];

/**
 * @description 判断工作区是否是旧版本内置的默认演示数据。
 * @param {object} workspace - 工作区实体。
 * @returns {boolean} 是否应当从本地缓存清理。
 * @keyword-en featured-article
 * @keyword-en workspace-storage
 */
const isLegacyDefaultWorkspace = (workspace) => {
  const id = String(workspace?.id || '');
  const name = String(workspace?.name || '').trim();
  if (LEGACY_DEFAULT_WORKSPACE_IDS.has(id)) return true;
  if (!LEGACY_DEFAULT_WORKSPACE_NAMES.has(name)) return false;
  const pages = Array.isArray(workspace?.pages) ? workspace.pages : [];
  if (pages.length === 0) return true;
  return pages.every((page) => {
    const title = String(page?.title || '').trim();
    const body = String(page?.body || '').trim();
    const images = Array.isArray(page?.images) ? page.images : [];
    const collageUrl = String(page?.collageUrl || '').trim();
    return !title && !body && images.length === 0 && !collageUrl;
  });
};

/**
 * @description 从浏览器本地缓存读取精选文章工作区。
 * @returns {object[]} 工作区列表。
 * @keyword-en featured-article
 * @keyword-en workspace-storage
 */
/**
 * @description 规整精选文章工作区数据，兼容后端与本地缓存结构。
 * @param {object} workspace - 工作区实体。
 * @returns {object} 规整后的工作区。
 * @keyword-en featured-article
 * @keyword-en workspace-storage
 */
const normalizeFeaturedWorkspace = (workspace) => ({
  id: String(workspace?.id || `workspace-${Date.now()}`),
  name: String(workspace?.name || '未命名工作区'),
  pages: Array.isArray(workspace?.pages)
    ? workspace.pages.map((page, index) => ({
        ...createFeaturedPage(index + 1),
        ...page,
        id: String(page?.id || `page-${Date.now()}-${index}`),
        images: Array.isArray(page?.images) ? page.images : [],
      }))
    : [],
  articleCount: Number.isFinite(Number(workspace?.articleCount))
    ? Number(workspace.articleCount)
    : Array.isArray(workspace?.pages)
      ? workspace.pages.length
      : 0,
});

const loadFeaturedWorkspaces = () => {
  if (typeof window === 'undefined') return createDefaultFeaturedWorkspaces();
  try {
    const raw = window.localStorage.getItem(FEATURED_WORKSPACES_STORAGE_KEY);
    if (!raw) return createDefaultFeaturedWorkspaces();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return createDefaultFeaturedWorkspaces();
    const filtered = parsed.filter((workspace) => !isLegacyDefaultWorkspace(workspace));
    if (filtered.length !== parsed.length) {
      window.localStorage.setItem(
        FEATURED_WORKSPACES_STORAGE_KEY,
        JSON.stringify(filtered),
      );
    }
    return filtered.map((workspace) => normalizeFeaturedWorkspace(workspace));
  } catch {
    return createDefaultFeaturedWorkspaces();
  }
};

/**
 * @description 将精选文章工作区写入浏览器本地缓存。
 * @param {object[]} workspaces - 工作区列表。
 * @returns {void}
 * @keyword-en featured-article
 * @keyword-en workspace-storage
 */
const saveFeaturedWorkspaces = (workspaces) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(FEATURED_WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces));
};

/**
 * @description 统计工作区内已创建的精选文章页面数量。
 * @param {object} workspace - 工作区实体。
 * @returns {number} 文章数量。
 * @keyword-en featured-article
 * @keyword-en workspace-picker
 */
const countFeaturedWorkspaceArticles = (workspace) =>
  Array.isArray(workspace?.pages) ? workspace.pages.length : 0;

/**
 * @description 根据当前页面和工作区生成标题草稿。
 * @param {object} page - 当前页面。
 * @param {object} workspace - 当前工作区。
 * @returns {string} 标题草稿。
 * @keyword-en featured-article
 * @keyword-en ai-title-draft
 */
const buildFeaturedTitleDraft = (page, workspace) => {
  const topic = String(page?.topic || '精选选题').trim();
  const workspaceName = String(workspace?.name || '精选文章').trim();
  return `${topic}｜${workspaceName}里值得收藏的一篇`;
};

/**
 * @description 根据当前页面和工作区生成正文草稿。
 * @param {object} page - 当前页面。
 * @param {object} workspace - 当前工作区。
 * @returns {string} 正文 Markdown 草稿。
 * @keyword-en featured-article
 * @keyword-en ai-body-draft
 */
const buildFeaturedBodyDraft = (page, workspace) => {
  const topic = String(page?.topic || '本次选题').trim();
  const workspaceName = String(workspace?.name || '精选文章').trim();
  return [
    `## ${topic}`,
    '',
    `今天从「${workspaceName}」里挑出这个角度，适合做一篇更轻、更有记忆点的精选内容。`,
    '',
    '- 开头先给一个明确场景，让读者知道为什么值得看',
    '- 中段用 2-3 个要点拆开亮点，保持节奏轻快',
    '- 结尾给一个行动提示，方便收藏、评论或转发',
    '',
    '✨ 可以继续补充真实案例、产品细节或用户反馈。',
  ].join('\n');
};

/**
 * @description 根据当前页面生成图片 AI 提示词草稿。
 * @param {object} page - 当前页面。
 * @param {object} workspace - 当前工作区。
 * @returns {string} 图片提示词草稿。
 * @keyword-en featured-article
 * @keyword-en ai-image-prompt
 */
const buildFeaturedImagePrompt = (page, workspace) => {
  const topic = String(page?.topic || '精选文章').trim();
  const workspaceName = String(workspace?.name || '内容工作区').trim();
  return `${workspaceName} / ${topic}，竖版社媒配图，清爽构图，主体明确，适合小红书封面`;
};

/**
 * @description 将当前精选文章页面转换为文章库入库 payload。
 * @param {object} page - 当前页面。
 * @param {object} workspace - 当前工作区。
 * @returns {object} 文章库文章 payload。
 * @keyword-en featured-article
 * @keyword-en store-into-library
 */
const buildFeaturedArticleLibraryPayload = (page, workspace) => {
  const images = Array.isArray(page?.images) ? page.images : [];
  const imageUrls = page?.collageUrl
    ? [page.collageUrl]
    : images.map((image) => readFeaturedGalleryImageUrl(image)).filter(Boolean);
  const imageIds = images
    .map((image) => Number(image?.id))
    .filter((id) => Number.isFinite(id));
  const topic = String(page?.topic || '').trim();
  const workspaceName = String(workspace?.name || '').trim();
  const markdown = String(page?.body || '').trim();
  return {
    title: String(page?.title || topic || '未命名精选文章').trim(),
    tags: [topic, workspaceName, '精选文章'].filter(Boolean),
    contentJson: {
      markdown,
      topic,
      workspaceName,
      source: 'featured-article',
    },
    text: markdown,
    imageUrls,
    imageIds,
    publishStatus: 'unpublished',
    source: 'featured-article',
    sourceRef: {
      workspaceId: String(workspace?.id || ''),
      pageId: String(page?.id || ''),
    },
  };
};

/**
 * @description 在 textarea 当前光标位置插入文本或包裹选区。
 * @param {object} input - 插入参数。
 * @returns {void}
 * @keyword-en featured-article
 * @keyword-en markdown-toolbar
 */
const insertTextAtCursor = ({ ref, value, suffix = '', onChange }) => {
  const target = ref?.current;
  if (!target) {
    onChange(`${value}${suffix}`);
    return;
  }
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? start;
  const current = target.value || '';
  const selected = current.slice(start, end);
  const next = `${current.slice(0, start)}${value}${selected}${suffix}${current.slice(end)}`;
  onChange(next);
  window.requestAnimationFrame(() => {
    target.focus();
    const cursor = start + value.length + selected.length;
    target.setSelectionRange(cursor, cursor);
  });
};

/**
 * @description 加载可绘制到 Canvas 的图片元素。
 * @param {string} src - 图片地址。
 * @returns {Promise<HTMLImageElement>} 图片元素。
 * @keyword-en featured-article
 * @keyword-en collage-preview
 */
const loadFeaturedImageElement = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/**
 * @description 将多张图库图片合成为精选文章图片槽位预览。
 * @param {object[]} images - 已选图库图片。
 * @returns {Promise<string>} 拼图 data URL。
 * @keyword-en featured-article
 * @keyword-en collage-preview
 */
const createFeaturedCollagePreview = async (images) => {
  const sources = images
    .map((image) => readFeaturedGalleryImageUrl(image))
    .filter(Boolean)
    .slice(0, FEATURED_IMAGE_PICK_LIMIT);
  const loaded = await Promise.all(sources.map((src) => loadFeaturedImageElement(src)));
  const canvas = document.createElement('canvas');
  canvas.width = FEATURED_IMAGE_SLOT_SIZE.width;
  canvas.height = FEATURED_IMAGE_SLOT_SIZE.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gap = 18;
  const columns = loaded.length <= 2 ? 1 : 2;
  const rows = Math.ceil(loaded.length / columns);
  const cellW = (canvas.width - gap * (columns + 1)) / columns;
  const cellH = (canvas.height - gap * (rows + 1)) / rows;

  loaded.forEach((image, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + col * (cellW + gap);
    const y = gap + row * (cellH + gap);
    const scale = Math.max(cellW / image.width, cellH / image.height);
    const sw = cellW / scale;
    const sh = cellH / scale;
    const sx = Math.max(0, (image.width - sw) / 2);
    const sy = Math.max(0, (image.height - sh) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, cellW, cellH, 22);
    ctx.clip();
    ctx.drawImage(image, sx, sy, sw, sh, x, y, cellW, cellH);
    ctx.restore();
  });

  return canvas.toDataURL('image/jpeg', 0.92);
};

/**
 * @description 精选文章图片选择弹窗，支持 tag 筛选、多选、直接用图和本地拼图预览。
 * @param {object} props - 组件参数。
 * @returns {JSX.Element | null} 弹窗节点。
 * @keyword-en featured-article
 * @keyword-en image-picker-dialog
 */
const FeaturedImagePickerDialog = ({
  open,
  currentPrompt,
  onClose,
  onUseImages,
  onUseCollage,
  onPromptChange,
}) => {
  const [images, setImages] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [collageLoading, setCollageLoading] = useState(false);

  /**
   * @description 拉取精选文章弹窗内可选择的图库图片。
   * @param {string} tag - 当前筛选标签。
   * @returns {Promise<void>}
   * @keyword-en featured-article
   * @keyword-en gallery-image-select
   */
  const loadImages = useCallback(async (tag) => {
    setImagesLoading(true);
    try {
      const res = await chatService.listGalleryImages({
        imageType: 'regular',
        tag: String(tag || '').trim() || undefined,
        limit: 160,
      });
      setImages(normalizeFeaturedGalleryImages(res?.images));
    } finally {
      setImagesLoading(false);
    }
  }, []);

  /**
   * @description 拉取精选文章弹窗内可筛选的图库标签。
   * @returns {Promise<void>}
   * @keyword-en featured-article
   * @keyword-en image-tag-filter
   */
  const loadTags = useCallback(async () => {
    setTagsLoading(true);
    try {
      const res = await chatService.listGalleryTags({ limit: 2000 });
      setTags(normalizeFeaturedGalleryTags(res?.tags));
    } finally {
      setTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setTagQuery('');
    void loadTags();
  }, [open, loadTags]);

  useEffect(() => {
    if (!open) return;
    void loadImages(selectedTag);
  }, [open, selectedTag, loadImages]);

  const selectedImages = useMemo(
    () => images.filter((image) => selectedIds.has(Number(image.id))),
    [images, selectedIds],
  );
  const visibleTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    return tags
      .filter((item) => !query || item.tag.toLowerCase().includes(query))
      .slice(0, 80);
  }, [tagQuery, tags]);

  /**
   * @description 切换弹窗中图库图片的多选状态。
   * @param {number|string} imageId - 图库图片 ID。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en gallery-image-select
   */
  const toggleImage = (imageId) => {
    const id = Number(imageId);
    if (!Number.isFinite(id)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < FEATURED_IMAGE_PICK_LIMIT) next.add(id);
      return next;
    });
  };

  /**
   * @description 将已选图库图片直接写入精选文章图片槽位。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en selected-image-apply
   */
  const handleUseSelected = () => {
    if (selectedImages.length === 0) return;
    onUseImages(selectedImages);
  };

  /**
   * @description 为当前选题生成图片提示词草稿。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en ai-image-prompt
   */
  const handleGeneratePrompt = () => {
    onPromptChange?.();
  };

  /**
   * @description 将已选多张图库图片合成为本地拼图预览并写入图片槽位。
   * @returns {Promise<void>}
   * @keyword-en featured-article
   * @keyword-en collage-preview
   */
  const handleCreateCollage = async () => {
    if (selectedImages.length < 2 || collageLoading) return;
    setCollageLoading(true);
    try {
      const collageUrl = await createFeaturedCollagePreview(selectedImages);
      onUseCollage({ collageUrl, images: selectedImages });
    } catch (error) {
      showToast(`拼图生成失败: ${error?.message || '图片跨域或加载失败'}`, 'error');
    } finally {
      setCollageLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] bg-slate-950/45 flex items-center justify-center p-3">
      <div className="w-full max-w-5xl max-h-[90dvh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Images size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 truncate">选择精选文章图片</h3>
            <p className="text-xs text-slate-500 mt-0.5">已选 {selectedImages.length}/{FEATURED_IMAGE_PICK_LIMIT} 张，可直接用图或生成拼图</p>
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
          <div className="grid md:grid-cols-[minmax(0,1fr)_220px] gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-9 px-2 rounded-xl bg-white border border-slate-200 text-slate-400 flex items-center gap-1.5 shrink-0">
                  <Search size={14} />
                  <span className="text-xs">Tag</span>
                </div>
                <input
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  placeholder="筛选图片标签"
                  className="w-36 sm:w-48 px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
                />
                <button
                  type="button"
                  onClick={() => setSelectedTag('')}
                  className={`px-3 py-2 text-xs rounded-xl border transition shrink-0 ${
                    selectedTag
                      ? 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-600'
                  }`}
                >
                  全部
                </button>
              </div>
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                {tagsLoading ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-400">
                    <Loader2 size={12} className="animate-spin" />
                    加载标签
                  </span>
                ) : visibleTags.length === 0 ? (
                  <span className="px-2.5 py-1 text-xs text-slate-400">暂无匹配标签</span>
                ) : (
                  visibleTags.map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => setSelectedTag(item.tag)}
                      className={`shrink-0 px-2.5 py-1 text-xs rounded-full border transition ${
                        selectedTag === item.tag
                          ? 'border-emerald-300 bg-emerald-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-600'
                      }`}
                    >
                      #{item.tag}{item.count !== null ? ` ${item.count}` : ''}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">AI 图片提示</span>
                <button
                  type="button"
                  onClick={handleGeneratePrompt}
                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition"
                  title="生成提示词"
                >
                  <Wand2 size={15} />
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500 line-clamp-3">
                {currentPrompt || '点击 AI 图标生成本次图片提示词'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-white">
          {imagesLoading ? (
            <div className="h-56 flex items-center justify-center text-slate-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : images.length === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center text-slate-400">
              <ImageIcon size={24} className="mb-2" />
              <p className="text-sm">暂无可选图片</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {images.map((image) => {
                const id = Number(image.id);
                const selected = selectedIds.has(id);
                const disabled = !selected && selectedIds.size >= FEATURED_IMAGE_PICK_LIMIT;
                return (
                  <button
                    type="button"
                    key={id}
                    disabled={disabled}
                    onClick={() => toggleImage(id)}
                    className={`relative aspect-square rounded-xl overflow-hidden border transition ${
                      selected
                        ? 'border-emerald-400 ring-2 ring-emerald-100'
                        : disabled
                          ? 'border-slate-100 opacity-45 cursor-not-allowed'
                          : 'border-slate-200 hover:border-emerald-200'
                    }`}
                  >
                    <img src={readFeaturedGalleryImageUrl(image)} alt="" className="w-full h-full object-cover" />
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                        <Check size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 bg-white flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs rounded-xl text-slate-500 hover:bg-slate-100 transition"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleCreateCollage}
            disabled={selectedImages.length < 2 || collageLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:text-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {collageLoading ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
            {collageLoading ? '拼图生成中' : '拼图生成'}
          </button>
          <button
            type="button"
            onClick={handleUseSelected}
            disabled={selectedImages.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <Check size={14} />
            使用选中图片
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * @description 精选文章选题重选弹窗，提供输入框、AI 候选项和选择确认。
 * @param {object} props - 组件参数。
 * @returns {JSX.Element | null} 弹窗节点。
 * @keyword-en featured-article
 * @keyword-en topic-dialog
 */
const FeaturedTopicDialog = ({ open, currentTopic, workspace, onClose, onSelectTopic }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [options, setOptions] = useState([]);
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setMessages([
      {
        role: 'assistant',
        text: currentTopic
          ? `当前选题是「${currentTopic}」。你可以告诉我想换成什么方向。`
          : '告诉我这篇精选文章想面向什么场景，我会给出几个选题。',
      },
    ]);
    setOptions(currentTopic ? [currentTopic, ...buildFeaturedTopicOptions(currentTopic, workspace).slice(0, 5)] : []);
  }, [currentTopic, open, workspace]);

  /**
   * @description 根据输入模拟 AI 对话并刷新选题候选项。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en ai-topic-options
   */
  const handleAskAi = () => {
    const text = input.trim();
    if (!text || thinking) return;
    setThinking(true);
    const nextOptions = buildFeaturedTopicOptions(text, workspace);
    setMessages((prev) => [
      ...prev,
      { role: 'user', text },
      { role: 'assistant', text: `我给你拆了 ${nextOptions.length} 个更适合精选文章的选题。` },
    ]);
    setOptions(nextOptions);
    setInput('');
    window.setTimeout(() => setThinking(false), 240);
  };

  /**
   * @description 选中 AI 返回的某个候选选题。
   * @param {string} topic - 候选选题。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en topic-selector
   */
  const handlePickTopic = (topic) => {
    onSelectTopic(topic);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[96] bg-slate-950/45 flex items-center justify-center p-3">
      <div className="w-full max-w-2xl max-h-[88dvh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900">重选选题</h3>
            <p className="text-xs text-slate-500 mt-0.5">输入方向，让 AI 给出可选选题</p>
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

        <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-slate-50">
          <div className="space-y-2">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                    message.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700'
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="text-xs font-medium text-slate-500 mb-2">AI 候选选题</div>
            <div className="flex flex-wrap gap-2">
              {options.length === 0 ? (
                <span className="text-xs text-slate-400">输入方向后会出现在这里</span>
              ) : (
                options.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => handlePickTopic(topic)}
                    className={`px-3 py-1.5 text-xs rounded-full border transition ${
                      currentTopic === topic
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-600'
                    }`}
                  >
                    {topic}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-slate-100 bg-white flex items-center gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleAskAi();
            }}
            placeholder="例如：想做春季护肤、门店活动、用户案例..."
            className="flex-1 min-w-0 px-3 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
          />
          <button
            type="button"
            onClick={handleAskAi}
            disabled={!input.trim() || thinking}
            className="w-10 h-10 rounded-xl bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition"
            title="发送给 AI"
          >
            {thinking ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * @description 精选文章存入文章库弹窗，支持选择已有库或新建库。
 * @param {object} props - 组件参数。
 * @returns {JSX.Element | null} 弹窗节点。
 * @keyword-en featured-article
 * @keyword-en library-picker
 */
const FeaturedLibraryPickerDialog = ({ open, storing, onClose, onPick }) => {
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('小红书');

  /**
   * @description 加载可存入的文章库列表。
   * @returns {Promise<void>}
   * @keyword-en featured-article
   * @keyword-en library-picker
   */
  const loadLibraries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await articleLibraryService.listLibraries({ limit: 200 });
      setLibraries(Array.isArray(res?.items) ? res.items : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadLibraries();
  }, [loadLibraries, open]);

  /**
   * @description 新建文章库并将当前精选文章存入该库。
   * @returns {Promise<void>}
   * @keyword-en featured-article
   * @keyword-en store-into-library
   */
  const handleCreateLibrary = async () => {
    const name = newName.trim();
    if (!name || storing) return;
    const created = await articleLibraryService.createLibrary({ name, type: newType.trim() || '小红书' });
    const createdId = created?.library?.id ?? created?.id;
    if (!createdId) {
      showToast(describeLibraryError(created, '创建文章库失败'), 'error');
      return;
    }
    await onPick(createdId);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[96] bg-slate-950/45 flex items-center justify-center p-3">
      <div className="w-full max-w-xl max-h-[86dvh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <FileText size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900">存入文章库</h3>
            <p className="text-xs text-slate-500 mt-0.5">选择目标库，或创建一个新库</p>
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

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="rounded-2xl border border-slate-200 p-3 bg-slate-50">
            <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="新建文章库名称"
                className="min-w-0 px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-amber-100 focus:border-amber-300"
              />
              <input
                value={newType}
                onChange={(event) => setNewType(event.target.value)}
                placeholder="类型"
                className="min-w-0 px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-amber-100 focus:border-amber-300"
              />
            </div>
            <button
              type="button"
              onClick={handleCreateLibrary}
              disabled={!newName.trim() || storing}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Plus size={14} />
              新建并存入
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {loading ? (
              <div className="h-28 flex items-center justify-center text-slate-400">
                <Loader2 size={22} className="animate-spin" />
              </div>
            ) : libraries.length === 0 ? (
              <div className="h-28 flex items-center justify-center text-sm text-slate-400">
                暂无文章库
              </div>
            ) : (
              libraries.map((library) => (
                <button
                  key={library.id}
                  type="button"
                  onClick={() => onPick(library.id)}
                  disabled={storing}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-left hover:border-amber-200 hover:bg-amber-50/50 disabled:opacity-60 transition"
                >
                  <div className="text-sm font-medium text-slate-900">{library.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {library.type || '未分类'} · {library.stats?.total ?? 0} 篇
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * @description 精选文章工具主视图，提供工作区选择、页面列表和单篇编辑区。
 * @param {{ onBack?: Function }} props - 组件参数。
 * @returns {JSX.Element} 主视图节点。
 * @keyword-en featured-article
 * @keyword-en workspace-editor
 */
const FeaturedArticleView = ({ onBack }) => {
  const [workspaces, setWorkspaces] = useState(() => loadFeaturedWorkspaces());
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [activePageId, setActivePageId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [storing, setStoring] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [savingPage, setSavingPage] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    saveFeaturedWorkspaces(workspaces);
  }, [workspaces]);

  /**
   * @description 把后端返回的工作区合并到当前页面状态。
   * @param {object} workspace - 后端工作区实体。
   * @returns {object} 规整后的工作区。
   * @keyword-en featured-article
   * @keyword-en workspace-editor
   */
  const applyRemoteWorkspace = useCallback((workspace) => {
    const normalized = normalizeFeaturedWorkspace(workspace);
    setWorkspaces((prev) => {
      const exists = prev.some((item) => item.id === normalized.id);
      if (!exists) return [normalized, ...prev];
      return prev.map((item) => (item.id === normalized.id ? normalized : item));
    });
    return normalized;
  }, []);

  /**
   * @description 从后端加载精选文章工作区列表，不再创建默认工作区。
   * @returns {Promise<void>}
   * @keyword-en featured-article
   * @keyword-en workspace-picker
   */
  const loadRemoteWorkspaces = useCallback(async () => {
    setLoadingWorkspaces(true);
    try {
      const res = await featuredArticleService.listWorkspaces({
        limit: 200,
      });
      if (Array.isArray(res?.items) && res.items.length > 0) {
        setWorkspaces(res.items.map((workspace) => normalizeFeaturedWorkspace(workspace)));
      }
    } finally {
      setLoadingWorkspaces(false);
    }
  }, []);

  useEffect(() => {
    void loadRemoteWorkspaces();
  }, [loadRemoteWorkspaces]);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null,
    [activeWorkspaceId, workspaces],
  );
  const activePage = useMemo(
    () => activeWorkspace?.pages?.find((page) => page.id === activePageId) || activeWorkspace?.pages?.[0] || null,
    [activePageId, activeWorkspace],
  );

  /**
   * @description 进入某个精选文章工作区并定位到第一页。
   * @param {string} workspaceId - 工作区 ID。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en workspace-picker
   */
  const handleSelectWorkspace = async (workspaceId) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    const detail = await featuredArticleService.getWorkspace(workspaceId);
    let nextWorkspace = detail?.workspace
      ? applyRemoteWorkspace(detail.workspace)
      : normalizeFeaturedWorkspace(workspace);
    if (!nextWorkspace.pages.length) {
      const created = await featuredArticleService.createPage(workspaceId, createFeaturedPage(1));
      if (created?.workspace) {
        nextWorkspace = applyRemoteWorkspace(created.workspace);
      }
    }
    setActiveWorkspaceId(nextWorkspace.id);
    setActivePageId(nextWorkspace.pages[0]?.id || '');
  };

  /**
   * @description 返回精选文章工作区选择页。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en workspace-picker
   */
  const handleBackToWorkspaces = () => {
    setActiveWorkspaceId('');
    setActivePageId('');
    setPickerOpen(false);
    setTopicDialogOpen(false);
    setLibraryDialogOpen(false);
    setPreviewImage(null);
  };

  /**
   * @description 更新当前精选文章页面字段。
   * @param {object} patch - 页面字段补丁。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en article-page
   */
  const updateCurrentPage = (patch) => {
    if (!activeWorkspace || !activePage) return;
    setWorkspaces((prev) =>
      prev.map((workspace) => {
        if (workspace.id !== activeWorkspace.id) return workspace;
        return {
          ...workspace,
          pages: workspace.pages.map((page) =>
            page.id === activePage.id ? { ...page, ...patch } : page,
          ),
        };
      }),
    );
  };

  /**
   * @description 在当前工作区新增一个精选文章页面。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en article-page
   */
  const handleAddPage = async () => {
    if (!activeWorkspace) return;
    const nextPage = createFeaturedPage((activeWorkspace.pages?.length || 0) + 1);
    const created = await featuredArticleService.createPage(activeWorkspace.id, nextPage);
    if (!created?.workspace || !created?.page) {
      showToast('新增页面失败', 'error');
      return;
    }
    applyRemoteWorkspace(created.workspace);
    setActivePageId(String(created.page.id || nextPage.id));
  };

  /**
   * @description 选中左侧缩略栏中的某个精选文章页面。
   * @param {string} pageId - 页面 ID。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en slide-page-list
   */
  const handleSelectPage = (pageId) => {
    setActivePageId(pageId);
  };

  /**
   * @description 删除左侧缩略栏中的一个精选文章页面，并在必要时切换当前选中页。
   * @param {string} pageId - 页面 ID。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en slide-page-list
   */
  const handleDeletePage = async (pageId) => {
    if (!activeWorkspace) return;
    const pages = Array.isArray(activeWorkspace.pages) ? activeWorkspace.pages : [];
    const targetIndex = pages.findIndex((page) => page.id === pageId);
    if (targetIndex < 0) return;
    const deleted = await featuredArticleService.deletePage(activeWorkspace.id, pageId);
    if (!deleted?.workspace) {
      showToast('删除页面失败', 'error');
      return;
    }
    const nextWorkspace = applyRemoteWorkspace(deleted.workspace);
    const nextPages = nextWorkspace.pages || [];
    if (activePageId === pageId) {
      const fallback = nextPages[Math.max(0, targetIndex - 1)] || nextPages[0] || null;
      setActivePageId(fallback?.id || '');
    }
  };

  /**
   * @description 重新选择当前页面的本次选题。
   * @param {string} topic - 选题名称。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en topic-selector
   */
  const handleSelectTopic = (topic) => {
    updateCurrentPage({ topic });
  };

  /**
   * @description 打开 AI 选题重选弹窗。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en topic-dialog
   */
  const handleOpenTopicDialog = () => {
    setTopicDialogOpen(true);
  };

  /**
   * @description 向正文编辑区插入 Markdown 片段或表情。
   * @param {string} value - 插入前缀。
   * @param {string} [suffix] - 插入后缀。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en markdown-toolbar
   */
  const handleInsertMarkdown = (value, suffix = '') => {
    insertTextAtCursor({
      ref: bodyRef,
      value,
      suffix,
      onChange: (next) => updateCurrentPage({ body: next }),
    });
  };

  /**
   * @description 将 AI 标题草稿写入当前页面标题。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en ai-title-draft
   */
  const handleAiTitle = () => {
    updateCurrentPage({ title: buildFeaturedTitleDraft(activePage, activeWorkspace) });
  };

  /**
   * @description 将 AI 正文草稿写入当前页面正文。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en ai-body-draft
   */
  const handleAiBody = () => {
    updateCurrentPage({ body: buildFeaturedBodyDraft(activePage, activeWorkspace) });
  };

  /**
   * @description 将 AI 图片提示词草稿写入当前页面图片提示。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en ai-image-prompt
   */
  const handleAiImagePrompt = () => {
    updateCurrentPage({ imagePrompt: buildFeaturedImagePrompt(activePage, activeWorkspace) });
  };

  /**
   * @description 将弹窗中选择的图库图片应用到当前页面图片槽位。
   * @param {object[]} images - 已选图库图片。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en selected-image-apply
   */
  const handleApplySelectedImages = (images) => {
    updateCurrentPage({
      imageMode: 'gallery-stack',
      images,
      collageUrl: '',
    });
    setPickerOpen(false);
  };

  /**
   * @description 将弹窗生成的拼图预览应用到当前页面图片槽位。
   * @param {{ collageUrl: string, images: object[] }} input - 拼图结果。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en collage-preview
   */
  const handleApplyCollageImage = (input) => {
    updateCurrentPage({
      imageMode: 'collage',
      images: input.images,
      collageUrl: input.collageUrl,
    });
    setPickerOpen(false);
  };

  /**
   * @description 从当前页面图片列表中移除指定图片。
   * @param {number|string} imageId - 图库图片 ID。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en selected-image-apply
   */
  const handleRemoveImage = (imageId) => {
    if (!activePage) return;
    const id = Number(imageId);
    updateCurrentPage({
      images: (activePage.images || []).filter((image) => Number(image.id) !== id),
      collageUrl: activePage.imageMode === 'collage' ? '' : activePage.collageUrl,
      imageMode: 'gallery-stack',
    });
  };

  /**
   * @description 打开精选文章图片放大预览层。
   * @param {{ src: string, label?: string }} image - 待预览图片。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en image-lightbox
   */
  const handleOpenImagePreview = (image) => {
    const src = String(image?.src || '').trim();
    if (!src) return;
    setPreviewImage({ src, label: String(image?.label || '图片预览') });
  };

  /**
   * @description 关闭精选文章图片放大预览层。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en image-lightbox
   */
  const handleCloseImagePreview = () => {
    setPreviewImage(null);
  };

  /**
   * @description 保存当前精选文章草稿到本地工作区缓存。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en workspace-storage
   */
  const handleSavePage = async () => {
    if (!activeWorkspace || !activePage || savingPage) return;
    setSavingPage(true);
    try {
      const saved = await featuredArticleService.updatePage(
        activeWorkspace.id,
        activePage.id,
        activePage,
      );
      if (!saved?.workspace) {
        showToast('保存精选文章草稿失败', 'error');
        return;
      }
      applyRemoteWorkspace(saved.workspace);
      showToast('已保存精选文章草稿', 'success');
    } finally {
      setSavingPage(false);
    }
  };

  /**
   * @description 打开文章库选择弹窗准备入库。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en store-into-library
   */
  const handleOpenLibraryDialog = () => {
    if (!activePage) return;
    if (!String(activePage.title || '').trim()) {
      showToast('请先填写标题', 'error');
      return;
    }
    setLibraryDialogOpen(true);
  };

  /**
   * @description 将当前精选文章存入指定文章库。
   * @param {number|string} libraryId - 文章库 ID。
   * @returns {Promise<void>}
   * @keyword-en featured-article
   * @keyword-en store-into-library
   */
  const handleStoreIntoLibrary = async (libraryId) => {
    if (!activePage || !activeWorkspace || storing) return;
    const id = Number(libraryId);
    if (!Number.isFinite(id)) return;
    setStoring(true);
    try {
      const saved = await featuredArticleService.updatePage(
        activeWorkspace.id,
        activePage.id,
        activePage,
      );
      if (saved?.workspace) applyRemoteWorkspace(saved.workspace);
      const res = await featuredArticleService.storePageToLibrary(
        activeWorkspace.id,
        activePage.id,
        id,
      );
      if (!res) {
        showToast('存入文章库失败', 'error');
        return;
      }
      if (res.workspace) applyRemoteWorkspace(res.workspace);
      showToast('已存入文章库', 'success');
      setLibraryDialogOpen(false);
    } finally {
      setStoring(false);
    }
  };

  /**
   * @description 新建一个空的精选文章工作区。
   * @returns {void}
   * @keyword-en featured-article
   * @keyword-en workspace-picker
   */
  const handleCreateWorkspace = async () => {
    const created = await featuredArticleService.createWorkspace({
      name: `精选工作区 ${workspaces.length + 1}`,
    });
    if (!created?.workspace) {
      showToast('新建工作区失败', 'error');
      return;
    }
    applyRemoteWorkspace(created.workspace);
  };

  if (!activeWorkspace) {
    return (
      <div className="h-full flex flex-col bg-slate-50 animate-fade-in">
        <div className="h-14 px-4 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
            aria-label="返回"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">精选文章</h2>
            <p className="text-xs text-slate-500">
              {loadingWorkspaces ? '正在同步工作区...' : '选择一个工作区开始整理内容'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreateWorkspace}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-slate-900 text-white hover:bg-slate-700 transition"
          >
            <Plus size={14} />
            新工作区
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => handleSelectWorkspace(workspace.id)}
                className="group text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-200 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <FileText size={20} />
                  </div>
                  <ChevronLeft size={18} className="rotate-180 text-slate-300 group-hover:text-emerald-500 transition" />
                </div>
                <div className="mt-4 text-base font-semibold text-slate-900 line-clamp-1">
                  {workspace.name}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  {countFeaturedWorkspaceArticles(workspace)} 篇文章
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 animate-fade-in">
      <div className="h-14 px-3 md:px-4 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={handleBackToWorkspaces}
          className="p-2 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
          aria-label="返回工作区"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900 truncate">{activeWorkspace.name}</h2>
          <p className="text-xs text-slate-500">{countFeaturedWorkspaceArticles(activeWorkspace)} 篇文章</p>
        </div>
        <button
          type="button"
          onClick={handleAddPage}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-slate-900 text-white hover:bg-slate-700 transition"
        >
          <Plus size={14} />
          添加页面
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <aside className="w-32 md:w-44 lg:w-52 shrink-0 border-r border-slate-200 bg-white overflow-y-auto p-3">
          <div className="space-y-2">
            {(activeWorkspace.pages || []).map((page, index) => {
              const coverUrl = page.collageUrl || (page.images?.[0] ? readFeaturedGalleryImageUrl(page.images[0]) : '');
              const title = page.title || page.topic || `页面 ${index + 1}`;
              return (
                <div
                  key={page.id}
                  className={`relative w-full aspect-[3/4] rounded-xl border overflow-hidden transition ${
                    activePage?.id === page.id
                      ? 'border-emerald-400 ring-2 ring-emerald-100'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectPage(page.id)}
                    className="group w-full h-full block text-left bg-slate-100 overflow-hidden"
                  >
                    {coverUrl ? (
                      <img src={coverUrl} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    ) : (
                      <div className="w-full h-full bg-slate-50 flex items-center justify-center">
                        <ImageIcon size={18} className="text-slate-300" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-2 pt-8 bg-gradient-to-t from-white via-white/90 to-transparent">
                      <div className="text-[11px] font-semibold leading-4 text-slate-800 line-clamp-2">
                        {title}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">{index + 1}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeletePage(page.id);
                    }}
                    className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-white/90 text-slate-500 hover:text-red-500 shadow-sm flex items-center justify-center transition"
                    aria-label="删除页面"
                    title="删除页面"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={handleAddPage}
              className="w-full aspect-[3/4] rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50 transition flex items-center justify-center"
              aria-label="添加页面"
            >
              <Plus size={22} />
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto p-3 md:p-5">
          {activePage ? (
            <div className="w-full max-w-none space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">选题</div>
                    <div className="text-lg font-semibold text-slate-900 mt-1">{activePage.topic}</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenTopicDialog}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-600 transition"
                  >
                    <RefreshCw size={13} />
                    重选
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xs text-slate-500">图片选择</div>
                    <div className="text-sm font-medium text-slate-900 mt-0.5">
                      {activePage.imageMode === 'collage' ? '拼图 1 张' : `${activePage.images?.length || 0} 张图片`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-slate-900 text-white hover:bg-slate-700 transition"
                  >
                    <Plus size={14} />
                    选择图片
                  </button>
                </div>

                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, ${FEATURED_IMAGE_GRID_CELL_SIZE.width}px)`,
                  }}
                >
                  {activePage.collageUrl ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleOpenImagePreview({ src: activePage.collageUrl, label: '拼图预览' })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          handleOpenImagePreview({ src: activePage.collageUrl, label: '拼图预览' });
                        }
                      }}
                      className="group relative rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 hover:border-emerald-300 transition"
                      style={{
                        width: FEATURED_IMAGE_GRID_CELL_SIZE.width,
                        height: FEATURED_IMAGE_GRID_CELL_SIZE.height,
                      }}
                    >
                      <img src={activePage.collageUrl} alt="" className="w-full h-full object-cover" />
                      <div className="absolute left-2 top-2 px-2 py-1 rounded-full bg-white/90 text-[11px] text-slate-600 shadow-sm">
                        拼图
                      </div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                      <span className="absolute left-2 bottom-2 w-7 h-7 rounded-full bg-white/90 text-slate-600 shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <Maximize2 size={14} />
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          updateCurrentPage({ collageUrl: '', imageMode: 'gallery-stack' });
                        }}
                        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-slate-500 hover:text-red-500 shadow-sm flex items-center justify-center transition"
                        aria-label="移除拼图"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : (activePage.images || []).map((image, index) => (
                    <div
                      role="button"
                      tabIndex={0}
                      key={`${image.id}-${index}`}
                      onClick={() => handleOpenImagePreview({
                        src: readFeaturedGalleryImageUrl(image),
                        label: `图片 ${index + 1}`,
                      })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          handleOpenImagePreview({
                            src: readFeaturedGalleryImageUrl(image),
                            label: `图片 ${index + 1}`,
                          });
                        }
                      }}
                      className="group relative rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 hover:border-emerald-300 transition"
                      style={{
                        width: FEATURED_IMAGE_GRID_CELL_SIZE.width,
                        height: FEATURED_IMAGE_GRID_CELL_SIZE.height,
                      }}
                    >
                      <img src={readFeaturedGalleryImageUrl(image)} alt="" className="w-full h-full object-cover" />
                      <div className="absolute left-2 top-2 px-2 py-1 rounded-full bg-white/90 text-[11px] text-slate-600 shadow-sm">
                        {index + 1}
                      </div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                      <span className="absolute left-2 bottom-2 w-7 h-7 rounded-full bg-white/90 text-slate-600 shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <Maximize2 size={14} />
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRemoveImage(image.id);
                        }}
                        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-slate-500 hover:text-red-500 shadow-sm flex items-center justify-center transition"
                        aria-label="移除图片"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50 transition flex flex-col items-center justify-center"
                    style={{
                      width: FEATURED_IMAGE_GRID_CELL_SIZE.width,
                      height: FEATURED_IMAGE_GRID_CELL_SIZE.height,
                    }}
                  >
                    <Plus size={30} />
                    <span className="mt-2 text-xs">添加图片</span>
                    <span className="mt-1 text-[11px]">{FEATURED_IMAGE_GRID_CELL_SIZE.width} × {FEATURED_IMAGE_GRID_CELL_SIZE.height}</span>
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">标题</label>
                <div className="flex items-center gap-2">
                  <input
                    value={activePage.title || ''}
                    onChange={(event) => updateCurrentPage({ title: event.target.value })}
                    placeholder="输入单行标题"
                    className="flex-1 min-w-0 px-3 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
                  />
                  <button
                    type="button"
                    onClick={handleAiTitle}
                    className="w-10 h-10 rounded-xl border border-slate-200 text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition flex items-center justify-center"
                    title="AI 生成标题"
                  >
                    <Sparkles size={17} />
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <label className="block text-xs font-medium text-slate-600">正文内容</label>
                  <button
                    type="button"
                    onClick={handleAiBody}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition"
                  >
                    <Sparkles size={13} />
                    AI 生成
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-emerald-100 focus-within:border-emerald-300">
                  <div className="px-2 py-2 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-1.5">
                    {MARKDOWN_ACTIONS.map((action) => {
                      const Icon = action.icon;
                      return (
                        <button
                          key={action.key}
                          type="button"
                          onClick={() => handleInsertMarkdown(action.insert, action.suffix)}
                          className="w-8 h-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white border border-transparent hover:border-slate-200 transition flex items-center justify-center"
                          title={action.label}
                        >
                          <Icon size={15} />
                        </button>
                      );
                    })}
                    <span className="mx-1 h-5 w-px bg-slate-200" />
                    <Smile size={15} className="text-slate-400 mx-1" />
                    {EMOJI_PRESETS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleInsertMarkdown(emoji)}
                        className="w-8 h-8 rounded-lg text-sm hover:bg-white border border-transparent hover:border-slate-200 transition"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <textarea
                    ref={bodyRef}
                    value={activePage.body || ''}
                    onChange={(event) => updateCurrentPage({ body: event.target.value })}
                    placeholder="输入正文，支持 Emoji 和常用 Markdown"
                    rows={16}
                    className="w-full min-h-[360px] px-3 py-3 text-sm leading-6 outline-none resize-y"
                  />
                </div>
              </section>

              <div className="sticky bottom-3 z-10 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur p-3 flex items-center justify-end gap-2 shadow-sm">
                <button
                  type="button"
                  onClick={handleSavePage}
                  disabled={savingPage}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 text-slate-700 hover:border-emerald-200 hover:text-emerald-600 transition"
                >
                  {savingPage ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  保存
                </button>
                <button
                  type="button"
                  onClick={handleOpenLibraryDialog}
                  disabled={storing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {storing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                  存入文章库
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400">
              <button
                type="button"
                onClick={handleAddPage}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-slate-300 hover:border-emerald-300 hover:text-emerald-600 transition"
              >
                <Plus size={18} />
                添加第一个页面
              </button>
            </div>
          )}
        </main>
      </div>

      <FeaturedImagePickerDialog
        open={pickerOpen}
        currentPrompt={activePage?.imagePrompt || ''}
        onClose={() => setPickerOpen(false)}
        onUseImages={handleApplySelectedImages}
        onUseCollage={handleApplyCollageImage}
        onPromptChange={handleAiImagePrompt}
      />
      {previewImage ? (
        <div className="fixed inset-0 z-[97] bg-slate-950/80 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-zoom-out"
            onClick={handleCloseImagePreview}
            aria-label="关闭图片预览"
          />
          <div className="relative max-w-[92vw] max-h-[90dvh]">
            <img
              src={previewImage.src}
              alt={previewImage.label || ''}
              className="max-w-[92vw] max-h-[90dvh] rounded-2xl object-contain shadow-2xl"
            />
            <div className="absolute left-3 top-3 px-3 py-1.5 rounded-full bg-white/90 text-xs text-slate-700 shadow-sm">
              {previewImage.label || '图片预览'}
            </div>
            <button
              type="button"
              onClick={handleCloseImagePreview}
              className="absolute right-3 top-3 w-9 h-9 rounded-full bg-white/90 text-slate-600 hover:text-slate-900 shadow-sm flex items-center justify-center transition"
              aria-label="关闭图片预览"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      ) : null}
      <FeaturedTopicDialog
        open={topicDialogOpen}
        currentTopic={activePage?.topic || ''}
        workspace={activeWorkspace}
        onClose={() => setTopicDialogOpen(false)}
        onSelectTopic={handleSelectTopic}
      />
      <FeaturedLibraryPickerDialog
        open={libraryDialogOpen}
        storing={storing}
        onClose={() => setLibraryDialogOpen(false)}
        onPick={handleStoreIntoLibrary}
      />
    </div>
  );
};

export default FeaturedArticleView;
