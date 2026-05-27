import { Injectable, Inject } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
import { EmbeddingService } from '../../shared/embedding/embedding.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
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
    private readonly adminService: AdminService,
  ) {
    this.collection = db.collection<SkillThoughtEntity>('skill_thoughts');
    void this.ensureIndexes();
  }

  /**
   * @title 创建思维链 Create Thought
   * @description 创建新的思维链记录。支持同步和异步模式。
   * @param input - 创建参数
   * @param asyncMode - 是否异步模式（默认false），异步模式不会等待向量生成
   */
  async create(
    input: SkillThoughtCreateInput,
    asyncMode = false,
  ): Promise<SkillThoughtEntity> {
    const now = new Date();
    const entity: SkillThoughtEntity = {
      _id: new ObjectId(),
      tenantId: input.tenantId,
      userId: input.userId,
      content: input.content,
      summary: input.summary ?? '',
      keywords: input.keywords ?? [],
      embedding: input.embedding ?? [],
      sessionId: input.sessionId,
      toolsUsed: input.toolsUsed,
      category: input.category,
      usageCount: 0,
      status: input.status ?? (asyncMode ? 'pending' : 'completed'),
      createdAt: now,
      updatedAt: now,
    };

    if (asyncMode) {
      // 异步模式：直接插入，不等待向量生成
      await this.collection.insertOne(entity);
      // 异步处理摘要、关键词和向量生成
      this.processThoughtAsync(entity._id.toString(), input).catch((err) =>
        console.error('[SkillThoughtService] Async processing failed:', err),
      );
    } else {
      // 同步模式：生成向量
      const embeddingConfig = await this.resolveDefaultEmbeddingConfig();
      const textForEmbedding = `${input.summary ?? input.content} ${(input.keywords ?? []).join(' ')}`;
      entity.embedding = await this.embeddingService.embedText(
        textForEmbedding,
        embeddingConfig,
      );
      await this.collection.insertOne(entity);
    }

    return entity;
  }

  /**
   * @title 异步处理思维链 Process Thought Async
   * @description 后台生成摘要、关键词和向量嵌入。
   */
  private async processThoughtAsync(
    id: string,
    input: SkillThoughtCreateInput,
  ): Promise<void> {
    try {
      // 1. 生成摘要
      const summary = await this.generateSummary(input.content);
      // 2. 提取关键词
      const keywords = await this.extractKeywords(input.content);

      // 3. 生成向量
      const embeddingConfig = await this.resolveDefaultEmbeddingConfig();
      const textForEmbedding = `${summary} ${keywords.join(' ')}`;
      const embedding = await this.embeddingService.embedText(
        textForEmbedding,
        embeddingConfig,
      );

      // 4. 更新记录
      await this.collection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            summary,
            keywords,
            embedding,
            status: 'completed',
            updatedAt: new Date(),
          },
        },
      );
      console.log(
        `[SkillThoughtService] Thought ${id} async processing completed`,
      );
    } catch (error) {
      console.error(
        `[SkillThoughtService] Thought ${id} async processing failed:`,
        error,
      );
      await this.collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'failed', updatedAt: new Date() } },
      );
    }
  }

  /**
   * @title 向量相似度搜索 Search Similar
   * @description 使用 Atlas Vector Search 进行相似度搜索。
   */
  async searchSimilar(
    query: string,
    limit = 5,
    minScore = 0.5,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<SkillThoughtSearchResult[]> {
    const embeddingConfig = await this.resolveDefaultEmbeddingConfig();
    const queryEmbedding = await this.embeddingService.embedText(
      query,
      embeddingConfig,
    );

    // 如果已知 Atlas 不可用，直接使用本地搜索
    if (this.isAtlasAvailable === false) {
      return this.searchSimilarLocal(queryEmbedding, limit, minScore, scope);
    }

    try {
      const scopeMatch = this.buildScopeMatchStage(scope);
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
          ...(scopeMatch ? [scopeMatch] : []),
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
      return this.searchSimilarLocal(queryEmbedding, limit, minScore, scope);
    }
  }

  /**
   * @title 本地余弦相似度搜索 Local Cosine Similarity Search
   */
  private async searchSimilarLocal(
    queryEmbedding: number[],
    limit: number,
    minScore: number,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<SkillThoughtSearchResult[]> {
    const allThoughts = await this.collection
      .find(this.buildReadScopeFilter(scope))
      .toArray();

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
    scope?: { tenantId?: string; userId?: string },
  ): Promise<SkillThoughtSearchResult | null> {
    const results = await this.searchSimilar(query, 1, threshold, scope);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * @title 更新思维链 Update Thought
   * @description 更新思维链内容并重新生成向量。
   */
  async update(
    id: string,
    input: SkillThoughtUpdateInput,
    scope?: { tenantId?: string; userId?: string },
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
        ...this.buildScopeFilter(scope),
      });
      if (existing) {
        const summary = input.summary ?? existing.summary;
        const keywords = input.keywords ?? existing.keywords;
        const textForEmbedding = `${summary} ${keywords.join(' ')}`;
        const embeddingConfig = await this.resolveDefaultEmbeddingConfig();
        updates['embedding'] = await this.embeddingService.embedText(
          textForEmbedding,
          embeddingConfig,
        );
      }
    }

    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id), ...this.buildScopeFilter(scope) },
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
    scope?: { tenantId?: string; userId?: string },
  ): Promise<SkillThoughtEntity | null> {
    const existing = await this.collection.findOne({
      _id: new ObjectId(existingId),
      ...this.buildScopeFilter(scope),
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

    return this.update(
      existingId,
      {
        content: mergedContent,
        summary: newSummary,
        keywords: mergedKeywords,
        toolsUsed: mergedTools,
      },
      scope,
    );
  }

  /**
   * @title 增加使用次数 Increment Usage Count
   */
  async incrementUsageCount(
    id: string,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id), ...this.buildScopeFilter(scope) },
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
    scope?: { tenantId?: string; userId?: string },
  ): Promise<SkillThoughtEntity[]> {
    const filter = matchAll
      ? { keywords: { $all: keywords } }
      : { keywords: { $in: keywords } };

    return this.collection
      .find({ ...filter, ...this.buildReadScopeFilter(scope) })
      .sort({ usageCount: -1, updatedAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * @title 删除思维链 Delete Thought
   */
  async delete(
    id: string,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: new ObjectId(id),
      ...this.buildScopeFilter(scope),
    });
    return result.deletedCount > 0;
  }

  /**
   * @description 列出思维链
   * @keyword-en list thoughts
   */
  async list(
    scope?: { tenantId?: string; userId?: string },
    limit = 100,
  ): Promise<SkillThoughtEntity[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    return this.collection
      .find(this.buildReadScopeFilter(scope))
      .sort({ updatedAt: -1 })
      .limit(safeLimit)
      .toArray();
  }

  /**
   * @description 获取单条思维链
   * @keyword-en get thought by id
   */
  async getById(
    id: string,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<SkillThoughtEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.collection.findOne({
      _id: new ObjectId(id),
      ...this.buildReadScopeFilter(scope),
    });
  }

  /**
   * @title 使用 AI 生成摘要 Generate Summary with AI
   */
  async generateSummary(content: string): Promise<string> {
    try {
      const aiConfig = await this.resolveDefaultAiConfig();
      const messages = this.agentService.toMessages([
        {
          role: 'system',
          content: `你是一个面向"思维链/经验库"的专业摘要生成器。
你的目标是：将内容压缩成2-3句话，重点突出以下可检索信息：

1. 核心业务对象：涉及的主要实体、Schema、数据表（如用户、订单、任务、报表）
2. 关键字段/属性：重要的参数、配置、筛选条件
3. 典型场景：这段经验适用于什么场景（如数据分析、报表生成、任务自动化）
4. 解决的问题：这段经验能帮助解决什么问题

要求：
- 使用标准化的领域术语，便于语义检索
- 避免口语化表达，使用规范的技术/业务词汇
- 只保留足以让下次快速复用的关键信息
- 不要展开具体操作步骤或代码实现细节`,
        },
        { role: 'user', content },
      ]);

      const result = await this.agentService.runWithMessages({
        config: {
          provider: aiConfig.provider,
          model: aiConfig.model,
          temperature: 0.3,
          apiKey: aiConfig.apiKey,
          baseUrl: aiConfig.baseUrl,
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
      const aiConfig = await this.resolveDefaultAiConfig();
      const messages = this.agentService.toMessages([
        {
          role: 'system',
          content: `你是一个面向"思维链/经验库"的关键词提取专家。

请提取 5-10 个用于"广泛检索和复用"的高质量关键词。

关键词选择原则（按优先级）：
1. 核心业务对象：如 用户、订单、报表、任务、财务、销售
2. 业务动作：如 统计、汇总、对账、导出、生成、同步
3. 上位概念/模块名：如 财务分析、任务管理、数据看板、报表中心
4. 典型场景/用途：如 日报生成、月度对账、订单统计、任务提醒
5. 技术/工具名：如 Excel、PDF、API、Webhook、定时任务

要求：
- 关键词应短小精悍（2-6字为宜），便于向量匹配
- 优先使用标准化的技术/业务术语
- 避免带有过多限定条件的长句（如"2024年1月销售额统计"）
  应使用其上位概念（如 销售额统计、月度报表）
- 只返回关键词，用逗号分隔，不要其他内容`,
        },
        { role: 'user', content },
      ]);

      const result = await this.agentService.runWithMessages({
        config: {
          provider: aiConfig.provider,
          model: aiConfig.model,
          temperature: 0.1,
          apiKey: aiConfig.apiKey,
          baseUrl: aiConfig.baseUrl,
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
      await this.collection.createIndex(
        { keywords: 1 },
        { name: 'keywords_1' },
      );
      await this.collection.createIndex(
        { sessionId: 1 },
        { name: 'sessionId_1' },
      );
      await this.collection.createIndex(
        { category: 1 },
        { name: 'category_1' },
      );
      await this.collection.createIndex(
        { usageCount: -1 },
        { name: 'usageCount_-1' },
      );
      await this.collection.createIndex(
        { updatedAt: -1 },
        { name: 'updatedAt_-1' },
      );
      await this.collection.createIndex(
        { createdAt: -1 },
        { name: 'createdAt_-1' },
      );
      await this.collection.createIndex(
        { tenantId: 1, updatedAt: -1 },
        { name: 'tenantId_1_updatedAt_-1' },
      );
      await this.collection.createIndex(
        { tenantId: 1, userId: 1, updatedAt: -1 },
        { name: 'tenantId_1_userId_1_updatedAt_-1' },
      );
    } catch {
      // ignore
    }
  }

  /**
   * @description 构建向量检索作用域过滤
   * @keyword-en build vector search scope match
   */
  private buildScopeMatchStage(scope?: {
    tenantId?: string;
    userId?: string;
  }): { $match: Record<string, unknown> } | null {
    const filter = this.buildReadScopeFilter(scope);
    const keys = Object.keys(filter);
    if (keys.length === 0) return null;
    return { $match: filter };
  }

  /**
   * @description 构建读取范围过滤
   * @keyword-en build read scope filter
   */
  private buildReadScopeFilter(scope?: {
    tenantId?: string;
    userId?: string;
  }): Record<string, unknown> {
    const tenantId = scope?.tenantId?.trim();
    const userId = scope?.userId?.trim();
    if (!tenantId && !userId) return this.buildScopeFilter(scope);
    if (tenantId && userId) {
      return {
        $or: [
          { tenantId, userId },
          { tenantId, userId: { $exists: false } },
          { tenantId: { $exists: false }, userId },
          { tenantId: { $exists: false }, userId: { $exists: false } },
        ],
      };
    }
    if (tenantId) {
      return {
        $or: [{ tenantId }, { tenantId: { $exists: false } }],
      };
    }
    return {
      $or: [{ userId }, { userId: { $exists: false } }],
    };
  }

  /**
   * @description 解析默认AI模型配置
   * @keyword-en resolve default ai model config
   */
  private async resolveDefaultAiConfig(preferEmModel = false): Promise<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }> {
    if (preferEmModel) {
      const emRuntime = await this.adminService.getDefaultEmbeddingRuntime();
      if (emRuntime) {
        return {
          provider: emRuntime.providerCode,
          model: emRuntime.model,
          apiKey: emRuntime.apiKey,
          baseUrl: emRuntime.baseUrl,
        };
      }
    }
    const runtime = await this.adminService.getDefaultAiProviderRuntime();
    if (runtime) {
      const selectedModel =
        runtime.model || 'deepseek-ai/deepseek-v3.1-terminus';
      return {
        provider: runtime.providerCode,
        model: selectedModel,
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
      };
    }
    return {
      provider: 'nvidia',
      model: 'deepseek-ai/deepseek-v3.1-terminus',
    };
  }

  /**
   * @description 解析默认Embedding配置
   * @keyword-en resolve default embedding config
   */
  private async resolveDefaultEmbeddingConfig(): Promise<{
    providerCode?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  }> {
    const runtime = await this.adminService.getDefaultEmbeddingRuntime();
    if (!runtime) {
      return {
        providerCode: 'gemini',
        model: 'gemini-embedding-001',
      };
    }
    return {
      providerCode: runtime.providerCode,
      model: runtime.model,
      apiKey: runtime.apiKey,
      baseUrl: runtime.baseUrl,
    };
  }

  /**
   * @description 构建租户过滤
   * @keyword-en build tenant scope filter
   */
  private buildScopeFilter(scope?: { tenantId?: string; userId?: string }): {
    tenantId?: string | { $exists: false };
    userId?: string;
  } {
    const filter: {
      tenantId?: string | { $exists: false };
      userId?: string;
    } = {};
    if (scope && 'tenantId' in scope) {
      const tenantId = scope.tenantId?.trim();
      filter.tenantId = tenantId ? tenantId : { $exists: false };
    }
    if (scope?.userId?.trim()) {
      filter.userId = scope.userId.trim();
    }
    return filter;
  }
}
