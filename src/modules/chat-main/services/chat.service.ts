import { Injectable, Logger } from '@nestjs/common';
import { ContextService } from '../../context/services/context.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { ChatRequest, ChatResponse } from '../types/chat.types';
import {
  BaseMessage,
  AIMessage,
  CreateAgentParams,
  HumanMessage,
} from 'langchain';
import { StructuredTool, isStructuredTool } from '@langchain/core/tools';
import type { DeepAgentSubAgent } from '../../ai-agent/types/agent.types.js';
import { ContextRole } from '../../context/enums/context.enums';
import { ToolsService } from '../../function-call/tools/services/tools.service.js';
import { TitleFunctionCallService } from '../../function-call/title/services/title.service.js';
import { AnalysisFunctionCallService } from '../../function-call/analysis/services/analysis.service.js';
import { RetrievalService } from '../../ai-context/services/retrieval.service.js';
import { KeywordService } from '../../ai-context/services/keyword.service.js';
import { Observable } from 'rxjs';
import { AdminService } from '../../admin/services/admin.service.js';
import type { ConversationSessionType } from '../../context/entities/conversation.entity.js';
import { SassService } from '../../sass/services/sass.service.js';
import { DataSourceSchemaService } from '../../data-source/services/data-source-schema.service.js';
import { MediaAgentService } from '../../media-agent/services/media-agent.service.js';

/**
 * @title 主对话服务 Chat-Main Service
 * @description 封装流式与非流式对话流程，并提供上下文CRUD接口。
 * @keywords-cn 主对话, 流式, 非流式, 上下文CRUD
 * @keywords-en chat main, streaming, non-streaming, context CRUD
 */
@Injectable()
export class ChatMainService {
  private readonly logger = new Logger(ChatMainService.name);

  constructor(
    private readonly ctx: ContextService,
    private readonly agent: AgentService,
    private readonly tools: ToolsService,
    private readonly titleTools: TitleFunctionCallService,
    private readonly retrieval: RetrievalService,
    private readonly keywordTools: KeywordService,
    private readonly adminService: AdminService,
    private readonly analysisTools: AnalysisFunctionCallService,
    private readonly sass: SassService,
    private readonly schemaService: DataSourceSchemaService,
    private readonly mediaAgent: MediaAgentService,
  ) {}

  private readonly HITL_PLACEHOLDER = '##HITL_REQUIRED_FRONTEND##';

  /**
   * @title 非流式发送 Send (non-stream)
   * @description 追加用户消息，执行Agent回复，并写入上下文。
   * @keywords-cn 非流式, 同步
   * @keywords-en non-streaming, sync
   */
  async send(request: ChatRequest): Promise<ChatResponse> {
    const scope = this.getRequestScope(request);
    const sid = await this.ctx.createSessionWithScope(request.sessionId, scope);
    await this.ctx.appendMessage(
      sid,
      {
        role: ContextRole.User,
        content: request.input,
      },
      scope,
    );
    try {
      const meta = await this.ctx.getConversation(sid, scope);
      if (!meta || !meta.title || meta.title.trim().length === 0) {
        const t = this.provisionalTitle(request.input);
        if (t && t.length > 0) await this.ctx.setTitleWithScope(sid, t, scope);
      }
    } catch (e) {
      void e;
    }

    const now = request.now ?? new Date().toISOString();
    const ip = request.ip ?? '';
    const platformSupplement = await this.buildPlatformSupplement(scope.tenantId);
    const sysContent = [
      `SESSION_ID:${sid}`,
      `REQUEST_TIME_ISO:${now}`,
      ip ? `CLIENT_IP:${ip}` : 'CLIENT_IP:unknown',
      platformSupplement,
      await this.getSystemPromptCN(scope.sessionType, scope.tenantId),
    ].join('\n');

    // checkpoint 会根据 thread_id 自动获取上下文，只需传入最新消息
    const messages: BaseMessage[] = [new HumanMessage(request.input)];
    const tools = this.getToolsForInput(
      request.input,
      undefined,
      scope,
      scope.sessionType,
    );
    const subagents = this.buildDefaultSubagents(
      tools,
      scope.sessionType,
      scope,
      {
        sid,
        now,
        ip: ip || 'unknown',
      },
    );
    const checkpoint_id =
      (await this.ctx.getConversation(sid, scope))?.lastCheckpointId ?? 'root';
    let ai: AIMessage;
    try {
      ai = await this.agent.runWithMessages({
        config: {
          temperature: request.temperature ?? 0.5,
          tools,
          subagents,
          system: sysContent,
          recursionLimit: 1000,
          context: {
            threadId: sid,
            checkpointId: checkpoint_id,
          },
        },
        messages,
        callOption: {
          configurable: {
            thread_id: sid,
            checkpoint_ns: 'default',
            checkpoint_id: checkpoint_id,
          },
        },
      });
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[send] failed sid=${sid} sessionType=${scope.sessionType} userId=${scope.userId ?? 'unknown'} tenantId=${scope.tenantId ?? 'unknown'} inputLen=${request.input?.length ?? 0} message=${e.message}`,
        e.stack,
      );
      throw e;
    }
    const rawText = this.extractText(ai);
    let text = this.sanitizeFinalText(rawText);
    const nonStreamToolCalls = ai.tool_calls;
    let derivedToolResults: { name?: unknown; output?: unknown }[] | undefined;
    const directToolResults:
      | { name?: unknown; output?: unknown }[]
      | undefined = Array.isArray(
      (ai as unknown as Record<string, unknown>)['tool_results'],
    )
      ? ((ai as unknown as Record<string, unknown>)['tool_results'] as {
          name?: unknown;
          output?: unknown;
        }[])
      : undefined;
    try {
      const parsedUnknown: unknown = JSON.parse(text);
      if (parsedUnknown && typeof parsedUnknown === 'object') {
        const rec = parsedUnknown as Record<string, unknown>;
        const urlVal = rec['url'];
        if (typeof urlVal === 'string' && urlVal.includes('/static/pages/')) {
          derivedToolResults = [
            { name: 'frontend_finalize', output: parsedUnknown },
          ];
        }
      }
    } catch {
      void 0;
    }
    try {
      const hasHitl = (arr?: { name?: unknown; output?: unknown }[]) =>
        Array.isArray(arr)
          ? arr.some((tr) => {
              const r = tr as Record<string, unknown>;
              const out = r['output'];
              const obj =
                out && typeof out === 'object'
                  ? (out as Record<string, unknown>)
                  : undefined;
              const rh = !!(obj && obj['requires_human'] === true);
              const missArr =
                obj && Array.isArray(obj['missing'])
                  ? (obj['missing'] as unknown[])
                  : [];
              return rh || (Array.isArray(missArr) && missArr.length > 0);
            })
          : false;
      let hitl = hasHitl(directToolResults) || hasHitl(derivedToolResults);
      if (!hitl) {
        try {
          const maybeJson: unknown = JSON.parse(rawText);
          if (maybeJson && typeof maybeJson === 'object') {
            const obj = maybeJson as Record<string, unknown>;
            const rh = obj['requires_human'] === true;
            const missArr = obj['missing'];
            hitl =
              rh ||
              (Array.isArray(missArr) && (missArr as unknown[]).length > 0);
          }
        } catch {
          // ignore
        }
      }
      if (hitl) text = this.HITL_PLACEHOLDER;
    } catch {
      void 0;
    }

    text = this.appendCanvasItIfNeeded(
      text,
      directToolResults ?? derivedToolResults,
    );

    text = this.appendTaskItIfNeeded(
      text,
      directToolResults ?? derivedToolResults,
    );
    text = this.appendDecisionSummaryIfNeeded(
      text,
      directToolResults ?? derivedToolResults,
    );
    text = this.appendDecisionItIfNeeded(
      text,
      directToolResults ?? derivedToolResults,
    );

    await this.ctx.appendMessage(
      sid,
      {
        role: ContextRole.Assistant,
        content: text,
        tool_calls:
          Array.isArray(nonStreamToolCalls) && nonStreamToolCalls.length > 0
            ? nonStreamToolCalls
            : undefined,
        tool_results: directToolResults ?? derivedToolResults,
      },
      scope,
    );

    this.titleTools.ensureFirstTurnTitle(sid).catch(() => {});
    // 异步补充关键词
    this.retrieval.reindexSession(sid).catch((e) => console.error(e));
    // 更新最新checkpoint id
    this.ctx
      .getLatestCheckpointId(sid)
      .then((cid) =>
        cid ? this.ctx.setLastCheckpointId(sid, cid, scope) : undefined,
      )
      .catch(() => {});
    return { text, messages };
  }

  /**
   * @title 流式发送 Stream
   * @description 消费 AgentStreamEvent 事件流，转为 SSE MessageEvent，并维护上下文。
   * @keywords-cn 流式, 事件, SSE
   * @keywords-en streaming, events, SSE
   */
  stream(request: ChatRequest): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      void (async () => {
        let sid: string | null = null;
        try {
          const scope = this.getRequestScope(request);
          sid = await this.ctx.createSessionWithScope(request.sessionId, scope);
          if (!sid) throw new Error('SESSION_ID_MISSING');

          await this.ctx.appendMessage(
            sid,
            { role: ContextRole.User, content: request.input },
            scope,
          );

          const meta = await this.ctx.getConversation(sid, scope);
          if (!meta?.title || meta.title.trim().length === 0) {
            const t = this.provisionalTitle(request.input);
            if (t && t.length > 0)
              void this.ctx.setTitleWithScope(sid, t, scope);
          }

          const nowStr = request.now ?? new Date().toISOString();
          const ipStr = request.ip || 'unknown';
          const platformSupplement = await this.buildPlatformSupplement(scope.tenantId);
          const sysContent = [
            `SESSION_ID:${sid}`,
            `REQUEST_TIME_ISO:${nowStr}`,
            `CLIENT_IP:${ipStr}`,
            platformSupplement,
            await this.getSystemPromptCN(scope.sessionType, scope.tenantId),
          ].join('\n');

          const streamWriter = (msg: string) => {
            if (!subscriber.closed)
              subscriber.next({
                data: { type: 'log', data: msg, thread_id: sid },
              } as MessageEvent);
          };

          const tools = this.getToolsForInput(
            request.input,
            streamWriter,
            scope,
            scope.sessionType,
          );
          const subagents = this.buildDefaultSubagents(
            tools,
            scope.sessionType,
            scope,
            { sid, now: nowStr, ip: ipStr },
          );
          const checkpoint_id = meta?.lastCheckpointId ?? 'root';

          // ─── 消费 agent stream 事件 ───
          const iterable = this.agent.stream({
            config: {
              temperature: request.temperature ?? 0.1,
              tools,
              subagents,
              system: sysContent,
              recursionLimit: 1000,
              streamWriter,
              context: { threadId: sid, checkpointId: checkpoint_id },
            },
            messages: [new HumanMessage(request.input)],
            callOption: {
              configurable: {
                thread_id: sid,
                checkpoint_ns: 'default',
                checkpoint_id: checkpoint_id,
              },
            },
          });

          let fullText = '';
          let endToolCalls: unknown[] | undefined;
          let endToolResults:
            | { name?: unknown; output?: unknown }[]
            | undefined;

          const safeSend = (payload: unknown) => {
            if (!subscriber.closed) {
              subscriber.next({ data: payload } as MessageEvent);
            }
          };

          for await (const step of iterable) {
            switch (step.type) {
              case 'start':
                // 内部初始化，不推送
                break;
              case 'token':
                fullText += step.data.text;
                safeSend({
                  type: 'token',
                  data: { text: step.data.text, thread_id: sid },
                });
                break;
              case 'tool_narration':
                safeSend({
                  type: 'tool_narration',
                  data: { text: step.data.text },
                });
                break;
              case 'reasoning':
                safeSend({ type: 'reasoning', data: { text: step.data.text } });
                break;
              case 'tool_start':
                safeSend({ type: 'tool_start', data: step.data });
                break;
              case 'tool_chunk':
                safeSend({ type: 'tool_chunk', data: step.data });
                break;
              case 'tool_end':
                safeSend({ type: 'tool_end', data: step.data });
                break;
              case 'subagent':
                safeSend({ type: 'subagent', data: step.data });
                break;
              case 'end': {
                endToolCalls = step.data.tool_calls as unknown[] | undefined;
                endToolResults = step.data.tool_results;
                // end 事件下发后再做后处理
                break;
              }
              case 'error': {
                const errObj = step.data.error as
                  | (Error & { code?: string })
                  | undefined;
                const errCode = errObj?.code || errObj?.name || 'STREAM_ERROR';
                const errMsg = errObj?.message ?? 'STREAM_ERROR';
                safeSend({
                  type: 'error',
                  data: { code: errCode, message: errMsg },
                });
                break;
              }
              case 'custom':
                safeSend({ type: 'custom', data: step.data });
                break;
              default:
                break;
            }
          }

          // ─── 后处理 ───
          let text = this.sanitizeFinalText(fullText);

          // HITL 检测
          try {
            const hasHitl = (arr?: { name?: unknown; output?: unknown }[]) =>
              Array.isArray(arr) &&
              arr.some((tr) => {
                const r = tr as Record<string, unknown>;
                const out = r['output'];
                const obj =
                  out && typeof out === 'object'
                    ? (out as Record<string, unknown>)
                    : undefined;
                return !!(obj && obj['requires_human'] === true);
              });
            if (hasHitl(endToolResults)) text = this.HITL_PLACEHOLDER;
          } catch {
            void 0;
          }

          text = this.appendCanvasItIfNeeded(text, endToolResults);
          text = this.appendTaskItIfNeeded(text, endToolResults);
          text = this.appendDecisionSummaryIfNeeded(text, endToolResults);
          text = this.appendDecisionItIfNeeded(text, endToolResults);

          // 推送最终 end 事件
          safeSend({
            type: 'end',
            data: {
              text,
              tool_calls: endToolCalls,
              tool_results: endToolResults,
              thread_id: sid,
            },
          });

          // 写入上下文
          await this.ctx.appendMessage(
            sid,
            {
              role: ContextRole.Assistant,
              content: text,
              tool_calls:
                Array.isArray(endToolCalls) && endToolCalls.length > 0
                  ? endToolCalls
                  : undefined,
              tool_results: endToolResults,
            },
            scope,
          );

          // 异步：标题、索引、checkpoint
          this.titleTools.ensureFirstTurnTitle(sid).catch(() => {});
          this.retrieval.reindexSession(sid).catch((e) => console.error(e));
          this.ctx
            .getLatestCheckpointId(sid)
            .then((cid) =>
              cid ? this.ctx.setLastCheckpointId(sid!, cid, scope) : undefined,
            )
            .catch(() => {});
        } catch (err: unknown) {
          const e = err instanceof Error ? err : new Error(String(err));
          this.logger.error(
            `[stream] failed sid=${sid ?? 'unknown'} sessionType=${request.sessionType ?? 'default'} userId=${request.userId ?? 'unknown'} tenantId=${request.tenantId ?? 'unknown'} inputLen=${request.input?.length ?? 0} message=${e.message}`,
            e.stack,
          );
          if (!subscriber.closed) {
            subscriber.next({
              data: {
                type: 'error',
                data: { code: 'STREAM_ERROR', message: e.message },
              },
            } as MessageEvent);
          }
        } finally {
          if (!subscriber.closed) subscriber.complete();
        }
      })();
    });
  }

  /**
   * @title 上下文CRUD Context CRUD
   * @description 提供会话创建、消息读取与清理操作的封装。
   * @keywords-cn 上下文, CRUD
   * @keywords-en context, CRUD
   */
  async createSession(
    sessionId?: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<string> {
    return this.ctx.createSessionWithScope(sessionId, scope);
  }

  async appendUser(
    sessionId: string,
    content: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.ctx.appendMessage(
      sessionId,
      {
        role: ContextRole.User,
        content,
      },
      scope,
    );
  }

  async appendAssistant(
    sessionId: string,
    content: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.ctx.appendMessage(
      sessionId,
      {
        role: ContextRole.Assistant,
        content,
      },
      scope,
    );
  }

  async getMessages(
    sessionId: string,
    limit?: number,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<
    Array<
      import('../../context/types/context.types').ContextMessage & {
        fingerprint: string;
      }
    >
  > {
    const history = await this.ctx.getMessages(
      sessionId,
      limit,
      undefined,
      scope,
    );
    const deleted = await this.ctx.getDeletedFingerprints(sessionId, scope);
    const enriched = (history ?? []).map((m, idx) => {
      const fingerprint = this.ctx.fingerprintMessage(sessionId, m, idx);
      return {
        ...m,
        content: this.sanitizeHistoryContent(m.content),
        fingerprint,
      };
    });
    return enriched.filter((m) =>
      m.fingerprint ? !deleted.has(m.fingerprint) : true,
    );
  }

  async deleteMessages(
    sessionId: string,
    params?: { fingerprints?: string[]; indexes?: number[] },
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<{ deleted: number }> {
    const fingerprints = Array.isArray(params?.fingerprints)
      ? (params?.fingerprints ?? [])
          .filter((s) => typeof s === 'string')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];

    const idxs = Array.isArray(params?.indexes)
      ? (params?.indexes ?? []).filter(
          (n) => typeof n === 'number' && Number.isFinite(n),
        )
      : [];

    if (fingerprints.length === 0 && idxs.length > 0) {
      const visible = await this.getMessages(sessionId, undefined, scope);
      const uniq = Array.from(new Set(idxs.map((n) => Math.trunc(n))));
      for (const i of uniq) {
        if (i < 0 || i >= visible.length) continue;
        const fp = visible[i].fingerprint;
        if (fp) fingerprints.push(fp);
      }
    }

    const uniqueFps = Array.from(new Set(fingerprints));
    if (uniqueFps.length > 0) {
      await this.ctx.markDeletedFingerprints(sessionId, uniqueFps, scope);
    }
    return { deleted: uniqueFps.length };
  }

  async clearSession(
    sessionId: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.ctx.clearSessionWithScope(sessionId, scope);
  }

  private extractText(ai: AIMessage): string {
    const content = ai.content;
    if (typeof content === 'string') {
      return content;
    }
    const extracted = this.extractTextFromModelContent(content);
    if (extracted) return extracted;
    return JSON.stringify(content);
  }

  private sanitizeHistoryContent(content: unknown): string {
    if (typeof content !== 'string') return '';
    const s = content.trim();
    if (s.length === 0) return '';
    // 宽松检测：Anthropic content block 数组（兼容 minimax 带空格的 JSON 序列化）
    const looksLikeBlocks =
      s.startsWith('[') &&
      (s.includes('"type"') || s.includes('"type" :')) &&
      (s.includes('thinking') || s.includes('tool_use') || s.includes('text'));
    if (!looksLikeBlocks) return content;
    try {
      const parsed: unknown = JSON.parse(s) as unknown;
      const extracted = this.extractTextFromModelContent(parsed);
      // 只有 thinking/tool_use 块、没有 text 块时，extracted 为空 → 返回空字符串而非原始 JSON
      return extracted;
    } catch {
      return content;
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
        const type = typeof rec['type'] === 'string' ? rec['type'] : '';
        if (type === 'thinking' || type === 'tool_use') continue;
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

  private sanitizeFinalText(text: string): string {
    const s = typeof text === 'string' ? text : String(text ?? '');
    const trimmed = s.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return s;
    let depth = 0;
    let inString = false;
    let quote: string | null = null;
    let esc = false;
    let endIdx = -1;
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (inString) {
        if (esc) {
          esc = false;
        } else if (c === '\\') {
          esc = true;
        } else if (quote && c === quote) {
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
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    if (endIdx <= 0) return s;
    const head = trimmed.slice(0, endIdx);
    const rest = trimmed.slice(endIdx).trimStart();
    try {
      const parsed: unknown = JSON.parse(head) as unknown;
      const rec = parsed as Record<string, unknown>;
      const isToolJson =
        !!parsed &&
        typeof parsed === 'object' &&
        ('answer' in rec || 'data' in rec || 'query' in rec);
      const isCanvasWorkflowJson =
        !!parsed &&
        typeof parsed === 'object' &&
        typeof rec['ok'] === 'boolean' &&
        typeof rec['canvasId'] === 'number';
      // 内容清洗策略：
      // - 如果 JSON 被识别为工具数据，则剥离 JSON 头部，仅保留其后的正文。
      // - 若其后没有正文（rest 为空），为了避免 message.content 丢失，保留原文 s。
      if (isToolJson || isCanvasWorkflowJson) return rest.length > 0 ? rest : s;
      return s;
    } catch {
      return s;
    }
  }

  private ensureStringArray(
    v: unknown,
    fallback: string[] = ['analysis_subagent'],
  ): string[] {
    if (!Array.isArray(v)) return fallback;
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string') out.push(item);
    }
    return out.length > 0 ? out : fallback;
  }

  private provisionalTitle(text: string): string {
    const s = String(text || '').trim();
    let t = s.slice(0, 24);
    t = t.replace(/[\s\u3000]+$/g, '');
    t = t.replace(/[.,!;:。！，；：]+$/g, '');
    if (t.length === 0) return '新会话';
    return t;
  }

  /**
   * @description 构造对话层系统提示（数据分析/页面生成/批量发布的通用约束）。
   * @returns {string} 中文系统提示文本。
   * @keyword-en system-prompt, data-analysis, batch-publish
   */
  private async getDataAnalysisPromptCN(tenantId?: string): Promise<string> {
    const base = [
      '你是 AI 指挥官 “小集”，目标是用最少步骤完成用户当前需求。',
      '你能完成代码生成,看版替换,页面生成,数据分析等任务,但你不是执行者,只能调用工具/子代理来完成任务。',
      '优先直接回答；只有当信息不足或用户明确要求时再调用工具/子代理。',
      '当工具返回了 Canvas 信息（如 canvasId），回复中输出一个 ```canvas-it``` JSON 代码块（至少包含 canvasId）。',
      '当用户诉求属于”方案/决策/策略/建议”，且已有可支撑的数据时，调用 decision_card_generate 生成决策卡,如果没有就进行复杂数据查询, 然后继续生成',
      '当工具返回决策卡信息（如 cardId）时，回复中输出一个 ```decision-it``` JSON 代码块（至少包含 cardId）。',
      '涉及看板替换/改版时：先调用 dashboard_config_view 读取现状，再调用 dashboard_config_patch 增量修改；不要跳过读取步骤。',
      'dashboardCode 仅可使用字母/数字/_/-；若用户未明确给 code，则不要传 dashboardCode（默认 ai-commander），禁止编造无效 code。',
      '新增 block 时必须使用已注册类型（如 stat_card、stat_comparison_card、mongo_*）；禁止输出未注册 block 类型。',
      '涉及看板新增字段/新增指标时，必须同步调整 config.queries 数据查询定义，不允许只改 blocks 不改数据源结构。',
      '看板查询结构优先用 dashboard_mongo_search 校验（对齐 /mongo/query 万用查询结构），确认字段可查再写入 config.queries。',
      '看板 query 支持 sourceType=mongo 或 sourceType=feishu-bitable（飞书可用 tableId 作为 collection）。',
      '当看板指标需要复杂过滤/聚合/格式重组时，可在 config.queries.<key>.transformJs 中定义前端 JS 数据处理逻辑。',
      '不要回显工具原始 JSON 长文本，只做简洁结论。',
      '小红书流程：先生成示例内容 Canvas；用户明确”发布/执行”后再进入发布任务阶段。',
      '批量发布通过 Todo 派单：创建/更新 Todo，并使用中文接单人名称”小红书发布机”（避免暴露内部代码）；type 只能为 auto_execute/offline_execute/other（发布场景必须 auto_execute），并写清关联资源（如 canvasId）与 count。',
      '调用 todo_create/todo_update 时不要手填 userId，统一由会话上下文注入。',
      '创建发布任务时，description 必须写入当前会话上下文摘要（用户目标、对象、资源、执行要求），不要留空。',
      '示例文章生成阶段会基于图库原始图片即时生成拼图与封面；不复用历史拼图或历史封面。',
      '生成拼图/封面属于独立图库操作；除非用户明确要求生成文章/内容，否则禁止同时触发 Canvas 创建。',
      '[重要]需要任何数据分析,数据查询,数据获取时使用 analysis_subagent, 如果有数据来源返回也要在回答生成中说明数据来源和字段信息，确保查询结果可解释且可复用。',
      '涉及计算时必须调用 js_calc 或 js_calc_batch。',
      '若工具失败或返回空，明确告知用户并给下一步选项。',
      '所有的数据查询都要带上数据表清单（schema catalog），说明数据来源和字段信息，确保查询结果可解释且可复用。',
      '【重要】返回图片时：只输出 markdown 图片语法如 ![描述](/static/uploads/xxx.jpg)，禁止在路径前加任何域名、IP或 baseURL，禁止使用 HTML img 标签。',
    ];

    // 构建数据表清单（不超过5000字）
    const schemaCatalog = await this.buildSchemaCatalog(tenantId);

    return [...base, schemaCatalog].join('\n');
  }

  /**
   * @description 构建数据表清单markdown
   * @keyword-en build schema catalog markdown
   */
  private async buildSchemaCatalog(tenantId?: string): Promise<string> {
    const MAX_CHARS = 5000;
    const lines: string[] = [];
    let totalChars = 0;

    // 获取所有可见数据源的 schemas
    const schemas = await this.schemaService.listAllSchemas({
      tenantId,
      limit: 200,
    });

    // 按 sourceCode 分组
    const grouped: Record<string, typeof schemas> = {};
    for (const item of schemas) {
      const code = item.schema.sourceCode || 'unknown';
      if (!grouped[code]) grouped[code] = [];
      grouped[code].push(item);
    }

    // 标题
    const header = '\n【数据表清单】\n| sourceCode | collectionName | nameCn |';
    const headerSep = '|------------|----------------|--------|';

    lines.push(header, headerSep);
    totalChars += header.length + headerSep.length + 2;

    for (const [sourceCode, items] of Object.entries(grouped)) {
      for (const item of items) {
        const collectionName = item.schema.collectionName || '';
        const nameCn = item.schema.nameCn || collectionName;
        const row = `| ${sourceCode} | ${collectionName} | ${nameCn} |`;
        const rowChars = row.length + 1; // +1 for newline

        // 超出限制时直接停止，不添加截断行
        if (totalChars + rowChars > MAX_CHARS) {
          return lines.join('\n');
        }

        lines.push(row);
        totalChars += rowChars;
      }
    }

    return lines.join('\n');
  }

  /**
   * @description 获取会话模式系统提示
   * @keyword-en resolve system prompt by session mode
   */
  private async getSystemPromptCN(sessionType: ConversationSessionType, tenantId?: string): Promise<string> {
    if (sessionType === 'thought') return this.getThoughtPromptCN();
    if (sessionType === 'gallery-agent') return this.getGalleryAgentPromptCN();
    if (sessionType === 'xhs-specialist') return this.getXhsSpecialistPromptCN();
    return this.getDataAnalysisPromptCN(tenantId);
  }

  /**
   * @description 构建平台AI补充说明（租户个性化提示）
   * @param {string | undefined} tenantId - 租户ID
   * @returns {Promise<string>} 平台补充说明，如有则拼入SYSTEM_PROMPT块
   * @keyword-en build platform AI prompt supplement
   */
  private async buildPlatformSupplement(tenantId?: string): Promise<string> {
    if (!tenantId?.trim()) return '';
    const info = await this.sass.getPlatformInfo(tenantId);
    if (!info?.aiPromptSupplement?.trim()) return '';
    return [`【平台AI补充说明】`, info.aiPromptSupplement.trim()].join('\n');
  }

  /**
   * @description 思维链路专用提示词
   * @keyword-en thought route system prompt
   */
  private getThoughtPromptCN(): string {
    return [
      '你是“思维链路沉淀助手”，本会话唯一目标是产出可复用思维链。',
      '禁止执行：页面生成、发布编排、业务任务执行、与思维链无关的工具调用。',
      '回答需聚焦：sourceCode、collection/table、关键字段含义、典型过滤条件与适用场景。',
      '当用户提供的是某一些数据的查询方法的时候,或者说明逻辑的时候,不需要分析,可以寻找有没有相关的思维链来合并更新进去或者新建条思维进去',
      '若信息不足先提问澄清，不得编造字段。',
      '【关键】当需要生成思维链时，必须：1. 先完成完整的数据分析 2. 存入经验时 content 必须包含：数据源、涉及的表/集合、核心字段（字段名+含义+业务用途）、典型查询条件、业务场景、查询示例、结果解读 3. 禁止只写入抽象性描述，必须写入具体分析过程和结论 4. category 使用具体业务场景标签',
    ].join('\n');
  } 

  /**
   * @description 图库Agent专用提示词
   * @keyword-en gallery agent system prompt
   */
  private getGalleryAgentPromptCN(): string {
    return [
      '你是"图库智能助手"，专注于帮助用户搜索和管理图片素材。',
      '你可以使用图库工具来：',
      '1. 搜索图片 - 通过文字描述搜索相似图片',
      '2. 列出标签 - 查看图库中已有的标签',
      '3. 列出图片 - 查看图库中的图片列表（包括普通图片和拼图/封面图片）',
      '4. 生成拼图 - 必须严格选择 2 张横图（isPortrait !== true），生成 640x853（96dpi）拼图并入图库。拼图是独立操作，无需先创建 Canvas，用户可直接命令生成拼图。',
      '',
      '【重要】图片检索规则：',
      '- 检索顺序必须是：先标签检索（gallery_list_tags + gallery_list_images / gallery_search_images 标签命中），再描述向量检索兜底；禁止一上来只做描述检索后就下结论。',
      '- 当用户需要搜索图片用于文章配图、素材参考等日常用途时：必须设置 image_type="regular"，这样会返回普通图片。',
      '- 普通图判定唯一依据：isCollage !== true。禁止因为 description 或 tags 包含“封面/自动封面”等字样就把 isCollage=false 的图片排除。',
      '- 当用户明确要求查找"拼图"或"封面"类图片时：设置 image_type="collage"。',
      '- 拼图规则：只能使用横图（isPortrait !== true）；竖图（isPortrait === true）禁止参与拼图。',
      '- 在宣称“没有普通图”前，必须至少执行一次标签检索并确认 image_type="regular" 的列表为空。',
      '',
      '简而言之：除非用户明确要"拼图"或"封面"，否则一律用 image_type="regular" 搜索普通图片。',
      '请根据用户需求，调用合适的图库工具来完成任务。',
      '如果图库中没有相关图片，请告知用户并建议其他获取图片的方式。',
      '【重要】返回图片时：只输出 markdown 图片语法如 ![描述](/static/uploads/xxx.jpg)，禁止在路径前加任何域名、IP或 baseURL，禁止把相对路径拼接成绝对路径。',
    ].join('\n');
  }

  /**
   * @description 小红书专家专用提示词
   * @keyword-en XHS specialist system prompt
   */
  private getXhsSpecialistPromptCN(): string {
    return [
      '你是"小红书内容创作专家"，专注于帮助用户生成和管理小红书内容。',
      '你可以使用Canvas和图库工具来：',
      '1. 查看Canvas列表 - 了解用户的内容集合',
      '2. 获取Canvas详情 - 查看具体文章内容',
      '3. 结合图库图片 - 为文章配图',
      '若用户要求拼图：只能用 2 张图，拼图成品固定 640x853（96dpi），再用于内容链路。',
      '请根据用户需求，帮助他们创建高质量的小红书内容。',
    ].join('\n');
  }

  /**
   * @description 获取工具集合
   * @keyword-en get tools
   */
  private getTools(
    streamWriter?: (msg: string) => void,
    scope?: { tenantId?: string; userId?: string },
    mode: ConversationSessionType = 'default',
  ): CreateAgentParams['tools'] {
    return this.tools.getHandle(streamWriter, scope, { mode });
  }

  /**
   * @description 读取请求租户范围
   * @keyword-en resolve request scope
   */
  private getRequestScope(request: ChatRequest): {
    tenantId?: string;
    userId?: string;
    sessionType: ConversationSessionType;
  } {
    const tenantId = request.tenantId?.trim();
    const userId = request.userId?.trim();
    const validTypes: ConversationSessionType[] = ['default', 'thought', 'gallery-agent', 'xhs-specialist'];
    const sessionType = validTypes.includes(request.sessionType as ConversationSessionType)
      ? (request.sessionType as ConversationSessionType)
      : 'default';
    return {
      tenantId: tenantId || undefined,
      userId: userId || undefined,
      sessionType,
    };
  }

  /**
   * @description 基于输入意图，对可用工具做轻量过滤（避免误触发/过度工具化）。
   * @param {string} input - 用户输入。
   * @param {(msg: string) => void} [streamWriter] - 可选流式日志输出。
   * @returns {CreateAgentParams['tools']} 对话层可用工具。
   * @keyword-en tools, intent, filter
   */
  private getToolsForInput(
    input: string,
    streamWriter?: (msg: string) => void,
    scope?: { tenantId?: string; userId?: string },
    mode: ConversationSessionType = 'default',
  ): CreateAgentParams['tools'] {
    const tools = this.getTools(streamWriter, scope, mode) ?? [];
    if (mode === 'thought') return tools;
    if (this.isTopicOrchestrateIntent(input)) {
      return tools.filter((t) => {
        const name = (t as unknown as { name?: string }).name ?? '';
        return name === 'topic_orchestrate' || name === 'task';
      });
    }
    return tools;
  }

  /**
   * @description 构建默认子代理配置
   * @keyword-en build default subagents
   */
  private buildDefaultSubagents(
    tools: CreateAgentParams['tools'],
    mode: ConversationSessionType,
    scope?: { tenantId?: string; userId?: string },
    env?: { sid: string; now: string; ip: string },
  ): DeepAgentSubAgent[] {
    const baseTools = this.normalizeSubagentTools(tools);
    const envStr = env
      ? [
          `SESSION_ID:${env.sid}`,
          `REQUEST_TIME_ISO:${env.now}`,
          `CLIENT_IP:${env.ip}`,
        ].join('\n')
      : '';

    if (mode === 'thought') {
      return [
        {
          name: 'analysis_subagent',
          description: '思维链/Schema 分析子代理',
          systemPrompt: [envStr, this.getThoughtPromptCN()]
            .filter(Boolean)
            .join('\n\n'),
          tools: baseTools,
        },
      ];
    }

    const dataSourceTools = this.normalizeSubagentTools(
      this.analysisTools.getAllDataSourceTools(scope),
    );
    const topicOrchestrateTools = baseTools.filter(
      (t) => (t as unknown as { name?: string }).name === 'topic_orchestrate',
    );

    const analysisSys = [
      '你是一名严谨、务实的数据分析 Agent。',
      '目标：以最小推理成本与最少工具调用，在单次流程内一次性获取所需数据并返回最终答案。',
      '涉及任何加减乘除、比例、汇总、均值、环比、同比等计算时，必须调用 js_calc 或 js_calc_batch，禁止心算。',
      '为了检索速度,你可以并发返回Tool call,我将并发执行返回结果',
      '[!重要!] 所有的数据分析,都要带上对应的数据表,也就是数据来源标识',
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
      '   | sourceCode           | 资源标识字段   | 查询工具                     |',
      '   |---------------------|---------------|------------------------------|',
      '   | main-mongo         | collectionName | data_source_query           |',
      '   | tenant-mongo       | collectionName | data_source_query           |',
      '   | super-party        | collectionName | super_party_query           |',
      '   | feishu-bitable     | tableId       | feishu_bitable_list_records |',
      '   | feishu-bitable-task| tableId       | feishu_bitable_list_records |',
      '',
      '   注意：schema_search 同时搜索 sass_schema（子租户表，sourceCode=tenant-mongo）',
      '   和 data_source_schemas（飞书、main-mongo等），统一使用 data_source_query 查询。',
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
      '   - 默认使用异步模式（asyncMode=true），立即返回不阻塞',
      '   - content: 必须记录完整、具体的经验内容，而非抽象概述。内容需包含以下部分：',
      '     【数据源】使用的具体数据源及 sourceCode（如 main-mongo、feishu-bitable）',
      '     【涉及的表/集合】具体的 schema 名称、collectionName 或 tableId',
      '     【核心字段】列出本次查询实际使用的关键字段（不仅是字段名，还要说明其含义、业务用途）',
      '     【典型查询条件】本次问题的核心过滤条件（如时间范围、状态筛选），用自然语言解释条件含义',
      '     【业务场景】本次问题对应的具体业务场景（如"查询某供应商的月度订单汇总"），而非泛泛的"数据分析"',
      '     【查询示例】（如有）本次实际执行的核心查询逻辑或关键参数组合',
      '     【结果解读】查询返回的数据结构或典型结果，便于后续理解如何解析数据',
      '   - 重要：禁止只写入抽象性描述（如"feishu-bitable database schema analysis"），必须写入本次具体分析过程和结论',
      '   - 建议将上述信息组织为结构化 JSON 对象字符串，字段示例：dataSource、sourceCode、schemaName、collectionName/tableId、fields、filters、queryExample、resultFormat、businessScenario、toolsUsed、category 等。',
      '   - toolsUsed: 使用的工具名列表（如 schema_search、data_source_query、feishu_bitable_list_records 等）',
      '   - category: 建议使用能表达具体业务场景的标签，如 "供应商订单汇总"、"月度销售统计"、"任务进度追踪" 等，避免泛泛的 "schema-knowledge"',
      '   - 如果当前调用中 search_thought 返回了结果，则不得调用 generate_thought，只需在回答中引用该历史思维链内容',
      '【批量查询优化】',
      '- 当需要查询多个表的结构时，使用 schema_batch_get 一次获取多个表的完整字段',
      '- 当需要从多个表或多条件查询数据时，使用 data_source_batch_query 并发执行多个查询',
      '- 批量查询返回时，若某个查询数据超量，会在 warning 中提示该查询条件和数据有误，请根据提示调整',
      '【约束】',
      '- 默认 limit = 50，最大 200',
      '- 避免不必要的多轮工具调用',
      scope?.tenantId
        ? `- 当前租户 tenantId=${scope?.tenantId}，所有数据查询必须带 tenantId 过滤条件，禁止跨租户`
        : '- 当前为平台范围（无 tenantId），仅允许查询平台级数据',
    ];
    if (envStr) analysisSys.unshift(envStr);

    return [
      {
        name: 'analysis_subagent',
        description:
          '数据分析与检索子代理。凡是需要查询数据、分析数据的情况都必须委派给此代理。',
        systemPrompt: analysisSys.join('\n'),
        tools: dataSourceTools,
      },
      {
        name: 'topic_orchestrate_subagent',
        description:
          '示例文章生成子代理。凡是需要生成小红书等平台示例文章、批量内容、系列文章的情况都必须委派给此代理。',
        systemPrompt: [
          envStr,
          '你是示例文章生成子代理，负责生成可直接发布的示例文章内容。',
          '你是专项“文章生成代理”：所有文章产出都必须通过 Canvas 承载，禁止脱离 Canvas 直接返回文章正文。',
          '你必须生成完整的、可以直接使用的小红书正文内容，而不是文章方向或大纲。',
          '小红书文章要求：开头 1-2 句强钩子；全篇短句短段；多用要点列表；语气真实分享；不要像教科书。',
          '文章长度要求：至少 200 字，确保内容充实。',
          '必须包含具体数字化细节（人数、预算、时长、转化指标等）。',
          '必须在末尾给 3-6 个话题标签（#标签）。',
          '必须调用 topic_orchestrate 工具产出文章并写入 Canvas，禁止你自己直接写文章正文或大纲。',
          '示例文章阶段除内容生成外，还会基于图库原始图片即时生成拼图与封面；不允许复用历史拼图或历史封面。',
          '工具返回后，直接返回工具结果；不要自行改写成大纲或方向建议。',
          '如果工具调用报错，必须把错误原文直接返回给用户，不要继续重试，不要换参数重复调用。',
          '当出现 ARTICLE_DRAFT_INVALID 时，直接告知“本次生成未通过发布质量校验”，并建议用户调整话题后再试。',
          '调用 topic_orchestrate 工具时，必须显式传入 userId（取当前会话上下文用户），禁止省略。',
          '[重要约束] 调用 topic_orchestrate 工具时，只需要调用一次，不要重复调用。',
          '[重要约束] 工具调用完成后，必须直接返回结果，不要再次调用任何工具。',
          '[重要约束] 绝对不要在回复中重复相同的文字或问题。',
        ]
          .filter(Boolean)
          .join('\n'),
        tools: topicOrchestrateTools,
      },
      {
        name: 'frontend_subagent',
        description: '前端页面生成子代理',
        systemPrompt: [
          envStr,
          '你是前端页面生成子代理。',
          '只在用户明确要求图表/页面/可视化时工作。',
          '输出需严格遵循工具与系统提示的约束。',
        ]
          .filter(Boolean)
          .join('\n'),
        tools: baseTools,
      },
      {
        name: 'ops_subagent',
        description: '发布与执行编排子代理',
        systemPrompt: [
          envStr,
          '你是执行编排子代理。',
          '专注批量发布与流程执行，严格遵守工具调用规则。',
        ]
          .filter(Boolean)
          .join('\n'),
        tools: baseTools,
      },
      {
        name: 'gallery_subagent',
        description: '图库与图片管理子代理',
        systemPrompt: [
          envStr,
          '你是图库与图片管理子代理。',
          '当用户询问图片、图库、素材、搜索图片、生成图片、返回图片等需求时，必须委派给此代理。',
          '你可以使用图库工具搜索、列出、随机获取图片，以及管理图库分组和标签。',
          '搜索图片时优先使用 gallery_search_images（向量+标签检索），仅列出时使用 gallery_list_images。',
          '重要：当你需要为用户返回图片时，直接返回图片 URL 即可，不需要经过 Canvas 或 topic_orchestrate。',
          '返回图片结果时，必须包含图片的 URL（thumbUrl 或 url）、标签、描述等信息，以便用户查看。',
          '如果用户要求"生成一张图片"或类似需求，应从图库中搜索匹配的图片并直接返回 URL，不需要创建 Canvas。',
          '只有在用户明确要求生成"文章"或"多篇内容"时，才考虑委派给 topic_orchestrate_subagent。',
        ]
          .filter(Boolean)
          .join('\n'),
        tools: this.normalizeSubagentTools(
          this.mediaAgent.getGalleryToolsHandle(scope),
        ),
      },
    ];
  }

  /**
   * @description 判断选题编排意图
   * @keyword-en topic orchestrate intent
   */
  private isTopicOrchestrateIntent(input: string): boolean {
    const s = String(input || '').trim();
    if (!s) return false;

    const hasPlatform = /小红书|xhs|XHS/.test(s);
    const wantsBatchContent = /批量|多篇|几篇|一组|系列|连载/.test(s);
    const wantsPlanning =
      /编排|选题|规划|策划|写(几)?篇|生成(几)?篇|产出|内容|软文|文案/.test(s);
    const wantsPromote = /推广|引流|转化|营销|投放/.test(s);
    return (
      (hasPlatform && (wantsBatchContent || wantsPlanning)) ||
      (wantsBatchContent && (wantsPlanning || wantsPromote))
    );
  }

  /**
   * @description 规范子代理工具列表
   * @keyword-en normalize subagent tools
   */
  private normalizeSubagentTools(
    tools: CreateAgentParams['tools'],
  ): StructuredTool[] {
    if (!Array.isArray(tools)) return [];
    return tools.filter((t): t is StructuredTool => isStructuredTool(t));
  }

  private parseCanvasExecuteCanvasId(input: string): number | null {
    const s = String(input || '').trim();
    if (!s) return null;
    const m = s.match(/(?:^|\s)(?:执行|运行)\s*(?:canvas\s*)?(\d+)(?:\s|$)/i);
    if (!m || !m[1]) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  private extractCanvasItItems(output: unknown): Array<{
    canvasId: number;
    status?: string;
    topic?: string;
    platform?: string;
    articleCount?: number;
    needFields?: string[];
  }> {
    const out: Array<{
      canvasId: number;
      status?: string;
      topic?: string;
      platform?: string;
      articleCount?: number;
      needFields?: string[];
    }> = [];

    const tryPush = (obj: Record<string, unknown>) => {
      const cidRaw = obj['canvasId'] ?? obj['canvas_id'] ?? obj['id'];
      const cid = Number(cidRaw);
      if (!Number.isFinite(cid)) return;

      const canvas = obj['canvas'];
      const canvasRec =
        canvas && typeof canvas === 'object'
          ? (canvas as Record<string, unknown>)
          : undefined;
      const status =
        typeof obj['status'] === 'string'
          ? obj['status']
          : typeof canvasRec?.['status'] === 'string'
            ? canvasRec['status']
            : undefined;
      const needFieldsRaw = obj['needFields'] ?? obj['missing'];
      const needFields = Array.isArray(needFieldsRaw)
        ? (needFieldsRaw as unknown[])
            .filter((x) => typeof x === 'string')
            .map((x) => String(x))
        : undefined;

      const topic =
        typeof obj['topic'] === 'string'
          ? obj['topic']
          : typeof canvasRec?.['topic'] === 'string'
            ? canvasRec['topic']
            : undefined;
      const platform =
        typeof obj['platform'] === 'string'
          ? obj['platform']
          : typeof canvasRec?.['platform'] === 'string'
            ? canvasRec['platform']
            : undefined;
      const articleCountRaw =
        obj['articleCount'] ?? canvasRec?.['articleCount'];
      const articleCount =
        typeof articleCountRaw === 'number' && Number.isFinite(articleCountRaw)
          ? articleCountRaw
          : undefined;

      out.push({
        canvasId: cid,
        status,
        topic,
        platform,
        articleCount,
        needFields,
      });
    };

    if (output && typeof output === 'object') {
      const rec = output as Record<string, unknown>;
      tryPush(rec);
      return out;
    }

    if (typeof output === 'string') {
      const s = output.trim();
      if (!s) return out;
      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(s);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            tryPush(parsed as Record<string, unknown>);
          }
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                tryPush(item as Record<string, unknown>);
              }
            }
          }
          return out;
        } catch {
          void 0;
        }
      }
      const m = s.match(/(?:canvasId|canvas_id|id)\s*[:=]\s*(\d+)/i);
      if (m && m[1]) {
        const cid = Number(m[1]);
        if (Number.isFinite(cid)) out.push({ canvasId: cid });
      }
    }

    return out;
  }

  private extractTaskItItems(output: unknown): Array<{
    todoId: number;
    batchTaskId?: number;
    taskId?: string;
    platform?: string;
    canvasId?: number;
    taskCount?: number;
    status?: string;
    tasksPreview?: string[];
  }> {
    const out: Array<{
      todoId: number;
      batchTaskId?: number;
      taskId?: string;
      platform?: string;
      canvasId?: number;
      taskCount?: number;
      status?: string;
      tasksPreview?: string[];
    }> = [];

    const tryPush = (obj: Record<string, unknown>) => {
      const todoIdRaw = obj['todoId'] ?? obj['todo_id'] ?? obj['todo'];
      const todoIdNum =
        typeof todoIdRaw === 'number'
          ? todoIdRaw
          : typeof todoIdRaw === 'string'
            ? Number(todoIdRaw)
            : NaN;
      if (!Number.isFinite(todoIdNum)) return;

      const batchTaskIdRaw = obj['batchTaskId'] ?? obj['batch_task_id'];
      const batchTaskId =
        typeof batchTaskIdRaw === 'number' && Number.isFinite(batchTaskIdRaw)
          ? batchTaskIdRaw
          : undefined;
      const taskId =
        typeof obj['taskId'] === 'string'
          ? obj['taskId']
          : typeof obj['mcpTaskId'] === 'string'
            ? obj['mcpTaskId']
            : undefined;
      const platform =
        typeof obj['platform'] === 'string' ? obj['platform'] : undefined;
      const canvasIdRaw = obj['canvasId'] ?? obj['canvas_id'];
      const canvasId =
        typeof canvasIdRaw === 'number' && Number.isFinite(canvasIdRaw)
          ? canvasIdRaw
          : typeof canvasIdRaw === 'string'
            ? Number(canvasIdRaw)
            : undefined;
      const taskCountRaw = obj['taskCount'] ?? obj['count'];
      const taskCount =
        typeof taskCountRaw === 'number' && Number.isFinite(taskCountRaw)
          ? taskCountRaw
          : undefined;
      const status =
        typeof obj['status'] === 'string' ? obj['status'] : undefined;
      const tasksPreview = Array.isArray(obj['tasksPreview'])
        ? (obj['tasksPreview'] as unknown[])
            .map((x) => {
              if (typeof x === 'string') return x.trim();
              if (typeof x === 'number' && Number.isFinite(x)) return String(x);
              if (typeof x === 'boolean') return String(x);
              return '';
            })
            .filter((x) => x.length > 0)
            .slice(0, 20)
        : undefined;

      out.push({
        todoId: todoIdNum,
        batchTaskId,
        taskId,
        platform,
        canvasId,
        taskCount,
        status,
        tasksPreview,
      });
    };

    const visit = (val: unknown) => {
      if (!val) return;
      if (typeof val === 'string') {
        const s = val.trim();
        if (!s) return;
        if (s.startsWith('{') || s.startsWith('[')) {
          try {
            const parsed: unknown = JSON.parse(s);
            visit(parsed);
            return;
          } catch {
            void 0;
          }
        }
        const m = s.match(/(?:todoId|todo_id)\s*[:=]\s*(\d+)/i);
        if (m && m[1]) {
          const tid = Number(m[1]);
          if (Number.isFinite(tid)) out.push({ todoId: tid });
        }
        return;
      }
      if (Array.isArray(val)) {
        for (const item of val) visit(item);
        return;
      }
      if (val && typeof val === 'object') {
        const rec = val as Record<string, unknown>;
        tryPush(rec);
        const nestedKeys = ['result', 'task', 'summary', 'data'];
        for (const k of nestedKeys) {
          const nxt = rec[k];
          if (nxt && typeof nxt === 'object') visit(nxt);
        }
      }
    };

    visit(output);
    return out;
  }

  private buildTaskItBlock(item: {
    todoId: number;
    batchTaskId?: number;
    taskId?: string;
    platform?: string;
    canvasId?: number;
    taskCount?: number;
    status?: string;
    tasksPreview?: string[];
  }): string {
    const payload: Record<string, unknown> = { todoId: item.todoId };
    if (
      typeof item.batchTaskId === 'number' &&
      Number.isFinite(item.batchTaskId)
    ) {
      payload['batchTaskId'] = item.batchTaskId;
    }
    if (typeof item.taskId === 'string' && item.taskId.length > 0) {
      payload['taskId'] = item.taskId;
    }
    if (typeof item.platform === 'string' && item.platform.length > 0) {
      payload['platform'] = item.platform;
    }
    if (typeof item.canvasId === 'number' && Number.isFinite(item.canvasId)) {
      payload['canvasId'] = item.canvasId;
    }
    if (typeof item.taskCount === 'number' && Number.isFinite(item.taskCount)) {
      payload['taskCount'] = item.taskCount;
    }
    if (typeof item.status === 'string' && item.status.length > 0) {
      payload['status'] = item.status;
    }
    if (Array.isArray(item.tasksPreview) && item.tasksPreview.length > 0) {
      payload['tasksPreview'] = item.tasksPreview;
    }
    return `\n\n\`\`\`task-it\n${JSON.stringify(payload)}\n\`\`\`\n`;
  }

  private appendTaskItIfNeeded(
    text: string,
    toolResults?: Array<{ name?: unknown; output?: unknown }>,
  ): string {
    const base = typeof text === 'string' ? text : String(text ?? '');
    const existing = new Set<number>();
    const re = /```task-it\s*([\s\S]*?)```/gi;
    base.replace(re, (_full, body) => {
      const items = this.extractTaskItItems(body);
      for (const it of items) existing.add(Number(it.todoId));
      return '';
    });

    const results = Array.isArray(toolResults) ? toolResults : [];
    const fromTools = results
      .flatMap((tr) =>
        this.extractTaskItItems((tr as { output?: unknown })?.output),
      )
      .filter((it) => Number.isFinite(Number(it.todoId)));

    const unique: Array<{
      todoId: number;
      batchTaskId?: number;
      taskId?: string;
      platform?: string;
      canvasId?: number;
      taskCount?: number;
      status?: string;
      tasksPreview?: string[];
    }> = [];
    const seen = new Set<number>(existing);
    for (const it of fromTools) {
      const tid = Number(it.todoId);
      if (!Number.isFinite(tid) || seen.has(tid)) continue;
      seen.add(tid);
      unique.push(it);
    }
    if (unique.length === 0) return base;

    return base + unique.map((it) => this.buildTaskItBlock(it)).join('');
  }

  private buildCanvasItBlock(item: {
    canvasId: number;
    status?: string;
    topic?: string;
    platform?: string;
    articleCount?: number;
    needFields?: string[];
  }): string {
    const payload: Record<string, unknown> = { canvasId: item.canvasId };
    if (typeof item.status === 'string' && item.status.length > 0) {
      payload['status'] = item.status;
    }
    if (typeof item.topic === 'string' && item.topic.length > 0) {
      payload['topic'] = item.topic;
    }
    if (typeof item.platform === 'string' && item.platform.length > 0) {
      payload['platform'] = item.platform;
    }
    if (
      typeof item.articleCount === 'number' &&
      Number.isFinite(item.articleCount)
    ) {
      payload['articleCount'] = item.articleCount;
    }
    if (Array.isArray(item.needFields) && item.needFields.length > 0) {
      payload['needFields'] = item.needFields;
    }
    return `\n\n\`\`\`canvas-it\n${JSON.stringify(payload)}\n\`\`\`\n`;
  }

  private appendCanvasItIfNeeded(
    text: string,
    toolResults?: Array<{ name?: unknown; output?: unknown }>,
  ): string {
    const base = typeof text === 'string' ? text : String(text ?? '');
    const re = /```canvas-it\s*([\s\S]*?)```/gi;
    const cleaned = base.replace(re, '').trimEnd();

    const results = Array.isArray(toolResults) ? toolResults : [];
    const fromTools = results
      .flatMap((tr) =>
        this.extractCanvasItItems((tr as { output?: unknown })?.output),
      )
      .filter((it) => Number.isFinite(Number(it.canvasId)));

    const unique: Array<{
      canvasId: number;
      status?: string;
      needFields?: string[];
    }> = [];
    const seen = new Set<number>();
    for (const it of fromTools) {
      const cid = Number(it.canvasId);
      if (!Number.isFinite(cid) || seen.has(cid)) continue;
      seen.add(cid);
      unique.push({
        canvasId: cid,
        status: it.status,
        needFields: it.needFields,
      });
    }
    if (unique.length === 0) return base;

    const last = unique[unique.length - 1];
    return cleaned + this.buildCanvasItBlock(last);
  }

  private extractDecisionItems(output: unknown): Array<{
    cardId: string;
    decisionSummary?: string;
    title?: string;
    recommendation?: string;
    actions?: string[];
    risks?: string[];
    status?: string;
  }> {
    const out: Array<{
      cardId: string;
      decisionSummary?: string;
      title?: string;
      recommendation?: string;
      actions?: string[];
      risks?: string[];
      status?: string;
    }> = [];
    const tryPush = (obj: Record<string, unknown>) => {
      const cardIdRaw = obj['cardId'] ?? obj['card_id'] ?? obj['id'];
      let cardId = '';
      if (typeof cardIdRaw === 'string') {
        cardId = cardIdRaw.trim();
      } else if (
        typeof cardIdRaw === 'number' ||
        typeof cardIdRaw === 'bigint'
      ) {
        cardId = String(cardIdRaw);
      }
      if (!cardId) return;
      const renderPayload =
        obj['cardRenderPayload'] && typeof obj['cardRenderPayload'] === 'object'
          ? (obj['cardRenderPayload'] as Record<string, unknown>)
          : {};
      const actions = Array.isArray(renderPayload['actions'])
        ? (renderPayload['actions'] as unknown[])
            .filter((x) => typeof x === 'string')
            .map((x) => String(x))
        : undefined;
      const risks = Array.isArray(renderPayload['risks'])
        ? (renderPayload['risks'] as unknown[])
            .filter((x) => typeof x === 'string')
            .map((x) => String(x))
        : undefined;
      out.push({
        cardId,
        decisionSummary:
          typeof obj['decisionSummary'] === 'string'
            ? obj['decisionSummary']
            : typeof renderPayload['summary'] === 'string'
              ? renderPayload['summary']
              : undefined,
        title:
          typeof renderPayload['title'] === 'string'
            ? renderPayload['title']
            : undefined,
        recommendation:
          typeof renderPayload['recommendation'] === 'string'
            ? renderPayload['recommendation']
            : undefined,
        actions,
        risks,
        status:
          typeof renderPayload['status'] === 'string'
            ? renderPayload['status']
            : undefined,
      });
    };
    if (output && typeof output === 'object') {
      tryPush(output as Record<string, unknown>);
      return out;
    }
    if (typeof output !== 'string') return out;
    const s = output.trim();
    if (!s) return out;
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(s);
        if (Array.isArray(parsed)) {
          for (const it of parsed) {
            if (it && typeof it === 'object')
              tryPush(it as Record<string, unknown>);
          }
        } else if (parsed && typeof parsed === 'object') {
          tryPush(parsed as Record<string, unknown>);
        }
      } catch {
        void 0;
      }
    }
    return out;
  }

  private buildDecisionItBlock(item: {
    cardId: string;
    title?: string;
    decisionSummary?: string;
    recommendation?: string;
    actions?: string[];
    risks?: string[];
    status?: string;
  }): string {
    const payload: Record<string, unknown> = { cardId: item.cardId };
    if (typeof item.title === 'string' && item.title.length > 0) {
      payload['title'] = item.title;
    }
    if (
      typeof item.decisionSummary === 'string' &&
      item.decisionSummary.length > 0
    ) {
      payload['summary'] = item.decisionSummary;
    }
    if (
      typeof item.recommendation === 'string' &&
      item.recommendation.length > 0
    ) {
      payload['recommendation'] = item.recommendation;
    }
    if (Array.isArray(item.actions) && item.actions.length > 0) {
      payload['actions'] = item.actions;
    }
    if (Array.isArray(item.risks) && item.risks.length > 0) {
      payload['risks'] = item.risks;
    }
    if (typeof item.status === 'string' && item.status.length > 0) {
      payload['status'] = item.status;
    }
    return `\n\n\`\`\`decision-it\n${JSON.stringify(payload)}\n\`\`\`\n`;
  }

  private appendDecisionSummaryIfNeeded(
    text: string,
    toolResults?: Array<{ name?: unknown; output?: unknown }>,
  ): string {
    const base = typeof text === 'string' ? text : String(text ?? '');
    const first = (toolResults ?? [])
      .flatMap((tr) =>
        this.extractDecisionItems((tr as { output?: unknown }).output),
      )
      .find(
        (it) =>
          typeof it.decisionSummary === 'string' &&
          it.decisionSummary.length > 0,
      );
    if (!first || !first.decisionSummary) return base;
    if (base.includes('决策已生成')) return base;
    return `${base}\n\n决策已生成：${first.decisionSummary}`;
  }

  private appendDecisionItIfNeeded(
    text: string,
    toolResults?: Array<{ name?: unknown; output?: unknown }>,
  ): string {
    const base = typeof text === 'string' ? text : String(text ?? '');
    const existing = new Set<string>();
    const re = /```decision-it\s*([\s\S]*?)```/gi;
    base.replace(re, (_full, body) => {
      const arr = this.extractDecisionItems(body);
      for (const it of arr) existing.add(String(it.cardId));
      return '';
    });
    const fromTools = (toolResults ?? [])
      .flatMap((tr) =>
        this.extractDecisionItems((tr as { output?: unknown }).output),
      )
      .filter((it) => it.cardId && String(it.cardId).length > 0);
    const uniq: Array<{
      cardId: string;
      title?: string;
      decisionSummary?: string;
      recommendation?: string;
      actions?: string[];
      risks?: string[];
      status?: string;
    }> = [];
    const seen = new Set<string>(existing);
    for (const it of fromTools) {
      const id = String(it.cardId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      uniq.push(it);
    }
    if (uniq.length === 0) return base;
    return base + uniq.map((it) => this.buildDecisionItBlock(it)).join('');
  }

  private shouldUseAnalysis(text: string): boolean {
    const kws = [
      '数据',
      '统计',
      '记录',
      '查询',
      'search',
      'count',
      '分析',
      'report',
      '报表',
      '数据库',
    ];
    for (const k of kws) if (text.includes(k)) return true;
    return false;
  }

  private shouldUseFrontend(text: string): boolean {
    const kws = [
      '页面',
      '图表',
      '可视化',
      'dashboard',
      'echarts',
      '表格',
      '报表',
      '渲染',
    ];
    for (const k of kws) if (text.includes(k)) return true;
    return false;
  }

  private extractKeywordsFast(input: string): string[] {
    const val = String(input || '');
    const set = new Set<string>();
    const lower = val.toLowerCase();
    const english = lower.match(/[a-z][a-z0-9-]{1,}/g) ?? [];
    const stop = new Set<string>([
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'have',
      'has',
      'are',
      'was',
      'were',
      'is',
      'of',
      'to',
      'in',
      'on',
      'at',
      'by',
      'it',
      'but',
      'can',
      'could',
      'should',
      'would',
      'will',
      'do',
      'does',
      'did',
    ]);
    for (const w of english) {
      if (w.length > 2 && !stop.has(w)) set.add(w);
    }
    const chineseSeq = val.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
    for (const seq of chineseSeq) set.add(seq);
    return Array.from(set);
  }

  private getDefaultRecursionLimit(input: string, toolCount: number): number {
    const complexity = this.extractKeywordsFast(input).length;
    let base = toolCount > 1 ? 28 : 16;
    if (complexity >= 6) base = 48;
    else if (complexity >= 3) base = base + 8;
    return base;
  }
}

interface MessageEvent {
  data: unknown;
  id?: string;
  type?: string;
  retry?: number;
}
