import { persistentAtom } from '@nanostores/persistent';
import { atom } from 'nanostores';

/**
 * @description AI Commander 全局状态管理
 * @keyword-en store
 */

// 持久化当前激活的 Tab，默认为 'dashboard'
// 'ai_commander_active_tab' 是 localStorage 中的 key
export const $activeTab = persistentAtom('ai_commander_active_tab', 'dashboard');

// 决策流待办数量状态
export const $decisionCount = persistentAtom('ai_commander_decision_count', 0);

// 任务中心待办数量状态 (未接单 + 进行中)
export const $taskCount = persistentAtom('ai_commander_task_count', 0);

// 任务中心: 新建派单弹窗开关
export const $createTaskOpen = atom(false);

// 当前会话ID，用于加载决策卡片
export const $currentSessionId = atom(null);

export const $decisionFocusCardId = atom(null);

export const $canvasFocusId = atom(null);

export const $decisionsRefreshKey = atom(0);

export const $tasksRefreshKey = atom(0);
