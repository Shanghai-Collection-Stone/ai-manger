import { Module } from '@nestjs/common';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { SassModule } from '../sass/sass.module.js';
import { AdminController } from './controller/admin.controller.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminService } from './services/admin.service.js';

/**
 * @description 后台管理模块
 * @keyword-en admin module
 */
@Module({
  imports: [DataSourceModule, SassModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthGuard],
  exports: [AdminService, AdminAuthGuard],
})
export class AdminModule {}
