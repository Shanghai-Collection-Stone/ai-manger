import type { DouyinTopicEntity } from '../entities/douyin-workbench.entity.js';
import {
  buildDirectorBrief,
  describeDirectionEn,
  describeDirectionZh,
  directionFingerprint,
  freshShotDirection,
  keepCameraInFrame,
  listDirectorFrames,
  parseDirectorPlan,
} from './douyin-video-director.js';
import {
  buildEditClipBrief,
  parseEditPlan,
  snapCutPoint,
  type DouyinEditClipInput,
} from './douyin-video-edit.js';

/**
 * @description 造一条带两镜配图（第 3 镜没配图）的分镜脚本。
 * @keyword-cn 测试分镜脚本, 导演测试数据
 * @keyword-en test-storyboard-topic, director-fixture
 */
function storyboardTopic(): DouyinTopicEntity {
  return {
    id: 7,
    kind: 'child',
    title: '上海儿童生日派对',
    script: '带孩子来过生日',
    storyboard: [
      {
        id: 's1',
        duration: 4,
        shotType: '中景',
        visual: '孩子们围着蛋糕',
        narration: '生日快乐',
        transition: '',
        media: { type: 'image', id: 11, name: 'a', url: '/static/a.jpg' },
      },
      {
        id: 's2',
        duration: 5,
        shotType: '近景',
        visual: '气球墙',
        narration: '',
        transition: '叠化',
        media: { type: 'image', id: 12, name: 'b', url: '/static/b.jpg' },
      },
      {
        id: 's3',
        duration: 3,
        shotType: '全景',
        visual: '片尾',
        narration: '',
        transition: '',
        media: null,
      },
    ],
  } as unknown as DouyinTopicEntity;
}

describe('douyin video director helpers', () => {
  it('lists storyboard frames with images only and fingerprints them', () => {
    const topic = storyboardTopic();
    const frames = listDirectorFrames(topic);
    expect(frames.map((frame) => [frame.key, frame.sourceKey])).toEqual([
      ['s1', 'image:11'],
      ['s2', 'image:12'],
    ]);
    const same = directionFingerprint(listDirectorFrames(storyboardTopic()));
    expect(directionFingerprint(frames)).toBe(same);
    topic.storyboard[1].media = {
      type: 'image',
      id: 13,
      name: 'c',
      url: '/static/c.jpg',
    };
    expect(directionFingerprint(listDirectorFrames(topic))).not.toBe(same);
  });

  it('lists store-visit segments by scene image and skips video material', () => {
    const topic = {
      id: 8,
      kind: 'child',
      productionMode: 'store-visit',
      title: '探店',
      storyboard: [],
      storeVisit: {
        sceneImages: [
          {
            type: 'image',
            id: 21,
            name: '门头',
            url: '/static/door.jpg',
            description: '门头招牌',
          },
        ],
        segments: [
          {
            id: 'g1',
            lines: '今天我们来到了一家超好玩的店',
            sceneImageId: 21,
            shot: 'presenter',
            sceneImageIds: [21, 22],
          },
          { id: 'g2', lines: '看这个', sceneVideoId: 5 },
        ],
      },
    } as unknown as DouyinTopicEntity;
    const frames = listDirectorFrames(topic);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      key: 'g1',
      sourceKey: 'presenter:21:21-22',
      kind: 'presenter',
      scene: '门头招牌',
    });
    expect(frames[0].seconds).toBe(4);
  });

  it('labels each frame in the brief', () => {
    const brief = buildDirectorBrief({
      mode: 'storyboard',
      title: '派对',
      frames: listDirectorFrames(storyboardTopic()),
    });
    expect(brief).toContain('第 2 张 = 第 2 段（分镜，约 5 秒）｜画面：气球墙');
    expect(
      buildDirectorBrief({ mode: 'storyboard', title: '派对', frames: [] }),
    ).toContain('没有附图');
  });

  it('parses the plan, drops English fields that contain Chinese and ignores unknown numbers', () => {
    const frames = listDirectorFrames(storyboardTopic());
    const plan = parseDirectorPlan(
      JSON.stringify({
        note: '门店引流，套模板',
        template: {
          useTemplate: true,
          aspectRatio: '4:3',
          title: '儿童派对',
          sellingPoints: ['闯关'],
        },
        shots: [
          {
            no: 1,
            camera: 'slow push-in toward the cake',
            motion: 'candles flicker',
            cameraZh: '缓慢推近蛋糕',
            motionZh: '烛火摇曳',
          },
          {
            no: 2,
            camera: '缓慢平移',
            motion: 'balloons sway',
            cameraZh: '缓慢平移',
            motionZh: '气球晃动',
          },
          { no: 9, camera: 'nothing' },
        ],
      }),
      frames,
    );
    expect(plan.template).toMatchObject({
      useTemplate: true,
      aspectRatio: '4:3',
      title: '儿童派对',
    });
    expect(plan.shots.s1).toEqual({
      sourceKey: 'image:11',
      camera: 'slow push-in toward the cake',
      motion: 'candles flicker',
      cameraZh: '缓慢推近蛋糕',
      motionZh: '烛火摇曳',
    });
    expect(plan.shots.s2.camera).toBe('');
    expect(Object.keys(plan.shots)).toEqual(['s1', 's2']);
    expect(plan.note).toBe('门店引流，套模板');
    expect(parseDirectorPlan('not json', frames).template.useTemplate).toBe(
      false,
    );
  });

  it('keeps store-visit camera moves inside the photo', () => {
    const direction = (camera: string, cameraZh: string) => ({
      sourceKey: 'k',
      camera,
      motion: 'steam drifts up',
      cameraZh,
      motionZh: '热气飘动',
    });
    expect(
      keepCameraInFrame(
        direction('slow push-in toward the cake', '缓慢推近蛋糕'),
        'broll',
      ),
    ).toMatchObject({ camera: 'slow push-in toward the cake' });
    expect(
      keepCameraInFrame(
        direction('static camera', '固定机位带轻微手持感'),
        'presenter',
      ).cameraZh,
    ).toBe('固定机位带轻微手持感');
    for (const [camera, cameraZh] of [
      ['slow pan to the right', '缓慢向右平移'],
      ['gentle tilt up to the sign', '轻微上摇到招牌'],
      ['slow pull back to reveal the hall', '缓慢拉远'],
      ['slow push-in, then pan left', '缓慢推近后左移'],
      ['camera tracks along the counter', '推近'],
    ])
      expect(keepCameraInFrame(direction(camera, cameraZh), 'broll')).toEqual({
        sourceKey: 'k',
        camera: 'slow push-in toward the main subject',
        motion: 'steam drifts up',
        cameraZh: '缓慢推近主体',
        motionZh: '热气飘动',
      });
    expect(
      keepCameraInFrame(direction('', '缓慢左右平移'), 'presenter'),
    ).toMatchObject({ camera: 'static camera', cameraZh: '固定机位' });
  });

  it('clamps store-visit plans and stored directions, but not storyboard ones', () => {
    const topic = {
      id: 8,
      kind: 'child',
      productionMode: 'store-visit',
      title: '探店',
      storyboard: [],
      storeVisit: {
        sceneImages: [
          { type: 'image', id: 21, name: '吧台', url: '/static/bar.jpg' },
        ],
        segments: [{ id: 'g1', lines: '看这个吧台', sceneImageId: 21 }],
      },
    } as unknown as DouyinTopicEntity;
    const frames = listDirectorFrames(topic);
    const plan = parseDirectorPlan(
      JSON.stringify({
        shots: [
          {
            no: 1,
            camera: 'slow pan right across the bar',
            motion: 'lights flicker',
            cameraZh: '缓慢向右平移',
            motionZh: '灯光闪烁',
          },
        ],
      }),
      frames,
    );
    expect(plan.shots.g1).toMatchObject({
      camera: 'slow push-in toward the main subject',
      cameraZh: '缓慢推近主体',
      motion: 'lights flicker',
    });
    topic.videoDirection = {
      status: 'ready',
      fingerprint: 'x',
      shots: {
        g1: {
          sourceKey: frames[0].sourceKey,
          camera: 'gentle tilt up',
          motion: 'lights flicker',
          cameraZh: '轻微上摇',
          motionZh: '灯光闪烁',
        },
      },
      updatedAt: new Date(),
    };
    expect(describeDirectionZh(freshShotDirection(topic, 'g1'))).toBe(
      '运镜：缓慢推近主体；画面动态：灯光闪烁',
    );
    const storyboard = parseDirectorPlan(
      JSON.stringify({
        shots: [{ no: 2, camera: 'slow pan left', cameraZh: '缓慢左移' }],
      }),
      listDirectorFrames(storyboardTopic()),
    );
    expect(storyboard.shots.s2.camera).toBe('slow pan left');
  });

  it('从脚本开始的脚本不把运镜收进原图', () => {
    const topic = {
      id: 9,
      kind: 'child',
      productionMode: 'store-visit',
      title: '生日会',
      storyboard: [],
      storeVisit: {
        start: 'script',
        sceneImages: [
          { type: 'image', id: 31, name: 'ai', url: '/static/ai.jpg' },
        ],
        segments: [{ id: 'g1', lines: '开场', sceneImageId: 31 }],
      },
    } as unknown as DouyinTopicEntity;
    const frames = listDirectorFrames(topic);
    const raw = JSON.stringify({
      shots: [{ no: 1, camera: 'slow pan right', cameraZh: '缓慢右移' }],
    });
    expect(parseDirectorPlan(raw, frames, false).shots.g1.camera).toBe(
      'slow pan right',
    );
    expect(parseDirectorPlan(raw, frames).shots.g1.camera).toBe(
      'slow push-in toward the main subject',
    );
    topic.videoDirection = {
      status: 'ready',
      fingerprint: 'x',
      shots: {
        g1: {
          sourceKey: frames[0].sourceKey,
          camera: 'slow pan right',
          motion: '',
          cameraZh: '缓慢右移',
          motionZh: '',
        },
      },
      updatedAt: new Date(),
    };
    expect(freshShotDirection(topic, 'g1')?.camera).toBe('slow pan right');
    expect(
      buildDirectorBrief({ mode: 'storyboard', title: '生日会', frames }),
    ).toContain('（空镜，');
  });

  it('only uses a direction designed for the current frame', () => {
    const topic = storyboardTopic();
    topic.videoDirection = {
      status: 'ready',
      fingerprint: 'x',
      shots: {
        s1: {
          sourceKey: 'image:11',
          camera: 'slow push-in.',
          motion: 'candles flicker',
          cameraZh: '推近',
          motionZh: '烛火',
        },
      },
      updatedAt: new Date(),
    };
    const direction = freshShotDirection(topic, 's1');
    expect(describeDirectionEn(direction)).toBe(
      'slow push-in; candles flicker',
    );
    expect(describeDirectionZh(direction)).toBe('运镜：推近；画面动态：烛火');
    topic.storyboard[0].media = {
      type: 'image',
      id: 99,
      name: 'z',
      url: '/static/z.jpg',
    };
    expect(freshShotDirection(topic, 's1')).toBeUndefined();
    expect(describeDirectionEn(undefined)).toBe('');
  });
});

describe('douyin video edit helpers', () => {
  const clip = (input: Partial<DouyinEditClipInput>): DouyinEditClipInput => ({
    shotId: 'c',
    duration: 6,
    hasAudio: true,
    speech: [],
    frames: [],
    ...input,
  });

  it('keeps cut points out of speech', () => {
    const speech = [
      { start: 0.1, end: 0.5 },
      { start: 1, end: 4 },
      { start: 4.6, end: 5.2 },
    ];
    expect(snapCutPoint(2, speech, 'start')).toBe(0.9);
    expect(snapCutPoint(0.75, speech, 'start')).toBe(0.75);
    expect(snapCutPoint(4.3, speech, 'end')).toBe(4.3);
    expect(snapCutPoint(4.1, speech, 'end')).toBe(4.3);
    expect(snapCutPoint(4.8, speech, 'end')).toBe(5.5);
  });

  it('clamps trims, transitions, subtitle and cover', () => {
    const clips = [
      clip({
        shotId: 'a',
        speech: [
          { start: 0.1, end: 0.4 },
          { start: 0.9, end: 4 },
          { start: 4.5, end: 5.4 },
        ],
      }),
      clip({ shotId: 'b', duration: 2, hasAudio: false }),
      clip({ shotId: 'c', duration: 4 }),
    ];
    const plan = parseEditPlan(
      JSON.stringify({
        note: '去掉开头语气词和结尾多出的半句',
        clips: [
          { no: 1, trimStart: 0.7, trimEnd: 4.3 },
          { no: 2, trimStart: 1.5, trimEnd: 1.6 },
        ],
        transitions: [
          { after: 1, type: 'fade', duration: 0.6 },
          { after: 2, type: 'spin', duration: 0.5 },
        ],
        subtitle: { position: 'top', size: 'huge' },
        cover: { clip: 3, time: 2 },
      }),
      clips,
    );
    expect(plan.clips[0]).toEqual({
      shotId: 'a',
      trimStart: 0.7,
      trimEnd: 4.3,
    });
    // 第 2 段剪完不到 1 秒，按不剪处理；第 3 段模型没给，按不剪处理
    expect(plan.clips[1]).toEqual({ shotId: 'b', trimStart: 0, trimEnd: 2 });
    expect(plan.clips[2]).toEqual({ shotId: 'c', trimStart: 0, trimEnd: 4 });
    expect(plan.transitions).toEqual([
      { type: 'fade', duration: 0.6 },
      { type: 'cut', duration: 0 },
    ]);
    expect(plan.subtitle).toEqual({ position: 'top', size: 'medium' });
    expect(plan.cover).toEqual({ clipIndex: 2, time: 2 });
    expect(plan.note).toBe('去掉开头语气词和结尾多出的半句');
  });

  it('limits how much a clip can lose and how long a blend can be', () => {
    const plan = parseEditPlan(
      JSON.stringify({
        clips: [{ no: 1, trimStart: 3, trimEnd: 1.5 }, { no: 2 }],
        transitions: [{ after: 1, type: 'fadewhite', duration: 0.6 }],
      }),
      [
        clip({ shotId: 'a', duration: 5, hasAudio: false }),
        clip({ shotId: 'b', duration: 1.2, hasAudio: false }),
      ],
    );
    expect(plan.clips[0]).toEqual({ shotId: 'a', trimStart: 2, trimEnd: 3 });
    expect(plan.transitions[0]).toEqual({ type: 'fadewhite', duration: 0.3 });
    expect(parseEditPlan('oops', [clip({ shotId: 'a' })])).toMatchObject({
      clips: [{ shotId: 'a', trimStart: 0, trimEnd: 6 }],
      transitions: [],
      subtitle: { position: 'bottom', size: 'medium' },
      cover: { clipIndex: 0, time: 0.5 },
    });
  });

  it('describes a clip with speech, lines and continuity', () => {
    const brief = buildEditClipBrief(
      clip({
        speech: [{ start: 0.2, end: 3.1 }],
        frames: [
          { time: 0.1, image: 'x' },
          { time: 3, image: 'y' },
        ],
      }),
      {
        lines: '今天我们来到了街角咖啡店',
        continued: true,
        transitionHint: '',
      },
      1,
    );
    expect(brief).toContain('第 2 段：时长 6.00 秒；人声区间 0.20-3.10');
    expect(brief).toContain('台词（12 字，正常语速约 2.7 秒）');
    expect(brief).toContain('接着上一段的尾帧拍');
    expect(brief).toContain('0.1s、3.0s 的抽帧');
  });
});
