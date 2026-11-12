import { ObjectId } from 'mongodb';
import type { DouyinTopicEntity } from '../entities/douyin-workbench.entity.js';
import {
  DouyinStoreVisitAutopilotService,
  DOUYIN_AUTOPILOT_CLAIM_MS,
} from './douyin-store-visit-autopilot.service.js';

/** @description 取内存 Mongo 桩的点号路径值。 @keyword-cn 托管测试取值, 嵌套字段 @keyword-en autopilot-test-value, nested-field */
function valueAt(record: any, path: string): any {
  return path.split('.').reduce((value, key) => value?.[key], record);
}
/** @description 模拟认领所需的 Mongo 条件，包括状态、租期与轮次。 @keyword-cn 托管测试过滤, 认领条件 @keyword-en autopilot-test-filter, claim-condition */
function matches(record: any, query: any): boolean {
  return Object.entries(query).every(([key, condition]: [string, any]) => {
    if (key === '$or')
      return condition.some((entry: any) => matches(record, entry));
    const actual = valueAt(record, key);
    if (
      condition &&
      typeof condition === 'object' &&
      !('_bsontype' in condition)
    ) {
      if ('$exists' in condition)
        return (actual !== undefined) === condition.$exists;
      if ('$lt' in condition)
        return (
          actual !== undefined &&
          new Date(actual).getTime() < new Date(condition.$lt).getTime()
        );
      if ('$ne' in condition) return actual !== condition.$ne;
    }
    return String(actual) === String(condition);
  });
}
/** @description 模拟 Mongo 的嵌套写入与清理。 @keyword-cn 托管测试写入, 认领释放 @keyword-en autopilot-test-write, release-test-claim */
function applyUpdate(record: any, update: any): void {
  for (const [operator, fields] of Object.entries(update) as Array<
    [string, Record<string, unknown>]
  >)
    for (const [path, value] of Object.entries(fields)) {
      const keys = path.split('.');
      const last = keys.pop()!;
      const target = keys.reduce(
        (current, key) => (current[key] ||= {}),
        record,
      );
      if (operator === '$unset') delete target[last];
      else target[last] = value;
    }
}

const scope = { tenantId: 'tenant', userId: 'owner' };
const body =
  '主题：周末亲子游。开场拍门头，中段介绍双人套餐 99 元和卡丁车，结尾引导查看团购套餐。';

/** @description 构造使用真实托管状态机的内存仓库，所有 AI 与出片操作使用记录副作用的桩。 @keyword-cn 托管状态机测试桩, 业务步骤替身 @keyword-en autopilot-state-fixture, workflow-step-double */
function setup(setting: Record<string, unknown> = {}) {
  const topic = {
    _id: new ObjectId(),
    id: 5,
    kind: 'child',
    productionMode: 'store-visit',
    userId: scope.userId,
    tenantId: scope.tenantId,
    title: '托管测试',
    storyboard: [],
    storeVisit: {
      start: 'script',
      script: body,
      template: 'voiceover',
      voiceId: 'selected-voice',
      ...setting,
    },
  } as unknown as DouyinTopicEntity;
  /** @description 返回独立读取快照，避免用共享对象掩盖并发错误。 @keyword-cn 托管读取快照, 并发测试 @keyword-en autopilot-read-snapshot, concurrency-test */
  function snapshot() {
    return { ...structuredClone(topic), _id: topic._id };
  }
  const topics = {
    updateOne: jest.fn(async (filter, update) => {
      if (!matches(topic, filter)) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(topic, update);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      if (!matches(topic, filter)) return null;
      applyUpdate(topic, update);
      return snapshot();
    }),
    find: jest.fn((filter) => ({
      toArray: async () => (matches(topic, filter) ? [snapshot()] : []),
    })),
  };
  const operations = { findOne: jest.fn().mockResolvedValue(null) };
  const repository = {
    get: jest.fn(async (id, owner) =>
      id === topic.id &&
      owner.userId === topic.userId &&
      owner.tenantId === topic.tenantId
        ? snapshot()
        : null,
    ),
    update: jest.fn(async (_id, input) => {
      if (input.personaId) topic.personaId = input.personaId;
      if (input.storeVisit) Object.assign(topic.storeVisit!, input.storeVisit);
      return snapshot();
    }),
  };
  const planner = {
    recommend: jest.fn().mockResolvedValue({
      persona: null,
      voice: {
        voiceId: 'longanyang',
        voiceName: '男声',
        voicePrompt: '年轻男声，清晰自然',
        reason: '适合当前脚本',
      },
    }),
    reviewScript: jest.fn().mockResolvedValue({ passed: true, issues: [] }),
    writeScript: jest.fn().mockResolvedValue({
      needsStore: true,
      storeQuestion: { question: '请确认拍摄哪家门店？' },
    }),
  };
  const scripts = {
    refineScript: jest.fn(async () => ({ script: body + '表达轻快自然。' })),
  };
  const agent = {
    videoOptions: jest.fn().mockResolvedValue({
      storeVisit: {
        voiceClone: { configured: true },
        video: { configured: true, durations: [15] },
        avatar: { configured: true, durations: [15] },
      },
    }),
    setCast: jest.fn(async (_id, input) => {
      topic.storeVisit!.voiceId = input.voiceId;
    }),
    writeScript: jest.fn(async () => {
      topic.storeVisit!.script = body;
      topic.storeVisit!.scriptNeedsRefine = false;
      return { script: body, review: { passed: true, issues: [] } };
    }),
    generateLines: jest.fn(async () => {
      topic.storeVisit!.segments = [
        { id: 'a', scene: '门头', lines: '双人套餐 99 元。', shot: 'broll' },
        {
          id: 'b',
          scene: '卡丁车',
          lines: '周末约上朋友来玩。',
          shot: 'broll',
        },
      ];
      topic.storeVisit!.linesScript = topic.storeVisit!.script;
    }),
    pickPictures: jest.fn(async () => {
      topic.storeVisit!.sceneImages = [
        { type: 'image', id: 31, name: '图1', url: '/31.jpg' },
      ];
      for (const segment of topic.storeVisit!.segments!)
        if (!segment.sceneImageId) segment.sceneImageId = 31;
    }),
    generatePictures: jest.fn(async (_id, input) => {
      const id = 40 + agent.generatePictures.mock.calls.length;
      topic.storeVisit!.sceneImages ||= [];
      topic.storeVisit!.sceneImages.push({
        type: 'image',
        id,
        name: 'AI 图',
        url: `/${id}.jpg`,
      });
      topic.storeVisit!.segments!.find(
        (segment) => segment.id === input.segmentId,
      )!.sceneImageId = id;
    }),
    matchScenes: jest.fn(),
    classifyStorePhotos: jest.fn().mockResolvedValue({ assigned: 0 }),
    generateStoreVisit: jest.fn(async () => {
      topic.storeVisit!.pipeline = { state: 'running', updatedAt: new Date() };
    }),
    requestMerge: jest.fn(async () => {
      topic.autoConcatShots = true;
    }),
  };
  const spots = {
    requireStore: jest.fn().mockResolvedValue({
      id: 7,
      spots: [{ id: 's', images: [{ imageId: 31 }] }],
    }),
  };
  const personas = { get: jest.fn().mockResolvedValue(null) };
  const pipeline = {
    pause: jest.fn(async () => {
      if (topic.storeVisit?.pipeline)
        topic.storeVisit.pipeline.state = 'paused';
    }),
  };
  /** @description 创建共享同一持久化数据的独立进程服务替身。 @keyword-cn 托管多进程替身, 共享任务仓库 @keyword-en autopilot-process-double, shared-task-store */
  function makeService() {
    return new DouyinStoreVisitAutopilotService(
      {
        collection: (name: string) =>
          name === 'douyin_topics' ? topics : operations,
      } as never,
      repository as never,
      agent as never,
      planner as never,
      scripts as never,
      spots as never,
      personas as never,
      pipeline as never,
    );
  }
  const service = makeService();
  /** @description 启动任务但关闭即时推进，测试逐次显式驱动每个步骤。 @keyword-cn 初始化测试托管, 显式推进步骤 @keyword-en begin-test-autopilot, explicit-step-driving */
  async function begin(input = {}) {
    const kick = jest.spyOn(service, 'advance').mockResolvedValue();
    await service.start(topic.id, input, scope);
    kick.mockRestore();
  }
  return {
    topic,
    service,
    begin,
    makeService,
    topics,
    operations,
    repository,
    agent,
    planner,
    scripts,
    spots,
    personas,
    pipeline,
  };
}

describe('Agent 全流程托管', () => {
  it('复用已有脚本与音色，逐步完成台词、画面、出片，拼接完成前不报成功', async () => {
    const { service, topic, begin, agent, planner } = setup();
    await begin();
    await service.advance(5, scope);
    expect(planner.reviewScript).toHaveBeenCalledTimes(1);
    expect(agent.writeScript).not.toHaveBeenCalled();
    expect(planner.recommend).not.toHaveBeenCalled();
    await service.advance(5, scope);
    expect(agent.generateLines).toHaveBeenCalledTimes(1);
    await service.advance(5, scope);
    expect(agent.pickPictures).toHaveBeenCalledWith(5, scope, {
      onlyMissing: true,
    });
    await service.advance(5, scope);
    expect(topic.storeVisit!.autopilot!.stage).toBe('voice');
    await service.advance(5, scope);
    await service.advance(5, scope);
    expect(agent.generateStoreVisit).toHaveBeenCalledTimes(1);
    topic.storeVisit!.pipeline!.state = 'done';
    topic.storeVisit!.segments!.forEach((segment, index) =>
      Object.assign(segment, { videoId: index + 10, nativeAudio: true }),
    );
    await service.advance(5, scope);
    expect(topic.storeVisit!.autopilot!.state).toBe('running');
    expect(agent.requestMerge).toHaveBeenCalledTimes(1);
    await service.advance(5, scope);
    expect(agent.requestMerge).toHaveBeenCalledTimes(1);
    topic.generatedVideoId = 99;
    await service.advance(5, scope);
    expect(topic.storeVisit!.autopilot!.state).toBe('done');
  });

  it('无音色时由 AI 补齐，旧正文按新设定微调，不改已有录音或定制音色', async () => {
    const first = setup({ voiceId: undefined });
    await first.begin();
    await first.service.advance(5, scope);
    expect(first.planner.recommend).toHaveBeenCalledTimes(1);
    expect(first.topic.storeVisit!.scriptNeedsRefine).toBe(true);
    await first.service.advance(5, scope);
    expect(first.scripts.refineScript).toHaveBeenCalledTimes(1);
    expect(first.topic.storeVisit!.linesScript).toBe('');
    const preserved = setup({
      voiceId: 'my-clone',
      voiceSource: 'clone',
      voicePrompt: '我自己的声音',
    });
    await preserved.begin();
    await preserved.service.advance(5, scope);
    expect(preserved.planner.recommend).not.toHaveBeenCalled();
    expect(preserved.topic.storeVisit!.voiceId).toBe('my-clone');
  });

  it('音色库未配置时使用 AI 推荐的声音描述，不调用音色定制接口', async () => {
    const { service, topic, begin, agent } = setup({ voiceId: undefined });
    agent.videoOptions.mockResolvedValue({
      storeVisit: {
        voiceClone: { configured: false },
        video: { configured: true, durations: [15] },
        avatar: { configured: true, durations: [15] },
      },
    });
    await begin();
    await service.advance(5, scope);
    expect(topic.storeVisit!.voicePrompt).toBe('年轻男声，清晰自然');
    expect(agent.setCast).not.toHaveBeenCalled();
  });

  it('缺少门店时只询问并等待，不擅自创建门店或反复生成', async () => {
    const { service, topic, begin, planner, agent } = setup({ start: 'store' });
    await begin();
    await service.advance(5, scope);
    await service.advance(5, scope);
    expect(topic.storeVisit!.autopilot!.state).toBe('waiting');
    expect(topic.storeVisit!.autopilot!.message).toContain('确认');
    expect(planner.writeScript).toHaveBeenCalledTimes(1);
    expect(agent.writeScript).not.toHaveBeenCalled();
  });

  it('图库没有素材时切到逐段 AI 补图，已有画面保持原样', async () => {
    const { service, topic, begin, agent } = setup({
      linesScript: body,
      sceneImages: [{ type: 'image', id: 31, url: '/31.jpg' }],
      segments: [
        { id: 'a', lines: '旧画面', sceneImageId: 31, shot: 'broll' },
        { id: 'b', lines: '待补画面', shot: 'broll' },
      ],
    });
    agent.pickPictures.mockRejectedValue(
      new Error('图库里还没有能用的图片，可以先上传图片，或改用 AI 生图'),
    );
    await begin();
    await service.advance(5, scope);
    await service.advance(5, scope);
    expect(topic.storeVisit!.autopilot!.pictureSource).toBe('ai');
    await service.advance(5, scope);
    expect(agent.generatePictures).toHaveBeenCalledWith(
      5,
      { segmentId: 'b' },
      scope,
    );
    expect(topic.storeVisit!.segments![0].sceneImageId).toBe(31);
  });

  it('AI 步骤失败后暂停等待，重复巡检不会重复扣费重试', async () => {
    const { service, topic, begin, planner } = setup();
    planner.reviewScript.mockRejectedValue(new Error('CREDIT_EXHAUSTED'));
    await begin();
    await service.advance(5, scope);
    await service.advance(5, scope);
    expect(planner.reviewScript).toHaveBeenCalledTimes(1);
    expect(topic.storeVisit!.autopilot!.state).toBe('waiting');
    expect(topic.storeVisit!.autopilot!.message).toContain('不足');
  });

  it('同一任务跨进程只认领一次，处理中点击暂停不会启动下一步', async () => {
    const fixture = setup({ script: '' });
    let release!: () => void;
    fixture.agent.writeScript.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      fixture.topic.storeVisit!.script = body;
      return { script: body, review: { passed: true, issues: [] } };
    });
    await fixture.begin();
    const pending = fixture.service.advance(5, scope);
    await new Promise(setImmediate);
    await fixture.makeService().advance(5, scope);
    expect(fixture.agent.writeScript).toHaveBeenCalledTimes(1);
    await fixture.service.pause(5, scope);
    release();
    await pending;
    await fixture.service.advance(5, scope);
    expect(fixture.topic.storeVisit!.autopilot!.state).toBe('paused');
    expect(fixture.agent.generateLines).not.toHaveBeenCalled();
    expect(fixture.topic.storeVisit!.autopilot!.claimId).toBeUndefined();
  });

  it('暂停续跑保留当前步骤和未改动脚本的自检，不重复生成台词或检查', async () => {
    const { service, topic, begin, planner, agent } = setup();
    await begin({ voiceAnchor: true });
    await service.advance(5, scope);
    await service.advance(5, scope);
    await service.advance(5, scope);
    const checkpoint = structuredClone(topic.storeVisit!.autopilot!);
    expect(checkpoint.stage).toBe('picture');
    await service.pause(5, scope);
    await begin();
    expect(topic.storeVisit!.autopilot).toMatchObject({
      stage: 'picture',
      runId: checkpoint.runId,
      reviewKey: checkpoint.reviewKey,
      voiceAnchor: true,
    });
    await service.advance(5, scope);
    expect(planner.reviewScript).toHaveBeenCalledTimes(1);
    expect(agent.generateLines).toHaveBeenCalledTimes(1);
    await service.start(5, {}, scope);
    expect(topic.storeVisit!.autopilot!.runId).toBe(checkpoint.runId);
  });

  it('服务重启后可回收失效认领并从已有结果继续', async () => {
    const { topic, begin, makeService, planner } = setup();
    await begin();
    topic.storeVisit!.autopilot!.advancingAt = new Date(
      Date.now() - DOUYIN_AUTOPILOT_CLAIM_MS - 1000,
    );
    topic.storeVisit!.autopilot!.claimId = 'crashed';
    await makeService().advance(5, scope);
    expect(planner.reviewScript).toHaveBeenCalledTimes(1);
    expect(topic.storeVisit!.autopilot!.claimId).toBeUndefined();
  });

  it('不允许操作其他用户的脚本', async () => {
    const { service, topics } = setup();
    await expect(
      service.start(5, {}, { ...scope, userId: 'another-user' }),
    ).rejects.toThrow('没有这个脚本');
    expect(topics.updateOne).not.toHaveBeenCalled();
  });

  it('暂停托管也会暂停正在出片的导演', async () => {
    const { service, topic, begin, pipeline } = setup({
      pipeline: { state: 'running', updatedAt: new Date() },
    });
    await begin();
    await service.pause(5, scope);
    expect(pipeline.pause).toHaveBeenCalledWith(5, 'user', scope);
    expect(topic.storeVisit!.autopilot!.state).toBe('paused');
  });
});
