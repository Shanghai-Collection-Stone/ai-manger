import { ObjectId } from 'mongodb';
import type { DouyinTopicEntity } from '../entities/douyin-workbench.entity.js';
import {
  DouyinStoreVisitAutopilotService,
  DOUYIN_AUTOPILOT_CLAIM_MS,
  DOUYIN_AUTOPILOT_MAX_REPAIRS_PER_POSITION,
  autopilotRepairActions,
  autopilotRepairKey,
  autopilotScriptKey,
} from './douyin-store-visit-autopilot.service.js';
import {
  parseStoreVisitRepairDecision,
  parseStoreVisitSameFailure,
} from './douyin-store-visit-planner.service.js';
import {
  mergeStoreVisitSegments,
  normalizeStoreVisitSegments,
} from './douyin-workbench-repository.service.js';

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
      if ('$in' in condition) return condition.$in.includes(actual);
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
    diagnoseAutopilotFailure: jest.fn(
      async (_topic: unknown, _input: unknown, _scope: unknown) => ({
        action: 'retry',
        instruction: '',
        reason: '',
      }),
    ),
    isSameAutopilotFailure: jest.fn(
      async (_topic: unknown, _input: unknown, _scope: unknown) => true,
    ),
    writeScript: jest.fn().mockResolvedValue({
      needsStore: true,
      storeQuestion: { question: '请确认拍摄哪家门店？' },
    }),
  };
  const scripts = {
    refineScript: jest.fn(async (_input: any, _scope: any) => ({
      script: body + '表达轻快自然。',
    })),
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
      if (input.voiceId) topic.storeVisit!.voiceId = input.voiceId;
      if (input.template) topic.storeVisit!.template = input.template;
    }),
    writeScript: jest.fn(async () => {
      topic.storeVisit!.script = body;
      topic.storeVisit!.scriptNeedsRefine = false;
      return {
        script: body,
        review: { passed: true, issues: [] as string[] },
      };
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
    setStore: jest.fn((_id: number, storeId: number) => {
      topic.storeVisit!.storeId = storeId;
      return Promise.resolve();
    }),
    createStore: jest.fn((input: { name: string }) =>
      Promise.resolve({ store: { id: 88, name: input.name } }),
    ),
    fitSegmentsToMaterials: jest
      .fn()
      .mockResolvedValue({ rewritten: 0, missing: 0 }),
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
    resume: jest.fn(async () => {
      topic.storeVisit!.pipeline = { state: 'running', updatedAt: new Date() };
      return snapshot();
    }),
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
  it('脚本自检失败按原因重写，台词失败把原因交给下一次生成', async () => {
    const f = setup();
    await f.begin();
    Object.assign(f.topic.storeVisit!.autopilot!, {
      state: 'waiting',
      stage: 'script',
      failureId: 'review',
      message: '脚本自检仍需处理：套餐价格与资料不符',
    });
    f.planner.diagnoseAutopilotFailure.mockResolvedValueOnce({
      action: 'rewrite-script',
      instruction: '',
      reason: '脚本事实不符',
    });
    await f.begin({ recoverFailureId: 'review' });
    await f.service.advance(5, scope);
    expect(f.agent.writeScript).toHaveBeenCalledWith(
      5,
      { keepCast: true, issues: ['脚本自检仍需处理：套餐价格与资料不符'] },
      scope,
    );
    Object.assign(f.topic.storeVisit!.autopilot!, {
      state: 'waiting',
      stage: 'lines',
      failureId: 'lines',
      message: '台词缺少套餐价格',
      reviewKey: autopilotScriptKey(f.topic),
    });
    await f.begin({ recoverFailureId: 'lines' });
    await f.service.advance(5, scope);
    await f.service.advance(5, scope);
    expect(f.agent.generateLines).toHaveBeenCalledWith(
      5,
      expect.stringContaining('上次失败原因：台词缺少套餐价格'),
      scope,
      { useMaterials: true },
    );
  });

  it('手动暂停导演不触发错误自动恢复', async () => {
    const f = setup({ pipeline: { state: 'running', updatedAt: new Date() } });
    await f.begin();
    f.topic.storeVisit!.pipeline = {
      state: 'paused',
      pauseReason: 'editing',
      updatedAt: new Date(),
    };
    await (f.service as any).finishVideo(f.topic, scope);
    expect(f.topic.storeVisit!.autopilot!.state).toBe('paused');
    expect(f.topic.storeVisit!.autopilot!.failureId).toBeUndefined();
  });

  it('失败标识保护自动恢复，用户暂停和其他失败均不能被过期倒计时覆盖', async () => {
    const f = setup();
    f.planner.reviewScript.mockRejectedValueOnce(new Error('network timeout'));
    await f.begin();
    await f.service.advance(5, scope);
    const failureId = f.topic.storeVisit!.autopilot!.failureId!;
    expect(failureId).toBeTruthy();
    await f.service.start(5, { recoverFailureId: 'stale' }, scope);
    expect(f.topic.storeVisit!.autopilot!.state).toBe('waiting');
    await f.service.pause(5, scope);
    expect(f.topic.storeVisit!.autopilot!.state).toBe('paused');
    await f.service.start(5, { recoverFailureId: failureId }, scope);
    expect(f.topic.storeVisit!.autopilot!.state).toBe('paused');
  });

  it('任务不存在时只续跑失败分段，不重做已成功视频', async () => {
    const f = setup({
      linesScript: body,
      sceneImages: [{ type: 'image', id: 31, url: '/31.jpg' }],
      segments: [
        {
          id: 'a',
          lines: '已成功',
          shot: 'broll',
          sceneImageId: 31,
          videoId: 88,
          nativeAudio: true,
        },
        { id: 'b', lines: '待生成', shot: 'broll', sceneImageId: 31 },
      ],
    });
    await f.begin();
    Object.assign(f.topic.storeVisit!.autopilot!, {
      stage: 'make',
      reviewKey: autopilotScriptKey(f.topic),
    });
    f.topic.storeVisit!.pipeline = {
      state: 'paused',
      pauseReason: 'failed',
      currentSegmentId: 'b',
      error: '自建视频服务上找不到这次任务，请重新生成',
      updatedAt: new Date(),
    };
    await f.service.advance(5, scope);
    const failureId = f.topic.storeVisit!.autopilot!.failureId;
    expect(f.topic.storeVisit!.autopilot!.state).toBe('waiting');
    await f.begin({ recoverFailureId: failureId });
    await f.service.advance(5, scope);
    expect(f.pipeline.resume).toHaveBeenCalledTimes(1);
    expect(f.topic.storeVisit!.segments![0].videoId).toBe(88);
    expect(f.topic.storeVisit!.autopilot!.recovery).toMatchObject({
      stage: 'make',
      segmentId: 'b',
      pending: false,
    });
    expect(f.agent.generateLines).not.toHaveBeenCalled();
  });

  it('台词过长先按失败原因改短该段，再继续导演', async () => {
    const longLines =
      '双人套餐 99 元，周末约上朋友来体验卡丁车，现场还有更多亲子项目可以一起玩。';
    const f = setup({
      segments: [
        { id: 'a', lines: '成功段', videoId: 88, nativeAudio: true },
        { id: 'b', lines: longLines },
      ],
    });
    await f.begin();
    Object.assign(f.topic.storeVisit!.autopilot!, {
      state: 'waiting',
      stage: 'make',
      failureId: 'long',
      message: '第 2 段配音太长，超过视频时长',
    });
    f.topic.storeVisit!.pipeline = {
      state: 'paused',
      currentSegmentId: 'b',
      updatedAt: new Date(),
    };
    f.planner.diagnoseAutopilotFailure.mockResolvedValueOnce({
      action: 'rewrite-segment',
      instruction: '压缩到 25 字以内',
      reason: '配音超过单段时长',
    });
    f.scripts.refineScript.mockResolvedValue({
      script: '双人套餐 99 元，周末约朋友一起来体验卡丁车。',
    });
    await f.begin({ recoverFailureId: 'long' });
    await f.service.advance(5, scope);
    expect(f.scripts.refineScript.mock.calls[0][0]).toMatchObject({
      script: longLines,
      instruction: expect.stringContaining('配音太长'),
    });
    expect(f.topic.storeVisit!.segments![0].videoId).toBe(88);
    expect(f.topic.storeVisit!.segments![1].lines.length).toBeLessThan(
      longLines.length,
    );
    expect(f.pipeline.resume).toHaveBeenCalledTimes(1);
  });

  it('恢复期间再次暂停不会重新启动出片', async () => {
    const f = setup({ segments: [{ id: 'b', lines: body }] });
    await f.begin();
    Object.assign(f.topic.storeVisit!.autopilot!, {
      state: 'waiting',
      stage: 'make',
      failureId: 'long',
      message: '台词太长，配音超长',
    });
    f.topic.storeVisit!.pipeline = {
      state: 'paused',
      currentSegmentId: 'b',
      updatedAt: new Date(),
    };
    f.planner.diagnoseAutopilotFailure.mockResolvedValueOnce({
      action: 'rewrite-segment',
      instruction: '压缩这一段',
      reason: '配音超长',
    });
    f.scripts.refineScript.mockImplementation(async () => {
      await f.service.pause(5, scope);
      return { script: '双人套餐 99 元，周末约朋友一起来体验卡丁车。' };
    });
    await f.begin({ recoverFailureId: 'long' });
    await f.service.advance(5, scope);
    expect(f.topic.storeVisit!.autopilot!.state).toBe('paused');
    expect(f.pipeline.resume).not.toHaveBeenCalled();
    expect(f.topic.storeVisit!.segments![0].lines).toBe(body);
  });

  /** @description 构造第 1 段出片失败、流水线已暂停的托管现场。 @keyword-cn 托管失败现场, 修复测试桩 @keyword-en autopilot-failure-fixture, repair-test-double */
  async function failedAtSegment(message: string) {
    const f = setup({
      linesScript: body,
      sceneImages: [{ type: 'image', id: 31, url: '/31.jpg' }],
      segments: [
        { id: 'a', lines: '绝了！', shot: 'broll', sceneImageId: 31 },
        { id: 'b', lines: '第二段保持不变。', shot: 'broll', sceneImageId: 31 },
      ],
    });
    await f.begin();
    Object.assign(f.topic.storeVisit!.autopilot!, {
      stage: 'make',
      reviewKey: autopilotScriptKey(f.topic),
    });
    const fail = (error = message) => {
      f.topic.storeVisit!.pipeline = {
        state: 'paused',
        pauseReason: 'failed',
        currentSegmentId: 'a',
        error,
        updatedAt: new Date(),
      };
    };
    fail();
    await f.service.advance(5, scope);
    return { ...f, fail };
  }

  it('AI 判定原样重试时不改短台词，同一段再失败就停下等用户', async () => {
    const f = await failedAtSegment('第 1 段提交失败：服务暂时不可用');
    const auto = () => f.topic.storeVisit!.autopilot!;
    expect(auto().state).toBe('waiting');
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    expect(f.planner.diagnoseAutopilotFailure).toHaveBeenCalledTimes(1);
    expect(f.scripts.refineScript).not.toHaveBeenCalled();
    expect(f.topic.storeVisit!.segments![0].lines).toBe('绝了！');
    expect(f.pipeline.resume).toHaveBeenCalledTimes(1);
    f.fail();
    await f.service.advance(5, scope);
    expect(auto().state).toBe('paused');
    expect(auto().blocked).toMatchObject({ segmentId: 'a', lines: '绝了！' });
    expect(auto().message).toContain('已自动修复过');
    expect(f.planner.isSameAutopilotFailure).not.toHaveBeenCalled();
    await f.service.advance(5, scope);
    expect(f.planner.diagnoseAutopilotFailure).toHaveBeenCalledTimes(1);
    expect(f.pipeline.resume).toHaveBeenCalledTimes(1);
  });

  it('用户手动继续时 AI 再修一次；用户改过台词就直接按新内容出片', async () => {
    const f = await failedAtSegment('第 1 段提交失败：服务暂时不可用');
    const auto = () => f.topic.storeVisit!.autopilot!;
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    f.fail();
    await f.service.advance(5, scope);
    expect(auto().state).toBe('paused');
    await f.begin();
    expect(auto().blocked).toBeUndefined();
    expect(auto().repairs).toEqual([]);
    expect(auto().recovery?.pending).toBe(true);
    await f.service.advance(5, scope);
    expect(f.planner.diagnoseAutopilotFailure).toHaveBeenCalledTimes(2);
    f.fail();
    await f.service.advance(5, scope);
    expect(auto().state).toBe('paused');
    f.topic.storeVisit!.segments![0].lines = '用户改过的开场';
    await f.begin();
    expect(auto().recovery).toBeUndefined();
    await f.service.advance(5, scope);
    expect(f.planner.diagnoseAutopilotFailure).toHaveBeenCalledTimes(2);
    expect(f.agent.generateStoreVisit).toHaveBeenCalledTimes(1);
    expect(f.topic.storeVisit!.segments![0].lines).toBe('用户改过的开场');
  });

  it('修完后同段出现不同类错误不占重试次数，继续由 AI 修复', async () => {
    const f = await failedAtSegment('第 1 段配音时长 16.20 秒，不在范围内');
    const auto = () => f.topic.storeVisit!.autopilot!;
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    f.planner.isSameAutopilotFailure.mockResolvedValueOnce(false);
    f.fail('第 1 段素材读取失败');
    await f.service.advance(5, scope);
    expect(f.planner.isSameAutopilotFailure.mock.calls[0][1]).toMatchObject({
      previous: ['第 1 段配音时长 16.20 秒，不在范围内'],
      current: '第 1 段素材读取失败',
    });
    expect(auto().state).toBe('waiting');
    expect(auto().blocked).toBeUndefined();
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    expect(f.planner.diagnoseAutopilotFailure).toHaveBeenCalledTimes(2);
    expect(auto().repairs).toHaveLength(2);
    f.fail('第 1 段配音时长 16.20 秒，不在范围内');
    await f.service.advance(5, scope);
    expect(auto().state).toBe('paused');
    expect(f.planner.isSameAutopilotFailure).toHaveBeenCalledTimes(1);
  });

  it('文字不同但 AI 判定同类时停下等用户', async () => {
    const f = await failedAtSegment('第 1 段配音时长 16.20 秒，不在范围内');
    const auto = () => f.topic.storeVisit!.autopilot!;
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    f.fail('第 1 段配音时长 15.40 秒，不在范围内');
    await f.service.advance(5, scope);
    expect(f.planner.isSameAutopilotFailure).toHaveBeenCalledTimes(1);
    expect(auto().state).toBe('paused');
    expect(f.planner.diagnoseAutopilotFailure).toHaveBeenCalledTimes(1);
  });

  it('错误一直变化时同一位置也有总修复上限', async () => {
    const f = await failedAtSegment('错误 0');
    const auto = () => f.topic.storeVisit!.autopilot!;
    f.planner.isSameAutopilotFailure.mockResolvedValue(false);
    for (let i = 1; i <= DOUYIN_AUTOPILOT_MAX_REPAIRS_PER_POSITION; i += 1) {
      expect(auto().state).toBe('waiting');
      await f.begin({ recoverFailureId: auto().failureId });
      await f.service.advance(5, scope);
      f.fail(`错误 ${i}`);
      await f.service.advance(5, scope);
    }
    expect(auto().state).toBe('paused');
    expect(f.planner.diagnoseAutopilotFailure).toHaveBeenCalledTimes(
      DOUYIN_AUTOPILOT_MAX_REPAIRS_PER_POSITION,
    );
  });

  it('修复动作本身失败时停下，不换个说法继续重试', async () => {
    const f = await failedAtSegment('第 1 段配音超过时长');
    const auto = () => f.topic.storeVisit!.autopilot!;
    f.planner.diagnoseAutopilotFailure.mockResolvedValueOnce({
      action: 'rewrite-segment',
      instruction: '压缩',
      reason: '超长',
    });
    f.scripts.refineScript.mockRejectedValueOnce(new Error('模型超时'));
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    expect(auto().state).toBe('paused');
    expect(auto().message).toContain('自动修复没有完成：模型超时');
    expect(f.pipeline.resume).not.toHaveBeenCalled();
  });

  it('改台词只动失败这一段，AI 改写期间用户改过就以用户为准', async () => {
    const f = await failedAtSegment('第 1 段配音超过时长');
    const auto = () => f.topic.storeVisit!.autopilot!;
    f.planner.diagnoseAutopilotFailure.mockResolvedValue({
      action: 'rewrite-segment',
      instruction: '压缩',
      reason: '超长',
    });
    f.scripts.refineScript.mockImplementationOnce(async () => {
      f.topic.storeVisit!.segments![1].lines = '用户刚改的第二段';
      return { script: '改好的开场' };
    });
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    expect(f.topic.storeVisit!.segments!.map((item) => item.lines)).toEqual([
      '改好的开场',
      '用户刚改的第二段',
    ]);
    f.fail('第 1 段配音又超过时长');
    f.planner.isSameAutopilotFailure.mockResolvedValueOnce(false);
    await f.service.advance(5, scope);
    f.scripts.refineScript.mockImplementationOnce(async () => {
      f.topic.storeVisit!.segments![0].lines = '用户亲自改的开场';
      return { script: 'AI 改写结果' };
    });
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    expect(f.topic.storeVisit!.segments![0].lines).toBe('用户亲自改的开场');
  });

  it('保存改动时其他镜头的成片保留，只有接这段尾帧的续段作废', () => {
    const current = [
      {
        id: 'a',
        lines: '第一段',
        sceneImageId: 31,
        videoId: 1,
        nativeAudio: true,
      },
      { id: 'b', lines: '失败段', sceneImageId: 32 },
      {
        id: 'c',
        lines: '接尾帧',
        sceneImageId: 32,
        videoId: 2,
        nativeAudio: true,
      },
      {
        id: 'd',
        lines: '新镜头',
        sceneImageId: 33,
        videoId: 3,
        nativeAudio: true,
      },
    ];
    const merged = mergeStoreVisitSegments(
      normalizeStoreVisitSegments(
        current.map((item) =>
          item.id === 'b' ? { ...item, lines: '改好的失败段' } : item,
        ),
        [31, 32, 33],
      ),
      current,
    );
    expect(merged.map((item) => item.videoId)).toEqual([
      1,
      undefined,
      undefined,
      3,
    ]);
  });

  it('同类判定解析不了时按同类处理', () => {
    expect(parseStoreVisitSameFailure('{"same":false}')).toBe(false);
    expect(parseStoreVisitSameFailure('{"same":true}')).toBe(true);
    expect(parseStoreVisitSameFailure('不是 JSON')).toBe(true);
  });

  it('AI 判定只有用户能处理时直接停下，不重试', async () => {
    const f = await failedAtSegment('视频模型密钥没有配置');
    const auto = () => f.topic.storeVisit!.autopilot!;
    f.planner.diagnoseAutopilotFailure.mockResolvedValueOnce({
      action: 'ask-user',
      instruction: '',
      reason: '缺少配置',
    });
    await f.begin({ recoverFailureId: auto().failureId });
    await f.service.advance(5, scope);
    expect(auto().state).toBe('paused');
    expect(auto().message).toContain('需要你处理');
    expect(f.pipeline.resume).not.toHaveBeenCalled();
  });

  it('AI 判定换画面时只重做失败这一段', async () => {
    const f = await failedAtSegment('第 1 段素材读取失败');
    f.planner.diagnoseAutopilotFailure.mockResolvedValueOnce({
      action: 'replace-picture',
      instruction: '换成门头全景',
      reason: '素材失效',
    });
    await f.begin({
      recoverFailureId: f.topic.storeVisit!.autopilot!.failureId,
    });
    await f.service.advance(5, scope);
    expect(f.agent.generatePictures).toHaveBeenCalledWith(
      5,
      { segmentId: 'a', prompt: '换成门头全景' },
      scope,
    );
    expect(f.topic.storeVisit!.segments![1].sceneImageId).toBe(31);
    expect(f.pipeline.resume).toHaveBeenCalledTimes(1);
  });

  it('修复动作按步骤限制，越权或解析失败的判定退回原样重试', () => {
    expect(autopilotRepairActions('make', true)).not.toContain(
      'regenerate-lines',
    );
    expect(autopilotRepairActions('make', false)).toEqual([
      'retry',
      'ask-user',
    ]);
    expect(autopilotRepairKey('voice', 'a')).toBe(
      autopilotRepairKey('make', 'a'),
    );
    const actions = autopilotRepairActions('make', true);
    expect(
      parseStoreVisitRepairDecision(
        '{"action":"rewrite-script","instruction":"全部重写"}',
        actions,
      ),
    ).toEqual({ action: 'retry', instruction: '', reason: '' });
    expect(parseStoreVisitRepairDecision('不是 JSON', actions).action).toBe(
      'retry',
    );
    expect(
      parseStoreVisitRepairDecision(
        '{"action":"rewrite-segment","instruction":"压缩","reason":"超长"}',
        actions,
      ),
    ).toEqual({
      action: 'rewrite-segment',
      instruction: '压缩',
      reason: '超长',
    });
  });

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

  it('从门店开始时配不上素材的段按已有素材改写台词，不停下来要客户补素材', async () => {
    const { service, topic, begin, agent } = setup({
      start: 'store',
      storeId: 7,
      linesScript: body,
      sceneImages: [{ type: 'image', id: 31, url: '/31.jpg' }],
      segments: [
        { id: 'a', lines: '门头打卡', sceneImageId: 31, shot: 'broll' },
        { id: 'b', lines: '招牌甜品超好吃', shot: 'broll' },
      ],
    });
    agent.fitSegmentsToMaterials.mockImplementation(() => {
      Object.assign(topic.storeVisit!.segments![1], {
        lines: '蹦床区随便蹦，孩子能玩一下午',
        sceneImageId: 31,
      });
      return Promise.resolve({ rewritten: 1, missing: 0 });
    });
    await begin();
    topic.storeVisit!.autopilot!.reviewKey = autopilotScriptKey(topic);
    await service.advance(5, scope);
    expect(agent.matchScenes).toHaveBeenCalledWith(5, scope, {
      onlyMissing: true,
    });
    expect(agent.fitSegmentsToMaterials).toHaveBeenCalledWith(5, scope);
    expect(topic.storeVisit!.autopilot!.state).toBe('running');
    expect(topic.storeVisit!.autopilot!.message).toContain('已按门店已有素材');
    expect(topic.storeVisit!.segments![0].lines).toBe('门头打卡');
  });

  it('只剩人物出镜段配不上照片时改为不露脸解说，而不是等客户处理', async () => {
    const { service, topic, begin, agent } = setup({
      start: 'store',
      storeId: 7,
      template: 'opening',
      faceImage: { imageId: 1, url: '/face.jpg' },
      linesScript: body,
      sceneImages: [{ type: 'image', id: 31, url: '/31.jpg' }],
      segments: [
        { id: 'a', lines: '大家好', shot: 'presenter' },
        { id: 'b', lines: '蹦床区', sceneImageId: 31, shot: 'broll' },
      ],
    });
    agent.fitSegmentsToMaterials.mockResolvedValue({
      rewritten: 0,
      missing: 1,
    });
    await begin();
    topic.storeVisit!.autopilot!.reviewKey = autopilotScriptKey(topic);
    await service.advance(5, scope);
    expect(agent.setCast).toHaveBeenCalledWith(
      5,
      { template: 'voiceover' },
      scope,
    );
    expect(topic.storeVisit!.autopilot!.state).toBe('running');
  });

  it('脚本按自检意见重写后仍有提示时照常往下做，不停下来', async () => {
    const { service, topic, begin, agent, planner } = setup();
    planner.reviewScript.mockResolvedValue({
      passed: false,
      issues: ['第 2 段缺少价格'],
    });
    agent.writeScript.mockImplementation(() => {
      topic.storeVisit!.script = body + '补充了价格说明。';
      return Promise.resolve({
        script: topic.storeVisit!.script,
        review: { passed: false, issues: ['第 3 段语气偏平'] },
      });
    });
    await begin();
    await service.advance(5, scope);
    expect(agent.writeScript).toHaveBeenCalledTimes(1);
    expect(topic.storeVisit!.autopilot!.state).toBe('running');
    expect(topic.storeVisit!.autopilot!.message).toContain('剩余提示');
    await service.advance(5, scope);
    expect(agent.generateLines).toHaveBeenCalledTimes(1);
  });

  it('脚本或客户需求里写明了已有门店时直接设定，不再等客户确认', async () => {
    const { service, topic, begin, planner, agent, operations } = setup({
      start: 'store',
    });
    operations.findOne.mockResolvedValueOnce({ prompt: '周末带娃去欢乐谷' });
    planner.writeScript.mockResolvedValue({
      needsStore: true,
      storeQuestion: {
        question: '这条视频拍欢乐谷吗？',
        storeId: 7,
        name: '欢乐谷',
        description: '',
        confident: true,
      },
    });
    await begin({ scriptPrompt: '突出亲子套餐' });
    await service.advance(5, scope);
    expect(planner.writeScript).toHaveBeenCalledWith(
      5,
      { keepCast: true, prompt: '突出亲子套餐\n周末带娃去欢乐谷' },
      scope,
    );
    expect(agent.setStore).toHaveBeenCalledWith(5, 7, scope);
    expect(agent.createStore).not.toHaveBeenCalled();
    expect(topic.storeVisit!.autopilot!.state).toBe('running');
    expect(topic.storeVisit!.autopilot!.message).toContain('欢乐谷');
  });

  it('需求里写明的门店还没建时按店名新建再设定；没确定时照旧询问', async () => {
    const created = setup({ start: 'store' });
    created.planner.writeScript.mockResolvedValue({
      needsStore: true,
      storeQuestion: {
        question: '这条视频拍小熊烘焙吗？',
        storeId: null,
        name: '小熊烘焙',
        description: '社区烘焙店',
        confident: true,
      },
    });
    await created.begin();
    await created.service.advance(5, scope);
    expect(created.agent.createStore).toHaveBeenCalledWith(
      { name: '小熊烘焙', description: '社区烘焙店' },
      scope,
    );
    expect(created.agent.setStore).toHaveBeenCalledWith(5, 88, scope);
    expect(created.topic.storeVisit!.autopilot!.state).toBe('running');
    const unsure = setup({ start: 'store' });
    unsure.planner.writeScript.mockResolvedValue({
      needsStore: true,
      storeQuestion: {
        question: '拍哪家店？',
        storeId: 7,
        name: '欢乐谷',
        description: '',
        confident: false,
      },
    });
    await unsure.begin();
    await unsure.service.advance(5, scope);
    expect(unsure.agent.setStore).not.toHaveBeenCalled();
    expect(unsure.topic.storeVisit!.autopilot!.state).toBe('waiting');
  });

  it('要出镜却没有带形象图的人物时改为不露脸解说继续', async () => {
    const { service, topic, begin, agent } = setup({
      template: 'opening',
      voiceId: undefined,
    });
    await begin();
    await service.advance(5, scope);
    expect(agent.setCast).toHaveBeenCalledWith(
      5,
      { template: 'voiceover' },
      scope,
    );
    expect(topic.storeVisit!.template).toBe('voiceover');
    expect(topic.storeVisit!.autopilot!.state).toBe('running');
  });
});
