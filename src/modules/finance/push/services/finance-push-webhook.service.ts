import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { FinanceBindingService } from '../../config/services/finance-binding.service.js';
import { FinancePushConfigService } from './finance-push-config.service.js';
import type { FinancePushLogEntry } from './finance-push-runner.service.js';
import {
  FinancePushRunnerService,
  type FinancePushRunResult,
} from './finance-push-runner.service.js';

const REQUIRED_PUSH_EVENT = 'webhooks.requiredPush';
const REPORT_SOURCE = 'ai-manger.finance.push';
const WEBHOOK_ENDPOINT = '/finance/push/webhooks/required-push';
const PROBE_EVENTS = new Set([
  'ping',
  'test',
  'webhook.ping',
  'webhook.test',
  'webhooks.ping',
  'webhooks.test',
  'url_verification',
  'endpoint.verification',
]);
const LOG_REDACTED = '[redacted]';

type RequestWithRawBody = Request & { rawBody?: Buffer | string };

interface FinancePushWebhookHook {
  id?: string;
  reportUrl?: string;
  token?: string;
  tokenHeader?: string;
}

interface FinancePushWebhookContext {
  event: string;
  webhookId?: string;
  hookId?: string;
  tenantId: string;
  scopeId: string;
  bindingNames: string[];
  startDate?: string;
  endDate?: string;
  hook: FinancePushWebhookHook;
}

type FinancePushWebhookReportStatus =
  | 'queued'
  | 'dispatching'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

type FinancePushWebhookReportLevel = 'info' | 'success' | 'warning' | 'error';

interface FinancePushWebhookReportInput {
  status: FinancePushWebhookReportStatus;
  level: FinancePushWebhookReportLevel;
  message: string;
  progress?: number;
  meta?: Record<string, unknown>;
}

/**
 * @description Accepted webhook response returned after signature and payload validation.
 * @keyword-en finance-push-webhook-accepted, webhook-trigger
 * @keyword-cn 财务推送webhook接收, webhook触发
 */
export interface FinancePushWebhookAccepted {
  ok: true;
}

/**
 * @description Non-mutating response for webhook endpoint health checks and provider validation probes.
 * @keyword-en finance-push-webhook-probe, webhook-health
 */
export interface FinancePushWebhookProbe {
  ok: true;
  accepted: false;
  mode: 'probe';
  endpoint: string;
  event: string;
  challenge?: string;
}

/**
 * @description Union response returned by the finance push webhook receiver.
 * @keyword-en finance-push-webhook-response, webhook-health
 */
export type FinancePushWebhookResponse =
  | FinancePushWebhookAccepted
  | FinancePushWebhookProbe;

/**
 * @description Receives finance push webhooks, verifies optional HMAC signature, starts push jobs, and reports progress to hook.reportUrl.
 * @keyword-en finance-push-webhook-service, webhook-progress-report
 * @keyword-cn 财务推送webhook服务, 进度回报
 */
@Injectable()
export class FinancePushWebhookService {
  private readonly logger = new Logger(FinancePushWebhookService.name);

  constructor(
    private readonly runnerService: FinancePushRunnerService,
    private readonly bindingService: FinanceBindingService,
    private readonly configService: FinancePushConfigService,
  ) {}

  /**
   * @description Validate a required-push webhook and launch the push task in the background.
   * @keyword-en accept-finance-push-webhook, webhook-trigger
   * @keyword-cn 接收财务推送webhook, webhook触发
   */
  async accept(
    req: Request,
    body: unknown,
  ): Promise<FinancePushWebhookResponse> {
    this.logIncomingRequest(req, body);
    if (this.isProbeRequest(req, body)) {
      return this.probe(req, body, { log: false });
    }
    this.verifySignature(req, body);
    const context = await this.parseContext(req, body);
    void this.processAccepted(context);
    return {
      ok: true,
    };
  }

  /**
   * @description Return a safe webhook receiver probe response without launching any push task.
   * @keyword-en finance-push-webhook-probe, webhook-health
   */
  probe(
    req?: Request,
    body?: unknown,
    options: { log?: boolean } = {},
  ): FinancePushWebhookProbe {
    if (req && options.log !== false) {
      this.logIncomingRequest(req, body);
    }
    const challenge = this.extractProbeChallenge(req, body);
    return {
      ok: true,
      accepted: false,
      mode: 'probe',
      endpoint: WEBHOOK_ENDPOINT,
      event: REQUIRED_PUSH_EVENT,
      ...(challenge ? { challenge } : {}),
    };
  }

  /**
   * @description Log every request received by the webhook endpoint with masked sensitive fields.
   * @keyword-en log-webhook-request, webhook-debug
   */
  private logIncomingRequest(req: Request, body: unknown): void {
    const snapshot = {
      at: new Date().toISOString(),
      method: req.method,
      originalUrl: req.originalUrl,
      path: req.path,
      ip: req.ip,
      ips: req.ips,
      headers: this.sanitizeForLog(req.headers),
      query: this.sanitizeForLog(req.query),
      body: this.sanitizeForLog(body),
      rawBody: this.maskSensitiveText(this.getRawBody(req, body)),
    };
    this.logger.log(
      `Finance push webhook received: ${JSON.stringify(snapshot)}`,
    );
  }

  /**
   * @description Execute the accepted push and report dispatching, running, completed, or failed states.
   * @keyword-en process-accepted-webhook, webhook-progress-report
   * @keyword-cn 处理已接收webhook, 进度回报
   */
  private async processAccepted(
    context: FinancePushWebhookContext,
  ): Promise<void> {
    await this.report(context, {
      status: 'dispatching',
      level: 'info',
      message: `Accepted finance push for ${context.bindingNames.length} binding(s)`,
      progress: 0,
    });
    try {
      const results: FinancePushRunResult[] = [];
      const total = context.bindingNames.length;
      for (let index = 0; index < total; index += 1) {
        const bindingName = context.bindingNames[index];
        const progressBase = 5 + Math.floor((index / total) * 85);
        await this.report(context, {
          status: 'running',
          level: 'info',
          message: `Starting finance push for binding ${bindingName}`,
          progress: progressBase,
          meta: { bindingName },
        });
        const result = await this.runnerService.runByScope(
          context.scopeId,
          bindingName,
          {
            startDate: context.startDate,
            endDate: context.endDate,
            onLog: (entry) => {
              void this.report(context, {
                status: 'running',
                level: this.toReportLevel(entry.level),
                message: entry.msg,
                progress: Math.min(95, progressBase + 5),
                meta: { at: entry.at, bindingName },
              });
            },
          },
        );
        results.push(result);
        if (result.failedBatch) {
          await this.report(context, {
            status: 'failed',
            level: 'error',
            message:
              result.failedBatch.message ||
              `Finance push failed at binding ${bindingName}, batch ${result.failedBatch.index + 1}`,
            progress: 100,
            meta: {
              bindingName,
              result: this.toResultMeta(result),
              results: results.map((item) => this.toResultMeta(item)),
            },
          });
          return;
        }
      }
      const successCount = results.reduce(
        (sum, item) => sum + item.successCount,
        0,
      );
      await this.report(context, {
        status: 'completed',
        level: 'success',
        message: `Finance push completed, ${successCount} records pushed across ${results.length} binding(s)`,
        progress: 100,
        meta: { results: results.map((item) => this.toResultMeta(item)) },
      });
    } catch (err) {
      const message = this.toErrorMessage(err);
      this.logger.error(
        `Finance push webhook failed for ${context.bindingNames.join(',')}: ${message}`,
      );
      await this.report(context, {
        status: 'failed',
        level: 'error',
        message,
        progress: 100,
      });
    }
  }

  /**
   * @description Send one status update back to hook.reportUrl with hook token headers.
   * @keyword-en send-webhook-report, webhook-progress-report
   * @keyword-cn 发送webhook回报, 进度回报
   */
  private async report(
    context: FinancePushWebhookContext,
    input: FinancePushWebhookReportInput,
  ): Promise<void> {
    const url = context.hook.reportUrl;
    if (!url) return;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (context.hook.token && context.hook.tokenHeader) {
      headers[context.hook.tokenHeader] = context.hook.token;
    }
    const body = {
      hookId: context.hookId,
      status: input.status,
      level: input.level,
      source: REPORT_SOURCE,
      message: input.message,
      progress: input.progress,
      meta: {
        webhookId: context.webhookId,
        tenantId: context.tenantId,
        bindingNames: context.bindingNames,
        startDate: context.startDate,
        endDate: context.endDate,
        ...(input.meta ?? {}),
      },
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `Finance webhook report failed HTTP ${res.status}: ${text.slice(0, 300)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Finance webhook report network error: ${this.toErrorMessage(err)}`,
      );
    }
  }

  /**
   * @description Verify x-finance-webhook-signature when FINANCE_PUSH_WEBHOOK_SECRET or FINANCE_WEBHOOK_SECRET is configured.
   * @keyword-en verify-webhook-signature, hmac-sha256
   * @keyword-cn 校验webhook签名, hmac签名
   */
  private verifySignature(req: Request, body: unknown): void {
    const secret = this.getWebhookSecret();
    if (!secret) return;
    const signature = this.getHeader(req, 'x-finance-webhook-signature');
    const occurredAt =
      this.getHeader(req, 'x-finance-webhook-time') ||
      (this.isRecord(body) ? this.pickString(body, ['occurredAt']) : undefined);
    if (!signature || !occurredAt) {
      throw new UnauthorizedException('FINANCE_WEBHOOK_SIGNATURE_REQUIRED');
    }
    const rawBody = this.getRawBody(req, body);
    const expected =
      'sha256=' +
      createHmac('sha256', secret)
        .update(`${occurredAt}.${rawBody}`)
        .digest('hex');
    const actual = signature.startsWith('sha256=')
      ? signature
      : `sha256=${signature}`;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new UnauthorizedException('FINANCE_WEBHOOK_SIGNATURE_INVALID');
    }
  }

  /**
   * @description Read webhook secret from env with backwards-compatible names.
   * @keyword-en resolve-webhook-secret, webhook-secret
   * @keyword-cn 解析webhook密钥, webhook密钥
   */
  private getWebhookSecret(): string {
    return (
      process.env.FINANCE_PUSH_WEBHOOK_SECRET?.trim() ||
      process.env.FINANCE_WEBHOOK_SECRET?.trim() ||
      ''
    );
  }

  /**
   * @description Parse and validate event envelope, hook data, external tenant mapping, binding names, and optional date window.
   * @keyword-en parse-webhook-context, webhook-envelope
   * @keyword-cn 解析webhook上下文, webhook信封
   */
  private async parseContext(
    req: Request,
    body: unknown,
  ): Promise<FinancePushWebhookContext> {
    if (!this.isRecord(body)) {
      throw new BadRequestException('FINANCE_WEBHOOK_BODY_INVALID');
    }
    const payload = this.isRecord(body.payload) ? body.payload : {};
    const binding = this.extractEnvelopeBinding(body, payload);
    const headerEvent = this.getHeader(req, 'x-finance-webhook-event');
    const bodyEvent =
      this.pickString(body, ['event']) || this.pickString(binding, ['event']);
    if (headerEvent && bodyEvent && headerEvent !== bodyEvent) {
      throw new BadRequestException('FINANCE_WEBHOOK_EVENT_MISMATCH');
    }
    const event = headerEvent || bodyEvent;
    if (event !== REQUIRED_PUSH_EVENT) {
      throw new BadRequestException('FINANCE_WEBHOOK_EVENT_UNSUPPORTED');
    }
    const tenantId =
      this.pickString(body, ['tenantId']) ||
      this.pickString(binding, ['tenantId']);
    if (!tenantId) {
      throw new BadRequestException('FINANCE_WEBHOOK_TENANT_REQUIRED');
    }
    const scopeId = await this.resolveWebhookScopeId(tenantId);
    const input = this.isRecord(payload.input) ? payload.input : {};
    const { startDate, endDate } = this.extractDateWindow(payload, input);
    const hook = this.extractHook(req, body, payload);
    if (!hook.reportUrl) {
      throw new BadRequestException('FINANCE_WEBHOOK_REPORT_URL_REQUIRED');
    }
    const webhookId =
      this.getHeader(req, 'x-finance-webhook-id') ||
      this.pickString(body, ['id']) ||
      this.pickString(binding, ['deliveryId', 'delivery_id', 'webhookId']);
    const hookId = hook.id || webhookId;
    const bindingNames = await this.extractBindingNames(
      scopeId,
      payload,
      body,
    );
    return {
      event,
      webhookId,
      hookId,
      tenantId,
      scopeId,
      bindingNames,
      startDate,
      endDate,
      hook,
    };
  }

  /**
   * @description Map the external finance tenantId from webhook payload to this system's internal scope id.
   * @keyword-cn 外部租户映射, webhook作用域
   * @keyword-en resolve-webhook-scope, external-tenant-mapping
   */
  private async resolveWebhookScopeId(externalTenantId: string): Promise<string> {
    const config = await this.configService.getByExternalTenantId(
      externalTenantId,
    );
    if (!config) {
      throw new BadRequestException('FINANCE_WEBHOOK_TENANT_UNMAPPED');
    }
    return config.tenantId;
  }

  /**
   * @description Extract the webhook delivery binding object from top-level body or payload.binding.
   * @keyword-en extract-envelope-binding, webhook-envelope
   */
  private extractEnvelopeBinding(
    body: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (this.isRecord(body.binding)) return body.binding;
    if (this.isRecord(payload.binding)) return payload.binding;
    return {};
  }

  /**
   * @description Detect empty, browser, ping, test, or challenge requests used to validate the receiver URL.
   * @keyword-en detect-webhook-probe, webhook-health
   */
  private isProbeRequest(req: Request, body: unknown): boolean {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') return true;
    if (!this.isRecord(body)) return true;

    const headerEvent = this.getHeader(req, 'x-finance-webhook-event');
    const bodyEvent = this.pickString(body, ['event', 'type']);
    const event = headerEvent || bodyEvent;
    if (event) return PROBE_EVENTS.has(event);

    const hasChallenge = !!this.extractProbeChallenge(req, body);
    if (hasChallenge) return true;

    const hasActionableContext =
      !!this.pickString(body, ['tenantId']) ||
      this.isRecord(body.binding) ||
      this.isRecord(body.payload) ||
      this.isRecord(body.hook);
    return !hasActionableContext;
  }

  /**
   * @description Extract provider challenge tokens from body or query string for URL verification probes.
   * @keyword-en extract-webhook-challenge, webhook-health
   */
  private extractProbeChallenge(
    req?: Request,
    body?: unknown,
  ): string | undefined {
    if (this.isRecord(body)) {
      const bodyChallenge = this.pickString(body, [
        'challenge',
        'echostr',
        'verification',
      ]);
      if (bodyChallenge) return bodyChallenge;
    }
    return (
      this.pickQueryString(req?.query?.challenge) ||
      this.pickQueryString(req?.query?.echostr) ||
      this.pickQueryString(req?.query?.verification)
    );
  }

  /**
   * @description Extract hook report URL, token, token header, and hook id from envelope or headers.
   * @keyword-en extract-webhook-hook, report-url
   * @keyword-cn 提取webhook回调, 回报地址
   */
  private extractHook(
    req: Request,
    body: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): FinancePushWebhookHook {
    const hook = this.isRecord(body.hook) ? body.hook : {};
    const binding = this.extractEnvelopeBinding(body, payload);
    const bindingHook = this.isRecord(binding.hook) ? binding.hook : {};
    const id =
      this.pickString(hook, ['id']) ||
      this.pickString(bindingHook, ['id']) ||
      this.getHeader(req, 'x-finance-hook-id') ||
      this.pickString(body, ['hookId']) ||
      this.pickString(binding, ['hookId', 'hook_id']);
    const token =
      this.pickString(hook, ['token']) ||
      this.pickString(binding, ['token']);
    const tokenHeader =
      this.pickString(hook, ['tokenHeader', 'token_header']) ||
      this.pickString(binding, ['tokenHeader', 'token_header']) ||
      (token ? 'x-finance-hook-token' : undefined);
    return {
      id,
      reportUrl:
        this.pickString(hook, ['reportUrl', 'report_url']) ||
        this.pickString(bindingHook, ['reportUrl', 'report_url']) ||
        this.pickString(binding, ['reportUrl', 'report_url']),
      token,
      tokenHeader,
    };
  }

  /**
   * @description Resolve explicit binding names, or fall back to all bindings in the tenant scope.
   * @keyword-en extract-binding-names, webhook-payload
   * @keyword-cn 提取绑定名称列表, webhook负载
   */
  private async extractBindingNames(
    scopeId: string,
    payload: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Promise<string[]> {
    const input = this.isRecord(payload.input) ? payload.input : {};
    const explicit = [
      ...this.pickStringArray(input, ['bindingNames', 'bindings', 'names']),
      ...this.pickStringArray(payload, ['bindingNames', 'bindings', 'names']),
      ...this.pickStringArray(body, ['bindingNames', 'bindings', 'names']),
      ...[
        this.pickString(input, [
          'bindingName',
          'binding',
          'name',
          'pushName',
          'financeBindingName',
        ]),
        this.pickString(payload, [
          'bindingName',
          'binding',
          'name',
          'pushName',
          'financeBindingName',
        ]),
        this.pickString(body, [
          'bindingName',
          'binding',
          'name',
          'pushName',
          'financeBindingName',
        ]),
      ].filter((value): value is string => !!value),
    ];
    const names =
      explicit.length > 0
        ? explicit
        : (await this.bindingService.listByScope(scopeId)).map(
            (item) => item.name,
          );
    const deduped = Array.from(
      new Set(names.map((name) => name.trim()).filter(Boolean)),
    );
    if (deduped.length === 0) {
      throw new BadRequestException('FINANCE_WEBHOOK_BINDING_REQUIRED');
    }
    return deduped;
  }

  /**
   * @description Resolve optional YYYY-MM-DD date window from payload or payload.dateWindow.
   * @keyword-en extract-date-window, date-window
   * @keyword-cn 提取日期窗口, 日期过滤
   */
  private extractDateWindow(
    payload: Record<string, unknown>,
    input: Record<string, unknown> = {},
  ): {
    startDate?: string;
    endDate?: string;
  } {
    const dateWindow = this.isRecord(payload.dateWindow)
      ? payload.dateWindow
      : {};
    const inputDateWindow = this.isRecord(input.dateWindow)
      ? input.dateWindow
      : {};
    return {
      startDate:
        this.pickString(payload, ['startDate', 'start_date']) ||
        this.pickString(input, ['startDate', 'start_date']) ||
        this.pickString(dateWindow, ['startDate', 'start', 'from']) ||
        this.pickString(inputDateWindow, ['startDate', 'start', 'from']),
      endDate:
        this.pickString(payload, ['endDate', 'end_date']) ||
        this.pickString(input, ['endDate', 'end_date']) ||
        this.pickString(dateWindow, ['endDate', 'end', 'to']) ||
        this.pickString(inputDateWindow, ['endDate', 'end', 'to']),
    };
  }

  /**
   * @description Convert run result to compact report meta without large failed payloads.
   * @keyword-en compact-result-meta, webhook-report-meta
   * @keyword-cn 压缩结果元信息, 回报元信息
   */
  private toResultMeta(result: FinancePushRunResult): Record<string, unknown> {
    return {
      name: result.name,
      totalRows: result.totalRows,
      transformedRows: result.transformedRows,
      filteredRows: result.filteredRows,
      dateFilteredRows: result.dateFilteredRows,
      transformErrors: result.transformErrors,
      successCount: result.successCount,
      batches: result.batches,
      failedBatch: result.failedBatch
        ? {
            index: result.failedBatch.index,
            httpStatus: result.failedBatch.httpStatus,
            code: result.failedBatch.code,
            message: result.failedBatch.message,
          }
        : undefined,
    };
  }

  /**
   * @description Read an HTTP header as a trimmed string.
   * @keyword-en read-webhook-header, header-string
   * @keyword-cn 读取webhook头, 请求头字符串
   */
  private getHeader(req: Request, name: string): string | undefined {
    const value = req.header(name);
    return value?.trim() || undefined;
  }

  /**
   * @description Read raw body captured by Nest rawBody mode, falling back to JSON serialization for unsigned requests.
   * @keyword-en read-raw-body, hmac-raw-body
   * @keyword-cn 读取原始请求体, hmac原文
   */
  private getRawBody(req: Request, body: unknown): string {
    const rawBody = (req as RequestWithRawBody).rawBody;
    if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
    if (typeof rawBody === 'string') return rawBody;
    return JSON.stringify(body ?? {});
  }

  /**
   * @description Recursively mask sensitive request fields before writing webhook debug logs.
   * @keyword-en sanitize-webhook-log, webhook-debug
   */
  private sanitizeForLog(value: unknown, key = ''): unknown {
    if (this.isSensitiveLogKey(key)) return LOG_REDACTED;
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeForLog(item, key));
    }
    if (this.isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          this.sanitizeForLog(entryValue, entryKey),
        ]),
      );
    }
    if (typeof value === 'string') return this.maskSensitiveText(value);
    return value;
  }

  /**
   * @description Decide whether a field name should be masked in webhook request logs.
   * @keyword-en detect-sensitive-log-key, webhook-debug
   */
  private isSensitiveLogKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return (
      normalized === 'authorization' ||
      normalized === 'x-api-key' ||
      normalized.includes('signature') ||
      normalized.includes('secret') ||
      normalized.includes('token') ||
      normalized.includes('apikey') ||
      normalized.includes('api-key')
    );
  }

  /**
   * @description Mask sensitive JSON-like fragments inside raw webhook request text.
   * @keyword-en mask-sensitive-log-text, webhook-debug
   */
  private maskSensitiveText(text: string): string {
    return text
      .replace(
        /("(?:authorization|x-api-key|x-finance-webhook-signature|signature|secret|token|tokenHeader|apiKey|api_key)"\s*:\s*)"[^"]*"/gi,
        `$1"${LOG_REDACTED}"`,
      )
      .replace(
        /\b(authorization|x-api-key|x-finance-webhook-signature|signature|secret|token|apiKey|api_key)=([^&\s]+)/gi,
        `$1=${LOG_REDACTED}`,
      );
  }

  /**
   * @description Pick and trim string arrays from a record, also accepting comma-separated strings.
   * @keyword-en pick-string-array, record-helper
   * @keyword-cn 选择字符串数组, 对象辅助
   */
  private pickStringArray(
    record: Record<string, unknown>,
    keys: string[],
  ): string[] {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      if (typeof value === 'string' && value.trim()) {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }
    return [];
  }

  /**
   * @description Pick a trimmed string from an Express query value.
   * @keyword-en pick-query-string, record-helper
   */
  private pickQueryString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find(
        (item) => typeof item === 'string' && item.trim(),
      );
      return typeof first === 'string' ? first.trim() : undefined;
    }
    return undefined;
  }

  /**
   * @description Pick the first non-empty string field from a record.
   * @keyword-en pick-string-field, record-helper
   * @keyword-cn 选择字符串字段, 对象辅助
   */
  private pickString(
    record: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  /**
   * @description Check whether an unknown value is a non-array object record.
   * @keyword-en is-record, object-guard
   * @keyword-cn 判断对象记录, 对象守卫
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * @description Map internal runner log levels to webhook report levels.
   * @keyword-en map-report-level, webhook-report-level
   * @keyword-cn 映射回报级别, webhook回报级别
   */
  private toReportLevel(
    level: FinancePushLogEntry['level'],
  ): FinancePushWebhookReportLevel {
    if (level === 'warn') return 'warning';
    return level;
  }

  /**
   * @description Convert unknown errors to readable strings for reports and logs.
   * @keyword-en error-to-message, error-reporting
   * @keyword-cn 错误转消息, 错误回报
   */
  private toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err ?? 'UNKNOWN_ERROR');
  }
}
