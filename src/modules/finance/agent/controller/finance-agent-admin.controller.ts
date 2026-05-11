import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../../../admin/guards/admin-auth.guard.js';
import type { AdminRequest } from '../../../admin/types/admin-request.types.js';
import { FinanceAgentService } from '../services/finance-agent.service.js';
import { FinanceAgentChatDto } from './finance-agent.dto.js';

/**
 * @description 后台财务 Agent 控制器（提供 chat 入口供 admin UI 调用）
 * @keyword-en finance agent admin controller, chat
 */
@Controller('admin/finance/agent')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class FinanceAgentAdminController {
  constructor(private readonly financeAgent: FinanceAgentService) {}

  /**
   * @description 同步聊天：传完整历史 messages，返回 agent 最终回复
   * @keyword-en finance agent chat endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('chat')
  async chat(@Req() req: Request, @Body() body: FinanceAgentChatDto) {
    const adminUser = (req as AdminRequest).adminUser;
    if (!adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    const result = await this.financeAgent.chat(
      { adminUser, name: body.name },
      body.messages,
    );
    return result;
  }
}
