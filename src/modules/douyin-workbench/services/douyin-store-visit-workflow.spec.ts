import { BadRequestException } from '@nestjs/common';
import type { Db } from 'mongodb';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  clearPresenterKeyframes,
  DouyinWorkbenchRepositoryService,
  mergeStoreVisitSegments,
} from './douyin-workbench-repository.service.js';
import {
  buildStoreVisitSceneBrief,
  DouyinStoreVisitService,
} from './douyin-store-visit.service.js';
import {
  buildStoreVisitContinuityBrief,
  isStoreVisitSceneStart,
  parseStoreVisitContinuityPlan,
} from './douyin-store-visit-continuity.js';
import {
  buildStoreVisitLipSyncFaces,
  describeStoreVisitLipSyncSkip,
  parseStoreVisitFaceMatches,
  planStoreVisitFaceMatch,
  readStoreVisitFaces,
} from './douyin-store-visit-lip-sync.js';
import { DouyinChildTopicGenerationService } from './douyin-child-topic-generation.service.js';
import {
  COSYVOICE_CLONE_MODEL,
  COSYVOICE_PRESET_MODEL,
} from './douyin-cosyvoice.service.js';
import {
  DouyinStoreVisitDto,
  DouyinStoreVisitVoiceDto,
} from '../controller/douyin-workbench.dto.js';

/**
 * @description 构造独立探店草稿与素材归属测试仓储。
 * @keyword-cn 探店流程测试仓储, 租户素材测试
 * @keyword-en store-visit-test-repository, tenant-media-test
 */
function buildStoreVisitRepository() {
  let sequence = 0;
  const topics = {
    createIndex: jest.fn().mockResolvedValue('index'),
    insertOne: jest.fn().mockResolvedValue({}),
    insertMany: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue({ id: 2, kind: 'child' }),
    findOneAndUpdate: jest.fn().mockResolvedValue({ id: 2, kind: 'child' }),
  };
  const gallery = { findOne: jest.fn().mockResolvedValue({ id: 17 }) };
  const videos = { findOne: jest.fn().mockResolvedValue({ id: 31 }) };
  const counters = {
    findOneAndUpdate: jest
      .fn()
      .mockImplementation(async () => ({ value: { seq: ++sequence } })),
  };
  const db = {
    collection: jest
      .fn()
      .mockImplementation((name: string) =>
        name === 'douyin_topics'
          ? topics
          : name === 'counters'
            ? counters
            : name === 'videos'
              ? videos
              : gallery,
      ),
  };
  return {
    repository: new DouyinWorkbenchRepositoryService(db as unknown as Db),
    topics,
    gallery,
  };
}

/**
 * @description 构造探店画外音测试服务：保留真实的作用域校验、扣费退费与分段校验逻辑，替换数据库、存储、百炼与数眼网络。
 * @keyword-cn 画外音测试服务, 探店服务替身
 * @keyword-en voiceover-test-service, store-visit-service-double
 */
function buildVoiceoverService(topic: Record<string, unknown> = {}) {
  const service = Object.create(DouyinStoreVisitService.prototype);
  service.previews = new Map();
  service.repository = {
    get: jest.fn().mockResolvedValue({
      id: 2,
      kind: 'child',
      title: '街角咖啡店',
      productionMode: 'store-visit',
      ...topic,
    }),
    saveStoreVisitVoice: jest
      .fn()
      .mockImplementation(async (_id, voice) => ({ id: 2, storeVisit: voice })),
    updateStoreVisitSegment: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  };
  service.storage = {
    hasPublicStorage: jest.fn().mockReturnValue(true),
    saveAudio: jest
      .fn()
      .mockResolvedValue({ url: 'https://oss.example/a.wav', key: 'k/a.wav' }),
    deleteAudio: jest.fn().mockResolvedValue(undefined),
    publishImage: jest
      .fn()
      .mockImplementation(async (url: string) =>
        /^https?:\/\//.test(url) ? url : 'https://oss.example/first-frame.png',
      ),
  };
  service.cosyVoice = {
    createVoice: jest.fn().mockResolvedValue('cosyvoice-v3.5-plus-aim2-x'),
    waitVoiceReady: jest.fn().mockResolvedValue(undefined),
    deleteVoice: jest.fn().mockResolvedValue(true),
    synthesize: jest.fn().mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 9.6,
      characters: 80,
      url: 'https://dashscope.example/t.wav',
    }),
    synthesizePreview: jest
      .fn()
      .mockResolvedValue({ url: 'https://dashscope.example/p.mp3' }),
  };
  service.workflowModels = {
    resolveNodeRuntime: jest
      .fn()
      .mockImplementation(async (_workflow: string, node: string) =>
        node === 'voice-clone'
          ? {
              providerId: 'ds-1',
              providerCode: 'dashscope',
              providerName: '百炼',
              model: 'cosyvoice-v3.5-plus',
              apiKey: 'sk-test',
            }
          : node === 'store-visit-avatar'
            ? {
                providerId: 'sy-2',
                providerCode: 'shuyan',
                providerName: '数眼',
                model: 'kling-avatar-pro',
                apiKey: 'sk-shuyan',
              }
            : {
                providerId: 'sy-1',
                providerCode: 'shuyan',
                providerName: '数眼',
                model: 'doubao-seedance-2-0-260128',
                apiKey: 'sk-shuyan',
              },
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
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
  };
  service.fetchShuyan = jest
    .fn()
    .mockImplementation(async (url: string) =>
      url.includes('/kling/')
        ? { code: 0, data: { task_id: 'kling-1' } }
        : { id: 'task-1' },
    );
  return service;
}

const voiceFile = {
  buffer: Buffer.from('fake-audio'),
  originalname: 'me.mp3',
  mimetype: 'audio/mpeg',
  size: 10,
};

const readyTopic = {
  storeVisit: {
    sceneImages: [
      {
        id: 17,
        type: 'image',
        name: '吧台',
        url: 'https://cdn/scene.jpg',
        description: '木质吧台，咖啡师在做拿铁',
        tags: ['吧台', '招牌拿铁'],
      },
    ],
    sceneDescription: '木质吧台，招牌拿铁',
    voiceSource: 'clone',
    voiceId: 'cosyvoice-v3.5-plus-aim2-x',
    voiceModel: 'cosyvoice-v3.5-plus',
    voiceProviderId: 'ds-1',
    segments: [
      {
        id: 'seg-1',
        lines: '今天带大家来看看这家街角咖啡店',
        sceneImageId: 17,
      },
    ],
  },
};

/** @description 构造可原子认领的真实形状续段记录和视觉模型替身，用来验证串行、鉴权与尾帧入参。 @keyword-cn 连续生成测试服务, 原子认领测试 @keyword-en continuity-test-service, atomic-claim-test */
function buildContinuityService() {
  const topic = {
    ...readyTopic,
    storeVisit: {
      ...readyTopic.storeVisit,
      segments: [
        {
          id: 'seg-1',
          lines: '先看一下吧台',
          sceneImageId: 17,
          videoId: 41,
          audioUrl: 'https://oss.example/a.wav',
          audioSeconds: 9.6,
        },
        { id: 'seg-2', lines: '接着介绍招牌咖啡', sceneImageId: 17 },
      ],
    },
  };
  const service = buildVoiceoverService(topic);
  const row = {
    id: 'pending-2',
    topicId: 2,
    segmentId: 'seg-2',
    status: 'queued',
    mode: 'store-visit',
    provider: 'shuyan',
    tenantId: 'tenant-1',
    userId: 'user-1',
    continuity: {
      stage: 'waiting',
      previousSegmentId: 'seg-1',
      sequenceId: 'sequence',
    },
    request: {
      lines: topic.storeVisit.segments[1].lines,
      action: '',
      sceneImageId: 17,
      shot: 'broll',
      voiceId: topic.storeVisit.voiceId,
      faceImageId: null,
    },
  };
  /** @description 按用户与租户查找续段测试记录。 @keyword-cn 续段作用域测试, 记录匹配 @keyword-en continuation-scope-test, record-match */
  service.operations.findOne.mockImplementation(
    async function findQueuedOperation(query: Record<string, unknown>) {
      return query.id === row.id &&
        (!query.userId || query.userId === row.userId) &&
        (!query.tenantId || query.tenantId === row.tenantId)
        ? row
        : null;
    },
  );
  /** @description 测试中仅允许第一次原子认领等待记录。 @keyword-cn 测试原子认领, 重复提交防护 @keyword-en test-atomic-claim, duplicate-submit-guard */
  service.operations.findOneAndUpdate.mockImplementation(
    async function claimQueuedOperation() {
      if (row.continuity.stage !== 'waiting' || row.status !== 'queued')
        return null;
      row.continuity.stage = 'planning';
      return row;
    },
  );
  /** @description 将状态修改应用到续段测试记录。 @keyword-cn 测试状态写入, 续段记录 @keyword-en test-status-write, continuation-record */
  service.operations.updateOne.mockImplementation(
    async function patchQueuedOperation(
      _query: Record<string, unknown>,
      patch: { $set: Record<string, unknown> },
    ) {
      Object.assign(row, patch.$set);
      return { modifiedCount: 1 };
    },
  );
  service.repository.requireImage = jest.fn().mockResolvedValue({
    type: 'image',
    id: 92,
    url: 'https://cdn.example/actual-tail.jpg',
  });
  service.repository.requireVideo = jest
    .fn()
    .mockResolvedValue({ url: 'https://cdn.example/previous.mp4' });
  service.agentService = {
    runWithMessages: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        tailDescription: '镜头位于吧台左侧，光线温暖',
        transition: '继续缓慢右移到咖啡杯',
        videoPrompt:
          '严格从尾帧的吧台左侧画面接续，向右平移展示咖啡杯，保持机位和光线。',
      }),
    }),
  };
  return { service, row, topic };
}

describe('探店真实尾帧连续生成', () => {
  const scope = { tenantId: 'tenant-1', userId: 'user-1' };
  it('台词或人物空镜切换不算换场景，真正换场景才切起始图', () => {
    const segments = [
      { id: 'a', lines: '开场', sceneImageId: 17 },
      { id: 'b', lines: '介绍', sceneImageId: 17, shot: 'presenter' as const },
      { id: 'c', lines: '换位置', sceneImageId: 18 },
    ];
    expect(isStoreVisitSceneStart(segments, 1)).toBe(false);
    expect(isStoreVisitSceneStart(segments, 2)).toBe(true);
    expect(
      buildStoreVisitContinuityBrief({
        title: '探店',
        previous: segments[0],
        segment: segments[1],
        sceneChanged: false,
      }),
    ).toContain('人物自然入画');
    expect(() =>
      parseStoreVisitContinuityPlan('{"videoPrompt":"重开镜"}'),
    ).toThrow('缺少');
  });
  it('视觉 LLM 同时看真实尾帧和原始场景，生成接口只用尾帧作严格首帧', async () => {
    const { service } = buildContinuityService();
    await service.continueOperation(
      'pending-2',
      { previousVideoId: 41, tailImageId: 92 },
      scope,
    );
    const images =
      service.agentService.runWithMessages.mock.calls[0][0].messages[0].content.filter(
        (item: { type: string }) => item.type === 'image_url',
      );
    expect(
      images.map((item: { image_url: { url: string } }) => item.image_url.url),
    ).toEqual(['https://cdn.example/actual-tail.jpg', 'https://cdn/scene.jpg']);
    const payload = JSON.parse(service.fetchShuyan.mock.calls[0][1].body);
    expect(
      payload.content.filter(
        (item: { type: string }) => item.type === 'image_url',
      ),
    ).toEqual([
      {
        type: 'image_url',
        role: 'first_frame',
        image_url: { url: 'https://cdn.example/actual-tail.jpg' },
      },
    ]);
    expect(payload.content[0].text).toContain('严格从尾帧的吧台左侧画面接续');
    expect(payload.generate_audio).toBe(false);
    expect(service.billing.chargeService).toHaveBeenCalledTimes(1);
  });
  it('重复续段只认领一次，不重复扣费和请求供应商', async () => {
    const { service } = buildContinuityService();
    await Promise.all([
      service.continueOperation(
        'pending-2',
        { previousVideoId: 41, tailImageId: 92 },
        scope,
      ),
      service.continueOperation(
        'pending-2',
        { previousVideoId: 41, tailImageId: 92 },
        scope,
      ),
    ]);
    expect(service.fetchShuyan).toHaveBeenCalledTimes(1);
    expect(service.billing.chargeService).toHaveBeenCalledTimes(1);
  });
  it('前段被重新生成、跨用户或跨租户调用都不能续接或扣费', async () => {
    const { service } = buildContinuityService();
    await expect(
      service.continueOperation(
        'pending-2',
        { previousVideoId: 99, tailImageId: 92 },
        scope,
      ),
    ).rejects.toThrow('上一段的视频已变化');
    await expect(
      service.continueOperation(
        'pending-2',
        { previousVideoId: 41, tailImageId: 92 },
        { ...scope, userId: 'other' },
      ),
    ).rejects.toThrow('当前用户');
    await expect(
      service.continueOperation(
        'pending-2',
        { previousVideoId: 41, tailImageId: 92 },
        { ...scope, tenantId: 'other' },
      ),
    ).rejects.toThrow('当前用户');
    expect(service.billing.chargeService).not.toHaveBeenCalled();
  });
  it('等待期间删除或重排台词会结束旧队列，避免永远挡住重新生成', async () => {
    const { service, row, topic } = buildContinuityService();
    topic.storeVisit.segments.reverse();
    await service.refreshRow(row);
    expect(row.status).toBe('failed');
    expect(service.billing.chargeService).not.toHaveBeenCalled();
  });
  it('前段失败时停止后续等待，未开始的片段不扣费', async () => {
    const { service, row, topic } = buildContinuityService();
    delete topic.storeVisit.segments[0].videoId;
    service.operations.findOne.mockResolvedValue({ status: 'failed' });
    await service.refreshRow(row);
    expect(row.status).toBe('failed');
    expect(service.billing.chargeService).not.toHaveBeenCalled();
  });
  it('修改或重排前段台词使后续旧成片作废，但同场景起始图保留', () => {
    const current = [
      {
        id: 'a',
        lines: '原台词',
        sceneImageId: 17,
        videoId: 1,
        audioUrl: 'a.wav',
      },
      {
        id: 'b',
        lines: '下一段',
        sceneImageId: 17,
        videoId: 2,
        audioUrl: 'b.wav',
      },
    ];
    const next = mergeStoreVisitSegments(
      [{ ...current[0], lines: '新台词' }, current[1]].map(
        ({ videoId, audioUrl, ...segment }) => segment,
      ),
      current,
    );
    expect(next.every((segment) => !segment.videoId)).toBe(true);
    const reordered = mergeStoreVisitSegments(
      [
        { id: 'b', lines: '下一段', sceneImageId: 17 },
        { id: 'a', lines: '原台词', sceneImageId: 17 },
      ],
      current,
    );
    expect(reordered.every((segment) => !segment.videoId)).toBe(true);
  });
});

describe('独立探店制作流程（画外音）', () => {
  const scope = { tenantId: 'tenant-1', userId: 'user-1' };

  it('新建探店母题同时创建没有脚本与分镜的真实制作草稿', async () => {
    const { repository, topics } = buildStoreVisitRepository();
    const mother = await repository.create(
      { kind: 'mother', title: '街角咖啡店', productionMode: 'store-visit' },
      scope,
    );
    const docs = topics.insertMany.mock.calls[0][0];
    expect(mother.productionMode).toBe('store-visit');
    expect(docs).toHaveLength(2);
    expect(docs[1]).toMatchObject({
      id: 2,
      parentId: mother.id,
      kind: 'child',
      tenantId: scope.tenantId,
      userId: scope.userId,
      productionMode: 'store-visit',
      storyboard: [],
      storeVisit: {},
    });
    expect(docs[1].script).toBeUndefined();
  });

  it('旧入口继续创建分镜母题，不额外创建草稿', async () => {
    const { repository, topics } = buildStoreVisitRepository();
    await repository.create({ kind: 'mother', title: '拍摄技巧' }, scope);
    expect(topics.insertOne).toHaveBeenCalledTimes(1);
    expect(topics.insertMany).not.toHaveBeenCalled();
  });

  it('独立场景按租户校验，只更新场景字段而保留音色', async () => {
    const { repository, topics, gallery } = buildStoreVisitRepository();
    await repository.update(
      2,
      {
        storeVisit: {
          sceneImages: [
            {
              id: 17,
              type: 'image',
              url: 'https://cdn/scene.jpg',
              description: ' 门头招牌 ',
              tags: [' 门头 ', '门头', ''],
            } as any,
          ],
          sceneDescription: ' 木质吧台 ',
        },
      },
      scope,
    );
    expect(gallery.findOne).toHaveBeenCalledWith({
      id: 17,
      tenantId: 'tenant-1',
    });
    const update = topics.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set['storeVisit.sceneDescription']).toBe('木质吧台');
    expect(update.$set['storeVisit.sceneImages'][0]).toMatchObject({
      id: 17,
      description: '门头招牌',
      tags: ['门头'],
    });
    expect(update.$set['storeVisit.voiceId']).toBeUndefined();
  });

  it('场景图的说明最多 500 字、标签最多 10 个，超出时校验不通过', async () => {
    const errors = await validate(
      plainToInstance(DouyinStoreVisitDto, {
        sceneImages: [
          {
            type: 'image',
            id: 17,
            name: '门头',
            url: 'https://cdn/scene.jpg',
            description: '长'.repeat(501),
            tags: Array.from({ length: 11 }, (_, index) => `标签${index}`),
          },
        ],
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors).toHaveLength(1);
  });

  it('分段场景说明：这张场景的说明与标签在前，门店整体说明在后', () => {
    expect(buildStoreVisitSceneBrief(readyTopic.storeVisit as any, 17)).toBe(
      '这一段的场景：木质吧台，咖啡师在做拿铁（吧台、招牌拿铁）；门店整体：木质吧台，招牌拿铁',
    );
    expect(
      buildStoreVisitSceneBrief({ sceneDescription: '老街小店' } as any, 99),
    ).toBe('门店整体：老街小店');
  });

  it('有场景还没写说明时在扣费前拒绝生成', async () => {
    const service = buildVoiceoverService({
      ...readyTopic,
      storeVisit: {
        ...readyTopic.storeVisit,
        sceneImages: [
          { id: 17, type: 'image', name: '吧台', url: 'https://cdn/scene.jpg' },
        ],
      },
    });
    await expect(service.start(2, scope)).rejects.toThrow('场景说明');
    expect(service.billing.chargeService).not.toHaveBeenCalled();
  });

  it('拒绝保存其他租户或不存在的场景素材', async () => {
    const { repository, topics, gallery } = buildStoreVisitRepository();
    gallery.findOne.mockResolvedValue(null);
    await expect(
      repository.update(
        2,
        {
          storeVisit: {
            sceneImages: [
              { id: 17, type: 'image', url: 'https://cdn/scene.jpg' },
            ],
          },
        },
        scope,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(topics.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('PATCH 不收音色字段，出镜人物可传 null 清掉，选用接口只收字母数字的音色 ID', async () => {
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitDto, {
          voiceId: 'forged-voice',
          voiceMode: 'prompt',
          faceImage: null,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toHaveLength(2);
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitDto, {
          faceImage: {
            type: 'image',
            id: 33,
            name: '人物',
            url: 'https://cdn/face.jpg',
          },
          template: 'bookend',
          segments: [{ id: 'seg-1', lines: '大家好', shot: 'presenter' }],
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitDto, {
          template: 'random',
          segments: [{ id: 'seg-1', lines: '大家好', shot: 'avatar' }],
        }),
      ),
    ).toHaveLength(2);
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitVoiceDto, {
          voiceId: 'longxiaochun_v3',
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitVoiceDto, { voiceId: '../etc' }),
      ),
    ).toHaveLength(1);
  });

  it.each(['clone', 'preset'] as const)(
    '保存 %s 音色清掉旧版声音设计字段，场景与台词不动',
    async (source) => {
      const { repository, topics } = buildStoreVisitRepository();
      await repository.saveStoreVisitVoice(
        2,
        {
          voiceSource: source,
          voiceName: '新音色',
          voiceId: 'voice-2',
          voiceProviderId: 'p1',
          voiceModel: 'm1',
          ...(source === 'clone'
            ? {
                voiceSample: {
                  name: 'sample.wav',
                  contentType: 'audio/wav',
                  sizeBytes: 100,
                  uploadedAt: new Date(),
                },
              }
            : {}),
        },
        scope,
      );
      const [filter, update] = topics.findOneAndUpdate.mock.calls[0];
      expect(filter).toMatchObject({
        id: 2,
        kind: 'child',
        tenantId: scope.tenantId,
        userId: scope.userId,
      });
      expect(update.$set['storeVisit.voiceSource']).toBe(source);
      expect(update.$set['storeVisit.voiceModel']).toBe('m1');
      for (const key of ['voiceMode', 'voiceDescription', 'voicePreviewUrl'])
        expect(update.$unset[`storeVisit.${key}`]).toBe('');
      if (source === 'preset') {
        expect(update.$unset['storeVisit.voiceSample']).toBe('');
        expect(update.$unset['storeVisit.voiceClonedAt']).toBe('');
      } else {
        expect(update.$set['storeVisit.voiceSample'].name).toBe('sample.wav');
        expect(update.$set['storeVisit.voiceClonedAt']).toBeInstanceOf(Date);
      }
      expect(update.$set['storeVisit.sceneImages']).toBeUndefined();
      expect(update.$set['storeVisit.lines']).toBeUndefined();
    },
  );

  it('分段没改时保留成片与配音，台词、场景或画面描述改了就作废', () => {
    const saved = [
      {
        id: 'a',
        lines: '第一段',
        sceneImageId: 17,
        videoId: 31,
        audioUrl: 'https://oss/a.wav',
        audioSeconds: 8.2,
        voiceId: 'v1',
      },
    ];
    expect(
      mergeStoreVisitSegments(
        [{ id: 'a', lines: '第一段', sceneImageId: 17 }],
        saved,
      )[0],
    ).toMatchObject({
      videoId: 31,
      audioUrl: 'https://oss/a.wav',
      voiceId: 'v1',
    });
    for (const changed of [
      { id: 'a', lines: '改过的台词', sceneImageId: 17 },
      { id: 'a', lines: '第一段', sceneImageId: 18 },
      { id: 'a', lines: '第一段', sceneImageId: 17, action: '镜头推近' },
    ]) {
      const [merged] = mergeStoreVisitSegments([changed], saved);
      expect(merged.videoId).toBeUndefined();
      expect(merged.audioUrl).toBeUndefined();
    }
  });

  it('分段成片一次写入四个字段，传 null 一次清掉', async () => {
    const { repository, topics } = buildStoreVisitRepository();
    await repository.updateStoreVisitSegment(
      2,
      'seg-1',
      {
        videoId: 31,
        audioUrl: 'https://oss/a.wav',
        audioSeconds: 8.2,
        voiceId: 'v1',
      },
      scope,
    );
    const [, written, options] = topics.findOneAndUpdate.mock.calls[0];
    expect(written.$set['storeVisit.segments.$[segment].videoId']).toBe(31);
    expect(written.$set['storeVisit.segments.$[segment].audioSeconds']).toBe(
      8.2,
    );
    expect(options.arrayFilters).toEqual([{ 'segment.id': 'seg-1' }]);
    await repository.updateStoreVisitSegment(2, 'seg-1', null, scope);
    const cleared = topics.findOneAndUpdate.mock.calls[1][1];
    for (const field of ['videoId', 'audioUrl', 'audioSeconds', 'voiceId'])
      expect(cleared.$unset[`storeVisit.segments.$[segment].${field}`]).toBe(
        '',
      );
  });

  it('没配 OSS 时在上传录音和调用百炼之前拒绝克隆', async () => {
    const service = buildVoiceoverService();
    service.storage.hasPublicStorage.mockReturnValue(false);
    await expect(service.cloneVoice(2, voiceFile, scope)).rejects.toThrow(
      'OSS',
    );
    expect(service.storage.saveAudio).not.toHaveBeenCalled();
    expect(service.cosyVoice.createVoice).not.toHaveBeenCalled();
  });

  it('克隆用节点模型绑定音色、克隆完删录音，并删掉这条脚本之前克隆的旧音色', async () => {
    const service = buildVoiceoverService({
      storeVisit: {
        voiceSource: 'clone',
        voiceId: 'old-voice',
        voiceProviderId: 'ds-1',
      },
    });
    const topic = await service.cloneVoice(2, voiceFile, scope);
    expect(service.cosyVoice.createVoice.mock.calls[0][1]).toMatchObject({
      targetModel: 'cosyvoice-v3.5-plus',
      prefix: 'aim2',
      audioUrl: 'https://oss.example/a.wav',
    });
    expect(service.storage.deleteAudio).toHaveBeenCalledWith('k/a.wav');
    expect(service.cosyVoice.deleteVoice).toHaveBeenCalledWith(
      expect.anything(),
      'old-voice',
    );
    expect(topic.storeVisit).toMatchObject({
      voiceSource: 'clone',
      voiceModel: COSYVOICE_CLONE_MODEL,
      voiceProviderId: 'ds-1',
    });
    expect(service.operations.insertOne.mock.calls[0][0]).toMatchObject({
      operation: 'voice-clone',
      provider: 'dashscope',
      status: 'completed',
    });
  });

  it('克隆审核不通过时也删掉录音和半成品音色，记失败审计', async () => {
    const service = buildVoiceoverService();
    service.cosyVoice.waitVoiceReady.mockRejectedValue(
      new Error('DASHSCOPE_VOICE_REJECTED'),
    );
    await expect(service.cloneVoice(2, voiceFile, scope)).rejects.toThrow(
      '审核',
    );
    expect(service.storage.deleteAudio).toHaveBeenCalledWith('k/a.wav');
    expect(service.cosyVoice.deleteVoice).toHaveBeenCalledWith(
      expect.anything(),
      'cosyvoice-v3.5-plus-aim2-x',
    );
    expect(service.repository.saveStoreVisitVoice).not.toHaveBeenCalled();
    expect(service.operations.insertOne.mock.calls[0][0].status).toBe('failed');
  });

  it('录音格式不是 mp3 / wav / m4a 时直接拒绝', async () => {
    const service = buildVoiceoverService();
    await expect(
      service.cloneVoice(
        2,
        { ...voiceFile, originalname: 'me.webm', mimetype: 'audio/webm' },
        scope,
      ),
    ).rejects.toThrow('格式');
    expect(service.storage.saveAudio).not.toHaveBeenCalled();
  });

  it('只能选用目录里的系统音色，保存时固定用系统音色模型', async () => {
    const service = buildVoiceoverService();
    await expect(
      service.usePresetVoice(2, 'not-a-voice', scope),
    ).rejects.toThrow('可选音色');
    const topic = await service.usePresetVoice(2, 'longxiaochun_v3', scope);
    expect(topic.storeVisit).toMatchObject({
      voiceSource: 'preset',
      voiceId: 'longxiaochun_v3',
      voiceModel: COSYVOICE_PRESET_MODEL,
      voiceProviderId: 'ds-1',
    });
  });

  it('提示词定制音色：按描述设计并等可用，写进脚本、删掉旧克隆音色并记审计', async () => {
    const service = buildVoiceoverService({
      storeVisit: {
        voiceSource: 'clone',
        voiceId: 'old-voice',
        voiceProviderId: 'ds-1',
      },
    });
    service.cosyVoice.designVoice = jest
      .fn()
      .mockResolvedValue('cosyvoice-v3.5-plus-vd-aim2-x');
    const topic = await service.designVoice(
      2,
      { prompt: '  二十多岁的女生，声音清亮有活力  ' },
      scope,
    );
    expect(service.cosyVoice.designVoice.mock.calls[0][1]).toMatchObject({
      targetModel: 'cosyvoice-v3.5-plus',
      prefix: 'aim2',
      prompt: '二十多岁的女生，声音清亮有活力',
    });
    expect(
      service.cosyVoice.designVoice.mock.calls[0][1].previewText.length,
    ).toBeGreaterThanOrEqual(15);
    expect(service.cosyVoice.waitVoiceReady).toHaveBeenCalledWith(
      expect.anything(),
      'cosyvoice-v3.5-plus-vd-aim2-x',
    );
    expect(service.cosyVoice.deleteVoice).toHaveBeenCalledWith(
      expect.anything(),
      'old-voice',
    );
    expect(topic.storeVisit).toMatchObject({
      voiceSource: 'design',
      voiceId: 'cosyvoice-v3.5-plus-vd-aim2-x',
      voiceModel: 'cosyvoice-v3.5-plus',
      voicePrompt: '二十多岁的女生，声音清亮有活力',
      voiceName: '二十多岁的女生，声音清亮有活力',
    });
    expect(service.operations.insertOne.mock.calls[0][0]).toMatchObject({
      operation: 'voice-design',
      status: 'completed',
    });
  });

  it('提示词定制失败时保留原音色、删掉半成品并提示换个说法', async () => {
    const service = buildVoiceoverService();
    service.cosyVoice.designVoice = jest
      .fn()
      .mockResolvedValue('cosyvoice-v3.5-plus-vd-aim2-x');
    service.cosyVoice.waitVoiceReady.mockRejectedValue(
      new Error('DASHSCOPE_VOICE_REJECTED'),
    );
    await expect(
      service.designVoice(2, { prompt: '沉稳的中年男声' }, scope),
    ).rejects.toThrow('换个说法');
    expect(service.cosyVoice.deleteVoice).toHaveBeenCalledWith(
      expect.anything(),
      'cosyvoice-v3.5-plus-vd-aim2-x',
    );
    expect(service.repository.saveStoreVisitVoice).not.toHaveBeenCalled();
    expect(service.operations.insertOne.mock.calls[0][0].status).toBe('failed');
    await expect(
      service.designVoice(2, { prompt: '女' }, scope),
    ).rejects.toThrow(BadRequestException);
  });

  it('本脚本提示词定制的音色可以试听，用它绑定的模型', async () => {
    const service = buildVoiceoverService({
      storeVisit: {
        voiceSource: 'design',
        voiceId: 'cosyvoice-v3.5-flash-vd-aim2-x',
        voiceModel: 'cosyvoice-v3.5-flash',
        voiceProviderId: 'ds-1',
      },
    });
    await service.previewVoice(2, 'cosyvoice-v3.5-flash-vd-aim2-x', scope);
    expect(service.cosyVoice.synthesizePreview.mock.calls[0][1].model).toBe(
      'cosyvoice-v3.5-flash',
    );
  });

  it('试听只给系统音色或本脚本克隆的音色，结果会缓存', async () => {
    const service = buildVoiceoverService(readyTopic);
    await expect(
      service.previewVoice(2, 'someone-elses-voice', scope),
    ).rejects.toThrow('只能试听');
    await service.previewVoice(2, 'cosyvoice-v3.5-plus-aim2-x', scope);
    expect(service.cosyVoice.synthesizePreview.mock.calls[0][1].model).toBe(
      'cosyvoice-v3.5-plus',
    );
    await service.previewVoice(2, 'longanyang', scope);
    await service.previewVoice(2, 'longanyang', scope);
    expect(service.cosyVoice.synthesizePreview).toHaveBeenCalledTimes(2);
    expect(service.cosyVoice.synthesizePreview.mock.calls[1][1].model).toBe(
      COSYVOICE_PRESET_MODEL,
    );
  });

  it.each([
    ['没有场景图', { ...readyTopic.storeVisit, sceneImages: [] }, '场景图'],
    [
      '有段没选场景',
      {
        ...readyTopic.storeVisit,
        segments: [{ id: 'seg-1', lines: '今天带大家来看看' }],
      },
      '第 1 段还没选场景图',
    ],
    ['没选音色', { ...readyTopic.storeVisit, voiceId: undefined }, '音色'],
  ])('%s时在配音、提交和扣费之前拒绝', async (_label, storeVisit, message) => {
    const service = buildVoiceoverService({ storeVisit });
    await expect(service.start(2, scope)).rejects.toThrow(message);
    expect(service.billing.chargeService).not.toHaveBeenCalled();
    expect(service.cosyVoice.synthesize).not.toHaveBeenCalled();
    expect(service.fetchShuyan).not.toHaveBeenCalled();
  });

  it('逐段配音后以场景图为首帧提交与配音等长的静音空镜', async () => {
    const service = buildVoiceoverService(readyTopic);
    const result = await service.start(2, scope);
    expect(result.operations).toHaveLength(1);
    expect(service.repository.updateStoreVisitSegment).toHaveBeenCalledWith(
      2,
      'seg-1',
      null,
      scope,
    );
    expect(service.repository.update).toHaveBeenCalledWith(
      2,
      { autoConcatShots: true },
      scope,
    );
    expect(service.cosyVoice.synthesize.mock.calls[0][1]).toEqual({
      model: 'cosyvoice-v3.5-plus',
      voice: 'cosyvoice-v3.5-plus-aim2-x',
      text: '今天带大家来看看这家街角咖啡店',
    });
    const [url, init] = service.fetchShuyan.mock.calls[0];
    expect(url).toContain('/seedance/api/v3/contents/generations/tasks');
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      duration: 10,
      generate_audio: false,
      ratio: 'adaptive',
    });
    expect(payload.content[1]).toMatchObject({
      role: 'first_frame',
      image_url: { url: 'https://cdn/scene.jpg' },
    });
    expect(payload.content[0].text).toContain('不要出现任何文字');
    const inserted = service.operations.insertOne.mock.calls[0][0];
    expect(inserted).toMatchObject({
      provider: 'shuyan',
      mode: 'store-visit',
      segmentId: 'seg-1',
      status: 'queued',
      externalId: 'task-1',
    });
    expect(inserted.request).toMatchObject({
      audioUrl: 'https://oss.example/a.wav',
      audioSeconds: 9.6,
      voiceId: 'cosyvoice-v3.5-plus-aim2-x',
    });
  });

  it('配音超过画面上限加定格容差时退回扣费并提示拆短', async () => {
    const service = buildVoiceoverService(readyTopic);
    service.cosyVoice.synthesize.mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 21,
      characters: 200,
      url: 'https://dashscope.example/t.wav',
    });
    await expect(service.start(2, scope)).rejects.toThrow('拆短');
    expect(service.billing.refundService).toHaveBeenCalledTimes(1);
    expect(service.fetchShuyan).not.toHaveBeenCalled();
    expect(service.operations.insertOne.mock.calls[0][0].status).toBe('failed');
  });

  it('仅凭新建探店的标题和场景写画外音台词，无需脚本或分镜', async () => {
    const agent = {
      runWithMessages: jest.fn().mockResolvedValue({
        content: '今天带大家来看看这家街角咖啡店，一起体验招牌拿铁。',
      }),
    };
    const topic = {
      id: 2,
      kind: 'child',
      title: '街角咖啡店',
      productionMode: 'store-visit',
      storyboard: [],
      storeVisit: {
        sceneDescription: '木质吧台，招牌拿铁',
        sceneImages: [
          {
            id: 17,
            type: 'image',
            name: 'a.jpg',
            url: 'https://cdn/a.jpg',
            description: '门头招牌',
            tags: ['门头'],
          },
        ],
      },
    };
    const repository = { get: jest.fn().mockResolvedValue(topic) };
    const workflowModels = {
      resolveNodeRuntime: jest.fn().mockResolvedValue(null),
    };
    const service = new DouyinChildTopicGenerationService(
      agent as any,
      {} as any,
      {} as any,
      repository as any,
      workflowModels as any,
      {} as any,
    );
    const result = await service.writeStoreVisitLines(
      2,
      '语气像朋友推荐',
      scope,
    );
    expect(result.lines).toContain('街角咖啡店');
    const request = agent.runWithMessages.mock.calls[0][0];
    expect(request.config.system).toContain('画外音');
    expect(request.messages[0].content).toContain('木质吧台，招牌拿铁');
    expect(request.messages[0].content).toContain('场景1：门头招牌（标签：门头）');
    expect(request.messages[0].content).toContain('语气像朋友推荐');
  });
  it('场景没变时保留人物首帧；改了镜头类型时作废这段成片但首帧还在', () => {
    const keyframe = {
      type: 'image' as const,
      id: 91,
      name: '首帧',
      url: 'https://cdn/k.jpg',
    };
    const current = [
      {
        id: 'a',
        lines: '开场',
        sceneImageId: 17,
        shot: 'presenter' as const,
        keyframe,
        videoId: 5,
        audioUrl: 'https://a.wav',
      },
      { id: 'b', lines: '吧台', sceneImageId: 17, keyframe },
    ];
    const merged = mergeStoreVisitSegments(
      [
        { id: 'a', lines: '开场', sceneImageId: 17 },
        { id: 'b', lines: '吧台', sceneImageId: 18 },
      ],
      current,
    );
    expect(merged[0]).toEqual({
      id: 'a',
      lines: '开场',
      sceneImageId: 17,
      keyframe,
    });
    expect(merged[1]).toEqual({ id: 'b', lines: '吧台', sceneImageId: 18 });
  });

  it('换出镜人物时清掉全部首帧及依赖旧尾帧的后续成片', () => {
    const keyframe = {
      type: 'image' as const,
      id: 91,
      name: '首帧',
      url: 'https://cdn/k.jpg',
    };
    expect(
      clearPresenterKeyframes([
        {
          id: 'a',
          lines: '开场',
          shot: 'presenter',
          keyframe,
          videoId: 5,
          audioUrl: 'https://a.wav',
          audioSeconds: 3,
          voiceId: 'v',
        },
        {
          id: 'b',
          lines: '吧台',
          keyframe,
          videoId: 6,
          audioUrl: 'https://b.wav',
        },
      ]),
    ).toEqual([
      { id: 'a', lines: '开场', shot: 'presenter' },
      { id: 'b', lines: '吧台' },
    ]);
  });

  it('人物出镜段没有出镜人物或首帧时在扣费前拒绝', async () => {
    const presenterTopic = {
      storeVisit: {
        ...readyTopic.storeVisit,
        segments: [
          {
            id: 'seg-1',
            lines: '大家好，带你们逛逛这家店',
            sceneImageId: 17,
            shot: 'presenter',
          },
        ],
      },
    };
    await expect(
      buildVoiceoverService(presenterTopic).start(2, scope),
    ).rejects.toThrow('选好出镜人物');
    const noKeyframe = buildVoiceoverService({
      storeVisit: {
        ...presenterTopic.storeVisit,
        faceImage: {
          type: 'image',
          id: 33,
          name: '人物',
          url: 'https://cdn/face.jpg',
        },
      },
    });
    await expect(noKeyframe.start(2, scope)).rejects.toThrow(
      '第 1 段切入人物场景，还没有场景起始画面',
    );
    expect(noKeyframe.billing.chargeService).not.toHaveBeenCalled();
  });

  it('首尾出镜：先提交开场人物段，后续空镜等待实际尾帧且不提前扣费', async () => {
    const keyframe = {
      type: 'image',
      id: 91,
      name: '首帧',
      url: 'https://cdn/keyframe.jpg',
    };
    const service = buildVoiceoverService({
      storeVisit: {
        ...readyTopic.storeVisit,
        faceImage: {
          type: 'image',
          id: 33,
          name: '人物',
          url: 'https://cdn/face.jpg',
        },
        template: 'bookend',
        segments: [
          {
            id: 'seg-1',
            lines: '大家好，今天带你们来这家咖啡店',
            sceneImageId: 17,
            shot: 'presenter',
            keyframe,
            action: '站在门口挥手',
          },
          { id: 'seg-2', lines: '吧台的拉花很漂亮', sceneImageId: 17 },
        ],
      },
    });
    const result = await service.start(2, scope);
    expect(result.operations).toHaveLength(2);
    const [avatarUrl, avatarInit] = service.fetchShuyan.mock.calls[0];
    expect(avatarUrl).toMatch(/\/kling\/v1\/videos\/avatar\/image2video$/);
    expect(JSON.parse(avatarInit.body)).toMatchObject({
      image: 'https://cdn/keyframe.jpg',
      sound_file: 'https://oss.example/a.wav',
      mode: 'pro',
    });
    expect(JSON.parse(avatarInit.body).prompt).toContain('站在门口挥手');
    expect(service.fetchShuyan).toHaveBeenCalledTimes(1);
    expect(service.billing.chargeService).toHaveBeenCalledTimes(1);
    const [presenter, broll] = service.operations.insertOne.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(presenter).toMatchObject({
      segmentId: 'seg-1',
      model: 'kling-avatar-pro',
      externalId: 'kling-1',
      request: {
        engine: 'kling-avatar',
        shot: 'presenter',
        keyframeImageId: 91,
        mode: 'pro',
      },
    });
    expect(broll).toMatchObject({
      segmentId: 'seg-2',
      status: 'queued',
      continuity: { stage: 'waiting', previousSegmentId: 'seg-1' },
      request: { shot: 'broll' },
    });
    expect(broll.externalId).toBeUndefined();
    expect(broll.request.engine).toBeUndefined();
  });

  it('人物出镜段配音不足 2 秒时退回扣费并提示多写几句', async () => {
    const service = buildVoiceoverService({
      storeVisit: {
        ...readyTopic.storeVisit,
        faceImage: {
          type: 'image',
          id: 33,
          name: '人物',
          url: 'https://cdn/face.jpg',
        },
        segments: [
          {
            id: 'seg-1',
            lines: '嗨',
            sceneImageId: 17,
            shot: 'presenter',
            keyframe: {
              type: 'image',
              id: 91,
              name: '首帧',
              url: 'https://cdn/k.jpg',
            },
          },
        ],
      },
    });
    service.cosyVoice.synthesize.mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 0.8,
      characters: 1,
      url: 'https://dashscope.example/t.wav',
    });
    await expect(service.start(2, scope)).rejects.toThrow('多写几句');
    expect(service.billing.refundService).toHaveBeenCalledTimes(1);
    expect(service.fetchShuyan).not.toHaveBeenCalled();
  });
  it('对口型节点先填视频型号时，人物段以人物首帧为第一帧走数眼图生视频，不对口型', async () => {
    const keyframe = {
      type: 'image',
      id: 91,
      name: '首帧',
      url: 'https://cdn/keyframe.jpg',
    };
    const service = buildVoiceoverService({
      storeVisit: {
        ...readyTopic.storeVisit,
        faceImage: {
          type: 'image',
          id: 33,
          name: '人物',
          url: 'https://cdn/face.jpg',
        },
        segments: [
          {
            id: 'seg-1',
            lines: '大家好，今天带你们来这家咖啡店',
            sceneImageId: 17,
            shot: 'presenter',
            keyframe,
          },
        ],
      },
    });
    const original =
      service.workflowModels.resolveNodeRuntime.getMockImplementation();
    service.workflowModels.resolveNodeRuntime.mockImplementation(
      async (workflow: string, node: string) =>
        node === 'store-visit-avatar'
          ? {
              providerId: 'sy-3',
              providerCode: 'shuyan',
              providerName: '数眼',
              model: 'MiniMax-H3',
              apiKey: 'sk-shuyan',
            }
          : original(workflow, node),
    );
    const result = await service.start(2, scope);
    expect(result.operations).toHaveLength(1);
    const [url, init] = service.fetchShuyan.mock.calls[0];
    expect(url).toContain('/hailuo/v2/video_generation');
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      model: 'MiniMax-H3',
      ratio: 'adaptive',
      duration: 10,
    });
    expect(payload.content[1]).toMatchObject({
      role: 'first_frame',
      image_url: { url: 'https://cdn/keyframe.jpg' },
    });
    expect(payload.content[0].text).toContain('带着镜头介绍门店');
    const inserted = service.operations.insertOne.mock.calls[0][0];
    expect(inserted).toMatchObject({
      model: 'MiniMax-H3',
      externalId: 'task-1',
      request: {
        shot: 'presenter',
        engine: 'shuyan-video',
        keyframeImageId: 91,
      },
    });
    expect(inserted.request.mode).toBeUndefined();
  });

  it('对口型节点是视频型号时，人物段配音超过型号上限同样退费并提示拆短', async () => {
    const service = buildVoiceoverService({
      storeVisit: {
        ...readyTopic.storeVisit,
        faceImage: {
          type: 'image',
          id: 33,
          name: '人物',
          url: 'https://cdn/face.jpg',
        },
        segments: [
          {
            id: 'seg-1',
            lines: '很长的一段讲解',
            sceneImageId: 17,
            shot: 'presenter',
            keyframe: {
              type: 'image',
              id: 91,
              name: '首帧',
              url: 'https://cdn/k.jpg',
            },
          },
        ],
      },
    });
    const original =
      service.workflowModels.resolveNodeRuntime.getMockImplementation();
    service.workflowModels.resolveNodeRuntime.mockImplementation(
      async (workflow: string, node: string) =>
        node === 'store-visit-avatar'
          ? {
              providerId: 'sy-3',
              providerCode: 'shuyan',
              providerName: '数眼',
              model: 'MiniMax-H3',
              apiKey: 'sk-shuyan',
            }
          : original(workflow, node),
    );
    service.cosyVoice.synthesize.mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 25,
      characters: 120,
      url: 'https://dashscope.example/t.wav',
    });
    await expect(service.start(2, scope)).rejects.toThrow(
      '人物出镜视频型号单段画面上限',
    );
    expect(service.billing.refundService).toHaveBeenCalledTimes(1);
    expect(service.fetchShuyan).not.toHaveBeenCalled();
  });
});

/** @description 把 `$set`（含点号路径）写进内存记录，模拟 Mongo 更新。 @keyword-cn 测试内存更新, 点号路径 @keyword-en test-memory-set, dotted-path */
function applySet(
  target: Record<string, unknown>,
  patch: Record<string, unknown> = {},
) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.');
    let cursor = target;
    for (const part of parts.slice(0, -1))
      cursor = (cursor[part] ??= {}) as Record<string, unknown>;
    cursor[parts[parts.length - 1]] = value;
  }
}

/**
 * @description 构造 MiniMax-H3 人物段画面已出片的调用记录、内存更新与数眼 / 可灵替身，用来验证出片后的识别人脸与对口型。
 * @keyword-cn 对口型测试服务, 人物段出片
 * @keyword-en lip-sync-test-service, presenter-video-ready
 * @param {{faces?: Array<Record<string, unknown>>, identifyError?: Error}} options 可灵人脸识别返回的脸或报错。
 */
function buildLipSyncService(
  options: {
    faces?: Array<Record<string, unknown>>;
    identifyError?: Error;
  } = {},
) {
  const service = buildVoiceoverService({
    storeVisit: {
      ...readyTopic.storeVisit,
      faceImage: {
        type: 'image',
        id: 33,
        name: '人物',
        url: 'https://cdn/face.jpg',
      },
      segments: [
        {
          id: 'seg-1',
          lines: '大家好，今天带你们来这家咖啡店',
          sceneImageId: 17,
          shot: 'presenter',
          keyframe: {
            type: 'image',
            id: 91,
            name: '首帧',
            url: 'https://cdn/k.jpg',
          },
        },
      ],
    },
  });
  const row: Record<string, any> = {
    id: 'op-1',
    topicId: 2,
    segmentId: 'seg-1',
    provider: 'shuyan',
    mode: 'store-visit',
    model: 'MiniMax-H3',
    providerId: 'sy-3',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: 'running',
    externalId: 'h3-task',
    createdAt: new Date(),
    updatedAt: new Date(),
    request: {
      segmentIndex: 1,
      shot: 'presenter',
      engine: 'shuyan-video',
      lines: '大家好，今天带你们来这家咖啡店',
      action: '',
      sceneImageId: 17,
      keyframeImageId: 91,
      voiceId: readyTopic.storeVisit.voiceId,
      audioUrl: 'https://oss.example/a.wav',
      audioSeconds: 9.6,
      duration: 10,
    },
  };
  service.adminService.getAiProviderRuntimeById.mockResolvedValue({
    providerId: 'sy-3',
    apiKey: 'sk-shuyan',
    baseUrl: 'https://platform.shuyanai.com/v1',
  });
  service.storage.saveRemote = jest
    .fn()
    .mockResolvedValue({ id: 501, url: 'https://oss.example/v.mp4' });
  /** @description 测试中按状态与对口型字段原子认领记录。 @keyword-cn 测试对口型认领, 防重复提交 @keyword-en test-lip-sync-claim, duplicate-submit-guard */
  service.operations.findOneAndUpdate.mockImplementation(
    function claimLipSyncRow(
      query: Record<string, any>,
      patch: { $set: Record<string, unknown> },
    ) {
      if (query.lipSync && row.lipSync) return Promise.resolve(null);
      if (!['queued', 'running'].includes(row.status))
        return Promise.resolve(null);
      applySet(row, patch.$set);
      return Promise.resolve(row);
    },
  );
  /** @description 将状态修改应用到对口型测试记录。 @keyword-cn 测试状态写入, 对口型记录 @keyword-en test-status-write, lip-sync-record */
  service.operations.updateOne.mockImplementation(function patchLipSyncRow(
    _query: unknown,
    patch: { $set: Record<string, unknown> },
  ) {
    applySet(row, patch.$set);
    return Promise.resolve({ modifiedCount: 1 });
  });
  service.logger = { warn: jest.fn() };
  service.agentService = {
    runWithMessages: jest
      .fn()
      .mockResolvedValue({ content: '{"matches":[1]}' }),
  };
  /** @description 按地址模拟数眼 H3 查询、可灵人脸识别与对口型。 @keyword-cn 测试数眼替身, 可灵对口型替身 @keyword-en test-shuyan-double, kling-lip-sync-double */
  service.fetchShuyan = jest.fn().mockImplementation(function fakeShuyan(
    url: string,
  ) {
    return Promise.resolve().then(() => fakeShuyanResponse(url));
  });
  /** @description 按地址给出数眼 H3 查询、可灵人脸识别与对口型的响应。 @keyword-cn 测试数眼响应, 可灵对口型响应 @keyword-en test-shuyan-response, kling-lip-sync-response */
  function fakeShuyanResponse(url: string): Record<string, unknown> {
    if (url.includes('/hailuo/v2/query/'))
      return {
        task: {
          status: 'succeeded',
          content: { url: 'https://shuyan.example/h3.mp4' },
          duration: 10,
        },
      };
    if (url.endsWith('/kling/v1/videos/identify-face')) {
      if (options.identifyError) throw options.identifyError;
      return {
        code: 0,
        data: {
          session_id: 'session-1',
          face_data: options.faces ?? [
            {
              face_id: 'f1',
              face_image: 'https://kling.example/f1.jpg',
              start_time: 0,
              end_time: 10000,
            },
          ],
        },
      };
    }
    if (url.endsWith('/kling/v1/videos/advanced-lip-sync'))
      return { code: 0, data: { task_id: 'lip-1' } };
    if (url.endsWith('/kling/v1/videos/advanced-lip-sync/lip-1'))
      return {
        code: 0,
        data: {
          task_status: 'succeed',
          task_result: {
            videos: [
              { url: 'https://kling.example/synced.mp4', duration: '10.0' },
            ],
          },
        },
      };
    throw new Error(`unexpected ${url}`);
  }
  return { service, row };
}

describe('人物段视频型号出片后对口型', () => {
  it('只有一张脸出现超过半段时直接用它；多张时交给视觉比对，备选出现最久的', () => {
    const solo = planStoreVisitFaceMatch(
      [
        { faceId: 'a', imageUrl: 'u', startMs: 0, endMs: 9000 },
        { faceId: 'b', imageUrl: 'u', startMs: 1000, endMs: 2500 },
      ],
      10000,
    );
    expect(solo.direct?.faceId).toBe('a');
    const crowd = planStoreVisitFaceMatch(
      [
        { faceId: 'a', imageUrl: 'u', startMs: 0, endMs: 6000 },
        { faceId: 'b', imageUrl: 'u', startMs: 0, endMs: 8000 },
        { faceId: 'c', imageUrl: 'u', startMs: 0, endMs: 1000 },
      ],
      10000,
    );
    expect(crowd.direct).toBeNull();
    expect(crowd.candidates.map((face) => face.faceId)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(crowd.fallback?.faceId).toBe('b');
    expect(
      planStoreVisitFaceMatch(
        [{ faceId: 'x', imageUrl: 'u', startMs: 0, endMs: 3000 }],
        10000,
      ),
    ).toMatchObject({ direct: null, fallback: null });
  });

  it('同一人被拆成多段时按出现时间各自对上配音，不足 2 秒和超出配音的部分不提交', () => {
    const clips = buildStoreVisitLipSyncFaces(
      [
        { faceId: 'late', imageUrl: '', startMs: 5200, endMs: 10000 },
        { faceId: 'early', imageUrl: '', startMs: 0, endMs: 4800 },
        { faceId: 'blink', imageUrl: '', startMs: 4800, endMs: 5200 },
      ],
      { audioMs: 9600, videoMs: 10000, soundFile: 'https://oss.example/a.wav' },
    );
    expect(clips).toEqual([
      {
        face_id: 'early',
        sound_file: 'https://oss.example/a.wav',
        sound_start_time: 0,
        sound_end_time: 4800,
        sound_insert_time: 0,
      },
      {
        face_id: 'late',
        sound_file: 'https://oss.example/a.wav',
        sound_start_time: 5200,
        sound_end_time: 9600,
        sound_insert_time: 5200,
      },
    ]);
  });

  it('解析识别与比对结果：Base64 截图补前缀，比对编号越界或重复会被丢掉', () => {
    const { faces } = readStoreVisitFaces(
      {
        session_id: 's',
        face_data: [{ face_id: 1, face_image: 'AAAA', start_time: 0 }],
      },
      8000,
    );
    expect(faces[0]).toEqual({
      faceId: '1',
      imageUrl: 'data:image/jpeg;base64,AAAA',
      startMs: 0,
      endMs: 8000,
    });
    expect(
      parseStoreVisitFaceMatches('```json\n{"matches":[2,2,9,0]}\n```', 3),
    ).toEqual([2]);
    expect(describeStoreVisitLipSyncSkip('SHUYAN_VIDEO_HTTP_404:{}')).toBe(
      '没对上口型：数眼没有开放可灵人脸识别或对口型接口，已保留原画面',
    );
  });

  it('H3 画面出片后先识别人脸并提交可灵对口型，对口型完成后才把对口型版本入库', async () => {
    const { service, row } = buildLipSyncService();
    await service.refreshRow({ ...row });
    expect(service.storage.saveRemote).not.toHaveBeenCalled();
    const identify = service.fetchShuyan.mock.calls.find(([url]: [string]) =>
      url.endsWith('/identify-face'),
    );
    expect(JSON.parse(identify[1].body)).toEqual({
      video_url: 'https://shuyan.example/h3.mp4',
    });
    const submit = service.fetchShuyan.mock.calls.find(([url]: [string]) =>
      url.endsWith('/advanced-lip-sync'),
    );
    expect(JSON.parse(submit[1].body)).toEqual({
      session_id: 'session-1',
      face_choose: [
        {
          face_id: 'f1',
          sound_file: 'https://oss.example/a.wav',
          sound_start_time: 0,
          sound_end_time: 9600,
          sound_insert_time: 0,
        },
      ],
    });
    expect(service.agentService.runWithMessages).not.toHaveBeenCalled();
    expect(row.lipSync).toMatchObject({
      stage: 'syncing',
      taskId: 'lip-1',
      sourceVideoUrl: 'https://shuyan.example/h3.mp4',
    });
    expect(service.toView(row).lipSync).toEqual({ stage: 'syncing' });

    await service.refreshRow({ ...row });
    expect(service.storage.saveRemote).toHaveBeenCalledWith(
      'https://kling.example/synced.mp4',
      expect.objectContaining({ durationSeconds: 10 }),
    );
    expect(service.repository.updateStoreVisitSegment).toHaveBeenCalledWith(
      2,
      'seg-1',
      expect.objectContaining({ videoId: 501 }),
      expect.anything(),
    );
    expect(row).toMatchObject({
      status: 'completed',
      lipSync: { stage: 'done' },
    });
  });

  it('画面里有多张脸时让视觉模型拿出镜人物照比对，同一人的多段都对上口型', async () => {
    const { service, row } = buildLipSyncService({
      faces: [
        {
          face_id: 'host-a',
          face_image: 'https://kling.example/a.jpg',
          start_time: 0,
          end_time: 4500,
        },
        {
          face_id: 'guest',
          face_image: 'https://kling.example/g.jpg',
          start_time: 0,
          end_time: 4000,
        },
        {
          face_id: 'host-b',
          face_image: 'https://kling.example/b.jpg',
          start_time: 5000,
          end_time: 9800,
        },
      ],
    });
    // 候选按出现时长排序：host-b(4.8s) 为 1、host-a(4.5s) 为 2、guest(4s) 为 3
    service.agentService.runWithMessages.mockResolvedValue({
      content: '{"matches":[1,2]}',
    });
    await service.refreshRow({ ...row });
    const images =
      service.agentService.runWithMessages.mock.calls[0][0].messages[0].content
        .filter((item: { type: string }) => item.type === 'image_url')
        .map((item: { image_url: { url: string } }) => item.image_url.url);
    expect(images).toEqual([
      'https://cdn/face.jpg',
      'https://kling.example/b.jpg',
      'https://kling.example/a.jpg',
      'https://kling.example/g.jpg',
    ]);
    const submit = service.fetchShuyan.mock.calls.find(([url]: [string]) =>
      url.endsWith('/advanced-lip-sync'),
    );
    expect(
      JSON.parse(submit[1].body).face_choose.map(
        (item: {
          face_id: string;
          sound_start_time: number;
          sound_end_time: number;
        }) => [item.face_id, item.sound_start_time, item.sound_end_time],
      ),
    ).toEqual([
      ['host-a', 0, 4500],
      ['host-b', 5000, 9600],
    ]);
    expect(row.lipSync.faceIds).toEqual(['host-b', 'host-a']);
  });

  it('数眼没开放人脸识别时不让整段失败，保留原画面入库并写明原因', async () => {
    const { service, row } = buildLipSyncService({
      identifyError: new Error('SHUYAN_VIDEO_HTTP_404:{"error":"not found"}'),
    });
    await service.refreshRow({ ...row });
    expect(service.storage.saveRemote).toHaveBeenCalledWith(
      'https://shuyan.example/h3.mp4',
      expect.anything(),
    );
    expect(row.status).toBe('completed');
    expect(row.lipSync).toMatchObject({
      stage: 'skipped',
      reason: '没对上口型：数眼没有开放可灵人脸识别或对口型接口，已保留原画面',
    });
    expect(service.toView(row).lipSync).toEqual({
      stage: 'skipped',
      reason: row.lipSync.reason,
    });
  });

  it('要对口型的人物段不给定格容差，配音超过型号最长秒数就退费拆短', async () => {
    const service = buildVoiceoverService({
      storeVisit: {
        ...readyTopic.storeVisit,
        faceImage: {
          type: 'image',
          id: 33,
          name: '人物',
          url: 'https://cdn/face.jpg',
        },
        segments: [
          {
            id: 'seg-1',
            lines: '讲解',
            sceneImageId: 17,
            shot: 'presenter',
            keyframe: {
              type: 'image',
              id: 91,
              name: '首帧',
              url: 'https://cdn/k.jpg',
            },
          },
        ],
      },
    });
    const original =
      service.workflowModels.resolveNodeRuntime.getMockImplementation();
    service.workflowModels.resolveNodeRuntime.mockImplementation(
      (workflow: string, node: string) =>
        node === 'store-visit-avatar'
          ? Promise.resolve({
              providerId: 'sy-3',
              providerCode: 'shuyan',
              providerName: '数眼',
              model: 'MiniMax-H3',
              apiKey: 'sk-shuyan',
            })
          : (original(workflow, node) as Promise<unknown>),
    );
    service.cosyVoice.synthesize.mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 15.5,
      characters: 70,
      url: 'https://dashscope.example/t.wav',
    });
    await expect(
      service.start(2, { tenantId: 'tenant-1', userId: 'user-1' }),
    ).rejects.toThrow('要对口型，不能定格补齐');
    expect(service.billing.refundService).toHaveBeenCalledTimes(1);
  });
});

/**
 * @description 构造「探店人物对口型」节点填 wan2.7-i2v 的探店测试服务：数眼万相接口按百炼协议返回任务 ID 与成片。
 * @keyword-cn 万相测试服务, 配音驱动人物段
 * @keyword-en wan-test-service, audio-driven-presenter
 */
function buildWanService() {
  const service = buildVoiceoverService({
    storeVisit: {
      ...readyTopic.storeVisit,
      faceImage: {
        type: 'image',
        id: 33,
        name: '人物',
        url: 'https://cdn/face.jpg',
      },
      segments: [
        {
          id: 'seg-1',
          lines: '大家好，今天带你们来这家咖啡店',
          sceneImageId: 17,
          shot: 'presenter',
          keyframe: {
            type: 'image',
            id: 91,
            name: '首帧',
            url: 'https://cdn/keyframe.jpg',
          },
        },
      ],
    },
  });
  const original =
    service.workflowModels.resolveNodeRuntime.getMockImplementation();
  service.workflowModels.resolveNodeRuntime.mockImplementation(
    (workflow: string, node: string) =>
      node === 'store-visit-avatar'
        ? Promise.resolve({
            providerId: 'sy-4',
            providerCode: 'shuyan',
            providerName: '数眼',
            model: 'wan2.7-i2v',
            apiKey: 'sk-shuyan',
          })
        : (original(workflow, node) as Promise<unknown>),
  );
  /** @description 按地址模拟数眼万相的创建与查询响应。 @keyword-cn 测试万相替身, 百炼协议响应 @keyword-en test-wan-double, dashscope-protocol-response */
  service.fetchShuyan = jest.fn().mockImplementation(function fakeWan(
    url: string,
  ) {
    if (
      url.endsWith('/ali/api/v1/services/aigc/video-generation/video-synthesis')
    )
      return Promise.resolve({
        request_id: 'r',
        output: { task_id: 'wan-1', task_status: 'PENDING' },
      });
    if (url.endsWith('/ali/api/v1/tasks/wan-1'))
      return Promise.resolve({
        output: {
          task_id: 'wan-1',
          task_status: 'SUCCEEDED',
          video_url: 'https://dashscope.example/wan.mp4',
        },
        usage: { duration: 10 },
      });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  return { service };
}

describe('人物段用 wan2.7-i2v 按配音生成', () => {
  const scope = { tenantId: 'tenant-1', userId: 'user-1' };

  it('首帧加这段配音走数眼百炼协议一次生成，带异步请求头且不进后期对口型', async () => {
    const { service } = buildWanService();
    await service.start(2, scope);
    const [url, init] = service.fetchShuyan.mock.calls[0];
    expect(url).toBe(
      'https://platform.shuyanai.com/ali/api/v1/services/aigc/video-generation/video-synthesis',
    );
    expect(init.headers).toEqual({ 'X-DashScope-Async': 'enable' });
    const payload = JSON.parse(init.body);
    expect(payload.model).toBe('wan2.7-i2v');
    expect(payload.input.media).toEqual([
      { type: 'first_frame', url: 'https://cdn/keyframe.jpg' },
      { type: 'driving_audio', url: 'https://oss.example/a.wav' },
    ]);
    expect(payload.parameters).toMatchObject({
      duration: 10,
      resolution: '720P',
      prompt_extend: false,
      watermark: false,
    });
    expect(payload.input.prompt).toContain('人物按传入的配音说话');
    const inserted = service.operations.insertOne.mock.calls[0][0];
    expect(inserted).toMatchObject({
      externalId: 'wan-1',
      request: { shot: 'presenter', engine: 'shuyan-video', audioDriven: true },
    });
  });

  it('万相出片后直接入库，不识别人脸也不提交可灵对口型', async () => {
    const { service } = buildWanService();
    service.adminService.getAiProviderRuntimeById.mockResolvedValue({
      providerId: 'sy-4',
      apiKey: 'sk-shuyan',
      baseUrl: 'https://platform.shuyanai.com/v1',
    });
    service.storage.saveRemote = jest
      .fn()
      .mockResolvedValue({ id: 601, url: 'https://oss.example/wan.mp4' });
    service.operations.findOneAndUpdate.mockResolvedValue({ id: 'op-w' });
    const row = {
      id: 'op-w',
      topicId: 2,
      segmentId: 'seg-1',
      provider: 'shuyan',
      mode: 'store-visit',
      model: 'wan2.7-i2v',
      providerId: 'sy-4',
      tenantId: 'tenant-1',
      userId: 'user-1',
      status: 'running',
      externalId: 'wan-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      request: {
        segmentIndex: 1,
        shot: 'presenter',
        engine: 'shuyan-video',
        audioDriven: true,
        lines: '大家好，今天带你们来这家咖啡店',
        action: '',
        sceneImageId: 17,
        keyframeImageId: 91,
        voiceId: readyTopic.storeVisit.voiceId,
        audioUrl: 'https://oss.example/a.wav',
        audioSeconds: 9.6,
        duration: 10,
      },
    };
    await service.refreshRow(row);
    expect(
      service.fetchShuyan.mock.calls.map(([url]: [string]) => url),
    ).toEqual(['https://platform.shuyanai.com/ali/api/v1/tasks/wan-1']);
    expect(service.storage.saveRemote).toHaveBeenCalledWith(
      'https://dashscope.example/wan.mp4',
      expect.objectContaining({ durationSeconds: 10 }),
    );
    const completed = service.operations.updateOne.mock.calls.at(-1)[1].$set;
    expect(completed.status).toBe('completed');
    expect(completed['lipSync.stage']).toBeUndefined();
  });

  it('没配 OSS 时在建队列和扣费之前拒绝，配音太短时退费提示多写几句', async () => {
    const { service: offline } = buildWanService();
    offline.storage.hasPublicStorage.mockReturnValue(false);
    await expect(offline.start(2, scope)).rejects.toThrow('配置 OSS');
    expect(offline.billing.chargeService).not.toHaveBeenCalled();

    const { service: short } = buildWanService();
    short.cosyVoice.synthesize.mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 1.4,
      characters: 4,
      url: 'https://dashscope.example/t.wav',
    });
    await expect(short.start(2, scope)).rejects.toThrow('至少要 2 秒');
    expect(short.billing.refundService).toHaveBeenCalledTimes(1);
    expect(short.fetchShuyan).not.toHaveBeenCalled();
  });

  it('图库里的站内首帧先传 OSS 换公网地址再交给万相；上传不了时退费并说明原因', async () => {
    const { service } = buildWanService();
    const topic = await service.repository.get();
    topic.storeVisit.segments[0].keyframe.url = '/static/uploads/keyframe.png';
    service.repository.get.mockResolvedValue(topic);
    await service.start(2, scope);
    expect(service.storage.publishImage).toHaveBeenCalledWith(
      '/static/uploads/keyframe.png',
      scope,
    );
    const payload = JSON.parse(service.fetchShuyan.mock.calls[0][1].body);
    expect(payload.input.media[0]).toEqual({
      type: 'first_frame',
      url: 'https://oss.example/first-frame.png',
    });

    const { service: failing } = buildWanService();
    const local = await failing.repository.get();
    local.storeVisit.segments[0].keyframe.url = '/static/uploads/keyframe.png';
    failing.repository.get.mockResolvedValue(local);
    failing.storage.publishImage.mockRejectedValue(
      new Error('DOUYIN_PUBLIC_STORAGE_MISSING'),
    );
    await expect(failing.start(2, scope)).rejects.toThrow('配好后会自动上传首帧');
    expect(failing.billing.refundService).toHaveBeenCalledTimes(1);
    expect(failing.fetchShuyan).not.toHaveBeenCalled();
  });
});
