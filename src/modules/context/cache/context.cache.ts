/**
 * @title 上下文缓存 Context Cache
 * @description 简单的内存缓存，用于短期存储会话消息。
 * @keywords-cn 缓存, 会话, 内存
 * @keywords-en cache, session, memory
 */
export class ContextCache {
  private readonly messages: Map<
    string,
    { updatedAt: number; items: string[] }
  > = new Map();

  get(sessionId: string): string[] | undefined {
    const entry = this.messages.get(sessionId);
    return entry ? entry.items : undefined;
  }

  set(sessionId: string, items: string[]): void {
    this.messages.set(sessionId, { updatedAt: Date.now(), items });
  }
}
