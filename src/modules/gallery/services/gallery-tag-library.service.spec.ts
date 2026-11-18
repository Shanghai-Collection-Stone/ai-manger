import { ObjectId, type Db } from 'mongodb';
import { GalleryTagLibraryService } from './gallery-tag-library.service';

type Doc = Record<string, any>;

const LEGACY = [
  { id: 'a', name: '门店', tags: ['月亮湾店', '诺瓦城店', '丽宝店', '其他'] },
  {
    id: 'b',
    name: '活动',
    tags: ['团建', '生日派对', '快闪活动', '主理人活动', '大厅潮玩'],
  },
  {
    id: 'c',
    name: '画面',
    tags: ['人像', '群像', '特写', '亲子', '情侣', '餐食', '环境'],
  },
];

/**
 * @description 构造只实现本服务用到操作的内存标签库与图片集合。
 * @keyword-cn 标签库测试桩, 内存集合
 * @keyword-en tag-library-test-stub, in-memory-collection
 */
function createService(seed: { library?: Doc; imageTags?: string[][] } = {}) {
  const libraries: Doc[] = seed.library ? [{ ...seed.library }] : [];
  const images: Doc[] = (seed.imageTags ?? []).map((tags, index) => ({
    id: `img-${index}`,
    tenantId: 't1',
    tags,
  }));
  const counts = { countDocuments: 0 };
  const matches = (doc: Doc, filter: Doc) =>
    Object.entries(filter).every(([key, value]) =>
      value instanceof Date
        ? doc[key]?.getTime() === value.getTime()
        : value instanceof ObjectId
          ? doc[key]?.equals?.(value)
          : doc[key] === value,
    );
  const libraryCollection = {
    createIndex: () => Promise.resolve('ok'),
    findOneAndUpdate: (filter: Doc, update: { $setOnInsert: Doc }) => {
      let doc = libraries.find((row) => row.scopeKey === filter.scopeKey);
      if (!doc) {
        doc = { ...update.$setOnInsert };
        libraries.push(doc);
      }
      return Promise.resolve({ value: { ...doc } });
    },
    updateOne: (filter: Doc, update: { $set: Doc }) => {
      const doc = libraries.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
    },
    findOne: (filter: Doc) =>
      Promise.resolve(libraries.find((row) => matches(row, filter)) ?? null),
  };
  const imageCollection = {
    countDocuments: (filter: { tags: { $in: string[] } }) => {
      counts.countDocuments += 1;
      const wanted = new Set(filter.tags.$in);
      return Promise.resolve(
        images.filter((image) => image.tags.some((tag: string) => wanted.has(tag)))
          .length,
      );
    },
    aggregate: () => ({ toArray: () => Promise.resolve([]) }),
  };
  const db = {
    collection: (name: string) =>
      name === 'gallery_tag_libraries' ? libraryCollection : imageCollection,
  } as unknown as Db;
  return { service: new GalleryTagLibraryService(db), libraries, counts };
}

/**
 * @description 旧版首次打开时写入、之后没人改过的预设标签库文档。
 * @keyword-cn 旧预设标签库, 测试数据
 * @keyword-en legacy-preset-library, test-fixture
 */
function legacyLibrary(overrides: Doc = {}): Doc {
  const at = new Date('2026-10-01T00:00:00Z');
  return {
    _id: new ObjectId(),
    scopeKey: 'tenant:t1',
    categories: LEGACY.map((category) => ({ ...category, tags: [...category.tags] })),
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

describe('GalleryTagLibraryService 新租户不写入预设标签，旧租户不动', () => {
  it('第一次打开图库建的是空标签库，不带任何门店、活动预设', async () => {
    const { service, libraries } = createService();
    const view = await service.get('t1', []);
    expect(view.categories).toEqual([]);
    expect(libraries[0].categories).toEqual([]);
  });

  it('旧租户已有的标签库（包括早期写入的门店、活动预设）原样返回，不清理也不改写', async () => {
    const { service, libraries, counts } = createService({
      library: legacyLibrary(),
      imageTags: [['海边']],
    });
    const before = libraries[0].updatedAt.getTime();
    const view = await service.get('t1', []);
    expect(view.categories.map((category) => category.name)).toEqual([
      '门店',
      '活动',
      '画面',
    ]);
    expect(libraries[0].categories).toHaveLength(3);
    expect(libraries[0].updatedAt.getTime()).toBe(before);
    expect(counts.countDocuments).toBe(0);
  });
});
