import { ConflictException } from '@nestjs/common';
import type {
  DouyinStoreVisitSegment,
  DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import { DouyinStoreVisitPipelineService } from './douyin-store-visit-pipeline.service.js';

const scope = { tenantId: 'tenant-1', userId: 'user-1' };

type Op = {
  id: string;
  segmentId: string;
  status: 'queued' | 'running' | 'saving' | 'completed' | 'failed';
  request: Record<string, unknown>;
  error?: string;
};

/**
 * @description 按点号路径读对象里的值。
 * @keyword-cn 点号路径取值, 测试桩
 * @keyword-en read-dotted-path, test-stub
 */
function readPath(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | undefined)?.[key],
      source,
    );
}

/**
 * @description 内存版的 Mongo 条件判断：只支持流水线用到的相等、`$exists`、`$lt`、`$in` 与 `$or`。
 * @keyword-cn 内存条件匹配, 测试桩
 * @keyword-en in-memory-filter, test-stub
 */
function matchesFilter(
  source: unknown,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or')
      return (expected as Record<string, unknown>[]).some((item) =>
        matchesFilter(source, item),
      );
    const actual = readPath(source, key);
    if (expected instanceof Date)
      return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === 'object') {
      const rule = expected as Record<string, unknown>;
      if ('$exists' in rule) return (actual !== undefined) === rule.$exists;
      if ('$lt' in rule)
        return actual instanceof Date && actual < (rule.$lt as Date);
      if ('$in' in rule) return (rule.$in as unknown[]).includes(actual);
      return false;
    }
    return actual === expected;
  });
}

/**
 * @description 构造流水线服务：选题与调用记录都在内存里，提交单段时新建一条排队中的调用（快照为当前内容）。
 * @keyword-cn 流水线测试桩, 内存选题
 * @keyword-en pipeline-service-stub, in-memory-topic
 */
function build(segments: DouyinStoreVisitSegment[]) {
  const topic = {
    id: 5,
    kind: 'child',
    tenantId: scope.tenantId,
    userId: scope.userId,
    storeVisit: { voiceId: 'voice-1', segments },
  } as unknown as DouyinTopicEntity;
  const ops: Op[] = [];
  const clone = () => structuredClone(topic);
  const repository = {
    get: jest.fn(async () => clone()),
    setStoreVisitPipeline: jest.fn(
      async (
        _id: number,
        patch: Record<string, unknown>,
        _scope: unknown,
        expect?: Record<string, unknown>,
      ) => {
        if (expect && !matchesFilter(topic, expect)) return null;
        const pipeline = ((
          topic.storeVisit as Record<string, unknown>
        ).pipeline ??= { updatedAt: new Date() }) as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete pipeline[key];
          else pipeline[key] = value;
        }
        return clone();
      },
    ),
    updateStoreVisitSegment: jest.fn(
      async (_id: number, segmentId: string, patch: unknown) => {
        const segment = topic.storeVisit!.segments!.find(
          (item) => item.id === segmentId,
        )!;
        if (patch === null) {
          delete segment.videoId;
          delete segment.nativeAudio;
        }
        return clone();
      },
    ),
    update: jest.fn(async (_id: number, input: Record<string, unknown>) =>
      Object.assign(topic, input),
    ),
    listRunningStoreVisitPipelines: jest.fn(async () =>
      topic.storeVisit?.pipeline?.state === 'running' ? [clone()] : [],
    ),
  };
  const collection = {
    findOne: jest.fn(async (filter: Record<string, unknown>) => {
      const found = ops.find((op) => {
        if (filter.id && op.id !== filter.id) return false;
        const status = filter.status as { $in: string[] } | undefined;
        if (status && !status.$in.includes(op.status)) return false;
        const ids = filter.segmentId as { $in: string[] } | undefined;
        return !ids || ids.$in.includes(op.segmentId);
      });
      return found ?? null;
    }),
  };
  const storeVisit = {
    startSingle: jest.fn(async (_id: number, segmentId: string) => {
      const segment = topic.storeVisit!.segments!.find(
        (item) => item.id === segmentId,
      )!;
      const op: Op = {
        id: `op-${ops.length + 1}`,
        segmentId,
        status: 'queued',
        request: {
          lines: segment.lines,
          sceneImageId: segment.sceneImageId,
          sceneImageIds: [],
          clipStart: 0,
          action: '',
          shot: segment.shot || 'broll',
          voiceId: 'voice-1',
        },
      };
      ops.push(op);
      return { id: op.id, segmentId };
    }),
  };
  const service = new DouyinStoreVisitPipelineService(
    { collection: () => collection } as never,
    repository as never,
    storeVisit as never,
  );
  /** 让某段的调用出片并绑定到分段。 */
  const complete = (segmentId: string) => {
    const op = ops.filter((item) => item.segmentId === segmentId).at(-1)!;
    op.status = 'completed';
    const segment = topic.storeVisit!.segments!.find(
      (item) => item.id === segmentId,
    )!;
    segment.videoId = 100 + ops.indexOf(op);
    segment.nativeAudio = true;
  };
  return { service, topic, ops, repository, storeVisit, complete };
}

const threeSegments = (): DouyinStoreVisitSegment[] => [
  { id: 'a', lines: '开场', sceneImageId: 11 },
  { id: 'b', lines: '门口接着说', sceneImageId: 11 },
  { id: 'c', lines: '吧台', sceneImageId: 21 },
];

describe('探店 AI 导演流水线', () => {
  it('一次只提交一段：前一段出完才接下一段，巡检按选题的租户用户推进', async () => {
    const { service, topic, storeVisit, complete } = build(threeSegments());
    await service.start(5, scope, { voiceAnchor: true });
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(1);
    expect(storeVisit.startSingle).toHaveBeenCalledWith(5, 'a', scope, {
      voiceAnchor: true,
    });
    expect(topic.storeVisit?.pipeline).toMatchObject({
      state: 'running',
      currentSegmentId: 'a',
      currentOperationId: 'op-1',
    });
    expect(topic.storeVisit?.pipeline?.advancingAt).toBeUndefined();
    await service.tickOnce();
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(1);
    complete('a');
    await service.tickOnce();
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(2);
    expect(storeVisit.startSingle).toHaveBeenLastCalledWith(5, 'b', scope, {
      voiceAnchor: true,
    });
  });

  it('暂停后在跑的那段跑完也不接下一段，手动继续后才接着生成', async () => {
    const { service, topic, storeVisit, complete } = build(threeSegments());
    await service.start(5, scope);
    await service.pause(5, 'editing', scope);
    complete('a');
    await service.advance(5, scope);
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(1);
    expect(topic.storeVisit?.pipeline).toMatchObject({
      state: 'paused',
      pauseReason: 'editing',
    });
    await service.resume(5, scope);
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(2);
    expect(storeVisit.startSingle).toHaveBeenLastCalledWith(
      5,
      'b',
      scope,
      expect.anything(),
    );
    expect(topic.storeVisit?.pipeline?.pauseReason).toBeUndefined();
  });

  it('当前段按原内容失败时暂停并带原因，继续后重试这一段', async () => {
    const { service, topic, ops, storeVisit } = build(threeSegments());
    await service.start(5, scope);
    ops[0].status = 'failed';
    ops[0].error = '视频模型超时';
    await service.advance(5, scope);
    expect(topic.storeVisit?.pipeline).toMatchObject({
      state: 'paused',
      pauseReason: 'failed',
      error: '视频模型超时',
    });
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(1);
    await service.resume(5, scope);
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(2);
    expect(storeVisit.startSingle).toHaveBeenLastCalledWith(
      5,
      'a',
      scope,
      expect.anything(),
    );
    expect(topic.storeVisit?.pipeline).toMatchObject({
      state: 'running',
      currentOperationId: 'op-2',
    });
    expect(topic.storeVisit?.pipeline?.error).toBeUndefined();
  });

  it('生成期间这段被改过而作废的不算失败，按最新内容重新提交', async () => {
    const { service, topic, ops, storeVisit } = build(threeSegments());
    await service.start(5, scope);
    topic.storeVisit!.segments![0].lines = '改过的开场';
    ops[0].status = 'failed';
    await service.advance(5, scope);
    expect(topic.storeVisit?.pipeline?.state).toBe('running');
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(2);
    expect(storeVisit.startSingle).toHaveBeenLastCalledWith(
      5,
      'a',
      scope,
      expect.anything(),
    );
  });

  it('提交被拦下（如素材没说明）时暂停并记下原因', async () => {
    const { service, topic, storeVisit } = build(threeSegments());
    storeVisit.startSingle.mockRejectedValueOnce(
      new Error('素材「门头」还没写说明'),
    );
    await service.start(5, scope);
    expect(topic.storeVisit?.pipeline).toMatchObject({
      state: 'paused',
      pauseReason: 'failed',
      error: '素材「门头」还没写说明',
      currentSegmentId: 'a',
    });
  });

  it('AI 导演还在规划时等，规划卡住超过时限就不再等', async () => {
    const { service, topic, storeVisit } = build(threeSegments());
    topic.videoDirection = {
      status: 'planning',
      fingerprint: 'f',
      shots: {},
      updatedAt: new Date(),
    };
    await service.start(5, scope);
    expect(storeVisit.startSingle).not.toHaveBeenCalled();
    expect(topic.storeVisit?.pipeline?.state).toBe('running');
    topic.videoDirection.updatedAt = new Date(Date.now() - 10 * 60_000);
    await service.advance(5, scope);
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(1);
  });

  it('全部出完置为完成并打开自动拼接；各段都已出片时开始生成直接完成', async () => {
    const { service, topic, storeVisit, complete } = build([
      { id: 'a', lines: '开场', sceneImageId: 11 },
    ]);
    await service.start(5, scope);
    complete('a');
    await service.advance(5, scope);
    expect(topic.storeVisit?.pipeline?.state).toBe('done');
    expect(topic.autoConcatShots).toBe(true);
    topic.autoConcatShots = false;
    await service.start(5, scope);
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(1);
    expect(topic.storeVisit?.pipeline?.state).toBe('done');
    expect(topic.autoConcatShots).toBe(true);
  });

  it('重做某段：清掉它与接它尾帧的续段，已完成的导演回到生成中按顺序重做', async () => {
    const { service, topic, storeVisit, complete } = build(threeSegments());
    await service.start(5, scope);
    complete('a');
    await service.advance(5, scope);
    complete('b');
    await service.advance(5, scope);
    complete('c');
    await service.advance(5, scope);
    expect(topic.storeVisit?.pipeline?.state).toBe('done');
    await service.redo(5, 'a', scope);
    const [a, b, c] = topic.storeVisit!.segments!;
    expect(b.videoId).toBeUndefined();
    expect(c.videoId).toBeDefined();
    expect(a.videoId).toBeUndefined();
    expect(topic.storeVisit?.pipeline).toMatchObject({
      state: 'running',
      currentSegmentId: 'a',
    });
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(4);
  });

  it('暂停中重做只排进去不开跑；这段还在生成时不能重做', async () => {
    const { service, topic, storeVisit, complete } = build(threeSegments());
    await service.start(5, scope);
    await expect(service.redo(5, 'a', scope)).rejects.toThrow(
      ConflictException,
    );
    complete('a');
    await service.pause(5, 'user', scope);
    await service.redo(5, 'a', scope);
    expect(topic.storeVisit!.segments![0].videoId).toBeUndefined();
    expect(topic.storeVisit?.pipeline?.state).toBe('paused');
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(1);
  });

  it('并发推进只提交一次；全部重新生成时还有段在跑就拒绝', async () => {
    const { service, storeVisit, complete } = build(threeSegments());
    await service.start(5, scope);
    complete('a');
    await Promise.all([
      service.advance(5, scope),
      service.advance(5, scope),
      service.tickOnce(),
    ]);
    expect(storeVisit.startSingle).toHaveBeenCalledTimes(2);
    await expect(service.start(5, scope, { restart: true })).rejects.toThrow(
      ConflictException,
    );
  });
});
