import { Injectable, Inject } from '@nestjs/common';
import { Db, Collection, ObjectId } from 'mongodb';
import type { CheckpointTuple } from '@langchain/langgraph-checkpoint';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { randomUUID, createHash } from 'crypto';
import {
  ContextMessage,
  ContextMemory,
  MessagePart,
} from '../types/context.types';
import { MessageEntity } from '../entities/message.entity';
import {
  ConversationEntity,
  ConversationSessionType,
} from '../entities/conversation.entity';
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
  private readonly deleted: Collection<{
    _id: ObjectId;
    sessionId: string;
    tenantId?: string;
    userId?: string;
    fp: string;
    timestamp: Date;
  }>;
  private readonly saver: MongoDBSaver;

  constructor(
    @Inject('CTX_MONGO_DB') db: Db,
    @Inject('CTX_LANGGRAPH_SAVER') saver: MongoDBSaver,
  ) {
    const convCol: Collection<ConversationEntity> =
      db.collection<ConversationEntity>('conversations');
    const msgCol: Collection<MessageEntity> =
      db.collection<MessageEntity>('messages');
    const delCol: Collection<{
      _id: ObjectId;
      sessionId: string;
      tenantId?: string;
      userId?: string;
      fp: string;
      timestamp: Date;
    }> = db.collection<{
      _id: ObjectId;
      sessionId: string;
      tenantId?: string;
      userId?: string;
      fp: string;
      timestamp: Date;
    }>('deleted_messages');
    this.conversations = convCol;
    this.messages = msgCol;
    this.deleted = delCol;
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
    return this.createSessionWithScope(sessionId);
  }

  /**
   * @title 创建租户会话 Create Session With Scope
   * @description 创建或返回租户用户范围内会话ID。
   * @keywords-cn 创建会话, 租户
   * @keywords-en create session, tenant scope
   */
  async createSessionWithScope(
    sessionId?: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<string> {
    const requestedSessionId = sessionId?.trim();
    let sid = requestedSessionId || cryptoRandomId();
    const now = new Date();
    const existing = await this.conversations.findOne(
      this.buildConversationFilter(sid, scope),
    );
    if (existing) return sid;
    try {
      await this.conversations.insertOne({
        _id: new ObjectId(),
        sessionId: sid,
        sessionType: this.normalizeSessionType(scope?.sessionType),
        tenantId: scope?.tenantId,
        userId: scope?.userId,
        title: undefined,
        lastCheckpointId: undefined,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        const raw = await this.conversations.findOne({ sessionId: sid });
        if (raw && this.isConversationInScope(raw, scope)) {
          return sid;
        }
        if (!requestedSessionId) {
          sid = cryptoRandomId();
          await this.conversations.insertOne({
            _id: new ObjectId(),
            sessionId: sid,
            sessionType: this.normalizeSessionType(scope?.sessionType),
            tenantId: scope?.tenantId,
            userId: scope?.userId,
            title: undefined,
            lastCheckpointId: undefined,
            createdAt: now,
            updatedAt: now,
          });
          return sid;
        }
      }
      throw error;
    }
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
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.assertSessionScope(sessionId, scope);
    const now = new Date();
    const scopeSet = this.buildConversationScopeSet(scope);
    await this.messages.insertOne({
      _id: new ObjectId(),
      sessionId,
      tenantId: scope?.tenantId,
      userId: scope?.userId,
      role: message.role,
      content: message.content,
      name: message.name,
      tool_calls: message.tool_calls,
      tool_results: message.tool_results,
      tool_summary: message.tool_summary,
      parts: message.parts,
      timestamp: now,
    });
    await this.conversations.updateOne(
      this.buildConversationFilter(sessionId, scope),
      {
        $set: {
          updatedAt: now,
          ...scopeSet,
        },
      },
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
    opts?: { excludeRoles?: ContextRole[] },
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<ContextMessage[]> {
    await this.assertSessionScope(sessionId, scope);
    const storedMessages = await this.messages
      .find({ sessionId, ...this.buildScopeFilter(scope) })
      .sort({ timestamp: 1 })
      .toArray();
    const tuple: CheckpointTuple | undefined = await this.saver.getTuple({
      configurable: { thread_id: sessionId },
    });
    if (!tuple) {
      const fallback = storedMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        name: typeof m.name === 'string' ? m.name : undefined,
        tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls : undefined,
        tool_results: Array.isArray(m.tool_results)
          ? m.tool_results
          : undefined,
        tool_summary: Array.isArray(m.tool_summary)
          ? m.tool_summary
          : undefined,
        parts: Array.isArray(m.parts) ? (m.parts as MessagePart[]) : undefined,
        timestamp: m.timestamp,
      }));
      const filtered =
        opts && Array.isArray(opts.excludeRoles) && opts.excludeRoles.length > 0
          ? fallback.filter((m) => !opts.excludeRoles!.includes(m.role))
          : fallback;
      const ordered = filtered.sort(
        (a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0),
      );
      return typeof limit === 'number' && limit > 0
        ? ordered.slice(-limit)
        : ordered;
    }
    const channelValues = tuple.checkpoint?.channel_values ?? {};
    const stateMessages = channelValues['messages'];
    const arr = Array.isArray(stateMessages)
      ? (stateMessages as unknown[])
      : [];
    const msgs: ContextMessage[] = [];
    const toolResultBuffer = new Map<
      string,
      { id: string; name?: string; output: unknown }
    >();
    // Build id→name map from AIMessage.tool_calls to recover correct names
    // for ToolMessages (checkpoint often stores name as 'tool' instead of the real function name)
    const toolCallIdToName = new Map<string, string>();

    type SavedMessage = {
      type?: string;
      content?: unknown;
      name?: string;
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

    const rawCheckpointTs = (tuple.checkpoint as unknown as { ts?: unknown })
      ?.ts;
    const baseMs =
      typeof rawCheckpointTs === 'number'
        ? rawCheckpointTs
        : typeof rawCheckpointTs === 'string' &&
            rawCheckpointTs.trim().length > 0
          ? Number(rawCheckpointTs)
          : Date.now();
    let seq = 0;

    for (const item of arr) {
      const v: SavedMessage = (item ?? {}) as SavedMessage;
      const t = typeof v.type === 'string' ? v.type : undefined;
      const ts = new Date(baseMs + seq);
      seq += 1;
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
          // Populate the id→name map for later ToolMessage name recovery
          if (idVal && nameVal && nameVal !== 'tool') {
            toolCallIdToName.set(idVal, nameVal);
          }
          return { id: idVal, name: nameVal, input: inputVal };
        });
        const tool_results: any[] = [];
        for (const c of tool_calls) {
          const tr = toolResultBuffer.get(c.id);
          if (tr) {
            tool_results.push({
              id: tr.id,
              name: tr.name ?? c.name,
              output: tr.output,
            });
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
        let nameRaw = typeof v.name === 'string' ? v.name : undefined;
        // Recover correct tool name: checkpoint often stores 'tool' as the name
        if (
          (!nameRaw || nameRaw === 'tool') &&
          idRaw &&
          toolCallIdToName.has(idRaw)
        ) {
          nameRaw = toolCallIdToName.get(idRaw);
        }
        if (idRaw) {
          toolResultBuffer.set(idRaw, {
            id: idRaw,
            name: nameRaw,
            output: content,
          });
        }
      }
    }

    for (const m of msgs) {
      if (m.role !== ContextRole.Assistant) continue;
      const calls: Array<{ id: string; name?: string; input?: unknown }> =
        Array.isArray(m.tool_calls)
          ? (
              m.tool_calls as Array<{
                id?: unknown;
                name?: unknown;
                input?: unknown;
              }>
            ).map((tc) => ({
              id: typeof tc.id === 'string' ? tc.id : '',
              name: typeof tc.name === 'string' ? tc.name : undefined,
              input: tc.input,
            }))
          : [];
      if (calls.length === 0) continue;
      const results: Array<{ id: string; name?: string; output: unknown }> = [];
      for (const c of calls) {
        const tr = c.id ? toolResultBuffer.get(c.id) : undefined;
        if (tr) {
          results.push({
            id: tr.id,
            name: tr.name ?? c.name,
            output: tr.output,
          });
          toolResultBuffer.delete(c.id);
        }
      }
      if (results.length > 0) {
        const existing: Array<{ id: string; name?: string; output: unknown }> =
          Array.isArray(m.tool_results)
            ? m.tool_results
                .map((it) => {
                  const obj = it as {
                    id?: unknown;
                    name?: unknown;
                    output?: unknown;
                  };
                  const id = typeof obj.id === 'string' ? obj.id : '';
                  const name =
                    typeof obj.name === 'string' ? obj.name : undefined;
                  return { id, name, output: obj.output };
                })
                .filter((r) => r.id.length > 0)
            : [];
        m.tool_results = [...existing, ...results];
      }
    }

    const merged: ContextMessage[] = [];
    for (let i = 0; i < msgs.length; i++) {
      const cur = msgs[i];
      if (cur.role !== ContextRole.Assistant) {
        merged.push(cur);
        continue;
      }
      const batch: ContextMessage[] = [cur];
      let j = i + 1;
      while (j < msgs.length && msgs[j].role === ContextRole.Assistant) {
        batch.push(msgs[j]);
        j++;
      }
      i = j - 1;

      // 生成 parts 数组，保留顺序
      const parts: import('../types/context.types').MessagePart[] = [];
      const tcMap = new Map<
        string,
        { id: string; name?: string; input?: unknown }
      >();
      const trMap = new Map<
        string,
        { id: string; name?: string; output: unknown }
      >();

      for (const b of batch) {
        // 1. 先添加文本内容
        const c = b.content;
        if (typeof c === 'string' && c.trim().length > 0) {
          parts.push({ type: 'text', content: c });
        }

        // 2. 然后添加 tool_calls
        const tcs: Array<{ id?: unknown; name?: unknown; input?: unknown }> =
          Array.isArray(b.tool_calls)
            ? (b.tool_calls as Array<{
                id?: unknown;
                name?: unknown;
                input?: unknown;
              }>)
            : [];
        for (const t of tcs) {
          const id = typeof t.id === 'string' ? t.id : '';
          if (!id) continue;
          const name = typeof t.name === 'string' ? t.name : '';
          const input = t.input;
          if (!tcMap.has(id)) {
            tcMap.set(id, { id, name, input });
            parts.push({ type: 'tool_call', id, name, input });
          }
        }

        // 3. 然后添加 tool_results
        const trs: Array<{ id?: unknown; name?: unknown; output?: unknown }> =
          Array.isArray(b.tool_results)
            ? (b.tool_results as Array<{
                id?: unknown;
                name?: unknown;
                output?: unknown;
              }>)
            : [];
        for (const r of trs) {
          const id = typeof r.id === 'string' ? r.id : '';
          if (!id) continue;
          const name = typeof r.name === 'string' ? r.name : undefined;
          const output = r.output;
          if (!trMap.has(id)) {
            trMap.set(id, { id, name, output: output });
            parts.push({
              type: 'tool_result',
              id,
              name,
              output: output,
            });
          }
        }
      }

      // 合并所有非空内容用于 content 字段（保持兼容性）
      const contentParts: string[] = [];
      for (let k = 0; k < batch.length; k++) {
        const c = batch[k].content;
        if (typeof c === 'string' && c.trim().length > 0) {
          contentParts.push(c);
        }
      }
      const content =
        contentParts.length === 1 ? contentParts[0] : contentParts.join('\n\n');

      const ts = batch[batch.length - 1].timestamp;
      const mergedItem: ContextMessage = {
        role: ContextRole.Assistant,
        content,
        tool_calls: tcMap.size > 0 ? Array.from(tcMap.values()) : undefined,
        tool_results: trMap.size > 0 ? Array.from(trMap.values()) : undefined,
        parts: parts.length > 0 ? parts : undefined,
        timestamp: ts,
      };
      merged.push(mergedItem);
    }

    // 从 messages 集合补充 tool_results（包含子 tool 调用）
    const storedAssistants = storedMessages.filter(
      (s) => s.role === ContextRole.Assistant,
    );

    // Match stored messages to merged messages by content similarity
    // rather than fragile sequential index
    const usedStoredIndexes = new Set<number>();

    const findBestStoredMatch = (
      m: ContextMessage,
    ): (typeof storedAssistants)[number] | undefined => {
      const mContent = (m.content ?? '').trim();
      let bestIdx = -1;
      let bestScore = -1;

      for (let i = 0; i < storedAssistants.length; i++) {
        if (usedStoredIndexes.has(i)) continue;
        const s = storedAssistants[i];
        let score = 0;

        // Score by content match
        const sContent = (
          typeof s.content === 'string' ? s.content : ''
        ).trim();
        if (mContent.length > 0 && sContent.length > 0) {
          if (mContent === sContent) {
            score += 10;
          } else if (
            mContent.includes(sContent.slice(0, 50)) ||
            sContent.includes(mContent.slice(0, 50))
          ) {
            score += 5;
          }
        }

        // Score by tool call overlap (stored uses runId, checkpoint uses call_id,
        // so match by parts/tool_results content instead)
        if (
          Array.isArray(s.parts) &&
          s.parts.length > 0 &&
          Array.isArray(m.parts)
        ) {
          // Both have parts → likely a match if tool count is similar
          const sToolCount = (s.parts as Array<{ type?: string }>).filter(
            (p) => p.type === 'tool_call' || p.type === 'tool_result',
          ).length;
          const mToolCount = m.parts.filter(
            (p) => p.type === 'tool_call' || p.type === 'tool_result',
          ).length;
          if (sToolCount > 0 && mToolCount > 0) {
            score += Math.min(sToolCount, mToolCount) * 2;
          }
        }

        // Prefer sequential order as tiebreaker
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && bestScore > 0) {
        usedStoredIndexes.add(bestIdx);
        return storedAssistants[bestIdx];
      }

      // Fallback: use first unused stored message (sequential)
      for (let i = 0; i < storedAssistants.length; i++) {
        if (!usedStoredIndexes.has(i)) {
          usedStoredIndexes.add(i);
          return storedAssistants[i];
        }
      }
      return undefined;
    };

    for (const m of merged) {
      if (m.role !== ContextRole.Assistant) continue;
      const stored = findBestStoredMatch(m);

      // 1. 优先使用存储的 parts (包含完美的 SSE 顺序)
      if (stored && Array.isArray(stored.parts) && stored.parts.length > 0) {
        m.parts = stored.parts as MessagePart[];
        // 同步完整列表
        if (Array.isArray(stored.tool_calls)) m.tool_calls = stored.tool_calls;
        if (Array.isArray(stored.tool_results))
          m.tool_results = stored.tool_results;
        continue;
      }

      // 2. Fallback: 使用之前的逻辑 - 补充 checkpoint 中没有的 tool_results / tool_calls
      if (stored && Array.isArray(stored.tool_results)) {
        // 补充 checkpoint 中没有的 tool_results
        const existingIds = new Set(
          ((m.tool_results as Array<{ id?: string }>) || []).map((tr) => tr.id),
        );
        const additional = (
          stored.tool_results as Array<{
            id?: string;
            name?: string;
            output?: unknown;
          }>
        ).filter((tr) => tr.id && !existingIds.has(tr.id));
        if (additional.length > 0) {
          const existing = (m.tool_results ?? []) as Array<{
            id?: string;
            name?: string;
            output?: unknown;
          }>;
          m.tool_results = [...existing, ...additional];
          // 同时更新 parts 数组 (追加在最后)
          if (Array.isArray(m.parts)) {
            for (const tr of additional) {
              m.parts.push({
                type: 'tool_result',
                id: tr.id || '',
                name: tr.name,
                output: tr.output,
              });
            }
          }
        }
      }
      // 同时补充 tool_calls
      if (stored && Array.isArray(stored.tool_calls)) {
        const existingCallIds = new Set(
          ((m.tool_calls as Array<{ id?: string }>) || []).map((tc) => tc.id),
        );
        const additionalCalls = (
          stored.tool_calls as Array<{
            id?: string;
            name?: string;
            input?: unknown;
          }>
        ).filter((tc) => tc.id && !existingCallIds.has(tc.id));
        if (additionalCalls.length > 0) {
          const existingCalls = (m.tool_calls ?? []) as Array<{
            id?: string;
            name?: string;
            input?: unknown;
          }>;
          m.tool_calls = [...existingCalls, ...additionalCalls];
          // 同时更新 parts 数组 (追加在最后)
          if (Array.isArray(m.parts)) {
            for (const tc of additionalCalls) {
              m.parts.push({
                type: 'tool_call',
                id: tc.id || '',
                name: tc.name || '',
                input: tc.input,
              });
            }
          }
        }
      }
    }

    const filtered =
      opts && Array.isArray(opts.excludeRoles) && opts.excludeRoles.length > 0
        ? merged.filter((m) => !opts.excludeRoles!.includes(m.role))
        : merged;
    const ordered = filtered.sort(
      (a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0),
    );
    const limited =
      typeof limit === 'number' && limit > 0 ? ordered.slice(-limit) : ordered;

    return limited;
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      // 提取 type=text 内容；thinking / tool_use 等非文本块直接忽略（不序列化）
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
      return parts.join('\n');
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
    return this.getScopedConversations();
  }

  /**
   * @title 获取租户会话列表 List Scoped Conversations
   * @description 返回范围内会话列表，按更新时间倒序。
   * @keywords-cn 获取会话, 租户
   * @keywords-en list conversations, tenant scope
   */
  async getScopedConversations(scope?: {
    tenantId?: string;
    userId?: string;
    sessionType?: ConversationSessionType;
  }): Promise<ConversationEntity[]> {
    const docs = await this.conversations
      .find(this.buildConversationsListReadFilter(scope), {
        projection: {
          _id: 0,
          sessionId: 1,
          sessionType: 1,
          title: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      })
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
    await this.clearSessionWithScope(sessionId);
  }

  /**
   * @title 清空范围会话 Clear Session With Scope
   * @description 删除租户用户范围内会话和消息。
   * @keywords-cn 清空会话, 租户
   * @keywords-en clear session, tenant scope
   */
  async clearSessionWithScope(
    sessionId: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.assertSessionScope(sessionId, scope);
    const filter = this.buildConversationFilter(sessionId, scope);
    await this.messages.deleteMany(filter);
    await this.conversations.deleteOne(filter);
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
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<ContextMemory> {
    const messages = await this.getMessages(
      sessionId,
      undefined,
      undefined,
      scope,
    );
    const hasSystem = messages.some((m) => m.role === ContextRole.System);
    const sys = hasSystem ? system : system;
    return { sessionId, system: sys, messages };
  }

  async getDeletedFingerprints(
    sessionId: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<Set<string>> {
    await this.assertSessionScope(sessionId, scope);
    const docs = await this.deleted
      .find(
        { sessionId, ...this.buildScopeFilter(scope) },
        { projection: { _id: 0, fp: 1 } },
      )
      .toArray();
    return new Set(docs.map((d) => d.fp));
  }

  async markDeletedFingerprints(
    sessionId: string,
    fps: string[],
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.assertSessionScope(sessionId, scope);
    const now = new Date();
    const ops = (fps || [])
      .filter((s) => typeof s === 'string' && s.length > 0)
      .map((fp) => ({
        updateOne: {
          filter: { sessionId, fp, ...this.buildScopeFilter(scope) },
          update: {
            $set: {
              sessionId,
              fp,
              timestamp: now,
              tenantId: scope?.tenantId,
              userId: scope?.userId,
            },
          },
          upsert: true,
        },
      }));
    if (ops.length > 0) await this.deleted.bulkWrite(ops);
  }

  fingerprintMessage(
    sessionId: string,
    m: ContextMessage,
    position?: number,
  ): string {
    const normalizeCalls = (
      arr: unknown,
    ): Array<{ id?: string; name?: string; input?: unknown }> => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((it) => {
          const rec = it as { id?: unknown; name?: unknown; input?: unknown };
          const id = typeof rec.id === 'string' ? rec.id : undefined;
          const name = typeof rec.name === 'string' ? rec.name : undefined;
          const input = rec.input;
          return { id, name, input };
        })
        .filter((x) => (x.id ?? x.name ?? '') !== '');
    };
    const normalizeResults = (
      arr: unknown,
    ): Array<{ id?: string; name?: string; output?: unknown }> => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((it) => {
          const rec = it as { id?: unknown; name?: unknown; output?: unknown };
          const id = typeof rec.id === 'string' ? rec.id : undefined;
          const name = typeof rec.name === 'string' ? rec.name : undefined;
          const output = rec.output;
          return { id, name, output };
        })
        .filter((x) => (x.id ?? x.name ?? '') !== '');
    };
    const normalizeParts = (
      arr: unknown,
    ): Array<{
      type: string;
      id?: string;
      name?: string;
      content?: string;
    }> => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((it) => {
          const rec = it as Record<string, unknown>;
          const type = typeof rec['type'] === 'string' ? rec['type'] : '';
          const id = typeof rec['id'] === 'string' ? rec['id'] : undefined;
          const name =
            typeof rec['name'] === 'string' ? rec['name'] : undefined;
          const content =
            typeof rec['content'] === 'string' ? rec['content'] : undefined;
          return { type, id, name, content };
        })
        .filter((p) => p.type.length > 0);
    };
    const payload = {
      sessionId,
      role: m.role,
      content: m.content,
      tool_calls: normalizeCalls(m.tool_calls),
      tool_results: normalizeResults(m.tool_results),
      parts: normalizeParts(m.parts),
      ts: m.timestamp ? Math.floor(m.timestamp.getTime() / 1000) : undefined,
      pos: typeof position === 'number' ? position : undefined,
    };
    try {
      const text = JSON.stringify(payload);
      return createHash('sha256').update(text).digest('hex');
    } catch {
      return `${sessionId}:${m.role}:${m.content?.slice(0, 40) ?? ''}`;
    }
  }

  /**
   * @title 获取会话元信息 Get Conversation Meta
   * @description 返回会话的元信息（包含标题）。
   */
  async getConversation(
    sessionId: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<ConversationEntity | null> {
    const doc = await this.conversations.findOne(
      this.buildConversationReadFilter(sessionId, scope),
      {
        projection: {
          _id: 0,
          sessionId: 1,
          sessionType: 1,
          title: 1,
          lastCheckpointId: 1,
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
    await this.setTitleWithScope(sessionId, title);
  }

  /**
   * @title 设置范围标题 Set Title With Scope
   * @description 更新范围内会话标题。
   * @keywords-cn 标题, 租户
   * @keywords-en title, tenant scope
   */
  async setTitleWithScope(
    sessionId: string,
    title: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.assertSessionScope(sessionId, scope);
    const now = new Date();
    const $set: Record<string, unknown> = { title, updatedAt: now };
    if (scope?.sessionType) {
      $set['sessionType'] = this.normalizeSessionType(scope.sessionType);
    }
    if (scope?.tenantId) $set['tenantId'] = scope.tenantId;
    if (scope?.userId) $set['userId'] = scope.userId;
    await this.conversations.updateOne(
      this.buildConversationFilter(sessionId, scope),
      { $set },
    );
  }

  /**
   * @title 设置会话关键词 Set Conversation Keywords
   * @description 更新会话的关键词。
   */
  async setKeywords(
    sessionId: string,
    keywords: string[],
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.assertSessionScope(sessionId, scope);
    const now = new Date();
    const scopeSet = this.buildConversationScopeSet(scope);
    await this.conversations.updateOne(
      this.buildConversationFilter(sessionId, scope),
      {
        $set: {
          keywords,
          updatedAt: now,
          ...scopeSet,
        },
      },
    );
  }

  async setLastCheckpointId(
    sessionId: string,
    checkpointId: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    await this.assertSessionScope(sessionId, scope);
    const now = new Date();
    const scopeSet = this.buildConversationScopeSet(scope);
    await this.conversations.updateOne(
      this.buildConversationFilter(sessionId, scope),
      {
        $set: {
          lastCheckpointId: checkpointId,
          updatedAt: now,
          ...scopeSet,
        },
      },
    );
  }

  async getLatestCheckpointId(sessionId: string): Promise<string | undefined> {
    const tuple: CheckpointTuple | undefined = await this.saver.getTuple({
      configurable: { thread_id: sessionId },
    });

    const id = (tuple?.checkpoint as unknown as { id?: string })?.id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  }

  private async ensureIndexes(): Promise<void> {
    try {
      await this.conversations.createIndex({ sessionId: 1 }, { unique: true });
      await this.conversations.createIndex({ sessionType: 1, updatedAt: -1 });
      await this.conversations.createIndex({
        tenantId: 1,
        userId: 1,
        updatedAt: -1,
      });
      await this.conversations.createIndex({ updatedAt: -1 });
      await this.messages.createIndex({
        tenantId: 1,
        userId: 1,
        timestamp: -1,
      });
      await this.messages.createIndex({ sessionId: 1, timestamp: 1 });
      await this.messages.createIndex({ keywords: 1 });
      await this.deleted.createIndex(
        { sessionId: 1, tenantId: 1, userId: 1, fp: 1 },
        { unique: true },
      );
    } catch {
      // ignore
    }
  }

  /**
   * @title 构建范围过滤 Build Scope Filter
   * @description 统一构建 tenantId 和 userId 的查询过滤。
   * @keywords-cn 过滤, 租户
   * @keywords-en filter, tenant scope
   */
  private buildScopeFilter(scope?: { tenantId?: string; userId?: string }): {
    tenantId?: string | Record<string, any>;
    userId?: string;
  } {
    const filter: {
      tenantId?: string | Record<string, any>;
      userId?: string;
    } = {};
    if (scope && 'tenantId' in scope) {
      const tenantId = scope.tenantId?.trim();
      filter.tenantId = tenantId ? tenantId : { $in: [null] };
    }
    if (scope?.userId?.trim()) {
      filter.userId = scope.userId.trim();
    }
    return filter;
  }

  /**
   * @description 构建会话可回写的范围字段，仅在显式传入时写入
   * @keyword-en build conversation scope set patch
   */
  private buildConversationScopeSet(scope?: {
    tenantId?: string;
    userId?: string;
    sessionType?: ConversationSessionType;
  }): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (!scope) return patch;
    if ('sessionType' in scope && scope.sessionType) {
      patch.sessionType = this.normalizeSessionType(scope.sessionType);
    }
    if ('tenantId' in scope && scope.tenantId !== undefined) {
      const tenantId = scope.tenantId?.trim();
      patch.tenantId = tenantId ? tenantId : null;
    }
    if (scope.userId?.trim()) {
      patch.userId = scope.userId.trim();
    }
    return patch;
  }

  /**
   * @description 会话类型标准化
   * @keyword-en normalize session type
   */
  private normalizeSessionType(
    sessionType?: ConversationSessionType,
  ): ConversationSessionType {
    return sessionType === 'thought' ? 'thought' : 'default';
  }

  /**
   * @description 构建会话列表过滤
   * @keyword-en build conversations list filter
   */
  private buildConversationsListFilter(scope?: {
    tenantId?: string;
    userId?: string;
    sessionType?: ConversationSessionType;
  }): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      ...this.buildScopeFilter(scope),
    };
    const type = this.normalizeSessionType(scope?.sessionType);
    if (type === 'thought') {
      filter.sessionType = 'thought';
      return filter;
    }
    filter.$or = [
      { sessionType: 'default' },
      { sessionType: { $exists: false } },
    ];
    return filter;
  }

  /**
   * @description 构建会话列表读取过滤
   * @keyword-en build conversations list read filter
   */
  private buildConversationsListReadFilter(scope?: {
    tenantId?: string;
    userId?: string;
    sessionType?: ConversationSessionType;
  }): Record<string, unknown> {
    const filter = this.buildConversationsListFilter(scope);
    const scopeOr = this.buildScopeReadOr(scope);
    if (!scopeOr) return filter;
    const rest = { ...filter };
    delete rest['tenantId'];
    delete rest['userId'];
    return { ...rest, $and: [{ $or: scopeOr }] };
  }

  /**
   * @description 构建会话精确过滤
   * @keyword-en build conversation exact filter
   */
  private buildConversationFilter(
    sessionId: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      sessionId,
      ...this.buildScopeFilter(scope),
    };
    const type = this.normalizeSessionType(scope?.sessionType);
    if (type === 'thought') {
      base.sessionType = 'thought';
      return base;
    }
    base.$or = [
      { sessionType: 'default' },
      { sessionType: { $exists: false } },
    ];
    return base;
  }

  /**
   * @description 构建会话读取过滤
   * @keyword-en build conversation read filter
   */
  private buildConversationReadFilter(
    sessionId: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Record<string, unknown> {
    const filter = this.buildConversationFilter(sessionId, scope);
    const scopeOr = this.buildScopeReadOr(scope);
    if (!scopeOr) return filter;
    const rest = { ...filter };
    delete rest['tenantId'];
    delete rest['userId'];
    return { ...rest, $and: [{ $or: scopeOr }] };
  }

  /**
   * @description 构建读取范围兼容or条件
   * @keyword-en build read scope or condition
   */
  private buildScopeReadOr(scope?: {
    tenantId?: string;
    userId?: string;
  }): Array<Record<string, unknown>> | null {
    const tenantId = scope?.tenantId?.trim();
    const userId = scope?.userId?.trim();
    if (!tenantId && !userId) return null;
    if (tenantId && userId) {
      return [
        { tenantId, userId },
        { tenantId, userId: { $exists: false } },
        { tenantId: { $exists: false }, userId },
        { tenantId: { $exists: false }, userId: { $exists: false } },
      ];
    }
    if (tenantId) {
      return [{ tenantId }, { tenantId: { $exists: false } }];
    }
    return [{ userId }, { userId: { $exists: false } }];
  }

  /**
   * @title 校验会话范围 Assert Session Scope
   * @description 当传入 scope 时，确保会话归属匹配。
   * @keywords-cn 会话校验, 租户
   * @keywords-en assert session scope, tenant
   */
  private async assertSessionScope(
    sessionId: string,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): Promise<void> {
    if (!scope || (!('tenantId' in scope) && !scope.userId)) return;
    const row = await this.conversations.findOne({ sessionId });
    if (!row) {
      throw new Error('SESSION_SCOPE_FORBIDDEN');
    }
    if (!this.isConversationInScope(row, scope)) {
      throw new Error('SESSION_SCOPE_FORBIDDEN');
    }
  }

  /**
   * @description 判断是否为Mongo重复键错误
   * @keyword-en detect mongo duplicate key error
   */
  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }

  /**
   * @description 校验会话是否在请求范围内
   * @keyword-en validate conversation scope compatibility
   */
  private isConversationInScope(
    row: ConversationEntity,
    scope?: {
      tenantId?: string;
      userId?: string;
      sessionType?: ConversationSessionType;
    },
  ): boolean {
    if (!scope) return true;
    const scopeTenantId = scope.tenantId?.trim();
    const scopeUserId = scope.userId?.trim();
    const scopeType = this.normalizeSessionType(scope.sessionType);
    const rowTenantId = row.tenantId?.trim();
    const rowUserId = row.userId?.trim();
    const rowType = this.normalizeSessionType(row.sessionType);
    const tenantMatch =
      !scopeTenantId || !rowTenantId || rowTenantId === scopeTenantId;
    const userMatch = !scopeUserId || !rowUserId || rowUserId === scopeUserId;
    const typeMatch = rowType === scopeType;
    return tenantMatch && userMatch && typeMatch;
  }
}

function cryptoRandomId(): string {
  return randomUUID();
}
