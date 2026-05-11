import { ObjectId } from 'mongodb';

/**
 * @description 租户飞书凭证实体（appId / appSecret 一对一绑定到租户）
 * @keyword-en tenant feishu credential entity, app id, app secret
 */
export interface TenantFeishuCredentialEntity {
  _id: ObjectId;
  tenantId: string;
  appId: string;
  appSecret: string;
  remark?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 凭证创建/更新输入（tenantId 由登录态决定，不在入参中携带）
 * @keyword-en tenant feishu credential input
 */
export interface TenantFeishuCredentialInput {
  appId: string;
  appSecret: string;
  remark?: string;
}
