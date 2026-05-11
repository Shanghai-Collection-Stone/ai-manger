import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../../admin/admin.module.js';
import { DataSourceModule } from '../../data-source/data-source.module.js';
import { FinanceConfigModule } from '../config/finance-config.module.js';
import { FinanceSourceModule } from '../source/finance-source.module.js';
import { FinanceTransformModule } from '../transform/finance-transform.module.js';
import { FinancePushAdminController } from './controller/finance-push-admin.controller.js';
import { FinanceExternalService } from './services/finance-external.service.js';
import { FinancePushConfigService } from './services/finance-push-config.service.js';
import { FinancePushRunnerService } from './services/finance-push-runner.service.js';

/**
 * @description 财务推送模块(每作用域一份 push config + 按 binding name 推送 + 外部资源透传)
 * @keyword-en finance push module, scoped config, run by name, external proxy
 */
@Module({
  imports: [
    DataSourceModule,
    forwardRef(() => AdminModule),
    FinanceConfigModule,
    FinanceSourceModule,
    FinanceTransformModule,
  ],
  controllers: [FinancePushAdminController],
  providers: [
    FinancePushConfigService,
    FinancePushRunnerService,
    FinanceExternalService,
  ],
  exports: [
    FinancePushConfigService,
    FinancePushRunnerService,
    FinanceExternalService,
  ],
})
export class FinancePushModule {}
