import { ObjectId } from 'mongodb';

/**
 * @description 后台用户角色
 * @keyword-en admin user role
 */
export type AdminUserRole = 'super_admin' | 'tenant_admin' | 'operator';

/**
 * @description 后台用户实体
 * @keyword-en admin user entity
 */
export interface AdminUserEntity {
  _id: ObjectId;
  username: string;
  passwordHash: string;
  displayName: string;
  role: AdminUserRole;
  tenantId?: string;
  enabled: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description 登录会话实体
 * @keyword-en admin session entity
 */
export interface AdminSessionEntity {
  _id: ObjectId;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @description AI提供商配置实体
 * @keyword-en ai provider settings entity
 */
export interface AdminAiProviderEntity {
  _id: ObjectId;
  providerCode: string;
  name: string;
  baseUrl?: string;
  model?: string;
  apiKey: string;
  enabled: boolean;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}
