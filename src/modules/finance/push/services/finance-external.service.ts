import { BadRequestException, Injectable } from '@nestjs/common';
import type { AdminUserEntity } from '../../../admin/entities/admin.entity.js';
import { FinancePushConfigService } from './finance-push-config.service.js';

/**
 * @description 外部财务系统资源(透传给前端绑定弹窗用)
 * @keyword-en external resource shape
 */
export interface FinanceExternalResource {
  id: string;
  name?: string;
  code?: string;
  [key: string]: unknown;
}

/**
 * @description 外部 API 透传 client(列 stores/companies 给前端选 storeId/companyId)
 * @keyword-en finance external proxy, list stores companies via push config
 */
@Injectable()
export class FinanceExternalService {
  constructor(private readonly pushConfig: FinancePushConfigService) {}

  /**
   * @description 列出外部财务系统的门店
   * @keyword-en list external stores
   */
  async listStores(
    currentUser: AdminUserEntity,
  ): Promise<FinanceExternalResource[]> {
    return this.fetchAll(currentUser, '/stores', 'stores');
  }

  /**
   * @description 列出外部财务系统的公司
   * @keyword-en list external companies
   */
  async listCompanies(
    currentUser: AdminUserEntity,
  ): Promise<FinanceExternalResource[]> {
    return this.fetchAll(currentUser, '/companies', 'companies');
  }

  /**
   * @description 通用分页拉取(根据 meta.total / meta.page 决定是否翻页;最多翻 20 页 ≈ 10000 条)
   * @keyword-en fetch all with pagination cap
   */
  private async fetchAll(
    currentUser: AdminUserEntity,
    path: string,
    pluralKey: string,
  ): Promise<FinanceExternalResource[]> {
    const scopeId = this.pushConfig.resolveScopeId(currentUser);
    const config = await this.pushConfig.get(scopeId);
    if (!config) throw new BadRequestException('PUSH_CONFIG_REQUIRED');
    const out: FinanceExternalResource[] = [];
    const pageSize = 500;
    for (let page = 1; page <= 20; page += 1) {
      const url = this.joinUrl(
        config.baseUrl,
        `${path}?page=${page}&page_size=${pageSize}`,
      );
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new BadRequestException(
          `FINANCE_EXTERNAL_LIST_FAILED:HTTP ${res.status} · ${text.slice(0, 200)}`,
        );
      }
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: unknown;
        meta?: { total?: number };
      } | null;
      if (!body || body.ok === false) {
        throw new BadRequestException('FINANCE_EXTERNAL_LIST_FAILED');
      }
      const list = this.extractArray(body, pluralKey);
      out.push(...list);
      const total = Number(body.meta?.total ?? out.length);
      if (out.length >= total || list.length < pageSize) break;
    }
    return out;
  }

  /**
   * @description 从响应取数组(兼容 { data:[] } 与 { data:{ stores:[] } })
   * @keyword-en extract array from response
   */
  private extractArray(
    body: { data?: unknown },
    pluralKey: string,
  ): FinanceExternalResource[] {
    const data = body?.data;
    if (Array.isArray(data)) return data as FinanceExternalResource[];
    if (data && typeof data === 'object') {
      const inner = (data as Record<string, unknown>)[pluralKey];
      if (Array.isArray(inner)) return inner as FinanceExternalResource[];
    }
    return [];
  }

  /**
   * @description 拼 baseUrl + path
   * @keyword-en join base url and path
   */
  private joinUrl(baseUrl: string, path: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    const tail = path.startsWith('/') ? path : `/${path}`;
    return `${base}${tail}`;
  }
}
