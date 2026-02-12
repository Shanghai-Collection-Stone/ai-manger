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
        provider: request.provider ?? 'nvidia',
        model: request.model ?? 'deepseek-ai/deepseek-v3.1-terminus',
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

    text = this.appendCanvasItIfNeeded(
      text,
      directToolResults ?? derivedToolResults,
    );

    text = this.appendTaskItIfNeeded(
      text,
      directToolResults ?? derivedToolResults,
    );

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
        let sid: string | null = null;
        try {
          sid = await this.ctx.createSession(request.sessionId);
          if (!sid) throw new Error('SESSION_ID_MISSING');
          const sessionId = sid;
          await this.ctx.appendMessage(sessionId, {
            role: ContextRole.User,
            content: request.input,
          });
          try {
            const meta = await this.ctx.getConversation(sessionId);
            if (!meta || !meta.title || meta.title.trim().length === 0) {
              const t = this.provisionalTitle(request.input);
              if (t && t.length > 0) await this.ctx.setTitle(sessionId, t);
            }
          } catch (e) {
            void e;
          }

          const now = request.now ?? new Date().toISOString();
          const ip = request.ip ?? '';
          const sysContent = [
            `SESSION_ID:${sessionId}`,
            `REQUEST_TIME_ISO:${now}`,
            ip ? `CLIENT_IP:${ip}` : 'CLIENT_IP:unknown',
            this.getDataAnalysisPromptCN(),
          ].join('\n');

          // checkpoint 会根据 thread_id 自动获取上下文，只需传入最新消息
          const messages: BaseMessage[] = [new HumanMessage(request.input)];

          const streamWriter = (msg: string) => {
            safeNext({
              data: {
                type: 'log',
                data: msg,
                thread_id: sid,
              },
            } as MessageEvent);
          };

          const tools = this.getToolsForInput(request.input, streamWriter);
          const checkpoint_id =
            (await this.ctx.getConversation(sessionId))?.lastCheckpointId ??
            'root';

          const toolTimeoutMs = 0;
          const abortController = new AbortController();
          const toolTimers = new Map<string, ReturnType<typeof setTimeout>>();
          const pendingToolIds = new Set<string>();
          let timedOutToolId: string | null = null;
          const toolDebug =
            process.env.TOOL_DEBUG === '1'
              ? true
              : process.env.TOOL_DEBUG === '0'
                ? false
                : process.env.NODE_ENV !== 'production';

          const noTimeoutToolNames = new Set<string>(['topic_orchestrate']);

          const iterable = this.agent.stream({
            config: {
              provider: request.provider ?? 'nvidia',
              model: request.model ?? 'deepseek-ai/deepseek-v3.1-terminus',
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
              signal: abortController.signal,
              configurable: {
                thread_id: sid,
                checkpoint_ns: 'default',
                checkpoint_id: checkpoint_id,
              },
            },
          });

          let fullContent = '';
          const injectedCanvasIds = new Set<number>();
          const injectedTodoIds = new Set<number>();
          const toolCallMap = new Map<
            string,
            { id: string; name: string; input: unknown }
          >();
          const toolResultMap = new Map<
            string,
            { id: string; name?: string; output: unknown }
          >();
          const argsBuffer = new Map<string, string>();
          const toolChunkCount = new Map<string, number>();
          const debugToolNames = new Set<string>([]);
          const parts: MessagePart[] = [];

          const safeNextStreamEvent = (payload: {
            type: string;
            data: Record<string, unknown>;
          }) => {
            safeNext({
              data: {
                type: payload.type,
                data: { ...payload.data },
                thread_id: sid,
              },
            } as MessageEvent);
          };

          const emitToolStart = (input: {
            id?: string;
            name?: string;
            input?: unknown;
          }) => {
            if (!input.id) return;
            safeNextStreamEvent({
              type: 'tool_start',
              data: { id: input.id, name: input.name, input: input.input },
            });
          };

          const emitToolEnd = (input: {
            id?: string;
            name?: string;
            input?: unknown;
            output?: unknown;
          }) => {
            if (!input.id) return;
            safeNextStreamEvent({
              type: 'tool_end',
              data: {
                id: input.id,
                name: input.name,
                input: input.input,
                output: input.output,
              },
            });
          };

          const appendAssistantText = (text: string) => {
            const s = String(text ?? '');
            if (!s) return;
            fullContent += s;
            const lastPart = parts[parts.length - 1];
            if (lastPart && lastPart.type === 'text') {
              lastPart.content += s;
            } else {
              parts.push({ type: 'text', content: s });
            }
          };

          const clearToolTimer = (id: string) => {
            const h = toolTimers.get(id);
            if (h) clearTimeout(h);
            toolTimers.delete(id);
          };

          const markToolDone = (id: string) => {
            clearToolTimer(id);
            pendingToolIds.delete(id);
          };

          const startToolTimer = (id: string) => {
            if (toolTimeoutMs <= 0) return;
            clearToolTimer(id);
            const h = setTimeout(() => {
              if (toolResultMap.has(id)) return;
              if (!pendingToolIds.has(id)) return;
              timedOutToolId = id;
              abortController.abort(
                new Error(`TOOL_TIMEOUT_${toolTimeoutMs}ms`),
              );
            }, toolTimeoutMs);
            toolTimers.set(id, h);
          };

          const synthesizePendingToolResults = (err: unknown) => {
            const errorObj =
              err instanceof Error ? err : new Error(String(err));
            for (const id of Array.from(pendingToolIds)) {
              const call = toolCallMap.get(id);
              const name = call?.name ?? '';
              const output = {
                ok: false,
                error: id === timedOutToolId ? 'TOOL_TIMEOUT' : 'TOOL_ERROR',
                message: errorObj.message,
              };
              toolResultMap.set(id, { id, name, output });
              parts.push({ type: 'tool_result', id, name, output });
              emitToolEnd({ id, name, input: call?.input, output });
              markToolDone(id);
            }

            if (fullContent.trim().length === 0) {
              const msg =
                timedOutToolId && toolCallMap.get(timedOutToolId)?.name
                  ? `工具调用超时（${Math.floor(toolTimeoutMs / 1000)}s）：${toolCallMap.get(timedOutToolId)?.name}`
                  : `工具调用失败：${errorObj.message}`;
              appendAssistantText(msg);
              safeNextStreamEvent({
                type: 'token',
                data: { text: msg },
              });
            }
          };

          try {
            for await (const e of iterable) {
              switch (e.type) {
                case 'token': {
                  appendAssistantText(e.data.text);
                  safeNextStreamEvent({
                    type: 'token',
                    data: { text: e.data.text },
                  });
                  break;
                }
                case 'reasoning': {
                  safeNextStreamEvent({
                    type: 'reasoning',
                    data: { text: e.data.text },
                  });
                  break;
                }
                case 'tool_start': {
                  const { id, name, input } = e.data;
                  if (id) {
                    const existing = toolCallMap.get(id);
                    if (existing) {
                      if (typeof name === 'string' && name.length > 0) {
                        existing.name = name;
                      }
                      if (typeof input !== 'undefined') {
                        existing.input = input;
                      }
                      const part = parts.find(
                        (p) => p.type === 'tool_call' && p.id === id,
                      );
                      if (part && part.type === 'tool_call') {
                        if (typeof name === 'string' && name.length > 0) {
                          part.name = name;
                        }
                        if (typeof input !== 'undefined') {
                          part.input = input;
                        }
                      }
                    } else {
                      toolCallMap.set(id, { id, name, input });
                      parts.push({ type: 'tool_call', id, name, input });
                      pendingToolIds.add(id);
                      if (!noTimeoutToolNames.has(String(name ?? ''))) {
                        startToolTimer(id);
                      }
                    }
                  }
                  if (toolDebug && debugToolNames.has(String(name ?? ''))) {
                    console.log('[Chat.stream] tool_start', {
                      id,
                      name,
                      inputType: typeof input,
                    });
                  }
                  emitToolStart({ id, name, input });
                  break;
                }
                case 'tool_chunk': {
                  const { id, args } = e.data;
                  if (id && !toolCallMap.has(id)) {
                    const toolName =
                      typeof (e.data as { name?: unknown }).name === 'string'
                        ? ((e.data as { name?: unknown }).name as string)
                        : '';
                    toolCallMap.set(id, {
                      id,
                      name: toolName,
                      input: undefined,
                    });
                    parts.push({
                      type: 'tool_call',
                      id,
                      name: toolName,
                      input: undefined,
                    });
                    pendingToolIds.add(id);
                    if (!noTimeoutToolNames.has(String(toolName ?? ''))) {
                      startToolTimer(id);
                    }
                    emitToolStart({ id, name: toolName, input: undefined });
                  }
                  if (id && args) {
                    const current = argsBuffer.get(id) || '';
                    argsBuffer.set(id, current + args);
                    const nextCount = (toolChunkCount.get(id) ?? 0) + 1;
                    toolChunkCount.set(id, nextCount);
                    const toolName = toolCallMap.get(id)?.name;
                    if (
                      toolDebug &&
                      nextCount <= 3 &&
                      debugToolNames.has(String(toolName ?? ''))
                    ) {
                      console.log('[Chat.stream] tool_chunk', {
                        id,
                        chunk: nextCount,
                        argsLen: String(args).length,
                        totalLen: (current + args).length,
                      });
                    }
                  }
                  break;
                }
                case 'tool_end': {
                  const { id, name, output } = e.data;
                  if (id && !toolCallMap.has(id)) {
                    const toolName = typeof name === 'string' ? name : '';
                    toolCallMap.set(id, {
                      id,
                      name: toolName,
                      input: undefined,
                    });
                    parts.push({
                      type: 'tool_call',
                      id,
                      name: toolName,
                      input: undefined,
                    });
                    emitToolStart({ id, name: toolName, input: undefined });
                  }
                  if (id) {
                    toolResultMap.set(id, { id, name, output });
                    parts.push({ type: 'tool_result', id, name, output });
                    markToolDone(id);
                  }

                  let parsedInput: unknown = undefined;
                  if (id) {
                    const rawArgs = argsBuffer.get(id);
                    if (rawArgs && rawArgs.trim().length > 0) {
                      try {
                        parsedInput = JSON.parse(rawArgs);
                      } catch {
                        parsedInput = rawArgs;
                      }
                    } else {
                      parsedInput = toolCallMap.get(id)?.input;
                    }
                  }

                  emitToolEnd({ id, name, input: parsedInput, output });

                  if (toolDebug && debugToolNames.has(String(name ?? ''))) {
                    const rawArgs = id ? argsBuffer.get(id) : undefined;
                    console.log('[Chat.stream] tool_end', {
                      id,
                      name,
                      parsedInputType: typeof parsedInput,
                      rawArgsLen:
                        typeof rawArgs === 'string' ? rawArgs.length : 0,
                      outputType: typeof output,
                    });
                  }

                  const items = this.extractCanvasItItems(output);
                  for (const it of items) {
                    const cid = Number(it.canvasId);
                    if (!Number.isFinite(cid) || injectedCanvasIds.has(cid))
                      continue;
                    injectedCanvasIds.add(cid);

                    const block = this.buildCanvasItBlock(it);
                    safeNextStreamEvent({
                      type: 'token',
                      data: { text: block },
                    });
                    appendAssistantText(block);
                  }

                  const taskItems = this.extractTaskItItems(output);
                  for (const it of taskItems) {
                    const tid = Number(it.todoId);
                    if (!Number.isFinite(tid) || injectedTodoIds.has(tid))
                      continue;
                    injectedTodoIds.add(tid);

                    const block = this.buildTaskItBlock(it);
                    safeNextStreamEvent({
                      type: 'token',
                      data: { text: block },
                    });
                    appendAssistantText(block);
                  }
                  break;
                }
                case 'end': {
                  const { text } = e.data;
                  safeNextStreamEvent({
                    type: 'end',
                    data: { text },
                  });
                  if (
                    fullContent.trim().length === 0 &&
                    text &&
                    text.trim().length > 0
                  ) {
                    fullContent = text;
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
          } catch (err: unknown) {
            synthesizePendingToolResults(err);

            const e = err instanceof Error ? err : new Error(String(err));
            const rec = e as unknown as Record<string, unknown>;
            const codeVal = rec['lc_error_code'];
            const code = typeof codeVal === 'string' ? codeVal : undefined;
            safeNextStreamEvent({
              type: 'error',
              data: {
                code,
                message: e.message,
                can_continue: code === 'GRAPH_RECURSION_LIMIT',
              },
            });
          } finally {
            for (const h of toolTimers.values()) clearTimeout(h);
            toolTimers.clear();
            pendingToolIds.clear();
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

          this.titleTools.ensureFirstTurnTitle(sessionId).catch(() => {});
          this.retrieval
            .reindexSession(sessionId)
            .catch((e) => console.error(e));
          this.ctx
            .getLatestCheckpointId(sessionId)
            .then((cid) =>
              cid ? this.ctx.setLastCheckpointId(sessionId, cid) : undefined,
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
          const threadId = sid ?? request.sessionId;
          safeNext({
            type: payload.type,
            data: {
              type: payload.type,
              data: {
                ...payload.data,
                thread_id: threadId,
              },
              thread_id: threadId,
            },
          } as MessageEvent);
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
      const isCanvasWorkflowJson =
        !!parsed &&
        typeof parsed === 'object' &&
        typeof rec['ok'] === 'boolean' &&
        typeof rec['canvasId'] === 'number';
      // 内容清洗策略：
      // - 如果 JSON 被识别为工具数据，则剥离 JSON 头部，仅保留其后的正文。
      // - 若其后没有正文（rest 为空），为了避免 message.content 丢失，保留原文 s。
      if (isToolJson || isCanvasWorkflowJson)
        return rest.length > 0 ? rest : '';
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

  /**
   * @description 构造对话层系统提示（数据分析/页面生成/批量发布的通用约束）。
   * @returns {string} 中文系统提示文本。
   * @keyword-en system-prompt, data-analysis, batch-publish
   */
  private getDataAnalysisPromptCN(): string {
    return [
      '你是一名务实的中文数据分析与页面生成助理。',
      '以“满足用户当前需求”为准则执行，不要进行不必要的数据获取或分析。',
      '当你通过工具获得 Canvas 信息（例如 canvasId）时，你必须在回复中输出一个 ```canvas-it 代码块；代码块内容必须是 JSON，至少包含 canvasId。',
      '不要在主对话中回显工具的原始 JSON 输出（尤其不要展示 articles/markdown 等长文本）；只需用一句话总结，并输出一个规范的 ```canvas-it JSON 代码块。',
      '如果回复中已经包含 ```canvas-it 代码块，不要重复输出第二个。',
      '除非用户明确说“开始批量发布/批量发布”，否则不要触发发布流程。',
      '当用户明确表示“开始批量发布小红书”且提供了 canvasId 时：直接调用 xhs_batch_publish；不要反复询问开始时间/间隔/登录状态等前置问题。若用户未指定，则 plannedAtStart 不传、intervalMinutes 默认为 0。',
      '发布到小红书时优先走 xhs_batch_publish（由后端编排并异步执行发布流）。',
      '配图规则：优先使用图库工具自动配图。先调用 gallery_list_tags 获取可用标签；再基于文章主题/关键词选择 1-3 个标签调用 gallery_search_images 获取图片（url/thumbUrl/absPath）；将 absPath 写入 xhs_batch_publish 的 payload（会合并到每条任务的 payload）。',
      '当用户表达想做“小红书批量内容/批量软文/系列文章/示例文章”等需求时，先确认主题（topic）与发布平台；然后先调用 topic_orchestrate 生成示例文章 Canvas 供用户查看与修改，用户确认后再进入发布/执行。',
      '当你调用 topic_orchestrate、gallery_list_tags、gallery_search_images、xhs_batch_publish 或 MCP 原生批量发布工具时，如果用户没有明确给出 userId，默认使用 userId="default"。',
      '仅当用户明确提出需要数据、统计、具体记录或数据库信息时，调用 data_analysis；仅当用户明确提出需要生成页面、图表或可视化时，调用 frontend_plan 或 frontend_finalize。',
      '[重要]只有用户提出生成报表等类似字眼,才生成页面,否则不要随意生成报表页面',
      'data_analysis 返回 JSON 以辅助回答；若已能直接回答问题，请用现有数据简洁回答。',
      '[重要]data_analysis 有时候会有问题返回,格式一般为 { question:xx }, 把对应的内容返回给用户,让用户确定一下吧。',
      '若 frontend_finalize 产生外链，请不要在回答中返回任何代码或说明文字。',
      '若工具返回失败或为空，请直接告知并询问是否继续。',
      '仅当用户明确要求“发布/执行/开始批量发布”时，才进入发布流程；发布到小红书时若用户未提供图片，先尝试通过 gallery_list_tags + gallery_search_images 从图库获取；若图库无可用图片再要求用户上传或提供可访问URL。',
      '编排阶段不强制要求图片路径；若用户要求 AI 配图，优先使用现有图库，其次使用可访问网络图片。',
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
  ): CreateAgentParams['tools'] {
    const tools = this.getTools(streamWriter) ?? [];
    if (this.isTopicOrchestrateIntent(input)) {
      return tools.filter(
        (t) => (t as unknown as { name?: string }).name === 'topic_orchestrate',
      );
    }
    return tools;
  }

  private isBatchPublishIntent(input: string): boolean {
    const s = String(input || '').trim();
    if (!s) return false;
    const wantsStart =
      /开始批量发布|立即发布|马上发布|直接发布|执行批量发布|开始跑批|开始执行批量/.test(
        s,
      );
    const hasCanvasId = /canvas\s*\d+/i.test(s) || /```canvas-it/i.test(s);
    const mentionsBatchPublish = /批量发布/.test(s);
    return wantsStart || (mentionsBatchPublish && hasCanvasId);
  }

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
    const existing = new Set<number>();
    const re = /```canvas-it\s*([\s\S]*?)```/gi;
    base.replace(re, (_full, body) => {
      const items = this.extractCanvasItItems(body);
      for (const it of items) existing.add(Number(it.canvasId));
      return '';
    });

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
    const seen = new Set<number>(existing);
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

    return base + unique.map((it) => this.buildCanvasItBlock(it)).join('');
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
