import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams, BaseMessage } from 'langchain';
import * as z from 'zod';
import { AgentService } from '../../../ai-agent/services/agent.service.js';
import { SchemaFunctionCallService } from '../../schema/services/schema.service.js';
import { DataSourceSearchToolsService } from '../../../data-source/tools/data-source-search.tools.js';
import { SuperPartySourceToolsService } from '../../../data-source/sources/super-party/super-party-source.tools.js';
import { FeishuBitableSourceToolsService } from '../../../data-source/sources/feishu-bitable/feishu-bitable-source.tools.js';
import { SkillThoughtToolsService } from '../../../skill-thought/tools/skill-thought.tools.js';

/**
 * @title 数据分析函数服务 Data Analysis Function Service
 * @description 集中管理所有数据源的分析工具，集成思维链学习。
 * @keywords-cn 数据分析, 最小查询, Schema, 数据源, 思维链
 * @keywords-en data analysis, minimal query, schema, data source, skill thought
 */
@Injectable()
export class AnalysisFunctionCallService {
  constructor(
    private readonly agent: AgentService,
    private readonly schemaTools: SchemaFunctionCallService,
    private readonly dataSourceTools: DataSourceSearchToolsService,
    private readonly superPartyTools: SuperPartySourceToolsService,
    private readonly feishuBitableTools: FeishuBitableSourceToolsService,
    private readonly skillThoughtTools: SkillThoughtToolsService,
  ) {}

  /**
   * @title 获取所有数据源工具 Get All Data Source Tools
   * @description 返回所有数据源相关的工具列表（含思维链工具），用于 Agent 调用。
   */
  getAllDataSourceTools(): CreateAgentParams['tools'] {
    const tools: CreateAgentParams['tools'] = [
      ...(this.skillThoughtTools.getHandle() ?? []),
      // Schema 搜索工具
      ...(this.schemaTools.getHandle() ?? []),
      // 各数据源查询工具
      ...(this.dataSourceTools.getHandle() ?? []),
      ...(this.superPartyTools.getHandle() ?? []),
      ...(this.feishuBitableTools.getTools() ?? []),
    ];

    const selfGuard = tool(
      () => {
        return JSON.stringify({
          error: 'NESTED_DATA_ANALYSIS_NOT_ALLOWED',
          message:
            '当前已经在 data_analysis 工具内部，禁止再次调用 data_analysis。请直接使用 schema_search、data_source_query、super_party_query、feishu_bitable_* 或已有思维链内容完成本次分析。',
        });
      },
      {
        name: 'data_analysis',
        description:
          'Guard tool used inside data_analysis to prevent recursive calls to data_analysis itself.',
        schema: z.object({}),
      },
    );

    tools.push(selfGuard);
    return tools;
  }

  /**
   * @title 获取函数句柄 Get Handle
   * @description 返回该服务的函数调用句柄数组，用于Agent工具集。
   * @keywords-cn 函数调用, 句柄, 工具
   * @keywords-en function call, handle, tools
   * @returns `CreateAgentParams['tools']` 函数描述列表
   */
  getHandle(streamWriter?: (msg: string) => void): CreateAgentParams['tools'] {
    const dataAnalysis = tool(
      async ({ question, provider, model, ip, now }, config) => {
        if (streamWriter) streamWriter(`Analyzing request: ${question}`);
        let context: BaseMessage[] | undefined;
        if (config && typeof config === 'object') {
          const cfgObj = config as Record<string, unknown>;
          const ctxObj = cfgObj['context'];
          if (ctxObj && typeof ctxObj === 'object') {
            const cur = (ctxObj as Record<string, unknown>)['currentContext'];
            if (Array.isArray(cur)) {
              context = cur as BaseMessage[];
            }
          }
        }

        const resolvedNow =
          typeof now === 'string' && now.trim().length > 0
            ? now
            : new Date().toISOString();
        const resolvedIp =
          typeof ip === 'string' && ip.trim().length > 0 ? ip : 'unknown';

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
          '所有数据纬度都以给人理解为准,比如标识用户的就不用ID,用username等来考虑,理解为用户更方便记忆和操作。',
          '在进行任何复杂数据查询前，必须优先调用 search_thought 搜索相似的历史经验，而不是直接进行 schema_search 或数据查询。',
          '[重要] search_thought 得到历史经验后,要分析是否有本次查询需要的表结构,从而达成快速搜索的目的',
          '如果本次调用中已经通过 search_thought 找到了可复用的思维链（返回结果非空），则本次流程中严禁再调用 generate_thought，只能基于已有思维链内容进行查询与回答。',
          '如果存在多数据源的情况,以 JSON 返回内容 { question:xx },告诉用户要确定的数据源',
          '',
          '【核心流程】遵循以下顺序执行：',
          '',
          '1. 【搜索历史经验】先调用 search_thought 搜索相似的历史查询经验：',
          '   - 若找到匹配 需要强结合历史经验,不要在过度搜索Schema, 通过相关经验的工具调用链路和表结构,来获取你需要的数据即可',
          '   - 若无匹配，继续下一步',
          '',
          '2. 【推断数据源】调用 schema_search 搜索相关表/资源：',
          '   - 返回结果包含 sourceCode 字段，标识数据来源',
          '   - 不同数据源返回不同资源标识（见下方映射表）',
          '',
          '3. 【根据 sourceCode 选择工具】：',
          '   | sourceCode      | 资源标识字段   | 查询工具                    |',
          '   |-----------------|---------------|----------------------------|',
          '   | main-mongo      | collectionName | data_source_query          |',
          '   | super-party     | collectionName | super_party_query          |',
          '   | feishu-bitable  | tableId        | feishu_bitable_list_records|',
          '',
          '4. 【多数据源确认】若 schema_search 返回多个不同 sourceCode 的结果，',
          '   请与用户确认使用哪个数据源，不要自行选择。',
          '',
          '5. 【构建查询】严格依据 schema 字段构建查询，不得编造字段。',
          '   - 飞书日期字段：使用 YYYY-MM-DD 字符串格式，系统自动转换',
          '   - 飞书日期操作符：仅支持 is/isNot/isGreater/isLess/isEmpty/isNotEmpty',
          '',
          '6. 【保存经验】仅在本次未通过 search_thought 找到可复用思维链时，才调用 generate_thought 保存本次 schema 经验：',
          '   - 请先检查最近一次 search_thought 的返回字段 shouldGenerateThought：仅当其为 true 时，才允许调用 generate_thought。',
          '   - 调用 generate_thought 时，必须显式传入 allowGenerate=true；若 shouldGenerateThought 为 false，则不得调用该工具。',
          '   - content: 重点记录“查询所依赖的 schema 信息”，而不是详细的查询步骤：',
          '     · 使用的数据源及 sourceCode（例如 main-mongo / super-party / feishu-bitable）',
          '     · 具体使用的表/集合/多维表格（schema 名称、collectionName 或 tableId）',
          '     · 关键字段及其含义（用于过滤、分组、排序、聚合的字段），用自然语言解释清楚',
          '     · 与本次问题强相关的典型查询条件（where/filter 的核心条件），以及这些条件对应的自然语言含义',
          '     · 不需要描述具体“如何调用工具”或“查询执行步骤”，只需让下次看这条思维链的人可以立刻知道应该用哪个 schema、哪些字段、配合哪些条件来完成类似问题',
          '   - 建议将上述信息组织为结构化 JSON 对象字符串，字段示例：dataSource、sourceCode、schemaName、collectionName/tableId、fields、filters、toolsUsed、category 等。',
          '   - toolsUsed: 使用的工具名列表（例如 schema_search、data_source_query、super_party_query、feishu_bitable_list_records 等）',
          '   - category: 建议使用 "schema-knowledge" 或其他能表达该思维链适用场景的分类标签',
          '   - 如果当前调用中 search_thought 返回了结果，则不得调用 generate_thought，只需在回答中引用该历史思维链内容',
          '',
          '【约束】',
          '- 默认 limit = 50，最大 200',
          '- 避免不必要的多轮工具调用',
          '',
          `当前请求时间(ISO): ${resolvedNow}`,
          `客户端IP: ${resolvedIp}`,
          '',
          '【输出格式】',
          JSON.stringify(jsonSchema, null, 2),
        ].join('\n');

        const messages: BaseMessage[] = [
          ...(context ?? []),
          ...this.agent.toMessages([{ role: 'user', content: question }]),
        ];

        // 使用所有数据源工具
        const tools = this.getAllDataSourceTools();

        const cfg = {
          provider: provider ?? 'deepseek',
          model: model ?? 'deepseek-chat',
          noPostHook: true,
          temperature: 0.1,
          tools,
          system: sys,
        };

        let finalContent = '';
        try {
          if (streamWriter) streamWriter('Searching related schemas...');
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          let threadId: string = config.context['threadId'] ?? 'analysis';
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          let checkpointId: string = config.context['checkpointId'] ?? 'root';
          if (config && typeof config === 'object') {
            const cfgObj = config as Record<string, unknown>;
            const configurable = cfgObj['configurable'];
            if (configurable && typeof configurable === 'object') {
              const t = (configurable as Record<string, unknown>)['thread_id'];
              const c = (configurable as Record<string, unknown>)[
                'checkpoint_id'
              ];
              if (typeof t === 'string') threadId = t;
              if (typeof c === 'string') checkpointId = c;
            }
            const t2 = cfgObj['thread_id'];
            if (typeof t2 === 'string') threadId = t2;
          }
          const ai = await this.agent.runWithMessages({
            config: {
              ...cfg,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              context: config.context,
            },
            messages,
            callOption: {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: 'analysis',
                checkpoint_id: checkpointId,
              },
            },
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
          'Data Analysis & Retrieval Tool. Call this tool whenever the user asks for data, statistics, specific records, or database information. Supports multiple data sources: main database (AI system) and super-party (mini program). It AUTOMATICALLY infers schemas and executes queries.',
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
            .describe('Preferred max rows (default 50, max 200)'),
          provider: z.enum(['gemini', 'deepseek']).optional(),
          model: z.string().optional(),
          ip: z.string().optional().describe('Client IP address'),
          now: z.string().optional().describe('Current time in ISO string'),
        }),
      },
    );

    return [dataAnalysis];
  }
}
