import { Logger } from '@nestjs/common';
import { ChatAnthropic } from '@langchain/anthropic';

type CompletionArgs = Parameters<ChatAnthropic['completionWithRetry']>;
type CompletionResult = Awaited<
  ReturnType<ChatAnthropic['completionWithRetry']>
>;

// content 为空时的补发次数(不含首发)
const EMPTY_CONTENT_MAX_RETRIES = 2;
// MiniMax base_resp 中补发也不会变的状态: 鉴权失败 / 余额不足 / 输入违规 / 超长 / 参数错误
const NON_RETRYABLE_STATUS_CODES = new Set([1004, 1008, 1026, 1039, 2013]);

const logger = new Logger('AnthropicCompatChatModel');

/**
 * @description Anthropic 协议聊天模型兼容层。MiniMax 等 Anthropic 兼容端在业务失败(内容审核、限流、内部错误)时
 *   仍返回 HTTP 200,但 `content: null`,真实状态放在 `base_resp`;原生 ChatAnthropic 直接读 `content.length`,
 *   抛出无法定位的 `Cannot read properties of null (reading 'length')`。这里在非流式请求返回后校验 content:
 *   可补发的状态重新请求,仍为空则抛带状态码的 `AI_PROVIDER_EMPTY_RESPONSE`,交给上层按错误码处理。
 * @keyword-cn Anthropic兼容, 空响应兜底, MiniMax空内容
 * @keyword-en anthropic-compat, empty-content-guard, minimax-null-content
 */
export class AnthropicCompatChatModel extends ChatAnthropic {
  /**
   * @description 非流式请求:content 不是数组时记录原始响应,按 base_resp 状态码决定补发或抛错。
   * @keyword-cn 空响应重试, 响应校验
   * @keyword-en empty-content-retry, response-validation
   * @throws {Error} `AI_PROVIDER_EMPTY_RESPONSE`。
   */
  protected override async completionWithRetry(
    ...args: CompletionArgs
  ): Promise<CompletionResult> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await super.completionWithRetry(...args);
      if (Array.isArray(response?.content)) return response;
      const status = AnthropicCompatChatModel.readProviderStatus(response);
      const retry =
        attempt < EMPTY_CONTENT_MAX_RETRIES &&
        !(
          status.code !== undefined &&
          NON_RETRYABLE_STATUS_CODES.has(status.code)
        );
      let raw = '';
      try {
        raw = JSON.stringify(response).slice(0, 1000);
      } catch {
        raw = '<unstringifyable>';
      }
      logger.warn(
        `[completionWithRetry] model=${this.model} empty content attempt=${attempt + 1} status=${status.code ?? '-'} msg=${status.message ?? '-'} stop_reason=${response?.stop_reason ?? '-'} retry=${retry} raw=${raw}`,
      );
      if (!retry) {
        throw new Error(
          `AI_PROVIDER_EMPTY_RESPONSE: 模型 ${this.model} 返回空内容(status=${status.code ?? '-'} ${status.message ?? ''}, stop_reason=${response?.stop_reason ?? '-'})`,
        );
      }
    }
  }

  /**
   * @description 读取 Anthropic 兼容端附带的厂商状态(MiniMax 的 `base_resp.status_code / status_msg`)。
   * @keyword-cn 厂商状态码, base_resp解析
   * @keyword-en provider-status-code, base-resp-parse
   */
  private static readProviderStatus(response: unknown): {
    code?: number;
    message?: string;
  } {
    const baseResp = (response as { base_resp?: unknown } | null)?.base_resp;
    if (!baseResp || typeof baseResp !== 'object') return {};
    const { status_code: code, status_msg: message } = baseResp as {
      status_code?: unknown;
      status_msg?: unknown;
    };
    return {
      code: typeof code === 'number' ? code : undefined,
      message: typeof message === 'string' ? message : undefined,
    };
  }
}
