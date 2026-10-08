import { resolveMemoryPlan } from './cluster-memory';

describe('resolveMemoryPlan', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('按配置预算的 60% 平分给 worker 当堆上限', () => {
    process.env.CLUSTER_MEMORY_BUDGET_MB = '8000';
    delete process.env.WORKER_MAX_OLD_SPACE_MB;
    expect(resolveMemoryPlan(2)).toEqual({
      budgetMb: 8000,
      source: 'env',
      requestedWorkers: 2,
      workers: 2,
      heapMbPerWorker: 2400,
      rssWarnMbPerWorker: 3600,
    });
  });

  it('预算不够时减少 worker 数，而不是开一堆堆上限过小的进程', () => {
    process.env.CLUSTER_MEMORY_BUDGET_MB = '1000';
    delete process.env.WORKER_MAX_OLD_SPACE_MB;
    const plan = resolveMemoryPlan(4);
    expect(plan.workers).toBe(1);
    expect(plan.heapMbPerWorker).toBe(600);
  });

  it('堆上限封顶 4096MB，也可以直接指定', () => {
    process.env.CLUSTER_MEMORY_BUDGET_MB = '64000';
    delete process.env.WORKER_MAX_OLD_SPACE_MB;
    expect(resolveMemoryPlan(2).heapMbPerWorker).toBe(4096);
    process.env.WORKER_MAX_OLD_SPACE_MB = '700';
    expect(resolveMemoryPlan(2).heapMbPerWorker).toBe(700);
  });

  it('没有配置时取容器上限或整机一半', () => {
    delete process.env.CLUSTER_MEMORY_BUDGET_MB;
    delete process.env.WORKER_MAX_OLD_SPACE_MB;
    const plan = resolveMemoryPlan(2);
    expect(['container', 'host']).toContain(plan.source);
    expect(plan.budgetMb).toBeGreaterThan(0);
  });
});
