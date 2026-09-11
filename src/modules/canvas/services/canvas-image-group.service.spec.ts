import type { GalleryImageEntity } from '../../gallery/entities/gallery-image.entity';
import type { ImageGroupLayout } from '../entities/canvas.entity';

jest.mock('../../gallery/services/gallery.service', () => ({
  GalleryService: class {},
}));
jest.mock('../../gallery/services/gallery-group.service', () => ({
  GalleryGroupService: class {},
}));
jest.mock('../../ai-agent/services/agent.service', () => ({
  AgentService: class {},
}));
jest.mock('../../sass/services/sass.service', () => ({
  SassService: class {},
}));
jest.mock(
  '../../gallery/material-styles/services/material-style.service',
  () => ({
    MaterialStyleService: class {},
  }),
);

import { CanvasImageGroupService } from './canvas-image-group.service';

type PlanResult =
  | {
      ok: true;
      plans: Array<{
        layout: ImageGroupLayout;
        slots: Array<{
          kind: 'portrait' | 'collage';
          role: string;
          imgA?: GalleryImageEntity;
          imgB?: GalleryImageEntity;
        }>;
      }>;
    }
  | {
      ok: false;
      stats: { missingLandscape: number; missingPortrait: number };
    };

type ServiceInternals = {
  planImageGroupAllocation: (
    pool: GalleryImageEntity[],
    articles: Array<{ title: string; tags: string[] }>,
    options?: {
      layoutCandidates?: ImageGroupLayout[];
      allowSourceReuse?: boolean;
    },
  ) => PlanResult;
  fetchImagePool: (
    input: { userId: string; dedup?: boolean | 'prefer' },
    tags: string[],
    wantCount: number,
  ) => Promise<GalleryImageEntity[]>;
  isLocalImageReadable: (img: GalleryImageEntity) => boolean;
};

/**
 * @description 构造一张测试用图库图片。
 * @keyword-cn 测试图片, 图库实体
 * @keyword-en test-image, gallery-entity
 */
function makeImage(id: number, isPortrait: boolean): GalleryImageEntity {
  return { id, isPortrait, tags: ['测试'] } as unknown as GalleryImageEntity;
}

/**
 * @description 生成指定数量的竖图与横图混合图片池。
 * @keyword-cn 测试图片池, 竖横图配比
 * @keyword-en test-image-pool, orientation-mix
 */
function makePool(portrait: number, landscape: number): GalleryImageEntity[] {
  return [
    ...Array.from({ length: portrait }, (_v, i) => makeImage(i + 1, true)),
    ...Array.from({ length: landscape }, (_v, i) => makeImage(1000 + i, false)),
  ];
}

const DEFAULT_CHAIN: ImageGroupLayout[] = [
  'collage-cover-4collage-1portrait',
  'collage-cover-5collage',
  'portrait-cover-5inner',
  'collage-cover-5inner',
  'portrait-cover-5portrait',
];
const PORTRAIT_FIRST_CHAIN: ImageGroupLayout[] = [
  'portrait-cover-5portrait',
  'collage-cover-5inner',
  'portrait-cover-5inner',
  'collage-cover-4collage-1portrait',
  'collage-cover-5collage',
];

/**
 * @description 图组候选版式链与「优先不重复」取图顺序的回归测试：配图规则决定拼图/单图配比，
 *   图库不够时按链回退；优先不重复模式下未用图必须排在已用图前面先被分配。
 * @keyword-cn 候选版式测试, 优先不重复测试
 * @keyword-en layout-candidates-test, prefer-unused-test
 */
describe('CanvasImageGroupService', () => {
  const articles = [{ title: '测试文章', tags: ['测试'] }];
  let sampleRandom: jest.Mock;
  let service: ServiceInternals;

  beforeEach(() => {
    sampleRandom = jest.fn();
    const instance = new CanvasImageGroupService(
      { sampleRandom } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    service = instance as unknown as ServiceInternals;
    jest.spyOn(service, 'isLocalImageReadable').mockReturnValue(true);
  });

  it('默认规则按 5 拼图 + 1 竖图排版，单图排在最后一页', () => {
    const result = service.planImageGroupAllocation(makePool(6, 12), articles, {
      layoutCandidates: DEFAULT_CHAIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plans[0].layout).toBe('collage-cover-4collage-1portrait');
    expect(result.plans[0].slots.map((slot) => slot.kind)).toEqual([
      'collage',
      'collage',
      'collage',
      'collage',
      'collage',
      'portrait',
    ]);
  });

  it('竖图优先在竖图充足时全部使用竖图', () => {
    const result = service.planImageGroupAllocation(makePool(6, 12), articles, {
      layoutCandidates: PORTRAIT_FIRST_CHAIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.plans[0].slots.every((slot) => slot.kind === 'portrait'),
    ).toBe(true);
  });

  it('首选版式凑不齐时按链回退，而不是直接失败', () => {
    // 只有 2 张竖图：全竖图、2拼4竖、3拼3竖都不够，回退到 5 拼 1 竖
    const result = service.planImageGroupAllocation(makePool(2, 12), articles, {
      layoutCandidates: PORTRAIT_FIRST_CHAIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plans[0].layout).toBe('collage-cover-4collage-1portrait');
  });

  it('只给一个版式且横图不够时直接报横图缺口，不换版式', () => {
    const result = service.planImageGroupAllocation(makePool(6, 3), articles, {
      layoutCandidates: ['collage-cover-4collage-1portrait'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stats.missingLandscape).toBeGreaterThan(0);
  });

  it('允许复用时少量横图也能凑满拼图，且同一张拼图两格不同图', () => {
    const result = service.planImageGroupAllocation(makePool(1, 3), articles, {
      layoutCandidates: ['collage-cover-4collage-1portrait'],
      allowSourceReuse: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const collages = result.plans[0].slots.filter(
      (slot) => slot.kind === 'collage',
    );
    expect(collages).toHaveLength(5);
    for (const slot of collages) {
      expect(slot.imgA?.id).not.toBe(slot.imgB?.id);
    }
  });

  it('允许复用时横图少于 2 张仍然报不足', () => {
    const result = service.planImageGroupAllocation(makePool(6, 1), articles, {
      layoutCandidates: ['collage-cover-4collage-1portrait'],
      allowSourceReuse: true,
    });
    expect(result.ok).toBe(false);
  });

  it('候选版式全部凑不齐时报源图不足', () => {
    const result = service.planImageGroupAllocation(makePool(2, 3), articles, {
      layoutCandidates: DEFAULT_CHAIN,
    });
    expect(result.ok).toBe(false);
  });

  it('优先不重复模式下未用图排在前面，不够时用已用图补齐', async () => {
    const unused = [makeImage(1, true), makeImage(2, true)];
    const used = [makeImage(3, true), makeImage(4, true)];
    sampleRandom.mockImplementation(
      ({ includeUsed }: { includeUsed: boolean }) =>
        Promise.resolve(includeUsed ? [...used, ...unused] : [...unused]),
    );
    const pool = await service.fetchImagePool(
      { userId: 'u1', dedup: 'prefer' },
      ['测试'],
      10,
    );
    expect(pool).toHaveLength(4);
    expect(new Set(pool.slice(0, 2).map((img) => img.id))).toEqual(
      new Set([1, 2]),
    );
    expect(new Set(pool.slice(2).map((img) => img.id))).toEqual(
      new Set([3, 4]),
    );
  });

  it('优先不重复模式下未用图足够时不再取已用图', async () => {
    const unused = Array.from({ length: 5 }, (_v, i) => makeImage(i + 1, true));
    sampleRandom.mockResolvedValue(unused);
    const pool = await service.fetchImagePool(
      { userId: 'u1', dedup: 'prefer' },
      ['测试'],
      5,
    );
    expect(pool).toHaveLength(5);
    expect(sampleRandom).toHaveBeenCalledTimes(1);
    expect(sampleRandom).toHaveBeenCalledWith(
      expect.objectContaining({ includeUsed: false }),
    );
  });
});
