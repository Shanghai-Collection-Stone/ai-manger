import { Injectable, Logger } from '@nestjs/common';
import type {
  HotTopicRuleEntity,
  HotTopicRuleFieldPaths,
} from '../entities/hot-topic.entity.js';

/** @type {number} 单次榜单请求超时毫秒数，公开榜单接口普遍很快，超过这个时间基本就是被限流或不可达。 */
const FETCH_TIMEOUT_MS = 15000;

/** @type {number} 单条规则允许解析出的最大条数，防止上游返回超长数组把库撑爆。 */
const MAX_ITEMS_PER_RULE = 200;

/** @type {string} 未显式配置 User-Agent 时补上的桌面 UA，多数公开榜单接口会拒绝空 UA 请求。 */
const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * @description 从榜单响应里解析出来的单条原始热点，尚未落库、尚未 AI 归类。
 * @keyword-cn 解析后热点, 原始条目
 * @keyword-en parsed-hot-topic, raw-item
 */
export interface ParsedHotTopic {
  rank: number;
  title: string;
  url?: string;
  heat?: string;
  summary?: string;
}

/**
 * @description 一次榜单抓取与解析的结果，失败时带上人可读原因供管理页「是否可用」展示。
 * @keyword-cn 抓取结果, 解析回执
 * @keyword-en fetch-result, parse-receipt
 */
export interface HotTopicFetchResult {
  ok: boolean;
  items: ParsedHotTopic[];
  message?: string;
}

/**
 * @description 采集规则里可被抓取的最小字段集合，规则自检与正式采集共用同一份入参形状。
 * @keyword-cn 抓取入参, 规则片段
 * @keyword-en fetch-input, rule-fragment
 */
export type HotTopicFetchable = Pick<
  HotTopicRuleEntity,
  'endpoint' | 'headers' | 'listPath' | 'fields' | 'urlTemplate' | 'limit'
>;

/**
 * @description 公开榜单 HTTP 直采与 JSON 解析。规则由后台可编辑，所以这里既要能按点号路径
 *  灵活取值，也要挡住指向内网的地址——规则表本身就是一个「让服务端去访问任意 URL」的入口。
 * @keyword-cn 榜单直采, 榜单解析, 内网地址拦截
 * @keyword-en board-http-fetch, board-parse, ssrf-guard
 */
@Injectable()
export class HotTopicFetcherService {
  private readonly logger = new Logger(HotTopicFetcherService.name);

  /**
   * @description 抓取并解析一条采集规则。任何环节失败都收敛成 `{ ok: false, message }` 而不是抛异常，
   *  让批量采集里单条规则失效不影响其余规则。
   * @param {HotTopicFetchable} rule - 采集规则（地址、请求头与取值路径）。
   * @returns {Promise<HotTopicFetchResult>} 抓取与解析结果。
   * @keyword-cn 抓取榜单, 单规则容错
   * @keyword-en fetch-board, per-rule-tolerance
   */
  async fetchRule(rule: HotTopicFetchable): Promise<HotTopicFetchResult> {
    const endpointError = this.validateEndpoint(rule.endpoint);
    if (endpointError) return { ok: false, items: [], message: endpointError };

    let payload: unknown;
    try {
      payload = await this.requestJson(rule);
    } catch (error) {
      const message = this.readErrorMessage(error);
      this.logger.warn(
        `[hot-topic] fetch_failed endpoint=${rule.endpoint} ${message}`,
      );
      return { ok: false, items: [], message };
    }

    const rawList = this.resolveList(payload, rule.listPath);
    if (!rawList) {
      return {
        ok: false,
        items: [],
        message: rule.listPath
          ? `按路径 ${rule.listPath} 没有取到数组，上游可能改了返回结构`
          : '响应里没有找到任何对象数组，请手动配置榜单数组路径',
      };
    }

    const limit = Math.max(
      1,
      Math.min(MAX_ITEMS_PER_RULE, Math.floor(rule.limit || 50)),
    );
    const items: ParsedHotTopic[] = [];
    for (const raw of rawList) {
      if (items.length >= limit) break;
      const item = this.normalizeItem(raw, rule.fields, rule.urlTemplate);
      if (!item) continue;
      if (items.some((existing) => existing.title === item.title)) continue;
      items.push({ ...item, rank: items.length + 1 });
    }

    if (items.length === 0) {
      return {
        ok: false,
        items: [],
        message: `取到 ${rawList.length} 条原始数据，但按标题路径 ${rule.fields.title} 解析不出任何标题`,
      };
    }
    return { ok: true, items };
  }

  /**
   * @description 校验榜单地址：只允许 http/https 公网地址，挡掉 localhost、回环与私网网段。
   *  规则可由后台自由填写，不挡就等于把服务端当成访问任意内网地址的跳板。
   * @param {string} endpoint - 待校验的榜单地址。
   * @returns {string | null} 不合法时返回原因，合法返回 null。
   * @keyword-cn 地址校验, 内网地址拦截
   * @keyword-en endpoint-validation, ssrf-guard
   */
  validateEndpoint(endpoint: string): string | null {
    const raw = String(endpoint ?? '').trim();
    if (!raw) return '榜单地址不能为空';
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return '榜单地址不是合法 URL';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '榜单地址只支持 http / https';
    }
    if (this.isInternalHost(parsed.hostname)) {
      return '榜单地址不能指向本机或内网地址';
    }
    return null;
  }

  /**
   * @description 判断主机名是否落在本机/内网网段，覆盖 localhost、IPv4 私网、IPv6 回环与链路本地。
   * @param {string} hostname - URL 的 hostname。
   * @returns {boolean} 命中内网返回 true。
   * @keyword-cn 内网主机判定, 私网网段
   * @keyword-en internal-host-check, private-range
   */
  private isInternalHost(hostname: string): boolean {
    const host = String(hostname ?? '')
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '::1' || host === '::' || host.startsWith('fe80:'))
      return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true;
    if (host.endsWith('.internal') || host.endsWith('.local')) return true;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 10 || first === 127 || first === 0) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
    return false;
  }

  /**
   * @description 发起一次榜单 GET 请求并解析成 JSON。部分榜单接口把 JSON 标成 text/html，
   *  所以不看 Content-Type，直接按文本解析。
   * @param {HotTopicFetchable} rule - 采集规则。
   * @returns {Promise<unknown>} 解析后的 JSON。
   * @throws {Error} 网络失败、非 2xx 或响应不是 JSON 时抛出。
   * @keyword-cn 发起榜单请求, 文本解析JSON
   * @keyword-en request-board-json, parse-text-json
   */
  private async requestJson(rule: HotTopicFetchable): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      ...(rule.headers ?? {}),
    };
    const hasUserAgent = Object.keys(headers).some(
      (key) => key.toLowerCase() === 'user-agent',
    );
    if (!hasUserAgent) headers['User-Agent'] = FALLBACK_UA;

    const response = await fetch(rule.endpoint, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`上游返回 HTTP ${response.status}`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      const preview = text.slice(0, 80).replace(/\s+/g, ' ');
      throw new Error(`响应不是 JSON（前 80 字符：${preview}）`);
    }
  }

  /**
   * @description 按点号路径取出榜单数组；路径为空时深度探测第一个「元素是对象」的数组。
   * @param {unknown} payload - 上游响应。
   * @param {string} listPath - 榜单数组路径，可留空。
   * @returns {unknown[] | null} 榜单数组，取不到返回 null。
   * @keyword-cn 定位榜单数组, 自动探测
   * @keyword-en locate-board-array, auto-detect
   */
  private resolveList(payload: unknown, listPath: string): unknown[] | null {
    const path = String(listPath ?? '').trim();
    if (path) {
      const value = this.readPath(payload, path);
      return Array.isArray(value) ? value : null;
    }
    return this.findFirstObjectArray(payload, 0);
  }

  /**
   * @description 深度优先找出响应里第一个元素为对象的数组，作为榜单数组的兜底探测。
   * @param {unknown} node - 当前节点。
   * @param {number} depth - 当前深度，超过 6 层放弃。
   * @returns {unknown[] | null} 命中的数组。
   * @keyword-cn 探测对象数组, 深度限制
   * @keyword-en detect-object-array, depth-limit
   */
  private findFirstObjectArray(node: unknown, depth: number): unknown[] | null {
    if (depth > 6 || node === null || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      return node.some((item) => item !== null && typeof item === 'object')
        ? node
        : null;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      const hit = this.findFirstObjectArray(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * @description 按点号路径读取嵌套值，路径段是纯数字时按数组下标处理。
   * @param {unknown} source - 源对象。
   * @param {string} path - 点号路径，例如 `data.cards.0.content`。
   * @returns {unknown} 取到的值，任一段缺失返回 undefined。
   * @keyword-cn 点号路径取值, 数组下标
   * @keyword-en dot-path-read, array-index
   */
  readPath(source: unknown, path: string): unknown {
    const segments = String(path ?? '')
      .split('.')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    let current: unknown = source;
    for (const segment of segments) {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) {
        const index = Number(segment);
        if (!Number.isInteger(index) || index < 0) return undefined;
        current = current[index];
        continue;
      }
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  /**
   * @description 把一条原始榜单数据按取值路径归一化；标题取不到即视为无效条目直接丢弃。
   * @param {unknown} raw - 单条原始数据。
   * @param {HotTopicRuleFieldPaths} fields - 字段取值路径。
   * @param {string} [urlTemplate] - 榜单不给链接时的检索地址模板。
   * @returns {Omit<ParsedHotTopic, 'rank'> | null} 归一化条目。
   * @keyword-cn 归一化条目, 标题必填
   * @keyword-en normalize-item, title-required
   */
  private normalizeItem(
    raw: unknown,
    fields: HotTopicRuleFieldPaths,
    urlTemplate?: string,
  ): Omit<ParsedHotTopic, 'rank'> | null {
    const title = this.readText(raw, fields.title, 160);
    if (!title) return null;
    const directUrl = this.readText(raw, fields.url, 600);
    const url =
      directUrl || this.buildTemplateUrl(urlTemplate, title, raw) || undefined;
    const heat = this.readText(raw, fields.heat, 40);
    const summary = this.readText(raw, fields.summary, 300);
    return {
      title,
      ...(url ? { url } : {}),
      ...(heat ? { heat } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  /**
   * @description 按路径读取一个可展示的短文本，数字转成字符串，对象与数组一律视为取不到。
   * @param {unknown} raw - 源对象。
   * @param {string} [path] - 取值路径，缺省返回空串。
   * @param {number} maxLength - 截断长度。
   * @returns {string} 归一化后的文本，取不到返回空串。
   * @keyword-cn 读取文本字段, 截断
   * @keyword-en read-text-field, truncate
   */
  private readText(
    raw: unknown,
    path: string | undefined,
    maxLength: number,
  ): string {
    if (!path) return '';
    const value = this.readPath(raw, path);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  /**
   * @description 填充地址模板里的 `{...}` 占位符：`{title}` 用已解析出的标题，其余占位符按点号
   *  路径从原始条目上取值（例如澎湃新闻的 `{contId}`），取到的值统一按 URL 组件转义。
   *  任一占位符取不到值就整体判为拼不出地址返回空串——半截 URL 比没有 URL 更糟。
   * @param {string} [template] - 地址模板。
   * @param {string} title - 已解析出的热点标题。
   * @param {unknown} raw - 原始条目，供非 title 占位符取值。
   * @returns {string} 拼好的地址，模板为空或占位符缺值时返回空串。
   * @keyword-cn 拼接检索地址, 字段占位符
   * @keyword-en build-search-url, field-placeholder
   */
  private buildTemplateUrl(
    template: string | undefined,
    title: string,
    raw: unknown,
  ): string {
    const pattern = String(template ?? '').trim();
    if (!pattern || !pattern.includes('{')) return '';
    let missing = false;
    const url = pattern.replace(/\{([^{}]+)\}/g, (_match, key: string) => {
      const path = String(key).trim();
      const value = path === 'title' ? title : this.readText(raw, path, 200);
      if (!value) {
        missing = true;
        return '';
      }
      return encodeURIComponent(value);
    });
    return missing ? '' : url;
  }

  /**
   * @description 把 fetch / 超时 / 解析异常压成一行可读文本，写进规则的可用性快照。
   * @param {unknown} error - 捕获到的异常。
   * @returns {string} 可读原因。
   * @keyword-cn 错误可读化, 失败原因
   * @keyword-en readable-error, failure-reason
   */
  readErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        return `请求超时（${FETCH_TIMEOUT_MS / 1000} 秒无响应）`;
      }
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      return cause ? `${error.message}（${cause}）` : error.message;
    }
    return String(error);
  }
}
