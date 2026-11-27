import type { DouyinPersonaView } from '../../douyin-persona/entities/douyin-persona.entity.js';
import type { DouyinStoreVisitSpot } from '../entities/douyin-store-visit-store.entity.js';
import { COSYVOICE_PRESET_VOICES } from './douyin-cosyvoice.service.js';
import {
  DouyinStoreVisitPlannerService,
  buildStoreVisitSceneCatalog,
  describeStoreVisitSpotCatalog,
  guessStoreVisitSceneSpot,
  isStoreVisitDialectAllowed,
  isStoreVisitStoreDetermined,
  parseStoreVisitReviewIssues,
  parseStoreVisitSceneMatches,
  parseStoreVisitScript,
  pickPersonaPresetVoice,
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
  materials?: unknown[];
  describeDraftMaterial?: jest.Mock;
  runWithMessages: jest.Mock;
}) {
  const get = jest.fn((id: number) =>
    Promise.resolve(id === input.topic.id ? input.topic : input.mother),
  );
  const list = jest.fn().mockResolvedValue(input.personas ?? []);
  const buildPromptSection = jest.fn().mockResolvedValue(input.knowledge ?? '');
  const loadCandidates = jest.fn().mockResolvedValue(input.materials ?? []);
  const describeDraftMaterial = input.describeDraftMaterial ?? jest.fn().mockResolvedValue('');
  const service = new DouyinStoreVisitPlannerService(
    { get } as never,
    {
      requireStore: jest.fn().mockResolvedValue(
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
    { loadCandidates } as never,
    { describeDraftMaterial } as never,
  );
  return { service, list, buildPromptSection, loadCandidates, describeDraftMaterial };
}

/**
 * @description 构造模型调用台词工具的返回消息，默认按测试镜头顺序编号。
 * @keyword-cn 测试台词提交, 模型工具消息
 * @keyword-en test-line-submission, model-tool-message
 */
function lineSubmission(
  updates: Array<{
    scene: string;
    lines: string;
    position?: number;
    delivery?: string;
    image?: number;
  }>,
) {
  return {
    content: '',
    tool_calls: [
      {
        name: 'update_store_visit_lines',
        args: {
          updates: updates.map((segment, index) => ({
            position: index + 1,
            ...segment,
          })),
        },
      },
    ],
  };
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
    expect(
      parseStoreVisitScript(
        '{"segments":[{"scene":"门头","lines":"今天来集合石！","delivery":" 热情打招呼，语调上扬 "}]}',
      ).segments,
    ).toEqual([
      {
        scene: '门头',
        lines: '今天来集合石！',
        delivery: '热情打招呼，语调上扬',
      },
    ]);
    expect(
      parseStoreVisitScript(
        '{"segments":[{"scene":"门头","lines":"今天来集合石！","delivery":"边推门边说，热络招呼，语调上扬"},{"scene":"吧台","lines":"来看看吧台","delivery":"推门进去"}]}',
      ).segments,
    ).toEqual([
      {
        scene: '门头',
        lines: '今天来集合石！',
        delivery: '热络招呼，语调上扬',
      },
      { scene: '吧台', lines: '来看看吧台' },
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
    const voice = COSYVOICE_PRESET_VOICES[0];
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

  it('模型选的音色和人物男女不一致，或是没人要求的方言音色时，按人物声线换掉', () => {
    const male = COSYVOICE_PRESET_VOICES.find(
      (item) => item.gender === 'male' && !item.dialect,
    )!;
    const mismatched = pickStoreVisitRecommendation(
      { personaId: 7, voiceId: male.voiceId, voiceReason: '有劲' },
      { personas, voices: COSYVOICE_PRESET_VOICES, presenter: true },
    );
    expect(
      COSYVOICE_PRESET_VOICES.find(
        (item) => item.voiceId === mismatched.voice.voiceId,
      ),
    ).toMatchObject({ gender: 'female' });
    expect(mismatched.voice.reason).toBe('和出镜人物的男女与声线一致');
    const dialect = pickStoreVisitRecommendation(
      { voiceId: 'longlaotie_v3', voicePrompt: '东北大哥' },
      { personas, voices: COSYVOICE_PRESET_VOICES, presenter: false },
    );
    expect(dialect.voice.voiceId).not.toBe('longlaotie_v3');
    expect(dialect.voice.voicePrompt).not.toContain('东北');
    expect(
      pickStoreVisitRecommendation(
        { voiceId: 'longlaotie_v3' },
        {
          personas,
          voices: COSYVOICE_PRESET_VOICES,
          presenter: false,
          hint: '用东北话讲',
        },
      ).voice.voiceId,
    ).toBe('longlaotie_v3');
  });
});

describe('persona preset voice', () => {
  const laotie = COSYVOICE_PRESET_VOICES.find(
    (item) => item.voiceId === 'longlaotie_v3',
  )!;

  it('方言音色只在要求里提到这种方言时才算被要求', () => {
    expect(isStoreVisitDialectAllowed(laotie, '')).toBe(false);
    expect(isStoreVisitDialectAllowed(laotie, '人设是东北大哥')).toBe(true);
    expect(isStoreVisitDialectAllowed(COSYVOICE_PRESET_VOICES[0], '')).toBe(
      true,
    );
  });

  it('按人物男女与声线挑音色，人物没写方言就不用方言，写了就用', () => {
    const pick = (voice: Record<string, unknown>, extra = {}) =>
      pickPersonaPresetVoice(
        { voice, ...extra } as unknown as DouyinPersonaView,
        COSYVOICE_PRESET_VOICES,
      );
    expect(
      pick({ gender: 'female', age: 'young', pace: 'fast' }),
    ).toMatchObject({ gender: 'female', category: 'lively' });
    expect(
      pick({ gender: 'male', age: 'mature', pace: 'normal' }),
    ).toMatchObject({ gender: 'male', category: 'steady' });
    expect(
      pick({ gender: 'female', age: 'adult', pace: 'normal', timbre: '温柔' }),
    ).toMatchObject({ gender: 'female', category: 'gentle' });
    expect(
      pick({ gender: 'male', age: 'adult', pace: 'normal' }).dialect,
    ).toBeUndefined();
    expect(
      pick(
        { gender: 'male', age: 'adult', pace: 'normal' },
        { summary: '豪爽的东北大哥' },
      ).voiceId,
    ).toBe('longlaotie_v3');
    expect(
      pick(
        { gender: 'female', age: 'adult', pace: 'normal' },
        { summary: '东北姑娘' },
      ).gender,
    ).toBe('female');
    expect(pickPersonaPresetVoice(null, COSYVOICE_PRESET_VOICES).dialect).toBe(
      undefined,
    );
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
    voiceId: COSYVOICE_PRESET_VOICES[1].voiceId,
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

  it('默认只写创作脚本，未选人物音色时不推荐声线，也不输出台词', async () => {
    const runWithMessages = jest
      .fn()
      .mockResolvedValueOnce({ content: JSON.stringify(script) })
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service, list } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '欢乐谷探店',
        storeVisit: { storeId: 701 },
      },
      personas: [persona],
      runWithMessages,
    });
    const result = await service.writeScript(2, {}, { userId: 'u1' });
    expect(result).toMatchObject({ script: script.script, presenter: false });
    expect(result).not.toHaveProperty('voice');
    expect(result).not.toHaveProperty('persona');
    expect(result).not.toHaveProperty('segments');
    expect(list).not.toHaveBeenCalled();
    expect(runWithMessages.mock.calls[0][0].config.system).toContain(
      '未指定人物或音色就保持未指定',
    );
  });

  it('新设定的脚本微调未完成时拒绝生成台词，不调用模型', async () => {
    const runWithMessages = jest.fn();
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '探店',
        storeVisit: {
          storeId: 701,
          script: script.script,
          scriptNeedsRefine: true,
        },
      },
      runWithMessages,
    });
    await expect(
      service.generateLines(2, {}, { userId: 'u1' }),
    ).rejects.toThrow('请先完成按新人物和音色微调脚本');
    expect(runWithMessages).not.toHaveBeenCalled();
  });

  it('显式要求 AI 推荐时写脚本并定出镜、人物与音色，写完对照引用知识自检', async () => {
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
    const result = await service.writeScript(
      2,
      { keepCast: false },
      { userId: 'u1' },
    );
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
      voice: { voiceId: COSYVOICE_PRESET_VOICES[1].voiceId },
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

  it('已经选好出镜人物时写脚本只给这个人物，模型挑别人也按它出镜', async () => {
    const runWithMessages = jest
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({ ...script, personaId: 44 }),
      })
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '欢乐谷探店',
        personaId: 42,
        storeVisit: { storeId: 701 },
      },
      personas: [{ ...persona, id: 44, name: '阿杰' }, persona],
      runWithMessages,
    });
    const result = await service.writeScript(
      2,
      { keepCast: false },
      { userId: 'u1' },
    );
    const writing = runWithMessages.mock.calls[0][0];
    expect(writing.messages[0].content).toContain('id=42｜小林');
    expect(writing.messages[0].content).not.toContain('id=44');
    expect(writing.config.system).toContain('方言音色（东北话、粤语）');
    expect(result).toMatchObject({ persona: { personaId: 42 } });
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
      .mockResolvedValueOnce(lineSubmission(script.segments))
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
      '脚本正文给出全片主题、已知事实和叙事走向',
    );
    expect(runWithMessages.mock.calls[0][0].requiredTool.name).toBe(
      'update_store_visit_lines',
    );
    expect(runWithMessages.mock.calls[0][0].config.system).toContain(
      '必须调用 update_store_visit_lines 一次来更新台词',
    );
    expect(runWithMessages.mock.calls[0][0].messages[0].content).toContain(
      '调用 update_store_visit_lines 一次更新 3～8 段台词',
    );
    expect(result).toMatchObject({
      segments: script.segments,
      linesScript: edited,
    });
    expect(result).not.toHaveProperty('voice');
    expect(list).not.toHaveBeenCalled();
  });

  it('只返回 JSON 或重复镜头编号时，不接受台词更新', async () => {
    const runWithMessages = jest.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ segments: script.segments }) })
      .mockResolvedValueOnce(lineSubmission(script.segments.map((segment) => ({ ...segment, position: 1 }))));
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        storeVisit: { start: 'script', script: script.script },
      },
      runWithMessages,
    });
    await expect(service.generateLines(2, {}, { userId: 'u1' })).rejects.toThrow(
      'AI 台词首轮校验失败。镜头编号不符',
    );
    expect(runWithMessages).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: '旧台词',
      reply: lineSubmission([{ scene: '改过的标题', lines: '原来的台词。' }]),
      reason: '镜头 1 的台词与原台词完全相同',
    },
    {
      label: '错误镜头编号',
      reply: lineSubmission([{ position: 2, scene: '改过的标题', lines: '新的台词。' }]),
      reason: '镜头编号不符，应提交 1，实际收到 2',
    },
    {
      label: '普通文本',
      reply: { content: '{"segments":[]}' },
      reason: '应调用台词工具 1 次，实际收到 0 次',
    },
    {
      label: '空台词字段',
      reply: lineSubmission([{ scene: '改过的标题', lines: ' ' }]),
      reason: '工具参数未通过校验，问题字段 updates.0.lines（too_small）',
    },
  ])('第二轮返回$label时报告具体原因', async ({ reply, reason }) => {
    const runWithMessages = jest.fn()
      .mockResolvedValueOnce(lineSubmission([{ scene: '改过的标题', lines: '原来的台词。' }]))
      .mockResolvedValueOnce(reply);
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        storeVisit: {
          start: 'script',
          script: script.script,
          segments: [{ id: 'shot', scene: '旧标题', lines: '原来的台词。' }],
        },
      },
      runWithMessages,
    });
    await expect(service.generateLines(2, {
      preserveSegments: true,
      refreshExisting: true,
    }, { userId: 'u1' })).rejects.toThrow(`AI 台词第二轮改写校验失败。${reason}。`);
    expect(runWithMessages).toHaveBeenCalledTimes(2);
  });

  it('从脚本开始：不选门店也能写脚本和生成台词，提示词换成通用短视频、画面从图库挑或 AI 生图', async () => {
    const runWithMessages = jest
      .fn()
      .mockResolvedValueOnce({ content: JSON.stringify(script) })
      .mockResolvedValueOnce({ content: '{"issues":[]}' })
      .mockResolvedValueOnce(lineSubmission(script.segments))
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service, list } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '孩子的生日会',
        storeVisit: { start: 'script', script: script.script },
      },
      personas: [persona],
      runWithMessages,
    });
    const written = await service.writeScript(2, {}, { userId: 'u1' });
    expect(written).not.toHaveProperty('needsStore');
    expect(written).toMatchObject({ script: script.script });
    const writing = runWithMessages.mock.calls[0][0].config.system as string;
    expect(writing).toContain('你是抖音短视频编导');
    expect(writing).not.toContain('探店');
    expect(writing).toContain('从图库挑图或 AI 生图');
    expect(list).not.toHaveBeenCalled();
    const lines = await service.generateLines(2, {}, { userId: 'u1' });
    expect(lines).toMatchObject({ segments: script.segments });
    const linesSystem = runWithMessages.mock.calls[2][0].config
      .system as string;
    expect(linesSystem).toContain('你是抖音短视频的口播编导');
    expect(linesSystem).toContain('从图库挑图或 AI 生图');
    expect(linesSystem).not.toContain('门店名称');
  });

  it('从脚本开始：先按选中的脚本方向在配图偏向标签内匹配素材，再让每段按选的素材图写画面和台词', async () => {
    const materials = [
      {
        id: 91,
        name: 'a.jpg',
        url: '/91.jpg',
        coverUrl: '/91s.jpg',
        tags: ['生日会'],
        description: '孩子们围着蛋糕',
        isPortrait: false,
      },
      {
        id: 92,
        name: 'b.jpg',
        url: '/92.jpg',
        coverUrl: '',
        tags: [],
        description: '派对布置全景',
        isPortrait: false,
      },
      {
        id: 93,
        name: 'c.jpg',
        url: '/93.jpg',
        coverUrl: '',
        tags: [],
        description: '吹蜡烛特写',
        isPortrait: false,
      },
    ];
    const runWithMessages = jest
      .fn()
      .mockResolvedValueOnce(lineSubmission([
            {
              image: 2,
              scene: '派对布置全景',
              lines: '给孩子办生日会，布置是第一印象！',
              delivery: '开门见山，语调上扬',
            },
            {
              image: 9,
              scene: '孩子围着蛋糕',
              lines: '蛋糕一端上来，孩子们全围过来了。',
              delivery: '轻快带笑',
            },
            {
              image: 3,
              scene: '吹蜡烛特写',
              lines: '许个愿吹蜡烛，这一刻最值得记住。',
              delivery: '温暖收尾',
            },
      ]))
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service, loadCandidates } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '孩子的生日会',
        storyboardPreference: {
          imageSource: 'gallery',
          galleryTags: ['生日会'],
        },
        storeVisit: { start: 'script', script: script.script },
      },
      materials,
      runWithMessages,
    });
    const lines = (await service.generateLines(2, {}, { userId: 'u1' })) as {
      segments: Array<{ sceneImageId?: number }>;
      sceneImages?: Array<{ id: number; description?: string }>;
    };
    expect(loadCandidates).toHaveBeenCalledWith(
      expect.stringContaining('孩子的生日会'),
      { userId: 'u1' },
      ['生日会'],
    );
    const call = runWithMessages.mock.calls[0][0];
    expect(call.config.system).toContain('【先看素材再设计分镜】');
    expect(call.messages[0].content).toContain(
      '图1：孩子们围着蛋糕（标签：生日会）',
    );
    // 第 2 段给了不存在的图 9，按相关度补一张还没用过的
    expect(lines.segments.map((segment) => segment.sceneImageId)).toEqual([
      92, 91, 93,
    ]);
    expect(lines.sceneImages?.map((image) => image.id)).toEqual([91, 92, 93]);
  });

  it('一次工具调用按各自素材更新不连续的镜头，保留中间的手改段', async () => {
    const runWithMessages = jest.fn().mockResolvedValueOnce(lineSubmission([
        { position: 3, scene: '门头检票入口', lines: '到检票口之前，先看看这家的团购。' },
        { position: 1, scene: '木桌区', lines: '先在木桌边聊两句，等会儿一起上赛道。' },
    ])).mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service, loadCandidates } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '周末活动',
        storeVisit: {
          start: 'script',
          script: '开场介绍卡丁车，结尾提醒查看团购。',
          linesScript: '开场介绍卡丁车，结尾提醒查看团购。',
          segments: [
            { id: 'video', lines: '这里的卡丁车很好玩。', sceneVideoId: 20, manualMaterial: true },
            { id: 'manual', lines: '原样保留。', manualLines: true },
            { id: 'photos', lines: '这里有咖啡。', sceneImageIds: [21, 22] },
          ],
          sceneVideos: [{ id: 20, name: '店里实拍', description: '视频封面是一排木桌' }],
          sceneImages: [
            { id: 21, name: '门头', description: '门口招牌' },
            { id: 22, name: '另一角度', description: '可见检票入口' },
          ],
        },
      },
      materials: [{ id: 91 }],
      runWithMessages,
    });

    const result = await service.generateLines(2, { preserveSegments: true, refreshExisting: true }, { userId: 'u1' });

    expect(loadCandidates).not.toHaveBeenCalled();
    const { config, messages } = runWithMessages.mock.calls[0][0];
    expect(config.system).toContain('把它自然写进 lines。只在 scene 提到画面不算完成');
    expect(config.system).not.toContain('不念颜色、灯光');
    expect(messages[0].content).toContain('1. 已选视频。实际画面说明：视频封面是一排木桌');
    expect(messages[0].content).toContain('3. 已选图片。实际画面说明：门口招牌 / 可见检票入口');
    expect(messages[0].content).toContain('此段已确认，台词供衔接：原样保留。');
    expect(messages[0].content).toContain('updates 只提交这些镜头原编号 1、3。');
    expect(messages[0].content).not.toContain('这里的卡丁车很好玩。');
    expect(messages[0].content).not.toContain('这里有咖啡。');
    expect(result.segments.map(({ lines }) => lines)).toEqual([
      '先在木桌边聊两句，等会儿一起上赛道。',
      '原样保留。',
      '到检票口之前，先看看这家的团购。',
    ]);
    expect(runWithMessages.mock.calls.filter(([input]) => input.requiredTool)).toHaveLength(1);
  });

  it('新配图缺说明时只识别选中的图片，台词按识别结果重写', async () => {
    const firstDraft = [
      { image: 1, scene: '签到板', lines: '一个个插上名牌。' },
      { image: 2, scene: '蛋糕', lines: '生日蛋糕来了。' },
      { image: 2, scene: '蛋糕', lines: '一起许个愿吧。' },
    ];
    const revised = { scene: '孩子围着器材', lines: '大家一围过来，派对马上就热闹了。' };
    const runWithMessages = jest.fn()
      .mockResolvedValueOnce(lineSubmission(firstDraft))
      .mockResolvedValueOnce(lineSubmission([revised]))
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service, describeDraftMaterial } = plannerWith({
      topic: { id: 2, kind: 'child', title: '生日派对', storeVisit: { start: 'script', script: '从签到转到游戏，再到切蛋糕。' } },
      materials: [
        { id: 21, name: '活动照片', url: '/21.jpg', description: '', tags: [] },
        { id: 22, name: '蛋糕', url: '/22.jpg', description: '生日蛋糕', tags: [] },
        { id: 23, name: '未使用的照片', url: '/23.jpg', description: '', tags: [] },
      ],
      describeDraftMaterial: jest.fn().mockResolvedValue('孩子们围着室内游戏器材'),
      runWithMessages,
    });
    const draft = await service.generateLines(2, {}, { userId: 'u1' });
    expect(describeDraftMaterial.mock.calls).toEqual([[2, { type: 'image', id: 21 }, { userId: 'u1' }]]);
    expect(runWithMessages.mock.calls[1][0].messages[0].content).toContain('第 1 段：孩子们围着室内游戏器材');
    expect(draft.segments[0]).toMatchObject({ ...revised, sceneImageId: 21 });
    expect(draft.sceneImages?.find((image) => image.id === 21)?.description).toBe('孩子们围着室内游戏器材');
  });

  it('旧自动配图的说明抄自镜头标题时先看图，手选的说明继续使用', async () => {
    const runWithMessages = jest.fn()
      .mockResolvedValueOnce(lineSubmission([
        { scene: '孩子围着器材', lines: '孩子们一围过来，今天的派对就热闹起来了。' },
        { scene: '室内前台', lines: '先到前台集合。' },
      ]))
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service, describeDraftMaterial } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '生日派对',
        storeVisit: {
          start: 'script',
          script: '从签到过渡到孩子们一起玩。',
          segments: [
            { id: 'group', scene: '签到板插上名牌', lines: '名牌位一个个填满。', sceneImageId: 21 },
            { id: 'lobby', scene: '室内前台', lines: '先到前台集合。', sceneImageId: 22, manualMaterial: true },
          ],
          sceneImages: [
            { type: 'image', id: 21, name: 'DSC01458.JPG', description: '签到板插上名牌' },
            { type: 'image', id: 22, name: '前台照片', description: '室内前台' },
          ],
        },
      },
      describeDraftMaterial: jest.fn().mockResolvedValue('几名孩子围着室内的游戏器材'),
      runWithMessages,
    });
    const draft = await service.generateLines(2, { preserveSegments: true }, { userId: 'u1' });
    expect(describeDraftMaterial).toHaveBeenCalledTimes(1);
    expect(describeDraftMaterial).toHaveBeenCalledWith(2, { type: 'image', id: 21 }, { userId: 'u1' });
    const prompt = runWithMessages.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('已选图片。实际画面说明：几名孩子围着室内的游戏器材');
    expect(prompt).not.toContain('签到板插上名牌');
    expect(draft.sceneImages).toMatchObject([{ id: 21, description: '几名孩子围着室内的游戏器材' }]);
    expect(draft.segments[0].lines).toBe('孩子们一围过来，今天的派对就热闹起来了。');
  });

  it('已选湖景时，按具体画面细节写出生日本段的过渡台词', async () => {
    const runWithMessages = jest.fn()
      .mockResolvedValueOnce(lineSubmission([
        { position: 2, scene: '远山与湖景', lines: '包间点名' },
        { position: 1, scene: '派对前台', lines: '到前台集合，准备今天的生日会。' },
      ]))
      .mockResolvedValueOnce(lineSubmission([
        { position: 2, scene: '远山与湖景', lines: '像湖面这样安静一拍，然后把掌声留给今天的小寿星。' },
      ]))
      .mockResolvedValueOnce({ content: '{"issues":[]}' });
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '门店生日会',
        storeVisit: {
          start: 'script',
          script: '在店内布置生日会，先集合，再到包间点名。',
          segments: [
            { id: 'lobby', lines: '旧开场', sceneImageId: 21 },
            { id: 'lake', lines: '包间点名', sceneImageId: 22 },
          ],
          sceneImages: [
            { id: 21, name: '派对前台', description: '店内前台和派对招牌' },
            { id: 22, name: '湖景', description: '黄昏的湖面与远山' },
          ],
        },
      },
      runWithMessages,
    });
    const draft = await service.generateLines(
      2, { preserveSegments: true, refreshExisting: true }, { userId: 'u1' },
    );
    const rewriteRequest = runWithMessages.mock.calls[0][0];
    expect(rewriteRequest.config.system).toContain('【关联弱也照样写】');
    expect(rewriteRequest.messages[0].content).toContain('2. 已选图片。实际画面说明：黄昏的湖面与远山');
    expect(rewriteRequest.messages[0].content).toContain('在店内布置生日会，先集合，再到包间点名。');
    expect(runWithMessages.mock.calls[1][0].messages[0].content).toContain('第 2 段需要换掉原台词');
    expect(runWithMessages.mock.calls[1][0].messages[0].content).not.toContain('上一版：');
    expect(runWithMessages.mock.calls[1][0].messages[0].content).toContain(
      '调用 update_store_visit_lines 一次更新台词。updates 只包含镜头编号 2，沿用这些原编号。',
    );
    expect(draft.segments[1]).toMatchObject({ scene: '远山与湖景', lines: '像湖面这样安静一拍，然后把掌声留给今天的小寿星。' });
  });

  it('配图偏向是 AI 画面或调用方关掉素材时，从脚本开始也不去图库匹配', async () => {
    const runWithMessages = jest.fn().mockResolvedValue(lineSubmission(script.segments));
    const generate = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '孩子的生日会',
        storyboardPreference: { imageSource: 'generate', galleryTags: [] },
        storeVisit: { start: 'script', script: script.script },
      },
      materials: [{ id: 91 }],
      runWithMessages,
    });
    await generate.service.generateLines(2, {}, { userId: 'u1' });
    expect(generate.loadCandidates).not.toHaveBeenCalled();
    const off = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        title: '孩子的生日会',
        storeVisit: { start: 'script', script: script.script },
      },
      materials: [{ id: 91 }],
      runWithMessages,
    });
    await off.service.generateLines(
      2,
      { useMaterials: false },
      { userId: 'u1' },
    );
    expect(off.loadCandidates).not.toHaveBeenCalled();
  });

  it('从门店开始仍要先定门店才能生成台词', async () => {
    const runWithMessages = jest.fn();
    const { service } = plannerWith({
      topic: {
        id: 2,
        kind: 'child',
        storeVisit: { start: 'store', script: script.script },
      },
      runWithMessages,
    });
    await expect(
      service.generateLines(2, {}, { userId: 'u1' }),
    ).rejects.toThrow('确认这条视频拍哪家店');
    expect(runWithMessages).not.toHaveBeenCalled();
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
    const runWithMessages = jest.fn().mockResolvedValue({
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

  it('客户需求里写明了已有门店时标为已确定；只在引用知识里出现的不算', async () => {
    const runWithMessages = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        question: '这条视频拍欢乐谷人民路店吗？',
        storeId: 701,
        name: '欢乐谷人民路店',
        confident: true,
      }),
    });
    const { service } = plannerWith({
      topic: { id: 2, kind: 'child', title: '周末遛娃', storeVisit: {} },
      stores: [{ id: 701, name: '欢乐谷人民路店' }],
      knowledge: '本次拍摄欢乐谷人民路店',
      runWithMessages,
    });
    expect(await service.writeScript(2, {}, { userId: 'u1' })).toMatchObject({
      storeQuestion: { storeId: 701, confident: false },
    });
    expect(
      await service.writeScript(
        2,
        { prompt: '帮我拍欢乐谷人民路店的亲子套餐' },
        { userId: 'u1' },
      ),
    ).toMatchObject({ storeQuestion: { storeId: 701, confident: true } });
    expect(runWithMessages.mock.calls[1][0].messages[0].content).toContain(
      '客户需求：帮我拍欢乐谷人民路店的亲子套餐',
    );
  });

  it('门店已确定的判断：要模型确定且店名真的写在客户文字里，简称要唯一对应，新店名不能和已有门店名互相包含', () => {
    const stores = ['欢乐谷人民路店', '欢乐谷万达店', '星空咖啡'];
    const base = { storeNames: stores, sources: '' };
    expect(
      isStoreVisitStoreDetermined({
        ...base,
        confident: false,
        name: '星空咖啡',
        existingName: '星空咖啡',
        sources: '拍星空咖啡',
      }),
    ).toBe(false);
    expect(
      isStoreVisitStoreDetermined({
        ...base,
        confident: true,
        name: '星空',
        existingName: '星空咖啡',
        sources: '这周拍星空',
      }),
    ).toBe(true);
    expect(
      isStoreVisitStoreDetermined({
        ...base,
        confident: true,
        name: '欢乐谷',
        existingName: '欢乐谷人民路店',
        sources: '周末去欢乐谷',
      }),
    ).toBe(false);
    expect(
      isStoreVisitStoreDetermined({
        ...base,
        confident: true,
        name: '小熊烘焙',
        sources: '给小熊烘焙拍一条探店',
      }),
    ).toBe(true);
    expect(
      isStoreVisitStoreDetermined({
        ...base,
        confident: true,
        name: '欢乐谷',
        sources: '给欢乐谷拍一条',
      }),
    ).toBe(false);
    expect(
      isStoreVisitStoreDetermined({
        ...base,
        confident: true,
        name: '小熊烘焙',
        sources: '拍一家烘焙店',
      }),
    ).toBe(false);
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
