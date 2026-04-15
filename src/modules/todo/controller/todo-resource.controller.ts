import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Request } from 'express';
import { TodoService } from '../services/todo.service.js';
import type { TodoEntity } from '../entities/todo.entity.js';
import type { TodoItemCreateInput, TodoItemUpdateInput } from '../entities/todo-item.entity.js';
import { XhsPostStatService } from '../services/xhs-post-stat.service.js';
import type {
  XhsPostStatCreateInput,
  XhsPostStatUpdateInput,
} from '../entities/xhs-post-stat.entity.js';
import type { CanvasArticleEntity } from '../../canvas/entities/canvas.entity.js';

/** 合法的任务状态枚举值 */
const VALID_TODO_STATUSES = new Set(['pending', 'in_progress', 'done', 'failed', 'cancelled']);
/** 合法的节点状态枚举值 */
const VALID_ITEM_STATUSES = new Set(['pending', 'in_progress', 'done', 'failed', 'cancelled']);

/**
 * @description 状态别名归一化（AI 传入别名时自动转换）
 * @keyword-en normalize status alias
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

/**
 * @description 诊断字符串是否已乱码
 * @keyword-en diagnose garbled string
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
 * @description 关键资源接口控制器，提供对 task-api 所有资源的无差别访问
 * 通过 resourceToken 鉴权，可访问 token 对应资源集合下的所有资源
 * @keyword-en TodoResourceController resource token auth API for accessing all task resources
 */
@Controller('task-api-resource')
export class TodoResourceController {
  private readonly logger = new Logger(TodoResourceController.name);

  constructor(
    private readonly todo: TodoService,
    private readonly moduleRef: ModuleRef,
    private readonly xhsPostStat: XhsPostStatService,
  ) {}

  /**
   * @description 从请求头提取并验证 taskToken，返回对应任务
   * @keyword-en resolve todo by task token
   */
  private async resolveTodo(req: Request, todoId: number) {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('TASK_TOKEN_REQUIRED');
    }
    const token = auth.slice(7).trim();
    if (!token) throw new UnauthorizedException('TASK_TOKEN_REQUIRED');

    // taskToken 验证
    const todo = await this.todo.getByTaskToken(token);
    if (!todo) throw new UnauthorizedException('INVALID_TASK_TOKEN');

    // 验证 todoId 归属
    if (todo.id !== todoId) throw new UnauthorizedException('TASK_TOKEN_MISMATCH');
    return todo;
  }

  // ─── 统一资源读取 ─────────────────────────────────────────────────────────

  /**
   * @description 统一资源读取接口，根据 resourceId（canvas ID 或 filename）精确获取关联资源
   * @keyword-en get associated resource by resourceId or filename
   */
  @Get(':todoId/resource/:resourceId')
  async getResource(
    @Param('todoId') todoId: string,
    @Param('resourceId') resourceId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));

    // 查找关联资源
    const associated = todo.associatedResources?.find(
      (r) => String(r.resourceId) === resourceId,
    );
    if (!associated) {
      throw new UnauthorizedException('RESOURCE_NOT_ASSOCIATED');
    }

    if (associated.type === 'canvas') {
      // Canvas 类型：调用 canvasService 获取单篇文章
      const canvasId = Number(resourceId);
      if (!Number.isFinite(canvasId) || canvasId <= 0) {
        return {
          resource: { type: 'canvas', id: resourceId, associated: false },
          data: null,
          message: 'CANVAS_ID_INVALID',
        };
      }

      const { CanvasService } = await import('../../canvas/services/canvas.service.js');
      const canvasService = this.moduleRef.get(CanvasService, { strict: false });
      if (!canvasService) throw new Error('CANVAS_SERVICE_UNAVAILABLE');

      const canvas = await canvasService.get(canvasId, todo.tenantId);
      if (!canvas) {
        return {
          resource: { type: 'canvas', id: canvasId, associated: false },
          data: null,
          message: 'CANVAS_NOT_FOUND',
        };
      }

      const articles: Array<Omit<CanvasArticleEntity, 'imageUrls'> & { imageUrls: string[] }> = (
        canvas.articles ?? []
      ).map((article: CanvasArticleEntity) => ({
        ...article,
        imageUrls: (article.imageUrls ?? []).map((url: string) => this.resolveImageUrl(url) ?? url),
      }));

      return {
        resource: { type: 'canvas', id: canvas.id, associated: true },
        data: {
          canvas: { id: canvas.id, topic: canvas.topic, status: canvas.status, createdAt: canvas.createdAt, updatedAt: canvas.updatedAt },
          articles,
        },
      };
    }

    if (associated.type === 'file') {
      // File 类型：从 task-api 目录读取文件
      const filePath = join(process.cwd(), 'task-api', String(resourceId));
      try {
        const content = await readFile(filePath, 'utf-8');
        return {
          resource: { type: 'file', id: resourceId, associated: true },
          data: { content, filename: resourceId },
        };
      } catch {
        return {
          resource: { type: 'file', id: resourceId, associated: false },
          data: null,
          message: 'FILE_NOT_FOUND',
        };
      }
    }

    return {
      resource: { type: associated.type, id: resourceId, associated: false },
      data: null,
      message: 'RESOURCE_TYPE_NOT_SUPPORTED',
    };
  }

  // ─── 任务操作 ─────────────────────────────────────────────────────────────

  /**
   * @description 获取任务详情
   * @keyword-en get task detail
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
   * @description 更新任务字段
   * @keyword-en update task fields
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
    // status 运行时校验
    if (body.status !== undefined) {
      const rawStatus = body.status as unknown as string;
      const normalized = normalizeStatus(rawStatus);
      if (normalized !== rawStatus) {
        this.logger.log(`[updateTask] status alias: '${rawStatus}' → '${normalized}' (todoId=${todoId})`);
        (body as Record<string, unknown>).status = normalized;
      }
      if (!VALID_TODO_STATUSES.has(normalized)) {
        this.logger.warn(`[updateTask] INVALID status rejected: '${rawStatus}' (todoId=${todoId})`);
        delete (body as Record<string, unknown>).status;
      }
    }

    this.logger.log(`[updateTask] todoId=${todoId} body.keys=${Object.keys(body).join(',')}`);
    if (body.aiPlan !== undefined) {
      this.logger.log(`[updateTask] aiPlan diag: ${JSON.stringify(garbageDiag('aiPlan', body.aiPlan))}`);
    }

    const todo = await this.resolveTodo(req, Number(todoId));
    const updated = await this.todo.update({ id: todo.id, tenantId: todo.tenantId, ...body });
    if (!updated) return { ok: false };
    const { _id, taskToken, ...rest } = updated as typeof updated & { _id?: unknown; taskToken?: unknown };
    void _id; void taskToken;
    return { ok: true, todo: rest };
  }

  /**
   * @description 删除任务
   * @keyword-en delete task
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

  // ─── 执行节点操作 ─────────────────────────────────────────────────────────

  /**
   * @description 列出执行节点
   * @keyword-en list todo items
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
   * @description 获取单个执行节点
   * @keyword-en get single todo item
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
   * @keyword-en create todo item
   */
  @Post(':todoId/items')
  async createItem(
    @Param('todoId') todoId: string,
    @Body() body: Omit<TodoItemCreateInput, 'todoId'>,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const rawStatus = body.status as unknown as string | undefined;
    if (!rawStatus || !VALID_ITEM_STATUSES.has(rawStatus)) {
      if (rawStatus) {
        this.logger.warn(`[createItem] INVALID status coerced to in_progress: '${rawStatus}'`);
      }
      (body as Record<string, unknown>).status = 'in_progress';
    }

    const todo = await this.resolveTodo(req, Number(todoId));
    const item = await this.todo.createItem({ ...body, todoId: todo.id, tenantId: todo.tenantId });
    const { _id, ...rest } = item as typeof item & { _id?: unknown };
    void _id;
    this.logger.log(`[createItem] created itemId=${String(rest.id)} todoId=${todoId}`);
    return { item: rest };
  }

  /**
   * @description 更新执行节点
   * @keyword-en update todo item
   */
  @Patch(':todoId/items/:itemId')
  async updateItem(
    @Param('todoId') todoId: string,
    @Param('itemId') itemId: string,
    @Body() body: Omit<TodoItemUpdateInput, 'id'>,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    if (body.status !== undefined) {
      const rawStatus = body.status as unknown as string;
      const normalized = normalizeStatus(rawStatus);
      if (normalized !== rawStatus) {
        (body as Record<string, unknown>).status = normalized;
      }
      if (!VALID_ITEM_STATUSES.has(normalized)) {
        delete (body as Record<string, unknown>).status;
      }
    }

    const todo = await this.resolveTodo(req, Number(todoId));
    const item = await this.todo.getItem(Number(itemId), todo.tenantId);
    if (!item || item.todoId !== todo.id) {
      throw new UnauthorizedException('ITEM_NOT_BELONG_TO_TASK');
    }
    const updated = await this.todo.updateItem({ ...body, id: Number(itemId), tenantId: todo.tenantId });
    if (!updated) return { ok: false };
    const { _id, ...rest } = updated as typeof updated & { _id?: unknown };
    void _id;
    return { ok: true, item: rest };
  }

  /**
   * @description 删除执行节点
   * @keyword-en delete todo item
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

  // ─── Canvas 资源操作 ─────────────────────────────────────────────────────

  /**
   * @description 将图片相对路径转换为完整路径
   * @keyword-en resolve relative image url
   */
  private resolveImageUrl(url?: string): string | undefined {
    if (!url) return undefined;
    if (/^(https?|data:)/i.test(url)) return url;
    const base = (process.env.TASK_API_BASE_URL ?? 'http://127.0.0.1:3011').replace(/\/$/, '');
    return `${base}/${url.replace(/^\//, '')}`;
  }

  /**
   * @description 获取 Canvas 下的所有文章（需任务关联此 Canvas）
   * @keyword-en get canvas articles
   */
  @Get(':todoId/canvas')
  async getCanvasArticles(
    @Param('todoId') todoId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));

    // 从 associatedResources 中查找 canvas 类型的关联
    const canvasResource = todo.associatedResources?.find((r) => r.type === 'canvas');
    if (!canvasResource) {
      return {
        resource: { type: 'canvas', id: null, associated: false },
        data: null,
        message: 'CANVAS_NOT_ASSOCIATED',
      };
    }

    const canvasId = Number(canvasResource.resourceId);
    if (!Number.isFinite(canvasId) || canvasId <= 0) {
      return {
        resource: { type: 'canvas', id: canvasResource.resourceId, associated: false },
        data: null,
        message: 'CANVAS_ID_INVALID',
      };
    }

    const { CanvasService } = await import('../../canvas/services/canvas.service.js');
    const canvasService = this.moduleRef.get(CanvasService, { strict: false });
    if (!canvasService) throw new Error('CANVAS_SERVICE_UNAVAILABLE');

    const canvas = await canvasService.get(canvasId, todo.tenantId);
    if (!canvas) {
      return {
        resource: { type: 'canvas', id: canvasId, associated: false },
        data: null,
        message: 'CANVAS_NOT_FOUND',
      };
    }

    const articles: Array<Omit<CanvasArticleEntity, 'imageUrls'> & { imageUrls: string[] }> = (
      canvas.articles ?? []
    ).map((article: CanvasArticleEntity) => ({
      ...article,
      imageUrls: (article.imageUrls ?? []).map((url: string) => this.resolveImageUrl(url) ?? url),
    }));

    return {
      resource: { type: 'canvas', id: canvas.id, associated: true },
      data: {
        canvas: { id: canvas.id, topic: canvas.topic, status: canvas.status, createdAt: canvas.createdAt, updatedAt: canvas.updatedAt },
        articles,
      },
    };
  }

  // ─── XHS 帖子数据操作 ────────────────────────────────────────────────────

  /**
   * @description 列出帖子数据
   * @keyword-en list xhs post stats
   */
  @Get(':todoId/xhs-stats')
  async listXhsStats(
    @Param('todoId') todoId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const stats = await this.xhsPostStat.listByTodo(todo.id);
    return {
      resource: { type: 'xhs_stats', id: null, associated: true, todoId: todo.id },
      data: { stats },
    };
  }

  /**
   * @description 获取单条帖子数据
   * @keyword-en get single xhs post stat
   */
  @Get(':todoId/xhs-stats/:statId')
  async getXhsStat(
    @Param('todoId') todoId: string,
    @Param('statId') statId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const stat = await this.xhsPostStat.get(Number(statId));
    if (!stat) {
      return {
        resource: { type: 'xhs_stats', id: Number(statId), associated: false },
        data: null,
        message: 'STAT_NOT_FOUND',
      };
    }
    if (stat.todoId !== todo.id) {
      throw new UnauthorizedException('STAT_NOT_BELONG_TO_TASK');
    }
    return {
      resource: { type: 'xhs_stats', id: stat.id, associated: true },
      data: { stat },
    };
  }

  /**
   * @description 新增帖子数据
   * @keyword-en create xhs post stat
   */
  @Post(':todoId/xhs-stats')
  async createXhsStat(
    @Param('todoId') todoId: string,
    @Body() body: Omit<XhsPostStatCreateInput, 'todoId'>,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const stat = await this.xhsPostStat.create({ ...body, todoId: todo.id });
    const { _id, ...rest } = stat as typeof stat & { _id?: unknown };
    void _id;
    return {
      resource: { type: 'xhs_stats', id: rest.id, associated: true },
      data: { stat: rest },
    };
  }

  /**
   * @description 批量 upsert 帖子数据
   * @keyword-en bulk upsert xhs post stats
   */
  @Post(':todoId/xhs-stats/bulk')
  async bulkUpsertXhsStats(
    @Param('todoId') todoId: string,
    @Body() body: { items?: Omit<XhsPostStatCreateInput, 'todoId'>[]; posts?: unknown },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    if (!Array.isArray(body?.items)) {
      const wrongPosts = Array.isArray(body?.posts);
      throw new BadRequestException({
        code: 'INVALID_XHS_STATS_BULK_BODY',
        message: wrongPosts
          ? '请求体格式错误：该接口仅支持 items 字段，请将 posts 重命名为 items。'
          : '请求体格式错误：请使用 { "items": [...] }，并确保 items 为数组。',
      });
    }

    const items = body.items;
    const badIndex = items.findIndex((x) => !x || typeof x.postTitle !== 'string' || x.postTitle.trim().length === 0);
    if (badIndex >= 0) {
      throw new BadRequestException({
        code: 'INVALID_XHS_STATS_ITEM',
        message: `请求体格式错误：items[${badIndex}] 缺少有效 postTitle。`,
      });
    }

    const result = await this.xhsPostStat.bulkUpsert(todo.id, items);
    return {
      resource: { type: 'xhs_stats', id: null, associated: true, todoId: todo.id },
      data: { ok: true, upserted: result.upserted },
    };
  }

  /**
   * @description 更新帖子数据
   * @keyword-en update xhs post stat
   */
  @Patch(':todoId/xhs-stats/:statId')
  async updateXhsStat(
    @Param('todoId') todoId: string,
    @Param('statId') statId: string,
    @Body() body: Omit<XhsPostStatUpdateInput, 'id'>,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const existing = await this.xhsPostStat.get(Number(statId));
    if (!existing) {
      return {
        resource: { type: 'xhs_stats', id: Number(statId), associated: false },
        data: null,
        message: 'STAT_NOT_FOUND',
      };
    }
    if (existing.todoId !== todo.id) {
      throw new UnauthorizedException('STAT_NOT_BELONG_TO_TASK');
    }
    const updated = await this.xhsPostStat.update({ ...body, id: Number(statId) });
    if (!updated) return { ok: false };
    const { _id, ...rest } = updated as typeof updated & { _id?: unknown };
    void _id;
    return {
      resource: { type: 'xhs_stats', id: rest.id, associated: true },
      data: { ok: true, stat: rest },
    };
  }

  /**
   * @description 删除帖子数据
   * @keyword-en delete xhs post stat
   */
  @Delete(':todoId/xhs-stats/:statId')
  async deleteXhsStat(
    @Param('todoId') todoId: string,
    @Param('statId') statId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const todo = await this.resolveTodo(req, Number(todoId));
    const existing = await this.xhsPostStat.get(Number(statId));
    if (!existing) {
      return {
        resource: { type: 'xhs_stats', id: Number(statId), associated: false },
        data: null,
        message: 'STAT_NOT_FOUND',
      };
    }
    if (existing.todoId !== todo.id) {
      throw new UnauthorizedException('STAT_NOT_BELONG_TO_TASK');
    }
    const ok = await this.xhsPostStat.delete(Number(statId));
    return {
      resource: { type: 'xhs_stats', id: Number(statId), associated: true },
      data: { ok },
    };
  }
}
