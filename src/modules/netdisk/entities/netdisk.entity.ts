import { ObjectId } from 'mongodb';

/**
 * @description 网盘节点类型(文件夹/文件)
 * @keyword-en disk node type
 * @keyword-cn 网盘节点类型
 */
export type DiskNodeType = 'folder' | 'file';

/**
 * @description 网盘节点实体，租户网盘的文件/文件夹树节点；workspaceId 为空表示租户级网盘，非空表示工作区内内容
 * @keyword-en disk node entity
 * @keyword-cn 网盘节点实体
 */
export interface DiskNodeEntity {
  _id: ObjectId;
  /** 归属租户 */
  tenantId: string;
  /** 归属工作区；null=租户级网盘，非 null=工作区内容 */
  workspaceId?: string | null;
  /** 父文件夹节点 ID；null=所在作用域根 */
  parentId?: string | null;
  type: DiskNodeType;
  name: string;
  /** 文件大小(字节)，文件夹为 0 */
  sizeBytes: number;
  /** 磁盘相对存储键(相对存储根)，仅文件 */
  storageKey?: string;
  /** MIME 类型，仅文件 */
  mimeType?: string;
  /** 创建者后台用户 ID */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 租户网盘根配置实体，承载租户级容量配额与已用量
 * @keyword-en disk root entity
 * @keyword-cn 网盘根配置实体
 */
export interface DiskRootEntity {
  _id: ObjectId;
  /** 归属租户(唯一) */
  tenantId: string;
  /** 租户网盘总容量(字节)，0=不限 */
  capacityBytes: number;
  /** 已用容量(字节) */
  usedBytes: number;
  createdAt: Date;
  updatedAt: Date;
}
