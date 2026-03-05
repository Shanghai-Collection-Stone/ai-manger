import type { Request } from 'express';

/**
 * @description Sass请求上下文，承载中间件注入的tenantId与keyId
 * @keyword-en sass request context
 */
export type SassTenantRequest = Request & {
  sassTenantId?: string;
  sassKeyId?: string;
};
