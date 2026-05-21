import { ObjectId } from 'mongodb';
import { ContextRole } from '../enums/context.enums';
import type { ConversationSessionType } from './conversation.entity';

/**
 * @title 消息实体 Message Entity
 * @description 表示一条对话消息，包括角色与内容。
 * @keywords-cn 消息, 实体, 角色
 * @keywords-en message, entity, role
 */
export interface MessageEntity {
  _id: ObjectId;
  sessionId: string;
  tenantId?: string;
  userId?: string;
  /** @description 会话类型(新消息写入,历史 doc 可能无此字段) */
  sessionType?: ConversationSessionType;
  role: ContextRole;
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_results?: any[];
  tool_summary?: any[];
  parts?: any[];
  keywords?: string[];
  timestamp: Date;
}
