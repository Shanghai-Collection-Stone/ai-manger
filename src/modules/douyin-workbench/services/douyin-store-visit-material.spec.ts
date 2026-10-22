import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DouyinStoreVisitDto } from '../controller/douyin-workbench.dto.js';
import type {
  DouyinStoreVisitSegment,
  DouyinStoreVisitSetting,
} from '../entities/douyin-workbench.entity.js';
import {
  describeStoreVisitMaterials,
  DouyinChildTopicGenerationService,
  findStoreVisitHardToVoiceWords,
  findStoreVisitUnknownNumbers,
  listStoreVisitMaterials,
  parseStoreVisitMaterialSegments,
  reviewStoreVisitLines,
} from './douyin-child-topic-generation.service.js';
import {
  isStoreVisitLocalSegment,
  isStoreVisitSegmentReady,
  isStoreVisitVisualStart,
  storeVisitVisualSource,
} from './douyin-store-visit-continuity.js';
import { DouyinStoreVisitService } from './douyin-store-visit.service.js';
import {
  mergeStoreVisitSegments,
  normalizeStoreVisitOpeningScene,
  normalizeStoreVisitSceneVideos,
  normalizeStoreVisitSegments,
} from './douyin-workbench-repository.service.js';

const scope = { tenantId: 'tenant-1', userId: 'user-1' };

/**
 * @description 带视频素材、图片素材与一段 AI 画面的探店设置：门头视频开场，拿铁图片本机缓推，最后一段图片交给 AI。
 * @keyword-cn 探店素材测试数据, 本机素材段
 * @keyword-en store-visit-material-fixture, local-segment-fixture
 */
function materialSetting(): DouyinStoreVisitSetting {
  return {
    storeName: '街角咖啡店',
    sceneImages: [
      {
        type: 'image',
        id: 17,
        name: '招牌拿铁',
        url: 'https://cdn/latte.jpg',
        description: '招牌拿铁，抖音团购价 19.9 元',
        tags: ['招牌产品'],
      },
    ],
    sceneVideos: [
      {
        type: 'video',
        id: 5,
        name: '门头',
        url: 'https://cdn/v5.mp4',
        description: '门头招牌',
        tags: ['门头'],
        durationSeconds: 12,
      },
    ],
    openingScene: { type: 'video', id: 5 },
    voiceSource: 'clone',
    voiceId: 'cosyvoice-v3.5-plus-aim2-x',
    voiceModel: 'cosyvoice-v3.5-plus',
    voiceProviderId: 'ds-1',
    segments: [
      { id: 'seg-1', lines: '今天我们来到了街角咖啡店', sceneVideoId: 5 },
      {
        id: 'seg-2',
        lines: '招牌拿铁抖音团购只要 19.9 元',
        sceneImageId: 17,
        visualSource: 'local',
      },
      { id: 'seg-3', lines: '再看看拿铁的细节', sceneImageId: 17 },
    ],
  };
}

/**
 * @description 构造探店生成测试服务：保留真实的分段校验、排队与扣费逻辑，替换数据库、存储、百炼与数眼网络。
 * @keyword-cn 本机素材测试服务, 探店服务替身
 * @keyword-en local-material-test-service, store-visit-service-double
 */
function buildService(storeVisit: DouyinStoreVisitSetting) {
  const service = Object.create(DouyinStoreVisitService.prototype) as Record<
    string,
    any
  >;
  service.previews = new Map();
  service.repository = {
    get: jest.fn().mockResolvedValue({
      id: 2,
      kind: 'child',
      title: '街角咖啡店',
      productionMode: 'store-visit',
      storeVisit,
    }),
    requireVideo: jest.fn().mockResolvedValue({
      id: 5,
      url: 'https://cdn/v5.mp4',
      durationMs: 12000,
    }),
    updateStoreVisitSegment: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  };
  service.storage = {
    hasPublicStorage: jest.fn().mockReturnValue(true),
    saveAudio: jest
      .fn()
      .mockResolvedValue({ url: 'https://oss.example/a.wav', key: 'k' }),
  };
  service.cosyVoice = {
    synthesize: jest.fn().mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 6,
      characters: 30,
    }),
  };
  service.workflowModels = {
    resolveNodeRuntime: jest
      .fn()
      .mockImplementation((_workflow: string, node: string) =>
        Promise.resolve(
          node === 'voice-clone'
            ? {
                providerId: 'ds-1',
                providerCode: 'dashscope',
                providerName: '百炼',
                model: 'cosyvoice-v3.5-plus',
                apiKey: 'sk-test',
              }
            : {
                providerId: 'sy-1',
                providerCode: 'shuyan',
                providerName: '数眼',
                model: 'doubao-seedance-2-0-260128',
                apiKey: 'sk-shuyan',
              },
        ),
      ),
  };
  service.adminService = {
    getAiProviderRuntimeById: jest
      .fn()
      .mockResolvedValue({ providerId: 'ds-1', apiKey: 'sk-test' }),
  };
  service.billing = {
    chargeService: jest.fn().mockResolvedValue({}),
    refundService: jest.fn().mockResolvedValue(true),
  };
  service.operations = {
    insertOne: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  service.fetchShuyan = jest.fn().mockResolvedValue({ id: 'task-1' });
  return service;
}

describe('探店实拍素材与本机缓推', () => {
  it('视频续段同时提交真实尾帧和视频参考，声画仍由模型生成', async () => {
    const setting = materialSetting();
    const service = buildService(setting);
    await service.submitSegment({
      topic: await service.repository.get(2, scope),
      segment: setting.segments![0],
      index: 1,
      sceneUrl: '',
      voice: { voiceId: '', model: '' },
      firstFrameUrl: 'https://cdn/actual-tail.jpg',
      target: {
        shot: 'broll',
        engine: 'shuyan-video',
        route: 'hailuo-v2',
        runtime: { model: 'MiniMax-H3', providerId: 'sy', apiKey: 'test' },
      },
      scope,
    });
    const payload = JSON.parse(service.fetchShuyan.mock.calls[0][1].body);
    expect(payload.content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'https://cdn/actual-tail.jpg' },
      role: 'reference_image',
    });
    expect(payload.content).toContainEqual({
      type: 'video_url',
      video_url: { url: 'https://cdn/v5.mp4' },
      role: 'reference_video',
    });
    expect(payload.content[0].text).toContain('图1 是上一段实际尾帧');
    expect(
      service.operations.insertOne.mock.calls[0][0].request.nativeAudio,
    ).toBe(true);
  });

  it('旧本机照片转为 AI 视频，只有带原生声音的视频才就绪', () => {
    const photo = {
      id: 'a',
      lines: '介绍拿铁',
      sceneImageId: 17,
      visualSource: 'local' as const,
    };
    expect(storeVisitVisualSource(photo)).toBe('original');
    expect(isStoreVisitLocalSegment(photo)).toBe(false);
    expect(
      isStoreVisitSegmentReady({ ...photo, audioUrl: 'https://a.wav' }),
    ).toBe(false);
    expect(
      isStoreVisitSegmentReady({ ...photo, videoId: 41, nativeAudio: true }),
    ).toBe(true);
    expect(isStoreVisitSegmentReady({ ...photo, videoId: 41 })).toBe(false);
    expect(isStoreVisitVisualStart([photo, { ...photo, id: 'b' }], 1)).toBe(
      false,
    );
  });

  it('分段收视频素材、入点与本机运镜，视频素材段不收人物镜头，素材不在选题里时清空', () => {
    const [video, image, gone] = normalizeStoreVisitSegments(
      [
        {
          id: 'a',
          lines: '门头',
          sceneVideoId: 5,
          clipStart: 2.345,
          shot: 'presenter',
          motion: 'pan',
          visualSource: 'local',
        },
        {
          id: 'b',
          lines: '招牌拿铁',
          sceneImageId: 17,
          motion: 'zoom-out',
          visualSource: 'local',
        },
        {
          id: 'c',
          lines: '素材已删',
          sceneVideoId: 99,
          motion: 'spin' as never,
        },
      ],
      [17],
      [5],
    );
    expect(video).toEqual({
      id: 'a',
      lines: '门头',
      sceneVideoId: 5,
      clipStart: 2.3,
    });
    expect(image).toEqual({
      id: 'b',
      lines: '招牌拿铁',
      sceneImageId: 17,
      motion: 'zoom-out',
      visualSource: 'original',
    });
    expect(gone).toEqual({ id: 'c', lines: '素材已删' });
  });

  it('视频素材只留引用、说明、标签与时长；开场素材必须指向现有素材', () => {
    const videos = normalizeStoreVisitSceneVideos([
      {
        type: 'video',
        id: 5,
        name: '门头.mp4',
        url: 'https://cdn/v5.mp4',
        description: ' 门头招牌 ',
        tags: ['门头', '门头'],
        durationSeconds: 12.34,
        videoId: 999,
      } as never,
      { id: 5, name: '重复' },
    ]);
    expect(videos).toEqual([
      {
        type: 'video',
        id: 5,
        name: '门头.mp4',
        url: 'https://cdn/v5.mp4',
        description: '门头招牌',
        tags: ['门头'],
        durationSeconds: 12.3,
      },
    ]);
    expect(
      normalizeStoreVisitOpeningScene({ type: 'video', id: 5 }, [], videos),
    ).toEqual({ type: 'video', id: 5 });
    expect(
      normalizeStoreVisitOpeningScene({ type: 'image', id: 5 }, [], videos),
    ).toBeUndefined();
  });

  it('只配音的旧产出被清掉，已生成的原声视频在未改动时保留', () => {
    const old = {
      id: 'a',
      lines: '门头',
      sceneVideoId: 5,
      audioUrl: 'https://old.wav',
    };
    expect(
      mergeStoreVisitSegments(
        [{ id: old.id, lines: old.lines, sceneVideoId: 5 }],
        [old],
      )[0].audioUrl,
    ).toBeUndefined();
    const video = { ...old, videoId: 41, nativeAudio: true };
    expect(mergeStoreVisitSegments([old], [video])[0]).toMatchObject({
      videoId: 41,
      nativeAudio: true,
    });
    expect(
      mergeStoreVisitSegments([{ ...old, clipStart: 2 }], [video])[0].videoId,
    ).toBeUndefined();
  });

  it('视频素材和旧缓推照片全部进入视频生成队列，按段生成并计费', async () => {
    const service = buildService(materialSetting());
    const result = await service.start(2, scope);
    expect(result.operations).toHaveLength(3);
    expect(service.fetchShuyan).toHaveBeenCalledTimes(1);
    expect(service.billing.chargeService).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(service.fetchShuyan.mock.calls[0][1].body);
    expect(payload.generate_audio).toBe(true);
    expect(payload.content).toContainEqual({
      type: 'video_url',
      video_url: { url: 'https://cdn/v5.mp4' },
      role: 'reference_video',
    });
    expect(service.repository.requireVideo).toHaveBeenCalledWith(5, scope);
    const rows = service.operations.insertOne.mock.calls.map(
      (call: any[]) => call[0],
    );
    expect(
      rows.every(
        (row: any) => row.provider === 'shuyan' && row.status === 'queued',
      ),
    ).toBe(true);
    expect(rows[0].request.nativeAudio).toBe(true);
    expect(rows[1].continuity.stage).toBe('waiting');
    expect(
      service.repository.updateStoreVisitSegment.mock.calls.every(
        (call: any[]) => call[2] === null,
      ),
    ).toBe(true);
  });

  it('旧照片本机缓推也必须调用视频节点，不能只配音完成', async () => {
    const setting = materialSetting();
    setting.segments = [setting.segments![1]];
    const service = buildService(setting);
    await service.start(2, scope);
    expect(
      service.workflowModels.resolveNodeRuntime.mock.calls.some(
        (call: string[]) => call[1] === 'store-visit-video',
      ),
    ).toBe(true);
    expect(service.fetchShuyan).toHaveBeenCalledTimes(1);
    expect(service.operations.insertOne.mock.calls[0][0].request).toMatchObject(
      { nativeAudio: true, visualSource: 'original' },
    );
  });

  it('门店照片和人物照一起交给多图模型：提示词先说明图1、图2 各是什么，再写脚本，不生成首帧', async () => {
    const setting = materialSetting();
    setting.faceImage = {
      type: 'image',
      id: 848,
      name: '铁山',
      url: 'https://cdn/face.jpg',
    };
    setting.segments = [
      {
        id: 'seg-1',
        lines: '老铁们，今天我们来到了街角咖啡店！',
        sceneImageId: 17,
        shot: 'presenter',
        visualSource: 'references',
        action: '站在门口挥手打招呼',
      },
    ];
    const service = buildService(setting);
    service.repository.get.mockResolvedValue({
      id: 2,
      kind: 'child',
      title: '街角咖啡店',
      productionMode: 'store-visit',
      personaId: 1,
      storeVisit: setting,
    });
    service.personas = {
      get: jest.fn().mockResolvedValue({
        name: '铁山',
        appearance: '三十岁出头的东北汉子，寸头，黑色夹克',
        referenceImages: [
          { view: 'closeup', imageId: 848, url: 'https://cdn/face.jpg' },
          { view: 'front', imageId: 846, url: 'https://cdn/full-body.jpg' },
        ],
      }),
    };
    await service.start(2, scope);
    const payload = JSON.parse(service.fetchShuyan.mock.calls[0][1].body);
    const text: string = payload.content[0].text;
    expect(text.indexOf('【图片说明】')).toBeLessThan(text.indexOf('【脚本】'));
    expect(text).toContain(
      '图1：本段的门店画面——招牌拿铁，抖音团购价 19.9 元（招牌产品）',
    );
    expect(text).toContain(
      '图2：出镜人物「铁山」（三十岁出头的东北汉子，寸头，黑色夹克）',
    );
    // Seedance 2.0：这段配音作为音频1 参考音色，人物自己开口说话
    expect(text).toContain('音频1：人物的声音参考');
    expect(text).toContain(
      '站在门口挥手打招呼，用音频1 的音色和语气对着镜头说："老铁们，今天我们来到了街角咖啡店！"',
    );
    expect(text).toContain('音色和语气与音频1 一致');
    // 人物要站在场景里而不是大头贴；画面里已有的东西要动起来
    expect(text).toContain('人物站在场景的地面上');
    expect(text).toContain('不要拍成大头特写');
    expect(text).toContain('原图里本来就有的东西自然地动起来');
    expect(
      payload.content
        .slice(1)
        .map(
          (item: {
            role: string;
            image_url?: { url: string };
            audio_url?: { url: string };
          }) => [item.role, (item.image_url ?? item.audio_url)?.url],
        ),
    ).toEqual([
      ['reference_image', 'https://cdn/latte.jpg'],
      ['reference_image', 'https://cdn/full-body.jpg'],
      ['reference_audio', 'https://oss.example/a.wav'],
    ]);
    expect(payload.generate_audio).toBe(true);
    expect(service.operations.insertOne.mock.calls[0][0].request).toMatchObject(
      { nativeAudio: true },
    );
  });

  it('只输入声音提示词时无需百炼，H3 直接生成台词与声音', async () => {
    const setting = materialSetting();
    setting.segments = [setting.segments![1]];
    setting.voiceId = undefined;
    setting.voiceModel = undefined;
    setting.voiceSource = undefined;
    setting.voicePrompt = '二十多岁男声，中气足，东北口音，语速自然';
    const service = buildService(setting);
    service.workflowModels.resolveNodeRuntime.mockResolvedValue({
      providerCode: 'shuyan',
      providerId: 'sy',
      model: 'MiniMax-H3',
      apiKey: 'test',
    });
    await service.start(2, scope);
    expect(service.cosyVoice.synthesize).not.toHaveBeenCalled();
    expect(service.storage.saveAudio).not.toHaveBeenCalled();
    const payload = JSON.parse(service.fetchShuyan.mock.calls[0][1].body);
    expect(payload.content[0].text).toContain(setting.voicePrompt);
    expect(payload.content[0].text).toContain(setting.segments![0].lines);
    expect(payload.content[0].text).toContain('直接在本段视频里生成自然的人声');
    expect(payload.content[0].text).not.toMatch(/静音|不生成人声|台词仅用于/);
    expect(payload.content.some((item: any) => item.type === 'audio_url')).toBe(
      false,
    );
    expect(service.operations.insertOne.mock.calls[0][0].request).toMatchObject(
      { nativeAudio: true, voiceMode: 'prompt' },
    );
  });

  it('音色样本不满足参考音频时长时改用提示词，视频仍自行说话', async () => {
    const setting = materialSetting();
    setting.segments = [setting.segments![1]];
    const service = buildService(setting);
    service.cosyVoice.synthesize.mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 1.2,
    });
    await service.start(2, scope);
    const payload = JSON.parse(service.fetchShuyan.mock.calls[0][1].body);
    expect(payload.generate_audio).toBe(true);
    expect(payload.content.some((item: any) => item.type === 'audio_url')).toBe(
      false,
    );
    expect(
      service.operations.insertOne.mock.calls[0][0].request.voiceMode,
    ).toBe('prompt');
  });

  it('单段重做生成视频，后面独立且已生成原声的段不重复扣费', async () => {
    const setting = materialSetting();
    setting.segments = setting.segments!.map((segment, index) => ({
      ...segment,
      videoId: 41 + index,
      nativeAudio: true,
    }));
    const service = buildService(setting);
    const result = await service.startOne(2, 'seg-1', scope);
    expect(result.operations).toHaveLength(1);
    expect(service.fetchShuyan).toHaveBeenCalledTimes(1);
    expect(service.billing.chargeService).toHaveBeenCalledTimes(1);
  });
});

describe('探店台词按素材说明简单设计、不编造数字', () => {
  it('开场素材排第一，台词标记【素材k】按序号对回图片或视频', () => {
    const materials = listStoreVisitMaterials(materialSetting());
    expect(materials.map((item) => [item.type, item.id])).toEqual([
      ['video', 5],
      ['image', 17],
    ]);
    expect(describeStoreVisitMaterials(materials)).toBe(
      '素材1（开场·门头，视频 12 秒）：门头招牌（标签：门头）\n素材2（图片）：招牌拿铁，抖音团购价 19.9 元（标签：招牌产品）',
    );
    expect(
      parseStoreVisitMaterialSegments(
        '【素材1】\n今天我们来到了街角咖啡店\n【素材2】\n招牌拿铁只要 19.9 元',
        materials,
      ),
    ).toEqual([
      { sceneVideoId: 5, lines: '今天我们来到了街角咖啡店' },
      { sceneImageId: 17, lines: '招牌拿铁只要 19.9 元' },
    ]);
    expect(
      parseStoreVisitMaterialSegments('【素材3】\n越界', materials),
    ).toEqual([]);
  });

  it('资料里没有的数字、中文数字价格和开场没报店名都会提醒', () => {
    expect(
      findStoreVisitUnknownNumbers(
        '这么大一桌只要 199 元，4 个人吃，再送 2 杯',
        '双人套餐 199.00 元，4 人份',
      ),
    ).toEqual(['2']);
    expect(
      reviewStoreVisitLines({
        segments: [{ lines: '今天带大家逛一家店' }, { lines: '只要九十九元' }],
        facts: '套餐 99 元',
        storeName: '街角咖啡店',
      }),
    ).toEqual([
      '台词里有用中文数字写的价格，请改成素材说明里的数字',
      '开场段没有说出门店名称「街角咖啡店」',
      '台词总共只有约 3 秒，偏短；把素材说明写具体些（套餐包含什么、怎么玩、适合谁）再让 AI 重写，内容会更饱满',
    ]);
    expect(
      reviewStoreVisitLines({
        segments: [
          { lines: '今天我们来到了街角咖啡店，'.repeat(4) },
          { lines: '招牌拿铁是店里主打，抖音团购只要 99 元。'.repeat(3) },
        ],
        facts: '套餐 99 元',
        storeName: '街角咖啡店',
      }),
    ).toEqual([]);
  });

  /** @description 构造只替换 LLM 的写台词服务。 @keyword-cn 写台词测试服务, LLM替身 @keyword-en lines-writer-test-service, llm-double */
  function buildWriter(responses: string[]) {
    const agent = {
      runWithMessages: jest.fn(),
    };
    responses.forEach((content) =>
      agent.runWithMessages.mockResolvedValueOnce({ content }),
    );
    const service = new DouyinChildTopicGenerationService(
      agent as never,
      {} as never,
      {} as never,
      {
        get: jest.fn().mockResolvedValue({
          id: 2,
          kind: 'child',
          title: '街角咖啡店探店',
          productionMode: 'store-visit',
          storyboard: [],
          storeVisit: { ...materialSetting(), template: 'voiceover' },
        }),
      } as never,
      { resolveNodeRuntime: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
    );
    return { service, agent };
  }

  it('开场报店名与亮点，其余按素材说明介绍，团购价连同对象一起报且只是可选写法，不用江湖口吻；编了资料里没有的价格时让模型按资料重写一次', async () => {
    const { service, agent } = buildWriter([
      '【素材1】\n今天我们来到了街角咖啡店\n【素材2】\n招牌拿铁抖音团购只要 29 元',
      '【素材1】\n家人们，今天我们来到了街角咖啡店，门头就是这块招牌，路过一眼就能认出来。\n【素材2】\n再来看看店里的招牌拿铁，这是他们家的主打，抖音团购只要 19.9 元，下午来一杯刚刚好。\n【素材1】\n想去的直接点视频下方的团购链接，先囤上再说，到店出示就能用。',
    ]);
    const result = await service.writeStoreVisitLines(2, undefined, scope);
    expect(agent.runWithMessages).toHaveBeenCalledTimes(2);
    const first = agent.runWithMessages.mock.calls[0][0];
    expect(first.config.system).toContain('今天我们来到了街角咖啡店');
    expect(first.config.system).toContain('不能单独甩出一个价格');
    expect(first.config.system).toContain(
      '不用「老铁」「兄弟」「整」这类江湖口吻',
    );
    expect(first.config.system).toContain('【示例】');
    expect(first.config.system).toContain('不必每段都报价');
    expect(first.config.system).toContain('不许编造');
    expect(first.messages[0].content).toContain(
      '门店名称：<store_name>街角咖啡店</store_name>',
    );
    const retry = agent.runWithMessages.mock.calls[1][0].messages;
    expect(retry[1]).toMatchObject({ role: 'assistant' });
    expect(retry[2].content).toContain('「29」在资料里找不到');
    expect(result.segments).toEqual([
      {
        sceneVideoId: 5,
        lines:
          '家人们，今天我们来到了街角咖啡店，门头就是这块招牌，路过一眼就能认出来。',
      },
      {
        sceneImageId: 17,
        lines:
          '再来看看店里的招牌拿铁，这是他们家的主打，抖音团购只要 19.9 元，下午来一杯刚刚好。',
      },
      {
        sceneVideoId: 5,
        lines: '想去的直接点视频下方的团购链接，先囤上再说，到店出示就能用。',
      },
    ]);
    expect(result.warnings).toBeUndefined();
  });

  it('方言和谐音字不好配音：提示词要求普通话用词且优先于人物设定，写出「嘎哈」时让模型改成普通话重写', async () => {
    const { service, agent } = buildWriter([
      '【素材1】\n今天我们来到了街角咖啡店，看电影、聚会都嘎哈都行\n【素材2】\n招牌拿铁杠杠的，抖音团购只要 19.9 元',
      '【素材1】\n家人们，今天我们来到了街角咖啡店，门头就是这块招牌，路过一眼就能认出来。\n【素材2】\n再来看看店里的招牌拿铁，这是他们家的主打，抖音团购只要 19.9 元，下午来一杯刚刚好。\n【素材1】\n想去的直接点视频下方的团购链接，先囤上再说，到店出示就能用。',
    ]);
    const result = await service.writeStoreVisitLines(2, undefined, scope);
    const first = agent.runWithMessages.mock.calls[0][0];
    expect(first.config.system).toContain('【好念】');
    expect(first.config.system).toContain('这一条优先于人物设定和补充要求');
    expect(agent.runWithMessages).toHaveBeenCalledTimes(2);
    expect(
      agent.runWithMessages.mock.calls[1][0].messages[2].content,
    ).toContain('「嘎哈」「杠杠的」是方言或谐音字');
    expect(result.warnings).toBeUndefined();
  });

  it('方言谐音字写进提醒，店名里本来就有的字不算', () => {
    expect(
      findStoreVisitHardToVoiceWords('聚会都嘎哈都行，俺家烤肉', '俺家烤肉'),
    ).toEqual(['嘎哈']);
    expect(
      reviewStoreVisitLines({
        segments: [
          { lines: '今天我们来到了街角咖啡店，'.repeat(4) },
          { lines: '看电影、开黑、聚会都嘎哈都行，必须的安排上。'.repeat(3) },
        ],
        facts: '',
        storeName: '街角咖啡店',
      }),
    ).toEqual([
      '台词里的「嘎哈」是方言或谐音字，配音和视频模型可能念不准，建议改成普通话说法',
    ]);
  });

  it('重写后仍有资料里没有的数字时带上提醒返回，不悄悄放过', async () => {
    const text =
      '【素材1】\n今天我们来到了街角咖啡店\n【素材2】\n拿铁只要 9 元';
    const { service } = buildWriter([text, text]);
    const result = await service.writeStoreVisitLines(2, undefined, scope);
    expect(result.warnings).toEqual([
      '台词里的「9」在素材说明里找不到，请核对价格和份量',
      '台词总共只有约 4 秒，偏短；把素材说明写具体些（套餐包含什么、怎么玩、适合谁）再让 AI 重写，内容会更饱满',
    ]);
  });

  it('没有素材时不调用模型，提示先选素材', async () => {
    const { service, agent } = buildWriter([]);
    (service as unknown as { repository: { get: jest.Mock } }).repository.get =
      jest.fn().mockResolvedValue({
        id: 2,
        kind: 'child',
        title: '街角咖啡店探店',
        productionMode: 'store-visit',
        storeVisit: {},
      });
    await expect(
      service.writeStoreVisitLines(2, undefined, scope),
    ).rejects.toThrow('先在「素材」步骤');
    expect(agent.runWithMessages).not.toHaveBeenCalled();
  });
});

describe('探店素材保存参数校验', () => {
  it('门店名称、视频素材、开场素材与分段的入点、运镜、本机缓推都能通过校验，未知运镜被拒', async () => {
    const valid = plainToInstance(DouyinStoreVisitDto, {
      storeName: '街角咖啡店',
      sceneVideos: [
        {
          type: 'video',
          id: 5,
          name: '门头',
          url: 'https://cdn/v5.mp4',
          description: '门头招牌',
          tags: ['门头'],
          durationSeconds: 12,
        },
      ],
      openingScene: { type: 'video', id: 5 },
      segments: [
        { lines: '门头', sceneVideoId: 5, clipStart: 1.5 },
        {
          lines: '拿铁',
          sceneImageId: 17,
          visualSource: 'local',
          motion: 'pan',
        },
      ],
    });
    expect(await validate(valid)).toEqual([]);
    const invalid = plainToInstance(DouyinStoreVisitDto, {
      segments: [{ lines: '拿铁', sceneImageId: 17, motion: 'spin' }],
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });
});
