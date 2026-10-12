import { BadRequestException } from '@nestjs/common';
import type { Db } from 'mongodb';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DouyinWorkbenchRepositoryService,
  mergeStoreVisitSegments,
} from './douyin-workbench-repository.service.js';
import { DouyinStoreVisitService } from './douyin-store-visit.service.js';
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
  };
  service.fetchShuyan = jest.fn().mockResolvedValue({ id: 'task-1' });
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
    sceneImages: [{ id: 17, type: 'image', url: 'https://cdn/scene.jpg' }],
    sceneDescription: '木质吧台，招牌拿铁',
    voiceSource: 'clone',
    voiceId: 'cosyvoice-v3.5-plus-aim2-x',
    voiceModel: 'cosyvoice-v3.5-plus',
    voiceProviderId: 'ds-1',
    segments: [
      { id: 'seg-1', lines: '今天带大家来看看这家街角咖啡店', sceneImageId: 17 },
    ],
  },
};

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
            { id: 17, type: 'image', url: 'https://cdn/scene.jpg' },
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
    expect(update.$set['storeVisit.sceneImages'][0].id).toBe(17);
    expect(update.$set['storeVisit.voiceId']).toBeUndefined();
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

  it('PATCH 不收音色字段，选用接口只收字母数字的音色 ID', async () => {
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitDto, {
          voiceId: 'forged-voice',
          voiceMode: 'prompt',
          faceImage: null,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toHaveLength(3);
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitVoiceDto, { voiceId: 'longxiaochun_v3' }),
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
    ).toMatchObject({ videoId: 31, audioUrl: 'https://oss/a.wav', voiceId: 'v1' });
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
    expect(written.$set['storeVisit.segments.$[segment].audioSeconds']).toBe(8.2);
    expect(options.arrayFilters).toEqual([{ 'segment.id': 'seg-1' }]);
    await repository.updateStoreVisitSegment(2, 'seg-1', null, scope);
    const cleared = topics.findOneAndUpdate.mock.calls[1][1];
    for (const field of ['videoId', 'audioUrl', 'audioSeconds', 'voiceId'])
      expect(cleared.$unset[`storeVisit.segments.$[segment].${field}`]).toBe('');
  });

  it('没配 OSS 时在上传录音和调用百炼之前拒绝克隆', async () => {
    const service = buildVoiceoverService();
    service.storage.hasPublicStorage.mockReturnValue(false);
    await expect(service.cloneVoice(2, voiceFile, scope)).rejects.toThrow('OSS');
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
    [
      '没选音色',
      { ...readyTopic.storeVisit, voiceId: undefined },
      '音色',
    ],
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
      ratio: '9:16',
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
      storeVisit: { sceneDescription: '木质吧台，招牌拿铁' },
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
    expect(request.messages[0].content).toContain('语气像朋友推荐');
  });
});
