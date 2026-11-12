import { BadRequestException } from '@nestjs/common';
import type { DouyinStoreVisitClassifyEvent } from '../entities/douyin-store-visit-store.entity.js';
import type { DouyinTopicEntity } from '../entities/douyin-workbench.entity.js';
import { DouyinWorkbenchAgentService } from './douyin-workbench-agent.service.js';

const scope = { tenantId: 'tenant-1', userId: 'user-1' };

/**
 * @description 测试用门店：门头（开场）与吧台两个点位，各带打过分的图片。
 * @keyword-cn 测试门店, 点位桩
 * @keyword-en test-store, spot-stub
 */
function buildStore() {
  return {
    id: 7,
    name: '集合石',
    description: '电玩城',
    spots: [
      {
        id: 'gate',
        name: '门头',
        description: '店外招牌',
        opening: true,
        images: [
          { imageId: 11, url: '/11.jpg', description: '招牌', score: 9 },
          { imageId: 12, url: '/12.jpg', description: '门口', score: 6 },
        ],
        videos: [],
        updatedAt: new Date(0),
      },
      {
        id: 'bar',
        name: '吧台',
        description: '收银台',
        images: [
          { imageId: 21, url: '/21.jpg', description: '吧台', score: 8 },
        ],
        videos: [],
        updatedAt: new Date(0),
      },
    ],
  };
}

/**
 * @description 构造编排服务：仓库是内存里的一条探店脚本（保存时按接口的合并方式写进去），其他业务服务都是替身。
 * @keyword-cn 编排服务测试桩, 内存仓库
 * @keyword-en agent-service-stub, in-memory-repository
 * @param {Partial<DouyinTopicEntity['storeVisit']>} [storeVisit] 初始探店设置。
 */
function buildAgent(storeVisit: Record<string, unknown> = {}) {
  const store = buildStore();
  const topic = {
    id: 5,
    kind: 'child',
    parentId: 4,
    productionMode: 'store-visit',
    title: '集合石探店',
    storyboard: [],
    status: 'draft',
    storeVisit: { storeId: 7, storeName: '集合石', ...storeVisit },
  } as unknown as DouyinTopicEntity;
  const updates: Array<Record<string, unknown>> = [];
  const repository = {
    get: jest.fn(async () => topic),
    update: jest.fn(async (_id: number, dto: Record<string, unknown>) => {
      const patch = JSON.parse(JSON.stringify(dto)) as Record<string, unknown>;
      updates.push(patch);
      const { storeVisit: nextVisit, ...rest } = patch;
      Object.assign(topic, rest);
      if (nextVisit) Object.assign(topic.storeVisit!, nextVisit);
      return topic;
    }),
    listWorkspace: jest.fn(async () => []),
    requireVideo: jest.fn(async () => ({ url: '/v.mp4' })),
  };
  const operations = {
    list: jest.fn(async () => []),
    createGeneration: jest.fn(async () => ({
      id: 'full-1',
      status: 'running',
      topicId: 5,
      operation: 'generate',
      mode: 'full',
    })),
    getVideoOptions: jest.fn(async () => ({
      full: {},
      shot: {},
      storeVisit: {
        voiceClone: { configured: true },
        video: { configured: true, durations: [5, 10, 15] },
        avatar: { configured: true, durations: [15], multiReference: false },
      },
    })),
  };
  const storeVisitService = {
    usePresetVoice: jest.fn(async (_id: number, voiceId: string) => {
      Object.assign(topic.storeVisit!, { voiceId, voiceSource: 'preset' });
      return topic;
    }),
    designVoice: jest.fn(),
    generateKeyframe: jest.fn(async (_id: number, segmentId: string) => {
      const segment = topic.storeVisit!.segments!.find(
        (item) => item.id === segmentId,
      )!;
      segment.keyframe = { type: 'image', id: 99, name: '首帧', url: '/k.jpg' };
      return { topic, segmentId, keyframe: segment.keyframe };
    }),
    start: jest.fn(async () => ({
      operations: [
        {
          id: 'op-1',
          segmentId: 'a',
          status: 'queued',
          topicId: 5,
          operation: 'generate',
        },
      ],
    })),
    startOne: jest.fn(),
    listPresetVoices: jest.fn(() => []),
    listPresetCategories: jest.fn(() => []),
  };
  const planner = {
    writeScript: jest.fn(),
    generateLines: jest.fn(),
    matchScenes: jest.fn(),
  };
  const spots = {
    requireStore: jest.fn(async () => store),
    similarity: jest.fn(async () => ({ clusters: [[31, 32]], failed: [] })),
    classify: jest.fn(),
    saveSpots: jest.fn(async (_id: number, input: unknown) => ({
      ...store,
      spots: input,
    })),
    listStores: jest.fn(async () => [store]),
    createStore: jest.fn(),
  };
  const personas = {
    list: jest.fn(async () => [
      {
        id: 3,
        name: '铁山',
        referenceImages: [
          { view: 'closeup', imageId: 41, url: '/41.jpg' },
          { view: 'front', imageId: 42, url: '/42.jpg', coverUrl: '/42s.jpg' },
        ],
      },
    ]),
  };
  const director = { schedule: jest.fn(async () => undefined) };
  const pipeline = {
    start: jest.fn(async () => ({
      ...topic,
      storeVisit: {
        ...topic.storeVisit,
        pipeline: {
          state: 'running',
          currentSegmentId: 'a',
          updatedAt: new Date(),
        },
      },
    })),
    redo: jest.fn(async () => topic),
    pause: jest.fn(async () => topic),
    resume: jest.fn(async () => topic),
  };
  const unify = {
    unify: jest.fn(async () => {
      topic.productionMode = 'store-visit';
      return { topic, converted: true };
    }),
  };
  const segmentImages = {
    pickImages: jest.fn(async () => ({
      segments: [{ id: 'a', sceneImageId: 31 }],
      sceneImages: [{ type: 'image', id: 31, name: '图库图', url: '/31.jpg' }],
    })),
    generateImage: jest.fn(async () => ({})),
  };
  const agent = new DouyinWorkbenchAgentService(
    repository as never,
    storeVisitService as never,
    planner as never,
    spots as never,
    operations as never,
    {} as never,
    unify as never,
    director as never,
    personas as never,
    {} as never,
    {} as never,
    {} as never,
    pipeline as never,
    segmentImages as never,
  );
  return {
    agent,
    unify,
    segmentImages,
    operations,
    topic,
    updates,
    repository,
    storeVisitService,
    planner,
    spots,
    director,
    pipeline,
    store,
  };
}

describe('AI 操作抖音工作台（编排服务）', () => {
  it('AI 写好脚本后落库：脚本与出镜方式，开头出镜时用人物的正面形象图，再选用 AI 挑的音色库音色', async () => {
    const { agent, topic, planner, storeVisitService } = buildAgent();
    planner.writeScript.mockResolvedValue({
      script: '  老铁们，今天来集合石。 ',
      presenter: true,
      persona: { personaId: 3, name: '铁山', reason: '东北口音' },
      voice: {
        voiceId: 'longlaotie_v3',
        voiceName: '龙老铁',
        reason: '豪爽',
        voicePrompt: '',
      },
      review: { passed: true, issues: [] },
    });
    const result = await agent.writeScript(
      5,
      { prompt: '突出团购', keepCast: false },
      scope,
    );
    expect(topic.storeVisit).toMatchObject({
      script: '老铁们，今天来集合石。',
      template: 'opening',
      faceImage: {
        type: 'image',
        id: 42,
        url: '/42.jpg',
        coverUrl: '/42s.jpg',
        name: '铁山 · 人物形象',
      },
      voiceId: 'longlaotie_v3',
    });
    expect(topic.personaId).toBe(3);
    expect(storeVisitService.usePresetVoice).toHaveBeenCalledWith(
      5,
      'longlaotie_v3',
      scope,
    );
    expect(result).toMatchObject({
      template: 'opening',
      persona: { id: 3 },
      voice: { voiceId: 'longlaotie_v3' },
    });
  });

  it('门店还没定时只返回 AI 的门店确认问题，不落库', async () => {
    const { agent, planner, repository } = buildAgent();
    planner.writeScript.mockResolvedValue({
      needsStore: true,
      storeQuestion: { question: '是哪家店？' },
    });
    await expect(agent.writeScript(5, {}, scope)).resolves.toEqual({
      needsStore: true,
      storeQuestion: { question: '是哪家店？' },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('默认写脚本沿用现有出镜人物音色，不应用隐式推荐并清除微调未完成标记', async () => {
    const { agent, topic, planner, storeVisitService } = buildAgent({
      template: 'opening',
      voiceId: 'selected-voice',
      scriptNeedsRefine: true,
    });
    planner.writeScript.mockResolvedValue({
      script: '已按当前人物和音色写好的创作方案。',
      presenter: false,
      voice: { voiceId: 'other-voice' },
    });
    await agent.writeScript(5, {}, scope);
    expect(topic.storeVisit).toMatchObject({
      template: 'opening',
      voiceId: 'selected-voice',
      scriptNeedsRefine: false,
    });
    expect(storeVisitService.usePresetVoice).not.toHaveBeenCalled();
  });

  it('按脚本生成台词：每段新 ID、按出镜方式排镜头，并记下台词对应的脚本', async () => {
    const { agent, topic, planner } = buildAgent({
      script: '正文',
      template: 'opening',
    });
    planner.generateLines.mockResolvedValue({
      linesScript: '正文',
      segments: [
        { lines: '开场打招呼', scene: '门头' },
        { lines: '介绍吧台', scene: '吧台' },
      ],
    });
    await agent.generateLines(5, undefined, scope);
    const segments = topic.storeVisit!.segments!;
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      lines: '开场打招呼',
      shot: 'presenter',
      visualSource: 'generated',
      scene: '门头',
    });
    expect(segments[1].shot).toBeUndefined();
    expect(segments[0].id).toMatch(/^seg-/);
    expect(topic.storeVisit!.linesScript).toBe('正文');
  });

  it('AI 配场景后写进分段，并把用到的点位按打分同步成选题素材（开场点位作开场素材）', async () => {
    const { agent, topic, planner } = buildAgent({
      script: '正文',
      linesScript: '正文',
      segments: [
        { id: 'a', lines: '开场' },
        { id: 'b', lines: '吧台' },
      ],
    });
    planner.matchScenes.mockResolvedValue({
      segments: [
        { id: 'a', spotId: 'gate', sceneImageId: 11, sceneImageIds: [11, 12] },
        { id: 'b', spotId: 'bar', sceneImageId: 21 },
      ],
    });
    await agent.matchScenes(5, scope);
    expect(topic.storeVisit!.segments).toEqual([
      {
        id: 'a',
        lines: '开场',
        spotId: 'gate',
        sceneImageId: 11,
        sceneImageIds: [11, 12],
      },
      { id: 'b', lines: '吧台', spotId: 'bar', sceneImageId: 21 },
    ]);
    expect(topic.storeVisit!.spotIds).toEqual(['gate', 'bar']);
    expect(topic.storeVisit!.sceneImages!.map((image) => image.id)).toEqual([
      11, 12, 21,
    ]);
    expect(topic.storeVisit!.openingScene).toEqual({ type: 'image', id: 11 });
  });

  it('托管配图仅填缺失段，保留用户选好的门店图', async () => {
    const { agent, topic, planner } = buildAgent({
      sceneImages: [
        { id: 11, type: 'image', name: '已选画面', url: '/11.jpg' },
      ],
      segments: [
        {
          id: 'a',
          lines: '开场',
          spotId: 'gate',
          sceneImageId: 11,
          videoId: 80,
          nativeAudio: true,
        },
        { id: 'b', lines: '吧台' },
      ],
    });
    planner.matchScenes.mockResolvedValue({
      segments: [
        { id: 'a', spotId: 'bar', sceneImageId: 21 },
        { id: 'b', spotId: 'bar', sceneImageId: 21 },
      ],
    });
    await agent.matchScenes(5, scope, { onlyMissing: true });
    expect(topic.storeVisit!.segments![0]).toMatchObject({
      sceneImageId: 11,
      spotId: 'gate',
    });
    expect(topic.storeVisit!.segments![1].sceneImageId).toBe(21);
  });

  it('从脚本开始无需选择门店即可生成台词', async () => {
    const { agent, planner, topic } = buildAgent({
      start: 'script',
      storeId: undefined,
      script: '创作方案',
      template: 'voiceover',
    });
    planner.generateLines.mockResolvedValue({
      linesScript: '创作方案',
      segments: [{ lines: '周末来玩', scene: '城市' }],
    });
    await agent.generateLines(5, undefined, scope);
    expect(topic.storeVisit!.linesScript).toBe('创作方案');
    expect(topic.storeVisit!.segments).toHaveLength(1);
  });

  it('托管图库配图仅填缺失段，保留用户已选画面', async () => {
    const { agent, topic, segmentImages } = buildAgent({
      start: 'script',
      sceneImages: [
        { id: 11, type: 'image', name: '已选画面', url: '/11.jpg' },
      ],
      segments: [
        {
          id: 'a',
          lines: '开场',
          sceneImageId: 11,
          videoId: 80,
          nativeAudio: true,
        },
        { id: 'b', lines: '结尾' },
      ],
    });
    segmentImages.pickImages.mockResolvedValue({
      segments: [
        { id: 'a', sceneImageId: 31 },
        { id: 'b', sceneImageId: 31 },
      ],
      sceneImages: [{ id: 31, type: 'image', name: '图库图', url: '/31.jpg' }],
    });
    await agent.pickPictures(5, scope, { onlyMissing: true });
    expect(topic.storeVisit!.segments![0]).toMatchObject({ sceneImageId: 11 });
    expect(topic.storeVisit!.segments![1].sceneImageId).toBe(31);
  });

  it('旧分镜脚本被任一工具操作时先自动转成统一流程', async () => {
    const { agent, topic, unify } = buildAgent();
    topic.productionMode = 'storyboard';
    await agent.topicDetail(5, scope);
    expect(unify.unify).toHaveBeenCalledWith(5, scope);
  });

  it('选起点：改成从脚本开始时清掉已配画面、保留台词，之后不再要求门店', async () => {
    const { agent, topic } = buildAgent({
      script: '正文',
      linesScript: '正文',
      template: 'voiceover',
      voiceId: 'longanyang',
      spotIds: ['gate'],
      segments: [{ id: 'a', lines: '开场', spotId: 'gate', sceneImageId: 11 }],
    });
    const detail = await agent.setStart(5, 'script', scope);
    expect(topic.storeVisit).toMatchObject({
      start: 'script',
      sceneImages: [],
    });
    expect(topic.storeVisit!.segments![0]).toMatchObject({
      id: 'a',
      lines: '开场',
    });
    expect(topic.storeVisit!.segments![0].sceneImageId).toBeUndefined();
    expect(detail).toMatchObject({ start: 'script', store: null });
    expect(String(detail.nextStep)).toContain(
      'douyin_store_visit_pick_pictures',
    );
  });

  it('从脚本开始：从图库配画面写进分段与素材，AI 生图逐段生成或只重做一段', async () => {
    const { agent, topic, segmentImages } = buildAgent({
      start: 'script',
      script: '正文',
      linesScript: '正文',
      segments: [
        { id: 'a', lines: '开场' },
        { id: 'b', lines: '结尾' },
      ],
    });
    await agent.pickPictures(5, scope);
    expect(topic.storeVisit!.segments![0].sceneImageId).toBe(31);
    expect(topic.storeVisit!.sceneImages!.map((image) => image.id)).toEqual([
      31,
    ]);
    await agent.generatePictures(5, {}, scope);
    expect(segmentImages.generateImage).toHaveBeenCalledTimes(2);
    await agent.generatePictures(5, { segmentId: 'b', prompt: '暖色' }, scope);
    expect(segmentImages.generateImage).toHaveBeenLastCalledWith(
      5,
      'b',
      '暖色',
      scope,
    );
    await expect(
      agent.generatePictures(5, { segmentId: 'zz' }, scope),
    ).rejects.toThrow('没有这个分段');
  });

  it('整条一次出：不要求选音色，画面齐了就提交整片生成', async () => {
    const { agent, operations } = buildAgent({
      start: 'script',
      script: '正文',
      linesScript: '正文',
      template: 'voiceover',
      sceneImages: [{ type: 'image', id: 31, name: 'g', url: '/31.jpg' }],
      segments: [{ id: 'a', lines: '开场', sceneImageId: 31 }],
    });
    const result = await agent.generateStoreVisit(5, { full: true }, scope);
    expect(operations.createGeneration).toHaveBeenCalledWith(
      5,
      undefined,
      scope,
    );
    expect(result).toMatchObject({ operation: { id: 'full-1' } });
  });

  it('出片前检查不过就不提交也不扣费', async () => {
    const { agent, storeVisitService } = buildAgent({
      script: '正文',
      linesScript: '正文',
      template: 'voiceover',
      segments: [{ id: 'a', lines: '开场' }],
    });
    await expect(agent.generateStoreVisit(5, {}, scope)).rejects.toThrow(
      BadRequestException,
    );
    await expect(agent.generateStoreVisit(5, {}, scope)).rejects.toThrow(
      '还没有音色',
    );
    expect(storeVisitService.start).not.toHaveBeenCalled();
  });

  it('出片：缺人物首帧的镜头先生成首帧，再启动 AI 导演一段一段地出片', async () => {
    const { agent, storeVisitService, pipeline } = buildAgent({
      script: '正文',
      linesScript: '正文',
      template: 'opening',
      voiceId: 'longlaotie_v3',
      faceImage: { type: 'image', id: 42, name: '铁山', url: '/42.jpg' },
      spotIds: ['gate', 'bar'],
      segments: [
        {
          id: 'a',
          lines: '开场',
          shot: 'presenter',
          visualSource: 'generated',
          spotId: 'gate',
          sceneImageId: 11,
        },
        { id: 'b', lines: '吧台', spotId: 'bar', sceneImageId: 21 },
      ],
    });
    const result = await agent.generateStoreVisit(5, {}, scope);
    expect(storeVisitService.generateKeyframe).toHaveBeenCalledTimes(1);
    expect(storeVisitService.generateKeyframe).toHaveBeenCalledWith(
      5,
      'a',
      undefined,
      scope,
    );
    expect(pipeline.start).toHaveBeenCalledWith(5, scope, {
      voiceAnchor: true,
      restart: false,
    });
    expect(storeVisitService.start).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      state: 'running',
      currentSegment: 1,
      ready: 0,
      total: 2,
    });
  });

  it('重做某段：导演还没开始时清掉这段后直接开始生成；控制导演时重做要给分段', async () => {
    const { agent, pipeline } = buildAgent({
      script: '正文',
      linesScript: '正文',
      template: 'voiceover',
      voiceId: 'longlaotie_v3',
      spotIds: ['bar'],
      segments: [{ id: 'a', lines: '吧台', spotId: 'bar', sceneImageId: 21 }],
    });
    await agent.regenerateStoreVisitSegment(5, 'a', {}, scope);
    expect(pipeline.redo).toHaveBeenCalledWith(5, 'a', scope);
    expect(pipeline.start).toHaveBeenCalledWith(5, scope, {
      voiceAnchor: true,
    });
    await agent.controlStoreVisitPipeline(5, { action: 'pause' }, scope);
    expect(pipeline.pause).toHaveBeenCalledWith(5, 'user', scope);
    await expect(
      agent.controlStoreVisitPipeline(5, { action: 'redo' }, scope),
    ).rejects.toThrow('重做要给分段 ID');
  });

  it('换店时清掉已配场景与台词来源，脚本正文保留', async () => {
    const { agent, topic, spots } = buildAgent({
      storeId: 6,
      script: '正文',
      linesScript: '正文',
      segments: [{ id: 'a', lines: '开场', spotId: 'old', sceneImageId: 5 }],
    });
    await agent.setStore(5, 7, scope);
    expect(spots.requireStore).toHaveBeenCalledWith(7, scope);
    expect(topic.storeVisit).toMatchObject({
      storeId: 7,
      storeName: '集合石',
      linesScript: '',
      spotIds: [],
      script: '正文',
    });
    expect(topic.storeVisit!.segments).toEqual([{ id: 'a', lines: '开场' }]);
  });

  it('门店照片归类：相似图同批，新点位与归到已有点位的图一起保存，没认出的图单独列出', async () => {
    const { agent, spots } = buildAgent();
    spots.classify.mockImplementation(
      async (
        _id: number,
        input: { imageIds: number[]; groups: number[][] },
        _scope: unknown,
        emit: (event: DouyinStoreVisitClassifyEvent) => void,
      ) => {
        expect(input.imageIds).toEqual([31, 32, 33]);
        expect(input.groups).toEqual([[31, 32]]);
        emit({
          type: 'spot',
          key: 'new-claw',
          name: '娃娃机',
          description: '夹娃娃区',
          opening: false,
        });
        emit({
          type: 'assign',
          imageId: 31,
          spotKey: 'new-claw',
          description: '一排娃娃机',
          score: 8,
        });
        emit({
          type: 'assign',
          imageId: 32,
          spotKey: 'bar',
          description: '吧台侧面',
          score: 6,
        });
        emit({ type: 'done', assigned: [31, 32], missed: [33] });
      },
    );
    const result = await agent.classifyStorePhotos(7, [31, 32, 33], scope);
    const saved = spots.saveSpots.mock.calls[0][1] as Array<{
      id?: string;
      name: string;
      images: Array<{ imageId: number }>;
    }>;
    expect(
      saved.map((spot) => [
        spot.id,
        spot.name,
        spot.images.map((image) => image.imageId),
      ]),
    ).toEqual([
      ['gate', '门头', [11, 12]],
      ['bar', '吧台', [21, 32]],
      [undefined, '娃娃机', [31]],
    ]);
    expect(result).toMatchObject({
      assigned: 2,
      missed: [33],
      newSpots: ['娃娃机'],
    });
    await expect(
      agent.classifyStorePhotos(
        7,
        Array.from({ length: 17 }, (_, index) => index + 1),
        scope,
      ),
    ).rejects.toThrow('每次归类');
  });

  it('设定人物时拒绝没有形象图的预设人物，保存时拒绝不合规的字段（与接口同一套校验）', async () => {
    const { agent } = buildAgent();
    await expect(agent.setCast(5, { personaId: 99 }, scope)).rejects.toThrow(
      '没有这个预设人物',
    );
    await expect(
      agent.updateTopic(5, { title: 'x'.repeat(300) }, scope),
    ).rejects.toThrow(BadRequestException);
  });
});
