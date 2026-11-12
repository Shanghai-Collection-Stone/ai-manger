import { DouyinSegmentImageService } from './douyin-segment-image.service.js';

/**
 * @description 造一个从脚本开始、三段台词的子选题，第 1 段已有一张图。
 * @keyword-cn 测试从脚本开始选题, 分段配图测试数据
 * @keyword-en test-script-first-topic, segment-image-fixture
 */
function scriptFirstTopic(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    kind: 'child',
    title: '孩子的生日会',
    storeVisit: {
      start: 'script',
      script: '主题：让孩子自己挑生日会。',
      sceneImages: [{ type: 'image', id: 11, name: 'a', url: '/static/a.jpg' }],
      segments: [
        { id: 's1', lines: '第一段', scene: '孩子围着蛋糕', sceneImageId: 11 },
        { id: 's2', lines: '第二段', scene: '派对布置全景' },
        { id: 's3', lines: '第三段', scene: '吹蜡烛特写' },
      ],
    },
    ...overrides,
  };
}

/**
 * @description 用替身依赖组装分段配图服务。
 * @keyword-cn 组装分段配图服务, 测试替身
 * @keyword-en build-segment-image-service, test-doubles
 */
function serviceWith(topic: Record<string, unknown>) {
  const repository = {
    get: jest.fn().mockResolvedValue(topic),
    update: jest.fn(async (_id: number, input: Record<string, unknown>) => ({
      ...topic,
      ...input,
    })),
  };
  const candidates = {
    loadCandidates: jest.fn().mockResolvedValue([
      {
        id: 21,
        name: 'cake',
        url: '/static/cake.jpg',
        coverUrl: '/static/cake-s.jpg',
        tags: ['生日'],
        description: '生日蛋糕',
        isPortrait: true,
      },
      {
        id: 22,
        name: 'party',
        url: '/static/party.jpg',
        coverUrl: '',
        tags: [],
        description: '',
        isPortrait: true,
      },
    ]),
  };
  const storyboard = {
    pickShotImages: jest.fn(async (shots: Array<{ media?: unknown }>) => {
      shots[0].media = { type: 'image', id: 21, name: 'cake', url: '' };
    }),
  };
  const shotImages = {
    generateImage: jest.fn().mockResolvedValue({
      id: 31,
      originalName: '生日 分镜画面',
      url: '/static/new.jpg',
      thumbUrl: '/static/new-s.jpg',
    }),
  };
  const service = new DouyinSegmentImageService(
    repository as never,
    candidates as never,
    storyboard as never,
    shotImages as never,
  );
  return { service, repository, candidates, storyboard, shotImages };
}

describe('从脚本开始的分段配图', () => {
  const scope = { userId: 'u1' };

  it('按脚本从图库挑图：模型挑的先用，没挑上的按相关度补，返回每段的图和场景图', async () => {
    const { service, candidates, storyboard } = serviceWith(scriptFirstTopic());
    const result = await service.pickImages(2, scope);
    expect(candidates.loadCandidates).toHaveBeenCalledWith(
      expect.stringContaining('孩子的生日会'),
      scope,
      [],
    );
    expect(storyboard.pickShotImages.mock.calls[0][0][1]).toMatchObject({
      id: 's2',
      visual: '派对布置全景',
      narration: '第二段',
    });
    expect(result.segments[0]).toEqual({ id: 's1', sceneImageId: 21 });
    expect(result.segments).toHaveLength(3);
    expect(result.sceneImages[0]).toMatchObject({
      id: 21,
      description: '生日蛋糕',
      tags: ['生日'],
    });
    expect(
      result.sceneImages.find((image) => image.id === 22)?.description,
    ).toBeTruthy();
  });

  it('从门店开始的脚本不走这里，图库为空时提示改用 AI 生图', async () => {
    const store = serviceWith(
      scriptFirstTopic({ storeVisit: { start: 'store', segments: [] } }),
    );
    await expect(store.service.pickImages(2, scope)).rejects.toThrow(
      '门店实拍',
    );
    const empty = serviceWith(scriptFirstTopic());
    empty.candidates.loadCandidates.mockResolvedValue([]);
    await expect(empty.service.pickImages(2, scope)).rejects.toThrow('AI 生图');
  });

  it('给一段 AI 生图：延续上一段的画面，新图绑定到这段并并进素材，旧图没人用就移走', async () => {
    const { service, repository, shotImages } = serviceWith(scriptFirstTopic());
    const result = await service.generateImage(2, 's2', undefined, scope);
    expect(shotImages.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        description: '派对布置全景',
        previousImageUrl: '/static/a.jpg',
      }),
    );
    expect(result).toMatchObject({ segmentId: 's2', imageId: 31 });
    const saved = repository.update.mock.calls[0][1].storeVisit as {
      sceneImages: Array<{ id: number }>;
      segments: Array<{ id: string; sceneImageId?: number }>;
    };
    expect(saved.sceneImages.map((image) => image.id)).toEqual([11, 31]);
    expect(saved.segments[1]).toMatchObject({ id: 's2', sceneImageId: 31 });

    const again = serviceWith(scriptFirstTopic());
    await again.service.generateImage(2, 's1', '换成户外草坪', scope);
    expect(again.shotImages.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ description: '换成户外草坪' }),
    );
    const replaced = again.repository.update.mock.calls[0][1].storeVisit as {
      sceneImages: Array<{ id: number }>;
    };
    expect(replaced.sceneImages.map((image) => image.id)).toEqual([31]);
  });
});
