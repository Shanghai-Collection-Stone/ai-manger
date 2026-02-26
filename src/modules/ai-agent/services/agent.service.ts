import { Inject, Injectable } from '@nestjs/common';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import {
  AgentRunInput,
  AgentConfig,
  AgentRunMessagesInput,
} from '../types/agent.types';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  AIMessageChunk,
  ToolMessage,
} from '@langchain/core/messages';
import {
  createAgent,
  tool,
  CreateAgentParams,
  summarizationMiddleware,
} from 'langchain';
import * as z from 'zod';
import { AgentStreamEvent } from '../types/agent.types';
import { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';

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
  ) {
    const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
    const isDev = env === 'development' || env === 'dev';
    let dbName = config.get<string>('MONGODB_DB') ?? 'ai_system';
    if (isDev) dbName = config.get<string>('DEV_MONGODB_DB') ?? dbName;
    this.checkpointer = new MongoDBSaver({ client, dbName });
  }
  /**
   * @title 获取函数调用描述 Get FunctionCallDescription
   * @description 返回服务的function-call能力描述。
   * @keywords-cn 函数调用描述
   * @keywords-en function call description
   */
  getHandle(): CreateAgentParams['tools'] {
    const agentRun = tool(
      async ({ provider, model, temperature, system, history, input }) => {
        const config = {
          provider: provider ?? 'deepseek',
          model: model ?? 'deepseek-chat',
          temperature,
          system,
        } as AgentConfig;
        const base: BaseMessage[] = this.toMessages(
          (history ?? []).map((h) => ({ role: h.role, content: h.content })),
        );
        base.push(new HumanMessage(input));
        const ai = await this.runWithMessages({ config, messages: base });
        const content = (ai as unknown as { content: unknown }).content;
        return typeof content === 'string' ? content : JSON.stringify(content);
      },
      {
        name: 'agent_run',
        description:
          'Run agent with provider/model and optional history. Returns text.',
        schema: z.object({
          provider: z
            .enum(['gemini', 'deepseek'])
            .optional()
            .describe('Model provider'),
          model: z.string().optional().describe('Model name'),
          temperature: z.number().optional().describe('Sampling temperature'),
          system: z.string().optional().describe('System prompt'),
          history: z
            .array(
              z.object({
                role: z.enum(['system', 'user', 'assistant']),
                content: z.string(),
              }),
            )
            .optional()
            .describe('Conversation history'),
          input: z.string().describe('User input'),
        }),
      },
    );
    return [agentRun];
  }

  /**
   * @title 构建聊天模型 Build Chat Model
   * @description 根据提供方返回对应的LangChain聊天模型。
   * @keywords-cn 构建模型, Gemini, DeepSeek
   * @keywords-en build model, Gemini, DeepSeek
   */
  buildChatModel(config: AgentConfig): ReturnType<typeof createAgent> {
    let model;
    if (config.provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY ?? '';
      model = new ChatGoogleGenerativeAI({
        model: config.model,
        temperature: config.temperature,
        apiKey,
      });
    }
    if (config.provider === 'deepseek') {
      const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
      model = new ChatOpenAI({
        model: config.model,
        temperature: config.temperature,
        streaming: true,
        apiKey,
        configuration: {
          baseURL: 'https://api.deepseek.com',
        },
        modelKwargs: {
          response_format: config.responseFormat,
        },
      });
    }
    if (config.provider === 'nvidia') {
      const apiKey = process.env.NVIDIA_API_KEY ?? '';
      model = new ChatOpenAI({
        model: config.model || 'deepseek-ai/deepseek-v3.1-terminus',
        temperature: config.temperature,
        streaming: true,
        apiKey,
        configuration: {
          baseURL: 'https://integrate.api.nvidia.com/v1',
        },
      });
    }
    if (!model) {
      throw new Error('Unsupported provider') satisfies Error;
    }
    const middleware: any[] = [];
    try {
      const geminiKey = process.env.GEMINI_API_KEY ?? '';
      if (geminiKey) {
        const summaryModelId =
          process.env.SUMMARIZATION_MODEL ??
          process.env.GEMINI_SUMMARY_MODEL ??
          'gemini-1.5-flash';
        const summaryTemp = Number(
          process.env.SUMMARIZATION_TEMPERATURE ?? '0.2',
        );
        const triggerMessages = Number(
          process.env.SUMMARIZATION_TRIGGER_MESSAGES ?? '60',
        );
        const keepMessages = Number(
          process.env.SUMMARIZATION_KEEP_MESSAGES ?? '30',
        );
        const summaryPrefix = process.env.SUMMARIZATION_PREFIX ?? '历史摘要：';

        const summaryModel = new ChatGoogleGenerativeAI({
          model: summaryModelId,
          apiKey: geminiKey,
          temperature: isFinite(summaryTemp) ? summaryTemp : 0.2,
        });
        middleware.push(
          summarizationMiddleware({
            model: summaryModel,
            trigger: {
              messages: isFinite(triggerMessages) ? triggerMessages : 60,
            },
            keep: { messages: isFinite(keepMessages) ? keepMessages : 30 },
            summaryPrefix,
          }),
        );
      }
    } catch {
      void 0;
    }

    return createAgent({
      model,
      systemPrompt: config.system,
      tools: config.tools,
      contextSchema: config.contextSchema,
      checkpointer: this.checkpointer,
      middleware: middleware.length > 0 ? middleware : undefined,
    });
  }

  /**
   * @title 运行Agent Run Agent
   * @description 使用配置与历史消息执行一次对话，返回AI消息。
   * @keywords-cn 运行Agent, 对话
   * @keywords-en run agent, chat
   */
  async run(input: AgentRunInput): Promise<AIMessage> {
    const agent = this.buildChatModel(input.config);
    const messages: BaseMessage[] = [];
    for (let i = 0; i < input.history.length; i++) {
      messages.push(input.history[i]);
    }
    messages.push(new HumanMessage(input.input));
    const callback = [
      {
        handleLLMNewToken(token: string) {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer(token);
            } catch (e) {
              void e;
            }
          }
        },
        handleLLMStart() {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer('[LLMStart]');
            } catch (e) {
              void e;
            }
          }
        },
        handleLLMEnd() {
          if (input.config.nonStreaming) return;
          const writer = input.config.streamWriter;
          if (typeof writer === 'function') {
            try {
              writer('[LLMEnd]');
            } catch (e) {
              void e;
            }
          }
        },
      },
    ];
    const state = await agent.invoke(
      { messages, systemPrompt: input.config.system },
      input.config.nonStreaming ? undefined : { callbacks: callback },
    );
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg instanceof AIMessage) {
        return msg;
      }
    }
    return new AIMessage('');
  }

  async runWithMessages(input: AgentRunMessagesInput): Promise<AIMessage> {
    const agent = this.buildChatModel(input.config);
    const callback = [
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
        option.callback = callback;
      }

      if (input.config.noPostHook) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        option.tags = ['subagent'];
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      option.systemPrompt = input.config.system;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      option.context = input.config.context;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return option;
    };
    const state = await agent.invoke(
      { messages: input.messages },
      { ...preOption() },
    );

    const idToName = new Map<string, string>();
    const toolResults: { name?: unknown; output?: unknown }[] = [];
    let lastToolCalls: unknown[] | undefined;
    for (const m of state.messages) {
      if (m instanceof AIMessage) {
        const tcs = (m as unknown as { tool_calls?: unknown }).tool_calls;
        if (Array.isArray(tcs) && tcs.length > 0) {
          lastToolCalls = tcs as unknown[];
          for (const tc of tcs) {
            const rec =
              tc && typeof tc === 'object'
                ? (tc as Record<string, unknown>)
                : undefined;
            const idVal = rec?.['id'];
            const nameVal = rec?.['name'];
            const id = typeof idVal === 'string' ? idVal : undefined;
            const name = typeof nameVal === 'string' ? nameVal : undefined;
            if (id && name) idToName.set(id, name);
          }
        }
      }
      if (m instanceof ToolMessage) {
        const rec = m as unknown as Record<string, unknown>;
        const nameVal = rec['name'];
        const toolCallIdVal = rec['tool_call_id'] ?? rec['toolCallId'];
        const additionalKw =
          rec['additional_kwargs'] &&
          typeof rec['additional_kwargs'] === 'object'
            ? (rec['additional_kwargs'] as Record<string, unknown>)
            : undefined;
        const additionalToolCallIdVal = additionalKw?.['tool_call_id'];

        const toolCallId =
          typeof toolCallIdVal === 'string'
            ? toolCallIdVal
            : typeof additionalToolCallIdVal === 'string'
              ? additionalToolCallIdVal
              : undefined;

        const toolName =
          typeof nameVal === 'string'
            ? nameVal
            : toolCallId
              ? idToName.get(toolCallId)
              : undefined;
        const content = (m as unknown as { content?: unknown }).content;
        toolResults.push({ name: toolName, output: content });
      }
    }

    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg instanceof AIMessage || msg instanceof AIMessageChunk) {
        const out = msg as unknown as Record<string, unknown>;
        if (toolResults.length > 0) out['tool_results'] = toolResults;
        if (!Array.isArray(out['tool_calls']) && Array.isArray(lastToolCalls)) {
          out['tool_calls'] = lastToolCalls;
        }
        return msg;
      }
    }
    return new AIMessage('');
  }

  /**
   * @title 流式运行Agent Stream Agent
   * @description 以流式事件的形式返回模型输出令牌与最终消息，支持FunctionCall与深度思考。
   * @keywords-cn 流式, 令牌, 事件, 深度思考, 函数调用
   * @keywords-en stream, token, events, deep thinking, function call
   */
  async *stream(input: AgentRunMessagesInput): AsyncIterable<AgentStreamEvent> {
    const agent = this.buildChatModel(input.config);
    // 确保 configurable 字段始终存在
    const defaultConfigurable = {
      thread_id: `stream_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      checkpoint_ns: 'default',
      checkpoint_id: 'root',
    };
    const existingConfigurable =
      (input.callOption as Record<string, unknown>)?.configurable ?? {};
    const mergedConfigurable = {
      ...defaultConfigurable,
      ...existingConfigurable,
    };
    const buffered: AgentStreamEvent[] = [];
    type StreamIterResult = IteratorResult<AgentStreamEvent, void>;
    let pendingResolve: ((value: StreamIterResult) => void) | null = null;
    let isDone = false;
    const toolRunIdToName = new Map<string, string>();

    const nextEvent = async (): Promise<StreamIterResult> => {
      if (buffered.length > 0) {
        const value = buffered.shift()!;
        return { value, done: false };
      }
      if (isDone) return { value: undefined, done: true };
      return await new Promise<StreamIterResult>((resolve) => {
        pendingResolve = resolve;
      });
    };

    const resolvePending = (res: StreamIterResult) => {
      const r = pendingResolve;
      pendingResolve = null;
      if (typeof r === 'function') r(res);
    };

    const pushEvent = (evt: AgentStreamEvent) => {
      if (isDone) return;
      if (pendingResolve) {
        resolvePending({ value: evt, done: false });
        return;
      }
      buffered.push(evt);
    };

    const safeVal = (v: unknown): unknown => {
      const seen = new WeakSet<object>();
      const walk = (x: unknown): unknown => {
        if (x === null) return null;

        switch (typeof x) {
          case 'string':
          case 'number':
          case 'boolean':
            return x;
          case 'undefined':
            return undefined;
          case 'bigint':
            return x.toString();
          case 'function':
          case 'symbol':
            return undefined;
          case 'object': {
            if (x instanceof Error) {
              return { name: x.name, message: x.message, stack: x.stack };
            }
            if (Array.isArray(x)) return x.map((i) => walk(i));
            const obj = x as Record<string, unknown>;
            if (seen.has(obj)) return '[Circular]';
            seen.add(obj);
            const out: Record<string, unknown> = {};
            for (const [k, v2] of Object.entries(obj)) {
              const vv = walk(v2);
              if (typeof vv !== 'undefined') out[k] = vv;
            }
            return out;
          }
        }
      };
      return walk(v);
    };

    pushEvent({ type: 'start', data: { input: input.messages } });

    const handler: Record<string, unknown> = {
      handleLLMNewToken: (token: string, ...rest: unknown[]) => {
        const tags = rest.find((x) => Array.isArray(x)) as
          | unknown[]
          | undefined;
        if (Array.isArray(tags) && tags.includes('subagent')) return;
        if (typeof token === 'string' && token.length > 0) {
          pushEvent({ type: 'token', data: { text: token } });
        }
      },
      handleToolStart: (
        toolObj: unknown,
        toolInput: unknown,
        runId: unknown,
      ) => {
        const rec = toolObj as Record<string, unknown> | null;
        const nameVal = rec?.['name'];
        const name = typeof nameVal === 'string' ? nameVal : '';
        const id = typeof runId === 'string' ? runId : undefined;
        if (id && name) toolRunIdToName.set(id, name);
        pushEvent({
          type: 'tool_start',
          data: { id, name, input: safeVal(toolInput) },
        });
      },
      handleToolEnd: (toolOutput: unknown, runId: unknown) => {
        const id = typeof runId === 'string' ? runId : undefined;
        let name = '';
        const outRec =
          toolOutput && typeof toolOutput === 'object'
            ? (toolOutput as Record<string, unknown>)
            : undefined;
        const nameVal = outRec?.['name'];
        if (typeof nameVal === 'string') name = nameVal;
        if (!name && id) name = toolRunIdToName.get(id) ?? '';
        pushEvent({
          type: 'tool_end',
          data: { id, name, output: safeVal(toolOutput) },
        });
      },
    };

    const invokeTask = (async () => {
      try {
        const state = await agent.invoke({ messages: input.messages }, {
          ...(input.callOption ?? {}),
          configurable: mergedConfigurable,
          recursionLimit: input.config.recursionLimit,
          context: input.config.context,
          callbacks: [handler],
        } as unknown as Parameters<typeof agent.invoke>[1]);

        let text = '';
        const msgs = (state as unknown as { messages?: BaseMessage[] })
          .messages;
        if (Array.isArray(msgs) && msgs.length > 0) {
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m instanceof AIMessage || m instanceof AIMessageChunk) {
              text = typeof m.content === 'string' ? m.content : '';
              break;
            }
          }
        }
        pushEvent({ type: 'end', data: { text } });
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        pushEvent({ type: 'error', data: { error: e } });
      } finally {
        isDone = true;
        resolvePending({ value: undefined, done: true });
      }
    })();

    void invokeTask;

    while (true) {
      const n = await nextEvent();
      if (n.done) break;
      yield n.value;
    }
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
