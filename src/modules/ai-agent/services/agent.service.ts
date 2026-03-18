import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  AgentRunInput,
  AgentConfig,
  AgentRunMessagesInput,
} from '../types/agent.types';
import type { AgentRunStreamInput } from '../types/agent.types';
import {
  BaseMessage,
  BaseMessageLike,
  HumanMessage,
  SystemMessage,
  AIMessageChunk,
  coerceMessageLikeToMessage,
  isBaseMessage,
  AIMessage,
} from '@langchain/core/messages';
import { StructuredTool, isStructuredTool } from '@langchain/core/tools';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { CreateAgentParams } from 'langchain';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type { SubAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import type * as z3 from 'zod/v3';
import type * as z4 from 'zod/v4/core';
import type * as z4Classic from 'zod/v4';
import { createDeepAgent } from 'deepagents';
import { AgentStreamEvent, type AgentStreamOption } from '../types/agent.types';
import { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { AdminService } from '../../admin/services/admin.service.js';

type DeepAgentReturn = Awaited<ReturnType<typeof createDeepAgent>>;
type InteropZodObject =
  | z3.ZodObject<any, any, any, any, any>
  | z4.$ZodObject
  | z4Classic.ZodObject<any, any>;

/**
 * @title Agent服务 Agent Service
 * @description 使用LangChain构建与运行Agent，支持Gemini与DeepSeek。
 * @keywords-cn Agent服务, LangChain, Gemini, DeepSeek
 * @keywords-en agent service, LangChain, Gemini, DeepSeek
 */
@Injectable()
export class AgentService {
  private readonly checkpointer: MongoDBSaver;

  constructor(
    @Inject('CTX_MONGO_CLIENT') client: MongoClient,
    config: ConfigService,
    private readonly adminService: AdminService,
  ) {
    const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
    const isDev = env === 'development' || env === 'dev';
    let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
    if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
    this.checkpointer = new MongoDBSaver({ client, dbName });

    // Monkey-patch to fix empty bulkWrite error in langgraph-checkpoint-mongodb
    const originalPutWrites = this.checkpointer.putWrites.bind(
      this.checkpointer,
    );
    this.checkpointer.putWrites = async (config, writes, taskId) => {
      if (!writes || writes.length === 0) {
        return; // Skip empty writes to avoid MongoDB Invalid BulkOperation error
      }
      return originalPutWrites(config, writes, taskId);
    };
  }

  /**
   * @title 构建聊天模型 Build Chat Model
   * @description 根据提供方返回对应的LangChain聊天模型。
   * @keywords-cn 构建模型, Gemini, DeepSeek
   * @keywords-en build model, Gemini, DeepSeek
   */
  async buildChatModel(config: AgentConfig): Promise<DeepAgentReturn> {
    const llm = await this.buildLLM(config);

    const options = {
      model: llm,
      systemPrompt: config.system,
      tools: this.normalizeTools(config.tools),
      contextSchema: this.normalizeContextSchema(config.contextSchema),
      responseFormat: config.responseFormat,
      checkpointer: this.checkpointer,
      subagents: this.normalizeSubagents(config.subagents),
    };
    return createDeepAgent(options) as DeepAgentReturn;
  }

  async buildLLM(config: AgentConfig): Promise<BaseChatModel> {
    const runtime = await this.resolveDefaultRuntime();
    const provider = String(runtime.providerCode).trim().toLowerCase();
    const rawModel = String(runtime.model ?? '').trim();
    if (!rawModel) throw new Error('AI_MODEL_NOT_CONFIGURED');
    const m = /^(openai|google-genai|anthropic):(.+)$/.exec(rawModel);
    const modelProvider = m?.[1];
    const modelName = (m?.[2] ?? rawModel).trim();
    if (!modelName) throw new Error('AI_MODEL_NOT_CONFIGURED');

    const protocol =
      provider === 'gemini'
        ? 'google-genai'
        : provider === 'minimax' ||
            provider === 'anthropic' ||
            provider === 'claude'
          ? 'anthropic'
          : 'openai';
    if (modelProvider && modelProvider !== protocol) {
      throw new Error('AI_MODEL_PROVIDER_MISMATCH');
    }

    const temperature =
      typeof config.temperature === 'number' &&
      Number.isFinite(config.temperature)
        ? config.temperature
        : undefined;

    if (protocol === 'google-genai') {
      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        temperature,
        streaming: !config.nonStreaming,
      });
    }
    if (protocol === 'anthropic') {
      return new ChatAnthropic({
        model: modelName,
        apiKey: runtime.apiKey,
        anthropicApiUrl: runtime.baseUrl,
        temperature,
        streaming: !config.nonStreaming,
      });
    }
    return new ChatOpenAI({
      model: modelName,
      apiKey: runtime.apiKey,
      temperature,
      streaming: !config.nonStreaming,
      useResponsesApi: false,
      configuration: runtime.baseUrl ? { baseURL: runtime.baseUrl } : undefined,
    });
  }

  /**
   * @title 解析默认运行时 Resolve Default Runtime
   * @description 从管理配置中解析默认AI运行时信息。
   * @keywords-cn 运行时, 默认配置
   * @keywords-en runtime, default config
   */
  private async resolveDefaultRuntime(): Promise<{
    providerCode: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }> {
    const runtime = await this.adminService.getDefaultAiProviderRuntime();
    const providerCode = String(runtime?.providerCode ?? '').trim();
    const model = String(runtime?.model ?? '').trim();
    if (!providerCode) throw new Error('AI_PROVIDER_RUNTIME_NOT_CONFIGURED');
    if (!model) throw new Error('AI_MODEL_NOT_CONFIGURED');

    const provider = providerCode.toLowerCase();
    const apiKey = String(runtime?.apiKey ?? '').trim() || undefined;
    const baseUrl = String(runtime?.baseUrl ?? '').trim() || undefined;

    if (!apiKey) throw new Error('AI_API_KEY_NOT_CONFIGURED');

    const requiresBaseUrl =
      provider === 'deepseek' ||
      provider === 'nvidia' ||
      provider === 'minimax' ||
      provider === 'anthropic' ||
      provider === 'claude';
    if (requiresBaseUrl && !baseUrl)
      throw new Error('AI_BASE_URL_NOT_CONFIGURED');

    return { providerCode, model, apiKey, baseUrl };
  }

  /**
   * @title 运行Agent Run Agent
   * @description 使用配置与历史消息执行一次对话，返回AI消息。
   * @keywords-cn 运行Agent, 对话
   * @keywords-en run agent, chat
   */
  async run(input: AgentRunInput): Promise<AIMessage> {
    const messages: BaseMessage[] = [];
    for (let i = 0; i < input.history.length; i++) {
      messages.push(input.history[i]);
    }
    messages.push(new HumanMessage(input.input));
    const extracted = this.extractSystemTextFromMessages(
      this.normalizeMessages(messages),
    );
    const mergedSystem = [input.config.system, extracted.systemText]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n\n');
    const agent = await this.buildChatModel({
      ...input.config,
      system: mergedSystem.length > 0 ? mergedSystem : undefined,
    });
    const callback: Callbacks = [
      {
        handleLLMNewToken(token: string) {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer(token);
            } catch {
              // ignore
            }
          }
        },
        handleLLMStart() {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer('[LLMStart]');
            } catch {
              // ignore
            }
          }
        },
        handleLLMEnd() {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer('[LLMEnd]');
            } catch {
              // ignore
            }
          }
        },
      },
    ];
    const state: unknown = await agent.invoke(
      {
        messages: extracted.messages,
      },
      input.config.nonStreaming ? undefined : { callbacks: callback },
    );
    const stateMessages = this.extractStateMessages(state);
    for (let i = stateMessages.length - 1; i >= 0; i--) {
      const msg = stateMessages[i];
      if (msg instanceof AIMessage) {
        return msg;
      }
    }
    return new AIMessage('');
  }

  /**
   * @title 运行Agent（消息） Run Agent With Messages
   * @description 使用消息列表执行Agent并返回最后一条AI消息。
   * @keywords-cn 运行, 消息, 调用
   * @keywords-en run, messages, invoke
   */
  async runWithMessages(input: AgentRunMessagesInput): Promise<AIMessage> {
    const callback: Callbacks = [
      {
        handleLLMNewToken() {},
        handleLLMStart() {},
        handleLLMEnd() {},
      },
    ];
    // 确保 configurable 字段始终存在
    const defaultConfigurable = {
      thread_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      checkpoint_ns: 'default',
      checkpoint_id: 'root',
    };
    const preOption: () => AgentRunMessagesInput['callOption'] = () => {
      const option: any = {
        ...input.callOption,
      };
      // 将 configurable 与默认值合并
      const existingConfigurable =
        (input.callOption as Record<string, unknown>)?.configurable ?? {};
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      option.configurable = { ...defaultConfigurable, ...existingConfigurable };

      if (input.config.nonStreaming) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        option.callbacks = callback;
      }

      if (input.config.noPostHook) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        option.tags = ['subagent'];
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      option.context = input.config.context;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return option;
    };
    const extracted = this.extractSystemTextFromMessages(
      this.normalizeMessages(input.messages),
    );
    const mergedSystem = [input.config.system, extracted.systemText]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n\n');
    const agent = await this.buildChatModel({
      ...input.config,
      system: mergedSystem.length > 0 ? mergedSystem : undefined,
    });
    const state: unknown = await agent.invoke(
      { messages: extracted.messages },
      { ...preOption() },
    );
    const stateMessages = this.extractStateMessages(state);
    for (let i = stateMessages.length - 1; i >= 0; i--) {
      const msg = stateMessages[i];
      if (msg instanceof AIMessage) {
        return msg;
      }
      if (msg instanceof AIMessageChunk) {
        return this.coerceAIMessageFromChunk(msg);
      }
    }

    return new AIMessage('');
  }

  /**
   * @title 运行子代理（消息） Run SubAgent With Messages
   * @description 以子代理模式运行消息，默认开启 noPostHook 与 nonStreaming。
   * @keywords-cn 子代理, 消息, 调用
   * @keywords-en subagent, messages, invoke
   */
  async runSubAgentWithMessages(
    input: AgentRunMessagesInput,
  ): Promise<AIMessage> {
    return await this.runWithMessages({
      ...input,
      config: {
        ...input.config,
        noPostHook: true,
        nonStreaming: true,
      },
    });
  }

  /**
   * @title 流式运行Agent Stream Agent
   * @description 以双模式流(messages+updates)返回 token、tool、subagent 等完整事件流。
   * @keywords-cn 流式, 令牌, 事件, 深度思考, 函数调用, 子代理
   * @keywords-en stream, token, events, deep thinking, function call, subagent
   */
  async *stream(input: AgentRunStreamInput): AsyncIterable<AgentStreamEvent> {
    const extracted = this.extractSystemTextFromMessages(
      this.normalizeMessages(input.messages),
    );
    const mergedSystem = [input.config.system, extracted.systemText]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n\n');
    const agent = await this.buildChatModel({
      ...input.config,
      system: mergedSystem.length > 0 ? mergedSystem : undefined,
    });
    // 确保 configurable 字段始终存在
    const defaultConfigurable = {
      thread_id: `stream_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      checkpoint_ns: 'default',
      checkpoint_id: 'root',
    };
    const existingConfigurable =
      typeof input.callOption?.configurable === 'object' &&
      input.callOption?.configurable !== null
        ? input.callOption.configurable
        : {};
    const mergedConfigurable = {
      ...defaultConfigurable,
      ...existingConfigurable,
    };
    yield { type: 'start', data: { input: extracted.messages } };

    const streamSubgraphs = input.config.streamSubgraphs ?? true;
    const callOption: NonNullable<AgentStreamOption> = {
      configurable: mergedConfigurable,
      recursionLimit: input.config.recursionLimit,
      context: input.config.context,
      subgraphs: streamSubgraphs,
    };
    if (input.callOption) Object.assign(callOption, input.callOption);

    let fullText = '';
    const toolCalls: unknown[] = [];
    const toolResults: { name?: unknown; output?: unknown }[] = [];

    try {
      const stream = await agent.stream(
        { messages: extracted.messages },
        { ...callOption, streamMode: ['messages', 'updates'] },
      );

      const logFilePath = path.join(process.cwd(), 'llm-chunk.log');
      try {
        fs.writeFileSync(logFilePath, '');
      } catch {
        // ignore
      }

      /**
       * 双模式流返回三元组: [namespace, mode, data]
       * - mode='messages': data=[message, metadata] — LLM token / tool result
       * - mode='updates':  data={nodeName: nodeData}  — 子代理生命周期
       */
      for await (const tuple of stream) {
        const arr = tuple as unknown[];
        if (!Array.isArray(arr) || arr.length < 3) continue;
        const namespace = Array.isArray(arr[0]) ? (arr[0] as string[]) : [];
        const mode = typeof arr[1] === 'string' ? arr[1] : '';
        const data = arr[2];

        // 命名空间里如果包含典型的子代理标记，或者层级深入且包含子代名字，则认为是 subagent
        // 比如可能出现 'task', 'analysis_subagent' 等，或者存在多次 'tools'
        let graphNode: unknown = undefined;
        if (Array.isArray(data) && data.length > 1) graphNode = data[1];
        const graphNodeRec =
          graphNode && typeof graphNode === 'object'
            ? (graphNode as Record<string, unknown>)
            : undefined;
        const isMainLLM = !graphNodeRec?.['lc_agent_name'];
        const isSubagent = isMainLLM
          ? Array.isArray(namespace) &&
            namespace.some(
              (s: string) => typeof s === 'string' && s.startsWith('tools:'),
            )
          : true;
        try {
          fs.appendFileSync(
            logFilePath,
            JSON.stringify(tuple, null, 2) +
              '\n Subagent: ' +
              isSubagent +
              '\n isMainLLM: ' +
              isMainLLM +
              '\n lc_agent_name:' +
              (typeof graphNodeRec?.['lc_agent_name'] === 'string'
                ? graphNodeRec['lc_agent_name']
                : '') +
              '\n\n====================\n\n',
          );
        } catch {
          // ignore
        }

        // ─── messages 模式：token 流 / tool_call 流 / tool 结果 ───
        if (mode === 'messages') {
          const messageArr = Array.isArray(data) ? data : [data];
          const message = messageArr[0] as Record<string, unknown> | undefined;
          if (!message) continue;

          const msgType = message['type'] as string | undefined;
          const isAIChunk =
            msgType === 'AIMessageChunk' ||
            msgType === 'ai' ||
            (message['_getType'] && typeof message['_getType'] === 'function');

          // tool_call_chunks — 工具调用流
          const tcChunks = message['tool_call_chunks'] as
            | Array<Record<string, unknown>>
            | undefined;
          if (isAIChunk && Array.isArray(tcChunks) && tcChunks.length > 0) {
            for (const tc of tcChunks) {
              const name = tc['name'] as string | undefined;
              const id = tc['id'] as string | undefined;
              const args = tc['args'] as string | undefined;
              const index = tc['index'] as number | undefined;
              if (name) {
                // 首次出现 name 视为 tool_start
                yield {
                  type: 'tool_start',
                  data: { id, name, input: undefined },
                };
              }
              if (args) {
                yield {
                  type: 'tool_chunk',
                  data: { id: id ?? '', name, args, index },
                };
              }
            }
            continue;
          }

          // ToolMessage — 工具结果
          const isToolMsg =
            msgType === 'tool' ||
            msgType === 'ToolMessage' ||
            (message['tool_call_id'] && !isAIChunk);
          if (isToolMsg) {
            const toolName = (message['name'] ?? '') as string;
            const toolCallId = (message['tool_call_id'] ?? '') as string;
            const content = message['content'] ?? message['text'] ?? '';
            toolResults.push({ name: toolName, output: content });
            yield {
              type: 'tool_end',
              data: { id: toolCallId, name: toolName, output: content },
            };
            continue;
          }

          if (isAIChunk) {
            const text = (message['text'] ??
              message['content'] ??
              '') as string;
            const textStr = typeof text === 'string' ? text : '';
            if (textStr) {
              if (!isSubagent) {
                fullText += textStr;
                yield { type: 'token', data: { text: textStr } };
              } else {
                yield { type: 'tool_narration', data: { text: textStr } };
              }
            }
            continue;
          }
        }

        // ─── updates 模式：子代理生命周期 ───
        if (mode === 'updates') {
          const chunk =
            data && typeof data === 'object'
              ? (data as Record<string, unknown>)
              : undefined;
          if (!chunk) continue;

          for (const [nodeName, nodeData] of Object.entries(chunk)) {
            // 主代理 model_request — 检测 task tool_call（子代理启动）
            if (!isSubagent && nodeName === 'model_request') {
              const nd = nodeData as { messages?: unknown[] } | undefined;
              for (const msg of nd?.messages ?? []) {
                const m = msg as Record<string, unknown>;
                const tcs = m['tool_calls'] as
                  | Array<Record<string, unknown>>
                  | undefined;
                for (const tc of tcs ?? []) {
                  if (tc['name'] === 'task') {
                    const args = tc['args'] as
                      | Record<string, unknown>
                      | undefined;
                    toolCalls.push(tc);
                    yield {
                      type: 'tool_start',
                      data: {
                        id: tc['id'] as string | undefined,
                        name: (args?.['subagent_type'] as string) ?? 'task',
                        input: args,
                      },
                    };
                  }
                }
              }
            }

            // 主代理 tools 节点 — 子代理完成返回结果
            if (!isSubagent && nodeName === 'tools') {
              const nd = nodeData as { messages?: unknown[] } | undefined;
              for (const msg of nd?.messages ?? []) {
                const m = msg as Record<string, unknown>;
                if (m['type'] === 'tool') {
                  const toolCallId = (m['tool_call_id'] ?? '') as string;
                  const name = (m['name'] ?? 'task') as string;
                  const content = m['content'] ?? '';
                  toolResults.push({ name, output: content });
                  yield {
                    type: 'tool_end',
                    data: { id: toolCallId, name, output: content },
                  };
                }
              }
            }

            // 子代理事件 — 透传
            if (isSubagent) {
              yield {
                type: 'subagent',
                data: {
                  namespace,
                  event: { [nodeName]: nodeData },
                },
              };
            }
          }
        }
      }

      yield {
        type: 'end',
        data: {
          text: fullText,
          tool_calls:
            toolCalls.length > 0
              ? (toolCalls as AIMessage['tool_calls'])
              : undefined,
          tool_results: toolResults.length > 0 ? toolResults : undefined,
        },
      };
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(err);
      const normalized = this.normalizeStreamError(e);
      console.error(
        '[AgentService.stream] ERROR',
        normalized.code,
        normalized.message,
      );
      const outErr = new Error(normalized.message) as Error & {
        code?: string;
      };
      outErr.name = normalized.code;
      outErr.code = normalized.code;
      yield { type: 'error', data: { error: outErr } };
    }
  }

  private normalizeStreamError(error: Error): {
    code: string;
    message: string;
  } {
    const raw = String(error.message || '').trim();
    if (!raw) return { code: 'STREAM_ERROR', message: 'STREAM_ERROR' };
    if (/invalid chat setting|\(2013\)/i.test(raw)) {
      return {
        code: 'MODEL_CHAT_SETTING_INVALID',
        message:
          '当前模型/网关不支持 chat 调用或 baseUrl 不兼容。若使用 MiniMax OpenAI 兼容接口，请将 baseUrl 设置为 https://api.minimax.io/v1（海外）或 https://api.minimaxi.com/v1（国内），并选择 MiniMax-M2.5/M2.1 等聊天模型。',
      };
    }
    if (raw.includes('ARTICLE_DRAFT_INVALID')) {
      return {
        code: 'ARTICLE_DRAFT_INVALID',
        message: '本次生成未通过发布质量校验，请缩小话题范围后重试。',
      };
    }
    const m = /^([A-Z0-9_]+):?\s*/.exec(raw);
    const code = m?.[1] ? m[1] : 'STREAM_ERROR';
    return { code, message: raw.slice(0, 240) };
  }

  /**
   * @description 规范消息为 BaseMessage 数组
   * @keyword-en normalize messages
   */
  private normalizeMessages(input: unknown): BaseMessage[] {
    if (Array.isArray(input)) {
      return input.map((m) =>
        isBaseMessage(m) ? m : coerceMessageLikeToMessage(m as BaseMessageLike),
      );
    }
    return [
      isBaseMessage(input)
        ? input
        : coerceMessageLikeToMessage(input as BaseMessageLike),
    ];
  }

  private extractSystemTextFromMessages(messages: BaseMessage[]): {
    systemText: string;
    messages: BaseMessage[];
  } {
    const kept: BaseMessage[] = [];
    const systemParts: string[] = [];
    for (const msg of messages) {
      if (msg instanceof SystemMessage) {
        const content = (msg as unknown as { content?: unknown }).content;
        const text =
          typeof content === 'string' ? content : JSON.stringify(content ?? '');
        if (text.trim().length > 0) systemParts.push(text.trim());
        continue;
      }
      kept.push(msg);
    }
    return { systemText: systemParts.join('\n\n'), messages: kept };
  }

  /**
   * @description 提取运行状态中的消息列表
   * @keyword-en extract state messages
   */
  private extractStateMessages(state: unknown): BaseMessage[] {
    if (isBaseMessage(state)) return [state];
    if (!state || typeof state !== 'object') return [];
    const messages = (state as { messages?: unknown }).messages;
    if (messages && !Array.isArray(messages)) {
      return [
        isBaseMessage(messages)
          ? messages
          : coerceMessageLikeToMessage(messages as BaseMessageLike),
      ];
    }
    if (!Array.isArray(messages)) return [];
    const normalized: BaseMessage[] = [];
    for (const item of messages) {
      if (isBaseMessage(item)) {
        normalized.push(item);
        continue;
      }
      if (item) {
        normalized.push(coerceMessageLikeToMessage(item as BaseMessageLike));
      }
    }
    return normalized;
  }

  private coerceAIMessageFromChunk(chunk: AIMessageChunk<any>): AIMessage {
    return new AIMessage({
      id: chunk.id,
      name: chunk.name,
      content: chunk.content,
      additional_kwargs: chunk.additional_kwargs,
      response_metadata: chunk.response_metadata,
      tool_calls: chunk.tool_calls,
      invalid_tool_calls: chunk.invalid_tool_calls,
      usage_metadata:
        chunk.usage_metadata as unknown as AIMessage['usage_metadata'],
    });
  }

  /**
   * @description 过滤并规范工具列表
   * @keyword-en normalize tools
   */
  private normalizeTools(
    tools: AgentConfig['tools'],
  ): CreateAgentParams['tools'] | undefined {
    if (!Array.isArray(tools)) return undefined;
    return tools;
  }

  /**
   * @description 规范子代理配置（确保 tools 为 StructuredTool[]）
   */
  private normalizeSubagents(
    subagents: AgentConfig['subagents'],
  ): SubAgent[] | undefined {
    if (!Array.isArray(subagents)) return undefined;
    return subagents.map((subagent) => {
      if (!Array.isArray(subagent.tools)) return subagent;
      const tools = subagent.tools.filter((t): t is StructuredTool =>
        isStructuredTool(t),
      );
      return { ...subagent, tools };
    });
  }

  /**
   * @description 规范上下文Schema
   * @keyword-en normalize context schema
   */
  private normalizeContextSchema(
    schema: AgentConfig['contextSchema'],
  ): InteropZodObject | undefined {
    if (!schema || typeof schema !== 'object') return undefined;
    const rec = schema as {
      safeParse?: unknown;
      parse?: unknown;
      _def?: unknown;
    };
    if (
      typeof rec.safeParse === 'function' &&
      typeof rec.parse === 'function'
    ) {
      return schema as InteropZodObject;
    }
    return undefined;
  }

  /**
   * @title 构造历史 Construct History
   * @description 将纯文本历史转换为LangChain消息对象数组。
   * @keywords-cn 历史转换, 消息对象
   * @keywords-en history convert, message objects
   */
  toMessages(
    history: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[],
  ): BaseMessage[] {
    const messages: BaseMessage[] = [];
    for (const h of history) {
      const content =
        typeof h.content === 'string'
          ? h.content
          : JSON.stringify(h.content ?? '');
      if (h.role === 'system') {
        messages.push(new SystemMessage(content));
      } else if (h.role === 'assistant') {
        messages.push(new AIMessage(content));
      } else {
        messages.push(new HumanMessage(content));
      }
    }
    return messages;
  }
}
