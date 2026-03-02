import React, { useEffect, useState } from 'react';
import { 
  Brush, Shield, Wrench, Megaphone, Plus, Clock, User, X, ClipboardList
} from 'lucide-react';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

/**
 * @description 任务中心视图组件，展示执行指挥中心任务流
 * @keyword-en TaskCenterView
 * @returns {JSX.Element} TaskCenterView component
 */
const TaskCenterView = () => {
  const [activeTab, setActiveTab] = useState('inprogress');
  const [activeCategory, setActiveCategory] = useState('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  
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

  const quickActions = [
    { id: 'all', icon: <ClipboardList size={16} className="text-slate-600" />, label: '全部' },
    { id: 'cleaning', icon: <Brush size={16} className="text-orange-500" />, label: '保洁' },
    { id: 'security', icon: <Shield size={16} className="text-blue-500" />, label: '安保' },
    { id: 'repair', icon: <Wrench size={16} className="text-slate-600" />, label: '报修' },
    { id: 'inspection', icon: <Megaphone size={16} className="text-red-500" />, label: '巡检' },
  ];

  const typeLabelMap = {
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

  const inProgressCount = tasks.filter(t => t.status === 'inprogress').length;
  const pendingCount = tasks.filter(t => t.status === 'pending').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;

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
        const textSource = `${todo.title || ''}${todo.description || ''}`;
        const type = textSource.includes('保洁')
          ? 'cleaning'
          : textSource.includes('安保')
            ? 'security'
            : textSource.includes('维修') || textSource.includes('报修')
              ? 'repair'
              : textSource.includes('巡检')
                ? 'inspection'
                : 'inspection';
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
          assignee: todo.userId || '待分配',
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
  }, []);

  const handleCreateTask = async () => {
    if (!newTask.title || !newTask.assignee) return;
    if (isCreating) return;
    setIsCreating(true);
    try {
      const payload = {
        userId: newTask.assignee,
        title: newTask.title,
        description: newTask.desc || '手动创建的任务工单',
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
      setIsCreateModalOpen(false);
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
    <div className="space-y-6 animate-fade-in pb-24 relative" id="task-center-view">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">待办管理</h2>
          <p className="text-xs text-slate-400 mt-1">对接现有工单系统</p>
        </div>
        <button 
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center space-x-1 bg-slate-900 text-white px-3 py-1.5 rounded-full text-xs font-medium shadow-lg shadow-slate-200 hover:bg-slate-800 transition"
        >
          <Plus size={14} />
          <span>新建派单</span>
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <div className="text-xs text-slate-500">待接单</div>
          <div className="text-lg font-bold text-slate-900 mt-1">{pendingCount}</div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <div className="text-xs text-slate-500">进行中</div>
          <div className="text-lg font-bold text-slate-900 mt-1">{inProgressCount}</div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <div className="text-xs text-slate-500">已完成</div>
          <div className="text-lg font-bold text-slate-900 mt-1">{completedCount}</div>
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
            <div key={task.id} className="bg-white rounded-xl px-4 py-3 border border-slate-100 hover:border-slate-200 transition">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${task.status === 'inprogress' ? 'bg-blue-500' : task.status === 'pending' ? 'bg-orange-500' : 'bg-slate-300'}`} />
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

                <div className="flex flex-col items-end gap-2 min-w-[92px]">
                  <div className="flex items-center gap-1 text-[11px] text-slate-600">
                    <User size={12} className="text-slate-400" />
                    <span className="line-clamp-1">{task.assignee}</span>
                  </div>
                  {(task.status === 'inprogress' || task.status === 'pending') ? (
                    <div className="text-[11px] text-slate-400">
                      {task.status === 'inprogress' ? (
                        <span className="flex items-center">
                          <Clock size={12} className="mr-1" />
                          {task.eta}
                        </span>
                      ) : (
                        <button className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs px-2.5 py-1 rounded-full font-medium transition">
                          {task.actionText || '查看'}
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Task Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsCreateModalOpen(false)} />
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl relative z-10 animate-fade-in-up overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-bold text-slate-800">新建派单</h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition">
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
    </div>
  );
};

export default TaskCenterView;
