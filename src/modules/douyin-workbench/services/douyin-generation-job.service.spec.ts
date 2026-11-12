import { DouyinGenerationJobService } from './douyin-generation-job.service.js';

/**
 * @description 造一个带候选脚本、尚未处理的子选题任务的服务：仓库与任务集合都用内存桩，记录入库参数。
 * @keyword-cn 生成任务测试桩, 候选脚本任务
 * @keyword-en generation-job-test-stub, draft-job-fixture
 * @param productionMode 这批候选的制作方式。
 * @param productionStart 统一流程的起点（只有从脚本开始才记）。
 * @returns 服务、仓库桩与 start 间谍。
 */
function setup(
  productionMode?: 'storyboard' | 'store-visit',
  productionStart?: 'script',
) {
  const job = {
    id: 'job-1',
    kind: 'children',
    topicId: 7,
    status: 'done',
    progress: { stage: 'saving', current: 1 },
    ...(productionMode ? { productionMode } : {}),
    ...(productionStart ? { start: productionStart } : {}),
    result: {
      drafts: [
        { key: 'd1', title: '欢乐谷周末遛娃', script: '主题：亲子周末。' },
      ],
    },
    startedAt: new Date(),
    updatedAt: new Date(),
  };
  const collection = {
    createIndex: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(job),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const repository = {
    createChildren: jest.fn(
      async (
        _parentId: number,
        candidates: Array<{ title: string; productionMode?: string }>,
      ) =>
        candidates.map((candidate, index) => ({
          id: 100 + index,
          kind: 'child',
          title: candidate.title,
          ...(candidate.productionMode === 'store-visit'
            ? { productionMode: 'store-visit' }
            : {}),
        })),
    ),
  };
  const queue = { registerLane: jest.fn() };
  const service = new DouyinGenerationJobService(
    { collection: () => collection } as never,
    repository as never,
    {} as never,
    {} as never,
    queue as never,
    { getDouyinGenerationConcurrencyLimits: jest.fn() } as never,
    {} as never,
  );
  const start = jest
    .spyOn(service, 'start')
    .mockResolvedValue({ id: 'storyboard-job' } as never);
  return { service, repository, start, job };
}

describe('DouyinGenerationJobService.confirmDrafts', () => {
  const scope = { tenantId: 't1', userId: 'u1' };

  it('探店批次保存为探店脚本，不启动分镜任务', async () => {
    const { service, repository, start } = setup('store-visit');
    const result = await service.confirmDrafts(
      'job-1',
      [
        {
          key: 'd1',
          storyboardPreference: { imageSource: 'gallery', galleryTags: [] },
        },
      ],
      scope as never,
    );
    expect(repository.createChildren).toHaveBeenCalledWith(
      7,
      [
        expect.objectContaining({
          title: '欢乐谷周末遛娃',
          script: '主题：亲子周末。',
          productionMode: 'store-visit',
        }),
      ],
      scope,
    );
    expect(start).not.toHaveBeenCalled();
    expect(result.jobs).toEqual([]);
  });

  it('从脚本开始的批次入库时带上起点，同样不启动分镜任务', async () => {
    const { service, repository, start } = setup('store-visit', 'script');
    await service.confirmDrafts('job-1', [{ key: 'd1' }], scope as never);
    expect(repository.createChildren.mock.calls[0][1][0]).toMatchObject({
      productionMode: 'store-visit',
      start: 'script',
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('分镜批次照旧逐条启动分镜任务', async () => {
    const { service, repository, start } = setup();
    const result = await service.confirmDrafts(
      'job-1',
      [
        {
          key: 'd1',
          storyboardPreference: { imageSource: 'gallery', galleryTags: [] },
        },
      ],
      scope as never,
    );
    expect(
      repository.createChildren.mock.calls[0][1][0].productionMode,
    ).toBeUndefined();
    expect(start).toHaveBeenCalledWith('storyboard', 100, undefined, scope);
    expect(result.jobs).toHaveLength(1);
  });

  it('还原批次人物音色，逐条取消时保留显式空值，不回退成批次选择', async () => {
    const { service, repository, job } = setup('store-visit');
    Object.assign(job, {
      personaId: 42,
      voiceId: 'longanyang',
      scriptStyle: 'cinematic',
    });
    await service.confirmDrafts('job-1', [{ key: 'd1' }], scope);
    expect(repository.createChildren.mock.calls[0][1][0]).toMatchObject({
      personaId: 42,
      voiceId: 'longanyang',
      scriptStyle: 'cinematic',
    });
    await service.confirmDrafts(
      'job-1',
      [{ key: 'd1', personaId: 0, voiceId: '', scriptStyle: '' }],
      scope,
    );
    expect(repository.createChildren.mock.calls[1][1][0]).toMatchObject({
      personaId: 0,
      voiceId: '',
      scriptStyle: '',
    });
  });
});
