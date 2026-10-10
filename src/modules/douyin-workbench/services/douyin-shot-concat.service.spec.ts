import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Db } from 'mongodb';
import { DouyinShotConcatService } from './douyin-shot-concat.service.js';
import type { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type Row = Record<string, any>;

/**
 * @description 只实现本服务用到的查询写法的内存集合（等值、`$lt` 日期比较）。
 * @keyword-cn 内存集合, 测试替身
 * @keyword-en in-memory-collection, test-double
 */
function memoryOperations(rows: Row[]) {
  /** @description 匹配等值、日期与集合查询。 @keyword-cn 匹配测试查询, 内存集合 @keyword-en match-test-query, in-memory-collection */
  const matches = (row: Row, filter: Row) =>
    Object.entries(filter).every(([key, value]) =>
      value && typeof value === 'object' && '$lt' in value
        ? row[key] < value.$lt
        : value && typeof value === 'object' && '$in' in value
          ? value.$in.includes(row[key])
          : row[key] === value,
    );
  return {
    rows,
    findOne: async (filter: Row) =>
      rows.find((row) => matches(row, filter)) ?? null,
    insertOne: async (doc: Row) => {
      rows.push({ ...doc });
    },
    updateOne: async (filter: Row, update: Row) => {
      const row = rows.find((item) => matches(item, filter));
      if (row) Object.assign(row, update.$set);
    },
    updateMany: async (filter: Row, update: Row) => {
      rows
        .filter((item) => matches(item, filter))
        .forEach((row) => Object.assign(row, update.$set));
    },
  };
}

const scope = { tenantId: 't1', userId: 'u1' };

/**
 * @description 构造带内存集合与假仓储的服务。
 * @keyword-cn 构造测试服务, 假仓储
 * @keyword-en build-test-service, fake-repository
 */
function build(topic: Row, rows: Row[] = []) {
  const operations = memoryOperations(rows);
  const repository = {
    get: jest.fn(async () => topic),
    requireVideo: jest.fn(async (id: number) => ({
      id,
      url: `https://cdn/v${id}.mp4`,
      durationMs: 9000,
    })),
    update: jest.fn(async () => topic),
    claimAutoConcat: jest.fn(async () => {
      const had = Boolean(topic.autoConcatShots);
      topic.autoConcatShots = undefined;
      return had;
    }),
  };
  const service = new DouyinShotConcatService(
    { collection: () => operations } as unknown as Db,
    repository as unknown as DouyinWorkbenchRepositoryService,
  );
  return { service, repository, operations };
}

/** @description 建立已出片的两镜脚本。 @keyword-cn 就绪脚本, 测试素材 @keyword-en ready-topic, test-media */
const readyTopic = () => ({
  id: 7,
  kind: 'child',
  title: '脚本',
  storyboard: [
    { id: 's1', duration: 3, videoId: 11 },
    { id: 's2', duration: 4, videoId: 12 },
  ],
});

describe('DouyinShotConcatService（客户端合成）', () => {
  it('还有分镜没出片时拒绝', async () => {
    const topic = readyTopic();
    topic.storyboard[1].videoId = undefined as unknown as number;
    const { service } = build(topic);
    await expect(service.prepare(7, scope)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('按分镜顺序返回片段地址，写运行中记录，手动合成顺带清掉自动合成标记', async () => {
    const topic = { ...readyTopic(), autoConcatShots: true };
    const { service, operations } = build(topic);
    const result = await service.prepare(7, scope);
    expect(
      result.clips.map((clip) => [
        clip.shotIndex,
        clip.videoId,
        clip.url,
        clip.fallbackSeconds,
      ]),
    ).toEqual([
      [1, 11, 'https://cdn/v11.mp4', 3],
      [2, 12, 'https://cdn/v12.mp4', 4],
    ]);
    expect(result.operation).toMatchObject({
      provider: 'client',
      mode: 'concat',
      status: 'running',
    });
    expect(operations.rows).toHaveLength(1);
    expect(topic.autoConcatShots).toBeUndefined();
  });

  it('探店模式按分段顺序合成，分段还在生成时冲突', async () => {
    const topic = {
      id: 7,
      kind: 'child',
      title: '探店',
      productionMode: 'store-visit',
      storyboard: [],
      storeVisit: {
        segments: [
          { id: 'g1', lines: '今天带大家来到这家咖啡店', videoId: 21 },
          { id: 'g2', lines: '招牌拿铁', videoId: 22 },
        ],
      },
    };
    const busy = build(topic, [
      {
        topicId: 7,
        operation: 'generate',
        segmentId: 'g2',
        status: 'running',
        tenantId: 't1',
        userId: 'u1',
      },
    ]);
    await expect(busy.service.prepare(7, scope)).rejects.toThrow(
      '探店分段正在生成',
    );
    const { service, operations } = build(topic);
    const result = await service.prepare(7, scope);
    expect(
      result.clips.map((clip) => [
        clip.shotId,
        clip.videoId,
        clip.fallbackSeconds,
      ]),
    ).toEqual([
      ['g1', 21, 3],
      ['g2', 22, 2],
    ]);
    expect(operations.rows[0].request).toMatchObject({
      segmentIds: ['g1', 'g2'],
    });
  });

  it('探店分段没出片时按段提示', async () => {
    const { service } = build({
      id: 7,
      kind: 'child',
      productionMode: 'store-visit',
      storyboard: [],
      storeVisit: { segments: [{ id: 'g1', lines: '台词' }] },
    });
    await expect(service.prepare(7, scope)).rejects.toThrow('第 1 段');
  });

  it('自动合成要先领到标记，领不到（已被处理或取消）时冲突', async () => {
    const { service } = build(readyTopic());
    await expect(service.prepare(7, scope, { auto: true })).rejects.toThrow(
      ConflictException,
    );
  });

  it('同一脚本正在合成时冲突', async () => {
    const { service } = build(readyTopic());
    await service.prepare(7, scope);
    await expect(service.prepare(7, scope)).rejects.toThrow(ConflictException);
  });

  it('重生成中的分镜仍有旧视频时禁止领取合成，保留自动合成预约', async () => {
    const topic = { ...readyTopic(), autoConcatShots: true };
    const { service, operations } = build(topic, [
      {
        topicId: 7,
        operation: 'generate',
        shotId: 's1',
        status: 'saving',
        tenantId: 't1',
        userId: 'u1',
      },
    ]);
    await expect(service.prepare(7, scope, { auto: true })).rejects.toThrow(
      ConflictException,
    );
    expect(topic.autoConcatShots).toBe(true);
    expect(operations.rows).toHaveLength(1);
  });

  it('过期客户端合成收为失败，仍在回报的合成保持运行', async () => {
    const stale = {
      provider: 'client',
      mode: 'concat',
      status: 'running',
      updatedAt: new Date(Date.now() - 31 * 60 * 1000),
    };
    const active = { ...stale, updatedAt: new Date() };
    const { service } = build(readyTopic(), [stale, active]);
    await service.settleStale();
    expect(stale.status).toBe('failed');
    expect(active.status).toBe('running');
  });

  it('回报完成后设为当前整片并记下结果，结束后的回报被拒绝', async () => {
    const { service, repository } = build(readyTopic());
    const { operation } = await service.prepare(7, scope);
    await service.report(
      operation.id,
      { status: 'running', progress: 150 },
      scope,
    );
    const done = await service.report(
      operation.id,
      { status: 'completed', videoId: 99 },
      scope,
    );
    expect(repository.update).toHaveBeenCalledWith(
      7,
      { generatedVideoId: 99 },
      scope,
    );
    expect(done).toMatchObject({
      status: 'completed',
      progress: 100,
      result: { videoId: 99, shotCount: 2, duration: 9 },
    });
    await expect(
      service.report(operation.id, { status: 'failed', error: 'x' }, scope),
    ).rejects.toThrow(ConflictException);
  });

  it('回报失败写中文原因，完成却没给视频 ID 时拒绝', async () => {
    const { service } = build(readyTopic());
    const { operation } = await service.prepare(7, scope);
    await expect(
      service.report(operation.id, { status: 'completed' }, scope),
    ).rejects.toThrow(BadRequestException);
    const failed = await service.report(
      operation.id,
      {
        status: 'failed',
        error: '第 1 镜的分镜视频下载失败',
        errorDetail: 'HTTP 404',
      },
      scope,
    );
    expect(failed).toMatchObject({
      status: 'failed',
      error: '第 1 镜的分镜视频下载失败',
      errorDetail: 'HTTP 404',
    });
  });
});
