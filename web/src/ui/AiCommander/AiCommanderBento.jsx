import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { 
  LayoutDashboard, Sparkles, MessageSquare, Target, Search, ChevronRight, MapPin, History, ClipboardList
} from 'lucide-react';

import DashboardView from './DashboardView';
import DecisionFeedView from './DecisionFeedView';
import ChatBIView from './ChatBIView';
import TaskCenterView from './TaskCenterView';
import NavItem from './NavItem';
import { $activeTab, $decisionCount } from './store';

/**
 * @description AI 指挥官 Bento 风格主界面组件
 * @keyword-en AiCommanderBento
 * @returns {JSX.Element} AiCommanderBento component
 */
const AiCommanderBento = () => {
  const activeTab = useStore($activeTab);
  const decisionCount = useStore($decisionCount);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [timeRange, setTimeRange] = useState('本月');
  const [trOpen, setTrOpen] = useState(false);
  const trRef = useRef(null);
  const timeRanges = [
    '今天','明天','昨天',
    '过去7天内','未来7天内',
    '过去30天内','未来30天内',
    '本周','上周','上月','本月'
  ];

  useEffect(() => {
    const onClick = (e) => {
      if (!trRef.current) return;
      if (!trRef.current.contains(e.target)) setTrOpen(false);
    };
    if (trOpen) document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [trOpen]);

  return (
    <div className="flex flex-col min-h-screen bg-[#F7F9FC] font-sans text-slate-800">
      {/* 顶部控制台 */}
      <div className="pt-4 pb-4 px-5 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] z-10 relative">
        <div className="flex justify-between items-center mb-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            AI 指挥官
          </h1>
          
          {/* Header Actions */}
          {activeTab === 'chat' ? (
            <button 
              onClick={() => setIsChatDrawerOpen(true)}
              className="flex items-center space-x-2 bg-indigo-50 px-3 py-1.5 rounded-full cursor-pointer hover:bg-indigo-100 transition text-indigo-600 border border-indigo-100"
              title="历史会话"
            >
              <History size={16} />
              <span className="text-xs font-medium">历史会话</span>
            </button>
          ) : (
            <div className="flex items-center space-x-2">
              {activeTab === 'dashboard' ? (
                <div className="relative" ref={trRef}>
                  <button
                    onClick={() => setTrOpen((v) => !v)}
                    className="inline-flex items-center px-3 py-1.5 rounded-2xl bg-slate-900 text-white text-xs font-semibold shadow-sm"
                    title="选择时间维度"
                  >
                    <span className="mr-1">时间维度</span>
                    <span className="px-2 py-0.5 rounded-xl bg-white/10">{timeRange}</span>
                  </button>
                  {trOpen && (
                    <div className="absolute right-0 mt-2 w-44 bg-white border border-slate-100 rounded-2xl shadow-xl p-2 animate-fade-in">
                      <div className="grid grid-cols-1 gap-1">
                        {timeRanges.map((tr) => (
                          <button
                            key={tr}
                            onClick={() => {
                              setTimeRange(tr);
                              setTrOpen(false);
                            }}
                            className={`text-xs px-3 py-2 rounded-xl text-left transition ${
                              timeRange === tr
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {tr}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              <div className="bg-slate-100 p-2 rounded-full cursor-pointer hover:bg-slate-200 transition hidden">
                <Search size={18} className="text-slate-600" />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center text-sm font-medium text-slate-500 cursor-pointer">
          <MapPin size={14} className="mr-1" /> 济南集合石项目 <ChevronRight size={14} className="ml-0.5" />
        </div>
      </div>

      {/* 核心内容区 (可滚动) */}
      <div className="flex-1 overflow-y-auto pb-24 px-4 pt-4 custom-scrollbar">
        {activeTab === 'dashboard' && <DashboardView timeRange={timeRange} />}
        {activeTab === 'decisions' && <DecisionFeedView />}
        {activeTab === 'tasks' && <TaskCenterView />}
        {activeTab === 'chat' && (
          <ChatBIView 
            isDrawerOpen={isChatDrawerOpen} 
            onDrawerToggle={setIsChatDrawerOpen} 
          />
        )}
      </div>

      {/* 悬浮的 AI Chat 唤醒按钮 (如果不在Chat页面) */}
      {activeTab !== 'chat' && (
        <button 
          onClick={() => $activeTab.set('chat')}
          className="fixed bottom-24 right-5 w-14 h-14 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-[0_8px_20px_rgba(79,70,229,0.3)] flex items-center justify-center z-40 transition-transform hover:scale-105"
        >
          <Sparkles size={24} className="text-white" />
        </button>
      )}

      {/* 极简毛玻璃底部导航 */}
      <div className="fixed bottom-0 w-full h-20 bg-white/80 backdrop-blur-xl border-t border-slate-100 flex justify-around items-center px-6 pb-4 z-40">
        <NavItem icon={<LayoutDashboard size={22} />} label="看板" isActive={activeTab === 'dashboard'} onClick={() => $activeTab.set('dashboard')} />
        <NavItem 
          icon={<Target size={22} />} 
          label="决策流" 
          isActive={activeTab === 'decisions'} 
          onClick={() => $activeTab.set('decisions')} 
          badge={decisionCount > 0 ? decisionCount.toString() : null}
        />
        <NavItem icon={<ClipboardList size={22} />} label="任务" isActive={activeTab === 'tasks'} onClick={() => $activeTab.set('tasks')} />
        <NavItem icon={<MessageSquare size={22} />} label="AI助理" isActive={activeTab === 'chat'} onClick={() => $activeTab.set('chat')} />
      </div>
    </div>
  );
};

export default AiCommanderBento;
