import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from '../../admin/services/admin.service.js';
import { DecisionCardService } from '../services/decision-card.service.js';

/**
 * @description 决策卡控制器
 * @keyword-en decision card controller
 */
@Controller('decision-cards')
export class DecisionCardController {
  constructor(
    private readonly cards: DecisionCardService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @description 按租户读取决策卡
   * @keyword-en list decision cards by tenant endpoint
   */
  @Get()
  async listByScope(@Req() req: Request) {
    const scope = await this.requireAuthScope(req);
    const rows = await this.cards.listByScope(scope);
    return { cards: rows };
  }

  /**
   * @description 按会话读取决策卡
   * @keyword-en list decision cards by session endpoint
   */
  @Get('session/:sessionId')
  async listBySession(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ) {
    const scope = await this.requireAuthScope(req);
    const rows = await this.cards.listBySession(sessionId, scope);
    return { cards: rows };
  }

  /**
   * @description 读取决策卡详情
   * @keyword-en get decision card detail endpoint
   */
  @Get(':id')
  async getById(@Param('id') id: string, @Req() req: Request) {
    const scope = await this.requireAuthScope(req);
    const card = await this.cards.getById(id, scope);
    return { card };
  }

  /**
   * @description 应用决策，生成对应的待办任务
   * @keyword-en apply decision endpoint
   */
  @Post(':id/apply')
  async applyDecision(@Param('id') id: string, @Req() req: Request) {
    const scope = await this.requireAuthScope(req);
    const result = await this.cards.applyDecision(id, scope);
    return result;
  }

  private async requireAuthScope(req?: Request): Promise<{
    tenantId?: string;
    userId: string;
  }> {
    const scope = await this.resolveAuthScope(req);
    if (!scope.userId) throw new UnauthorizedException('AUTH_REQUIRED');
    return { tenantId: scope.tenantId, userId: scope.userId };
  }

  /**
   * @description 解析请求范围
   * @keyword-en resolve request scope
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
