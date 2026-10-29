import type { DouyinPersonaView } from '../../douyin-persona/entities/douyin-persona.entity.js';
import type { DouyinStoreVisitSpot } from '../entities/douyin-store-visit-store.entity.js';
import { COSYVOICE_PRESET_VOICES } from './douyin-cosyvoice.service.js';
import {
  DouyinStoreVisitPlannerService,
  buildStoreVisitSceneCatalog,
  describeStoreVisitSpotCatalog,
  guessStoreVisitSceneSpot,
  parseStoreVisitReviewIssues,
  parseStoreVisitSceneMatches,
  parseStoreVisitScript,
  pickStoreVisitRecommendation,
  reviewStoreVisitScriptRules,
} from './douyin-store-visit-planner.service.js';

/**
 * @description 造一个点位：图片按给定 ID 与分数生成描述。
 * @keyword-cn 测试点位, 点位工厂
 * @keyword-en test-spot, spot-factory
 */
function spot(
  id: string,
  name: string,
  images: Array<[number, number]>,
  extra: Partial<DouyinStoreVisitSpot> = {},
): DouyinStoreVisitSpot {
  return {
    id,
    name,
    description: `${name}说明`,
    images: images.map(([imageId, score]) => ({
      imageId,
      url: `https://oss.example.com/${imageId}.jpg`,
      description: `${name}图${imageId}`,
      score,
    })),
    videos: [],
    updatedAt: new Date(0),
    ...extra,
  };
}

/**
 * @description 造一个规划服务：选题仓储、门店、人物、引用知识与模型调用都用桩。
 * @keyword-cn 测试规划服务, 依赖桩
 * @keyword-en test-planner-service, dependency-stubs
 */
function plannerWith(input: {
  topic: Record<string, unknown>;
  mother?: Record<string, unknown>;
  store?: Record<string, unknown>;
  stores?: unknown[];
  personas?: unknown[];
  knowledge?: string;
  runWithMessages: jest.Mock;
}) {
  const get = jest.fn((id: number) =>
    Promise.resolve(id === input.topic.id ? input.topic : input.mother),
  );
  const list = jest.fn().mockResolvedValue(input.personas ?? []);
  const buildPromptSection = jest.fn().mockResolvedValue(input.knowledge ?? '');
  const service = new DouyinStoreVisitPlannerService(
    { get } as never,
    {
      requireStore: jest
        .fn()
        .mockResolvedValue(
          input.store ?? {
            id: 701,
            name: '欢乐谷',
            description: '',
            spots: [],
          },
        ),
      listStores: jest.fn().mockResolvedValue(input.stores ?? []),
    } as never,
    { list, get: jest.fn().mockResolvedValue(null) } as never,
    { resolveNodeRuntime: jest.fn().mockResolvedValue(null) } as never,
    { runWithMessages: input.runWithMessages } as never,
    { buildPromptSection } as never,
  );
  return { service, list, buildPromptSection };
}

describe('store visit scene catalog', () => {
  it('开场点位排第一，每个点位按分数取最多 4 张图，只有视频的点位带第一段视频，空点位去掉', () => {
    const catalog = buildStoreVisitSceneCatalog([
      spot('ride', '旋转木马', [
        [1, 6],
        [2, 9],
        [4, 3],
        [5, 7],
        [6, 8],
      ]),
      spot('gate', '门头', [[3, 8]], { opening: true }),
      spot('empty', '空点位', []),
      spot('show', '演出', [], {
        videos: [
          { videoId: 31, name: '演出实拍', description: '晚上的演出', url: '' },
          { videoId: 32, name: '演出 2', description: '', url: '' },
        ] as never,
      }),
    ]);
    expect(catalog.map((entry) => [entry.index, entry.spot.id])).toEqual([
      [1, 'gate'],
      [2, 'ride'],
      [3, 'show'],
    ]);
    expect(catalog[1].images.map((image) => image.imageId)).toEqual([
      2, 6, 5, 1,
    ]);
    expect(catalog[2].videoIds).toEqual([31]);
    const text = describeStoreVisitSpotCatalog(catalog);
    expect(text).toContain('【点位1】门头（开场·门头）：门头说明');
    expect(text).toContain('图2.1（9 分）：旋转木马图2');
    expect(text).toContain('实拍视频：晚上的演出');
  });

  it('按模型给的点位与图片配场景：图片只认这个点位的编号，人物出镜段用门头 1 张，漏段按名字猜点位', () => {
    const catalog = buildStoreVisitSceneCatalog([
      spot('gate', '门头', [[3, 8]], { opening: true }),
      spot('ride', '旋转木马', [
        [1, 6],
        [2, 9],
      ]),
      spot('kart', '卡丁车', [[7, 8]]),
    ]);
    const segments = [
      { id: 's1', lines: '今天来到欢乐谷', scene: '门头', shot: 'presenter' },
      { id: 's2', lines: '旋转木马小朋友最爱', scene: '旋转木马' },
      { id: 's3', lines: '卡丁车一脚油门冲出去', scene: '卡丁车赛道' },
      { id: 's4', lines: '点左下角下单', scene: '门头招牌' },
    ];
    const result = parseStoreVisitSceneMatches(
      JSON.stringify({
        segments: [
          { segment: 1, spot: 2, images: ['2.1', '2.2'] },
          { segment: 2, spot: 2, images: ['2.2', '2.1', '1.1', '2.9'] },
          { segment: 4, spot: 9, images: ['9.1'] },
        ],
      }),
      catalog,
      segments,
    );
    expect(result).toEqual([
      { id: 's1', spotId: 'ride', sceneImageId: 2 },
      { id: 's2', spotId: 'ride', sceneImageId: 1, sceneImageIds: [1, 2] },
      { id: 's3', spotId: 'kart', sceneImageId: 7 },
      { id: 's4', spotId: 'gate', sceneImageId: 3 },
    ]);
  });

  it('模型失败时全部按规则兜底：第 1 段用门头，其余段在非门头点位里轮换，只有视频的点位用视频', () => {
    const catalog = buildStoreVisitSceneCatalog([
      spot('gate', '门头', [[3, 8]], { opening: true }),
      spot('show', '演出', [], {
        videos: [
          { videoId: 31, name: '演出', description: '', url: '' },
        ] as never,
      }),
    ]);
    const result = parseStoreVisitSceneMatches('', catalog, [
      { id: 's1', lines: '开场', shot: 'presenter' },
      { id: 's2', lines: '再来看看' },
    ]);
    expect(result).toEqual([
      { id: 's1', spotId: 'gate', sceneImageId: 3 },
      { id: 's2', spotId: 'show', sceneVideoId: 31 },
    ]);
    expect(
      guessStoreVisitSceneSpot({ lines: '门头好看' }, catalog, 1).spot.id,
    ).toBe('gate');
  });
});

describe('store visit script parsing and review', () => {
  it('解析带代码块围栏的脚本 JSON，去掉空台词段，读出是否出镜', () => {
    const draft = parseStoreVisitScript(
      '```json\n{"presenter":true,"personaId":7,"segments":[{"scene":" 门头 招牌 ","lines":"今天来到\\n欢乐谷"},{"scene":"空","lines":"  "}]}\n```',
    );
    expect(draft.presenter).toBe(true);
    expect(draft.raw.personaId).toBe(7);
    expect(draft.segments).toEqual([
      { scene: '门头 招牌', lines: '今天来到 欢乐谷' },
    ]);
    expect(parseStoreVisitScript('不是 JSON')).toEqual({
      presenter: undefined,
      raw: {},
      segments: [],
    });
  });

  it('自检问题带段号，超出段数的丢掉，整条问题不带段号', () => {
    expect(
      parseStoreVisitReviewIssues(
        '{"issues":[{"segment":2,"problem":"价格和引用知识不一致"},{"segment":0,"problem":"结尾没引导下单"},{"segment":9,"problem":"不存在"}]}',
        3,
      ),
    ).toEqual(['第 2 段：价格和引用知识不一致', '结尾没引导下单']);
  });

  it('规则核对：资料里没有的数字、开场没报店名、整条太短', () => {
    const issues = reviewStoreVisitScriptRules({
      segments: [{ lines: '来玩吧，团购 88 元' }],
      facts: '欢乐谷 团购 99 元',
      storeName: '欢乐谷',
    });
    expect(issues.some((issue) => issue.includes('「88」'))).toBe(true);
    expect(
      issues.some((issue) => issue.includes('第 1 段没有说出门店名称')),
    ).toBe(true);
    expect(issues.some((issue) => issue.includes('偏短'))).toBe(true);
  });
});

describe('store visit plan recommendation', () => {
  const personas = [
    {
      id: 7,
      name: '小雅',
      voice: { gender: 'female', age: 'young', pace: 'fast' },
    },
    {
      id: 8,
      name: '阿强',
      voice: { gender: 'male', age: 'adult', pace: 'normal' },
    },
  ] as unknown as DouyinPersonaView[];

  it('采用模型选的人物与音色，声音描述跟着人物声线走', () => {
    const voice = COSYVOICE_PRESET_VOICES[1];
    const result = pickStoreVisitRecommendation(
      {
        personaId: 8,
        personaReason: '豪爽',
        voiceId: voice.voiceId,
        voiceReason: '有劲',
      },
      { personas, voices: COSYVOICE_PRESET_VOICES, presenter: true },
    );
    expect(result.persona).toEqual({
      personaId: 8,
      name: '阿强',
      reason: '豪爽',
    });
    expect(result.voice.voiceId).toBe(voice.voiceId);
    expect(result.voice.voicePrompt).toContain('男声');
  });

  it('不出镜时不挑人物；模型乱填音色时按活力种草兜底', () => {
    const result = pickStoreVisitRecommendation(
      { personaId: 7, voiceId: 'nope' },
      { personas, voices: COSYVOICE_PRESET_VOICES, presenter: false },
    );
    expect(result.persona).toBeNull();
    expect(
      COSYVOICE_PRESET_VOICES.find(
        (item) => item.voiceId === result.voice.voiceId,
      )?.category,
    ).toBe('lively');
    expect(result.voice.reason).toBe('适合探店种草的口播');
  });
});

describe('store visit script writing', () => {
  const persona = {
    id: 42,
    name: '小林',
    summary: '咖啡爱好者',
    voice: { gender: 'female', age: 'young', pace: 'normal' },
    referenceImages: [{ imageId: 31, url: 'https://oss.example.com/31.jpg' }],
  };
  const script = {
    script:
      '主题：欢乐谷亲子乐园的周末游玩推荐。开场：门头实拍，引出室内亲子乐园定位。中段：以卡丁车为主卖点，说明双人套餐 99 元；拍摄卡丁车与休息区，避免编造体验。结尾：提醒观众查看团购套餐并下单。',
    presenter: true,
    personaId: 42,
    personaReason: '人设最搭',
    voiceId: COSYVOICE_PRESET_VOICES[0].voiceId,
    voiceReason: '活泼',
    segments: [
      {
        scene: '门头招牌',
        lines:
          '今天我们来到了欢乐谷，一家室内亲子乐园，蹦床、滑梯、卡丁车一次玩个够，周末遛娃特别合适。',
      },
      {
        scene: '卡丁车',
        lines:
          '卡丁车双人套餐抖音团购 99 元，一脚油门就冲出去，约上朋友比比谁跑得更快，特别解压。',
      },
      {
        scene: '休息区',
        lines:
          '玩累了还能在休息区坐坐，大人歇歇脚，孩子就在眼前玩，想来的点左下角就能下单。',
      },
    ],
  };

  it('第一次写脚本：看母选题的引用知识写分段脚本并定出镜、人物与音色，写完对照引用知识自检', async () => {
    const runWithMessages = jest
      .fn()
      .mockResolvedValueOnce({ content: JSON.stringify(script) })
      .mockResolvedValueOnce({
        content:
          '{"issues":[{"segment":2,"problem":"引用知识要求说清营业时间"}]}',
      });
    const { service, buildPromptSection } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        parentId: 1,
        title: '欢乐谷探店',
        storeVisit: { storeId: 701 },
      },
      mother: {
        id: 1,
        kind: 'mother',
        title: '欢乐谷',
        knowledgeIds: ['a'.repeat(24)],
      },
      personas: [persona, { ...persona, id: 43, referenceImages: [] }],
      knowledge:
        '<reference_knowledge>【价格】卡丁车双人套餐 99 元</reference_knowledge>',
      runWithMessages,
    });
    const result = await service.writeScript(2, {}, { userId: 'u1' });
    expect(buildPromptSection).toHaveBeenCalledWith(['a'.repeat(24)], {
      userId: 'u1',
    });
    const writing = runWithMessages.mock.calls[0][0];
    expect(writing.config.system).toContain('【引用知识】');
    expect(writing.config.system).toContain('【讲卖点，不念画面】');
    expect(writing.config.system).toContain('"presenter"');
    expect(writing.messages[0].content).toContain('卡丁车双人套餐 99 元');
    expect(writing.messages[0].content).toContain('id=42｜小林');
    expect(writing.messages[0].content).not.toContain('id=43');
    expect(result).toMatchObject({
      presenter: true,
      persona: { personaId: 42, reason: '人设最搭' },
      voice: { voiceId: COSYVOICE_PRESET_VOICES[0].voiceId },
      script: script.script,
      review: {
        passed: false,
        knowledgeCount: 1,
        issues: ['第 2 段：引用知识要求说清营业时间'],
      },
    });
    expect(result).not.toHaveProperty('segments');
    expect(runWithMessages.mock.calls[1][0].config.system).toContain(
      '对照【引用知识】',
    );
  });

  it('按自检意见改：沿用当前出镜与人物，只改台词，把上一版和问题交给模型；格式不对重试一次', async () => {
    const runWithMessages = jest
      .fn()
      .mockResolvedValueOnce({ content: '好的，我来改' })
      .mockResolvedValueOnce({
        content: JSON.stringify({ script: script.script }),
      })
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service, list } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '欢乐谷探店',
        storeVisit: {
          storeId: 701,
          script:
            '上一版具体脚本：开场介绍欢乐谷门头，中段介绍卡丁车双人套餐 199 元并安排实拍，结尾引导查看团购。',
          template: 'voiceover',
          segments: [{ id: 'old', lines: '旧台词 199 元', scene: '门头' }],
        },
      },
      knowledge:
        '<reference_knowledge>【价格】卡丁车双人套餐 99 元</reference_knowledge>',
      runWithMessages,
    });
    const result = await service.writeScript(
      2,
      { issues: ['第 1 段：价格和引用知识不一致'] },
      { userId: 'u1' },
    );
    expect(list).not.toHaveBeenCalled();
    const retry = runWithMessages.mock.calls[1][0];
    expect(retry.config.system).not.toContain('"presenter"');
    expect(retry.messages[0].content).toContain('视频不露脸');
    expect(retry.messages[0].content).toContain(
      '上一版具体脚本：开场介绍欢乐谷门头',
    );
    expect(retry.messages[0].content).toContain(
      '- 第 1 段：价格和引用知识不一致',
    );
    expect(retry.messages[0].content).toContain('格式不对');
    expect(result).toEqual({
      presenter: false,
      script: script.script,
      review: { passed: true, knowledgeCount: 0, issues: [] },
    });
  });

  it('根据用户编辑并保存的脚本生成台词，保留独立正文和人物音色，带回来源快照', async () => {
    const edited =
      script.script + '\n用户修改：重点介绍卡丁车，结尾提醒查看营业时间。';
    const runWithMessages = jest
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({ segments: script.segments }),
      })
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service, list } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '欢乐谷',
        storeVisit: { storeId: 701, script: edited, template: 'voiceover' },
      },
      runWithMessages,
    });
    const result = await service.generateLines(
      2,
      { prompt: '自然一点' },
      { userId: 'u1' },
    );
    expect(runWithMessages.mock.calls[0][0].messages[0].content).toContain(
      edited,
    );
    expect(runWithMessages.mock.calls[0][0].config.system).toContain(
      '严格根据用户已确认的【脚本正文】',
    );
    expect(result).toMatchObject({
      segments: script.segments,
      linesScript: edited,
    });
    expect(result).not.toHaveProperty('voice');
    expect(list).not.toHaveBeenCalled();
  });

  it('没有独立脚本时拒绝生成台词，不调用模型；只有台词格式的脚本结果重试后仍拒绝', async () => {
    const runWithMessages = jest.fn().mockResolvedValue({
      content: JSON.stringify({ segments: script.segments }),
    });
    const { service } = plannerWith({
      topic: { id: 2, kind: 'child', storeVisit: { storeId: 701 } },
      runWithMessages,
    });
    await expect(
      service.generateLines(2, {}, { userId: 'u1' }),
    ).rejects.toThrow('请先生成或填写脚本正文');
    expect(runWithMessages).not.toHaveBeenCalled();
    await expect(service.writeScript(2, {}, { userId: 'u1' })).rejects.toThrow(
      'AI 没写出具体脚本内容',
    );
    expect(runWithMessages).toHaveBeenCalledTimes(2);
  });

  it('正文自检读取保存后的脚本而不把旧台词当脚本', async () => {
    const runWithMessages = jest
      .fn()
      .mockResolvedValue({ content: '{"issues":[]}' });
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        storeVisit: {
          storeId: 701,
          script: script.script,
          segments: [{ lines: '不该参与正文审核的旧台词' }],
        },
      },
      runWithMessages,
    });
    await expect(
      service.reviewScript(2, { userId: 'u1' }),
    ).resolves.toMatchObject({ passed: true });
    expect(runWithMessages.mock.calls[0][0].messages[0].content).toContain(
      script.script,
    );
    expect(runWithMessages.mock.calls[0][0].messages[0].content).not.toContain(
      '不该参与正文审核的旧台词',
    );
  });

  it('脚本修改后台词未更新时拒绝配场景', async () => {
    const runWithMessages = jest.fn();
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        storeVisit: {
          storeId: 1,
          script: script.script,
          linesScript: '旧脚本',
        },
      },
      runWithMessages,
    });
    await expect(service.matchScenes(2, { userId: 'u1' })).rejects.toThrow(
      '请先根据当前脚本重新生成台词',
    );
    expect(runWithMessages).not.toHaveBeenCalled();
  });
});

describe('store visit store confirmation', () => {
  it('没选门店时先读取引用知识询问确认已有门店，不直接写脚本', async () => {
    const runWithMessages = jest
      .fn()
      .mockResolvedValue({
        content: JSON.stringify({
          question: '这条视频拍欢乐谷人民路店吗？',
          storeId: 701,
          name: '模型的简称',
          description: '模型的说明',
        }),
      });
    const { service } = plannerWith({
      topic: { id: 2, kind: 'child', title: '周末遛娃', storeVisit: {} },
      stores: [
        { id: 701, name: '欢乐谷人民路店', description: '人民路亲子乐园' },
      ],
      knowledge: '本次拍摄欢乐谷人民路店',
      runWithMessages,
    });
    const result = await service.writeScript(2, {}, { userId: 'u1' });
    expect(result).toMatchObject({
      needsStore: true,
      storeQuestion: {
        storeId: 701,
        name: '欢乐谷人民路店',
        description: '人民路亲子乐园',
      },
    });
    expect(result).not.toHaveProperty('script');
    expect(runWithMessages).toHaveBeenCalledTimes(1);
    expect(runWithMessages.mock.calls[0][0].messages[0].content).toContain(
      '本次拍摄欢乐谷人民路店',
    );
  });

  it('资料不明确时提出问题，不擅自选择仅有的一家门店；伪造ID不被采用', async () => {
    const runWithMessages = jest
      .fn()
      .mockResolvedValueOnce({
        content:
          '{"question":"准备拍哪家店、哪家分店？","storeId":null,"name":""}',
      })
      .mockResolvedValueOnce({
        content: '{"question":"请确认门店","storeId":999,"name":"新店"}',
      });
    const { service } = plannerWith({
      topic: { id: 2, kind: 'child', storeVisit: {} },
      stores: [{ id: 701, name: '现有门店' }],
      runWithMessages,
    });
    expect(await service.writeScript(2, {}, { userId: 'u1' })).toMatchObject({
      storeQuestion: { storeId: null, name: '' },
    });
    expect(await service.writeScript(2, {}, { userId: 'u1' })).toMatchObject({
      storeQuestion: { storeId: null, name: '新店' },
    });
  });

  it('AI询问失败时仍给出可填写的门店问题，手写脚本生成台词也要求先确定门店', async () => {
    const runWithMessages = jest.fn().mockRejectedValue(new Error('timeout'));
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        storeVisit: { script: '用户直接填写的脚本正文' },
      },
      runWithMessages,
    });
    expect(await service.writeScript(2, {}, { userId: 'u1' })).toMatchObject({
      needsStore: true,
      storeQuestion: { name: '', storeId: null },
    });
    await expect(
      service.generateLines(2, {}, { userId: 'u1' }),
    ).rejects.toThrow('请先在脚本步骤确认');
    expect(runWithMessages).toHaveBeenCalledTimes(1);
  });
});

describe('store visit scene matching', () => {
  it('按脚本从门店全部点位配图；模型挂了也按规则配上，不阻断', async () => {
    const runWithMessages = jest.fn().mockRejectedValue(new Error('timeout'));
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '欢乐谷探店',
        storeVisit: {
          storeId: 1,
          segments: [
            { id: 's1', lines: '今天来到欢乐谷', scene: '门头' },
            { id: 's2', lines: '卡丁车冲出去', scene: '卡丁车' },
          ],
        },
      },
      store: {
        id: 1,
        name: '欢乐谷',
        spots: [
          spot('kart', '卡丁车', [[7, 8]]),
          spot('gate', '门头', [[3, 8]], { opening: true }),
        ],
      },
      runWithMessages,
    });
    await expect(service.matchScenes(2, { userId: 'u1' })).resolves.toEqual({
      segments: [
        { id: 's1', spotId: 'gate', sceneImageId: 3 },
        { id: 's2', spotId: 'kart', sceneImageId: 7 },
      ],
    });
  });

  it('没选门店或门店没有点位时提示先去处理', async () => {
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: 'x',
        storeVisit: { segments: [{ id: 's1', lines: '台词' }] },
      },
      runWithMessages: jest.fn(),
    });
    await expect(service.matchScenes(2, { userId: 'u1' })).rejects.toThrow(
      '先选好门店',
    );
  });
});
