import { GalleryService } from './gallery.service.js';

/**
 * @description 创建记录列表查询条件、可指定游标图片的集合替身。
 * @keyword-cn 列表查询替身, 游标图片
 * @keyword-en list-query-double, cursor-image
 */
function createListCollection(cursorImage: Record<string, unknown> | null) {
  const cursor = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([]),
  };
  return {
    find: jest.fn().mockReturnValue(cursor),
    findOne: jest.fn().mockResolvedValue(cursorImage),
    cursor,
  };
}

/**
 * @description 用集合替身执行一次图片列表查询，返回 find 收到的全部过滤子条件。
 * @keyword-cn 执行列表查询, 查询子条件
 * @keyword-en run-list-query, query-clauses
 */
async function listClauses(
  images: ReturnType<typeof createListCollection>,
  options: Parameters<GalleryService['findAccessibleImages']>[2],
): Promise<unknown[]> {
  const service = Object.create(GalleryService.prototype) as GalleryService;
  Object.assign(service, { images });
  await service.findAccessibleImages('user', 'tenant', options);
  const [[filter]] = images.find.mock.calls as [[{ $and?: unknown[] }]];
  return filter.$and ?? [filter];
}

describe('图库列表复合游标与关键词搜索', () => {
  it('最新排序按游标图片的创建时间与 ID 复合定位下一页', async () => {
    const createdAt = new Date('2026-10-01T00:00:00Z');
    const images = createListCollection({ createdAt });
    const clauses = await listClauses(images, { cursorId: 120, limit: 40 });
    expect(images.findOne).toHaveBeenCalledWith(
      { $and: [{ tenantId: 'tenant' }, { id: 120 }] },
      { projection: { _id: 0, createdAt: 1 } },
    );
    expect(clauses).toContainEqual({
      createdAt: { $lte: createdAt },
      $or: [{ createdAt: { $lt: createdAt } }, { id: { $lt: 120 } }],
    });
    expect(images.cursor.sort).toHaveBeenCalledWith({ createdAt: -1, id: -1 });
  });

  it('最早排序的复合游标取更晚的图片', async () => {
    const createdAt = new Date('2026-10-01T00:00:00Z');
    const images = createListCollection({ createdAt });
    const clauses = await listClauses(images, {
      cursorId: 120,
      sort: 'oldest',
    });
    expect(clauses).toContainEqual({
      createdAt: { $gte: createdAt },
      $or: [{ createdAt: { $gt: createdAt } }, { id: { $gt: 120 } }],
    });
  });

  it('游标图片已不可见时回退为只比较 ID', async () => {
    const images = createListCollection(null);
    const clauses = await listClauses(images, { cursorId: 120 });
    expect(clauses).toContainEqual({ id: { $lt: 120 } });
  });

  it('收藏优先仍按 offset 翻页，不查游标图片', async () => {
    const images = createListCollection(null);
    await listClauses(images, { cursorId: 120, sort: 'favorite', offset: 40 });
    expect(images.findOne).not.toHaveBeenCalled();
    expect(images.cursor.skip).toHaveBeenCalledWith(40);
  });

  it('关键词去空白、转义正则特殊字符并匹配文件名、描述与备注', async () => {
    const images = createListCollection(null);
    const clauses = await listClauses(images, { keyword: '  a.b(1)  ' });
    const match = { $regex: 'a\\.b\\(1\\)', $options: 'i' };
    expect(clauses).toContainEqual({
      $or: [
        { originalName: match },
        { fileName: match },
        { description: match },
        { note: match },
      ],
    });
  });
});
