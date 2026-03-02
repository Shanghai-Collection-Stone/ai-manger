import React from 'react';

/**
 * @description 底部导航按钮组件
 * @keyword-en NavItem
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.icon - Icon component
 * @param {string} props.label - Label text
 * @param {boolean} props.isActive - Whether the item is active
 * @param {Function} props.onClick - Click handler
 * @param {string|number} [props.badge] - Badge content
 * @returns {JSX.Element} NavItem component
 */
const NavItem = ({ icon, label, isActive, onClick, badge }) => (
  <button 
    id={label === '决策流' ? 'tab-decisions' : ''}
    onClick={onClick}
    className={`flex flex-col items-center justify-center w-16 relative transition-colors duration-300 ${isActive ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
  >
    <div className={`mb-1 transition-transform duration-300 ${isActive ? 'scale-110' : ''}`}>
      {icon}
    </div>
    <span className={`text-[10px] font-bold ${isActive ? 'text-slate-900' : 'font-medium'}`}>{label}</span>
    
    {badge && (
      <div className="absolute top-[-4px] right-2 bg-orange-500 text-white text-[9px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center font-bold shadow-sm ring-2 ring-white">
        {badge}
      </div>
    )}
  </button>
);

export default NavItem;
