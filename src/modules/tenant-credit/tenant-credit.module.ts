import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AiBillingModule } from '../ai-billing/ai-billing.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { TenantCreditController } from './controller/tenant-credit.controller.js';
import { TenantCreditService } from './services/tenant-credit.service.js';

/**
 * @description 租户 Credit 分配模块：成员额度分配、新成员赠送、旧余额迁移、个人额度充值与当前成员额度查询。
 * @keyword-cn 租户额度模块, 成员额度分配
 * @keyword-en tenant-credit-module, member-credit-allocation
 */
@Module({
  imports: [AdminModule, AiBillingModule, DataSourceModule],
  controllers: [TenantCreditController],
  providers: [TenantCreditService],
  exports: [TenantCreditService],
})
export class TenantCreditModule {}
