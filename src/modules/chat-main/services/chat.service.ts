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
import type { BaseMessageLike } from '@langchain/core/messages';
import { StructuredTool, isStructuredTool } from '@langchain/core/tools';
import type { DeepAgentSubAgent } from '../../ai-agent/types/agent.types.js';
import { ContextRole } from '../../context/enums/context.enums';
import {
  ToolsService,
  FunctionCallScope,
} from '../../function-call/tools/services/tools.service.js';
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
import {
  SupervisorGraphService,
  type ExpertSpec,
  type ExpertName,
} from './supervisor-graph.service.js';

/**
 * @title 主对话服务 Chat-Main Service
 * @description 封装流式与非流式对话流程，并提供上下文CRUD接口。
 * @keywords-cn 主对话, 流式, 非流式, 上下文CRUD
 * @keywords-en chat main, streaming, non-streaming, context CRUD
 */
@Injectable()
export class ChatMainService {
  private readonly logger = new Logger(ChatMainService.name);
  private readonly IMAGE_PER_ARTICLE_MIN_COUNT = 6;
  private readonly IMAGE_PER_ARTICLE_MAX_COUNT = 8;

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
    private readonly supervisorGraph: SupervisorGraphService,
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
    const platformSupplement = await this.buildPlatformSupplement(
      scope.tenantId,
    );
    const sysContent = [
      `SESSION_ID:${sid}`,
      `REQUEST_TIME_ISO:${now}`,
      ip ? `CLIENT_IP:${ip}` : 'CLIENT_IP:unknown',
      platformSupplement,
      await this.getSystemPromptCN(scope.sessionType, scope.tenantId),
    ].join('\n');

    // checkpoint 会根据 thread_id 自动获取上下文，只需传入最新消息
    const messages: BaseMessage[] = [new HumanMessage(request.input)];
    const finalScope = {
      ...scope,
      category: scope?.sessionType?.startsWith('xhs') ? 'xhs' : undefined,
    };
    const tools = this.getToolsForInput(
      request.input,
      undefined,
      finalScope,
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
        platformSupplement,
      },
    );
    // 主 agent 不直接持有 subagent 专属工具，强制走路由委派
    const mainAgentTools = this.filterSubagentOnlyTools(
      tools,
      scope.sessionType,
      request.input,
    );
    // 调试日志：打印主 agent 和各 subagent 的工具列表
    this.logToolsForLLM('sync', scope.sessionType, mainAgentTools, subagents);
    const checkpoint_id =
      (await this.ctx.getConversation(sid, scope))?.lastCheckpointId ?? 'root';
    let ai: AIMessage;
    try {
      ai = await this.agent.runWithMessages({
        config: {
          temperature: request.temperature ?? 0.5,
          tenantId: scope.tenantId,
          tools: mainAgentTools,
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
    text = this.ensureReadableNarrationIfNeeded(
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
      const abortController = new AbortController();
      let disposed = false;
      const shouldStop = (): boolean =>
        disposed || subscriber.closed || abortController.signal.aborted;

      void (async () => {
        let sid: string | null = null;
        // 看门狗: 监控 stream 长时间无任何事件(LLM/工具/graph 节点 silent hang),
        // 超时则主动 abort,让前端至少能收到 error 而不是永久卡死无反应。
        let streamWatchdog: ReturnType<typeof setInterval> | null = null;
        // fullText 提到 try 外: 含 earlyEmit 推送的所有 fence(canvas-it/handoff-it/
        // tag-select-it) + LLM token。catch 分支需要它把"已产生内容"补落库,
        // 否则 stream 中断时 assistant 消息从不入库 → 刷新后卡片全丢。
        let fullText = '';
        // 标记 assistant 消息是否已落库,避免正常路径 + catch 路径重复 append。
        let assistantPersisted = false;
        try {
          const scope = this.getRequestScope(request);
          const updatesOnlyStream = this.shouldUseUpdatesOnlyStreamForInput(
            request.input,
            scope.sessionType,
          );
          sid = await this.ctx.createSessionWithScope(request.sessionId, scope);
          if (!sid) throw new Error('SESSION_ID_MISSING');
          if (shouldStop()) return;

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
          const platformSupplement = await this.buildPlatformSupplement(
            scope.tenantId,
          );
          const sysContent = [
            `SESSION_ID:${sid}`,
            `REQUEST_TIME_ISO:${nowStr}`,
            `CLIENT_IP:${ipStr}`,
            platformSupplement,
            await this.getSystemPromptCN(scope.sessionType, scope.tenantId),
          ].join('\n');

          const streamWriter = (msg: string) => {
            if (!shouldStop())
              subscriber.next({
                data: { type: 'log', data: msg, thread_id: sid },
              } as MessageEvent);
          };

          if (updatesOnlyStream) {
            streamWriter(
              '[StreamMode] updates-only enabled for tool-heavy workflow',
            );
          }

          // fullText 在 try 外声明(catch 需用它补落库),此处不再重新声明。

          // 早期 fence 推送通道(canvas-it / handoff-it 等):tool 调用瞬间直接 push 到前端,
          // 不依赖 LLM 二次解码,首屏零延迟。
          // - canvas-it: xhs_create_image_group_canvas 创 Canvas 成功瞬间推
          // - handoff-it: supervisor handoff_to_expert 调用瞬间推,前端显示切换提示卡片
          // 同步累加 fullText 以保证最终落库包含 fence。canvas-it 按 canvasId 去重。
          const emittedEarlyCanvasIds = new Set<number>();
          const earlyEmitCanvasIt = (text: string) => {
            if (shouldStop()) return;
            const block = String(text ?? '').trim();
            if (!block) return;
            // canvas-it 去重(按 canvasId)
            const cm = /```canvas-it\s*([\s\S]*?)```/i.exec(block);
            if (cm) {
              try {
                const payload = JSON.parse(cm[1]) as { canvasId?: unknown };
                const cid = Number(payload?.canvasId);
                if (Number.isFinite(cid)) {
                  if (emittedEarlyCanvasIds.has(cid)) return;
                  emittedEarlyCanvasIds.add(cid);
                }
              } catch {
                // ignore parse errors;不阻塞推送
              }
            }
            // handoff-it / 其他 fence: 直接透传,前端自行去重
            const payload = `\n\n${block}\n\n`;
            fullText += payload;
            subscriber.next({
              data: { type: 'token', data: { text: payload, thread_id: sid } },
            } as MessageEvent);
            // 诊断: 记录每次 earlyEmit 推送的 fence 类型 + 当前 fullText 长度
            const fenceType = /```([a-z-]+)/i.exec(block)?.[1] ?? 'unknown';
            this.logger.log(
              `[fence-trace] earlyEmit type=${fenceType} blockLen=${block.length} fullTextLen=${fullText.length} sid=${sid ?? ''}`,
            );
          };

          const finalScope = {
            ...scope,
            category: scope?.sessionType?.startsWith('xhs') ? 'xhs' : undefined,
            earlyEmit: earlyEmitCanvasIt,
          };

          const tools = this.getToolsForInput(
            request.input,
            streamWriter,
            finalScope,
            scope.sessionType,
          );
          const subagents = this.buildDefaultSubagents(
            tools,
            scope.sessionType,
            finalScope,
            {
              sid,
              now: nowStr,
              ip: ipStr,
              platformSupplement,
            },
          );
          // 主 agent 不直接持有 subagent 专属工具，强制走路由委派
          const mainAgentTools = this.filterSubagentOnlyTools(
            tools,
            scope.sessionType,
            request.input,
          );
          // 调试日志：打印主 agent 和各 subagent 的工具列表
          this.logToolsForLLM(
            'stream',
            scope.sessionType,
            mainAgentTools,
            subagents,
          );
          const checkpoint_id = meta?.lastCheckpointId ?? 'root';

          // ─── default 模式: 意图识别 + 专家直派(不再用 LangGraph StateGraph)───
          // 两步走:
          //   ① recognizeIntent —— 先走代码层承上/关键词规则,仍不确定时再用轻量 LLM
          //      读 JSON 化 fullDialog/recentDialog,输出一个路由词。不是 tool 调用、不是 graph。
          //   ② buildExpertAgent —— 按路由词在代码层选定**单个专家** createReactAgent。
          // 选定的专家 agent 当 preBuiltAgent 交给 agent.stream 正常流式消费,原有
          // stream 处理逻辑(token 累加 / SSE / 落库)完全不变。
          // 放弃 StateGraph: supervisor 作为图节点时 minimax 会被多代理执行上下文
          // 带偏(模仿历史里的工具调用文本、不老实输出路由词),拆成两步后彻底解耦。
          let preBuiltAgent:
            | ReturnType<SupervisorGraphService['buildExpertAgent']>
            | undefined;
          // ⚠️ ctx.appendMessage 在 stream 入口已写入当前 user 输入,历史已含最新一条。
          let streamMessages: BaseMessageLike[] = [
            new HumanMessage(request.input),
          ];
          if (
            this.supervisorGraph.shouldUseSupervisor(scope.sessionType) &&
            sid
          ) {
            const experts = this.mapSubagentsToExpertSpecs(subagents);
            const currentAction = meta?.actionSession ?? null;
            if (experts.length > 0) {
              // 显式装填完整历史 —— 意图识别 + 专家执行共用同一份。
              let loadedHistory: BaseMessage[] = [];
              try {
                loadedHistory = await this.loadHistoryAsBaseMessages(
                  sid,
                  scope,
                );
              } catch (e) {
                this.logger.warn(
                  `[chat.stream] load_history_failed sid=${sid}: ${String(e)}`,
                );
              }
              const expertLLM = await this.agent.buildLLM({
                temperature: request.temperature ?? 0.1,
                tenantId: scope.tenantId,
              });
              const intentLLM = await this.agent.buildLLM({
                temperature: 0,
                tenantId: scope.tenantId,
              });
              const checkpointer =
                this.agent.getCheckpointer() as unknown as Parameters<
                  SupervisorGraphService['buildExpertAgent']
                >[0]['checkpointer'];

              // 简化历史: 剥掉卡片 fence / minimax 工具调用伪文本。
              // 意图识别 + chat 专家用它,避免 minimax 被执行产物带偏去虚拟造 tool。
              const cleanHistory =
                this.simplifyHistoryForRouting(loadedHistory);

              // ① 意图识别 —— 先跑承上/关键词确定性规则,仍不确定才读简化历史 JSON。
              const route = await this.supervisorGraph.recognizeIntent({
                systemPrompt: this.getSupervisorPromptBySession(
                  scope.sessionType,
                  sysContent,
                  currentAction,
                ),
                history: cleanHistory,
                llm: intentLLM,
                currentActionSession: currentAction,
              });

              // ② 专家直派 —— 按路由词构建单个专家 agent
              preBuiltAgent = this.supervisorGraph.buildExpertAgent({
                route,
                experts,
                chatExpertPrompt: this.getChatExpertPromptBySession(
                  scope.sessionType,
                  sysContent,
                ),
                expertLLM,
                chatLLM: intentLLM,
                checkpointer,
              });

              if (route !== 'chat') {
                // 业务专家: earlyEmit handoff-it 切换卡片 + 持久化 actionSession;
                // 喂**完整历史**(业务专家要靠执行上下文/卡片接着干活)。
                try {
                  const isContinuation = currentAction === route;
                  const handoffMeta = this.getHandoffDisplayMeta(
                    scope.sessionType,
                    route,
                  );
                  const fence = `\`\`\`handoff-it\n${JSON.stringify({
                    expert: route,
                    expertNode: `${route}_expert`,
                    expertLabel: handoffMeta.label,
                    icon: handoffMeta.icon,
                    reason: `${handoffMeta.reasonPrefix}: ${route}`,
                    isContinuation,
                    ts: Date.now(),
                  })}\n\`\`\``;
                  earlyEmitCanvasIt(fence);
                } catch (e) {
                  this.logger.warn(
                    `[chat.stream] handoff_fence_emit_failed: ${String(e)}`,
                  );
                }
                try {
                  await this.ctx.setActionSession(sid, route, scope);
                } catch (e) {
                  this.logger.warn(
                    `[chat.stream] action_session_persist_failed: ${String(e)}`,
                  );
                }
                if (loadedHistory.length > 0) {
                  streamMessages = loadedHistory;
                }
              } else {
                if (currentAction) {
                  try {
                    await this.ctx.setActionSession(sid, null, scope);
                  } catch (e) {
                    this.logger.warn(
                      `[chat.stream] action_session_clear_failed: ${String(e)}`,
                    );
                  }
                }
                // chat 专家: 喂**简化历史**,避免它看到历史里的卡片/工具调用后
                // 跟着虚拟造一个 tool_call。
                if (cleanHistory.length > 0) {
                  streamMessages = cleanHistory;
                }
              }
            }
          }

          // ─── 消费 agent stream 事件 ───
          const iterable = this.agent.stream({
            preBuiltAgent,
            config: {
              temperature: request.temperature ?? 0.1,
              tenantId: scope.tenantId,
              tools: mainAgentTools,
              subagents,
              system: sysContent,
              recursionLimit: 1000,
              streamWriter,
              streamMode: updatesOnlyStream ? 'updates' : undefined,
              context: { threadId: sid, checkpointId: checkpoint_id },
            },
            messages: streamMessages,
            callOption: {
              configurable: {
                thread_id: sid,
                checkpoint_ns: 'default',
                checkpoint_id: checkpoint_id,
              },
              signal: abortController.signal,
            },
          });

          let endToolCalls: unknown[] | undefined;
          let endToolResults:
            | { name?: unknown; output?: unknown }[]
            | undefined;
          const observedToolResults: { name?: unknown; output?: unknown }[] =
            [];

          const safeSend = (payload: unknown) => {
            if (!shouldStop()) {
              subscriber.next({ data: payload } as MessageEvent);
            }
          };

          // 启动看门狗: stream 连续 STREAM_IDLE_TIMEOUT_MS 无任何事件视为 hang。
          // 阈值给 3 分钟,容忍 LLM thinking 与正常工具调用间隙;真正 silent hang
          // (LLM/graph 节点无响应)会被打破 → abort → catch → 前端收到 error。
          const STREAM_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
          let lastStreamEventAt = Date.now();
          streamWatchdog = setInterval(() => {
            const idle = Date.now() - lastStreamEventAt;
            if (idle > STREAM_IDLE_TIMEOUT_MS) {
              this.logger.error(
                `[chat.stream] watchdog: ${idle}ms no stream event, aborting. sid=${sid ?? ''} sessionType=${scope.sessionType}`,
              );
              try {
                abortController.abort();
              } catch {
                void 0;
              }
            }
          }, 20 * 1000);

          for await (const step of iterable) {
            lastStreamEventAt = Date.now();
            if (shouldStop()) break;
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
                // subagent 文本也累积到 fullText，避免 subagent 全程代劳时
                // mongo 里的 content 只剩主 agent 一小截自述，刷新后正文/canvas-it 块丢失
                fullText += step.data.text;
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
                observedToolResults.push({
                  name: step.data?.name,
                  output: step.data?.output,
                });
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
                  | (Error & { code?: string; cause?: unknown })
                  | undefined;
                const errCode = errObj?.code || errObj?.name || 'STREAM_ERROR';
                const errMsg = errObj?.message ?? 'STREAM_ERROR';
                // 后端也完整打 log,避免前端能看到细节但后端只剩简短一行
                this.logger.error(
                  `[ChatMainService.stream] sid=${sid ?? ''} sessionType=${scope.sessionType} code=${errCode} message=${errMsg}`,
                  errObj?.stack,
                );
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
          const finalToolResults =
            Array.isArray(endToolResults) && endToolResults.length > 0
              ? endToolResults
              : observedToolResults.length > 0
                ? observedToolResults
                : undefined;

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
            if (hasHitl(finalToolResults)) text = this.HITL_PLACEHOLDER;
          } catch {
            void 0;
          }

          text = this.appendCanvasItIfNeeded(text, finalToolResults);
          text = this.appendTaskItIfNeeded(text, finalToolResults);
          text = this.appendDecisionSummaryIfNeeded(text, finalToolResults);
          text = this.appendDecisionItIfNeeded(text, finalToolResults);
          text = this.ensureReadableNarrationIfNeeded(text, finalToolResults);

          // graph 正常结束但零输出: 不要静默成前端"无内容",明确暴露异常。
          if (!text.trim()) {
            this.logger.error(
              `[stream] empty output sid=${sid} sessionType=${scope.sessionType} — graph 正常结束但未产生任何内容(无 token / 无 fence / 无工具结果)`,
            );
            text =
              '⚠️ AI 未产生有效回复(模型或路由可能异常),请重试一次。若反复出现请联系管理员。';
          }

          // 推送最终 end 事件
          safeSend({
            type: 'end',
            data: {
              text,
              tool_calls: endToolCalls,
              tool_results: finalToolResults,
              thread_id: sid,
            },
          });

          // 诊断: 落库前记录 text 是否含各类 fence,定位 fence 丢在落库前还是落库后
          this.logger.log(
            `[fence-trace] persist sid=${sid} textLen=${text.length}` +
              ` canvas-it=${text.includes('```canvas-it')}` +
              ` handoff-it=${text.includes('```handoff-it')}` +
              ` tag-select-it=${text.includes('```tag-select-it')}` +
              ` fullTextLen=${fullText.length}`,
          );

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
              tool_results: finalToolResults,
            },
            scope,
          );
          assistantPersisted = true;

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
          // ⚠️ stream 中断补落库: assistant 消息未正常落库时(hang/abort/error),
          // 把已产生的 fullText(含 earlyEmit 推送的 canvas-it/handoff-it/tag-select-it
          // fence)写入 mongo,否则用户已经看到的卡片在刷新后全部消失。
          if (!assistantPersisted && sid) {
            try {
              const partial = this.sanitizeFinalText(fullText).trim();
              if (partial.length > 0) {
                const recoveryScope = this.getRequestScope(request);
                await this.ctx.appendMessage(
                  sid,
                  { role: ContextRole.Assistant, content: partial },
                  recoveryScope,
                );
                assistantPersisted = true;
                this.logger.warn(
                  `[stream] partial assistant persisted on error sid=${sid} len=${partial.length}`,
                );
              }
            } catch (persistErr) {
              this.logger.warn(
                `[stream] partial persist failed sid=${sid}: ${String(persistErr)}`,
              );
            }
          }
          if (!subscriber.closed) {
            subscriber.next({
              data: {
                type: 'error',
                data: { code: 'STREAM_ERROR', message: e.message },
              },
            } as MessageEvent);
          }
        } finally {
          if (streamWatchdog) {
            clearInterval(streamWatchdog);
            streamWatchdog = null;
          }
          if (!subscriber.closed) subscriber.complete();
        }
      })();

      return () => {
        disposed = true;
        try {
          abortController.abort();
        } catch {
          void 0;
        }
      };
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

  /**
   * @description 追加一条用户消息到会话。
   * @keyword-en append user message
   */
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

  /**
   * @description 追加一条助手消息到会话。
   * @keyword-en append assistant message
   */
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

  /**
   * @description 获取会话消息并附加可删除指纹，同时过滤已删除项。
   * @keyword-en get messages with fingerprints
   */
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
      let content = this.sanitizeHistoryContent(m.content);
      // 历史消息兜底：stream 中断或 appendMessage 失败时 MongoDB 未保存 content，
      // 但 checkpoint 里已有 tool_results。此处基于 tool_results 幂等重建
      // canvas-it / task-it / decision-it 代码块，避免刷新后 canvas 块消失
      if (m.role === ContextRole.Assistant) {
        const toolResults = Array.isArray(m.tool_results)
          ? (m.tool_results as Array<{ name?: unknown; output?: unknown }>)
          : undefined;
        content = this.appendCanvasItIfNeeded(content, toolResults);
        content = this.appendTaskItIfNeeded(content, toolResults);
        content = this.appendDecisionItIfNeeded(content, toolResults);
      }
      return {
        ...m,
        content,
        fingerprint,
      };
    });
    const result = enriched.filter((m) =>
      m.fingerprint ? !deleted.has(m.fingerprint) : true,
    );
    // 诊断: 记录读取出的 assistant 消息是否含 fence,定位 fence 是落库后丢失还是读取处理丢失
    for (const m of result) {
      if (m.role !== ContextRole.Assistant) continue;
      const c = typeof m.content === 'string' ? m.content : '';
      if (
        c.includes('```canvas-it') ||
        c.includes('```handoff-it') ||
        c.includes('```tag-select-it')
      ) {
        this.logger.log(
          `[fence-trace] getMessages assistant has fence sid=${sessionId}` +
            ` canvas-it=${c.includes('```canvas-it')}` +
            ` handoff-it=${c.includes('```handoff-it')}` +
            ` tag-select-it=${c.includes('```tag-select-it')}`,
        );
      } else {
        this.logger.log(
          `[fence-trace] getMessages assistant NO fence sid=${sessionId} contentLen=${c.length}`,
        );
      }
    }
    return result;
  }

  /**
   * @description 按指纹或可见索引删除消息（软删除）。
   * @keyword-en delete messages by fingerprint or index
   */
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

  /**
   * @description 清空指定会话上下文。
   * @keyword-en clear session messages
   */
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

  /**
   * @description 从 AIMessage 中抽取可展示文本。
   * @keyword-en extract display text from ai message
   */
  private extractText(ai: AIMessage): string {
    const content = ai.content;
    if (typeof content === 'string') {
      return content;
    }
    const extracted = this.extractTextFromModelContent(content);
    if (extracted) return extracted;
    return JSON.stringify(content);
  }

  /**
   * @description 清洗历史消息内容，剔除仅含 thinking/tool_use 的块结构。
   * @keyword-en sanitize history message content
   */
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

  /**
   * @description 从多种模型 content 结构中提取纯文本。
   * @keyword-en extract text from model content
   */
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

  /**
   * @description 清洗最终输出，避免把工具 JSON 头部原样展示给用户。
   * @keyword-en sanitize final output text
   */
  private sanitizeFinalText(text: string): string {
    let s = typeof text === 'string' ? text : String(text ?? '');
    s = s.replace(/\[TOOL_CALL\][\s\S]*?(?:\[\/TOOL_CALL\]|$)/gi, '');
    const minimaxArtifactIndex = s.search(
      /<\|?minimax\|?>|<minimax:tool_call>|<\s*invoke\b|<parameter\b/i,
    );
    if (minimaxArtifactIndex >= 0) {
      s = s.slice(0, minimaxArtifactIndex).trimEnd();
    }
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

  /**
   * @description 规范化字符串数组输入，必要时返回默认值。
   * @keyword-en normalize string array input
   */
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

  /**
   * @description 生成会话的临时标题。
   * @keyword-en build provisional session title
   */
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
      '工具必须通过系统结构化 tool call 调用；禁止把 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本展示给用户。',
      '如果是生成文章的数据收集,直接交给生文节点去做就好了,不需要你检索完了给到 subagent',
      '优先直接回答；只有当信息不足或用户明确要求时再调用工具/子代理。',
      '当工具返回了 Canvas 信息（如 canvasId），回复中输出一个 ```canvas-it``` JSON 代码块（至少包含 canvasId）。',
      '文章库流程：用户要“存入文章库/获取文章库二维码/按库标题取二维码”时，先用 article_library_list 给出候选；用户提供明确标题或 ID 后，再调用 canvas_store_to_article_library 或 article_library_get_push_qr。Canvas 仍在 generating 时不要强行入库，提示完成后再存；不要编造二维码内容。',
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
      '批量发布通过 Todo 派单：创建/更新 Todo，并使用中文接单人名称”小红书发布机”（避免暴露内部代码）；type 只能为 auto_execute/offline_execute/long_task/other（发布场景必须 auto_execute），并写清关联资源（如 canvasId）与 count。',
      '【long_task 长时任务】需要跨天/跨周持续执行的任务使用 long_task 类型，可携带 deadline（ISO日期字符串，非必填）。long_task 会自动注入 Cron 追踪规则：每次执行前须调用 todo_get 检查任务状态，若状态为 done/failed/cancelled 或当前时间超过 deadline，须立即删除 Cron job。',
      '调用 todo_create/todo_update 时不要手填 userId，统一由会话上下文注入。',
      '创建发布任务时，description 必须写入当前会话上下文摘要（用户目标、对象、资源、执行要求），不要留空。',
      '生成拼图/封面属于独立图库操作；除非用户明确要求生成文章/内容，否则禁止同时触发 Canvas 创建。',
      '[重要]需要任何数据分析、数据查询、数据获取时，会由系统路由到数据分析专家。专家必须直接调用已绑定的数据工具完成查询，禁止输出 [TOOL_CALL]、XML、JSON 伪工具调用文本；如果有数据来源返回，也要在回答中说明数据来源和字段信息，确保查询结果可解释且可复用。',
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
   * @description supervisor LLM 系统提示词。仅负责路由决策,不持有业务工具。
   *   规则尽量短:每个专家一句 + handoff 调用约束 + fallback 直接回答。
   * @keyword-en supervisor system prompt for routing decisions
   */
  /**
   * @description 把 ctx 存储的对话历史(ContextMessage[])转成 LangChain BaseMessage[]。
   *   用于 supervisor graph / 直接 expert 路径在 stream 入口显式注入完整对话历史,
   *   避免依赖 LangGraph checkpoint 跨 graph schema 共享(实测多 graph 切换时 checkpoint
   *   读不到对方写入的 messages,导致 expert agent 看不到上下文 = "切换后从零开始")。
   *   - user → HumanMessage / assistant → AIMessage / system → SystemMessage
   *   - 跳过空 content 的消息(避免 LLM 端报"empty content")
   *   - ctx.getMessages 已包含当前用户最新消息(stream 入口提前 appendMessage),无需额外 append
   * @keyword-en load conversation history as base messages
   */
  private async loadHistoryAsBaseMessages(
    sid: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<BaseMessage[]> {
    const history = await this.ctx.getMessages(
      sid,
      undefined,
      undefined,
      scope,
    );
    const out: BaseMessage[] = [];
    for (const m of history) {
      const content =
        typeof m?.content === 'string' ? m.content : String(m?.content ?? '');
      if (!content.trim()) continue;
      if (m.role === ContextRole.User) {
        out.push(new HumanMessage({ content }));
      } else if (m.role === ContextRole.Assistant) {
        out.push(new AIMessage({ content }));
      }
      // system 消息不复用,会由 createReactAgent 的 prompt 参数自行注入
    }
    return out;
  }

  /**
   * @description 把对话历史"简化"成纯自然语言对话 —— 剥掉所有 earlyEmit 卡片 fence
   *   (canvas-it/handoff-it/tag-select-it/task-it/decision-it)和 minimax 私有工具调用
   *   伪文本(<minimax:tool_call>/<invoke>/<parameter>)。
   *   **用途**: 意图识别 LLM、chat 专家拿到的历史里若残留"执行产物"(卡片/工具调用),
   *   minimax 会被带偏 —— 把自己当执行者去模仿、虚拟造一个 tag-select 卡片或 tool_call,
   *   而不是老实做意图分类 / 闲聊。简化后只剩用户/AI 的自然语言,杜绝这种误触发。
   *   业务专家**不**用简化历史(它们要靠执行上下文接着干活)。
   * @keyword-en simplify history strip cards and tool-call artifacts for routing
   */
  private simplifyHistoryForRouting(history: BaseMessage[]): BaseMessage[] {
    const stripArtifacts = (text: string): string =>
      String(text ?? '')
        // earlyEmit 卡片 fence(含未闭合兜底)
        .replace(
          /```(?:canvas-it|handoff-it|tag-select-it|tag-select|task-it|decision-it)\b[\s\S]*?(?:```|$)/gi,
          '',
        )
        // minimax 私有工具调用伪文本
        .replace(/<minimax:tool_call>[\s\S]*?(?:<\/minimax:tool_call>|$)/gi, '')
        .replace(/<\|?minimax\|?>[\s\S]*$/gi, '')
        .replace(/<\s*invoke\b[\s\S]*?(?:<\/invoke>|$)/gi, '')
        .replace(/<parameter\b[\s\S]*?(?:<\/parameter>|$)/gi, '')
        .trim();
    const out: BaseMessage[] = [];
    for (const msg of history) {
      const type = (msg as { _getType?: () => string })._getType?.();
      // 用户输入保持原样(用户消息不会有执行产物,且可能含多模态图片)
      if (type === 'human') {
        out.push(msg);
        continue;
      }
      if (type !== 'ai') continue;
      const content = (msg as { content?: unknown }).content;
      const rawText =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((b) =>
                  b && typeof b === 'object' && 'text' in b
                    ? String((b as { text?: unknown }).text ?? '')
                    : '',
                )
                .join(' ')
            : '';
      const cleaned = stripArtifacts(rawText);
      // 清洗后为空(纯卡片回复) → 丢弃,不喂给路由/chat
      if (cleaned) out.push(new AIMessage({ content: cleaned }));
    }
    return out;
  }

  private getSupervisorPromptCN(
    envContext: string,
    currentActionSession?:
      | 'image'
      | 'article'
      | 'data'
      | 'frontend'
      | 'publisher'
      | 'task'
      | null,
  ): string {
    const expertLabel: Record<string, string> = {
      image: '图组生图专家',
      article: '文章生成专家',
      data: '数据分析专家',
      frontend: '前端可视化专家',
      publisher: '批量发布专家',
      task: '任务编排专家',
    };
    const actionCtx = currentActionSession
      ? `【当前会话上下文】上一轮已激活「${expertLabel[currentActionSession] ?? currentActionSession}」(actionSession=${currentActionSession})。`
      : '【当前会话上下文】当前无激活专家,由你从头判定。';
    return [
      envContext,
      '',
      '你是 AI 指挥官的「意图分析层」。你的**唯一**职责: 读取一条 JSON 化上下文,判定本轮用户意图,输出一个路由词。',
      '',
      '【输入格式】你会收到一条 user 消息,内容是 JSON,包含:',
      '- currentActionSession: 当前业务链路的激活专家。代码层会先处理明显承上；你只在需要 LLM 补充判断时参考它',
      '- latestUserMessage: 本轮用户最新消息,这是本轮意图判定的第一优先级',
      '- fullDialog: 完整清洗历史,用于承上判断和恢复较早的任务上下文',
      '- recentDialog: 最近 10 组 user/assistant 对话,用于快速理解近端承接关系',
      '',
      '【⚠️ 输出格式 —— 极其重要,必须严格遵守】',
      '你的回复**必须且只能**是下面 7 个英文单词中的**一个**,不带任何标点、引号、解释、前后缀:',
      '  image    article    data    frontend    publisher    task    chat',
      '正确示例(整条回复就这一个词): chat',
      '错误示例: "chat"、handoff chat、路由到 chat、expert=chat、我认为应该选 chat',
      '禁止输出多个词,禁止输出句子,禁止解释理由。',
      '',
      '【⚠️ 你只做分类,绝不执行任务】',
      '你是分类器,不是执行者。无论用户要什么,你都**只输出一个路由词**。',
      '严禁输出 ```tag-select```、```canvas-it``` 等任何代码块/卡片/JSON/工具调用 ——',
      '那是专家干的活。你哪怕看到历史里有这些卡片,也绝不模仿、绝不生成。',
      '',
      actionCtx,
      '',
      '【判定规则】先归类 JSON.latestUserMessage,再结合 fullDialog/recentDialog 判断是否延续上一轮任务,最后输出对应路由词:',
      '- 如果 currentActionSession 不为空,且 latestUserMessage 是确认/继续/补充时间范围/补充指标口径/“那就按这个来”等承接语,优先输出 currentActionSession 对应的路由词,不要因为句子短或像口语确认就输出 chat',
      '- 闲聊/无意义/情绪词("哈哈""好的""嗯""厉害""6""hi""你好") → 输出 chat',
      '- 询问指挥官自己("你是谁""你能做什么""怎么用") → 输出 chat',
      '- 与 6 个专家领域都无关的通用问题 → 输出 chat',
      '- 同时含"图文/正文/文章/全套/也写文/一并出文"与配图/图组 → 输出 article',
      '- 只创建/生成/做/出 图组/拼图/封面/Canvas/配图,且没有明确生文意图 → 输出 image',
      '- 写/生成/编排 文章/正文/图文/选题/小红书内容 → 输出 article',
      '- 查/统计/分析/趋势 数据/记录/聚合,或要方案/决策/策略/建议 → 输出 data',
      '- 生成 图表/HTML/可视化页面/dashboard → 输出 frontend',
      '- 批量发布/内容分发/指派 robot 发布执行 → 输出 publisher',
      '- 创建/编排/查询 任务/待办/工单/排期 → 输出 task',
      '⚠️ publisher 是"把内容发出去",task 是"管理待办与编排任务",两者不同,别混。',
      '⚠️ 即使 actionSession 已有激活专家,只要本轮明确是闲聊/能力询问/结束当前业务,也必须输出 chat。',
      'actionSession 是承上状态,不是让你执行任务；明确切换才回 chat。',
      '',
      '【延续性识别】结合 fullDialog/recentDialog 判断,本轮是否在推进上一轮专家任务:',
      '- 历史在做 image/article 并发出 tag-select 卡片,本轮"我选定标签：#X" → 延续对应专家；上一轮 article 输出 article,上一轮 image 输出 image',
      '- 历史在做 data,本轮"换成 14 天"/"再细分一下" → 输出 data',
      '- 本轮"再来一组"/"再生成一个"且历史在做图组 → 输出 image',
      '- 本轮"开始生成"/"确认"/"按这个执行"/"开始吧"且上一轮正在准备 article/image/data/task 等业务 → 延续上一轮专家',
      '',
      '再次强调: 你的整条回复只能是 image/article/data/frontend/publisher/task/chat 其中一个词。',
    ]
      .filter((line) => typeof line === 'string')
      .join('\n');
  }

  /**
   * @description chat_expert(指挥官闲聊/通用对话节点)的系统提示词。supervisor 把
   *   闲聊/打招呼/问能力/与业务无关的问题 handoff 到本节点,由本节点固有返回 ——
   *   supervisor 自己绝不生成用户可见内容,所有面向用户的文字都由专家节点产出。
   * @keyword-en build chat expert prompt for casual conversation node
   */
  private getChatExpertPromptCN(envContext: string): string {
    return [
      envContext,
      '',
      '你是 AI 指挥官的 chat 兜底入口,只负责接待、简单闲聊、能力说明和澄清问题。',
      '你不是业务执行者。数据查询、图组生图、文章生成、可视化、发布执行、任务编排都必须由系统路由给对应专家完成。',
      '',
      '【你的能力】你统筹 6 个业务方向,可按用户需求调度:',
      '- 图组生图: 创建图组 Canvas、配图、封面、拼图',
      '- 文章生成: 写正文、编排选题、小红书内容',
      '- 数据分析 & 决策建议: 查询统计、趋势分析、报表,并据此生成决策卡/方案建议',
      '- 前端可视化: 生成图表、HTML 看板、dashboard',
      '- 批量发布: 内容批量发布、分发、机器人发布执行',
      '- 任务编排: 待办/工单的创建、编排、管理',
      '',
      '【回应要求】',
      '- 闲聊/情绪词("哈哈""好的""厉害"): 自然地回一句,语气轻松',
      '- 问"你是谁"/"你能做什么": 简洁介绍你能统筹的 6 个方向,引导用户提出具体需求',
      '- 与业务无关的通用问题: 简短回答,或说明你更擅长上述 6 类任务',
      '- 如果用户像是在提出业务请求但信息不足,只问一个澄清问题,不要自己查数据、生成内容、制定发布计划或创建任务',
      '- 禁止说"我去查一下/我来生成/我确认数据/我调用工具"等执行口吻',
      '- 禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用、canvas-it、task-it、tag-select-it、handoff-it 代码块',
      '- 用中文,1-3 句即可,不要冗长,不要解释内部路由逻辑',
    ]
      .filter((line) => typeof line === 'string')
      .join('\n');
  }

  /**
   * @description 按会话模式选择意图识别提示词。
   * @keyword-cn 意图识别, 小红书路由
   * @keyword-en supervisor-prompt, xhs-routing
   */
  private getSupervisorPromptBySession(
    sessionType: ConversationSessionType,
    envContext: string,
    currentActionSession?:
      | 'image'
      | 'article'
      | 'data'
      | 'frontend'
      | 'publisher'
      | 'task'
      | null,
  ): string {
    if (sessionType === 'xhs-specialist') {
      return this.getXhsSupervisorPromptCN(envContext, currentActionSession);
    }
    return this.getSupervisorPromptCN(envContext, currentActionSession);
  }

  /**
   * @description 按会话模式选择 chat 专家提示词。
   * @keyword-cn 闲聊专家, 小红书专家
   * @keyword-en chat-expert-prompt, xhs-chat
   */
  private getChatExpertPromptBySession(
    sessionType: ConversationSessionType,
    envContext: string,
  ): string {
    if (sessionType === 'xhs-specialist') {
      return this.getXhsChatExpertPromptCN(envContext);
    }
    return this.getChatExpertPromptCN(envContext);
  }

  /**
   * @description 构建小红书专家意图识别提示词。
   * @keyword-cn 小红书意图识别, 专家直派
   * @keyword-en xhs-intent-routing, expert-dispatch
   */
  private getXhsSupervisorPromptCN(
    envContext: string,
    currentActionSession?:
      | 'image'
      | 'article'
      | 'data'
      | 'frontend'
      | 'publisher'
      | 'task'
      | null,
  ): string {
    const actionCtx = currentActionSession
      ? `【当前会话上下文】上一轮已激活小红书专家路由: ${currentActionSession}。用户若在确认、补充时间/账号/篇数/标签/发布范围,优先延续该路由。`
      : '【当前会话上下文】当前无激活的小红书子领域,由你重新判定。';
    return [
      envContext,
      '',
      '你是小红书专家的「意图识别层」。你的唯一职责是读取 JSON 化上下文,把本轮用户请求分派到一个小红书专属专家。',
      '小红书专家主入口只是简单对话/能力说明节点,不是业务执行者；凡是生图、生文、数据、发布、任务、可视化请求,都必须路由给对应专家。',
      '输入 JSON 中 fullDialog 是完整清洗历史,recentDialog 是最近片段。遇到短句、追问、确认、补标签/账号/篇数时,必须结合 fullDialog 和 currentActionSession 承上判断。',
      '',
      '【输出格式】整条回复只能是下面 7 个英文路由词中的一个,不要标点、解释、JSON、代码块或工具调用:',
      '  image    article    data    frontend    publisher    task    chat',
      '',
      '【绝对禁止】你只做分类,不执行任务。禁止输出 [TOOL_CALL]、<minimax>、canvas-it、task-it、tag-select-it、任何 JSON 或工具调用伪文本。',
      '',
      actionCtx,
      '',
      '【路由规则】优先判断 latestUserMessage,再结合 fullDialog/recentDialog:',
      '- 闲聊/打招呼/问小红书专家能做什么/与小红书无关 → chat',
      '- 生成图组、配图、生图、封面、拼图、图库搜图、图片组 Canvas → image',
      '- 生成小红书图文、正文、笔记文案、选题、种草文章、把 Canvas 存入文章库、文章库二维码 → article',
      '- 数据追踪、数据采集、粉丝/点赞/收藏/评论分析、爆文规律、竞品账号、发文后数据回收 → data',
      '- 发布、发文执行、批量发布、账号池、账号轮流发布、Adspower、确认将 Canvas 发出去 → publisher',
      '- 查看/管理/更新小红书任务、任务列表、任务进度,但不是要求立刻发布或采集 → task',
      '- 小红书数据图表、可视化报告、dashboard、HTML 看板 → frontend',
      '- 如果 currentActionSession 不为空,且用户是在说“好的/那就按这个/上周也看/补这个标签/有哪些tag/我想选一下/开始吧/发布吧”等承接语,优先输出 currentActionSession 对应路由词',
      '- 如果上一轮已经进入 image 或 article,本轮只是在问 tag/标签/素材风格/可选项/选一下,继续输出上一轮 currentActionSession,不要切 chat',
      '- 如果同一句同时包含图文/正文与配图/图组,优先 article；只有纯图片素材需求才 image',
    ].join('\n');
  }

  /**
   * @description 小红书专家的通用对话提示词。
   * @keyword-cn 小红书闲聊, 能力介绍
   * @keyword-en xhs-chat-expert, capability-intro
   */
  private getXhsChatExpertPromptCN(envContext: string): string {
    return [
      envContext,
      '',
      '你是小红书专家的 chat 兜底入口,只负责简单闲聊、能力说明和澄清问题。',
      '你不是小红书业务执行者。图组生图、图文生文、数据追踪、发文执行、任务管理、可视化都必须交给对应专家完成。',
      '你可以简洁说明自己能统筹: 图组生图、图文生文、数据追踪、发文执行、小红书任务管理、数据可视化。',
      '如果用户像是在提出小红书业务请求但信息不足,只问一个澄清问题,不要自己生成图文、图片方案、数据结论或发布计划。',
      '禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用、canvas-it、task-it、tag-select-it、handoff-it 代码块。',
      '不要解释内部路由逻辑。用中文,1-3 句即可。',
    ].join('\n');
  }

  /**
   * @description 生成 handoff 卡片展示元信息。
   * @keyword-cn 路由胶囊, 小红书专家
   * @keyword-en handoff-display, xhs-routing
   */
  private getHandoffDisplayMeta(
    sessionType: ConversationSessionType,
    route: string,
  ): { label?: string; icon?: string; reasonPrefix: string } {
    if (sessionType !== 'xhs-specialist') {
      return { reasonPrefix: '意图识别路由' };
    }
    const labels: Record<string, { label: string; icon: string }> = {
      image: { label: '小红书生图专家', icon: '🎨' },
      article: { label: '小红书生文专家', icon: '✍️' },
      data: { label: '小红书数据追踪专家', icon: '📊' },
      frontend: { label: '小红书可视化专家', icon: '📈' },
      publisher: { label: '小红书发文执行专家', icon: '🚀' },
      task: { label: '小红书任务管理专家', icon: '🗂️' },
    };
    return {
      ...labels[route],
      reasonPrefix: '小红书意图识别路由',
    };
  }

  /**
   * @description 把 buildDefaultSubagents 返回的 SubAgent 数组映射到 SupervisorGraph
   *   所需的 ExpertSpec 数组(零重复:直接复用现有 prompt+tools)。
   * @keyword-en map default subagents to expert specs
   */
  private mapSubagentsToExpertSpecs(
    subagents: DeepAgentSubAgent[],
  ): ExpertSpec[] {
    const nameMap: Record<string, ExpertName> = {
      analysis_subagent: 'data',
      topic_orchestrate_subagent: 'article',
      frontend_subagent: 'frontend',
      ops_subagent: 'publisher',
      task_subagent: 'task',
      gallery_subagent: 'image',
      xhs_data_tracker_subagent: 'data',
      xhs_article_expert_subagent: 'article',
      xhs_image_expert_subagent: 'image',
      xhs_publish_subagent: 'publisher',
      xhs_task_subagent: 'task',
      xhs_visual_report_subagent: 'frontend',
    };
    const specs: ExpertSpec[] = [];
    for (const sub of subagents) {
      const expertName = nameMap[sub.name];
      if (!expertName) continue;
      const tools = Array.isArray(sub.tools) ? sub.tools : [];
      specs.push({
        name: expertName,
        description: sub.description,
        systemPrompt:
          typeof sub.systemPrompt === 'string' ? sub.systemPrompt : '',
        tools,
      });
    }
    return specs;
  }

  /**
   * @description 获取会话模式系统提示
   * @keyword-en resolve system prompt by session mode
   */
  private async getSystemPromptCN(
    sessionType: ConversationSessionType,
    tenantId?: string,
  ): Promise<string> {
    console.log('当前会话模式:', sessionType);
    if (sessionType === 'thought') return this.getThoughtPromptCN();
    if (sessionType === 'gallery-agent') return this.getGalleryAgentPromptCN();
    if (sessionType === 'xhs-specialist') {
      return this.getXhsSpecialistPromptCN();
    }
    if (sessionType === 'xhs-tracker') return this.getXhsTrackerPromptCN();
    if (sessionType === 'xhs-publisher') return this.getXhsPublisherPromptCN();
    if (sessionType === 'xhs-article-expert')
      return this.getXhsArticleExpertPromptCN();
    if (sessionType === 'xhs-image-expert')
      return this.getXhsImageExpertPromptCN();
    return this.getDataAnalysisPromptCN(tenantId);
  }

  /**
   * @description 构建平台AI补充说明（租户个性化提示）
   * @param {string | undefined} tenantId - 租户ID
   * @returns {Promise<string>} 平台补充说明，如有则拼入SYSTEM_PROMPT块
   * @keyword-en build platform AI prompt supplement
   */
  private async buildPlatformSupplement(tenantId?: string): Promise<string> {
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
   * @keyword-cn 小红书专家, 能力介绍
   * @keyword-en xhs-specialist, routing-entry
   */
  private getXhsSpecialistPromptCN(): string {
    return [
      '你是"小红书专家"主入口,只负责简单对话、能力说明和承接用户意图。',
      '你不是业务执行者: 生图、生文、数据追踪、发文执行、任务管理、可视化都由系统 supervisor 路由给对应小红书专家完成。',
      '当用户提出任何业务诉求时,不要自己执行、不要输出伪工具调用、不要编造结果；等待系统路由到对应专家。',
      '如果用户只是打招呼、问你能做什么、问如何使用,用 1-3 句说明可统筹: 图组生图、图文生文、数据追踪、发文执行、任务管理、数据可视化。',
      '',
      '【边界】',
      '- 禁止调用或模拟任何工具。',
      '- 禁止生成图文正文、图片方案、数据结论、发布计划等业务结果。',
      '- 禁止输出 canvas-it/task-it/tag-select-it/handoff-it 代码块。',
    ].join('\n');
  }

  /**
   * @description 获取工具集合
   * @keyword-en get tools
   */
  /**
   * @description 数据追踪会话专用主提示词（xhs-tracker 直接对话模式）
   * @keyword-en xhs tracker session system prompt
   */
  private getXhsTrackerPromptCN(): string {
    console.log('小红书数据追踪专家提示词被调用');
    return [
      '你是"小红书数据追踪专家"，专注于小红书账号与内容的数据分析及定期采集任务创建。',
      '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
      '',
      '【职责范围】',
      '- 分析账号粉丝增长趋势、笔记互动数据（点赞/收藏/评论/阅读）',
      '- 识别爆文规律：标题特征、发布时间、话题标签、内容类型',
      '- 竞品账号对比分析与内容选题建议',
      '- 结合历史数据判断最佳发文时间、频次策略',
      '- 根据任务耗时程度来决定创建长时还是短时任务',
      '- 在用户没确定采集频率的时候可以主动询问采集频率等细节问题',
      '[！重要！]任务长期采集最多就是 7天的规划, 不能超出这个上限, 如果用户需求超过了这个时间范围, 需要明确告知用户并建议缩短采集周期或者分阶段采集,同样的这个期限也要在创建采集任务时明确说明。',
      '',
      '【数据收集任务创建规则】',
      '当用户要求任何数据追踪时，使用 todo_create 创建任务：',
      '- type: auto_execute | long_task 请根据任务可能需要的时间来判定',
      '- assignee: 先调用 robot_list 获取可用代理列表，选取 module=xhs_data_tracking 或名称含"数据追踪"的代理 id（格式 agent:<id>）',
      '- 关联资源一定要有: 任务专项接口-XHS帖子数据收集.md, 小红书网站操作说明.md',
      '- aiPlan 必须包含以下几个部分：',
      '  1. 【采集目标】说明要采集哪些帖子/账号/关键词',
      '  2. 【采集字段】postTitle、postUrl、authorUrl、likeCount、commentCount、collectCount、viewCount(曝光/浏览量，能取到就取)、shareCount(分享量，能取到就取)、top5评论',
      '  3. 【数据回写规则】采集完成后，必须通过任务专项接口回写数据：',
      '     - 接口地址：POST /task-api/{todoId}/xhs-stats/bulk',
      '     - 鉴权方式：Authorization: Bearer {taskToken}（从 todo.taskToken 获取）',
      '     - 请求体：{ "items": [ { postTitle, postUrl, authorUrl, likeCount, commentCount, collectCount, viewCount, shareCount, topComments, tag, dataAt } ] }',
      '     - topComments 格式：[ { content, likeCount, replyCount } ]（最多5条）；viewCount / shareCount 取不到时省略字段，不要填 0 冒充真实值',
      '  4. 要说明数据采集完成后 可以使用关联资源 任务专项接口-XHS帖子数据收集.md 的markdown说明来进行回传数据',
      '  5. [!重要!] 进行小红书数据采集任务的时候,一定要按照 小红书网站操作说明.md 的说明来完成操作',
      '',
      '- 创建完任务后可以立即返回,不需要等待任务完成；任务执行结果通过用户查询任务状态或主动推送的方式反馈给用户。',
      '- 创建成功后输出 task-it 代码块供前端渲染任务看板（格式：```task-it\\n{"todoId":<id>,"status":"pending"}\\n```）。',
      '【执行约束】',
      '1. 量化输出：给出具体数字、趋势方向、行动建议，不给模糊判断。',
      '2. 所有数据分析必须说明数据来源和字段含义，确保可解释。',
      '3. 禁止生成文章正文或调用图库工具。',
    ].join('\n');
  }

  /**
   * @description 发文执行会话专用主提示词（xhs-publisher 直接对话模式）
   * @keyword-en xhs publisher session system prompt
   */
  private getXhsPublisherPromptCN(): string {
    return [
      '你是"小红书发文执行专家"，专注于将内容推入发布流程。不用在意既往任务队列等',
      '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
      '',
      '【发布前可参考】',
      '1. 若用户已明确指定 canvasId，直接使用该 ID，跳到步骤 3。',
      '2. 用户要求查询文章时候, 可以使用 canvas_search 搜索相关 Canvas（article 类型），尽量返回至少 5 组候选。',
      '3. 将候选 Canvas 列表以卡片形式展示给用户（含 Canvas ID、主题、文章数量），等待用户确认选择。',
      '4. 用户确认选定的 Canvas 后，才允许进入下方工作流。',
      '',
      '【发文工作流 - 每次发布任务强制执行，共七步，不得跳步】',
      '',
      '第一步：调用 get_account_pool（platform="xhs"）获取当前可用的小红书账号列表。',
      '  - 记录所有账号的 id、username、adspowerId，后续 Todo 节点按顺序轮流分配。',
      '  - 如果账号池为空，必须告知用户无法执行发布，并建议先添加小红书账号。',
      '',
      '第二步：调用 get_canvas_detail（canvasId）获取 Canvas 的文章列表。',
      '  - 记录每篇文章的 index 和 title，用于构建 todo item 节点。',
      '',
      '第三步：调用 robot_list 查看可以指派的 Agent，记录 publishAgentId 和 trackAgentId。',
      '',
      '第四步：调用 todo_create 创建「发文追踪 Todo」（不设 assignee，等待回调触发）：',
      '  - title：[追踪] <主题/Canvas名>',
      '  - type：auto_execute',
      '  - assignee：不设定',
      '  - aiPlan：说明需在发布 Todo 完成后启动；采集目标帖子的 postUrl、标题、点赞/收藏/评论数。',
      '  - 记录响应中的 todo.id 作为 trackingTodoId。',
      '',
      '第五步：调用 todo_create 创建「发布执行 Todo」（暂不设 assignee）：',
      '  - title：发布任务 - <Canvas 主题>',
      '  - type：auto_execute',
      '  - resource：[{"type":"canvas","resourceId":<canvasId>},{"type":"file","resourceId":"小红书网站操作说明.md"}]',
      '  - aiPlan 必须包含以下全部内容：',
      '    1. 发布目标和 Canvas ID',
      '    2. [重要] 当前任务已经构建了对应的浏览器和对应的账号来进行每一步的发布任务，请严格按照 todo list 来进行发文和状态更改。',
      '    3. [！必须！] 发布成功后必须抓取帖子链接（postUrl），将其写入任务结果（taskResult）。',
      '    4. 账号列表（将第一步获取到的账号全部列出：username、adspowerId）',
      '  - callbacks：[{"event":"update_process_task","params":{"targetTodoId":<trackingTodoId>,"assignee":"<trackAgentId>"}}]',
      '    （发布完成后将自动把追踪任务派给数据追踪代理并触发执行）',
      '  - 记录响应中的 todo.id 作为 publishTodoId。',
      '',
      '第六步：依次为每篇文章调用 todo_item_create 构建执行节点列表（账号轮流分配）：',
      '  - todoId：publishTodoId',
      '  - title：账号 <username> 发送第 <n> 篇：<文章标题>',
      '  - description：adspowerId=<adspowerId>；请按顺序执行，发完后将本节点状态改为 done。',
      '  - stage：发布节点 <n>/<总数>',
      '  - 每篇文章一个节点，账号按顺序循环（第1篇→账号1，第2篇→账号2，…，超出后循环）。',
      '  ⚠️ 此步骤必须全部完成后才允许进入第七步，否则机器人提前触发会忽略节点列表。',
      '',
      '第七步：所有节点创建完毕后，调用 todo_update 设置 assignee 触发发布机器人：',
      '  - id：publishTodoId',
      '  - assignee：publishAgentId',
      '',
      '第八步：输出两条 task-it 代码块：',
      '  发布任务：```task-it',
      '  {"todoId":<发布id>,"status":"pending"}',
      '  ```',
      '  追踪任务：```task-it',
      '  {"todoId":<追踪id>,"status":"pending"}',
      '  ```',
      '',
      '【执行约束】',
      '1. 发布前确认用户已完成内容审核，禁止在内容草稿阶段触发发布。',
      '2. 如内容未生成，请提示用户先完成内容创作，本代理只处理"确认发布"阶段。',
      '3. todo_create 中 userId 由会话上下文注入，禁止手填。',
      '4. 追踪 Todo 必须先于发布 Todo 创建（第四步先于第五步），以便获取 trackingTodoId 写入 callbacks。',
      '5. todo_item_create 全部完成后才能调用 todo_update 设置 assignee，否则节点列表会被忽略。',
    ].join('\n');
  }

  /**
   * @description 生文专家系统提示词 — 固定小红书真实分享文风，不追问多平台文风。
   * @keyword-cn 小红书生文, 固定文风
   * @keyword-en xhs-article-expert, writing-style
   */
  private getXhsArticleExpertPromptCN(): string {
    return [
      '你是"小红书生文专家"，专注于策划与撰写小红书图文内容。',
      '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
      '',
      '【Canvas 内容展示规则 - 严格遵守】',
      '- 当用户要查看/预览某个 Canvas 具体内容时，直接输出 canvas-it 代码块，禁止展开文字描述内容。',
      '- 格式：```canvas-it\n{"canvasId":<id>,"type":"article"}\n```',
      '- canvas_search 工具仅用于搜索定位，找到后输出 canvas-it 块即可，不再调用详情工具。',
      '',
      '【生文执行规则 - 异步工作流】',
      '0. 如果用户要生成图文/配图文章但没有明确图库 tags，必须先调用 tag_select_request 发出 tag 选择卡片；用户回传"我选定标签：#A #B"后，再调用 topic_orchestrate，并把选定 tags 原样写入 userPrompt。',
      '1. 小红书生文专家固定垂直小红书平台，不向用户追问知乎/公众号/通用专业等文风；调用 topic_orchestrate 时必须把 writingStyle 写为"小红书真实分享文风"。',
      '2. userPrompt 必须以最后一条用户生成要求为准；用户额外给出风格口吻时只作为小红书笔记内部语气参考，不改变平台。',
      '3. 生文必须使用 topic_orchestrate 工具发起异步工作流，不要同步展开正文。',
      '4. tool 返回后，立即把其中的 canvas-it 代码块原样输出给用户，不要追加长篇解释。',
      '   - 若 tool 明确返回缺少图库标签/配图预检未通过/未创建 Canvas 且没有 canvas-it，只告知用户需要先选择标签、补图、减少篇数或更换标签，不要编造 Canvas 卡片。',
      '5. 当用户明确指定图组 Canvas（如"用 554 和 555 生两篇图文"）时：',
      '   - 将指定 ID 放入 topic_orchestrate.imageGroupCanvasIds（number[]）',
      '   - count 按用户要求传入（例如 2）',
      '   - 由工作流将这些图组合并映射到新图文 Canvas。',
      '   - 生文成功消费后，系统会自动把源图组 Canvas 标记为已使用；不要另行手写状态。',
      '6. 当用户未指定图组 Canvas 时：必须确保 userPrompt 中有用户明确给出的图库 tags（如 #月亮湾店 #生日派对）；没有 tags 就调用 tag_select_request，禁止让 LLM 自己编 tags 或自行搜索图片。',
      '7. 任何生文请求都不要退化成"仅搜索+口头计划"，必须实际调用 topic_orchestrate。',
      '【N 篇文章 = 一次调用，一个 Canvas】',
      '- 用户说"生成 N 篇 / 来 N 篇 / 写 N 个选题"时，必须一次性调用 topic_orchestrate 并传 count=N，N 篇全部落到同一个 Canvas。',
      '- 用户本轮只是"开始生成/确认/按这个执行/可以了"等延续上一轮方案时，必须继承最近对话里已确认的篇数；上一轮确认 3 篇就传 count=3，不得因为本轮短句或单数标题改成 1。',
      '- 严禁串行调用 N 次 topic_orchestrate（每次 count=1）来制造 N 个 Canvas，这是错误用法。',
      '- 如果模型怀疑要分批，立刻停止并改为单次 count=N 的调用。',
      '',
      '【图文创作规范】',
      '- 标题：15~20 字，含核心关键词与情绪词，吸引目标用户点击',
      '- 正文：800~1200 字，结构分明，段落间有钩子，结尾引导互动',
      '- 标签：8~15 个，覆盖主话题、长尾词、竞品词',
      '- 风格：与提供的图片视觉风格保持一致',
      '- 每篇图文对应一组图片，tags 与图组 Canvas 中的 tags 保持一致',
      '',
      '【工具使用】',
      '- tag_select_request：图文生成前收集图库 tags/素材方向（用户未明确 tags 时必须调用；已给 tags 时跳过）',
      '- xhs_list_unused_image_groups：查询未被生文消费的图片组 Canvas；用户问"未使用图组/可用图组/哪些图组还没生文"时优先调用',
      '- canvas_search：搜索 Canvas（type 参数指定 image-group）',
      '- xhs_get_canvas_detail：按 ID 查看 Canvas 摘要信息',
      '- topic_orchestrate：发起异步生文并返回新 Canvas',
      '- article_library_list：列出可用文章库，供用户按标题或 id 选择',
      '- canvas_store_to_article_library：把整个 Canvas 或指定文章存入文章库',
      '- article_library_get_push_qr：按文章库标题或 id 获取二维码 qrContent',
      '【文章库工作流】用户要求把 Canvas 存入文章库时，如果未指定库，先列出候选文章库；用户用标题确认后再调用入库工具。若 Canvas 仍在生成中，告诉用户完成后再入库。用户要求二维码时，优先按标题或 id 调用二维码工具，返回 qrContent，不要自行生成 token。',
    ].join('\n');
  }

  /**
   * @description 生图专家系统提示词 — 专注图组 Canvas 的创建与素材管理。
   * @keyword-en xhs image expert system prompt
   */
  private getXhsImageExpertPromptCN(): string {
    return [
      '你是"小红书生图专家"，专注于小红书图组素材的创建与管理。',
      '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
      '',
      '【Canvas 内容展示规则 - 严格遵守】',
      '- 当用户要查看/预览某个 Canvas 具体内容时，直接输出 canvas-it 代码块，禁止展开文字描述。',
      '- 格式：```canvas-it\n{"canvasId":<id>,"type":"image-group"}\n```',
      '- canvas_search 工具仅用于搜索定位，找到后输出 canvas-it 块即可，不再调用详情工具。',
      '',
      '【核心职责】',
      '- 根据用户的主题/标签需求，规划并创建图组 Canvas（type=image-group）',
      '- 每个图组对应一篇文章的配图集合（6 张/组为默认模板）',
      '- 协助用户从图库检索合适素材，或触发 AI 生图流程',
      '',
      '【图组 Canvas 创建规则】',
      '1. 必须调用 xhs_create_image_group_canvas 创建，不要只返回文字建议。',
      '2. 创建前确认：主题词、关键词标签、文章篇数（决定图组数量）。',
      '3. 每篇文章的 tags 必须精准反映该文章的主题，用于后续与生文 Canvas 关联。',
      '4. 一次需求只允许调用一次 xhs_create_image_group_canvas，把所有 N 篇 articles 一次性传入（groupCount=N、articles 长度=N）；严禁拆成多次单篇调用产生多个 Canvas。',
      '5. 调用后把工具结果里的 canvas-it 代码块原样返回。',
      '',
      '【图库工具】',
      '- xhs_list_unused_image_groups：查询未被生文消费的图片组 Canvas',
      '- canvas_search：搜索已有 Canvas（type=image-group）',
      '- xhs_get_canvas_detail：查看 Canvas 详情',
      '- xhs_create_image_group_canvas：创建图组 Canvas',
      '- gallery_search_images：向量+标签检索图库素材',
      '- gallery_list_images：列出图片',
      '- gallery_list_tags：查看可用标签',
      '- gallery_random_images：随机取图',
      '',
      '返回图片路径使用相对路径（如 /static/uploads/xxx.jpg），禁止拼接域名。',
    ].join('\n');
  }

  /**
   * @description 获取工具集合
   * @keyword-en get tools
   */
  private getTools(
    streamWriter?: (msg: string) => void,
    scope?: FunctionCallScope,
    mode: ConversationSessionType = 'default',
  ): CreateAgentParams['tools'] {
    return this.tools.getHandle(streamWriter, scope, { mode });
  }

  /**
   * @description 构建图库子代理配置（统一 xhs-specialist/default，避免重复设计与规则漂移）
   * @keyword-en build gallery subagent shared config
   */
  private buildGallerySubagent(
    envStr: string,
    tools: StructuredTool[],
  ): DeepAgentSubAgent {
    return {
      name: 'gallery_subagent',
      description:
        '⚡【图组Canvas(image-group)·图库搜图·素材】「图组」「图片组」「image-group」「配图集合」「图组Canvas」以及仅配图需求 → 委派此代理；若用户明确要图文/正文/全套，交由图文生成专家处理。',
      systemPrompt: [
        envStr,
        '你是图库与图片素材子代理，同时负责创建图片组 Canvas（image-group 类型）并触发匹配生图。',
        '【图组Canvas创建规则】',
        '  1. 当用户需求包含文章配图/生图时，必须调用 xhs_create_image_group_canvas，不要只返回文字建议。',
        '  2. groupCount 与 articles 数量保持一致；文章篇数必须按用户或LLM指定，不要强制改成 6-8 篇。',
        '  3. **数量缺省规则**：用户未明确说"N 组/N 篇"时，默认只生成 1 组（articles 只传 1 篇，groupCount=1）。"一组/一套/一份"在中文里就是 1 组，严禁把"团建/美食/旅行"等单一主题自行拆成多个子场景来凑多组。',
        `  4. 每篇文章配图目标为 ${this.IMAGE_PER_ARTICLE_MIN_COUNT}-${this.IMAGE_PER_ARTICLE_MAX_COUNT} 张（当前图组模板默认 6 张）。`,
        '  5. **一次调用 = 一个 Canvas**：用户说"N 组/N 篇"时，把全部 N 篇 articles 一次性传给 xhs_create_image_group_canvas（groupCount=N、articles 长度=N），落到同一个 Canvas；严禁循环调用 N 次产生 N 个 Canvas。',
        '  6. **canvas-it 已由系统提前推送给前端**，你只需输出一句简短确认（例如"图组 Canvas 已创建，正在后台生成"），**严禁再输出 ```canvas-it``` 代码块**，也不要再调用任何其他工具。',
        '【Canvas 工具】',
        '- xhs_list_unused_image_groups：查询未被生文消费的图片组 Canvas',
        '- canvas_search：搜索 Canvas 列表',
        '- xhs_get_canvas_detail：获取 Canvas 详情（含文章和图片组）',
        '- xhs_create_image_group_canvas：创建图片组 Canvas（异步后台生成，立即返回 generating 状态）',
        '【图库工具】',
        '- gallery_search_images：向量+标签检索（优先使用）',
        '- gallery_list_images：列出图片',
        '- gallery_list_tags：列标签',
        '- gallery_random_images：随机取图',
        '返回图片路径使用相对路径（如 /static/uploads/xxx.jpg），禁止拼接域名。',
        '若用户明确只需要文章正文且不需要配图，可改由 topic_orchestrate_subagent 处理。',
      ]
        .filter(Boolean)
        .join('\n'),
      tools,
    };
  }

  /**
   * @description 读取请求租户范围
   * @keyword-en resolve request scope
   */
  private getRequestScope(request: ChatRequest): FunctionCallScope & {
    sessionType: ConversationSessionType;
  } {
    const tenantId = request.tenantId?.trim();
    const userId = request.userId?.trim();
    const validTypes: ConversationSessionType[] = [
      'default',
      'thought',
      'gallery-agent',
      'xhs-specialist',
      'xhs-tracker',
      'xhs-publisher',
      'xhs-article-expert',
      'xhs-image-expert',
    ];
    const sessionType = validTypes.includes(
      request.sessionType as ConversationSessionType,
    )
      ? (request.sessionType as ConversationSessionType)
      : 'default';
    const category = sessionType.startsWith('xhs') ? 'xhs' : undefined;
    return {
      tenantId: tenantId || undefined,
      userId: userId || undefined,
      sessionType,
      category,
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
    scope?: FunctionCallScope,
    mode: ConversationSessionType = 'default',
  ): CreateAgentParams['tools'] {
    const tools = this.getTools(streamWriter, scope, mode) ?? [];
    if (mode === 'thought') return tools;
    if (this.isTopicOrchestrateIntent(input)) {
      const allow = new Set([
        'task',
        'topic_orchestrate',
        'tag_select_request',
        'data_analysis',
        'mcp_list_resources',
        'mcp_read_resource',
        'mcp_ingest_file',
        'mcp_list_mcp_tools',
        'mcp_list_mcp_resources',
      ]);
      return tools.filter((t) => {
        const name = (t as unknown as { name?: string }).name ?? '';
        if (allow.has(name)) return true;
        return /duck|ddg|duckduckgo|web_search/i.test(name);
      });
    }
    return tools;
  }

  /**
   * @description 按职责映射各 subagent 专属工具集。每个 subagent 只持有完成其职责所需的工具，禁止传全量 baseTools。
   * @keyword-en resolve per-subagent tool sets by responsibility
   */
  private resolveSubagentToolSets(
    allTools: StructuredTool[],
    scope?: {
      tenantId?: string;
      userId?: string;
      earlyEmit?: (text: string) => void;
    },
  ): {
    analysis: StructuredTool[];
    topicOrchestrate: StructuredTool[];
    frontend: StructuredTool[];
    ops: StructuredTool[];
    task: StructuredTool[];
    gallery: StructuredTool[];
  } {
    const pick = (...names: string[]): StructuredTool[] => {
      const set = new Set(names);
      return allTools.filter((t) => set.has(t.name));
    };
    const pickPrefix = (...prefixes: string[]): StructuredTool[] =>
      allTools.filter((t) => prefixes.some((p) => t.name.startsWith(p)));

    // 搜索类 MCP 工具（如 ddg-search）— 先排除前缀再保留 duck 匹配
    const searchTools = allTools.filter((t) => {
      const n = t.name;
      if (!n) return false;
      if (
        n.startsWith('gallery_') ||
        n.startsWith('xhs_') ||
        n.startsWith('todo_') ||
        n.startsWith('dashboard_') ||
        n.startsWith('frontend_')
      ) {
        return false;
      }
      return /duck|ddg|duckduckgo|web_search/i.test(n);
    });
    const xhsTools = this.normalizeSubagentTools(
      this.mediaAgent.getXhsToolsHandle(scope),
    );
    const tagSelectTools = xhsTools.filter(
      (t) => t.name === 'tag_select_request',
    );

    return {
      // 数据查询分析 — 独立来源（含 schema/data_source/js_calc/thought 等）
      analysis: [
        ...this.normalizeSubagentTools(
          this.analysisTools.getAllDataSourceTools(scope),
        ),
        ...searchTools,
      ],
      // 文章正文生成（可先做数据收集）
      topicOrchestrate: Array.from(
        new Map(
          [
            ...pick('topic_orchestrate', 'data_analysis'),
            ...pick(
              'mcp_list_resources',
              'mcp_read_resource',
              'mcp_ingest_file',
              'mcp_list_mcp_tools',
              'mcp_list_mcp_resources',
            ),
            ...tagSelectTools,
            ...searchTools,
          ].map((t) => [t.name, t] as const),
        ).values(),
      ),
      // 前端可视化 — HTML/图表生成 + 标题 + MCP 读取 + 看板只读查询
      frontend: [
        ...pick('frontend_plan', 'frontend_finalize', 'title_generate'),
        ...pick(
          'mcp_list_resources',
          'mcp_read_resource',
          'mcp_ingest_file',
          'mcp_list_mcp_tools',
          'mcp_list_mcp_resources',
        ),
        ...pick(
          'tenant_tables',
          'tenant_query',
          'dashboard_mongo_search',
          'dashboard_config_view',
        ),
      ],
      // 执行编排 — Todo 管理 + 机器人 + MCP 适配器执行工具 + 看板写入
      // 批量发布 — robot 指派/内容分发/发布执行 + 剩余 MCP 自动化工具
      ops: [
        ...pick('robot_list'),
        ...pick('dashboard_config_patch'),
        // 剩余 MCP 适配器工具（非分析/前端/图库/搜索/任务类），如自动化指令等
        ...allTools.filter((t) => {
          const n = t.name;
          return (
            !n.startsWith('todo_') &&
            !n.startsWith('frontend_') &&
            !n.startsWith('gallery_') &&
            !n.startsWith('mcp_') &&
            !n.startsWith('tenant_') &&
            !n.startsWith('dashboard_') &&
            !n.startsWith('xhs_') &&
            !/duck|ddg|duckduckgo|web_search/i.test(n) &&
            ![
              'robot_list',
              'title_generate',
              'topic_orchestrate',
              'js_calc',
              'js_calc_batch',
              'decision_card_generate',
            ].includes(n)
          );
        }),
      ],
      // 任务编排 — 待办/工单的创建、编排、管理(todo_* 全家桶)
      task: [...pickPrefix('todo_')],
      // 图库 + XHS Canvas — 完全独立来源
      gallery: [
        ...this.normalizeSubagentTools(
          this.mediaAgent.getGalleryToolsHandle(scope),
        ),
        ...xhsTools,
        // 搜索工具仅用于图组素材搜集
        ...searchTools,
      ],
    };
  }

  /**
   * @description 从主 agent 工具列表中移除只给 subagent 使用的专属工具，强制走路由委派
   * @keyword-en filter out subagent-only tools from main agent
   */
  private filterSubagentOnlyTools(
    tools: CreateAgentParams['tools'],
    mode: ConversationSessionType,
    input?: string,
  ): CreateAgentParams['tools'] {
    if (
      mode === 'thought' ||
      mode === 'gallery-agent' ||
      mode === 'xhs-specialist' ||
      mode === 'xhs-tracker' ||
      mode === 'xhs-publisher' ||
      mode === 'xhs-article-expert' ||
      mode === 'xhs-image-expert'
    ) {
      return tools;
    }
    const isTopicIntent =
      typeof input === 'string' && this.isTopicOrchestrateIntent(input);
    // default 模式：主agent不直接持有这些工具，全部交给对应subagent
    // 注意:xhs_create_image_group_canvas 故意不在 subagentOnly 中,允许主 agent 直接调,
    //   工具本身已经 fire-and-forget 异步生图 + earlyEmit 推 canvas-it,
    //   避免被 gallery_subagent 的 LLM 二次推理阻塞前端 canvas-it 卡片到达时机。
    const subagentOnly = new Set([
      'topic_orchestrate', // → topic_orchestrate_subagent
      'xhs_list_canvases', // → gallery_subagent (列表查询走 subagent)
      'xhs_get_canvas_detail', // → gallery_subagent (详情查询走 subagent)
    ]);
    const topicDataCollectionOnly = new Set([
      'data_analysis',
      'mcp_list_resources',
      'mcp_read_resource',
      'mcp_ingest_file',
      'mcp_list_mcp_tools',
      'mcp_list_mcp_resources',
    ]);
    return (tools ?? []).filter((t) => {
      const name = (t as { name?: string }).name ?? '';
      if (subagentOnly.has(name)) return false;
      if (isTopicIntent && topicDataCollectionOnly.has(name)) return false;
      if (isTopicIntent && /duck|ddg|duckduckgo|web_search/i.test(name)) {
        return false;
      }
      return true;
    });
  }

  /**
   * @description 调试用：打印主 agent 和各 subagent 的工具名称列表
   * @keyword-en debug log LLM tools
   */
  private logToolsForLLM(
    path: 'sync' | 'stream',
    mode: ConversationSessionType,
    mainAgentTools: CreateAgentParams['tools'],
    subagents: DeepAgentSubAgent[],
  ): void {
    const main = (mainAgentTools ?? [])
      .map((t) => (t as { name?: string }).name)
      .filter(Boolean);
    console.log(
      `[tools:llm:${path}] mode=${mode} mainAgent tools (${main.length}):`,
      main,
    );
    for (const sa of subagents ?? []) {
      const names = (sa.tools ?? [])
        .map((t) => (t as { name?: string }).name)
        .filter(Boolean);
      console.log(
        `[tools:llm:${path}] subagent="${sa.name}" tools (${names.length}):`,
        names,
      );
    }
  }

  /**
   * @description 构建小红书主专家的专属自动路由专家定义。
   * @keyword-cn 小红书专家, 专家直派, 子领域路由
   * @keyword-en xhs-specialist-subagents, expert-dispatch
   */
  private buildXhsSpecialistSubagents(
    envStr: string,
    allTools: StructuredTool[],
    toolSets: {
      analysis: StructuredTool[];
      topicOrchestrate: StructuredTool[];
      frontend: StructuredTool[];
      ops: StructuredTool[];
      task: StructuredTool[];
      gallery: StructuredTool[];
    },
  ): DeepAgentSubAgent[] {
    const byName = new Map(allTools.map((t) => [t.name, t] as const));
    const pick = (...names: string[]): StructuredTool[] =>
      names
        .map((name) => byName.get(name))
        .filter((t): t is StructuredTool => Boolean(t));
    const pickPrefix = (...prefixes: string[]): StructuredTool[] =>
      allTools.filter((t) => prefixes.some((p) => t.name.startsWith(p)));
    const unique = (...groups: StructuredTool[][]): StructuredTool[] =>
      Array.from(
        new Map(groups.flat().map((t) => [t.name, t] as const)).values(),
      );

    const todoTools = pickPrefix('todo_');
    const articleTools = unique(
      todoTools,
      toolSets.topicOrchestrate,
      pick(
        'canvas_search',
        'get_canvas_detail',
        'xhs_get_canvas_detail',
        'xhs_list_unused_image_groups',
        'xhs_regenerate_article_images',
        'article_library_list',
        'article_library_get_push_qr',
        'canvas_store_to_article_library',
      ),
    );
    const imageTools = unique(
      toolSets.gallery,
      pick(
        'canvas_search',
        'xhs_create_image_group_canvas',
        'xhs_list_canvases',
        'xhs_get_canvas_detail',
        'xhs_list_unused_image_groups',
        'xhs_regenerate_canvas_cover',
        'gallery_search_images',
        'gallery_random_images',
        'gallery_list_tags',
        'gallery_list_images',
      ),
    );
    const publisherTools = unique(
      todoTools,
      toolSets.ops,
      pick(
        'robot_list',
        'get_account_pool',
        'canvas_search',
        'get_canvas_detail',
        'xhs_get_canvas_detail',
        'xhs_batch_publish',
        'batch_publish',
        'canvas_execute',
      ),
    );
    const taskTools = unique(
      todoTools,
      pick(
        'robot_list',
        'canvas_search',
        'get_canvas_detail',
        'xhs_get_canvas_detail',
        'get_account_pool',
      ),
    );
    const visualReportTools = unique(
      toolSets.frontend,
      toolSets.analysis,
      pick(
        'canvas_search',
        'get_canvas_detail',
        'xhs_get_canvas_detail',
        'xhs_list_canvases',
        'title_generate',
      ),
    );

    return [
      {
        name: 'xhs_data_tracker_subagent',
        description:
          '【小红书数据追踪】粉丝/点赞/收藏/评论/爆文/竞品/发文后数据采集与分析 -> 委派此专家。',
        systemPrompt: [envStr, this.getXhsTrackerPromptCN()]
          .filter(Boolean)
          .join('\n\n'),
        tools: unique(toolSets.analysis, pick('canvas_search')),
      },
      {
        name: 'xhs_article_expert_subagent',
        description:
          '【小红书生文】选题、正文、笔记、种草图文、文章库入库/二维码 -> 委派此专家。',
        systemPrompt: [envStr, this.getXhsArticleExpertPromptCN()]
          .filter(Boolean)
          .join('\n\n'),
        tools: articleTools,
      },
      {
        name: 'xhs_image_expert_subagent',
        description:
          '【小红书生图】图组、配图、封面、图库搜图、图片组 Canvas -> 委派此专家。',
        systemPrompt: [envStr, this.getXhsImageExpertPromptCN()]
          .filter(Boolean)
          .join('\n\n'),
        tools: imageTools,
      },
      {
        name: 'xhs_publish_subagent',
        description:
          '【小红书发文执行】账号池、批量发布、Adspower、机器人发文、发布任务 -> 委派此专家。',
        systemPrompt: [envStr, this.getXhsPublisherPromptCN()]
          .filter(Boolean)
          .join('\n\n'),
        tools: publisherTools,
      },
      {
        name: 'xhs_task_subagent',
        description:
          '【小红书任务管理】查看、创建、更新、追踪小红书任务和执行节点 -> 委派此专家。',
        systemPrompt: [
          envStr,
          '你是小红书任务管理专家。负责用 todo_* 工具查看、创建、更新、追踪小红书相关任务和执行节点；不要替代生文、生图、数据采集或发文执行专家做业务产出。',
        ]
          .filter(Boolean)
          .join('\n\n'),
        tools: taskTools,
      },
      {
        name: 'xhs_visual_report_subagent',
        description:
          '【小红书可视化】小红书数据图表、HTML 看板、dashboard、可视化报告 -> 委派此专家。',
        systemPrompt: [
          envStr,
          '你是小红书数据可视化专家。负责先获取小红书相关数据口径，再生成图表、HTML 看板或 dashboard；输出必须遵守前端/可视化工具的返回格式。',
        ]
          .filter(Boolean)
          .join('\n\n'),
        tools: visualReportTools,
      },
    ];
  }

  /**
   * @description 构建默认子代理配置
   * @keyword-en build default subagents
   */
  private buildDefaultSubagents(
    tools: CreateAgentParams['tools'],
    mode: ConversationSessionType,
    scope?: {
      tenantId?: string;
      userId?: string;
      earlyEmit?: (text: string) => void;
    },
    env?: {
      sid: string;
      now: string;
      ip: string;
      platformSupplement?: string;
    },
  ): DeepAgentSubAgent[] {
    const allTools = this.normalizeSubagentTools(tools);
    const toolSets = this.resolveSubagentToolSets(allTools, scope);

    // 给每个 subagent 注入主 agent 的 sanitize/诊断 middleware。
    // deepagents 默认不会把主 agent 的 customMiddleware 透传给 subagent,
    // 导致 subagent 内部 model 调用得不到 sanitize 兜底 + 诊断 log,
    // 出错时只看到 patchToolCallsMiddleware 抛 `expected AIMessage or Command, got object` 而无原始数据。
    const sanitizeMw = this.agent.buildSubagentSanitizeMiddleware();
    const injectMiddleware = (subs: DeepAgentSubAgent[]): DeepAgentSubAgent[] =>
      subs.map((s) => ({
        ...s,
        middleware: [
          ...((s.middleware as unknown[]) ?? []),
          sanitizeMw,
        ] as DeepAgentSubAgent['middleware'],
      }));
    const envStr = env
      ? [
          `SESSION_ID:${env.sid}`,
          `REQUEST_TIME_ISO:${env.now}`,
          `CLIENT_IP:${env.ip}`,
          scope?.userId ? `CURRENT_USER_ID:${scope.userId}` : '',
          '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
          env.platformSupplement ? env.platformSupplement : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

    if (mode === 'thought') {
      return injectMiddleware([
        {
          name: 'analysis_subagent',
          description: '思维链/Schema 分析子代理',
          systemPrompt: [envStr, this.getThoughtPromptCN()]
            .filter(Boolean)
            .join('\n\n'),
          tools: toolSets.analysis,
        },
      ]);
    }

    if (mode === 'xhs-specialist') {
      return injectMiddleware(
        this.buildXhsSpecialistSubagents(envStr, allTools, toolSets),
      );
    }

    if (
      mode === 'xhs-tracker' ||
      mode === 'xhs-publisher' ||
      mode === 'xhs-article-expert' ||
      mode === 'xhs-image-expert'
    ) {
      return injectMiddleware([
        this.buildGallerySubagent(envStr, toolSets.gallery),
      ]);
    }

    const analysisSys = [
      '你是一名严谨、务实的数据分析 Agent。',
      '目标：以最小推理成本与最少工具调用，在单次流程内一次性获取所需数据并返回最终答案。',
      '涉及任何加减乘除、比例、汇总、均值、环比、同比等计算时，必须调用 js_calc 或 js_calc_batch，禁止心算。',
      '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
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
      '【决策卡生成】当用户诉求属于"方案/决策/策略/建议"类时：',
      '- 已有可支撑数据 → 调用 decision_card_generate 生成决策卡',
      '- 数据不足 → 先按上述流程查数据，再生成决策卡',
      '- 工具返回决策卡信息（cardId）后，回复中输出一个 ```decision-it``` JSON 代码块（至少含 cardId），供前端渲染',
      '【约束】',
      '- 默认 limit = 50，最大 200',
      '- 避免不必要的多轮工具调用',
      scope?.tenantId
        ? `- 当前租户 tenantId=${scope?.tenantId}，所有数据查询必须带 tenantId 过滤条件，禁止跨租户`
        : '- 当前为平台范围（无 tenantId），仅允许查询平台级数据',
    ];
    if (envStr) analysisSys.unshift(envStr);

    return injectMiddleware([
      {
        name: 'analysis_subagent',
        description:
          '【数据查询·统计·趋势分析】查数据 / 统计聚合 / 趋势分析 / 筛选记录 → 必须委派此代理。不处理文章生成、图库、发布任务。',
        systemPrompt: analysisSys.join('\n'),
        tools: toolSets.analysis,
      },
      {
        name: 'topic_orchestrate_subagent',
        description: [
          '【图文/文章生成】用户要生成小红书/平台图文、正文、文章时委派此代理。禁止直接输出文章正文，必须调用 topic_orchestrate 工具写入 Canvas, Canvas 是异步加载的 不需要等待返回!',
          '该代理可先做数据收集：优先通过 task 委派 analysis_subagent，或直接用 data_analysis / duckduckgo 相关 MCP 搜索工具整理素材，再调用 topic_orchestrate。',
        ].join('\n'),
        systemPrompt: [
          envStr,
          '你是专项文章生成代理。',
          '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
          '若用户要生成图文/配图文章但未明确图库 tags，必须先调用 tag_select_request 发出 tag 选择卡片；用户回传"我选定标签：#A #B"后，把选定 tags 原样写入 topic_orchestrate.userPrompt 再生成。',
          '严禁让 LLM 自己编 tags、自己猜图库标签或自行搜索图片来配图；topic_orchestrate 的 image-group 链路只接受用户明确给出的 tags 或指定的 imageGroupCanvasIds。',
          '调用 topic_orchestrate 前必须确认生文风格；如果最后一条用户要求没有明确平台/文风（小红书/知乎/公众号/通用专业等），先只问用户一句文风选择问题并等待回答，不要调用工具。',
          '当用户已明确文风或平台时，把文风写入 topic_orchestrate.writingStyle；userPrompt 必须忠实压缩最后一条用户生成要求，不能只复用更早历史。',
          '在调用 topic_orchestrate 之前，先判断是否需要补充事实数据/案例/趋势。',
          '若信息不足：优先通过 task 委派 analysis_subagent 做结构化数据收集；如需外部实时信息，可调用 duckduckgo/web_search 类 MCP 工具检索。',
          '你也可以直接调用 data_analysis 完成数据库分析；但当任务较复杂时，优先使用 analysis_subagent 以获得更稳定的数据链路。',
          '完成数据收集后，必须将结果压缩为 dataSummary（建议 300-1200 字，包含数据来源、关键结论、可用于写作的要点），并在调用 topic_orchestrate 时一并传入。',
          '调用 topic_orchestrate 时，同时传入 userPrompt（最后一条用户生成要求的精炼重述）、writingStyle（已确认文风）和 dataSummary（你整理的数据摘要）。',
          '多篇文章可以在一个Canvas里生成，给 topic_orchestrate 对应的数量参数即可，禁止通过重复调用来生成多篇文章。',
          '如果本轮是"开始生成/确认/按这个执行/可以了"等延续上一轮方案，必须继承最近对话已确认的篇数和选题；上一轮确认 3 篇就传 count=3，不得因为本轮短句或单数标题传 count=1。',
          'topic_orchestrate 工具会返回简短状态和 canvas-it 代码块；你只需要告知用户正在生成中,并把 canvas-it 代码块原样输出给用户，让前端渲染看板入口。禁止输出工具 JSON、canvas 对象、文章 items 或标题列表。',
          '如果 topic_orchestrate 返回"缺少图库标签/配图预检未通过/未创建 Canvas"且没有 canvas-it，只能用一句话告知用户需要先选择标签、补图、减少篇数或更换标签，禁止编造 Canvas 入口。',
          '你的职责仅是整理参数并调用 topic_orchestrate 工具，禁止直接输出文章正文、标题列表、items JSON。',
          '【userId 来源】上方 CURRENT_USER_ID 字段即当前用户 ID，调用 topic_orchestrate 时必须把此值传给 userId 参数，禁止省略、禁止自造。',
          '所有文章产出都必须通过 topic_orchestrate 工具写入 Canvas，禁止直接返回文章正文或大纲。',
          '小红书正文要求：开头 1-2 句强钩子；短句短段；多要点列表；真实分享语气；末尾 3-6 个话题标签（#标签）；至少 200 字。',
          '工具调用规则：',
          '  - tag_select_request 在缺少图库 tags/素材方向时必须调用一次；用户已经给出 tags 或"我选定标签"时才可以直接 topic_orchestrate',
          '  - 调用 topic_orchestrate 时 userPrompt 必须包含明确图库 tags，除非传了 imageGroupCanvasIds',
          '  - topic_orchestrate 只调用一次，禁止重复',
          '  - 工具报错时原文返回用户，不重试',
          '  - ARTICLE_DRAFT_INVALID → 告知"生成未通过质量校验"，建议调整话题',
          '【重要】工具调用成功后，只输出一句简短说明 + 工具返回结果中的 canvas-it 代码块，让前端立即渲染 Canvas 入口卡片。不再调用其他工具；不要复述任何 JSON 数据。',
        ]
          .filter(Boolean)
          .join('\n'),
        tools: toolSets.topicOrchestrate,
      },
      {
        name: 'frontend_subagent',
        description:
          '【图表·HTML·可视化页面】用户明确要求「生成图表」「HTML页面」「可视化报告」→ 委派此代理。',
        systemPrompt: [
          envStr,
          '你是前端页面生成子代理。只在用户明确要求图表/页面/可视化时工作。',
          '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
          '除非用户明确要求 MCP 资源读取/导入，否则不要调用任何 mcp_* 工具。',
          '若必须读取 MCP 资源，先调用 mcp_list_resources 确认存在，再调用 mcp_read_resource。',
          '输出需严格遵循工具与系统提示的约束。',
        ]
          .filter(Boolean)
          .join('\n'),
        tools: toolSets.frontend,
      },
      {
        name: 'ops_subagent',
        description:
          '【批量发布·内容分发·机器人发布执行】触发批量发布 / 指派 robot 执行发布 → 委派此代理。不处理待办/任务编排。',
        systemPrompt: [
          envStr,
          '你是批量发布子代理，专注内容批量发布、分发与 robot 发布执行，严格遵守工具调用规则。',
          '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
        ]
          .filter(Boolean)
          .join('\n'),
        tools: toolSets.ops,
      },
      {
        name: 'task_subagent',
        description:
          '【任务编排】创建/更新/查询/编排待办与工单 → 委派此代理。不处理批量发布。',
        systemPrompt: [
          envStr,
          '你是任务编排子代理，负责待办/工单的创建、更新、查询与多步骤编排。',
          '工具必须通过系统结构化 tool call 调用；禁止输出 [TOOL_CALL]、<minimax>、XML、JSON 伪工具调用文本。',
          '用 todo_* 工具落地任务，你只编排不直接执行业务；严格遵守工具调用规则。',
        ]
          .filter(Boolean)
          .join('\n'),
        tools: toolSets.task,
      },
      this.buildGallerySubagent(envStr, toolSets.gallery),
    ]);
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
      /编排|选题|规划|策划|写(几)?篇|生成(几)?篇|产出|内容|图文|正文|文章|全套|写文|软文|文案/.test(
        s,
      );
    const wantsPromote = /推广|引流|转化|营销|投放/.test(s);
    return (
      (hasPlatform && (wantsBatchContent || wantsPlanning)) ||
      (wantsBatchContent && (wantsPlanning || wantsPromote))
    );
  }

  /**
   * @description 判断当前输入是否应使用 updates-only 流模式，降低工具高频阶段 token 流写入风险。
   * @keyword-en detect updates-only stream mode intent
   */
  private shouldUseUpdatesOnlyStreamForInput(
    input: string,
    sessionType: ConversationSessionType,
  ): boolean {
    void input;
    void sessionType;
    // 为保证首屏与刷新后的结果一致性，暂时关闭 updates-only 模式，统一走默认流式。
    return false;
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

  /**
   * @description 从自然语言中提取待执行的 canvasId。
   * @keyword-en parse canvas execute id
   */
  private parseCanvasExecuteCanvasId(input: string): number | null {
    const s = String(input || '').trim();
    if (!s) return null;
    const m = s.match(/(?:^|\s)(?:执行|运行)\s*(?:canvas\s*)?(\d+)(?:\s|$)/i);
    if (!m || !m[1]) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  /**
   * @description 从工具输出中提取 canvas-it 结构化信息。
   * @keyword-en extract canvas-it items
   */
  private extractCanvasItItems(output: unknown): Array<{
    canvasId: number;
    status?: string;
    topic?: string;
    platform?: string;
    articleCount?: number;
    needFields?: string[];
    type?: string;
  }> {
    type CanvasItItem = {
      canvasId: number;
      status?: string;
      topic?: string;
      platform?: string;
      articleCount?: number;
      needFields?: string[];
      type?: string;
    };

    const out: CanvasItItem[] = [];
    const visited = new Set<unknown>();

    const tryPush = (obj: Record<string, unknown>) => {
      const canvasVal = obj['canvas'];
      const canvasRec =
        canvasVal && typeof canvasVal === 'object' && !Array.isArray(canvasVal)
          ? (canvasVal as Record<string, unknown>)
          : undefined;
      const cidRaw =
        obj['canvasId'] ?? obj['canvas_id'] ?? obj['id'] ?? canvasRec?.['id'];
      const cid = Number(cidRaw);
      if (!Number.isFinite(cid)) return;
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
        type:
          typeof obj['type'] === 'string'
            ? obj['type']
            : typeof canvasRec?.['type'] === 'string'
              ? canvasRec['type']
              : undefined,
      });
    };

    const visit = (val: unknown): void => {
      if (val === null || val === undefined) return;

      if (typeof val === 'string') {
        const s = val.trim();
        if (!s) return;
        if (s.startsWith('{') || s.startsWith('[')) {
          try {
            visit(JSON.parse(s));
          } catch {
            void 0;
          }
        }

        // Parse embedded canvas-it JSON blocks from tool text.
        const canvasItRe = /```canvas-it\s*([\s\S]*?)```/gi;
        let cim: RegExpExecArray | null;
        while ((cim = canvasItRe.exec(s)) !== null) {
          try {
            visit(JSON.parse(cim[1].trim()));
          } catch {
            void 0;
          }
        }

        const idPatterns = [
          /(?:canvasId|canvas_id)\s*[:=]\s*(\d+)/i,
          /canvas\s*\(id\s*=\s*(\d+)\)/i,
          /canvas（id\s*=\s*(\d+)）/i,
        ];
        for (const re of idPatterns) {
          const m = s.match(re);
          if (!m || !m[1]) continue;
          const cid = Number(m[1]);
          if (Number.isFinite(cid)) out.push({ canvasId: cid });
          break;
        }
        return;
      }

      if (typeof val !== 'object') return;
      if (visited.has(val)) return;
      visited.add(val);

      if (Array.isArray(val)) {
        for (const item of val) visit(item);
        return;
      }

      const rec = val as Record<string, unknown>;
      tryPush(rec);

      const text = rec['text'];
      if (typeof text === 'string') visit(text);

      const content = rec['content'];
      if (
        typeof content === 'string' ||
        Array.isArray(content) ||
        (content && typeof content === 'object')
      ) {
        visit(content);
      }

      const nestedKeys = ['result', 'data', 'summary', 'payload', 'canvas'];
      for (const key of nestedKeys) {
        const nested = rec[key];
        if (!nested) continue;
        if (typeof nested === 'string' || typeof nested === 'object') {
          visit(nested);
        }
      }
    };

    visit(output);
    if (out.length <= 1) return out;

    const merged = new Map<number, CanvasItItem>();
    for (const item of out) {
      const prev = merged.get(item.canvasId);
      if (!prev) {
        merged.set(item.canvasId, item);
        continue;
      }
      merged.set(item.canvasId, {
        canvasId: item.canvasId,
        status: prev.status ?? item.status,
        topic: prev.topic ?? item.topic,
        platform: prev.platform ?? item.platform,
        articleCount:
          typeof prev.articleCount === 'number' &&
          Number.isFinite(prev.articleCount)
            ? prev.articleCount
            : item.articleCount,
        needFields:
          Array.isArray(prev.needFields) && prev.needFields.length > 0
            ? prev.needFields
            : item.needFields,
        type: prev.type ?? item.type,
      });
    }
    return Array.from(merged.values());
  }

  /**
   * @description 从工具输出中提取 task-it 结构化信息。
   * @keyword-en extract task-it items
   */
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
        // 处理 todo_create 返回的 { todo: { id: ... } } 结构
        const todoObj = rec['todo'];
        if (todoObj && typeof todoObj === 'object') {
          const t = todoObj as Record<string, unknown>;
          const idRaw = t['id'] ?? t['todoId'];
          const idNum =
            typeof idRaw === 'number'
              ? idRaw
              : typeof idRaw === 'string'
                ? Number(idRaw)
                : NaN;
          if (Number.isFinite(idNum) && !out.some((x) => x.todoId === idNum)) {
            const status =
              typeof t['status'] === 'string' ? t['status'] : undefined;
            const taskType =
              typeof t['type'] === 'string' ? t['type'] : undefined;
            out.push({
              todoId: idNum,
              status,
              ...(taskType ? { platform: taskType } : {}),
            });
          }
        }
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

  /**
   * @description 构建 task-it markdown 代码块。
   * @keyword-en build task-it block
   */
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

  /**
   * @description 按工具结果自动补全 task-it 代码块。
   * @keyword-en append task-it block if needed
   */
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

  /**
   * @description 构建 canvas-it markdown 代码块。
   * @keyword-en build canvas-it block
   */
  private buildCanvasItBlock(item: {
    canvasId: number;
    status?: string;
    topic?: string;
    platform?: string;
    articleCount?: number;
    needFields?: string[];
    type?: string;
  }): string {
    const payload: Record<string, unknown> = { canvasId: item.canvasId };
    if (typeof item.type === 'string' && item.type.length > 0) {
      payload['type'] = item.type;
    }
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

  /**
   * @description 按工具结果自动补全 canvas-it 代码块。
   * @keyword-en append canvas-it block if needed
   */
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
      topic?: string;
      platform?: string;
      articleCount?: number;
      needFields?: string[];
      type?: string;
    }> = [];
    const seen = new Set<number>();
    for (const it of fromTools) {
      const cid = Number(it.canvasId);
      if (!Number.isFinite(cid) || seen.has(cid)) continue;
      seen.add(cid);
      unique.push({
        canvasId: cid,
        status: it.status,
        topic: it.topic,
        platform: it.platform,
        articleCount: it.articleCount,
        needFields: it.needFields,
        type: it.type,
      });
    }
    if (unique.length === 0) return base;

    return cleaned + unique.map((it) => this.buildCanvasItBlock(it)).join('');
  }

  /**
   * @description 从工具输出中提取决策卡数据。
   * @keyword-en extract decision items
   */
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

  /**
   * @description 构建 decision-it markdown 代码块。
   * @keyword-en build decision-it block
   */
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

  /**
   * @description 若存在决策结果则补充简短摘要文案。
   * @keyword-en append decision summary if needed
   */
  private appendDecisionSummaryIfNeeded(
    text: string,
    toolResults?: Array<{ name?: unknown; output?: unknown }>,
  ): string {
    const base = typeof text === 'string' ? text : String(text ?? '');
    const first = (toolResults ?? [])
      .filter((tr) => tr?.name === 'decision_card_generate')
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

  /**
   * @description 按工具结果自动补全 decision-it 代码块。
   * @keyword-en append decision-it block if needed
   */
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
      .filter((tr) => tr?.name === 'decision_card_generate')
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

  /**
   * @description 当输出仅包含结构化卡片代码块时，补充可读文案，避免前端出现空消息气泡。
   * @keyword-en ensure readable narration for card-only output
   */
  private ensureReadableNarrationIfNeeded(
    text: string,
    toolResults?: Array<{ name?: unknown; output?: unknown }>,
  ): string {
    const base = typeof text === 'string' ? text : String(text ?? '');
    if (base.trim() === this.HITL_PLACEHOLDER) return base;

    const plain = base
      .replace(/```canvas-it\s*[\s\S]*?```/gi, '')
      .replace(/```task-it\s*[\s\S]*?```/gi, '')
      .replace(/```decision-it\s*[\s\S]*?```/gi, '')
      .trim();
    if (plain.length > 0) return base;

    const results = Array.isArray(toolResults) ? toolResults : [];
    const hasCanvas =
      results.flatMap((tr) => this.extractCanvasItItems(tr?.output)).length > 0;
    const hasTask =
      results.flatMap((tr) => this.extractTaskItItems(tr?.output)).length > 0;
    const hasDecision =
      results
        .filter((tr) => tr?.name === 'decision_card_generate')
        .flatMap((tr) => this.extractDecisionItems(tr?.output)).length > 0;

    const hints: string[] = [];
    if (hasCanvas) hints.push('已为你创建看板，正在生成中。');
    if (hasTask) hints.push('已为你创建执行任务，请稍候查看进度。');
    if (hasDecision) hints.push('已为你生成决策卡。');
    if (hints.length === 0) return base;

    const prefix = hints.join('\n');
    return base.trim().length > 0 ? `${prefix}\n\n${base}` : prefix;
  }

  /**
   * @description 判断输入是否更适合数据分析链路。
   * @keyword-en detect analysis intent
   */
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

  /**
   * @description 判断输入是否更适合前端可视化链路。
   * @keyword-en detect frontend intent
   */
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

  /**
   * @description 从输入中快速抽取关键词集合，用于复杂度估计。
   * @keyword-en extract keywords fast
   */
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

  /**
   * @description 根据输入复杂度与工具规模估算递归上限。
   * @keyword-en estimate default recursion limit
   */
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
