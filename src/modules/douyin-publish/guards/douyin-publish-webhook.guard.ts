import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  RawBodyRequest,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import {
  DOUYIN_PUBLISH_ACCESS_METADATA,
  type DouyinPublishAccessDeclaration,
} from './douyin-publish-token.guard.js';

/** 校验平台原始请求体签名与 AppID；challenge 只允许无副作用的地址验证。
 * @keyword-cn 回调验签, 同址权限声明
 * @keyword-en webhook-signature, colocated-permission-declaration
 */
@Injectable()
export class DouyinPublishWebhookGuard implements CanActivate {
  /** 注入签名秘钥及入口权限声明读取器。
   * @keyword-cn 回调验签, 同址权限声明
   * @keyword-en webhook-signature, colocated-permission-declaration
   */
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  /** 只接受配置应用的签名消息；不将 JSON 再序列化作为验签输入。
   * @keyword-cn 回调验签, 原始请求体
   * @keyword-en webhook-signature, raw-body
   */
  canActivate(context: ExecutionContext): boolean {
    const declaration = this.reflector.get<DouyinPublishAccessDeclaration>(
      DOUYIN_PUBLISH_ACCESS_METADATA,
      context.getHandler(),
    );
    if (
      declaration?.subject !== 'DouyinWorkbench' ||
      declaration.action !== 'update'
    )
      throw new ForbiddenException('DOUYIN_WEBHOOK_PERMISSION_REQUIRED');
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const appId = String(this.config.get('DOUYIN_MINIAPP_APP_ID') ?? '').trim();
    const secret = String(
      this.config.get('DOUYIN_PUBLISH_WEBHOOK_SECRET') ?? '',
    ).trim();
    if (!appId || !secret)
      throw new ServiceUnavailableException(
        'DOUYIN_PUBLISH_WEBHOOK_NOT_CONFIGURED',
      );
    const body = request.body as Record<string, unknown> | undefined;
    if (
      !body ||
      (body.client_key !== appId &&
        !(body.event === 'verify_webhook' && body.client_key === ''))
    )
      throw new UnauthorizedException('DOUYIN_WEBHOOK_APP_MISMATCH');
    const signature = String(request.headers['x-douyin-signature'] ?? '');
    // 平台首次地址校验可能不携带签名；该分支只回显 challenge，不接收业务事件。
    if (body.event === 'verify_webhook' && !signature) return true;
    if (!request.rawBody || !/^[a-f\d]{40}$/i.test(signature))
      throw new UnauthorizedException('DOUYIN_WEBHOOK_SIGNATURE_INVALID');
    const expected = createHash('sha1')
      .update(secret)
      .update(request.rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new UnauthorizedException('DOUYIN_WEBHOOK_SIGNATURE_INVALID');
    return true;
  }
}

/** 在平台回调路由同址声明真实权限根主体及平台签名鉴权。
 * @keyword-cn 回调验签, 同址权限声明
 * @keyword-en webhook-signature, colocated-permission-declaration
 */
export function RequireDouyinPublishWebhookAccess(
  action: 'update',
  subject: 'DouyinWorkbench',
): MethodDecorator {
  return applyDecorators(
    SetMetadata(DOUYIN_PUBLISH_ACCESS_METADATA, { action, subject }),
    UseGuards(DouyinPublishWebhookGuard),
  );
}
