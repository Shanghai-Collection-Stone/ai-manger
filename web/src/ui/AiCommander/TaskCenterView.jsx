import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import {
  Brush, Shield, Wrench, Megaphone, Plus, Clock, User, X, ClipboardList, Zap, UserCheck, AlertTriangle, CheckCircle2, ChevronRight, CircleDot, CheckCircle, XCircle, Timer
} from 'lucide-react';
import { $createTaskOpen, $taskCount, $tasksRefreshKey } from './store';
import { getAdminToken } from '../Admin/adminApi';
import { chatService } from './chatService';
import CanvasFeedView from './CanvasFeedView';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked
marked.setOptions({ breaks: true, gfm: true });

/**
 * @description 渲染 markdown 为安全的 HTML
 * @keyword-en renderMarkdown
 * @param {string} content
 * @returns {{ __html: string }}
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

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/**
 * @description 判断资源链接是否为图片。
 * @keyword-en isImageResourceUrl
 * @param {string} url
 * @returns {boolean}
 */
const isImageResourceUrl = (url) => {
  const s = String(url || '').trim().toLowerCase();
  if (!s) return false;
  return /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.bmp|\.svg)(\?|#|$)/i.test(s);
};

/**
 * @description 规范化资源链接到可访问地址。
 * @keyword-en normalizeResourceUrl
 * @param {string} raw
 * @returns {string}
 */
const normalizeResourceUrl = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(uploads|uploads_thumbs|pages)\//i.test(s)) return `${API_BASE}/${s}`;
  if (/^\/(uploads|uploads_thumbs|pages)\//i.test(s)) return `${API_BASE}${s}`;
  return s;
};

/**
 * @description 解析关联资源文本，提取Canvas、图片和链接资源。
 * @keyword-en extractResourceItems
 * @param {string} raw
 * @returns {Array<{ id: string; kind: 'canvas' | 'image' | 'url' | 'text'; label: string; value: string; canvasId?: number }>}
 */
const extractResourceItems = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return [];

  /** @type {Array<{ id: string; kind: 'canvas' | 'image' | 'url' | 'text'; label: string; value: string; canvasId?: number }>} */
  const items = [];
  const seen = new Set();

  const pushItem = (item) => {
    const key = `${item.kind}:${item.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  // 尝试从 JSON 资源提取结构化字段
  try {
    const maybe = JSON.parse(text);
    if (maybe && typeof maybe === 'object') {
      const obj = /** @type {Record<string, unknown>} */ (maybe);
      const canvasIdNum = Number(obj.canvasId ?? obj.canvas_id ?? obj.canvas);
      if (Number.isFinite(canvasIdNum) && canvasIdNum > 0) {
        pushItem({
          id: `canvas-${canvasIdNum}`,
          kind: 'canvas',
          label: `Canvas #${canvasIdNum}`,
          value: String(canvasIdNum),
          canvasId: canvasIdNum,
        });
      }
      const oneUrl = normalizeResourceUrl(String(obj.url ?? obj.imageUrl ?? '').trim());
      if (oneUrl) {
        pushItem({
          id: `url-${oneUrl}`,
          kind: isImageResourceUrl(oneUrl) ? 'image' : 'url',
          label: isImageResourceUrl(oneUrl) ? '图片资源' : '链接资源',
          value: oneUrl,
        });
      }
      const imageUrls = Array.isArray(obj.imageUrls) ? obj.imageUrls : [];
      imageUrls.forEach((u, idx) => {
        const normalized = normalizeResourceUrl(String(u || '').trim());
        if (!normalized) return;
        pushItem({
          id: `image-${idx}-${normalized}`,
          kind: 'image',
          label: `图片 ${idx + 1}`,
          value: normalized,
        });
      });
    }
  } catch {
    // ignore json parse errors
  }

  const canvasRegex = /(?:canvas(?:id)?|画布)\s*[#：:\-]?\s*(\d+)/gi;
  let canvasMatch = canvasRegex.exec(text);
  while (canvasMatch) {
    const n = Number(canvasMatch[1]);
    if (Number.isFinite(n) && n > 0) {
      pushItem({
        id: `canvas-text-${n}`,
        kind: 'canvas',
        label: `Canvas #${n}`,
        value: String(n),
        canvasId: n,
      });
    }
    canvasMatch = canvasRegex.exec(text);
  }

  const urlRegex = /(https?:\/\/[^\s,，;；]+)/gi;
  let urlMatch = urlRegex.exec(text);
  while (urlMatch) {
    const normalized = normalizeResourceUrl(urlMatch[1]);
    if (normalized) {
      pushItem({
        id: `url-text-${normalized}`,
        kind: isImageResourceUrl(normalized) ? 'image' : 'url',
        label: isImageResourceUrl(normalized) ? '图片资源' : '链接资源',
        value: normalized,
      });
    }
    urlMatch = urlRegex.exec(text);
  }

  const pathRegex = /(?:^|[\s,，;；])((?:\/?)(?:uploads|uploads_thumbs|pages)\/[^\s,，;；]+)/gi;
  let pathMatch = pathRegex.exec(text);
  while (pathMatch) {
    const normalized = normalizeResourceUrl(pathMatch[1]);
    if (normalized && isImageResourceUrl(normalized)) {
      pushItem({
        id: `path-image-${normalized}`,
        kind: 'image',
        label: '图片资源',
        value: normalized,
      });
    }
    pathMatch = pathRegex.exec(text);
  }

  if (items.length === 0) {
    pushItem({
      id: 'text-resource',
      kind: 'text',
      label: '文本资源',
      value: text,
    });
  }

  return items;
};

/* ─── Timeline Modal ─── */

/**
 * @description 任务节点时间轴弹窗组件
 * @keyword-en TodoTimelineModal
 * @param {Object} props
 * @param {Object} props.task - 当前任务对象
 * @param {Function} props.onClose - 关闭回调
 * @returns {JSX.Element}
 */
const TodoTimelineModal = ({ task, onClose }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetched, setFetched] = useState(false);

  const buildAuthHeaders = () => {
    const token = getAdminToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  useEffect(() => {
    // Only fetch once when modal opens
    if (!task?.id || fetched) return;

    let cancelled = false;
    setLoading(true);

    fetch(`${API_BASE}/todo/${task.id}/items`, {
      headers: buildAuthHeaders(),
    })
      .then(res => {
        if (cancelled) return null;
        if (!res.ok) return { items: [] };
        return res.json();
      })
      .then(data => {
        if (cancelled || !data) return;
        const list = Array.isArray(data.items) ? data.items : [];
        setItems(list);
        setFetched(true);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [task?.id, fetched]);

  const formatTime = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'done':
        return { icon: <CheckCircle size={14} />, color: 'text-green-600', bgColor: 'bg-green-50 border-green-200' };
      case 'in_progress':
        return { icon: <CircleDot size={14} />, color: 'text-blue-600', bgColor: 'bg-blue-50 border-blue-200' };
      case 'failed':
      case 'cancelled':
        return { icon: <XCircle size={14} />, color: 'text-red-600', bgColor: 'bg-red-50 border-red-200' };
      default:
        return { icon: <Timer size={14} />, color: 'text-slate-400', bgColor: 'bg-slate-50 border-slate-200' };
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'done': return '已完成';
      case 'in_progress': return '进行中';
      case 'failed': return '失败';
      case 'cancelled': return '已取消';
      default: return '待处理';
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <Clock size={16} className="text-indigo-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-800 truncate">执行节点</h3>
              <p className="text-[10px] text-slate-500 truncate">
                {task?.title || `任务 #${task?.id}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-200 transition text-slate-400 hover:text-slate-600 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <Clock size={32} className="mb-2 opacity-30" />
              <p className="text-sm">暂无执行节点</p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-slate-200" />

              <div className="space-y-3">
                {items.map((item, idx) => {
                  const style = getStatusStyle(item.status);
                  const isLast = idx === items.length - 1;
                  return (
                    <div key={item.id} className="relative flex gap-3">
                      {/* Status dot */}
                      <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${style.bgColor}`}>
                        <span className={style.color}>{style.icon}</span>
                      </div>

                      {/* Content card */}
                      <div className={`flex-1 min-w-0 pb-${isLast ? '0' : '4'}`}>
                        <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="text-sm font-medium text-slate-800 line-clamp-1">
                              {item.title || '未命名节点'}
                            </h4>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${style.bgColor} ${style.color}`}>
                              {getStatusText(item.status)}
                            </span>
                          </div>

                          {item.description && (
                            <p className="text-xs text-slate-500 line-clamp-2 mb-2">
                              {item.description}
                            </p>
                          )}

                          <div className="flex items-center gap-3 text-[10px] text-slate-400">
                            {item.plannedAt && (
                              <span className="flex items-center gap-1">
                                <Clock size={10} />
                                {formatDate(item.plannedAt)} {formatTime(item.plannedAt)}
                              </span>
                            )}
                            {item.userId && (
                              <span className="flex items-center gap-1">
                                <User size={10} />
                                {item.userId}
                              </span>
                            )}
                          </div>

                          {item.doneNote && (
                            <div className="mt-2 pt-2 border-t border-slate-100">
                              <p className="text-xs text-slate-600 italic">
                                {item.doneNote}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50 shrink-0">
          <p className="text-[10px] text-slate-400 text-center">
            共 {items.length} 个节点 · 按计划时间排序
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * @description 任务中心视图组件，展示执行指挥中心任务流
 * @keyword-en TaskCenterView
 * @returns {JSX.Element} TaskCenterView component
 */
const TaskCenterView = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState('inprogress');
  const [activeCategory, setActiveCategory] = useState('all');
  const refreshKey = useStore($tasksRefreshKey);
  const isCreateModalOpen = useStore($createTaskOpen);

  /**
   * @description 统一任务类型到三分类，兼容历史类型值
   * @keyword-en normalizeTaskType
   * @param {string} rawType
   * @returns {string}
   */
  const normalizeTaskType = useCallback((rawType) => {
    const t = String(rawType || '').trim().toLowerCase();
    if (t === 'auto_execute') return 'auto_execute';
    if (t === 'offline_execute') return 'offline_execute';
    if (t === 'other') return 'other';
    if (['cleaning', 'security', 'repair', 'inspection'].includes(t)) {
      return 'offline_execute';
    }
    return 'other';
  }, []);
  
  // 新建任务表单状态
  const [newTask, setNewTask] = useState({
    title: '',
    desc: '',
    type: 'offline_execute',
    assignee: '',
    resource: ''
  });

  const [tasks, setTasks] = useState([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
   const [acceptName, setAcceptName] = useState('');
  const [assigneeTargets, setAssigneeTargets] = useState([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAcceptInDetail, setShowAcceptInDetail] = useState(false);
  const [showAbnormalInput, setShowAbnormalInput] = useState(false);
  const [abnormalReasonText, setAbnormalReasonText] = useState('');
  const [showReworkInput, setShowReworkInput] = useState(false);
  const [reworkAssignee, setReworkAssignee] = useState('');
  const [descExpanded, setDescExpanded] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [authUserName, setAuthUserName] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [roleScope, setRoleScope] = useState('self');

  // Timeline modal state
  const [showTimeline, setShowTimeline] = useState(false);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [resourceCanvasViewerId, setResourceCanvasViewerId] = useState(null);
  const [resourcePreview, setResourcePreview] = useState(null);
  const [resourceCanvas, setResourceCanvas] = useState(null);
  const [resourceCanvasLoading, setResourceCanvasLoading] = useState(false);

  /**
   * @description 关闭任务详情与其子弹窗
   * @keyword-en closeTaskDetail
   * @returns {void}
   */
  const closeTaskDetail = () => {
    setSelectedTask(null);
    setShowTimeline(false);
    setShowResourceModal(false);
    setResourceCanvasViewerId(null);
  };

  const resourceItems = useMemo(
    () => extractResourceItems(selectedTask?.resource || ''),
    [selectedTask?.resource],
  );

  useEffect(() => {
    if (!showResourceModal) {
      setResourcePreview(null);
      setResourceCanvas(null);
      setResourceCanvasLoading(false);
      return;
    }
    setResourcePreview(resourceItems[0] || null);
    setResourceCanvas(null);
    setResourceCanvasLoading(false);
  }, [showResourceModal, resourceItems]);

  useEffect(() => {
    if (!showResourceModal) return;
    if (!resourcePreview || resourcePreview.kind !== 'canvas') return;
    const canvasId = Number(resourcePreview.canvasId);
    if (!Number.isFinite(canvasId) || canvasId <= 0) return;

    let cancelled = false;
    setResourceCanvasLoading(true);
    setResourceCanvas(null);

    chatService
      .getCanvas(canvasId)
      .then((res) => {
        if (cancelled) return;
        const canvas = res?.canvas && typeof res.canvas === 'object' ? res.canvas : null;
        setResourceCanvas(canvas);
      })
      .finally(() => {
        if (!cancelled) setResourceCanvasLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showResourceModal, resourcePreview]);

  const quickActions = [
    { id: 'all', icon: <ClipboardList size={16} className="text-slate-600" />, label: '全部' },
    { id: 'auto_execute', icon: <Zap size={16} className="text-purple-500" />, label: '自动执行' },
    { id: 'offline_execute', icon: <Brush size={16} className="text-orange-500" />, label: '线下执行' },
    { id: 'other', icon: <Shield size={16} className="text-blue-500" />, label: '其他' },
  ];

  const typeLabelMap = {
    auto_execute: '自动执行',
    offline_execute: '线下执行',
    other: '其他'
  };

  const priorityLabelMap = {
    high: { label: '高优', className: 'bg-red-50 text-red-600 border-red-100' },
    medium: { label: '中优', className: 'bg-amber-50 text-amber-600 border-amber-100' },
    low: { label: '低优', className: 'bg-slate-50 text-slate-500 border-slate-100' }
  };

  const pendingCount = tasks.filter(t => t.status === 'pending').length;
  const inProgressCount = tasks.filter(t => t.status === 'inprogress').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const autoExecCount = tasks.filter(t => t.type === 'auto_execute').length;
  const abnormalCount = tasks.filter(t => t.status === 'abnormal').length;
  const totalCount = tasks.length;

  /**
   * @description 生成带鉴权头的请求头
   * @keyword-en build auth headers
   * @returns {Record<string, string>}
   */
  const buildAuthHeaders = () => {
    const token = getAdminToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  /**
   * @description 计算任务可见权限
   * @keyword-en resolve task visibility permission
   * @returns {void}
   */
  const resolveTaskPermission = () => {
    const role = currentUser?.role;
    const scopeByRole = {
      super_admin: 'all',
      tenant_admin: 'all',
      operator: 'self',
    };
    setRoleScope(scopeByRole[role] || 'self');
    setAuthUserName(currentUser?.username || '');
    setAuthDisplayName(currentUser?.displayName || '');
  };

  const loadTodos = async () => {
    setIsFetching(true);
    try {
      const canViewAllTasks = roleScope === 'all';
      const query = canViewAllTasks
        ? `${API_BASE}/todo?limit=100`
        : `${API_BASE}/todo?limit=100&userId=${encodeURIComponent(authUserName)}`;
      const res = await fetch(query, {
        headers: {
          ...buildAuthHeaders(),
        },
      });
      if (!res.ok) {
        setTasks([]);
        return;
      }
      const data = await res.json();
      const rows = Array.isArray(data.todos) ? data.todos : [];
      const mapped = rows
        .filter((todo) => {
          if (canViewAllTasks) return true;
          const owner = todo.userId || '';
          const assignee = todo.assignee || '';
          return (
            owner === authUserName ||
            owner === authDisplayName ||
            assignee === authUserName ||
            assignee === authDisplayName
          );
        })
        .map(todo => {
        const type = normalizeTaskType(todo.type);
        const statusInfo = todo.status === 'pending'
          ? { status: 'pending', statusText: '待接单' }
          : todo.status === 'in_progress'
            ? { status: 'inprogress', statusText: '执行中' }
            : todo.status === 'done'
              ? { status: 'completed', statusText: '已完成' }
              : todo.status === 'failed'
                ? { status: 'abnormal', statusText: '异常' }
                : todo.status === 'cancelled'
                  ? { status: 'abnormal', statusText: '已取消' }
                  : { status: 'pending', statusText: '待接单' };
        const timeText = todo.updatedAt || todo.createdAt
          ? new Date(todo.updatedAt || todo.createdAt).toLocaleString()
          : '';
        return {
          id: todo.id,
          title: todo.title || '未命名任务',
          desc: todo.description || '暂无描述',
          ...statusInfo,
          owner: todo.userId || '系统',
          assigneeRaw: todo.assignee || '',
          assignee: todo.assigneeDisplayName || todo.assignee || '待分配',
          abnormalReason: todo.abnormalReason || '',
          eta: timeText ? `更新 ${timeText}` : '',
          actionText: '催办',
          type,
          priority: 'medium',
          aiPlan: todo.aiPlan || '',
          aiConsideration: todo.aiConsideration || '',
          decisionReason: todo.decisionReason || '',
          createdAt: todo.createdAt || '',
          updatedAt: todo.updatedAt || '',
          resource: todo.resource || ''
        };
      });
      setTasks(mapped);
      // 更新全局未处理任务数量 (仅待接单)
      const pending = mapped.filter(t => t.status === 'pending').length;
      $taskCount.set(pending);
    } catch {
      setTasks([]);
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    resolveTaskPermission();
  }, [currentUser]);

  useEffect(() => {
    if (!authUserName && !authDisplayName) return;
    loadTodos();
    fetch(`${API_BASE}/todo/assignee-targets`, {
      headers: {
        ...buildAuthHeaders(),
      },
    })
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.targets)) {
          setAssigneeTargets(
            d.targets
              .map((x) => {
                const value = String(x?.value || '').trim();
                const label = String(x?.label || value).trim();
                const type = String(x?.type || 'user').trim();
                if (!value) return null;
                return { value, label, type };
              })
              .filter(Boolean),
          );
          return;
        }
        if (Array.isArray(d.assignees)) {
          setAssigneeTargets(
            d.assignees
              .map((x) => {
                const v = String(x || '').trim();
                if (!v) return null;
                return { value: v, label: v, type: 'user' };
              })
              .filter(Boolean),
          );
        }
      })
      .catch(() => {});
  }, [authUserName, authDisplayName, roleScope, normalizeTaskType]);

  useEffect(() => {
    if (!authUserName && !authDisplayName) return;
    if (refreshKey <= 0) return;
    loadTodos();
  }, [refreshKey]);

  const handleCreateTask = async () => {
    if (!newTask.title) return;
    if (isCreating) return;
    setIsCreating(true);
    try {
      const payload = {
        userId: authUserName || authDisplayName || newTask.assignee || 'system',
        title: newTask.title,
        description: newTask.desc || '手动创建的任务工单',
        type: String(newTask.assignee || '').startsWith('robot:') ? 'auto_execute' : newTask.type,
        assignee: roleScope === 'all'
          ? newTask.assignee || undefined
          : authDisplayName || authUserName || undefined,
        resource: (newTask.resource || '').trim() || undefined,
        aiConsideration: '人工创建待办任务',
        decisionReason: '来自待办管理系统创建',
        aiPlan: '等待负责人处理并反馈结果'
      };
      const res = await fetch(`${API_BASE}/todo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
        body: JSON.stringify(payload)
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.todo?.id) {
        await loadTodos();
      }
      $createTaskOpen.set(false);
      setNewTask({ title: '', desc: '', type: 'offline_execute', assignee: '', resource: '' });
    } finally {
      setIsCreating(false);
    }
  };

  const filteredTasks = tasks.filter(task => {
    // 状态筛选 (简化逻辑：pending 也算在 inprogress Tab 显示，或者单独处理)
    const statusMatch = activeTab === 'inprogress' 
      ? (task.status === 'inprogress' || task.status === 'pending')
      : task.status === activeTab;
    
    // 分类筛选
    const categoryMatch = activeCategory === 'all' || task.type === activeCategory;

    return statusMatch && categoryMatch;
  });

  return (
    <div className="space-y-4 animate-fade-in pb-24 relative" id="task-center-view">

      {/* Statistics Grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
            <div className="text-[10px] text-slate-500">待接单</div>
          </div>
          <div className="text-2xl font-black text-slate-900">{pendingCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
            <div className="text-[10px] text-slate-500">进行中</div>
          </div>
          <div className="text-2xl font-black text-slate-900">{inProgressCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
            <div className="text-[10px] text-slate-500">已完成</div>
          </div>
          <div className="text-2xl font-black text-slate-900">{completedCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap size={10} className="text-purple-500" />
            <div className="text-[10px] text-slate-500">自动执行</div>
          </div>
          <div className="text-2xl font-black text-slate-900">{autoExecCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={10} className="text-red-500" />
            <div className="text-[10px] text-slate-500">异常工单</div>
          </div>
          <div className="text-2xl font-black text-slate-900">{abnormalCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <ClipboardList size={10} className="text-slate-400" />
            <div className="text-[10px] text-slate-500">全部任务</div>
          </div>
          <div className="text-2xl font-black text-slate-900">{totalCount}</div>
        </div>
      </div>

      <div 
        className="flex items-center gap-2 overflow-x-auto pb-1"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {quickActions.map((action) => (
          <button 
            key={action.id} 
            onClick={() => setActiveCategory(action.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition whitespace-nowrap ${
              activeCategory === action.id 
                ? 'bg-slate-900 text-white border-slate-900' 
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            <span className={activeCategory === action.id ? 'text-white' : ''}>{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-100">
        <div className="flex space-x-6">
          <button 
            onClick={() => setActiveTab('inprogress')}
            className={`pb-2 text-sm font-bold transition-colors relative ${activeTab === 'inprogress' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
          >
            进行中 ({tasks.filter(t => t.status === 'inprogress' || t.status === 'pending').length})
            {activeTab === 'inprogress' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-slate-900 rounded-full" />}
          </button>
          <button 
            onClick={() => setActiveTab('completed')}
            className={`pb-2 text-sm font-bold transition-colors relative ${activeTab === 'completed' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
          >
            已完成
            {activeTab === 'completed' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-slate-900 rounded-full" />}
          </button>
          <button 
            onClick={() => setActiveTab('abnormal')}
            className={`pb-2 text-sm font-bold transition-colors relative ${activeTab === 'abnormal' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
          >
            异常工单 ({abnormalCount})
            {activeTab === 'abnormal' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-slate-900 rounded-full" />}
          </button>
        </div>
      </div>

      <div className="space-y-2 min-h-[200px]">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
      <ClipboardList size={24} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium">该分类下暂无任务</p>
          </div>
        ) : (
          filteredTasks.map(task => (
            <div 
              key={task.id} 
              onClick={() => {
                setSelectedTask(task);
                setShowResourceModal(false);
                setShowAcceptInDetail(false);
                setShowAbnormalInput(false);
                setAbnormalReasonText('');
                setShowReworkInput(false);
                setReworkAssignee(task.assigneeRaw || '');
                setDescExpanded(false);
                setPlanExpanded(false);
              }}
              className="bg-white rounded-xl px-4 py-3 border border-slate-100 hover:border-slate-200 hover:shadow-sm transition cursor-pointer active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${task.status === 'inprogress' ? 'bg-blue-500' : task.status === 'pending' ? 'bg-orange-500' : 'bg-slate-300'}`} />
                    <h3 className="font-semibold text-slate-800 text-sm line-clamp-1">{task.title}</h3>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{task.desc}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[10px] px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-100">
                      {typeLabelMap[task.type] || '其他'}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${priorityLabelMap[task.priority]?.className || 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                      {priorityLabelMap[task.priority]?.label || '普通'}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded border bg-white text-slate-500 border-slate-200">
                      {task.statusText}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 min-w-[80px]">
                  <div className="flex items-center gap-1 text-[11px] text-slate-600">
                    <User size={12} className="text-slate-400" />
                    <span className="line-clamp-1">{task.owner || '-'}</span>
                  </div>
                  {task.eta && (
                    <span className="flex items-center text-[11px] text-slate-400">
                      <Clock size={12} className="mr-1" />
                      {task.eta}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Task Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => $createTaskOpen.set(false)} />
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl relative z-10 animate-fade-in-up overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-bold text-slate-800">新建派单</h3>
              <button onClick={() => $createTaskOpen.set(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">任务标题</label>
                <input 
                  type="text" 
                  value={newTask.title}
                  onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  placeholder="例如：B区卫生间清洁"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">任务类型</label>
                  <select 
                    value={newTask.type}
                    onChange={(e) => setNewTask({...newTask, type: e.target.value})}
                    disabled={String(newTask.assignee || '').startsWith('robot:')}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition appearance-none"
                  >
                    <option value="auto_execute">自动执行</option>
                    <option value="offline_execute">线下执行</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">指派给</label>
                  <select
                    value={newTask.assignee}
                    onChange={(e) => {
                      const nextAssignee = e.target.value;
                      setNewTask({
                        ...newTask,
                        assignee: nextAssignee,
                        type: String(nextAssignee || '').startsWith('robot:') ? 'auto_execute' : newTask.type,
                      });
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition appearance-none"
                  >
                    <option value="">请选择指派对象</option>
                    {assigneeTargets.map((target) => (
                      <option key={target.value} value={target.value}>
                        {target.type === 'robot' ? `🤖 ${target.label}` : `👤 ${target.label}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">关联资源 (选填)</label>
                <input
                  type="text"
                  value={newTask.resource}
                  onChange={(e) => setNewTask({...newTask, resource: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  placeholder="例如：店铺A-B区监控、https://..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">描述详情 (选填)</label>
                <textarea 
                  value={newTask.desc}
                  onChange={(e) => setNewTask({...newTask, desc: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition h-24 resize-none"
                  placeholder="描述任务的具体要求..."
                />
              </div>

              <button 
                onClick={handleCreateTask}
                disabled={isCreating}
                className={`w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:scale-[1.02] active:scale-95 transition-all mt-2 ${isCreating ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                确认派单
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeTaskDetail} />
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl relative z-10 animate-fade-in-up overflow-hidden max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-slate-50/50 flex-shrink-0">
              <div className="flex-1 min-w-0 pr-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${selectedTask.status === 'inprogress' ? 'bg-blue-500' : selectedTask.status === 'pending' ? 'bg-orange-500 animate-pulse' : selectedTask.status === 'completed' ? 'bg-green-500' : 'bg-slate-300'}`} />
                  <h3 className="font-bold text-slate-800 text-base line-clamp-2">{selectedTask.title}</h3>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
                    {typeLabelMap[selectedTask.type] || '其他'}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-white text-slate-500 border-slate-200">
                    {selectedTask.statusText}
                  </span>
                </div>
              </div>
              <button onClick={closeTaskDetail} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Description */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">任务描述</label>
                  {String(selectedTask.desc || '').length > 220 && (
                    <button
                      onClick={() => setDescExpanded((v) => !v)}
                      className="text-[10px] font-bold text-slate-500 hover:text-slate-700"
                    >
                      {descExpanded ? '收起' : '展开'}
                    </button>
                  )}
                </div>
                <div
                  className={`text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words bg-slate-50 rounded-xl p-3 border border-slate-100 ${
                    descExpanded ? '' : 'max-h-40 overflow-y-auto'
                  }`}
                >
                  {selectedTask.desc || '暂无描述'}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">执行计划</label>
                  {String(selectedTask.aiPlan || '').length > 400 && (
                    <button
                      onClick={() => setPlanExpanded((v) => !v)}
                      className="text-[10px] font-bold text-slate-500 hover:text-slate-700"
                    >
                      {planExpanded ? '收起' : '展开'}
                    </button>
                  )}
                </div>
                <div
                  className={`bg-white rounded-xl p-3 border border-slate-200 overflow-y-auto ${
                    planExpanded ? '' : 'max-h-56'
                  }`}
                >
                  {selectedTask.aiPlan ? (
                    <div
                      className="text-sm text-slate-700 leading-relaxed break-words prose prose-sm prose-slate max-w-none
                        prose-p:my-1 prose-li:my-0.5
                        [&_ul]:list-disc [&_ul]:pl-5 [&_li]:pl-1
                        [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:pl-1
                        [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs
                        [&_pre]:bg-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:text-xs [&_pre]:overflow-x-auto
                        [&_strong]:font-semibold [&_em]:italic"
                      dangerouslySetInnerHTML={renderMarkdown(selectedTask.aiPlan)}
                    />
                  ) : (
                    <span className="text-sm text-slate-400">暂无执行计划</span>
                  )}
                </div>
              </div>

              {/* Meta Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">负责人</div>
                  <div className="flex items-center gap-1.5 text-sm text-slate-700">
                    <User size={14} className="text-slate-400" />
                    <span>{selectedTask.owner || '-'}</span>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">接单人</div>
                  <div className="flex items-center gap-1.5 text-sm text-slate-700">
                    <User size={14} className="text-slate-400" />
                    <span>{selectedTask.assignee || '待分配'}</span>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">更新时间</div>
                  <div className="flex items-center gap-1.5 text-sm text-slate-700">
                    <Clock size={14} className="text-slate-400" />
                    <span className="text-xs">{selectedTask.eta || '无'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">关联资源</div>
                {selectedTask.resource ? (
                  <button
                    onClick={() => setShowResourceModal(true)}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    查看关联资源
                  </button>
                ) : (
                  <div className="text-sm text-slate-400">暂无关联资源</div>
                )}
              </div>

              {/* Timeline Button */}
              <button
                onClick={() => setShowTimeline(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition text-sm font-medium"
              >
                <Clock size={16} />
                <span>查看执行节点</span>
                <ChevronRight size={14} />
              </button>

              {/* Abnormal Reason */}
              {(selectedTask.status === 'abnormal' || selectedTask.status === 'failed') && selectedTask.abnormalReason && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4 mt-4">
                  <div className="flex items-center gap-2 text-red-600 mb-2">
                    <AlertTriangle size={16} />
                    <span className="text-xs font-bold uppercase tracking-wider">异常原因</span>
                  </div>
                  <p className="text-sm text-red-700 whitespace-pre-wrap">{selectedTask.abnormalReason}</p>
                </div>
              )}

              {/* Accept Section (only for pending tasks) */}
              {selectedTask.status === 'pending' && showAcceptInDetail && (
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
                      placeholder="输入或选择接单人姓名"
                      autoFocus
                    />
                    {showAssigneeDropdown && assigneeTargets.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 max-h-32 overflow-y-auto">
                        {assigneeTargets
                          .filter((a) => {
                            if (!acceptName) return true;
                            const q = acceptName.toLowerCase();
                            return a.label.toLowerCase().includes(q) || a.value.toLowerCase().includes(q);
                          })
                          .map((target) => (
                            <button
                              key={target.value}
                              onMouseDown={(e) => { e.preventDefault(); setAcceptName(target.value); setShowAssigneeDropdown(false); }}
                              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition flex items-center gap-2"
                            >
                              <User size={14} className="text-slate-400" />
                              <span>{target.label}</span>
                              <span className="ml-auto text-[10px] text-slate-400">{target.type === 'robot' ? '机器人' : '人员'}</span>
                            </button>
                          ))
                        }
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={async () => {
                      if (!acceptName.trim() || isAccepting) return;
                      setIsAccepting(true);
                      try {
                        const res = await fetch(`${API_BASE}/todo/${selectedTask.id}/accept`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
                          body: JSON.stringify({ assignee: acceptName.trim() })
                        });
                        if (res.ok) {
                          await loadTodos();
                          setSelectedTask(null);
                        }
                      } finally {
                        setIsAccepting(false);
                      }
                    }}
                    disabled={!acceptName.trim() || isAccepting}
                    className={`w-full bg-indigo-600 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-indigo-700 transition ${(!acceptName.trim() || isAccepting) ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {isAccepting ? '处理中...' : '确认接单'}
                  </button>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="p-5 border-t border-slate-100 flex-shrink-0">
              {selectedTask.status === 'pending' && !showAcceptInDetail ? (
                <button 
                  onClick={() => setShowAcceptInDetail(true)}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <UserCheck size={16} />
                  接单
                </button>
              ) : selectedTask.status === 'inprogress' ? (
                showAbnormalInput ? (
                  <div className="space-y-3 animate-fade-in">
                    <label className="block text-xs font-bold text-red-600">异常原因</label>
                    <textarea
                      value={abnormalReasonText}
                      onChange={(e) => setAbnormalReasonText(e.target.value)}
                      placeholder="请详细描述异常情况..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition h-24 resize-none"
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowAbnormalInput(false)}
                        className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all flex items-center justify-center"
                      >
                        取消
                      </button>
                      <button
                        onClick={async () => {
                          if (!abnormalReasonText.trim() || isAccepting) return;
                          setIsAccepting(true);
                          try {
                            const res = await fetch(`${API_BASE}/todo/${selectedTask.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
                              body: JSON.stringify({ status: 'failed', abnormalReason: abnormalReasonText.trim() })
                            });
                            if (res.ok) {
                              await loadTodos();
                              setSelectedTask(null);
                            }
                          } finally {
                            setIsAccepting(false);
                          }
                        }}
                        disabled={!abnormalReasonText.trim() || isAccepting}
                        className={`flex-1 bg-red-600 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-red-200 hover:bg-red-700 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center ${(!abnormalReasonText.trim() || isAccepting) ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        确认提交
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button 
                      onClick={async () => {
                        if (isAccepting) return;
                        setIsAccepting(true);
                        try {
                          const res = await fetch(`${API_BASE}/todo/${selectedTask.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
                            body: JSON.stringify({ status: 'done' })
                          });
                          if (res.ok) {
                            await loadTodos();
                            setSelectedTask(null);
                          }
                        } finally {
                          setIsAccepting(false);
                        }
                      }}
                      disabled={isAccepting}
                      className={`flex-1 bg-green-500 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-green-200 hover:bg-green-600 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 ${isAccepting ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <CheckCircle2 size={16} />
                      完成任务
                    </button>
                    <button 
                      onClick={() => setShowAbnormalInput(true)}
                      disabled={isAccepting}
                      className={`flex-1 bg-red-50 text-red-600 border border-red-200 py-3 rounded-xl font-bold text-sm hover:bg-red-100 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 ${isAccepting ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <AlertTriangle size={16} />
                      异常上报
                    </button>
                  </div>
                )
              ) : selectedTask.status === 'abnormal' ? (
                showReworkInput ? (
                  <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-3 animate-fade-in">
                    <label className="block text-xs font-bold text-blue-600">重新分配负责人</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={reworkAssignee}
                        onChange={(e) => {
                          setReworkAssignee(e.target.value);
                          setShowAssigneeDropdown(true);
                        }}
                        onFocus={() => setShowAssigneeDropdown(true)}
                        placeholder="请输入或选择接单人..."
                        className="w-full bg-white border border-blue-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition pr-10"
                      />
                      <User className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                      
                      {showAssigneeDropdown && assigneeTargets.length > 0 && (
                        <div className="absolute z-60 top-full left-0 right-0 mt-1 bg-white border border-slate-100 rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                          {assigneeTargets
                            .filter((target) => {
                              if (!reworkAssignee) return true;
                              const q = reworkAssignee.toLowerCase();
                              return target.label.toLowerCase().includes(q) || target.value.toLowerCase().includes(q);
                            })
                            .map((target) => (
                              <button
                                key={target.value}
                                onMouseDown={(e) => { e.preventDefault(); setReworkAssignee(target.value); setShowAssigneeDropdown(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition flex items-center gap-2"
                              >
                                <User size={14} className="text-slate-400" />
                                <span>{target.label}</span>
                                <span className="ml-auto text-[10px] text-slate-400">{target.type === 'robot' ? '机器人' : '人员'}</span>
                              </button>
                            ))
                          }
                        </div>
                      )}
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => setShowReworkInput(false)}
                        className="flex-1 bg-white border border-slate-200 text-slate-600 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all flex items-center justify-center"
                      >
                        取消
                      </button>
                      <button 
                        onClick={async () => {
                          if (!reworkAssignee.trim() || isAccepting) return;
                          setIsAccepting(true);
                          try {
                            const res = await fetch(`${API_BASE}/todo/${selectedTask.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
                              body: JSON.stringify({ status: 'in_progress', abnormalReason: '', assignee: reworkAssignee.trim() })
                            });
                            if (res.ok) {
                              await loadTodos();
                              setSelectedTask(null);
                            }
                          } finally {
                            setIsAccepting(false);
                          }
                        }}
                        disabled={!reworkAssignee.trim() || isAccepting}
                        className={`flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-bold text-sm shadow-md hover:bg-blue-700 transition ${(!reworkAssignee.trim() || isAccepting) ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        确认返工
                      </button>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={() => {
                      setReworkAssignee(selectedTask.assigneeRaw || '');
                      setShowReworkInput(true);
                    }}
                    className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-blue-200 hover:bg-blue-600 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <Clock size={16} />
                    重新执行 (返工)
                  </button>
                )
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Timeline Modal */}
      {showTimeline && (
        <TodoTimelineModal
          task={selectedTask}
          onClose={() => setShowTimeline(false)}
        />
      )}

      {showResourceModal && selectedTask && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowResourceModal(false)} />
          <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-sm font-semibold text-slate-800">关联资源</h3>
              <button
                onClick={() => setShowResourceModal(false)}
                className="p-1.5 rounded-full hover:bg-slate-200 transition text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-2">
                {resourceItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setResourcePreview(item)}
                    className={`w-full text-left rounded-xl border px-3 py-2 transition ${
                      resourcePreview?.id === item.id
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold">{item.label}</div>
                    <div className="text-[11px] text-slate-500 truncate mt-1">{item.value}</div>
                  </button>
                ))}
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 min-h-[260px]">
                {!resourcePreview ? (
                  <div className="text-sm text-slate-400">暂无可预览资源</div>
                ) : resourcePreview.kind === 'image' ? (
                  <div className="space-y-3">
                    <div className="w-full h-[320px] bg-white rounded-lg border border-slate-100 overflow-hidden flex items-center justify-center">
                      <img
                        src={resourcePreview.value}
                        alt="resource-preview"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <a
                      href={resourcePreview.value}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      打开原图
                    </a>
                  </div>
                ) : resourcePreview.kind === 'canvas' ? (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-slate-800">
                      Canvas #{resourcePreview.canvasId}
                    </div>
                    {resourceCanvasLoading ? (
                      <div className="text-sm text-slate-500">加载 Canvas 中...</div>
                    ) : resourceCanvas ? (
                      <>
                        <div className="text-sm text-slate-700">
                          主题：{resourceCanvas.topic || '未命名'}
                        </div>
                        <div className="text-sm text-slate-700">
                          状态：{resourceCanvas.status || 'unknown'}
                        </div>
                        <div className="text-sm text-slate-700">
                          文章数：{Array.isArray(resourceCanvas.articles) ? resourceCanvas.articles.length : 0}
                        </div>
                        <button
                          type="button"
                          onClick={() => setResourceCanvasViewerId(resourcePreview.canvasId || null)}
                          className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          打开 Canvas 弹窗
                        </button>
                      </>
                    ) : (
                      <div className="text-sm text-amber-600">未找到对应 Canvas 数据</div>
                    )}
                  </div>
                ) : resourcePreview.kind === 'url' ? (
                  <div className="space-y-3">
                    <div className="text-sm text-slate-700 break-all">{resourcePreview.value}</div>
                    <a
                      href={resourcePreview.value}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      打开链接
                    </a>
                  </div>
                ) : (
                  <div className="text-sm text-slate-700 whitespace-pre-wrap break-all">
                    {resourcePreview.value}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {resourceCanvasViewerId && (
        <div className="fixed inset-0 z-[95] bg-white">
          <CanvasFeedView
            canvasId={resourceCanvasViewerId}
            onClose={() => setResourceCanvasViewerId(null)}
          />
        </div>
      )}
    </div>
  );
};

export default TaskCenterView;
