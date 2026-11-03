import type { Db } from 'mongodb';
import { ModelConcurrencyService } from './model-concurrency.service';
import { MODEL_CONCURRENCY_SLOT_GRACE_MS } from '../entities/model-concurrency.entity';

type Row = Record<string, any>;

/**
 * @description 按本服务用到的写法判断一行是否命中查询：相等、`$in`、`$lt`。
 * @keyword-cn 内存查询匹配, 测试替身
 * @keyword-en memory-filter-match, test-double
 */
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const value = row[key];
    if (
      expected &&
      typeof expected === 'object' &&
      !(expected instanceof Date)
    ) {
      if ('$in' in expected) return expected.$in.includes(value);
      if ('$lt' in expected) return value < expected.$lt;
    }
    return value === expected;
  });
}

/**
 * @description 内存集合：支持本服务用到的方法，并按给定字段组模拟唯一索引（冲突抛 code 11000）。
 * @keyword-cn 内存集合, 唯一索引模拟
 * @keyword-en in-memory-collection, unique-index-emulation
 */
function memoryCollection(uniqueKeys: string[][] = []) {
  const rows: Row[] = [];
  const duplicate = () => Object.assign(new Error('E11000'), { code: 11000 });
  const violates = (doc: Row) =>
    uniqueKeys.some((keys) =>
      rows.some((row) => keys.every((key) => row[key] === doc[key])),
    );
  const cursor = (list: Row[]) => {
    let out = [...list];
    const api = {
      sort(spec: Record<string, number>) {
        const [key, direction] = Object.entries(spec)[0];
        out.sort(
          (a, b) =>
            (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * direction,
        );
        return api;
      },
      limit(count: number) {
        out = out.slice(0, count);
        return api;
      },
      toArray: async () => out,
    };
    return api;
  };
  return {
    rows,
    createIndex: jest.fn().mockResolvedValue('ok'),
    findOne: async (filter: Row) =>
      rows.find((row) => matches(row, filter)) ?? null,
    find: (filter: Row = {}) =>
      cursor(rows.filter((row) => matches(row, filter))),
    insertOne: async (doc: Row) => {
      if (violates(doc)) throw duplicate();
      rows.push({ ...doc });
    },
    updateOne: async (
      filter: Row,
      update: { $set?: Row; $setOnInsert?: Row },
      options: { upsert?: boolean } = {},
    ) => {
      const existing = rows.find((row) => matches(row, filter));
      if (existing) {
        Object.assign(existing, update.$set ?? {});
        return;
      }
      if (!options.upsert) return;
      const doc = { ...filter, ...update.$setOnInsert, ...update.$set };
      if (violates(doc)) throw duplicate();
      rows.push(doc);
    },
    deleteOne: async (filter: Row) => {
      const index = rows.findIndex((row) => matches(row, filter));
      if (index >= 0) rows.splice(index, 1);
    },
    deleteMany: async (filter: Row) => {
      for (let index = rows.length - 1; index >= 0; index -= 1)
        if (matches(rows[index], filter)) rows.splice(index, 1);
    },
    findOneAndDelete: async (filter: Row) => {
      const index = rows.findIndex((row) => matches(row, filter));
      return index >= 0 ? rows.splice(index, 1)[0] : null;
    },
  };
}

/**
 * @description 构造带内存集合的并发服务。
 * @keyword-cn 构造并发测试服务, 内存名额
 * @keyword-en build-concurrency-service, memory-slots
 */
function buildService() {
  const collections = {
    model_concurrency_limits: memoryCollection([['providerId', 'model']]),
    model_concurrency_slots: memoryCollection([['key', 'slot']]),
    model_concurrency_waiters: memoryCollection([['holder']]),
  };
  const db = {
    collection: (name: keyof typeof collections) => collections[name],
  } as unknown as Db;
  return {
    service: new ModelConcurrencyService(db),
    slots: collections.model_concurrency_slots.rows,
    waiters: collections.model_concurrency_waiters.rows,
  };
}

/** @description 等后台派发（不等待的 Promise）跑完。 @keyword-cn 等后台派发 @keyword-en flush-dispatch */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const seedance = { providerId: 'p1', model: 'seedance-2' };

describe('ModelConcurrencyService 按模型限并发', () => {
  it('没设上限时直接放行，只记一条统计用名额', async () => {
    const { service } = buildService();
    expect(await service.admit('video', seedance, 'a')).toBe(true);
    expect(await service.admit('video', seedance, 'b')).toBe(true);
    expect(await service.overview()).toEqual([
      { ...seedance, limit: null, running: 2, waiting: 0 },
    ]);
  });

  it('上限满了排队；前面有人排队时，空出名额新来的也不插队', async () => {
    const { service } = buildService();
    await service.setLimit(seedance, 1);
    expect(await service.admit('video', seedance, 'a')).toBe(true);
    expect(await service.admit('video', seedance, 'b')).toBe(false);
    await service.release('a');
    expect(await service.admit('video', seedance, 'c')).toBe(false);
    expect(await service.positions(['b', 'c'])).toEqual(
      new Map([
        ['b', 0],
        ['c', 1],
      ]),
    );
  });

  it('同一任务重复申请不重复占名额', async () => {
    const { service, slots } = buildService();
    await service.setLimit(seedance, 2);
    await service.admit('video', seedance, 'a');
    await service.admit('video', seedance, 'a');
    expect(slots).toHaveLength(1);
  });

  it('不同模型的名额互不占用', async () => {
    const { service } = buildService();
    await service.setLimit(seedance, 1);
    await service.setLimit({ providerId: 'p1', model: 'minimax-h3' }, 1);
    expect(await service.admit('video', seedance, 'a')).toBe(true);
    expect(
      await service.admit(
        'video',
        { providerId: 'p1', model: 'minimax-h3' },
        'b',
      ),
    ).toBe(true);
  });

  it('一轮里先回收已结束任务的名额，再按先来先到派发下一个', async () => {
    const { service, waiters } = buildService();
    const dispatch = jest.fn().mockResolvedValue(true);
    const running = new Set(['a']);
    service.registerKind('video', {
      dispatch,
      inspect: async (holders) =>
        new Map(holders.map((holder) => [holder, running.has(holder)])),
    });
    await service.setLimit(seedance, 1);
    await service.admit('video', seedance, 'a');
    await service.admit('video', seedance, 'b');
    await service.admit('video', seedance, 'c');

    await service.tick();
    await flush();
    expect(dispatch).not.toHaveBeenCalled();

    running.delete('a');
    running.add('b');
    await service.tick();
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('b');
    expect(waiters.map((row) => row.holder)).toEqual(['c']);
  });

  it('业务说不用提交时归还名额，下一轮放行后面的', async () => {
    const { service } = buildService();
    const dispatch = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    service.registerKind('video', {
      dispatch,
      inspect: async (holders) => new Map(holders.map((h) => [h, true])),
    });
    await service.setLimit(seedance, 1);
    await service.admit('video', seedance, 'a');
    await service.admit('video', seedance, 'b');
    await service.admit('video', seedance, 'c');
    await service.release('a');

    await service.tick();
    await flush();
    await service.tick();
    await flush();
    expect(dispatch.mock.calls.map(([holder]) => holder)).toEqual(['b', 'c']);
  });

  it('调高上限后同一轮放行多个排队任务', async () => {
    const { service } = buildService();
    const dispatch = jest.fn().mockResolvedValue(true);
    service.registerKind('video', {
      dispatch,
      inspect: async (holders) => new Map(holders.map((h) => [h, true])),
    });
    await service.setLimit(seedance, 1);
    await service.admit('video', seedance, 'a');
    await service.admit('video', seedance, 'b');
    await service.admit('video', seedance, 'c');
    await service.setLimit(seedance, 3);

    await service.tick();
    await flush();
    expect(dispatch.mock.calls.map(([holder]) => holder)).toEqual(['b', 'c']);
  });

  it('查不到任务的名额过了保护期才回收', async () => {
    const { service, slots } = buildService();
    service.registerKind('video', {
      dispatch: jest.fn(),
      inspect: async () => new Map(),
    });
    await service.setLimit(seedance, 1);
    await service.admit('video', seedance, 'a');
    await service.tick();
    expect(slots).toHaveLength(1);

    slots[0].acquiredAt = new Date(
      Date.now() - MODEL_CONCURRENCY_SLOT_GRACE_MS - 1000,
    );
    await service.tick();
    expect(slots).toHaveLength(0);
  });

  it('补回丢了的排队登记，已拿到名额的不补', async () => {
    const { service, waiters } = buildService();
    await service.setLimit(seedance, 1);
    await service.admit('video', seedance, 'a');
    await service.ensureWaiting('video', seedance, 'a', new Date());
    await service.ensureWaiting('video', seedance, 'b', new Date());
    expect(waiters.map((row) => row.holder)).toEqual(['b']);
  });
});
