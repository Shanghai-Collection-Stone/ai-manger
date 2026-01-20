import { ContextRole } from '../enums/context.enums';

/**
 * @title 上下文消息类型 Context Message Type
 * @description 上下文中使用的标准消息结构。
 * @keywords-cn 消息类型, 上下文
 * @keywords-en message type, context
 */
export interface ContextMessage {
  role: ContextRole;
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_results?: any[];
  tool_summary?: any[];
  timestamp?: Date;
}

/**
 * @title 会话内存 Context Memory
 * @description 用于Agent构造提示的会话历史与系统信息。
 * @keywords-cn 会话内存, 历史, 系统消息
 * @keywords-en memory, history, system messages
 */
export interface ContextMemory {
  sessionId: string;
  system: string[];
  messages: ContextMessage[];
}
