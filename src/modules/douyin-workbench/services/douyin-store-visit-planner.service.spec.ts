import type { DouyinPersonaView } from '../../douyin-persona/entities/douyin-persona.entity.js';
import type { DouyinStoreVisitSpot } from '../entities/douyin-store-visit-store.entity.js';
import { COSYVOICE_PRESET_VOICES } from './douyin-cosyvoice.service.js';
import {
  DouyinStoreVisitPlannerService,
  buildStoreVisitSpotCatalog,
  describeStoreVisitSpotCatalog,
  parseStoreVisitSpotSegments,
  pickStoreVisitRecommendation,
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

const sceneImages = [1, 2, 3, 4, 5].map((id) => ({
  type: 'image' as const,
  id,
  name: `图${id}`,
  url: `https://oss.example.com/${id}.jpg`,
}));

describe('store visit spot catalog', () => {
  const spots = [
    spot('ride', '旋转木马', [
      [1, 6],
      [2, 9],
    ]),
    spot('gate', '门头', [[3, 8]], { opening: true }),
    spot('cafe', '咖啡区', [[9, 10]]),
  ];

  it('开场点位排第一，只收选题里同步过的图并按分数排序，没图的点位去掉', () => {
    const catalog = buildStoreVisitSpotCatalog(
      spots,
      ['ride', 'gate', 'cafe'],
      sceneImages,
    );
    expect(catalog.map((entry) => entry.spot.id)).toEqual(['gate', 'ride']);
    expect(catalog[1].images.map((image) => image.imageId)).toEqual([2, 1]);
    expect(describeStoreVisitSpotCatalog(catalog)).toContain(
      '【点位1】门头（开场·门头）：门头说明',
    );
    expect(describeStoreVisitSpotCatalog(catalog)).toContain(
      '图2.1（9 分）：旋转木马图2',
    );
  });

  it('按「【点位k｜图k.a】」解析分段与参考图，写错的图编号按分数轮换兜底', () => {
    const catalog = buildStoreVisitSpotCatalog(
      spots,
      ['gate', 'ride'],
      sceneImages,
    );
    const segments = parseStoreVisitSpotSegments(
      [
        '【点位1｜图1.1】',
        '家人们，今天我们来到了欢乐谷！',
        '【点位2｜图2.2,2.1,1.1】',
        '先看旋转木马，小朋友最爱。',
        '【点位2】',
        '晚上还会亮灯。',
        '【点位2｜图2.9】',
        '想去的点视频下方链接。',
        '【点位7】',
        '不存在的点位。',
      ].join('\n'),
      catalog,
    );
    expect(segments).toEqual([
      {
        spotId: 'gate',
        lines: '家人们，今天我们来到了欢乐谷！',
        sceneImageId: 3,
      },
      {
        spotId: 'ride',
        lines: '先看旋转木马，小朋友最爱。',
        sceneImageId: 1,
        sceneImageIds: [1, 2],
      },
      {
        spotId: 'ride',
        lines: '晚上还会亮灯。',
        sceneImageId: 1,
        sceneImageIds: [1, 2],
      },
      {
        spotId: 'ride',
        lines: '想去的点视频下方链接。',
        sceneImageId: 2,
        sceneImageIds: [2, 1],
      },
    ]);
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

describe('store visit spot lines', () => {
  it('提示词要求讲卖点、不念图片描述里的画面，附示例；按点位解析出简短分段', async () => {
    const spots = [
      spot('gate', '门头', [[3, 8]], { opening: true }),
      spot('kart', '卡丁车', [[1, 9]]),
    ];
    const runWithMessages = jest.fn().mockResolvedValue({
      content: [
        '【点位1｜图1.1】',
        '今天我们来到了欢乐谷，一家室内游乐场，卡丁车随便开。',
        '【点位2｜图2.1】',
        '卡丁车一脚油门就冲出去，约上朋友比比谁快。',
      ].join('\n'),
    });
    const service = new DouyinStoreVisitPlannerService(
      {
        get: jest.fn().mockResolvedValue({
          id: 2,
          kind: 'child',
          title: '欢乐谷探店',
          storeVisit: {
            storeId: 1,
            spotIds: ['gate', 'kart'],
            sceneImages,
            template: 'voiceover',
          },
        }),
      } as never,
      {
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 1, name: '欢乐谷', spots }),
      } as never,
      { get: jest.fn() } as never,
      { resolveNodeRuntime: jest.fn().mockResolvedValue(null) } as never,
      { runWithMessages } as never,
    );
    const result = await service.writeSpotLines(2, undefined, {
      userId: 'u1',
    });
    const request = runWithMessages.mock.calls[0][0];
    expect(request.config.system).toContain('【讲卖点，不念画面】');
    expect(request.config.system).toContain('不是逐个讲解画面的说明视频');
    expect(request.config.system).toContain('【示例】');
    expect(request.config.system).not.toContain('有画面感');
    expect(request.messages[0].content).toContain('不要照着念');
    expect(result.segments.map((segment) => segment.spotId)).toEqual([
      'gate',
      'kart',
    ]);
    expect(runWithMessages).toHaveBeenCalledTimes(1);
  });
});
