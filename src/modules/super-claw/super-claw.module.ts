import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { ChatMainModule } from '../chat-main/chat-main.module.js';
import { ContextModule } from '../context/context.module.js';
import { TodoModule } from '../todo/todo.module.js';
import { BrowserAuthModule } from '../browser-auth/browser-auth.module.js';
import { SuperClawAdminController } from './controller/super-claw-admin.controller.js';
import { SuperClawGrpcController } from './controller/super-claw-grpc.controller.js';
import { SuperClawTokenGuard } from './guards/super-claw-token.guard.js';
import { SuperClawService } from './services/super-claw.service.js';
import { SuperClawGatewayService } from './services/super-claw-gateway.service.js';
import { SuperClawTaskChannelService } from './services/super-claw-task-channel.service.js';

/**
 * @description SuperClaw 平台节点接入与容量分配模块
 * @keyword-cn 节点模块, 平台接入
 * @keyword-en node-module, platform-onboarding
 */
@Module({
  imports: [
    forwardRef(() => DataSourceModule),
    AdminModule,
    ContextModule,
    ChatMainModule,
    TodoModule,
    BrowserAuthModule,
  ],
  controllers: [SuperClawAdminController, SuperClawGrpcController],
  providers: [
    SuperClawService,
    SuperClawGatewayService,
    SuperClawTaskChannelService,
    SuperClawTokenGuard,
    {
      provide: 'SuperClawTaskChannelService',
      useExisting: SuperClawTaskChannelService,
    },
  ],
  exports: [SuperClawService, SuperClawTaskChannelService],
})
export class SuperClawModule {}
