import { ObjectId } from 'mongodb';
import { ContextRole } from '../enums/context.enums';

/**
 * @title 消息实体 Message Entity
 * @description 表示一条对话消息，包括角色与内容。
 * @keywords-cn 消息, 实体, 角色
 * @keywords-en message, entity, role
 */
export interface MessageEntity {
  _id: ObjectId;
  sessionId: string;
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
