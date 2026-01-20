import {
  AIMessage,
  BaseMessage,
  CreateAgentParams,
  ReactAgent,
} from 'langchain';

/**
 * @title Agent提供方 Agent Provider
 * @description 支持的模型提供方类型。
 * @keywords-cn 提供方, 模型, 枚举
 * @keywords-en provider, model, enum
 */
export type AgentProvider = 'gemini' | 'deepseek';

/**
 * @title Agent配置 Agent Config
 * @description 构建Agent的配置，包括模型与提示。
 * @keywords-cn 配置, 模型, 提示
 * @keywords-en config, model, prompt
 */
export interface AgentConfig {
  provider: AgentProvider;
  model: string;
  temperature?: number;
  system?: string;
  tools?: CreateAgentParams['tools'];
  contextSchema?: CreateAgentParams['contextSchema'];
  responseFormat?: CreateAgentParams['responseFormat'] | Record<string, any>;
  streamWriter?: (message: string) => void;
  recursionLimit?: number;
  nonStreaming?: boolean;
  noPostHook?: boolean;
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
  messages: BaseMessage[];
  callOption?:
    | Omit<Parameters<ReactAgent['stream']>[1], 'streamMode'>
    | Omit<Parameters<ReactAgent['invoke']>[1], 'streamMode'>;
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
      data: { error: Error };
    }
  | {
      type: 'custom';
      data: unknown;
    };
