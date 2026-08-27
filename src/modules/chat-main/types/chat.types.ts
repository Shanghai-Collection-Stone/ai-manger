import { BaseMessage } from 'langchain';

/**
 * @title 聊天请求 Chat Request
 * @description 主对话层的请求参数。
 * @keywords-cn 聊天, 请求, 上下文
 * @keywords-en chat, request, context
 */
export interface ChatRequest {
  sessionId: string;
  input: string;
  sessionType?:
    | 'default'
    | 'thought'
    | 'gallery-agent'
    | 'xhs-specialist'
    | 'xhs-tracker'
    | 'xhs-publisher'
    | 'xhs-article-expert'
    | 'xhs-image-expert';
  provider?: string;
  model?: string;
  temperature?: number;
  recursionLimit?: number;
  keepTools?: string[];
  ip?: string;
  now?: string;
  userId?: string;
  tenantId?: string;
  workspaceId?: string;
}

/**
 * @title 聊天响应 Chat Response
 * @description 主对话层的标准响应。
 * @keywords-cn 聊天, 响应
 * @keywords-en chat, response
 */
export interface ChatResponse {
  text: string;
  messages: BaseMessage[];
}
