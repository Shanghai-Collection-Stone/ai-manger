import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module.js';
import { AiBillingService } from './services/ai-billing.service.js';
import { AiCreditWalletService } from './services/ai-credit-wallet.service.js';

/**
 * @description AI Token 用量、租户 / 成员 / 个人三层 Credit 钱包与扣费模块。
 * @keyword-cn AI计费模块, Credit扣费
 * @keyword-en ai-billing-module, credit-charge
 */
@Module({
  imports: [ContextModule],
  providers: [AiBillingService, AiCreditWalletService],
  exports: [AiBillingService, AiCreditWalletService],
})
export class AiBillingModule {}
