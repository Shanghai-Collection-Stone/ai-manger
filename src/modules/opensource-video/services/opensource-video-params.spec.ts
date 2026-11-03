import {
  clampOpensourceVideoDuration,
  clampOpensourceVideoResolution,
  describeOpensourceVideoFailure,
  isOpensourceVideoProvider,
  listOpensourceVideoDurationChoices,
  listOpensourceVideoResolutionChoices,
  mapOpensourceVideoStatus,
  resolveOpensourceVideoMode,
  toOpensourceVoiceHint,
} from './opensource-video-params';

describe('opensource video params', () => {
  it('提供商代码大小写与空格不限', () => {
    expect(isOpensourceVideoProvider(' OpenSource-Video ')).toBe(true);
    expect(isOpensourceVideoProvider('shuyan')).toBe(false);
    expect(isOpensourceVideoProvider(undefined)).toBe(false);
  });

  it('模型编码换成生成档位，不认识的返回 null', () => {
    expect(resolveOpensourceVideoMode('minimax-h3-turbo')).toBe('turbo');
    expect(resolveOpensourceVideoMode(' MiniMax-H3-Fast ')).toBe('fast');
    expect(resolveOpensourceVideoMode('minimax-h3-quality')).toBe('quality');
    expect(resolveOpensourceVideoMode('MiniMax-H3')).toBeNull();
  });

  it('时长 1～15 秒，四舍五入后夹到范围内', () => {
    const choices = listOpensourceVideoDurationChoices();
    expect(choices[0]).toBe(1);
    expect(choices[choices.length - 1]).toBe(15);
    expect(choices).toHaveLength(15);
    expect(clampOpensourceVideoDuration(4.6)).toBe(5);
    expect(clampOpensourceVideoDuration(40)).toBe(15);
    expect(clampOpensourceVideoDuration(0)).toBe(1);
    expect(clampOpensourceVideoDuration(Number.NaN)).toBe(1);
  });

  it('清晰度没设定用 544P，其他写法就近取档', () => {
    expect(listOpensourceVideoResolutionChoices()).toEqual(['544P', '672P']);
    expect(clampOpensourceVideoResolution()).toEqual({
      label: '544P',
      megapixels: 0.5,
    });
    expect(clampOpensourceVideoResolution('672p')).toEqual({
      label: '672P',
      megapixels: 0.8,
    });
    expect(clampOpensourceVideoResolution('480p').label).toBe('544P');
    expect(clampOpensourceVideoResolution('720P').label).toBe('672P');
    expect(clampOpensourceVideoResolution('2K').label).toBe('672P');
    expect(clampOpensourceVideoResolution('SUPER_HD').label).toBe('544P');
  });

  it('音色描述转英文：预设句、用户写的描述、预设人物句都只出英文，认不出时为空', () => {
    expect(
      toOpensourceVoiceHint(
        '男声，东北直率男，东北话，自然口语，整条视频保持同一个人的音色与语气',
      ),
    ).toBe(
      'male voice, Northeastern Chinese accent, hearty and straightforward',
    );
    expect(
      toOpensourceVoiceHint(
        '二十多岁的男生，声音中气足的低音炮，略沙哑，语速适中，豪爽东北大哥，带着老铁们吃喝玩乐。',
      ),
    ).toBe(
      'young deep slightly husky strong male voice, Northeastern Chinese accent, hearty and straightforward',
    );
    expect(
      toOpensourceVoiceHint(
        '旁白音色固定为年轻女声，语速偏快利落，清亮干脆；全片只有这一个人的声音。',
      ),
    ).toBe('young bright female voice, fast pace');
    expect(toOpensourceVoiceHint('自然清晰的中文声音')).toBe('');
    expect(toOpensourceVoiceHint(undefined)).toBe('');
  });

  it('状态映射：succeeded → completed，未知状态视为排队', () => {
    expect(mapOpensourceVideoStatus('succeeded')).toBe('completed');
    expect(mapOpensourceVideoStatus('failed')).toBe('failed');
    expect(mapOpensourceVideoStatus('running')).toBe('running');
    expect(mapOpensourceVideoStatus('queued')).toBe('queued');
    expect(mapOpensourceVideoStatus(undefined)).toBe('queued');
  });

  it('报错翻译：通道错误给固定说明，生成失败原文附在后面', () => {
    expect(
      describeOpensourceVideoFailure(
        'OPENSOURCE_VIDEO_HTTP_401:{"detail":"缺少或错误的 API Key"}',
      ),
    ).toContain('API Key 无效');
    expect(
      describeOpensourceVideoFailure(
        'OPENSOURCE_VIDEO_HTTP_502:{"detail":"x"}',
      ),
    ).toContain('ComfyUI 暂时不可用');
    expect(
      describeOpensourceVideoFailure(
        'OPENSOURCE_VIDEO_NETWORK_ERROR:fetch failed',
      ),
    ).toContain('映射地址');
    expect(
      describeOpensourceVideoFailure(
        '任务已不在 ComfyUI 队列中 (ComfyUI 可能重启过)',
      ),
    ).toBe(
      '自建视频服务生成失败：任务已不在 ComfyUI 队列中 (ComfyUI 可能重启过)',
    );
    expect(describeOpensourceVideoFailure('')).toBe(
      '自建视频服务生成失败，请稍后重试。',
    );
  });
});
