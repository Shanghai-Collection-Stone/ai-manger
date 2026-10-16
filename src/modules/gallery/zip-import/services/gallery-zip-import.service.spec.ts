import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Db } from 'mongodb';
import type { GalleryService } from '../../services/gallery.service.js';
import { GalleryZipImportService } from './gallery-zip-import.service.js';

type Doc = Record<string, unknown>;

/** @description 匹配恢复扫描需要的 Mongo 过滤语义。 @keyword-cn 恢复条件测试, 过滤匹配 @keyword-en recovery-filter-test, filter-matching */
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return (condition as Doc[]).some((branch) => matches(doc, branch));
    }
    const value = doc[key];
    if (
      condition &&
      typeof condition === 'object' &&
      !(condition instanceof Date)
    ) {
      const ops = condition as Doc;
      if ('$in' in ops && !(ops.$in as unknown[]).includes(value)) return false;
      if (
        '$lt' in ops &&
        !(value instanceof Date && value < (ops.$lt as Date))
      ) {
        return false;
      }
      if ('$exists' in ops && (value !== undefined) !== ops.$exists)
        return false;
      return true;
    }
    return value === condition;
  });
}

/** @description 为 ZIP 恢复提供内存数据库替身。 @keyword-cn 恢复数据库替身, 内存测试 @keyword-en recovery-db-stub, in-memory-test */
function createFakeDb(docs: Doc[]): Db {
  const collection = {
    createIndex: jest.fn().mockResolvedValue('ok'),
    find: (filter: Doc) => {
      const cursor = {
        limit: () => cursor,
        toArray: () =>
          Promise.resolve(docs.filter((doc) => matches(doc, filter))),
      };
      return cursor;
    },
    updateOne: (filter: Doc, update: { $set?: Doc }) => {
      const doc = docs.find((item) => matches(item, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
    },
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  return { collection: () => collection } as unknown as Db;
}

describe('GalleryZipImportService.recoverOrphanedJobs', () => {
  const now = Date.now();
  /** @description 构造指定分钟以前的心跳时间。 @keyword-cn 心跳测试时间, 过期时间 @keyword-en heartbeat-test-time, stale-time */
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000);
  let zipDir: string;

  beforeEach(() => {
    zipDir = mkdtempSync(join(tmpdir(), 'zip-recover-'));
  });

  /** @description 建立可恢复任务的临时 ZIP 文件。 @keyword-cn 临时ZIP测试, 恢复文件 @keyword-en temporary-zip-test, recovery-file */
  const tempZip = (name: string) => {
    const path = join(zipDir, name);
    writeFileSync(path, 'zip');
    return path;
  };

  it('负责进程不在了：处理到一半的判失败并保留已入库图片，排队中的由本进程接手', async () => {
    const runningZip = tempZip('running.zip');
    const pendingZip = tempZip('pending.zip');
    const freshZip = tempZip('fresh.zip');
    const docs: Doc[] = [
      {
        id: 'running',
        status: 'importing',
        ownerId: 'old-process',
        heartbeatAt: minutesAgo(5),
        zipAbsPath: runningZip,
        imageIds: [1, 2, 3],
      },
      {
        id: 'pending',
        status: 'pending',
        ownerId: 'old-process',
        heartbeatAt: minutesAgo(5),
        zipAbsPath: pendingZip,
        imageIds: [],
      },
      {
        id: 'pending-without-zip',
        status: 'pending',
        heartbeatAt: minutesAgo(5),
        zipAbsPath: join(zipDir, 'missing.zip'),
        imageIds: [],
      },
      {
        id: 'cancel-requested',
        status: 'extracting',
        cancelRequested: true,
        heartbeatAt: minutesAgo(5),
        imageIds: [9],
      },
      {
        id: 'fresh',
        status: 'importing',
        ownerId: 'live-process',
        heartbeatAt: minutesAgo(0.5),
        zipAbsPath: freshZip,
        imageIds: [],
      },
    ];
    const service = new GalleryZipImportService(
      createFakeDb(docs),
      {} as GalleryService,
    );
    const schedule = jest
      .spyOn(
        service as unknown as { scheduleJob: (id: string) => void },
        'scheduleJob',
      )
      .mockImplementation(() => undefined);

    await service.recoverOrphanedJobs();

    const byId = (id: string) => docs.find((doc) => doc.id === id) as Doc;
    expect(byId('running').status).toBe('failed');
    expect(byId('running').stage).toContain('已入库 3 张已保留');
    expect(existsSync(runningZip)).toBe(false);

    expect(byId('pending').status).toBe('pending');
    expect(byId('pending').ownerId).not.toBe('old-process');
    expect(schedule).toHaveBeenCalledWith('pending');
    expect(existsSync(pendingZip)).toBe(true);

    expect(byId('pending-without-zip').status).toBe('failed');
    expect(byId('pending-without-zip').stage).toContain('找不到 ZIP');

    expect(byId('cancel-requested').status).toBe('cancelled');
    expect(byId('cancel-requested').stage).toBe('已取消(已入库 1 张)');

    expect(byId('fresh').status).toBe('importing');
    expect(existsSync(freshZip)).toBe(true);
  });

  it('没有心跳的旧任务按 updatedAt 判断，10 分钟内仍有进展的不动', async () => {
    const docs: Doc[] = [
      {
        id: 'legacy-active',
        status: 'importing',
        updatedAt: minutesAgo(3),
        imageIds: [],
      },
      {
        id: 'legacy-stuck',
        status: 'importing',
        updatedAt: minutesAgo(30),
        imageIds: [7],
      },
    ];
    const service = new GalleryZipImportService(
      createFakeDb(docs),
      {} as GalleryService,
    );

    await service.recoverOrphanedJobs();

    expect(docs[0].status).toBe('importing');
    expect(docs[1].status).toBe('failed');
    expect(docs[1].stage).toContain('已入库 1 张已保留');
  });
});
