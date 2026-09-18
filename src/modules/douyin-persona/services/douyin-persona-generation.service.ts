import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { GalleryAiImageService } from '../../gallery/services/gallery-ai-image.service.js';
import {
  toWorkflowLlmConfig,
  WorkflowModelService,
} from '../../workflow-model/services/workflow-model.service.js';
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';
import {
  DOUYIN_PERSONA_PERSPECTIVE_LABELS,
  DOUYIN_PERSONA_VIEW_SPECS,
  type DouyinPersonaImage,
  type DouyinPersonaView,
} from '../entities/douyin-persona.entity.js';
import {
  DouyinPersonaRepositoryService,
  normalizePersonaPerspective,
  normalizePersonaVoice,
} from './douyin-persona-repository.service.js';

type DouyinPersonaScope = { tenantId?: string; userId: string };

/**
 * @description 只接受字符串的安全取值，LLM 返回的任意 JSON 值转文本时不会落成「[object Object]」。
 * @keyword-cn 安全读取字符串, LLM返回取值
 * @keyword-en safe-read-string, llm-value-access
 * @param value 任意值。
 * @returns {string} 是字符串时原样返回，否则空串。
 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * @description 人物形象图统一带上的业务标签，便于在图库里筛出预设人物的形象图。
 * @keyword-cn 人物形象图标签, 业务标签
 * @keyword-en persona-image-tag, business-tag
 */
export const DOUYIN_PERSONA_IMAGE_TAG = '抖音人物形象';

/**
 * @description 预设人物的两类 AI 能力：按一句话需求写出完整人设草稿，以及按人设逐张生成三视图形象图。
 *   三视图串行生成，第二、三张都以前一张为底图，保证三张是同一张脸，后续分镜出图再以它们为底图。
 * @keyword-cn 人物AI生成, 三视图生成
 * @keyword-en persona-ai-generation, reference-sheet-generation
 */
@Injectable()
export class DouyinPersonaGenerationService {
  private readonly logger = new Logger(DouyinPersonaGenerationService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly aiImages: GalleryAiImageService,
    private readonly repository: DouyinPersonaRepositoryService,
    private readonly workflowModels: WorkflowModelService,
  ) {}

  /**
   * @description 让 LLM 按一句话需求写出可直接入库的人设草稿（姓名、简介、外貌、性格语气、视角、音色）。
   *   草稿不入库，由后台管理员在表单里确认或修改后再保存。
   * @keyword-cn AI生成人设, 人设草稿
   * @keyword-en ai-draft-persona, persona-draft
   * @param brief 管理员填写的一句话需求，例如「25 岁成都本地探店女生，接地气爱吐槽」。
   * @param scope 租户用户作用域。
   * @returns {Promise<Partial<DouyinPersonaView>>} 人设草稿字段。
   * @throws {BadRequestException} 需求为空（`DOUYIN_PERSONA_BRIEF_REQUIRED`）、模型没输出可解析 JSON（`DOUYIN_PERSONA_DRAFT_NOT_JSON`）
   *   或人设缺人物名 / 外貌不足 20 字（`DOUYIN_PERSONA_DRAFT_INCOMPLETE`）；后两者都会把模型原始回复或返回的键写进警告日志。
   */
  async draftPersona(
    brief: string,
    scope: DouyinPersonaScope,
  ): Promise<{
    name: string;
    summary: string;
    appearance: string;
    persona: string;
    perspective: DouyinPersonaView['perspective'];
    voice: DouyinPersonaView['voice'];
  }> {
    const requirement = String(brief ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    if (!requirement)
      throw new BadRequestException('DOUYIN_PERSONA_BRIEF_REQUIRED');

    const perspectives = Object.entries(DOUYIN_PERSONA_PERSPECTIVE_LABELS)
      .map(([key, value]) => `${key}（${value.label}）`)
      .join('、');
    const result = await this.agentService.runWithMessages({
      config: {
        ...toWorkflowLlmConfig(
          await this.workflowModels.resolveNodeRuntime(
            WORKFLOW_NODES.douyinWorkbench.key,
            WORKFLOW_NODES.douyinWorkbench.script,
          ),
        ),
        tenantId: scope.tenantId,
        temperature: 0.6,
        noPostHook: true,
        nonStreaming: true,
        billingContext: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          source: 'douyin-persona.persona-draft',
          platformScope: !scope.tenantId,
        },
        system: `你负责为抖音短视频设计一个固定出镜的虚拟人物。只输出一个 JSON 对象，不要输出解释、Markdown 或代码块围栏。
字段要求：
- name：人物名，2 至 12 个字的中文昵称或名字。
- summary：一句话简介，不超过 30 字。
- appearance：外貌与穿着设定，150 至 400 字，写清性别、年龄感、脸型五官、发型发色、体型、常穿服装与配饰、整体气质。必须具体到能照着画出同一个人，不要写"自由发挥"这类模糊词，不要描述场景和动作。
- persona：性格与说话语气，80 至 200 字，写清性格底色、说话习惯、口头禅倾向。
- perspective：从 ${perspectives} 里选一个最贴合的键名。
- voice：对象，含 gender（female/male/neutral）、age（young/adult/mature）、pace（slow/normal/fast）、timbre（不超过 30 字的音色特质）。
不要设计真实存在的人物、明星或品牌代言人；不要涉及未成年人。`,
      },
      messages: [
        {
          role: 'user',
          content: `人物需求：<persona_brief>${requirement}</persona_brief>\n请输出 JSON。`,
        },
      ],
    });

    const { value: parsed, raw } = this.readJsonObject(result);
    // 两类失败分开报：解析不出 JSON 多半是模型不听格式指令，字段不全多半是模型敷衍
    if (!parsed) {
      this.logger.warn(
        `[draftPersona] 模型没有返回可解析的 JSON，原始回复前 500 字：${raw.slice(0, 500) || '(空回复)'}`,
      );
      throw new BadRequestException(
        'DOUYIN_PERSONA_DRAFT_NOT_JSON：模型没有按要求只输出 JSON。重试一次通常就好；一直失败就去后台「工作流节点模型」把 抖音视频制作 / 脚本生成 换成能稳定输出 JSON 的模型。',
      );
    }
    const name = readString(parsed?.name)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    const appearance = readString(parsed?.appearance).trim().slice(0, 1000);
    if (!name || appearance.length < 20) {
      this.logger.warn(
        `[draftPersona] 人设草稿字段不全 name=${name || '(空)'} appearance=${appearance.length} 字，模型返回的键：${Object.keys(parsed).join(',') || '(无)'}`,
      );
      throw new BadRequestException(
        `DOUYIN_PERSONA_DRAFT_INCOMPLETE：模型返回的人设缺${!name ? '人物名' : '外貌设定（要至少 20 字）'}。把需求写具体一点再试一次，或者直接在表单里手填。`,
      );
    }
    return {
      name,
      summary: readString(parsed?.summary)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120),
      appearance,
      persona: readString(parsed?.persona).trim().slice(0, 1000),
      perspective: normalizePersonaPerspective(
        typeof parsed?.perspective === 'string'
          ? parsed.perspective
          : undefined,
      ),
      voice: normalizePersonaVoice(
        parsed?.voice as Record<string, unknown> | undefined,
      ),
    };
  }

  /**
   * @description 为一个人物串行生成三视图形象图：正面全身 → 四分之三侧身 → 面部特写，
   *   后两张把已生成的图作为底图候选，保证同一张脸；三张全部入图库后一次性回填到人物上，
   *   原有形象图整组替换。任意一张失败即整体失败，不会留下半套形象图。
   * @keyword-cn 生成人物三视图, 形象一致
   * @keyword-en generate-reference-sheet, identity-consistency
   * @param id 人物业务 ID。
   * @param scope 租户用户作用域。
   * @returns {Promise<DouyinPersonaView>} 带有新形象图的人物。
   * @throws {BadRequestException} 人物不存在、外貌设定为空或出图失败时抛出。
   */
  async generateReferenceSheet(
    id: number,
    scope: DouyinPersonaScope,
  ): Promise<DouyinPersonaView> {
    const persona = await this.repository.get(id, scope);
    if (!persona) throw new BadRequestException('DOUYIN_PERSONA_NOT_FOUND');
    const appearance = String(persona.appearance ?? '').trim();
    if (!appearance) {
      throw new BadRequestException('DOUYIN_PERSONA_APPEARANCE_REQUIRED');
    }

    const nodeRuntime = await this.workflowModels.resolveNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.key,
      WORKFLOW_NODES.douyinWorkbench.personaImage,
    );
    const images: DouyinPersonaImage[] = [];
    for (const spec of DOUYIN_PERSONA_VIEW_SPECS) {
      const prompt = this.buildViewPrompt(
        persona.name,
        appearance,
        spec.composition,
        images.length > 0,
      );
      const generated = await this.agentService.sendPrompt({
        prompt,
        runtimeOverride: nodeRuntime ?? undefined,
        size: spec.size,
        includeSystemPrompt: false,
        ...(images.length
          ? { baseImageCandidates: images.map((image) => image.url) }
          : {}),
        billingContext: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          platformScope: !scope.tenantId,
          source: 'douyin-persona.reference-sheet',
        },
      });
      const image = await this.aiImages.persistGeneratedImage({
        imagePath: String(generated?.imagePath ?? ''),
        userId: scope.userId,
        tenantId: scope.tenantId,
        originalName: `${persona.name} ${spec.label}`,
        description: `抖音人物形象:${persona.name} ${spec.label}`,
        tags: [DOUYIN_PERSONA_IMAGE_TAG],
      });
      images.push({
        view: spec.view,
        imageId: image.id,
        url: image.url,
        coverUrl: image.thumbUrl || image.url,
      });
    }
    this.logger.log(
      `[generateReferenceSheet] persona=${id} 生成 ${images.length} 张形象图`,
    );
    return this.repository.replaceImages(id, images, scope);
  }

  /**
   * @description 拼出一张形象图的文生图提示词：人物外貌设定 + 本张构图要求 + 固定的形象图规格
   *   （纯色背景、无文字、真实写实），并在有底图时强调必须复用底图里的同一个人。
   * @keyword-cn 构造形象图提示, 纯色背景无文字
   * @keyword-en build-persona-image-prompt, plain-background-no-text
   * @param name 人物名，作为主题上下文。
   * @param appearance 外貌设定。
   * @param composition 本张的构图要求。
   * @param hasBaseImage 是否已有前序形象图作为底图。
   * @returns {string} 最终提示词。
   */
  private buildViewPrompt(
    name: string,
    appearance: string,
    composition: string,
    hasBaseImage: boolean,
  ): string {
    return [
      `短视频固定出镜人物「${name}」的形象参考图。`,
      `人物设定：${appearance}`,
      `本张构图：${composition}。`,
      hasBaseImage
        ? '必须与所给底图是同一个人：长相、五官比例、发型发色、体型与服装完全一致，只改变机位与景别。'
        : '',
      '要求：真人写实摄影质感，自然柔和的均匀光线，浅灰或米白纯色背景，人物完整不被裁切，没有其他人物或道具遮挡。',
      '画面中不要出现任何文字、字幕、水印、logo、拼贴边框或多格排版。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * @description 从 Agent 响应里读出 JSON 对象，容忍代码块围栏、思考段与前后多余文字。
   *   连同原始回复一起返回：解析失败时调用方要把「模型到底回了什么」写进日志，否则排不出是模型没听指令还是回了空。
   * @keyword-cn 解析Agent JSON, 去代码块围栏, 保留原始回复
   * @keyword-en parse-agent-json, strip-code-fence, keep-raw-reply
   * @param result Agent 返回值。
   * @returns {{value: Record<string, unknown>|null, raw: string}} 解析出的对象（失败为 null）与原始回复。
   */
  private readJsonObject(result: unknown): {
    value: Record<string, unknown> | null;
    raw: string;
  } {
    const content = (result as { content?: unknown })?.content;
    const raw =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((part) =>
                typeof part === 'string'
                  ? part
                  : part && typeof part === 'object' && 'text' in part
                    ? readString((part as { text?: unknown }).text)
                    : '',
              )
              .filter(Boolean)
              .join('\n')
          : '';
    // 有的模型会先吐一段 <think> 推理再给 JSON，先摘掉，免得把推理里的花括号当成正文
    const text = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { value: null, raw };
    try {
      return {
        value: JSON.parse(text.slice(start, end + 1)) as Record<
          string,
          unknown
        >,
        raw,
      };
    } catch {
      return { value: null, raw };
    }
  }
}
