import { ConflictException } from '@nestjs/common';
import {
  DouyinStoreVisitService,
  readStoreVisitVoiceAnchor,
  storeVisitVoiceKey,
} from './douyin-store-visit.service.js';

const scope = { tenantId: 'tenant-1', userId: 'user-1' };

/**
 * @description 生成一段单声道 16kHz 16 位 PCM 的 WAV（全静音），用来验证时长校验。
 * @keyword-cn 测试WAV生成, 静音音频
 * @keyword-en test-wav-factory, silent-audio
 */
function wav(seconds: number): Buffer {
  const data = Math.round(seconds * 16000) * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data, 40);
  return Buffer.concat([header, Buffer.alloc(data)]);
}

/**
 * @description 三个不同点位（不同照片）的新镜头分段。
 * @keyword-cn 测试分段, 三个新镜头
 * @keyword-en test-segments, three-new-shots
 */
function segments(extra: Array<Record<string, unknown>> = []) {
  return [
    { id: 'seg-1', lines: '家人们今天我们来到了欢乐谷', sceneImageId: 17 },
    { id: 'seg-2', lines: '先看旋转木马，小朋友最爱', sceneImageId: 18 },
    { id: 'seg-3', lines: '还有星空打卡墙，拍照超出片', sceneImageId: 19 },
  ].map((segment, index) => ({ ...segment, ...(extra[index] || {}) }));
}

/**
 * @description 构造只替换外部依赖的探店服务：数眼 Seedance 2.0 视频节点、百炼克隆音色、OSS 存储与调用集合都是替身。
 * @keyword-cn 音色锚点测试服务, 外部依赖替身
 * @keyword-en voice-anchor-test-service, dependency-doubles
 */
function buildService(storeVisit: Record<string, unknown>) {
  const service = Object.create(DouyinStoreVisitService.prototype);
  const topic = {
    id: 2,
    kind: 'child',
    title: '欢乐谷',
    productionMode: 'store-visit',
    storeVisit: {
      sceneImages: [17, 18, 19].map((id) => ({
        type: 'image',
        id,
        name: `图${id}`,
        url: `https://cdn.example/${id}.jpg`,
        description: `点位图${id}`,
      })),
      voiceSource: 'clone',
      voiceId: 'cosyvoice-clone-x',
      voiceModel: 'cosyvoice-v3.5-plus',
      voiceProviderId: 'ds-1',
      ...storeVisit,
    },
  };
  service.topic = topic;
  service.previews = new Map();
  service.repository = {
    get: jest.fn().mockImplementation(() => Promise.resolve(service.topic)),
    updateStoreVisitSegment: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    requireVideo: jest
      .fn()
      .mockImplementation((id: number) =>
        Promise.resolve({ url: `https://cdn.example/video-${id}.mp4` }),
      ),
    saveStoreVisitVoiceAnchor: jest
      .fn()
      .mockImplementation((_id: number, anchor: unknown) => {
        service.topic = {
          ...service.topic,
          storeVisit: { ...service.topic.storeVisit, voiceAnchor: anchor },
        };
        return Promise.resolve(service.topic);
      }),
  };
  service.storage = {
    hasPublicStorage: jest.fn().mockReturnValue(true),
    saveAudio: jest
      .fn()
      .mockResolvedValue({ url: 'https://oss.example/anchor.wav' }),
  };
  service.cosyVoice = {
    synthesize: jest.fn().mockResolvedValue({
      buffer: Buffer.from('wav'),
      seconds: 6,
      characters: 30,
    }),
  };
  service.workflowModels = {
    resolveNodeRuntime: jest.fn().mockResolvedValue({
      providerId: 'sy-1',
      providerCode: 'shuyan',
      providerName: '数眼',
      model: 'doubao-seedance-2-0-260128',
      apiKey: 'sk-shuyan',
    }),
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
  service.fetchShuyan = jest.fn().mockResolvedValue({ id: 'task-1' });
  return service;
}

describe('探店音色锚点', () => {
  it('音色标识跟着音色 ID 与声音描述走，换了声音描述锚点就不用', () => {
    const setting = { voiceId: 'v1', voicePrompt: '年轻女声' };
    const anchor = {
      url: 'https://oss.example/anchor.wav',
      seconds: 6,
      segmentId: 'seg-1',
      videoId: 41,
      voiceKey: storeVisitVoiceKey(setting),
      createdAt: new Date(0),
    };
    expect(storeVisitVoiceKey(setting)).toBe('v1|年轻女声');
    expect(readStoreVisitVoiceAnchor({ ...setting, voiceAnchor: anchor })).toBe(
      anchor,
    );
    expect(
      readStoreVisitVoiceAnchor({
        ...setting,
        voicePrompt: '沉稳男声',
        voiceAnchor: anchor,
      }),
    ).toBeUndefined();
  });

  it('统一音色模式先只生成第 1 段，其余新镜头等第 1 段并标记锚点段', async () => {
    const service = buildService({ segments: segments() });
    await service.start(2, scope, { voiceAnchor: true });
    expect(service.fetchShuyan).toHaveBeenCalledTimes(1);
    const waiting = service.operations.insertOne.mock.calls
      .map((call: Array<{ continuity?: Record<string, unknown> }>) => call[0])
      .filter(
        (row: { continuity?: { stage?: string } }) =>
          row.continuity?.stage === 'waiting',
      );
    expect(
      waiting.map(
        (row: { segmentId: string; continuity: Record<string, unknown> }) => [
          row.segmentId,
          row.continuity.previousSegmentId,
          row.continuity.anchorSegmentId,
        ],
      ),
    ).toEqual([
      ['seg-2', 'seg-1', 'seg-1'],
      ['seg-3', 'seg-1', 'seg-1'],
    ]);
  });

  it('不开统一音色时照旧逐段排队，等的是上一段', async () => {
    const service = buildService({ segments: segments() });
    await service.start(2, scope);
    const waiting = service.operations.insertOne.mock.calls
      .map((call: Array<{ continuity?: Record<string, unknown> }>) => call[0])
      .filter(
        (row: { continuity?: { stage?: string } }) =>
          row.continuity?.stage === 'waiting',
      );
    expect(
      waiting.map(
        (row: { segmentId: string; continuity: Record<string, unknown> }) => [
          row.segmentId,
          row.continuity.previousSegmentId,
          row.continuity.anchorSegmentId,
        ],
      ),
    ).toEqual([
      ['seg-2', 'seg-1', undefined],
      ['seg-3', 'seg-2', undefined],
    ]);
  });

  it('已有锚点时各段并行提交，都拿锚点声音作参考音频，不再按台词另合成', async () => {
    const setting = {
      voiceSource: 'clone' as const,
      voiceId: 'cosyvoice-clone-x',
      voiceModel: 'cosyvoice-v3.5-plus',
      voiceProviderId: 'ds-1',
    };
    const service = buildService({
      segments: segments(),
      voiceAnchor: {
        url: 'https://oss.example/anchor.wav',
        seconds: 6,
        segmentId: 'seg-1',
        videoId: 41,
        voiceKey: storeVisitVoiceKey(setting),
        createdAt: new Date(0),
      },
    });
    await service.start(2, scope, { voiceAnchor: true });
    expect(service.fetchShuyan).toHaveBeenCalledTimes(3);
    expect(service.cosyVoice.synthesize).not.toHaveBeenCalled();
    for (const [, init] of service.fetchShuyan.mock.calls) {
      const payload = JSON.parse(init.body);
      expect(payload.content).toContainEqual({
        type: 'audio_url',
        audio_url: { url: 'https://oss.example/anchor.wav' },
        role: 'reference_audio',
      });
    }
  });

  it('等锚点的新镜头不要求紧挨锚点段，先把锚点段视频交给客户端取声音，取到前不认领', async () => {
    const service = buildService({
      segments: segments([{ videoId: 41, nativeAudio: true }]),
    });
    const row = {
      id: 'pending-3',
      topicId: 2,
      segmentId: 'seg-3',
      status: 'queued',
      mode: 'store-visit',
      userId: scope.userId,
      tenantId: scope.tenantId,
      continuity: {
        stage: 'waiting',
        previousSegmentId: 'seg-1',
        anchorSegmentId: 'seg-1',
        sequenceId: 's',
      },
      request: {
        lines: '还有星空打卡墙，拍照超出片',
        action: '',
        sceneImageId: 19,
        sceneImageIds: [],
        shot: 'broll',
        voiceId: 'cosyvoice-clone-x',
      },
    };
    service.operations.findOne.mockResolvedValue(row);
    const input = await service.readContinuationInput(row.id, scope);
    expect(input).toMatchObject({
      requiresTailFrame: false,
      previousVideoId: 41,
      voiceAnchor: {
        segmentId: 'seg-1',
        videoId: 41,
        url: 'https://cdn.example/video-41.mp4',
      },
    });
    await expect(
      service.continueOperation(row.id, { previousVideoId: 41 }, scope),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(service.operations.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('锚点声音只收 2～15 秒的 WAV，同一段同一个视频重复上传不重复存', async () => {
    const service = buildService({
      segments: segments([{ videoId: 41, nativeAudio: true }]),
    });
    const file = (seconds: number) => {
      const buffer = wav(seconds);
      return {
        buffer,
        size: buffer.length,
        originalname: 'anchor.wav',
        mimetype: 'audio/wav',
      };
    };
    await expect(
      service.saveVoiceAnchor(
        2,
        { segmentId: 'seg-1', videoId: 41 },
        file(1),
        scope,
      ),
    ).rejects.toThrow('2～15 秒');
    await expect(
      service.saveVoiceAnchor(
        2,
        { segmentId: 'seg-1', videoId: 40 },
        file(5),
        scope,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const saved = await service.saveVoiceAnchor(
      2,
      { segmentId: 'seg-1', videoId: 41 },
      file(5),
      scope,
    );
    expect(saved.storeVisit.voiceAnchor).toMatchObject({
      url: 'https://oss.example/anchor.wav',
      seconds: 5,
      segmentId: 'seg-1',
      videoId: 41,
    });
    expect(saved.storeVisit.voiceAnchor.voiceKey).toBe(
      storeVisitVoiceKey(saved.storeVisit),
    );
    await service.saveVoiceAnchor(
      2,
      { segmentId: 'seg-1', videoId: 41 },
      file(5),
      scope,
    );
    expect(service.storage.saveAudio).toHaveBeenCalledTimes(1);
  });
});
