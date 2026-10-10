import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { GalleryAiImageService } from '../../gallery/services/gallery-ai-image.service.js';
import {
  DOUYIN_SCRIPT_STYLES,
  type DouyinFaceMaskStyle,
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
 * @description 3D 卡通大头的头像风格：圆润的立体角色头跟实拍场景的光线质感最容易融，
 *   不会像二次元平涂那样一眼看出是后期贴上去的。
 * @keyword-cn 卡通大头风格, 皮克斯风
 * @keyword-en cartoon-head-style, pixar-style
 */
export const DOUYIN_SHOT_FACE_MASK_STYLE =
  '圆润讨喜的 3D 皮克斯 / 迪士尼动画电影角色头像，柔和的次表面散射皮肤质感，眼睛偏大，头部比例略大于真人（Q 版但不夸张）';

/**
 * @description 人像处理风格的中文名，用于图库命名与接口说明，与前端风格弹窗一致。
 * @keyword-cn 人像处理风格名称
 * @keyword-en face-mask-style-labels
 */
export const DOUYIN_FACE_MASK_STYLE_LABELS: Record<
  DouyinFaceMaskStyle,
  string
> = {
  'cartoon-3d': '3D 卡通大头',
  'anime-bighead': '动画大头',
  anthropomorphic: '拟人风格',
  deidentify: 'AI 去除真人特征',
};

/** @type {string[]} 所有风格共用的收尾要求：只改人，不改场景。 */
const FACE_MASK_KEEP_SCENE = [
  '其余部分必须原样保留：构图、背景、门店与陈设、身体姿态、手部动作、光线方向与色温都不要改动；不要增减人数，不要移动任何人的位置。',
  '画面中不要出现任何文字、字幕、水印、logo 或拼贴边框。',
];

/**
 * @description 拼出分镜人像处理的图像编辑提示词：这是一次定点编辑，不是重画一张，所以每种风格都强调除人物以外的像素保持原样——
 *   构图、衣着、光线一动，画面就跟同条视频的其他镜头对不上了。
 *   - `cartoon-3d`：头部换成 3D 皮克斯风卡通大头；
 *   - `anime-bighead`：头部换成二维动画风 Q 版大头，线条与上色贴合实拍光影；
 *   - `anthropomorphic`：人物整体换成穿着原衣服、保持原动作的拟人化动物角色；
 *   - `deidentify`：把真人重绘成写实但带明显 AI 质感的虚拟模特（五官精致、皮肤干净、柔和补光），衣着姿态与场景不变，去掉身份细节。
 * @keyword-cn 人像处理提示词, 定点编辑
 * @keyword-en face-mask-prompt, targeted-edit
 * @param {DouyinFaceMaskStyle} [style] 处理风格，缺省 3D 卡通大头。
 * @returns {string} 提示词。
 */
export function buildShotFaceMaskPrompt(
  style: DouyinFaceMaskStyle = 'cartoon-3d',
): string {
  const intro = '以所给底图为准，这是一条抖音竖屏短视频里的一个镜头画面。';
  const byStyle: Record<DouyinFaceMaskStyle, string[]> = {
    'cartoon-3d': [
      `只做一件事：把画面中每一个真人的头部替换成${DOUYIN_SHOT_FACE_MASK_STYLE}，保持原来的朝向、视线方向、头部倾斜角度与位置。`,
      '衣着保持不变。卡通头与身体的衔接要自然：脖子、发际线、边缘阴影与地面投影都要对得上，不要做成贴纸拼贴、马赛克或生硬的圆形遮挡。',
    ],
    'anime-bighead': [
      '只做一件事：把画面中每一个真人的头部替换成二维动画风格的 Q 版大头——清晰干净的描边线条、赛璐珞平涂上色、大眼睛、表情生动，头部比例明显大于真人但不怪异；保持原来的朝向、视线方向、头部倾斜角度、发型轮廓与发色。',
      '衣着保持不变。动画头的明暗要跟画面光线方向一致，脖子与发际线处要和实拍身体自然衔接，不要做成贴纸拼贴、马赛克或生硬的圆形遮挡。',
    ],
    anthropomorphic: [
      '只做一件事：把画面中每一个真人替换成拟人化的卡通动物角色（例如猫、狗、熊、兔子、狐狸，不同的人用不同的动物），角色直立、穿着原来的衣服、保持原来的身体姿态、手部动作、朝向与视线方向。',
      '头部、手部等露出的皮肤都变成动物特征（毛发、耳朵、口鼻），画风统一为精致的 3D 动画电影质感，毛发受光与画面光线方向一致，和场景自然融合，不要做成贴纸拼贴或面具。',
    ],
    deidentify: [
      '只做一件事：把画面中每一个真人重绘成一位不存在的 AI 虚拟模特——写实人像，但要有明显的 AI 写真 / 电商模特图质感：五官精致端正、皮肤干净细腻、气色好，人物身上是柔和均匀的摄影补光（受光方向与色温仍和场景一致），一看就是 AI 生成的人物，而不是随手拍到的路人。',
      '脸型、五官、眉眼与唇形都要和原来的人明显不同，无法被认出是原来的人；保留大致年龄段与性别观感、表情情绪、头部朝向与视线方向，发型长短与发色大体保持。',
      '衣着的款式、颜色、图案与穿搭（包括眼镜、包、首饰等配饰）保持不变，身体姿态与手部动作保持不变；去掉能识别个人身份的细节，如胸牌姓名、纹身、证件。不要打码、模糊或加遮挡；人物边缘与地面投影要自然，不要像抠图贴进场景。',
    ],
  };
  return [intro, ...byStyle[style], ...FACE_MASK_KEEP_SCENE].join('\n');
}

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
   * @description 按所选风格处理这一镜画面里的真人（3D 卡通大头 / 动画大头 / 拟人风格 / AI 去除真人特征）：以当前画面为底图走图像编辑，
   *   新图入图库后绑定到这一段，记下所用风格，并把处理前的画面记进 `originalMedia` 供一键恢复。反复处理时不覆盖最早那张原图。
   *   火山系模型（Seedance / 豆包）不收带真人的参考图，这是把实拍镜头喂进去之前的常规处理。
   * @keyword-cn 分镜卡通换头, 遮挡真人
   * @keyword-en shot-face-mask, cover-real-person
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} shotId 分镜段落 ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @param {DouyinFaceMaskStyle} [style] 处理风格，缺省 3D 卡通大头。
   * @returns {Promise<{topic: DouyinTopicEntity, shotId: string, imageId: number, imageUrl: string}>} 更新结果。
   * @throws {BadRequestException} DOUYIN_CHILD_TOPIC_NOT_FOUND / DOUYIN_STORYBOARD_SHOT_NOT_FOUND / DOUYIN_SHOT_IMAGE_REQUIRED。
   */
  async maskFaces(
    topicId: number,
    shotId: string,
    scope: DouyinScope,
    style: DouyinFaceMaskStyle = 'cartoon-3d',
  ): Promise<{
    topic: DouyinTopicEntity;
    shotId: string;
    imageId: number;
    imageUrl: string;
  }> {
    const { topic, shot } = await this.requireShot(topicId, shotId, scope);
    const baseImage = String(shot.media?.url ?? '').trim();
    if (!baseImage || shot.media?.type !== 'image') {
      throw new BadRequestException('DOUYIN_SHOT_IMAGE_REQUIRED');
    }
    const nodeRuntime = await this.workflowModels.resolveNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.key,
      WORKFLOW_NODES.douyinWorkbench.shotImage,
    );
    const styleLabel = DOUYIN_FACE_MASK_STYLE_LABELS[style];
    const generated = await this.agentService.sendPrompt({
      prompt: buildShotFaceMaskPrompt(style),
      runtimeOverride: nodeRuntime ?? undefined,
      size: DOUYIN_SHOT_IMAGE_SIZE,
      includeSystemPrompt: false,
      baseImageCandidates: [baseImage],
      billingContext: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        platformScope: !scope.tenantId,
        source: 'douyin-workbench.shot-face-mask',
      },
    });
    const image = await this.aiImages.persistGeneratedImage({
      imagePath: String(generated?.imagePath ?? ''),
      userId: scope.userId,
      tenantId: scope.tenantId,
      originalName: `${topic.title} 分镜画面（${styleLabel}）`,
      description: `抖音分镜画面:人像已处理为${styleLabel}`,
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
        faceMaskStyle: style,
        // 已经处理过就不要再改 originalMedia，否则「恢复原图」会退回上一次的处理结果
        ...(shot.originalMedia ? {} : { originalMedia: shot.media }),
      },
      scope,
    );
    return { topic: updated, shotId, imageId: image.id, imageUrl: image.url };
  }

  /**
   * @description 把这一镜的画面换回处理前的原图，并清掉 `originalMedia`。
   * @keyword-cn 恢复分镜原图, 撤销换头
   * @keyword-en restore-shot-image, undo-face-mask
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} shotId 分镜段落 ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<{topic: DouyinTopicEntity, shotId: string}>} 更新结果。
   * @throws {BadRequestException} DOUYIN_SHOT_ORIGINAL_IMAGE_NOT_FOUND。
   */
  async restoreOriginalImage(
    topicId: number,
    shotId: string,
    scope: DouyinScope,
  ): Promise<{ topic: DouyinTopicEntity; shotId: string }> {
    const { shot } = await this.requireShot(topicId, shotId, scope);
    if (!shot.originalMedia) {
      throw new BadRequestException('DOUYIN_SHOT_ORIGINAL_IMAGE_NOT_FOUND');
    }
    const updated = await this.repository.updateShot(
      topicId,
      shotId,
      { media: shot.originalMedia, originalMedia: null, faceMaskStyle: null },
      scope,
    );
    return { topic: updated, shotId };
  }

  /**
   * @description 读取一个子选题（脚本），不是子选题时报错。
   * @keyword-cn 读取脚本选题, 子选题校验
   * @keyword-en require-child-topic, child-topic-check
   * @param {number} topicId 子选题 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns {Promise<DouyinTopicEntity>} 选题。
   * @throws {BadRequestException} DOUYIN_CHILD_TOPIC_NOT_FOUND。
   */
  private async requireTopic(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child') {
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    }
    return topic;
  }

  /**
   * @description 读取一段分镜，找不到时报错。
   * @keyword-cn 读取分镜段落, 段落校验
   * @keyword-en require-storyboard-shot, shot-check
   * @param {number} topicId 子选题 ID。
   * @param {string} shotId 分镜段落 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns {Promise<{topic: DouyinTopicEntity, shot: DouyinStoryboardShot}>} 选题与分镜段落。
   * @throws {BadRequestException} DOUYIN_STORYBOARD_SHOT_NOT_FOUND。
   */
  private async requireShot(
    topicId: number,
    shotId: string,
    scope: DouyinScope,
  ): Promise<{ topic: DouyinTopicEntity; shot: DouyinStoryboardShot }> {
    const topic = await this.requireTopic(topicId, scope);
    const shot = (topic.storyboard ?? []).find((item) => item.id === shotId);
    if (!shot) {
      throw new BadRequestException('DOUYIN_STORYBOARD_SHOT_NOT_FOUND');
    }
    return { topic, shot };
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
