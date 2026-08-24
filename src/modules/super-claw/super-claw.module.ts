import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { SuperClawAdminController } from './controller/super-claw-admin.controller.js';
import { SuperClawGrpcController } from './controller/super-claw-grpc.controller.js';
import { SuperClawTokenGuard } from './guards/super-claw-token.guard.js';
import { SuperClawService } from './services/super-claw.service.js';

/**
 * @description SuperClaw 平台节点接入与容量分配模块
 * @keyword-cn 节点模块, 平台接入
 * @keyword-en node-module, platform-onboarding
 */
@Module({
  imports: [forwardRef(() => DataSourceModule), AdminModule],
  controllers: [SuperClawAdminController, SuperClawGrpcController],
  providers: [SuperClawService, SuperClawTokenGuard],
  exports: [SuperClawService],
})
export class SuperClawModule {}
