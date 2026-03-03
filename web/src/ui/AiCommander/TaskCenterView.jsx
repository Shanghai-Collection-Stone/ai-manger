import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { 
  Brush, Shield, Wrench, Megaphone, Plus, Clock, User, X, ClipboardList, Zap, UserCheck, AlertTriangle, CheckCircle2
} from 'lucide-react';
import { $createTaskOpen } from './store';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/**
 * @description 任务中心视图组件，展示执行指挥中心任务流
 * @keyword-en TaskCenterView
 * @returns {JSX.Element} TaskCenterView component
 */
const TaskCenterView = () => {
  const [activeTab, setActiveTab] = useState('inprogress');
  const [activeCategory, setActiveCategory] = useState('all');
  const isCreateModalOpen = useStore($createTaskOpen);
  
  // 新建任务表单状态
  const [newTask, setNewTask] = useState({
    title: '',
    desc: '',
    type: 'cleaning',
    assignee: ''
  });

  const [tasks, setTasks] = useState([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [acceptName, setAcceptName] = useState('');
  const [assignees, setAssignees] = useState([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAcceptInDetail, setShowAcceptInDetail] = useState(false);
  const [showAbnormalInput, setShowAbnormalInput] = useState(false);
  const [abnormalReasonText, setAbnormalReasonText] = useState('');
  const [showReworkInput, setShowReworkInput] = useState(false);
  const [reworkAssignee, setReworkAssignee] = useState('');

  const quickActions = [
    { id: 'all', icon: <ClipboardList size={16} className="text-slate-600" />, label: '全部' },
    { id: 'auto_execute', icon: <Zap size={16} className="text-purple-500" />, label: '自动执行' },
    { id: 'cleaning', icon: <Brush size={16} className="text-orange-500" />, label: '保洁' },
    { id: 'security', icon: <Shield size={16} className="text-blue-500" />, label: '安保' },
    { id: 'repair', icon: <Wrench size={16} className="text-slate-600" />, label: '报修' },
    { id: 'inspection', icon: <Megaphone size={16} className="text-red-500" />, label: '巡检' },
  ];

  const typeLabelMap = {
    auto_execute: '自动执行',
    cleaning: '保洁调度',
    security: '安保维序',
    repair: '设备报修',
    inspection: '店长巡检'
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

  const loadTodos = async () => {
    setIsFetching(true);
    try {
      const res = await fetch(`${API_BASE}/todo`);
      if (!res.ok) {
        setTasks([]);
        return;
      }
      const data = await res.json();
      const rows = Array.isArray(data.todos) ? data.todos : [];
      const mapped = rows.map(todo => {
        const type = todo.type || 'inspection';
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
          assignee: todo.assignee || '待分配',
          abnormalReason: todo.abnormalReason || '',
          eta: timeText ? `更新 ${timeText}` : '',
          actionText: '催办',
          type,
          priority: 'medium'
        };
      });
      setTasks(mapped);
    } catch {
      setTasks([]);
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    loadTodos();
    // Load historical assignees
    fetch(`${API_BASE}/todo/assignees`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.assignees)) setAssignees(d.assignees);
      })
      .catch(() => {});
  }, []);

  const handleCreateTask = async () => {
    if (!newTask.title) return;
    if (isCreating) return;
    setIsCreating(true);
    try {
      const payload = {
        userId: newTask.assignee || 'system',
        title: newTask.title,
        description: newTask.desc || '手动创建的任务工单',
        type: newTask.type,
        assignee: newTask.assignee || undefined,
        aiConsideration: '人工创建待办任务',
        decisionReason: '来自待办管理系统创建',
        aiPlan: '等待负责人处理并反馈结果'
      };
      const res = await fetch(`${API_BASE}/todo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.todo?.id) {
        await loadTodos();
      }
      $createTaskOpen.set(false);
      setNewTask({ title: '', desc: '', type: 'cleaning', assignee: '' });
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

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
            异常工单
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
                setShowAcceptInDetail(false);
                setShowAbnormalInput(false);
                setAbnormalReasonText('');
                setShowReworkInput(false);
                setReworkAssignee(task.assignee || '');
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
                    <span className="line-clamp-1">{task.assignee}</span>
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition appearance-none"
                  >
                    <option value="cleaning">保洁调度</option>
                    <option value="security">安保维序</option>
                    <option value="repair">设备报修</option>
                    <option value="inspection">店长巡检</option>
                    <option value="auto_execute">自动执行</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">指派给</label>
                  <input 
                    type="text" 
                    value={newTask.assignee}
                    onChange={(e) => setNewTask({...newTask, assignee: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                    placeholder="例如：李阿姨"
                  />
                </div>
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
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedTask(null)} />
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
              <button onClick={() => setSelectedTask(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Description */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">任务描述</label>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{selectedTask.desc || '暂无描述'}</p>
              </div>

              {/* Meta Info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">负责人</div>
                  <div className="flex items-center gap-1.5 text-sm text-slate-700">
                    <User size={14} className="text-slate-400" />
                    <span>{selectedTask.assignee}</span>
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
                    {showAssigneeDropdown && assignees.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 max-h-32 overflow-y-auto">
                        {assignees
                          .filter(a => !acceptName || a.toLowerCase().includes(acceptName.toLowerCase()))
                          .map(name => (
                            <button
                              key={name}
                              onMouseDown={(e) => { e.preventDefault(); setAcceptName(name); setShowAssigneeDropdown(false); }}
                              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition flex items-center gap-2"
                            >
                              <User size={14} className="text-slate-400" />
                              {name}
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
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ assignee: acceptName.trim() })
                        });
                        if (res.ok) {
                          if (!assignees.includes(acceptName.trim())) {
                            setAssignees(prev => [...prev, acceptName.trim()]);
                          }
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
                              headers: { 'Content-Type': 'application/json' },
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
                            headers: { 'Content-Type': 'application/json' },
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
                      
                      {showAssigneeDropdown && assignees.length > 0 && (
                        <div className="absolute z-60 top-full left-0 right-0 mt-1 bg-white border border-slate-100 rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                          {assignees
                            .filter(name => !reworkAssignee || name.toLowerCase().includes(reworkAssignee.toLowerCase()))
                            .map(name => (
                              <button
                                key={name}
                                onMouseDown={(e) => { e.preventDefault(); setReworkAssignee(name); setShowAssigneeDropdown(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition flex items-center gap-2"
                              >
                                <User size={14} className="text-slate-400" />
                                {name}
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
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'in_progress', abnormalReason: '', assignee: reworkAssignee.trim() })
                            });
                            if (res.ok) {
                              if (!assignees.includes(reworkAssignee.trim())) {
                                setAssignees(prev => [...prev, reworkAssignee.trim()]);
                              }
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
                      setReworkAssignee(selectedTask.assignee || '');
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
    </div>
  );
};

export default TaskCenterView;
