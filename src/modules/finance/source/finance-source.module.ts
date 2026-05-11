import { Module } from '@nestjs/common';
import { TenantCredentialModule } from '../../tenant-credential/tenant-credential.module.js';
import { ApprovalReaderService } from './services/approval-reader.service.js';
import { BitableReaderService } from './services/bitable-reader.service.js';
import { FinanceFeishuClientFactory } from './services/finance-feishu-client.factory.js';

/**
 * @description 财务源模块：飞书多维表 + 审批的独立读取通路
 * @keyword-en finance source module, bitable reader, approval reader
 */
@Module({
  imports: [TenantCredentialModule],
  providers: [
    FinanceFeishuClientFactory,
    BitableReaderService,
    ApprovalReaderService,
  ],
  exports: [
    FinanceFeishuClientFactory,
    BitableReaderService,
    ApprovalReaderService,
  ],
})
export class FinanceSourceModule {}
