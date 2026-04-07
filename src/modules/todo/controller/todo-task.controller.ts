import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

/** 合法的任务状态枚举值（运行时校验用） */
const VALID_TODO_STATUSES = new Set(['pending', 'in_progress', 'done', 'failed', 'cancelled']);
/** 合法的节点状态枚举值（运行时校验用） */
const VALID_ITEM_STATUSES = new Set(['pending', 'in_progress', 'done', 'failed', 'cancelled']);

/**
 * @description 将 AI 可能传入的别名状态归一化为数据库在1值
 * 例： 'completed' → 'done'、'running' → 'in_progress'
 * @keyword-en normalize status alias from AI input
 * @param {string} s
 * @returns {string}
 */
function normalizeStatus(s: string): string {
  const aliases: Record<string, string> = {
    completed: 'done',
    finish: 'done',
    finished: 'done',
    success: 'done',
    succeed: 'done',
    running: 'in_progress',
    started: 'in_progress',
    processing: 'in_progress',
    error: 'failed',
    abort: 'cancelled',
    aborted: 'cancelled',
    cancel: 'cancelled',
  };
  return aliases[s] ?? s;
}
import type { Request } from 'express';
import { TodoService } from '../services/todo.service.js';
import type { TodoItemCreateInput, TodoItemUpdateInput } from '../entities/todo-item.entity.js';
import type { CanvasArticleEntity } from '../../canvas/entities/canvas.entity.js';

/**
 * @description 诊断字符串是否已乱码（含 U+003F '?' 或 U+FFFD '\uFFFD'）
 * @keyword-en diagnose garbled string char codes
 */
function garbageDiag(label: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return { label, type: typeof value };
  const codes = Array.from(value.slice(0, 40)).map((c) => c.codePointAt(0) as number);
  return {
    label,
    preview: value.slice(0, 120),
    length: value.length,
    byteLength: Buffer.byteLength(value, 'utf8'),
    questionMarkCount: (value.match(/\?/g) ?? []).length,
    firstCharCodes: codes,
    isGarbled: codes.some((c) => c === 63 || c === 65533),
  };
}

/**
 * @description 任务专项接口控制器，供 claw skill 通过 taskToken 鉴权后操作任务和执行节点
 * @keyword-en TodoTaskController task token auth dedicated API for claw skill
 */
@Controller('task-api')
export class TodoTaskController {
  private readonly logger = new Logger(TodoTaskController.name);

  constructor(
    private readonly todo: TodoService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * @description 从请求头提取并验证 taskToken，返回对应 todo
   * @keyword-en resolve todo by task token from Authorization header
   */
  private async resolveTodo(req: Request, todoId: number) {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('TASK_TOKEN_REQUIRED');
    }
    const token = auth.slice(7).trim();
    if (!token) throw new UnauthorizedException('TASK_TOKEN_REQUIRED');
    const todo = await this.todo.getByTaskToken(token);
    if (!todo) throw new UnauthorizedException('INVALID_TASK_TOKEN');
    if (todo.id !== todoId) throw new UnauthorizedException('TASK_TOKEN_MISMATCH');
    return todo;
  }

  /**
   * @description 获取任务详情
   * @keyword-en get task detail by task token
   */
  @Get(':todoId')
  async getTask(
    @Param('todoId') todoId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const { _id, taskToken, ...rest } = todo as typeof todo & { _id?: unknown; taskToken?: unknown };
    void _id; void taskToken;
    return { todo: rest };
  }

  /**
   * @description 更新任务字段（状态/描述/aiPlan/异常原因等）
   * @keyword-en update task fields via task token
   */
  @Patch(':todoId')
  async updateTask(
    @Param('todoId') todoId: string,
    @Body() body: {
      status?: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
      title?: string;
      description?: string;
      aiPlan?: string;
      abnormalReason?: string;
      taskResult?: string;
      stage?: string;
    },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    // --- status 运行时校验：AI 可能传入中文或无效值，直接拒绝写入 ---
    if (body.status !== undefined) {
      const rawStatus = body.status as unknown as string;
      const normalized = normalizeStatus(rawStatus);
      if (normalized !== rawStatus) {
        this.logger.log(`[updateTask] status alias: '${rawStatus}' → '${normalized}' (todoId=${todoId})`);
        (body as Record<string, unknown>).status = normalized;
      }
      if (!VALID_TODO_STATUSES.has(normalized)) {
        this.logger.warn(
          `[updateTask] INVALID status rejected: '${rawStatus}' (todoId=${todoId})`,
        );
        delete (body as Record<string, unknown>).status;
      }
    }

    // --- 接口入参日志 ---
    this.logger.log(
      `[updateTask] todoId=${todoId} body.keys=${Object.keys(body).join(',')} status=${body.status ?? '-'}`,
    );
    if (body.aiPlan !== undefined) {
      this.logger.log(`[updateTask] aiPlan diag: ${JSON.stringify(garbageDiag('aiPlan', body.aiPlan))}`);
    }
    if (body.description !== undefined) {
      this.logger.log(`[updateTask] description diag: ${JSON.stringify(garbageDiag('description', body.description))}`);
    }
    if (body.taskResult !== undefined) {
      this.logger.log(`[updateTask] taskResult diag: ${JSON.stringify(garbageDiag('taskResult', body.taskResult))}`);
    }
    if (body.abnormalReason !== undefined) {
      this.logger.log(`[updateTask] abnormalReason diag: ${JSON.stringify(garbageDiag('abnormalReason', body.abnormalReason))}`);
    }

    const todo = await this.resolveTodo(req, Number(todoId));
    const updated = await this.todo.update({
      id: todo.id,
      tenantId: todo.tenantId,
      ...body,
    });
    if (!updated) {
      this.logger.warn(`[updateTask] update returned null, todoId=${todoId}`);
      return { ok: false };
    }
    const { _id, taskToken, ...rest } = updated as typeof updated & { _id?: unknown; taskToken?: unknown };
    void _id; void taskToken;
    // --- 接口响应日志 ---
    this.logger.log(
      `[updateTask] ok todoId=${todoId} status=${String(rest.status)} aiPlan.len=${typeof rest.aiPlan === 'string' ? rest.aiPlan.length : '-'}`,
    );
    return { ok: true, todo: rest };
  }

  /**
   * @description 删除任务（仅影响当前 token 绑定的任务）
   * @keyword-en delete task via task token
   */
  @Delete(':todoId')
  async deleteTask(
    @Param('todoId') todoId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const ok = await this.todo.delete(todo.id, todo.tenantId);
    return { ok };
  }

  /**
   * @description 列出任务的执行节点
   * @keyword-en list todo items via task token
   */
  @Get(':todoId/items')
  async listItems(
    @Param('todoId') todoId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const items = await this.todo.listItems(todo.id, todo.tenantId);
    return { items };
  }

  /**
   * @description 获取单个执行节点详情
   * @keyword-en get single todo item via task token
   */
  @Get(':todoId/items/:itemId')
  async getItem(
    @Param('todoId') todoId: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const item = await this.todo.getItem(Number(itemId), todo.tenantId);
    if (!item || item.todoId !== todo.id) {
      throw new UnauthorizedException('ITEM_NOT_BELONG_TO_TASK');
    }
    const { _id, ...rest } = item as typeof item & { _id?: unknown };
    void _id;
    return { item: rest };
  }

  /**
   * @description 新增执行节点
   * @keyword-en create todo item via task token
   */
  @Post(':todoId/items')
  async createItem(
    @Param('todoId') todoId: string,
    @Body() body: Omit<TodoItemCreateInput, 'todoId'>,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    // 通过 task-api 创建的节点默认为 in_progress（机器人执行步骤语境）
    // 若 AI 传了非法 status，也修正为 in_progress
    const rawStatus = body.status as unknown as string | undefined;
    if (!rawStatus || !VALID_ITEM_STATUSES.has(rawStatus)) {
      if (rawStatus) {
        this.logger.warn(`[createItem] INVALID status coerced to in_progress: '${rawStatus}' (todoId=${todoId})`);
      }
      (body as Record<string, unknown>).status = 'in_progress';
    }

    this.logger.log(
      `[createItem] todoId=${todoId} title=${JSON.stringify(body.title)} status=${body.status ?? '-'} stage=${body.stage ?? '-'}`,
    );
    if (body.title !== undefined) {
      this.logger.log(`[createItem] title diag: ${JSON.stringify(garbageDiag('title', body.title))}`);
    }
    if (body.description !== undefined) {
      this.logger.log(`[createItem] description diag: ${JSON.stringify(garbageDiag('description', body.description))}`);
    }

    const todo = await this.resolveTodo(req, Number(todoId));
    const item = await this.todo.createItem({
      ...body,
      todoId: todo.id,
      tenantId: todo.tenantId,
    });
    const { _id, ...rest } = item as typeof item & { _id?: unknown };
    void _id;
    this.logger.log(`[createItem] created itemId=${String(rest.id)} todoId=${todoId}`);
    return { item: rest };
  }

  /**
   * @description 更新执行节点（通过节点ID，验证归属当前任务）
   * @keyword-en update todo item via task token
   */
  @Patch(':todoId/items/:itemId')
  async updateItem(
    @Param('todoId') todoId: string,
    @Param('itemId') itemId: string,
    @Body() body: Omit<TodoItemUpdateInput, 'id'>,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    // status 运行时校验
    if (body.status !== undefined) {
      const rawStatus = body.status as unknown as string;
      const normalized = normalizeStatus(rawStatus);
      if (normalized !== rawStatus) {
        this.logger.log(`[updateItem] status alias: '${rawStatus}' → '${normalized}' (itemId=${itemId})`);
        (body as Record<string, unknown>).status = normalized;
      }
      if (!VALID_ITEM_STATUSES.has(normalized)) {
        this.logger.warn(
          `[updateItem] INVALID status rejected: '${rawStatus}' (itemId=${itemId})`,
        );
        delete (body as Record<string, unknown>).status;
      }
    }

    this.logger.log(
      `[updateItem] todoId=${todoId} itemId=${itemId} body.keys=${Object.keys(body).join(',')} status=${body.status ?? '-'}`,
    );
    if (body.doneNote !== undefined) {
      this.logger.log(`[updateItem] doneNote diag: ${JSON.stringify(garbageDiag('doneNote', body.doneNote))}`);
    }
    if (body.title !== undefined) {
      this.logger.log(`[updateItem] title diag: ${JSON.stringify(garbageDiag('title', body.title))}`);
    }

    const todo = await this.resolveTodo(req, Number(todoId));
    const item = await this.todo.getItem(Number(itemId), todo.tenantId);
    if (!item || item.todoId !== todo.id) {
      throw new UnauthorizedException('ITEM_NOT_BELONG_TO_TASK');
    }
    const updated = await this.todo.updateItem({
      ...body,
      id: Number(itemId),
      tenantId: todo.tenantId,
    });
    if (!updated) {
      this.logger.warn(`[updateItem] update returned null, itemId=${itemId}`);
      return { ok: false };
    }
    const { _id, ...rest } = updated as typeof updated & { _id?: unknown };
    void _id;
    this.logger.log(`[updateItem] ok itemId=${itemId} status=${String(rest.status)}`);
    return { ok: true, item: rest };
  }

  /**
   * @description 删除执行节点（验证归属当前任务）
   * @keyword-en delete todo item via task token
   */
  @Delete(':todoId/items/:itemId')
  async deleteItem(
    @Param('todoId') todoId: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const item = await this.todo.getItem(Number(itemId), todo.tenantId);
    if (!item || item.todoId !== todo.id) {
      throw new UnauthorizedException('ITEM_NOT_BELONG_TO_TASK');
    }
    const ok = await this.todo.deleteItem(Number(itemId), todo.tenantId);
    return { ok };
  }

  /**
   * @description 从 todo 文本中提取 Canvas ID
   * @keyword-en extract canvas id from todo text fields
   */
  private extractCanvasId(todo: { title?: string; description?: string; aiConsideration?: string; decisionReason?: string; aiPlan?: string }): number | undefined {
    const text = [
      todo.title,
      todo.description,
      todo.aiConsideration,
      todo.decisionReason,
      todo.aiPlan,
    ]
      .filter(Boolean)
      .join('\n');
    const r1 = /\bcanvas(?:\s*id)?\s*[:：#]?\s*(\d+)\b/i.exec(text);
    const r2 = /画布\s*[:：#]?\s*(\d+)\b/i.exec(text);
    const raw = r1?.[1] ?? r2?.[1];
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.floor(n);
  }

  /**
   * @description 将图片相对路径转换为完整路径
   * @keyword-en resolve relative image url to absolute
   */
  private resolveImageUrl(url?: string): string | undefined {
    if (!url) return undefined;
    // 如果已经是完整路径（http/https/data:开头），直接返回
    if (/^(https?|data:)/i.test(url)) return url;
    // 拼接完整路径
    const base = (process.env.TASK_API_BASE_URL ?? 'http://127.0.0.1:3011').replace(/\/$/, '');
    return `${base}/${url.replace(/^\//, '')}`;
  }

  /**
   * @description 获取专项 Canvas 下的所有文章（图片地址转为完整路径）
   * @keyword-en get canvas articles by task token
   */
  @Get(':todoId/canvas')
  async getCanvasArticles(
    @Param('todoId') todoId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const canvasId = this.extractCanvasId(todo);
    if (!canvasId) {
      return { canvas: null, articles: [], message: 'CANVAS_ID_NOT_FOUND_IN_TASK' };
    }

    // 通过 ModuleRef 获取 CanvasService（懒加载避免循环依赖）
    const { CanvasService } = await import('../../canvas/services/canvas.service.js');
    const canvasService = this.moduleRef.get(CanvasService, { strict: false });
    if (!canvasService) {
      throw new Error('CANVAS_SERVICE_UNAVAILABLE');
    }

    const canvas = await canvasService.get(canvasId, todo.tenantId);
    if (!canvas) {
      return { canvas: null, articles: [], message: 'CANVAS_NOT_FOUND' };
    }

    // 转换图片地址为完整路径
    const articles: Array<Omit<CanvasArticleEntity, 'imageUrls'> & { imageUrls: string[] }> = (
      canvas.articles ?? []
    ).map((article: CanvasArticleEntity) => ({
      ...article,
      imageUrls: (article.imageUrls ?? []).map((url: string) => this.resolveImageUrl(url) ?? url),
    }));

    return {
      canvas: {
        id: canvas.id,
        topic: canvas.topic,
        status: canvas.status,
        createdAt: canvas.createdAt,
        updatedAt: canvas.updatedAt,
      },
      articles,
    };
  }
}
