import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../../admin/admin.module.js';
import { AiAgentModule } from '../../ai-agent/ai-agent.module.js';
import { FinanceConfigModule } from '../config/finance-config.module.js';
import { FinancePushModule } from '../push/finance-push.module.js';
import { FinanceSourceModule } from '../source/finance-source.module.js';
import { FinanceTransformModule } from '../transform/finance-transform.module.js';
import { FinanceAgentAdminController } from './controller/finance-agent-admin.controller.js';
import { FinanceAgentService } from './services/finance-agent.service.js';
import { FinanceToolsService } from './services/finance-tools.service.js';

/**
 * @description 财务 Agent 模块(工具句柄 + 系统提示词 + 后台 chat;依赖 push 模块的外部资源透传 service)
 * @keyword-en finance-agent-module, external-resource-query
 */
@Module({
  imports: [
    forwardRef(() => AiAgentModule),
    forwardRef(() => AdminModule),
    FinanceConfigModule,
    FinanceSourceModule,
    FinanceTransformModule,
    FinancePushModule,
  ],
  controllers: [FinanceAgentAdminController],
  providers: [FinanceAgentService, FinanceToolsService],
  exports: [FinanceAgentService],
})
export class FinanceAgentModule {}
