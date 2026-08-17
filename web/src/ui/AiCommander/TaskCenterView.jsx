import React, { useEffect, useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import {
  Brush, Shield, Clock, User, X, ClipboardList, Zap, AlertTriangle, List, LayoutGrid
} from 'lucide-react';
import { $createTaskOpen, $taskCount, $tasksRefreshKey } from './store';
import { getAdminToken } from '../Admin/adminApi';
import TaskDetailPage from './TaskDetailPage';
import { SkeletonList } from './blocks/shared.jsx';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/* ─── 看板视图 ─── */

/**
 * @description 任务看板组件，横向泳道展示各状态任务
 * @keyword-en KanbanBoard kanban columns by task status
 */
const KanbanBoard = ({ tasks, onTaskClick, loading = false }) => {
  const typeLabelMap = {
    auto_execute: '自动执行',
    offline_execute: '线下执行',
    other: '其他',
  };

  const columns = [
    { id: 'pending', label: '待接单', dotClass: 'bg-orange-400', headerClass: 'text-orange-600 bg-orange-50 border-orange-100', tasks: tasks.filter((t) => t.status === 'pending') },
    { id: 'inprogress', label: '执行中', dotClass: 'bg-blue-500', headerClass: 'text-blue-600 bg-blue-50 border-blue-100', tasks: tasks.filter((t) => t.status === 'inprogress') },
    { id: 'completed', label: '已完成', dotClass: 'bg-green-500', headerClass: 'text-green-600 bg-green-50 border-green-100', tasks: tasks.filter((t) => t.status === 'completed') },
    { id: 'abnormal', label: '异常', dotClass: 'bg-red-400', headerClass: 'text-red-600 bg-red-50 border-red-100', tasks: tasks.filter((t) => t.status === 'abnormal') },
  ];

  return (
    /* 看板泳道容器 区域 */
    <div
      className="flex gap-3 overflow-x-auto pb-4"
      style={{ touchAction: 'pan-x', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      {columns.map((col) => (
        /* 单个泳道列 */
        <div key={col.id} className="flex-shrink-0 w-60">
          {/* 列头 */}
          <div className={`flex items-center justify-between px-3 py-2 rounded-xl border mb-3 ${col.headerClass}`}>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${col.dotClass}`} />
              <span className="text-xs font-bold">{col.label}</span>
            </div>
            <span className="text-xs font-bold opacity-70">{col.tasks.length}</span>
          </div>

          {/* 任务卡片列表 */}
          <div
            className="space-y-2 overflow-y-auto max-h-[60vh] min-h-[40vh] pr-0.5"
            style={{ touchAction: 'pan-y', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {loading && tasks.length === 0 ? (
              <SkeletonList rows={3} rowClassName="h-20" />
            ) : col.tasks.length === 0 ? (
              <div className="text-center text-xs text-slate-300 py-8 animate-fade-in">暂无任务</div>
            ) : (
              col.tasks.map((task) => (
                /* 看板任务卡片 */
                <button
                  key={task.id}
                  onClick={() => onTaskClick(task)}
                  className="w-full text-left bg-white rounded-xl border border-slate-100 p-3 hover:border-slate-200 hover:shadow-sm transition active:scale-[0.98]"
                >
                  <h3 className="font-semibold text-slate-800 text-xs line-clamp-2 mb-2">{task.title}</h3>
                  <div className="flex items-center justify-between gap-1 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-50 text-slate-500 border-slate-100">
                      {typeLabelMap[task.type] || '其他'}
                    </span>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 min-w-0">
                      <User size={10} className="shrink-0" />
                      <span className="truncate max-w-[70px]">{task.assignee || '待分配'}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ─── 任务中心主视图 ─── */

/**
 * @description 任务中心视图，提供列表和看板两种视图模式
 * @keyword-en TaskCenterView task management center with list and board view
 * @param {object} props.currentUser - 当前登录用户
 */
const TaskCenterView = ({ currentUser }) => {
  /* 视图模式：list 列表 | board 看板 */
  const [viewMode, setViewMode] = useState('list');
  /* 页面层级：null 列表页 | 'detail' 任务详情页 */
  const [viewPage, setViewPage] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);

  const [activeTab, setActiveTab] = useState('inprogress');
  const [activeCategory, setActiveCategory] = useState('all');
  const refreshKey = useStore($tasksRefreshKey);
  const isCreateModalOpen = useStore($createTaskOpen);

  /**
   * @description 统一任务类型到三分类
   * @keyword-en normalizeTaskType
   */
  const normalizeTaskType = useCallback((rawType) => {
    const t = String(rawType || '').trim().toLowerCase();
    if (t === 'auto_execute') return 'auto_execute';
    if (t === 'offline_execute') return 'offline_execute';
    if (t === 'other') return 'other';
    if (['cleaning', 'security', 'repair', 'inspection'].includes(t)) return 'offline_execute';
    return 'other';
  }, []);

  /* 新建任务表单 */
  const [newTask, setNewTask] = useState({ title: '', desc: '', type: 'offline_execute', assignee: '', resource: '' });
  const [tasks, setTasks] = useState([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [acceptName, setAcceptName] = useState('');
  const [assigneeTargets, setAssigneeTargets] = useState([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [authUserName, setAuthUserName] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [roleScope, setRoleScope] = useState('self');

  /**
   * @description 打开任务详情页
   * @keyword-en open task detail page
   */
  const openTaskDetail = (task) => {
    setSelectedTask(task);
    setViewPage('detail');
  };

  /**
   * @description 关闭任务详情页，返回列表
   * @keyword-en close task detail page back to list
   */
  const closeTaskDetail = () => {
    setViewPage(null);
    setSelectedTask(null);
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

  /**
   * @description 计算任务可见权限
   * @keyword-en resolve task visibility permission
   */
  const resolveTaskPermission = () => {
    const role = currentUser?.role;
    const scopeByRole = { super_admin: 'all', tenant_admin: 'all', operator: 'self' };
    setRoleScope(scopeByRole[role] || 'self');
    setAuthUserName(currentUser?.username || '');
    setAuthDisplayName(currentUser?.displayName || '');
  };

  /**
   * @description 加载任务列表
   * @keyword-en load todos list
   */
  const loadTodos = async () => {
    setIsFetching(true);
    try {
      const canViewAllTasks = roleScope === 'all';
      const query = canViewAllTasks
        ? `${API_BASE}/todo?limit=100`
        : `${API_BASE}/todo?limit=100&userId=${encodeURIComponent(authUserName)}`;
      const res = await fetch(query, { headers: buildAuthHeaders() });
      if (!res.ok) { setTasks([]); return; }
      const data = await res.json();
      const rows = Array.isArray(data.todos) ? data.todos : [];
      const mapped = rows
        .filter((todo) => {
          if (canViewAllTasks) return true;
          const owner = todo.userId || '';
          const assignee = todo.assignee || '';
          return (
            owner === authUserName || owner === authDisplayName ||
            assignee === authUserName || assignee === authDisplayName
          );
        })
        .map((todo) => {
          const type = normalizeTaskType(todo.type);
          const statusInfo =
            todo.status === 'pending' ? { status: 'pending', statusText: '待接单' } :
            todo.status === 'in_progress' ? { status: 'inprogress', statusText: '执行中' } :
            todo.status === 'done' ? { status: 'completed', statusText: '已完成' } :
            todo.status === 'failed' ? { status: 'abnormal', statusText: '异常' } :
            todo.status === 'cancelled' ? { status: 'abnormal', statusText: '已取消' } :
            { status: 'pending', statusText: '待接单' };
          const timeText = (todo.updatedAt || todo.createdAt)
            ? new Date(todo.updatedAt || todo.createdAt).toLocaleString() : '';
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
            type,
            priority: 'medium',
            aiPlan: todo.aiPlan || '',
            aiConsideration: todo.aiConsideration || '',
            decisionReason: todo.decisionReason || '',
            createdAt: todo.createdAt || '',
            updatedAt: todo.updatedAt || '',
            resource: todo.resource || '',
            taskResult: todo.taskResult || '',
          };
        });
      setTasks(mapped);
      $taskCount.set(mapped.filter((t) => t.status === 'pending').length);
    } catch {
      setTasks([]);
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => { resolveTaskPermission(); }, [currentUser]);

  useEffect(() => {
    if (!authUserName && !authDisplayName) return;
    loadTodos();
    fetch(`${API_BASE}/todo/assignee-targets`, { headers: buildAuthHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.targets)) {
          setAssigneeTargets(d.targets.map((x) => {
            const value = String(x?.value || '').trim();
            const label = String(x?.label || value).trim();
            const type = String(x?.type || 'user').trim();
            if (!value) return null;
            return { value, label, type };
          }).filter(Boolean));
        }
      })
      .catch(() => {});
  }, [authUserName, authDisplayName, roleScope]);

  useEffect(() => {
    if (!authUserName && !authDisplayName) return;
    if (refreshKey <= 0) return;
    loadTodos();
  }, [refreshKey]);

  /**
   * @description 创建新任务
   * @keyword-en handle create task
   */
  const handleCreateTask = async () => {
    if (!newTask.title || isCreating) return;
    setIsCreating(true);
    try {
      const payload = {
        userId: authUserName || authDisplayName || newTask.assignee || 'system',
        title: newTask.title,
        description: newTask.desc || '手动创建的任务工单',
        type: String(newTask.assignee || '').startsWith('robot:') || String(newTask.assignee || '').startsWith('agent:') ? 'auto_execute' : newTask.type,
        assignee: roleScope === 'all' ? newTask.assignee || undefined : authDisplayName || authUserName || undefined,
        resource: (newTask.resource || '').trim() || undefined,
        aiConsideration: '人工创建待办任务',
        decisionReason: '来自待办管理系统创建',
        aiPlan: '等待负责人处理并反馈结果',
      };
      const res = await fetch(`${API_BASE}/todo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
      await loadTodos();
      $createTaskOpen.set(false);
      setNewTask({ title: '', desc: '', type: 'offline_execute', assignee: '', resource: '' });
    } finally {
      setIsCreating(false);
    }
  };

  /* 统计数据 */
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const inProgressCount = tasks.filter((t) => t.status === 'inprogress').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const autoExecCount = tasks.filter((t) => t.type === 'auto_execute').length;
  const abnormalCount = tasks.filter((t) => t.status === 'abnormal').length;
  const totalCount = tasks.length;

  /* 列表视图过滤 */
  const filteredTasks = tasks.filter((task) => {
    const statusMatch = activeTab === 'inprogress'
      ? (task.status === 'inprogress' || task.status === 'pending')
      : task.status === activeTab;
    const categoryMatch = activeCategory === 'all' || task.type === activeCategory;
    return statusMatch && categoryMatch;
  });

  const quickActions = [
    { id: 'all', icon: <ClipboardList size={16} className="text-slate-600" />, label: '全部' },
    { id: 'auto_execute', icon: <Zap size={16} className="text-purple-500" />, label: '自动执行' },
    { id: 'offline_execute', icon: <Brush size={16} className="text-orange-500" />, label: '线下执行' },
    { id: 'other', icon: <Shield size={16} className="text-blue-500" />, label: '其他' },
  ];

  const typeLabelMap = { auto_execute: '自动执行', offline_execute: '线下执行', other: '其他' };
  const priorityLabelMap = {
    high: { label: '高优', className: 'bg-red-50 text-red-600 border-red-100' },
    medium: { label: '中优', className: 'bg-amber-50 text-amber-600 border-amber-100' },
    low: { label: '低优', className: 'bg-slate-50 text-slate-500 border-slate-100' },
  };

  /* 任务详情页 */
  if (viewPage === 'detail' && selectedTask) {
    return (
      <TaskDetailPage
        task={selectedTask}
        onBack={closeTaskDetail}
        onReload={loadTodos}
        assigneeTargets={assigneeTargets}
      />
    );
  }

  return (
    <div className="space-y-4 animate-fade-in pb-24 relative" id="task-center-view">

      {/* 视图切换 Tab 区域（列表 / 看板） */}
      <div className="flex border-b border-slate-100">
        <button
          onClick={() => setViewMode('list')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors relative ${viewMode === 'list' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <List size={14} /> 任务列表
          {viewMode === 'list' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-slate-900 rounded-full" />}
        </button>
        <button
          onClick={() => setViewMode('board')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors relative ${viewMode === 'board' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <LayoutGrid size={14} /> 任务看板
          {viewMode === 'board' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-slate-900 rounded-full" />}
        </button>
      </div>

      {viewMode === 'list' ? (
        /* 列表视图 区域 */
        <>
          {/* 分类筛选 区域 */}
          <div
            className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {quickActions.map((action) => (
              <button
                key={action.id}
                onClick={() => setActiveCategory(action.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition whitespace-nowrap ${activeCategory === action.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
              >
                <span className={activeCategory === action.id ? 'text-white' : ''}>{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>

          {/* 状态 Tab 区域 */}
          <div className="border-b border-slate-100">
            <div className="flex space-x-6">
              <button
                onClick={() => setActiveTab('inprogress')}
                className={`pb-2 text-sm font-bold transition-colors relative ${activeTab === 'inprogress' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
              >
                进行中 ({tasks.filter((t) => t.status === 'inprogress' || t.status === 'pending').length})
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

          {/* 任务列表 区域 */}
          <div className="space-y-2 min-h-[200px]">
            {isFetching && tasks.length === 0 ? (
              /* 首次拉取时用骨架屏占位，避免误显示「暂无任务」 */
              <SkeletonList rows={4} rowClassName="h-[86px]" />
            ) : filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 animate-fade-in">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
                  <ClipboardList size={24} className="text-slate-300" />
                </div>
                <p className="text-sm font-medium">该分类下暂无任务</p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                /* 列表任务卡片 */
                <div
                  key={task.id}
                  onClick={() => openTaskDetail(task)}
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
        </>
      ) : (
        /* 看板视图 区域 */
        <>
          {/* 统计卡片 区域 */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { dot: 'bg-orange-500', label: '待接单', value: pendingCount },
              { dot: 'bg-blue-500', label: '进行中', value: inProgressCount },
              { dot: 'bg-green-500', label: '已完成', value: completedCount },
            ].map((item) => (
              <div key={item.label} className="bg-white rounded-2xl border border-slate-50 shadow-[0_2px_10px_rgba(0,0,0,0.02)] p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
                  <div className="text-[10px] text-slate-500">{item.label}</div>
                </div>
                <div className="text-2xl font-black text-slate-900">{item.value}</div>
              </div>
            ))}
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
          <KanbanBoard tasks={tasks} onTaskClick={openTaskDetail} loading={isFetching} />
        </>
      )}

      {/* 新建任务弹窗 区域 */}
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
              {/* 任务标题输入 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">任务标题</label>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  placeholder="例如：B区卫生间清洁"
                />
              </div>

              {/* 类型和指派 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">任务类型</label>
                  <select
                    value={newTask.type}
                    onChange={(e) => setNewTask({ ...newTask, type: e.target.value })}
                    disabled={String(newTask.assignee || '').startsWith('robot:') || String(newTask.assignee || '').startsWith('agent:')}
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
                      const v = e.target.value;
                      setNewTask({
                        ...newTask,
                        assignee: v,
                        type: (String(v || '').startsWith('robot:') || String(v || '').startsWith('agent:')) ? 'auto_execute' : newTask.type,
                      });
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition appearance-none"
                  >
                    <option value="">请选择指派对象</option>
                    {assigneeTargets.map((target) => (
                      <option key={target.value} value={target.value}>
                        {(target.type === 'robot' || target.type === 'agent') ? `🤖 ${target.label}` : `👤 ${target.label}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 关联资源 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">关联资源 (选填)</label>
                <input
                  type="text"
                  value={newTask.resource}
                  onChange={(e) => setNewTask({ ...newTask, resource: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  placeholder="例如：店铺A-B区监控、https://..."
                />
              </div>

              {/* 描述详情 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">描述详情 (选填)</label>
                <textarea
                  value={newTask.desc}
                  onChange={(e) => setNewTask({ ...newTask, desc: e.target.value })}
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
    </div>
  );
};

export default TaskCenterView;