import sharp from 'sharp';
import {
  buildStoreVisitSpotClassificationBrief,
  clampStoreVisitSpotScore,
  clusterStoreVisitSignatures,
  computeStoreVisitImageSignature,
  normalizeStoreVisitSpotName,
  parseStoreVisitSpotClassification,
  storeVisitSignatureDistance,
} from './douyin-store-visit-spot.service.js';

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
  it('只收本批图片与已知或本次声明的点位，丢掉没图的新点位并夹紧分数', () => {
    const result = parseStoreVisitSpotClassification(
      '```json\n' +
        JSON.stringify({
          images: [
            { id: 11, spot: 'abc123', description: '门头招牌', score: 12 },
            { id: 12, spot: 'new-ride', description: '旋转木马', score: 8.4 },
            { id: 12, spot: 'abc123', description: '重复', score: 3 },
            { id: 99, spot: 'abc123', description: '不在本批', score: 9 },
            { id: 13, spot: 'unknown', description: '乱填点位', score: 5 },
          ],
          newSpots: [
            { key: 'new-ride', name: '「旋转木马」', description: '亲子项目' },
            { key: 'new-empty', name: '空点位', description: '没有图' },
            { key: 'bad key', name: '非法键' },
          ],
        }) +
        '\n```',
      { imageIds: [11, 12, 13], spotKeys: ['abc123', 'new-old'] },
    );
    expect(result.assignments).toEqual([
      { imageId: 11, spotKey: 'abc123', description: '门头招牌', score: 10 },
      { imageId: 12, spotKey: 'new-ride', description: '旋转木马', score: 8 },
    ]);
    expect(result.spots).toEqual([
      {
        key: 'new-ride',
        name: '旋转木马',
        description: '亲子项目',
        opening: false,
      },
    ]);
  });

  it('一张都没归上时报错，交给调用方提示重试', () => {
    expect(() =>
      parseStoreVisitSpotClassification('{"images":[]}', {
        imageIds: [1],
        spotKeys: [],
      }),
    ).toThrow('AI 没有把任何图片归入点位');
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
