import { BadRequestException } from '@nestjs/common';
import {
  describeTemplateEditError,
  DouyinVideoTemplateService,
} from './douyin-video-template.service.js';
import type {
  DouyinTopicEntity,
  DouyinVideoTemplate,
} from '../entities/douyin-workbench.entity.js';
import { parseTemplatePlan } from './douyin-video-template.js';

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
  jest.spyOn(service, 'readImage').mockResolvedValue(null);
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

/**
 * @description 验证每段使用自己的素材但共用全片标题、风格、视频区域与首个模板参考，关闭的段不调用生图。
 * @keyword-cn 分段模板生成回归, 对应素材
 * @keyword-en segment-render-regression, matched-material
 */
async function verifySegmentRendering(): Promise<void> {
  const topic = storeVisitTopic({
    sceneImages: [
      { id: 17, name: '门口', url: '/door.png' },
      { id: 18, name: '拼图', url: '/collage.png' },
    ] as never,
    segments: [
      { id: 'a', sceneImageId: 17, lines: '欢迎' },
      { id: 'b', sceneImageId: 18, lines: '活动' },
      { id: 'c', sceneImageId: 17, lines: '再见' },
    ] as never,
  });
  const repository = {
    get: jest.fn().mockResolvedValue(topic),
    setVideoTemplate: jest.fn().mockResolvedValue(topic),
  };
  const service = new DouyinVideoTemplateService(
    {} as never,
    {} as never,
    repository as never,
    {} as never,
  );
  const renderer = service as unknown as {
    renderTemplateImage: (...args: unknown[]) => Promise<DouyinVideoTemplate>;
  };
  const render = jest
    .spyOn(renderer, 'renderTemplateImage')
    .mockResolvedValueOnce({ ...template, imageUrl: '/a-template.png' })
    .mockResolvedValueOnce({ ...template, imageUrl: '/b-template.png' });
  const first = parseTemplatePlan(
    '{"useTemplate":true,"title":"门口","aspectRatio":"4:3"}',
  );
  const second = parseTemplatePlan(
    '{"useTemplate":true,"title":"拼图","aspectRatio":"3:4","style":"中间小星星"}',
  );
  const off = { ...first, useTemplate: false };
  await service.applyTemplate(
    topic,
    template,
    { userId: 'u1' },
    { a: first, b: second, c: off },
  );
  expect(render).toHaveBeenCalledTimes(2);
  expect(render.mock.calls[0][1]).toMatchObject({
    title: template.title,
    style: template.style,
    window: template.window,
    aspectRatio: '4:3',
  });
  expect(render.mock.calls[1][1]).toMatchObject({
    title: template.title,
    style: template.style,
    window: template.window,
  });
  expect(render.mock.calls[1][3]).toMatchObject({
    baseUrl: '/collage.png',
    key: 'b',
    styleReferenceUrl: '/a-template.png',
  });
  expect(render.mock.calls[0][3]).toMatchObject({
    styleReferenceUrl: undefined,
  });
  expect((render.mock.calls[1][3] as { brief: string }).brief).toContain(
    '中间小星星',
  );
  expect(repository.setVideoTemplate.mock.calls[0][1].variants.c).toMatchObject(
    { enabled: false, sourceKey: 'broll:17:' },
  );
}

it(
  'keeps one visual system and shares the first template while adapting each material',
  verifySegmentRendering,
);

/**
 * @description 验证实际改图请求同时携带本段素材和固定模板风格参考，后续段不能复制旧场景与文案。
 * @keyword-cn 模板风格参考回归, 统一片段视觉
 * @keyword-en template-style-reference-regression, consistent-segment-design
 */
async function verifyStyleReference(): Promise<void> {
  const { service, agentService } = buildService();
  const renderer = service as unknown as {
    renderTemplateImage: (...args: unknown[]) => Promise<DouyinVideoTemplate>;
  };
  await expect(
    renderer.renderTemplateImage(
      storeVisitTopic(),
      template,
      { userId: 'u1' },
      {
        baseUrl: '/this-segment.png',
        styleReferenceUrl: '/first-template.png',
      },
    ),
  ).rejects.toThrow('STOP_AFTER_CAPTURE');
  const input = agentService.sendPrompt.mock.calls[0][0];
  expect(input.baseImageCandidates).toEqual(['/this-segment.png']);
  expect(input.extraImageCandidates).toEqual(['/first-template.png']);
  expect(input.prompt).toContain('沿用图2的主辅色');
  expect(input.prompt).toContain('不要从图2复制场景、人物、商品或旧文案');
}

it(
  'passes a fixed style reference separately from the current material',
  verifyStyleReference,
);

describe('版式模板只在实拍图上编辑', () => {
  it('探店用第 1 段的实拍场景图做底图，不用合成的人物首帧', async () => {
    const { service, agentService } = buildService();
    await expect(
      service.applyTemplate(storeVisitTopic(), template, { userId: 'u1' }),
    ).rejects.toThrow('STOP_AFTER_CAPTURE');
    const input = agentService.sendPrompt.mock.calls[0][0];
    expect(input.baseImageCandidates).toEqual(['https://cdn/real-door.jpg']);
    expect(input.prompt).toContain('照片主体保持原样、完整、不变形');
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
