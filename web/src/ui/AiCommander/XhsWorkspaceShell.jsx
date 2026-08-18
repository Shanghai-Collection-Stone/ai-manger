import React from 'react';
import {
  BarChart3,
  ChevronLeft,
  Lightbulb,
  PenLine,
  Settings,
  User,
} from 'lucide-react';

/**
 * @description 为选题、发文和数据工作区提供固定不切换的顶部标题与左侧导航外壳。
 * @keyword-cn 固定工作区外壳, 统一侧边导航, 内容区域切换
 * @keyword-en fixed-workspace-shell, unified-sidebar, content-switching
 */
const XhsWorkspaceShell = ({ activeTab, onBack, onNavigate, children }) => (
  <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#fafbff] text-slate-900 animate-fade-in">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white px-5 xl:px-7">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 rounded-lg p-2 text-[#12338b] hover:bg-blue-50"
        aria-label="返回"
      >
        <ChevronLeft size={27} strokeWidth={2.4} />
      </button>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-300 via-blue-300 to-rose-300 text-white shadow-sm">
        <PenLine size={16} strokeWidth={2.2} />
      </span>
      <h1 className="text-[15px] font-bold tracking-wide text-[#10275f]">
        内容创作助手
      </h1>
    </header>

    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[112px] shrink-0 flex-col border-r border-slate-200/80 bg-white px-3 py-6 xl:w-[150px] xl:px-4 2xl:w-[196px]">
        <nav className="flex-1" aria-label="内容创作导航">
          {[
            ['chat', Lightbulb, '选题'],
            ['tasks', PenLine, '发文'],
            ['canvas', BarChart3, '数据'],
          ].map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onNavigate(value)}
              className={`relative mb-3 flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-sm font-semibold transition lg:px-4 lg:text-base ${activeTab === value ? 'bg-gradient-to-r from-rose-50 to-red-50 text-red-500' : 'text-[#153783] hover:bg-slate-50'}`}
            >
              {activeTab === value && (
                <span className="absolute -left-4 bottom-2 top-2 w-1 rounded-r-full bg-red-500" />
              )}
              <Icon size={23} strokeWidth={2} />
              <span className="hidden xl:inline">{label}</span>
            </button>
          ))}
        </nav>

        <div className="space-y-2 text-[#153783]">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold hover:bg-slate-50"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <User size={16} />
            </span>
            <span className="hidden truncate xl:inline">内容运营团队</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold hover:bg-slate-50"
          >
            <Settings size={20} />
            <span className="hidden xl:inline">设置</span>
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  </div>
);

export default XhsWorkspaceShell;
