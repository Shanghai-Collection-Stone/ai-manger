import { Module } from '@nestjs/common';
import { FinanceAgentModule } from './agent/finance-agent.module.js';
import { FinanceConfigModule } from './config/finance-config.module.js';
import { FinancePushModule } from './push/finance-push.module.js';
import { FinanceSourceModule } from './source/finance-source.module.js';
import { FinanceTransformModule } from './transform/finance-transform.module.js';

/**
 * @description 财务领域聚合模块（source / transform / config / agent / push 五个子模块）
 * @keyword-en finance domain module, aggregator
 */
@Module({
  imports: [
    FinanceSourceModule,
    FinanceTransformModule,
    FinanceConfigModule,
    FinanceAgentModule,
    FinancePushModule,
  ],
  exports: [
    FinanceSourceModule,
    FinanceTransformModule,
    FinanceConfigModule,
    FinanceAgentModule,
    FinancePushModule,
  ],
})
export class FinanceModule {}
