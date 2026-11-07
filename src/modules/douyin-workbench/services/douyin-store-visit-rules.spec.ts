import type { DouyinStoreVisitSegment } from '../entities/douyin-workbench.entity.js';
import type { DouyinStoreVisitSpot } from '../entities/douyin-store-visit-store.entity.js';
import {
  applyStoreVisitSceneMatches,
  applyStoreVisitTemplate,
  createStoreVisitSegmentId,
  packStoreVisitClassifyBatches,
  rankStoreVisitSpotImages,
  spotsToStoreVisitMaterials,
  storeVisitKeyframeOf,
  storeVisitSceneStarts,
  toStoreVisitSegmentsPayload,
  toStoreVisitSpotsPayload,
  usedStoreVisitSpotIds,
  withoutStoreVisitScene,
} from './douyin-store-visit-rules.js';

/**
 * @description 构造一个点位：图片按给定打分排列，带图片地址与描述。
 * @keyword-cn 测试点位, 点位构造
 * @keyword-en test-spot, build-spot
 * @param {string} id 点位 ID。
 * @param {number[]} scores 各图打分（图片 ID 为点位序号 * 10 + 下标）。
 * @param {Partial<DouyinStoreVisitSpot>} [extra] 其他字段。
 * @returns {DouyinStoreVisitSpot} 点位。
 */
function spot(
  id: string,
  scores: number[],
  extra: Partial<DouyinStoreVisitSpot> = {},
): DouyinStoreVisitSpot {
  const base = Number(id.replace(/\D/g, '')) * 10;
  return {
    id,
    name: `点位${id}`,
    description: `说明${id}`,
    images: scores.map((score, index) => ({
      imageId: base + index,
      url: `/img/${base + index}.jpg`,
      thumbUrl: `/thumb/${base + index}.jpg`,
      description: `图${base + index}`,
      score,
    })),
    videos: [],
    updatedAt: new Date(0),
    ...extra,
  };
}

describe('探店规则（与桌面端同规则）', () => {
  it('分段 ID 与桌面端同格式', () => {
    expect(createStoreVisitSegmentId()).toMatch(
      /^seg-[a-z0-9]+-[a-z0-9]{1,5}$/,
    );
  });

  it('开头有人出镜：第 1 段改成人物镜头并补画面来源，其余回到实景，原人物或体验段去掉来源、有照片时用照片来源', () => {
    const segments: DouyinStoreVisitSegment[] = [
      { id: 'a', lines: '开场', shot: 'broll' },
      {
        id: 'b',
        lines: '体验',
        shot: 'experience',
        visualSource: 'references',
        sceneImageId: 5,
      },
      {
        id: 'c',
        lines: '旧人物',
        shot: 'presenter',
        visualSource: 'generated',
      },
    ];
    expect(applyStoreVisitTemplate(segments, 'opening', 'references')).toEqual([
      { id: 'a', lines: '开场', shot: 'presenter', visualSource: 'references' },
      {
        id: 'b',
        lines: '体验',
        shot: 'broll',
        sceneImageId: 5,
        visualSource: 'original',
      },
      { id: 'c', lines: '旧人物', shot: 'broll' },
    ]);
    expect(
      applyStoreVisitTemplate(
        [
          {
            id: 'a',
            lines: '开场',
            shot: 'presenter',
            visualSource: 'generated',
          },
        ],
        'opening',
        'references',
      )[0].visualSource,
    ).toBe('generated');
    expect(applyStoreVisitTemplate(segments, 'unknown')).toBe(segments);
  });

  it('分段保存参数去掉出片结果、去空白、丢空台词，实拍视频与照片二选一，多图最多 3 张', () => {
    const payload = toStoreVisitSegmentsPayload([
      {
        id: 'a',
        lines: '  介绍门头 ',
        scene: ' 门头 ',
        sceneImageId: 1,
        sceneImageIds: [1, 2, 3, 4],
        spotId: 's1',
        action: ' ',
        shot: 'broll',
        visualSource: 'original',
        videoId: 9,
        nativeAudio: true,
      },
      {
        id: 'b',
        lines: '实拍',
        sceneVideoId: 7,
        clipStart: 2,
        sceneImageId: 3,
        motion: 'push-in' as never,
      },
      { id: 'c', lines: '   ' },
    ]);
    expect(payload).toEqual([
      {
        id: 'a',
        lines: '介绍门头',
        scene: '门头',
        sceneImageId: 1,
        sceneImageIds: [1, 2, 3],
        spotId: 's1',
        visualSource: 'original',
      },
      { id: 'b', lines: '实拍', sceneVideoId: 7, clipStart: 2 },
    ]);
  });

  it('清场景只去掉点位与素材，台词和镜头保留', () => {
    expect(
      withoutStoreVisitScene({
        id: 'a',
        lines: 'x',
        shot: 'presenter',
        spotId: 's',
        sceneImageId: 1,
        sceneImageIds: [1, 2],
        sceneVideoId: 3,
        clipStart: 1,
      }),
    ).toEqual({ id: 'a', lines: 'x', shot: 'presenter' });
  });

  it('点位素材按打分取前 4 张、视频点位带第一段视频、开场点位取最高分图；分段所用点位按出现顺序去重', () => {
    const store = {
      spots: [
        spot('s1', [5, 9, 7, 3, 8], { opening: true }),
        spot('s2', [], {
          videos: [
            {
              videoId: 70,
              url: '/v.mp4',
              name: '实拍',
              description: '',
              durationSeconds: 6,
            },
          ],
        }),
      ],
    };
    expect(
      rankStoreVisitSpotImages(store.spots[0]).map((image) => image.imageId),
    ).toEqual([11, 14, 12, 10, 13]);
    const ids = usedStoreVisitSpotIds(
      [
        { id: 'a', lines: '', spotId: 's2' },
        { id: 'b', lines: '', spotId: 's1' },
        { id: 'c', lines: '', spotId: 's2' },
        { id: 'd', lines: '', spotId: 'gone' },
      ],
      store,
    );
    expect(ids).toEqual(['s2', 's1']);
    const materials = spotsToStoreVisitMaterials(store, ids);
    expect(materials.sceneImages.map((image) => image.id)).toEqual([
      11, 14, 12, 10,
    ]);
    expect(materials.sceneImages[0]).toEqual({
      type: 'image',
      id: 11,
      name: '点位s1 · 图1',
      url: '/img/11.jpg',
      coverUrl: '/thumb/11.jpg',
      description: '点位s1：图11',
      tags: ['点位s1'],
    });
    expect(materials.sceneVideos).toEqual([
      {
        type: 'video',
        id: 70,
        name: '实拍',
        url: '/v.mp4',
        description: '点位s2：说明s2',
        tags: ['点位s2'],
        durationSeconds: 6,
      },
    ]);
    expect(materials.openingScene).toEqual({ type: 'image', id: 11 });
  });

  it('只给 AI 合成人物的新镜头准备首帧，同场景同用途只准备一次，已保存的首帧可复用', () => {
    const segments: DouyinStoreVisitSegment[] = [
      { id: 'a', lines: '1', shot: 'presenter', sceneImageId: 1 },
      { id: 'b', lines: '2', shot: 'presenter', sceneImageId: 1 },
      { id: 'c', lines: '3', shot: 'broll', sceneImageId: 2 },
      { id: 'd', lines: '4', shot: 'presenter', sceneImageId: 1 },
    ];
    expect(
      storeVisitSceneStarts(segments).map((segment) => segment.id),
    ).toEqual(['a']);
    const keyframe = {
      type: 'image' as const,
      id: 91,
      name: '首帧',
      url: '/k.jpg',
    };
    expect(
      storeVisitKeyframeOf(segments[0], [{ ...segments[1], keyframe }]),
    ).toBe(keyframe);
    expect(
      storeVisitKeyframeOf(segments[2], [{ ...segments[2], keyframe }]),
    ).toBeNull();
  });

  it('配场景结果先清旧场景再写点位与素材，没配上的段不变', () => {
    const segments: DouyinStoreVisitSegment[] = [
      { id: 'a', lines: '1', sceneVideoId: 9, spotId: 'old' },
      { id: 'b', lines: '2', sceneImageId: 4 },
      { id: 'c', lines: '3', sceneImageId: 5 },
    ];
    expect(
      applyStoreVisitSceneMatches(segments, [
        { id: 'a', spotId: 's1', sceneImageId: 11, sceneImageIds: [11, 12] },
        { id: 'b', spotId: 's2', sceneVideoId: 70 },
        { id: 'c', spotId: '' },
      ]),
    ).toEqual([
      {
        id: 'a',
        lines: '1',
        spotId: 's1',
        sceneImageId: 11,
        sceneImageIds: [11, 12],
      },
      { id: 'b', lines: '2', spotId: 's2', sceneVideoId: 70 },
      { id: 'c', lines: '3', sceneImageId: 5 },
    ]);
  });

  it('归类批次同组尽量同批，组太大拆开，每批不超过 8 张', () => {
    expect(
      packStoreVisitClassifyBatches([
        [1, 2, 3],
        [4],
        [5, 6, 7, 8, 9, 10, 11, 12, 13],
        [14],
      ]),
    ).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8, 9, 10, 11, 12],
      [13, 14],
    ]);
  });

  it('点位保存参数只带 ID、名称、说明、开场标记与图片视频引用，打分缺省 5', () => {
    expect(
      toStoreVisitSpotsPayload([
        {
          id: 's1',
          name: ' 门头 ',
          description: ' 店外 ',
          opening: true,
          images: [{ imageId: 3, description: '招牌' }],
          videos: [{ videoId: 7 }],
        },
        { name: '新点位', images: [] },
      ]),
    ).toEqual([
      {
        id: 's1',
        name: '门头',
        description: '店外',
        opening: true,
        images: [{ imageId: 3, description: '招牌', score: 5 }],
        videos: [{ videoId: 7, description: '' }],
      },
      { name: '新点位', description: '', images: [], videos: [] },
    ]);
  });
});
