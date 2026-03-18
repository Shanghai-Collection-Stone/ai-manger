import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  FolderPlus, Image as ImageIcon, Search, Plus, Trash2, X, Upload, MoreHorizontal, Check, RefreshCw, ChevronLeft, Edit2, BrainCircuit
} from 'lucide-react';
import ThoughtRouteView from './ThoughtRouteView';
import CanvasFeedView from './CanvasFeedView';

/**
 * @description Tools View for AI Commander, including AI Gallery
 * @keyword-en ToolsView
 */

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

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
      const res = await fetch(`${API_BASE}/gallery/groups${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { groups: [] };
      return await res.json();
    } catch {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
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
      });
      if (!res.ok) return { ok: false };
      return await res.json();
    } catch {
      return { ok: false };
    }
  },

  /**
   * @description List gallery images with filtering
   * @keyword-en listGalleryImages
   * @param {Object} [params]
   * @returns {Promise<Object>}
   */
  async listGalleryImages({ userId, groupId, tag, cursorId, limit } = {}) {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (groupId !== undefined && groupId !== null && `${groupId}` !== '') {
        params.set('groupId', String(groupId));
      }
      if (tag) params.set('tag', tag);
      if (cursorId !== undefined && cursorId !== null && `${cursorId}` !== '') {
        params.set('cursorId', String(cursorId));
      }
      if (typeof limit === 'number') params.set('limit', String(limit));
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/gallery${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { images: [] };
      return await res.json();
    } catch {
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
      const fd = new FormData();
      (Array.isArray(files) ? files : []).forEach((f) => fd.append('files', f));
      Object.entries(body || {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        fd.append(k, String(v));
      });
      const res = await fetch(`${API_BASE}/gallery/upload`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) return { images: [] };
      return await res.json();
    } catch {
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
      const res = await fetch(`${API_BASE}/gallery/tags${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { tags: [] };
      return await res.json();
    } catch {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return { matched: 0, modified: 0 };
      return await res.json();
    } catch {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return { ok: false };
      return await res.json();
    } catch {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input || {}),
      });
      if (!res.ok) return { updated: 0 };
      return await res.json();
    } catch {
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
      const res = await fetch(`${API_BASE}/canvas${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { canvases: [] };
      return await res.json();
    } catch {
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

/**
 * @description Gallery view component for managing images and groups
 * @keyword-en GalleryView
 * @param {Object} props
 * @param {Function} props.onBack - Callback when back button is clicked
 */
const GalleryView = ({ onBack }) => {
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
  
  // Preview State
  const [previewImage, setPreviewImage] = useState(null);
  const [previewAddTags, setPreviewAddTags] = useState([]);
  const [previewRemoveTags, setPreviewRemoveTags] = useState([]);
  
  // Upload Tags State
  const [uploadDraft, setUploadDraft] = useState({ tags: '' });
  
  // Create Group State
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState({ name: '', description: '', tags: '' });
  
  // Edit Group State
  const [isEditingGroup, setIsEditingGroup] = useState(false);
  const [editGroupDraft, setEditGroupDraft] = useState({ name: '', description: '', tags: '' });

  // Refs
  const imagesReqIdRef = useRef(0);
  const imagesRef = useRef([]);
  const selectedGroupIdRef = useRef(selectedGroupId);
  const fileRef = useRef(null);
  const loadMoreRef = useRef(null);

  // Sync refs
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { selectedGroupIdRef.current = selectedGroupId; }, [selectedGroupId]);

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
  }, [pageSize, userId]);

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
    }
  };

  // Upload Images
  const onUploadFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const tags = String(uploadDraft.tags || '')
        .split(/[\s,]+/g)
        .map(t => t.trim())
        .filter(t => t.length > 0);
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
  }, [previewImage, previewAddTags, previewRemoveTags, userId, loadTags, closePreview]);

  const deletePreviewImage = useCallback(async () => {
    if (!previewImage) return;
    const img = previewImage;
    const uid = userId || 'default';
    await api.deleteGalleryImage(img.id, { userId: uid });
    setImages((prev) => prev.filter((x) => x.id !== img.id));
    closePreview();
    await loadTags();
  }, [previewImage, userId, closePreview, loadTags]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800">
            <ChevronLeft size={22} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-800">AI 图库</h2>
            <p className="text-[10px] text-slate-400">共 {groups.reduce((acc, g) => acc + (g.image_count || 0), 0)} 张图片</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
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
              className="px-3 py-2 text-sm border border-slate-200 rounded-full focus:outline-none focus:border-blue-500 w-32"
            />
            <button 
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-semibold hover:bg-slate-800 transition shadow-lg shadow-slate-200 disabled:opacity-50 disabled:shadow-none"
            >
              {uploading ? <RefreshCw className="animate-spin" size={16} /> : <Upload size={16} />}
              <span>上传</span>
            </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
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

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closePreview} />
          <div className="relative w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  #{previewImage.id} {previewImage.originalName || ''}
                </div>
                <div className="text-xs text-gray-500 truncate">{previewImage.fileName || ''}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={deletePreviewImage}
                  className="h-8 px-3 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
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

            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="bg-black/5 p-4 flex items-center justify-center">
                <img
                  src={previewImage.url || previewImage.thumbUrl}
                  alt={previewImage.originalName || `img-${previewImage.id}`}
                  className="max-h-[70vh] w-full object-contain rounded-lg"
                  loading="eager"
                  decoding="async"
                />
              </div>
              <div className="p-4 space-y-3">
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

                <div className="flex justify-end gap-2 pt-2">
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
      )}
    </div>
  );
};

const ToolsView = ({ onThoughtRouteChange }) => {
  const [view, setView] = useState('list'); // 'list' | 'gallery' | 'thought' | 'canvas'
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
      onThoughtRouteChange(view === 'thought');
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
  if (view === 'canvas') {
    const normalizedQuery = String(canvasQuery || '').trim().toLowerCase();
    const filtered = (Array.isArray(canvases) ? canvases : []).filter((c) => {
      if (!normalizedQuery) return true;
      const idText = String(c?.id ?? '').toLowerCase();
      const topic = String(c?.topic ?? '').toLowerCase();
      return idText.includes(normalizedQuery) || topic.includes(normalizedQuery);
    });
    return (
      <div className="p-4 animate-fade-in space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-slate-300"
          >
            <ChevronLeft size={14} />
            返回
          </button>
          <button
            onClick={() => {
              void loadCanvases();
            }}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-slate-300"
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Search size={14} className="text-slate-400" />
            <input
              value={canvasQuery}
              onChange={(e) => setCanvasQuery(e.target.value)}
              placeholder="按 Canvas ID / 主题筛选"
              className="w-full text-sm bg-transparent outline-none placeholder:text-slate-400"
            />
          </div>
          {canvasLoading ? (
            <div className="py-8 flex items-center justify-center text-slate-400">
              <RefreshCw size={16} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">暂无 Canvas</div>
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {filtered.map((c) => (
                <button
                  key={String(c?.id ?? Math.random())}
                  onClick={() => {
                    const id = Number(c?.id);
                    if (Number.isFinite(id)) setActiveCanvasId(id);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
                >
                  <div className="text-sm font-medium text-slate-800">
                    {c?.topic || `Canvas #${c?.id ?? '-'}`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {`#${c?.id ?? '-'} · ${(Array.isArray(c?.articles) ? c.articles.length : 0)} 篇 · ${c?.status || 'unknown'}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {Number.isFinite(activeCanvasId) && (
          <CanvasFeedView
            canvasId={activeCanvasId}
            onClose={() => setActiveCanvasId(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-4 animate-fade-in">
      
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
      </div>
    </div>
  );
};

export default ToolsView;
