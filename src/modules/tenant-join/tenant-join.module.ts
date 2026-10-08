import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { SassModule } from '../sass/sass.module.js';
import { TenantJoinController } from './controller/tenant-join.controller.js';
import { TenantJoinApplicationService } from './services/tenant-join-application.service.js';
import { TenantJoinNotifyService } from './services/tenant-join-notify.service.js';
import { TenantInviteService } from './services/tenant-invite.service.js';

/**
 * @description 租户入驻模块，提供申请审批、邀请链接与带租户目标的注册
 * @keyword-cn 租户入驻模块, 邀请入驻
 * @keyword-en tenant-join-module, invite-onboarding
 */
@Module({
  imports: [AdminModule, DataSourceModule, SassModule],
  controllers: [TenantJoinController],
  providers: [
    TenantJoinApplicationService,
    TenantInviteService,
    TenantJoinNotifyService,
  ],
  exports: [TenantJoinApplicationService, TenantInviteService],
})
export class TenantJoinModule {}
