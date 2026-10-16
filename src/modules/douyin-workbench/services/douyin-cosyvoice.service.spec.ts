import {
  buildCosyVoicePrefix,
  COSYVOICE_PRESET_CATEGORIES,
  COSYVOICE_PRESET_VOICES,
  describeCosyVoiceFailure,
  describeVoiceDesignFailure,
  DouyinCosyVoiceService,
  readWavSeconds,
  resolveDashScopeOrigin,
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
