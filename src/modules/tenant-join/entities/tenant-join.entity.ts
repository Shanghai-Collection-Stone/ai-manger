import type { ObjectId } from 'mongodb';

/**
 * @description 租户入驻申请状态
 * @keyword-cn 入驻申请状态
 * @keyword-en join-application-status
 */
export type TenantJoinApplicationStatus = 'pending' | 'approved' | 'rejected';

/**
 * @description 邮件通知结果状态
 * @keyword-cn 邮件通知状态
 * @keyword-en join-notify-status
 */
export type TenantJoinNotifyStatus = 'sent' | 'failed' | 'skipped';

/**
 * @description 租户入驻申请文档
 * @keyword-cn 入驻申请实体
 * @keyword-en join-application-entity
 */
export interface TenantJoinApplicationEntity {
  _id: ObjectId;
  accountId: string;
  phone: string;
  email: string;
  displayName: string;
  tenantId: string;
  tenantName: string;
  message?: string;
  status: TenantJoinApplicationStatus;
  reviewerId?: string;
  reviewerName?: string;
  reviewedAt?: Date;
  rejectReason?: string;
  memberUserId?: string;
  notifyStatus?: TenantJoinNotifyStatus;
  notifyError?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 租户邀请文档
 * @keyword-cn 租户邀请实体
 * @keyword-en tenant-invite-entity
 */
export interface TenantInviteEntity {
  _id: ObjectId;
  code: string;
  tenantId: string;
  tenantName: string;
  createdBy: string;
  createdByName: string;
  expiresAt: Date;
  revokedAt?: Date;
  useCount: number;
  lastUsedAt?: Date;
  createdAt: Date;
}

/**
 * @description 对外入驻申请视图
 * @keyword-cn 入驻申请视图
 * @keyword-en join-application-view
 */
export interface ApplicationView {
  id: string;
  tenantId: string;
  tenantName: string;
  phone: string;
  email: string;
  displayName: string;
  message: string | null;
  status: TenantJoinApplicationStatus;
  rejectReason: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  notifyStatus: TenantJoinNotifyStatus | null;
  notifyError: string | null;
  createdAt: string;
}

/**
 * @description 对外租户邀请视图
 * @keyword-cn 租户邀请视图
 * @keyword-en tenant-invite-view
 */
export interface InviteView {
  id: string;
  code: string;
  tenantId: string;
  tenantName: string;
  expiresAt: string;
  revokedAt: string | null;
  useCount: number;
  lastUsedAt: string | null;
  createdByName: string;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked';
}

/**
 * @description 邮件通知服务返回值
 * @keyword-cn 邮件通知结果
 * @keyword-en join-notify-result
 */
export interface JoinNotifyResult {
  status: TenantJoinNotifyStatus;
  error?: string;
}
