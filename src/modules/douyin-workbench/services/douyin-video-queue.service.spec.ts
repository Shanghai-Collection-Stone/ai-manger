import type { Db } from 'mongodb';
import {
  DouyinVideoQueueService,
  isOccupyingVideoModel,
  readQueuedShotRequest,
} from './douyin-video-queue.service';
import type { DouyinOperationEntity } from '../entities/douyin-workbench.entity';

type Row = Record<string, any>;

/**
 * @description 读点号路径的字段（`queue.stage`）。
 * @keyword-cn 读取点号路径, 测试替身
 * @keyword-en read-dotted-path, test-double
 */
function readPath(row: Row, path: string): unknown {
  return path.split('.').reduce<any>((value, key) => value?.[key], row);
}

/**
 * @description 按点号路径写字段。
 * @keyword-cn 写入点号路径, 测试替身
 * @keyword-en write-dotted-path, test-double
 */
function writePath(row: Row, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  const target = keys.reduce<any>((node, key) => (node[key] ??= {}), row);
  target[last] = value;
}

/**
 * @description 判断一行是否命中查询：相等、`$in`、`$exists`、`$lt`，支持点号路径。
 * @keyword-cn 内存查询匹配, 点号路径
 * @keyword-en memory-filter-match, dotted-path
 */
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const value = readPath(row, key);
    if (
      expected &&
      typeof expected === 'object' &&
      !(expected instanceof Date)
    ) {
      if ('$in' in expected) return expected.$in.includes(value);
      if ('$exists' in expected)
        return (value !== undefined) === expected.$exists;
      if ('$lt' in expected) return (value as Date) < expected.$lt;
    }
    return value === expected;
  });
}

/**
 * @description 抖音调用集合替身：只实现排队服务用到的方法。
 * @keyword-cn 调用集合替身, 内存记录
 * @keyword-en operation-collection-double, memory-rows
 */
function memoryOperations(rows: Row[]) {
  const apply = (row: Row, update: { $set?: Row; $unset?: Row }) => {
    for (const [key, value] of Object.entries(update.$set ?? {}))
      writePath(row, key, value);
    for (const key of Object.keys(update.$unset ?? {})) delete row[key];
  };
  return {
    findOne: async (filter: Row) =>
      rows.find((row) => matches(row, filter)) ?? null,
    find: (filter: Row) => ({
      limit: () => ({
        toArray: async () => rows.filter((row) => matches(row, filter)),
      }),
      toArray: async () => rows.filter((row) => matches(row, filter)),
    }),
    insertOne: async (doc: Row) => {
      rows.push(doc);
    },
    updateOne: async (filter: Row, update: { $set?: Row; $unset?: Row }) => {
      const row = rows.find((item) => matches(item, filter));
      if (row) apply(row, update);
    },
    findOneAndUpdate: async (filter: Row, update: { $set?: Row }) => {
      const row = rows.find((item) => matches(item, filter));
      if (!row) return null;
      apply(row, update);
      return row;
    },
  };
}

/**
 * @description 构造排队服务：内存调用记录、记录注册种类的并发服务替身、脚本与提供商替身。
 * @keyword-cn 构造排队测试服务, 并发服务替身
 * @keyword-en build-video-queue-service, concurrency-double
 */
function buildService(rows: Row[]) {
  const concurrency = {
    registerKind: jest.fn(),
    admit: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
    ensureWaiting: jest.fn().mockResolvedValue(undefined),
    positions: jest.fn().mockResolvedValue(new Map()),
  };
  const repository = {
    get: jest.fn().mockResolvedValue({ id: 7, kind: 'child', storyboard: [] }),
  };
  const adminService = {
    getAiProviderRuntimeById: jest.fn().mockResolvedValue({
      providerId: 'p1',
      providerCode: 'shuyan',
      name: '数眼',
      modelCategory: 'video',
      model: 'default-model',
      baseUrl: 'https://platform.shuyanai.com/v1',
      apiKey: 'sk-1',
    }),
  };
  const db = { collection: () => memoryOperations(rows) } as unknown as Db;
  const service = new DouyinVideoQueueService(
    db,
    concurrency as never,
    repository as never,
    adminService as never,
  );
  return { service, concurrency, repository };
}

/**
 * @description 一条等模型空位的分镜调用记录。
 * @keyword-cn 排队分镜记录, 测试数据
 * @keyword-en queued-shot-row, fixture
 */
function waitingRow(extra: Row = {}): Row {
  return {
    id: 'op-1',
    operation: 'generate',
    topicId: 7,
    shotId: 's1',
    provider: 'shuyan',
    mode: 'shot',
    model: 'doubao-seedance-2-0-260128',
    providerId: 'p1',
    userId: 'u1',
    tenantId: 't1',
    request: {},
    status: 'queued',
    queue: {
      stage: 'waiting',
      enqueuedAt: new Date(),
      input: { prompt: '多给特写' },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

describe('DouyinVideoQueueService 抖音视频按模型排队', () => {
  it('构造时向模型并发登记注册抖音视频种类', () => {
    const { concurrency } = buildService([]);
    expect(concurrency.registerKind).toHaveBeenCalledWith(
      'douyin-video',
      expect.objectContaining({
        dispatch: expect.any(Function),
        inspect: expect.any(Function),
      }),
    );
  });

  it('轮到时按记录的提供商与模型重建运行配置，交回对应通道提交', async () => {
    const rows = [waitingRow()];
    const { service } = buildService(rows);
    let request: ReturnType<typeof readQueuedShotRequest> | undefined;
    const submitter = jest.fn(async ({ row }) => {
      request = readQueuedShotRequest(row);
      await service.save(
        { ...row, status: 'queued', externalId: 'task-1' } as never,
        true,
      );
    });
    service.register('shuyan', submitter);

    expect(await service.dispatch('op-1')).toBe(true);
    const call = submitter.mock.calls[0][0];
    expect(call.runtime).toEqual(
      expect.objectContaining({
        providerId: 'p1',
        providerCode: 'shuyan',
        model: 'doubao-seedance-2-0-260128',
        apiKey: 'sk-1',
      }),
    );
    expect(call.scope).toEqual({ userId: 'u1', tenantId: 't1' });
    expect(request).toEqual({
      mode: 'shot',
      shotId: 's1',
      prompt: '多给特写',
    });
    expect(rows[0].queue).toBeUndefined();
    expect(rows[0].externalId).toBe('task-1');
  });

  it('通道提交前就报错时把排队记录判失败并归还名额', async () => {
    const rows = [waitingRow()];
    const { service } = buildService(rows);
    service.register('shuyan', async () => {
      throw new Error('DOUYIN_STORYBOARD_SHOT_NOT_FOUND');
    });

    expect(await service.dispatch('op-1')).toBe(false);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: '排队后提交失败：DOUYIN_STORYBOARD_SHOT_NOT_FOUND',
      }),
    );
    expect(rows[0].queue).toBeUndefined();
  });

  it('脚本已删除时判失败，不调用通道', async () => {
    const rows = [waitingRow()];
    const { service, repository } = buildService(rows);
    repository.get.mockResolvedValue(null);
    const submitter = jest.fn();
    service.register('shuyan', submitter);

    expect(await service.dispatch('op-1')).toBe(false);
    expect(submitter).not.toHaveBeenCalled();
    expect(rows[0].error).toBe('排队后提交失败：脚本已删除');
  });

  it('记录已不在排队（被取消或已提交）时不再提交', async () => {
    const rows = [waitingRow({ status: 'failed' })];
    const { service } = buildService(rows);
    const submitter = jest.fn();
    service.register('shuyan', submitter);
    expect(await service.dispatch('op-1')).toBe(false);
    expect(submitter).not.toHaveBeenCalled();
  });

  it('探店分段统一交给探店通道', async () => {
    const rows = [waitingRow({ mode: 'store-visit', segmentId: 'seg-1' })];
    const { service } = buildService(rows);
    const storeVisit = jest.fn().mockResolvedValue(undefined);
    const shuyan = jest.fn();
    service.register('store-visit', storeVisit);
    service.register('shuyan', shuyan);
    await service.dispatch('op-1');
    expect(storeVisit).toHaveBeenCalled();
    expect(shuyan).not.toHaveBeenCalled();
  });

  it('排队或生成中且不在对口型阶段才算占着模型', () => {
    expect(isOccupyingVideoModel({ status: 'running' })).toBe(true);
    expect(isOccupyingVideoModel({ status: 'queued' })).toBe(true);
    expect(isOccupyingVideoModel({ status: 'saving' })).toBe(false);
    expect(isOccupyingVideoModel({ status: 'completed' })).toBe(false);
    expect(
      isOccupyingVideoModel({
        status: 'running',
        lipSync: { stage: 'syncing' },
      } as Pick<DouyinOperationEntity, 'status' | 'lipSync'>),
    ).toBe(false);
  });

  it('巡检把提交中断的记录判失败，还在等的补回排队登记', async () => {
    const rows = [
      waitingRow({
        id: 'stuck',
        queue: {
          stage: 'submitting',
          enqueuedAt: new Date(),
          submittingAt: new Date(Date.now() - 11 * 60 * 1000),
          input: {},
        },
      }),
      waitingRow({ id: 'waiting' }),
    ];
    const { service, concurrency } = buildService(rows);
    await service.recover();
    expect(rows[0].status).toBe('failed');
    expect(concurrency.release).toHaveBeenCalledWith('stuck');
    expect(concurrency.ensureWaiting).toHaveBeenCalledWith(
      'douyin-video',
      { providerId: 'p1', model: 'doubao-seedance-2-0-260128' },
      'waiting',
      rows[1].queue.enqueuedAt,
    );
  });
});
