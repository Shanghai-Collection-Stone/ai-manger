import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { DouyinPublishLibraryEntity } from '../entities/douyin-publish.entity.js';
import { DouyinPublishLibraryService } from '../services/douyin-publish-library.service.js';

/**
 * @description 标记抖音发布小程序入口的动作与权限主体。
 * @keyword-cn 扫码入口权限, 权限主体声明
 * @keyword-en qr-entry-permission, permission-subject-declaration
 */
export const DOUYIN_PUBLISH_ACCESS_METADATA = 'douyin-publish:access';

/**
 * @description 小程序扫码入口的同址权限声明。
 * @keyword-cn 扫码入口权限, 权限主体声明
 * @keyword-en qr-entry-permission, permission-subject-declaration
 */
export interface DouyinPublishAccessDeclaration {
  action: 'read' | 'update';
  subject: 'DouyinWorkbench';
}

/**
 * @description 已由扫码令牌 Guard 写入发布库上下文的请求。
 * @keyword-cn 扫码请求上下文, 发布库上下文
 * @keyword-en qr-request-context, publish-library-context
 */
export interface DouyinPublishTaskRequest extends Request {
  douyinPublishLibrary: DouyinPublishLibraryEntity;
}

/**
 * @description 校验小程序入口的同址权限声明、Bearer 扫码令牌与可选租户头，并把发布库写入请求上下文。
 * @keyword-cn 扫码令牌鉴权, 同址权限声明
 * @keyword-en qr-token-guard, colocated-permission-declaration
 */
@Injectable()
export class DouyinPublishTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly libraries: DouyinPublishLibraryService,
  ) {}

  /**
   * @description 在路由执行前校验 DouyinWorkbench 权限主体与扫码令牌。
   * @keyword-cn 校验扫码入口, 权限主体校验
   * @keyword-en validate-qr-entry, permission-subject-check
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const declaration = this.reflector.get<DouyinPublishAccessDeclaration>(
      DOUYIN_PUBLISH_ACCESS_METADATA,
      context.getHandler(),
    );
    if (!declaration || declaration.subject !== 'DouyinWorkbench') {
      throw new ForbiddenException(
        'DOUYIN_PUBLISH_ACCESS_DECLARATION_REQUIRED',
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<DouyinPublishTaskRequest>();
    const authorization = String(request.headers.authorization ?? '');
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token)
      throw new UnauthorizedException('DOUYIN_PUBLISH_TOKEN_REQUIRED');

    const library = await this.libraries.findByToken(token);
    if (!library)
      throw new UnauthorizedException('DOUYIN_PUBLISH_TOKEN_INVALID');

    const header = request.headers['x-tenant-id'];
    const tenantId = Array.isArray(header) ? header[0] : header;
    if (
      tenantId !== undefined &&
      String(tenantId).trim() !== String(library.tenantId ?? '')
    ) {
      throw new ForbiddenException('DOUYIN_PUBLISH_TENANT_MISMATCH');
    }

    request.douyinPublishLibrary = library;
    return true;
  }
}

/**
 * @description 在小程序路由注册处同时声明动作、DouyinWorkbench 权限主体和扫码令牌 Guard。
 * @keyword-cn 扫码权限装饰器, 同址权限声明
 * @keyword-en qr-access-decorator, colocated-permission-declaration
 */
export function RequireDouyinPublishTokenAccess(
  action: DouyinPublishAccessDeclaration['action'],
  subject: DouyinPublishAccessDeclaration['subject'],
): MethodDecorator {
  return applyDecorators(
    SetMetadata(DOUYIN_PUBLISH_ACCESS_METADATA, { action, subject }),
    UseGuards(DouyinPublishTokenGuard),
  );
}
