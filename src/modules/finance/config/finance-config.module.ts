import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../../admin/admin.module.js';
import { DataSourceModule } from '../../data-source/data-source.module.js';
import { FinanceSourceModule } from '../source/finance-source.module.js';
import { FinanceTransformModule } from '../transform/finance-transform.module.js';
import { FinanceConfigAdminController } from './controller/finance-config-admin.controller.js';
import { FinanceBindingService } from './services/finance-binding.service.js';
import { FinanceTransformService } from './services/finance-transform.service.js';

/**
 * @description 财务配置模块（支出/应付 binding + transform 持久化 + 后台 CRUD + bitable 表列表）
 * @keyword-en finance config module, binding, transform persistence, admin crud, bitable tables
 */
@Module({
  imports: [
    DataSourceModule,
    forwardRef(() => AdminModule),
    FinanceSourceModule,
    FinanceTransformModule,
  ],
  controllers: [FinanceConfigAdminController],
  providers: [FinanceBindingService, FinanceTransformService],
  exports: [FinanceBindingService, FinanceTransformService],
})
export class FinanceConfigModule {}
