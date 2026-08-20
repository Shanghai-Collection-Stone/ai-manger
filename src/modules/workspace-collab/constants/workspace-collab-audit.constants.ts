/**
 * @description 工作区协作审计事件动作常量,命名空间格式 `<module>.<verb>`,供 Agent/会话/任务埋点使用
 * @keyword-en workspace collab audit actions
 * @keyword-cn 工作区协作审计动作
 */
export const WORKSPACE_COLLAB_AUDIT_ACTIONS = {
  agentCreate: 'workspaceAgent.create',
  agentUpdate: 'workspaceAgent.update',
  agentDelete: 'workspaceAgent.delete',
  conversationCreate: 'workspaceConversation.create',
  conversationDelete: 'workspaceConversation.delete',
  conversationMessage: 'workspaceConversation.messageSend',
  taskCreate: 'workspaceTask.create',
  taskUpdate: 'workspaceTask.update',
  taskDelete: 'workspaceTask.delete',
  taskFollowup: 'workspaceTask.followupAdd',
} as const;
