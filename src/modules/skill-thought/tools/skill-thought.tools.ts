import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { SkillThoughtService } from '../services/skill-thought.service.js';

/**
 * @title 思维链 Tools 服务 Skill Thought Tools Service
 * @description 提供思维链的 LangChain 工具函数：搜索和生成。
 * @keywords-cn 思维链工具, 搜索, 生成
 * @keywords-en skill thought tools, search, generate
 */
@Injectable()
export class SkillThoughtToolsService {
  constructor(private readonly thoughtService: SkillThoughtService) {}

  /**
   * @title 获取工具句柄 Get Handle
   * @description 返回思维链相关的工具列表。
   */
  getHandle(): CreateAgentParams['tools'] {
    /**
     * Tool 1: search_thought
     * 搜索思维链，用于快速检索相关经验
     */
    const searchThought = tool(
      async ({ query, limit, minScore }) => {
        try {
          const results = await this.thoughtService.searchSimilar(
            query,
            limit ?? 5,
            minScore ?? 0.5,
          );

          let used = results;
          const normalizedQuery = query.toLowerCase().trim();
          if (normalizedQuery.length > 0 && results.length > 0) {
            const overlapped = results.filter((r) => {
              const keywords = r.thought.keywords ?? [];
              if (keywords.length === 0) return false;
              return keywords.some((kw) => {
                const k = kw.toLowerCase().trim();
                return k.length > 0 && normalizedQuery.indexOf(k) !== -1;
              });
            });
            if (overlapped.length > 0) {
              used = overlapped;
            }
          }

          if (used.length === 0) {
            return JSON.stringify({
              success: true,
              message: 'No matching thoughts found',
              results: [],
              shouldGenerateThought: true,
            });
          }

          for (const r of used) {
            await this.thoughtService.incrementUsageCount(
              r.thought._id.toString(),
            );
          }

          return JSON.stringify({
            success: true,
            count: used.length,
            shouldGenerateThought: false,
            results: used.map((r) => ({
              id: r.thought._id.toString(),
              summary: r.thought.summary,
              keywords: r.thought.keywords,
              toolsUsed: r.thought.toolsUsed,
              score: r.score,
              content:
                r.thought.content.length > 500
                  ? r.thought.content.slice(0, 500) + '...'
                  : r.thought.content,
            })),
          });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'search_thought',
        description: [
          'Search for similar skill thoughts (past solutions/experiences) based on semantic similarity.',
          'Use this tool BEFORE attempting complex tasks to find relevant past solutions.',
          'Returns matched thoughts with their summaries, keywords, and content snippets.',
          'Field `shouldGenerateThought` in the response indicates whether it is appropriate to call `generate_thought` (true only when no related thoughts were found).',
        ].join(' '),
        schema: z.object({
          query: z
            .string()
            .describe(
              'Search query describing what you are trying to accomplish',
            ),
          limit: z
            .number()
            .optional()
            .default(5)
            .describe('Maximum number of results to return'),
          minScore: z
            .number()
            .optional()
            .default(0.5)
            .describe('Minimum similarity score (0-1)'),
        }),
      },
    );

    /**
     * Tool 2: generate_thought
     * 产生/更新思维链
     */
    const generateThought = tool(
      async ({ content, sessionId, toolsUsed, category, allowGenerate }) => {
        try {
          if (allowGenerate === false) {
            return JSON.stringify({
              success: false,
              action: 'skipped',
              message:
                'Thought generation is disabled in this context (allowGenerate=false).',
            });
          }

          // 1. 使用 AI 生成摘要和关键词
          const summary = await this.thoughtService.generateSummary(content);
          const keywords = await this.thoughtService.extractKeywords(content);

          if (keywords.length === 0) {
            return JSON.stringify({
              success: false,
              error: 'Failed to extract keywords from content',
            });
          }

          // 2. 搜索是否有强相关的已有思维链（相似度 > 0.85）
          const searchQuery = `${summary} ${keywords.join(' ')}`;
          const existingThought =
            await this.thoughtService.findStronglyRelated(searchQuery);

          if (existingThought) {
            // 3. 若有强相关，则合并更新
            const merged = await this.thoughtService.mergeIntoExisting(
              existingThought.thought._id.toString(),
              content,
              keywords,
              toolsUsed,
            );

            if (merged) {
              return JSON.stringify({
                success: true,
                action: 'merged',
                message: 'Content merged into existing thought',
                thoughtId: merged._id.toString(),
                summary: merged.summary,
                keywords: merged.keywords,
                similarityScore: existingThought.score,
              });
            }
          }

          // 4. 否则创建新记录
          const newThought = await this.thoughtService.create({
            content,
            summary,
            keywords,
            sessionId,
            toolsUsed,
            category,
          });

          return JSON.stringify({
            success: true,
            action: 'created',
            message: 'New thought created',
            thoughtId: newThought._id.toString(),
            summary: newThought.summary,
            keywords: newThought.keywords,
          });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'generate_thought',
        description: [
          'Generate and store a reusable skill thought focused on schema knowledge and typical query conditions, not low-level execution steps.',
          'Automatically extracts keywords and generates a summary for classification and fast retrieval.',
          'If a strongly related thought exists (similarity > 0.85), the new content will be merged instead of creating duplicates.',
          'Use this tool AFTER completing a task when you want future calls to quickly know which schemas, fields, and conditions to use for similar questions.',
          'Only call this tool when the latest `search_thought` response has `shouldGenerateThought=true`, and pass `allowGenerate=true` explicitly; otherwise, avoid calling it.',
        ].join(' '),
        schema: z.object({
          content: z
            .string()
            .describe(
              'Structured description centered on schema, field meanings, and key filters/conditions needed to solve similar questions; do NOT include low-level execution steps.',
            ),
          allowGenerate: z
            .boolean()
            .optional()
            .describe(
              'Set to false to explicitly disable creating or merging any thought in this context',
            ),
          sessionId: z
            .string()
            .optional()
            .describe('Session ID where this thought was generated'),
          toolsUsed: z
            .array(z.string())
            .optional()
            .describe('List of tools used in this solution'),
          category: z
            .string()
            .optional()
            .describe(
              'Category/type of this thought (e.g., "data-analysis", "frontend")',
            ),
        }),
      },
    );

    /**
     * Tool 3: get_thought_detail
     * 获取思维链详情
     */
    const getThoughtDetail = tool(
      async ({ thoughtId }) => {
        try {
          const results = await this.thoughtService.findByKeywords(
            [],
            false,
            1,
          );
          // 这里需要一个 findById 方法，暂时通过搜索实现
          const thought = results.find((t) => t._id.toString() === thoughtId);

          if (!thought) {
            return JSON.stringify({
              success: false,
              error: 'Thought not found',
            });
          }

          await this.thoughtService.incrementUsageCount(thoughtId);

          return JSON.stringify({
            success: true,
            thought: {
              id: thought._id.toString(),
              content: thought.content,
              summary: thought.summary,
              keywords: thought.keywords,
              toolsUsed: thought.toolsUsed,
              category: thought.category,
              usageCount: thought.usageCount,
              createdAt: thought.createdAt,
              updatedAt: thought.updatedAt,
            },
          });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'get_thought_detail',
        description: 'Get full details of a specific skill thought by its ID.',
        schema: z.object({
          thoughtId: z.string().describe('The ID of the thought to retrieve'),
        }),
      },
    );

    return [searchThought, generateThought, getThoughtDetail];
  }
}
