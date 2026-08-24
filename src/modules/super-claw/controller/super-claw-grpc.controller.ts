import { Controller, UseGuards } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status, type ServerUnaryCall } from '@grpc/grpc-js';
import { ADMIN_SUBJECTS } from '../../admin/casl/admin-permission.constants.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type {
  SuperClawHeartbeatRequest,
  SuperClawHeartbeatResponse,
  SuperClawRegisterRequest,
  SuperClawRegisterResponse,
} from '../entities/super-claw.entity.js';
import {
  SuperClawTokenGuard,
  type AuthenticatedSuperClawCall,
} from '../guards/super-claw-token.guard.js';
import { SuperClawService } from '../services/super-claw.service.js';

/**
 * @description SuperClaw gRPC 注册和心跳控制器
 * @keyword-cn gRPC控制器, 节点接入
 * @keyword-en grpc-controller, node-onboarding
 */
@Controller()
export class SuperClawGrpcController {
  constructor(private readonly superClawService: SuperClawService) {}

  /**
   * @description 使用平台 Token 注册 SuperClaw 实例并建立连接状态
   * @keyword-cn 注册端点, 建立连接
   * @keyword-en register-endpoint, establish-connection
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'Register')
  async register(
    request: SuperClawRegisterRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ): Promise<SuperClawRegisterResponse> {
    return this.superClawService.register(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 接收已注册 SuperClaw 的连接心跳
   * @keyword-cn 心跳端点, 连接续期
   * @keyword-en heartbeat-endpoint, connection-renewal
   */
  @UseGuards(SuperClawTokenGuard)
  @RequirePermission('update', ADMIN_SUBJECTS.SuperClaw)
  @GrpcMethod('SuperClawGateway', 'Heartbeat')
  async heartbeat(
    request: SuperClawHeartbeatRequest,
    _metadata: unknown,
    call: ServerUnaryCall<unknown, unknown>,
  ): Promise<SuperClawHeartbeatResponse> {
    return this.superClawService.heartbeat(
      this.requireSuperClawId(call),
      request,
    );
  }

  /**
   * @description 从已认证 gRPC 调用读取 SuperClaw ID
   * @keyword-cn 读取节点身份, 鉴权上下文
   * @keyword-en read-node-identity, auth-context
   */
  private requireSuperClawId(call: ServerUnaryCall<unknown, unknown>): string {
    const id = (call as AuthenticatedSuperClawCall).superClawId;
    if (!id) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'INVALID_SUPER_CLAW_TOKEN',
      });
    }
    return id;
  }
}
