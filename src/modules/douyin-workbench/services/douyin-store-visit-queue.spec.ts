import {
  DouyinStoreVisitService,
  toQueuedSegmentInput,
} from './douyin-store-visit.service.js';
import type { WorkflowNodeRuntime } from '../../workflow-model/entities/workflow-model.entity.js';

const runtime: WorkflowNodeRuntime = {
  providerId: 'p1',
  providerCode: 'shuyan',
  providerName: '数眼',
  model: 'doubao-seedance-2-0-260128',
  apiKey: 'sk-1',
};

const segment = {
  id: 'seg-2',
  lines: '这家的拿铁奶泡特别绵',
  action: '端起杯子',
  sceneImageId: 17,
  shot: 'broll' as const,
};

const topic = {
  id: 2,
  kind: 'child',
  title: '街角咖啡店',
  storeVisit: {
    voiceId: 'v1',
    voiceModel: 'cosyvoice-v3.5-plus',
    segments: [segment],
  },
};

/**
 * @description 构造只替换排队与计费依赖的探店服务。
 * @keyword-cn 探店排队测试服务, 排队替身
 * @keyword-en store-visit-queue-service, queue-double
 */
function buildService(admitted: boolean) {
  const service = Object.create(DouyinStoreVisitService.prototype);
  service.videoQueue = {
    admit: jest.fn().mockResolvedValue(admitted),
    enqueue: jest.fn(async (doc, input) => ({
      ...doc,
      status: 'queued',
      queue: { stage: 'waiting', enqueuedAt: new Date(), input },
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    release: jest.fn(),
    releaseAndThrow: jest.fn(),
  };
  service.billing = { chargeService: jest.fn() };
  return service;
}

describe('探店分段按模型并发排队', () => {
  it('模型并发满了不扣费，把这段存成排队记录直接返回', async () => {
    const service = buildService(false);
    const view = await service.submitSegment({
      topic,
      segment,
      index: 2,
      sceneUrl: 'https://cdn/scene.jpg',
      voice: { voiceId: 'v1', model: 'cosyvoice-v3.5-plus' },
      target: {
        shot: 'broll',
        engine: 'shuyan-video',
        runtime,
        route: 'seedance',
      },
      scope: { userId: 'u1', tenantId: 't1' },
      continuity: { stage: 'generating', sequenceId: 'seq-1' },
    });
    expect(service.billing.chargeService).not.toHaveBeenCalled();
    const [doc, input, existing] = service.videoQueue.enqueue.mock.calls[0];
    expect(doc).toEqual(
      expect.objectContaining({
        segmentId: 'seg-2',
        provider: 'shuyan',
        mode: 'store-visit',
        model: 'doubao-seedance-2-0-260128',
        providerId: 'p1',
        continuity: { stage: 'generating', sequenceId: 'seq-1' },
        request: expect.objectContaining({ lines: segment.lines }),
      }),
    );
    expect(input).toEqual(
      expect.objectContaining({
        segmentIndex: 2,
        sceneUrl: 'https://cdn/scene.jpg',
        target: { shot: 'broll', engine: 'shuyan-video' },
        voiceAnchor: false,
      }),
    );
    expect(JSON.stringify(input)).not.toContain('sk-1');
    expect(existing).toBe(false);
    expect(view).toEqual(
      expect.objectContaining({
        status: 'queued',
        queue: { stage: 'waiting' },
      }),
    );
  });

  it('续段排队时改写原记录，不新建', async () => {
    const service = buildService(false);
    await service.submitSegment({
      topic,
      segment,
      index: 2,
      sceneUrl: '',
      voice: { voiceId: 'v1', model: 'cosyvoice-v3.5-plus' },
      target: { shot: 'broll', engine: 'opensource-video', runtime },
      scope: { userId: 'u1' },
      operationId: 'op-continue',
      firstFrameUrl: 'https://cdn/tail.jpg',
      previousVideoId: 31,
      tailImageId: 99,
    });
    const [doc, input, existing] = service.videoQueue.enqueue.mock.calls[0];
    expect(doc.id).toBe('op-continue');
    expect(existing).toBe(true);
    expect(input).toEqual(
      expect.objectContaining({
        firstFrameUrl: 'https://cdn/tail.jpg',
        previousVideoId: 31,
        tailImageId: 99,
      }),
    );
  });

  it('轮到时按当前脚本找回分段，重建生成目标并带原记录 ID 提交', async () => {
    const service = buildService(true);
    service.submitSegment = jest.fn().mockResolvedValue({ id: 'op-1' });
    const queued = toQueuedSegmentInput({
      index: 1,
      sceneUrl: 'https://cdn/scene.jpg',
      voice: { voiceId: 'v1', model: 'cosyvoice-v3.5-plus' },
      target: { shot: 'broll', engine: 'shuyan-video' },
      continuationPrompt: '镜头缓慢推近',
    });
    await service.submitQueued({
      row: {
        id: 'op-1',
        segmentId: 'seg-2',
        continuity: { stage: 'generating', sequenceId: 'seq-1' },
        request: {
          lines: segment.lines,
          action: '端起杯子',
          sceneImageId: 17,
          shot: 'broll',
          voiceId: 'v1',
        },
        queue: { stage: 'submitting', enqueuedAt: new Date(), input: queued },
      },
      topic,
      runtime,
      scope: { userId: 'u1' },
    });
    expect(service.submitSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        segment,
        index: 1,
        operationId: 'op-1',
        admitted: true,
        continuationPrompt: '镜头缓慢推近',
        continuity: { stage: 'generating', sequenceId: 'seq-1' },
        target: expect.objectContaining({
          shot: 'broll',
          engine: 'shuyan-video',
          runtime,
          route: 'seedance',
        }),
      }),
    );
  });

  it('排队期间台词被改了就取消，不提交', async () => {
    const service = buildService(true);
    service.submitSegment = jest.fn();
    await expect(
      service.submitQueued({
        row: {
          id: 'op-1',
          segmentId: 'seg-2',
          request: {
            lines: '旧台词',
            sceneImageId: 17,
            shot: 'broll',
            voiceId: 'v1',
          },
          queue: { stage: 'submitting', enqueuedAt: new Date(), input: {} },
        },
        topic,
        runtime,
        scope: { userId: 'u1' },
      }),
    ).rejects.toThrow('分段已修改或删除');
    expect(service.submitSegment).not.toHaveBeenCalled();
  });
});
