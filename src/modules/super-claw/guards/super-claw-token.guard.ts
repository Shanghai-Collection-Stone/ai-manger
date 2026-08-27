import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import {
  status,
  type ServerDuplexStream,
  type ServerUnaryCall,
} from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { SuperClawService } from '../services/super-claw.service.js';

/**
 * @description 注入已认证 SuperClaw ID 的 gRPC 调用上下文
 * @keyword-cn 认证调用上下文, 节点标识
 * @keyword-en authenticated-call-context, node-id
 */
export type AuthenticatedSuperClawCall = (
  ServerUnaryCall<unknown, unknown> | ServerDuplexStream<unknown, unknown>
) & { superClawId?: string };

/**
 * @description 校验 gRPC metadata 中的平台 SuperClaw Token
 * @keyword-cn 令牌守卫, 元数据鉴权
 * @keyword-en token-guard, metadata-authentication
 */
@Injectable()
export class SuperClawTokenGuard implements CanActivate {
  constructor(private readonly superClawService: SuperClawService) {}

  /**
   * @description 读取 Authorization 或 x-super-claw-token 并注入节点身份
   * @keyword-cn 校验调用, 注入身份
   * @keyword-en authorize-call, inject-identity
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const unaryCall = context.getArgByIndex<AuthenticatedSuperClawCall>(2);
    const streamCall = context.getArgByIndex<AuthenticatedSuperClawCall>(0);
    const call = unaryCall?.metadata ? unaryCall : streamCall;
    if (!call?.metadata) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'INVALID_SUPER_CLAW_TOKEN',
      });
    }
    const authorization = String(call.metadata.get('authorization')[0] ?? '');
    const dedicated = String(call.metadata.get('x-super-claw-token')[0] ?? '');
    const token = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : dedicated.trim();
    const superClawId = await this.superClawService.authenticateToken(token);
    if (!superClawId) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'INVALID_SUPER_CLAW_TOKEN',
      });
    }
    call.superClawId = superClawId;
    return true;
  }
}
