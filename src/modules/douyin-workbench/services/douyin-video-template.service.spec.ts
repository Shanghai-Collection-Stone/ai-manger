import { BadRequestException } from '@nestjs/common';
import {
  describeTemplateEditError,
  DouyinVideoTemplateService,
} from './douyin-video-template.service.js';
import type {
  DouyinTopicEntity,
  DouyinVideoTemplate,
} from '../entities/douyin-workbench.entity.js';

const template: DouyinVideoTemplate = {
  enabled: true,
  window: { x: 44, y: 520, width: 992, height: 744 },
  aspectRatio: '4:3',
  title: '集合石探店',
  sellingPoints: ['西部主题'],
  style: '暖橙配色',
  updatedAt: new Date(),
};

/**
 * @description 构造模板服务：生图调用先记下参数再抛出，测试只看交给改图模型的底图与提示词。
 * @keyword-cn 模板服务替身, 记录改图参数
 * @keyword-en template-service-double, capture-edit-input
 */
function buildService(error: Error = new Error('STOP_AFTER_CAPTURE')) {
  const agentService = { sendPrompt: jest.fn().mockRejectedValue(error) };
  const workflowModels = {
    resolveNodeRuntime: jest.fn().mockResolvedValue(null),
  };
  const service = new DouyinVideoTemplateService(
    agentService as never,
    workflowModels as never,
    {} as never,
    {} as never,
  );
  return { service, agentService };
}

/**
 * @description 一条探店子选题：第 1 段有合成的人物首帧，也配了实拍场景图。
 * @keyword-cn 探店模板测试选题, 人物首帧与实拍图
 * @keyword-en store-visit-template-topic, keyframe-and-real-photo
 */
function storeVisitTopic(extra: Partial<DouyinTopicEntity['storeVisit']> = {}) {
  return {
    id: 10,
    kind: 'child',
    productionMode: 'store-visit',
    storyboard: [],
    storeVisit: {
      sceneImages: [{ id: 17, name: '大门', url: 'https://cdn/real-door.jpg' }],
      segments: [
        {
          id: 'seg-1',
          lines: '欢迎来到集合石',
          sceneImageId: 17,
          keyframe: { id: 99, url: 'https://cdn/ai-keyframe.jpg' },
        },
      ],
      ...extra,
    },
  } as unknown as DouyinTopicEntity;
}

describe('版式模板只在实拍图上编辑', () => {
  it('探店用第 1 段的实拍场景图做底图，不用合成的人物首帧', async () => {
    const { service, agentService } = buildService();
    await expect(
      service.applyTemplate(storeVisitTopic(), template, { userId: 'u1' }),
    ).rejects.toThrow('STOP_AFTER_CAPTURE');
    const input = agentService.sendPrompt.mock.calls[0][0];
    expect(input.baseImageCandidates).toEqual(['https://cdn/real-door.jpg']);
    expect(input.prompt).toContain('只做编辑排版，不新造画面内容');
  });

  it('没有实拍图时直接拒绝，不调用生图', async () => {
    const { service, agentService } = buildService();
    const topic = storeVisitTopic({ sceneImages: [], segments: [] });
    await expect(
      service.applyTemplate(topic, template, { userId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
    expect(agentService.sendPrompt).not.toHaveBeenCalled();
  });

  it('分镜模式用第一个配了图片的镜头做底图', async () => {
    const { service, agentService } = buildService();
    const topic = {
      id: 3,
      kind: 'child',
      storyboard: [
        { id: 's1', media: { type: 'video', url: 'https://cdn/a.mp4' } },
        { id: 's2', media: { type: 'image', url: '/static/shot-2.png' } },
      ],
    } as unknown as DouyinTopicEntity;
    await expect(
      service.applyTemplate(topic, template, { userId: 'u1' }),
    ).rejects.toThrow('STOP_AFTER_CAPTURE');
    expect(
      agentService.sendPrompt.mock.calls[0][0].baseImageCandidates,
    ).toEqual(['/static/shot-2.png']);
  });

  it('生图模型只能凭空生成时提示换支持改图的模型', async () => {
    const { service } = buildService(
      new Error('IMAGE_PROVIDER_NOT_SUPPORTED:shuyan'),
    );
    await expect(
      service.applyTemplate(storeVisitTopic(), template, { userId: 'u1' }),
    ).rejects.toThrow('不能改图');
    const other = new Error('NETWORK');
    expect(describeTemplateEditError(other)).toBe(other);
  });
});
