import { ObjectId } from 'mongodb';

/**
 * @description 工作区内成员角色(工作区维度，独立于后台全局角色)
 * @keyword-en workspace member role
 * @keyword-cn 工作区成员角色
 */
export type WorkspaceMemberRole = 'owner' | 'editor' | 'viewer';

/**
 * @description 工作区实体，隶属租户并作为 SuperClaw 子资源，含独立网盘容量
 * @keyword-en workspace-entity, super-claw-child
 * @keyword-cn 工作区实体, 节点子资源
 */
export interface WorkspaceEntity {
  _id: ObjectId;
  /** 归属租户 */
  tenantId: string;
  /** 承载该工作区的平台 SuperClaw 节点 ID */
  superClawId: string;
  /** 工作区名称(租户内唯一) */
  name: string;
  /** 工作区描述 */
  description?: string;
  /** 容量设定(字节)，0 表示不限 */
  capacityBytes: number;
  /** 已用容量(字节)，由网盘上传/删除维护 */
  usedBytes: number;
  /** 创建者后台用户 ID */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 工作区成员实体,绑定后台用户与工作区角色
 * @keyword-en workspace member entity
 * @keyword-cn 工作区成员实体
 */
export interface WorkspaceMemberEntity {
  _id: ObjectId;
  workspaceId: string;
  tenantId: string;
  /** 后台用户 ID(admin_users._id) */
  userId: string;
  /** 冗余用户名，便于列表展示 */
  username: string;
  role: WorkspaceMemberRole;
  /** 添加者后台用户 ID */
  addedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
