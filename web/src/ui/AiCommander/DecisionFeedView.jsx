import React from 'react';
import { useStore } from '@nanostores/react';
import { 
  Zap, Clock, CheckCircle2, XCircle, Target
} from 'lucide-react';
import { $decisionCount } from './store';

/**
 * @description 决策流视图组件，展示待办决策任务卡片
 * @keyword-en DecisionFeedView
 * @returns {JSX.Element} DecisionFeedView component
 */
const DecisionFeedView = () => {
  const count = useStore($decisionCount);

  return (
    <div className="space-y-4 animate-fade-in" id="decisions-view">
      {/* 空状态 */}
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3">
          <CheckCircle2 size={24} className="text-slate-300" />
        </div>
        <p className="text-sm font-medium">暂无待办决策</p>
        <p className="text-xs text-slate-400 mt-1">AI 正在分析最新业务数据...</p>
      </div>
    </div>
  );
};

export default DecisionFeedView;
