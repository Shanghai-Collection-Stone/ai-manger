import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Collection, Db, ObjectId } from 'mongodb';
import { BaseMessage } from 'langchain';
import * as z from 'zod';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { DecisionCardEntity } from '../entities/decision-card.entity.js';
import { TodoService } from '../../todo/services/todo.service.js';
import { RobotRegistryService } from '../../auto-task-robot/services/robot-registry.service.js';

/**
 * @description 决策卡服务
 * @keyword-en decision card service
 */
@Injectable()
export class DecisionCardService {
  private readonly cards: Collection<DecisionCardEntity>;

  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly agent: AgentService,
    private readonly adminService: AdminService,
    private readonly todoService: TodoService,
    private readonly robots: RobotRegistryService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.cards = db.collection<DecisionCardEntity>('decision_cards');
    void this.ensureIndexes();
  }

  /**
   * @description 生成并保存决策卡
   * @keyword-en generate and persist decision card
   */
  async generateDecisionCard(input: {
    sessionId: string;
    question: string;
    analysisData?: string;
    capabilityBrief?: string;
    tenantId?: string;
    userId?: string;
  }): Promise<{
    cardId: string;
    decisionSummary: string;
    cardRenderPayload: Record<string, unknown>;
  }> {
    const normalizedQuestion = String(input.question || '').trim();
    const duplicated = await this.findRecentDuplicateDecision({
      sessionId: input.sessionId,
      question: normalizedQuestion,
      tenantId: input.tenantId,
      userId: input.userId,
      withinMs: 45 * 1000,
    });
    if (duplicated) {
      const cardId = String(duplicated._id);
      return {
        cardId,
        decisionSummary: duplicated.summary,
        cardRenderPayload: this.buildCardRenderPayload(duplicated),
      };
    }

    const runtime = await this.resolveDecisionRuntime();
    const capabilityBrief = this.buildCapabilityBrief(input.capabilityBrief);
    const hasXhsIntent = /小红书|xhs|发布|发文|种草/i.test(normalizedQuestion);
    const sys = [
      '你是业务决策引擎，负责基于当前数据与当前能力组合生成可执行决策。',
      '必须输出 JSON 对象，不要输出其他文本。',
      'JSON字段：title(string), summary(string), reasoning(string[]), options(string[]), recommendation(string), risks(string[]), actions(string[])。',
      'summary 要简洁，适合主对话直接提示用户“决策已生成”。',
      'recommendation 必须是完整建议，不得使用“已基于当前数据与能力生成决策建议，请查看决策卡。”这类空洞文案。',
      'recommendation 需要包含：关键判断、执行方向、阶段目标、可量化指标（至少1个）。',
      'reasoning/options/actions/risks 每个数组至少返回2条，内容要具体可执行。',
      'actions 必须体现“AI下一步要做的具体操作”，每条动作包含：操作对象、使用能力/工具、负责人、完成标准。',
      'actions 至少一条要体现任务分配（例如使用 todo_create 创建并指派线下执行人员任务）。',
      'actions 中涉及能力时，必须只写中文能力名；禁止出现工具函数名、robot:xxx、下划线英文代号。',
      hasXhsIntent
        ? '若问题涉及小红书发布，actions 至少一条要体现从“示例内容生成”到“自动发布机执行”的链路。'
        : '若问题不涉及发布，可将发布链路作为备选动作，不要强制写发布执行。',
    ].join('\n');
    const payload = {
      question: normalizedQuestion,
      analysisData: input.analysisData ?? '',
      capabilityBrief,
    };
    const messages: BaseMessage[] = this.agent.toMessages([
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(payload) },
    ]);
    let parsed: {
      title?: string;
      summary?: string;
      reasoning?: string[];
      options?: string[];
      recommendation?: string;
      risks?: string[];
      actions?: string[];
    } = {};
    try {
      const ai = await this.agent.runWithMessages({
        config: {
          provider: runtime.provider,
          model: runtime.model,
          apiKey: runtime.apiKey,
          baseUrl: runtime.baseUrl,
          temperature: 0.2,
          system: sys,
        },
        messages,
      });
      const content = (ai as unknown as { content: unknown }).content;
      const raw =
        typeof content === 'string' ? content : JSON.stringify(content);
      parsed = this.parseDecisionJson(raw);
    } catch {
      parsed = {};
    }

    const now = new Date();
    const title = this.pickNonEmpty(parsed.title, '数据驱动决策建议');
    const summary = this.pickNonEmpty(
      parsed.summary,
      '已生成可执行决策，建议按阶段推进并跟踪转化、客流与复购指标。',
    );
    const reasoning = this.ensureMinimumList(
      this.normalizeStringArray(parsed.reasoning),
      this.buildFallbackReasoning(input),
    );
    const options = this.ensureMinimumList(
      this.normalizeStringArray(parsed.options),
      this.buildFallbackOptions(input),
    );
    const recommendation = this.buildDetailedRecommendation(
      input,
      summary,
      parsed.recommendation,
    );
    const risks = this.ensureMinimumList(
      this.normalizeStringArray(parsed.risks),
      this.buildFallbackRisks(),
    );
    const actions = this.ensureMinimumList(
      this.normalizeStringArray(parsed.actions),
      this.buildFallbackActions(input),
    );

    const entity: DecisionCardEntity = {
      _id: new ObjectId(),
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      question: normalizedQuestion,
      title,
      summary,
      reasoning,
      options,
      recommendation,
      risks,
      actions,
      sourceDataBrief: input.analysisData,
      capabilityBrief,
      status: 'generated',
      createdAt: now,
      updatedAt: now,
    };
    await this.cards.insertOne(entity);
    const cardId = String(entity._id);
    return {
      cardId,
      decisionSummary: summary,
      cardRenderPayload: this.buildCardRenderPayload(entity),
    };
  }

  /**
   * @description 查找短时间重复决策，防止一次请求落多条
   * @keyword-en find recent duplicate decision
   */
  private async findRecentDuplicateDecision(input: {
    sessionId: string;
    question: string;
    tenantId?: string;
    userId?: string;
    withinMs: number;
  }): Promise<DecisionCardEntity | null> {
    const since = new Date(Date.now() - Math.max(1000, input.withinMs));
    return this.cards.findOne(
      {
        sessionId: input.sessionId,
        question: input.question,
        status: 'generated',
        createdAt: { $gte: since },
        ...this.buildScopeFilter({
          tenantId: input.tenantId,
          userId: input.userId,
        }),
      },
      { sort: { createdAt: -1 } },
    );
  }

  /**
   * @description 统一构建决策卡渲染载荷
   * @keyword-en build decision card render payload
   */
  private buildCardRenderPayload(
    card: DecisionCardEntity,
  ): Record<string, unknown> {
    return {
      cardId: String(card._id),
      title: card.title,
      summary: card.summary,
      recommendation: card.recommendation,
      actions: card.actions,
      risks: card.risks,
      status: card.status,
    };
  }

  /**
   * @description 按会话读取决策卡
   * @keyword-en list decision cards by session
   */
  async listBySession(
    sessionId: string,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<DecisionCardEntity[]> {
    return this.cards
      .find({ sessionId, ...this.buildScopeFilter(scope) })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  /**
   * @description 按租户读取决策卡
   * @keyword-en list decision cards by tenant
   */
  async listByScope(scope?: {
    tenantId?: string;
    userId?: string;
  }): Promise<DecisionCardEntity[]> {
    return this.cards
      .find({ ...this.buildScopeFilter(scope) })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  /**
   * @description 读取决策卡详情
   * @keyword-en get decision card detail
   */
  async getById(
    id: string,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<DecisionCardEntity | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.cards.findOne({
      _id: new ObjectId(id),
      ...this.buildScopeFilter(scope),
    });
  }

  /**
   * @description 解析决策模型运行配置
   * @keyword-en resolve decision runtime model
   */
  private async resolveDecisionRuntime(): Promise<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }> {
    const envProvider = process.env.DECISION_PROVIDER?.trim();
    const envModel = process.env.DECISION_MODEL?.trim();
    if (envProvider && envModel) {
      return {
        provider: envProvider,
        model: envModel,
      };
    }
    const runtime = await this.adminService.getDefaultAiProviderRuntime();
    if (runtime) {
      return {
        provider: runtime.providerCode,
        model: runtime.model || 'deepseek-ai/deepseek-v3.1-terminus',
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
   * @description 构建范围过滤
   * @keyword-en build scope filter
   */
  private buildScopeFilter(scope?: {
    tenantId?: string;
    userId?: string;
  }): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (scope?.tenantId?.trim()) filter.tenantId = scope.tenantId.trim();
    return filter;
  }

  /**
   * @description 解析决策JSON
   * @keyword-en parse decision json
   */
  private parseDecisionJson(raw: string): {
    title?: string;
    summary?: string;
    reasoning?: string[];
    options?: string[];
    recommendation?: string;
    risks?: string[];
    actions?: string[];
  } {
    const text = String(raw || '').trim();
    if (!text) return {};
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      return {
        title: typeof obj['title'] === 'string' ? obj['title'] : undefined,
        summary:
          typeof obj['summary'] === 'string' ? obj['summary'] : undefined,
        reasoning: this.normalizeStringArray(obj['reasoning']),
        options: this.normalizeStringArray(obj['options']),
        recommendation:
          typeof obj['recommendation'] === 'string'
            ? obj['recommendation']
            : undefined,
        risks: this.normalizeStringArray(obj['risks']),
        actions: this.normalizeStringArray(obj['actions']),
      };
    } catch {
      const body = text.match(/\{[\s\S]*\}/)?.[0] ?? '';
      if (!body) return {};
      try {
        return this.parseDecisionJson(body);
      } catch {
        return {};
      }
    }
  }

  /**
   * @description 规范化字符串数组
   * @keyword-en normalize string array
   */
  private normalizeStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0)
      .slice(0, 12);
  }

  /**
   * @description 选择非空文本
   * @keyword-en pick non empty text
   */
  private pickNonEmpty(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return fallback;
  }

  /**
   * @description 判断是否为空洞建议文本
   * @keyword-en generic recommendation detector
   */
  private isGenericRecommendationText(text: string): boolean {
    const t = String(text || '').trim();
    if (!t) return true;
    if (t.length < 28) return true;
    return /已基于当前数据与能力生成决策建议|请查看决策卡|建议参考决策卡|暂无更多建议/i.test(
      t,
    );
  }

  /**
   * @description 构建高质量核心建议
   * @keyword-en build detailed recommendation
   */
  private buildDetailedRecommendation(
    input: {
      question: string;
      analysisData?: string;
      capabilityBrief?: string;
    },
    summary: string,
    rawRecommendation?: string,
  ): string {
    const candidate = this.pickNonEmpty(rawRecommendation, '');
    if (!this.isGenericRecommendationText(candidate)) return candidate;
    const signals = this.extractSignalLines(
      `${input.analysisData ?? ''}\n${input.capabilityBrief ?? ''}`,
      2,
    );
    const signalText =
      signals.length > 0 ? `当前关键信号：${signals.join('；')}。` : '';
    return [
      `围绕“${input.question}”，建议采用“先止跌、再优化、后放大”的三阶段策略。`,
      signalText,
      '第一阶段（1-2周）聚焦低成本拉新与高意向客群触达，目标是将到店客流环比提升8%-12%。',
      '第二阶段（2-4周）优化导购转化与商品动线，目标是进店转化率提升3-5个百分点。',
      '第三阶段（4-8周）做复购与会员运营，目标是复购率提升10%以上，并将单客价值稳定抬升。',
      `执行总原则：${summary}`,
    ]
      .filter((x) => x.trim().length > 0)
      .join('');
  }

  /**
   * @description 提取关键信号行
   * @keyword-en extract signal lines
   */
  private extractSignalLines(text: string, limit: number): string[] {
    const rows = String(text || '')
      .split(/\r?\n|；|;/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 6);
    return rows.slice(0, Math.max(0, limit));
  }

  /**
   * @description 保证数组最少两条
   * @keyword-en ensure minimum list length
   */
  private ensureMinimumList(source: string[], fallback: string[]): string[] {
    const s = Array.isArray(source)
      ? source.filter((x) => x.trim().length > 0)
      : [];
    if (s.length >= 2) return s.slice(0, 12);
    const merged = [...s, ...fallback].filter((x) => x.trim().length > 0);
    return Array.from(new Set(merged)).slice(0, 12);
  }

  /**
   * @description 构建依据兜底项
   * @keyword-en fallback reasoning builder
   */
  private buildFallbackReasoning(input: {
    question: string;
    analysisData?: string;
    capabilityBrief?: string;
  }): string[] {
    const signals = this.extractSignalLines(input.analysisData ?? '', 1);
    return [
      signals.length > 0
        ? `数据侧已出现异常信号：${signals[0]}`
        : `当前问题“${input.question}”已触发经营优化需求。`,
      '现有能力支持按渠道与时间维度跟踪效果，可进行闭环验证。',
    ];
  }

  /**
   * @description 构建方案兜底项
   * @keyword-en fallback options builder
   */
  private buildFallbackOptions(input: { capabilityBrief?: string }): string[] {
    const hasTrack = String(input.capabilityBrief || '').trim().length > 0;
    return [
      '方案A：短期促活拉新，快速提升到店客流与活动触达。',
      hasTrack
        ? '方案B：围绕可追踪渠道做精细化投放，持续优化转化成本。'
        : '方案B：建立日/周监控面板后再推进精细化投放。',
    ];
  }

  /**
   * @description 构建风险兜底项
   * @keyword-en fallback risks builder
   */
  private buildFallbackRisks(): string[] {
    return [
      '过度依赖单一促销手段，可能带来短期波动后回落。',
      '未建立指标复盘机制，会导致策略无法持续优化。',
    ];
  }

  /**
   * @description 构建动作兜底项
   * @keyword-en fallback actions builder
   */
  private buildFallbackActions(input: {
    question: string;
    capabilityBrief?: string;
  }): string[] {
    const hasXhsIntent = /小红书|xhs|发布|发文|种草/i.test(
      String(input.question),
    );
    return [
      `创建执行总任务：围绕“${input.question}”拆分周计划，明确客流、转化、复购三类目标值，并生成主任务。`,
      '分配线下执行任务：为门店负责人创建“物料准备/活动执行/到店转化复盘”任务，明确负责人和截止时间。',
      hasXhsIntent
        ? '发布链路执行：先做示例内容生成，再指派小红书发布机执行发布并跟踪结果。'
        : '建立监控复盘任务：创建“日报监控+周复盘”任务，连续4周跟踪关键指标变化并调整策略。',
    ];
  }

  private buildCapabilityBrief(input?: string): string {
    const robots = this.robots.listRobots();
    const robotLines =
      robots.length > 0
        ? robots
            .map(
              (r, i) => `${i + 1}) ${r.name}：${r.description}`,
            )
            .join('\n')
        : '（当前无自动机器人）';
    const base = [
      '可用能力清单（仅输出中文能力名）：',
      'A) 内容生成：示例文章生成（可产出 Canvas）',
      'B) 任务管理：待办创建/更新/分配/跟踪（可指派到人或自动化代理）',
      'C) 自动机器人：',
      robotLines,
      'D) 数据分析：数据分析子代理（查询/统计/复盘，必要时使用）',
      'E) 计算能力：精确计算器（用于复杂/批量计算）',
      '约束：小红书发布必须基于 Canvas；若要批量发布，先有 CanvasId，再指派小红书发布机执行。',
    ].join('\n');
    const extra = this.localizeCapabilityText(String(input || '').trim());
    if (!extra) return base;
    return `${base}\n补充能力信息：\n${extra}`;
  }

  private localizeCapabilityText(text: string): string {
    let out = String(text ?? '').trim();
    if (!out) return '';
    const replacements: Array<[RegExp, string]> = [
      [/\btopic_orchestrate\b/gi, '示例文章生成'],
      [/\brobot:xhs_publisher\b/gi, '小红书发布机'],
      [/\btodo_create\b/gi, '待办创建'],
      [/\btodo_update\b/gi, '待办更新'],
      [/\btodo_list\b/gi, '待办查询'],
      [/\banalysis_subagent\b/gi, '数据分析子代理'],
      [/\bjs_calc_batch\b/gi, '批量精确计算'],
      [/\bjs_calc\b/gi, '精确计算'],
      [/\bcanvas_execute\b/gi, '执行画布发布流程'],
      [/\bxhs_batch_publish\b/gi, '小红书批量发布'],
      [/\bgallery_search_images\b/gi, '图库按标签搜图'],
      [/\bgallery_list_tags\b/gi, '图库标签查询'],
      [/\bdashboard_mongo_search\b/gi, '看板万用查询'],
      [/\bdashboard_config_view\b/gi, '查看看板配置'],
      [/\bdashboard_config_patch\b/gi, '更新看板配置'],
      [/\btenant_query\b/gi, '租户数据查询'],
      [/\btenant_tables\b/gi, '租户表结构查询'],
    ];
    for (const [pattern, value] of replacements) {
      out = out.replace(pattern, value);
    }
    return out;
  }

  /**
   * @description 初始化索引
   * @keyword-en ensure decision card indexes
   */
  private async ensureIndexes(): Promise<void> {
    await this.cards.createIndex({ sessionId: 1, updatedAt: -1 });
    await this.cards.createIndex({ tenantId: 1, userId: 1, updatedAt: -1 });
    await this.cards.createIndex({ status: 1, updatedAt: -1 });
  }

  /**
   * @description 应用决策，生成对应的待办任务
   * @keyword-en apply decision and generate todo
   */
  async applyDecision(
    cardId: string,
    scope?: { tenantId?: string; userId?: string },
  ): Promise<{
    success: boolean;
    todoId?: number;
    todoIds?: number[];
    robotTriggers?: Array<{
      todoId: number;
      triggered: boolean;
      robotCode?: string;
      error?: string;
    }>;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    const isProd = process.env.NODE_ENV === 'production';
    const trunc = (s: unknown, max = 2400): string => {
      const raw = typeof s === 'string' ? s : JSON.stringify(s ?? '');
      const t = raw.length > max ? raw.slice(0, max) + '…' : raw;
      return t;
    };
    const capture = (
      stage: string,
      err: unknown,
      extra?: Record<string, unknown>,
    ) => {
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        stage,
        name: e.name,
        message: e.message,
        ...(isProd ? {} : { stack: e.stack }),
        ...(extra ?? {}),
      };
    };
    const failures: Array<Record<string, unknown>> = [];

    const card = await this.getById(cardId, scope);
    if (!card) {
      return { success: false, error: '决策卡不存在' };
    }
    if (card.status !== 'generated') {
      return { success: false, error: '该决策已被应用或已归档' };
    }
    const userId = scope?.userId ?? card.userId;
    if (!userId) {
      return { success: false, error: 'AUTH_REQUIRED' };
    }
    const hasXhsIntent = /小红书|xhs|发布|发文|种草/i.test(
      String(card.question),
    );

    const canvasFromCard = this.extractCanvasIdFromText(
      [card.title, card.summary, card.recommendation, ...(card.actions ?? [])]
        .filter(Boolean)
        .join('\n'),
    );
    let canvasId = canvasFromCard;
    const publishCount = this.extractCountFromText(card.question) ?? 3;
    if (hasXhsIntent && !canvasId) {
      const graphUnknown: unknown = this.moduleRef.get(
        'ARTICLE_GRAPH_SERVICE',
        {
          strict: false,
        },
      );
      const graph =
        graphUnknown && typeof graphUnknown === 'object'
          ? (graphUnknown as {
              generateToCanvas?: (input: {
                userId: string;
                tenantId?: string;
                platform?: string;
                topic?: string;
                count?: number;
                galleryUserId?: string;
                galleryGroupId?: number;
                minImageScore?: number;
              }) => Promise<Record<string, unknown>>;
            })
          : undefined;
      if (typeof graph?.generateToCanvas === 'function') {
        try {
          const topic = this.extractTopicFromText(card.question);
          const gen = await graph.generateToCanvas({
            userId,
            tenantId: scope?.tenantId,
            platform: 'xhs',
            topic,
            count: Math.max(1, Math.min(5, publishCount)),
          });
          const genObj: Record<string, unknown> =
            gen && typeof gen === 'object' ? gen : {};
          const cid = Number(genObj['canvasId']);
          if (Number.isFinite(cid) && cid > 0) canvasId = Math.floor(cid);
        } catch (e) {
          failures.push(capture('canvas_generate', e));
        }
      }
    }

    const runtime = await this.resolveDecisionRuntime();
    const capabilityBrief = this.buildCapabilityBrief(card.capabilityBrief);
    const robots = this.robots.listRobots();
    const robotHints = robots
      .map((r) => `robot:${r.code}（${r.name}）`)
      .join('、');

    const ZTodoOutlinePlan = z.object({
      tasks: z
        .array(
          z.object({
            title: z.string().min(2).max(60),
            description: z.string().max(220).optional(),
            aiConsideration: z.string().min(20).max(400),
            decisionReason: z.string().min(20).max(400),
            assignee: z.string().optional(),
            type: z.string().optional(),
            detailHint: z.string().min(20).max(220),
          }),
        )
        .min(3)
        .max(8),
    });

    const ZTodoDetail = z.object({
      goalAndScope: z.string().min(20).max(800),
      prerequisites: z.array(z.string().min(1).max(160)).min(1).max(10),
      materials: z.array(z.string().min(1).max(160)).min(1).max(20),
      steps: z.array(z.string().min(1).max(200)).min(6).max(14),
      deliverables: z.array(z.string().min(1).max(160)).min(1).max(12),
      acceptanceCriteria: z.array(z.string().min(1).max(220)).min(3).max(12),
      dataAndReview: z.array(z.string().min(1).max(220)).min(1).max(12),
    });

    const sysOutline = [
      '你是任务规划引擎（第1步：生成任务大纲）。',
      '必须输出 JSON，不要输出其他文本。',
      '输出 schema：{ "tasks": [{ "title": string, "description"?: string, "aiConsideration": string, "decisionReason": string, "assignee"?: string, "type"?: string, "detailHint": string }] }。',
      '至少 3 条任务：1条总控 + 每条决策 action 至少 1 条。',
      'detailHint 要写“这个任务需要哪些具体物料/步骤/表格字段/会议安排”，但要短（<=220字），避免长文本。',
      hasXhsIntent
        ? [
            '若涉及小红书发布：必须包含一条“发布执行任务”，assignee=robot:xhs_publisher。',
            canvasId
              ? `发布执行任务必须包含 Canvas#${canvasId}。`
              : '发布执行任务必须包含 Canvas#<id>（若缺失则先生成）。',
            `发布执行任务必须包含“发布数量: ${publishCount} 篇”。`,
          ].join('\n')
        : undefined,
      robotHints.length > 0
        ? `可用机器人：${robotHints}。适合机器人执行的任务请设置 assignee 为对应 robot:code。`
        : undefined,
      `可用能力信息：\n${capabilityBrief}`,
    ]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n');

    const sysDetail = [
      '你是任务规划引擎（第2步：为单条任务生成执行细节）。',
      '必须输出 JSON，不要输出其他文本。',
      '输出 schema：{ "goalAndScope": string, "prerequisites": string[], "materials": string[], "steps": string[], "deliverables": string[], "acceptanceCriteria": string[], "dataAndReview": string[] }',
      '必须具体，禁止空泛表达；materials 要具体到“海报尺寸/文案/二维码/话术/表格字段”等。',
      'steps 至少 6 步，每步必须包含负责人（人/robot）与截止时间建议（例如 Day1/本周五 18:00）。',
      '所有数组元素必须是一行文本，不能包含换行符（\\n）。',
      '如果任务涉及“监控/日报/周报/复盘”：必须写明监控口径、数据来源、表格字段、日报发送节奏、周复盘会议安排（参与人/议程/产出行动项）。',
    ].join('\n');
    const payload = {
      question: card.question,
      title: card.title,
      recommendation: card.recommendation,
      actions: card.actions,
      risks: card.risks,
      summary: card.summary,
      constraints: {
        canvasId: canvasId ?? null,
        publishCount: publishCount,
      },
    };
    let llm: Awaited<ReturnType<AgentService['buildLLM']>>;
    try {
      llm = await this.agent.buildLLM({
        provider: runtime.provider,
        model: runtime.model,
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        temperature: 0.1,
        nonStreaming: true,
        system: undefined,
      });
    } catch (e) {
      failures.push(capture('build_llm', e));
      return {
        success: false,
        error: '生成待办任务失败',
        details: { failures },
      };
    }

    let outlinePlan = ZTodoOutlinePlan.safeParse(undefined);
    let lastRaw = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const payloadFix =
          attempt === 0
            ? {
                task: 'Generate task outline',
                required: {
                  schema:
                    '{ "tasks": [{ "title": string, "description"?: string, "aiConsideration": string, "decisionReason": string, "assignee"?: string, "type"?: string, "detailHint": string }] }',
                  must: [
                    'Only output JSON object',
                    'Output must be a JSON object with key "tasks" (array)',
                    'All fields must match schema types',
                    'detailHint must be short but specific',
                  ],
                },
                original: payload,
              }
            : {
                task: 'Fix previous output to match schema',
                previousOutput: lastRaw,
                required: {
                  schema:
                    '{ "tasks": [{ "title": string, "description"?: string, "aiConsideration": string, "decisionReason": string, "assignee"?: string, "type"?: string, "detailHint": string }] }',
                  must: [
                    'Only output JSON object',
                    'Output must be a JSON object with key "tasks" (array)',
                    'All fields must match schema types',
                    'detailHint must be short but specific',
                  ],
                },
                original: payload,
              };
        const ai = await llm.invoke([
          ...this.agent.toMessages([{ role: 'system', content: sysOutline }]),
          ...this.agent.toMessages([
            { role: 'user', content: JSON.stringify(payloadFix) },
          ]),
        ]);
        const content = (ai as unknown as { content?: unknown }).content;
        const extracted = this.extractTextFromModelContent(content);
        lastRaw =
          extracted ||
          (typeof content === 'string'
            ? content
            : JSON.stringify(content ?? ''));
        let parsed: unknown = this.parseJsonFromModelText(lastRaw);
        if (Array.isArray(parsed)) parsed = { tasks: parsed };
        outlinePlan = ZTodoOutlinePlan.safeParse(parsed);
        if (outlinePlan.success) break;
      } catch (e) {
        failures.push(
          capture('task_plan_text', e, {
            attempt,
            lastRaw: lastRaw ? trunc(lastRaw) : undefined,
          }),
        );
      }
    }
    if (!outlinePlan.success) {
      failures.push(
        capture('task_outline_validate', 'TASK_OUTLINE_INVALID', {
          lastRaw: lastRaw ? trunc(lastRaw) : undefined,
          zodIssues: outlinePlan.error?.issues?.slice(0, 20),
        }),
      );
      return {
        success: false,
        error: '生成待办任务失败',
        details: { failures },
      };
    }

    const outlineTasks = outlinePlan.data.tasks;
    const detailedTasksResults = await Promise.all(
      outlineTasks.map(async (t) => {
        let detail = ZTodoDetail.safeParse(undefined);
        let lastDetailRaw = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const must = this.buildDetailMust(t.title, t.type, {
              hasXhsIntent,
              canvasId,
              publishCount,
            });
            const userPayload =
              attempt === 0
                ? {
                    task: {
                      title: t.title,
                      description: t.description,
                      assignee: t.assignee,
                      type: t.type,
                      detailHint: t.detailHint,
                    },
                    context: {
                      decision: payload,
                      allTasks: outlineTasks.map((x) => ({
                        title: x.title,
                        assignee: x.assignee,
                        type: x.type,
                        detailHint: x.detailHint,
                      })),
                    },
                    required: { must },
                  }
                : {
                    task: {
                      title: t.title,
                      description: t.description,
                      assignee: t.assignee,
                      type: t.type,
                      detailHint: t.detailHint,
                    },
                    context: {
                      decision: payload,
                      allTasks: outlineTasks.map((x) => ({
                        title: x.title,
                        assignee: x.assignee,
                        type: x.type,
                        detailHint: x.detailHint,
                      })),
                    },
                    previousOutput: lastDetailRaw,
                    required: {
                      schema:
                        '{ "goalAndScope": string, "prerequisites": string[], "materials": string[], "steps": string[], "deliverables": string[], "acceptanceCriteria": string[], "dataAndReview": string[] }',
                      must: [
                        'Only output JSON object',
                        'All fields must match schema types',
                        'No newline characters in array items',
                        'steps length >= 6',
                        ...must,
                      ],
                    },
                  };
            const ai = await llm.invoke([
              ...this.agent.toMessages([
                { role: 'system', content: sysDetail },
              ]),
              ...this.agent.toMessages([
                { role: 'user', content: JSON.stringify(userPayload) },
              ]),
            ]);
            const content = (ai as unknown as { content?: unknown }).content;
            const extracted = this.extractTextFromModelContent(content);
            lastDetailRaw =
              extracted ||
              (typeof content === 'string'
                ? content
                : JSON.stringify(content ?? ''));
            const parsed = this.parseJsonFromModelText(lastDetailRaw);
            detail = ZTodoDetail.safeParse(parsed);
            if (detail.success) {
              if (this.isDetailSpecificEnough(t.title, detail.data)) break;
              detail = ZTodoDetail.safeParse(undefined);
            }
          } catch (e) {
            failures.push(
              capture('task_detail', e, {
                title: trunc(t.title, 120),
                attempt,
                lastRaw: lastDetailRaw ? trunc(lastDetailRaw) : undefined,
              }),
            );
          }
        }
        if (!detail.success) {
          detail = ZTodoDetail.safeParse({
            goalAndScope: t.detailHint,
            prerequisites: ['待确认：相关数据/负责人/预算/渠道'],
            materials: ['待确认：海报/文案/二维码/话术/表格模板'],
            steps: [
              '负责人=运营负责人，Day1：确认目标与范围并补齐缺失信息',
              '负责人=门店负责人，Day1：盘点现有资源与物料缺口',
              '负责人=运营负责人，Day2：输出执行方案与物料清单',
              '负责人=门店负责人，Day3：完成物料准备与人员排班',
              '负责人=门店负责人，Day4-14：按方案执行并每日记录数据',
              '负责人=运营负责人，本周五 18:00：复盘会议与优化调整',
            ],
            deliverables: [
              '执行方案文档',
              '物料清单',
              '数据记录表',
              '复盘结论与优化项',
            ],
            acceptanceCriteria: [
              '有明确负责人',
              '有明确截止时间',
              '有可量化验收标准',
            ],
            dataAndReview: [
              '记录位置：飞书多维表格',
              '每周五复盘会议',
              '字段：客流/转化/复购/成本/问题',
            ],
          });
        }
        if (!detail.success) return null;
        return {
          title: t.title,
          description: this.renderTodoDescriptionFromDetail(
            t.description,
            detail.data,
          ),
          aiConsideration: t.aiConsideration,
          decisionReason: t.decisionReason,
          aiPlan: this.renderTodoAiPlan(detail.data),
          assignee: t.assignee,
          type: t.type,
        };
      }),
    );

    const detailedTasks = detailedTasksResults.filter(
      (x): x is NonNullable<(typeof detailedTasksResults)[number]> => !!x,
    );
    if (detailedTasks.length === 0) {
      return {
        success: false,
        error: '生成待办任务失败',
        details: { failures },
      };
    }

    const expected = Math.min(
      12,
      Math.max(3, 1 + (Array.isArray(card.actions) ? card.actions.length : 0)),
    );
    const tasks = this.ensureTodoTasks(detailedTasks, {
      expected,
      card,
      hasXhsIntent,
      canvasId,
      publishCount,
    });

    const createdIds: number[] = [];
    const robotTriggers: Array<{
      todoId: number;
      triggered: boolean;
      robotCode?: string;
      error?: string;
    }> = [];
    const createResults = await Promise.all(
      tasks.map(async (t) => {
        try {
          const todo = await this.todoService.create({
            tenantId: card.tenantId,
            userId,
            title: t.title,
            description: t.description,
            aiConsideration: t.aiConsideration,
            decisionReason: t.decisionReason,
            aiPlan: t.aiPlan,
            assignee:
              typeof t.assignee === 'string' && t.assignee.trim().length > 0
                ? t.assignee.trim()
                : undefined,
            type: typeof t.type === 'string' ? t.type : undefined,
          });
          const trig = await this.robots.triggerIfRobotAssigned({ todo });
          return { todoId: todo.id, trig };
        } catch (e) {
          failures.push(
            capture('todo_create_or_trigger', e, {
              title: trunc(t.title, 120),
            }),
          );
          return null;
        }
      }),
    );
    for (const result of createResults) {
      if (!result) continue;
      createdIds.push(result.todoId);
      robotTriggers.push({ todoId: result.todoId, ...result.trig });
    }
    if (createdIds.length === 0) {
      return {
        success: false,
        error: '生成待办任务失败',
        details: { failures },
      };
    }

    await this.cards.updateOne(
      { _id: new ObjectId(cardId) },
      { $set: { status: 'applied', updatedAt: new Date() } },
    );

    return {
      success: true,
      todoId: createdIds[0],
      todoIds: createdIds,
      robotTriggers,
      details: failures.length > 0 ? { warnings: failures } : undefined,
    };
  }

  private parseJsonFromModelText(text: string): unknown {
    const raw = String(text ?? '').trim();
    if (!raw) throw new Error('JSON_PARSE_FAILED');
    const cleaned = raw
      .replace(/^```[a-zA-Z]*\s*/g, '')
      .replace(/```\s*$/g, '')
      .trim();
    const block = this.extractFirstJsonBlock(cleaned) ?? cleaned;
    const removeTrailingCommas = (s: string): string =>
      s.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(block) as unknown;
    } catch {
      void 0;
    }
    try {
      return JSON.parse(removeTrailingCommas(block)) as unknown;
    } catch {
      throw new Error('JSON_PARSE_FAILED');
    }
  }

  private extractTextFromModelContent(content: unknown): string {
    if (content === null || content === undefined) return '';
    if (typeof content === 'string') return content;
    if (typeof content === 'number' || typeof content === 'boolean') {
      return String(content);
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (typeof item === 'string') {
          if (item.trim().length > 0) parts.push(item);
          continue;
        }
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const text = rec['text'];
        if (typeof text === 'string' && text.trim().length > 0) {
          parts.push(text);
          continue;
        }
        const c = rec['content'];
        if (typeof c === 'string' && c.trim().length > 0) {
          parts.push(c);
          continue;
        }
      }
      return parts.join('\n').trim();
    }
    if (typeof content === 'object') {
      const rec = content as Record<string, unknown>;
      const text = rec['text'];
      if (typeof text === 'string') return text;
      const c = rec['content'];
      if (typeof c === 'string') return c;
      return '';
    }
    return '';
  }

  private renderTodoAiPlan(input: {
    goalAndScope: string;
    prerequisites: string[];
    materials: string[];
    steps: string[];
    deliverables: string[];
    acceptanceCriteria: string[];
    dataAndReview: string[];
  }): string {
    const lines: string[] = [];
    lines.push('## 目标与范围');
    lines.push(`- ${String(input.goalAndScope ?? '').trim()}`);
    lines.push('');
    lines.push('## 前置条件/依赖');
    for (const x of input.prerequisites ?? [])
      lines.push(`- ${String(x).trim()}`);
    lines.push('');
    lines.push('## 物料/输入清单');
    for (const x of input.materials ?? []) lines.push(`- ${String(x).trim()}`);
    lines.push('');
    lines.push('## 执行步骤');
    let i = 1;
    for (const x of input.steps ?? []) {
      const t = String(x).trim();
      if (!t) continue;
      lines.push(`${i}. ${t}`);
      i++;
    }
    lines.push('');
    lines.push('## 输出物');
    for (const x of input.deliverables ?? [])
      lines.push(`- ${String(x).trim()}`);
    lines.push('');
    lines.push('## 验收标准');
    for (const x of input.acceptanceCriteria ?? [])
      lines.push(`- ${String(x).trim()}`);
    lines.push('');
    lines.push('## 数据记录与复盘方式');
    for (const x of input.dataAndReview ?? [])
      lines.push(`- ${String(x).trim()}`);
    return lines.join('\n').trim();
  }

  private renderTodoDescriptionFromDetail(
    base: string | undefined,
    detail: {
      goalAndScope: string;
      prerequisites: string[];
      materials: string[];
      deliverables: string[];
    },
  ): string | undefined {
    const b = String(base ?? '').trim();
    const goal = String(detail.goalAndScope ?? '').trim();
    const mats = Array.isArray(detail.materials)
      ? detail.materials.slice(0, 4)
      : [];
    const outs = Array.isArray(detail.deliverables)
      ? detail.deliverables.slice(0, 3)
      : [];
    const parts: string[] = [];
    if (b) parts.push(b);
    if (goal) parts.push(goal);
    if (mats.length > 0) parts.push(`物料：${mats.join('；')}`);
    if (outs.length > 0) parts.push(`输出：${outs.join('；')}`);
    const merged = parts.join(' | ').trim();
    if (!merged) return undefined;
    return merged.length > 220 ? merged.slice(0, 218) + '…' : merged;
  }

  private buildDetailMust(
    title: string,
    type: string | undefined,
    ctx: { hasXhsIntent: boolean; canvasId?: number; publishCount: number },
  ): string[] {
    const t = String(title ?? '');
    const must: string[] = [];
    const isReview = /监控|日报|周报|复盘|看板|指标/i.test(t);
    if (isReview) {
      must.push('materials must include a table/dashboard artifact');
      must.push('dataAndReview must include field list and cadence');
      must.push('steps must include daily report and weekly review meeting');
      must.push(
        'deliverables must include report template and meeting minutes',
      );
    }
    const isMaterial = /物料|海报|传单|二维码|话术|陈列/i.test(t);
    if (isMaterial) {
      must.push('materials must include at least 5 concrete items');
      must.push('steps must include procurement/production and verification');
    }
    const isXhsPublish =
      ctx.hasXhsIntent &&
      /小红书|xhs|发布/i.test(t) &&
      /publish|xhs_publish/i.test(String(type ?? ''));
    if (isXhsPublish) {
      must.push('steps must include Canvas#<id> and publish count');
    }
    return must;
  }

  private isDetailSpecificEnough(
    title: string,
    detail: {
      materials: string[];
      steps: string[];
      dataAndReview: string[];
      deliverables: string[];
    },
  ): boolean {
    const t = String(title ?? '');
    const isReview = /监控|日报|周报|复盘|看板|指标/i.test(t);
    const mats = Array.isArray(detail.materials) ? detail.materials : [];
    const steps = Array.isArray(detail.steps) ? detail.steps : [];
    const dr = Array.isArray(detail.dataAndReview) ? detail.dataAndReview : [];
    const outs = Array.isArray(detail.deliverables) ? detail.deliverables : [];
    if (steps.length < 6) return false;
    if (isReview) {
      const hasField = dr.some((x) => /字段|field|kpi|指标/i.test(String(x)));
      const hasCadence = dr.some((x) =>
        /每日|周五|每周|日报|周报/i.test(String(x)),
      );
      const hasMeeting = steps.some((x) => /会议|复盘|review/i.test(String(x)));
      const hasReport = outs.some((x) =>
        /报告|日报|周报|纪要|看板/i.test(String(x)),
      );
      if (!hasField || !hasCadence || !hasMeeting || !hasReport) return false;
    }
    if (mats.length === 0) return false;
    return true;
  }

  private extractFirstJsonBlock(text: string): string | undefined {
    const s = String(text ?? '');
    const startObj = s.indexOf('{');
    const startArr = s.indexOf('[');
    let start = -1;
    if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr);
    else start = startObj >= 0 ? startObj : startArr;
    if (start < 0) return undefined;
    let depth = 0;
    let inString = false;
    let quote: string | null = null;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (quote && c === quote) {
          inString = false;
          quote = null;
        }
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        quote = c;
        continue;
      }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) return s.slice(start, i + 1).trim();
      }
    }
    return undefined;
  }

  private ensureTodoTasks(
    tasks: Array<{
      title: string;
      description?: string;
      aiConsideration: string;
      decisionReason: string;
      aiPlan: string;
      assignee?: string;
      type?: string;
    }>,
    input: {
      expected: number;
      card: DecisionCardEntity;
      hasXhsIntent: boolean;
      canvasId?: number;
      publishCount: number;
    },
  ): Array<{
    title: string;
    description?: string;
    aiConsideration: string;
    decisionReason: string;
    aiPlan: string;
    assignee?: string;
    type?: string;
  }> {
    const normalized = Array.isArray(tasks) ? tasks.slice(0, 12) : [];
    const actionList = Array.isArray(input.card.actions)
      ? input.card.actions.map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];

    const needXhsRobot =
      input.hasXhsIntent &&
      !!input.canvasId &&
      !normalized.some((t) =>
        String(t.assignee ?? '')
          .toLowerCase()
          .includes('robot:xhs_publisher'),
      );
    if (needXhsRobot) {
      normalized.push({
        title: '小红书批量发布执行',
        description:
          '基于已生成的示例文章 Canvas 执行批量发布，并回传发布结果。',
        aiConsideration:
          '发布执行需要稳定的自动化流程与可追踪结果，交由 robot:xhs_publisher 执行可降低人工成本并减少出错。',
        decisionReason:
          String(input.card.recommendation ?? '').trim() ||
          '决策建议包含小红书发布动作，需要落地执行与跟踪效果。',
        aiPlan: [
          `Canvas#${input.canvasId}`,
          `发布数量: ${input.publishCount} 篇`,
        ]
          .filter(Boolean)
          .join('\n'),
        assignee: 'robot:xhs_publisher',
        type: 'xhs_publish',
      });
    }

    const minCount = Math.max(3, Math.min(12, input.expected));
    for (let i = normalized.length; i < minCount; i++) {
      const action = actionList[i - 1] ?? actionList[i] ?? '';
      const title =
        action.length > 0 ? action.slice(0, 32) : `执行任务${i + 1}`;
      normalized.push({
        title,
        description:
          action.length > 0
            ? action
            : '根据决策建议补齐执行任务并明确完成标准。',
        aiConsideration:
          '该任务用于把决策拆解为可执行步骤，确保每一步都有负责人、输入输出与完成标准。',
        decisionReason:
          String(input.card.recommendation ?? '').trim() ||
          '基于决策卡建议生成可执行任务。',
        aiPlan:
          action.length > 0
            ? action
            : '明确目标 → 准备输入 → 执行 → 验收 → 记录结果与复盘。',
        type: 'action_task',
      });
    }
    return normalized.slice(0, 12);
  }

  private extractCanvasIdFromText(text: string): number | undefined {
    const s = String(text ?? '').trim();
    if (!s) return undefined;
    const r1 = /\bcanvas(?:\s*id)?\s*[:：#]?\s*(\d+)\b/i.exec(s);
    const r2 = /画布\s*[:：#]?\s*(\d+)\b/i.exec(s);
    const raw = r1?.[1] ?? r2?.[1];
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.floor(n);
  }

  private extractCountFromText(text: string): number | undefined {
    const s = String(text ?? '').trim();
    if (!s) return undefined;
    const r = /(\d+)\s*(?:篇|条|个|post|posts)\b/i.exec(s);
    const n = Number(r?.[1] ?? '');
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.max(1, Math.min(100, Math.floor(n)));
  }

  private extractTopicFromText(text: string): string | undefined {
    const s = String(text ?? '').trim();
    if (!s) return undefined;
    const cleaned = s
      .replace(/小红书|xhs|发布|发文|批量|批量发布|种草/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length === 0) return s.slice(0, 40);
    return cleaned.length > 60 ? cleaned.slice(0, 60) : cleaned;
  }
}
