import { ObjectId } from 'mongodb';
import { hasUsableEmbedding, toStoredEmbedding } from '../gallery-embedding';
import { GalleryService } from './gallery.service';
import { GalleryGroupService } from './gallery-group.service';

const ZERO = new Array<number>(768).fill(0);

/**
 * @description 构造只带向量相关依赖替身的图片服务：向量服务按传入结果返回，记录写入的文档与批量操作。
 * @keyword-cn 向量测试替身, 图片服务桩
 * @keyword-en embedding-test-double, gallery-service-stub
 */
function createGallery(vectors: { text?: number[]; batch?: number[][] }) {
  const inserted: Record<string, unknown>[] = [];
  const bulk: unknown[] = [];
  const cursor = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([
      { _id: new ObjectId(), id: 1, description: 'a' },
      { _id: new ObjectId(), id: 2, description: 'b' },
    ]),
  };
  const images = {
    find: jest.fn().mockReturnValue(cursor),
    aggregate: jest.fn(),
    insertMany: jest.fn((docs: Record<string, unknown>[]) => {
      inserted.push(...docs);
      return Promise.resolve({ insertedCount: docs.length });
    }),
    bulkWrite: jest.fn((ops: unknown[]) => {
      bulk.push(...ops);
      return Promise.resolve({ ok: 1 });
    }),
  };
  let seq = 0;
  const service = Object.create(GalleryService.prototype) as GalleryService;
  Object.assign(service, {
    images,
    counters: {
      findOneAndUpdate: () => Promise.resolve({ value: { seq: ++seq } }),
    },
    embedding: {
      embedText: jest.fn().mockResolvedValue(vectors.text ?? ZERO),
      embedBatch: jest.fn().mockResolvedValue(vectors.batch ?? []),
    },
    adminService: { getDefaultEmbeddingRuntime: () => Promise.resolve(null) },
    tagLinks: {
      replaceImageTags: jest.fn().mockResolvedValue(undefined),
      tagsByImageIds: jest.fn().mockResolvedValue(new Map()),
    },
  });
  return { service, images, inserted, bulk };
}

describe('图库向量不再存全 0', () => {
  it('只有含非零分量的向量才算有效，无效向量入库存空数组', () => {
    expect(hasUsableEmbedding(ZERO)).toBe(false);
    expect(hasUsableEmbedding([])).toBe(false);
    expect(hasUsableEmbedding([0, Number.NaN, 0.2])).toBe(true);
    expect(toStoredEmbedding(ZERO)).toEqual([]);
    expect(toStoredEmbedding(undefined)).toEqual([]);
    expect(toStoredEmbedding([0, 0.5])).toEqual([0, 0.5]);
  });

  it('查询向量全 0 时相似检索直接返回空，不读取图片', async () => {
    const { service, images } = createGallery({ text: ZERO });
    await expect(
      service.searchSimilar('门店', undefined, 't1', 24, 0.35, 'regular'),
    ).resolves.toEqual([]);
    expect(images.find).not.toHaveBeenCalled();
    expect(images.aggregate).not.toHaveBeenCalled();
  });

  it('上传时向量服务返回全 0，图片存空数组而不是 768 个 0', async () => {
    const { service, inserted } = createGallery({ batch: [ZERO] });
    const [created] = await service.createMany([
      {
        userId: 'u',
        tenantId: 't1',
        originalName: 'a.jpg',
        fileName: 'a.jpg',
        url: '/a.jpg',
      },
    ]);
    expect(inserted[0].embedding).toEqual([]);
    expect(created.embedding).toEqual([]);
  });

  it('重建向量时拿到全 0 的图片不覆盖原向量，只写入有效向量', async () => {
    const valid = [0.1, 0.2, 0.3];
    const { service, bulk } = createGallery({ batch: [ZERO, valid] });
    await expect(
      service.rebuildEmbeddings({ tenantId: 't1' }),
    ).resolves.toEqual({
      updated: 1,
    });
    expect(bulk).toHaveLength(1);
    expect(JSON.stringify(bulk[0])).toContain('[0.1,0.2,0.3]');
  });

  it('分组向量化拿到全 0 时同样存空数组', async () => {
    const service = Object.create(
      GalleryGroupService.prototype,
    ) as GalleryGroupService;
    Object.assign(service, {
      embedding: { embedText: jest.fn().mockResolvedValue(ZERO) },
      adminService: { getDefaultEmbeddingRuntime: () => Promise.resolve(null) },
    });
    const safeEmbedText = (
      service as unknown as { safeEmbedText(text: string): Promise<number[]> }
    ).safeEmbedText.bind(service);
    await expect(safeEmbedText('动态封面')).resolves.toEqual([]);
  });
});
