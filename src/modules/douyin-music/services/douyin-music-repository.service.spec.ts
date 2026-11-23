import { ObjectId, type Db } from 'mongodb';
import type { OssStorageService } from '../../video-library/services/oss-storage.service.js';
import type { DouyinMusicEntity } from '../entities/douyin-music.entity.js';
import { DouyinMusicRepositoryService } from './douyin-music-repository.service.js';

type Row = Record<string, any>;

/**
 * @description 判断一行是否命中仓储用到的查询写法（等值、`$and`、`$or`、`$exists`）。
 * @keyword-cn 匹配音乐查询, 内存集合
 * @keyword-en match-music-query, in-memory-collection
 * @param {Row} row 数据行。
 * @param {Row} filter 查询条件。
 * @returns {boolean} 是否命中。
 */
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every((item: Row) => matches(row, item));
    if (key === '$or') return value.some((item: Row) => matches(row, item));
    if (value && typeof value === 'object' && '$exists' in value)
      return (row[key] !== undefined) === value.$exists;
    return (row[key] ?? null) === value;
  });
}

/**
 * @description 构造一条音乐记录。
 * @keyword-cn 构造音乐记录, 测试素材
 * @keyword-en build-music-row, test-fixture
 * @param {Partial<DouyinMusicEntity>} patch 覆盖字段。
 * @returns {DouyinMusicEntity} 音乐记录。
 */
function track(patch: Partial<DouyinMusicEntity>): DouyinMusicEntity {
  const now = new Date();
  return {
    _id: new ObjectId(),
    id: 1,
    source: 'upload',
    tenantId: 't1',
    userId: 'alice',
    name: '歌',
    category: 'other',
    key: `music/${patch.id ?? 1}.mp3`,
    contentType: 'audio/mpeg',
    sizeBytes: 10,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

/**
 * @description 用内存集合构造仓储：alice、bob 同租户，carol 在别的租户。
 * @keyword-cn 构造音乐仓储, 内存集合
 * @keyword-en build-music-repository, in-memory-collection
 * @returns {{repository: DouyinMusicRepositoryService, rows: DouyinMusicEntity[]}} 仓储与数据。
 */
function build() {
  const rows = [
    track({ id: 1, userId: 'alice' }),
    track({ id: 2, userId: 'bob' }),
    track({ id: 3, userId: 'carol', tenantId: 't2' }),
  ];
  const collection = {
    createIndex: jest.fn(() => Promise.resolve('ok')),
    find: (filter: Row) => ({
      sort: () => ({
        limit: () => ({
          toArray: () =>
            Promise.resolve(rows.filter((row) => matches(row, filter))),
        }),
      }),
    }),
    findOne: (filter: Row) =>
      Promise.resolve(rows.find((row) => matches(row, filter)) ?? null),
    countDocuments: (filter: Row) =>
      Promise.resolve(rows.filter((row) => matches(row, filter)).length),
    deleteOne: (filter: Row) => {
      const index = rows.findIndex((row) => row._id === filter._id);
      if (index >= 0) rows.splice(index, 1);
      return Promise.resolve({ deletedCount: index >= 0 ? 1 : 0 });
    },
  };
  const repository = new DouyinMusicRepositoryService(
    { collection: () => collection } as unknown as Db,
    { publicUrl: (key: string) => `https://cdn/${key}` } as OssStorageService,
  );
  return { repository, rows };
}

describe('tenant-shared music uploads', () => {
  const alice = { tenantId: 't1', userId: 'alice' };
  const bob = { tenantId: 't1', userId: 'bob' };
  const carol = { tenantId: 't2', userId: 'carol' };

  it('shares uploads inside the tenant and keeps other tenants out', async () => {
    const { repository } = build();
    const list = await repository.list(bob);
    expect(list.map((item) => item.id).sort()).toEqual([1, 2]);
    expect(list.find((item) => item.id === 1)).toMatchObject({
      mine: false,
      canDelete: false,
    });
    expect(list.find((item) => item.id === 2)).toMatchObject({
      mine: true,
      canDelete: true,
    });
    expect(list[0]).not.toHaveProperty('userId');
    expect(await repository.getUsable(1, bob)).not.toBeNull();
    expect(await repository.getUsable(1, carol)).toBeNull();
    expect(await repository.getUsable(3, alice)).toBeNull();
  });

  it('counts the upload quota per person', async () => {
    const { repository } = build();
    expect(await repository.countUploads(alice)).toBe(1);
    expect(await repository.countUploads(bob)).toBe(1);
  });

  it('lets only the uploader or a same-tenant admin delete', async () => {
    const { repository, rows } = build();
    expect(await repository.removeUpload(1, bob)).toBeNull();
    expect(
      await repository.removeUpload(1, { ...carol, canManageUploads: true }),
    ).toBeNull();
    expect(rows).toHaveLength(3);
    expect((await repository.removeUpload(1, alice))?.id).toBe(1);
    expect(
      (await repository.removeUpload(2, { ...alice, canManageUploads: true }))
        ?.id,
    ).toBe(2);
    expect(rows.map((row) => row.id)).toEqual([3]);
  });
});
