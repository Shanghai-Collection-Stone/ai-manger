# Demo UI Refactor

## 任务描述
将 `demo.react` 中的三个页面（DashboardView, DecisionFeedView, ChatBIView）抽离区分开，保持原有样式，不影响原 `ai-chat` 功能。

## 任务步骤
1.  [x] 创建组件目录 `web/src/ui/AiCommander`
2.  [x] 拆分组件：
    -   `AiCommanderBento.jsx`
    -   `DashboardView.jsx`
    -   `DecisionFeedView.jsx`
    -   `ChatBIView.jsx`
    -   `NavItem.jsx`
3.  [x] 添加 JSDOC 和 `module.md`
4.  [x] 创建 Astro 页面 `web/src/pages/ai-commander.astro`
5.  [x] 验证访问

## 进度跟踪
- [x] 初始化
- [x] 组件拆分完成
- [x] 模块文档创建完成
- [x] Astro 页面创建完成
