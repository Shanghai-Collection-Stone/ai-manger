import {
  Controller,
  Post,
  Body,
  Sse,
  Query,
  Get,
  Param,
  Delete,
  Req,
} from '@nestjs/common';
import { ChatMainService } from '../services/chat.service.js';
import type { ChatRequest, ChatResponse } from '../types/chat.types.js';
import type { ContextMessage } from '../../context/types/context.types.js';
import { Observable } from 'rxjs';
import type { Request } from 'express';

/**
 * @title 主对话控制器 Chat-Main Controller
 * @description 提供对话的发送与流式SSE接口，以及上下文CRUD。
 * @keywords-cn 主对话, 控制器, 流式, 上下文
 * @keywords-en chat main, controller, streaming, context
 */
@Controller('chat')
export class ChatMainController {
  constructor(private readonly chat: ChatMainService) {}

  @Post('send')
  /**
   * @title 发送对话 Send Chat
   * @description 非流式发送接口，地址 `POST /chat/send`。
   * @keywords-cn 发送, 非流式
   * @keywords-en send, non-stream
   * @param body `ChatRequest` 请求体，包含 `sessionId`, `input`, `provider`, `model`, `temperature`
   * @returns `ChatResponse`，包含最终文本与 `messages` 历史
   */
  async send(
    @Body() body: ChatRequest,
    @Req() req: Request,
  ): Promise<ChatResponse> {
    // 设置默认模型为 deepseek-chat
    if (!body.provider) body.provider = 'deepseek';
    if (!body.model) body.model = 'deepseek-chat';
    if (!body.ip) {
      const remote = req.ip || req.socket?.remoteAddress || '';
      body.ip = remote || undefined;
    }
    if (!body.now) {
      body.now = new Date().toISOString();
    }
    return this.chat.send(body);
  }

  @Sse('stream')
  /**
   * @title 流式对话 Stream Chat
   * @description SSE接口，地址 `GET /chat/stream`。
   * @keywords-cn 流式, SSE
   * @keywords-en streaming, sse
   * @param sessionId 会话ID，查询参数
   * @param input 用户输入，查询参数
   * @param provider 模型提供方，可选 `gemini|deepseek`
   * @param model 模型名称，可选
   * @param temperature 采样温度，可选
   * @returns `Observable<MessageEvent>`，令牌与最终文本事件
   */
  stream(
    @Query('sessionId') sessionId: string,
    @Query('input') input: string,
    @Query('provider') provider?: 'gemini' | 'deepseek',
    @Query('model') model?: string,
    @Query('temperature') temperature?: number,
    @Query('recursionLimit') recursionLimit?: string,
    @Req() req?: Request,
  ): Observable<MessageEvent> {
    // 设置默认模型为 deepseek-chat
    const finalProvider = provider ?? 'deepseek';
    const finalModel = model ?? 'deepseek-chat';
    const rl = recursionLimit ? Number(recursionLimit) : undefined;
    const remoteIp = req ? req.ip || req.socket?.remoteAddress || '' : '';
    const now = new Date().toISOString();
    return this.chat.stream({
      sessionId,
      input,
      provider: finalProvider,
      model: finalModel,
      temperature,
      recursionLimit: rl,
      ip: remoteIp || undefined,
      now,
    });
  }

  @Post('session')
  /**
   * @title 创建会话 Create Session
   * @description 地址 `POST /chat/session`，返回新的或复用的 `sessionId`。
   * @keywords-cn 会话, 创建
   * @keywords-en session, create
   * @param sessionId 可选，会话ID
   * @returns `{ sessionId: string }`
   */
  async createSession(
    @Body('sessionId') sessionId?: string,
  ): Promise<{ sessionId: string }> {
    const sid = await this.chat.createSession(sessionId);
    return { sessionId: sid };
  }

  @Get('messages/:sessionId')
  /**
   * @title 获取消息 Get Messages
   * @description 地址 `GET /chat/messages/:sessionId`，返回会话消息列表。
   * @keywords-cn 消息, 读取
   * @keywords-en messages, read
   * @param sessionId 路径参数，会话ID
   * @returns `{ messages: unknown[] }`
   */
  async getMessages(
    @Param('sessionId') sessionId: string,
  ): Promise<{ messages: ContextMessage[] }> {
    const msgs = await this.chat.getMessages(sessionId);
    return { messages: msgs };
  }

  @Delete('session/:sessionId')
  /**
   * @title 清空会话 Clear Session
   * @description 地址 `DELETE /chat/session/:sessionId`，清理会话历史。
   * @keywords-cn 会话, 清理
   * @keywords-en session, clear
   * @param sessionId 路径参数，会话ID
   * @returns `{ ok: boolean }` 成功标记
   */
  async clearSession(
    @Param('sessionId') sessionId: string,
  ): Promise<{ ok: boolean }> {
    await this.chat.clearSession(sessionId);
    return { ok: true };
  }
}

interface MessageEvent {
  data: unknown;
}
