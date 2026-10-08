import {
  clampShuyanVideoDuration,
  describeShuyanVideoError,
  listShuyanVideoDurationChoices,
  mapShuyanVideoStatus,
  resolveShuyanVideoGateway,
  listShuyanVideoResolutionChoices,
  clampShuyanVideoResolution,
  describeShuyanVideoFailure,
  describeRejectedShuyanImages,
  normalizeShuyanVideoModel,
  resolveShuyanVideoRoute,
  resolveShuyanVideoTaskUrl,
  shuyanResolutionHeightOf,
  unwrapShuyanVideoTask,
} from './douyin-shuyan-video.service';

describe('数眼视频运行时（Seedance / MiniMax-H3）', () => {
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

  it('Seedance 与 MiniMax-H3 各走自己的原生路由，其余视频族未接入', () => {
    expect(resolveShuyanVideoRoute('doubao-seedance-2-5-oinone')).toBe(
      'seedance',
    );
    expect(resolveShuyanVideoRoute('seedance-1.5-pro')).toBe('seedance');
    expect(resolveShuyanVideoRoute('MiniMax-H3')).toBe('hailuo-v2');
    expect(resolveShuyanVideoRoute('minimax-h3')).toBe('hailuo-v2');
    expect(resolveShuyanVideoRoute('kling-v2.1')).toBeNull();
    expect(resolveShuyanVideoRoute('hailuo-2.3')).toBeNull();
    expect(resolveShuyanVideoRoute('MiniMax-M3')).toBeNull();
  });

  it('MiniMax-H3 模型名对齐到接口枚举，其余原样', () => {
    expect(normalizeShuyanVideoModel(' minimax-h3 ')).toBe('MiniMax-H3');
    expect(normalizeShuyanVideoModel('seedance-2-0-pro')).toBe(
      'seedance-2-0-pro',
    );
  });

  it('按路由拼创建与查询地址', () => {
    const gateway = 'https://platform.shuyanai.com';
    expect(resolveShuyanVideoTaskUrl(gateway, 'hailuo-v2')).toBe(
      'https://platform.shuyanai.com/hailuo/v2/video_generation',
    );
    expect(resolveShuyanVideoTaskUrl(gateway, 'hailuo-v2', '4240109')).toBe(
      'https://platform.shuyanai.com/hailuo/v2/query/video_generation/4240109',
    );
    expect(resolveShuyanVideoTaskUrl(gateway, 'seedance')).toBe(
      'https://platform.shuyanai.com/seedance/api/v3/contents/generations/tasks',
    );
    expect(resolveShuyanVideoTaskUrl(gateway, 'seedance', 'cgt-1')).toBe(
      'https://platform.shuyanai.com/seedance/api/v3/contents/generations/tasks/cgt-1',
    );
  });

  it('MiniMax-H3 查询结果拆掉 task 外壳，Seedance 平铺结果原样', () => {
    expect(
      unwrapShuyanVideoTask({
        task: {
          id: '4240109',
          status: 'succeeded',
          content: { url: 'https://cdn.example.com/a.mp4' },
        },
      }),
    ).toEqual({
      id: '4240109',
      status: 'succeeded',
      content: { url: 'https://cdn.example.com/a.mp4' },
    });
    const flat = { id: 'cgt-1', status: 'running' };
    expect(unwrapShuyanVideoTask(flat)).toBe(flat);
  });

  it('MiniMax-H3 清晰度为 768P / 2K，没设定取 768P，按像素就近取档', () => {
    expect(listShuyanVideoResolutionChoices('MiniMax-H3')).toEqual([
      '768P',
      '2K',
    ]);
    expect(clampShuyanVideoResolution('MiniMax-H3', '')).toBe('768P');
    expect(clampShuyanVideoResolution('MiniMax-H3', '2k')).toBe('2K');
    expect(clampShuyanVideoResolution('MiniMax-H3', '1080p')).toBe('768P');
    expect(clampShuyanVideoResolution('MiniMax-H3', '1440p')).toBe('2K');
    expect(clampShuyanVideoResolution('seedance-2-0-pro', '2K')).toBe('1080p');
    expect(shuyanResolutionHeightOf('2K')).toBe(1440);
    expect(shuyanResolutionHeightOf('768P')).toBe(768);
    expect(shuyanResolutionHeightOf('高清')).toBe(0);
  });

  it('MiniMax-H3 可选 4~15 秒', () => {
    expect(listShuyanVideoDurationChoices('MiniMax-H3')).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(clampShuyanVideoDuration('MiniMax-H3', 2)).toBe(4);
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

  it('认不出的上游错误给通用中文说明，原文留在 errorDetail 里', () => {
    expect(
      describeShuyanVideoError({
        status: 'failed',
        error: { code: 'ContentFilteredError', message: 'content rejected' },
      }),
    ).toBe('视频生成失败，请稍后重试。');
    expect(describeShuyanVideoError({ status: 'running' })).toBe(
      '数眼智能视频任务未完成（running）。',
    );
  });

  it('参考图里有真人被拒时点名是哪几张，并说清楚该怎么改', () => {
    const raw =
      'SHUYAN_VIDEO_HTTP_400:{"code":"fail_to_fetch_task","message":"{\\"error\\":{\\"code\\":\\"InputImageSensitiveContentDetected.PrivacyInformation\\",\\"message\\":\\"The request failed because the input image \'content[1]\' \'content[4]\' \'content[9]\' may contain real person.\\"}}"}';
    expect(describeRejectedShuyanImages(raw)).toBe('第 1、4、9 张参考图');
    const message = describeShuyanVideoFailure(raw);
    expect(message).toContain('第 1、4、9 张参考图里有真人');
    expect(message).toContain('AI 生成画面');
  });

  it('通道自己的错不套用 PixMax 文案', () => {
    expect(
      describeShuyanVideoFailure('SHUYAN_VIDEO_NETWORK_ERROR:fetch failed'),
    ).toBe('连接数眼智能失败，请检查网络后重试。');
    expect(describeShuyanVideoFailure('SHUYAN_VIDEO_HTTP_429:{}')).toBe(
      '请求数眼智能太频繁，请稍等片刻再试。',
    );
  });
});
