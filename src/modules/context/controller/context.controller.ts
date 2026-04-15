import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from '../../admin/services/admin.service.js';
import { ContextService } from '../services/context.service';
import { ContextMessage } from '../types/context.types';
import { ContextRole } from '../enums/context.enums';

/**
 * @title 会话上下文控制器 Context Controller
 * @description 提供读取会话消息的只读接口；用于调试与集成。
 * @keywords-cn 上下文, 会话, 消息, 控制器
 * @keywords-en context, session, message, controller
 */
@Controller('context')
export class ContextController {
  constructor(
    private readonly context: ContextService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @title 获取所有会话列表 List All Sessions
   * @description 返回系统中的所有会话概要。
   * @keywords-cn 会话列表
   * @keywords-en list sessions
   */
  @Get('list')
  async listConversations(
    @Req() req: Request,
    @Query('sessionType') sessionType?: 'default' | 'thought' | 'gallery-agent' | 'xhs-specialist' | 'xhs-tracker' | 'xhs-nurturer' | 'xhs-publisher',
  ) {
    const scope = await this.resolveAuthScope(req);
    return this.context.getScopedConversations({
      ...scope,
      sessionType,
    });
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
    @Query('includeSystem') includeSystem?: string,
    @Req() req?: Request,
  ): Promise<ContextMessage[]> {
    const n = limit ? Number(limit) : undefined;
    const inc = String(includeSystem ?? '')
      .trim()
      .toLowerCase();
    const shouldIncludeSystem = inc === '1' || inc === 'true' || inc === 'yes';
    const scope = await this.resolveAuthScope(req);
    const messages = await this.context.getMessages(
      sessionId,
      n,
      shouldIncludeSystem ? undefined : { excludeRoles: [ContextRole.System] },
      scope,
    );
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
  async getConversation(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{
    sessionId: string;
    title?: string;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const scope = await this.resolveAuthScope(req);
    const meta = await this.context.getConversation(sessionId, scope);
    if (!meta) return null;
    return {
      sessionId: meta.sessionId,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }

  /**
   * @description 解析请求鉴权范围
   * @keyword-en resolve request auth scope
   */
  private async resolveAuthScope(req?: Request): Promise<{
    tenantId?: string;
    userId?: string;
  }> {
    const auth = req?.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return {};
    const token = auth.slice(7).trim();
    if (!token) return {};
    const user = await this.adminService.getUserByToken(token);
    if (!user) return {};
    return {
      tenantId: user.tenantId,
      userId: user.username,
    };
  }
}
