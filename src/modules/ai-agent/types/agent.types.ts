import {
  AIMessage,
  BaseMessage,
  BaseMessageLike,
} from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { CreateAgentParams } from 'langchain';
import type { SubAgent, SupportedResponseFormat } from 'deepagents';

/**
 * @title Agent提供方 Agent Provider
 * @description 支持的模型提供方类型。
 * @keywords-cn 提供方, 模型, 枚举
 * @keywords-en provider, model, enum
 */
export type AgentProvider = string;

/**
 * @title Agent配置 Agent Config
 * @description 构建Agent的配置，包括模型与提示。
 * @keywords-cn 配置, 模型, 提示
 * @keywords-en config, model, prompt
 */
export interface AgentConfig {
  provider?: AgentProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  system?: string;
  /** 租户 ID，用于统一注入平台 AI 补充说明 */
  tenantId?: string;
  /** 直接传入的平台 AI 补充说明（优先级高于 tenantId 自动查询） */
  platformAiPromptSupplement?: string;
  tools?: CreateAgentParams['tools'];
  contextSchema?: unknown;
  responseFormat?: SupportedResponseFormat;
  streamWriter?: (message: string) => void;
  recursionLimit?: number;
  nonStreaming?: boolean;
  noPostHook?: boolean;
  systemPrompt?: string;
  context?: Record<string, string>;
  subagents?: DeepAgentSubAgent[];
  streamMode?: 'updates' | 'messages';
  streamSubgraphs?: boolean;
}

/**
 * @title Agent运行入参 Agent Run Input
 * @description Agent执行所需的历史消息与用户输入。
 * @keywords-cn 运行, 入参, 历史消息
 * @keywords-en run, input, history
 */
export interface AgentRunInput {
  config: AgentConfig;
  history: BaseMessage[];
  input: string;
}

export interface AgentRunMessagesInput {
  config: AgentConfig;
  messages: BaseMessageLike[] | BaseMessageLike;
  callOption?: AgentInvokeOption;
}

export interface AgentRunStreamInput {
  config: AgentConfig;
  messages: BaseMessageLike[] | BaseMessageLike;
  callOption?: AgentStreamOption;
}

/**
 * @title 函数调用描述 FunctionCallDescription
 * @description 描述服务的函数调用能力，用于function-call场景。
 * @keywords-cn 函数调用, 描述
 * @keywords-en function call, description
 */
export interface FunctionCallDescription {
  service: 'AgentService';
  version: string;
  functions: {
    name: string;
    description: string;
    keywordsCn: string[];
    keywordsEn: string[];
    args: {
      name: string;
      type: string;
      required: boolean;
      description: string;
    }[];
    returns: string;
  }[];
}

/**
 * @title Agent实例 Agent Instance
 * @description 统一的Agent实例接口，支持invoke调用。
 * @keywords-cn Agent实例, 调用
 * @keywords-en agent instance, invoke
 */
export interface AgentInstance {
  invoke: (input: { messages: BaseMessage[] }) => Promise<AIMessage>;
}

/**
 * @title Agent调用配置 Agent Call Option
 * @description 统一Agent运行与流式的配置类型。
 * @keywords-cn 调用配置, 运行, 流式
 * @keywords-en call option, invoke, stream
 */
export interface AgentInvokeOption
  extends RunnableConfig<Record<string, unknown>> {
  context?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * @title Agent流式配置 Agent Stream Option
 * @description Agent流式运行的配置类型。
 * @keywords-cn 流式配置, 运行
 * @keywords-en stream option, run
 */
export interface AgentStreamOption extends AgentInvokeOption {
  streamMode?: 'updates' | 'messages' | string[];
  subgraphs?: boolean;
}

/**
 * @title DeepAgent子代理配置 DeepAgent SubAgent
 * @description DeepAgent子代理的基础结构定义。
 * @keywords-cn 子代理, 深度代理
 * @keywords-en subagent, deep agent
 */
export type DeepAgentSubAgent = SubAgent;

/**
 * @title 流式事件 Agent Stream Event
 * @description Agent在流式传输中的事件类型定义。
 * @keywords-cn 流式, 事件, 令牌
 * @keywords-en stream, event, token
 */
export type AgentStreamEvent =
  | {
      type: 'start';
      data: { input: BaseMessage[] };
    }
  | {
      type: 'token';
      data: { text: string };
    }
  | {
      type: 'tool_narration';
      data: { text: string };
    }
  | {
      type: 'reasoning';
      data: { text: string };
    }
  | {
      type: 'tool_chunk';
      data: {
        id: string;
        name?: string;
        args?: string;
        index?: number;
      };
    }
  | {
      type: 'tool_start';
      data: { id?: string; name: string; input: unknown };
    }
  | {
      type: 'tool_end';
      data: { id?: string; name: string; output: unknown };
    }
  | {
      type: 'subagent';
      data: { namespace: string[]; event: unknown };
    }
  | {
      type: 'end';
      data: {
        text: string;
        tool_calls?: AIMessage['tool_calls'];
        tool_results?: { name?: unknown; output?: unknown }[];
        tool_summary?: {
          id: string;
          name?: string;
          args?: unknown;
          status: 'pending' | 'completed' | 'failed';
          result?: unknown;
          duration?: number;
        }[];
        analysis?: string;
      };
    }
  | {
      type: 'error';
      data: { error: Error & { code?: string } };
    }
  | {
      type: 'custom';
      data: unknown;
    };
