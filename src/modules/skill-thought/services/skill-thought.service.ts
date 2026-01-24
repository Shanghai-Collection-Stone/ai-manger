import { Injectable, Inject } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
import { EmbeddingService } from '../../shared/embedding/embedding.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import {
  SkillThoughtEntity,
  SkillThoughtCreateInput,
  SkillThoughtSearchResult,
  SkillThoughtUpdateInput,
} from '../entities/skill-thought.entity.js';

/**
 * @title 思维链服务 Skill Thought Service
 * @description 管理思维链的 CRUD 操作、向量搜索和智能合并。
 * @keywords-cn 思维链服务, 向量搜索, 智能合并
 * @keywords-en skill thought service, vector search, intelligent merge
 */
@Injectable()
export class SkillThoughtService {
  private readonly collection: Collection<SkillThoughtEntity>;
  private readonly VECTOR_INDEX_NAME = 'skill_thought_embedding_index';
  private readonly SIMILARITY_THRESHOLD = 0.85;
  private isAtlasAvailable: boolean | null = null; // 缓存 Atlas 可用性检测结果

  constructor(
    @Inject('ST_MONGO_DB') private readonly db: Db,
    private readonly embeddingService: EmbeddingService,
    private readonly agentService: AgentService,
  ) {
    this.collection = db.collection<SkillThoughtEntity>('skill_thoughts');
    void this.ensureIndexes();
  }

  /**
   * @title 创建思维链 Create Thought
   * @description 创建新的思维链记录。
   */
  async create(input: SkillThoughtCreateInput): Promise<SkillThoughtEntity> {
    const now = new Date();

    // 生成向量嵌入（使用摘要+关键词组合）
    const textForEmbedding = `${input.summary} ${input.keywords.join(' ')}`;
    const embedding = await this.embeddingService.embedText(textForEmbedding);

    const entity: SkillThoughtEntity = {
      _id: new ObjectId(),
      content: input.content,
      summary: input.summary,
      keywords: input.keywords,
      embedding,
      sessionId: input.sessionId,
      toolsUsed: input.toolsUsed,
      category: input.category,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.collection.insertOne(entity);
    return entity;
  }

  /**
   * @title 向量相似度搜索 Search Similar
   * @description 使用 Atlas Vector Search 进行相似度搜索。
   */
  async searchSimilar(
    query: string,
    limit = 5,
    minScore = 0.5,
  ): Promise<SkillThoughtSearchResult[]> {
    const queryEmbedding = await this.embeddingService.embedText(query);

    // 如果已知 Atlas 不可用，直接使用本地搜索
    if (this.isAtlasAvailable === false) {
      return this.searchSimilarLocal(queryEmbedding, limit, minScore);
    }

    try {
      // 使用 Atlas Vector Search
      const results = await this.collection
        .aggregate<SkillThoughtEntity & { score: number }>([
          {
            $vectorSearch: {
              index: this.VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 10,
              limit: limit * 2, // 获取更多候选以便过滤
            },
          },
          {
            $addFields: {
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ])
        .toArray();

      // 标记 Atlas 可用
      this.isAtlasAvailable = true;

      return results
        .filter((r) => r.score >= minScore)
        .slice(0, limit)
        .map((r) => ({
          thought: r,
          score: r.score,
        }));
    } catch {
      // 检测到 Atlas 不可用，标记并回退到本地余弦相似度
      if (this.isAtlasAvailable === null) {
        console.warn(
          '[SkillThoughtService] Atlas Vector Search not available, using local cosine similarity',
        );
        this.isAtlasAvailable = false;
      }
      return this.searchSimilarLocal(queryEmbedding, limit, minScore);
    }
  }

  /**
   * @title 本地余弦相似度搜索 Local Cosine Similarity Search
   */
  private async searchSimilarLocal(
    queryEmbedding: number[],
    limit: number,
    minScore: number,
  ): Promise<SkillThoughtSearchResult[]> {
    const allThoughts = await this.collection.find({}).toArray();

    const scored = allThoughts
      .filter(
        (thought): thought is SkillThoughtEntity & { embedding: number[] } =>
          Array.isArray(thought.embedding) && thought.embedding.length > 0,
      )
      .map((thought) => ({
        thought,
        score: this.embeddingService.cosineSimilarity(
          queryEmbedding,
          thought.embedding,
        ),
      }));

    return scored
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * @title 查找强相关思维链 Find Strongly Related
   * @description 查找相似度超过阈值的强相关思维链。
   */
  async findStronglyRelated(
    query: string,
    threshold = this.SIMILARITY_THRESHOLD,
  ): Promise<SkillThoughtSearchResult | null> {
    const results = await this.searchSimilar(query, 1, threshold);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * @title 更新思维链 Update Thought
   * @description 更新思维链内容并重新生成向量。
   */
  async update(
    id: string,
    input: SkillThoughtUpdateInput,
  ): Promise<SkillThoughtEntity | null> {
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (input.content !== undefined) updates['content'] = input.content;
    if (input.summary !== undefined) updates['summary'] = input.summary;
    if (input.keywords !== undefined) updates['keywords'] = input.keywords;
    if (input.toolsUsed !== undefined) updates['toolsUsed'] = input.toolsUsed;
    if (input.category !== undefined) updates['category'] = input.category;

    // 如果摘要或关键词更新，重新生成向量
    if (input.summary !== undefined || input.keywords !== undefined) {
      const existing = await this.collection.findOne({
        _id: new ObjectId(id),
      });
      if (existing) {
        const summary = input.summary ?? existing.summary;
        const keywords = input.keywords ?? existing.keywords;
        const textForEmbedding = `${summary} ${keywords.join(' ')}`;
        updates['embedding'] =
          await this.embeddingService.embedText(textForEmbedding);
      }
    }

    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after' },
    );

    return result ?? null;
  }

  /**
   * @title 合并思维链 Merge Thought
   * @description 将新内容合并到已有的强相关思维链中。
   */
  async mergeIntoExisting(
    existingId: string,
    newContent: string,
    newKeywords: string[],
    newToolsUsed?: string[],
  ): Promise<SkillThoughtEntity | null> {
    const existing = await this.collection.findOne({
      _id: new ObjectId(existingId),
    });
    if (!existing) return null;

    // 合并内容
    const mergedContent = `${existing.content}

---

${newContent}`;

    // 合并关键词（去重）
    const mergedKeywords = Array.from(
      new Set([...existing.keywords, ...newKeywords]),
    );

    // 合并工具列表
    const mergedTools = Array.from(
      new Set([...(existing.toolsUsed ?? []), ...(newToolsUsed ?? [])]),
    );

    // 使用 AI 生成新的摘要
    const newSummary = await this.generateSummary(mergedContent);

    return this.update(existingId, {
      content: mergedContent,
      summary: newSummary,
      keywords: mergedKeywords,
      toolsUsed: mergedTools,
    });
  }

  /**
   * @title 增加使用次数 Increment Usage Count
   */
  async incrementUsageCount(id: string): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $inc: { usageCount: 1 },
        $set: { updatedAt: new Date() },
      },
    );
  }

  /**
   * @title 按关键词查找 Find By Keywords
   */
  async findByKeywords(
    keywords: string[],
    matchAll = false,
    limit = 10,
  ): Promise<SkillThoughtEntity[]> {
    const filter = matchAll
      ? { keywords: { $all: keywords } }
      : { keywords: { $in: keywords } };

    return this.collection
      .find(filter)
      .sort({ usageCount: -1, updatedAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * @title 删除思维链 Delete Thought
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: new ObjectId(id),
    });
    return result.deletedCount > 0;
  }

  /**
   * @title 使用 AI 生成摘要 Generate Summary with AI
   */
  async generateSummary(content: string): Promise<string> {
    try {
      const messages = this.agentService.toMessages([
        {
          role: 'system',
          content:
            '你是一个面向“思维链/经验库”的专业摘要生成器。你的目标是：将下面的内容压缩成一到两句话，重点突出：1）涉及到的 schema 或数据表（包括数据源、schema 名称、collectionName 或 tableId）；2）这些 schema 中关键字段的含义；3）适用的典型查询条件或使用场景。不要展开具体的操作步骤或查询执行过程，只保留足以让下次快速复用的关键信息。',
        },
        { role: 'user', content },
      ]);

      const result = await this.agentService.runWithMessages({
        config: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.3,
        },
        messages,
      });

      const responseContent = result.content;
      return typeof responseContent === 'string'
        ? responseContent.trim()
        : JSON.stringify(responseContent);
    } catch (error) {
      console.error('Failed to generate summary:', error);
      // 回退：取前200字符
      return content.slice(0, 200) + (content.length > 200 ? '...' : '');
    }
  }

  /**
   * @title 使用 AI 提取关键词 Extract Keywords with AI
   */
  async extractKeywords(content: string): Promise<string[]> {
    try {
      const messages = this.agentService.toMessages([
        {
          role: 'system',
          content:
            '你是一个关键词提取器。请从以下内容中提取 5-10 个用于“广泛检索和复用”的关键词。只返回关键词，用逗号分隔，不要其他内容。关键词应尽量短小、泛化，优先选择：1）领域核心名词（如 营业额、订单、任务）；2）上位概念或模块名（如 财务分析、任务管理）；3）典型业务场景（如 日报、对账、统计）。避免带有过多限定条件的长句（如 “1月营业额>1000 的统计”），而是用其上位概念（如 营业额统计、月度报表）。',
        },
        { role: 'user', content },
      ]);

      const result = await this.agentService.runWithMessages({
        config: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.1,
        },
        messages,
      });

      const responseContent = result.content;
      const text =
        typeof responseContent === 'string'
          ? responseContent
          : JSON.stringify(responseContent);

      return text
        .split(/[,，\n]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    } catch (error) {
      console.error('Failed to extract keywords:', error);
      return [];
    }
  }

  /**
   * @title 确保索引 Ensure Indexes
   */
  private async ensureIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ keywords: 1 });
      await this.collection.createIndex({ sessionId: 1 });
      await this.collection.createIndex({ category: 1 });
      await this.collection.createIndex({ usageCount: -1 });
      await this.collection.createIndex({ updatedAt: -1 });
    } catch {
      // ignore
    }
  }
}
