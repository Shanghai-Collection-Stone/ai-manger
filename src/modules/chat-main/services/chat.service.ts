import { Injectable } from '@nestjs/common';
import { ContextService } from '../../context/services/context.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { ChatRequest, ChatResponse } from '../types/chat.types';
import {
  BaseMessage,
  AIMessage,
  CreateAgentParams,
  ToolMessage,
  HumanMessage,
  SystemMessage,
} from 'langchain';
import { ContextRole } from '../../context/enums/context.enums';
import { MessagePart } from '../../context/types/context.types';
import { ToolsService } from '../../function-call/tools/services/tools.service.js';
import { TitleFunctionCallService } from '../../function-call/title/services/title.service.js';
import { RetrievalService } from '../../ai-context/services/retrieval.service.js';
import { KeywordService } from '../../ai-context/services/keyword.service.js';
import { Observable } from 'rxjs';

/**
 * @title 主对话服务 Chat-Main Service
 * @description 封装流式与非流式对话流程，并提供上下文CRUD接口。
 * @keywords-cn 主对话, 流式, 非流式, 上下文CRUD
 * @keywords-en chat main, streaming, non-streaming, context CRUD
 */
@Injectable()
export class ChatMainService {
  constructor(
    private readonly ctx: ContextService,
    private readonly agent: AgentService,
    private readonly tools: ToolsService,
    private readonly titleTools: TitleFunctionCallService,
    private readonly retrieval: RetrievalService,
    private readonly keywordTools: KeywordService,
  ) {}

  private readonly HITL_PLACEHOLDER = '##HITL_REQUIRED_FRONTEND##';

  /**
   * @title 非流式发送 Send (non-stream)
   * @description 追加用户消息，执行Agent回复，并写入上下文。
   * @keywords-cn 非流式, 同步
   * @keywords-en non-streaming, sync
   */
  async send(request: ChatRequest): Promise<ChatResponse> {
    const sid = await this.ctx.createSession(request.sessionId);
    await this.ctx.appendMessage(sid, {
      role: ContextRole.User,
      content: request.input,
    });
    try {
      const meta = await this.ctx.getConversation(sid);
      if (!meta || !meta.title || meta.title.trim().length === 0) {
        const t = this.provisionalTitle(request.input);
        if (t && t.length > 0) await this.ctx.setTitle(sid, t);
      }
    } catch (e) {
      void e;
    }

    const now = request.now ?? new Date().toISOString();
    const ip = request.ip ?? '';
    const sysContent = [
      `SESSION_ID:${sid}`,
      `REQUEST_TIME_ISO:${now}`,
      ip ? `CLIENT_IP:${ip}` : 'CLIENT_IP:unknown',
      this.getDataAnalysisPromptCN(),
    ].join('\n');

    // checkpoint 会根据 thread_id 自动获取上下文，只需传入最新消息
    const messages: BaseMessage[] = [new HumanMessage(request.input)];
    const tools = this.getToolsForInput(request.input);
    const checkpoint_id =
      (await this.ctx.getConversation(sid))?.lastCheckpointId ?? 'root';
    const ai = await this.agent.runWithMessages({
      config: {
        provider: request.provider ?? 'deepseek',
        model: request.model ?? 'deepseek-chat',
        temperature: request.temperature ?? 0.5,
        tools,
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

    await this.ctx.appendMessage(sid, {
      role: ContextRole.Assistant,
      content: text,
      tool_calls:
        Array.isArray(nonStreamToolCalls) && nonStreamToolCalls.length > 0
          ? nonStreamToolCalls
          : undefined,
      tool_results: directToolResults ?? derivedToolResults,
    });

    this.titleTools.ensureFirstTurnTitle(sid).catch(() => {});
    // 异步补充关键词
    this.retrieval.reindexSession(sid).catch((e) => console.error(e));
    // 更新最新checkpoint id
    this.ctx
      .getLatestCheckpointId(sid)
      .then((cid) => (cid ? this.ctx.setLastCheckpointId(sid, cid) : undefined))
      .catch(() => {});
    return { text, messages };
  }

  /**
   * @title 流式发送 Stream
   * @description 返回事件流，包含令牌与最终消息，并维护上下文。
   * @keywords-cn 流式, 事件
   * @keywords-en streaming, events
   */
  stream(request: ChatRequest): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const safeNext = (event: MessageEvent) => {
        if (subscriber.closed) return;
        try {
          subscriber.next(event);
        } catch (err) {
          void err;
        }
      };
      void (async () => {
        try {
          const sid = await this.ctx.createSession(request.sessionId);
          await this.ctx.appendMessage(sid, {
            role: ContextRole.User,
            content: request.input,
          });
          try {
            const meta = await this.ctx.getConversation(sid);
            if (!meta || !meta.title || meta.title.trim().length === 0) {
              const t = this.provisionalTitle(request.input);
              if (t && t.length > 0) await this.ctx.setTitle(sid, t);
            }
          } catch (e) {
            void e;
          }

          const now = request.now ?? new Date().toISOString();
          const ip = request.ip ?? '';
          const sysContent = [
            `SESSION_ID:${sid}`,
            `REQUEST_TIME_ISO:${now}`,
            ip ? `CLIENT_IP:${ip}` : 'CLIENT_IP:unknown',
            this.getDataAnalysisPromptCN(),
          ].join('\n');

          // checkpoint 会根据 thread_id 自动获取上下文，只需传入最新消息
          const messages: BaseMessage[] = [new HumanMessage(request.input)];

          const streamWriter = (msg: string) => {
            safeNext({ type: 'log', data: msg } as MessageEvent);
          };

          const tools = this.getToolsForInput(request.input, streamWriter);
          const checkpoint_id =
            (await this.ctx.getConversation(sid))?.lastCheckpointId ?? 'root';
          const iterable = this.agent.stream({
            config: {
              provider: request.provider ?? 'deepseek',
              model: request.model ?? 'deepseek-chat',
              temperature: request.temperature ?? 0.1,
              tools,
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

          let fullContent = '';
          const toolCallMap = new Map<
            string,
            { id: string; name: string; input: unknown }
          >();
          const toolResultMap = new Map<
            string,
            { id: string; name?: string; output: unknown }
          >();
          const argsBuffer = new Map<string, string>();
          const parts: MessagePart[] = [];

          for await (const e of iterable) {
            // Forward all events to SSE, include thread_id for correlation
            safeNext({
              data: { ...(e as any), thread_id: sid },
            } as MessageEvent);

            switch (e.type) {
              case 'token': {
                const text = e.data.text;
                fullContent += text;
                // 更新或添加 text part
                const lastPart = parts[parts.length - 1];
                if (lastPart && lastPart.type === 'text') {
                  lastPart.content += text;
                } else {
                  parts.push({ type: 'text', content: text });
                }
                break;
              }
              case 'tool_start': {
                const { id, name, input } = e.data;
                if (id) {
                  toolCallMap.set(id, { id, name, input });
                  parts.push({ type: 'tool_call', id, name, input });
                }
                break;
              }
              case 'tool_chunk': {
                const { id, args } = e.data;
                if (id && args) {
                  const current = argsBuffer.get(id) || '';
                  argsBuffer.set(id, current + args);

                  // 更新对应的 tool_call part
                  // 注意：tool_chunk 可能在 tool_start 之后
                  // 但 parts 里的 tool_call 已经添加了
                  // 这里暂不更新 parts 里的 input，因为 args 是流式的 JSON 字符串
                }
                break;
              }
              case 'tool_end': {
                const { id, name, output } = e.data;
                if (id) {
                  toolResultMap.set(id, { id, name, output });
                  parts.push({ type: 'tool_result', id, name, output });
                }
                break;
              }
              case 'end': {
                const { text } = e.data;
                // 只在 fullContent 为空时才使用 end 事件的 text，避免覆盖流式累积的内容
                if (
                  fullContent.trim().length === 0 &&
                  text &&
                  text.trim().length > 0
                ) {
                  fullContent = text;
                  // 更新 parts
                  if (parts.length === 0) {
                    parts.push({ type: 'text', content: text });
                  } else {
                    const lastPart = parts[parts.length - 1];
                    if (lastPart.type === 'text') {
                      lastPart.content = text;
                    } else {
                      parts.push({ type: 'text', content: text });
                    }
                  }
                }
                break;
              }
            }
          }

          // Merge buffered args into toolCallMap AND parts
          for (const [id, jsonStr] of argsBuffer) {
            const call = toolCallMap.get(id);
            if (call) {
              try {
                const parsed = JSON.parse(jsonStr) as unknown;
                call.input = parsed;
                // 更新 parts 中的 input
                const part = parts.find(
                  (p) => p.type === 'tool_call' && p.id === id,
                );
                if (part && part.type === 'tool_call') {
                  part.input = parsed;
                }
              } catch {
                // Ignore parse error, keep original input or partial
              }
            }
          }

          // Save context
          // Check for HITL (Human in the loop)
          try {
            const hitl = Array.from(toolResultMap.values()).some((tr) => {
              const out = tr.output;
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
            });
            if (hitl) {
              fullContent = this.HITL_PLACEHOLDER;
              // 更新 parts？ HITL 可能意味着 content 改变
            }
          } catch {
            void 0;
          }

          // Build final tool results
          const finalToolResults = Array.from(toolResultMap.values()).map(
            (tr) => {
              const call = toolCallMap.get(tr.id);
              return {
                id: tr.id,
                name: call?.name ?? tr.name,
                input: call?.input,
                output: tr.output,
              };
            },
          );

          await this.ctx.appendMessage(sid, {
            role: ContextRole.Assistant,
            content: this.sanitizeFinalText(fullContent),
            parts: parts.length > 0 ? parts : undefined,
            tool_calls:
              toolCallMap.size > 0
                ? Array.from(toolCallMap.values())
                : undefined,
            tool_results:
              finalToolResults.length > 0 ? finalToolResults : undefined,
          });

          this.titleTools.ensureFirstTurnTitle(sid).catch(() => {});
          this.retrieval.reindexSession(sid).catch((e) => console.error(e));
          this.ctx
            .getLatestCheckpointId(sid)
            .then((cid) =>
              cid ? this.ctx.setLastCheckpointId(sid, cid) : undefined,
            )
            .catch(() => {});

          if (!subscriber.closed) subscriber.complete();
        } catch (err: unknown) {
          const e = err instanceof Error ? err : new Error(String(err));
          const rec = e as unknown as Record<string, unknown>;
          const codeVal = rec['lc_error_code'];
          const code = typeof codeVal === 'string' ? codeVal : undefined;
          const payload = {
            type: 'error',
            data: {
              code,
              message: e.message,
              can_continue: code === 'GRAPH_RECURSION_LIMIT',
            },
          };
          safeNext({ data: payload } as MessageEvent);
          if (!subscriber.closed) subscriber.complete();
        }
      })();
    });
  }

  /**
   * @title 智能上下文构建 Smart Context
   * @description 根据输入与历史记录构建上下文，支持长上下文检索与工具调用过滤。
   * @keywords-cn 智能上下文, 检索, 过滤
   * @keywords-en smart context, retrieval, filtering
   */
  private toCheckpointMessages(
    contextMessages: import('../../context/types/context.types').ContextMessage[],
  ): BaseMessage[] {
    const recent = contextMessages.slice(-20);
    const messages: BaseMessage[] = [];
    for (const m of recent) {
      if (m.role === ContextRole.System) {
        messages.push(new SystemMessage(m.content));
      } else if (m.role === ContextRole.User) {
        messages.push(new HumanMessage(m.content));
      } else if (m.role === ContextRole.Assistant) {
        const rawToolCalls = (
          (m.tool_calls as
            | Array<{ id: string; name: string; input: unknown }>
            | undefined) || []
        ).map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.input as Record<string, unknown>,
        }));

        const allowedToolNames = new Set(
          (this.getTools() ?? []).map(
            (t) => (t as unknown as { name?: string }).name ?? '',
          ),
        );
        const filteredToolCalls = rawToolCalls.filter((c) =>
          allowedToolNames.has(c.name),
        );

        const results =
          (m.tool_results as
            | Array<{
                id: string;
                name?: string;
                output: unknown;
              }>
            | undefined) || [];
        const resultMap = new Map(results.map((r) => [r.id, r]));

        const matchedCalls = filteredToolCalls.filter((c) =>
          resultMap.has(c.id),
        );
        if (matchedCalls.length === 0) {
          messages.push(new AIMessage({ content: m.content }));
        } else {
          for (let i = 0; i < matchedCalls.length; i += 5) {
            const batchCalls = matchedCalls.slice(i, i + 5);
            messages.push(
              new AIMessage({
                content: i === 0 ? m.content : '',
                tool_calls: batchCalls.map((c) => ({
                  id: c.id,
                  name: c.name,
                  args: c.args,
                })),
              }),
            );
            for (const call of batchCalls) {
              const tr = resultMap.get(call.id)!;
              messages.push(
                new ToolMessage({
                  tool_call_id: tr.id,
                  content:
                    typeof tr.output === 'string'
                      ? tr.output
                      : JSON.stringify(tr.output),
                }),
              );
            }
          }
        }
      }
    }
    return messages;
  }

  /**
   * @title 上下文CRUD Context CRUD
   * @description 提供会话创建、消息读取与清理操作的封装。
   * @keywords-cn 上下文, CRUD
   * @keywords-en context, CRUD
   */
  async createSession(sessionId?: string): Promise<string> {
    return this.ctx.createSession(sessionId);
  }

  async appendUser(sessionId: string, content: string): Promise<void> {
    await this.ctx.appendMessage(sessionId, {
      role: ContextRole.User,
      content,
    });
  }

  async appendAssistant(sessionId: string, content: string): Promise<void> {
    await this.ctx.appendMessage(sessionId, {
      role: ContextRole.Assistant,
      content,
    });
  }

  async getMessages(
    sessionId: string,
    limit?: number,
  ): Promise<
    Array<
      import('../../context/types/context.types').ContextMessage & {
        fingerprint: string;
      }
    >
  > {
    const history = await this.ctx.getMessages(sessionId, limit);
    const deleted = await this.ctx.getDeletedFingerprints(sessionId);
    const enriched = (history ?? []).map((m, idx) => {
      const fingerprint = this.ctx.fingerprintMessage(sessionId, m, idx);
      return { ...m, fingerprint };
    });
    return enriched.filter((m) =>
      m.fingerprint ? !deleted.has(m.fingerprint) : true,
    );
  }

  async deleteMessages(
    sessionId: string,
    params?: { fingerprints?: string[]; indexes?: number[] },
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
      const visible = await this.getMessages(sessionId);
      const uniq = Array.from(new Set(idxs.map((n) => Math.trunc(n))));
      for (const i of uniq) {
        if (i < 0 || i >= visible.length) continue;
        const fp = visible[i].fingerprint;
        if (fp) fingerprints.push(fp);
      }
    }

    const uniqueFps = Array.from(new Set(fingerprints));
    if (uniqueFps.length > 0) {
      await this.ctx.markDeletedFingerprints(sessionId, uniqueFps);
    }
    return { deleted: uniqueFps.length };
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.ctx.clearSession(sessionId);
  }

  private extractText(ai: AIMessage): string {
    const content = ai.content;
    if (typeof content === 'string') {
      return content;
    }
    return JSON.stringify(content);
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
      // 内容清洗策略：
      // - 如果 JSON 被识别为工具数据，则剥离 JSON 头部，仅保留其后的正文。
      // - 若其后没有正文（rest 为空），为了避免 message.content 丢失，保留原文 s。
      if (isToolJson) return rest.length > 0 ? rest : s;
      return s;
    } catch {
      return s;
    }
  }

  private ensureStringArray(
    v: unknown,
    fallback: string[] = ['data_analysis'],
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

  private getDataAnalysisPromptCN(): string {
    return [
      '你是一名务实的中文数据分析与页面生成助理。',
      '以“满足用户当前需求”为准则执行，不要进行不必要的数据获取或分析。',
      '仅当用户明确提出需要数据、统计、具体记录或数据库信息时，调用 data_analysis；仅当用户明确提出需要生成页面、图表或可视化时，调用 frontend_plan 或 frontend_finalize。',
      '[重要]只有用户提出生成报表等类似字眼,才生成页面,否则不要随意生成报表页面',
      'data_analysis 返回 JSON 以辅助回答；若已能直接回答问题，请用现有数据简洁回答。',
      '[重要]data_analysis 有时候会有问题返回,格式一般为 { question:xx }, 把对应的内容返回给用户,让用户确定一下吧。',
      '若 frontend_finalize 产生外链，请不要在回答中返回任何代码或说明文字。',
      '若工具返回失败或为空，请直接告知并询问是否继续。',
      '若用户要进行“小红书发布/发布到小红书/MCP发布”等操作，必须先拿到参考图的绝对路径或可访问URL数组；若用户未提供，请先要求用户上传参考图（不要臆测图片）。',
      '若用户要求Ai配图那就用ai现有数据配张网络图片吧,不强制一定要绝对路径的图片',
      '[重要] UI 框架(uiFramework) 与 布局(layout) 必须由用户明确提供，不得由 AI 猜测；缺失时直接返回占位符：##HITL_REQUIRED_FRONTEND##。',
      '当 frontend_plan 或 frontend_finalize 返回 requires_human=true 或 missing 非空时，不继续生成页面，直接返回占位符：##HITL_REQUIRED_FRONTEND##。',
      '避免在工具间反复循环；完成一次工具调用后直接输出答案或结果。',
    ].join('\n');
  }

  private getTools(
    streamWriter?: (msg: string) => void,
  ): CreateAgentParams['tools'] {
    return this.tools.getHandle(streamWriter);
  }

  private getToolsForInput(
    _input: string,
    streamWriter?: (msg: string) => void,
  ): CreateAgentParams['tools'] {
    return this.getTools(streamWriter);
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
