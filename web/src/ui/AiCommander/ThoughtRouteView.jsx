import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Plus, RefreshCw, Trash2, Edit2, Search } from 'lucide-react';
import ChatBIView from './ChatBIView';

const API_BASE = typeof window !== 'undefined' && window.location.port === '4322'
  ? 'http://localhost:3011'
  : (typeof window !== 'undefined' ? window.location.origin : '');
const ADMIN_TOKEN_KEY = 'admin_token';

/**
 * @description 构建鉴权头
 * @keyword-en build auth headers
 */
const getAuthHeaders = () => {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

/**
 * @description 思维链路页面
 * @keyword-en thought route view
 */
const ThoughtRouteView = ({ onBack }) => {
  const [tab, setTab] = useState('chat');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ summary: '', content: '', keywords: '' });

  const canSave = useMemo(() => {
    return draft.content.trim().length > 0 && draft.summary.trim().length > 0;
  }, [draft.content, draft.summary]);

  /**
   * @description 格式化关键词展示
   * @keyword-en format keywords text
   */
  const formatKeywords = (value) => {
    return Array.isArray(value) ? value.join(', ') : '';
  };

  /**
   * @description 加载思维链列表
   * @keyword-en load thoughts
   */
  const loadThoughts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (keyword.trim()) params.set('keyword', keyword.trim());
      const res = await fetch(`${API_BASE}/skill-thought?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        setRows([]);
        return;
      }
      const data = await res.json();
      setRows(Array.isArray(data?.thoughts) ? data.thoughts : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'table') return;
    loadThoughts();
  }, [tab]);

  /**
   * @description 保存思维链
   * @keyword-en save thought
   */
  const saveThought = async () => {
    if (!canSave) return;
    const payload = {
      summary: draft.summary.trim(),
      content: draft.content.trim(),
      keywords: draft.keywords
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    };
    const url = editingId
      ? `${API_BASE}/skill-thought/${encodeURIComponent(editingId)}`
      : `${API_BASE}/skill-thought`;
    const method = editingId ? 'PATCH' : 'POST';
    await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });
    setEditingId('');
    setDraft({ summary: '', content: '', keywords: '' });
    await loadThoughts();
  };

  /**
   * @description 删除思维链
   * @keyword-en remove thought
   */
  const removeThought = async (id) => {
    await fetch(`${API_BASE}/skill-thought/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await loadThoughts();
  };

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800">
          <ChevronLeft size={22} />
        </button>
        <div className="inline-flex rounded-full bg-slate-100 p-1 flex-shrink-0">
          <button onClick={() => setTab('chat')} className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'chat' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>对话</button>
          <button onClick={() => setTab('table')} className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === 'table' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>思维链表格管理</button>
        </div>
      </div>

      {tab === 'chat' ? (
        <div className="flex-1 min-h-0">
          <ChatBIView
            sessionType="thought"
            sessionStorageKey="ai_commander_thought_session_id"
            welcomeTitle="思维链路对话"
            welcomeDesc="此对话仅用于理解Schema并产出可复用思维链。"
            quickPrompts={['先帮我梳理这个数据源的Schema结构', '基于当前Schema生成一条思维链']}
            inputPlaceholder="输入问题，聚焦Schema理解与思维链生成..."
            showInlineSessionPicker
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="摘要"
                value={draft.summary}
                onChange={(e) => setDraft((prev) => ({ ...prev, summary: e.target.value }))}
              />
              <input
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm md:col-span-2"
                placeholder="关键词，逗号分隔"
                value={draft.keywords}
                onChange={(e) => setDraft((prev) => ({ ...prev, keywords: e.target.value }))}
              />
              <textarea
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm md:col-span-3 min-h-[110px]"
                placeholder="思维链内容"
                value={draft.content}
                onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={() => {
                  setEditingId('');
                  setDraft({ summary: '', content: '', keywords: '' });
                }}
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600"
              >
                清空
              </button>
              <button
                onClick={saveThought}
                disabled={!canSave}
                className="px-3 py-2 text-sm rounded-lg bg-slate-900 text-white disabled:opacity-40 inline-flex items-center gap-1"
              >
                <Plus size={14} />
                {editingId ? '保存修改' : '新增思维链'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm"
                placeholder="按关键词筛选"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <button onClick={loadThoughts} className="px-3 py-2 text-sm border border-slate-200 rounded-lg inline-flex items-center gap-1">
              <RefreshCw size={14} />
              刷新
            </button>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
            <div className="md:hidden divide-y divide-slate-100">
              {rows.map((row) => (
                <div key={row.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800 leading-5 break-words">
                      {row.summary || '未命名'}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setEditingId(row.id);
                          setDraft({
                            summary: row.summary || '',
                            content: row.content || '',
                            keywords: formatKeywords(row.keywords),
                          });
                        }}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => removeThought(row.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 leading-5 break-words">
                    {formatKeywords(row.keywords) || '无关键词'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'}
                  </p>
                  <p className="text-sm text-slate-700 leading-6 break-words">
                    {row.content || ''}
                  </p>
                </div>
              ))}
              {!loading && rows.length === 0 && (
                <div className="px-3 py-8 text-center text-slate-400 text-sm">暂无思维链数据</div>
              )}
              {loading && (
                <div className="px-3 py-8 text-center text-slate-400 text-sm">加载中...</div>
              )}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2 w-[26%]">摘要</th>
                    <th className="text-left px-3 py-2 w-[40%]">关键词</th>
                    <th className="text-left px-3 py-2 w-[24%]">更新时间</th>
                    <th className="text-right px-3 py-2 w-[10%]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 text-slate-700 break-words whitespace-normal">{row.summary || '未命名'}</td>
                      <td className="px-3 py-2 text-slate-500 break-words whitespace-normal">{formatKeywords(row.keywords)}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditingId(row.id);
                              setDraft({
                                summary: row.summary || '',
                                content: row.content || '',
                                keywords: formatKeywords(row.keywords),
                              });
                            }}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => removeThought(row.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td className="px-3 py-8 text-center text-slate-400" colSpan={4}>
                        暂无思维链数据
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td className="px-3 py-8 text-center text-slate-400" colSpan={4}>
                        加载中...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThoughtRouteView;
