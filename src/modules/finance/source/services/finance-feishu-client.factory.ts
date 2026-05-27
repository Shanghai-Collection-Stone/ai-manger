import { BadRequestException, Injectable } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import { TenantCredentialService } from '../../../tenant-credential/services/tenant-credential.service.js';
import { createFeishuHttpInstance } from '../../../../shared/network/feishu-http-instance.js';

/**
 * @description 财务专用飞书 Client 工厂，按租户 appId/appSecret 取出 lark.Client，并做内存级缓存
 * @keyword-en finance feishu client factory, tenant credential, lark sdk cache
 */
@Injectable()
export class FinanceFeishuClientFactory {
  private readonly cache = new Map<
    string,
    { client: lark.Client; appId: string }
  >();

  constructor(private readonly credentialService: TenantCredentialService) {}

  /**
   * @description 按租户获取 lark.Client（凭证变更时自动失效）
   * @keyword-en get lark client by tenant
   */
  async getClient(tenantId: string): Promise<lark.Client> {
    const id = String(tenantId ?? '').trim();
    if (!id) throw new BadRequestException('TENANT_ID_REQUIRED');
    const credential = await this.credentialService.getByTenant(id);
    if (!credential?.appId || !credential?.appSecret) {
      throw new BadRequestException('FEISHU_CREDENTIAL_MISSING');
    }
    const cached = this.cache.get(id);
    if (cached && cached.appId === credential.appId) {
      return cached.client;
    }
    const client = new lark.Client({
      appId: credential.appId,
      appSecret: credential.appSecret,
      disableTokenCache: false,
      // 飞书境内直连,禁用 axios env 代理,避免经本地代理明文 HTTP 发往 HTTPS 端口
      httpInstance: createFeishuHttpInstance(),
    });
    this.cache.set(id, { client, appId: credential.appId });
    return client;
  }

  /**
   * @description 强制清缓存（凭证更新后调用）
   * @keyword-en invalidate lark client cache
   */
  invalidate(tenantId?: string): void {
    if (!tenantId) {
      this.cache.clear();
      return;
    }
    this.cache.delete(String(tenantId).trim());
  }
}
