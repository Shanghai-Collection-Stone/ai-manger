/**
 * @description 通知审计事件动作常量，命名空间格式 `notice.<verb>`(段含模块名 notice)，供审计埋点使用
 * @keyword-en notice audit actions
 * @keyword-cn 通知审计动作
 */
export const NOTICE_AUDIT_ACTIONS = {
  create: 'notice.create',
  update: 'notice.update',
  delete: 'notice.delete',
  publish: 'notice.publish',
  revoke: 'notice.revoke',
} as const;
