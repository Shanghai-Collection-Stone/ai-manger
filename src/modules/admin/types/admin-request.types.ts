import type { Request } from 'express';
import type { AdminUserEntity } from '../entities/admin.entity.js';

/**
 * @description 注入后台登录上下文的请求类型
 * @keyword-en admin authenticated request type
 */
export interface AdminRequest extends Request {
  adminUser?: AdminUserEntity;
  adminToken?: string;
}
