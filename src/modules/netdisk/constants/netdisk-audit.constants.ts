/**
 * @description 网盘审计事件动作常量，命名空间格式 `netdisk.<verb>`(段含模块名 netdisk)，供审计埋点使用
 * @keyword-en netdisk audit actions
 * @keyword-cn 网盘审计动作
 */
export const NETDISK_AUDIT_ACTIONS = {
  folderCreate: 'netdisk.folderCreate',
  fileUpload: 'netdisk.fileUpload',
  nodeRename: 'netdisk.nodeRename',
  nodeDelete: 'netdisk.nodeDelete',
  rootUpdate: 'netdisk.rootUpdate',
} as const;
