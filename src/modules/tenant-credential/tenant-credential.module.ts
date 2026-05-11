import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DataSourceModule } from '../data-source/data-source.module.js';
import { TenantCredentialAdminController } from './controller/tenant-credential-admin.controller.js';
import { TenantCredentialService } from './services/tenant-credential.service.js';

/**
 * @description 租户第三方凭证模块（首发飞书 appId/appSecret，可扩展企微/钉钉）
 * @keyword-en tenant credential module, feishu, app id, app secret
 */
@Module({
  imports: [DataSourceModule, forwardRef(() => AdminModule)],
  controllers: [TenantCredentialAdminController],
  providers: [TenantCredentialService],
  exports: [TenantCredentialService],
})
export class TenantCredentialModule {}
