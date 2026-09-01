import { Injectable, Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import type { CreateAgentParams } from 'langchain';
import { z } from 'zod';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import {
  HOT_TOPIC_CATEGORY_LABELS,
  type HotTopicCategory,
  type HotTopicItemEntity,
  type HotTopicRecommendation,
  type HotTopicRecommendResult,
  type HotTopicScope,
} from '../entities/hot-topic.entity.js';
import { HotTopicItemService } from './hot-topic-item.service.js';

/** @type {number} 没走标签粗筛时，送进模型的候选热点上限；再多模型的排序质量会明显下滑。 */
const MAX_CANDIDATES = 80;

/**
 * @type {number} 标签粗筛命中后的候选上限。已经按标签滤过一轮，条目相关度整体更高，
 *  可以比全量兜底多带一些进去，让第二阶段看到该标签下「全部」热点标题而不是被截断的一段。
 */
const MAX_TAG_FILTERED_CANDIDATES = 150;

/**
 * @type {number} 标签粗筛后候选少于这个数就放弃筛选结果、回落全量池。
 *  筛得太狠时模型只能在个位数条目里硬选，反而会推出勉强沾边的热点。
 */
const MIN_TAG_FILTERED_CANDIDATES = 12;

/** @type {number} 第一阶段最多允许模型选中的标签数。 */
const MAX_PICKED_TAGS = 8;

/** @type {number} 单次最多返回的推荐条数上限。 */
const MAX_RECOMMENDATIONS = 10;

/**
 * @description 推荐接口入参：母选题必填，其余维度用来收窄候选范围。
 * @keyword-cn 推荐入参, 候选范围
 * @keyword-en recommend-input, candidate-scope
 */
export interface HotTopicRecommendInput {
  /** 用户母选题，推荐的唯一判据 */
  parentTopic: string;
  /** 母选题的补充说明，例如账号定位或受众画像 */
  parentTopicBrief?: string;
  /** 只在这些采集规则的结果里挑 */
  ruleIds?: number[];
  /** 只在这个分类里挑 */
  category?: HotTopicCategory;
  /** 只在带这些归类标签的热点里挑 */
  tags?: string[];
  /** 期望返回的推荐条数，缺省 5 */
  limit?: number;
}

/**
 * @description 按用户母选题从当前热点采集榜里挑出适配的热点，走**两阶段**：
 *
 *  1. **标签粗筛**：先只把归类标签清单（标签名 + 条目数）交给模型，让它按母选题选出相关标签。
 *     这一步的输入是几十个短词而不是几百条标题，模型能真正读完并做领域级判断。
 *  2. **标题判定**：用选中的标签过滤候选，把该范围内的热点标题全量交给模型逐条判定契合度。
 *
 *  分两步是因为一步做不好：热榜动辄几百条，一次性全塞进去要么超上下文、要么被截断成「前 80 条」，
 *  而截断是按名次而不是按相关性做的，母选题真正对口的热点很可能正好落在被截掉的那一段里。
 *  先按标签把范围收到对口领域，再在这个范围里看全部标题，两次的输入都在模型读得完的量级上。
 *
 *  粗筛只收窄范围、不做最终判断：选不出标签，或按标签筛完候选少于
 *  `MIN_TAG_FILTERED_CANDIDATES` 条，都会回落到全量候选池，宁可让模型多看一些也不能把范围筛没。
 *  调用方显式传了 `tags` 时直接用用户给的范围，跳过第一阶段。
 *
 *  两个阶段的结果都由 Agent 通过工具逐条写入运行内存，模型最终文本不参与解析，因此接口返回的
 *  永远是结构化 JSON。候选池只来自库里已采集的热点，模型不能凭空造热点——写入的
 *  `hot_topic_id` 必须命中候选池。
 * @keyword-cn 热点推荐, 母选题匹配, 标签粗筛, 两阶段推荐, 工具写入JSON
 * @keyword-en hot-topic-recommend, parent-topic-match, tag-prefilter, two-stage-recommend, tool-written-json
 */
@Injectable()
export class HotTopicRecommendService {
  private readonly logger = new Logger(HotTopicRecommendService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly itemService: HotTopicItemService,
  ) {}

  /**
   * @description 执行一次推荐：标签粗筛 → 按标签取候选（不足则回落全量）→ 跑判定 Agent →
   *  按契合度倒序返回结构化结果。
   * @param {HotTopicScope} scope - 租户与用户作用域。
   * @param {HotTopicRecommendInput} input - 推荐入参。
   * @returns {Promise<HotTopicRecommendResult>} 结构化推荐结果。
   * @throws {Error} 母选题为空或候选池为空时抛出。
   * @keyword-cn 执行热点推荐, 两阶段推荐, 结构化返回
   * @keyword-en run-hot-topic-recommend, two-stage-recommend, structured-response
   */
  async recommend(
    scope: HotTopicScope,
    input: HotTopicRecommendInput,
  ): Promise<HotTopicRecommendResult> {
    const parentTopic = String(input.parentTopic ?? '').trim();
    if (!parentTopic) throw new Error('HOT_TOPIC_PARENT_TOPIC_REQUIRED');

    const baseQuery = {
      ...(input.category ? { category: input.category } : {}),
      ...(input.ruleIds ? { ruleIds: input.ruleIds } : {}),
    };

    // --- 第一阶段：标签粗筛。调用方给了 tags 就直接用，否则让模型按母选题从标签清单里挑。 ---
    const explicitTags = (Array.isArray(input.tags) ? input.tags : [])
      .map((tag) => String(tag ?? '').trim())
      .filter((tag) => tag.length > 0);
    const matchedTags =
      explicitTags.length > 0
        ? explicitTags
        : await this.selectRelevantTags(
            scope,
            parentTopic,
            input.parentTopicBrief,
          );

    // --- 第二阶段：在粗筛范围内取热点标题；筛得太狠就回落全量池，别把范围筛没。 ---
    let candidates: HotTopicItemEntity[] = [];
    let tagFiltered = false;
    if (matchedTags.length > 0) {
      const scoped = await this.itemService.listCandidates(scope, {
        ...baseQuery,
        tags: matchedTags,
        limit: MAX_TAG_FILTERED_CANDIDATES,
      });
      // 用户显式给的标签是硬约束，模型挑出来的只是粗筛，条目太少时才允许放宽
      if (
        scoped.length >= MIN_TAG_FILTERED_CANDIDATES ||
        explicitTags.length > 0
      ) {
        candidates = scoped;
        tagFiltered = scoped.length > 0;
      }
    }
    if (candidates.length === 0) {
      candidates = await this.itemService.listCandidates(scope, {
        ...baseQuery,
        limit: MAX_CANDIDATES,
      });
    }
    if (candidates.length === 0) {
      throw new Error('HOT_TOPIC_NO_CANDIDATE');
    }
    this.logger.debug(
      `[hot-topic] recommend_candidates topic="${parentTopic.slice(0, 20)}" ` +
        `tags=${matchedTags.join('/') || '-'} tagFiltered=${tagFiltered} n=${candidates.length}`,
    );

    const wanted = Math.max(
      1,
      Math.min(MAX_RECOMMENDATIONS, Math.floor(Number(input.limit) || 5)),
    );
    const picked = await this.runRecommendAgent(
      parentTopic,
      input.parentTopicBrief,
      candidates,
      wanted,
      scope.tenantId,
    );

    const byId = new Map(candidates.map((item) => [item.id, item]));
    const recommendations: HotTopicRecommendation[] = picked
      .map((entry) => {
        const item = byId.get(entry.hotTopicId);
        if (!item) return null;
        return {
          hotTopicId: item.id,
          title: item.title,
          platform: item.platform,
          category: item.category,
          ...(item.url ? { url: item.url } : {}),
          ...(item.heat ? { heat: item.heat } : {}),
          tags: item.tags ?? [],
          matchScore: entry.matchScore,
          reason: entry.reason,
          angle: entry.angle,
        } satisfies HotTopicRecommendation;
      })
      .filter((entry): entry is HotTopicRecommendation => entry !== null)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, wanted);

    return {
      parentTopic,
      candidateCount: candidates.length,
      matchedTags,
      tagFiltered,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * @description 第一阶段：把归类标签清单交给模型，按母选题选出相关标签作为候选范围。
   *  标签由工具逐条写入，只接受清单内的标签；选不出来返回空数组，由调用方回落全量池。
   *  这一步只收窄范围、不做最终判断，所以提示词要求"宁可多选一个相关标签，也不要漏掉可能相关的领域"。
   * @param {HotTopicScope} scope - 作用域。
   * @param {string} parentTopic - 母选题。
   * @param {string} [brief] - 母选题补充说明。
   * @returns {Promise<string[]>} 选中的标签，选不出时为空数组。
   * @keyword-cn 标签粗筛, 收窄候选范围
   * @keyword-en tag-prefilter, narrow-candidates
   */
  private async selectRelevantTags(
    scope: HotTopicScope,
    parentTopic: string,
    brief?: string,
  ): Promise<string[]> {
    const tagRows = await this.itemService.listTagNames(scope);
    if (tagRows.length === 0) return [];
    // 标签本来就没几个的时候粗筛没有意义，直接让第二阶段看全量
    if (tagRows.length <= MAX_PICKED_TAGS) return [];

    const picked: string[] = [];
    const allowed = new Set(tagRows.map((row) => row.tag));
    const tools: NonNullable<CreateAgentParams['tools']> = [
      this.createTagPickTool(picked, allowed),
    ];

    try {
      await this.agentService.runWithMessages({
        config: {
          system: this.buildTagPrompt(parentTopic, brief, tagRows),
          tools,
          temperature: 0.2,
          noPostHook: true,
          nonStreaming: true,
          ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
        },
        messages: [
          {
            role: 'user',
            content: `开始筛选。母选题是「${parentTopic}」，请从标签清单里逐个写入相关标签。`,
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `[hot-topic] tag_prefilter_failed topic="${parentTopic.slice(0, 30)}": ${String(error)}`,
      );
      return [];
    }
    return picked;
  }

  /**
   * @description 创建标签粗筛工具：只接受标签清单内的标签，重复与超额一律拒绝。
   * @param {string[]} picked - 本次运行的内存结果。
   * @param {Set<string>} allowed - 允许写入的标签集合。
   * @returns {ReturnType<typeof tool>} 可挂给 Agent 的工具。
   * @keyword-cn 标签筛选工具, 清单约束
   * @keyword-en tag-pick-tool, list-constraint
   */
  private createTagPickTool(picked: string[], allowed: Set<string>) {
    return tool(
      (input) => {
        const tag = String(input.tag ?? '')
          .replace(/\s+/g, '')
          .trim();
        if (!allowed.has(tag)) {
          return `未记录：标签「${tag}」不在清单里，只能从清单里挑。`;
        }
        if (picked.includes(tag)) {
          return '未记录：这个标签已经选过了。';
        }
        if (picked.length >= MAX_PICKED_TAGS) {
          return `未记录：已经选满 ${MAX_PICKED_TAGS} 个标签。`;
        }
        picked.push(tag);
        return `已选中「${tag}」，当前共 ${picked.length} 个。`;
      },
      {
        name: 'hot_topic_pick_tag',
        description:
          '选中一个与母选题相关的归类标签，用来收窄后续热点候选范围。每个标签单独调用一次；禁止用最终回答代替此工具。',
        schema: z.object({
          tag: z
            .string()
            .min(1)
            .max(20)
            .describe('标签名，必须逐字来自给出的标签清单'),
        }),
      },
    );
  }

  /**
   * @description 构造标签粗筛提示词：给出母选题与带条目数的标签清单。
   * @param {string} parentTopic - 母选题。
   * @param {string} [brief] - 母选题补充说明。
   * @param {Array<{ tag: string; count: number }>} tagRows - 标签清单。
   * @returns {string} 系统提示词。
   * @keyword-cn 构造粗筛提示词, 工具交付约束
   * @keyword-en build-tag-prompt, tool-delivery-contract
   */
  private buildTagPrompt(
    parentTopic: string,
    brief: string | undefined,
    tagRows: Array<{ tag: string; count: number }>,
  ): string {
    const tagBlock = tagRows
      .map((row) => `${row.tag}(${row.count})`)
      .join('、');
    const briefLine = brief?.trim() ? `母选题补充说明：${brief.trim()}\n` : '';

    return `你是内容运营的选题策划助手。现在要为一个母选题从热点榜里找素材，第一步是**先圈定相关的话题领域**。

母选题：${parentTopic}
${briefLine}
下面是当前热点榜上全部归类标签（括号内是该标签下的热点条数）：
${tagBlock}

请选出与该母选题相关的标签，用来收窄后续要细看的热点范围。

判断标准：
1. 只要该标签下**有可能**出现与母选题相关的热点就选上——这一步只是收窄范围，不是最终判断，漏掉一个相关领域的代价远大于多选一个。
2. 最多选 ${MAX_PICKED_TAGS} 个，按相关度从高到低选。
3. 完全不沾边的领域不要选；一个都不相关时可以不调用任何工具。

交付协议：
1. 每个标签必须且只能通过 hot_topic_pick_tag 工具写入，一个标签一次调用，标签名逐字照抄清单里的写法。
2. 禁止在最终回答里输出 JSON、代码块或标签列表；最终文本不会被读取。
3. 选完后，最终只需回复"已完成"。`;
  }

  /**
   * @description 跑一次推荐 Agent，返回工具写入的内存结果；Agent 异常时返回空数组，
   *  由调用方得到一个 `recommendations: []` 的合法响应而不是 500。
   * @param {string} parentTopic - 母选题。
   * @param {string} [brief] - 母选题补充说明。
   * @param {HotTopicItemEntity[]} candidates - 候选热点。
   * @param {number} wanted - 期望条数。
   * @param {string} [tenantId] - 租户。
   * @returns {Promise<Array<{ hotTopicId: number; matchScore: number; reason: string; angle: string }>>} 内存推荐结果。
   * @keyword-cn 执行推荐Agent, 忽略最终文本
   * @keyword-en run-recommend-agent, ignore-final-text
   */
  private async runRecommendAgent(
    parentTopic: string,
    brief: string | undefined,
    candidates: HotTopicItemEntity[],
    wanted: number,
    tenantId?: string,
  ): Promise<
    Array<{
      hotTopicId: number;
      matchScore: number;
      reason: string;
      angle: string;
    }>
  > {
    const picked: Array<{
      hotTopicId: number;
      matchScore: number;
      reason: string;
      angle: string;
    }> = [];
    const allowedIds = new Set(candidates.map((item) => item.id));
    const tools: NonNullable<CreateAgentParams['tools']> = [
      this.createRecommendTool(picked, allowedIds, wanted),
    ];

    try {
      await this.agentService.runWithMessages({
        config: {
          system: this.buildSystemPrompt(
            parentTopic,
            brief,
            candidates,
            wanted,
          ),
          tools,
          temperature: 0.3,
          noPostHook: true,
          nonStreaming: true,
          ...(tenantId ? { tenantId } : {}),
        },
        messages: [
          {
            role: 'user',
            content: `开始筛选。母选题是「${parentTopic}」，请从候选热点里挑出最多 ${wanted} 条并逐条调用工具写入。`,
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `[hot-topic] recommend_agent_failed topic="${parentTopic.slice(0, 30)}": ${String(error)}`,
      );
    }
    return picked;
  }

  /**
   * @description 创建推荐写入工具：只接受候选池内的热点 ID，重复写入与超额写入一律拒绝。
   * @param {Array} picked - 本次运行的内存结果。
   * @param {Set<number>} allowedIds - 候选池热点 ID。
   * @param {number} wanted - 期望条数。
   * @returns {ReturnType<typeof tool>} 可挂给 Agent 的工具。
   * @keyword-cn 推荐写入工具, 候选池约束
   * @keyword-en recommendation-tool, candidate-pool-constraint
   */
  private createRecommendTool(
    picked: Array<{
      hotTopicId: number;
      matchScore: number;
      reason: string;
      angle: string;
    }>,
    allowedIds: Set<number>,
    wanted: number,
  ) {
    return tool(
      (input) => {
        const hotTopicId = Number(input.hot_topic_id);
        if (!allowedIds.has(hotTopicId)) {
          return `未记录：hot_topic_id=${input.hot_topic_id} 不在候选热点清单里，只能从清单里挑。`;
        }
        if (picked.some((entry) => entry.hotTopicId === hotTopicId)) {
          return '未记录：这条热点已经推荐过了，请换一条。';
        }
        if (picked.length >= wanted) {
          return `未记录：已经达到 ${wanted} 条，不要再添加。`;
        }
        const reason = String(input.reason ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        const angle = String(input.angle ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!reason || !angle) {
          return '未记录：匹配理由和切入角度都不能为空。';
        }
        const rawScore = Number(input.match_score);
        const matchScore = Number.isFinite(rawScore)
          ? Math.max(0, Math.min(100, Math.round(rawScore)))
          : 60;
        picked.push({
          hotTopicId,
          matchScore,
          reason: reason.slice(0, 200),
          angle: angle.slice(0, 200),
        });
        const remaining = wanted - picked.length;
        return remaining > 0
          ? `已记录第 ${picked.length} 条，还可以再推荐 ${remaining} 条。`
          : `已记录第 ${picked.length} 条，数量已满足。`;
      },
      {
        name: 'hot_topic_add_recommendation',
        description:
          '把一条推荐热点写入本次运行内存。每条推荐都必须单独调用一次；禁止用最终回答或 JSON 代替此工具。',
        schema: z.object({
          hot_topic_id: z
            .number()
            .int()
            .describe('推荐热点的 ID，必须来自候选热点清单'),
          match_score: z
            .number()
            .min(0)
            .max(100)
            .describe('与母选题的契合度，0-100，越高越贴合'),
          reason: z
            .string()
            .min(6)
            .max(200)
            .describe('为什么这条热点适合该母选题，一句话说清关联点'),
          angle: z
            .string()
            .min(6)
            .max(200)
            .describe('建议的切入角度，说明这条热点在该母选题下可以怎么写'),
        }),
      },
    );
  }

  /**
   * @description 构造推荐系统提示词：给出母选题、候选热点清单与工具交付协议。
   * @param {string} parentTopic - 母选题。
   * @param {string} [brief] - 母选题补充说明。
   * @param {HotTopicItemEntity[]} candidates - 候选热点。
   * @param {number} wanted - 期望条数。
   * @returns {string} 系统提示词。
   * @keyword-cn 构造推荐提示词, 工具交付约束
   * @keyword-en build-recommend-prompt, tool-delivery-contract
   */
  private buildSystemPrompt(
    parentTopic: string,
    brief: string | undefined,
    candidates: HotTopicItemEntity[],
    wanted: number,
  ): string {
    const candidateBlock = candidates
      .map((item) => {
        const parts = [
          `- id=${item.id}｜${item.platform}·${HOT_TOPIC_CATEGORY_LABELS[item.category]}｜${item.title}`,
        ];
        if (item.tags?.length) parts.push(`  标签：${item.tags.join('、')}`);
        if (item.heat) parts.push(`  热度：${item.heat}`);
        if (item.summary) parts.push(`  摘要：${item.summary}`);
        return parts.join('\n');
      })
      .join('\n');

    const briefLine = brief?.trim() ? `母选题补充说明：${brief.trim()}\n` : '';

    return `你是内容运营的选题策划助手，负责在当前热点采集榜里为一个母选题挑出可以直接落笔的热点。

母选题：${parentTopic}
${briefLine}
判断标准（按优先级）：
1. 热点内容与母选题的领域、受众必须真实相关，宁可少推也不要凑数。
2. 热点要有可写的落点，能延伸出具体内容，而不只是一个名字或一个赛果。
3. 同一个事件的多条重复表述只保留最有代表性的一条。
4. 契合度打分要拉开差距：明显贴合给 80 以上，勉强沾边给 50 上下，不相关的直接不推荐。

合规边界：
- 不推荐违法、危险、仇恨、歧视、色情低俗、涉及未成年人不当内容或侵犯隐私的热点。
- 不对具体个人做负面定性，不把未经证实的传闻写成事实。
- 医疗、金融、法律方向的切入角度不得承诺效果或收益。

候选热点清单（已按相关话题领域筛选过，是这个范围内的全部热点；只能从这里挑，不得自造）：
${candidateBlock}

交付协议：
1. 每条推荐必须且只能通过 hot_topic_add_recommendation 工具写入，一条一次调用。
2. 最多推荐 ${wanted} 条；真正贴合的不足 ${wanted} 条时就少推，不要为了凑数推不相关的热点。
3. 禁止在最终回答里输出 JSON、代码块、表格或推荐列表；最终文本不会被读取。
4. 全部写完后，最终只需回复"已完成"。`;
  }
}
