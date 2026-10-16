import { ObjectId } from 'mongodb';
import type { GalleryImageEntity } from '../entities/gallery-image.entity.js';
import { GalleryService } from './gallery.service.js';
import { GalleryGroupService } from './gallery-group.service.js';

/**
 * @description 创建只记录 Mongo 查询与聚合投影的集合替身。
 * @keyword-cn 公开投影测试, 查询记录
 * @keyword-en public-projection-test, query-recording
 */
function createCollection() {
  const cursor = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([]),
  };
  return {
    find: jest.fn().mockReturnValue(cursor),
    aggregate: jest.fn().mockReturnValue(cursor),
  };
}

describe('图库公开响应不携带向量', () => {
  it('清除公开响应的向量，同时保留内部原始实体和历史字段默认值', () => {
    const image = {
      id: 42,
      _id: new ObjectId(),
      embedding: [0.1, 0.2, 0.3],
      url: '/image.jpg',
    } as GalleryImageEntity;
    const result = GalleryService.prototype.toPublicImage(image);
    expect(result).not.toHaveProperty('_id');
    expect(result).not.toHaveProperty('embedding');
    expect(result).toMatchObject({
      id: 42,
      url: '/image.jpg',
      favorite: false,
      note: '',
      aiFaceProtected: false,
    });
    expect(image.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(image._id).toBeInstanceOf(ObjectId);
  });

  it('普通与随机图库列表在数据库读取阶段排除向量', async () => {
    const images = createCollection();
    const service = Object.create(GalleryService.prototype) as GalleryService;
    Object.assign(service, { images });
    await service.findAccessibleImages('user', 'tenant', { limit: 40 });
    expect(images.find).toHaveBeenCalledWith(expect.any(Object), {
      projection: { _id: 0, embedding: 0 },
    });
    await service.findAccessibleImages('user', 'tenant', { sort: 'random' });
    expect(images.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([{ $project: { _id: 0, embedding: 0 } }]),
    );
  });

  it('分组列表同样排除向量，不影响内部语义检索存储', async () => {
    const groups = createCollection();
    const service = Object.create(
      GalleryGroupService.prototype,
    ) as GalleryGroupService;
    Object.assign(service, { groups });
    await service.listAccessibleGroups('user', 'tenant');
    expect(groups.find).toHaveBeenCalledWith(expect.any(Object), {
      projection: { _id: 0, embedding: 0 },
    });
  });
});
