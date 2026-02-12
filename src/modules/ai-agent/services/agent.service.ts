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
      console.log('nvidia model', apiKey, config.model);
      model = new ChatOpenAI({
        model: config.model || 'deepseek-ai/deepseek-v3.1-terminus',
        temperature: config.temperature,
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
    console.log('context', input.config.context);
    const stream = agent.streamEvents(
      { messages: input.messages },
      {
        ...input.callOption,
        configurable: mergedConfigurable,
        recursionLimit: input.config.recursionLimit,
        context: input.config.context,
      },
    );

    let finalOutput: any = null;
    const toolDebug =
      process.env.TOOL_DEBUG === '1'
        ? true
        : process.env.TOOL_DEBUG === '0'
          ? false
          : process.env.NODE_ENV !== 'production';
    const toolCallIdToToolName = new Map<string, string>();
    const startedToolCallIds = new Set<string>();
    const toolInputEmittedIds = new Set<string>();
    const pendingInputToolIdsByName = new Map<string, string[]>();
    const toolChunkCount = new Map<string, number>();
    const debugToolNames = new Set<string>(['xhs_batch_publish']);
    for await (const event of stream) {
      const data = event.data as {
        chunk?: AIMessageChunk;
        input?: any;
        output?: any;
      };
      switch (event.event) {
        case 'on_chat_model_start':
          // 可以选择性抛出start事件
          break;
        case 'on_chat_model_end':
          break;
        case 'on_chat_model_stream': {
          const chunk = data.chunk;
          if (!chunk) break;
          // 处理深度思考 (DeepSeek等推理模型)
          const additionalKwargs = chunk.additional_kwargs as Record<
            string,
            unknown
          >;
          const reasoning = additionalKwargs?.reasoning_content as
            | string
            | undefined;
          if (reasoning) {
            yield {
              type: 'reasoning',
              data: { text: reasoning },
            };
            break;
          }
          // 处理普通文本流
          if (chunk.content && typeof chunk.content === 'string') {
            if (event.tags!.includes('subagent')) break;
            yield {
              type: 'token',
              data: { text: chunk.content },
            };
            break;
          }
          // 处理工具调用流
          if (chunk.tool_call_chunks?.length) {
            for (const tc of chunk.tool_call_chunks) {
              const toolCallId = typeof tc.id === 'string' ? tc.id : undefined;
              if (toolCallId && typeof tc.name === 'string') {
                toolCallIdToToolName.set(toolCallId, tc.name);
              }

              if (toolCallId && !startedToolCallIds.has(toolCallId)) {
                startedToolCallIds.add(toolCallId);
                let initialArgs: unknown = undefined;
                if (typeof tc.args === 'string' && tc.args.trim().length > 0) {
                  try {
                    initialArgs = JSON.parse(tc.args) as unknown;
                  } catch {
                    initialArgs = tc.args;
                  }
                } else if (
                  typeof tc.args !== 'undefined' &&
                  typeof tc.args !== 'string'
                ) {
                  initialArgs = tc.args;
                }

                if (typeof initialArgs !== 'undefined') {
                  toolInputEmittedIds.add(toolCallId);
                } else {
                  const toolName =
                    (typeof tc.name === 'string' ? tc.name : undefined) ??
                    toolCallIdToToolName.get(toolCallId) ??
                    '';
                  if (toolName) {
                    const list = pendingInputToolIdsByName.get(toolName) ?? [];
                    if (!list.includes(toolCallId)) {
                      list.push(toolCallId);
                      pendingInputToolIdsByName.set(toolName, list);
                    }
                  }
                }
                if (toolDebug && debugToolNames.has(String(tc.name ?? ''))) {
                  console.log('[Agent.stream] tool_start', {
                    id: toolCallId,
                    name: tc.name,
                    inputType: typeof initialArgs,
                  });
                }
                yield {
                  type: 'tool_start',
                  data: {
                    id: toolCallId,
                    name:
                      (typeof tc.name === 'string'
                        ? tc.name
                        : toolCallIdToToolName.get(toolCallId)) || '',
                    input: initialArgs,
                  },
                };
              }

              if (toolCallId && typeof tc.args === 'string' && tc.args.length) {
                const nextCount = (toolChunkCount.get(toolCallId) ?? 0) + 1;
                toolChunkCount.set(toolCallId, nextCount);
                if (
                  toolDebug &&
                  nextCount <= 3 &&
                  debugToolNames.has(String(tc.name ?? ''))
                ) {
                  console.log('[Agent.stream] tool_chunk', {
                    id: toolCallId,
                    chunk: nextCount,
                    argsLen: tc.args.length,
                  });
                }
                yield {
                  type: 'tool_chunk',
                  data: {
                    id: toolCallId,
                    name: tc.name,
                    args: tc.args,
                    index: tc.index,
                  },
                };
              }

              if (
                toolCallId &&
                tc.args &&
                typeof tc.args !== 'string' &&
                typeof tc.args !== 'undefined'
              ) {
                let rawArgs = '';
                try {
                  rawArgs = JSON.stringify(tc.args);
                } catch {
                  rawArgs = String(tc.args);
                }
                if (rawArgs.length > 0) {
                  const nextCount = (toolChunkCount.get(toolCallId) ?? 0) + 1;
                  toolChunkCount.set(toolCallId, nextCount);
                  if (
                    toolDebug &&
                    nextCount <= 3 &&
                    debugToolNames.has(String(tc.name ?? ''))
                  ) {
                    console.log('[Agent.stream] tool_chunk', {
                      id: toolCallId,
                      chunk: nextCount,
                      argsLen: rawArgs.length,
                    });
                  }
                  yield {
                    type: 'tool_chunk',
                    data: {
                      id: toolCallId,
                      name: tc.name,
                      args: rawArgs,
                      index: tc.index,
                    },
                  };
                }
              }
            }
          }
          break;
        }
        case 'on_tool_start': {
          const dataRec = data as unknown as Record<string, unknown>;
          const toolCall = dataRec['tool_call'];
          const toolCallId =
            dataRec['tool_call_id'] ??
            (toolCall && typeof toolCall === 'object'
              ? (toolCall as Record<string, unknown>)['id']
              : undefined);
          let toolCallIdStr =
            typeof toolCallId === 'string' && toolCallId.trim().length > 0
              ? toolCallId
              : undefined;

          const toolName = typeof event.name === 'string' ? event.name : '';
          if (!toolCallIdStr && toolName) {
            const list = pendingInputToolIdsByName.get(toolName);
            const candidate = Array.isArray(list) ? list[0] : undefined;
            if (typeof candidate === 'string' && candidate.length > 0) {
              toolCallIdStr = candidate;
            }
          }

          const inputVal = dataRec['input'];
          if (
            toolCallIdStr &&
            typeof inputVal !== 'undefined' &&
            !toolInputEmittedIds.has(toolCallIdStr)
          ) {
            const id = toolCallIdStr;
            startedToolCallIds.add(id);
            toolInputEmittedIds.add(id);
            if (toolName) {
              const list = pendingInputToolIdsByName.get(toolName);
              if (Array.isArray(list)) {
                pendingInputToolIdsByName.set(
                  toolName,
                  list.filter((x) => x !== id),
                );
              }
            }
            yield {
              type: 'tool_start',
              data: {
                id,
                name: toolCallIdToToolName.get(id) ?? event.name ?? '',
                input: inputVal,
              },
            };
          }
          break;
        }
        case 'on_tool_end': {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const toolCallId = data.output?.tool_call_id as unknown;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const toolCallIdAlt = data.output?.toolCallId as unknown;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const additionalKwRaw = data.output?.additional_kwargs as unknown;
          const additionalKw =
            additionalKwRaw && typeof additionalKwRaw === 'object'
              ? (additionalKwRaw as Record<string, unknown>)
              : undefined;
          const toolCallIdAlt2 = additionalKw?.['tool_call_id'];
          const toolCallIdStr =
            typeof toolCallId === 'string'
              ? toolCallId
              : typeof toolCallIdAlt === 'string'
                ? toolCallIdAlt
                : typeof toolCallIdAlt2 === 'string'
                  ? toolCallIdAlt2
                  : undefined;
          if (
            toolDebug &&
            toolCallIdStr &&
            debugToolNames.has(toolCallIdToToolName.get(toolCallIdStr) ?? '')
          ) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const outContent = data.output?.content as unknown;
            console.log('[Agent.stream] tool_end', {
              id: toolCallIdStr,
              name: toolCallIdStr
                ? toolCallIdToToolName.get(toolCallIdStr)
                : undefined,
              outputType: typeof outContent,
            });
          }

          yield {
            type: 'tool_end',
            data: {
              name:
                (toolCallIdStr && toolCallIdToToolName.get(toolCallIdStr)) ??
                event.name,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              output: data.output?.content,
              id: toolCallIdStr,
            },
          };
          break;
        }
        case 'on_chain_end':
          // 记录最终输出，用于生成end事件（如果是根链结束）
          if (event.name === 'AgentExecutor' || !event.name) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            finalOutput = data.output;
          }
          break;
      }
    }

    // 尝试构建结束事件
    if (finalOutput) {
      // 这里可以根据实际情况构建更详细的end事件
      // 目前简单返回文本，如果finalOutput包含messages则提取
      let text = '';
      if (typeof finalOutput === 'string') text = finalOutput;
      else if (
        typeof finalOutput === 'object' &&
        finalOutput !== null &&
        'content' in finalOutput
      ) {
        text = (finalOutput as { content: string }).content;
      } else if (
        typeof finalOutput === 'object' &&
        finalOutput !== null &&
        'messages' in finalOutput
      ) {
        const msgs = (finalOutput as { messages: BaseMessage[] }).messages;
        if (Array.isArray(msgs) && msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          text = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        }
      }

      yield {
        type: 'end',
        data: {
          text,
        },
      };
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
