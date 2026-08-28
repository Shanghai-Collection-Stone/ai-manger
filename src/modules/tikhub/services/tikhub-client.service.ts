import { Injectable, Logger } from '@nestjs/common';
import type { TikhubProbeResult } from '../entities/tikhub.entity.js';

/** @type {string} 小红书 App V2 图文笔记详情（图文/视频通用，只需 note_id）。 */
const XHS_NOTE_DETAIL_PATH = '/api/v1/xiaohongshu/app_v2/get_image_note_detail';

/** @type {string} 小红书 App V2 笔记评论列表。 */
const XHS_NOTE_COMMENTS_PATH = '/api/v1/xiaohongshu/app_v2/get_note_comments';

/** @type {string} TikHub 账户信息，用作 API Key 连通性自检（不产生业务计费）。 */
const TIKHUB_USER_INFO_PATH = '/api/v1/tikhub/user/get_user_info';

/** @type {number} 单次请求超时（毫秒）。 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * @description 调用 TikHub 时使用的凭证与域名，由配置服务解析后传入，客户端本身不读库。
 * @keyword-cn 调用凭证, 域名参数
 * @keyword-en call-credentials, base-url-option
 */
export interface TikhubCallOptions {
  apiKey: string;
  baseUrl: string;
}

/**
 * @description TikHub HTTP 客户端：只负责发请求、判错和返回原始 JSON，
 *   字段归一化交给 `TikhubXhsService`，避免上游改字段时改动散落各处。
 * @keyword-cn TikHub客户端, 接口调用
 * @keyword-en tikhub-client, http-call
 */
@Injectable()
export class TikhubClientService {
  private readonly logger = new Logger(TikhubClientService.name);

  /**
   * @description 用账户信息接口自检 API Key 是否可用，供配置页「测试连接」调用。
   * @keyword-cn 连通性自检, 密钥校验
   * @keyword-en connectivity-probe, api-key-validation
   * @param options 凭证与域名。
   * @returns {Promise<TikhubProbeResult>} 自检结果，失败时带可读原因。
   */
  async probe(options: TikhubCallOptions): Promise<TikhubProbeResult> {
    if (!options.apiKey) {
      return { ok: false, message: '未配置 TikHub API Key' };
    }
    try {
      const payload = await this.request<Record<string, unknown>>(
        TIKHUB_USER_INFO_PATH,
        {},
        options,
      );
      return { ok: true, balance: this.readBalance(payload) };
    } catch (error) {
      return { ok: false, message: this.readErrorMessage(error) };
    }
  }

  /**
   * @description 拉取一篇小红书笔记的详情，图文与视频笔记都能用这个接口拿到互动数据。
   * @keyword-cn 笔记详情, 互动数据
   * @keyword-en note-detail, interaction-data
   * @param noteId 小红书笔记 ID。
   * @param options 凭证与域名。
   * @returns {Promise<unknown>} TikHub 原始响应体。
   */
  async fetchNoteDetail(
    noteId: string,
    options: TikhubCallOptions,
  ): Promise<unknown> {
    return this.request(XHS_NOTE_DETAIL_PATH, { note_id: noteId }, options);
  }

  /**
   * @description 拉取一篇笔记的热门评论，按点赞排序取首屏即可满足评论快照需求。
   * @keyword-cn 笔记评论, 热门排序
   * @keyword-en note-comments, hot-sort
   * @param noteId 小红书笔记 ID。
   * @param options 凭证与域名。
   * @returns {Promise<unknown>} TikHub 原始响应体。
   */
  async fetchNoteComments(
    noteId: string,
    options: TikhubCallOptions,
  ): Promise<unknown> {
    return this.request(
      XHS_NOTE_COMMENTS_PATH,
      { note_id: noteId, sort_strategy: 'like_count', index: '0' },
      options,
    );
  }

  /**
   * @description 发起一次 TikHub GET 请求并统一判错，非 2xx 抛出携带状态码的可读异常。
   *   任何日志都不带 API Key。
   * @keyword-cn 发起请求, 统一判错
   * @keyword-en send-request, unified-error
   * @param path 接口路径。
   * @param query 查询参数。
   * @param options 凭证与域名。
   * @returns {Promise<T>} 解析后的响应体。
   */
  private async request<T>(
    path: string,
    query: Record<string, string>,
    options: TikhubCallOptions,
  ): Promise<T> {
    const url = new URL(path, options.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'ai-manger/tikhub-client',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `TikHub 请求失败 ${path}：${this.readErrorMessage(error)}`,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `TikHub 返回 ${response.status} ${path}：${text.slice(0, 300)}`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `TikHub 响应不是合法 JSON ${path}：${text.slice(0, 200)}`,
      );
    }
  }

  /**
   * @description 从账户信息响应里尽量读出余额，字段缺失时返回 undefined 而不是 0。
   * @keyword-cn 读取余额, 字段容错
   * @keyword-en read-balance, tolerant-field
   * @param payload 账户信息响应体。
   * @returns {number | undefined} 账户余额。
   */
  private readBalance(payload: unknown): number | undefined {
    const stack: unknown[] = [payload];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const record = node as Record<string, unknown>;
      for (const key of ['balance', 'account_balance', 'remaining_balance']) {
        const value = record[key];
        if (typeof value === 'number') return value;
        if (
          typeof value === 'string' &&
          value.trim() &&
          !isNaN(Number(value))
        ) {
          return Number(value);
        }
      }
      stack.push(...Object.values(record));
    }
    return undefined;
  }

  /**
   * @description 把 fetch / AbortSignal 抛出的错误压成一行可读文本，供任务失败原因展示。
   * @keyword-cn 错误可读化, 失败原因
   * @keyword-en readable-error, failure-reason
   * @param error 捕获到的异常。
   * @returns {string} 一行可读的错误描述。
   */
  private readErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const cause = (error as { cause?: unknown }).cause;
      const causeText = cause instanceof Error ? `（${cause.message}）` : '';
      if (error.name === 'TimeoutError') return '请求超时';
      return `${error.message}${causeText}`;
    }
    return String(error);
  }
}
