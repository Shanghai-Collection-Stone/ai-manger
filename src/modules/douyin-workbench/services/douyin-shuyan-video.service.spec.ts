import {
  clampShuyanVideoDuration,
  describeShuyanVideoError,
  isShuyanSeedanceModel,
  listShuyanVideoDurationChoices,
  mapShuyanVideoStatus,
  resolveShuyanVideoGateway,
  listShuyanVideoResolutionChoices,
  clampShuyanVideoResolution,
} from './douyin-shuyan-video.service';

describe('数眼 Seedance 视频运行时', () => {
  it('清晰度只有 Seedance 2.x 能到 1080p，设定对不上时就近取、没设定用默认档', () => {
    expect(listShuyanVideoResolutionChoices('seedance-2-0-pro')).toEqual([
      '480p',
      '720p',
      '1080p',
    ]);
    expect(listShuyanVideoResolutionChoices('seedance-1-0-pro')).toEqual([
      '480p',
      '720p',
    ]);
    expect(clampShuyanVideoResolution('seedance-2-0-pro', '1080P')).toBe(
      '1080p',
    );
    expect(clampShuyanVideoResolution('seedance-1-0-pro', '1080p')).toBe(
      '720p',
    );
    expect(clampShuyanVideoResolution('seedance-2-0-pro', '')).toBe('480p');
  });

  it('只把 Seedance 型号交给当前原生路由', () => {
    expect(isShuyanSeedanceModel('doubao-seedance-2-5-oinone')).toBe(true);
    expect(isShuyanSeedanceModel('seedance-1.5-pro')).toBe(true);
    expect(isShuyanSeedanceModel('kling-v2.1')).toBe(false);
  });

  it('从 OpenAI baseUrl 还原视频网关根地址', () => {
    expect(resolveShuyanVideoGateway('https://platform.shuyanai.com/v1')).toBe(
      'https://platform.shuyanai.com',
    );
    expect(resolveShuyanVideoGateway('https://cloud.shuyanai.com/v1/')).toBe(
      'https://cloud.shuyanai.com',
    );
    expect(resolveShuyanVideoGateway('https://relay.example.com/gateway')).toBe(
      'https://relay.example.com/gateway',
    );
  });

  it('按 Seedance 版本给出时长范围', () => {
    expect(listShuyanVideoDurationChoices('seedance-1-0-pro')).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(listShuyanVideoDurationChoices('seedance-1-5-pro')).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(
      listShuyanVideoDurationChoices('doubao-seedance-2-5-oinone'),
    ).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('把计划时长收敛成模型允许的整数秒', () => {
    expect(clampShuyanVideoDuration('seedance-1-0-pro', 1)).toBe(2);
    expect(clampShuyanVideoDuration('seedance-1-5-pro', 20)).toBe(12);
    expect(clampShuyanVideoDuration('seedance-2-0', 8.6)).toBe(9);
  });

  it.each([
    [undefined, 'queued'],
    ['queued', 'queued'],
    ['running', 'running'],
    ['succeeded', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'failed'],
    ['expired', 'failed'],
  ])('状态 %s → %s', (status, expected) => {
    expect(mapShuyanVideoStatus(status)).toBe(expected);
  });

  it('错误说明同时保留错误码与消息', () => {
    expect(
      describeShuyanVideoError({
        status: 'failed',
        error: { code: 'ContentFilteredError', message: 'content rejected' },
      }),
    ).toBe('数眼智能视频生成失败：ContentFilteredError：content rejected');
  });
});
