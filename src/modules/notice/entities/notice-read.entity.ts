import { ObjectId } from 'mongodb';

/**
 * @description 通知已读记录实体，(noticeId, userId) 唯一，标识某个接收人已读某条通知
 * @keyword-en notice read record entity
 * @keyword-cn 通知已读记录实体
 */
export interface NoticeReadEntity {
  _id: ObjectId;
  /** 归属租户 */
  tenantId: string;
  /** 已读的通知 ID */
  noticeId: string;
  /** 已读的后台用户 ID */
  userId: string;
  /** 标记已读时间 */
  readAt: Date;
}
