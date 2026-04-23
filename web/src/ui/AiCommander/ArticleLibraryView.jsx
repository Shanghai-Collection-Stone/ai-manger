import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Plus, Trash2, Loader2, Folder, ChevronLeft, Check, Pencil, RefreshCw, FileText,
} from 'lucide-react';
import { articleLibraryService } from './articleLibraryService';
import { showToast } from './blocks/shared';

/**
 * @description 2×2 缩略图网格（库封面）
 * @keyword-en library thumbnail mosaic grid
 */
const ThumbnailMosaic = ({ urls = [] }) => {
  const safe = Array.isArray(urls) ? urls.filter((u) => typeof u === 'string' && u) : [];
  if (safe.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-300">
        <Folder size={40} />
      </div>
    );
  }
  // 1 张：铺满；2/3/4 张：2×2 网格，不足补空格
  if (safe.length === 1) {
    return <img src={safe[0]} className="w-full h-full object-cover" alt="" loading="lazy" />;
  }
  const cells = safe.slice(0, 4);
  while (cells.length < 4) cells.push(null);
  return (
    <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-0.5 bg-slate-100">
      {cells.map((u, i) => (
        <div key={i} className="w-full h-full overflow-hidden bg-slate-50">
          {u ? (
            <img src={u} className="w-full h-full object-cover" alt="" loading="lazy" />
          ) : (
            <div className="w-full h-full bg-slate-100" />
          )}
        </div>
      ))}
    </div>
  );
};

/**
 * @description 创建 / 编辑文章库的表单对话框
 * @keyword-en library form dialog create edit
 */
const LibraryFormDialog = ({ initial, onClose, onSubmit }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast('请输入文章库名称', 'error');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ name: trimmedName, type: type.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="bg-white rounded-3xl p-5 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-base font-semibold text-slate-900">
            {initial ? '编辑文章库' : '新建文章库'}
          </h4>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：种草号 A"
              className="mt-1 w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">类型（自由填写）</label>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="例如：小红书 / 公众号 / 朋友圈"
              className="mt-1 w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-full text-slate-500 hover:bg-slate-100 transition"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm px-4 py-1.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition flex items-center gap-1"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * @description 库详情：基础信息 Tab（可改名 / 类型）
 * @keyword-en library basic info tab
 */
const BasicInfoTab = ({ library, onUpdated }) => {
  const [name, setName] = useState(library?.name ?? '');
  const [type, setType] = useState(library?.type ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(library?.name ?? '');
    setType(library?.type ?? '');
  }, [library?.id]);

  const save = async () => {
    setSaving(true);
    const res = await articleLibraryService.updateLibrary(library.id, {
      name: name.trim(),
      type: type.trim(),
    });
    setSaving(false);
    if (!res?.library) {
      showToast('更新失败', 'error');
      return;
    }
    showToast('已保存', 'success');
    onUpdated?.(res.library);
  };

  return (
    <div className="p-4 space-y-3 max-w-lg">
      <div>
        <label className="text-xs text-slate-500">名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-blue-300"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">类型</label>
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-blue-300"
        />
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="text-sm px-4 py-1.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition inline-flex items-center gap-1"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        保存
      </button>
    </div>
  );
};

/**
 * @description 库详情：推送二维码 Tab（状态多选 / 数据历史 / 二维码占位）
 * @keyword-en push qrcode tab status filter history placeholder
 */
const PushConfigTab = ({ library, onUpdated }) => {
  const [statusFilter, setStatusFilter] = useState(
    Array.isArray(library?.pushConfig?.statusFilter) && library.pushConfig.statusFilter.length > 0
      ? library.pushConfig.statusFilter
      : ['unpublished'],
  );
  const [pushUrl, setPushUrl] = useState(library?.pushConfig?.pushUrl ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatusFilter(
      Array.isArray(library?.pushConfig?.statusFilter) && library.pushConfig.statusFilter.length > 0
        ? library.pushConfig.statusFilter
        : ['unpublished'],
    );
    setPushUrl(library?.pushConfig?.pushUrl ?? '');
  }, [library?.id]);

  const toggle = (val) => {
    setStatusFilter((prev) => {
      const has = prev.includes(val);
      if (has) {
        const next = prev.filter((x) => x !== val);
        // 至少留一个
        return next.length === 0 ? prev : next;
      }
      return [...prev, val];
    });
  };

  const save = async () => {
    setSaving(true);
    const res = await articleLibraryService.updateLibrary(library.id, {
      pushConfig: { statusFilter, pushUrl: pushUrl.trim() },
    });
    setSaving(false);
    if (!res?.library) {
      showToast('保存失败', 'error');
      return;
    }
    showToast('已保存', 'success');
    onUpdated?.(res.library);
  };

  const stats = library?.stats ?? { total: 0, publishedCount: 0, unpublishedCount: 0 };

  return (
    <div className="p-4 space-y-5 max-w-lg">
      {/* 数据历史 */}
      <div>
        <div className="text-xs text-slate-500 mb-1.5">数据历史</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-400">已发布</div>
            <div className="text-lg font-semibold text-emerald-600">{stats.publishedCount}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-400">待发布</div>
            <div className="text-lg font-semibold text-amber-600">{stats.unpublishedCount}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-400">总计</div>
            <div className="text-lg font-semibold text-slate-700">{stats.total}</div>
          </div>
        </div>
      </div>

      {/* 状态池勾选 */}
      <div>
        <div className="text-xs text-slate-500 mb-1.5">推送状态池（扫码取文时可消费的范围）</div>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'unpublished', label: '未发布' },
            { key: 'published', label: '已发布' },
          ].map((it) => {
            const active = statusFilter.includes(it.key);
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => toggle(it.key)}
                className={`text-xs px-3 py-1 rounded-full border transition ${
                  active
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {it.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          默认勾选未发布。允许同时勾选已发布以支持重复推送。
        </p>
      </div>

      {/* 推送 URL（二维码占位） */}
      <div>
        <div className="text-xs text-slate-500 mb-1.5">推送链接（二维码占位）</div>
        <input
          value={pushUrl}
          onChange={(e) => setPushUrl(e.target.value)}
          placeholder="http://.../scan/xxx"
          className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-blue-300"
        />
      </div>

      {/* 二维码底部文案预览 */}
      <div className="bg-slate-50 rounded-2xl p-4 flex flex-col items-center">
        <div className="w-32 h-32 bg-slate-200 rounded-xl flex items-center justify-center text-slate-400 text-xs">
          二维码占位
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {stats.publishedCount} / {stats.total}
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="text-sm px-4 py-1.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition inline-flex items-center gap-1"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        保存
      </button>
    </div>
  );
};

/**
 * @description 文章列表 Tab
 * @keyword-en article list tab
 */
const ArticleListTab = ({ library, onChanged }) => {
  const [statusFilter, setStatusFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const load = useCallback(async () => {
    if (!library?.id) return;
    setLoading(true);
    const res = await articleLibraryService.listArticles(library.id, {
      status: statusFilter,
      limit: 100,
    });
    setItems(Array.isArray(res?.items) ? res.items : []);
    setLoading(false);
  }, [library?.id, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = async (article) => {
    const next = article.publishStatus === 'published' ? 'unpublished' : 'published';
    setUpdatingId(article.id);
    const res = await articleLibraryService.updateArticleStatus(library.id, article.id, next);
    setUpdatingId(null);
    if (!res?.article) {
      showToast('状态更新失败', 'error');
      return;
    }
    setItems((prev) => prev.map((a) => (a.id === article.id ? res.article : a)));
    onChanged?.();
  };

  const remove = async (article) => {
    if (!window.confirm(`删除文章「${article.title || article.id}」？`)) return;
    const ok = await articleLibraryService.deleteArticle(library.id, article.id);
    if (!ok) { showToast('删除失败', 'error'); return; }
    setItems((prev) => prev.filter((a) => a.id !== article.id));
    onChanged?.();
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        {[
          { key: 'all', label: '全部' },
          { key: 'unpublished', label: '未发布' },
          { key: 'published', label: '已发布' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              statusFilter === t.key
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          title="刷新"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-slate-400 gap-2">
          <FileText size={20} />
          <div className="text-xs">暂无文章</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((a) => {
            const cover = Array.isArray(a.imageUrls) && a.imageUrls.length > 0 ? a.imageUrls[0] : '';
            const isPub = a.publishStatus === 'published';
            return (
              <div key={a.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden flex flex-col">
                <div className="w-full aspect-video bg-slate-100 overflow-hidden">
                  {cover ? (
                    <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <FileText size={20} />
                    </div>
                  )}
                </div>
                <div className="p-3 flex-1 flex flex-col">
                  <div className="text-sm font-medium text-slate-800 line-clamp-2">
                    {a.title || `文章 #${a.id}`}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(a.tags ?? []).slice(0, 4).map((t, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-500">#{t}</span>
                    ))}
                  </div>
                  <div className="mt-auto pt-3 flex items-center gap-2">
                    <button
                      onClick={() => toggleStatus(a)}
                      disabled={updatingId === a.id}
                      className={`text-[11px] px-2.5 py-1 rounded-full transition flex items-center gap-1 ${
                        isPub
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      }`}
                    >
                      {updatingId === a.id ? <Loader2 size={10} className="animate-spin" /> : null}
                      {isPub ? '已发布' : '未发布'}
                    </button>
                    <button
                      onClick={() => remove(a)}
                      className="ml-auto p-1 text-slate-400 hover:text-red-500 transition"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * @description 库详情页（文章列表 / 基础信息 / 推送二维码 三个 Tab）
 * @keyword-en library detail view with tabs
 */
const LibraryDetailView = ({ libraryId, onBack }) => {
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('articles');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await articleLibraryService.getLibrary(libraryId);
    setLibrary(res?.library ?? null);
    setLoading(false);
  }, [libraryId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !library) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (!library) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400">
        <div>未找到该文章库</div>
        <button onClick={onBack} className="text-xs text-blue-500 hover:underline">返回</button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      <div className="flex items-center gap-2 p-3 border-b border-slate-100">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 truncate">{library.name}</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {library.type ? `${library.type} · ` : ''}#{library.id} · {library.stats?.total ?? 0} 篇
          </p>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs">
          {[
            { key: 'articles', label: '文章' },
            { key: 'basic', label: '基础信息' },
            { key: 'push', label: '推送二维码' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 rounded-full transition ${
                tab === t.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'articles' && (
          <ArticleListTab library={library} onChanged={load} />
        )}
        {tab === 'basic' && (
          <BasicInfoTab library={library} onUpdated={(lib) => setLibrary({ ...library, ...lib })} />
        )}
        {tab === 'push' && (
          <PushConfigTab library={library} onUpdated={(lib) => setLibrary({ ...library, ...lib })} />
        )}
      </div>
    </div>
  );
};

/**
 * @description 文章库入口视图：库列表网格 + 新建 + 跳详情
 * @keyword-en article library tool main view
 */
const ArticleLibraryView = ({ onBack }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [detailId, setDetailId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEditFor, setShowEditFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await articleLibraryService.listLibraries({ limit: 100 });
    setItems(Array.isArray(res?.items) ? res.items : []);
    setTotal(Number(res?.total ?? 0));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async ({ name, type }) => {
    const res = await articleLibraryService.createLibrary({ name, type });
    if (!res?.library) {
      showToast('创建失败', 'error');
      return;
    }
    showToast('已创建', 'success');
    setShowCreate(false);
    load();
  };

  const handleEdit = async ({ name, type }) => {
    if (!showEditFor) return;
    const res = await articleLibraryService.updateLibrary(showEditFor.id, { name, type });
    if (!res?.library) {
      showToast('更新失败', 'error');
      return;
    }
    showToast('已保存', 'success');
    setShowEditFor(null);
    load();
  };

  const handleDelete = async (lib) => {
    if (!window.confirm(`删除文章库「${lib.name}」？其中所有文章将一并清除。`)) return;
    const ok = await articleLibraryService.deleteLibrary(lib.id);
    if (!ok) { showToast('删除失败', 'error'); return; }
    showToast('已删除', 'success');
    load();
  };

  if (detailId != null) {
    return (
      <LibraryDetailView libraryId={detailId} onBack={() => { setDetailId(null); load(); }} />
    );
  }

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      <div className="flex items-center gap-2 p-3 border-b border-slate-100">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 truncate">文章库</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">共 {total} 个</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs px-3 py-1 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition inline-flex items-center gap-1"
        >
          <Plus size={12} /> 新建
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
            <Folder size={28} />
            <div className="text-xs">还没有文章库</div>
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs text-blue-500 hover:underline"
            >
              新建一个
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((lib) => (
              <div
                key={lib.id}
                className="group bg-white rounded-3xl border border-slate-100 overflow-hidden hover:shadow-lg hover:border-blue-100 transition-all cursor-pointer"
                onClick={() => setDetailId(lib.id)}
              >
                {/* 缩略图区 */}
                <div className="relative w-full aspect-square bg-slate-50">
                  <ThumbnailMosaic urls={lib.thumbnails} />
                  {/* 类型徽章 */}
                  {lib.type ? (
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-slate-900/70 text-white text-[10px]">
                      {lib.type}
                    </div>
                  ) : null}
                </div>
                {/* 信息条 */}
                <div className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 line-clamp-1">
                        {lib.name}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        <span className="text-emerald-500">{lib.stats?.publishedCount ?? 0}</span>
                        {' / '}
                        {lib.stats?.total ?? 0}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowEditFor(lib); }}
                        className="p-1 text-slate-400 hover:text-slate-700 transition"
                        title="编辑"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(lib); }}
                        className="p-1 text-slate-400 hover:text-red-500 transition"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <LibraryFormDialog onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
      )}
      {showEditFor && (
        <LibraryFormDialog initial={showEditFor} onClose={() => setShowEditFor(null)} onSubmit={handleEdit} />
      )}
    </div>
  );
};

export default ArticleLibraryView;
