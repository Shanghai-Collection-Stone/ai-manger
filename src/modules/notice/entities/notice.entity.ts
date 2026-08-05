import { ObjectId } from 'mongodb';

/**
 * @description 通知生命周期状态
 * @keyword-en notice status
 * @keyword-cn 通知状态
 */
export type NoticeStatus = 'draft' | 'published' | 'revoked';

/**
 * @description 通知实体，后台发起的站内通知(租户隔离)，可按用户定向或面向租户全体
 * @keyword-en notice entity
 * @keyword-cn 通知实体
 */
export interface NoticeEntity {
  _id: ObjectId;
  /** 归属租户 */
  tenantId: string;
  /** 通知标题 */
  title: string;
  /** 通知正文 */
  content: string;
  /** 通知类型(自由分类，如 system/announcement) */
  type?: string;
  /** 状态:草稿/已发布/已撤销 */
  status: NoticeStatus;
  /** 定向接收人后台用户 ID 列表；空数组 = 租户全体 */
  recipients: string[];
  /** 创建者后台用户 ID */
  createdBy: string;
  /** 发布/发起时间 */
  publishedAt?: Date;
  /** 撤销时间 */
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
