import {
  buildStoreVisitH3Prompt,
  DouyinStoreVisitService,
  matchesStoreVisitRequest,
  storeVisitVoiceKey,
} from './douyin-store-visit.service.js';
import {
  COSYVOICE_DEFAULT_DELIVERY,
  COSYVOICE_STORE_VISIT_RATE,
  readWavSeconds,
} from './douyin-cosyvoice.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';
import { DouyinStoreVisitDto } from '../controller/douyin-workbench.dto.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OpensourceVideoClientService } from '../../opensource-video/services/opensource-video-client.service.js';

/** @description 构造可解析的单声道 PCM WAV。 @keyword-cn 配音波形测试, 精确时长 @keyword-en speech-wave-fixture, exact-duration */
function speechWav(seconds: number): Buffer {
  const bytes = Math.round(seconds * 24000) * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF');
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24);
  buffer.writeUInt32LE(48000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(bytes, 40);
  return buffer;
}

/** @description 构造保留配音分流和提交逻辑、替换网络与数据库的测试服务。 @keyword-cn 双引擎测试服务, 生成依赖替身 @keyword-en dual-engine-test-service, generation-dependency-double */
function speechService() {
  const service = Object.create(DouyinStoreVisitService.prototype);
  service.pollOnce = jest.fn().mockResolvedValue(undefined);
  const voice = {
    providerId: 'ds',
    apiKey: 'test',
    providerCode: 'dashscope',
    model: 'cosyvoice-v3-flash',
  };
  service.readVoiceRuntime = jest.fn().mockResolvedValue(voice);
  service.readVoiceRuntimeFor = jest.fn().mockResolvedValue(voice);
  service.cosyVoice = {
    synthesize: jest
      .fn()
      .mockResolvedValue({ buffer: speechWav(3.17), seconds: 3.17 }),
  };
  service.opensourceVideos = {
    synthesizeSpeech: jest.fn().mockResolvedValue(speechWav(3.17)),
    createVideo: jest
      .fn()
      .mockResolvedValue({
        id: 'job-1',
        status: 'queued',
        has_guide_audio: true,
      }),
  };
  service.videoQueue = {
    admit: jest.fn().mockResolvedValue(true),
    release: jest.fn(),
    enqueue: jest.fn(async (doc) => ({
      ...doc,
      status: 'queued',
      queue: { stage: 'waiting', enqueuedAt: new Date(), input: {} },
    })),
  };
  service.billing = {
    chargeService: jest.fn().mockResolvedValue(undefined),
    refundService: jest.fn().mockResolvedValue(true),
  };
  service.storage = {
    saveAudio: jest.fn().mockResolvedValue({ url: 'https://cdn/guide.wav' }),
  };
  service.operations = { insertOne: jest.fn(), updateOne: jest.fn() };
  service.repository = { get: jest.fn().mockImplementation(async () => topic) };
  service.toVideoImageUrl = jest.fn(async (url) => url);
  return service;
}

const scope = { userId: 'u1', tenantId: 't1' };
const runtime = {
  providerId: 'own',
  providerCode: 'opensource-video',
  providerName: '自建',
  model: 'minimax-h3-turbo',
  baseUrl: 'https://gpu',
  apiKey: 'test',
};
const segment = {
  id: 's1',
  lines: '这家店很适合朋友一起聚会。',
  sceneImageId: 1,
  shot: 'presenter',
  visualSource: 'original',
};
const topic = {
  id: 3,
  kind: 'child',
  title: '探店',
  storeVisit: {
    speechEngine: 'qwen3-tts',
    voicePrompt: '年轻女声，自然清亮',
    segments: [segment],
  },
};

describe('探店完整配音驱动 H3', () => {
  it('自建配音客户端带提供商 Key 提交完整台词并读取 WAV', async () => {
    const original = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(new Uint8Array(speechWav(2)), {
        headers: { 'Content-Type': 'audio/wav' },
      }),
    );
    global.fetch = fetchMock;
    try {
      const buffer = await new OpensourceVideoClientService().synthesizeSpeech(
        runtime,
        { input: segment.lines, instructions: '女声' },
      );
      expect(buffer).toEqual(speechWav(2));
      expect(fetchMock).toHaveBeenCalledWith(
        'https://gpu/v1/audio/speech',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test' }),
          body: JSON.stringify({ input: segment.lines, instructions: '女声' }),
        }),
      );
    } finally {
      global.fetch = original;
    }
  });

  it('自建配音未部署或缺模型时保留可操作的错误说明', async () => {
    const original = global.fetch;
    try {
      global.fetch = jest
        .fn()
        .mockResolvedValue(new Response('{}', { status: 404 }));
      await expect(
        new OpensourceVideoClientService().synthesizeSpeech(runtime, {
          input: '你好',
          instructions: '女声',
        }),
      ).rejects.toThrow('接口尚未部署');
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Qwen 模型未安装' }), {
          status: 503,
        }),
      );
      await expect(
        new OpensourceVideoClientService().synthesizeSpeech(runtime, {
          input: '你好',
          instructions: '女声',
        }),
      ).rejects.toThrow('Qwen 模型未安装');
    } finally {
      global.fetch = original;
    }
  });
  it('仅有声音描述时由 Qwen VoiceDesign 合成完整台词，不调用百炼', async () => {
    const service = speechService();
    const speech = await service.synthesizeGuideSpeech(
      topic,
      segment,
      runtime,
      scope,
    );
    expect(speech.seconds).toBeCloseTo(3.17);
    expect(service.cosyVoice.synthesize).not.toHaveBeenCalled();
    expect(service.opensourceVideos.synthesizeSpeech).toHaveBeenCalledWith(
      runtime,
      {
        input: segment.lines,
        instructions: `${topic.storeVisit.voicePrompt}；念法：${COSYVOICE_DEFAULT_DELIVERY}`,
      },
    );
    await service.synthesizeGuideSpeech(
      topic,
      { ...segment, delivery: '惊喜地报价格' },
      runtime,
      scope,
    );
    expect(
      service.opensourceVideos.synthesizeSpeech.mock.calls[1][1].instructions,
    ).toBe(`${topic.storeVisit.voicePrompt}；念法：惊喜地报价格`);
  });

  it('百炼合成完整台词，使用该音色所属账号，不把台词截成参考样本', async () => {
    const service = speechService();
    const selected = {
      ...topic,
      storeVisit: {
        ...topic.storeVisit,
        speechEngine: 'cosyvoice',
        voiceId: 'voice-1',
        voiceModel: 'cosyvoice-v3.5-plus',
        voiceProviderId: 'owner',
        voiceSource: 'design',
      },
    };
    await service.synthesizeGuideSpeech(selected, segment, runtime, scope);
    expect(service.readVoiceRuntimeFor).toHaveBeenCalledWith('owner');
    expect(service.cosyVoice.synthesize).toHaveBeenCalledWith(
      expect.anything(),
      {
        model: 'cosyvoice-v3.5-plus',
        voice: 'voice-1',
        text: segment.lines,
        rate: COSYVOICE_STORE_VISIT_RATE,
        instruction: COSYVOICE_DEFAULT_DELIVERY,
      },
    );
    expect(service.opensourceVideos.synthesizeSpeech).not.toHaveBeenCalled();
    await service.synthesizeGuideSpeech(
      selected,
      { ...segment, delivery: '热情打招呼，语调上扬' },
      runtime,
      scope,
    );
    expect(service.cosyVoice.synthesize.mock.calls[1][1].instruction).toBe(
      '热情打招呼，语调上扬',
    );
  });

  it('Qwen 可克隆已选百炼音色的样本，样本文字与音频同时传入', async () => {
    const service = speechService();
    await service.synthesizeGuideSpeech(
      {
        ...topic,
        storeVisit: {
          ...topic.storeVisit,
          voiceId: 'voice-1',
          voiceModel: 'cosyvoice-v3-flash',
          voiceSource: 'preset',
        },
      },
      segment,
      runtime,
      scope,
    );
    expect(service.opensourceVideos.synthesizeSpeech).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        input: segment.lines,
        reference_audio: expect.stringMatching(/^data:audio\/wav;base64,/),
        reference_text: expect.any(String),
      }),
    );
  });

  it('两种引擎的配音都先去掉开头空白、缩短长停顿，再按收紧后的时长出画面', async () => {
    /** @description 前 0.6 秒静音、后 1 秒正弦波的配音。 @keyword-cn 带开头空白的配音, 收紧测试 @keyword-en leading-silence-speech, tighten-fixture */
    const leadingSilence = () => {
      const wav = speechWav(1.6);
      for (let index = 14400; index < 38400; index++)
        wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * index) / 24000)), 44 + index * 2);
      return wav;
    };
    const service = speechService();
    service.cosyVoice.synthesize.mockResolvedValueOnce({ buffer: leadingSilence(), seconds: 1.6 });
    const cosy = await service.synthesizeGuideSpeech(
      {
        ...topic,
        storeVisit: { ...topic.storeVisit, speechEngine: 'cosyvoice', voiceId: 'voice-1', voiceModel: 'cosyvoice-v3.5-plus' },
      },
      segment,
      runtime,
      scope,
    );
    expect(cosy.seconds).toBe(1.08);
    expect(readWavSeconds(cosy.buffer)).toBe(1.08);
    service.opensourceVideos.synthesizeSpeech.mockResolvedValueOnce(leadingSilence());
    const qwen = await service.synthesizeGuideSpeech(topic, segment, runtime, scope);
    expect(qwen.seconds).toBe(1.08);
  });

  it('Qwen 续段优先克隆第 1 段锚点，截短样本不编造全文转录', async () => {
    const service = speechService();
    const original = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(
      new Response(new Uint8Array(speechWav(2)), {
        headers: { 'Content-Type': 'audio/wav' },
      }),
    );
    try {
      await service.synthesizeGuideSpeech(topic, segment, runtime, scope, {
        url: 'https://cdn/anchor.wav',
      });
      expect(
        service.opensourceVideos.synthesizeSpeech.mock.calls[0][1],
      ).toEqual(
        expect.objectContaining({
          reference_audio: expect.stringMatching(/^data:audio\/wav;base64,/),
        }),
      );
      expect(
        service.opensourceVideos.synthesizeSpeech.mock.calls[0][1]
          .reference_text,
      ).toBeUndefined();
      expect(service.cosyVoice.synthesize).not.toHaveBeenCalled();
    } finally {
      global.fetch = original;
    }
  });

  it('自建任务先持久化排队，接口不等待配音，不提前扣费', async () => {
    const service = speechService();
    const view = await service.submitSegment({
      topic,
      segment,
      index: 1,
      sceneUrl: '',
      voice: { voiceId: '', model: '' },
      target: { shot: 'presenter', engine: 'opensource-video', runtime },
      scope,
    });
    expect(view.status).toBe('queued');
    expect(service.billing.chargeService).not.toHaveBeenCalled();
    expect(service.opensourceVideos.synthesizeSpeech).not.toHaveBeenCalled();
    expect(service.videoQueue.enqueue).toHaveBeenCalled();
  });

  it('按真实配音时长提交首帧和完整 guide_audio，成片仍标记为已含音轨', async () => {
    const service = speechService();
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    const view = await service.submitSegment({
      topic,
      segment,
      index: 1,
      sceneUrl: image,
      voice: { voiceId: '', model: '' },
      target: { shot: 'presenter', engine: 'opensource-video', runtime },
      scope,
      admitted: true,
    });
    expect(view.status).toBe('queued');
    const payload = service.opensourceVideos.createVideo.mock.calls[0][1];
    expect(payload.duration).toBeGreaterThanOrEqual(3.17);
    expect(payload.duration).toBeLessThan(3.22);
    expect(payload.first_frame).toBe(image);
    expect(payload.guide_audio).toBe(
      `data:audio/wav;base64,${speechWav(3.17).toString('base64')}`,
    );
    const saved = service.operations.insertOne.mock.calls[0][0];
    expect(saved.request).toMatchObject({
      nativeAudio: true,
      voiceMode: 'guide',
      speechEngine: 'qwen3-tts',
      audioSeconds: 3.17,
    });
    expect(payload.reference_audios).toBeUndefined();
  });

  it('配音超过模型时长时不提交视频并退费，不静默裁断台词', async () => {
    const service = speechService();
    service.opensourceVideos.synthesizeSpeech.mockResolvedValue(
      speechWav(15.1),
    );
    await expect(
      service.submitSegment({
        topic,
        segment,
        index: 1,
        sceneUrl: '',
        voice: { voiceId: '', model: '' },
        target: { shot: 'presenter', engine: 'opensource-video', runtime },
        scope,
        admitted: true,
      }),
    ).rejects.toThrow('配音时长');
    expect(service.opensourceVideos.createVideo).not.toHaveBeenCalled();
    expect(service.billing.refundService).toHaveBeenCalled();
  });

  it('开场配音不足音色锚点的两秒下限时明确提示并退费', async () => {
    const service = speechService();
    service.opensourceVideos.synthesizeSpeech.mockResolvedValue(speechWav(1));
    await expect(
      service.submitSegment({
        topic,
        segment,
        index: 1,
        sceneUrl: '',
        voice: { voiceId: '', model: '' },
        target: { shot: 'presenter', engine: 'opensource-video', runtime },
        scope,
        admitted: true,
        cleanVoice: true,
      }),
    ).rejects.toThrow('统一音色至少需要 2 秒声音');
    expect(service.opensourceVideos.createVideo).not.toHaveBeenCalled();
    expect(service.billing.refundService).toHaveBeenCalled();
  });

  it('配音服务失败时不退回自由出声的视频流程，并退费', async () => {
    const service = speechService();
    service.opensourceVideos.synthesizeSpeech.mockRejectedValue(
      new Error('Qwen 模型未安装'),
    );
    await expect(
      service.submitSegment({
        topic,
        segment,
        index: 1,
        sceneUrl: '',
        voice: { voiceId: '', model: '' },
        target: { shot: 'presenter', engine: 'opensource-video', runtime },
        scope,
        admitted: true,
      }),
    ).rejects.toThrow('Qwen 模型未安装');
    expect(service.opensourceVideos.createVideo).not.toHaveBeenCalled();
    expect(service.billing.refundService).toHaveBeenCalled();
  });

  it('旧 GPU 服务没有确认锚定配音时拒绝绑定结果并退费', async () => {
    const service = speechService();
    service.opensourceVideos.createVideo.mockResolvedValue({
      id: 'old-service-job',
      status: 'queued',
    });
    await expect(
      service.submitSegment({
        topic,
        segment,
        index: 1,
        sceneUrl: 'data:image/png;base64,iVBORw0KGgo=',
        voice: { voiceId: '', model: '' },
        target: { shot: 'presenter', engine: 'opensource-video', runtime },
        scope,
        admitted: true,
      }),
    ).rejects.toThrow('请先升级 GPU 服务');
    expect(service.billing.refundService).toHaveBeenCalled();
  });

  it('参考图模式同样带锚定配音，完整配音不冒充音色样本', async () => {
    const service = speechService();
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    const payload = await service.buildOpensourceSegmentInput({
      prompt: 'x',
      content: [
        {
          type: 'image_url',
          image_url: { url: image },
          role: 'reference_image',
        },
      ],
      seconds: 4,
      megapixels: 0.5,
      runtime,
      guideAudio: { buffer: speechWav(4) },
    });
    expect(payload.reference_images).toEqual([image]);
    expect(payload.reference_audios).toEqual([]);
    expect(payload.guide_audio).toBeDefined();
    expect(payload.first_frame).toBeUndefined();
  });

  it('锚定提示词不把完整配音说成音色样本，不强制禁用字幕', () => {
    const prompt = buildStoreVisitH3Prompt({
      title: '',
      lines: segment.lines,
      seconds: 4,
      shot: 'presenter',
      sceneDescription: '',
      voiceDescription: '女声',
      referenceAudio: false,
      multiReference: false,
      guideAudio: true,
    });
    expect(prompt).toContain(
      'Follow the provided complete voiceover exactly from frame zero',
    );
    expect(prompt).not.toContain('only a voice sample');
    expect(prompt).not.toContain('No subtitles');
  });

  it('切换引擎会使旧请求与旧锚点失效', () => {
    const selected = {
      ...topic,
      storeVisit: { ...topic.storeVisit, speechEngine: 'cosyvoice' },
    };
    expect(storeVisitVoiceKey(selected.storeVisit as never)).not.toBe(
      storeVisitVoiceKey(topic.storeVisit as never),
    );
    expect(
      matchesStoreVisitRequest(selected as never, segment as never, {
        ...segment,
        voiceId: '',
        speechEngine: 'qwen3-tts',
      }),
    ).toBe(false);
  });

  it('DTO 拒绝未知配音引擎', async () => {
    expect(
      await validate(
        plainToInstance(DouyinStoreVisitDto, { speechEngine: 'qwen3-tts' }),
      ),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(DouyinStoreVisitDto, { speechEngine: 'unknown' }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('换引擎清掉旧配音、分段、合成与锚点，保留台词与人物首帧', async () => {
    const repository = Object.create(
      DouyinWorkbenchRepositoryService.prototype,
    );
    const previous = {
      ...segment,
      keyframe: { id: 9 },
      videoId: 10,
      audioUrl: '/old.wav',
      audioSeconds: 4,
      nativeAudio: true,
      voiceId: 'v',
    };
    repository.get = jest.fn().mockResolvedValue({
      ...topic,
      storeVisit: {
        ...topic.storeVisit,
        speechEngine: 'cosyvoice',
        voiceId: 'v',
        segments: [previous],
      },
    });
    repository.topics = { findOneAndUpdate: jest.fn() };
    await repository.update(
      topic.id,
      { storeVisit: { speechEngine: 'qwen3-tts' } },
      scope,
    );
    const update = repository.topics.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set['storeVisit.segments']).toEqual([
      { ...segment, keyframe: { id: 9 } },
    ]);
    expect(update.$unset).toMatchObject({
      generatedVideoId: '',
      'storeVisit.voiceAnchor': '',
    });
  });
});
