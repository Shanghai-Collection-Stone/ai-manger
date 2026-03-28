import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FolderPlus, Image as ImageIcon, Search, Plus, Trash2, X, Upload, MoreHorizontal, Check, RefreshCw, ChevronLeft, Edit2, BrainCircuit, MessageSquare, BookOpen, Type
} from 'lucide-react';
import ThoughtRouteView from './ThoughtRouteView';
import CanvasFeedView from './CanvasFeedView';
import XhsSpecialistView from './XhsSpecialistView';
import ChatBIView from './ChatBIView';
import { showToast } from './blocks/shared';

/**
 * @description Tools View for AI Commander, including AI Gallery
 * @keyword-en ToolsView
 */

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/**
 * @description 获取认证 token
 * @keyword-en get auth token
 */
function getToken() {
  return localStorage.getItem('admin_token') || '';
}

/**
 * @description 获取认证 header
 * @keyword-en get auth headers
 */
function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const api = {
  /**
   * @description List gallery groups
   * @keyword-en listGalleryGroups
   * @param {Object} [params]
   * @param {string} [params.userId]
   * @returns {Promise<Object>}
   */
  async listGalleryGroups({ userId } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery/groups${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders(),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `获取图库分组失败 (${res.status})`, 'error');
        return { groups: [] };
      }
      return data;
    } catch (e) {
      showToast(`获取图库分组失败: ${e?.message || '网络错误'}`, 'error');
      return { groups: [] };
    }
  },

  /**
   * @description Create a new gallery group
   * @keyword-en createGalleryGroup
   * @param {Object} input
   * @returns {Promise<Object|null>}
   */
  async createGalleryGroup(input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(input || {}),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `创建图库分组失败 (${res.status})`, 'error');
        return null;
      }
      return data;
    } catch (e) {
      showToast(`创建图库分组失败: ${e?.message || '网络错误'}`, 'error');
      return null;
    }
  },

  /**
   * @description Update an existing gallery group
   * @keyword-en updateGalleryGroup
   * @param {string|number} id
   * @param {Object} input
   * @returns {Promise<Object|null>}
   */
  async updateGalleryGroup(id, input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/groups/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(input || {}),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `更新图库分组失败 (${res.status})`, 'error');
        return null;
      }
      return data;
    } catch (e) {
      showToast(`更新图库分组失败: ${e?.message || '网络错误'}`, 'error');
      return null;
    }
  },

  /**
   * @description Delete a gallery group
   * @keyword-en deleteGalleryGroup
   * @param {string|number} id
   * @returns {Promise<Object>}
   */
  async deleteGalleryGroup(id) {
    try {
      const res = await fetch(`${API_BASE}/gallery/groups/${id}/delete`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `删除图库分组失败 (${res.status})`, 'error');
        return { ok: false };
      }
      return data;
    } catch (e) {
      showToast(`删除图库分组失败: ${e?.message || '网络错误'}`, 'error');
      return { ok: false };
    }
  },

  /**
   * @description List gallery images with filtering
   * @keyword-en listGalleryImages
   * @param {Object} [params]
   * @returns {Promise<Object>}
   */
  async listGalleryImages({ userId, groupId, tag, includeCollage, cursorId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (groupId !== undefined && groupId !== null && `${groupId}` !== '') {
        params.set('groupId', String(groupId));
      }
      if (tag) params.set('tag', tag);
      if (typeof includeCollage === 'boolean') {
        params.set('includeCollage', includeCollage ? 'true' : 'false');
      }
      if (cursorId !== undefined && cursorId !== null && `${cursorId}` !== '') {
        params.set('cursorId', String(cursorId));
      }
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders(),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `获取图库图片失败 (${res.status})`, 'error');
        return { images: [] };
      }
      return data;
    } catch (e) {
      showToast(`获取图库图片失败: ${e?.message || '网络错误'}`, 'error');
      return { images: [] };
    }
  },

  /**
   * @description Upload images to gallery
   * @keyword-en uploadGalleryImages
   * @param {FileList|File[]} files
   * @param {Object} [body]
   * @returns {Promise<Object>}
   */
  async uploadGalleryImages(files, body) {
    try {
      const fileList = Array.isArray(files) ? files : [];
      const maxFiles = 24;
      const maxFileSize = 12 * 1024 * 1024;
      if (fileList.length > maxFiles) {
        showToast(`最多只能同时上传 ${maxFiles} 个文件`, 'error');
        return { images: [] };
      }
      const oversize = fileList.find((f) => Number(f?.size || 0) > maxFileSize);
      if (oversize) {
        showToast(`文件 ${oversize.name || ''} 超过 12MB 限制`, 'error');
        return { images: [] };
      }
      const fd = new FormData();
      fileList.forEach((f) => fd.append('files', f));
      Object.entries(body || {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        fd.append(k, String(v));
      });
      const res = await fetch(`${API_BASE}/gallery/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      console.log('[upload] status:', res.status, 'ok:', res.ok, 'raw:', raw.substring(0, 500));
      if (!res.ok) {
        showToast(data?.message || `上传失败 (${res.status})`, 'error');
        return { images: [] };
      }
      if (Array.isArray(data.images) && data.images.length > 0) {
        showToast(`上传成功 ${data.images.length} 张图片`, 'success');
      }
      return data;
    } catch (e) {
      showToast(`上传失败: ${e?.message || '网络错误'}`, 'error');
      return { images: [] };
    }
  },

  /**
   * @description List gallery tags
   * @keyword-en listGalleryTags
   * @param {Object} [params]
   * @returns {Promise<Object>}
   */
  async listGalleryTags({ userId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery/tags${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders(),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `获取标签列表失败 (${res.status})`, 'error');
        return { tags: [] };
      }
      return data;
    } catch (e) {
      showToast(`获取标签列表失败: ${e?.message || '网络错误'}`, 'error');
      return { tags: [] };
    }
  },

  /**
   * @description Batch update tags for images
   * @keyword-en batchUpdateGalleryImageTags
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async batchUpdateGalleryImageTags(input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/images/tags/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(input || {}),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `更新标签失败 (${res.status})`, 'error');
        return { matched: 0, modified: 0 };
      }
      return data;
    } catch (e) {
      showToast(`更新标签失败: ${e?.message || '网络错误'}`, 'error');
      return { matched: 0, modified: 0 };
    }
  },

  /**
   * @description Delete a gallery image
   * @keyword-en deleteGalleryImage
   * @param {string|number} id
   * @param {Object} [input]
   * @returns {Promise<Object>}
   */
  async deleteGalleryImage(id, input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/images/${id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(input || {}),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `删除图片失败 (${res.status})`, 'error');
        return { ok: false };
      }
      return data;
    } catch (e) {
      showToast(`删除图片失败: ${e?.message || '网络错误'}`, 'error');
      return { ok: false };
    }
  },

  /**
   * @description Rebuild embeddings for gallery images
   * @keyword-en rebuildGalleryImageEmbeddings
   * @param {Object} [input]
   * @returns {Promise<Object>}
   */
  async rebuildGalleryImageEmbeddings(input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/embeddings/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(input || {}),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `重建向量失败 (${res.status})`, 'error');
        return { updated: 0 };
      }
      return data;
    } catch (e) {
      showToast(`重建向量失败: ${e?.message || '网络错误'}`, 'error');
      return { updated: 0 };
    }
  },

  async listCanvases({ userId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (typeof limit === 'number' && Number.isFinite(limit)) {
        params.set('limit', String(Math.max(1, Math.floor(limit))));
      }
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/canvas${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders(),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `获取Canvas列表失败 (${res.status})`, 'error');
        return { canvases: [] };
      }
      return data;
    } catch (e) {
      showToast(`获取Canvas列表失败: ${e?.message || '网络错误'}`, 'error');
      return { canvases: [] };
    }
  },
};

const mergeUnique = (a, b) => {
  const map = new Map();
  (a || []).forEach((x) => map.set(x.id, x));
  (b || []).forEach((x) => map.set(x.id, x));
  return Array.from(map.values()).sort((p, q) => (q.id || 0) - (p.id || 0));
};

const mergeUniqueStrings = (a, b) => {
  const set = new Set(a || []);
  (b || []).forEach((x) => set.add(x));
  return Array.from(set).sort();
};

const COLLAGE_WIDTH = 640;
const COLLAGE_HEIGHT = 853;
const COLLAGE_DPI = 96;

// 上传图片最大边像素限制
const MAX_UPLOAD_DIMENSION = 4096;

/**
 * @description 获取图片文件的尺寸
 * @param {File} file - 图片文件
 * @returns {Promise<{width: number, height: number}>}
 * @keyword-en get image dimensions
 */
const getImageDimensions = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    resolve({ width: img.naturalWidth, height: img.naturalHeight });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('无法读取图片尺寸'));
  };
  img.src = url;
});

/**
 * @description 检查文件是否需要压缩（边长超过限制）
 * @param {File} file - 图片文件
 * @returns {Promise<boolean>}
 * @keyword-en check if image needs compression
 */
const needsCompression = async (file) => {
  const { width, height } = await getImageDimensions(file);
  return width > MAX_UPLOAD_DIMENSION || height > MAX_UPLOAD_DIMENSION;
};

/**
 * @description 使用 canvas 对图片进行尺寸压缩（保持高画质）
 * @param {File} file - 原始图片文件
 * @param {number} maxDim - 最大边像素限制
 * @returns {Promise<File>} 压缩后的图片文件
 * @keyword-en compress image by resizing with canvas
 */
const compressImage = async (file, maxDim = MAX_UPLOAD_DIMENSION) => {
  const { width, height } = await getImageDimensions(file);
  if (width <= maxDim && height <= maxDim) return file;

  const ratio = Math.min(maxDim / width, maxDim / height);
  const newW = Math.round(width * ratio);
  const newH = Math.round(height * ratio);

  const url = URL.createObjectURL(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, newW, newH);
  URL.revokeObjectURL(url);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95);
  });

  const ext = file.name.split('.').pop() || 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}_${newW}x${newH}.jpg`, { type: 'image/jpeg' });
};

const drawCover = (ctx, img, x, y, width, height) => {
  const iw = Number(img?.naturalWidth || img?.width || 0);
  const ih = Number(img?.naturalHeight || img?.height || 0);
  if (iw <= 0 || ih <= 0) return;
  const scale = Math.max(width / iw, height / ih);
  const sw = iw * scale;
  const sh = ih * scale;
  const dx = x + (width - sw) / 2;
  const dy = y + (height - sh) / 2;
  ctx.drawImage(img, dx, dy, sw, sh);
};

const createTwoImageCollageFile = async (urlA, urlB) => {
  const [imgA, imgB] = await Promise.all([
    loadImageElement(urlA),
    loadImageElement(urlB),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = COLLAGE_WIDTH;
  canvas.height = COLLAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('COLLAGE_CANVAS_CONTEXT_FAILED');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, COLLAGE_WIDTH, COLLAGE_HEIGHT);

  const topH = Math.floor(COLLAGE_HEIGHT / 2);
  const bottomH = COLLAGE_HEIGHT - topH;
  drawCover(ctx, imgA, 0, 0, COLLAGE_WIDTH, topH);
  drawCover(ctx, imgB, 0, topH, COLLAGE_WIDTH, bottomH);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, topH - 1, COLLAGE_WIDTH, 2);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('COLLAGE_BLOB_FAILED'));
    }, 'image/jpeg', 0.92);
  });
  const file = new File(
    [blob],
    `collage-${Date.now()}.jpg`,
    { type: 'image/jpeg' },
  );
  return file;
};

const createCoverFromCollageFile = async (collageUrl, text) => {
  const collageImg = await loadImageElement(collageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = COLLAGE_WIDTH;
  canvas.height = COLLAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('COVER_CANVAS_CONTEXT_FAILED');

  drawCover(ctx, collageImg, 0, 0, COLLAGE_WIDTH, COLLAGE_HEIGHT);

  const plateTop = Math.floor(COLLAGE_HEIGHT * 0.33);
  const plateHeight = Math.floor(COLLAGE_HEIGHT * 0.35);
  const gradient = ctx.createLinearGradient(0, plateTop, 0, plateTop + plateHeight);
  gradient.addColorStop(0, 'rgba(0,0,0,0.52)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.36)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, plateTop, COLLAGE_WIDTH, plateHeight);

  const title = String(text || '').trim().slice(0, 16) || '示例文章';
  const centerX = COLLAGE_WIDTH / 2;
  const centerY = Math.floor(COLLAGE_HEIGHT * 0.52);
  const fontSize = title.length > 8 ? 72 : 84;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `900 ${fontSize}px Impact, 'Arial Black', sans-serif`;

  ctx.lineWidth = 16;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(title, centerX, centerY);

  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, centerX, centerY);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('COVER_BLOB_FAILED'));
    }, 'image/jpeg', 0.92);
  });

  return new File([blob], `cover-${Date.now()}.jpg`, { type: 'image/jpeg' });
};

function TagPicker({ label, value, onChange, allTags, placeholder, disabled }) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const tags = Array.isArray(value) ? value : [];
  const known = Array.isArray(allTags) ? allTags : [];
  const selectedSet = useMemo(() => new Set(tags.map((t) => String(t))), [tags]);

  const suggestions = useMemo(() => {
    const q = String(input || '').trim().toLowerCase();
    const base = known
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .filter((t) => !selectedSet.has(t));
    const filtered = q ? base.filter((t) => t.toLowerCase().includes(q)) : base;
    return filtered.slice(0, 10);
  }, [input, known, selectedSet]);

  const addFromRaw = useCallback((raw) => {
    if (disabled) return;
    const s = String(raw || '').trim();
    if (!s) return;
    const tokens = s.split(/[\s,]+/g).map(x => String(x || '').trim()).filter(Boolean);
    if (tokens.length === 0) return;
    const next = [...tags];
    const nextSet = new Set(selectedSet);
    for (const t of tokens) {
      if (!t || nextSet.has(t)) continue;
      nextSet.add(t);
      next.push(t);
    }
    if (next.length === tags.length) return;
    onChange && onChange(next);
    setInput('');
  }, [disabled, onChange, selectedSet, tags]);

  const removeOne = useCallback((t) => {
    if (disabled) return;
    const key = String(t || '').trim();
    if (!key) return;
    const next = tags.filter((x) => String(x) !== key);
    onChange && onChange(next);
  }, [disabled, onChange, tags]);

  return (
    <div className="space-y-1">
      {label ? <div className="text-xs font-medium text-gray-600">{label}</div> : null}
      <div className={`relative rounded-lg border px-2 py-2 bg-white ${disabled ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">
              {t}
              <button type="button" onClick={() => removeOne(t)} disabled={disabled} className="hover:text-red-500">
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addFromRaw(input); }
              if (e.key === 'Backspace' && !input && tags.length > 0) { removeOne(tags[tags.length - 1]); }
            }}
            placeholder={tags.length === 0 ? placeholder : ''}
            disabled={disabled}
            className="flex-1 min-w-[60px] text-sm outline-none bg-transparent"
          />
        </div>
        {open && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-30 max-h-40 overflow-y-auto">
            {suggestions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addFromRaw(t)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TagFilterDropdown({ value, onChange, allTags }) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const known = Array.isArray(allTags) ? allTags : [];

  const suggestions = useMemo(() => {
    const q = String(input || '').trim().toLowerCase();
    const filtered = q ? known.filter((t) => t.toLowerCase().includes(q)) : known;
    return filtered.slice(0, 12);
  }, [input, known]);

  const select = useCallback((tag) => {
    onChange && onChange(tag);
    setInput('');
    setOpen(false);
  }, [onChange]);

  const clear = useCallback(() => {
    onChange && onChange('');
    setInput('');
  }, [onChange]);

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <input
            type="text"
            value={value || input}
            onChange={(e) => { setInput(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder="筛选标签"
            className="px-3 py-2 text-sm border border-slate-200 rounded-full focus:outline-none focus:border-blue-500 w-full sm:w-28 min-w-[100px] bg-white"
          />
          {open && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-30 max-h-48 overflow-y-auto">
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onMouseDown={() => select(t)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        {value && (
          <button
            onClick={clear}
            className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * @description Gallery view component for managing images and groups
 * @keyword-en GalleryView
 * @param {Object} props
 * @param {Function} props.onBack - Callback when back button is clicked
 */
const GalleryView = ({ onBack }) => {
  const [tab, setTab] = useState('gallery'); // 'gallery' | 'chat' | 'collage' | 'cover'
  const [userId, setUserId] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [images, setImages] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [hasMoreImages, setHasMoreImages] = useState(true);
  const [pageSize] = useState(20);
  const [uploading, setUploading] = useState(false);
  
  // Tags
  const [allTags, setAllTags] = useState([]);
  const [tagFilter, setTagFilter] = useState('');
  
  // Preview State
  const [previewImage, setPreviewImage] = useState(null);
  const [previewAddTags, setPreviewAddTags] = useState([]);
  const [previewRemoveTags, setPreviewRemoveTags] = useState([]);
  
  // Upload Tags State
  const [uploadDraft, setUploadDraft] = useState({ tags: '' });

  // Compression Confirm State
  const [showCompressConfirm, setShowCompressConfirm] = useState(false);
  const [pendingUpload, setPendingUpload] = useState(null); // { files, tags, groupId }

  // Create Group State
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState({ name: '', description: '', tags: '' });
  
  // Edit Group State
  const [isEditingGroup, setIsEditingGroup] = useState(false);
  const [editGroupDraft, setEditGroupDraft] = useState({ name: '', description: '', tags: '' });
  const [collageSelectedIds, setCollageSelectedIds] = useState([]);
  const [collageGenerating, setCollageGenerating] = useState(false);
  const [collageMessage, setCollageMessage] = useState('');
  const [coverSelectedId, setCoverSelectedId] = useState(null);
  const [coverText, setCoverText] = useState('');
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverMessage, setCoverMessage] = useState('');

  // Refs
  const imagesReqIdRef = useRef(0);
  const imagesRef = useRef([]);
  const selectedGroupIdRef = useRef(selectedGroupId);
  const fileRef = useRef(null);
  const loadMoreRef = useRef(null);

  // Sync refs
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { selectedGroupIdRef.current = selectedGroupId; }, [selectedGroupId]);

  const collageSourceImages = useMemo(
    () => (Array.isArray(images) ? images.filter((img) => img?.isCollage !== true) : []),
    [images],
  );

  const collageImages = useMemo(
    () => (Array.isArray(images) ? images.filter((img) => img?.isCollage === true) : []),
    [images],
  );

  // Load Tags
  const loadTags = useCallback(async () => {
    const uid = String(userId || '').trim() || 'default';
    const data = await api.listGalleryTags({ userId: uid, limit: 2000 });
    const list = Array.isArray(data?.tags) ? data.tags : [];
    setAllTags((prev) => {
      const set = new Set(prev);
      list.forEach(t => set.add(t));
      return Array.from(set).sort();
    });
  }, [userId]);

  // Load Groups
  const loadGroups = useCallback(async () => {
    const uid = String(userId || '').trim() || 'default';
    const data = await api.listGalleryGroups({ userId: uid });
    setGroups(Array.isArray(data?.groups) ? data.groups : []);
  }, [userId]);

  // Load Images
  const loadImages = useCallback(async ({ append = false } = {}) => {
    const reqId = (imagesReqIdRef.current += 1);
    setImagesLoading(true);
    try {
      const curImages = imagesRef.current;
      const cursorId = append && curImages.length > 0 ? curImages[curImages.length - 1]?.id : undefined;
      const data = await api.listGalleryImages({
        userId: userId || undefined,
        groupId: selectedGroupIdRef.current ?? undefined,
        tag: tagFilter || undefined,
        cursorId,
        limit: pageSize,
      });
      if (reqId !== imagesReqIdRef.current) return;
      const list = Array.isArray(data?.images) ? data.images : [];
      setHasMoreImages(list.length >= pageSize);
      if (append) {
        setImages((prev) => mergeUnique(prev, list));
      } else {
        setImages(() => mergeUnique([], list));
      }
    } finally {
      if (reqId === imagesReqIdRef.current) setImagesLoading(false);
    }
  }, [pageSize, userId, tagFilter]);

  // Initial Load
  useEffect(() => {
    loadGroups();
    loadTags();
    loadImages();
  }, [loadGroups, loadTags, loadImages]);

  // Reload images when group changes
  useEffect(() => {
    loadImages({ append: false });
  }, [selectedGroupId, loadImages]);

  // Reload images when tag filter changes
  useEffect(() => {
    loadImages({ append: false });
  }, [tagFilter, loadImages]);

  useEffect(() => {
    setCollageSelectedIds([]);
    setCollageMessage('');
    setCoverSelectedId(null);
    setCoverMessage('');
  }, [selectedGroupId, tab]);

  // Infinite Scroll
  useEffect(() => {
    if (!loadMoreRef.current) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !imagesLoading && hasMoreImages) {
        loadImages({ append: true });
      }
    }, { threshold: 0.1 });
    obs.observe(loadMoreRef.current);
    return () => obs.disconnect();
  }, [hasMoreImages, imagesLoading, loadImages]);

  // Create Group
  const onCreateGroup = async () => {
    const name = groupDraft.name.trim();
    if (!name) return;
    const res = await api.createGalleryGroup({
      userId: userId || 'default',
      name,
      description: groupDraft.description,
      tags: groupDraft.tags
    });
    if (res?.group) {
      setGroupDraft({ name: '', description: '', tags: '' });
      setShowCreateGroup(false);
      await loadGroups();
      setSelectedGroupId(res.group.id);
      showToast(`图库分组 "${name}" 创建成功`, 'success');
    }
  };

  // Upload Images
  const onUploadFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const tags = String(uploadDraft.tags || '')
      .split(/[\s,]+/g)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    // 检查是否有图片尺寸过大
    const largeFiles = [];
    for (const file of files) {
      try {
        if (await needsCompression(file)) {
          const { width, height } = await getImageDimensions(file);
          largeFiles.push({ file, width, height });
        }
      } catch {}
    }

    // 多文件上传时，把文件名和大小作为 key 用于后续匹配
    const largeKeys = new Set(largeFiles.map(lf => `${lf.file.name}__${lf.file.size}`));

    if (largeFiles.length > 0) {
      // 有大图，弹出确认框
      setPendingUpload({ files, tags, largeFiles, largeKeys });
      setShowCompressConfirm(true);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    // 尺寸正常，直接上传
    await doUpload(files, tags);
  };

  // 执行上传（内部方法）
  const doUpload = async (files, tags) => {
    setUploading(true);
    try {
      const res = await api.uploadGalleryImages(files, {
        userId: userId || 'default',
        groupId: selectedGroupId,
        tags: tags.length > 0 ? tags.join(',') : undefined,
      });
      if (res?.images) {
        await loadImages({ append: false });
        await loadTags();
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      setUploadDraft({ tags: '' });
    }
  };

  // 确认压缩并上传
  const onConfirmCompress = async () => {
    if (!pendingUpload) return;
    const { files, tags, largeKeys } = pendingUpload;
    setShowCompressConfirm(false);

    setUploading(true);
    try {
      // 压缩所有大图
      const compressedFiles = await Promise.all(
        files.map(async (f) => {
          const key = `${f.name}__${f.size}`;
          if (largeKeys.has(key)) {
            return compressImage(f);
          }
          return f;
        })
      );
      await doUpload(compressedFiles, tags);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      setUploadDraft({ tags: '' });
      setPendingUpload(null);
    }
  };

  // 取消上传
  const onCancelCompress = () => {
    setShowCompressConfirm(false);
    setPendingUpload(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleCollagePick = useCallback((id) => {
    const targetId = Number(id);
    if (!Number.isFinite(targetId)) return;
    setCollageMessage('');
    setCollageSelectedIds((prev) => {
      const has = prev.includes(targetId);
      if (has) return prev.filter((x) => x !== targetId);
      if (prev.length >= 2) return prev;
      return [...prev, targetId];
    });
  }, []);

  const generateCollage = useCallback(async () => {
    if (collageGenerating) return;
    if (!Array.isArray(collageSelectedIds) || collageSelectedIds.length !== 2) {
      setCollageMessage('请先选择 2 张图片');
      return;
    }
    const selected = collageSelectedIds
      .map((id) => collageSourceImages.find((img) => img.id === id))
      .filter(Boolean);
    if (selected.length !== 2) {
      setCollageMessage('选中的图片不存在，请重新选择');
      return;
    }

    setCollageGenerating(true);
    setCollageMessage('');
    try {
      const file = await createTwoImageCollageFile(
        selected[0].url || selected[0].thumbUrl,
        selected[1].url || selected[1].thumbUrl,
      );
      const mergedTags = Array.from(new Set([
        ...((Array.isArray(selected[0].tags) ? selected[0].tags : [])),
        ...((Array.isArray(selected[1].tags) ? selected[1].tags : [])),
        '拼图',
      ]));
      const desc = `双图拼图：#${selected[0].id} + #${selected[1].id}`;
      const uid = String(userId || '').trim() || 'default';
      const res = await api.uploadGalleryImages([file], {
        userId: uid,
        groupId: selectedGroupId,
        tags: mergedTags.join(','),
        description: desc,
        isCollage: 'true',
        collageSourceImageIds: `${selected[0].id},${selected[1].id}`,
        collageWidth: String(COLLAGE_WIDTH),
        collageHeight: String(COLLAGE_HEIGHT),
        collageDpi: String(COLLAGE_DPI),
      });
      if (Array.isArray(res?.images) && res.images.length > 0) {
        setCollageMessage('拼图已生成并入库');
        setCollageSelectedIds([]);
        await loadImages({ append: false });
        await loadTags();
        showToast('拼图生成并入库成功', 'success');
      } else {
        setCollageMessage('拼图上传失败，请稍后重试');
      }
    } catch (e) {
      setCollageMessage(`拼图生成失败：${e?.message || 'unknown error'}`);
    } finally {
      setCollageGenerating(false);
    }
  }, [
    collageGenerating,
    collageSelectedIds,
    collageSourceImages,
    userId,
    selectedGroupId,
    loadImages,
    loadTags,
  ]);

  const generateCover = useCallback(async () => {
    if (coverGenerating) return;
    const targetId = Number(coverSelectedId);
    if (!Number.isFinite(targetId)) {
      setCoverMessage('请先选择 1 张拼图素材');
      return;
    }
    const source = collageImages.find((img) => img.id === targetId);
    if (!source) {
      setCoverMessage('拼图素材不存在，请刷新后重试');
      return;
    }

    const text = String(coverText || '').trim();
    if (!text) {
      setCoverMessage('请先填写封面文字（文章类型）');
      return;
    }

    setCoverGenerating(true);
    setCoverMessage('');
    try {
      const file = await createCoverFromCollageFile(
        source.url || source.thumbUrl,
        text,
      );
      const mergedTags = Array.from(new Set([
        ...((Array.isArray(source.tags) ? source.tags : [])),
        '封面',
        '拼图封面',
        text,
      ]));
      const uid = String(userId || '').trim() || 'default';
      const res = await api.uploadGalleryImages([file], {
        userId: uid,
        groupId: selectedGroupId,
        tags: mergedTags.join(','),
        description: `封面图：基于拼图#${source.id}，文字=${text}`,
      });
      if (Array.isArray(res?.images) && res.images.length > 0) {
        setCoverMessage('封面图已生成并入库');
        setCoverSelectedId(null);
        await loadImages({ append: false });
        await loadTags();
        showToast('封面图生成并入库成功', 'success');
      } else {
        setCoverMessage('封面图上传失败，请稍后重试');
      }
    } catch (e) {
      setCoverMessage(`封面生成失败：${e?.message || 'unknown error'}`);
    } finally {
      setCoverGenerating(false);
    }
  }, [
    coverGenerating,
    coverSelectedId,
    coverText,
    collageImages,
    userId,
    selectedGroupId,
    loadImages,
    loadTags,
  ]);

  const currentGroup = groups.find(g => g.id === selectedGroupId);

  // Preview handlers
  const openPreview = useCallback((img) => {
    setPreviewImage(img);
    setPreviewAddTags([]);
    setPreviewRemoveTags([]);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewImage(null);
    setPreviewAddTags([]);
    setPreviewRemoveTags([]);
  }, []);

  const applyPreviewTags = useCallback(async () => {
    if (!previewImage) return;
    const img = previewImage;
    const addTags = Array.isArray(previewAddTags) ? previewAddTags : [];
    const removeTags = Array.isArray(previewRemoveTags) ? previewRemoveTags : [];
    if (addTags.length === 0 && removeTags.length === 0) {
      closePreview();
      return;
    }
    const uid = userId || 'default';
    await api.batchUpdateGalleryImageTags({
      userId: uid,
      ids: [img.id],
      addTags: addTags.length > 0 ? addTags : undefined,
      removeTags: removeTags.length > 0 ? removeTags : undefined,
    });
    await loadTags();
    setImages((prev) => prev.map((x) => {
      if (x.id !== img.id) return x;
      const currentTags = Array.isArray(x.tags) ? x.tags : [];
      const filtered = currentTags.filter((t) => !removeTags.includes(t));
      const newTags = [...new Set([...filtered, ...addTags])].sort();
      return { ...x, tags: newTags };
    }));
    setPreviewImage((prev) => {
      if (!prev) return null;
      const oldTags = Array.isArray(prev.tags) ? prev.tags : [];
      const filteredOld = oldTags.filter((t) => !removeTags.includes(t));
      const newTagsList = [...new Set([...filteredOld, ...addTags])];
      return { ...prev, tags: newTagsList };
    });
    setPreviewAddTags([]);
    setPreviewRemoveTags([]);
    showToast('标签更新成功', 'success');
  }, [previewImage, previewAddTags, previewRemoveTags, userId, loadTags, closePreview]);

  const deletePreviewImage = useCallback(async () => {
    if (!previewImage) return;
    const img = previewImage;
    const uid = userId || 'default';
    const res = await api.deleteGalleryImage(img.id, { userId: uid });
    if (res?.ok) {
      showToast(`图片 #${img.id} 已删除`, 'success');
      setImages((prev) => prev.filter((x) => x.id !== img.id));
      closePreview();
      await loadTags();
    }
  }, [previewImage, userId, closePreview, loadTags]);

  // Chat tab - render ChatBIView and return early
  if (tab === 'chat') {
    return (
      <div className="h-full flex flex-col bg-white animate-fade-in">
        {/* Header with back + tab switch */}
        <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="inline-flex rounded-full bg-slate-100 p-1 flex-shrink-0">
            <button
              onClick={() => setTab('chat')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              对话
            </button>
            <button
              onClick={() => setTab('gallery')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'gallery' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              图库
            </button>
            <button
              onClick={() => setTab('collage')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'collage' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              拼图
            </button>
            <button
              onClick={() => setTab('cover')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'cover' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              封面
            </button>
          </div>
        </div>
        {/* ChatBIView for gallery chat */}
        <div className="flex-1 min-h-0">
          <ChatBIView
            sessionType="gallery-agent"
            sessionStorageKey="ai_gallery_chat_session"
            welcomeTitle="图库智能助手"
            welcomeDesc="基于图库和标签管理，帮你搜索和管理图片素材"
            quickPrompts={['搜索风景类图片', '查找所有人物照片', '帮我整理图片标签']}
            inputPlaceholder="输入问题，关于图库搜索和管理..."
            showInlineSessionPicker
          />
        </div>
      </div>
    );
  }

  if (tab === 'collage') {
    return (
      <div className="h-full flex flex-col bg-white animate-fade-in">
        <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="inline-flex rounded-full bg-slate-100 p-1 flex-shrink-0">
            <button
              onClick={() => setTab('chat')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              对话
            </button>
            <button
              onClick={() => setTab('gallery')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'gallery' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              图库
            </button>
            <button
              onClick={() => setTab('collage')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'collage' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              拼图
            </button>
            <button
              onClick={() => setTab('cover')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'cover' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              封面
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800">双图拼图</div>
            <div className="text-xs text-slate-500 mt-1">
              规则：必须选择 2 张图；生成成品固定 {COLLAGE_WIDTH}x{COLLAGE_HEIGHT}，分辨率 {COLLAGE_DPI} DPI。
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCollageSelectedIds([])}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-white"
              >
                清空选择
              </button>
              <button
                onClick={() => void generateCollage()}
                disabled={collageGenerating || collageSelectedIds.length !== 2}
                className="px-3 py-1.5 text-xs rounded-lg bg-black text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {collageGenerating ? '拼图生成中...' : '生成拼图并入库'}
              </button>
              <span className="text-xs text-slate-500">
                已选 {collageSelectedIds.length}/2
              </span>
            </div>
            {collageMessage ? (
              <div className="mt-3 text-xs text-slate-600">{collageMessage}</div>
            ) : null}
          </div>

          <div
            className="md:hidden flex overflow-x-auto gap-2 pb-2"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedGroupId(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                selectedGroupId === null ? 'bg-black text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              全部
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                  selectedGroupId === g.id ? 'bg-black text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>

          <div className="hidden md:flex overflow-x-auto gap-2 pb-1">
            <button
              onClick={() => setSelectedGroupId(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                selectedGroupId === null ? 'bg-black text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              全部分组
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                  selectedGroupId === g.id ? 'bg-black text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {collageSourceImages.map((img) => {
              const selected = collageSelectedIds.includes(img.id);
              const disabled = !selected && collageSelectedIds.length >= 2;
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => toggleCollagePick(img.id)}
                  disabled={disabled}
                  className={`aspect-square relative rounded-xl overflow-hidden border transition ${
                    selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
                  } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-400'}`}
                >
                  <img
                    src={img.thumbUrl || img.url}
                    alt={img.description || `image-${img.id}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] flex items-center justify-center">
                    {selected ? '✓' : ''}
                  </div>
                  <div className="absolute left-0 right-0 bottom-0 bg-black/55 text-white text-[10px] px-2 py-1 text-left truncate">
                    #{img.id}
                  </div>
                </button>
              );
            })}
          </div>

          <div ref={loadMoreRef} className="h-10 flex items-center justify-center mt-2">
            {imagesLoading && <RefreshCw className="animate-spin text-slate-400" size={20} />}
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'cover') {
    return (
      <div className="h-full flex flex-col bg-white animate-fade-in">
        <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="inline-flex rounded-full bg-slate-100 p-1 flex-shrink-0">
            <button
              onClick={() => setTab('chat')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              对话
            </button>
            <button
              onClick={() => setTab('gallery')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'gallery' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              图库
            </button>
            <button
              onClick={() => setTab('collage')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'collage' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              拼图
            </button>
            <button
              onClick={() => setTab('cover')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'cover' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              封面
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Type size={16} /> 拼图封面生成
            </div>
            <div className="text-xs text-slate-500 mt-1">
              规则：先选 1 张拼图素材，再输入文章类型文字，系统会生成“拼图 + 浮动文字”封面图并入库。
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={coverText}
                onChange={(e) => setCoverText(e.target.value)}
                placeholder="封面文字（文章类型，如：生日布置）"
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-[240px] max-w-full"
              />
              <button
                onClick={() => {
                  setCoverSelectedId(null);
                  setCoverMessage('');
                }}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-white"
              >
                清空选择
              </button>
              <button
                onClick={() => void generateCover()}
                disabled={coverGenerating || !Number.isFinite(Number(coverSelectedId)) || !String(coverText || '').trim()}
                className="px-3 py-1.5 text-xs rounded-lg bg-black text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {coverGenerating ? '封面生成中...' : '生成封面并入库'}
              </button>
              <span className="text-xs text-slate-500">
                已选 {Number.isFinite(Number(coverSelectedId)) ? 1 : 0}/1
              </span>
            </div>
            {coverMessage ? (
              <div className="mt-3 text-xs text-slate-600">{coverMessage}</div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {collageImages.map((img) => {
              const selected = Number(coverSelectedId) === Number(img.id);
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => {
                    setCoverSelectedId(img.id);
                    setCoverMessage('');
                  }}
                  className={`aspect-square relative rounded-xl overflow-hidden border transition ${
                    selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <img
                    src={img.thumbUrl || img.url}
                    alt={img.description || `collage-${img.id}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] flex items-center justify-center">
                    {selected ? '✓' : ''}
                  </div>
                  <div className="absolute left-0 right-0 bottom-0 bg-black/55 text-white text-[10px] px-2 py-1 text-left truncate">
                    拼图 #{img.id}
                  </div>
                </button>
              );
            })}
          </div>

          {collageImages.length === 0 && (
            <div className="text-center text-xs text-slate-400 py-8 border border-dashed border-slate-200 rounded-xl">
              当前分组暂无拼图素材，请先到“拼图”Tab生成后再制作封面。
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 border-b border-slate-100 bg-white/90 gap-3 sm:gap-0">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800 shrink-0">
            <ChevronLeft size={22} />
          </button>
          <div className="inline-flex rounded-full bg-slate-100 p-1 flex-shrink-0">
            <button
              onClick={() => setTab('chat')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              对话
            </button>
            <button
              onClick={() => setTab('gallery')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'gallery' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              图库
            </button>
            <button
              onClick={() => setTab('collage')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'collage' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              拼图
            </button>
            <button
              onClick={() => setTab('cover')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'cover' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              封面
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 justify-end w-full sm:w-auto overflow-visible px-1 pb-1 sm:p-0">
          <TagFilterDropdown
            value={tagFilter}
            onChange={(tag) => setTagFilter(tag)}
            allTags={allTags}
          />
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            ref={fileRef}
            onChange={onUploadFiles}
          />
          <input
            type="text"
            value={uploadDraft.tags}
            onChange={(e) => setUploadDraft({ ...uploadDraft, tags: e.target.value })}
            placeholder="标签(逗号分隔)"
            className="px-3 py-2 text-sm border border-slate-200 rounded-full focus:outline-none focus:border-blue-500 w-full sm:w-32 min-w-[120px]"
          />
          <button 
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="shrink-0 flex items-center justify-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-semibold hover:bg-slate-800 transition shadow-lg shadow-slate-200 disabled:opacity-50 disabled:shadow-none whitespace-nowrap"
          >
            {uploading ? <RefreshCw className="animate-spin" size={16} /> : <Upload size={16} />}
            <span>上传</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        <div className="w-64 border-r border-slate-100 bg-slate-50 flex-col hidden md:flex">
          <div className="p-3 border-b border-slate-100 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">图库分组</span>
            <button onClick={() => setShowCreateGroup(true)} className="p-1 hover:bg-slate-200 rounded text-slate-500">
              <Plus size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button
              onClick={() => setSelectedGroupId(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition flex justify-between ${
                selectedGroupId === null ? 'bg-white shadow-sm text-blue-600' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>全部图片</span>
            </button>
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition flex justify-between ${
                  selectedGroupId === g.id ? 'bg-white shadow-sm text-blue-600' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span className="truncate">{g.name}</span>
                <span className="text-xs text-slate-400 ml-2">{g.image_count || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Grid */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
           {/* Mobile Group Selector */}
           <div 
             className="md:hidden mb-4 flex overflow-x-auto gap-2 pb-2"
             onTouchStart={(e) => e.stopPropagation()}
             onTouchEnd={(e) => e.stopPropagation()}
           >
            <button
                onClick={() => setSelectedGroupId(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                  selectedGroupId === null ? 'bg-black text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                全部
              </button>
              {groups.map(g => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                    selectedGroupId === g.id ? 'bg-black text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {g.name}
                </button>
              ))}
           </div>

           {/* Images Grid */}
           <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {images.map(img => (
                <div key={img.id} onClick={() => openPreview(img)} className="aspect-square bg-slate-100 rounded-xl overflow-hidden relative group cursor-pointer">
                  <img 
                    src={img.thumbUrl || img.url} 
                    alt={img.description || 'Image'} 
                    className="w-full h-full object-cover transition transform group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                  {img?.isCollage === true && (
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-blue-600/85 text-white text-[10px]">
                      拼图
                    </div>
                  )}
                  {Array.isArray(img.tags) && img.tags.length > 0 && (
                    <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-0.5">
                      {img.tags.slice(0, 3).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] truncate max-w-full">
                          {t}
                        </span>
                      ))}
                      {img.tags.length > 3 && (
                        <span className="px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
                          +{img.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
           </div>
           
           {/* Load More Trigger */}
           <div ref={loadMoreRef} className="h-10 flex items-center justify-center mt-4">
              {imagesLoading && <RefreshCw className="animate-spin text-slate-400" size={20} />}
           </div>
        </div>
      </div>

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <h3 className="text-lg font-bold mb-4">新建图库分组</h3>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
              placeholder="分组名称"
              value={groupDraft.name}
              onChange={e => setGroupDraft({...groupDraft, name: e.target.value})}
            />
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:border-blue-500 h-24 resize-none"
              placeholder="描述 (可选)"
              value={groupDraft.description}
              onChange={e => setGroupDraft({...groupDraft, description: e.target.value})}
            />
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setShowCreateGroup(false)}
                className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm font-medium"
              >
                取消
              </button>
              <button 
                onClick={onCreateGroup}
                className="px-4 py-2 rounded-lg bg-black text-white hover:bg-slate-800 text-sm font-medium"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compression Confirm Modal */}
      {showCompressConfirm && pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-lg font-bold mb-2 text-amber-600">图片尺寸过大</h3>
            <p className="text-sm text-slate-600 mb-4">
              以下图片尺寸超过 {MAX_UPLOAD_DIMENSION} 像素，可能导致上传失败（413 Payload Too Large）：
            </p>
            <div className="bg-slate-50 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto space-y-2">
              {pendingUpload.largeFiles.map(({ file, width, height }, idx) => (
                <div key={idx} className="text-xs text-slate-700 flex items-center gap-2">
                  <span className="shrink-0 w-6 h-6 bg-amber-100 text-amber-700 rounded flex items-center justify-center text-[10px] font-bold">{idx + 1}</span>
                  <span className="truncate flex-1" title={file.name}>{file.name}</span>
                  <span className="text-slate-400 shrink-0">{width} × {height}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-600 mb-4">
              点击"压缩上传"将自动把图片最大边缩至 {MAX_UPLOAD_DIMENSION} 像素（高画质 JPEG），然后上传。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancelCompress}
                className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm font-medium"
              >
                取消
              </button>
              <button
                onClick={onConfirmCompress}
                className="px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-sm font-medium"
              >
                压缩上传
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closePreview} />
          <div className="relative w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200 flex flex-col max-h-[95vh] md:max-h-[85vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
              <div className="min-w-0 pr-3">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  #{previewImage.id} {previewImage.originalName || ''}
                </div>
                <div className="text-xs text-gray-500 truncate">{previewImage.fileName || ''}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={deletePreviewImage}
                  className="h-8 px-3 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 hidden sm:block"
                >
                  删除
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  className="h-8 px-3 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col md:grid md:grid-cols-2 min-h-0 bg-white">
              <div className="bg-black/5 p-4 flex items-center justify-center min-h-[30vh] md:min-h-0 shrink-0">
                <img
                  src={previewImage.url || previewImage.thumbUrl}
                  alt={previewImage.originalName || `img-${previewImage.id}`}
                  className="max-h-[40vh] md:max-h-[70vh] w-full object-contain rounded-lg"
                  loading="eager"
                  decoding="async"
                />
              </div>
              <div className="p-4 space-y-3 bg-white shrink-0">
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-1">原图路径</div>
                  <div className="text-xs break-all bg-gray-50 p-2 rounded border border-gray-200">
                    {previewImage.url || ''}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">当前标签</div>
                  {Array.isArray(previewImage.tags) && previewImage.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {previewImage.tags.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 italic mb-2">暂无标签</div>
                  )}
                </div>

                {previewImage?.isCollage === true && (
                  <div className="text-xs text-gray-600">
                    拼图来源：
                    {Array.isArray(previewImage.collageSourceImageIds) && previewImage.collageSourceImageIds.length > 0
                      ? previewImage.collageSourceImageIds.map((id) => `#${id}`).join(' + ')
                      : '未知'}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3">
                  <TagPicker
                    label="添加标签"
                    value={previewAddTags}
                    onChange={setPreviewAddTags}
                    allTags={allTags}
                    placeholder="输入或选择，回车添加"
                    disabled={false}
                  />
                  <TagPicker
                    label="移除标签"
                    value={previewRemoveTags}
                    onChange={setPreviewRemoveTags}
                    allTags={Array.isArray(previewImage.tags) ? previewImage.tags : []}
                    placeholder="输入或选择，回车添加"
                    disabled={false}
                  />
                </div>

                <div className="flex justify-between md:justify-end gap-2 pt-2 mt-4 border-t border-gray-100 md:border-none md:mt-0 md:pt-0">
                  <button
                    type="button"
                    onClick={deletePreviewImage}
                    className="h-8 px-4 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 sm:hidden"
                  >
                    删除图片
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewAddTags([]);
                        setPreviewRemoveTags([]);
                      }}
                      className="h-8 px-4 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                      清空
                    </button>
                    <button
                    type="button"
                    onClick={applyPreviewTags}
                    disabled={((previewAddTags?.length || 0) === 0 && (previewRemoveTags?.length || 0) === 0)}
                    className="h-8 px-4 text-sm bg-black text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    应用标签
                  </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ToolsView = ({ onThoughtRouteChange }) => {
  const [view, setView] = useState('list'); // 'list' | 'gallery' | 'thought' | 'canvas' | 'xhs-specialist'
  const [canvases, setCanvases] = useState([]);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasQuery, setCanvasQuery] = useState('');
  const [activeCanvasId, setActiveCanvasId] = useState(null);

  const loadCanvases = useCallback(async () => {
    setCanvasLoading(true);
    try {
      const res = await api.listCanvases({ limit: 100 });
      const rows = Array.isArray(res?.canvases) ? res.canvases : [];
      setCanvases(rows);
    } finally {
      setCanvasLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof onThoughtRouteChange === 'function') {
      onThoughtRouteChange(view !== 'list');
    }
    return () => {
      if (typeof onThoughtRouteChange === 'function') {
        onThoughtRouteChange(false);
      }
    };
  }, [onThoughtRouteChange, view]);

  useEffect(() => {
    if (view === 'canvas') {
      void loadCanvases();
    }
  }, [view, loadCanvases]);

  if (view === 'gallery') {
    return <GalleryView onBack={() => setView('list')} />;
  }
  if (view === 'thought') {
    return <ThoughtRouteView onBack={() => setView('list')} />;
  }
  if (view === 'xhs-specialist') {
    return <XhsSpecialistView onBack={() => setView('list')} />;
  }
  if (view === 'canvas') {
    if (Number.isFinite(activeCanvasId)) {
      return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col h-[100dvh]">
          <CanvasFeedView
            canvasId={activeCanvasId}
            onClose={() => setActiveCanvasId(null)}
          />
        </div>
      );
    }
    
    const normalizedQuery = String(canvasQuery || '').trim().toLowerCase();
    const filtered = (Array.isArray(canvases) ? canvases : []).filter((c) => {
      if (!normalizedQuery) return true;
      const idText = String(c?.id ?? '').toLowerCase();
      const topic = String(c?.topic ?? '').toLowerCase();
      return idText.includes(normalizedQuery) || topic.includes(normalizedQuery);
    });
    return (
      <div className="h-full flex flex-col bg-white animate-fade-in">
        {/* Header matching other tools */}
        <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
          <button
            onClick={() => setView('list')}
            className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="font-bold text-slate-800">Canvas 管理</div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <div className="flex items-center gap-2 mb-3 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
              <Search size={16} className="text-slate-400" />
              <input
                value={canvasQuery}
                onChange={(e) => setCanvasQuery(e.target.value)}
                placeholder="按 Canvas ID / 主题筛选"
                className="w-full text-sm bg-transparent outline-none placeholder:text-slate-400"
              />
              <button
                onClick={() => void loadCanvases()}
                className="text-slate-400 hover:text-slate-600"
              >
                <RefreshCw size={14} className={canvasLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            
            {canvasLoading ? (
              <div className="py-12 flex items-center justify-center text-slate-400">
                <RefreshCw size={24} className="animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">暂无 Canvas</div>
            ) : (
              <div className="space-y-2">
                {filtered.map((c) => (
                  <button
                    key={String(c?.id ?? Math.random())}
                    onClick={() => {
                      const id = Number(c?.id);
                      if (Number.isFinite(id)) setActiveCanvasId(id);
                    }}
                    className="w-full flex items-center justify-between text-left p-3 rounded-xl border border-slate-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/30 transition shadow-sm"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-800 line-clamp-1">
                        {c?.topic || `Canvas #${c?.id ?? '-'}`}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {`#${c?.id ?? '-'} · ${(Array.isArray(c?.articles) ? c.articles.length : 0)} 篇 · ${c?.status || 'unknown'}`}
                      </div>
                    </div>
                    <ChevronLeft size={16} className="text-slate-300 rotate-180" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden animate-fade-in p-4">
      <div className="flex-1 overflow-y-auto">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div 
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-blue-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => setView('gallery')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          
          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-4 text-white shadow-blue-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <ImageIcon size={32} />
          </div>
          
          <span className="font-bold text-slate-800 text-lg z-10">AI 图库</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10">管理素材与图片</span>
          
          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-blue-500">
             <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>
        
        <div 
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-indigo-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => setView('thought')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          
          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mb-4 text-white shadow-indigo-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <BrainCircuit size={32} />
          </div>
          
          <span className="font-bold text-slate-800 text-lg z-10">思维链路</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10">Schema理解与链路沉淀</span>
          
          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-indigo-500">
             <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>

        <div 
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-emerald-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => setView('canvas')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          
          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4 text-white shadow-emerald-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <FolderPlus size={30} />
          </div>
          
          <span className="font-bold text-slate-800 text-lg z-10">Canvas 管理</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10">查看与预览画布</span>
          
          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-emerald-500">
             <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>

        {/* XHS Specialist Card */}
        <div
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-rose-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => setView('xhs-specialist')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-rose-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center mb-4 text-white shadow-rose-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <BookOpen size={30} />
          </div>

          <span className="font-bold text-slate-800 text-lg z-10">小红书专家</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10">专项内容助手</span>

          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-rose-500">
             <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default ToolsView;
