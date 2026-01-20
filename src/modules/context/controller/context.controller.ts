import { Controller, Get, Param, Query } from '@nestjs/common';
import { ContextService } from '../services/context.service';
import { ContextMessage } from '../types/context.types';

/**
 * @title 会话上下文控制器 Context Controller
 * @description 提供读取会话消息的只读接口；用于调试与集成。
 * @keywords-cn 上下文, 会话, 消息, 控制器
 * @keywords-en context, session, message, controller
 */
@Controller('context')
export class ContextController {
  constructor(private readonly context: ContextService) {}

  /**
   * @title 获取所有会话列表 List All Sessions
   * @description 返回系统中的所有会话概要。
   * @keywords-cn 会话列表
   * @keywords-en list sessions
   */
  @Get('list')
  async listConversations() {
    return this.context.getAllConversations();
  }

  /**
   * @title 获取会话消息 Get Session Messages
   * @description 返回指定会话的最近消息，用于调试或集成查看。
   * @keywords-cn 获取消息, 会话查询
   * @keywords-en list messages, session query
   * @param sessionId 会话ID
   * @param limit 限制条数
   */
  @Get(':sessionId')
  async getMessages(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ): Promise<ContextMessage[]> {
    const n = limit ? Number(limit) : undefined;
    const messages = await this.context.getMessages(sessionId, n);
    return messages;
  }

  /**
   * @title 获取会话元信息 Get Conversation Meta
   * @description 返回指定会话的元信息（包含标题）。
   * @keywords-cn 会话元信息, 标题
   * @keywords-en conversation meta, title
   * @param sessionId 会话ID
   */
  @Get('meta/:sessionId')
  async getConversation(@Param('sessionId') sessionId: string): Promise<{
    sessionId: string;
    title?: string;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const meta = await this.context.getConversation(sessionId);
    if (!meta) return null;
    return {
      sessionId: meta.sessionId,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }
}
