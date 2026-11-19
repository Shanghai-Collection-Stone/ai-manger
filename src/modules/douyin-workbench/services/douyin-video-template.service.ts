import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { readFile, unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { resolveGeneratedImageFile } from '../../gallery/services/gallery-ai-image.service.js';
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';
import { WorkflowModelService } from '../../workflow-model/services/workflow-model.service.js';
import type {
  DouyinTemplateAspect,
  DouyinTopicEntity,
  DouyinVideoTemplate,
} from '../entities/douyin-workbench.entity.js';
import { toOpensourceVideoImageData } from './douyin-opensource-video.service.js';
import { DOUYIN_SHOT_IMAGE_SIZE } from './douyin-shot-image.service.js';
import { DouyinVideoStorageService } from './douyin-video-storage.service.js';
import {
  buildTemplateEditPrompt,
  composeTemplateCover,
  DOUYIN_TEMPLATE_CANVAS,
  normalizeTemplateCopy,
  pickTemplateAspect,
  punchTemplateWindow,
  sizeTemplateWindow,
} from './douyin-video-template.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';
import { listDirectorFrames } from './douyin-video-director.js';
import type { DouyinTemplatePlan } from './douyin-video-template.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 模板改图失败的说明：「生图」模型只能凭空生成（如数眼生图没有改图接口）时提示换支持图生图的模型，其他错误原样返回。
 * @keyword-cn 模板改图报错, 不支持改图
 * @keyword-en template-edit-error, edit-not-supported
 * @param error 原错误。
 * @returns {unknown} 要抛出的错误。
 */
export function describeTemplateEditError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/IMAGE_PROVIDER_NOT_SUPPORTED/.test(message))
    return new BadRequestException(
      '「生图」节点当前的模型只能凭空生成、不能改图。模板只在实拍图上编辑排版，请把「生图」换成支持图生图的模型（如豆包 Seedream、GPT-Image 或 Gemini）',
    );
  return error;
}

/**
 * @description 逐段按对应素材生成可选版式与小装饰，保留完整照片；支持用户改文案、开关、删除与导演缩略图。

 * @keyword-cn 视频版式模板, 读图规划模板, 模板首帧拼合
 * @keyword-en video-layout-template, vision-template-plan, template-cover
 */
@Injectable()
export class DouyinVideoTemplateService {
  private readonly logger = new Logger(DouyinVideoTemplateService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly workflowModels: WorkflowModelService,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly storage: DouyinVideoStorageService,
  ) {}

  /**
   * @description 按改过的文案 / 比例重新出模板图与封面：改了比例时窗口按原来的宽度与位置重算；还没规划过时提示先规划。
   *   用户改过的模板标记 `source=user`，之后 AI 导演重新规划时不再覆盖。
   * @keyword-cn 重新生成模板, 修改模板文案
   * @keyword-en render-video-template, edit-template-copy
   * @param topicId 子选题（脚本）ID。
   * @param patch 要改的文案、风格与窗口比例（不传的沿用）。
   * @param scope 租户用户作用域。
   * @returns 更新后的选题。
   */
  async render(
    topicId: number,
    patch: {
      title?: string;
      subtitle?: string;
      sellingPoints?: string[];
      cta?: string;
      style?: string;
      aspectRatio?: DouyinTemplateAspect;
    },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.requireChild(topicId, scope);
    const current = topic.videoTemplate;
    if (!current) throw new BadRequestException('还没有模板，请先让 AI 规划');
    const copy = normalizeTemplateCopy({ ...current, ...patch });
    if (!copy.title) throw new BadRequestException('模板标题不能为空');
    const aspectRatio = patch.aspectRatio ?? current.aspectRatio;
    const { width, height } = DOUYIN_TEMPLATE_CANVAS;
    const window =
      aspectRatio === current.aspectRatio
        ? current.window
        : sizeTemplateWindow({
            aspect: aspectRatio,
            x: current.window.x / width,
            y: current.window.y / height,
            width: current.window.width / width,
          });
    return await this.applyTemplate(
      topic,
      {
        ...current,
        ...copy,
        subtitle: copy.subtitle || undefined,
        cta: copy.cta || undefined,
        aspectRatio,
        window,
        source: 'user',
      },
      scope,
    );
  }

  /**
   * @description 开关模板：开启要求已有模板图；关闭后出片与合成回到满屏 9:16，模板内容保留。开关过的模板标记 `source=user`，AI 导演不再改。
   * @keyword-cn 开关模板, 启用版式模板
   * @keyword-en toggle-video-template, enable-layout-template
   * @param topicId 子选题（脚本）ID。
   * @param enabled 是否启用。
   * @param scope 租户用户作用域。
   * @returns 更新后的选题。
   */
  async setEnabled(
    topicId: number,
    enabled: boolean,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.requireChild(topicId, scope);
    const current = topic.videoTemplate;
    if (!current) throw new BadRequestException('还没有模板，请先让 AI 规划');
    if (enabled && !current.imageUrl)
      throw new BadRequestException('模板图还没生成，请先生成模板');
    return await this.save(
      topic.id,
      { ...current, enabled, source: 'user', updatedAt: new Date() },
      scope,
    );
  }

  /**
   * @description 删除选题的模板（模板图文件留在存储里，不影响已合成的视频）。删除后 AI 导演下次规划可以重新给出模板。
   * @keyword-cn 删除模板, 清除版式
   * @keyword-en remove-video-template, clear-layout
   * @param topicId 子选题（脚本）ID。
   * @param scope 租户用户作用域。
   * @returns 更新后的选题。
   */
  async remove(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    await this.requireChild(topicId, scope);
    const updated = await this.repository.setVideoTemplate(
      topicId,
      null,
      scope,
    );
    if (!updated) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return updated;
  }

  /**
   * @description 按每段素材分别出图，共用标题、风格和窗口区域；后续段参考首个已出模板统一视觉，仅调整素材比例与小装饰，绑定sourceKey。

   * @keyword-cn 生成模板图, 模板抠窗拼封面
   * @keyword-en render-template-image, punch-and-compose
   * @param topic 子选题。
   * @param template 待出图的模板（文案、窗口、比例与来源）。
   * @param scope 租户用户作用域。
   * @returns 更新后的选题。
   * @throws {BadRequestException} 没有实拍图，或「生图」模型不支持改图。
   */
  async applyTemplate(
    topic: DouyinTopicEntity,
    template: DouyinVideoTemplate,
    scope: DouyinScope,
    plans: Record<string, DouyinTemplatePlan> = {},
  ): Promise<DouyinTopicEntity> {
    const frames = listDirectorFrames(topic);
    if (!frames.length) {
      const rendered = await this.renderTemplateImage(topic, template, scope);
      return await this.save(topic.id, rendered, scope);
    }
    const variants: Record<string, DouyinVideoTemplate> = {};
    let styleReferenceUrl: string | undefined;
    for (const frame of frames) {
      const plan = plans[frame.key];
      const variant: DouyinVideoTemplate = {
        ...template,
        ...(plan
          ? {
              enabled: plan.useTemplate,
              window: plan.window,
              aspectRatio: plan.aspectRatio,
              ...normalizeTemplateCopy(plan),
              reason: plan.reason,
            }
          : {}),
        title: template.title,
        style: template.style,
        window: template.window,
        variants: undefined,
        imageUrl: undefined,
        coverUrl: undefined,
        sourceKey: frame.sourceKey,
      };
      variants[frame.key] = variant.enabled
        ? await this.renderTemplateImage(topic, variant, scope, {
            baseUrl: frame.url,
            frameUrl: frame.url,
            key: frame.key,
            styleReferenceUrl,
            brief: `本段画面：${frame.visual}；场景：${frame.scene}；台词：${frame.lines}${plan?.style ? `；本段局部调整建议（仅采用素材适配和小装饰位置、大小，不改变全片配色、字体、标题与布局体系）：${plan.style}` : ''}`,
          })
        : variant;
      if (!styleReferenceUrl && variants[frame.key].imageUrl)
        styleReferenceUrl = variants[frame.key].imageUrl;
    }
    const preview = Object.values(variants).find(
      (variant) => variant.enabled && variant.imageUrl,
    );
    const latest = await this.repository.get(topic.id, scope);
    if (!latest) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    if (latest.videoTemplate?.source === 'user' && template.source !== 'user')
      return latest;
    if (JSON.stringify(listDirectorFrames(latest)) !== JSON.stringify(frames))
      return latest;
    return await this.save(
      topic.id,
      {
        ...template,
        imageUrl: preview?.imageUrl,
        coverUrl: preview?.coverUrl,
        variants,
        updatedAt: new Date(),
      },
      scope,
    );
  }

  /**
   * @description 按统一窗口区域完整适配本段素材，后续段携带首个模板作为风格参考生成模板和首帧预览，不修改选题。
   * @keyword-cn 分段模板出图, 素材适配
   * @keyword-en render-segment-template, material-adaptation
   */
  private async renderTemplateImage(
    topic: DouyinTopicEntity,
    template: DouyinVideoTemplate,
    scope: DouyinScope,
    input: {
      baseUrl?: string;
      frameUrl?: string;
      key?: string;
      brief?: string;
      styleReferenceUrl?: string;
    } = {},
  ): Promise<DouyinVideoTemplate> {
    const baseUrl = input.baseUrl || this.editBaseUrl(topic);
    if (!baseUrl)
      throw new BadRequestException(
        '模板只在实拍图上编辑排版，不凭空生成：请先给第 1 段配好门店图片',
      );
    const base = await this.readImage(baseUrl);
    if (base) {
      const meta = await sharp(base)
        .metadata()
        .catch(() => null);
      const width = meta?.autoOrient?.width ?? meta?.width;
      const height = meta?.autoOrient?.height ?? meta?.height;
      if (width && height) {
        const box = template.window;
        const scale = Math.min(box.width / width, box.height / height);
        const fittedWidth = Math.max(2, Math.floor((width * scale) / 2) * 2);
        const fittedHeight = Math.max(2, Math.floor((height * scale) / 2) * 2);
        template = {
          ...template,
          window: {
            x: Math.floor((box.x + (box.width - fittedWidth) / 2) / 2) * 2,
            y: Math.floor((box.y + (box.height - fittedHeight) / 2) / 2) * 2,
            width: fittedWidth,
            height: fittedHeight,
          },
          aspectRatio: pickTemplateAspect(width, height),
        };
      }
    }
    const node = await this.workflowModels.resolveNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.key,
      WORKFLOW_NODES.douyinWorkbench.image,
    );
    const generated = await this.agentService
      .sendPrompt({
        prompt: [
          buildTemplateEditPrompt(template),
          input.brief,
          input.styleReferenceUrl
            ? '图1是本段真实素材，图2仅作全片统一视觉参考。沿用图2的主辅色、字体字重、字号层级、标题和卖点的摆放、圆角描边与贴纸画法；只替换本段素材、指定文案和少量小装饰。不要从图2复制场景、人物、商品或旧文案，不因本段照片色调改变整套设计。窗口按给定位置与尺寸，仅在共同视频区域内适配原图比例。'
            : '本图将作为全片后续片段的固定视觉参考，请明确统一主辅色、字体、字号层级、标题位置、圆角描边和贴纸画法。',
        ]
          .filter(Boolean)
          .join('\n'),
        runtimeOverride: node ?? undefined,
        size: DOUYIN_SHOT_IMAGE_SIZE,
        includeSystemPrompt: false,
        baseImageCandidates: [baseUrl],
        ...(input.styleReferenceUrl
          ? { extraImageCandidates: [input.styleReferenceUrl] }
          : {}),
        billingContext: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          platformScope: !scope.tenantId,
          source: 'douyin-workbench.video-template-image',
        },
      })
      .catch((error: unknown) => {
        throw describeTemplateEditError(error);
      });
    const file = resolveGeneratedImageFile(String(generated?.imagePath ?? ''));
    if (!file) throw new BadGatewayException('模板图生成失败，请重试');
    const source = await readFile(file.absPath);
    await unlink(file.absPath).catch(() => undefined);
    const punched = await punchTemplateWindow(source, template.window, true);
    if (!punched.detected)
      this.logger.warn(
        `[applyTemplate] topic=${topic.id} 模板图里没认出绿色窗口，按规划位置抠窗`,
      );
    const imageUrl = await this.storage.saveImage(punched.png, {
      scope,
      fileName: `template-${topic.id}-${input.key || 'cover'}.png`,
      contentType: 'image/png',
    });
    let coverUrl: string | undefined;
    const frameUrl = input.frameUrl || this.firstFrameUrl(topic);
    if (frameUrl) {
      const frame = await this.readImage(frameUrl);
      if (frame) {
        coverUrl = await this.storage.saveImage(
          await composeTemplateCover(punched.png, frame, punched.window),
          {
            scope,
            fileName: `template-cover-${topic.id}-${input.key || 'cover'}.jpg`,
            contentType: 'image/jpeg',
          },
        );
      }
    }
    return {
      ...template,
      enabled: true,
      window: punched.window,
      aspectRatio: punched.aspectRatio,
      imageUrl,
      coverUrl,
      updatedAt: new Date(),
    };
  }

  /**
   * @description 模板改图的底图：探店取第 1 个配了门店图片的分段的实拍场景图（不用合成的人物首帧），没有时取素材里第一张门店图；
   *   分镜取第一个配了图片的镜头。都没有返回 undefined（不出模板）。
   * @keyword-cn 模板改图底图, 实拍图优先
   * @keyword-en template-edit-base, real-photo-first
   * @param topic 子选题。
   * @returns 底图地址，没有时为 undefined。
   */
  private editBaseUrl(topic: DouyinTopicEntity): string | undefined {
    if (topic.productionMode === 'store-visit') {
      const visit = topic.storeVisit;
      const first = visit?.segments?.find((segment) => segment.sceneImageId);
      return (
        visit?.sceneImages?.find((image) => image.id === first?.sceneImageId)
          ?.url ||
        visit?.sceneImages?.find((image) => image.url)?.url ||
        undefined
      );
    }
    return (
      (topic.storyboard ?? []).find(
        (shot) => shot.media?.type === 'image' && shot.media.url,
      )?.media?.url || undefined
    );
  }

  /**
   * @description 拼封面用的首帧：探店取第 1 段人物首帧，没有时取第 1 段的场景图；分镜取第一个配了图片的镜头。
   * @keyword-cn 模板参考图, 首帧来源
   * @keyword-en template-frame-sources, first-frame-source
   * @param topic 子选题。
   * @returns 首帧地址，没有时为 undefined。
   */
  private firstFrameUrl(topic: DouyinTopicEntity): string | undefined {
    if (topic.productionMode === 'store-visit') {
      const visit = topic.storeVisit;
      const first = visit?.segments?.find((segment) => segment.sceneImageId);
      return (
        visit?.segments?.[0]?.keyframe?.url ||
        visit?.sceneImages?.find((image) => image.id === first?.sceneImageId)
          ?.url ||
        undefined
      );
    }
    return (
      (topic.storyboard ?? []).find(
        (shot) => shot.media?.type === 'image' && shot.media.url,
      )?.media?.url || undefined
    );
  }

  /**
   * @description 读一张图的字节（站内 `/static`、公网地址或 data URL），读不到返回 null 并记日志；AI 导演读首帧也用它。
   * @keyword-cn 读取首帧图片, 图片字节
   * @keyword-en read-frame-image, image-bytes
   * @param url 图片地址。
   * @returns 图片字节或 null。
   */
  async readImage(url: string): Promise<Buffer | null> {
    try {
      const data = await toOpensourceVideoImageData(url);
      return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    } catch (error) {
      this.logger.warn(
        `[readImage] 读取图片失败 ${url.slice(0, 120)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * @description 把一张图缩到长边 `size` 的 JPEG data URL 交给读图模型，读不到返回空串（跳过这张）。
   * @keyword-cn 规划用缩略图, 读图输入
   * @keyword-en plan-image-thumbnail, vision-input
   * @param url 图片地址。
   * @param size 长边像素，缺省 768。
   * @returns data URL 或空串。
   */
  async toVisionImage(url: string, size = 768): Promise<string> {
    const image = await this.readImage(url);
    if (!image) return '';
    const thumbnail = await sharp(image)
      .autoOrient()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
      .catch(() => null);
    return thumbnail
      ? `data:image/jpeg;base64,${thumbnail.toString('base64')}`
      : '';
  }

  /**
   * @description 读取子选题，不存在或不是子选题时报错。
   * @keyword-cn 读取子选题, 选题校验
   * @keyword-en require-child-topic, topic-check
   * @param topicId 子选题 ID。
   * @param scope 租户用户作用域。
   * @returns 子选题。
   */
  private async requireChild(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return topic;
  }

  /**
   * @description 写入模板并返回更新后的选题，选题已被删除时报错。
   * @keyword-cn 写入模板, 保存模板结果
   * @keyword-en persist-video-template, save-template-result
   * @param topicId 子选题 ID。
   * @param template 模板。
   * @param scope 租户用户作用域。
   * @returns 更新后的选题。
   */
  private async save(
    topicId: number,
    template: DouyinVideoTemplate,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const updated = await this.repository.setVideoTemplate(
      topicId,
      template,
      scope,
    );
    if (!updated) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return updated;
  }
}
