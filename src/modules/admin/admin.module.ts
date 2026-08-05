import { Module, forwardRef } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { SassModule } from '../sass/sass.module.js';
import { AdminAbilityFactory } from './casl/admin-ability.factory.js';
import { AdminController } from './controller/admin.controller.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from './guards/policies.guard.js';
import { AdminService } from './services/admin.service.js';

/**
 * @description 后台管理模块
 * @keyword-en admin module
 */
@Module({
  imports: [forwardRef(() => DataSourceModule), SassModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminAuthGuard,
    AdminAbilityFactory,
    AdminPoliciesGuard,
  ],
  exports: [
    AdminService,
    AdminAuthGuard,
    AdminAbilityFactory,
    AdminPoliciesGuard,
  ],
})
export class AdminModule {}
