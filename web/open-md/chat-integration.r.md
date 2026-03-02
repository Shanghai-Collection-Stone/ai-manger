# Chat Integration and Cleanup

## 任务描述
1.  清空 `DecisionFeedView` 中的模拟数据，添加空状态。
2.  完善 `web/src/ui/AiCommander/module.md` 文档。
3.  将 AI 助理页面 (`ChatBIView`) 对接真实的 AI Chat 功能。

## 任务步骤
1.  [x] 修改 `web/src/ui/AiCommander/DecisionFeedView.jsx`：
    -   移除硬编码的决策卡片。
    -   添加 "暂无待办决策" 空状态 UI。
2.  [x] 创建 `web/src/ui/AiCommander/chatService.js`：
    -   封装 `createSession`, `streamChatPost` 等 API 调用。
3.  [x] 修改 `web/src/ui/AiCommander/ChatBIView.jsx`：
    -   引入 `chatService`。
    -   实现会话初始化、消息发送、流式响应处理。
    -   实现消息列表渲染和 Loading 状态。
4.  [x] 更新 `web/src/ui/AiCommander/module.md`：
    -   添加新组件和服务的描述。

## 进度跟踪
- [x] 初始化
- [x] 代码修改完成
- [x] 文档更新完成
