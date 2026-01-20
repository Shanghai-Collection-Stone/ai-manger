import { Injectable } from '@nestjs/common';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { TextFormatService } from '../../format/services/format.service.js';
import { CreateAgentParams, tool } from 'langchain';
import * as z from 'zod';
import { ZPageResult, PageResult } from '../types/frontend.types.js';
import { BaseMessage } from 'langchain';

/**
 * @title 前端页Agent服务 Frontend Page Agent Service
 * @description 使用LangChain约束输出结构，生成图表、表格与富Markdown。
 * @keywords-cn 前端Agent, 页面生成, 图表, 表格, Markdown
 * @keywords-en frontend agent, page generation, chart, table, markdown
 */
@Injectable()
export class FrontendAgentService {
  constructor(
    private readonly agent: AgentService,
    private readonly format: TextFormatService,
  ) {}

  /**
   * @title 获取函数句柄 Get Handle
   * @description 返回服务的FunctionCall描述。
   * @keywords-cn 句柄, 函数调用
   * @keywords-en handle, function-call
   */
  getHandle(): CreateAgentParams['tools'] {
    const generatePageTool = tool(
      async ({ provider, model, temperature, history, input }) => {
        const msgs: BaseMessage[] = this.agent.toMessages(
          (history ?? []).map(
            (h: {
              role: 'system' | 'user' | 'assistant';
              content: string;
            }) => ({
              role: h.role,
              content: h.content,
            }),
          ),
        );
        const result = await this.generatePage({
          provider,
          model,
          temperature,
          history: msgs,
          input,
        });
        return result;
      },
      {
        name: 'frontend_generate_page',
        description:
          'Frontend Generator. Call this tool when the user needs visualization, charts, tables, reports, or a structured page display.',
        schema: z.object({
          provider: z
            .enum(['gemini', 'deepseek'])
            .optional()
            .describe('Model provider'),
          model: z.string().optional().describe('Model name'),
          temperature: z.number().optional().describe('Sampling temperature'),
          history: z
            .array(
              z.object({
                role: z.enum(['system', 'user', 'assistant']),
                content: z.string(),
              }),
            )
            .describe('Chat history messages'),
          input: z.string().describe('User requirement for page generation'),
        }),
      },
    );
    return [generatePageTool];
  }

  /**
   * @title 生成页面 Generate Page
   * @description 生成包含图表、表格与富Markdown的页面结构。
   * @keywords-cn 页面生成, 结构化输出
   * @keywords-en page generation, structured output
   */
  async generatePage(params: {
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature?: number;
    history: BaseMessage[];
    input: string;
  }): Promise<PageResult> {
    const sys =
      '你是一个前端页面生成Agent。请严格返回JSON对象，符合ZPageResult的结构，包含elements数组，元素可以是chart/table/markdown三种。Markdown支持表格与复杂元素。禁止返回除JSON外的任何字符。';
    const config = {
      provider: params.provider ?? 'deepseek',
      model: params.model ?? 'deepseek-chat',
      temperature: params.temperature ?? 0.1,
      system: sys,
      contextSchema:
        ZPageResult as unknown as CreateAgentParams['contextSchema'],
    };
    const messages: BaseMessage[] = [
      ...this.agent.toMessages([{ role: 'system', content: sys }]),
      ...params.history,
      ...this.agent.toMessages([{ role: 'user', content: params.input }]),
    ];
    const ai = await this.agent.runWithMessages({ config, messages });
    const text = (ai as unknown as { content: unknown }).content;
    const raw0 = typeof text === 'string' ? text : JSON.stringify(text);
    const raw = this.format.normalizeJsonText(raw0);
    let obj: unknown;
    try {
      obj = JSON.parse(raw) as unknown;
    } catch (e) {
      throw e as Error;
    }
    const parsed = ZPageResult.safeParse(obj);
    if (!parsed.success) {
      throw new Error('Invalid page result');
    }
    return parsed.data;
  }
}
