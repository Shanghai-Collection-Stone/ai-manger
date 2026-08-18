import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Folder,
  FolderOpen,
  Info,
  Loader2,
  Menu,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { articleLibraryService } from './articleLibraryService';
import { createQrCodeSvg } from './qrCodeSvg';

const PUBLISH_PAGE_SIZE = 8;

const PUBLISH_STATUS_TABS = [
  { key: 'unsaved', label: '未保存' },
  { key: 'saved', label: '已保存' },
  { key: 'published', label: '已发布' },
];

const TOPIC_TONES = [
  'bg-violet-50 text-violet-600',
  'bg-blue-50 text-blue-600',
  'bg-emerald-50 text-emerald-600',
  'bg-orange-50 text-orange-600',
  'bg-rose-50 text-rose-600',
];

/**
 * @description 将日期值格式化为发文工作台使用的年月日时分文本。
 * @keyword-cn 格式化发文时间, 日期展示
 * @keyword-en format-publish-time, date-display
 */
function formatPublishTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * @description 从文章库文章元数据读取来源子选题 ID，用于区分未保存与已保存选题。
 * @keyword-cn 读取来源子选题, 文章去重
 * @keyword-en read-source-topic, deduplicate-library-article
 */
function readSourceTopicId(article) {
  const topicId = Number(article?.meta?.xhsTopicId);
  return Number.isInteger(topicId) && topicId > 0 ? topicId : undefined;
}

/**
 * @description 把已生成的真实子选题文章转换为文章库入库载荷，并保留来源选题关联。
 * @keyword-cn 构造文章入库载荷, 保留选题关联
 * @keyword-en build-library-article, preserve-topic-binding
 */
function buildTopicArticlePayload(topic) {
  const article = topic?.article ?? {};
  return {
    title: String(article.title || topic?.title || '').trim(),
    tags: Array.isArray(article.tags) ? article.tags : [],
    text: String(article.body || ''),
    imageUrls: Array.isArray(article.images) ? article.images : [],
    contentJson: {
      contentType: article.contentType || '图文',
      canvasBoards: Array.isArray(article.canvasBoards)
        ? article.canvasBoards
        : [],
    },
    meta: {
      xhsTopicId: topic.id,
      xhsParentTopicId: topic.parentId,
      xhsTopicType: topic.topicType,
      sourceArticleUpdatedAt: article.updatedAt,
    },
    publishStatus: 'unpublished',
    source: 'xhs-topic',
  };
}

/**
 * @description 渲染小红书发文工作台，连接真实母子选题、文章库、二维码与发布状态。
 * @keyword-cn 小红书发文工作台, 文章库入库, 扫码发布
 * @keyword-en xhs-publishing-workspace, store-topic-articles, qr-publishing
 */
const XhsPublishingView = ({ topicGroups = [], topicsLoading = false }) => {
  const [libraryMode, setLibraryMode] = useState('mother');
  const [libraries, setLibraries] = useState([]);
  const [librariesLoading, setLibrariesLoading] = useState(true);
  const [activeLibraryKey, setActiveLibraryKey] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [statusTab, setStatusTab] = useState('unsaved');
  const [articles, setArticles] = useState([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [qrState, setQrState] = useState({
    loading: false,
    svg: '',
    error: '',
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState({ type: '', message: '' });
  const [createOpen, setCreateOpen] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [creating, setCreating] = useState(false);

  /**
   * @description 加载当前租户可见文章库，供母题映射与自定义库列表使用。
   * @keyword-cn 加载发文文章库, 母题库映射
   * @keyword-en load-publishing-libraries, map-mother-libraries
   */
  const loadLibraries = useCallback(async () => {
    setLibrariesLoading(true);
    try {
      const response = await articleLibraryService.listLibraries({
        limit: 200,
      });
      setLibraries(Array.isArray(response?.items) ? response.items : []);
    } finally {
      setLibrariesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLibraries();
  }, [loadLibraries]);

  const motherLibraryOptions = useMemo(
    () =>
      topicGroups.map((group) => {
        const persisted = libraries.find(
          (library) => library.type === `xhs-mother:${group.id}`,
        );
        return {
          key: `mother:${group.id}`,
          groupId: group.id,
          name: persisted?.name || group.title,
          total: group.children?.length ?? 0,
          persistedId: persisted?.id,
          persisted,
        };
      }),
    [libraries, topicGroups],
  );

  const customLibraryOptions = useMemo(
    () =>
      libraries
        .filter((library) => library.type === 'xhs-custom')
        .map((library) => ({
          key: `custom:${library.id}`,
          name: library.name,
          total: library.stats?.total ?? 0,
          persistedId: library.id,
          persisted: library,
        })),
    [libraries],
  );

  const libraryOptions =
    libraryMode === 'mother' ? motherLibraryOptions : customLibraryOptions;
  const visibleLibraryOptions = libraryOptions.filter((library) =>
    library.name.toLowerCase().includes(librarySearch.trim().toLowerCase()),
  );
  const activeLibrary = libraryOptions.find(
    (library) => library.key === activeLibraryKey,
  );

  useEffect(() => {
    if (
      activeLibraryKey &&
      libraryOptions.some((library) => library.key === activeLibraryKey)
    ) {
      return;
    }
    setActiveLibraryKey(libraryOptions[0]?.key ?? '');
  }, [activeLibraryKey, libraryOptions]);

  /**
   * @description 加载选中文章库的详情、全部文章与扫码二维码。
   * @keyword-cn 加载文章库发文详情, 加载扫码二维码
   * @keyword-en load-library-publishing-detail, load-publish-qr
   */
  const loadLibraryContent = useCallback(async (libraryId) => {
    if (!libraryId) {
      setArticles([]);
      setQrState({ loading: false, svg: '', error: '' });
      return;
    }
    setContentLoading(true);
    setQrState({ loading: true, svg: '', error: '' });
    try {
      const [articleResponse, qrResponse] = await Promise.all([
        articleLibraryService.listArticles(libraryId, {
          status: 'all',
          limit: 500,
        }),
        articleLibraryService.getPushQr(libraryId),
      ]);
      setArticles(
        Array.isArray(articleResponse?.items) ? articleResponse.items : [],
      );
      if (!qrResponse?.qrContent) {
        setQrState({ loading: false, svg: '', error: '二维码生成失败' });
      } else {
        try {
          const svg = await createQrCodeSvg(qrResponse.qrContent, {
            scale: 5,
            margin: 3,
          });
          setQrState({ loading: false, svg, error: '' });
        } catch {
          setQrState({ loading: false, svg: '', error: '二维码生成失败' });
        }
      }
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedRowKeys([]);
    setPage(1);
    setNotice({ type: '', message: '' });
    void loadLibraryContent(activeLibrary?.persistedId);
  }, [activeLibrary?.key, activeLibrary?.persistedId, loadLibraryContent]);

  const candidateTopics = useMemo(() => {
    const groups = activeLibrary?.groupId
      ? topicGroups.filter((group) => group.id === activeLibrary.groupId)
      : topicGroups;
    return groups.flatMap((group) =>
      (group.children ?? []).map((topic) => ({
        ...topic,
        parentTitle: group.title,
      })),
    );
  }, [activeLibrary?.groupId, topicGroups]);

  const savedTopicIds = useMemo(
    () =>
      new Set(
        articles
          .map(readSourceTopicId)
          .filter((topicId) => topicId !== undefined),
      ),
    [articles],
  );

  const unsavedTopics = candidateTopics.filter(
    (topic) => topic.article && !savedTopicIds.has(topic.id),
  );
  const savedArticles = articles.filter(
    (article) => article.publishStatus !== 'published',
  );
  const publishedArticles = articles.filter(
    (article) => article.publishStatus === 'published',
  );
  const rows =
    statusTab === 'unsaved'
      ? unsavedTopics.map((topic) => ({
          key: `topic:${topic.id}`,
          id: topic.id,
          title: topic.article?.title || topic.title,
          topicType: topic.topicType,
          time: topic.article?.updatedAt || topic.updatedAt,
          topic,
        }))
      : (statusTab === 'saved' ? savedArticles : publishedArticles).map(
          (article) => ({
            key: `article:${article.id}`,
            id: article.id,
            title: article.title,
            topicType:
              article.meta?.xhsTopicType ||
              article.tags?.[0] ||
              (statusTab === 'published' ? '已发布' : '已保存'),
            time:
              statusTab === 'published'
                ? article.publishedAt || article.updatedAt
                : article.createdAt,
            article,
          }),
        );
  const filteredRows = rows.filter((row) =>
    row.title.toLowerCase().includes(contentSearch.trim().toLowerCase()),
  );
  const pageTotal = Math.max(
    1,
    Math.ceil(filteredRows.length / PUBLISH_PAGE_SIZE),
  );
  const pagedRows = filteredRows.slice(
    (page - 1) * PUBLISH_PAGE_SIZE,
    page * PUBLISH_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
    setSelectedRowKeys([]);
  }, [contentSearch, statusTab]);

  /**
   * @description 切换发文列表单行选择状态。
   * @keyword-cn 切换发文行选择, 批量选择
   * @keyword-en toggle-publish-row, batch-selection
   */
  const toggleRow = (rowKey) => {
    setSelectedRowKeys((current) =>
      current.includes(rowKey)
        ? current.filter((key) => key !== rowKey)
        : [...current, rowKey],
    );
  };

  /**
   * @description 切换当前页全部发文条目的选择状态。
   * @keyword-cn 全选当前发文页, 批量选择
   * @keyword-en select-publish-page, batch-selection
   */
  const toggleCurrentPage = () => {
    const currentPageKeys = pagedRows.map((row) => row.key);
    const allSelected = currentPageKeys.every((key) =>
      selectedRowKeys.includes(key),
    );
    setSelectedRowKeys((current) =>
      allSelected
        ? current.filter((key) => !currentPageKeys.includes(key))
        : [...new Set([...current, ...currentPageKeys])],
    );
  };

  /**
   * @description 确保当前母题或自定义文章库已经持久化，并返回真实文章库 ID。
   * @keyword-cn 按需创建发文库, 获取真实文章库
   * @keyword-en ensure-publishing-library, resolve-library-id
   */
  const ensureActiveLibrary = async () => {
    if (activeLibrary?.persistedId) return activeLibrary.persistedId;
    if (!activeLibrary?.name) return undefined;
    const response = await articleLibraryService.createLibrary({
      name: activeLibrary.name,
      type: activeLibrary.groupId
        ? `xhs-mother:${activeLibrary.groupId}`
        : 'xhs-custom',
    });
    const libraryId = response?.library?.id;
    if (libraryId) await loadLibraries();
    return libraryId;
  };

  /**
   * @description 将勾选的真实子选题文章批量保存到当前文章库。
   * @keyword-cn 保存选题到文章库, 批量文章入库
   * @keyword-en save-topics-to-library, bulk-store-articles
   */
  const saveSelectedTopics = async () => {
    const selectedTopics = unsavedTopics.filter((topic) =>
      selectedRowKeys.includes(`topic:${topic.id}`),
    );
    if (!selectedTopics.length || saving) return;
    setSaving(true);
    setNotice({ type: '', message: '' });
    try {
      const libraryId = await ensureActiveLibrary();
      if (!libraryId) throw new Error('LIBRARY_CREATE_FAILED');
      const response = await articleLibraryService.putArticles(
        libraryId,
        selectedTopics.map(buildTopicArticlePayload),
      );
      if (!response?.count) throw new Error('ARTICLE_STORE_FAILED');
      setSelectedRowKeys([]);
      setNotice({
        type: 'success',
        message: `已保存 ${response.count} 篇文章到文章库。`,
      });
      await Promise.all([loadLibraries(), loadLibraryContent(libraryId)]);
      setStatusTab('saved');
    } catch {
      setNotice({ type: 'error', message: '保存失败，请稍后重试。' });
    } finally {
      setSaving(false);
    }
  };

  /**
   * @description 从当前文章库删除勾选的已保存或已发布文章。
   * @keyword-cn 批量删除库内文章, 刷新文章库
   * @keyword-en delete-library-articles, refresh-library-content
   */
  const deleteSelectedArticles = async () => {
    const libraryId = activeLibrary?.persistedId;
    const selectedArticles = rows.filter((row) =>
      selectedRowKeys.includes(row.key),
    );
    if (!libraryId || !selectedArticles.length || deleting) return;
    if (
      !window.confirm(
        `确定从当前文章库删除选中的 ${selectedArticles.length} 篇文章吗？`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setNotice({ type: '', message: '' });
    try {
      const results = await Promise.all(
        selectedArticles.map((row) =>
          articleLibraryService.deleteArticle(libraryId, row.id),
        ),
      );
      if (results.some((result) => !result)) throw new Error('DELETE_FAILED');
      setSelectedRowKeys([]);
      setNotice({
        type: 'success',
        message: `已删除 ${selectedArticles.length} 篇文章。`,
      });
      await Promise.all([loadLibraries(), loadLibraryContent(libraryId)]);
    } catch {
      setNotice({ type: 'error', message: '删除失败，请稍后重试。' });
    } finally {
      setDeleting(false);
    }
  };

  /**
   * @description 删除当前文章库中的单篇文章并刷新统计。
   * @keyword-cn 删除单篇库内文章, 刷新文章库
   * @keyword-en delete-library-article, refresh-library-content
   */
  const deleteArticleRow = async (articleId) => {
    const libraryId = activeLibrary?.persistedId;
    if (!libraryId || !articleId || deleting) return;
    if (!window.confirm('确定从当前文章库删除这篇文章吗？')) return;
    setDeleting(true);
    setNotice({ type: '', message: '' });
    try {
      const deleted = await articleLibraryService.deleteArticle(
        libraryId,
        articleId,
      );
      if (!deleted) throw new Error('DELETE_FAILED');
      setSelectedRowKeys((current) =>
        current.filter((key) => key !== `article:${articleId}`),
      );
      setNotice({ type: 'success', message: '文章已从当前文章库删除。' });
      await Promise.all([loadLibraries(), loadLibraryContent(libraryId)]);
    } catch {
      setNotice({ type: 'error', message: '删除失败，请稍后重试。' });
    } finally {
      setDeleting(false);
    }
  };

  /**
   * @description 创建小红书自定义文章库并切换到新库。
   * @keyword-cn 新建自定义文章库, 切换新文章库
   * @keyword-en create-custom-library, select-created-library
   */
  const createCustomLibrary = async () => {
    const name = newLibraryName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const response = await articleLibraryService.createLibrary({
        name,
        type: 'xhs-custom',
      });
      const libraryId = response?.library?.id;
      if (!libraryId) throw new Error('LIBRARY_CREATE_FAILED');
      await loadLibraries();
      setLibraryMode('custom');
      setActiveLibraryKey(`custom:${libraryId}`);
      setCreateOpen(false);
      setNewLibraryName('');
    } catch {
      setNotice({ type: 'error', message: '新建文章库失败，请稍后重试。' });
    } finally {
      setCreating(false);
    }
  };

  /**
   * @description 刷新当前文章库详情、文章、二维码与统计。
   * @keyword-cn 刷新发文文章库, 刷新二维码统计
   * @keyword-en refresh-publishing-library, refresh-qr-stats
   */
  const refreshCurrentLibrary = async () => {
    await Promise.all([
      loadLibraries(),
      loadLibraryContent(activeLibrary?.persistedId),
    ]);
  };

  /**
   * @description 重命名当前发文文章库；虚拟母题库会先按需持久化再更新名称。
   * @keyword-cn 重命名发文文章库, 按需持久化母题库
   * @keyword-en rename-publishing-library, persist-mother-library
   */
  const renameActiveLibrary = async () => {
    if (!activeLibrary) return;
    const nextName = window.prompt('请输入新的文章库名称', activeLibrary.name);
    const normalizedName = String(nextName || '').trim();
    if (!normalizedName || normalizedName === activeLibrary.name) return;
    try {
      const libraryId = await ensureActiveLibrary();
      if (!libraryId) throw new Error('LIBRARY_CREATE_FAILED');
      const response = await articleLibraryService.updateLibrary(libraryId, {
        name: normalizedName,
      });
      if (!response?.library) throw new Error('LIBRARY_UPDATE_FAILED');
      await loadLibraries();
      setNotice({ type: 'success', message: '文章库名称已更新。' });
    } catch {
      setNotice({ type: 'error', message: '重命名失败，请稍后重试。' });
    }
  };

  const recentPublishedAt = publishedArticles.reduce((latest, article) => {
    const timestamp = new Date(
      article.publishedAt || article.updatedAt || 0,
    ).getTime();
    return timestamp > latest ? timestamp : latest;
  }, 0);
  const allCurrentPageSelected =
    pagedRows.length > 0 &&
    pagedRows.every((row) => selectedRowKeys.includes(row.key));

  return (
    <>
      <main className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden p-3 lg:p-4 xl:p-5">
        <div className="grid h-full min-w-[1040px] grid-cols-[minmax(250px,0.86fr)_minmax(470px,1.75fr)_minmax(285px,1fr)] gap-3 lg:gap-4">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_22px_rgba(24,45,93,0.04)]">
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">文章库</h2>
                <Info size={14} className="text-slate-400" />
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                <Plus size={14} /> 新建文章库
              </button>
            </div>
            <div className="mx-4 grid grid-cols-2 rounded-xl bg-slate-50 p-1 text-xs font-semibold">
              {[
                ['mother', '母题库'],
                ['custom', '自定义库'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setLibraryMode(value);
                    setActiveLibraryKey('');
                  }}
                  className={`rounded-lg py-2.5 transition ${libraryMode === value ? 'border border-rose-300 bg-white text-rose-500 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative mx-4 mt-4">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="搜索文章库"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-xs outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
              />
            </div>
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {librariesLoading || topicsLoading ? (
                <div className="flex h-36 items-center justify-center text-slate-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : visibleLibraryOptions.length ? (
                visibleLibraryOptions.map((library) => {
                  const active = activeLibrary?.key === library.key;
                  return (
                    <button
                      key={library.key}
                      type="button"
                      onClick={() => setActiveLibraryKey(library.key)}
                      className={`mb-1 flex w-full items-center gap-3 rounded-xl border-l-2 px-4 py-4 text-left transition ${active ? 'border-l-rose-500 bg-rose-50/70 text-[#15285f]' : 'border-l-transparent text-[#233c78] hover:bg-slate-50'}`}
                    >
                      {active ? (
                        <FolderOpen
                          size={18}
                          className="shrink-0 text-rose-500"
                        />
                      ) : (
                        <Folder size={18} className="shrink-0 text-slate-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                        {library.name}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] ${active ? 'bg-white text-rose-500' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {library.total}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-5 py-12 text-center text-xs leading-5 text-slate-400">
                  {libraryMode === 'mother'
                    ? '还没有母选题，请先到“选题”页创建。'
                    : '还没有自定义文章库。'}
                </div>
              )}
            </div>
            <div className="flex h-14 shrink-0 items-center justify-center gap-6 border-t border-slate-100 text-xs text-[#23458f]">
              <ChevronLeft size={16} className="text-slate-400" />
              <span className="font-semibold">1 / 1</span>
              <ChevronRight size={16} className="text-blue-500" />
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_22px_rgba(24,45,93,0.04)]">
            <div className="flex h-[70px] shrink-0 items-center gap-2 border-b border-slate-100 px-6">
              <h2 className="truncate text-base font-bold">
                {activeLibrary?.name || '请选择文章库'}
              </h2>
              {activeLibrary && (
                <button
                  type="button"
                  onClick={() => void renameActiveLibrary()}
                  className="shrink-0 text-slate-400 hover:text-blue-600"
                  title="重命名文章库"
                >
                  <Pencil size={15} />
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-4 px-6 pb-3 pt-4">
              <h3 className="text-sm font-bold">选择子题目加入文章库</h3>
              <div className="relative w-[210px]">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={contentSearch}
                  onChange={(event) => setContentSearch(event.target.value)}
                  placeholder="搜索子题目"
                  className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-rose-300"
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6">
              <div className="flex gap-2">
                {PUBLISH_STATUS_TABS.map((item) => {
                  const count =
                    item.key === 'unsaved'
                      ? unsavedTopics.length
                      : item.key === 'saved'
                        ? savedArticles.length
                        : publishedArticles.length;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setStatusTab(item.key)}
                      className={`relative rounded-t-xl px-4 py-3 text-xs font-semibold transition ${statusTab === item.key ? 'bg-rose-50 text-rose-500' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {item.label} ({count})
                      {statusTab === item.key && (
                        <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-rose-500" />
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setSelectedRowKeys([])}
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-500 hover:text-blue-600"
              >
                <Trash2 size={13} /> 清空选择
              </button>
            </div>
            {notice.message && (
              <div
                className={`mx-5 mt-3 flex items-start justify-between rounded-xl px-3 py-2 text-xs ${notice.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}
              >
                <span>{notice.message}</span>
                <button
                  type="button"
                  onClick={() => setNotice({ type: '', message: '' })}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
              {contentLoading ? (
                <div className="flex h-full items-center justify-center text-slate-400">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : !activeLibrary ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                  <Folder size={35} className="mb-3 opacity-50" />
                  <p className="text-sm font-semibold">请选择文章库</p>
                </div>
              ) : pagedRows.length ? (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  {statusTab !== 'unsaved' && (
                    <div className="flex items-center justify-between bg-slate-50/80 px-4 py-3 text-[11px] text-slate-400">
                      <span>
                        {statusTab === 'saved'
                          ? `已保存的子题目（${filteredRows.length}）`
                          : `已发布的子题目（${filteredRows.length}）`}
                      </span>
                      <span>
                        {statusTab === 'saved' ? '保存时间' : '发布时间'}
                      </span>
                    </div>
                  )}
                  {pagedRows.map((row, index) => {
                    const checked = selectedRowKeys.includes(row.key);
                    return (
                      <div
                        key={row.key}
                        className="flex min-h-[64px] items-center gap-3 border-t border-slate-100 px-4 first:border-t-0"
                      >
                        <button
                          type="button"
                          onClick={() => toggleRow(row.key)}
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-300 bg-white'}`}
                        >
                          {checked && <Check size={12} strokeWidth={3} />}
                        </button>
                        <span
                          className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold ${TOPIC_TONES[index % TOPIC_TONES.length]}`}
                        >
                          {row.topicType || '内容选题'}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-[#172b61]">
                          {row.title}
                        </p>
                        {statusTab === 'unsaved' ? (
                          <Menu size={16} className="shrink-0 text-slate-400" />
                        ) : (
                          <>
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {formatPublishTime(row.time)}
                            </span>
                            <button
                              type="button"
                              onClick={() => void deleteArticleRow(row.id)}
                              className="text-slate-400 hover:text-rose-500"
                              title="删除"
                            >
                              <X size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                  <Bookmark size={34} className="mb-3 opacity-40" />
                  <p className="text-sm font-semibold">
                    {statusTab === 'unsaved'
                      ? '没有可保存的已生成文章'
                      : statusTab === 'saved'
                        ? '文章库里还没有待发布文章'
                        : '文章库里还没有已发布文章'}
                  </p>
                  {statusTab === 'unsaved' && (
                    <p className="mt-1 text-xs">
                      请先在选题页生成文章正文与配图
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 px-5 pb-4 pt-3">
              <div className="flex h-12 items-center justify-between rounded-xl border border-slate-200 px-4 text-xs">
                <button
                  type="button"
                  onClick={toggleCurrentPage}
                  className="flex items-center gap-2 text-[#26447f]"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${allCurrentPageSelected ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-300'}`}
                  >
                    {allCurrentPageSelected && <Check size={12} />}
                  </span>
                  全选本页
                </button>
                {statusTab !== 'unsaved' && selectedRowKeys.length > 0 && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void deleteSelectedArticles()}
                    className="flex items-center gap-1 font-semibold text-rose-500 disabled:opacity-50"
                  >
                    {deleting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    删除
                  </button>
                )}
                <div className="flex items-center gap-5 font-semibold text-[#18316e]">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    className="disabled:opacity-30"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    {page} / {pageTotal}
                  </span>
                  <button
                    type="button"
                    disabled={page >= pageTotal}
                    onClick={() =>
                      setPage((current) => Math.min(pageTotal, current + 1))
                    }
                    className="disabled:opacity-30"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              {statusTab === 'unsaved' && (
                <button
                  type="button"
                  disabled={!selectedRowKeys.length || saving}
                  onClick={() => void saveSelectedTopics()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 py-3 text-sm font-bold text-white shadow-lg shadow-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {saving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Bookmark size={16} />
                  )}
                  {saving ? '保存中…' : '保存选中的题目到文章库'}
                </button>
              )}
            </div>
          </section>

          <aside className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-[0_4px_22px_rgba(24,45,93,0.04)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">文章库二维码</h2>
                <Info size={13} className="text-slate-400" />
              </div>
              <button
                type="button"
                onClick={() => void refreshCurrentLibrary()}
                disabled={contentLoading || !activeLibrary}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 disabled:opacity-40"
              >
                <RefreshCw
                  size={14}
                  className={contentLoading ? 'animate-spin' : ''}
                />
                刷新
              </button>
            </div>
            <div className="mx-auto mt-8 flex h-[220px] w-[220px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-3">
              {qrState.loading ? (
                <Loader2 size={24} className="animate-spin text-slate-400" />
              ) : qrState.svg ? (
                <div
                  className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: qrState.svg }}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center text-xs text-slate-400">
                  <QrCode size={42} className="opacity-40" />
                  <span>
                    {activeLibrary?.persistedId
                      ? qrState.error || '二维码暂不可用'
                      : '保存第一篇文章后生成二维码'}
                  </span>
                </div>
              )}
            </div>
            <p className="mt-5 text-center text-sm font-semibold text-[#22396f]">
              扫码进入小程序收文发布
            </p>
            <p className="mt-2 text-center text-xs leading-5 text-slate-400">
              将文章库分享给小程序成员，扫码查看和发布内容
            </p>

            <div className="mt-7 border-t border-slate-100 pt-6">
              <h3 className="text-sm font-bold">文章库统计</h3>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  [
                    '未保存',
                    unsavedTopics.length,
                    'text-orange-500',
                    'bg-orange-400',
                  ],
                  [
                    '已保存',
                    savedArticles.length,
                    'text-blue-600',
                    'bg-blue-500',
                  ],
                  [
                    '已发布',
                    publishedArticles.length,
                    'text-emerald-600',
                    'bg-emerald-500',
                  ],
                ].map(([label, value, tone, dot]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"
                  >
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                      {label}
                    </div>
                    <div className={`mt-3 text-2xl font-bold ${tone}`}>
                      {value}
                      <span className="ml-1 text-[10px] font-normal text-slate-400">
                        篇
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-[11px] text-slate-400">总子题目</p>
                <p className="mt-2 text-2xl font-bold text-[#18316e]">
                  {candidateTopics.length}
                  <span className="ml-1 text-[10px] font-normal text-slate-400">
                    篇
                  </span>
                </p>
              </div>
            </div>

            <div className="mt-5 border-t border-slate-100 pt-5">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Clock3 size={14} /> 最近一次发布时间
              </div>
              <p className="mt-3 text-sm font-bold text-[#18316e]">
                {recentPublishedAt
                  ? formatPublishTime(recentPublishedAt)
                  : '暂无发布记录'}
              </p>
            </div>
          </aside>
        </div>
      </main>

      {createOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                新建自定义文章库
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={20} />
              </button>
            </div>
            <label className="mt-5 block text-xs font-semibold text-slate-600">
              文章库名称
            </label>
            <input
              autoFocus
              value={newLibraryName}
              onChange={(event) => setNewLibraryName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createCustomLibrary();
              }}
              placeholder="例如：周边美食打卡推荐"
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!newLibraryName.trim() || creating}
                onClick={() => void createCustomLibrary()}
                className="flex items-center gap-2 rounded-xl bg-rose-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creating && <Loader2 size={15} className="animate-spin" />}
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default XhsPublishingView;
