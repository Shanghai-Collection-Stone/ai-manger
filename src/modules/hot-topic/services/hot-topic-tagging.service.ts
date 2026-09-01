import { Injectable, Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import type { CreateAgentParams } from 'langchain';
import { z } from 'zod';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import {
  HOT_TOPIC_CATEGORY_LABELS,
  type HotTopicItemEntity,
} from '../entities/hot-topic.entity.js';
import { HotTopicItemService } from './hot-topic-item.service.js';

/** @type {number} 单次送进模型的热点条数，太长会稀释注意力、也更容易触发上下文上限。 */
const TAGGING_CHUNK_SIZE = 25;

/** @type {number} 单条热点允许的标签数量上限。 */
const MAX_TAGS_PER_ITEM = 3;

/**
 * @description 推荐标签词表。刻意只做「建议」而不是「枚举」——热榜每天都会冒出词表覆盖不到的
 *  新话题，锁死词表会把它们全塞进「其他」。词表的作用是让高频话题收敛到同一批词上，
 *  避免同义标签（例如「影视」和「电影电视剧」）把标签列表撑成几百条。
 * @keyword-cn 推荐标签词表, 标签收敛
 * @keyword-en suggested-tag-vocabulary, tag-convergence
 */
export const HOT_TOPIC_SUGGESTED_TAGS: readonly string[] = [
  '社会民生',
  '突发事件',
  '政策法规',
  '国际时事',
  '经济财经',
  '科技数码',
  '教育升学',
  '医疗健康',
  '职场就业',
  '婚恋情感',
  '亲子育儿',
  '影视剧集',
  '综艺节目',
  '音乐演出',
  '明星动态',
  '体育赛事',
  '游戏电竞',
  '动漫二次元',
  '美食探店',
  '旅游出行',
  '时尚美妆',
  '家居生活',
  '宠物萌宠',
  '汽车出行',
  '房产楼市',
];

/**
 * @description 用 Agent 给采集到的热点做归类打标。全部标签只经工具逐条写入运行内存，
 *  模型最终文本不参与解析；模型不可用或没写全时按规则的 `defaultTags` 兜底，
 *  保证榜单上不会出现一批完全没有标签的条目。
 * @keyword-cn 热点归类, AI打标, 工具写入
 * @keyword-en hot-topic-classification, ai-tagging, tool-delivery
 */
@Injectable()
export class HotTopicTaggingService {
  private readonly logger = new Logger(HotTopicTaggingService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly itemService: HotTopicItemService,
  ) {}

  /**
   * @description 给一批热点条目做 AI 归类并回写标签。按 chunk 分批跑 Agent，单批失败只影响该批，
   *  其余批次照常归类。
   * @param {HotTopicItemEntity[]} items - 待归类条目。
   * @param {Map<number, string[]>} fallbackTagsByRuleId - 各规则的兜底标签。
   * @param {string} [tenantId] - 租户，用于解析该租户的模型配置。
   * @returns {Promise<number>} 被 AI 成功归类的条数。
   * @keyword-cn 批量归类热点, 分批跑Agent
   * @keyword-en tag-hot-topics, chunked-agent-run
   */
  async tagItems(
    items: HotTopicItemEntity[],
    fallbackTagsByRuleId: Map<number, string[]>,
    tenantId?: string,
  ): Promise<number> {
    if (items.length === 0) return 0;

    const updates: Array<{
      id: number;
      tags: string[];
      tagSource: HotTopicItemEntity['tagSource'];
    }> = [];

    for (let offset = 0; offset < items.length; offset += TAGGING_CHUNK_SIZE) {
      const chunk = items.slice(offset, offset + TAGGING_CHUNK_SIZE);
      const assigned = await this.runTaggingAgent(chunk, tenantId);
      for (const item of chunk) {
        const aiTags = assigned.get(item.id);
        if (aiTags && aiTags.length > 0) {
          updates.push({ id: item.id, tags: aiTags, tagSource: 'ai' });
          continue;
        }
        const fallback = fallbackTagsByRuleId.get(item.ruleId) ?? [];
        updates.push({
          id: item.id,
          tags: fallback,
          tagSource: fallback.length > 0 ? 'rule' : 'none',
        });
      }
    }

    await this.itemService.applyTags(updates);
    return updates.filter((update) => update.tagSource === 'ai').length;
  }

  /**
   * @description 跑一次归类 Agent，返回「条目 ID → 标签」的内存结果；Agent 异常时返回空结果，
   *  由调用方走兜底标签。
   * @param {HotTopicItemEntity[]} chunk - 本批条目。
   * @param {string} [tenantId] - 租户。
   * @returns {Promise<Map<number, string[]>>} 归类结果。
   * @keyword-cn 执行归类Agent, 忽略最终文本
   * @keyword-en run-tagging-agent, ignore-final-text
   */
  private async runTaggingAgent(
    chunk: HotTopicItemEntity[],
    tenantId?: string,
  ): Promise<Map<number, string[]>> {
    const assigned = new Map<number, string[]>();
    const allowedIds = new Set(chunk.map((item) => item.id));
    const tools: NonNullable<CreateAgentParams['tools']> = [
      this.createTagTool(assigned, allowedIds),
    ];

    try {
      await this.agentService.runWithMessages({
        config: {
          system: this.buildSystemPrompt(chunk),
          tools,
          temperature: 0.2,
          noPostHook: true,
          nonStreaming: true,
          ...(tenantId ? { tenantId } : {}),
        },
        messages: [
          {
            role: 'user',
            content: `开始归类。本批共 ${chunk.length} 条热点，请逐条调用工具写入标签。`,
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `[hot-topic] tagging_agent_failed size=${chunk.length}: ${String(error)}`,
      );
    }
    return assigned;
  }

  /**
   * @description 创建归类工具：按热点 ID 写入 1-3 个标签，非本批 ID 与空标签一律拒绝。
   * @param {Map<number, string[]>} assigned - 本次运行的内存结果。
   * @param {Set<number>} allowedIds - 本批允许写入的热点 ID。
   * @returns {ReturnType<typeof tool>} 可挂给 Agent 的工具。
   * @keyword-cn 归类工具, 内存写入
   * @keyword-en tagging-tool, memory-write
   */
  private createTagTool(
    assigned: Map<number, string[]>,
    allowedIds: Set<number>,
  ) {
    return tool(
      (input) => {
        const hotTopicId = Number(input.hot_topic_id);
        if (!allowedIds.has(hotTopicId)) {
          return `未记录：hot_topic_id=${input.hot_topic_id} 不在本批热点里。`;
        }
        const tags = Array.from(
          new Set(
            (Array.isArray(input.tags) ? input.tags : [])
              .map((tag) =>
                String(tag ?? '')
                  .replace(/\s+/g, '')
                  .trim(),
              )
              .filter((tag) => tag.length > 0 && tag.length <= 20),
          ),
        ).slice(0, MAX_TAGS_PER_ITEM);
        if (tags.length === 0) {
          return '未记录：标签不能为空，至少给出一个中文归类标签。';
        }
        assigned.set(hotTopicId, tags);
        return `已记录 ${hotTopicId}：${tags.join('、')}。`;
      },
      {
        name: 'hot_topic_set_tags',
        description:
          '给一条热点写入归类标签。每条热点都必须单独调用一次；禁止用最终回答或 JSON 代替此工具。',
        schema: z.object({
          hot_topic_id: z
            .number()
            .int()
            .describe('待归类热点的 ID，必须来自本次给出的热点清单'),
          tags: z
            .array(z.string().min(1).max(20))
            .min(1)
            .max(MAX_TAGS_PER_ITEM)
            .describe('1-3 个中文归类标签，从最贴切的一个开始'),
        }),
      },
    );
  }

  /**
   * @description 构造归类系统提示词：给出热点清单、推荐词表与工具交付协议。
   * @param {HotTopicItemEntity[]} chunk - 本批条目。
   * @returns {string} 系统提示词。
   * @keyword-cn 构造归类提示词, 工具交付约束
   * @keyword-en build-tagging-prompt, tool-delivery-contract
   */
  private buildSystemPrompt(chunk: HotTopicItemEntity[]): string {
    const listBlock = chunk
      .map((item) => {
        const parts = [
          `- id=${item.id}｜来源：${item.platform}（${HOT_TOPIC_CATEGORY_LABELS[item.category]}）｜标题：${item.title}`,
        ];
        if (item.summary) parts.push(`  摘要：${item.summary}`);
        return parts.join('\n');
      })
      .join('\n');

    return `你是内容运营的热点归类助手，负责给平台采集到的热搜条目打上可检索的中文归类标签。

标签要求：
1. 每条热点写 1-3 个标签，第一个必须是最贴切的主分类。
2. 优先复用推荐词表里的词，词表覆盖不到时可以自造，但必须是 2-6 字的中文通用话题词。
3. 标签描述的是「话题属于什么领域」，不是复述标题；不要把人名、剧名、事件名本身当标签。
4. 不要输出情绪判断、立场评价或任何涉及具体个人的负面定性。

推荐词表（建议优先使用，不是硬性枚举）：
${HOT_TOPIC_SUGGESTED_TAGS.join('、')}

本批待归类热点：
${listBlock}

交付协议：
1. 每条热点必须且只能通过 hot_topic_set_tags 工具写入标签，一条一次调用，参数带上该条的 id。
2. 禁止在最终回答里输出 JSON、代码块、表格或标签列表；最终文本不会被读取。
3. 全部写完后，最终只需回复"已完成"。`;
  }
}
