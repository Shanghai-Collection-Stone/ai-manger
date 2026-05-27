import { Injectable } from '@nestjs/common';
import { FinanceFeishuClientFactory } from './finance-feishu-client.factory.js';
import type {
  BitableFetchParams,
  FinanceColumnMeta,
  FinanceFetchResult,
  FinanceRawRow,
} from '../types/finance-source.types.js';

const FEISHU_FIELD_TYPE_MAP: Record<number, string> = {
  1: 'string',
  2: 'number',
  3: 'string',
  4: 'array',
  5: 'date',
  7: 'boolean',
  11: 'array',
  13: 'string',
  15: 'string',
  17: 'object',
  18: 'string',
  19: 'string',
  20: 'string',
  21: 'string',
  22: 'string',
  23: 'string',
  1001: 'date',
  1002: 'date',
  1003: 'object',
  1004: 'object',
  1005: 'string',
};

/**
 * @description 财务多维表读取器（独立通路，不复用 data-source 的 bitable service）
 * @keyword-en finance bitable reader, app token, table id, list records
 */
@Injectable()
export class BitableReaderService {
  constructor(private readonly clientFactory: FinanceFeishuClientFactory) {}

  /**
   * @description 列出 appToken 下所有数据表（供前端勾选批量绑定）
   * @keyword-en list bitable tables under app token
   */
  async listTables(
    tenantId: string,
    appToken: string,
  ): Promise<Array<{ tableId: string; name: string }>> {
    const client = await this.clientFactory.getClient(tenantId);
    const acc: Array<{ tableId: string; name: string }> = [];
    let pageToken: string | undefined;
    let safety = 0;
    do {
      const response = await client.bitable.appTable.list({
        path: { app_token: appToken },
        params: { page_size: 100, page_token: pageToken },
      });
      if (response.code !== 0) {
        throw new Error(`FEISHU_LIST_TABLES_FAILED: ${response.msg}`);
      }
      const data = response.data as
        | {
            items?: Array<{ table_id?: string; name?: string }>;
            has_more?: boolean;
            page_token?: string;
          }
        | undefined;
      for (const t of data?.items ?? []) {
        if (t.table_id) {
          acc.push({ tableId: t.table_id, name: t.name ?? t.table_id });
        }
      }
      pageToken = data?.has_more ? data.page_token : undefined;
      if (++safety > 50) break;
    } while (pageToken);
    return acc;
  }

  /**
   * @description 列出表字段元数据
   * @keyword-en list bitable fields meta
   */
  async listColumns(
    tenantId: string,
    appToken: string,
    tableId: string,
  ): Promise<FinanceColumnMeta[]> {
    const client = await this.clientFactory.getClient(tenantId);
    const response = await client.bitable.appTableField.list({
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: 100 },
    });
    if (response.code !== 0) {
      throw new Error(`FEISHU_LIST_FIELDS_FAILED: ${response.msg}`);
    }
    return (
      response.data?.items?.map((field) => ({
        name: field.field_name ?? '',
        type: FEISHU_FIELD_TYPE_MAP[field.type ?? 1] ?? 'string',
      })) ?? []
    );
  }

  /**
   * @description 拉取多维表记录（仅用 createdAt/updatedAt 自动字段，过滤推迟到 transform）
   * @keyword-en fetch bitable records page
   */
  async fetch(params: BitableFetchParams): Promise<FinanceFetchResult> {
    const client = await this.clientFactory.getClient(params.tenantId);
    const response = await client.bitable.appTableRecord.search({
      path: { app_token: params.appToken, table_id: params.tableId },
      params: {
        page_size: params.pageSize ?? 50,
        page_token: params.pageToken,
      },
      data: { automatic_fields: true },
    });
    if (response.code !== 0) {
      throw new Error(`FEISHU_LIST_RECORDS_FAILED: ${response.msg}`);
    }
    const data = response.data as
      | {
          items?: Array<{
            record_id?: string;
            fields?: Record<string, unknown>;
            created_time?: number;
            last_modified_time?: number;
          }>;
          has_more?: boolean;
          page_token?: string;
        }
      | undefined;
    const rows: FinanceRawRow[] =
      data?.items?.map((item) => {
        const recordId = item.record_id ?? '';
        // 把 record_id 注入到 fields,DSL 可以用 {"from":"record_id"} 引用作 externalId
        // 用户列里若有同名字段(罕见,飞书多维表通常用中文列名),用户字段优先,这里只在缺失时补
        const fields = { ...(item.fields ?? {}) } as Record<string, unknown>;
        if (!('record_id' in fields)) fields.record_id = recordId;
        return {
          id: recordId,
          sourceType: 'bitable' as const,
          fields,
          createdAt:
            typeof item.created_time === 'number'
              ? item.created_time
              : undefined,
          updatedAt:
            typeof item.last_modified_time === 'number'
              ? item.last_modified_time
              : undefined,
        };
      }) ?? [];
    const columns = await this.listColumns(
      params.tenantId,
      params.appToken,
      params.tableId,
    );
    return {
      rows,
      columns,
      hasMore: data?.has_more ?? false,
      pageToken: data?.page_token,
    };
  }

  /**
   * @description 拉全表（自动翻页，最大 maxRows 防爆）
   * @keyword-en fetch all bitable records
   */
  async fetchAll(
    params: Omit<BitableFetchParams, 'pageToken'> & { maxRows?: number },
  ): Promise<FinanceFetchResult> {
    const limit = params.maxRows ?? 5000;
    const acc: FinanceRawRow[] = [];
    let pageToken: string | undefined;
    let columns: FinanceColumnMeta[] = [];
    let safety = 0;
    do {
      const page = await this.fetch({ ...params, pageToken });
      if (columns.length === 0) columns = page.columns;
      acc.push(...page.rows);
      pageToken = page.hasMore ? page.pageToken : undefined;
      if (acc.length >= limit) break;
      if (++safety > 200) break;
    } while (pageToken);
    return {
      rows: acc.slice(0, limit),
      columns,
      hasMore: false,
      pageToken: undefined,
    };
  }
}
