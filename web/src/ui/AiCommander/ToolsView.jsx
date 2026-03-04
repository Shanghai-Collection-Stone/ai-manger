import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  FolderPlus, Image as ImageIcon, Search, Plus, Trash2, X, Upload, MoreHorizontal, Check, RefreshCw, ChevronLeft, Edit2
} from 'lucide-react';

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
    loadImages();
  }, [loadGroups, loadImages]);

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
      const res = await api.uploadGalleryImages(files, {
        userId: userId || 'default',
        groupId: selectedGroupId,
      });
      if (res?.images) {
        await loadImages({ append: false });
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const currentGroup = groups.find(g => g.id === selectedGroupId);

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
        <div className="flex gap-2">
           <input 
              type="file" 
              multiple 
              accept="image/*" 
              className="hidden" 
              ref={fileRef}
              onChange={onUploadFiles}
            />
            <button 
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-semibold hover:bg-slate-800 transition shadow-lg shadow-slate-200 disabled:opacity-50 disabled:shadow-none"
            >
              {uploading ? <RefreshCw className="animate-spin" size={16} /> : <Upload size={16} />}
              <span>上传图片</span>
            </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-slate-100 bg-slate-50 flex flex-col hidden md:flex">
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
                <div key={img.id} className="aspect-square bg-slate-100 rounded-xl overflow-hidden relative group">
                  <img 
                    src={img.thumb_path || img.path} 
                    alt={img.description || 'Image'} 
                    className="w-full h-full object-cover transition transform group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
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
    </div>
  );
};

const ToolsView = () => {
  const [view, setView] = useState('list'); // 'list' | 'gallery'

  if (view === 'gallery') {
    return <GalleryView onBack={() => setView('list')} />;
  }

  return (
    <div className="p-4 animate-fade-in">
      
      <div className="grid grid-cols-2 gap-4">
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
        
        {/* Placeholder for future tool */}
        <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 border-dashed flex flex-col items-center justify-center aspect-square opacity-60">
           <div className="w-14 h-14 rounded-2xl bg-slate-200 flex items-center justify-center mb-4 text-slate-400">
             <Plus size={24} />
           </div>
           <span className="font-medium text-slate-400">敬请期待</span>
        </div>
      </div>
    </div>
  );
};

export default ToolsView;
