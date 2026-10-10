import { BadRequestException } from '@nestjs/common';
import type { Db } from 'mongodb';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';
import { DouyinStoreVisitService } from './douyin-store-visit.service.js';
import { DouyinChildTopicGenerationService } from './douyin-child-topic-generation.service.js';
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DouyinStoreVisitDto } from '../controller/douyin-workbench.dto.js';

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
 * @description 构造声音设计测试服务，保留真实选题作用域校验与提交逻辑，替换供应商网络与数据库。
 * @keyword-cn 声音设计测试服务, 音色来源测试
 * @keyword-en voice-design-test-service, voice-source-test
 */
function buildStoreVisitVoiceService() {
  const service = Object.create(DouyinStoreVisitService.prototype);
  service.repository = {
    get: jest
      .fn()
      .mockResolvedValue({ id: 2, kind: 'child', title: '街角咖啡店' }),
    saveStoreVisitVoice: jest
      .fn()
      .mockImplementation(async (_id, voice) => ({ id: 2, storeVisit: voice })),
    update: jest.fn().mockResolvedValue({}),
  };
  service.readNodeRuntime = jest.fn().mockResolvedValue({
    providerId: 'provider-1',
    model: 'design-v1',
    baseUrl: 'https://adapter.example/api',
    apiKey: 'test-key',
  });
  service.fetchJson = jest.fn().mockResolvedValue({
    data: {
      voice_id: 'designed-1',
      preview_url: 'https://cdn.example/preview.mp3',
    },
  });
  service.operations = {
    insertOne: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
  };
  return service;
}

describe('独立探店制作流程', () => {
  const scope = { tenantId: 'tenant-1', userId: 'user-1' };
  it('保存提示词与移除固定音色原子清理音色引用，保留描述、人物、场景和成片', async () => {
    const { repository, topics } = buildStoreVisitRepository();
    topics.findOne.mockResolvedValue({
      id: 2,
      kind: 'child',
      storeVisit: {
        voiceSource: 'design',
        voiceId: 'old-voice',
        voiceDescription: '温暖女声',
      },
    } as any);
    await repository.update(2, { storeVisit: { voiceMode: 'prompt' } }, scope);
    const [filter, update] = topics.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      id: 2,
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    expect(update.$set).toMatchObject({
      'storeVisit.voiceMode': 'prompt',
      'storeVisit.voiceSource': 'design',
    });
    for (const key of [
      'voiceId',
      'voiceName',
      'voiceProviderId',
      'voiceModel',
      'voiceSample',
      'voicePreviewText',
      'voicePreviewUrl',
      'voiceCreatedAt',
      'voiceClonedAt',
    ])
      expect(update.$unset[`storeVisit.${key}`]).toBe('');
    for (const key of [
      'voiceDescription',
      'faceImage',
      'sceneImages',
      'lines',
    ]) {
      expect(update.$unset[`storeVisit.${key}`]).toBeUndefined();
      expect(update.$set[`storeVisit.${key}`]).toBeUndefined();
    }
    expect(update.$unset.generatedVideoId).toBeUndefined();
    expect(update.$set.generatedVideoId).toBeUndefined();
  });
  it('只保存声音提示词可保留固定音色，显式切换提示词才移除音色', async () => {
    const { repository, topics } = buildStoreVisitRepository();
    await repository.update(
      2,
      { storeVisit: { voiceDescription: ' 自然女声 ' } },
      scope,
    );
    const update = topics.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set['storeVisit.voiceDescription']).toBe('自然女声');
    expect(update.$unset).toBeUndefined();
    expect(update.$set['storeVisit.voiceId']).toBeUndefined();
  });
  it('提示词更新不能给母题附加音色，也不能越过选题作用域', async () => {
    const { repository, topics } = buildStoreVisitRepository();
    topics.findOne
      .mockResolvedValueOnce({ id: 1, kind: 'mother' } as any)
      .mockResolvedValueOnce(null as any);
    await expect(
      repository.update(
        1,
        { storeVisit: { voiceMode: 'prompt', voiceDescription: '女声' } },
        scope,
      ),
    ).rejects.toThrow('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    expect(
      await repository.update(
        2,
        { storeVisit: { voiceMode: 'prompt' } },
        scope,
      ),
    ).toBeNull();
    expect(topics.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('声音提示词允许短描述，PATCH 不接受伪造音色 ID 或启用 generated 模式', async () => {
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitDto, {
          voiceMode: 'prompt',
          voiceDescription: '女声',
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitDto, {
          voiceMode: 'generated',
          voiceId: 'forged-voice',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toHaveLength(2);
  });
  it.each([false, true])(
    '提示词声音直接提交视频，忽略旧音色引用 %s，不调用音色创建节点',
    async (staleVoice) => {
      const service = buildStoreVisitVoiceService();
      service.repository.get.mockResolvedValue({
        id: 2,
        kind: 'child',
        title: '街角咖啡店',
        productionMode: 'store-visit',
        storeVisit: {
          voiceSource: 'design',
          voiceDescription: '温暖女声',
          ...(staleVoice
            ? {
                voiceMode: 'prompt',
                voiceId: 'stale-voice',
                voiceModel: 'stale-model',
                voiceProviderId: 'stale-provider',
              }
            : {}),
          faceImage: {
            id: 11,
            type: 'image',
            url: 'https://cdn.example/face.jpg',
          },
          sceneImages: [
            { id: 17, type: 'image', url: 'https://cdn.example/scene.jpg' },
          ],
        },
      });
      service.billing = {
        chargeService: jest.fn().mockResolvedValue({}),
        runWithServiceBilling: jest
          .fn()
          .mockImplementation(async (callback) => callback()),
        refundService: jest.fn().mockResolvedValue(true),
      };
      service.fetchJson.mockResolvedValue({
        status: 'failed',
        message: '仅验证提交，不生成真实视频',
      });
      await service.start(
        2,
        { lines: '今天带大家来看看这家街角咖啡店', prompt: '自然的口播动作' },
        scope,
      );
      const request = JSON.parse(service.fetchJson.mock.calls[0][1].body);
      expect(request).toMatchObject({
        voiceSource: 'design',
        voiceMode: 'prompt',
        voiceDescription: '温暖女声',
      });
      expect(request.prompt).toContain('温暖女声');
      expect(request.prompt).toContain('自然的口播动作');
      expect(request).not.toHaveProperty('voiceId');
      expect(request).not.toHaveProperty('voiceModel');
      expect(request).not.toHaveProperty('voiceProviderId');
      expect(service.readNodeRuntime.mock.calls).toEqual([
        [WORKFLOW_NODES.douyinWorkbench.storeVisitVideo, '探店数字人视频'],
      ]);
      expect(service.billing.chargeService).toHaveBeenCalledTimes(1);
      expect(service.billing.chargeService.mock.calls[0][0].serviceCode).toBe(
        'video-generation',
      );
      expect(service.repository.saveStoreVisitVoice).not.toHaveBeenCalled();
    },
  );
  it('纯提示词为空时在调用供应商和扣费前拒绝，即使旧音色 ID 尚未清理', async () => {
    const service = buildStoreVisitVoiceService();
    service.repository.get.mockResolvedValue({
      id: 2,
      kind: 'child',
      storeVisit: {
        voiceSource: 'design',
        voiceMode: 'prompt',
        voiceDescription: '   ',
        voiceId: 'stale-voice',
        faceImage: { id: 11 },
      },
    });
    service.billing = { chargeService: jest.fn() };
    await expect(
      service.start(2, { lines: '今天带大家来看看这家咖啡店' }, scope),
    ).rejects.toThrow('声音提示词');
    expect(service.readNodeRuntime).not.toHaveBeenCalled();
    expect(service.billing.chargeService).not.toHaveBeenCalled();
  });
  it('声音设计独立调用设计节点，返回音色与试听并按当前租户保存', async () => {
    const service = buildStoreVisitVoiceService();
    const result = await service.designVoice(
      2,
      {
        description: ' 年轻温暖的女声，语速自然，像朋友聊天。 ',
        name: ' 咖啡女声 ',
      },
      scope,
    );
    expect(service.repository.get).toHaveBeenCalledWith(2, scope);
    expect(service.readNodeRuntime).toHaveBeenCalledWith(
      WORKFLOW_NODES.douyinWorkbench.voiceDesign,
      '声音设计',
    );
    const [url, request, key] = service.fetchJson.mock.calls[0];
    expect(url).toBe('https://adapter.example/api/voice-design');
    expect(key).toBe('test-key');
    expect(JSON.parse(request.body)).toMatchObject({
      name: '咖啡女声',
      description: '年轻温暖的女声，语速自然，像朋友聊天。',
      model: 'design-v1',
      language: 'zh-CN',
      previewText: expect.any(String),
    });
    expect(result.storeVisit).toMatchObject({
      voiceSource: 'design',
      voiceId: 'designed-1',
      voiceName: '咖啡女声',
      voiceProviderId: 'provider-1',
      voicePreviewUrl: 'https://cdn.example/preview.mp3',
    });
    expect(service.repository.saveStoreVisitVoice.mock.calls[0][2]).toEqual(
      scope,
    );
    expect(service.operations.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'voice-design',
        status: 'completed',
        tenantId: scope.tenantId,
      }),
    );
  });
  it.each(['network', 'missing-id'])(
    '设计失败 %s 保留原音色，不把请求 ID 当成音色 ID',
    async (failure) => {
      const service = buildStoreVisitVoiceService();
      if (failure === 'network')
        service.fetchJson.mockRejectedValue(new Error('供应商暂时不可用'));
      else service.fetchJson.mockResolvedValue({ id: 'request-id-only' });
      await expect(
        service.designVoice(
          2,
          { description: '年轻温暖的女声，语速自然，像朋友聊天。' },
          scope,
        ),
      ).rejects.toThrow();
      expect(service.repository.saveStoreVisitVoice).not.toHaveBeenCalled();
      expect(service.operations.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'voice-design',
          status: 'failed',
        }),
      );
    },
  );
  it('描述或试听为空白时在调用供应商前拒绝', async () => {
    const service = buildStoreVisitVoiceService();
    await expect(
      service.designVoice(2, { description: ' '.repeat(10) }, scope),
    ).rejects.toThrow('声音描述');
    await expect(
      service.designVoice(
        2,
        {
          description: '年轻温暖的女声，语速自然，像朋友聊天。',
          previewText: ' ',
        },
        scope,
      ),
    ).rejects.toThrow('试听文本');
    expect(service.readNodeRuntime).not.toHaveBeenCalled();
    expect(service.fetchJson).not.toHaveBeenCalled();
  });
  it('当前作用域没有选题时不能设计音色', async () => {
    const service = buildStoreVisitVoiceService();
    service.repository.get.mockResolvedValue(null);
    await expect(
      service.designVoice(
        2,
        { description: '年轻温暖的女声，语速自然，像朋友聊天。' },
        scope,
      ),
    ).rejects.toThrow('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    expect(service.readNodeRuntime).not.toHaveBeenCalled();
  });
  it.each(['clone', 'design'] as const)(
    '保存 %s 清除另一来源的字段，人物场景台词保持不变',
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
            : {
                voiceDescription: '温暖自然的女声',
                voicePreviewText: '欢迎来到街角咖啡店',
              }),
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
      expect(
        update.$unset[
          source === 'clone'
            ? 'storeVisit.voiceDescription'
            : 'storeVisit.voiceSample'
        ],
      ).toBe('');
      expect(update.$unset['storeVisit.voicePreviewUrl']).toBe('');
      expect(update.$set['storeVisit.faceImage']).toBeUndefined();
      expect(update.$set['storeVisit.sceneImages']).toBeUndefined();
      expect(update.$set['storeVisit.lines']).toBeUndefined();
    },
  );
  it('文字设计音色可直接提交数字人视频且携带实际音色来源和模型', async () => {
    const service = buildStoreVisitVoiceService();
    const created = await service.designVoice(
      2,
      { description: '年轻温暖的女声，语速自然，像朋友聊天。' },
      scope,
    );
    service.repository.get.mockResolvedValue({
      ...created,
      kind: 'child',
      title: '街角咖啡店',
      productionMode: 'store-visit',
      storeVisit: {
        ...created.storeVisit,
        faceImage: {
          id: 11,
          type: 'image',
          url: 'https://cdn.example/face.jpg',
        },
        sceneImages: [
          { id: 17, type: 'image', url: 'https://cdn.example/scene.jpg' },
        ],
      },
    });
    service.billing = {
      chargeService: jest.fn().mockResolvedValue({}),
      runWithServiceBilling: jest
        .fn()
        .mockImplementation(async (callback) => callback()),
    };
    service.fetchJson.mockResolvedValue({
      status: 'failed',
      message: '测试任务无需生成',
    });
    service.billing.refundService = jest.fn().mockResolvedValue(true);
    await service.start(2, { lines: '今天带大家来看看这家街角咖啡店' }, scope);
    expect(JSON.parse(service.fetchJson.mock.calls[1][1].body)).toMatchObject({
      voiceId: 'designed-1',
      voiceSource: 'design',
      voiceMode: 'generated',
      voiceProviderId: 'provider-1',
      voiceModel: 'design-v1',
      faceImageUrl: 'https://cdn.example/face.jpg',
      sceneImageUrls: ['https://cdn.example/scene.jpg'],
    });
  });
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
  it('独立场景按租户校验，只更新场景字段而保留人物与音色', async () => {
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
    expect(update.$set['storeVisit.faceImage']).toBeUndefined();
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
  it('数字人使用独立场景图，显式清空后不会重新使用旧分镜', () => {
    const collect = (DouyinStoreVisitService.prototype as any)
      .collectSceneImages;
    const old = { id: 11, type: 'image', url: 'https://cdn/old.jpg' };
    const image = { id: 17, type: 'image', url: 'https://cdn/scene.jpg' };
    expect(
      collect.call(
        {},
        {
          storeVisit: { sceneImages: [image, image] },
          storyboard: [{ media: old }],
        },
      ),
    ).toEqual([image]);
    expect(
      collect.call(
        {},
        { storeVisit: { sceneImages: [] }, storyboard: [{ media: old }] },
      ),
    ).toEqual([]);
    expect(collect.call({}, { storyboard: [{ media: old }] })).toEqual([old]);
  });
  it('独立探店缺少场景时在调用供应商与扣费之前拒绝', async () => {
    const service = Object.create(DouyinStoreVisitService.prototype);
    service.requireChild = jest.fn().mockResolvedValue({
      productionMode: 'store-visit',
      storyboard: [],
      storeVisit: {
        faceImage: { id: 11 },
        voiceId: 'voice-1',
        sceneImages: [],
      },
    });
    service.readNodeRuntime = jest.fn();
    service.billing = { chargeService: jest.fn() };
    await expect(
      service.start(2, { lines: '今天带大家来看看这家咖啡店' }, scope),
    ).rejects.toThrow('场景图');
    expect(service.readNodeRuntime).not.toHaveBeenCalled();
    expect(service.billing.chargeService).not.toHaveBeenCalled();
  });
  it('仅凭新建探店的标题和场景写台词，无需脚本或分镜', async () => {
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
    expect(request.messages[0].content).toContain('木质吧台，招牌拿铁');
    expect(request.messages[0].content).toContain('语气像朋友推荐');
  });
});
