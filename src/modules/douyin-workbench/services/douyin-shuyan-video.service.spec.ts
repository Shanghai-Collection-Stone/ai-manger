import {
  buildShuyanWanPayload,
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
  SHUYAN_WAN_PROMPT_MAX,
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

describe('数眼视频运行时（万相 wan2.7-i2v · 百炼协议）', () => {
  it('wan2.7-i2v 及其快照走万相路由，其他万相型号仍未接入', () => {
    expect(resolveShuyanVideoRoute('wan2.7-i2v')).toBe('wan');
    expect(resolveShuyanVideoRoute('wan2.7-i2v-2026-04-25')).toBe('wan');
    expect(resolveShuyanVideoRoute('wan2.6-i2v')).toBeNull();
    expect(resolveShuyanVideoRoute('wan2.7-t2v')).toBeNull();
  });

  it('按百炼异步协议拼创建与查询地址', () => {
    const gateway = 'https://platform.shuyanai.com';
    expect(resolveShuyanVideoTaskUrl(gateway, 'wan')).toBe(
      'https://platform.shuyanai.com/ali/api/v1/services/aigc/video-generation/video-synthesis',
    );
    expect(resolveShuyanVideoTaskUrl(gateway, 'wan', 'task-9')).toBe(
      'https://platform.shuyanai.com/ali/api/v1/tasks/task-9',
    );
  });

  it('把 output 里的任务 ID、状态、成片、错误与 usage 时长拆成平铺结构', () => {
    expect(
      unwrapShuyanVideoTask({
        request_id: 'r',
        output: { task_id: 't-1', task_status: 'PENDING' },
      }),
    ).toEqual({ id: 't-1', status: 'PENDING', content: { video_url: '' } });
    expect(
      unwrapShuyanVideoTask({
        output: {
          task_id: 't-1',
          task_status: 'SUCCEEDED',
          video_url: 'https://dashscope.example/v.mp4',
        },
        usage: { duration: 6 },
      }),
    ).toEqual({
      id: 't-1',
      status: 'SUCCEEDED',
      content: { video_url: 'https://dashscope.example/v.mp4' },
      duration: 6,
    });
    const failed = unwrapShuyanVideoTask({
      output: {
        task_id: 't-1',
        task_status: 'FAILED',
        code: 'DataInspectionFailed',
        message: 'bad',
      },
    });
    expect(failed.error).toEqual({
      code: 'DataInspectionFailed',
      message: 'bad',
    });
    expect(mapShuyanVideoStatus(failed.status)).toBe('failed');
    expect(mapShuyanVideoStatus('SUCCEEDED')).toBe('completed');
    expect(mapShuyanVideoStatus('CANCELED')).toBe('failed');
    expect(mapShuyanVideoStatus('UNKNOWN')).toBe('failed');
    expect(mapShuyanVideoStatus('PENDING')).toBe('queued');
  });

  it('首帧必传、配音作驱动音频，提示词按 5000 字截断，不改写提示词也不加水印', () => {
    const payload = buildShuyanWanPayload({
      model: 'wan2.7-i2v',
      prompt: '字'.repeat(6000),
      firstFrameUrl: 'https://cdn/k.jpg',
      audioUrl: 'https://oss/a.wav',
      duration: 10,
      resolution: '720P',
    }) as { input: { prompt: string; media: unknown[] }; parameters: unknown };
    expect(payload.input.prompt).toHaveLength(SHUYAN_WAN_PROMPT_MAX);
    expect(payload.input.media).toEqual([
      { type: 'first_frame', url: 'https://cdn/k.jpg' },
      { type: 'driving_audio', url: 'https://oss/a.wav' },
    ]);
    expect(payload.parameters).toEqual({
      resolution: '720P',
      duration: 10,
      prompt_extend: false,
      watermark: false,
    });
    const silent = buildShuyanWanPayload({
      model: 'wan2.7-i2v',
      prompt: 'p',
      firstFrameUrl: 'https://cdn/k.jpg',
      duration: 5,
      resolution: '720P',
    }) as { input: { media: unknown[] } };
    expect(silent.input.media).toHaveLength(1);
  });

  it('可选 2~15 秒、720P / 1080P，探店请求的 720p 对到 720P', () => {
    expect(listShuyanVideoDurationChoices('wan2.7-i2v')[0]).toBe(2);
    expect(listShuyanVideoDurationChoices('wan2.7-i2v').at(-1)).toBe(15);
    expect(listShuyanVideoResolutionChoices('wan2.7-i2v')).toEqual([
      '720P',
      '1080P',
    ]);
    expect(clampShuyanVideoResolution('wan2.7-i2v', '720p')).toBe('720P');
    expect(clampShuyanVideoResolution('wan2.7-i2v')).toBe('720P');
  });
});
