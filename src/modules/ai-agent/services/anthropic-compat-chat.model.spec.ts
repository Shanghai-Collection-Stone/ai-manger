import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage } from '@langchain/core/messages';
import { AnthropicCompatChatModel } from './anthropic-compat-chat.model';

type Completion = (...args: unknown[]) => Promise<unknown>;

const OK_RESPONSE = {
  id: 'msg_ok',
  type: 'message',
  role: 'assistant',
  model: 'MiniMax-M3',
  content: [{ type: 'text', text: '你好' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 3, output_tokens: 2 },
};

/**
 * @description 构造 MiniMax 业务失败时的 200 响应:content 为 null,状态放在 base_resp。
 * @keyword-cn 空内容响应, 测试替身
 * @keyword-en null-content-response, test-double
 */
function nullContentResponse(statusCode?: number) {
  return {
    ...OK_RESPONSE,
    content: null,
    stop_reason: null,
    ...(statusCode === undefined
      ? {}
      : { base_resp: { status_code: statusCode, status_msg: 'mocked' } }),
  };
}

/**
 * @description 把父类 completionWithRetry 换成按顺序返回给定响应的桩。
 * @keyword-cn 父类请求桩, 测试替身
 * @keyword-en parent-completion-stub, test-double
 */
function stubParentCompletion(...responses: unknown[]) {
  const proto = ChatAnthropic.prototype as unknown as {
    completionWithRetry: Completion;
  };
  const spy = jest.spyOn(proto, 'completionWithRetry');
  for (const response of responses) spy.mockResolvedValueOnce(response);
  return spy;
}

/**
 * @description 构造非流式的兼容层模型实例。
 * @keyword-cn 构造测试模型
 * @keyword-en build-test-model
 */
function buildModel() {
  return new AnthropicCompatChatModel({
    model: 'MiniMax-M3',
    apiKey: 'test-key',
    streaming: false,
  });
}

describe('AnthropicCompatChatModel', () => {
  afterEach(() => jest.restoreAllMocks());

  it('content 正常时直接返回,不补发', async () => {
    const spy = stubParentCompletion(OK_RESPONSE);
    const result = await buildModel().invoke([new HumanMessage('hi')]);
    expect(result.content).toBe('你好');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('content 为 null 时补发,拿到正常响应后返回', async () => {
    const spy = stubParentCompletion(nullContentResponse(1027), OK_RESPONSE);
    const result = await buildModel().invoke([new HumanMessage('hi')]);
    expect(result.content).toBe('你好');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('持续为空时补发 2 次后抛 AI_PROVIDER_EMPTY_RESPONSE,而不是 TypeError', async () => {
    const spy = stubParentCompletion(
      nullContentResponse(),
      nullContentResponse(),
      nullContentResponse(),
    );
    await expect(buildModel().invoke([new HumanMessage('hi')])).rejects.toThrow(
      /^AI_PROVIDER_EMPTY_RESPONSE:/,
    );
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('输入违规(1026)等补发也不会变的状态不补发,错误里带状态码', async () => {
    const spy = stubParentCompletion(nullContentResponse(1026));
    await expect(buildModel().invoke([new HumanMessage('hi')])).rejects.toThrow(
      /status=1026/,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
