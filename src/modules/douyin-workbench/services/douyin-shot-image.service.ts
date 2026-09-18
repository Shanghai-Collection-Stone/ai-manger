import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { GalleryAiImageService } from '../../gallery/services/gallery-ai-image.service.js';
import {
  DOUYIN_SCRIPT_STYLES,
  type DouyinStoryboardShot,
  type DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import { DouyinPersonaRepositoryService } from '../../douyin-persona/services/douyin-persona-repository.service.js';
import {
  buildPersonaImageBrief,
  personaBaseImageUrls,
} from '../../douyin-persona/services/douyin-persona-prompt.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';
import { WorkflowModelService } from '../../workflow-model/services/workflow-model.service.js';
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 分镜画面固定按竖屏 9:16 出图，和成片比例保持一致。
 * @keyword-cn 分镜出图尺寸, 竖屏比例
 * @keyword-en shot-image-size, portrait-ratio
 */
export const DOUYIN_SHOT_IMAGE_SIZE = '1024x1792';

/**
 * @description 分镜 AI 配图统一带上的业务标签，便于在图库里筛出抖音镜头画面。
 * @keyword-cn 分镜配图标签, 业务标签
 * @keyword-en shot-image-tag, business-tag
 */
export const DOUYIN_SHOT_IMAGE_TAG = '抖音分镜';

/**
 * @description 按分镜的画面描述重新生成这一镜的配图：调默认生图运行时出竖屏画面，入图库后直接绑定到该段分镜。
 *   每次调用都产出一张新图，旧图留在图库里不删，用户可以反复重生成直到满意。
 * @keyword-cn 分镜画面重生成, 文生图配图
 * @keyword-en shot-image-regeneration, text-to-image-shot
 */
@Injectable()
export class DouyinShotImageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly aiImages: GalleryAiImageService,
    private readonly personas: DouyinPersonaRepositoryService,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly workflowModels: WorkflowModelService,
  ) {}

  /**
   * @description 为指定分镜重新生成一张竖屏画面并绑定为该段的引用素材，返回更新后的选题。
   * @keyword-cn 重新生成分镜画面, 绑定分镜素材
   * @keyword-en regenerate-shot-image, bind-shot-media
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} shotId 分镜段落 ID。
   * @param {string|undefined} prompt 用户这次的补充描述，为空则用分镜已有的配图提示词或画面描述。
   * @param {DouyinScope} scope 租户用户作用域。
   * @param {{previousImageUrl?: string}} [options] 线性出图时上一镜已生成的画面，作为本镜底图保持场景与色调延续。
   * @returns {Promise<{topic: DouyinTopicEntity, shotId: string, imageId: number, imageUrl: string}>} 更新结果。
   * @throws {BadRequestException} 选题不是子选题、分镜不存在或没有任何可用画面描述时抛出。
   */
  async regenerate(
    topicId: number,
    shotId: string,
    prompt: string | undefined,
    scope: DouyinScope,
    options?: { previousImageUrl?: string },
  ): Promise<{
    topic: DouyinTopicEntity;
    shotId: string;
    imageId: number;
    imageUrl: string;
  }> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child') {
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    }
    const shot = (topic.storyboard ?? []).find((item) => item.id === shotId);
    if (!shot)
      throw new BadRequestException('DOUYIN_STORYBOARD_SHOT_NOT_FOUND');

    const requirement = String(prompt ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
    const persona = topic.personaId
      ? await this.personas.get(topic.personaId, scope)
      : null;
    const basePrompt = this.buildShotImagePrompt(
      topic.title,
      shot,
      requirement,
      persona,
      topic.scriptStyle,
      Boolean(options?.previousImageUrl),
    );
    if (!basePrompt)
      throw new BadRequestException('DOUYIN_SHOT_IMAGE_PROMPT_REQUIRED');

    const nodeRuntime = await this.workflowModels.resolveNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.key,
      WORKFLOW_NODES.douyinWorkbench.shotImage,
    );
    const baseImageCandidates = [
      String(options?.previousImageUrl ?? '').trim(),
      ...personaBaseImageUrls(persona),
      ...(topic.referenceImages ?? []).map((item) =>
        String(item.url ?? '').trim(),
      ),
    ].filter(Boolean);
    const generated = await this.agentService.sendPrompt({
      prompt: basePrompt,
      runtimeOverride: nodeRuntime ?? undefined,
      size: DOUYIN_SHOT_IMAGE_SIZE,
      includeSystemPrompt: false,
      ...(baseImageCandidates.length ? { baseImageCandidates } : {}),
      billingContext: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        platformScope: !scope.tenantId,
        source: 'douyin-workbench.shot-image-generation',
      },
    });
    const image = await this.aiImages.persistGeneratedImage({
      imagePath: String(generated?.imagePath ?? ''),
      userId: scope.userId,
      tenantId: scope.tenantId,
      originalName: `${topic.title} 分镜画面`,
      description: `抖音分镜画面:${basePrompt.slice(0, 120)}`,
      tags: [DOUYIN_SHOT_IMAGE_TAG],
    });
    const updated = await this.repository.updateShot(
      topicId,
      shotId,
      {
        media: {
          type: 'image',
          id: image.id,
          name: image.originalName || `图片 #${image.id}`,
          url: image.url,
          coverUrl: image.thumbUrl || image.url,
        },
        imagePrompt: requirement || shot.imagePrompt || shot.visual,
      },
      scope,
    );
    return { topic: updated, shotId, imageId: image.id, imageUrl: image.url };
  }

  /**
   * @description 拼出这一镜的文生图描述：用户补充描述优先，其次分镜自带的配图提示词，最后回退到画面描述，
   *   再统一叠加竖屏、无文字、写实质感这类固定规格。
   * @keyword-cn 构造分镜出图提示, 竖屏无文字
   * @keyword-en build-shot-image-prompt, portrait-no-text
   * @param {string} title 脚本标题，作为画面主题上下文。
   * @param {DouyinStoryboardShot} shot 目标分镜。
   * @param {string} requirement 用户本次补充描述。
   * @param {object|null} persona 选用的预设人物，决定出镜人物的长相与穿着。
   * @param {string|undefined} style 脚本风格，决定画面质感。
   * @param {boolean} hasPreviousShot 是否以上一镜画面为底图（线性连贯出图）。
   * @returns {string} 最终提示词，没有任何可用描述时返回空串。
   */
  private buildShotImagePrompt(
    title: string,
    shot: DouyinStoryboardShot,
    requirement: string,
    persona: Parameters<typeof buildPersonaImageBrief>[0],
    style: keyof typeof DOUYIN_SCRIPT_STYLES | undefined,
    hasPreviousShot: boolean,
  ): string {
    const description = [
      requirement,
      requirement ? '' : String(shot.imagePrompt ?? '').trim(),
      requirement ? '' : String(shot.visual ?? '').trim(),
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!description) return '';
    const visual = style ? DOUYIN_SCRIPT_STYLES[style].visual : '';
    return [
      `抖音竖屏短视频《${title}》的一个镜头画面。`,
      `景别：${shot.shotType || '中景'}。`,
      `画面内容：${description}`,
      buildPersonaImageBrief(persona),
      visual
        ? '画面风格：' + visual + '。全片所有镜头都保持这一风格，不要中途变换。'
        : '',
      hasPreviousShot
        ? '所给底图是本条视频上一镜的画面：请延续它的场景、光线方向、色调与人物状态，只按上面的画面内容推进到下一个镜头，不要换成另一个不相干的场景。'
        : '',
      '要求：9:16 竖构图，单一主体清晰，真实自然的光线与质感，适合作为视频镜头底图。',
      '画面中不要出现任何文字、字幕、水印、logo 或拼贴边框。',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
