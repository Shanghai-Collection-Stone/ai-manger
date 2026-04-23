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
  Res,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminService } from '../../admin/services/admin.service.js';
import { ChatMainService } from '../services/chat.service.js';
import type { ChatRequest, ChatResponse } from '../types/chat.types.js';
import type { ContextMessage } from '../../context/types/context.types.js';
import { Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * @title 主对话控制器 Chat-Main Controller
 * @description 提供对话的发送与流式SSE接口，以及上下文CRUD。
 * @keywords-cn 主对话, 控制器, 流式, 上下文
 * @keywords-en chat main, controller, streaming, context
 */
@Controller('chat')
export class ChatMainController {
  constructor(
    private readonly chat: ChatMainService,
    private readonly adminService: AdminService,
  ) {}

  @Post('upload-images')
  @UseInterceptors(
    FilesInterceptor('files', 12, {
      storage: multer.diskStorage({
        destination: (
          _req: Request,
          _file: Express.Multer.File,
          cb: (error: Error | null, destination: string) => void,
        ) => {
          const dir = join(process.cwd(), 'public', 'uploads');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (
          _req: Request,
          file: Express.Multer.File,
          cb: (error: Error | null, filename: string) => void,
        ) => {
          const rawExt = extname(String(file.originalname || '')).toLowerCase();
          const ext = rawExt && rawExt.length <= 12 ? rawExt : '';
          cb(null, `${Date.now()}-${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (
        _req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const mt = String(file.mimetype || '').toLowerCase();
        cb(null, mt.startsWith('image/'));
      },
      limits: {
        files: 12,
        fileSize: 12 * 1024 * 1024,
      },
    }),
  )
  uploadImages(@UploadedFiles() files: Express.Multer.File[]): {
    files: Array<{
      originalName: string;
      fileName: string;
      absPath: string;
      url: string;
    }>;
  } {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('No image files uploaded');
    }
    return {
      files: files.map((f) => ({
        originalName: String(f.originalname || ''),
        fileName: String(f.filename || ''),
        absPath: String(f.path || ''),
        url: `/static/uploads/${String(f.filename || '')}`,
      })),
    };
  }

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
    if (!body.provider) body.provider = 'nvidia';
    if (!body.model) body.model = 'deepseek-ai/deepseek-v3.1-terminus';
    if (!body.ip) {
      const remote = req.ip || req.socket?.remoteAddress || '';
      body.ip = remote || undefined;
    }
    if (!body.now) {
      body.now = new Date().toISOString();
    }
    const auth = await this.requireAuthContext(req);
    body.userId = auth.userId;
    body.tenantId = auth.tenantId;
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
    @Query('provider') provider?: 'gemini' | 'deepseek' | 'nvidia',
    @Query('model') model?: string,
    @Query('temperature') temperature?: number,
    @Query('recursionLimit') recursionLimit?: string,
    @Query('sessionType') sessionType?: 'default' | 'thought' | 'gallery-agent' | 'xhs-specialist' | 'xhs-tracker' | 'xhs-publisher',
    @Req() req?: Request,
  ): Observable<MessageEvent> {
    // 设置默认模型为 kimi-k2-instruct
    const finalProvider = provider ?? 'nvidia';
    const finalModel = model ?? 'deepseek-ai/deepseek-v3.1-terminus';
    const rl = recursionLimit ? Number(recursionLimit) : undefined;
    const remoteIp = req ? req.ip || req.socket?.remoteAddress || '' : '';
    const now = new Date().toISOString();
    return new Observable<MessageEvent>((subscriber) => {
      void this.requireAuthContext(req)
        .then((auth) => {
          const stream$ = this.chat.stream({
            sessionId,
            input,
            provider: finalProvider,
            model: finalModel,
            temperature,
            recursionLimit: rl,
            sessionType,
            ip: remoteIp || undefined,
            now,
            userId: auth.userId,
            tenantId: auth.tenantId,
          });
          const inner = stream$.subscribe({
            next: (event) => subscriber.next(event),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
          return inner;
        })
        .catch((err: unknown) => {
          subscriber.error(err);
        });
    });
  }

  @Post('stream')
  streamPost(
    @Body() body: ChatRequest,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    if (!body.provider) body.provider = 'nvidia';
    if (!body.model) body.model = 'deepseek-ai/deepseek-v3.1-terminus';
    if (!body.ip) {
      const remoteFromReq = typeof req.ip === 'string' ? req.ip : '';
      const remoteFromSocket =
        typeof req.socket?.remoteAddress === 'string'
          ? req.socket.remoteAddress
          : '';
      const remote = remoteFromReq || remoteFromSocket;
      body.ip = remote || undefined;
    }
    if (!body.now) body.now = new Date().toISOString();

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const startStream = async () => {
      const auth = await this.requireAuthContext(req);
      body.userId = auth.userId;
      body.tenantId = auth.tenantId;
      return this.chat.stream(body);
    };
    let subscription: ReturnType<Observable<MessageEvent>['subscribe']> | null =
      null;
    void startStream()
      .then((stream$) => {
        subscription = stream$.subscribe({
          next: (evt) => {
            if (res.writableEnded) return;
            res.write(`data: ${JSON.stringify(evt.data)}\n\n`);
          },
          error: (err: unknown) => {
            if (res.writableEnded) return;
            const e = err instanceof Error ? err : new Error(String(err));
            res.write(
              `data: ${JSON.stringify({
                type: 'error',
                data: { code: 'STREAM_ERROR', message: e.message },
              })}\n\n`,
            );
            res.end();
          },
          complete: () => {
            if (!res.writableEnded) res.end();
          },
        });
      })
      .catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            data: { code: 'STREAM_INIT_ERROR', message: e.message },
          })}\n\n`,
        );
        res.end();
      });

    req.on('close', () => {
      subscription?.unsubscribe();
      if (!res.writableEnded) res.end();
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
    @Body() body?: { sessionId?: string; sessionType?: 'default' | 'thought' | 'gallery-agent' | 'xhs-specialist' | 'xhs-tracker' | 'xhs-publisher' },
    @Req() req?: Request,
  ): Promise<{ sessionId: string }> {
    const auth = await this.requireAuthContext(req);
    const sid = await this.chat.createSession(body?.sessionId, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      sessionType: body?.sessionType,
    });
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
    @Req() req: Request,
    @Query('sessionType') sessionType?: 'default' | 'thought' | 'gallery-agent' | 'xhs-specialist' | 'xhs-tracker' | 'xhs-publisher',
  ): Promise<{ messages: Array<ContextMessage & { fingerprint: string }> }> {
    const auth = await this.requireAuthContext(req);
    const msgs = await this.chat.getMessages(sessionId, undefined, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      sessionType,
    });
    return { messages: msgs };
  }

  @Delete('messages/:sessionId')
  async deleteMessages(
    @Param('sessionId') sessionId: string,
    @Body() body: { fingerprints?: string[]; indexes?: number[] },
    @Req() req: Request,
    @Query('sessionType') sessionType?: 'default' | 'thought' | 'gallery-agent' | 'xhs-specialist' | 'xhs-tracker' | 'xhs-publisher',
  ): Promise<{ ok: boolean; deleted: number }> {
    const auth = await this.requireAuthContext(req);
    const res = await this.chat.deleteMessages(sessionId, body, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      sessionType,
    });
    return { ok: true, deleted: res.deleted };
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
    @Req() req: Request,
    @Query('sessionType') sessionType?: 'default' | 'thought' | 'gallery-agent' | 'xhs-specialist' | 'xhs-tracker' | 'xhs-publisher',
  ): Promise<{ ok: boolean }> {
    const auth = await this.requireAuthContext(req);
    await this.chat.clearSession(sessionId, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      sessionType,
    });
    return { ok: true };
  }

  private async requireAuthContext(req?: Request): Promise<{
    tenantId?: string;
    userId: string;
  }> {
    const auth = await this.resolveAuthContext(req);
    if (!auth.userId) throw new UnauthorizedException('AUTH_REQUIRED');
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /**
   * @description 解析请求中的登录范围信息
   * @keyword-en resolve auth scope from request
   */
  private async resolveAuthContext(req?: Request): Promise<{
    tenantId?: string;
    userId?: string;
  }> {
    const auth = req?.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      return {};
    }
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

interface MessageEvent {
  data: unknown;
}
