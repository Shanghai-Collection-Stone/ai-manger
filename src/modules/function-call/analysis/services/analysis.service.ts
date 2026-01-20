import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams, BaseMessage } from 'langchain';
import * as z from 'zod';
import { AgentService } from '../../../ai-agent/services/agent.service.js';
import { SchemaFunctionCallService } from '../../schema/services/schema.service.js';
import { MongoFunctionCallService } from '../../mongo/services/mongo.service.js';

/**
 * @title 数据分析函数服务 Data Analysis Function Service
 * @description 结合上下文与Schema推断最小查询，并在Mongo执行返回结果。
 * @keywords-cn 数据分析, 最小查询, Schema, Mongo
 * @keywords-en data analysis, minimal query, schema, mongo
 */
@Injectable()
export class AnalysisFunctionCallService {
  constructor(
    private readonly agent: AgentService,
    private readonly schemaTools: SchemaFunctionCallService,
    private readonly mongoTools: MongoFunctionCallService,
  ) {}

  /**
   * @title 获取函数句柄 Get Handle
   * @description 返回该服务的函数调用句柄数组，用于Agent工具集。
   * @keywords-cn 函数调用, 句柄, 工具
   * @keywords-en function call, handle, tools
   * @returns `CreateAgentParams['tools']` 函数描述列表
   */
  getHandle(streamWriter?: (msg: string) => void): CreateAgentParams['tools'] {
    const dataAnalysis = tool(
      async ({ question, provider, model }, config) => {
        if (streamWriter) streamWriter(`Analyzing request: ${question}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const context = config.context?.currentContext as BaseMessage[];

        const jsonSchema = {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              description: 'Final answer to the user question',
            },
            data: {
              type: 'string',
              description: 'Raw data retrieved from database (optional)',
            },
            query: {
              type: 'string',
              description: 'The executed query (optional)',
            },
          },
          required: ['answer'],
        };

        const sys = [
          '你是一名严谨、务实的数据分析 Agent。',
          '目标：以最小推理成本与最少工具调用，在单次流程内一次性获取所需数据并返回最终答案。',
          '核心流程（单次流程）：',
          '1. 基于用户问题精准识别所需数据实体、集合和关键字段。',
          '2. 调用 `schema_search` 时需使用多组关键词，一次性检索多个相关 schema，获取集合名称与字段定义。',
          '3. 【关键要求】使用 `mongo_search` 时：严格依据 schema 字段构建查询，不得编造字段、不得产生幻觉；筛选条件仅可使用真实字段；filter、projection、sort、limit 必须完全基于 schema 结果。',
          '4. 基于查询输出直接回答问题；若为统计类需求，优先使用 Count、Aggregate、MapReduce，而非获取完整记录。',
          '约束与阈值：',
          '1. 禁止输出任何思维过程或链式解释，必须只返回最终 JSON。',
          '2. 默认 limit = 50；最大 limit = 200；若用户未明确要求更多，不得超过 100。',
          '3. 避免不必要的多轮工具调用；一次查询应覆盖需求。',
          '4. 必须严格使用 schema_search 返回的字段名与集合名；禁止臆测字段。',
          `5. 当前用户偏好 limit: 50条 - 100条，默认50条。`,
          '错误自愈机制：',
          '- 当 `mongo_search` 返回 INVALID_FILTER_FIELDS（包含 invalid_fields 和 suggestions）时：不得终止；需根据语义使用得分最高、最贴近的字段替换错误字段。',
          '- 替换时必须保留原筛选结构（如 $and/$or/$gte/$eq 等）及其值，仅替换字段名；替换后立即重试 `mongo_search`。',
          '- 若无高匹配候选或替换后仍失败，则重新执行 `schema_search` 以确认字段，并据此重建 filter。',
          '- 示例：create_time → created_at；保持原语义不变。',
          '- 若返回 SCHEMA_REQUIRED，则必须先执行 `schema_search` 获取字段，再构建查询。',
          'schema 字段说明：',
          '- schema 包含集合名称、字段名、类型、是否必填、描述等信息。',
          '- 查询字段必须严格基于 schema 字段，禁止编造。',
          '- 可一次性构造多组关键词，以减少 schema_search 调用次数。',
          '数据获取策略：',
          '- 数据分析优先使用 Count、Aggregate、MapReduce 等方式；Find 有 limit 限制，应减少使用。',
          '- Find 仅在必须获取真实列表或实体数据时使用，如排行榜等。',
          '- 用户明确要求更多数据时，limit 可提升至 100；否则保持默认策略。',
          '- 若无需返回具体记录，优先使用计数或聚合以提升效率。',
          '输出要求：',
          'You must output JSON in the following format:',
          JSON.stringify(jsonSchema, null, 2),
        ].join('\\n');

        const messages: BaseMessage[] = [
          ...this.agent.toMessages([{ role: 'system', content: sys }]),
          ...(context ?? []),
          ...this.agent.toMessages([{ role: 'user', content: question }]),
        ];

        const tools = [
          ...(this.schemaTools.getHandle() ?? []),
          ...(this.mongoTools.getHandle() ?? []),
        ];

        const cfg = {
          provider: provider ?? 'deepseek',
          model: model ?? 'deepseek-chat',
          noPostHook: true,
          temperature: 0.1, // Lower temperature for precision
          tools,
        };

        let finalContent = '';
        try {
          if (streamWriter) streamWriter('Searching related schemas...');
          const ai = await this.agent.runWithMessages({
            config: cfg,
            messages,
          });
          const content = (ai as unknown as { content: unknown }).content;
          finalContent =
            typeof content === 'string' ? content : JSON.stringify(content);
          if (streamWriter) streamWriter('Formatting analysis result...');
        } catch (error: any) {
          console.error('Data analysis failed:', error);
          if (streamWriter) streamWriter(`[DataAnalysis] Error: ${error}`);
          return 'Data analysis failed due to an internal error.';
        }

        if (streamWriter) streamWriter(`[DataAnalysis] Complete.`);
        return finalContent;
      },
      {
        name: 'data_analysis',
        description:
          'Data Analysis & Retrieval Tool. Call this tool whenever the user asks for data, statistics, specific records, or database information. It AUTOMATICALLY infers schemas and executes MongoDB queries. DO NOT ask the user for collection names.',
        schema: z.object({
          question: z.string().describe('Analysis question'),
          context: z
            .array(
              z.object({
                role: z.enum(['system', 'user', 'assistant']),
                content: z.string(),
              }),
            )
            .optional()
            .describe('Conversation context'),
          limit: z
            .number()
            .optional()
            .describe('Preferred max rows (default 20, max 20)'),
          provider: z.enum(['gemini', 'deepseek']).optional(),
          model: z.string().optional(),
        }),
      },
    );

    return [dataAnalysis];
  }
}
