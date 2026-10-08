import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { AiBillingService } from '../../ai-billing/services/ai-billing.service.js';
import {
  DOUYIN_SCRIPT_STYLES,
  type DouyinGenerationJobProgress,
  type DouyinPublishCopy,
  type DouyinScriptStyle,
  type DouyinStoryboardShot,
} from '../entities/douyin-workbench.entity.js';
import { DouyinPersonaRepositoryService } from '../../douyin-persona/services/douyin-persona-repository.service.js';
import { buildPersonaScriptBrief } from '../../douyin-persona/services/douyin-persona-prompt.js';
import {
  DouyinWorkbenchRepositoryService,
  normalizePublishCopy,
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
 * @description AI 出图偏向下逐镜出图的方式：线性串行。第 N 镜以第 N-1 镜刚生成的画面为底图，
 *   镜头之间的场景、光线与人物状态才能延续；代价是不能并发，一条分镜的出图时间约等于镜头数乘单张耗时。
 * @keyword-cn 线性连贯出图, 串行出图
 * @keyword-en linear-shot-imaging, serial-image-generation
 */
export const STORYBOARD_IMAGE_GENERATION_LINEAR = true;

/**
 * @description AI 出图偏向下交给 LLM 的配图说明：不提供图库清单，只要求把 image_prompt 写好。
 * @keyword-cn AI出图说明, 配图提示词
 * @keyword-en ai-image-instruction, image-prompt-guide
 */
const GENERATE_IMAGE_INSTRUCTION =
  '本条分镜的画面稍后会按每段的 image_prompt 逐镜 AI 生成；image_prompt 要足够具体，能直接出图。';

/**
 * @description 一次写完整条分镜的结构化输出：4-12 段镜头，每段含时长、景别、画面、旁白、转场与配图提示词。
 * @keyword-cn 分镜结构, 一次写完分镜
 * @keyword-en storyboard-schema, single-shot-storyboard
 */
const ZDouyinStoryboard = z.object({
  shots: z
    .array(
      z.object({
        duration: z.number().describe('镜头秒数，1-120'),
        shot_type: z.string().describe('景别或镜头类型，如特写 / 中景 / 航拍'),
        visual: z.string().describe('可执行的画面与动作说明'),
        narration: z
          .string()
          .describe('旁白或口播，取自脚本正文对应句子；无旁白传空字符串'),
        transition: z.string().describe('与下一镜头的转场'),
        image_prompt: z
          .string()
          .describe(
            '本镜头的竖屏文生图描述：写清主体、动作、环境、镜头语言与光线，不要要求画面出现文字',
          ),
      }),
    )
    .describe('按脚本顺序排列的 4-12 段分镜'),
});

/**
 * @description 分镜选图的结构化输出：第几段配哪张候选图，没合适的可以不给。
 * @keyword-cn 分镜选图结构, 候选图编号
 * @keyword-en shot-image-pick-schema, candidate-image-id
 */
const ZDouyinShotImagePicks = z.object({
  picks: z
    .array(
      z.object({
        shot: z.number().describe('分镜序号，从 1 开始'),
        image_id: z.number().describe('候选清单里的图片编号（# 后面的数字）'),
      }),
    )
    .describe('每段分镜选中的图片，没有贴合的可以不给这一段'),
});

/**
 * @description 发布文案的结构化输出：标题、正文与话题，上限与视频发布库一致。
 * @keyword-cn 发布文案结构, 结构化输出
 * @keyword-en publish-copy-schema, structured-output
 */
const ZDouyinPublishCopy = z.object({
  title: z
    .string()
    .describe(
      '抖音作品标题：一句话点出看点或利益点，20 字左右，最多 60 字，不带话题井号',
    ),
  description: z
    .string()
    .describe(
      '发布正文：2-4 句口语化文案，开头一句抓人，交代看点与价值，结尾给互动引导；不复述整段口播，不写话题井号，最多 1000 字',
    ),
  tags: z
    .array(z.string())
    .describe('3-5 个抖音话题，不带井号，每个不超过 20 字，贴合内容与目标人群'),
});

/**
 * @description 使用真实 LLM 一次结构化输出生成抖音分镜并直接写入选题；图库配图另做一次关思考的选图。
 * @keyword-cn 抖音分镜生成, 结构化工具调用
 * @keyword-en douyin-storyboard-generation, structured-tool-call
 */
@Injectable()
export class DouyinStoryboardGenerationService {
  private readonly logger = new Logger(DouyinStoryboardGenerationService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly adminService: AdminService,
    private readonly billing: AiBillingService,
    private readonly personas: DouyinPersonaRepositoryService,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly images: DouyinStoryboardImageService,
    private readonly shotImages: DouyinShotImageService,
    private readonly workflowModels: WorkflowModelService,
  ) {}

  /**
   * @description 为当前用户子选题生成四至十二段真实分镜并持久化，配图按脚本的配图偏向走：
   *   图库自找——先从租户图库（可限定标签）挑候选图交给 LLM 逐段选图，没选的镜头按相关度自动补图，文字与画面一起保存；
   *   AI 生成——先保存纯文字分镜（进度进入 `imaging`，前端即可看到文字），再逐镜文生图，单镜失败不影响整条。
   *   拆分镜的同时并行写好发布文案（标题、正文、话题），随分镜一起保存；文案失败不影响分镜，原有文案保留。
   *   `onProgress` 回报已写入段数与已出图数，供后台任务展示进度。
   * @keyword-cn 生成真实分镜, 保存镜头脚本, 分镜自动配图, 先文字后配图, 同步写发布文案
   * @keyword-en generate-real-storyboard, persist-shot-script, storyboard-auto-image, text-first-imaging, publish-copy-with-storyboard
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
    publishCopyWritten: boolean;
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
    const persona = topic.personaId
      ? await this.personas.get(topic.personaId, scope)
      : null;
    const style = topic.scriptStyle;
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
    await this.billing.chargeService({
      serviceCode: 'text-generation',
      tenantId: scope.tenantId,
      userId: scope.userId,
      operationId: `douyin-storyboard:${topicId}:${randomUUID()}`,
      source: 'douyin-workbench.storyboard-generation',
      platformScope: !scope.tenantId,
    });
    onProgress?.({ stage: 'writing', current: 0 });
    const brief = {
      title: topic.title,
      script,
      topicType: topic.topicType,
      requirement,
      persona,
      style,
      useGallery,
    };
    // 发布文案只依赖脚本，与拆分镜并行跑，不拉长任务耗时；两者同在这一次 text-generation 扣费里
    const [shots, publishCopy] = await this.billing.runWithServiceBilling(() =>
      Promise.all([
        (async () => {
          let written = await this.writeStoryboard(brief, scope);
          if (written.length < 4) {
            written = await this.writeStoryboard(
              {
                ...brief,
                requirement: `上一次只写出 ${written.length} 段，至少要 4 段。${requirement}`,
              },
              scope,
            );
          }
          if (written.length < 4) return written;
          onProgress?.({ stage: 'writing', current: written.length });
          // 图库自找：分镜写好后单独一次关思考的选图，没选上的镜头保存前再按相关度补
          if (useGallery) await this.pickShotImages(written, candidates, scope);
          return written;
        })(),
        this.generatePublishCopy(
          topicId,
          {
            motherTitle: parent?.title,
            title: topic.title,
            script,
            requirement,
            persona,
            style,
          },
          scope,
        ),
      ]),
    );
    if (shots.length < 4)
      throw new BadRequestException('DOUYIN_STORYBOARD_INCOMPLETE');
    const saved = {
      storyboard: shots,
      ...(publishCopy ? { publishCopy } : {}),
    };
    const publishCopyWritten = Boolean(publishCopy);
    if (useGallery) {
      autoAssignShotImages(shots, candidates);
      onProgress?.({ stage: 'saving', current: shots.length });
      await this.repository.update(topicId, saved, scope);
      return {
        storyboard: shots,
        imageCount: 0,
        imageFailedCount: 0,
        publishCopyWritten,
      };
    }

    await this.repository.update(topicId, saved, scope);
    const outcome = await this.generateShotImages(
      topicId,
      shots,
      scope,
      onProgress,
    );
    return { storyboard: shots, ...outcome, publishCopyWritten };
  }

  /**
   * @description 按脚本标题与口播正文一次写好抖音发布文案（标题、正文、话题）。只做一次结构化输出调用，
   *   不走工具循环；模型读不到、输出不合规或调用失败都返回 null，由调用方保留原有文案、分镜照常保存。
   * @keyword-cn 生成发布文案, 分镜同步文案
   * @keyword-en generate-publish-copy, publish-copy-with-storyboard
   * @param topicId 子选题（脚本）ID，仅用于日志。
   * @param input 母题、脚本标题与正文、补充要求、出镜人物与风格。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinPublishCopy|null>} 规整后的发布文案，失败为 null。
   */
  private async generatePublishCopy(
    topicId: number,
    input: {
      motherTitle?: string;
      title: string;
      script: string;
      requirement: string;
      persona: Parameters<typeof buildPersonaScriptBrief>[0];
      style: DouyinScriptStyle | undefined;
    },
    scope: DouyinScope,
  ): Promise<DouyinPublishCopy | null> {
    try {
      const platformPrompt =
        await this.adminService.getTenantPlatformAiPromptSupplement(
          scope.tenantId,
        );
      const llm = await this.agentService.buildLLM({
        ...toWorkflowLlmConfig(
          await this.workflowModels.resolveNodeRuntime(
            WORKFLOW_NODES.douyinWorkbench.key,
            WORKFLOW_NODES.douyinWorkbench.script,
          ),
        ),
        temperature: 0.6,
        nonStreaming: true,
        tenantId: scope.tenantId,
        billingContext: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          source: 'douyin-workbench.publish-copy',
          platformScope: !scope.tenantId,
        },
      });
      const system = [
        '你是抖音短视频运营，负责给一条已经写好口播稿的视频写发布文案：作品标题、发布正文和话题。',
        '标题要一句话点出看点或利益点，不要标题党、不要夸大；正文 2-4 句口语化短句，结尾给评论或收藏引导；话题 3-5 个，要有人会搜。',
        '文案与口播稿观点一致，不编造数据、价格、功效或承诺，不写违法、低俗、歧视、侵权或违规引流内容。',
        input.persona
          ? '这条视频有固定出镜人物，正文用这个人物的第一人称口吻来写。'
          : '',
        input.style
          ? '文案调性与「' +
            DOUYIN_SCRIPT_STYLES[input.style].label +
            '」一致：' +
            DOUYIN_SCRIPT_STYLES[input.style].tone +
            '。'
          : '',
        platformPrompt ? `【平台业务说明】\n${platformPrompt}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const output = await llm
        .withStructuredOutput(ZDouyinPublishCopy, {
          name: 'douyin_workbench_publish_copy',
          method: 'functionCalling',
        })
        .invoke(
          [
            new SystemMessage(system),
            new HumanMessage(
              [
                input.motherTitle ? `母选题：${input.motherTitle}` : '',
                `脚本标题：${input.title}`,
                input.script
                  ? `口播正文：<script>${input.script.slice(0, 4000)}</script>`
                  : '口播正文：无，请按标题写。',
                buildPersonaScriptBrief(input.persona),
                input.requirement ? `补充要求：${input.requirement}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            ),
          ],
          this.agentService.buildNoStreamInvokeOption(),
        );
      const parsed = ZDouyinPublishCopy.safeParse(output);
      return parsed.success ? normalizePublishCopy(parsed.data) : null;
    } catch (error) {
      this.logger.warn(
        `[generatePublishCopy] 发布文案生成失败 topic=${topicId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * @description 文字分镜落库后逐镜文生图：线性串行出图，第 N 镜把第 N-1 镜刚生成的画面当底图，
   *   保证场景、色调与人物状态在镜头之间连贯；每出完一张回报 `imaging` 进度。
   *   单镜出图失败只计数并断开这一处的连贯链（下一镜改从人物形象图起头），已成功的画面不会被回滚。
   * @keyword-cn 逐镜出图, 线性连贯出图, 先文字后配图
   * @keyword-en generate-shot-images, linear-shot-imaging, text-first-imaging
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
    let previousImageUrl = '';
    onProgress?.({ stage: 'imaging', current: 0, total: shots.length });
    for (const shot of shots) {
      try {
        const result = await this.shotImages.regenerate(
          topicId,
          shot.id,
          undefined,
          scope,
          previousImageUrl ? { previousImageUrl } : undefined,
        );
        previousImageUrl = result.imageUrl;
        imageCount += 1;
      } catch (error) {
        // 断开连贯链：下一镜不再拿这张失败的图当底图，改由人物形象图与参考图起头
        previousImageUrl = '';
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
    return { imageCount, imageFailedCount };
  }

  /**
   * @description 一次结构化输出写完整条分镜（模型取节点 `storyboard`），不再逐段调工具；返回规整后的镜头，最多 12 段。
   *   画面描述不看候选图，图库配图由 `pickShotImages` 另外挑。
   * @keyword-cn 执行分镜Agent, 抖音创作约束, 一次写完分镜
   * @keyword-en run-storyboard-agent, douyin-creative-constraints, single-shot-storyboard
   * @param brief 脚本标题、正文、类型、补充要求、出镜人物、风格与配图方式。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinStoryboardShot[]>} 分镜镜头（还没配图）。
   */
  private async writeStoryboard(
    brief: {
      title: string;
      script: string;
      topicType: string | undefined;
      requirement: string;
      persona: Parameters<typeof buildPersonaScriptBrief>[0];
      style: DouyinScriptStyle | undefined;
      useGallery: boolean;
    },
    scope: DouyinScope,
  ): Promise<DouyinStoryboardShot[]> {
    const [llm, platformPrompt] = await Promise.all([
      (async () =>
        this.agentService.buildLLM({
          ...toWorkflowLlmConfig(
            await this.workflowModels.resolveNodeRuntime(
              WORKFLOW_NODES.douyinWorkbench.key,
              WORKFLOW_NODES.douyinWorkbench.storyboard,
            ),
          ),
          temperature: 0.4,
          nonStreaming: true,
          tenantId: scope.tenantId,
          billingContext: {
            tenantId: scope.tenantId,
            userId: scope.userId,
            source: 'douyin-workbench.storyboard-generation',
            platformScope: !scope.tenantId,
          },
        }))(),
      this.adminService.getTenantPlatformAiPromptSupplement(scope.tenantId),
    ]);
    const system = [
      '你是抖音短视频导演。把给定脚本拆成可直接拍摄或交给视频生成器执行的竖屏分镜。',
      '给了脚本正文时，必须按正文顺序逐段拆解：每段的 narration 直接取自正文对应句子，不要改写立意、不要新增正文里没有的信息、不要漏掉正文的收尾。',
      '总时长优先控制在 15-60 秒，前 3 秒必须有强钩子，后段包含明确收束或行动引导。',
      '一次给出全部 4-12 段分镜。',
      '不得编造真实数据、虚假承诺或违法违规内容。',
      '每段都要给 image_prompt：一句可以直接拿去文生图的竖屏画面描述，写清主体、动作、环境、镜头语言和光线氛围，不要含文字水印要求。',
      brief.persona
        ? '本条视频有固定出镜人物，每段画面与 image_prompt 都要把这个人物写进去，且全片长相、发型、服装保持一致；旁白保持这个人物的第一人称。'
        : '',
      brief.style
        ? '全片画面风格统一为「' +
          DOUYIN_SCRIPT_STYLES[brief.style].label +
          '」：' +
          DOUYIN_SCRIPT_STYLES[brief.style].visual +
          '。每段 image_prompt 都要体现这个风格，相邻镜头的场景与色调要能顺下来，不要各拍各的。'
        : '',
      brief.useGallery
        ? '本条分镜的画面稍后从用户图库里挑图，visual 要写清具体的场景与主体，方便按画面找图。'
        : GENERATE_IMAGE_INSTRUCTION,
      platformPrompt ? `【平台业务说明】\n${platformPrompt}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const output = await llm
      .withStructuredOutput(ZDouyinStoryboard, {
        name: 'douyin_workbench_storyboard',
        method: 'functionCalling',
      })
      .invoke(
        [
          new SystemMessage(system),
          new HumanMessage(
            [
              `脚本标题：${brief.title}`,
              brief.script
                ? `脚本正文（必须按它拆分镜头，旁白直接取自这段正文）：\n<script>${brief.script}</script>`
                : '脚本正文：无，请按标题自行撰写旁白。',
              `内容类型：${brief.topicType || '由你判断'}`,
              buildPersonaScriptBrief(brief.persona),
              brief.style
                ? `叙事与画面风格：${DOUYIN_SCRIPT_STYLES[brief.style].label} —— ${DOUYIN_SCRIPT_STYLES[brief.style].tone}`
                : '',
              brief.requirement ? `补充要求：${brief.requirement}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        ],
        this.agentService.buildNoStreamInvokeOption(),
      );
    return (ZDouyinStoryboard.safeParse(output).data?.shots ?? [])
      .map((shot) => ({
        id: randomUUID(),
        duration: Math.max(
          1,
          Math.min(120, Math.round(Number(shot.duration) || 3)),
        ),
        shotType:
          String(shot.shot_type ?? '')
            .trim()
            .slice(0, 30) || '中景',
        visual: String(shot.visual ?? '')
          .trim()
          .slice(0, 1000),
        narration: String(shot.narration ?? '')
          .trim()
          .slice(0, 1000),
        transition: String(shot.transition ?? '')
          .trim()
          .slice(0, 100),
        media: null,
        imagePrompt:
          String(shot.image_prompt ?? '')
            .trim()
            .slice(0, 1000) || undefined,
      }))
      .filter((shot) => shot.visual.length >= 2)
      .slice(0, 12);
  }

  /**
   * @description 分镜选图（模型取节点 `image-decision`，关闭思考）：一次调用为每段分镜从候选清单挑一张图，只认清单内编号，
   *   同一张图不重复用；选不上的镜头留给保存前的 `autoAssignShotImages` 按相关度补。调用失败只记警告，不影响分镜。
   * @keyword-cn 分镜选图, 关闭思考
   * @keyword-en storyboard-image-pick, thinking-off
   * @param shots 刚写好的分镜，选中的图直接写到 `media`。
   * @param candidates 候选图。
   * @param scope 租户用户作用域。
   */
  private async pickShotImages(
    shots: DouyinStoryboardShot[],
    candidates: StoryboardImageCandidate[],
    scope: DouyinScope,
  ): Promise<void> {
    if (!candidates.length || !shots.length) return;
    try {
      const llm = await this.agentService.buildLLM({
        ...toWorkflowLlmConfig(
          await this.workflowModels.resolveNodeRuntime(
            WORKFLOW_NODES.douyinWorkbench.key,
            WORKFLOW_NODES.douyinWorkbench.imageDecision,
          ),
        ),
        temperature: 0.2,
        nonStreaming: true,
        disableThinking: true,
        tenantId: scope.tenantId,
        billingContext: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          source: 'douyin-workbench.storyboard-image-pick',
          platformScope: !scope.tenantId,
        },
      });
      const output = await llm
        .withStructuredOutput(ZDouyinShotImagePicks, {
          name: 'douyin_workbench_pick_shot_images',
          method: 'functionCalling',
        })
        .invoke(
          [
            new SystemMessage(
              `你负责给抖音分镜配图：按每段的画面描述，从候选图片里挑最贴合的一张。\n${buildImageCandidatePrompt(candidates)}`,
            ),
            new HumanMessage(
              shots
                .map(
                  (shot, index) =>
                    `第 ${index + 1} 段｜${shot.shotType}｜画面：${shot.visual.slice(0, 120)}${shot.narration ? `｜旁白：${shot.narration.slice(0, 60)}` : ''}`,
                )
                .join('\n'),
            ),
          ],
          this.agentService.buildNoStreamInvokeOption(),
        );
      const candidateById = new Map(
        candidates.map((candidate) => [candidate.id, candidate]),
      );
      const used = new Set<number>();
      for (const pick of ZDouyinShotImagePicks.safeParse(output).data?.picks ??
        []) {
        const shot = shots[Math.round(Number(pick.shot)) - 1];
        const candidate = candidateById.get(Math.round(Number(pick.image_id)));
        if (!shot || shot.media || !candidate || used.has(candidate.id)) {
          continue;
        }
        used.add(candidate.id);
        shot.media = toImageMediaReference(candidate);
      }
    } catch (error) {
      this.logger.warn(
        `[pickShotImages] 分镜选图失败，改由相关度自动补图: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
