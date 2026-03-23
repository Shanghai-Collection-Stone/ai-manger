import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CanvasService } from '../services/canvas.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import type {
  CanvasAddArticlesInput,
  CanvasCreateInput,
  CanvasUpdateStatusInput,
  CanvasUpdateArticleInput,
} from '../entities/canvas.entity.js';

@Controller('canvas')
export class CanvasController {
  constructor(
    private readonly canvas: CanvasService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @description 从请求中解析认证用户（必须提供有效的认证 token）
   * @param {Request} req - Express 请求对象
   * @returns {Promise<{ tenantId?: string; userId?: string }>} 租户和用户范围
   * @throws {UnauthorizedException} 当没有 token 或 token 无效时抛出
   * @keyword-en resolve auth from request
   */
  private async resolveAuthScope(req: Request): Promise<{
    tenantId?: string;
    userId?: string;
  }> {
    const auth = req?.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    const token = auth.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    const user = await this.adminService.getUserByToken(token);
    if (!user) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    return {
      tenantId: user.tenantId,
      userId: user.username,
    };
  }

  /**
   * @description 创建画布。
   * @param {CanvasCreateInput} input - 画布创建参数。
   * @returns {Promise<Record<string, unknown>>} 包含 canvas 的响应对象。
   * @keyword canvas, controller, create
   * @since 2026-02-04
   */
  @Post()
  async create(
    @Body() input: CanvasCreateInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.canvas.create({
      ...input,
      tenantId: authScope.tenantId,
    });
    return { canvas: { ...doc, _id: undefined } };
  }

  /**
   * @description 获取单个画布。
   * @param {string} id - 路径参数：画布ID。
   * @returns {Promise<Record<string, unknown>>} 包含 canvas 的响应对象。
   * @keyword canvas, controller, get
   * @since 2026-02-04
   */
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.canvas.get(Number(id), authScope.tenantId);
    return { canvas: doc };
  }

  /**
   * @description 列出画布，支持按 userId 过滤。
   * @param {string} [userId] - 查询参数：用户ID。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @returns {Promise<Record<string, unknown>>} 包含 canvases 的响应对象。
   * @keyword canvas, controller, list
   * @since 2026-02-04
   */
  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = req ? await this.resolveAuthScope(req) : { tenantId: undefined };
    const lim = limit ? Number(limit) : 50;
    const rows = await this.canvas.list(userId, authScope.tenantId, lim);
    return { canvases: rows };
  }

  /**
   * @description 为画布追加文章。
   * @param {string} id - 路径参数：画布ID。
   * @param {CanvasAddArticlesInput} input - 追加文章输入。
   * @returns {Promise<Record<string, unknown>>} 包含 canvas 的响应对象。
   * @keyword canvas, controller, articles
   * @since 2026-02-04
   */
  @Post(':id/articles')
  async addArticles(
    @Param('id') id: string,
    @Body() input: CanvasAddArticlesInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.canvas.addArticles(Number(id), input, authScope.tenantId);
    return { canvas: doc };
  }

  /**
   * @description 更新画布整体状态。
   * @param {string} id - 路径参数：画布ID。
   * @param {CanvasUpdateStatusInput} input - 更新状态输入。
   * @returns {Promise<Record<string, unknown>>} 包含 canvas 的响应对象。
   * @keyword canvas, controller, status
   * @since 2026-02-04
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() input: CanvasUpdateStatusInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.canvas.updateStatus(Number(id), input.status, authScope.tenantId);
    return { canvas: doc };
  }

  @Patch(':id/articles/:articleId')
  async updateArticle(
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Body() input: CanvasUpdateArticleInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.canvas.updateArticle(
      Number(id),
      Number(articleId),
      input,
      authScope.tenantId,
    );
    return { canvas: doc };
  }
}
