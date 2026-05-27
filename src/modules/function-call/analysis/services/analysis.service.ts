import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import vm from 'node:vm';
import { SchemaFunctionCallService } from '../../schema/services/schema.service.js';
import { DataSourceSearchToolsService } from '../../../data-source/tools/data-source-search.tools.js';
import { SuperPartySourceToolsService } from '../../../data-source/sources/super-party/super-party-source.tools.js';
import { FeishuBitableSourceToolsService } from '../../../data-source/sources/feishu-bitable/feishu-bitable-source.tools.js';
import { SkillThoughtToolsService } from '../../../skill-thought/tools/skill-thought.tools.js';
import { DecisionCardService } from '../../../decision-card/services/decision-card.service.js';

/**
 * @title 数据分析函数服务 Data Analysis Function Service
 * @description 集中管理所有数据源的分析工具，集成思维链学习。
 * @keywords-cn 数据分析, 最小查询, Schema, 数据源, 思维链
 * @keywords-en data analysis, minimal query, schema, data source, skill thought
 */
@Injectable()
export class AnalysisFunctionCallService {
  constructor(
    private readonly schemaTools: SchemaFunctionCallService,
    private readonly dataSourceTools: DataSourceSearchToolsService,
    private readonly superPartyTools: SuperPartySourceToolsService,
    private readonly feishuBitableTools: FeishuBitableSourceToolsService,
    private readonly skillThoughtTools: SkillThoughtToolsService,
    private readonly decisionCards: DecisionCardService,
  ) {}

  private getCalculatorTools(): CreateAgentParams['tools'] {
    const jsCalc = tool(
      ({ expression, precision }) => {
        if (
          !expression ||
          typeof expression !== 'string' ||
          expression.trim().length === 0
        ) {
          return JSON.stringify({
            ok: false,
            error: 'EXPRESSION_REQUIRED',
            message: 'expression 参数必填，需要传入数学表达式字符串',
          });
        }
        try {
          const value = this.evaluateMathExpression(expression);
          const normalized =
            typeof precision === 'number' && Number.isFinite(precision)
              ? Number(
                  value.toFixed(
                    Math.max(0, Math.min(12, Math.floor(precision))),
                  ),
                )
              : value;
          return JSON.stringify({
            ok: true,
            expression,
            result: normalized,
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            expression,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        name: 'js_calc',
        description:
          'Evaluate one JavaScript math expression for precise arithmetic. Use this instead of mental math.',
        schema: z.object({
          expression: z
            .string()
            .min(1)
            .optional()
            .describe(
              'JavaScript math expression. Supports + - * / % () and Math.* functions, e.g. "(1200*0.18)+300" (required).',
            ),
          precision: z
            .number()
            .optional()
            .describe('Optional decimal precision (0-12) for rounded result'),
        }),
      },
    );

    const jsCalcBatch = tool(
      ({ expressions, precision }) => {
        if (!Array.isArray(expressions) || expressions.length === 0) {
          return JSON.stringify({
            ok: false,
            error: 'EXPRESSIONS_REQUIRED',
            message: 'expressions 参数必填，需要传入非空数组',
          });
        }
        const results = expressions.map((expr) => {
          try {
            const value = this.evaluateMathExpression(expr);
            const normalized =
              typeof precision === 'number' && Number.isFinite(precision)
                ? Number(
                    value.toFixed(
                      Math.max(0, Math.min(12, Math.floor(precision))),
                    ),
                  )
                : value;
            return { expression: expr, ok: true, result: normalized };
          } catch (error) {
            return {
              expression: expr,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        });
        return JSON.stringify({
          ok: results.every((x) => x.ok),
          results,
        });
      },
      {
        name: 'js_calc_batch',
        description:
          'Evaluate multiple JavaScript math expressions in one call. Use for grouped calculations.',
        schema: z.object({
          expressions: z
            .array(z.string().min(1))
            .min(1)
            .max(50)
            .optional()
            .describe(
              'List of JavaScript math expressions (required, 1-50 items)',
            ),
          precision: z
            .number()
            .optional()
            .describe('Optional decimal precision (0-12) for rounded result'),
        }),
      },
    );

    return [jsCalc, jsCalcBatch];
  }

  private evaluateMathExpression(expression: string): number {
    const expr = String(expression ?? '').trim();
    if (!expr) throw new Error('EXPRESSION_EMPTY');
    if (expr.length > 500) throw new Error('EXPRESSION_TOO_LONG');
    if (!/^[0-9+\-*/%().,\sA-Za-z_]+$/.test(expr)) {
      throw new Error('EXPRESSION_HAS_ILLEGAL_CHARACTERS');
    }
    const tokens = expr.match(/[A-Za-z_]\w*/g) ?? [];
    const allow = new Set(['Math']);
    for (const tk of tokens) {
      if (!allow.has(tk))
        throw new Error(`EXPRESSION_IDENTIFIER_NOT_ALLOWED:${tk}`);
    }
    const script = new vm.Script(`(${expr})`);
    const context = vm.createContext({ Math });
    const output: unknown = script.runInContext(context, { timeout: 300 });
    if (typeof output !== 'number' || !Number.isFinite(output)) {
      throw new Error('EXPRESSION_RESULT_NOT_FINITE_NUMBER');
    }
    return output;
  }

  /**
   * @title 获取所有数据源工具 Get All Data Source Tools
   * @description 返回所有数据源相关的工具列表（含思维链工具），用于 Agent 调用。
   * @keywords-en data source tools, aggregation
   */
  getAllDataSourceTools(scope?: {
    tenantId?: string;
    userId?: string;
  }): CreateAgentParams['tools'] {
    const decisionCardGenerate = tool(
      async ({ question, analysisData, capabilityBrief, sessionId }) => {
        console.log('[decision_card_generate] Called with:', {
          question,
          analysisData,
          capabilityBrief,
          sessionId,
          tenantId: scope?.tenantId,
        });
        try {
          if (!this.shouldGenerateDecisionCard(question)) {
            console.log(
              '[decision_card_generate] Skipped - not a decision intent',
            );
            return JSON.stringify({
              generated: false,
              reason: 'DECISION_INTENT_NOT_MATCHED',
            });
          }
          const res = await this.decisionCards.generateDecisionCard({
            sessionId:
              typeof sessionId === 'string' && sessionId.trim().length > 0
                ? sessionId.trim()
                : 'analysis',
            question: question.trim(),
            analysisData:
              typeof analysisData === 'string'
                ? analysisData.trim()
                : undefined,
            capabilityBrief:
              typeof capabilityBrief === 'string'
                ? capabilityBrief.trim()
                : undefined,
            tenantId: scope?.tenantId,
            userId: scope?.userId,
          });
          console.log('[decision_card_generate] Success:', {
            cardId: res.cardId,
            summary: res.decisionSummary,
          });
          return JSON.stringify({
            generated: true,
            cardId: res.cardId,
            decisionSummary: res.decisionSummary,
            cardRenderPayload: res.cardRenderPayload,
          });
        } catch (err) {
          console.error('[decision_card_generate] Error:', err);
          return JSON.stringify({
            generated: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      {
        name: 'decision_card_generate',
        description:
          'Generate and persist a decision card when user asks strategy/plan/data-driven decision.',
        schema: z.object({
          question: z
            .string()
            .min(2)
            .describe('Original user question for decision context'),
          analysisData: z
            .string()
            .optional()
            .describe('Existing analysis output used as decision evidence'),
          capabilityBrief: z
            .string()
            .optional()
            .describe(
              'Current available capability summary for decision making',
            ),
          sessionId: z
            .string()
            .optional()
            .describe('Current chat session id for persistence'),
        }),
      },
    );

    const tools: CreateAgentParams['tools'] = [
      ...(this.getCalculatorTools() ?? []),
      ...(this.skillThoughtTools.getHandle(scope) ?? []),
      // Schema 搜索工具
      ...(this.schemaTools.getHandle(scope) ?? []),
      // 各数据源查询工具
      ...(this.dataSourceTools.getHandle(scope) ?? []),
      ...(this.superPartyTools.getHandle() ?? []),
      ...(this.feishuBitableTools.getTools() ?? []),
      decisionCardGenerate,
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
   * @description 原数据分析工具已变更为 subagent 原生调度。不再返回 data_analysis 工具。
   * @keywords-cn 函数调用, 句柄, 工具
   * @keywords-en function call, handle, tools
   * @returns 空数组
   */
  getHandle(): CreateAgentParams['tools'] {
    return this.getCalculatorTools();
  }

  /**
   * @description 判断是否应生成决策卡
   * @keyword-en decide whether generate decision card
   */
  private shouldGenerateDecisionCard(question: string): boolean {
    const text = String(question || '').trim();
    if (!text) return false;
    return /方案|决策|策略|建议|计划|怎么做|如何|路径|评估|取舍|优先级|优化|改进|action/i.test(
      text,
    );
  }
}
