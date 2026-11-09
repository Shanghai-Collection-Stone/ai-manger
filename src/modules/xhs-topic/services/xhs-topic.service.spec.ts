import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { OutputParserException } from '@langchain/core/output_parsers';
import type { RunnableConfig } from '@langchain/core/runnables';
import { BaseChatOpenAI, ChatOpenAI } from '@langchain/openai';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { XhsTopicCandidate } from '../entities/xhs-topic.entity.js';
import {
  normalizeRequirementRecommendation,
  parseStructuredSubmission,
  recordTopicCandidates,
  XhsTopicService,
} from './xhs-topic.service.js';

describe('recordTopicCandidates', () => {
  it('一次交付全部候选时逐条写入并带上文章风格', () => {
    const candidates: XhsTopicCandidate[] = [];
    const result = recordTopicCandidates(
      candidates,
      [
        { title: '  周末  城市漫步路线 ', topic_type: '城市观察' },
        { title: '一个人吃火锅的勇气', topic_type: '情绪共鸣' },
      ],
      2,
      '第一人称口语',
    );
    expect(result).toEqual({ recorded: 2, problems: [] });
    expect(candidates).toEqual([
      {
        title: '周末 城市漫步路线',
        topicType: '城市观察',
        articleStyle: '第一人称口语',
      },
      {
        title: '一个人吃火锅的勇气',
        topicType: '情绪共鸣',
        articleStyle: '第一人称口语',
      },
    ]);
  });

  it('单条不合格只跳过该条并说明原因，不连累整批', () => {
    const candidates: XhsTopicCandidate[] = [
      { title: '已有题目', topicType: '生活指南' },
    ];
    const result = recordTopicCandidates(
      candidates,
      [
        { title: '已有题目', topic_type: '生活指南' },
        { title: '新题目', topic_type: '' },
        { title: '另一个新题目', topicType: '趋势讨论' },
      ],
      5,
    );
    expect(result.recorded).toBe(1);
    expect(result.problems).toEqual([
      '《已有题目》与已有题目重复',
      '《新题目》题目或题目类型少于 2 个字',
    ]);
    expect(candidates.map((item) => item.title)).toEqual([
      '已有题目',
      '另一个新题目',
    ]);
  });

  it('超出目标数量的忽略，JSON 字符串也能解析', () => {
    const candidates: XhsTopicCandidate[] = [];
    const result = recordTopicCandidates(
      candidates,
      JSON.stringify([
        { title: '题目一', topic_type: '生活指南' },
        { title: '题目二', topic_type: '生活指南' },
      ]),
      1,
    );
    expect(result.recorded).toBe(1);
    expect(result.problems).toEqual(['《题目二》超出目标数量，已忽略']);
  });

  it('参数不是数组时整批不记录并给出原因', () => {
    const candidates: XhsTopicCandidate[] = [];
    expect(recordTopicCandidates(candidates, '不是 JSON', 3)).toEqual({
      recorded: 0,
      problems: ['candidates 不是合法的 JSON 数组'],
    });
    expect(recordTopicCandidates(candidates, { title: 'x' }, 3)).toEqual({
      recorded: 0,
      problems: ['candidates 必须是数组'],
    });
    expect(candidates).toEqual([]);
  });
});

describe('normalizeRequirementRecommendation', () => {
  const options = {
    purposes: ['攻略教程', '种草推荐'],
    personas: ['打工人', '宝妈'],
    styles: ['第一人称', '真实体验', '干货清单'],
    lengths: ['不限', '300字左右'],
  };

  it('合格交付原样收下', () => {
    const { result, problems } = normalizeRequirementRecommendation(
      {
        purpose: '攻略教程',
        persona: '打工人',
        styleTags: ['第一人称', '干货清单'],
        keywords: ['上海', '周末'],
        length: '300字左右',
        idea: '用一天的时间线讲清楚怎么玩',
      },
      options,
    );
    expect(problems).toEqual([]);
    expect(result).toEqual({
      purpose: '攻略教程',
      persona: '打工人',
      styleTags: ['第一人称', '干货清单'],
      keywords: ['上海', '周末'],
      length: '300字左右',
      idea: '用一天的时间线讲清楚怎么玩',
    });
  });

  it('近似值、分隔符串与井号都能归一，长度缺省回落不限', () => {
    const { result, problems } = normalizeRequirementRecommendation(
      {
        purpose: ' 攻略 ',
        persona: '打工人。',
        styleTags: '#真实体验，干货清单、不存在的风格',
        keywords: '#上海 周末,  ,一个人',
        length: '800字',
        idea: '  从房间收纳切入  ',
      },
      options,
    );
    expect(problems).toEqual([]);
    expect(result.purpose).toBe('攻略教程');
    expect(result.persona).toBe('打工人');
    expect(result.styleTags).toEqual(['真实体验', '干货清单']);
    expect(result.keywords).toEqual(['上海 周末', '一个人']);
    expect(result.length).toBe('不限');
    expect(result.idea).toBe('从房间收纳切入');
  });

  it('越界的值丢弃并说明原因，供重试提示词使用', () => {
    const { result, problems } = normalizeRequirementRecommendation(
      { purpose: '随便写写', persona: '', styleTags: ['不存在'] },
      options,
    );
    expect(result.purpose).toBe('');
    expect(result.styleTags).toEqual([]);
    expect(problems).toEqual([
      'purpose 必须逐字取自：攻略教程、种草推荐',
      'persona 必须逐字取自：打工人、宝妈',
      'styleTags 至少从 styles 候选里逐字选 1 项',
      'keywords 至少给 2 个具体关键词',
      'idea 不能为空，用一句话写清切入角度',
    ]);
  });
});

/**
 * @description 创建不连接模型与数据库的一键推荐测试环境，保留独立的工具交付与纯 JSON 调用记录。
 * @keyword-cn 推荐回归测试, 空响应重试
 * @keyword-en recommendation-regression, empty-response-retry
 */
function createRequirementRecommendationHarness() {
  const structuredInvoke = jest.fn<
    Promise<{ raw: AIMessage; parsed: Record<string, unknown> | null }>,
    [BaseMessage[], RunnableConfig]
  >();
  const llm = {
    withStructuredOutput: jest
      .fn()
      .mockReturnValue({ invoke: structuredInvoke }),
    invoke: jest.fn<Promise<AIMessage>, [BaseMessage[], RunnableConfig]>(),
  };
  const admin = {
    getTenantPlatformAiPromptSupplement: jest
      .fn()
      .mockResolvedValue('平台说明'),
  };
  const agent = {
    buildLLM: jest.fn().mockResolvedValue(llm),
    buildNoStreamInvokeOption: jest
      .fn()
      .mockReturnValue({ callbacks: [], tags: ['nostream'] }),
  };
  const workflowModels = {
    resolveNodeRuntime: jest.fn().mockResolvedValue(null),
  };
  const repository = {
    getOwnedTopic: jest
      .fn()
      .mockResolvedValueOnce({
        id: 784,
        kind: 'child',
        parentId: 12,
        title: '上海周末城市漫步路线',
        articleStyle: '第一人称真实体验',
      })
      .mockResolvedValueOnce({ id: 12, kind: 'mother', title: '城市漫步' }),
  };
  const service = new XhsTopicService(
    ...([
      admin,
      agent,
      {},
      {},
      workflowModels,
      repository,
      {},
    ] as unknown as ConstructorParameters<typeof XhsTopicService>),
  );
  return { service, llm, structuredInvoke, agent, repository };
}

describe('parseStructuredSubmission', () => {
  it('正文为空但指定工具已提交参数时直接读取参数', () => {
    expect(
      parseStructuredSubmission(
        new AIMessage({
          content: '',
          tool_calls: [
            { name: 'other_tool', args: { ignored: true } },
            { name: 'submit', args: { purpose: '攻略教程' } },
          ],
        }),
        'submit',
      ),
    ).toEqual({ purpose: '攻略教程' });
  });

  it('兼容旧式 function_call 参数', () => {
    expect(
      parseStructuredSubmission(
        new AIMessage({
          content: '',
          additional_kwargs: {
            function_call: {
              name: 'submit',
              arguments: '{"purpose":"攻略教程"}',
            },
          },
        }),
        'submit',
      ),
    ).toEqual({ purpose: '攻略教程' });
  });

  it('只读取文本块，接受完整的 JSON 代码围栏', () => {
    expect(
      parseStructuredSubmission(
        new AIMessage({
          content: [
            { type: 'reasoning', reasoning: '内部思考' },
            { type: 'text', text: '```json\n{"purpose":' },
            { type: 'text', text: '"攻略教程"}\n```' },
          ],
        }),
        'submit',
      ),
    ).toEqual({ purpose: '攻略教程' });
  });

  it('真正空响应报告停止原因与损坏工具调用数量', () => {
    const message = new AIMessage({
      content: '',
      response_metadata: { finish_reason: 'length' },
      invalid_tool_calls: [{ name: 'submit', args: '{"purpose":' }],
    });
    expect(() => parseStructuredSubmission(message, 'submit')).toThrow(
      OutputParserException,
    );
    expect(() => parseStructuredSubmission(message, 'submit')).toThrow(
      'AI_STRUCTURED_OUTPUT_EMPTY: 模型未返回交付参数或 JSON 正文 (tool=submit finishReason=length invalidToolCalls=1)',
    );
  });

  it('拒绝损坏或被截断的 JSON，交给外层重试', () => {
    expect(() =>
      parseStructuredSubmission(
        new AIMessage('{"purpose":"攻略教程"'),
        'submit',
      ),
    ).toThrow('AI_STRUCTURED_OUTPUT_INVALID_JSON');
  });

  it.each(['null', '[]', '"攻略教程"', '12'])(
    '拒绝非对象交付 %s',
    (content) => {
      expect(() =>
        parseStructuredSubmission(new AIMessage(content), 'submit'),
      ).toThrow('AI_STRUCTURED_OUTPUT_INVALID_OBJECT');
    },
  );
});

describe('XhsTopicService.recommendArticleRequirements', () => {
  let warn: jest.SpyInstance;
  const scope = { tenantId: 'tenant-1', userId: 'user-1' };
  const options = {
    purposes: ['攻略教程', '种草推荐'],
    personas: ['打工人', '宝妈'],
    styles: ['第一人称', '真实体验', '干货清单'],
    lengths: ['不限', '300字左右'],
  };
  const recommendation = {
    purpose: '攻略教程',
    persona: '打工人',
    styleTags: ['第一人称', '真实体验', '干货清单'],
    keywords: ['上海', '周末', '城市漫步'],
    length: '300字左右',
    idea: '按一天的时间线介绍城市漫步路线',
  };

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('工具提交成功只调用一次，关闭思考且保留流式计费与作用域', async () => {
    const { service, llm, structuredInvoke, agent, repository } =
      createRequirementRecommendationHarness();
    structuredInvoke.mockResolvedValue({
      parsed: recommendation,
      raw: new AIMessage(''),
    });

    await expect(
      service.recommendArticleRequirements(784, options, scope),
    ).resolves.toEqual(recommendation);
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(llm.invoke).not.toHaveBeenCalled();
    expect(llm.withStructuredOutput).toHaveBeenCalledWith(expect.any(Object), {
      name: 'xhs_requirement_submit',
      method: 'functionCalling',
      includeRaw: true,
    });
    expect(agent.buildLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        disableThinking: true,
        nonStreaming: false,
        tenantId: scope.tenantId,
        billingContext: {
          ...scope,
          source: 'xhs-topic.requirement-recommendation',
          platformScope: false,
        },
      }),
    );
    expect(repository.getOwnedTopic).toHaveBeenNthCalledWith(1, 784, scope);
    expect(repository.getOwnedTopic).toHaveBeenNthCalledWith(2, 12, scope);
  });

  it('解析器拿不到参数时兼容模型已返回的 JSON 正文，无需补发', async () => {
    const { service, structuredInvoke, llm } =
      createRequirementRecommendationHarness();
    structuredInvoke.mockResolvedValue({
      parsed: null,
      raw: new AIMessage(JSON.stringify(recommendation)),
    });
    await expect(
      service.recommendArticleRequirements(784, options, scope),
    ).resolves.toEqual(recommendation);
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it('首轮空响应后改用纯 JSON，仍传上下文、候选约束与内部调用选项', async () => {
    const { service, structuredInvoke, llm } =
      createRequirementRecommendationHarness();
    structuredInvoke.mockResolvedValue({
      parsed: null,
      raw: new AIMessage(''),
    });
    llm.invoke.mockResolvedValue(new AIMessage(JSON.stringify(recommendation)));

    await expect(
      service.recommendArticleRequirements(784, options, scope),
    ).resolves.toEqual(recommendation);
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(llm.invoke).toHaveBeenCalledTimes(1);
    const [messages, invokeOption] = llm.invoke.mock.calls[0];
    expect(messages[0].content).toContain(
      '直接返回一个完整 JSON 对象，不调用工具',
    );
    expect(messages[0].content).toContain('"enum":["攻略教程","种草推荐"]');
    expect(messages[0].content).toContain('平台说明');
    expect(messages[0].content).not.toContain('请调用 xhs_requirement_submit');
    expect(messages[1].content).toContain('第一人称真实体验');
    expect(messages[1].content).toContain('上海周末城市漫步路线');
    expect(invokeOption).toEqual({ callbacks: [], tags: ['nostream'] });
  });

  it('工具参数损坏抛出解析异常时也切换纯 JSON', async () => {
    const { service, structuredInvoke, llm } =
      createRequirementRecommendationHarness();
    structuredInvoke.mockRejectedValue(
      new OutputParserException('invalid args'),
    );
    llm.invoke.mockResolvedValue(new AIMessage(JSON.stringify(recommendation)));
    await expect(
      service.recommendArticleRequirements(784, options, scope),
    ).resolves.toEqual(recommendation);
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(llm.invoke).toHaveBeenCalledTimes(1);
  });

  it('字段越界仍带原因重试工具交付，第二轮空响应保留安全的部分推荐', async () => {
    const { service, structuredInvoke, llm } =
      createRequirementRecommendationHarness();
    structuredInvoke
      .mockResolvedValueOnce({
        parsed: { ...recommendation, purpose: '非法选项', persona: '非法人设' },
        raw: new AIMessage(''),
      })
      .mockResolvedValueOnce({ parsed: null, raw: new AIMessage('') });
    await expect(
      service.recommendArticleRequirements(784, options, scope),
    ).resolves.toEqual({ ...recommendation, purpose: '', persona: '' });
    expect(structuredInvoke).toHaveBeenCalledTimes(2);
    expect(structuredInvoke.mock.calls[1][0][0].content).toContain(
      'purpose 必须逐字取自：攻略教程、种草推荐',
    );
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it('两次都为空时返回明确失败，只发两次且不伪造推荐', async () => {
    const { service, structuredInvoke, llm } =
      createRequirementRecommendationHarness();
    structuredInvoke.mockResolvedValue({
      parsed: null,
      raw: new AIMessage(''),
    });
    llm.invoke.mockResolvedValue(
      new AIMessage({
        content: '',
        response_metadata: { finish_reason: 'length' },
      }),
    );
    const error = await service
      .recommendArticleRequirements(784, options, scope)
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      code: 'XHS_REQUIREMENT_RECOMMEND_FAILED',
      message: '生成需求推荐失败，请稍后重试',
    });
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(llm.invoke).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('finishReason=length'),
    );
  });

  it('真实 LangChain 流式工具调用正文为空也能交付参数', async () => {
    const { service, agent } = createRequirementRecommendationHarness();
    const chunks = [
      {
        id: 'chatcmpl-test',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  index: 0,
                  id: 'call-test',
                  type: 'function',
                  function: {
                    name: 'xhs_requirement_submit',
                    arguments: JSON.stringify(recommendation),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-test',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      },
    ];
    const fetch = jest
      .fn<
        ReturnType<typeof globalThis.fetch>,
        Parameters<typeof globalThis.fetch>
      >()
      .mockResolvedValue(
        new Response(
          chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
            'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const model = new ChatOpenAI({
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      streaming: true,
      configuration: { fetch },
    });
    // SDK 流式 invoke 还会估算 Token；隔离分词字典下载，测试只验证响应解析。
    jest.spyOn(BaseChatOpenAI.prototype, 'getNumTokens').mockResolvedValue(1);
    agent.buildLLM.mockResolvedValue(model);

    await expect(
      service.recommendArticleRequirements(784, options, scope),
    ).resolves.toEqual(recommendation);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request: unknown = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(request).toMatchObject({
      stream: true,
      tool_choice: { function: { name: 'xhs_requirement_submit' } },
      tools: [
        {
          function: {
            parameters: {
              properties: {
                purpose: { enum: options.purposes },
              },
            },
          },
        },
      ],
    });
  });
});
