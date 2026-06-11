import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { 
  LayoutDashboard, Sparkles, MessageSquare, Target, Search, ChevronRight, MapPin, History, ClipboardList, Plus, LayoutGrid
} from 'lucide-react';

import DashboardView from './DashboardView';
import DecisionFeedView from './DecisionFeedView';
import ChatBIView from './ChatBIView';
import TaskCenterView from './TaskCenterView';
import ToolsView from './ToolsView';
import CanvasFeedView from './CanvasFeedView';
import NavItem from './NavItem';
import { ToastContainer } from './blocks/shared';
import {
  $activeTab,
  $decisionCount,
  $taskCount,
  $createTaskOpen,
  $decisionFocusCardId,
  $canvasFocusId,
  $decisionsRefreshKey,
  $tasksRefreshKey,
} from './store';
import { useSwipe } from './useSwipe';
import {
  adminApi,
  getAdminToken,
  resolveLoginPageHref,
  clearAdminToken,
} from '../Admin/adminApi';

/**
 * @description AI 指挥官 Bento 风格主界面组件
 * @keyword-en ai-commander-bento
 * @keyword-en full-screen-tools
 * @returns {JSX.Element} AiCommanderBento component
 */
const AiCommanderBento = () => {
  const activeTab = useStore($activeTab);
  const decisionCount = useStore($decisionCount);
  const taskCount = useStore($taskCount);
  const canvasFocusId = useStore($canvasFocusId);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [timeRange, setTimeRange] = useState('本月');
  const [trOpen, setTrOpen] = useState(false);
  const trRef = useRef(null);
  const [slideDir, setSlideDir] = useState('none');
  const [authChecking, setAuthChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [isThoughtRouteActive, setIsThoughtRouteActive] = useState(false);
  const scrollRef = useRef(null);
  const scrollPositionsRef = useRef(new Map());
  const lastTabRef = useRef(activeTab);
  const timeRanges = [
    '今天','明天','昨天',
    '过去7天内','未来7天内',
    '过去30天内','未来30天内',
    '本周','上周','上月','本月'
  ];

  const mainTabs = ['dashboard', 'decisions', 'chat', 'tasks', 'tools'];

  /**
   * @description 解析当前前台页面标识用于登录回跳
   * @keyword-en resolve current frontend next page
   * @returns {string}
   */
  const resolveCurrentFrontendNextPage = () => {
    const path = window.location.pathname || '';
    const fileName = (path.split('/').pop() || '').trim();
    if (!fileName) return 'ai-commander';
    if (fileName.endsWith('.html')) {
      const name = fileName.slice(0, -5).trim();
      return name || 'ai-commander';
    }
    const cleaned = fileName.replace(/[^a-zA-Z0-9-_]/g, '').trim();
    return cleaned || 'ai-commander';
  };

  /**
   * @description 退出登录
   * @keyword-en logout handler
   */
  const handleLogout = async () => {
    try {
      await adminApi.logout();
    } catch {
      // ignore logout API error
    } finally {
      clearAdminToken();
      window.location.href = resolveLoginPageHref({ from: 'frontend', next: 'ai-commander' });
    }
  };

  const onSwipeLeft = () => {
    const idx = mainTabs.indexOf(activeTab);
    if (idx < mainTabs.length - 1) {
      setSlideDir('right');
      $activeTab.set(mainTabs[idx + 1]);
    }
  };

  const onSwipeRight = () => {
    const idx = mainTabs.indexOf(activeTab);
    if (idx > 0) {
      setSlideDir('left');
      $activeTab.set(mainTabs[idx - 1]);
    }
  };

  const swipeHandlers = useSwipe({ onSwipeLeft, onSwipeRight });

  useEffect(() => {
    const prevTab = lastTabRef.current;
    const scroller = scrollRef.current;
    if (scroller && prevTab && prevTab !== activeTab) {
      scrollPositionsRef.current.set(prevTab, scroller.scrollTop || 0);
    }
    // 看板 tab 始终回到顶部，避免 tabs 导航栏被滚出视野
    const nextTop = activeTab === 'dashboard' ? 0 : (scrollPositionsRef.current.get(activeTab) ?? 0);
    if (scroller) {
      requestAnimationFrame(() => {
        scroller.scrollTop = nextTop;
      });
    }
    if (prevTab !== activeTab) {
      if (activeTab === 'decisions') {
        $decisionsRefreshKey.set($decisionsRefreshKey.get() + 1);
      }
      if (activeTab === 'tasks') {
        $tasksRefreshKey.set($tasksRefreshKey.get() + 1);
      }
    }
    lastTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const onClick = (e) => {
      if (!trRef.current) return;
      if (!trRef.current.contains(e.target)) setTrOpen(false);
    };
    if (trOpen) document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [trOpen]);

  /**
   * @description AI 指挥官页面登录鉴权
   * @keyword-en ai commander auth guard
   * @returns {Promise<void>}
   */
  const ensureAuthorized = async () => {
    const token = getAdminToken();
    const nextPage = resolveCurrentFrontendNextPage();
    if (!token) {
      window.location.href = resolveLoginPageHref({
        from: 'frontend',
        next: nextPage,
      });
      return;
    }
    try {
      const user = await adminApi.me();
      setCurrentUser(user);
      setAuthChecking(false);
    } catch {
      window.location.href = resolveLoginPageHref({
        from: 'frontend',
        next: nextPage,
      });
    }
  };

  useEffect(() => {
    void ensureAuthorized();
  }, []);

  useEffect(() => {
    const applyHashRoute = () => {
      const hash = window.location.hash || '';
      const c = hash.match(/^#canvas-(\d+)$/);
      if (c) {
        const canvasId = Number(c[1]);
        if (Number.isFinite(canvasId)) {
          $activeTab.set('tools');
          $canvasFocusId.set(canvasId);
        }
        return;
      }
      const m = hash.match(/^#decision-card-(.+)$/);
      if (!m) return;
      const cardId = decodeURIComponent(m[1] || '').trim();
      if (!cardId) return;
      $activeTab.set('decisions');
      $decisionFocusCardId.set(cardId);
    };
    applyHashRoute();
    window.addEventListener('hashchange', applyHashRoute);
    return () => window.removeEventListener('hashchange', applyHashRoute);
  }, []);

  if (authChecking) {
    return (
      <div className="h-[100dvh] flex items-center justify-center text-slate-500 bg-slate-50">
        登录校验中...
      </div>
    );
  }

  return (
    <ToastContainer>
      <div className="flex flex-col h-[100dvh] bg-[#F7F9FC] font-sans text-slate-800 overflow-hidden">
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right { animation: slideInRight 0.3s ease-out forwards; }
        .animate-slide-in-left { animation: slideInLeft 0.3s ease-out forwards; }
      `}</style>
      {/* 顶部控制台 */}
      {!(activeTab === 'tools' && isThoughtRouteActive) && (
      <div className="pt-4 pb-3 px-5 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] z-10 relative shrink-0">
        <div className="flex justify-between items-center mb-1">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {activeTab === 'dashboard' && 'AI 指挥官'}
              {activeTab === 'tasks' && '待办管理'}
              {activeTab === 'decisions' && '待办决策'}
              {activeTab === 'chat' && 'AI 指挥官'}
              {activeTab === 'tools' && '效能工具'}
            </h1>
            {activeTab === 'tasks' && (
              <p className="text-[11px] text-slate-400 mt-0.5">对接现有工单系统</p>
            )}
            {activeTab === 'decisions' && (
              <p className="text-[11px] text-slate-400 mt-0.5">AI 驱动的智能决策推荐</p>
            )}
            {activeTab === 'tools' && (
              <p className="text-[11px] text-slate-400 mt-0.5">AI 驱动的生产力工具集</p>
            )}
          </div>
          
          {/* Header Actions */}
          <div className="flex items-center space-x-2">
            {activeTab === 'chat' && (
              <button
                onClick={() => setIsChatDrawerOpen(true)}
                className="flex items-center space-x-2 bg-indigo-50 px-3 py-1.5 rounded-full cursor-pointer hover:bg-indigo-100 transition text-indigo-600 border border-indigo-100"
                title="历史会话"
              >
                <History size={16} />
                <span className="text-xs font-medium">历史会话</span>
              </button>
            )}
            {activeTab === 'tasks' && (
              <button
                onClick={() => $createTaskOpen.set(true)}
                className="flex items-center space-x-1 bg-slate-900 text-white px-3 py-1.5 rounded-full text-xs font-medium shadow-lg shadow-slate-200 hover:bg-slate-800 transition"
              >
                <Plus size={14} />
                <span>新建派单</span>
              </button>
            )}
            {activeTab === 'decisions' && (
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{decisionCount} 项</span>
            )}
            {activeTab === 'dashboard' && (
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
                  <div className="absolute right-0 mt-2 w-44 bg-white border border-slate-100 rounded-2xl shadow-xl p-2 animate-fade-in z-50">
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
            )}
            {/* 退出登录 - 所有标签页都显示 */}
            <button
              onClick={handleLogout}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-full text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition"
              title="退出登录"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              <span>退出</span>
            </button>
          </div>
        </div>
        <div className="flex items-center text-sm font-medium text-slate-500 cursor-pointer">
          <MapPin size={14} className="mr-1" /> {currentUser?.tenantName || '上海集合石'} <ChevronRight size={14} className="ml-0.5" />
        </div>
      </div>
      )}

      {/* 核心内容区 (可滚动) */}
      <div 
        ref={scrollRef}
        className={`flex-1 overflow-y-auto ${(activeTab === 'tools' && isThoughtRouteActive) ? 'pb-0 px-0 pt-0' : 'pb-[calc(5rem+env(safe-area-inset-bottom))] px-4'} custom-scrollbar ${
          slideDir === 'right' ? 'animate-slide-in-right' : 
          slideDir === 'left' ? 'animate-slide-in-left' : ''
        }`}
        {...swipeHandlers}
      >
        <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none', height: '100%' }}>
          <DashboardView timeRange={timeRange} />
        </div>
        <div style={{ display: activeTab === 'decisions' ? 'block' : 'none', height: '100%' }}>
          <DecisionFeedView />
        </div>
        <div style={{ display: activeTab === 'tasks' ? 'block' : 'none', height: '100%' }}>
          <TaskCenterView currentUser={currentUser} />
        </div>
        <div style={{ display: activeTab === 'tools' ? 'block' : 'none', height: '100%' }}>
          <ToolsView onThoughtRouteChange={setIsThoughtRouteActive} />
        </div>
        <div style={{ display: activeTab === 'chat' ? 'block' : 'none', height: '100%' }}>
          <ChatBIView 
            isDrawerOpen={isChatDrawerOpen} 
            onDrawerToggle={setIsChatDrawerOpen} 
          />
        </div>
      </div>

      {/* 极简毛玻璃底部导航 */}
      {!(activeTab === 'tools' && isThoughtRouteActive) && (
      <div className="fixed bottom-0 w-full h-[calc(5rem+env(safe-area-inset-bottom))] bg-white/80 backdrop-blur-xl border-t border-slate-100 flex items-center px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] z-40">
        <div className="flex-1 flex justify-around">
          <NavItem icon={<LayoutDashboard size={22} />} label="看板" isActive={activeTab === 'dashboard'} onClick={() => $activeTab.set('dashboard')} />
          <NavItem 
            icon={<Target size={22} />} 
            label="决策流" 
            isActive={activeTab === 'decisions'} 
            onClick={() => $activeTab.set('decisions')} 
            badge={decisionCount > 0 ? decisionCount.toString() : null}
          />
        </div>

        <div className="flex flex-col items-center -mt-2">
          <button
            onClick={() => $activeTab.set('chat')}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 ${
              activeTab === 'chat'
              ? 'bg-slate-900 text-white shadow-slate-400/50'
              : 'bg-white text-slate-900 border border-slate-100 shadow-slate-200/50'
            }`}
          >
            <Sparkles size={22} />
          </button>
          <div className={`text-[10px] text-center font-bold mt-0.5 ${activeTab === 'chat' ? 'text-slate-900' : 'text-slate-500 font-medium'}`}>AI 指挥官</div>
        </div>

        <div className="flex-1 flex justify-around">
          <NavItem 
            icon={<ClipboardList size={22} />} 
            label="任务" 
            isActive={activeTab === 'tasks'} 
            onClick={() => $activeTab.set('tasks')} 
            badge={taskCount > 0 ? taskCount.toString() : null}
          />
          <NavItem icon={<LayoutGrid size={22} />} label="工具" isActive={activeTab === 'tools'} onClick={() => $activeTab.set('tools')} />
        </div>
      </div>
      )}
      {canvasFocusId ? (
        <div className="fixed inset-0 z-50 bg-white flex flex-col h-[100dvh]">
          <CanvasFeedView
            canvasId={canvasFocusId}
            onClose={() => {
              $canvasFocusId.set(null);
              if ((window.location.hash || '').startsWith('#canvas-')) {
                history.replaceState(null, '', window.location.pathname + window.location.search);
              }
            }}
          />
        </div>
      ) : null}
      </div>
    </ToastContainer>
  );
};

export default AiCommanderBento;
