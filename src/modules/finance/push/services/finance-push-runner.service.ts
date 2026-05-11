import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AdminUserEntity } from '../../../admin/entities/admin.entity.js';
import { FinanceBindingService } from '../../config/services/finance-binding.service.js';
import { FinanceTransformService } from '../../config/services/finance-transform.service.js';
import type { FinanceSourceItem } from '../../config/entities/finance-binding.entity.js';
import { ApprovalReaderService } from '../../source/services/approval-reader.service.js';
import { BitableReaderService } from '../../source/services/bitable-reader.service.js';
import type { FinanceRawRow } from '../../source/types/finance-source.types.js';
import { TransformEngineService } from '../../transform/services/transform-engine.service.js';
import type {
  FinancePushConfigEntity,
  FinancePushTestStatus,
} from '../entities/finance-push-config.entity.js';
import { FinancePushConfigService } from './finance-push-config.service.js';

const BATCH_SIZE = 500;
/** 统一推送端点(对齐 api.md §6) */
const EVENTS_UPSERT_PATH = '/events/upsert';
/** 探活路径:验 key 有效性即可,scope 在第一次推送时再触发 */
const PROBE_PATH = '/me';

/**
 * @description 推送测试结果
 * @keyword-en push test result type
 */
export interface FinancePushTestResult {
  status: FinancePushTestStatus;
  httpStatus?: number;
  code?: string;
  message?: string;
}

/**
 * @description 推送执行单条日志
 * @keyword-en push run log entry
 */
export interface FinancePushLogEntry {
  level: 'info' | 'warn' | 'error';
  at: number;
  msg: string;
}

/**
 * @description 推送执行结果
 * @keyword-en push run result type
 */
export interface FinancePushRunResult {
  name: string;
  totalRows: number;
  transformedRows: number;
  filteredRows: number;
  /** 按 occurredAt 时间窗过滤掉的数量(transform 后再过滤) */
  dateFilteredRows: number;
  transformErrors: number;
  successCount: number;
  batches: number;
  /** 时间过滤窗口(YYYY-MM-DD) */
  startDate?: string;
  endDate?: string;
  failedBatch?: {
    index: number;
    httpStatus: number;
    code?: string;
    message?: string;
    /** 该批拒收时,推送过去的全部记录(给 Agent 排错用,完整不截断) */
    payloadAll: Array<Record<string, unknown>>;
    /** 对方服务器响应的完整 body(JSON 或 HTML/纯文本字符串,完整不截断) */
    rawResponseBody?: unknown;
    /** 响应 Content-Type 头(让 Agent 判断 body 是 JSON 还是 HTML) */
    contentType?: string;
  };
  /** 执行过程关键日志(给前端展示) */
  logs: FinancePushLogEntry[];
}

/**
 * @description run 入参选项
 * @keyword-en run options
 */
export interface FinancePushRunOptions {
  /** 仅推 occurredAt >= startDate(YYYY-MM-DD) */
  startDate?: string;
  /** 仅推 occurredAt <= endDate(YYYY-MM-DD) */
  endDate?: string;
}

/**
 * @description 财务推送执行器:统一推送 /api/v1/events/upsert(整批拒收)
 * @keyword-en finance push runner, unified events endpoint, abs amount, batch upsert
 */
@Injectable()
export class FinancePushRunnerService {
  private readonly logger = new Logger(FinancePushRunnerService.name);

  constructor(
    private readonly configService: FinancePushConfigService,
    private readonly bindingService: FinanceBindingService,
    private readonly transformService: FinanceTransformService,
    private readonly transformEngine: TransformEngineService,
    private readonly bitableReader: BitableReaderService,
    private readonly approvalReader: ApprovalReaderService,
  ) {}

  /**
   * @description 探测 key 有效性(GET /api/v1/me)
   * @keyword-en test push connectivity by probing /me
   */
  async test(currentUser: AdminUserEntity): Promise<FinancePushTestResult> {
    const scopeId = this.configService.resolveScopeId(currentUser);
    const config = await this.configService.get(scopeId);
    if (!config) throw new BadRequestException('PUSH_CONFIG_REQUIRED');
    const url = this.joinUrl(config.baseUrl, PROBE_PATH);
    const result = await this.probe(url, config.apiKey);
    await this.configService.recordTest(scopeId, result.status, result.message);
    return result;
  }

  /**
   * @description 执行一次完整推送:拉源 → transform → abs → 按 occurredAt 时间过滤 → 切批 → upsert(任一批失败立即停止);全程累积关键日志
   * @keyword-en run one push by binding name with logs and date window
   */
  async run(
    currentUser: AdminUserEntity,
    name: string,
    opts: FinancePushRunOptions = {},
  ): Promise<FinancePushRunResult> {
    const scopeId = this.configService.resolveScopeId(currentUser);
    const bindingName = this.bindingService.assertName(name);
    const startDate = this.normalizeDateOpt(opts.startDate);
    const endDate = this.normalizeDateOpt(opts.endDate);
    const logs: FinancePushLogEntry[] = [];
    const log = (level: FinancePushLogEntry['level'], msg: string) => {
      const entry: FinancePushLogEntry = { level, at: Date.now(), msg };
      logs.push(entry);
      const tag = `[finance-push:${bindingName}]`;
      if (level === 'error') this.logger.error(`${tag} ${msg}`);
      else if (level === 'warn') this.logger.warn(`${tag} ${msg}`);
      else this.logger.log(`${tag} ${msg}`);
    };

    const config = await this.configService.get(scopeId);
    if (!config) throw new BadRequestException('PUSH_CONFIG_REQUIRED');
    const binding = await this.bindingService.getByName(scopeId, bindingName);
    if (!binding?.sources?.length) {
      throw new BadRequestException('PUSH_BINDING_REQUIRED');
    }
    const transform = await this.transformService.getByName(scopeId, bindingName);
    if (!transform?.dsl) {
      throw new BadRequestException('PUSH_TRANSFORM_REQUIRED');
    }

    log(
      'info',
      `开始推送 binding「${bindingName}」· 共 ${binding.sources.length} 个源` +
        (startDate || endDate
          ? ` · 时间窗 [${startDate || '不限'} → ${endDate || '不限'}]`
          : ''),
    );

    log('info', '拉取源数据中...');
    const rawRows = await this.collectRawRows(scopeId, binding.sources, log);
    log('info', `源数据拉取完成 · 共 ${rawRows.length} 行`);

    log('info', `应用 Transform DSL...`);
    const transformed = this.transformEngine.run(rawRows, transform.dsl);
    log(
      transformed.errors.length > 0 ? 'warn' : 'info',
      `Transform 完成 · 输出 ${transformed.rows.length} 行 / 过滤 ${transformed.filteredCount} 行 / 异常 ${transformed.errors.length} 行`,
    );
    if (transformed.errors.length > 0) {
      const sampleErr = transformed.errors[0];
      log(
        'warn',
        `首条 transform 异常 · row#${sampleErr.rowIndex}${sampleErr.rowId ? `(id=${sampleErr.rowId})` : ''} · ${sampleErr.message}`,
      );
    }

    let records = transformed.rows.map((row) =>
      this.stripEmptyFields(this.normalizeAmount({ ...row })),
    );
    let dateFilteredRows = 0;
    if (startDate || endDate) {
      const beforeCount = records.length;
      records = records.filter((row) =>
        this.passesDateWindow(row.occurredAt, startDate, endDate),
      );
      dateFilteredRows = beforeCount - records.length;
      log(
        'info',
        `时间窗过滤后剩 ${records.length} 行 · 过滤掉 ${dateFilteredRows} 行(无 occurredAt 或不在窗内)`,
      );
    }

    const summary: FinancePushRunResult = {
      name: bindingName,
      totalRows: rawRows.length,
      transformedRows: records.length,
      filteredRows: transformed.filteredCount,
      dateFilteredRows,
      transformErrors: transformed.errors.length,
      successCount: 0,
      batches: 0,
      startDate,
      endDate,
      logs,
    };

    if (records.length === 0) {
      log('warn', '无可推送记录,中止');
      await this.configService.recordPush(scopeId, {
        name: bindingName,
        totalRows: summary.totalRows,
        successCount: 0,
        batches: 0,
        failedReason:
          dateFilteredRows > 0
            ? '时间窗过滤后无可推送记录'
            : 'transform 后无可推送记录',
      });
      return summary;
    }

    const endpoint = this.joinUrl(config.baseUrl, EVENTS_UPSERT_PATH);
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);
    log('info', `准备推送 ${records.length} 条 · 切 ${totalBatches} 批 · 端点 ${endpoint}`);
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      summary.batches += 1;
      const batchIndex = summary.batches - 1;
      log('info', `推送批次 ${summary.batches}/${totalBatches}(${chunk.length} 条)...`);
      const res = await this.upsertBatch(endpoint, config.apiKey, chunk);
      if (res.ok) {
        summary.successCount += chunk.length;
        log('info', `批次 ${summary.batches} 成功 · HTTP ${res.httpStatus}`);
        continue;
      }
      summary.failedBatch = {
        index: batchIndex,
        httpStatus: res.httpStatus,
        code: res.code,
        message: res.message,
        payloadAll: chunk,
        rawResponseBody: res.rawResponseBody,
        contentType: res.contentType,
      };
      // log 里只放短摘要,完整内容由前端通过 failedBatch.rawResponseBody / payloadAll 拿
      const shortMsg =
        typeof res.message === 'string' && res.message.length > 200
          ? res.message.slice(0, 200) + '...(完整见 failedBatch.rawResponseBody)'
          : (res.message ?? '');
      log(
        'error',
        `批次 ${summary.batches} 拒收 · HTTP ${res.httpStatus}${res.code ? ` · ${res.code}` : ''} · ${shortMsg}`,
      );
      await this.configService.recordPush(scopeId, {
        name: bindingName,
        totalRows: summary.totalRows,
        successCount: summary.successCount,
        batches: summary.batches,
        failedReason: this.formatFailedReason(res),
      });
      return summary;
    }

    log(
      'info',
      `全部成功 · ${summary.successCount} 条 / ${summary.batches} 批`,
    );
    await this.configService.recordPush(scopeId, {
      name: bindingName,
      totalRows: summary.totalRows,
      successCount: summary.successCount,
      batches: summary.batches,
    });
    return summary;
  }

  /**
   * @description 行的 occurredAt 是否落在 [start, end] 闭区间内(都按 YYYY-MM-DD 字符串比较;无 occurredAt 视为不通过)
   * @keyword-en row passes date window check
   */
  private passesDateWindow(
    value: unknown,
    start?: string,
    end?: string,
  ): boolean {
    if (!start && !end) return true;
    const day = this.toDayString(value);
    if (!day) return false;
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  }

  /**
   * @description 把任意 occurredAt(YYYY-MM-DD / ISO / Date / number)归一为 YYYY-MM-DD;不可解析返回 null
   * @keyword-en occurred at to YYYY-MM-DD
   */
  private toDayString(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
      const ms = Date.parse(trimmed);
      return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value < 10_000_000_000 ? value * 1000 : value;
      return new Date(ms).toISOString().slice(0, 10);
    }
    return null;
  }

  /**
   * @description 入参时间字符串校验 + 标准化(必须 YYYY-MM-DD,非法抛 400)
   * @keyword-en normalize date opt
   */
  private normalizeDateOpt(value: unknown): string | undefined {
    if (value == null) return undefined;
    const s = String(value).trim();
    if (!s) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      throw new BadRequestException(`PUSH_DATE_FORMAT_INVALID:期望 YYYY-MM-DD,收到 ${s}`);
    }
    return s;
  }

  /**
   * @description 把所有绑定源的原始行汇总(按源类型分发拉取,自动翻页);把 source 上的 schemaConstants 作为虚拟字段注入到该 source 的每行 fields,DSL 可直接 from 引用
   * @keyword-en collect raw rows with per-source logs and schema constants injection
   */
  private async collectRawRows(
    scopeId: string,
    sources: FinanceSourceItem[],
    log: (level: FinancePushLogEntry['level'], msg: string) => void,
  ): Promise<FinanceRawRow[]> {
    const all: FinanceRawRow[] = [];
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      const label =
        source.alias ||
        (source.type === 'bitable'
          ? `${source.appToken.slice(0, 8)}.../${source.tableId}`
          : source.approvalCode);
      const t0 = Date.now();
      let rows: FinanceRawRow[];
      if (source.type === 'bitable') {
        const res = await this.bitableReader.fetchAll({
          tenantId: scopeId,
          appToken: source.appToken,
          tableId: source.tableId,
          pageSize: 200,
        });
        rows = res.rows;
        log(
          'info',
          `源 ${i + 1}/${sources.length} 多维表「${label}」 · ${res.rows.length} 行 · ${Date.now() - t0}ms`,
        );
      } else {
        const res = await this.approvalReader.fetchAll({
          tenantId: scopeId,
          approvalCode: source.approvalCode,
          pageSize: 100,
        });
        rows = res.rows;
        log(
          'info',
          `源 ${i + 1}/${sources.length} 审批「${label}」 · ${res.rows.length} 行 · ${Date.now() - t0}ms`,
        );
      }
      // 注入 source_alias 保留字段(与 record_id 同风格),让 DSL 行级 from 引用表定义
      if (source.alias) {
        for (const row of rows) {
          if (!('source_alias' in row.fields)) {
            row.fields = { ...row.fields, source_alias: source.alias };
          }
        }
      }
      all.push(...rows);
    }
    return all;
  }

  /**
   * @description 推送前剥离值为 null/undefined/空串的字段;非 primitive 的复合 object/array(transform 引擎漏拍平的飞书 cell 等)在保留键名外强制转 JSON 字符串,避免推送 [object Object] 之类被对方拒收;保留 false/0 等合法 falsy 值;`meta` 这种"原始字段透传"型字段允许是 object
   * @keyword-en strip empty fields and stringify non-primitive leaks
   */
  private stripEmptyFields(
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined || v === '') continue;
      if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean'
      ) {
        out[k] = v;
        continue;
      }
      // meta 字段允许 object 透传(api.md §6 明确允许);其他字段若漏成 object/array,JSON.stringify 兜底
      if (k === 'meta') {
        out[k] = v;
        continue;
      }
      try {
        out[k] = JSON.stringify(v);
      } catch {
        // 循环引用等极端情况:剔除该字段
      }
    }
    return out;
  }

  /**
   * @description amount 兜底取绝对值(目标 schema 用绝对值,正负看 flow)
   * @keyword-en push amount abs fallback
   */
  private normalizeAmount(row: Record<string, unknown>): Record<string, unknown> {
    const v = row.amount;
    if (typeof v === 'number' && Number.isFinite(v)) {
      row.amount = Math.abs(v);
    } else if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.startsWith('-')) row.amount = trimmed.slice(1);
    }
    return row;
  }

  /**
   * @description 单批 upsert(整批拒收;解析对方响应,失败时保留完整 raw body + content-type)
   * @keyword-en upsert one batch all or nothing with full raw response
   */
  private async upsertBatch(
    url: string,
    apiKey: string,
    records: Array<Record<string, unknown>>,
  ): Promise<{
    ok: boolean;
    httpStatus: number;
    code?: string;
    message?: string;
    rawResponseBody?: unknown;
    contentType?: string;
  }> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(records),
      });
    } catch (err) {
      return {
        ok: false,
        httpStatus: 0,
        code: 'NETWORK',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const text = await response.text();
    const contentType = response.headers.get('content-type') || undefined;
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (response.ok && this.isOkBody(body)) {
      return { ok: true, httpStatus: response.status };
    }
    const parsed = this.classifyHttpError(response.status, body, text);
    return {
      ok: false,
      httpStatus: response.status,
      ...parsed,
      rawResponseBody: body,
      contentType,
    };
  }

  /**
   * @description 探活请求(GET /me)
   * @keyword-en probe target endpoint and classify status
   */
  private async probe(
    url: string,
    apiKey: string,
  ): Promise<FinancePushTestResult> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      return {
        status: 'network',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (response.ok) {
      return { status: 'ok', httpStatus: response.status, message: '连通正常' };
    }
    if (response.status === 401) {
      return {
        status: 'auth',
        httpStatus: 401,
        code: this.pickCode(body),
        message: this.pickMessage(body) || 'API Key 无效或已过期',
      };
    }
    if (response.status === 403) {
      return {
        status: 'scope',
        httpStatus: 403,
        code: this.pickCode(body),
        message: this.pickMessage(body) || 'API Key 缺少所需 scope',
      };
    }
    const cls = this.classifyHttpError(response.status, body, text);
    return {
      status: cls.code === 'VALIDATION' ? 'validation' : 'unknown',
      httpStatus: response.status,
      code: cls.code,
      message: cls.message,
    };
  }

  /**
   * @description 把 HTTP 错误归类为 code/message;命中 zod-known-issue 规则时升级为 VALIDATION;message 保留完整(最多 16k,防 HTML 错误页撑爆 mongo)
   * @keyword-en classify http error code and message keeping full raw
   */
  private classifyHttpError(
    status: number,
    body: unknown,
    rawText: string,
  ): { code?: string; message?: string } {
    const code = this.pickCode(body) || (status >= 500 ? 'INTERNAL' : undefined);
    const picked = this.pickMessage(body);
    const message = picked || (typeof rawText === 'string' ? rawText.slice(0, 16000) : undefined);
    if (
      (status >= 400) &&
      typeof rawText === 'string' &&
      /validation|required|expected|invalid_type|invalid_enum/i.test(rawText)
    ) {
      return { code: code || 'VALIDATION', message };
    }
    return { code, message };
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

  /**
   * @description 检查响应 body 的 { ok: true } 标志
   * @keyword-en check ok body shape
   */
  private isOkBody(body: unknown): boolean {
    if (!body || typeof body !== 'object') return true;
    const okFlag = (body as { ok?: unknown }).ok;
    return okFlag === undefined || okFlag === true;
  }

  /**
   * @description 取响应 body 的 error.code
   * @keyword-en pick error code from body
   */
  private pickCode(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const err = (body as { error?: { code?: unknown } }).error;
    if (err && typeof err.code === 'string') return err.code;
    return undefined;
  }

  /**
   * @description 取响应 body 的 error.message
   * @keyword-en pick error message from body
   */
  private pickMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const err = (body as { error?: { message?: unknown } }).error;
    if (err && typeof err.message === 'string') return err.message;
    return undefined;
  }

  /**
   * @description 把失败结果落到 push config 的 lastPushFailedReason 字段
   * @keyword-en format failed batch reason
   */
  private formatFailedReason(res: {
    httpStatus: number;
    code?: string;
    message?: string;
  }): string {
    const parts = [`HTTP ${res.httpStatus}`];
    if (res.code) parts.push(res.code);
    if (res.message) parts.push(res.message);
    return parts.join(' · ');
  }
}
