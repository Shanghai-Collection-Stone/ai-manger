import sharp from 'sharp';
import {
  buildStoreVisitSpotClassificationBrief,
  clampStoreVisitSpotScore,
  clusterStoreVisitSignatures,
  computeStoreVisitImageSignature,
  createStoreVisitClassifySession,
  DouyinStoreVisitSpotService,
  normalizeStoreVisitSpotName,
  storeVisitSignatureDistance,
} from './douyin-store-visit-spot.service.js';
import type { DouyinStoreVisitClassifyEvent } from '../entities/douyin-store-visit-store.entity.js';

/**
 * @description 生成一张纯色加对角渐变的测试图，`shift` 改变渐变方向，`color` 改变色调。
 * @keyword-cn 测试图片生成, 渐变图
 * @keyword-en test-image-factory, gradient-image
 */
async function makeImage(color: [number, number, number], shift = false) {
  const width = 64;
  const height = 48;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const t = shift ? (width - x) / width : x / width;
      const offset = (y * width + x) * 3;
      raw[offset] = Math.round(color[0] * t);
      raw[offset + 1] = Math.round(color[1] * t);
      raw[offset + 2] = Math.round(color[2] * t);
    }
  return await sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe('store visit spot similarity', () => {
  it('同一张图（缩放后）距离接近 0，方向与色调都不同的图距离大', async () => {
    const base = await makeImage([240, 120, 40]);
    const resized = await sharp(base).resize(128, 96).jpeg().toBuffer();
    const other = await makeImage([30, 90, 220], true);
    const a = await computeStoreVisitImageSignature(base);
    const b = await computeStoreVisitImageSignature(resized);
    const c = await computeStoreVisitImageSignature(other);
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.colors).toHaveLength(48);
    expect(storeVisitSignatureDistance(a, b)).toBeLessThan(0.1);
    expect(storeVisitSignatureDistance(a, c)).toBeGreaterThan(0.4);
  });

  it('单链接聚类把相似图并到一组，大组在前，单张也成组', () => {
    const near = { hash: '0f0f0f0f0f0f0f0f', colors: Array(48).fill(100) };
    const nearer = { hash: '0f0f0f0f0f0f0f0e', colors: Array(48).fill(104) };
    const far = { hash: 'f0f0f0f0f0f0f0f0', colors: Array(48).fill(10) };
    expect(
      clusterStoreVisitSignatures([
        { id: 3, signature: far },
        { id: 1, signature: near },
        { id: 2, signature: nearer },
      ]),
    ).toEqual([[1, 2], [3]]);
  });
});

describe('store visit spot classification', () => {
  it('归入已有点位或按名称新建点位（中文名也行），同名只建一次，逐条推事件并把剩下的图片告诉模型', () => {
    const events: DouyinStoreVisitClassifyEvent[] = [];
    const session = createStoreVisitClassifySession(
      {
        imageIds: [901, 902, 903],
        spots: [{ key: 'abc123', name: '门头招牌' }],
      },
      (event) => events.push(event),
    );
    const first = JSON.parse(
      session.assign({
        image_id: 902,
        spot_key: 'abc123',
        description: '红色霓虹门头',
        score: 12,
      }),
    );
    const second = JSON.parse(
      session.assign({
        image_id: 901,
        new_spot: { name: '「西部斗场」', description: '枪战主题区' },
        description: '射击大屏',
        score: 8.4,
      }),
    );
    session.assign({
      image_id: 903,
      new_spot: { name: '西部斗场' },
      description: '吧台侧面',
      score: 6,
    });
    expect(first).toEqual({
      ok: true,
      spot_key: 'abc123',
      remaining: [901, 903],
    });
    expect(second.ok).toBe(true);
    expect(second.spot_key).toMatch(/^new-[0-9a-f]{10}$/);
    expect(events.filter((event) => event.type === 'spot')).toEqual([
      {
        type: 'spot',
        key: second.spot_key,
        name: '西部斗场',
        description: '枪战主题区',
        opening: false,
      },
    ]);
    expect(events.filter((event) => event.type === 'assign')).toEqual([
      {
        type: 'assign',
        imageId: 902,
        spotKey: 'abc123',
        description: '红色霓虹门头',
        score: 10,
      },
      {
        type: 'assign',
        imageId: 901,
        spotKey: second.spot_key,
        description: '射击大屏',
        score: 8,
      },
      {
        type: 'assign',
        imageId: 903,
        spotKey: second.spot_key,
        description: '吧台侧面',
        score: 6,
      },
    ]);
    expect(session.missed()).toEqual([]);
  });

  it('不在本批的图片、找不到的点位不推事件，把原因返回给模型重来；点位名当 key 传也能认出来', () => {
    const events: DouyinStoreVisitClassifyEvent[] = [];
    const session = createStoreVisitClassifySession(
      { imageIds: [1, 2], spots: [{ key: 'abc123', name: '旋转木马' }] },
      (event) => events.push(event),
    );
    expect(
      JSON.parse(
        session.assign({
          image_id: 99,
          spot_key: 'abc123',
          description: 'x',
          score: 5,
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      JSON.parse(
        session.assign({
          image_id: 1,
          spot_key: 'new-nope',
          description: 'x',
          score: 5,
        }),
      ).error,
    ).toContain('不存在');
    expect(events).toEqual([]);
    expect(
      JSON.parse(
        session.assign({
          image_id: 2,
          spot_key: '旋转木马',
          description: '木马顶棚',
          score: 7,
        }),
      ).spot_key,
    ).toBe('abc123');
    expect(session.assigned()).toEqual([2]);
    expect(session.missed()).toEqual([1]);
  });

  it('classify 用轻量 Agent 只挂归类工具，工具调用即时推送，结束推 done；一张都没归上时报错', async () => {
    const service = Object.create(DouyinStoreVisitSpotService.prototype);
    service.stores = {
      findOne: jest
        .fn()
        .mockResolvedValue({
          id: 1,
          name: '集合石',
          description: '',
          spots: [],
        }),
    };
    service.previews = new Map();
    service.gallery = {
      findAccessibleImagesByIds: jest
        .fn()
        .mockImplementation((_u: string, _t: string, ids: number[]) =>
          Promise.resolve(
            ids.map((id) => ({
              id,
              url: 'https://cdn.example/' + id + '.jpg',
            })),
          ),
        ),
    };
    service.toVisionImage = jest
      .fn()
      .mockResolvedValue('data:image/jpeg;base64,AA==');
    service.workflowModels = {
      resolveNodeRuntime: jest.fn().mockResolvedValue(null),
    };
    const configs: Array<Record<string, any>> = [];
    service.agentService = {
      runWithMessages: jest
        .fn()
        .mockImplementation(
          async ({ config }: { config: Record<string, any> }) => {
            configs.push(config);
            await config.tools[0].invoke({
              image_id: 901,
              new_spot: { name: '大屏射击', opening: false },
              description: '投影大屏',
              score: 9,
            });
            return {};
          },
        ),
    };
    service.logger = { warn: jest.fn() };
    const events: DouyinStoreVisitClassifyEvent[] = [];
    await service.classify(
      1,
      { imageIds: [901, 902] },
      { userId: 'u1' },
      (event: DouyinStoreVisitClassifyEvent) => events.push(event),
    );
    expect(configs[0].lightweight).toBe(true);
    expect(configs[0].tools.map((item: { name: string }) => item.name)).toEqual(
      ['store_visit_assign_image'],
    );
    expect(events.map((event) => event.type)).toEqual([
      'spot',
      'assign',
      'done',
    ]);
    expect(events[2]).toEqual({ type: 'done', assigned: [901], missed: [902] });
    service.agentService.runWithMessages = jest.fn().mockResolvedValue({});
    await expect(
      service.classify(
        1,
        { imageIds: [901] },
        { userId: 'u1' },
        () => undefined,
      ),
    ).rejects.toThrow('没有把任何图片归入点位');
  });

  it('提示词列出已有点位的 key、封面序号与本批图片的预分组', () => {
    const brief = buildStoreVisitSpotClassificationBrief({
      storeName: '欢乐谷',
      storeDescription: '',
      spots: [{ key: 'abc', name: '门头', description: '店外', coverIndex: 3 }],
      images: [
        { id: 7, index: 1, group: 'A' },
        { id: 8, index: 2 },
      ],
    });
    expect(brief).toContain('key=abc｜门头｜店外｜封面是图3');
    expect(brief).toContain('store_visit_assign_image');
    expect(brief).toContain('图1：id=7（相似度预分组 A');
    expect(brief).toContain('图2：id=8');
  });

  it('点位名去掉书名号并截到 30 字，分数夹到 1～10', () => {
    expect(normalizeStoreVisitSpotName(' 《星空  打卡墙》 ')).toBe(
      '星空 打卡墙',
    );
    expect(normalizeStoreVisitSpotName('长'.repeat(40))).toHaveLength(30);
    expect(clampStoreVisitSpotScore(0)).toBe(1);
    expect(clampStoreVisitSpotScore('9.6')).toBe(10);
    expect(clampStoreVisitSpotScore('abc')).toBe(5);
  });
});
