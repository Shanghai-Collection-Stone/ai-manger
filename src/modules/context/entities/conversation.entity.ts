import { ObjectId } from 'mongodb';

/**
 * @title 会话类型 Conversation Session Type
 * @description 区分默认对话、思维链路、图库Agent、小红书专家专用对话。
 * @keyword-en conversation session type
 */
export type ConversationSessionType =
  | 'default'
  | 'thought'
  | 'gallery-agent'
  | 'xhs-specialist'
  | 'xhs-tracker'
  | 'xhs-publisher'
  | 'xhs-article-expert'
  | 'xhs-image-expert';

/**
 * @title 动作专家会话 Action Session
 * @description default sessionType 内部的"当前激活专家"持久化字段。
 *   sessionType 是会话隔离边界(不能改,改了会话历史就丢了);actionSession 是
 *   default sessionType 下 supervisor 路由出的当前 expert,跨多轮对话保持,
 *   下次进同一会话会优先用于承上短句、业务追问、标签选择等确定性路由。
 *   null/undefined 表示当前由 supervisor 接管(还没路由 / 用户切回指挥官)。
 * @keyword-en active expert agent persisted on conversation
 */
export type ConversationActionSession =
  'image' | 'article' | 'data' | 'frontend' | 'publisher' | 'task' | null;

/**
 * @title 会话实体 Conversation Entity
 * @description 表示一次AI对话的会话元信息。
 * @keywords-cn 会话, 实体, 上下文
 * @keywords-en conversation, entity, context
 */
export interface ConversationEntity {
  _id: ObjectId;
  sessionId: string;
  sessionType?: ConversationSessionType;
  /** @description default/xhs-specialist 自动路由下当前激活专家(用于承上短句和业务追问) */
  actionSession?: ConversationActionSession;
  tenantId?: string;
  userId?: string;
  /** 会话绑定的平台工作区；任务型会话必须设置。 */
  workspaceId?: string;
  title?: string;
  keywords?: string[];
  lastCheckpointId?: string;
  createdAt: Date;
  updatedAt: Date;
}
