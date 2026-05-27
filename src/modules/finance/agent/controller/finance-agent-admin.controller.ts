import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Response } from 'express';
import { AdminAuthGuard } from '../../../admin/guards/admin-auth.guard.js';
import type { AdminRequest } from '../../../admin/types/admin-request.types.js';
import { FinanceAgentService } from '../services/finance-agent.service.js';
import { FinanceAgentChatDto } from './finance-agent.dto.js';

/**
 * @description 后台财务 Agent 控制器（提供 chat 入口供 admin UI 调用）
 * @keyword-en finance-agent-admin-controller, admin-chat
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
   * @keyword-en finance-agent-chat-endpoint, one-shot-chat
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

  /**
   * @description 流式聊天：通过 SSE 返回 token、tool_start、tool_chunk、tool_end 与 end/error 事件
   * @keyword-en finance-agent-chat-stream, sse-endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post('chat/stream')
  async chatStream(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: FinanceAgentChatDto,
  ): Promise<void> {
    const adminUser = (req as AdminRequest).adminUser;
    if (!adminUser) throw new UnauthorizedException('UNAUTHORIZED');

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    /**
     * @description 写出单个财务 Agent SSE 事件
     * @keyword-en finance-agent-sse-write, sse-event
     */
    const write = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      let payload = 'null';
      try {
        payload = JSON.stringify(data ?? null);
      } catch {
        payload = JSON.stringify({
          message: 'SSE_SERIALIZE_FAILED',
        });
      }
      res.write(`event: ${event}\n`);
      res.write(`data: ${payload}\n\n`);
    };

    let aborted = false;
    let sentEnd = false;
    let hadError = false;
    req.on('close', () => {
      aborted = true;
    });

    try {
      for await (const evt of this.financeAgent.streamChat(
        { adminUser, name: body.name },
        body.messages,
      )) {
        if (aborted) break;
        if (evt.type === 'start') {
          write('start', { ok: true });
          continue;
        }
        if (evt.type === 'error') {
          hadError = true;
          const error = evt.data.error;
          write('error', {
            code: error.code || error.name || 'STREAM_ERROR',
            message: error.message || String(error),
          });
          continue;
        }
        if (evt.type === 'end') {
          sentEnd = true;
          write('end', { ok: true, ...evt.data });
          continue;
        }
        write(evt.type, evt.data);
      }
      if (!aborted && !sentEnd) {
        write('end', { ok: !hadError });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? 'UNKNOWN_ERROR');
      write('error', { code: 'FINANCE_AGENT_STREAM_ERROR', message });
      write('end', { ok: false });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }
}
