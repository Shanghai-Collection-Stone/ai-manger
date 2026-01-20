import { Injectable, Inject } from '@nestjs/common';
import { Db, Collection } from 'mongodb';
import { MessageEntity } from '../../context/entities/message.entity';
import { ConversationEntity } from '../../context/entities/conversation.entity';
import { RetrievalOptions } from '../types/retrieval.types';
import { KeywordService } from './keyword.service';
import { ContextMessage } from '../../context/types/context.types';

/**
 * @title 检索服务 Retrieval Service
 * @description 基于关键词的上下文检索与滑动窗口构造。
 * @keywords-cn 检索, 关键词, 滑动窗口, 上下文
 * @keywords-en retrieval, keywords, sliding window, context
 */
@Injectable()
export class RetrievalService {
  private readonly messages: Collection<MessageEntity>;
  private readonly conversations: Collection<ConversationEntity>;

  constructor(
    @Inject('MONGO_DB') db: Db,
    private readonly keyword: KeywordService,
  ) {
    this.messages = db.collection<MessageEntity>('messages');
    this.conversations = db.collection<ConversationEntity>('conversations');
  }

  /**
   * @title 为会话重建关键词索引 Reindex Session Keywords
   * @description 对未生成关键词的消息进行补全，并更新会话整体关键词。
   * @keywords-cn 重建索引, 关键词, 会话关键词
   * @keywords-en reindex, keywords, session keywords
   */
  async reindexSession(sessionId: string): Promise<number> {
    const cursor = this.messages.find({
      sessionId,
      $or: [{ keywords: { $exists: false } }, { keywords: { $size: 0 } }],
    });
    let count = 0;
    for await (const doc of cursor) {
      const kws = await this.keyword.extractKeywords(doc.content);
      await this.messages.updateOne(
        { _id: doc._id },
        { $set: { keywords: kws } },
      );
      count += 1;
    }

    // Update session level keywords
    await this.reindexSessionKeywords(sessionId);

    return count;
  }

  /**
   * @title 更新会话整体关键词 Update Session Keywords
   * @description 基于最近消息分析会话主题关键词。
   */
  async reindexSessionKeywords(sessionId: string): Promise<void> {
    const messages = await this.messages
      .find({ sessionId })
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    if (messages.length === 0) return;

    const text = messages.map((m) => m.content).join('\n');
    const kws = await this.keyword.extractKeywords(text);

    await this.conversations.updateOne(
      { sessionId },
      { $set: { keywords: kws } },
    );
  }

  /**
   * @title 关键词检索 Keyword Search
   * @description 返回匹配关键词的消息。
   * @keywords-cn 关键词检索
   * @keywords-en keyword search
   */
  async search(
    sessionId: string,
    keywords: string[],
    matchAll = false,
    limit?: number,
  ): Promise<MessageEntity[]> {
    const filter = matchAll
      ? { keywords: { $all: keywords } }
      : { keywords: { $in: keywords } };
    const cursor = this.messages
      .find({ sessionId, ...filter })
      .sort({ timestamp: 1 });
    if (typeof limit === 'number' && limit > 0) {
      cursor.limit(limit);
    }
    return cursor.toArray();
  }

  /**
   * @title 滑动窗口上下文 Sliding Context
   * @description 基于关键词命中构造上下文窗口，减少幻觉。
   * @keywords-cn 滑动窗口, 上下文构造
   * @keywords-en sliding window, context build
   */
  async getSlidingContext(
    sessionId: string,
    options: RetrievalOptions,
  ): Promise<ContextMessage[]> {
    const windowSize = options.windowSize ?? 3;
    const maxMessages = options.maxMessages ?? 20;

    let keywords = options.keywords;
    if (!keywords || keywords.length === 0) {
      const session = await this.conversations.findOne({ sessionId });
      if (session?.keywords) {
        keywords = session.keywords;
      } else {
        keywords = [];
      }
    }

    const all = await this.messages
      .find({ sessionId })
      .sort({ timestamp: 1 })
      .toArray();
    const hits: number[] = [];
    const keyset = new Set(keywords.map((k) => k.toLowerCase()));
    for (let i = 0; i < all.length; i++) {
      const kws = (all[i].keywords ?? []).map((k) => k.toLowerCase());
      const inter = kws.filter((k) => keyset.has(k));
      if (options.matchAll) {
        if (keywords.length > 0 && inter.length === keywords.length)
          hits.push(i);
      } else {
        if (inter.length > 0) hits.push(i);
      }
    }
    const picked = new Set<number>();
    for (const idx of hits) {
      const start = Math.max(0, idx - windowSize);
      const end = Math.min(all.length - 1, idx + windowSize);
      for (let j = start; j <= end; j++) picked.add(j);
      if (picked.size >= maxMessages) break;
    }
    const indices = Array.from(picked)
      .sort((a, b) => a - b)
      .slice(0, maxMessages);
    const result: ContextMessage[] = [];
    for (const i of indices) {
      const m = all[i];
      result.push({
        role: m.role,
        content: m.content,
        name: m.name,
        timestamp: m.timestamp,
      });
    }
    return result;
  }
}
