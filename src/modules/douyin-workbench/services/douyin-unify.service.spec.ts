import type { DouyinStoryboardShot } from '../entities/douyin-workbench.entity.js';
import { DouyinUnifyService } from './douyin-unify.service.js';
import {
  mergeShotsToLimit,
  storeVisitAsStoryboard,
  storyboardToStoreVisit,
} from './douyin-unify.js';

/**
 * @description 造一个分镜镜头，带可选配图。
 * @keyword-cn 测试分镜镜头, 旧分镜数据
 * @keyword-en test-storyboard-shot, legacy-shot-fixture
 */
function shot(
  id: string,
  narration: string,
  media?: { type: 'image' | 'video'; id: number },
): DouyinStoryboardShot {
  return {
    id,
    duration: 4,
    shotType: '中景',
    visual: `画面${id}`,
    narration,
    transition: '',
    media: media
      ? { ...media, name: `m${media.id}`, url: `/static/${media.id}.jpg` }
      : null,
  };
}

describe('旧分镜转统一流程', () => {
  it('有旁白的镜头变成分段，配图并进素材，台词算作按这版脚本拆好', () => {
    const setting = storyboardToStoreVisit({
      script: '  口播正文  ',
      storyboard: [
        shot('s1', '第一句', { type: 'image', id: 11 }),
        shot('s2', '', { type: 'image', id: 12 }),
        shot('s3', '第三句', { type: 'video', id: 31 }),
        shot('s4', '第四句', { type: 'image', id: 11 }),
      ],
    });
    expect(setting).toMatchObject({
      start: 'script',
      script: '口播正文',
      linesScript: '口播正文',
      template: 'voiceover',
    });
    expect(setting.segments).toEqual([
      {
        id: 's1',
        lines: '第一句',
        scene: '画面s1',
        shot: 'broll',
        sceneImageId: 11,
      },
      {
        id: 's3',
        lines: '第三句',
        scene: '画面s3',
        shot: 'broll',
        sceneVideoId: 31,
      },
      {
        id: 's4',
        lines: '第四句',
        scene: '画面s4',
        shot: 'broll',
        sceneImageId: 11,
      },
    ]);
    expect(setting.sceneImages?.map((image) => image.id)).toEqual([11]);
    expect(setting.sceneVideos?.map((video) => video.id)).toEqual([31]);
  });

  it('没有脚本正文时用台词拼，段 ID 不合法时换新', () => {
    const setting = storyboardToStoreVisit({
      storyboard: [shot('镜头 1', '你好'), shot('s2', '再见')],
    });
    expect(setting.script).toBe('你好\n再见');
    expect(setting.segments?.[0].id).toMatch(/^seg-/);
    expect(setting.segments?.[1].id).toBe('s2');
  });

  it('超过上限时合并旁白最短的相邻两镜，保留前一镜的配图', () => {
    const merged = mergeShotsToLimit(
      [
        shot('a', '长长长长'),
        shot('b', '短', { type: 'image', id: 2 }),
        shot('c', '短'),
        shot('d', '长长长长'),
      ],
      3,
    );
    expect(merged.map((item) => [item.id, item.narration])).toEqual([
      ['a', '长长长长'],
      ['b', '短短'],
      ['d', '长长长长'],
    ]);
    expect(merged[1].media?.id).toBe(2);
    const many = storyboardToStoreVisit({
      storyboard: Array.from({ length: 12 }, (_, index) =>
        shot(`s${index}`, `第${index}句`),
      ),
    });
    expect(many.segments).toHaveLength(8);
  });

  it('整条一次出：分段临时当成分镜，口播稿用台词拼，不是统一流程的原样返回', () => {
    const topic = {
      id: 5,
      kind: 'child',
      productionMode: 'store-visit',
      script: '旧口播',
      storyboard: [],
      storeVisit: {
        script: '编导方案',
        sceneImages: [{ type: 'image', id: 11, name: 'a', url: '/a.jpg' }],
        segments: [
          { id: 'g1', lines: '第一句', scene: '门头', sceneImageId: 11 },
          { id: 'g2', lines: '  ', scene: '空段' },
          { id: 'g3', lines: '第三句', action: '镜头推近吧台' },
        ],
      },
    } as never;
    const view = storeVisitAsStoryboard(topic);
    expect(view.script).toBe(['第一句', '第三句'].join('\n'));
    expect(view.storyboard).toMatchObject([
      { id: 'g1', narration: '第一句', visual: '门头', media: { id: 11 } },
      { id: 'g3', narration: '第三句', visual: '镜头推近吧台', media: null },
    ]);
    const legacy = { id: 6, storyboard: [shot('s1', '一句')] } as never;
    expect(storeVisitAsStoryboard(legacy)).toBe(legacy);
  });

  it('服务：已经是统一流程不动；旧分镜转一次并让导演重新规划', async () => {
    const unified = { id: 2, kind: 'child', productionMode: 'store-visit' };
    const legacy = {
      id: 3,
      kind: 'child',
      script: '正文',
      storyboard: [shot('s1', '一句', { type: 'image', id: 11 })],
    };
    const repository = {
      get: jest.fn(async (id: number) => (id === 2 ? unified : legacy)),
      convertToUnified: jest.fn(async () => ({
        ...legacy,
        productionMode: 'store-visit',
      })),
    };
    const director = { schedule: jest.fn().mockResolvedValue(undefined) };
    const service = new DouyinUnifyService(
      repository as never,
      director as never,
    );
    expect(await service.unify(2, { userId: 'u1' })).toMatchObject({
      converted: false,
    });
    expect(repository.convertToUnified).not.toHaveBeenCalled();
    expect(await service.unify(3, { userId: 'u1' })).toMatchObject({
      converted: true,
    });
    expect(repository.convertToUnified).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ start: 'script', script: '正文' }),
      { userId: 'u1' },
    );
    expect(director.schedule).toHaveBeenCalledWith(3, { userId: 'u1' });
  });
});
