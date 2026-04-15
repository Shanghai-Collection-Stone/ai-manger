import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronDown, RefreshCw, CheckCircle, Clock, AlertCircle, BookOpen, X, CircleDot, User, ArrowLeft, XCircle, Timer, ChevronRight } from 'lucide-react';
import ChatBIView from './ChatBIView';
import XhsDataTab from './XhsDataTab';

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

/** @description 小红书子代理配置 subagent config list */
const XHS_SUBAGENTS = [
  {
    id: 'main',
    label: '小红书专家',
    assignee: null,
    sessionType: 'xhs-specialist',
    sessionStorageKey: 'ai_commander_xhs_session',
    welcomeTitle: '小红书专家',
    welcomeDesc: '基于 Canvas 和图库，帮你生成和发布小红书内容',
    quickPrompts: ['生成一组小红书文章', '查看我的 Canvas 列表', '创建发布计划'],
    inputPlaceholder: '输入问题，关于小红书内容创作...',
  },
  {
    id: 'tracker',
    label: '数据追踪',
    assignee: 'robot:xhs_tracker',
    sessionType: 'xhs-tracker',
    sessionStorageKey: 'ai_commander_xhs_tracker_session',
    welcomeTitle: '数据追踪',
    welcomeDesc: '分析账号互动、爆文规律与粉丝增长趋势',
    quickPrompts: ['分析近期爆款笔记特点', '查看账号粉丝增长趋势', '对比竞品账号数据'],
    inputPlaceholder: '输入分析需求，关于小红书账号数据...',
  },
  {
    id: 'nurture',
    label: '养号策略',
    assignee: 'robot:xhs_nurturer',
    sessionType: 'xhs-nurturer',
    sessionStorageKey: 'ai_commander_xhs_nurture_session',
    welcomeTitle: '养号策略',
    welcomeDesc: '账号定位、内容规划与运营成长路径设计',
    quickPrompts: ['制定本月内容日历', '设计账号人设和定位', '规划涨粉冷启动策略'],
    inputPlaceholder: '输入需求，关于小红书账号运营策略...',
  },
  {
    id: 'publish',
    label: '发文执行',
    assignee: 'robot:xhs_publisher',
    sessionType: 'xhs-publisher',
    sessionStorageKey: 'ai_commander_xhs_publish_session',
    welcomeTitle: '发文执行',
    welcomeDesc: '将内容推入发布流程，批量派单执行',
    quickPrompts: ['发布当前 Canvas 文章', '查看发布任务进度', '批量派发发布任务'],
    inputPlaceholder: '输入发布指令...',
  },
];

/**
 * @description XHS Specialist View with dual-tab pattern
 * Tab 'chat' - LLM chat with XHS/Canvas tools
 * Tab 'tasks' - View XHS batch tasks assigned to xhs_publisher robot
 * @keyword-en XhsSpecialistView, xhs, canvas, specialist, dual-tab
 */
const XhsSpecialistView = ({ onBack }) => {
  const [tab, setTab] = useState('chat'); // 'chat' | 'tasks'
  // 当前激活的子代理 active subagent id
  const [activeAgent, setActiveAgent] = useState('main');
  // 子代理下拉菜单开关 subagent dropdown open state
  const [agentDropOpen, setAgentDropOpen] = useState(false);
  const agentDropRef = useRef(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskItems, setTaskItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsFetched, setItemsFetched] = useState(false);
  // 详情页内部 tab: 'info' | 'timeline' | 'xhs-data'
  const [detailTab, setDetailTab] = useState('info');

  // 关闭下拉菜单（点击外部区域时） close dropdown on outside click
  useEffect(() => {
    if (!agentDropOpen) return;
    const close = (e) => {
      if (agentDropRef.current && !agentDropRef.current.contains(e.target)) {
        setAgentDropOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [agentDropOpen]);

  /**
   * @description 加载当前子代理的任务列表，主视图按 category=xhs 过滤，子代理按 assignee
   * @keyword-en load tasks by category or assignee filter
   */
  const loadTasks = useCallback(async () => {
    const agent = XHS_SUBAGENTS.find(a => a.id === activeAgent) ?? XHS_SUBAGENTS[0];
    setLoading(true);
    try {
      let url;
      if (agent.assignee) {
        // 子代理：按 assignee 过滤
        url = `${API_BASE}/todo?limit=100&assignee=${encodeURIComponent(agent.assignee)}`;
      } else {
        // 主视图：按 category=xhs 拉取所有小红书类型任务
        url = `${API_BASE}/todo?limit=100&category=xhs`;
      }
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const allTasks = Array.isArray(data.todos) ? data.todos : [];
        allTasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setTasks(allTasks);
      } else {
        setTasks([]);
      }
    } catch (err) {
      console.error('Failed to load XHS tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [activeAgent]);

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
    setDetailTab('info');
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
      const agentLabel = XHS_SUBAGENTS.find(a => a.id === activeAgent)?.label ?? '小红书';
      return (
        <div className="text-center py-12 text-slate-400">
          <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无{agentLabel}相关任务</p>
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

  // ─── 任务详情全屏页面（含小红书数据 Tab） ───

  /**
   * @description 节点状态样式
   * @keyword-en item status style
   */
  const getItemStatusStyle = (status) => {
    switch (status) {
      case 'done': return { icon: <CheckCircle size={14} />, color: 'text-green-600', bg: 'bg-green-50 border-green-200' };
      case 'in_progress': return { icon: <CircleDot size={14} />, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' };
      case 'failed': case 'cancelled': return { icon: <XCircle size={14} />, color: 'text-red-600', bg: 'bg-red-50 border-red-200' };
      default: return { icon: <Timer size={14} />, color: 'text-slate-400', bg: 'bg-slate-50 border-slate-200' };
    }
  };

  /**
   * @description 详情页执行节点时间轴
   * @keyword-en DetailTimeline task items timeline
   */
  const renderDetailTimeline = () => {
    if (itemsLoading) {
      return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-rose-200 border-t-rose-500 rounded-full animate-spin" /></div>;
    }
    if (taskItems.length === 0) {
      return <div className="flex flex-col items-center justify-center py-16 text-slate-400"><Clock size={32} className="mb-2 opacity-30" /><p className="text-sm">暂无执行节点</p></div>;
    }
    return (
      /* 执行节点时间轴 区域 */
      <div className="p-4 pb-24">
        <div className="relative">
          <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-slate-200" />
          <div className="space-y-3">
            {taskItems.map((item) => {
              const style = getItemStatusStyle(item.status);
              return (
                <div key={item.id} className="relative flex gap-3">
                  <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${style.bg}`}>
                    <span className={style.color}>{style.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-medium text-slate-800 line-clamp-2">{item.title || '未命名节点'}</h4>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${style.bg} ${style.color}`}>{getStatusText(item.status)}</span>
                      </div>
                      {item.description && <p className="text-xs text-slate-500 line-clamp-2 mb-1">{item.description}</p>}
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        {item.plannedAt && <span className="flex items-center gap-1"><Clock size={10} />{formatDate(item.plannedAt)} {formatTime(item.plannedAt)}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-center text-[10px] text-slate-400 mt-4">共 {taskItems.length} 个节点</p>
      </div>
    );
  };

  /**
   * @description 详情页任务信息 Tab
   * @keyword-en DetailInfo task basic info
   */
  const renderDetailInfo = () => {
    const typeLabelMap = { auto_execute: '自动执行', offline_execute: '线下执行', long_task: '长时任务', other: '其他' };
    return (
      /* 任务详情信息主体 区域 */
      <div className="p-4 space-y-4 pb-24">
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">任务名称</div>
          <p className="text-sm font-semibold text-slate-800">{selectedTask.title}</p>
        </div>
        {selectedTask.description && (
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">任务描述</div>
            <div className="mt-1 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-xl p-3 border border-slate-100 max-h-40 overflow-y-auto">
              {selectedTask.description}
            </div>
          </div>
        )}
        {selectedTask.aiPlan && (
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">执行计划</div>
            <div className="mt-1 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-white rounded-xl p-3 border border-slate-200 max-h-56 overflow-y-auto">
              {selectedTask.aiPlan}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">接单人</div>
            <div className="flex items-center gap-1.5 text-sm text-slate-700"><User size={14} className="text-slate-400 shrink-0" />{selectedTask.assigneeDisplayName || selectedTask.assignee || '待分配'}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">任务类型</div>
            <span className="text-sm text-slate-700">{typeLabelMap[selectedTask.type] || '其他'}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderTaskDetail = () => {
    if (!selectedTask) return null;
    const dotColor = getStatusDotColor(selectedTask.status);
    const typeLabelMap = { auto_execute: '自动执行', offline_execute: '线下执行', long_task: '长时任务', other: '其他' };

    return (
      /* 任务详情全屏页面 区域 */
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        {/* 详情页头部 区域 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white shrink-0">
          <button onClick={handleCloseDetail} className="p-1.5 -ml-1 rounded-full hover:bg-slate-100 text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
              <h2 className="font-bold text-slate-800 text-base truncate">{selectedTask.title || `任务 #${selectedTask.id}`}</h2>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">{typeLabelMap[selectedTask.type] || '其他'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded border bg-white text-slate-500 border-slate-200">{getStatusText(selectedTask.status)}</span>
              {selectedTask.category === 'xhs' && <span className="text-[10px] px-2 py-0.5 rounded border bg-rose-50 text-rose-600 border-rose-200">小红书</span>}
            </div>
          </div>
        </div>

        {/* 详情页 Tab 导航 区域 */}
        <div className="border-b border-slate-100 px-4 bg-white shrink-0">
          <div className="flex space-x-5 overflow-x-auto">
            {[['info', '任务详情'], ['timeline', '执行节点'], ['xhs-data', '小红书数据']].map(([tabKey, label]) => (
              <button
                key={tabKey}
                onClick={() => setDetailTab(tabKey)}
                className={`py-3 text-sm font-bold transition-colors relative whitespace-nowrap ${detailTab === tabKey ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {label}
                {detailTab === tabKey && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-slate-900 rounded-full" />}
              </button>
            ))}
          </div>
        </div>

        {/* 详情页内容区域 */}
        <div className="flex-1 overflow-y-auto">
          {detailTab === 'info' && renderDetailInfo()}
          {detailTab === 'timeline' && renderDetailTimeline()}
          {detailTab === 'xhs-data' && <XhsDataTab task={selectedTask} />}
        </div>
      </div>
    );
  };

  // Chat Tab Content — 按当前子代理动态传入会话配置
  const renderChatTab = () => {
    const cfg = XHS_SUBAGENTS.find(a => a.id === activeAgent) ?? XHS_SUBAGENTS[0];
    return (
      <div className="flex-1 min-h-0">
        <ChatBIView
          sessionType={cfg.sessionType}
          sessionStorageKey={cfg.sessionStorageKey}
          welcomeTitle={cfg.welcomeTitle}
          welcomeDesc={cfg.welcomeDesc}
          quickPrompts={cfg.quickPrompts}
          inputPlaceholder={cfg.inputPlaceholder}
          showInlineSessionPicker
        />
      </div>
    );
  };

  // Tasks Tab Content
  const renderTasksTab = () => {
    const agentLabel = XHS_SUBAGENTS.find(a => a.id === activeAgent)?.label ?? '小红书';
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          {/* 任务列表标题 tasks tab title */}
          <h3 className="text-sm font-semibold text-slate-700">{agentLabel}任务</h3>
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
  };

  return (
    <div className="h-full flex flex-col bg-white animate-fade-in">
      {/* 页头：返回按鈕 + 子代理下拉切换区域 + 任务列表 tab header area */}
      <div className="flex items-center gap-2 p-3 md:p-4 border-b border-slate-100 bg-white/90">
        {/* 返回按鈕 back button */}
        <button
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft size={22} />
        </button>

        {/* 字代理切换区域 subagent switcher + tasks tab */}
        <div className="inline-flex rounded-full bg-slate-100 p-1 flex-shrink-0 gap-0.5">

          {/* 子代理下拉菜单 subagent dropdown */}
          <div className="relative" ref={agentDropRef}>
            <button
              onClick={() => { setTab('chat'); setAgentDropOpen(prev => !prev); }}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition ${
                tab === 'chat'
                  ? 'bg-white shadow text-slate-800'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {XHS_SUBAGENTS.find(a => a.id === activeAgent)?.label ?? '对话'}
              <ChevronDown
                size={12}
                className={`transition-transform ${
                  agentDropOpen && tab === 'chat' ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* 子代理选择列表面板 subagent selection panel */}
            {agentDropOpen && tab === 'chat' && (
              <div className="absolute top-full left-0 mt-1 z-20 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden min-w-[120px]">
                {XHS_SUBAGENTS.map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => { setActiveAgent(agent.id); setAgentDropOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-xs transition hover:bg-rose-50 hover:text-rose-600 ${
                      activeAgent === agent.id
                        ? 'text-rose-600 bg-rose-50 font-medium'
                        : 'text-slate-700'
                    }`}
                  >
                    {agent.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 任务列表 tab tasks tab button */}
          <button
            onClick={() => { setTab('tasks'); setAgentDropOpen(false); }}
            className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition ${
              tab === 'tasks'
                ? 'bg-white shadow text-slate-800'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            任务列表
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
