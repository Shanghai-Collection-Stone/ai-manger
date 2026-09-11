jest.mock('../../gallery/services/gallery.service', () => ({
  GalleryService: class {},
}));

import type { DouyinStoryboardShot } from '../entities/douyin-workbench.entity';
import {
  autoAssignShotImages,
  buildImageCandidatePrompt,
  scoreImageForShot,
  type StoryboardImageCandidate,
} from './douyin-storyboard-image.service';

/**
 * @description 构造一张测试候选图。
 * @keyword-cn 测试候选图, 分镜配图
 * @keyword-en test-image-candidate, storyboard-image
 */
function candidate(
  id: number,
  tags: string[],
  description = '',
): StoryboardImageCandidate {
  return {
    id,
    name: `图${id}`,
    url: `/static/uploads/${id}.jpg`,
    coverUrl: `/static/uploads_thumbs/${id}.jpg`,
    tags,
    description,
    isPortrait: true,
  };
}

/**
 * @description 构造一段测试分镜。
 * @keyword-cn 测试分镜, 镜头文字
 * @keyword-en test-shot, shot-text
 */
function shot(visual: string, media: DouyinStoryboardShot['media'] = null) {
  return {
    id: visual,
    duration: 3,
    shotType: '中景',
    visual,
    narration: '',
    transition: '直接切换',
    media,
  } satisfies DouyinStoryboardShot;
}

/**
 * @description 分镜自动配图的回归测试：按镜头文字与标签/描述的重合度选图，已有素材不动，候选用完一轮前不重复。
 * @keyword-cn 自动配图测试, 镜头配图
 * @keyword-en auto-image-test, shot-image-match
 */
describe('douyin storyboard image matching', () => {
  it('标签命中的图得分更高', () => {
    const cake = candidate(1, ['蛋糕', '生日']);
    const street = candidate(2, ['街景']);
    const text = shot('主角举起生日蛋糕，朋友们欢呼');
    expect(scoreImageForShot(text, cake)).toBeGreaterThan(
      scoreImageForShot(text, street),
    );
  });

  it('按相关度给没有素材的镜头补图，并尽量不重复', () => {
    const shots = [
      shot('门店外景，招牌亮灯'),
      shot('生日蛋糕推出来，蜡烛点亮'),
      shot('大家在包厢里合影'),
    ];
    const candidates = [
      candidate(1, ['门店', '招牌']),
      candidate(2, ['蛋糕', '蜡烛']),
      candidate(3, ['包厢', '合影']),
    ];
    expect(autoAssignShotImages(shots, candidates)).toBe(3);
    expect(shots.map((item) => item.media?.id)).toEqual([1, 2, 3]);
    expect(shots[1].media).toMatchObject({
      type: 'image',
      url: '/static/uploads/2.jpg',
      coverUrl: '/static/uploads_thumbs/2.jpg',
    });
  });

  it('已有素材的镜头不被覆盖，且已用的图优先让给其他镜头', () => {
    const existing = {
      type: 'image' as const,
      id: 2,
      name: '图2',
      url: '/static/uploads/2.jpg',
    };
    const shots = [shot('蛋糕特写', existing), shot('又一个蛋糕特写')];
    const candidates = [candidate(2, ['蛋糕']), candidate(9, ['街景'])];
    autoAssignShotImages(shots, candidates);
    expect(shots[0].media?.id).toBe(2);
    expect(shots[1].media?.id).toBe(9);
  });

  it('没有候选图时不配图，提示词告诉模型不要传 image_id', () => {
    const shots = [shot('门店外景')];
    expect(autoAssignShotImages(shots, [])).toBe(0);
    expect(shots[0].media).toBeNull();
    expect(buildImageCandidatePrompt([])).toContain('不要传 image_id');
  });

  it('候选清单带编号、方向、标签与截断描述', () => {
    const prompt = buildImageCandidatePrompt([
      candidate(7, ['生日', '派对'], '一群人在包厢里围着蛋糕庆祝'),
    ]);
    expect(prompt).toContain(
      '#7｜竖图｜标签：生日、派对｜一群人在包厢里围着蛋糕庆祝',
    );
  });
});
