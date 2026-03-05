import {
  Inject,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Db, ObjectId } from 'mongodb';
import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SassTenantRequest } from '../types/sass-request.types.js';

/**
 * @description 解析Header中的API Key
 * @keyword-en parse api key header
 */
function parseApiKey(req: Request): string | null {
  const requestIdValue = req.header('x-request-id');
  if (typeof requestIdValue === 'string' && requestIdValue.trim()) {
    return requestIdValue.trim();
  }
  const directValue = req.header('x-api-key');
  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue.trim();
  }
  const authorization = req.header('authorization') ?? '';
  const [scheme, token] = authorization.split(' ');
  if ((scheme ?? '').toLowerCase() === 'apikey' && token) {
    return token.trim();
  }
  return null;
}

/**
 * @description 对API Key进行哈希
 * @keyword-en hash api key
 */
function hashApiKey(value: string): string {
  const digest = createHash('sha256').update(value).digest('base64');
  return digest.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * @description Sass租户鉴权中间件，仅用于sass模块数据路由
 * @keyword-en sass tenant auth middleware
 */
@Injectable()
export class SassTenantAuthMiddleware implements NestMiddleware {
  constructor(@Inject('DS_MONGO_DB') private readonly db: Db) {}

  /**
   * @description 执行API Key校验并注入tenantId
   * @keyword-en verify api key and inject tenant
   */
  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const apiKey = parseApiKey(req);
    if (!apiKey) {
      throw new UnauthorizedException('MISSING_API_KEY');
    }

    const keyId = hashApiKey(apiKey);

    const keyDoc = await this.db
      .collection<Record<string, unknown>>('sass_api_keys')
      .findOne({
        keyId,
        revokedAt: { $exists: false },
      });
    if (!keyDoc) {
      throw new UnauthorizedException('API_KEY_NOT_FOUND_OR_REVOKED');
    }
    const expiresAt = keyDoc['expiresAt'];
    if (expiresAt instanceof Date && expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('API_KEY_EXPIRED');
    }
    const tenantId = keyDoc['tenantId'];
    if (typeof tenantId !== 'string' || !ObjectId.isValid(tenantId)) {
      throw new UnauthorizedException('INVALID_TENANT_CONTEXT');
    }

    const sassReq = req as SassTenantRequest;
    sassReq.sassTenantId = tenantId;
    sassReq.sassKeyId = keyId;
    next();
  }
}
