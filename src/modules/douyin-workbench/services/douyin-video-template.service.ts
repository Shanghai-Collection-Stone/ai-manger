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
  punchTemplateWindow,
  sizeTemplateWindow,
} from './douyin-video-template.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

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
 * @description 视频版式模板：「生图」节点在实拍图上编辑出带绿色窗口的模板海报（只排版，不新造画面内容），抠成透明窗口的 PNG 并与首帧拼成封面；
 *   要不要套、套什么由 AI 导演（`DouyinVideoDirectorService`）规划，这里负责出图与用户的改文案、开关、删除。分镜 / 整片 / 探店共用，不新增工作流节点。
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
   * @description 出模板图并写回：「生图」节点以实拍图为底图编辑出带绿色窗口的海报（只排版、不新造内容），抠成透明窗口 PNG 存储，再用首帧拼封面（没有首帧时不出封面）；
   *   窗口位置与比例以识别到的绿块为准，模板标为启用。生成的临时原图读完即删。AI 导演与用户改文案都走这里。
   *   没有实拍图可编辑、或「生图」模型只能凭空生成（不支持带底图）时直接拒绝，不退回凭空画。
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
  ): Promise<DouyinTopicEntity> {
    const baseUrl = this.editBaseUrl(topic);
    if (!baseUrl)
      throw new BadRequestException(
        '模板只在实拍图上编辑排版，不凭空生成：请先给第 1 段配好门店图片',
      );
    const node = await this.workflowModels.resolveNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.key,
      WORKFLOW_NODES.douyinWorkbench.image,
    );
    const generated = await this.agentService
      .sendPrompt({
        prompt: buildTemplateEditPrompt(template),
        runtimeOverride: node ?? undefined,
        size: DOUYIN_SHOT_IMAGE_SIZE,
        includeSystemPrompt: false,
        baseImageCandidates: [baseUrl],
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
    const punched = await punchTemplateWindow(source, template.window);
    if (!punched.detected)
      this.logger.warn(
        `[applyTemplate] topic=${topic.id} 模板图里没认出绿色窗口，按规划位置抠窗`,
      );
    const imageUrl = await this.storage.saveImage(punched.png, {
      scope,
      fileName: `template-${topic.id}.png`,
      contentType: 'image/png',
    });
    let coverUrl: string | undefined;
    const frameUrl = this.firstFrameUrl(topic);
    if (frameUrl) {
      const frame = await this.readImage(frameUrl);
      if (frame) {
        coverUrl = await this.storage.saveImage(
          await composeTemplateCover(punched.png, frame, punched.window),
          {
            scope,
            fileName: `template-cover-${topic.id}.jpg`,
            contentType: 'image/jpeg',
          },
        );
      }
    }
    return await this.save(
      topic.id,
      {
        ...template,
        enabled: true,
        window: punched.window,
        aspectRatio: punched.aspectRatio,
        imageUrl,
        coverUrl,
        updatedAt: new Date(),
      },
      scope,
    );
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
