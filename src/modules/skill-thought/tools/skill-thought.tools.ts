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
  getHandle(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    /**
     * Tool 1: search_thought
     * 搜索思维链，用于快速检索相关经验
     */
    const searchThought = tool(
      async ({ query, limit, minScore }) => {
        try {
          console.log(
            '[searchThought] 开始搜索, query:',
            query,
            'limit:',
            limit,
            'minScore:',
            minScore,
          );

          const results = await this.thoughtService.searchSimilar(
            query,
            limit ?? 5,
            minScore ?? 0.5,
            scope,
          );

          console.log('[searchThought] 向量搜索命中结果数:', results.length);
          if (results.length > 0) {
            results.forEach((r, i) => {
              console.log(
                `[searchThought] 命中 ${i + 1}: score=${r.score.toFixed(4)}, keywords=${r.thought.keywords?.join(', ')}, summary=${r.thought.summary?.slice(0, 50)}...`,
              );
            });
          }

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
            console.log('[searchThought] 关键词命中结果数:', overlapped.length);
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
              scope,
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
     * 产生/更新思维链 - 异步模式
     */
    const generateThought = tool(
      async ({ content, sessionId, toolsUsed, category, allowGenerate, asyncMode }) => {
        try {
          if (allowGenerate === false) {
            return JSON.stringify({
              success: false,
              action: 'skipped',
              message:
                'Thought generation is disabled in this context (allowGenerate=false).',
            });
          }
          console.log('[generate_thought] content length:', content.length);

          // 1. 搜索是否有强相关的已有思维链（相似度 > 0.85）
          // 使用内容摘要做预搜索
          const searchQuery = content.slice(0, 200);
          const existingThought = await this.thoughtService.findStronglyRelated(
            searchQuery,
            undefined,
            scope,
          );

          if (existingThought) {
            // 2. 若有强相关，则合并更新（同步模式）
            const merged = await this.thoughtService.mergeIntoExisting(
              existingThought.thought._id.toString(),
              content,
              [], // 异步模式下不传关键词，后续异步更新
              toolsUsed,
              scope,
            );

            if (merged) {
              return JSON.stringify({
                success: true,
                action: 'merged',
                message: 'Content merged into existing thought (async processing)',
                thoughtId: merged._id.toString(),
                status: 'pending',
                similarityScore: existingThought.score,
                note: 'Summary and keywords are being generated in background',
              });
            }
          }

          // 3. 否则创建新记录（异步模式）
          const useAsync = asyncMode !== false; // 默认异步
          const newThought = await this.thoughtService.create(
            {
              content,
              tenantId: scope?.tenantId,
              userId: scope?.userId,
              sessionId,
              toolsUsed,
              category,
            },
            useAsync, // asyncMode
          );

          return JSON.stringify({
            success: true,
            action: 'created',
            message: useAsync
              ? 'Thought created, summary/keywords being generated in background'
              : 'Thought created with summary and keywords',
            thoughtId: newThought._id.toString(),
            status: useAsync ? 'pending' : 'completed',
            ...(useAsync
              ? { note: 'Use get_thought_detail later to get full content' }
              : {
                  summary: newThought.summary,
                  keywords: newThought.keywords,
                }),
          });
        } catch (error) {
          console.error('Error in generate_thought:', error);
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
          '默认使用异步模式创建，summary和keywords会在后台异步生成，不阻塞主流程。',
        ].join(' '),
        schema: z.object({
          content: z
            .string()
            .describe(
              '所有关于该思维的分析和数据分析的所有信息,用于生成或合并思维链',
            ),
          allowGenerate: z
            .boolean()
            .optional()
            .describe(
              'Set to false to explicitly disable creating or merging any thought in this context',
            ),
          asyncMode: z
            .boolean()
            .optional()
            .describe('异步模式：true=立即返回，后台生成摘要关键词(默认)；false=同步等待完成')
            .default(true),
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
          const thought = await this.thoughtService.getById(thoughtId, scope);

          if (!thought) {
            return JSON.stringify({
              success: false,
              error: 'Thought not found',
            });
          }

          await this.thoughtService.incrementUsageCount(thoughtId, scope);

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
