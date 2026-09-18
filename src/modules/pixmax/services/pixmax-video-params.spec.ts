import {
  buildPixmaxVideoParams,
  findPixmaxModel,
  listPixmaxDurationChoices,
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
