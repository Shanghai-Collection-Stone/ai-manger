import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FolderPlus, Image as ImageIcon, Search, Plus, Trash2, X, Upload, MoreHorizontal, Check, RefreshCw, ChevronLeft, Edit2, BrainCircuit, MessageSquare, BookOpen, Type, Loader2, Library, ShieldCheck, FileArchive, FileText, Video
} from 'lucide-react';
import { showToast } from './blocks/shared';

/**
 * @description 视图级懒加载包装器：子视图拆成独立 chunk，切到该视图时才下载，调用处写法保持不变
 * @keyword-cn 按需加载, 代码分割
 * @keyword-en lazy-import, code-splitting
 * @param {Function} loader - 返回 import() Promise 的加载函数
 * @returns {React.ComponentType} 自带 Suspense 的组件
 */
const lazyView = (loader) => {
  const Loaded = React.lazy(loader);
  const Wrapped = (props) => (
    <React.Suspense
      fallback={
        <div className="w-full h-full min-h-[240px] flex items-center justify-center text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      }
    >
      <Loaded {...props} />
    </React.Suspense>
  );
  return Wrapped;
};

const ThoughtRouteView = lazyView(() => import('./ThoughtRouteView'));
const XhsSpecialistView = lazyView(() => import('./XhsSpecialistView'));
const DouyinSpecialistView = lazyView(() => import('./DouyinSpecialistView'));
const CanvasFeedView = lazyView(() => import('./CanvasFeedView'));
const ImageGroupCanvasView = lazyView(() => import('./ImageGroupCanvasView'));
const ChatBIView = lazyView(() => import('./ChatBIView'));
const ArticleLibraryView = lazyView(() => import('./ArticleLibraryView'));
const FeaturedArticleView = lazyView(() => import('./FeaturedArticleView'));
const AntiDetectionView = lazyView(() => import('./AntiDetectionView'));
const DesignEditorView = lazyView(() => import('./design-editor/DesignEditorView'));
const GalleryZipImportPanel = lazyView(() => import('./GalleryZipImportPanel'));

/**
 * @description Tools View for AI Commander, including AI Gallery
 * @keyword-en tools-view
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

const TOOL_VIEW_KEYS = new Set([
  'list',
  'gallery',
  'thought',
  'canvas',
  'xhs-specialist',
  'douyin-specialist',
  'article-library',
  'featured-article',
  'anti-detection',
  'design-editor',
]);
const GALLERY_TAB_KEYS = new Set(['chat', 'gallery', 'collage', 'cover']);
const TOOL_POPUP_ALIASES = new Map([
  ['gallery-zip-import', 'gallery-zip-import'],
  ['zip-import', 'gallery-zip-import'],
  ['gallery-create-group', 'gallery-create-group'],
  ['create-gallery-group', 'gallery-create-group'],
  ['gallery-batch-tags', 'gallery-batch-tags'],
  ['batch-tags', 'gallery-batch-tags'],
  ['article-library-create', 'article-library-create'],
  ['create-article-library', 'article-library-create'],
  ['article-library-edit', 'article-library-edit'],
  ['edit-article-library', 'article-library-edit'],
]);

/**
 * @description 归一化工具入口 URL 参数。
 * @keyword-en url-route
 * @keyword-en tool-view
 * @param {string|null|undefined} value - URL 中的工具视图值。
 * @returns {string|null}
 */
const normalizeToolViewParam = (value) => {
  const key = String(value || '').trim();
  return TOOL_VIEW_KEYS.has(key) ? key : null;
};

/**
 * @description 归一化图库内部 Tab URL 参数。
 * @keyword-en url-route
 * @keyword-en gallery-tab
 * @param {string|null|undefined} value - URL 中的图库 Tab 值。
 * @returns {string|null}
 */
const normalizeGalleryTabParam = (value) => {
  const key = String(value || '').trim();
  return GALLERY_TAB_KEYS.has(key) ? key : null;
};

/**
 * @description 归一化工具弹层 URL 参数。
 * @keyword-en url-route
 * @keyword-en tool-popup
 * @param {string|null|undefined} value - URL 中的工具弹层值。
 * @returns {string|null}
 */
const normalizeToolPopupParam = (value) => {
  const key = String(value || '').trim();
  return TOOL_POPUP_ALIASES.get(key) || null;
};

/**
 * @description 读取效能工具 URL 参数并推导工具视图、内部 Tab 和弹层。
 * @keyword-en url-route
 * @keyword-en tool-state
 * @returns {{ view: string|null, galleryTab: string|null, popup: string|null, libraryId: number|null, editLibraryId: number|null, articleLibraryTab: string }}
 */
const readToolsRouteParams = () => {
  if (typeof window === 'undefined') {
    return { view: null, galleryTab: null, popup: null, libraryId: null, editLibraryId: null, articleLibraryTab: '' };
  }
  const params = new URLSearchParams(window.location.search || '');
  const popup = normalizeToolPopupParam(
    params.get('popup') || params.get('modal') || params.get('dialog') || params.get('open'),
  );
  let view = normalizeToolViewParam(params.get('tool') || params.get('toolView'));
  const libraryId = Number(params.get('libraryId') || params.get('articleLibraryId'));
  const editLibraryId = Number(params.get('editLibraryId') || params.get('articleLibraryEditId'));
  if (!view && Number.isFinite(libraryId) && libraryId > 0) {
    view = 'article-library';
  }
  if (!view && popup) {
    if (popup.startsWith('gallery-')) view = 'gallery';
    if (popup.startsWith('article-library-')) view = 'article-library';
  }
  return {
    view,
    galleryTab: normalizeGalleryTabParam(params.get('galleryTab') || params.get('toolTab')),
    popup,
    libraryId: Number.isFinite(libraryId) && libraryId > 0 ? libraryId : null,
    editLibraryId: Number.isFinite(editLibraryId) && editLibraryId > 0 ? editLibraryId : null,
    articleLibraryTab: String(params.get('articleLibraryTab') || params.get('libraryTab') || params.get('detailTab') || '').trim(),
  };
};

/**
 * @description 更新效能工具 URL 参数,用于同步工具卡片、内部 Tab 和弹层。
 * @keyword-en url-route
 * @keyword-en query-sync
 * @param {Record<string, string|number|null|undefined>} patch - 要写入或删除的查询参数。
 * @param {{ replace?: boolean }} [options] - 历史记录写入方式。
 */
const updateToolsSearchParams = (patch, { replace = true } = {}) => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value === null || value === '') {
      url.searchParams.delete(key);
      return;
    }
    url.searchParams.set(key, String(value));
  });
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === current) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
};

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
  async listGalleryImages({ userId, groupId, tag, includeCollage, imageType, cursorId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (groupId !== undefined && groupId !== null && `${groupId}` !== '') {
        params.set('groupId', String(groupId));
      }
      if (tag) params.set('tag', tag);
      if (imageType) {
        params.set('imageType', imageType);
      } else if (typeof includeCollage === 'boolean') {
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
   * @description 批量删除图库图片
   * @keyword-en batchDeleteGalleryImages
   * @keyword-cn 图库批量删除
   * @param {{ userId: string, ids: Array<number|string> }} input
   * @returns {Promise<{ deleted: number, failed: number, deletedIds: number[] }>}
   */
  async batchDeleteGalleryImages(input) {
    try {
      const res = await fetch(`${API_BASE}/gallery/images/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(input || {}),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `批量删除失败 (${res.status})`, 'error');
        return { deleted: 0, failed: 0, deletedIds: [] };
      }
      return data;
    } catch (e) {
      showToast(`批量删除失败: ${e?.message || '网络错误'}`, 'error');
      return { deleted: 0, failed: 0, deletedIds: [] };
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
      const res = await fetch(`${API_BASE}/gallery/images/embedding/rebuild`, {
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

  /**
   * @description 通过 XMLHttpRequest 上传 ZIP 包并报告真实字节进度，服务端接收后进入后台队列。
   * @keyword-cn ZIP上传, 上传速度
   * @keyword-en zip-upload, upload-speed
   * @param {File} file - zip 文件
   * @param {Object} body - { groupId, tags }
   * @param {(progress: { loaded: number, total: number }) => void} [onProgress] - 上传字节进度回调
   * @returns {Promise<Object>}
   */
  async uploadGalleryZip(file, body, onProgress) {
    try {
      if (!file) {
        showToast('请先选择 ZIP 文件', 'error');
        return { job: null };
      }
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(body || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        fd.append(k, String(v));
      });
      return await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/gallery/zip-import/upload`);
        Object.entries(getAuthHeaders()).forEach(([name, value]) => {
          xhr.setRequestHeader(name, value);
        });
        xhr.upload.onprogress = (event) => {
          if (typeof onProgress !== 'function') return;
          onProgress({
            loaded: Number(event.loaded) || 0,
            total: event.lengthComputable ? Number(event.total) || 0 : Number(file.size) || 0,
          });
        };
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch {}
          if (xhr.status < 200 || xhr.status >= 300) {
            showToast(data?.message || `ZIP 上传失败 (${xhr.status})`, 'error');
            resolve({ job: null });
            return;
          }
          showToast('ZIP 已上传,正在后台解压', 'success');
          resolve(data);
        };
        xhr.onerror = () => {
          showToast('ZIP 上传失败: 网络错误', 'error');
          resolve({ job: null });
        };
        xhr.onabort = () => {
          showToast('ZIP 上传已取消', 'error');
          resolve({ job: null });
        };
        xhr.send(fd);
      });
    } catch (e) {
      showToast(`ZIP 上传失败: ${e?.message || '网络错误'}`, 'error');
      return { job: null };
    }
  },

  /**
   * @description 列出当前作用域最近的 zip 导入任务
   * @keyword-en listGalleryZipImports
   */
  async listGalleryZipImports({ userId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery/zip-import/list${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders(),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        return { jobs: [] };
      }
      return data;
    } catch {
      return { jobs: [] };
    }
  },

  /**
   * @description 取消单个 zip 导入任务
   * @keyword-en cancelGalleryZipImport
   */
  async cancelGalleryZipImport(id) {
    try {
      const res = await fetch(`${API_BASE}/gallery/zip-import/${id}/cancel`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `取消失败 (${res.status})`, 'error');
        return { ok: false };
      }
      return data;
    } catch (e) {
      showToast(`取消失败: ${e?.message || '网络错误'}`, 'error');
      return { ok: false };
    }
  },

  /**
   * @description 删除一条 zip 导入任务记录(仅完成/失败/取消态)
   * @keyword-en deleteGalleryZipImport
   */
  async deleteGalleryZipImport(id) {
    try {
      const res = await fetch(`${API_BASE}/gallery/zip-import/${id}/delete`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok) {
        showToast(data?.message || `删除失败 (${res.status})`, 'error');
        return { ok: false };
      }
      return data;
    } catch (e) {
      showToast(`删除失败: ${e?.message || '网络错误'}`, 'error');
      return { ok: false };
    }
  },

  async listCanvases({ userId, limit, type, skip, tag } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (typeof limit === 'number' && Number.isFinite(limit)) {
        params.set('limit', String(Math.max(1, Math.floor(limit))));
      }
      if (type) params.set('type', type);
      if (typeof skip === 'number' && skip > 0) params.set('skip', String(Math.floor(skip)));
      if (tag) params.set('tag', tag);
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

/**
 * @description 从 URL 加载 Image 元素
 * @param {string} url - 图片 URL
 * @returns {Promise<HTMLImageElement>}
 * @keyword-en load image element from url
 */
const loadImageElement = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('LOAD_IMAGE_FAILED'));
  img.src = url;
});

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
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, COLLAGE_WIDTH, COLLAGE_HEIGHT);

  const topH = Math.floor(COLLAGE_HEIGHT / 2);
  const bottomH = COLLAGE_HEIGHT - topH;

  // 上图：等比缩到 topH 高度，居中放置（超宽则两侧自然裁剪，不足则黑边）
  const iwA = Number(imgA?.naturalWidth || imgA?.width || 0);
  const ihA = Number(imgA?.naturalHeight || imgA?.height || 0);
  if (iwA > 0 && ihA > 0) {
    const scaleA = topH / ihA;
    const drawWA = Math.round(iwA * scaleA);
    const drawXA = Math.floor((COLLAGE_WIDTH - drawWA) / 2);
    ctx.drawImage(imgA, drawXA, 0, drawWA, topH);
  }

  // 下图：等比缩到 bottomH 高度，居中放置
  const iwB = Number(imgB?.naturalWidth || imgB?.width || 0);
  const ihB = Number(imgB?.naturalHeight || imgB?.height || 0);
  if (iwB > 0 && ihB > 0) {
    const scaleB = bottomH / ihB;
    const drawWB = Math.round(iwB * scaleB);
    const drawXB = Math.floor((COLLAGE_WIDTH - drawWB) / 2);
    ctx.drawImage(imgB, drawXB, topH, drawWB, bottomH);
  }

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

/**
 * @description 为竖图（Portrait）直接添加文字封面
 * @param {string} imageUrl - 图片 URL
 * @param {string} text - 封面文字
 * @param {{ width: number, height: number }} [dims] - 图片原始尺寸（可选，用于裁剪中心区域）
 * @returns {Promise<File>} 封面文件
 * @keyword-en create portrait cover with text overlay
 */
const createCoverFromSingleImageFile = async (imageUrl, text, dims) => {
  const img = await loadImageElement(imageUrl);
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  if (iw === 0 || ih === 0) throw new Error('INVALID_IMAGE_SIZE');

  // 使用固定封面尺寸展示（裁剪中心区域适配）
  const COVER_W = 640;
  const COVER_H = 853;
  const canvas = document.createElement('canvas');
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('COVER_CANVAS_CONTEXT_FAILED');

  // 绘制图片（cover 模式填充）
  drawCover(ctx, img, 0, 0, COVER_W, COVER_H);

  // 添加文字遮罩和文字
  const plateTop = Math.floor(COVER_H * 0.33);
  const plateHeight = Math.floor(COVER_H * 0.35);
  const gradient = ctx.createLinearGradient(0, plateTop, 0, plateTop + plateHeight);
  gradient.addColorStop(0, 'rgba(0,0,0,0.52)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.36)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, plateTop, COVER_W, plateHeight);

  const title = String(text || '').trim().slice(0, 16) || '示例文章';
  const centerX = COVER_W / 2;
  const centerY = Math.floor(COVER_H * 0.52);
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
    <div className="relative shrink-0">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <input
            type="text"
            value={value || input}
            onChange={(e) => { setInput(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder="标签"
            className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-slate-200 rounded-full focus:outline-none focus:border-blue-500 w-20 sm:w-28 bg-white"
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
 * @keyword-en gallery, gallery-view, infinite-scroll
 * @param {Object} props
 * @param {Function} props.onBack - Callback when back button is clicked
 */
const GalleryView = ({ onBack, routeGalleryTab, routePopup, onRoutePatch }) => {
  const [tab, setTab] = useState(() => normalizeGalleryTabParam(routeGalleryTab) || 'gallery'); // 'gallery' | 'chat' | 'collage' | 'cover'
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

  // ZIP Import Panel State
  const [zipPanelOpen, setZipPanelOpen] = useState(false);

  // Batch Select State (gallery tab)
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState([]);
  const [batchSelectAllActive, setBatchSelectAllActive] = useState(false);
  const [showBatchTagModal, setShowBatchTagModal] = useState(false);
  const [batchAddTags, setBatchAddTags] = useState([]);
  const [batchRemoveTags, setBatchRemoveTags] = useState([]);
  const [batchTagSaving, setBatchTagSaving] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // Refs
  const imagesReqIdRef = useRef(0);
  const imagesLoadingRef = useRef(false);
  const hasMoreImagesRef = useRef(hasMoreImages);
  const loadMoreArmedRef = useRef(true);
  const imagesRef = useRef([]);
  const selectedGroupIdRef = useRef(selectedGroupId);
  const tabRef = useRef(tab);
  const fileRef = useRef(null);
  const loadMoreRef = useRef(null);

  // Sync refs
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { hasMoreImagesRef.current = hasMoreImages; }, [hasMoreImages]);
  useEffect(() => { selectedGroupIdRef.current = selectedGroupId; }, [selectedGroupId]);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  /**
   * @description 切换图库内部 Tab 并同步 URL 参数。
   * @keyword-en url-route
   * @keyword-en gallery-tab
   * @param {string} nextTab - 下一个图库 Tab。
   */
  const selectGalleryTab = useCallback((nextTab) => {
    const targetTab = normalizeGalleryTabParam(nextTab);
    if (!targetTab) return;
    setTab(targetTab);
    onRoutePatch?.({
      tab: 'tools',
      tool: 'gallery',
      galleryTab: targetTab,
    });
  }, [onRoutePatch]);

  /**
   * @description 打开图库工具弹层并同步 URL 参数。
   * @keyword-en url-route
   * @keyword-en tool-popup
   * @param {string} popup - 图库弹层标识。
   */
  const openGalleryPopup = useCallback((popup) => {
    const targetPopup = normalizeToolPopupParam(popup);
    if (!targetPopup) return;
    if (targetPopup === 'gallery-zip-import') {
      setZipPanelOpen(true);
    }
    if (targetPopup === 'gallery-create-group') {
      setShowCreateGroup(true);
    }
    if (targetPopup === 'gallery-batch-tags') {
      setShowBatchTagModal(true);
      setBatchAddTags([]);
      setBatchRemoveTags([]);
    }
    onRoutePatch?.({
      tab: 'tools',
      tool: 'gallery',
      popup: targetPopup,
      galleryTab: tabRef.current,
    });
  }, [onRoutePatch]);

  /**
   * @description 关闭图库工具弹层并清理 URL 弹层参数。
   * @keyword-en url-route
   * @keyword-en tool-popup
   * @param {string} popup - 图库弹层标识。
   */
  const closeGalleryPopup = useCallback((popup) => {
    const targetPopup = normalizeToolPopupParam(popup);
    if (targetPopup === 'gallery-zip-import') {
      setZipPanelOpen(false);
    }
    if (targetPopup === 'gallery-create-group') {
      setShowCreateGroup(false);
    }
    if (targetPopup === 'gallery-batch-tags') {
      setShowBatchTagModal(false);
    }
    onRoutePatch?.({
      popup: null,
      modal: null,
      dialog: null,
      open: null,
    });
  }, [onRoutePatch]);

  useEffect(() => {
    const targetTab = normalizeGalleryTabParam(routeGalleryTab);
    if (targetTab && targetTab !== tabRef.current) {
      setTab(targetTab);
    }
  }, [routeGalleryTab]);

  useEffect(() => {
    const popup = normalizeToolPopupParam(routePopup);
    setZipPanelOpen(popup === 'gallery-zip-import');
    setShowCreateGroup(popup === 'gallery-create-group');
    setShowBatchTagModal(popup === 'gallery-batch-tags');
  }, [routePopup]);

  // 拼图素材：必须是横图（isPortrait 不为 true）且非拼图戏图
  const collageSourceImages = useMemo(
    () => (Array.isArray(images) ? images.filter((img) => img?.isCollage !== true && img?.isPortrait !== true) : []),
    [images],
  );

  const collageImages = useMemo(
    () => (Array.isArray(images) ? images.filter((img) => img?.isCollage === true) : []),
    [images],
  );

  // Cover UI: show all images except cover-tagged ones (for cover generation source selection)
  const coverSourceImages = useMemo(() => {
    if (!Array.isArray(images)) return [];
    const coverTags = new Set(['封面', '拼图封面', '自动封面', 'canvas封面']);
    return images.filter((img) => {
      const tags = Array.isArray(img?.tags) ? img.tags : [];
      const hasCoverTag = tags.some((t) => coverTags.has(String(t ?? '').trim()));
      return !hasCoverTag;
    });
  }, [images]);

  // Batch selection helpers (respect current filter/group result set)
  const visibleImageIds = useMemo(
    () =>
      (Array.isArray(images) ? images : [])
        .map((img) => Number(img?.id))
        .filter((id) => Number.isFinite(id)),
    [images],
  );
  const visibleImageIdSet = useMemo(
    () => new Set(visibleImageIds),
    [visibleImageIds],
  );
  const visibleSelectedCount = useMemo(
    () => batchSelectedIds.filter((id) => visibleImageIdSet.has(id)).length,
    [batchSelectedIds, visibleImageIdSet],
  );
  const hasVisibleImages = visibleImageIds.length > 0;
  const allVisibleSelected =
    hasVisibleImages && visibleSelectedCount === visibleImageIds.length;

  const toggleSelectAllVisible = useCallback(() => {
    if (!hasVisibleImages) return;
    if (allVisibleSelected) {
      setBatchSelectedIds((prev) =>
        prev.filter((id) => !visibleImageIdSet.has(id)),
      );
      setBatchSelectAllActive(false);
      return;
    }
    setBatchSelectedIds((prev) => {
      const next = new Set(prev);
      visibleImageIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
    setBatchSelectAllActive(true);
  }, [
    allVisibleSelected,
    hasVisibleImages,
    visibleImageIdSet,
    visibleImageIds,
  ]);

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

  /**
   * @description 加载图库图片；追加分页用同步锁防止同一次上拉连续触发。
   * @param {{ append?: boolean, imageType?: 'all'|'regular'|'collage' }} [options] - 加载选项。
   * @returns {Promise<void>}
   * @keyword-en gallery, infinite-scroll, pagination
   */
  const loadImages = useCallback(async ({ append = false, imageType: explicitImageType } = {}) => {
    if (append && (imagesLoadingRef.current || !hasMoreImagesRef.current)) return;
    if (!append) {
      loadMoreArmedRef.current = true;
    }
    const reqId = (imagesReqIdRef.current += 1);
    imagesLoadingRef.current = true;
    setImagesLoading(true);
    // 未显式指定时，依据当前 tab 自动推导: gallery/collage 只要 regular，cover 要 all
    const imageType = explicitImageType ?? (tabRef.current === 'cover' ? 'all' : 'regular');
    try {
      const curImages = imagesRef.current;
      const cursorId = append && curImages.length > 0 ? curImages[curImages.length - 1]?.id : undefined;
      if (append && (cursorId === undefined || cursorId === null || `${cursorId}` === '')) return;
      const params = {
        userId: userId || undefined,
        groupId: selectedGroupIdRef.current ?? undefined,
        tag: tagFilter || undefined,
        cursorId,
        limit: pageSize,
      };
      if (imageType) params.imageType = imageType;
      const data = await api.listGalleryImages(params);
      if (reqId !== imagesReqIdRef.current) return;
      const list = Array.isArray(data?.images) ? data.images : [];
      const hasFullPage = list.length >= pageSize;
      const prevImages = imagesRef.current;
      const nextImages = append ? mergeUnique(prevImages, list) : mergeUnique([], list);
      const nextHasMore = append
        ? hasFullPage && nextImages.length > prevImages.length
        : hasFullPage;
      imagesRef.current = nextImages;
      hasMoreImagesRef.current = nextHasMore;
      setImages(() => nextImages);
      setHasMoreImages(nextHasMore);
      if (append) {
        loadMoreArmedRef.current = false;
      }
    } finally {
      if (reqId === imagesReqIdRef.current) {
        imagesLoadingRef.current = false;
        setImagesLoading(false);
      }
    }
  }, [pageSize, userId, tagFilter]);

  // Initial metadata load
  useEffect(() => {
    loadGroups();
    loadTags();
  }, [loadGroups, loadTags]);

  // Reload images when tab changes:
  // - gallery: imageType='regular' — 只显示普通图片，过滤封面和拼图
  // - collage: imageType='regular' — 拼图创作素材，只显示普通图片
  // - cover: imageType='all' — 封面工具，显示普通图片和拼图
  useEffect(() => {
    if (tab === 'collage') {
      loadImages({ append: false, imageType: 'regular' });
    } else if (tab === 'cover') {
      loadImages({ append: false, imageType: 'all' });
    } else if (tab === 'gallery') {
      loadImages({ append: false, imageType: 'regular' });
    }
  }, [selectedGroupId, tab, loadImages]);

  useEffect(() => {
    setCollageSelectedIds([]);
    setCollageMessage('');
    setCoverSelectedId(null);
    setCoverMessage('');
  }, [selectedGroupId, tab]);

  // 过滤条件变化后，只保留当前可见结果中的选中项，避免跨筛选误操作
  useEffect(() => {
    if (!batchSelectMode) return;
    setBatchSelectedIds((prev) => prev.filter((id) => visibleImageIdSet.has(id)));
  }, [batchSelectMode, visibleImageIdSet]);

  // 切换筛选条件时，退出“全选当前筛选”态（避免跨筛选继续自动全选）
  useEffect(() => {
    if (!batchSelectMode) return;
    setBatchSelectAllActive(false);
  }, [batchSelectMode, selectedGroupId, tagFilter, tab]);

  // “全选当前筛选”激活时，滚动加载更多结果后自动纳入选中
  useEffect(() => {
    if (!batchSelectMode || !batchSelectAllActive || !hasVisibleImages) return;
    setBatchSelectedIds((prev) => {
      const next = new Set(prev);
      visibleImageIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  }, [
    batchSelectMode,
    batchSelectAllActive,
    hasVisibleImages,
    visibleImageIds,
  ]);

  // Infinite Scroll
  useEffect(() => {
    if (!loadMoreRef.current) return;
    const obs = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting) {
        loadMoreArmedRef.current = true;
        return;
      }
      if (
        !loadMoreArmedRef.current ||
        imagesLoadingRef.current ||
        !hasMoreImagesRef.current
      ) {
        return;
      }
      loadMoreArmedRef.current = false;
      void loadImages({ append: true });
    }, { threshold: 0.1 });
    obs.observe(loadMoreRef.current);
    return () => obs.disconnect();
  }, [loadImages, tab]);

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
      onRoutePatch?.({ popup: null, modal: null, dialog: null, open: null });
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
      const desc = `双图拼图：#${selected[0].id} + #${selected[1].id}`;
      const uid = String(userId || '').trim() || 'default';
      const res = await api.uploadGalleryImages([file], {
        userId: uid,
        groupId: selectedGroupId,
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
        await loadImages({ append: false, imageType: 'regular' });
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
      setCoverMessage('请先选择 1 张素材');
      return;
    }
    const source = coverSourceImages.find((img) => img.id === targetId);
    if (!source) {
      setCoverMessage('素材不存在，请刷新后重试');
      return;
    }

    const text = String(coverText || '').trim();
    if (!text) {
      setCoverMessage('请先填写封面文字（文章类型）');
      return;
    }

    const isPortrait = source.isPortrait === true;
    // 横图封面必须拼图：提前检查是否有第二张横图
    if (!isPortrait) {
      const anotherLandscape = coverSourceImages.find(
        (img) => img.id !== targetId && img.isPortrait !== true && img.isCollage !== true,
      );
      if (!anotherLandscape) {
        setCoverMessage('横图封面需要 2 张横图配合拼图，当前分组已有横图不足 2 张，请先上传更多横图');
        return;
      }
    }

    setCoverGenerating(true);
    setCoverMessage('');
    try {
      let coverFile;
      let coverType = 'single';

      if (isPortrait) {
        // 竖图：直接添加文字封面
        coverFile = await createCoverFromSingleImageFile(
          source.url || source.thumbUrl,
          text,
          source.width && source.height ? { width: source.width, height: source.height } : undefined,
        );
      } else {
        // 横图：必须拼图（配对选定项目外第一张横图）
        const anotherLandscape = coverSourceImages.find(
          (img) => img.id !== targetId && img.isPortrait !== true && img.isCollage !== true,
        );
        const collageFile = await createTwoImageCollageFile(
          source.url || source.thumbUrl,
          anotherLandscape.url || anotherLandscape.thumbUrl,
        );
        const collageUrl = URL.createObjectURL(collageFile);
        coverFile = await createCoverFromCollageFile(collageUrl, text);
        URL.revokeObjectURL(collageUrl);
        coverType = 'collage';
      }

      const uid = String(userId || '').trim() || 'default';
      const res = await api.uploadGalleryImages([coverFile], {
        userId: uid,
        groupId: selectedGroupId,
        description: `封面图：${coverType === 'collage' ? '拼图+' : ''}素材#${source.id}，文字=${text}`,
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
    coverSourceImages,
    userId,
    selectedGroupId,
    loadImages,
    loadTags,
  ]);

  const currentGroup = groups.find(g => g.id === selectedGroupId);

  /**
   * @description 批量保存标签（添加/移除）
   * @keyword-en batch save tags for selected images
   */
  const onBatchSaveTags = useCallback(async () => {
    if (batchSelectedIds.length === 0) return;
    setBatchTagSaving(true);
    try {
      const uid = String(userId || '').trim() || 'default';
      const res = await api.batchUpdateGalleryImageTags({
        userId: uid,
        ids: batchSelectedIds,
        addTags: batchAddTags.length > 0 ? batchAddTags : undefined,
        removeTags: batchRemoveTags.length > 0 ? batchRemoveTags : undefined,
      });
      showToast(`已更新 ${res.modified ?? 0} 张图片的标签`, 'success');
      setShowBatchTagModal(false);
      onRoutePatch?.({ popup: null, modal: null, dialog: null, open: null });
      setBatchSelectedIds([]);
      setBatchSelectMode(false);
      setBatchAddTags([]);
      setBatchRemoveTags([]);
      await loadImages({ append: false });
      await loadTags();
    } finally {
      setBatchTagSaving(false);
    }
  }, [batchSelectedIds, batchAddTags, batchRemoveTags, userId, loadImages, loadTags, onRoutePatch]);

  /**
   * @description 批量删除已选图片（二次确认 → 调后端 → 刷新图库/标签）。
   * @keyword-en batch delete selected gallery images
   * @keyword-cn 图库批量删除
   */
  const onBatchDelete = useCallback(async () => {
    if (batchSelectedIds.length === 0 || batchDeleting) return;
    if (!window.confirm(`确认删除选中的 ${batchSelectedIds.length} 张图片？删除后不可恢复。`)) {
      return;
    }
    setBatchDeleting(true);
    try {
      const uid = String(userId || '').trim() || 'default';
      const res = await api.batchDeleteGalleryImages({
        userId: uid,
        ids: batchSelectedIds,
      });
      showToast(
        `已删除 ${res.deleted ?? 0} 张图片${res.failed ? `，${res.failed} 张失败` : ''}`,
        res.failed ? 'info' : 'success',
      );
      setBatchSelectedIds([]);
      setBatchSelectAllActive(false);
      setBatchSelectMode(false);
      await loadImages({ append: false });
      await loadTags();
    } finally {
      setBatchDeleting(false);
    }
  }, [batchSelectedIds, batchDeleting, userId, loadImages, loadTags]);

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
              onClick={() => selectGalleryTab('chat')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              对话
            </button>
            <button
              onClick={() => selectGalleryTab('gallery')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'gallery' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              图库
            </button>
            <button
              onClick={() => selectGalleryTab('collage')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'collage' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              拼图
            </button>
            <button
              onClick={() => selectGalleryTab('cover')}
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
              onClick={() => selectGalleryTab('chat')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              对话
            </button>
            <button
              onClick={() => selectGalleryTab('gallery')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'gallery' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              图库
            </button>
            <button
              onClick={() => selectGalleryTab('collage')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'collage' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              拼图
            </button>
            <button
              onClick={() => selectGalleryTab('cover')}
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
              规则：必须选择 2 张横图（竖图不参与拼图）。生成成品固定 {COLLAGE_WIDTH}x{COLLAGE_HEIGHT}，分辨率 {COLLAGE_DPI} DPI。
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
              onClick={() => selectGalleryTab('chat')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              对话
            </button>
            <button
              onClick={() => selectGalleryTab('gallery')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'gallery' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              图库
            </button>
            <button
              onClick={() => selectGalleryTab('collage')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'collage' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              拼图
            </button>
            <button
              onClick={() => selectGalleryTab('cover')}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'cover' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              封面
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Type size={16} /> 封面生成
            </div>
            <div className="text-xs text-slate-500 mt-1">
              规则：竖图直接加文字；横图会自动找另一张横图配对拼图后再加文字。选择素材后输入文章类型文字即可。
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

          {/* 图片网格：普通图片 + 拼图 grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {coverSourceImages.map((img) => {
              const selected = Number(coverSelectedId) === Number(img.id);
              const isCollage = img.isCollage === true;
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
                    alt={img.description || `img-${img.id}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] flex items-center justify-center">
                    {selected ? '✓' : ''}
                  </div>
                  <div className="absolute left-0 right-0 bottom-0 bg-black/55 text-white text-[10px] px-2 py-1 text-left truncate">
                    {isCollage ? `拼图 #${img.id}` : `图片 #${img.id}`}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 空状态 empty state */}
          {coverSourceImages.length === 0 && !imagesLoading && (
            <div className='text-center text-xs text-slate-400 py-8 border border-dashed border-slate-200 rounded-xl'>
              当前分组暂无可用于生成封面的素材（普通图片或拼图）。
            </div>
          )}

          {/* 上拉加载 infinite scroll sentinel */}
          <div ref={loadMoreRef} className="h-8 flex items-center justify-center">
            {imagesLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      {/* Header - 双行布局：第一行=导航+主操作，第二行=筛选+次要工具 */}
      <div className="border-b border-slate-100 bg-white/90">
        <input
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          ref={fileRef}
          onChange={onUploadFiles}
        />
        {/* 第一行：返回 + tabs + 上传主按钮 */}
        <div className="flex items-center gap-2 px-2 sm:px-3 md:px-4 pt-2 sm:pt-3">
          <button
            onClick={onBack}
            className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800 shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="inline-flex rounded-full bg-slate-100 p-0.5 sm:p-1 shrink-0">
            <button
              onClick={() => selectGalleryTab('chat')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              对话
            </button>
            <button
              onClick={() => selectGalleryTab('gallery')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'gallery' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              图库
            </button>
            <button
              onClick={() => selectGalleryTab('collage')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'collage' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              拼图
            </button>
            <button
              onClick={() => selectGalleryTab('cover')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'cover' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
            >
              封面
            </button>
          </div>
          {/* 上传主按钮：仅在非 batch 模式下显示 */}
          {!batchSelectMode && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="上传图片"
              className="ml-auto shrink-0 inline-flex items-center justify-center gap-1.5 bg-slate-900 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-50 whitespace-nowrap"
            >
              {uploading ? <RefreshCw className="animate-spin" size={14} /> : <Upload size={14} />}
              <span>上传</span>
            </button>
          )}
          {batchSelectMode && (
            <span className="ml-auto text-xs text-slate-500 whitespace-nowrap shrink-0">
              已选 {visibleSelectedCount}/{visibleImageIds.length}
            </span>
          )}
        </div>

        {/* 第二行：筛选 + 次要工具 / batch 操作栏 */}
        <div className="flex items-center flex-wrap gap-1.5 sm:gap-2 px-2 sm:px-3 md:px-4 py-2 sm:py-3">
          {batchSelectMode ? (
            <>
              <button
                onClick={toggleSelectAllVisible}
                disabled={!hasVisibleImages}
                className="px-3 py-1.5 text-xs rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {allVisibleSelected ? '取消全选' : '全选当前筛选'}
              </button>
              <button
                onClick={() => openGalleryPopup('gallery-batch-tags')}
                disabled={batchSelectedIds.length === 0}
                className="px-3 py-1.5 text-xs rounded-full bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                批量改标签 ({batchSelectedIds.length})
              </button>
              <button
                onClick={onBatchDelete}
                disabled={batchSelectedIds.length === 0 || batchDeleting}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {batchDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                批量删除 ({batchSelectedIds.length})
              </button>
              <button
                onClick={() => { setBatchSelectMode(false); setBatchSelectedIds([]); setBatchSelectAllActive(false); }}
                className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 whitespace-nowrap"
              >
                <X size={12} /> 退出
              </button>
            </>
          ) : (
            <>
              <TagFilterDropdown
                value={tagFilter}
                onChange={(tag) => setTagFilter(tag)}
                allTags={allTags}
              />
              <input
                type="text"
                value={uploadDraft.tags}
                onChange={(e) => setUploadDraft({ ...uploadDraft, tags: e.target.value })}
                placeholder="上传标签(逗号分隔)"
                className="flex-1 min-w-[120px] sm:flex-none sm:w-40 md:w-48 px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-slate-200 rounded-full focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => { setBatchSelectMode(true); setBatchSelectedIds([]); setBatchSelectAllActive(false); }}
                title="批量选择"
                className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-100 whitespace-nowrap"
              >
                <Check size={14} />
                <span>批量选择</span>
              </button>
              <button
                onClick={() => openGalleryPopup('gallery-zip-import')}
                title="ZIP 批量导入(队列任务)"
                className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-100 whitespace-nowrap"
              >
                <FileArchive size={14} />
                <span>ZIP 导入</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        <div className="w-64 border-r border-slate-100 bg-slate-50 flex-col hidden md:flex">
          <div className="p-3 border-b border-slate-100 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">图库分组</span>
            <button onClick={() => openGalleryPopup('gallery-create-group')} className="p-1 hover:bg-slate-200 rounded text-slate-500">
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
              {images.map(img => {
                const isBatchSelected = batchSelectMode && batchSelectedIds.includes(img.id);
                return (
                  <div
                    key={img.id}
                    onClick={() => {
                      if (batchSelectMode) {
                        setBatchSelectAllActive(false);
                        setBatchSelectedIds(prev =>
                          prev.includes(img.id) ? prev.filter(x => x !== img.id) : [...prev, img.id]
                        );
                      } else {
                        openPreview(img);
                      }
                    }}
                    className={`aspect-square bg-slate-100 rounded-xl overflow-hidden relative group cursor-pointer ${batchSelectMode && isBatchSelected ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <img 
                      src={img.thumbUrl || img.url} 
                      alt={img.description || 'Image'} 
                      className="w-full h-full object-cover transition transform group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                    {/* 批量选择模式：复选框 */}
                    {batchSelectMode && (
                      <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${isBatchSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/80 border-slate-300'}`}>
                        {isBatchSelected && <span className="text-[10px] font-bold">✓</span>}
                      </div>
                    )}
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
                );
              })}
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
                onClick={() => closeGalleryPopup('gallery-create-group')}
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

      {/* 批量改标签 Modal */}
      {showBatchTagModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => closeGalleryPopup('gallery-batch-tags')} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 border border-gray-200">
            {/* Modal 标题区域 */}
            <div className="flex items-center justify-between mb-4">
              <div className="text-base font-semibold text-gray-900">批量改标签</div>
              <span className="text-xs text-gray-400">共 {batchSelectedIds.length} 张图片</span>
            </div>
            {/* 标签选择区域 */}
            <div className="space-y-4">
              <TagPicker
                label="添加标签"
                value={batchAddTags}
                onChange={setBatchAddTags}
                allTags={allTags}
                placeholder="输入或选择，回车添加"
                disabled={batchTagSaving}
              />
              <TagPicker
                label="移除标签"
                value={batchRemoveTags}
                onChange={setBatchRemoveTags}
                allTags={allTags}
                placeholder="输入或选择，回车添加"
                disabled={batchTagSaving}
              />
            </div>
            {/* 操作按钮区域 */}
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => closeGalleryPopup('gallery-batch-tags')}
                disabled={batchTagSaving}
                className="h-9 px-4 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void onBatchSaveTags()}
                disabled={batchTagSaving || (batchAddTags.length === 0 && batchRemoveTags.length === 0)}
                className="h-9 px-5 text-sm bg-black text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {batchTagSaving ? '保存中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ZIP 批量导入抽屉:零散选 zip → 后台队列异步处理 → 实时进度轮询 */}
      <GalleryZipImportPanel
        open={zipPanelOpen}
        onClose={() => closeGalleryPopup('gallery-zip-import')}
        userId={userId || 'default'}
        groups={groups}
        api={api}
        onCompleted={() => {
          loadImages({ append: false });
          loadGroups();
          loadTags();
        }}
      />
    </div>
  );
};

/**
 * @description ToolsView — 工具入口页，包含图库、思维链路、Canvas管理、小红书/抖音专家入口。
 * @keyword-en tools-view
 * @keyword-en tools
 * @keyword-en gallery
 * @keyword-en canvas
 * @keyword-en xhs-specialist
 * @keyword-en douyin-specialist
 * @keyword-en featured-article
 * @param {{ onThoughtRouteChange?: Function }} props
 */
const ToolsView = ({ onThoughtRouteChange }) => {
  const [view, setView] = useState('list'); // 'list' | 'gallery' | 'thought' | 'canvas' | 'xhs-specialist' | 'douyin-specialist' | 'article-library' | 'featured-article' | 'anti-detection'
  const [routeParams, setRouteParams] = useState(() => readToolsRouteParams());

  // ── Canvas 管理状态 ──────────────────────────────────────────
  const [canvases, setCanvases] = useState([]);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasType, setCanvasType] = useState('all'); // 'all' | 'article' | 'image-group'
  const [canvasTag, setCanvasTag] = useState('');
  const [canvasHasMore, setCanvasHasMore] = useState(true);
  const [canvasOpenItem, setCanvasOpenItem] = useState(null); // canvas object currently opened

  const canvasReqIdRef = useRef(0);
  const canvasListRef = useRef([]);
  const canvasLoadMoreRef = useRef(null);

  /**
   * @description 合并更新工具页 URL 参数并刷新本地路由快照。
   * @keyword-en url-route
   * @keyword-en query-sync
   * @param {Record<string, string|number|null|undefined>} patch - 工具页查询参数补丁。
   */
  const handleToolRoutePatch = useCallback((patch) => {
    updateToolsSearchParams(patch);
    setRouteParams(readToolsRouteParams());
  }, []);

  /**
   * @description 应用 URL 参数到效能工具入口、内部 Tab 和弹层。
   * @keyword-en url-route
   * @keyword-en tool-state
   */
  const applyToolsRouteParams = useCallback(() => {
    const nextRoute = readToolsRouteParams();
    setRouteParams(nextRoute);
    setView(nextRoute.view || 'list');
  }, []);

  /**
   * @description 切换效能工具卡片并同步 URL 参数。
   * @keyword-en url-route
   * @keyword-en tool-view
   * @param {string} nextView - 下一个工具视图。
   */
  const selectToolView = useCallback((nextView) => {
    const targetView = normalizeToolViewParam(nextView) || 'list';
    setView(targetView);
    const patch = {
      tab: 'tools',
      tool: targetView === 'list' ? null : targetView,
      popup: null,
      modal: null,
      dialog: null,
      open: null,
    };
    if (targetView !== 'gallery') {
      Object.assign(patch, {
        galleryTab: null,
        toolTab: null,
      });
    }
    if (targetView !== 'article-library') {
      Object.assign(patch, {
        libraryId: null,
        articleLibraryId: null,
        editLibraryId: null,
        articleLibraryEditId: null,
        articleLibraryTab: null,
        libraryTab: null,
        detailTab: null,
      });
    }
    handleToolRoutePatch(patch);
  }, [handleToolRoutePatch]);

  useEffect(() => {
    applyToolsRouteParams();
    window.addEventListener('popstate', applyToolsRouteParams);
    return () => window.removeEventListener('popstate', applyToolsRouteParams);
  }, [applyToolsRouteParams]);

  /**
   * @description 加载 Canvas 列表，支持分页追加和首屏重置。
   * @param {{ append?: boolean }} [opts]
   * @keyword-en load canvases with pagination
   */
  const loadCanvases = useCallback(async ({ append = false } = {}) => {
    const reqId = (canvasReqIdRef.current += 1);
    setCanvasLoading(true);
    try {
      const curList = canvasListRef.current;
      const skip = append ? curList.length : 0;
      const res = await api.listCanvases({
        limit: 20,
        type: canvasType !== 'all' ? canvasType : undefined,
        tag: canvasTag || undefined,
        skip,
      });
      if (reqId !== canvasReqIdRef.current) return;
      const rows = Array.isArray(res?.canvases) ? res.canvases : [];
      setCanvasHasMore(rows.length >= 20);
      if (append) {
        setCanvases((prev) => {
          const next = [...prev, ...rows];
          canvasListRef.current = next;
          return next;
        });
      } else {
        canvasListRef.current = rows;
        setCanvases(rows);
      }
    } finally {
      if (reqId === canvasReqIdRef.current) setCanvasLoading(false);
    }
  }, [canvasType, canvasTag]);

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

  // 切换到 canvas 视图或过滤条件变化时重新加载
  useEffect(() => {
    if (view === 'canvas') {
      canvasListRef.current = [];
      void loadCanvases({ append: false });
    }
  }, [view, canvasType, canvasTag, loadCanvases]);

  // Canvas 无限滚动
  useEffect(() => {
    if (!canvasLoadMoreRef.current || view !== 'canvas') return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !canvasLoading && canvasHasMore) {
        void loadCanvases({ append: true });
      }
    }, { threshold: 0.1 });
    obs.observe(canvasLoadMoreRef.current);
    return () => obs.disconnect();
  }, [canvasHasMore, canvasLoading, loadCanvases, view]);

  if (view === 'gallery') {
    return (
      <GalleryView
        onBack={() => selectToolView('list')}
        routeGalleryTab={routeParams.galleryTab}
        routePopup={routeParams.popup}
        onRoutePatch={handleToolRoutePatch}
      />
    );
  }
  if (view === 'thought') {
    return <ThoughtRouteView onBack={() => selectToolView('list')} />;
  }
  if (view === 'xhs-specialist') {
    return <XhsSpecialistView onBack={() => selectToolView('list')} />;
  }
  if (view === 'douyin-specialist') {
    return <DouyinSpecialistView onBack={() => selectToolView('list')} />;
  }
  if (view === 'article-library') {
    return (
      <ArticleLibraryView
        onBack={() => selectToolView('list')}
        routeLibraryId={routeParams.libraryId}
        routeEditLibraryId={routeParams.editLibraryId}
        routeDetailTab={routeParams.articleLibraryTab}
        routePopup={routeParams.popup}
        onRoutePatch={handleToolRoutePatch}
      />
    );
  }
  if (view === 'featured-article') {
    return <FeaturedArticleView onBack={() => selectToolView('list')} />;
  }
  if (view === 'anti-detection') {
    return <AntiDetectionView onBack={() => selectToolView('list')} />;
  }
  if (view === 'design-editor') {
    return <DesignEditorView onBack={() => selectToolView('list')} />;
  }
  if (view === 'canvas') {
    // ── 打开某个 Canvas 的内部覆盖层 ──
    if (canvasOpenItem) {
      if (canvasOpenItem.type === 'image-group') {
        return (
          <ImageGroupCanvasView
            canvasId={canvasOpenItem.id}
            onClose={() => setCanvasOpenItem(null)}
          />
        );
      }
      return (
        <CanvasFeedView
          canvasId={canvasOpenItem.id}
          onClose={() => setCanvasOpenItem(null)}
        />
      );
    }

    return (
      <div className="h-full flex flex-col bg-white animate-fade-in">
        {/* ── 顶部导航栏：返回、标题、类型过滤、标签筛选、刷新 ── */}
        <div className="flex flex-wrap items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
          {/* 返回按钮 back button */}
          <button
            onClick={() => selectToolView('list')}
            className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800 shrink-0"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="font-bold text-slate-800 flex-1 min-w-0">Canvas 管理</div>

          {/* 类型过滤 tab pills type filter */}
          <div className="inline-flex rounded-full bg-slate-100 p-1 shrink-0">
            {[
              { key: 'all', label: '全部' },
              { key: 'article', label: '图文' },
              { key: 'image-group', label: '图组' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setCanvasType(key)}
                className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${canvasType === key ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 标签筛选 tag filter input */}
          <div className="flex items-center gap-1 shrink-0">
            <input
              value={canvasTag}
              onChange={(e) => setCanvasTag(e.target.value)}
              placeholder="筛选标签"
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-full focus:outline-none focus:border-blue-500 w-24"
            />
            {canvasTag && (
              <button onClick={() => setCanvasTag('')} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={14} />
              </button>
            )}
          </div>

          {/* 刷新按钮 refresh button */}
          <button
            onClick={() => { canvasListRef.current = []; void loadCanvases({ append: false }); }}
            className="p-1.5 text-slate-400 hover:text-slate-600 shrink-0"
          >
            <RefreshCw size={14} className={canvasLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* ── Canvas 卡片网格 canvas cards grid ── */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
          {canvasLoading && canvases.length === 0 ? (
            <div className="py-12 flex items-center justify-center text-slate-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : canvases.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">暂无 Canvas</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {canvases.map((c) => {
                // 获取缩略图 thumbnail: 图文取第一篇文章首图，图组取第一组第一张
                const thumb =
                  c?.type === 'image-group'
                    ? c?.imageGroups?.[0]?.images?.[0]?.url
                    : c?.articles?.[0]?.imageUrls?.[0];
                const count =
                  c?.type === 'image-group'
                    ? `${c?.imageGroups?.length ?? 0} 组`
                    : `${c?.articles?.length ?? 0} 篇`;
                const typeLabel = c?.type === 'image-group' ? '图组' : '图文';
                const typeBg = c?.type === 'image-group' ? 'bg-violet-600' : 'bg-emerald-600';

                return (
                  <button
                    key={String(c?.id ?? Math.random())}
                    onClick={() => setCanvasOpenItem(c)}
                    className="group flex flex-col rounded-2xl border border-slate-100 bg-white overflow-hidden hover:shadow-md hover:border-emerald-200 transition text-left"
                  >
                    {/* 缩略图区域 thumbnail area */}
                    <div className="relative w-full aspect-video bg-slate-100 overflow-hidden">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={c?.topic || `canvas-${c?.id}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                          <FolderPlus size={28} />
                        </div>
                      )}
                      {/* 类型徽章 type badge */}
                      <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-white text-[10px] font-medium ${typeBg}`}>
                        {typeLabel}
                      </div>
                    </div>

                    {/* Canvas 信息 info */}
                    <div className="p-3">
                      <div className="text-sm font-medium text-slate-800 line-clamp-1">
                        {c?.topic || `Canvas #${c?.id ?? '-'}`}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        #{c?.id ?? '-'} · {count}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 无限滚动哨兵 infinite scroll sentinel */}
          <div ref={canvasLoadMoreRef} className="h-10 flex items-center justify-center mt-4">
            {canvasLoading && canvases.length > 0 && (
              <Loader2 size={16} className="animate-spin text-slate-400" />
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
          onClick={() => selectToolView('gallery')}
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
          onClick={() => selectToolView('thought')}
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
          onClick={() => selectToolView('canvas')}
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

        <div
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-violet-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => selectToolView('design-editor')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-violet-50/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center mb-4 text-white shadow-violet-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <Edit2 size={30} />
          </div>
          <span className="font-bold text-slate-800 text-lg z-10">灵感画布</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10">模板、图层与图片编辑</span>
          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-violet-500">
            <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>

        {/* XHS Specialist Card */}
        <div
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-rose-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => selectToolView('xhs-specialist')}
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

        {/* Douyin Specialist Card */}
        <div
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-cyan-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => selectToolView('douyin-specialist')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/50 to-rose-50/40 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-slate-900 via-cyan-700 to-rose-500 flex items-center justify-center mb-4 text-white shadow-cyan-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <Video size={30} />
          </div>

          <span className="font-bold text-slate-800 text-lg z-10">抖音专家</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10">短视频与本地生活</span>

          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-cyan-500">
             <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>

        {/* Article Library Card */}
        <div
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-amber-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => selectToolView('article-library')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mb-4 text-white shadow-amber-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <Library size={30} />
          </div>

          <span className="font-bold text-slate-800 text-lg z-10">文章库</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10">文章归档与队列推送</span>

          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-amber-500">
             <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>

        {/* Anti-Detection Card */}
        <div
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-teal-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => selectToolView('anti-detection')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-teal-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center mb-4 text-white shadow-teal-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <ShieldCheck size={30} />
          </div>

          <span className="font-bold text-slate-800 text-lg z-10">去 AI 标识</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10 whitespace-nowrap">去除 AI 生图指纹</span>

          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-teal-500">
             <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>

        {/* Featured Article Card */}
        <div
          className="group bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-lg hover:border-emerald-100 transition-all duration-300 aspect-square relative overflow-hidden"
          onClick={() => selectToolView('featured-article')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-emerald-500 to-lime-600 flex items-center justify-center mb-4 text-white shadow-emerald-200 shadow-xl group-hover:scale-110 transition-transform duration-300 z-10">
            <FileText size={30} />
          </div>

          <span className="font-bold text-slate-800 text-lg z-10">精选文章</span>
          <span className="text-xs text-slate-400 mt-1.5 z-10">选题与图文编辑</span>

          <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0 text-emerald-500">
             <ChevronLeft size={18} className="rotate-180" />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default ToolsView;
