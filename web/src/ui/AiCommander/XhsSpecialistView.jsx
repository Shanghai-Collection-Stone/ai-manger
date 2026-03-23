import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, RefreshCw, CheckCircle, Clock, AlertCircle, BookOpen, X, CircleDot, User } from 'lucide-react';
import ChatBIView from './ChatBIView';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/**
 * @description 获取认证 token
 * @keyword-en get auth token
 */
function getToken() {
  if (typeof window === 'undefined') return '';
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

const XHS_ROBOT_ASSIGNEE = 'robot:xhs_publisher';

/**
 * @description XHS Specialist View with dual-tab pattern
 * Tab 'chat' - LLM chat with XHS/Canvas tools
 * Tab 'tasks' - View XHS batch tasks assigned to xhs_publisher robot
 * @keyword-en XhsSpecialistView, xhs, canvas, specialist, dual-tab
 */
const XhsSpecialistView = ({ onBack }) => {
  const [tab, setTab] = useState('chat'); // 'chat' | 'tasks'
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskItems, setTaskItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsFetched, setItemsFetched] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const query = `${API_BASE}/todo?limit=100&assignee=${encodeURIComponent(XHS_ROBOT_ASSIGNEE)}`;
      const res = await fetch(query, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTasks(Array.isArray(data.todos) ? data.todos : []);
      }
    } catch (err) {
      console.error('Failed to load XHS tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'tasks') {
      loadTasks();
    }
  }, [tab, loadTasks]);

  // Load task items when a task is selected
  useEffect(() => {
    if (!selectedTask?.id || itemsFetched) return;

    let cancelled = false;
    setItemsLoading(true);

    fetch(`${API_BASE}/todo/${selectedTask.id}/items`, { headers: getAuthHeaders() })
      .then(res => {
        if (cancelled) return null;
        if (!res.ok) return { items: [] };
        return res.json();
      })
      .then(data => {
        if (cancelled || !data) return;
        setTaskItems(Array.isArray(data.items) ? data.items : []);
        setItemsFetched(true);
      })
      .catch(() => {
        if (!cancelled) setTaskItems([]);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedTask?.id, itemsFetched]);

  const handleSelectTask = (task) => {
    setSelectedTask(task);
    setTaskItems([]);
    setItemsFetched(false);
  };

  const handleCloseDetail = () => {
    setSelectedTask(null);
    setTaskItems([]);
    setItemsFetched(false);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'done':
      case 'completed':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'in_progress':
        return <CircleDot size={16} className="text-blue-500" />;
      case 'pending':
        return <Clock size={16} className="text-slate-400" />;
      default:
        return <AlertCircle size={16} className="text-slate-400" />;
    }
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'done':
      case 'completed':
        return { icon: <CheckCircle size={14} />, color: 'text-green-600', bgColor: 'bg-green-50 border-green-200' };
      case 'in_progress':
        return { icon: <CircleDot size={14} />, color: 'text-blue-600', bgColor: 'bg-blue-50 border-blue-200' };
      case 'failed':
      case 'cancelled':
        return { icon: <X size={14} />, color: 'text-red-600', bgColor: 'bg-red-50 border-red-200' };
      default:
        return { icon: <Clock size={14} />, color: 'text-slate-400', bgColor: 'bg-slate-50 border-slate-200' };
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'done':
      case 'completed':
        return '已完成';
      case 'in_progress':
        return '执行中';
      case 'pending':
        return '待接单';
      case 'failed':
        return '失败';
      default:
        return status || '未知';
    }
  };

  const getStatusDotColor = (status) => {
    if (status === 'in_progress') return 'bg-blue-500';
    if (status === 'pending') return 'bg-orange-500';
    if (status === 'done' || status === 'completed') return 'bg-green-500';
    return 'bg-slate-300';
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

  // Task List Content
  const renderTaskList = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <RefreshCw size={20} className="animate-spin mr-2" />
          <span className="text-sm">加载中...</span>
        </div>
      );
    }
    if (tasks.length === 0) {
      return (
        <div className="text-center py-12 text-slate-400">
          <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无小红书发布任务</p>
          <p className="text-xs mt-1">在对话中创建任务后会自动显示在这里</p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => handleSelectTask(task)}
            className="p-3 bg-slate-50 rounded-lg border border-slate-100 hover:border-rose-200 transition cursor-pointer"
          >
            <div className="flex items-start gap-2">
              {getStatusIcon(task.status)}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {task.title || `任务 #${task.id}`}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-500">
                    {getStatusText(task.status)}
                  </span>
                  {task.canvasId && (
                    <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                      Canvas#{task.canvasId}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Task Detail Modal Content
  const renderTaskDetail = () => {
    if (!selectedTask) return null;

    const dotColor = getStatusDotColor(selectedTask.status);

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={handleCloseDetail}
        />
        <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl relative z-10 animate-fade-in-up overflow-hidden max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
            <div className="flex-1 min-w-0 pr-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${dotColor}`} />
                <h3 className="font-bold text-slate-800 text-base line-clamp-2">
                  {selectedTask.title || `任务 #${selectedTask.id}`}
                </h3>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] px-2 py-0.5 rounded border bg-white text-slate-500 border-slate-200">
                  {getStatusText(selectedTask.status)}
                </span>
                {selectedTask.canvasId && (
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-blue-50 text-blue-600 border-blue-200">
                    Canvas#{selectedTask.canvasId}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleCloseDetail}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition flex-shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content - Task Items Timeline */}
          <div className="flex-1 overflow-y-auto p-4">
            {itemsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-rose-200 border-t-rose-500 rounded-full animate-spin" />
              </div>
            ) : taskItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <Clock size={32} className="mb-2 opacity-30" />
                <p className="text-sm">暂无执行节点</p>
              </div>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-slate-200" />

                <div className="space-y-3">
                  {taskItems.map((item, idx) => {
                    const style = getStatusStyle(item.status);
                    const isLast = idx === taskItems.length - 1;
                    return (
                      <div key={item.id} className="relative flex gap-3">
                        {/* Status dot */}
                        <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${style.bgColor}`}>
                          <span className={style.color}>{style.icon}</span>
                        </div>

                        {/* Content card */}
                        <div className={`flex-1 min-w-0 ${isLast ? 'pb-0' : 'pb-4'}`}>
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

          {/* Footer */}
          <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50 shrink-0">
            <p className="text-[10px] text-slate-400 text-center">
              共 {taskItems.length} 个节点 · 按计划时间排序
            </p>
          </div>
        </div>
      </div>
    );
  };

  // Chat Tab Content
  const renderChatTab = () => (
    <div className="flex-1 min-h-0">
      <ChatBIView
        sessionType="xhs-specialist"
        sessionStorageKey="ai_commander_xhs_session"
        welcomeTitle="小红书专家"
        welcomeDesc="基于 Canvas 和图库，帮你生成和发布小红书内容"
        quickPrompts={[
          '生成一组小红书文章',
          '查看我的 Canvas 列表',
          '分析爆款笔记特点',
        ]}
        inputPlaceholder="输入问题，关于小红书内容创作..."
        showInlineSessionPicker
      />
    </div>
  );

  // Tasks Tab Content
  const renderTasksTab = () => (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">小红书发布任务</h3>
        <button
          onClick={loadTasks}
          disabled={loading}
          className="p-1.5 hover:bg-slate-100 rounded-full text-slate-500 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {renderTaskList()}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      {/* Header with dual-tab */}
      <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
        <button
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="inline-flex rounded-full bg-slate-100 p-1 overflow-x-auto max-w-[calc(100%-88px)]">
          <button
            onClick={() => setTab('chat')}
            className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${
              tab === 'chat'
                ? 'bg-white shadow text-slate-800'
                : 'text-slate-500'
            }`}
          >
            对话
          </button>
          <button
            onClick={() => setTab('tasks')}
            className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${
              tab === 'tasks'
                ? 'bg-white shadow text-slate-800'
                : 'text-slate-500'
            }`}
          >
            发布任务
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {tab === 'chat' ? renderChatTab() : renderTasksTab()}

      {/* Task Detail Modal */}
      {selectedTask && renderTaskDetail()}
    </div>
  );
};

export default XhsSpecialistView;
