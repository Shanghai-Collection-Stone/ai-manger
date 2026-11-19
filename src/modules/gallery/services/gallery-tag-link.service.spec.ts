import { ObjectId, type Db } from 'mongodb';
import {
  GalleryTagLinkService,
  resolveGalleryTagScopeKey,
} from './gallery-tag-link.service';

type Doc = Record<string, any>;

/**
 * @description 比较两个值是否相等，ObjectId 按值比较。
 * @keyword-cn 测试值相等, ObjectId比较
 * @keyword-en test-value-equal, objectid-compare
 */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

/**
 * @description 内存集合的条件匹配，支持等值、`$in`、`$nin`、`$ne`。
 * @keyword-cn 内存条件匹配, 测试过滤
 * @keyword-en in-memory-match, test-filter
 */
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === 'object' && !(cond instanceof ObjectId)) {
      const c = cond as Doc;
      if ('$in' in c) return (c.$in as unknown[]).some((v) => same(v, value));
      if ('$nin' in c)
        return !(c.$nin as unknown[]).some((v) => same(v, value));
      if ('$ne' in c) return !same(c.$ne, value);
    }
    return same(cond, value);
  });
}

/**
 * @description 只实现关联服务用到操作的内存集合（find / bulkWrite / distinct / deleteMany / createIndex）。
 * @keyword-cn 内存集合替身, 关联服务测试
 * @keyword-en in-memory-collection, tag-link-test
 */
function createMemoryCollection(rows: Doc[]) {
  return {
    rows,
    createIndex: () => Promise.resolve('ok'),
    find: (filter: Doc) => ({
      toArray: () =>
        Promise.resolve(
          rows.filter((row) => matches(row, filter)).map((r) => ({ ...r })),
        ),
    }),
    distinct: (field: string, filter: Doc) => {
      const out: unknown[] = [];
      for (const row of rows.filter((r) => matches(r, filter))) {
        if (!out.some((v) => same(v, row[field]))) out.push(row[field]);
      }
      return Promise.resolve(out);
    },
    deleteMany: (filter: Doc) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], filter)) rows.splice(i, 1);
      }
      return Promise.resolve({ deletedCount: before - rows.length });
    },
    bulkWrite: (ops: Doc[]) => {
      for (const op of ops) {
        if (op.updateOne) {
          const { filter, update, upsert } = op.updateOne;
          let row: Doc | undefined = rows.find((r) => matches(r, filter));
          if (!row && upsert) {
            const created: Doc = {
              _id: new ObjectId(),
              ...filter,
              ...(update.$setOnInsert ?? {}),
            };
            rows.push(created);
            row = created;
          }
          if (row) Object.assign(row, update.$set ?? {});
        }
        if (op.deleteMany) {
          const filter = op.deleteMany.filter;
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (matches(rows[i], filter)) rows.splice(i, 1);
          }
        }
      }
      return Promise.resolve({ ok: 1 });
    },
  };
}

/**
 * @description 构造使用内存标签字典与关联集合的关联服务。
 * @keyword-cn 关联服务测试桩, 内存字典
 * @keyword-en tag-link-fixture, in-memory-dictionary
 */
function createLinkService() {
  const tags = createMemoryCollection([]);
  const links = createMemoryCollection([]);
  const db = {
    collection: (name: string) => (name === 'gallery_tags' ? tags : links),
  } as unknown as Db;
  return { service: new GalleryTagLinkService(db), tags, links };
}

describe('GalleryTagLinkService 标签字典与图片关联', () => {
  it('作用域键与图片租户可见范围一致', () => {
    expect(resolveGalleryTagScopeKey(' t1 ')).toBe('tenant:t1');
    expect(resolveGalleryTagScopeKey('')).toBe('platform');
    expect(resolveGalleryTagScopeKey(undefined)).toBe('platform');
  });

  it('按图片当前标签整体同步：新增、删除、换顺序，同名标签在同作用域只建一次', async () => {
    const { service, tags, links } = createLinkService();
    await service.replaceImageTags([
      { imageId: 1, tenantId: 't1', tags: ['海边', '日落'] },
      { imageId: 2, tenantId: 't1', tags: ['海边'] },
    ]);
    expect(tags.rows.map((row) => String(row.name)).sort()).toEqual([
      '日落',
      '海边',
    ]);
    expect(links.rows).toHaveLength(3);
    expect(await service.tagsByImageIds([1, 2])).toEqual(
      new Map([
        [1, ['海边', '日落']],
        [2, ['海边']],
      ]),
    );

    await service.replaceImageTags([
      { imageId: 1, tenantId: 't1', tags: ['日落', '人像'] },
    ]);
    expect((await service.tagsByImageIds([1])).get(1)).toEqual([
      '日落',
      '人像',
    ]);
    expect(links.rows.filter((row) => row.imageId === 1)).toHaveLength(2);
    expect(tags.rows).toHaveLength(3);
  });

  it('不同租户的同名标签互不影响，统计只看本作用域', async () => {
    const { service } = createLinkService();
    await service.replaceImageTags([
      { imageId: 1, tenantId: 't1', tags: ['海边'] },
      { imageId: 2, tenantId: 't2', tags: ['海边', '夜景'] },
    ]);
    expect(await service.countDistinctTags('tenant:t1')).toBe(1);
    expect(await service.countDistinctTags('tenant:t2')).toBe(2);
    expect(await service.imageIdsWithAnyTag('tenant:t1', ['海边'])).toEqual([
      1,
    ]);
    expect(
      (await service.listTagNames({ scopeKey: 'tenant:t2' })).sort(),
    ).toEqual(['夜景', '海边']);
  });

  it('清空标签和删除图片都会移除关联，标签字典保留', async () => {
    const { service, tags, links } = createLinkService();
    await service.replaceImageTags([
      { imageId: 1, tenantId: 't1', tags: ['海边'] },
      { imageId: 2, tenantId: 't1', tags: ['海边'] },
    ]);
    await service.replaceImageTags([{ imageId: 1, tenantId: 't1', tags: [] }]);
    expect(links.rows.map((row) => Number(row.imageId))).toEqual([2]);
    await service.removeImages([2]);
    expect(links.rows).toHaveLength(0);
    expect(tags.rows).toHaveLength(1);
    expect(await service.tagsByImageIds([1, 2])).toEqual(new Map());
  });
});
