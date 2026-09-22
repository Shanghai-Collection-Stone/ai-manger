import {
  buildPixmaxVideoParams,
  findPixmaxModel,
  listPixmaxDurationChoices,
  listPixmaxResolutionChoices,
  pickPixmaxResolution,
  mapPixmaxTaskStatus,
  pickPixmaxDuration,
  pickPixmaxReferMode,
  requiresPixmaxCompliance,
} from './pixmax-video-params';

describe('pixmax video params', () => {
  it('时长取不小于目标的最短一档，超过上限取最长一档；滑块型夹到范围内', () => {
    const stops = {
      name: 'duration',
      type: 'string',
      defaultValue: '5',
      options: ['5', '10'],
    };
    expect(pickPixmaxDuration(stops, 3)).toBe(5);
    expect(pickPixmaxDuration(stops, 6)).toBe(10);
    expect(pickPixmaxDuration(stops, 40)).toBe(10);
    const range = {
      name: 'duration',
      type: 'string',
      defaultValue: '5',
      min: 4,
      max: 30,
      step: 1,
    };
    expect(pickPixmaxDuration(range, 2.2)).toBe(4);
    expect(pickPixmaxDuration(range, 18.4)).toBe(19);
    expect(pickPixmaxDuration(range, 60)).toBe(30);
  });

  it('清晰度档位按从低到高排序，增强档紧跟同名原档，模型不存在时不给选', () => {
    expect(listPixmaxResolutionChoices('SEEDANCE_2_0')).toEqual([
      '480P',
      '720P',
      'SUPER_720P',
      '1080P',
      'SUPER_1080P',
      '4K',
      'SUPER_4K',
    ]);
    expect(listPixmaxResolutionChoices('PIXVERSE_V6')).toEqual([
      '360P',
      '540P',
      '720P',
      '1080P',
    ]);
    expect(listPixmaxResolutionChoices('这个模型不存在')).toEqual([]);
  });

  it('清晰度对不上模型档位时就近取，没指定时用模型默认档', () => {
    const spec = {
      name: 'resolution',
      type: 'string',
      defaultValue: '720P',
      options: ['480P', '720P', 'SUPER_720P', 'SUPER_1080P', 'SUPER_4K'],
    };
    expect(pickPixmaxResolution(spec, '480p')).toBe('480P');
    expect(pickPixmaxResolution(spec, '1080P')).toBe('SUPER_1080P');
    expect(pickPixmaxResolution(spec, '')).toBe('720P');
    const narrow = {
      name: 'resolution',
      type: 'string',
      defaultValue: '720P',
      options: ['720P', '1080P'],
    };
    expect(pickPixmaxResolution(narrow, '4K')).toBe('1080P');
    expect(pickPixmaxResolution(narrow, '360P')).toBe('720P');
  });

  it('组装参数时按设定的清晰度取档，对不上标记 resolutionClamped', () => {
    const exact = buildPixmaxVideoParams({
      modelCode: 'PIXVERSE_V6',
      prompt: '',
      targetSeconds: 5,
      mode: 'full',
      availableImages: 1,
      targetResolution: '1080P',
    });
    expect(exact.params.resolution).toBe('1080P');
    expect(exact.resolution).toBe('1080P');
    expect(exact.resolutionClamped).toBe(false);
    const clamped = buildPixmaxVideoParams({
      modelCode: 'PIXVERSE_V6',
      prompt: '',
      targetSeconds: 5,
      mode: 'full',
      availableImages: 1,
      targetResolution: '4K',
    });
    expect(clamped.params.resolution).toBe('1080P');
    expect(clamped.resolutionClamped).toBe(true);
    const auto = buildPixmaxVideoParams({
      modelCode: 'PIXVERSE_V6',
      prompt: '',
      targetSeconds: 5,
      mode: 'full',
      availableImages: 1,
    });
    expect(auto.params.resolution).toBe('720P');
    expect(auto.resolutionClamped).toBe(false);
  });

  it('分镜模式有图走图生视频，整片模式多图参考并受模型上限约束', () => {
    const seedance = findPixmaxModel('SEEDANCE_2_0')!;
    expect(pickPixmaxReferMode(seedance, 'shot', 1)).toEqual({
      referModel: 'imageToVideo',
      imageCount: 1,
    });
    expect(pickPixmaxReferMode(seedance, 'shot', 0)).toEqual({
      referModel: 'textToVideo',
      imageCount: 0,
    });
    expect(pickPixmaxReferMode(seedance, 'full', 20)).toEqual({
      referModel: 'referToVideo',
      imageCount: 9,
    });
    const hailuo = findPixmaxModel('HAILUO_23')!;
    expect(pickPixmaxReferMode(hailuo, 'full', 3)).toEqual({
      referModel: 'imageToVideo',
      imageCount: 1,
    });
    expect(pickPixmaxReferMode(hailuo, 'full', 0)).toEqual({
      referModel: 'textToVideo',
      imageCount: 0,
    });
  });

  it('整片模式在模型不支持多图参考时用首尾帧带上分镜画面', () => {
    const minimax = findPixmaxModel('MINIMAX_H3_MAX')!;
    expect(pickPixmaxReferMode(minimax, 'full', 9)).toEqual({
      referModel: 'firstAndLastFrame',
      imageCount: 2,
    });
    expect(pickPixmaxReferMode(minimax, 'full', 1)).toEqual({
      referModel: 'imageToVideo',
      imageCount: 1,
    });
  });

  it('只支持参考视频的模式不会拿图片凑数', () => {
    const kling = findPixmaxModel('KLING_V3_OMNI')!;
    const choice = pickPixmaxReferMode(kling, 'full', 4);
    expect(choice.referModel).toBe('imageRefer');
    expect(choice.imageCount).toBeGreaterThan(0);
  });

  it('Seedance 2.5 图生视频按要求把宽高比置为 adaptive，整片时长超过上限时标记压缩', () => {
    const shot = buildPixmaxVideoParams({
      modelCode: 'SEEDANCE_2_5',
      prompt: 'p',
      targetSeconds: 3,
      mode: 'shot',
      availableImages: 1,
    });
    expect(shot.params).toMatchObject({
      model: 'SEEDANCE_2_5',
      nodeType: 'GENERATE_VIDEO',
      referModel: 'imageToVideo',
      aspectRatio: 'adaptive',
      duration: '4',
      count: 1,
      resolution: '720P',
      includeAudio: true,
    });
    const full = buildPixmaxVideoParams({
      modelCode: 'SEEDANCE_2_5',
      prompt: 'p',
      targetSeconds: 45,
      mode: 'full',
      availableImages: 6,
    });
    expect(full.params).toMatchObject({
      referModel: 'referToVideo',
      aspectRatio: '9:16',
      duration: '30',
    });
    expect(full.imageCount).toBe(6);
    expect(full.durationClamped).toBe(true);
  });

  it('声音设置写入模型的 includeAudio 参数，没有该参数的模型不写', () => {
    const muted = buildPixmaxVideoParams({
      modelCode: 'SEEDANCE_2_0',
      prompt: 'p',
      targetSeconds: 5,
      mode: 'full',
      availableImages: 0,
      audioEnabled: false,
    });
    expect(muted.params.includeAudio).toBe(false);
    expect(muted.audioSwitchApplied).toBe(true);
    const minimax = buildPixmaxVideoParams({
      modelCode: 'MINIMAX_H3_MAX',
      prompt: 'p',
      targetSeconds: 5,
      mode: 'full',
      availableImages: 0,
      audioEnabled: false,
    });
    expect('includeAudio' in minimax.params).toBe(false);
    expect(minimax.audioSwitchApplied).toBe(false);
  });

  it('非生成类模型拒绝；目录里没有的模型按通用参数兜底', () => {
    expect(() =>
      buildPixmaxVideoParams({
        modelCode: 'VIDEO_UPSCALE',
        prompt: 'p',
        targetSeconds: 5,
        mode: 'full',
        availableImages: 0,
      }),
    ).toThrow('PIXMAX_MODEL_NOT_VIDEO_GENERATION');
    const unknown = buildPixmaxVideoParams({
      modelCode: 'PIXDANCE_2',
      prompt: 'p',
      targetSeconds: 22,
      mode: 'full',
      availableImages: 2,
    });
    expect(unknown.params).toMatchObject({
      referModel: 'referToVideo',
      duration: '15',
      aspectRatio: '9:16',
    });
    expect(unknown.durationClamped).toBe(true);
  });

  it('状态映射与火山系合规判断', () => {
    expect(mapPixmaxTaskStatus('QUEUE')).toBe('queued');
    expect(mapPixmaxTaskStatus('RUNNING')).toBe('running');
    expect(mapPixmaxTaskStatus('COMPLETE')).toBe('completed');
    expect(mapPixmaxTaskStatus('RESOURCE_INSUFFICIENT')).toBe('failed');
    expect(requiresPixmaxCompliance('SEEDANCE_2_0')).toBe(true);
    expect(requiresPixmaxCompliance('KLING_V3')).toBe(false);
  });
  it('列出模型可生成的时长：枚举型、滑块型、未知模型兜底、非生视频模型为空', () => {
    expect(listPixmaxDurationChoices('KLING_O1')).toEqual([5, 10]);
    const seedance25 = listPixmaxDurationChoices('SEEDANCE_2_5');
    expect(seedance25[0]).toBe(4);
    expect(seedance25[seedance25.length - 1]).toBe(30);
    expect(seedance25).toHaveLength(27);
    expect(listPixmaxDurationChoices('VIDU_Q2_PRO')).not.toContain(0);
    expect(listPixmaxDurationChoices('PIXDANCE_2')).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(listPixmaxDurationChoices('VIDEO_UPSCALE')).toEqual([]);
  });
});
