import {
  buildCosyVoiceInstruction,
  buildCosyVoicePrefix,
  cleanDelivery,
  COSYVOICE_DEFAULT_DELIVERY,
  cosyVoiceInstructionLength,
  COSYVOICE_PRESET_CATEGORIES,
  COSYVOICE_PRESET_VOICES,
  COSYVOICE_STORE_VISIT_RATE,
  describeCosyVoiceFailure,
  describeVoiceDesignFailure,
  DouyinCosyVoiceService,
  readWavSeconds,
  resolveDashScopeOrigin,
  tightenSpeechPauses,
} from './douyin-cosyvoice.service.js';

/**
 * @description 造一段静音 PCM WAV：16bit 单声道，指定采样率与秒数；`dataSize` 可强制写成流式占位值。
 * @keyword-cn 构造测试WAV, 静音音频
 * @keyword-en build-test-wav, silent-audio
 * @param {number} seconds 秒数。
 * @param {number} sampleRate 采样率。
 * @param {number} [dataSize] 写进头里的 data 块大小。
 * @returns {Buffer} WAV 文件内容。
 */
function buildWav(seconds: number, sampleRate: number, dataSize?: number): Buffer {
  const byteRate = sampleRate * 2;
  const pcm = Buffer.alloc(Math.round(seconds * byteRate));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize ?? pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * @description 按片段拼一段 24kHz 16bit 单声道 WAV：每段给秒数与振幅，振幅为 0 是静音，否则是 440Hz 正弦波（模拟人声）。
 * @keyword-cn 拼接测试WAV, 模拟人声
 * @keyword-en build-pieced-wav, fake-speech
 * @param {Array<[number, number]>} pieces 片段：[秒数, 振幅]。
 * @returns {Buffer} WAV 文件内容。
 */
function piecedWav(pieces: Array<[number, number]>): Buffer {
  const samples = pieces.flatMap(([seconds, amplitude]) =>
    Array.from({ length: Math.round(seconds * 24000) }, (_, index) =>
      Math.round(amplitude * Math.sin((2 * Math.PI * 440 * index) / 24000)),
    ),
  );
  const wav = buildWav(samples.length / 24000, 24000);
  samples.forEach((value, index) => wav.writeInt16LE(value, 44 + index * 2));
  return wav;
}

describe('百炼 CosyVoice 客户端', () => {
  afterEach(() => jest.restoreAllMocks());

  it('服务地址只取域名，兼容模式、专属域名和空值都能用', () => {
    expect(
      resolveDashScopeOrigin('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    ).toBe('https://dashscope.aliyuncs.com');
    expect(
      resolveDashScopeOrigin('https://ws-1.cn-beijing.maas.aliyuncs.com/api/v1'),
    ).toBe('https://ws-1.cn-beijing.maas.aliyuncs.com');
    expect(resolveDashScopeOrigin('')).toBe('https://dashscope.aliyuncs.com');
    expect(resolveDashScopeOrigin('not a url')).toBe(
      'https://dashscope.aliyuncs.com',
    );
  });

  it('克隆前缀只含字母数字且不超过 10 个字符', () => {
    expect(buildCosyVoicePrefix(2)).toBe('aim2');
    expect(buildCosyVoicePrefix(123456789)).toMatch(/^[a-z0-9]{1,10}$/);
    expect(buildCosyVoicePrefix(Number.NaN)).toBe('aim0');
  });

  it('从 WAV 文件头算时长，流式占位的 data 大小按文件长度算，非 WAV 为 0', () => {
    expect(readWavSeconds(buildWav(2.5, 24000))).toBe(2.5);
    expect(readWavSeconds(buildWav(1.2, 16000, 0xffffffff))).toBe(1.2);
    expect(readWavSeconds(Buffer.from('ID3 mp3 data that is not wav at all.....'))).toBe(0);
  });

  it('音色库每个分类都同时有男声和女声，每个音色都归到已有分类', () => {
    const keys = COSYVOICE_PRESET_CATEGORIES.map((category) => category.key);
    for (const voice of COSYVOICE_PRESET_VOICES)
      expect(keys).toContain(voice.category);
    for (const key of keys) {
      const genders = new Set(
        COSYVOICE_PRESET_VOICES.filter((voice) => voice.category === key).map(
          (voice) => voice.gender,
        ),
      );
      expect([...genders].sort()).toEqual(['female', 'male']);
    }
  });

  it('声音设计：按描述与试听句创建音色，响应里取音色 ID', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output: { voice_id: 'cosyvoice-v3.5-plus-vd-aim2-x' },
        }),
        { status: 200 },
      ),
    );
    const voiceId = await new DouyinCosyVoiceService().designVoice(
      { apiKey: 'sk-test' },
      {
        targetModel: 'cosyvoice-v3.5-plus',
        prefix: 'aim2',
        prompt: '二十多岁的女生，声音清亮',
        previewText: '大家好，今天带大家去探一家宝藏小店。',
      },
    );
    expect(voiceId).toBe('cosyvoice-v3.5-plus-vd-aim2-x');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization',
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: 'cosyvoice-v3.5-plus',
        prefix: 'aim2',
        voice_prompt: '二十多岁的女生，声音清亮',
        language_hints: ['zh'],
      },
    });
  });

  it('声音设计报错：描述不合格时提示换个说法，其余沿用通用说明', () => {
    expect(describeVoiceDesignFailure('DASHSCOPE_VOICE_REJECTED')).toContain(
      '换个说法',
    );
    expect(describeVoiceDesignFailure('DASHSCOPE_HTTP_401:x')).toContain(
      'API Key',
    );
  });

  it('系统音色 ID 不重复、都带名称和特质', () => {
    const ids = COSYVOICE_PRESET_VOICES.map((voice) => voice.voiceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const voice of COSYVOICE_PRESET_VOICES) {
      expect(voice.voiceName).toBeTruthy();
      expect(voice.trait).toBeTruthy();
    }
  });

  it('报错翻译：Key、限流、音色不匹配、审核不通过、录音不合格', () => {
    expect(describeCosyVoiceFailure('DASHSCOPE_HTTP_401:x')).toContain('API Key');
    expect(describeCosyVoiceFailure('DASHSCOPE_HTTP_429:Throttling')).toContain(
      '频繁',
    );
    expect(
      describeCosyVoiceFailure(
        'DASHSCOPE_HTTP_400:/SpeechSynthesizer:{"message":"[cosyvoice:]Engine return error code: 418"}',
      ),
    ).toContain('音色不可用');
    expect(describeCosyVoiceFailure('DASHSCOPE_VOICE_REJECTED')).toContain('审核');
    expect(
      describeCosyVoiceFailure('DASHSCOPE_HTTP_400:/customization:{"message":"bad"}'),
    ).toContain('录音不符合');
    expect(
      describeCosyVoiceFailure('DASHSCOPE_HTTP_500:/x:{"message":"内部错误"}'),
    ).toBe('百炼语音服务出错：内部错误');
  });

  it('合成配音：请求 24kHz WAV、http 地址换成 https 下载，并算出时长', async () => {
    const wav = buildWav(3, 24000);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: { audio: { url: 'http://dashscope-result-bj.example/a.wav' } },
            usage: { characters: 12 },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(wav)));
    const result = await new DouyinCosyVoiceService().synthesize(
      { apiKey: 'sk-test' },
      { model: 'cosyvoice-v3.5-plus', voice: 'v1', text: '你好' },
    );
    expect(result.seconds).toBe(3);
    expect(result.characters).toBe(12);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'cosyvoice-v3.5-plus',
      input: { voice: 'v1', format: 'wav', sample_rate: 24000 },
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://dashscope-result-bj.example/a.wav',
    );
  });

  it('念法转合成指令：复刻 / 设计音色在支持的模型上用自然语言，音色库只有支持情感的系统音色用固定格式，其余不传', () => {
    expect(
      buildCosyVoiceInstruction({ model: 'cosyvoice-v3.5-plus', voiceId: 'c1', voiceSource: 'clone', delivery: ' 热情打招呼，语调上扬 ' }),
    ).toBe('热情打招呼，语调上扬');
    expect(
      buildCosyVoiceInstruction({ model: 'cosyvoice-v3-flash', voiceId: 'd1', voiceSource: 'design' }),
    ).toBe(COSYVOICE_DEFAULT_DELIVERY);
    expect(
      buildCosyVoiceInstruction({ model: 'cosyvoice-v3-plus', voiceId: 'c1', voiceSource: 'clone', delivery: '兴奋' }),
    ).toBeUndefined();
    expect(
      buildCosyVoiceInstruction({ model: 'cosyvoice-v3-flash', voiceId: 'longlaotie_v3', voiceSource: 'preset', delivery: '兴奋' }),
    ).toBeUndefined();
    expect(
      buildCosyVoiceInstruction({ model: 'cosyvoice-v3-flash', voiceId: 'longanyang', voiceSource: 'preset' }),
    ).toBe('你正在进行广告促销，你说话的情感是happy。');
    expect(
      buildCosyVoiceInstruction({ model: 'cosyvoice-v3-plus', voiceId: 'longanhuan', voiceSource: 'preset', delivery: '惊喜地报价格' }),
    ).toBe('你正在进行产品推广，你说话的情感是surprised。');
    const long = buildCosyVoiceInstruction({ model: 'cosyvoice-v3.5-flash', voiceId: 'c1', voiceSource: 'clone', delivery: '很'.repeat(60) });
    expect(cosyVoiceInstructionLength(long!)).toBeLessThanOrEqual(100);
    expect(cosyVoiceInstructionLength('热情a1，')).toBe(7);
  });

  it('念法只管声音：带推门、走进、指着、边走边说、镜头这类动作或画面说法的小句整句去掉', () => {
    expect(cleanDelivery(' 边推门边说，热络招呼，语调上扬 ')).toBe('热络招呼，语调上扬');
    expect(cleanDelivery('走进店里；指着屏幕，语速稍快。重音在小丑竞技场')).toBe('语速稍快，重音在小丑竞技场');
    expect(cleanDelivery('对着镜头挥手')).toBe('');
    expect(cleanDelivery('热情打招呼，语调上扬')).toBe('热情打招呼，语调上扬');
    expect(cleanDelivery(undefined)).toBe('');
    expect(
      buildCosyVoiceInstruction({ model: 'cosyvoice-v3.5-plus', voiceId: 'c1', voiceSource: 'clone', delivery: '边推门边说，热络招呼' }),
    ).toBe('热络招呼');
    expect(
      buildCosyVoiceInstruction({ model: 'cosyvoice-v3.5-plus', voiceId: 'c1', voiceSource: 'clone', delivery: '推门进去' }),
    ).toBe(COSYVOICE_DEFAULT_DELIVERY);
  });

  it('合成时把念法指令放进 input.instruction；百炼拒绝指令时退回不带指令再合成一次', async () => {
    const wav = buildWav(2, 24000);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'InvalidParameter', message: 'instruction not supported' }), { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output: { audio: { url: 'https://a/b.wav' } } })),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(wav)));
    const result = await new DouyinCosyVoiceService().synthesize(
      { apiKey: 'sk-test' },
      { model: 'cosyvoice-v3.5-plus', voice: 'v1', text: '你好', instruction: '热情地说' },
    );
    expect(result.seconds).toBe(2);
    const first = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as { input: Record<string, unknown> };
    const second = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as { input: Record<string, unknown> };
    expect(first.input.instruction).toBe('热情地说');
    expect(second.input.instruction).toBeUndefined();
  });

  it('带语速时写进 input.rate，退回不带念法指令重试时语速照带；原速不传', async () => {
    const wav = buildWav(2, 24000);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'InvalidParameter' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { audio: { url: 'https://a/b.wav' } } })))
      .mockResolvedValueOnce(new Response(new Uint8Array(wav)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { audio: { url: 'https://a/c.wav' } } })))
      .mockResolvedValueOnce(new Response(new Uint8Array(wav)));
    const service = new DouyinCosyVoiceService();
    await service.synthesize(
      { apiKey: 'sk-test' },
      { model: 'cosyvoice-v3.5-plus', voice: 'v1', text: '你好', instruction: '热情地说', rate: COSYVOICE_STORE_VISIT_RATE },
    );
    await service.synthesize({ apiKey: 'sk-test' }, { model: 'cosyvoice-v3.5-plus', voice: 'v1', text: '你好', rate: 1 });
    const bodies = [0, 1, 3].map(
      (index) => JSON.parse(String((fetchMock.mock.calls[index] as [string, RequestInit])[1].body)) as { input: Record<string, unknown> },
    );
    expect(bodies[0].input).toMatchObject({ rate: 1.15, instruction: '热情地说' });
    expect(bodies[1].input.rate).toBe(1.15);
    expect(bodies[1].input.instruction).toBeUndefined();
    expect(bodies[2].input.rate).toBeUndefined();
  });

  it('收紧配音停顿：开头只留 0.08 秒、结尾留 0.15 秒，长停顿缩到 0.3 秒，开头的咔哒声不算开口', () => {
    const wav = piecedWav([[0.01, 8000], [0.59, 0], [1, 8000], [0.8, 0], [0.5, 8000], [0.5, 0]]);
    const tightened = tightenSpeechPauses(wav);
    expect(readWavSeconds(wav)).toBe(3.4);
    expect(readWavSeconds(tightened)).toBe(2.03);
    expect(tightened.readUInt32LE(4)).toBe(tightened.length - 8);
    expect(tightened.readUInt32LE(40)).toBe(tightened.length - 44);
  });

  it('收紧配音停顿：短停顿保留，整段静音或不是 16bit PCM 时原样返回', () => {
    const tight = piecedWav([[0.05, 0], [1, 8000], [0.2, 0], [1, 8000], [0.1, 0]]);
    expect(tightenSpeechPauses(tight)).toBe(tight);
    const silent = buildWav(2, 24000);
    expect(tightenSpeechPauses(silent)).toBe(silent);
    const float = piecedWav([[0.6, 0], [1, 8000]]);
    float.writeUInt16LE(3, 20);
    expect(tightenSpeechPauses(float)).toBe(float);
    const notWav = Buffer.from('not a wav file at all, just some bytes padding padding');
    expect(tightenSpeechPauses(notWav)).toBe(notWav);
  });

  it('响应带 code 时抛出保留原始信息的错误；没有 Key 时不发请求', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'InvalidParameter', message: 'x' }), {
          status: 400,
        }),
      );
    const service = new DouyinCosyVoiceService();
    await expect(
      service.createVoice(
        { apiKey: 'sk-test' },
        { targetModel: 'cosyvoice-v3.5-plus', prefix: 'aim2', audioUrl: 'https://a' },
      ),
    ).rejects.toThrow('DASHSCOPE_HTTP_400:/customization');
    fetchMock.mockClear();
    await expect(
      service.synthesize({}, { model: 'm', voice: 'v', text: 't' }),
    ).rejects.toThrow('InvalidApiKey');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
