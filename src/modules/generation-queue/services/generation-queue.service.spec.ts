import { GenerationQueueCore } from './generation-queue-core';
import { GenerationQueueService } from './generation-queue.service';

/** 让排队调度（串行 Promise 链与上限读取）跑完 */
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('GenerationQueueService（单进程）', () => {
  it('全平台上限内立即放行，超出排队，释放后按先后补位', async () => {
    const queue = new GenerationQueueService();
    queue.registerLane('lane', () =>
      Promise.resolve({ globalLimit: 2, tenantLimit: 5 }),
    );
    const order: string[] = [];
    const releases: Array<() => void> = [];
    for (const name of ['a', 'b', 'c', 'd']) {
      void queue.acquire('lane', 't1', name).then((release) => {
        order.push(name);
        releases.push(release);
      });
    }
    await flush();
    expect(order).toEqual(['a', 'b']);
    await expect(queue.snapshot('lane')).resolves.toEqual({
      running: 2,
      waiting: 2,
    });
    await expect(queue.activeState('lane', 'c')).resolves.toBe('queued');
    await expect(queue.activeState('lane', 'a')).resolves.toBe('running');
    releases[0]();
    releases[0]();
    await flush();
    expect(order).toEqual(['a', 'b', 'c']);
    await expect(queue.activeState('lane', 'a')).resolves.toBeNull();
    await expect(queue.activeKeys('lane')).resolves.toEqual(['b', 'c', 'd']);
  });

  it('上限读取失败时用保底值，run 结束自动释放', async () => {
    const queue = new GenerationQueueService();
    queue.registerLane('lane', () => Promise.reject(new Error('db down')));
    await expect(
      queue.run('lane', undefined, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    await expect(queue.snapshot('lane')).resolves.toEqual({
      running: 0,
      waiting: 0,
    });
  });

  it('未注册的通道直接报错', () => {
    expect(() => new GenerationQueueService().acquire('nope')).toThrow(
      'GENERATION_QUEUE_LANE_NOT_REGISTERED:nope',
    );
  });
});

describe('GenerationQueueCore（多进程时在主进程）', () => {
  const limits = { globalLimit: 3, tenantLimit: 1 };

  it('某租户占满时让后面其他租户先执行', () => {
    const core = new GenerationQueueCore();
    const granted = [
      ...core.enqueue({ ticketId: 'a1', lane: 'l', tenantKey: 'a' }, limits),
      ...core.enqueue({ ticketId: 'a2', lane: 'l', tenantKey: 'a' }, limits),
      ...core.enqueue({ ticketId: 'b1', lane: 'l', tenantKey: 'b' }, limits),
    ].map((ticket) => ticket.ticketId);
    expect(granted).toEqual(['a1', 'b1']);
    expect(core.release('a1').map((ticket) => ticket.ticketId)).toEqual(['a2']);
  });

  it('worker 退出时回收它持有的全部票据，名额让给其他进程', () => {
    const core = new GenerationQueueCore();
    const one = { globalLimit: 1, tenantLimit: 5 };
    core.enqueue(
      { ticketId: 'x', lane: 'l', tenantKey: 't', owner: 1, key: 'job-x' },
      one,
    );
    core.enqueue(
      { ticketId: 'y', lane: 'l', tenantKey: 't', owner: 2, key: 'job-y' },
      one,
    );
    expect(core.stateOf('l', 'job-x')).toBe('running');
    expect(core.stateOf('l', 'job-y')).toBe('queued');
    expect(core.releaseOwner(1).map((ticket) => ticket.ticketId)).toEqual([
      'y',
    ]);
    expect(core.stateOf('l', 'job-x')).toBeNull();
  });

  it('调高上限后立即补位', () => {
    const core = new GenerationQueueCore();
    const one = { globalLimit: 1, tenantLimit: 5 };
    core.enqueue({ ticketId: 'a', lane: 'l', tenantKey: 't' }, one);
    core.enqueue({ ticketId: 'b', lane: 'l', tenantKey: 't' }, one);
    expect(
      core
        .updateLimits('l', 't', { globalLimit: 2, tenantLimit: 5 })
        .map((ticket) => ticket.ticketId),
    ).toEqual(['b']);
  });
});
