import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Clock, User, CheckCircle2, AlertTriangle, UserCheck,
  CheckCircle, XCircle, CircleDot, Timer, X, ChevronRight
} from 'lucide-react';
import { getAdminToken } from '../Admin/adminApi';
import CanvasFeedView from './CanvasFeedView';
import { chatService } from './chatService';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/**
 * @description 渲染 markdown 为安全 HTML
 * @keyword-en renderMarkdown
 */
const renderMarkdown = (content) => {
  if (!content) return { __html: '' };
  try {
    const raw = marked.parse(content);
    return { __html: DOMPurify.sanitize(raw) };
  } catch {
    return { __html: DOMPurify.sanitize(content) };
  }
};

/**
 * @description 生成鉴权请求头
 * @keyword-en build auth headers
 */
const buildAuthHeaders = () => {
  const token = getAdminToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

const formatTime = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

/**
 * @description 节点状态样式映射
 * @keyword-en get item status style
 */
const getItemStatusStyle = (status) => {
  switch (status) {
    case 'done':
      return { icon: <CheckCircle size={14} />, color: 'text-green-600', bg: 'bg-green-50 border-green-200' };
    case 'in_progress':
      return { icon: <CircleDot size={14} />, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' };
    case 'failed':
    case 'cancelled':
      return { icon: <XCircle size={14} />, color: 'text-red-600', bg: 'bg-red-50 border-red-200' };
    default:
      return { icon: <Timer size={14} />, color: 'text-slate-400', bg: 'bg-slate-50 border-slate-200' };
  }
};

const getItemStatusText = (status) => {
  switch (status) {
    case 'done': return '已完成';
    case 'in_progress': return '进行中';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
    default: return '待处理';
  }
};

/* ─── 节点详情弹窗 ─── */

/**
 * @description 执行节点详情弹窗，限高可滚动
 * @keyword-en ItemDetailPopup timeline item detail popup
 */
const ItemDetailPopup = ({ item, onClose }) => {
  const style = getItemStatusStyle(item.status);
  return (
    /* 节点详情弹窗 区域 */
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
        {/* 弹窗头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${style.bg}`}>
              <span className={style.color}>{style.icon}</span>
            </div>
            <h3 className="text-sm font-semibold text-slate-800 truncate">{item.title || '节点详情'}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* 弹窗内容，限高滚动 */}
        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-3">
          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${style.bg} ${style.color}`}>
            {style.icon}
            <span>{getItemStatusText(item.status)}</span>
          </div>

          {/* 描述信息 */}
          {item.description && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">描述</div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{item.description}</p>
            </div>
          )}

          {/* 备注 */}
          {item.doneNote && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">备注</div>
              <p className="text-sm text-slate-600 italic whitespace-pre-wrap">{item.doneNote}</p>
            </div>
          )}

          {/* 阶段 */}
          {item.stage && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">阶段</div>
              <p className="text-sm text-slate-700">{item.stage}</p>
            </div>
          )}

          {/* 时间信息 */}
          <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
            {item.plannedAt && (
              <span className="flex items-center gap-1">
                <Clock size={11} />
                {formatDate(item.plannedAt)} {formatTime(item.plannedAt)}
              </span>
            )}
            {item.createdAt && (
              <span className="flex items-center gap-1">
                <Clock size={11} />
                创建 {formatDate(item.createdAt)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── 执行节点时间轴 Tab ─── */

/**
 * @description 执行节点时间轴 Tab，可点击查看节点详情
 * @keyword-en TaskTimelineTab timeline nodes tab
 */
const TaskTimelineTab = ({ task }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    if (!task?.id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/todo/${task.id}/items`, { headers: buildAuthHeaders() })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => {
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [task?.id]);

  return (
    /* 执行节点列表 区域 */
    <div className="p-4 pb-24">
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Clock size={32} className="mb-2 opacity-30" />
          <p className="text-sm">暂无执行节点</p>
        </div>
      ) : (
        <div className="relative">
          {/* 时间轴连接线 */}
          <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-slate-200" />
          <div className="space-y-3">
            {items.map((item) => {
              const style = getItemStatusStyle(item.status);
              return (
                /* 单个时间轴节点，可点击 */
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="relative flex gap-3 w-full text-left group"
                >
                  <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${style.bg}`}>
                    <span className={style.color}>{style.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm group-hover:border-indigo-200 group-hover:shadow-md transition">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-medium text-slate-800 line-clamp-2">
                          {item.title || '未命名节点'}
                        </h4>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${style.bg} ${style.color}`}>
                          {getItemStatusText(item.status)}
                        </span>
                      </div>
                      {item.description && (
                        <p className="text-xs text-slate-500 line-clamp-2 mb-1">{item.description}</p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          {item.plannedAt && (
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              {formatDate(item.plannedAt)} {formatTime(item.plannedAt)}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-indigo-500 opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5">
                          查看详情 <ChevronRight size={10} />
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading && items.length > 0 && (
        <p className="text-center text-[10px] text-slate-400 mt-4">共 {items.length} 个节点</p>
      )}

      {/* 节点详情弹窗 */}
      {selectedItem && (
        <ItemDetailPopup item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  );
};

/* ─── 判断图片链接 ─── */
const isImageUrl = (url) =>
  /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.bmp|\.svg)(\?|#|$)/i.test(String(url || ''));

const normalizeUrl = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(\/?)(?:uploads|uploads_thumbs|pages)\//i.test(s)) return `${API_BASE}/${s.replace(/^\//, '')}`;
  return s;
};

/* ─── 任务详情信息 Tab ─── */

/**
 * @description 任务详情 Tab，展示任务基础信息与操作按钮
 * @keyword-en TaskInfoTab task detail info tab with action buttons
 */
const TaskInfoTab = ({ task, onBack, onReload, assigneeTargets }) => {
  const typeLabelMap = {
    auto_execute: '自动执行',
    offline_execute: '线下执行',
    other: '其他',
  };

  const [descExpanded, setDescExpanded] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [showAcceptSection, setShowAcceptSection] = useState(false);
  const [acceptName, setAcceptName] = useState('');
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAbnormalInput, setShowAbnormalInput] = useState(false);
  const [abnormalReasonText, setAbnormalReasonText] = useState('');
  const [showReworkInput, setShowReworkInput] = useState(false);
  const [reworkAssignee, setReworkAssignee] = useState(task.assigneeRaw || '');
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [resourceCanvasViewerId, setResourceCanvasViewerId] = useState(null);
  const [resourceCanvas, setResourceCanvas] = useState(null);
  const [resourceCanvasLoading, setResourceCanvasLoading] = useState(false);

  const submit = async (url, method, body) => {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
      body: JSON.stringify(body),
    });
    return res.ok;
  };

  // 解析关联资源为资源项列表（简单版：支持图片/URL/文本）
  const resourceText = String(task.resource || '').trim();
  const resourceItems = (() => {
    if (!resourceText) return [];
    const items = [];
    const urlRegex = /(https?:\/\/[^\s,，;；]+)/gi;
    let m = urlRegex.exec(resourceText);
    while (m) {
      const u = normalizeUrl(m[1]);
      if (u) items.push({ id: `url-${u}`, kind: isImageUrl(u) ? 'image' : 'url', label: isImageUrl(u) ? '图片' : '链接', value: u });
      m = urlRegex.exec(resourceText);
    }
    if (items.length === 0) {
      items.push({ id: 'text', kind: 'text', label: '内容', value: resourceText });
    }
    return items;
  })();

  useEffect(() => {
    if (!showResourceModal) {
      setResourceCanvas(null);
      setResourceCanvasLoading(false);
    }
  }, [showResourceModal]);

  return (
    /* 任务详情信息主体 区域 */
    <div className="p-4 space-y-4 pb-24">
      {/* 任务名称 */}
      <div>
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">任务名称</div>
        <p className="text-sm font-semibold text-slate-800">{task.title}</p>
      </div>

      {/* 任务描述 区域 */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">任务描述</div>
          {(task.desc || '').length > 220 && (
            <button onClick={() => setDescExpanded((v) => !v)} className="text-[10px] font-bold text-slate-500 hover:text-slate-700">
              {descExpanded ? '收起' : '展开'}
            </button>
          )}
        </div>
        <div className={`mt-1 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words bg-slate-50 rounded-xl p-3 border border-slate-100 ${descExpanded ? '' : 'max-h-40 overflow-y-auto'}`}>
          {task.desc || '暂无描述'}
        </div>
      </div>

      {/* 执行计划 区域 */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">执行计划</div>
          {(task.aiPlan || '').length > 400 && (
            <button onClick={() => setPlanExpanded((v) => !v)} className="text-[10px] font-bold text-slate-500 hover:text-slate-700">
              {planExpanded ? '收起' : '展开'}
            </button>
          )}
        </div>
        <div className={`mt-1 bg-white rounded-xl p-3 border border-slate-200 overflow-y-auto ${planExpanded ? '' : 'max-h-56'}`}>
          {task.aiPlan ? (
            <div
              className="text-sm text-slate-700 leading-relaxed break-words prose prose-sm prose-slate max-w-none prose-p:my-1 prose-li:my-0.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded [&_strong]:font-semibold"
              dangerouslySetInnerHTML={renderMarkdown(task.aiPlan)}
            />
          ) : (
            <span className="text-sm text-slate-400">暂无执行计划</span>
          )}
        </div>
      </div>

      {/* 元信息网格 区域 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">负责人</div>
          <div className="flex items-center gap-1.5 text-sm text-slate-700">
            <User size={14} className="text-slate-400 shrink-0" />
            <span className="truncate">{task.owner || '-'}</span>
          </div>
        </div>
        <div className="bg-slate-50 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">接单人</div>
          <div className="flex items-center gap-1.5 text-sm text-slate-700">
            <User size={14} className="text-slate-400 shrink-0" />
            <span className="truncate">{task.assignee || '待分配'}</span>
          </div>
        </div>
        <div className="bg-slate-50 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">任务类型</div>
          <span className="text-sm text-slate-700">{typeLabelMap[task.type] || '其他'}</span>
        </div>
        <div className="bg-slate-50 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">更新时间</div>
          <div className="flex items-center gap-1 text-xs text-slate-700">
            <Clock size={13} className="text-slate-400 shrink-0" />
            <span className="truncate">{task.updatedAt ? new Date(task.updatedAt).toLocaleDateString('zh-CN') : '-'}</span>
          </div>
        </div>
      </div>

      {/* 关联资源 区域 */}
      <div className="bg-slate-50 rounded-xl p-3">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">关联资源</div>
        {resourceText ? (
          <button onClick={() => setShowResourceModal(true)} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            查看关联资源
          </button>
        ) : (
          <div className="text-sm text-slate-400">暂无关联资源</div>
        )}
      </div>

      {/* 异常原因 区域 */}
      {task.status === 'abnormal' && task.abnormalReason && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-600 mb-2">
            <AlertTriangle size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">异常原因</span>
          </div>
          <p className="text-sm text-red-700 whitespace-pre-wrap">{task.abnormalReason}</p>
        </div>
      )}

      {/* 操作按钮区域 */}
      <div className="pt-2 space-y-3">
        {/* 待接单 - 接单按钮 */}
        {task.status === 'pending' && !showAcceptSection && (
          <button
            onClick={() => setShowAcceptSection(true)}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition flex items-center justify-center gap-2"
          >
            <UserCheck size={16} /> 接单
          </button>
        )}

        {/* 待接单 - 接单表单 */}
        {task.status === 'pending' && showAcceptSection && (
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 space-y-3">
            <label className="block text-xs font-bold text-indigo-600">接单人</label>
            <div className="relative">
              <input
                type="text"
                value={acceptName}
                onChange={(e) => { setAcceptName(e.target.value); setShowAssigneeDropdown(true); }}
                onFocus={() => setShowAssigneeDropdown(true)}
                onBlur={() => setTimeout(() => setShowAssigneeDropdown(false), 200)}
                className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                placeholder="输入或选择接单人"
                autoFocus
              />
              {showAssigneeDropdown && assigneeTargets.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto">
                  {assigneeTargets
                    .filter((a) => !acceptName || a.label.toLowerCase().includes(acceptName.toLowerCase()) || a.value.toLowerCase().includes(acceptName.toLowerCase()))
                    .map((target) => (
                      <button
                        key={target.value}
                        onMouseDown={(e) => { e.preventDefault(); setAcceptName(target.value); setShowAssigneeDropdown(false); }}
                        className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition flex items-center gap-2"
                      >
                        <User size={14} className="text-slate-400" />
                        <span>{target.label}</span>
                        <span className="ml-auto text-[10px] text-slate-400">{target.type === 'agent' || target.type === 'robot' ? '机器人' : '人员'}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <button
              onClick={async () => {
                if (!acceptName.trim() || isSubmitting) return;
                setIsSubmitting(true);
                try {
                  const ok = await submit(`${API_BASE}/todo/${task.id}/accept`, 'POST', { assignee: acceptName.trim() });
                  if (ok) { onReload(); onBack(); }
                } finally { setIsSubmitting(false); }
              }}
              disabled={!acceptName.trim() || isSubmitting}
              className={`w-full bg-indigo-600 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-indigo-700 transition ${(!acceptName.trim() || isSubmitting) ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {isSubmitting ? '处理中...' : '确认接单'}
            </button>
          </div>
        )}

        {/* 执行中 - 完成/上报按钮 */}
        {task.status === 'inprogress' && !showAbnormalInput && (
          <div className="flex gap-3">
            <button
              onClick={async () => {
                if (isSubmitting) return;
                setIsSubmitting(true);
                try {
                  const ok = await submit(`${API_BASE}/todo/${task.id}`, 'PATCH', { status: 'done' });
                  if (ok) { onReload(); onBack(); }
                } finally { setIsSubmitting(false); }
              }}
              disabled={isSubmitting}
              className={`flex-1 bg-green-500 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-green-200 hover:bg-green-600 transition flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <CheckCircle2 size={16} /> 完成任务
            </button>
            <button
              onClick={() => setShowAbnormalInput(true)}
              disabled={isSubmitting}
              className={`flex-1 bg-red-50 text-red-600 border border-red-200 py-3 rounded-xl font-bold text-sm hover:bg-red-100 transition flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <AlertTriangle size={16} /> 异常上报
            </button>
          </div>
        )}

        {/* 执行中 - 异常上报表单 */}
        {task.status === 'inprogress' && showAbnormalInput && (
          <div className="space-y-3">
            <label className="block text-xs font-bold text-red-600">异常原因</label>
            <textarea
              value={abnormalReasonText}
              onChange={(e) => setAbnormalReasonText(e.target.value)}
              placeholder="请详细描述异常情况..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition h-24 resize-none"
            />
            <div className="flex gap-3">
              <button onClick={() => setShowAbnormalInput(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold text-sm hover:bg-slate-200 transition">
                取消
              </button>
              <button
                onClick={async () => {
                  if (!abnormalReasonText.trim() || isSubmitting) return;
                  setIsSubmitting(true);
                  try {
                    const ok = await submit(`${API_BASE}/todo/${task.id}`, 'PATCH', { status: 'failed', abnormalReason: abnormalReasonText.trim() });
                    if (ok) { onReload(); onBack(); }
                  } finally { setIsSubmitting(false); }
                }}
                disabled={!abnormalReasonText.trim() || isSubmitting}
                className={`flex-1 bg-red-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-red-700 transition ${(!abnormalReasonText.trim() || isSubmitting) ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                确认提交
              </button>
            </div>
          </div>
        )}

        {/* 异常 - 返工按钮 */}
        {task.status === 'abnormal' && !showReworkInput && (
          <button
            onClick={() => { setReworkAssignee(task.assigneeRaw || ''); setShowReworkInput(true); }}
            className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-blue-200 hover:bg-blue-600 transition flex items-center justify-center gap-2"
          >
            <Clock size={16} /> 重新执行 (返工)
          </button>
        )}

        {/* 异常 - 返工表单 */}
        {task.status === 'abnormal' && showReworkInput && (
          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-3">
            <label className="block text-xs font-bold text-blue-600">重新分配负责人</label>
            <div className="relative">
              <input
                type="text"
                value={reworkAssignee}
                onChange={(e) => { setReworkAssignee(e.target.value); setShowAssigneeDropdown(true); }}
                onFocus={() => setShowAssigneeDropdown(true)}
                onBlur={() => setTimeout(() => setShowAssigneeDropdown(false), 200)}
                placeholder="请输入或选择接单人..."
                className="w-full bg-white border border-blue-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
              />
              {showAssigneeDropdown && assigneeTargets.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-100 rounded-xl shadow-xl overflow-hidden max-h-40 overflow-y-auto">
                  {assigneeTargets
                    .filter((t) => !reworkAssignee || t.label.toLowerCase().includes(reworkAssignee.toLowerCase()) || t.value.toLowerCase().includes(reworkAssignee.toLowerCase()))
                    .map((target) => (
                      <button
                        key={target.value}
                        onMouseDown={(e) => { e.preventDefault(); setReworkAssignee(target.value); setShowAssigneeDropdown(false); }}
                        className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition flex items-center gap-2"
                      >
                        <User size={14} className="text-slate-400" />
                        <span>{target.label}</span>
                        <span className="ml-auto text-[10px] text-slate-400">{target.type === 'agent' || target.type === 'robot' ? '机器人' : '人员'}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowReworkInput(false)} className="flex-1 bg-white border border-slate-200 text-slate-600 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-50 transition">
                取消
              </button>
              <button
                onClick={async () => {
                  if (!reworkAssignee.trim() || isSubmitting) return;
                  setIsSubmitting(true);
                  try {
                    const ok = await submit(`${API_BASE}/todo/${task.id}`, 'PATCH', { status: 'in_progress', abnormalReason: '', assignee: reworkAssignee.trim() });
                    if (ok) { onReload(); onBack(); }
                  } finally { setIsSubmitting(false); }
                }}
                disabled={!reworkAssignee.trim() || isSubmitting}
                className={`flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-bold text-sm shadow-md hover:bg-blue-700 transition ${(!reworkAssignee.trim() || isSubmitting) ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                确认返工
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 关联资源弹窗 区域 */}
      {showResourceModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowResourceModal(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-sm font-semibold text-slate-800">关联资源</h3>
              <button onClick={() => setShowResourceModal(false)} className="p-1.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 max-h-[65vh] overflow-y-auto space-y-3">
              {resourceItems.map((item) => (
                <div key={item.id}>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{item.label}</div>
                  {item.kind === 'image' ? (
                    <div className="rounded-xl border border-slate-100 overflow-hidden flex items-center justify-center bg-slate-50 max-h-72">
                      <img src={item.value} alt="resource" className="max-w-full max-h-64 object-contain" />
                    </div>
                  ) : item.kind === 'url' ? (
                    <a href={item.value} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:text-indigo-700 break-all">{item.value}</a>
                  ) : (
                    <p className="text-sm text-slate-700 whitespace-pre-wrap break-all">{item.value}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Canvas 全屏查看器 */}
      {resourceCanvasViewerId && (
        <div className="fixed inset-0 z-[95] bg-white">
          <CanvasFeedView canvasId={resourceCanvasViewerId} onClose={() => setResourceCanvasViewerId(null)} />
        </div>
      )}
    </div>
  );
};

/* ─── 任务成果 Tab ─── */

/**
 * @description 任务成果 Tab，以 markdown 预览展示 claw api 最终返回的成果
 * @keyword-en TaskResultTab task result markdown preview tab
 */
const TaskResultTab = ({ task }) => (
  /* 任务成果内容 区域 */
  <div className="px-4 py-5">
    {task.taskResult ? (
      <div
        className="prose prose-sm max-w-none text-slate-700 leading-relaxed"
        dangerouslySetInnerHTML={renderMarkdown(task.taskResult)}
      />
    ) : (
      /* 暂无成果占位符 区域 */
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <CheckCircle2 size={36} strokeWidth={1.2} className="mb-3 text-slate-200" />
        <p className="text-sm">暂无任务成果</p>
        <p className="text-xs mt-1">任务完成后成果将显示在此处</p>
      </div>
    )}
  </div>
);

/* ─── TaskDetailPage 主体 ─── */

/**
 * @description 任务详情页，全屏展示任务详情、执行节点信息、任务成果三个 Tab
 * @keyword-en TaskDetailPage task detail full page with tabs
 * @param {object} props.task - 任务对象
 * @param {function} props.onBack - 返回回调
 * @param {function} props.onReload - 刷新列表回调
 * @param {Array} props.assigneeTargets - 可选指派对象列表
 */
const TaskDetailPage = ({ task, onBack, onReload, assigneeTargets }) => {
  const [activeTab, setActiveTab] = useState('info');

  const statusDotClass =
    task.status === 'inprogress' ? 'bg-blue-500' :
    task.status === 'pending' ? 'bg-orange-500 animate-pulse' :
    task.status === 'completed' ? 'bg-green-500' :
    'bg-slate-300';

  const typeLabelMap = { auto_execute: '自动执行', offline_execute: '线下执行', other: '其他' };

  return (
    /* 任务详情全页面 区域 */
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* 详情页头部 区域 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white shrink-0">
        <button onClick={onBack} className="p-1.5 -ml-1 rounded-full hover:bg-slate-100 text-slate-600">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotClass}`} />
            <h2 className="font-bold text-slate-800 text-base truncate">{task.title}</h2>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
              {typeLabelMap[task.type] || '其他'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded border bg-white text-slate-500 border-slate-200">
              {task.statusText}
            </span>
          </div>
        </div>
      </div>

      {/* 详情页 Tab 导航 区域 */}
      <div className="border-b border-slate-100 px-4 bg-white shrink-0">
        <div className="flex space-x-6">
          {[['info', '任务详情'], ['timeline', '执行节点信息'], ['result', '任务成果']].map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 text-sm font-bold transition-colors relative ${activeTab === tab ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {label}
              {activeTab === tab && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-slate-900 rounded-full" />}
            </button>
          ))}
        </div>
      </div>

      {/* 详情页内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'info' && <TaskInfoTab task={task} onBack={onBack} onReload={onReload} assigneeTargets={assigneeTargets} />}
        {activeTab === 'timeline' && <TaskTimelineTab task={task} />}
        {activeTab === 'result' && <TaskResultTab task={task} />}
      </div>
    </div>
  );
};

export default TaskDetailPage;
