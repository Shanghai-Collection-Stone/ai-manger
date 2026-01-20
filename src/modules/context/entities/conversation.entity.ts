import { ObjectId } from 'mongodb';

/**
 * @title 会话实体 Conversation Entity
 * @description 表示一次AI对话的会话元信息。
 * @keywords-cn 会话, 实体, 上下文
 * @keywords-en conversation, entity, context
 */
export interface ConversationEntity {
  _id: ObjectId;
  sessionId: string;
  userId?: string;
  title?: string;
  keywords?: string[];
  lastCheckpointId?: string;
  createdAt: Date;
  updatedAt: Date;
}
