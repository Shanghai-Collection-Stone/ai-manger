import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module.js';
import { AiBillingService } from './services/ai-billing.service.js';

/**
 * @description AI Token 用量和租户 Credit 扣费模块。
 * @keyword-cn AI计费模块, Credit扣费
 * @keyword-en ai-billing-module, credit-charge
 */
@Module({
  imports: [ContextModule],
  providers: [AiBillingService],
  exports: [AiBillingService],
})
export class AiBillingModule {}
