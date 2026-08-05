/**
 * @description 工作区审计事件动作常量,命名空间格式 `workspace.<verb>`(段含模块名 workspace)，供审计埋点使用
 * @keyword-en workspace audit actions
 * @keyword-cn 工作区审计动作
 */
export const WORKSPACE_AUDIT_ACTIONS = {
  create: 'workspace.create',
  update: 'workspace.update',
  delete: 'workspace.delete',
  memberAdd: 'workspace.memberAdd',
  memberUpdate: 'workspace.memberUpdate',
  memberRemove: 'workspace.memberRemove',
} as const;
