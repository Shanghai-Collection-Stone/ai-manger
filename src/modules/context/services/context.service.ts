import { Injectable, Inject } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
import type { CheckpointTuple } from '@langchain/langgraph-checkpoint';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { randomUUID } from 'crypto';
import { ContextMessage, ContextMemory } from '../types/context.types';
import { MessageEntity } from '../entities/message.entity';
import { ConversationEntity } from '../entities/conversation.entity';
import { ContextRole } from '../enums/context.enums';

/**
 * @title 上下文服务 Context Service
 * @description 管理AI对话会话与消息，提供持久化与读取。
 * @keywords-cn 上下文服务, 会话, 消息, MongoDB
 * @keywords-en context service, session, message, MongoDB
 */
@Injectable()
export class ContextService {
  private readonly conversations: Collection<ConversationEntity>;
  private readonly messages: Collection<MessageEntity>;
  private readonly saver: MongoDBSaver;

  constructor(
    @Inject('CTX_MONGO_DB') db: Db,
    @Inject('CTX_LANGGRAPH_SAVER') saver: MongoDBSaver,
  ) {
    const convCol: Collection<ConversationEntity> =
      db.collection<ConversationEntity>('conversations');
    const msgCol: Collection<MessageEntity> =
      db.collection<MessageEntity>('messages');
    this.conversations = convCol;
    this.messages = msgCol;
    this.saver = saver;
    void this.ensureIndexes();
  }

  /**
   * @title 创建会话 Create Session
   * @description 创建或返回现有会话ID。
   * @keywords-cn 创建会话
   * @keywords-en create session
   * @param sessionId 可选指定会话ID
   */
  async createSession(sessionId?: string): Promise<string> {
    const sid = sessionId ?? cryptoRandomId();
    const now = new Date();
    const existing = await this.conversations.findOne({ sessionId: sid });
    if (existing) return sid;
    await this.conversations.insertOne({
      _id: new ObjectId(),
      sessionId: sid,
      title: undefined,
      lastCheckpointId: undefined,
      createdAt: now,
      updatedAt: now,
    });
    return sid;
  }

  /**
   * @title 追加消息 Append Message
   * @description 将一条消息写入会话。
   * @keywords-cn 写入消息
   * @keywords-en append message
   * @param sessionId 会话ID
   * @param message 消息内容
   */
  async appendMessage(
    sessionId: string,
    message: ContextMessage,
  ): Promise<void> {
    const now = new Date();
    await this.messages.insertOne({
      _id: new ObjectId(),
      sessionId,
      role: message.role,
      content: message.content,
      name: message.name,
      tool_calls: message.tool_calls,
      tool_results: message.tool_results,
      tool_summary: message.tool_summary,
      timestamp: now,
    });
    await this.conversations.updateOne(
      { sessionId },
      { $set: { updatedAt: now } },
      { upsert: true },
    );
  }

  /**
   * @title 获取消息 Get Messages
   * @description 返回会话中的历史消息。
   * @keywords-cn 获取消息
   * @keywords-en get messages
   * @param sessionId 会话ID
   * @param limit 限制条数
   */
  async getMessages(
    sessionId: string,
    limit?: number,
  ): Promise<ContextMessage[]> {
    const tuple: CheckpointTuple | undefined = await this.saver.getTuple({
      configurable: { thread_id: sessionId },
    });
    if (!tuple) return [];
    const channelValues = tuple.checkpoint?.channel_values ?? {};
    const stateMessages = channelValues['messages'];
    const arr = Array.isArray(stateMessages)
      ? (stateMessages as unknown[])
      : [];
    const msgs: ContextMessage[] = [];
    const toolResultBuffer = new Map<string, { id: string; output: unknown }>();

    type SavedMessage = {
      type?: string;
      content?: unknown;
      tool_calls?: Array<{
        id?: string;
        tool_call_id?: string;
        name?: string;
        args?: Record<string, unknown>;
        input?: Record<string, unknown>;
      }>;
      tool_call_id?: string;
      id?: string;
    };

    for (const item of arr) {
      const v: SavedMessage = (item ?? {}) as SavedMessage;
      const t = typeof v.type === 'string' ? v.type : undefined;
      const ts = new Date(tuple.checkpoint?.ts ?? Date.now());
      if (t === 'human') {
        const content = this.extractText(v.content);
        msgs.push({ role: ContextRole.User, content, timestamp: ts });
      } else if (t === 'system') {
        const content = this.extractText(v.content);
        msgs.push({ role: ContextRole.System, content, timestamp: ts });
      } else if (t === 'ai') {
        const content = this.extractText(v.content);
        const rawCalls: SavedMessage['tool_calls'] = Array.isArray(v.tool_calls)
          ? v.tool_calls
          : [];
        const tool_calls = rawCalls.map((c) => {
          const idVal =
            typeof c.id === 'string'
              ? c.id
              : typeof c.tool_call_id === 'string'
                ? c.tool_call_id
                : '';
          const nameVal = typeof c.name === 'string' ? c.name : '';
          const inputVal =
            (c.args as Record<string, unknown>) ??
            (c.input as Record<string, unknown>) ??
            undefined;
          return { id: idVal, name: nameVal, input: inputVal };
        });
        const tool_results: any[] = [];
        for (const c of tool_calls) {
          const tr = toolResultBuffer.get(c.id);
          if (tr) {
            tool_results.push({ id: tr.id, output: tr.output });
            toolResultBuffer.delete(c.id);
          }
        }
        msgs.push({
          role: ContextRole.Assistant,
          content,
          tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
          tool_results: tool_results.length > 0 ? tool_results : undefined,
          timestamp: ts,
        });
      } else if (t === 'tool') {
        const content = this.extractText(v.content);
        const idRaw =
          typeof v.tool_call_id === 'string'
            ? v.tool_call_id
            : typeof v.id === 'string'
              ? v.id
              : '';
        if (idRaw) {
          toolResultBuffer.set(idRaw, {
            id: idRaw,
            output: content,
          });
        }
        msgs.push({
          role: ContextRole.Assistant,
          content,
          timestamp: ts,
        });
      }
    }

    const ordered = msgs.sort(
      (a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0),
    );
    const limited =
      typeof limit === 'number' && limit > 0 ? ordered.slice(-limit) : ordered;
    return limited;
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const parts = content
        .map((p) => {
          const rec = p as Record<string, unknown>;
          const t = rec['type'];
          if (t === 'text') {
            const val = rec['text'];
            return typeof val === 'string' ? val : '';
          }
          return '';
        })
        .filter((s) => s && s.length > 0);
      if (parts.length > 0) return parts.join('\n');
    }
    try {
      if (content === undefined || content === null) return '';
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }

  // 中间件已提供自动摘要与裁剪，这里不再进行二次裁剪

  /**
   * @title 获取所有会话 List All Conversations
   * @description 返回所有会话的列表，按更新时间倒序排列。
   * @keywords-cn 获取所有会话, 列表
   * @keywords-en list conversations, list
   */
  async getAllConversations(): Promise<ConversationEntity[]> {
    const docs = await this.conversations
      .find(
        {},
        {
          projection: {
            _id: 0,
            sessionId: 1,
            title: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ updatedAt: -1 })
      .toArray();
    return docs;
  }

  /**
   * @title 清空会话 Clear Session
   * @description 删除会话内所有消息并移除会话。
   * @keywords-cn 清理会话
   * @keywords-en clear session
   * @param sessionId 会话ID
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.messages.deleteMany({ sessionId });
    await this.conversations.deleteOne({ sessionId });
  }

  /**
   * @title 构造会话内存 Build Memory
   * @description 返回Agent可用的系统提示与消息历史。
   * @keywords-cn 会话内存, 系统提示
   * @keywords-en memory, system prompt
   * @param sessionId 会话ID
   * @param system 系统提示集合
   */
  async buildMemory(
    sessionId: string,
    system: string[] = [],
  ): Promise<ContextMemory> {
    const messages = await this.getMessages(sessionId);
    const hasSystem = messages.some((m) => m.role === ContextRole.System);
    const sys = hasSystem ? system : system;
    return { sessionId, system: sys, messages };
  }

  /**
   * @title 获取会话元信息 Get Conversation Meta
   * @description 返回会话的元信息（包含标题）。
   */
  async getConversation(sessionId: string): Promise<ConversationEntity | null> {
    const doc = await this.conversations.findOne(
      { sessionId },
      {
        projection: {
          _id: 0,
          sessionId: 1,
          title: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    );
    return doc ?? null;
  }

  /**
   * @title 设置会话标题 Set Conversation Title
   * @description 持久化会话标题。
   */
  async setTitle(sessionId: string, title: string): Promise<void> {
    const now = new Date();
    await this.conversations.updateOne(
      { sessionId },
      { $set: { title, updatedAt: now } },
      { upsert: true },
    );
  }

  /**
   * @title 设置会话关键词 Set Conversation Keywords
   * @description 更新会话的关键词。
   */
  async setKeywords(sessionId: string, keywords: string[]): Promise<void> {
    const now = new Date();
    await this.conversations.updateOne(
      { sessionId },
      { $set: { keywords, updatedAt: now } },
      { upsert: true },
    );
  }

  async setLastCheckpointId(
    sessionId: string,
    checkpointId: string,
  ): Promise<void> {
    const now = new Date();
    await this.conversations.updateOne(
      { sessionId },
      { $set: { lastCheckpointId: checkpointId, updatedAt: now } },
      { upsert: true },
    );
  }

  private async ensureIndexes(): Promise<void> {
    try {
      await this.conversations.createIndex({ sessionId: 1 }, { unique: true });
      await this.conversations.createIndex({ updatedAt: -1 });
      await this.messages.createIndex({ sessionId: 1, timestamp: 1 });
      await this.messages.createIndex({ keywords: 1 });
    } catch {
      // ignore
    }
  }
}

function cryptoRandomId(): string {
  return randomUUID();
}
