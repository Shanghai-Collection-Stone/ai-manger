import { Injectable } from '@nestjs/common';
import { FinanceFeishuClientFactory } from './finance-feishu-client.factory.js';
import type {
  ApprovalFetchParams,
  ApprovalInstanceStatus,
  FinanceColumnMeta,
  FinanceFetchResult,
  FinanceRawRow,
} from '../types/finance-source.types.js';

type ApprovalListResponse = {
  code: number;
  msg?: string;
  data?: {
    instance_code_list?: string[];
    page_token?: string;
    has_more?: boolean;
  };
};

type ApprovalGetResponse = {
  code: number;
  msg?: string;
  data?: {
    instance_code?: string;
    user_id?: string;
    open_id?: string;
    department_id?: string;
    start_time?: string;
    end_time?: string;
    status?: ApprovalInstanceStatus;
    serial_number?: string;
    /** 飞书审批表单内容为 JSON 字符串数组 */
    form?: string;
  };
};

type ApprovalFormItem = {
  id?: string;
  custom_id?: string;
  name?: string;
  type?: string;
  value?: unknown;
};

type ApprovalInstanceClient = {
  list: (args: {
    params: {
      approval_code: string;
      start_time?: string;
      end_time?: string;
      user_id?: string;
      page_token?: string;
      page_size?: number;
    };
  }) => Promise<ApprovalListResponse>;
  get: (args: {
    path: { instance_id: string };
    params?: { user_id_type?: string };
  }) => Promise<ApprovalGetResponse>;
};

/**
 * @description 财务飞书审批读取器（独立通路，按 approval_code 拉实例）
 * @keyword-en finance approval reader, approval code, instance list, form fields
 */
@Injectable()
export class ApprovalReaderService {
  constructor(private readonly clientFactory: FinanceFeishuClientFactory) {}

  /**
   * @description 列出实例 code（默认仅 APPROVED）
   * @keyword-en list approval instance codes
   */
  async listInstanceCodes(
    params: ApprovalFetchParams,
  ): Promise<{ codes: string[]; pageToken?: string; hasMore: boolean }> {
    const client = await this.clientFactory.getClient(params.tenantId);
    const instance = this.getInstanceClient(client);
    const response = await instance.list({
      params: {
        approval_code: params.approvalCode,
        page_size: params.pageSize ?? 100,
        page_token: params.pageToken,
        start_time:
          typeof params.startTime === 'number'
            ? String(params.startTime)
            : undefined,
        end_time:
          typeof params.endTime === 'number'
            ? String(params.endTime)
            : undefined,
      },
    });
    if (response.code !== 0) {
      throw new Error(`FEISHU_APPROVAL_LIST_FAILED: ${response.msg}`);
    }
    return {
      codes: response.data?.instance_code_list ?? [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more ?? false,
    };
  }

  /**
   * @description 取单实例详情，并把 form 字符串解析为字段键值
   * @keyword-en get approval instance detail
   */
  async getInstance(
    tenantId: string,
    instanceCode: string,
  ): Promise<FinanceRawRow | null> {
    const client = await this.clientFactory.getClient(tenantId);
    const instance = this.getInstanceClient(client);
    const response = await instance.get({
      path: { instance_id: instanceCode },
    });
    if (response.code !== 0 || !response.data) return null;
    const data = response.data;
    const formFields = this.parseForm(data.form);
    const meta: Record<string, unknown> = {
      __status: data.status,
      __serial: data.serial_number,
      __userId: data.user_id ?? data.open_id,
      __department: data.department_id,
      __startTime: data.start_time,
      __endTime: data.end_time,
    };
    // 把 instance_code 用 record_id 这个统一 key 暴露到 fields,DSL 可用 {"from":"record_id"} 作为 externalId
    const fields: Record<string, unknown> = { ...formFields, ...meta };
    if (!('record_id' in fields)) fields.record_id = instanceCode;
    return {
      id: instanceCode,
      sourceType: 'approval',
      fields,
      createdAt: this.toMs(data.start_time),
      updatedAt: this.toMs(data.end_time),
    };
  }

  /**
   * @description 拉全实例（默认 APPROVED）
   * @keyword-en fetch all approval instances
   */
  async fetchAll(
    params: ApprovalFetchParams & { maxInstances?: number },
  ): Promise<FinanceFetchResult> {
    const limit = params.maxInstances ?? 500;
    const wantStatuses = new Set<ApprovalInstanceStatus>(
      params.statuses && params.statuses.length > 0
        ? params.statuses
        : ['APPROVED'],
    );
    const codes: string[] = [];
    let pageToken: string | undefined;
    let safety = 0;
    do {
      const page = await this.listInstanceCodes({ ...params, pageToken });
      codes.push(...page.codes);
      pageToken = page.hasMore ? page.pageToken : undefined;
      if (codes.length >= limit) break;
      if (++safety > 100) break;
    } while (pageToken);

    const sliced = codes.slice(0, limit);
    const rows: FinanceRawRow[] = [];
    const columnSet = new Map<string, string>();
    const concurrency = 5;
    for (let i = 0; i < sliced.length; i += concurrency) {
      const batch = sliced.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((code) => this.getInstance(params.tenantId, code)),
      );
      for (const row of results) {
        if (!row) continue;
        const status = row.fields['__status'] as
          | ApprovalInstanceStatus
          | undefined;
        if (status && !wantStatuses.has(status)) continue;
        rows.push(row);
        for (const key of Object.keys(row.fields)) {
          if (!columnSet.has(key)) columnSet.set(key, this.guessType(row.fields[key]));
        }
      }
    }
    const columns: FinanceColumnMeta[] = Array.from(columnSet.entries()).map(
      ([name, type]) => ({ name, type }),
    );
    return { rows, columns, hasMore: false, pageToken: undefined };
  }

  /**
   * @description 解析 form 字段（飞书审批 form 为 JSON 字符串数组）
   * @keyword-en parse approval form
   */
  private parseForm(form?: string): Record<string, unknown> {
    if (!form) return {};
    try {
      const parsed = JSON.parse(form) as ApprovalFormItem[];
      if (!Array.isArray(parsed)) return {};
      const out: Record<string, unknown> = {};
      for (const item of parsed) {
        const key = item.name?.trim() || item.custom_id?.trim() || item.id;
        if (!key) continue;
        out[key] = item.value;
      }
      return out;
    } catch {
      return {};
    }
  }

  /**
   * @description 字符串/秒级时间戳 → 毫秒
   * @keyword-en parse to milliseconds
   */
  private toMs(value?: string): number | undefined {
    if (!value) return undefined;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return undefined;
    return num < 10_000_000_000 ? num * 1000 : num;
  }

  /**
   * @description 简易类型推断
   * @keyword-en guess column type
   */
  private guessType(value: unknown): string {
    if (value == null) return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return 'string';
  }

  /**
   * @description 兼容 SDK 路径（approval.v4.instance）
   * @keyword-en resolve approval instance client
   */
  private getInstanceClient(client: unknown): ApprovalInstanceClient {
    const root = client as {
      approval?: { v4?: { instance?: ApprovalInstanceClient } };
    };
    const target = root.approval?.v4?.instance;
    if (!target) {
      throw new Error('FEISHU_SDK_APPROVAL_NOT_AVAILABLE');
    }
    return target;
  }
}
