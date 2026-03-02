import { persistentAtom } from '@nanostores/persistent';

/**
 * @description AI Commander 全局状态管理
 * @keyword-en store
 */

// 持久化当前激活的 Tab，默认为 'dashboard'
// 'ai_commander_active_tab' 是 localStorage 中的 key
export const $activeTab = persistentAtom('ai_commander_active_tab', 'dashboard');

// 决策流待办数量状态
export const $decisionCount = persistentAtom('ai_commander_decision_count', 0);
