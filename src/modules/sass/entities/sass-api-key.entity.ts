import { ObjectId } from 'mongodb';

/**
 * @description API Key实体，记录租户访问密钥元信息
 * @keyword-en sass api key entity
 */
export interface SassApiKeyEntity {
  _id: ObjectId;
  tenantId: string;
  name: string;
  keyId: string;
  tokenPreview: string;
  expiresAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 创建API Key输入
 * @keyword-en sass api key create input
 */
export interface SassApiKeyCreateInput {
  tenantId: string;
  name: string;
  expireDays?: number;
}
