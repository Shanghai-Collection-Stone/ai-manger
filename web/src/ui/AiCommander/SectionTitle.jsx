import React from 'react';

/**
 * @description 通用区块标题组件，支持 children slot 放置操作按钮
 * @param {string} title - 主标题
 * @param {string} [subtitle] - 副标题/描述
 * @param {React.ReactNode} [children] - 右侧 slot，放操作按钮等
 * @param {React.ReactNode} [icon] - 标题前图标
 */
const SectionTitle = ({ title, subtitle, icon, children }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2.5">
      {icon && (
        <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500 flex-shrink-0">
          {icon}
        </div>
      )}
      <div>
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">{title}</h2>
        {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {children && <div className="flex items-center gap-2">{children}</div>}
  </div>
);

export default SectionTitle;
