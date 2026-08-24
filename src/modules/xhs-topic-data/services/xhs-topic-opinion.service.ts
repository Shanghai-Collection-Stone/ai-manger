import { Inject, Injectable, Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import type { CreateAgentParams } from 'langchain';
import { Collection, Db, ObjectId } from 'mongodb';
import { z } from 'zod';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { XhsPostStatService } from '../../todo/services/xhs-post-stat.service.js';
import type { XhsTopComment } from '../../todo/entities/xhs-post-stat.entity.js';
import type { XhsTopicEntity } from '../../xhs-topic/entities/xhs-topic.entity.js';
import type {
  XhsOpinionSentiment,
  XhsTopicOpinion,
  XhsTopicOpinionEntity,
} from '../entities/xhs-topic-data.entity.js';

/** @type {number} 送入模型分析的评论条数上限，超出按点赞量截断。 */
const MAX_ANALYZED_COMMENTS = 120;

/** @type {number} 返回给前端的热点关键词条数上限。 */
const MAX_KEYWORDS = 10;

/**
 * @description 情感极性枚举，与前端堆叠条的三段一一对应。
 * @keyword-cn 情感极性, 舆论三分
 * @keyword-en sentiment-polarity, opinion-buckets
 */
const POLARITIES = ['positive', 'neutral', 'negative'] as const;

/**
 * @description 舆论导向分析服务：把子选题抓到的热门评论交给 Agent 做情感与关键词分析，结果按最新采集时间缓存复用。
 * @keyword-cn 舆论导向分析, 情感分布, 分析缓存
 * @keyword-en opinion-analysis, sentiment-distribution, analysis-cache
 */
@Injectable()
export class XhsTopicOpinionService {
  private readonly logger = new Logger(XhsTopicOpinionService.name);
  private readonly opinions: Collection<XhsTopicOpinionEntity>;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly postStats: XhsPostStatService,
    private readonly agentService: AgentService,
  ) {
    this.opinions = db.collection<XhsTopicOpinionEntity>('xhs_topic_opinions');
    void this.ensureIndexes();
  }

  /**
   * @description 建立舆论分析缓存的选题唯一索引。
   * @keyword-cn 舆论缓存索引, 唯一选题
   * @keyword-en opinion-cache-index, unique-topic
   * @returns {Promise<void>}
   */
  async ensureIndexes(): Promise<void> {
    await this.opinions.createIndex({ topicId: 1 }, { unique: true });
  }

  /**
   * @description 读取子选题的舆论导向分析。数据未更新时直接复用缓存，`force` 或有新采集数据时重新跑一次分析。
   * @keyword-cn 舆论分析读取, 缓存复用
   * @keyword-en read-opinion, cache-reuse
   * @param topic 子选题实体。
   * @param force 是否强制重新分析。
   * @returns {Promise<XhsTopicOpinion | null>} 分析结果，没有可分析评论时为 null。
   */
  async getOpinion(
    topic: XhsTopicEntity,
    force = false,
  ): Promise<XhsTopicOpinion | null> {
    const stats = await this.postStats.listByTopic(topic.id);
    const comments = this.collectComments(stats);
    if (comments.length === 0) return null;
    const latestDataAt = stats.reduce<Date | undefined>((acc, item) => {
      const at = new Date(item.dataAt);
      return !acc || at > acc ? at : acc;
    }, undefined);

    const cached = await this.opinions.findOne({ topicId: topic.id });
    const cacheFresh =
      cached &&
      !force &&
      (!latestDataAt ||
        (cached.dataAt &&
          new Date(cached.dataAt).getTime() >= latestDataAt.getTime()));
    if (cacheFresh) return this.toView(cached);

    const analyzed = await this.analyze(topic, comments, latestDataAt);
    await this.opinions.updateOne(
      { topicId: topic.id },
      {
        $set: {
          tenantId: topic.tenantId ?? null,
          userId: topic.userId,
          sampleCount: analyzed.sampleCount,
          sentiments: analyzed.sentiments,
          keywords: analyzed.keywords,
          conclusion: analyzed.conclusion,
          highlights: analyzed.highlights,
          analyzedAt: new Date(analyzed.analyzedAt),
          dataAt: latestDataAt,
        },
        $setOnInsert: { _id: new ObjectId(), topicId: topic.id },
      },
      { upsert: true },
    );
    return analyzed;
  }

  /**
   * @description 运行分析 Agent：只认工具写入的结构化结果，模型最终文本不参与解析；分析失败时回退到词频兜底。
   * @keyword-cn 分析Agent, 工具写入, 词频兜底
   * @keyword-en analysis-agent, tool-write, frequency-fallback
   * @param topic 子选题实体。
   * @param comments 参与分析的评论。
   * @param latestDataAt 最新采集时间。
   * @returns {Promise<XhsTopicOpinion>} 分析结果。
   */
  private async analyze(
    topic: XhsTopicEntity,
    comments: XhsTopComment[],
    latestDataAt?: Date,
  ): Promise<XhsTopicOpinion> {
    const sample = comments.slice(0, MAX_ANALYZED_COMMENTS);
    const draft: {
      sentiments: Partial<Record<(typeof POLARITIES)[number], number>>;
      keywords: { word: string; weight: number }[];
      conclusion: string;
      highlights: XhsTopicOpinion['highlights'];
    } = { sentiments: {}, keywords: [], conclusion: '', highlights: [] };

    try {
      const tools = [
        this.createSentimentTool(draft),
        this.createKeywordTool(draft),
        this.createConclusionTool(draft),
        this.createHighlightTool(draft),
      ] as NonNullable<CreateAgentParams['tools']>;
      await this.agentService.runWithMessages({
        config: {
          system: this.buildSystemPrompt(topic, sample),
          tools,
          temperature: 0.2,
          noPostHook: true,
          nonStreaming: true,
        },
        messages: [
          {
            role: 'user',
            content:
              '开始分析。依次调用四个工具写入情感分布、热点关键词、一句话结论和代表性评论，不要在最终回答里输出 JSON。',
          },
        ],
        callOption: { recursionLimit: 40 },
      });
    } catch (error) {
      this.logger.warn(
        `[analyze] topicId=${topic.id} Agent 分析失败，回退词频兜底：${String(error)}`,
      );
    }

    const sentiments = this.normalizeSentiments(draft.sentiments, sample);
    const keywords =
      draft.keywords.length > 0
        ? draft.keywords.slice(0, MAX_KEYWORDS)
        : this.fallbackKeywords(sample);
    const highlights =
      draft.highlights.length > 0
        ? draft.highlights.slice(0, 6)
        : this.fallbackHighlights(sample);
    return {
      topicId: topic.id,
      sampleCount: sample.length,
      sentiments,
      keywords,
      conclusion:
        draft.conclusion ||
        `已分析 ${sample.length} 条热门评论，暂未生成结论文本。`,
      highlights,
      analyzedAt: new Date().toISOString(),
      dataAt: latestDataAt?.toISOString(),
    };
  }

  /**
   * @description 汇总子选题全部抓取记录里的热门评论，按点赞量倒序去重。
   * @keyword-cn 汇总热门评论, 评论去重
   * @keyword-en collect-comments, dedupe-comments
   * @param stats 子选题全部抓取数据。
   * @returns {XhsTopComment[]} 去重后的评论。
   */
  private collectComments(
    stats: { topComments?: XhsTopComment[] }[],
  ): XhsTopComment[] {
    const seen = new Set<string>();
    const merged: XhsTopComment[] = [];
    for (const stat of stats) {
      for (const comment of stat.topComments ?? []) {
        const content = String(comment?.content ?? '').trim();
        if (!content || seen.has(content)) continue;
        seen.add(content);
        merged.push({
          content,
          likeCount: Number(comment?.likeCount) || 0,
          replyCount: Number(comment?.replyCount) || 0,
        });
      }
    }
    return merged.sort((a, b) => b.likeCount - a.likeCount);
  }

  /**
   * @description 构造分析 Agent 的系统提示词，把评论样本按序号编入上下文供代表性评论引用。
   * @keyword-cn 分析提示词, 评论样本
   * @keyword-en analysis-prompt, comment-sample
   * @param topic 子选题实体。
   * @param comments 评论样本。
   * @returns {string} 系统提示词。
   */
  private buildSystemPrompt(
    topic: XhsTopicEntity,
    comments: XhsTopComment[],
  ): string {
    const listed = comments
      .map(
        (comment, index) =>
          `${index + 1}. [赞${comment.likeCount}] ${comment.content.slice(0, 120)}`,
      )
      .join('\n');
    return [
      '你是小红书内容舆情分析师，只通过工具写入结论，最终回答不承载任何结果。',
      `当前子选题：《${topic.title}》。`,
      '下面是该选题笔记下抓取到的热门评论样本：',
      listed,
      '',
      '执行要求：',
      '1. 调用 xhs_opinion_set_sentiment 一次，给出正面/中性/负面的评论条数，三者之和必须等于样本总数。',
      `2. 调用 xhs_opinion_add_keyword 最多 ${MAX_KEYWORDS} 次，写入真正高频且有信息量的关键词，权重用出现次数。`,
      '3. 调用 xhs_opinion_set_conclusion 一次，用一句话说清舆论导向与主要诉求，量化表述，不要空话。',
      '4. 调用 xhs_opinion_add_highlight 3-6 次，正负面都要覆盖，引用样本原文。',
      '禁止编造样本中不存在的评论内容。',
    ].join('\n');
  }

  /**
   * @description 创建情感分布写入工具。
   * @keyword-cn 情感分布工具, 极性计数
   * @keyword-en sentiment-tool, polarity-count
   * @param draft 本次分析的内存草稿。
   * @returns Agent 工具。
   */
  private createSentimentTool(draft: {
    sentiments: Partial<Record<(typeof POLARITIES)[number], number>>;
  }) {
    return tool(
      (input) => {
        draft.sentiments = {
          positive: Math.max(0, Number(input.positive) || 0),
          neutral: Math.max(0, Number(input.neutral) || 0),
          negative: Math.max(0, Number(input.negative) || 0),
        };
        return '已记录情感分布。';
      },
      {
        name: 'xhs_opinion_set_sentiment',
        description:
          '写入本次评论样本的情感分布条数。三个数之和必须等于样本总数，只调用一次。',
        schema: z.object({
          positive: z.number().int().min(0).describe('正面评论条数'),
          neutral: z.number().int().min(0).describe('中性评论条数'),
          negative: z.number().int().min(0).describe('负面评论条数'),
        }),
      },
    );
  }

  /**
   * @description 创建热点关键词写入工具。
   * @keyword-cn 关键词工具, 词频权重
   * @keyword-en keyword-tool, frequency-weight
   * @param draft 本次分析的内存草稿。
   * @returns Agent 工具。
   */
  private createKeywordTool(draft: {
    keywords: { word: string; weight: number }[];
  }) {
    return tool(
      (input) => {
        const word = String(input.word ?? '')
          .replace(/\s+/g, '')
          .trim();
        if (!word) return '未记录：关键词不能为空。';
        if (draft.keywords.length >= MAX_KEYWORDS) {
          return `未记录：关键词已满 ${MAX_KEYWORDS} 个。`;
        }
        if (draft.keywords.some((item) => item.word === word)) {
          return '未记录：关键词重复。';
        }
        draft.keywords.push({
          word: word.slice(0, 20),
          weight: Math.max(1, Number(input.weight) || 1),
        });
        return `已记录关键词「${word}」。`;
      },
      {
        name: 'xhs_opinion_add_keyword',
        description: '写入一个热点关键词及其出现次数，每个关键词单独调用一次。',
        schema: z.object({
          word: z.string().min(1).max(20).describe('中文关键词'),
          weight: z
            .number()
            .int()
            .min(1)
            .describe('该关键词在样本中的出现次数'),
        }),
      },
    );
  }

  /**
   * @description 创建舆论结论写入工具。
   * @keyword-cn 结论工具, 一句话结论
   * @keyword-en conclusion-tool, one-line-summary
   * @param draft 本次分析的内存草稿。
   * @returns Agent 工具。
   */
  private createConclusionTool(draft: { conclusion: string }) {
    return tool(
      (input) => {
        const text = String(input.conclusion ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text) return '未记录：结论不能为空。';
        draft.conclusion = text.slice(0, 200);
        return '已记录舆论结论。';
      },
      {
        name: 'xhs_opinion_set_conclusion',
        description: '写入一句话舆论导向结论，只调用一次。',
        schema: z.object({
          conclusion: z
            .string()
            .min(10)
            .max(200)
            .describe('量化、可执行的一句话舆论结论'),
        }),
      },
    );
  }

  /**
   * @description 创建代表性评论写入工具。
   * @keyword-cn 代表评论工具, 样本引用
   * @keyword-en highlight-tool, sample-quote
   * @param draft 本次分析的内存草稿。
   * @returns Agent 工具。
   */
  private createHighlightTool(draft: {
    highlights: XhsTopicOpinion['highlights'];
  }) {
    return tool(
      (input) => {
        const content = String(input.content ?? '').trim();
        if (!content) return '未记录：评论内容不能为空。';
        if (draft.highlights.length >= 6)
          return '未记录：代表性评论已满 6 条。';
        draft.highlights.push({
          polarity: input.polarity,
          content: content.slice(0, 120),
        });
        return `已记录第 ${draft.highlights.length} 条代表性评论。`;
      },
      {
        name: 'xhs_opinion_add_highlight',
        description:
          '写入一条代表性评论原文及其情感极性，每条单独调用一次，正负面都要覆盖。',
        schema: z.object({
          polarity: z
            .enum(['positive', 'neutral', 'negative'])
            .describe('该评论的情感极性'),
          content: z.string().min(2).max(120).describe('评论原文，不得改写'),
        }),
      },
    );
  }

  /**
   * @description 把模型给出的情感条数归一化成占比；模型没写或总数对不上时按条数重新配平，保证三段占比之和为 1。
   * @keyword-cn 情感归一化, 占比配平
   * @keyword-en normalize-sentiment, ratio-balance
   * @param raw 模型写入的情感条数。
   * @param comments 评论样本。
   * @returns {XhsOpinionSentiment[]} 归一化后的情感分布。
   */
  private normalizeSentiments(
    raw: Partial<Record<(typeof POLARITIES)[number], number>>,
    comments: XhsTopComment[],
  ): XhsOpinionSentiment[] {
    const total = comments.length;
    const counts = POLARITIES.map((polarity) =>
      Math.max(0, Number(raw[polarity]) || 0),
    );
    let sum = counts.reduce((acc, value) => acc + value, 0);
    if (sum === 0) {
      // 模型未写入时，全部计为中性，避免伪造正负面比例。
      counts[1] = total;
      sum = total;
    } else if (sum !== total && total > 0) {
      // 条数对不上时按比例缩放到样本总数，差额补给最大的一段。
      const scaled = counts.map((value) => Math.round((value / sum) * total));
      const drift = total - scaled.reduce((acc, value) => acc + value, 0);
      const maxIndex = scaled.indexOf(Math.max(...scaled));
      scaled[maxIndex] += drift;
      counts.splice(0, counts.length, ...scaled);
      sum = total;
    }
    return POLARITIES.map((polarity, index) => ({
      polarity,
      count: counts[index],
      ratio: sum > 0 ? counts[index] / sum : 0,
    }));
  }

  /**
   * @description Agent 未写入关键词时的兜底：按二字词切分统计词频。
   * @keyword-cn 关键词兜底, 词频统计
   * @keyword-en keyword-fallback, term-frequency
   * @param comments 评论样本。
   * @returns 关键词列表。
   */
  private fallbackKeywords(
    comments: XhsTopComment[],
  ): { word: string; weight: number }[] {
    const counts = new Map<string, number>();
    for (const comment of comments) {
      const chars = comment.content.replace(/[^一-龥]/g, '');
      for (let i = 0; i + 2 <= chars.length; i++) {
        const word = chars.slice(i, i + 2);
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .filter(([, weight]) => weight > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KEYWORDS)
      .map(([word, weight]) => ({ word, weight }));
  }

  /**
   * @description Agent 未写入代表性评论时的兜底：直接取点赞量最高的几条原文，极性标为中性。
   * @keyword-cn 代表评论兜底, 高赞评论
   * @keyword-en highlight-fallback, top-liked-comments
   * @param comments 评论样本。
   * @returns 代表性评论列表。
   */
  private fallbackHighlights(
    comments: XhsTopComment[],
  ): XhsTopicOpinion['highlights'] {
    return comments.slice(0, 3).map((comment) => ({
      polarity: 'neutral' as const,
      content: comment.content.slice(0, 120),
    }));
  }

  /**
   * @description 把缓存文档转换成接口返回结构。
   * @keyword-cn 舆论缓存视图, 结果转换
   * @keyword-en opinion-cache-view, result-mapping
   * @param entity 缓存文档。
   * @returns {XhsTopicOpinion} 接口返回体。
   */
  private toView(entity: XhsTopicOpinionEntity): XhsTopicOpinion {
    return {
      topicId: entity.topicId,
      sampleCount: entity.sampleCount,
      sentiments: entity.sentiments,
      keywords: entity.keywords,
      conclusion: entity.conclusion,
      highlights: entity.highlights,
      analyzedAt: new Date(entity.analyzedAt).toISOString(),
      dataAt: entity.dataAt ? new Date(entity.dataAt).toISOString() : undefined,
    };
  }
}
