import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { AiBillingService } from '../../ai-billing/services/ai-billing.service.js';
import type {
  DouyinGenerationJobProgress,
  DouyinStoryboardShot,
} from '../entities/douyin-workbench.entity.js';
import {
  DouyinWorkbenchRepositoryService,
  normalizeStoryboardPreference,
} from './douyin-workbench-repository.service.js';
import { DouyinShotImageService } from './douyin-shot-image.service.js';
import {
  toWorkflowLlmConfig,
  WorkflowModelService,
} from '../../workflow-model/services/workflow-model.service.js';
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';
import {
  autoAssignShotImages,
  buildImageCandidatePrompt,
  DouyinStoryboardImageService,
  toImageMediaReference,
  type StoryboardImageCandidate,
} from './douyin-storyboard-image.service.js';

type DouyinScope = { tenantId?: string; userId: string };
type ProgressReporter = (progress: DouyinGenerationJobProgress) => void;

/**
 * @description AI 出图偏向下同一条分镜同时文生图的镜头数，避免一次把生图运行时打满。
 * @keyword-cn 分镜出图并发, 生图限流
 * @keyword-en shot-image-concurrency, image-rate-limit
 */
export const STORYBOARD_IMAGE_GENERATION_CONCURRENCY = 2;

/**
 * @description AI 出图偏向下交给 LLM 的配图说明：不提供图库清单，只要求把 image_prompt 写好。
 * @keyword-cn AI出图说明, 配图提示词
 * @keyword-en ai-image-instruction, image-prompt-guide
 */
const GENERATE_IMAGE_INSTRUCTION =
  '本条分镜的画面稍后会按每段的 image_prompt 逐镜 AI 生成，不要传 image_id；image_prompt 要足够具体，能直接出图。';

/**
 * @description 使用真实 LLM 工具调用生成结构化抖音分镜并直接写入选题。
 * @keyword-cn 抖音分镜生成, 结构化工具调用
 * @keyword-en douyin-storyboard-generation, structured-tool-call
 */
@Injectable()
export class DouyinStoryboardGenerationService {
  private readonly logger = new Logger(DouyinStoryboardGenerationService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly billing: AiBillingService,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly images: DouyinStoryboardImageService,
    private readonly shotImages: DouyinShotImageService,
    private readonly workflowModels: WorkflowModelService,
  ) {}

  /**
   * @description 为当前用户子选题生成四至十二段真实分镜并持久化，配图按脚本的配图偏向走：
   *   图库自找——先从租户图库（可限定标签）挑候选图交给 LLM 逐段选图，没选的镜头按相关度自动补图，文字与画面一起保存；
   *   AI 生成——先保存纯文字分镜（进度进入 `imaging`，前端即可看到文字），再逐镜文生图，单镜失败不影响整条。
   *   `onProgress` 回报已写入段数与已出图数，供后台任务展示进度。
   * @keyword-cn 生成真实分镜, 保存镜头脚本, 分镜自动配图, 先文字后配图
   * @keyword-en generate-real-storyboard, persist-shot-script, storyboard-auto-image, text-first-imaging
   */
  async generate(
    topicId: number,
    prompt: string | undefined,
    scope: DouyinScope,
    onProgress?: ProgressReporter,
  ): Promise<{
    storyboard: DouyinStoryboardShot[];
    imageCount: number;
    imageFailedCount: number;
  }> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child') {
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    }
    const requirement = String(prompt ?? '').trim();
    const parent = topic.parentId
      ? await this.repository.get(topic.parentId, scope)
      : null;
    const script = String(topic.script ?? '').trim();
    const preference = normalizeStoryboardPreference(
      topic.storyboardPreference,
    );
    const useGallery = preference.imageSource === 'gallery';
    const candidates = useGallery
      ? await this.images.loadCandidates(
          [parent?.title, topic.title, script.slice(0, 400), requirement]
            .filter(Boolean)
            .join(' '),
          scope,
          preference.galleryTags,
        )
      : [];
    const shots: DouyinStoryboardShot[] = [];
    const addShot = this.createShotTool(shots, candidates, onProgress);
    const imagePrompt = useGallery
      ? buildImageCandidatePrompt(candidates)
      : GENERATE_IMAGE_INSTRUCTION;
    await this.billing.chargeService({
      serviceCode: 'text-generation',
      tenantId: scope.tenantId,
      userId: scope.userId,
      operationId: `douyin-storyboard:${topicId}:${randomUUID()}`,
      source: 'douyin-workbench.storyboard-generation',
      platformScope: !scope.tenantId,
    });
    onProgress?.({ stage: 'writing', current: 0 });
    await this.billing.runWithServiceBilling(async () => {
      await this.runAgent(
        topic.title,
        script,
        topic.topicType,
        requirement,
        imagePrompt,
        shots,
        addShot,
        scope,
      );
      if (shots.length < 4) {
        await this.runAgent(
          topic.title,
          script,
          topic.topicType,
          `已有 ${shots.length} 段，还需要补足到至少 4 段。${requirement}`,
          imagePrompt,
          shots,
          addShot,
          scope,
        );
      }
    });
    if (shots.length < 4)
      throw new BadRequestException('DOUYIN_STORYBOARD_INCOMPLETE');
    if (useGallery) {
      autoAssignShotImages(shots, candidates);
      onProgress?.({ stage: 'saving', current: shots.length });
      await this.repository.update(topicId, { storyboard: shots }, scope);
      return { storyboard: shots, imageCount: 0, imageFailedCount: 0 };
    }

    await this.repository.update(topicId, { storyboard: shots }, scope);
    const outcome = await this.generateShotImages(
      topicId,
      shots,
      scope,
      onProgress,
    );
    return { storyboard: shots, ...outcome };
  }

  /**
   * @description 文字分镜落库后逐镜文生图：按固定并发出图，每出完一张回报 `imaging` 进度；
   *   单镜出图失败只计数，已成功的画面已经各自写回，不会被回滚。
   * @keyword-cn 逐镜出图, 先文字后配图
   * @keyword-en generate-shot-images, text-first-imaging
   * @param topicId 子选题（脚本）ID。
   * @param shots 刚保存的文字分镜。
   * @param scope 当前租户用户作用域。
   * @param onProgress 进度回报。
   * @returns 出图成功与失败的镜头数。
   */
  private async generateShotImages(
    topicId: number,
    shots: DouyinStoryboardShot[],
    scope: DouyinScope,
    onProgress?: ProgressReporter,
  ): Promise<{ imageCount: number; imageFailedCount: number }> {
    let imageCount = 0;
    let imageFailedCount = 0;
    let cursor = 0;
    onProgress?.({ stage: 'imaging', current: 0, total: shots.length });
    const worker = async () => {
      while (cursor < shots.length) {
        const shot = shots[cursor];
        cursor += 1;
        try {
          await this.shotImages.regenerate(topicId, shot.id, undefined, scope);
          imageCount += 1;
        } catch (error) {
          imageFailedCount += 1;
          this.logger.warn(
            `[generateShotImages] 出图失败 topic=${topicId} shot=${shot.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        onProgress?.({
          stage: 'imaging',
          current: imageCount + imageFailedCount,
          total: shots.length,
        });
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            STORYBOARD_IMAGE_GENERATION_CONCURRENCY,
            shots.length,
          ),
        },
        worker,
      ),
    );
    return { imageCount, imageFailedCount };
  }

  /**
   * @description 创建逐段写入内存的分镜工具，禁止模型用最终文本冒充结构化结果；`image_id` 只接受候选清单里的图片，
   *   不在清单里的编号直接忽略（该段留给自动补图），每写入一段回报一次进度。
   * @keyword-cn 分镜追加工具, 内存写入, 分镜选图
   * @keyword-en storyboard-append-tool, memory-write, storyboard-image-pick
   */
  private createShotTool(
    shots: DouyinStoryboardShot[],
    candidates: StoryboardImageCandidate[],
    onProgress?: ProgressReporter,
  ) {
    const candidateById = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    return tool(
      (input) => {
        if (shots.length >= 12) return '已达到 12 段上限。';
        const imageId = Number(input.image_id);
        const candidate = Number.isInteger(imageId)
          ? candidateById.get(imageId)
          : undefined;
        const reusedAt = candidate
          ? shots.findIndex((shot) => shot.media?.id === candidate.id)
          : -1;
        shots.push({
          id: randomUUID(),
          duration: Math.max(1, Math.min(120, Number(input.duration))),
          shotType: input.shot_type.trim(),
          visual: input.visual.trim(),
          narration: input.narration.trim(),
          transition: input.transition.trim(),
          media: candidate ? toImageMediaReference(candidate) : null,
          imagePrompt:
            String(input.image_prompt ?? '')
              .trim()
              .slice(0, 1000) || undefined,
        });
        onProgress?.({ stage: 'writing', current: shots.length });
        const notes = [
          input.image_id !== undefined && !candidate
            ? `image_id ${input.image_id} 不在可用图片清单里，本段先不配图。`
            : '',
          reusedAt >= 0
            ? `提示：这张图第 ${reusedAt + 1} 段已经用过，后续尽量换一张。`
            : '',
        ].filter(Boolean);
        return [`已保存第 ${shots.length} 段分镜。`, ...notes].join('');
      },
      {
        name: 'douyin_workbench_add_storyboard_shot',
        description:
          '逐段保存抖音短视频分镜。每个镜头必须单独调用一次，最终回答不会被读取。',
        schema: z.object({
          duration: z.number().min(1).max(120).describe('镜头秒数'),
          shot_type: z.string().min(1).max(30).describe('景别或镜头类型'),
          visual: z
            .string()
            .min(2)
            .max(1000)
            .describe('可执行的画面与动作说明'),
          narration: z
            .string()
            .max(1000)
            .describe('旁白或口播，无旁白时传空字符串'),
          transition: z.string().max(100).describe('与下一镜头的转场'),
          image_id: z
            .number()
            .int()
            .optional()
            .describe(
              '从【可用图片】清单里选一张最贴合本镜头画面的图片编号；没有合适的不传',
            ),
          image_prompt: z
            .string()
            .max(1000)
            .describe(
              '本镜头的竖屏文生图描述，用户点「重新生成画面」时按它出图：写清主体、动作、环境、镜头语言与光线，不要要求画面出现文字',
            ),
        }),
      },
    );
  }

  /**
   * @description 调用配置中的默认文本模型并要求逐段使用分镜工具交付，同时附上候选图片清单让模型逐段选图。
   * @keyword-cn 执行分镜Agent, 抖音创作约束
   * @keyword-en run-storyboard-agent, douyin-creative-constraints
   */
  private async runAgent(
    title: string,
    script: string,
    topicType: string | undefined,
    requirement: string,
    imagePrompt: string,
    shots: DouyinStoryboardShot[],
    addShot: ReturnType<typeof tool>,
    scope: DouyinScope,
  ): Promise<void> {
    await this.agentService.runWithMessages({
      config: {
        ...toWorkflowLlmConfig(
          await this.workflowModels.resolveNodeRuntime(
            WORKFLOW_NODES.douyinWorkbench.key,
            WORKFLOW_NODES.douyinWorkbench.storyboard,
          ),
        ),
        system: [
          '你是抖音短视频导演。把给定脚本拆成可直接拍摄或交给视频生成器执行的竖屏分镜。',
          '给了脚本正文时，必须按正文顺序逐段拆解：每段的 narration 直接取自正文对应句子，不要改写立意、不要新增正文里没有的信息、不要漏掉正文的收尾。',
          '总时长优先控制在 15-60 秒，前 3 秒必须有强钩子，后段包含明确收束或行动引导。',
          '只通过 douyin_workbench_add_storyboard_shot 逐段交付，共 4-12 段；不要在最终回答输出分镜。',
          '不得编造真实数据、虚假承诺或违法违规内容。',
          '画面描述要能和所配图片对应上：选了图就围绕这张图的内容写画面，不要写图片里没有的元素。',
          '每段都要给 image_prompt：一句可以直接拿去文生图的竖屏画面描述，写清主体、动作、环境、镜头语言和光线氛围，不要含文字水印要求。',
          imagePrompt,
        ].join('\n'),
        tools: [addShot],
        temperature: 0.4,
        noPostHook: true,
        nonStreaming: true,
        tenantId: scope.tenantId,
        billingContext: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          source: 'douyin-workbench.storyboard-generation',
          operationId: `douyin-storyboard-${Date.now()}`,
          platformScope: !scope.tenantId,
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            `脚本标题：${title}`,
            script
              ? `脚本正文（必须按它拆分镜头，旁白直接取自这段正文）：\n<script>${script}</script>`
              : '脚本正文：无，请按标题自行撰写旁白。',
            `内容类型：${topicType || '由你判断'}`,
            requirement ? `补充要求：${requirement}` : '',
            `当前已保存 ${shots.length} 段，请继续完成。`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      callOption: { recursionLimit: 100 },
    });
  }
}
