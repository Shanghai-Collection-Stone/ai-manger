import {
  Body,
  Controller,
  Delete,
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
  CanvasImageGroupCreateInput,
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
   * @description 列出画布，支持按 userId / type / tag 过滤，支持分页 skip。
   * @param {string} [userId] - 查询参数：用户ID。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @param {string} [type] - 查询参数：画布类型（article / image-group）。
   * @param {string} [skip] - 查询参数：跳过条数（分页偏移）。
   * @param {string} [tag] - 查询参数：关键词标签过滤。
   * @returns {Promise<Record<string, unknown>>} 包含 canvases 的响应对象。
   * @keyword canvas, controller, list
   * @since 2026-02-04
   */
  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('skip') skip?: string,
    @Query('tag') tag?: string,
    @Req() req?: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = req
      ? await this.resolveAuthScope(req)
      : { tenantId: undefined };
    const lim = limit ? Number(limit) : 50;
    const skp = skip ? Number(skip) : 0;
    const rows = await this.canvas.list(
      userId,
      authScope.tenantId,
      lim,
      type,
      skp,
      tag,
    );
    return { canvases: rows };
  }

  /**
   * @description 创建图片组类型 Canvas，异步生成 imageGroups，立即返回 generating 状态。
   * @param {CanvasImageGroupCreateInput} input - 图片组 canvas 创建参数。
   * @returns {Promise<Record<string, unknown>>} 包含 canvas 的响应对象（status=generating）。
   * @keyword canvas, image-group, create, async
   * @since 2026-04-02
   */
  @Post('image-group')
  async createImageGroup(
    @Body() input: CanvasImageGroupCreateInput,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.canvas.createImageGroupCanvas({
      ...input,
      userId: authScope.userId ?? input.userId ?? 'unknown',
      tenantId: authScope.tenantId,
    });
    return { canvas: { ...doc, _id: undefined } };
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
    const doc = await this.canvas.addArticles(
      Number(id),
      input,
      authScope.tenantId,
    );
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
    const doc = await this.canvas.updateStatus(
      Number(id),
      input.status,
      authScope.tenantId,
    );
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

  /**
   * @description 重新生成图文 Canvas 指定文章封面，只替换首图并把 Canvas 暂置为 generating。
   * @param {string} id - Canvas ID。
   * @param {string} articleId - 文章 ID。
   * @param {{ imageIds?: number[]; sourceImageIds?: number[]; prompt?: string }} body - 参考图片与提示词。
   * @returns {Promise<Record<string, unknown>>} 进入生成中的 Canvas。
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en article-cover-only
   */
  @Post(':id/articles/:articleId/cover/regenerate')
  async regenerateArticleCover(
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Body()
    body: { imageIds?: number[]; sourceImageIds?: number[]; prompt?: string },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const rawIds = Array.isArray(body?.imageIds)
      ? body.imageIds
      : Array.isArray(body?.sourceImageIds)
        ? body.sourceImageIds
        : [];
    const doc = await this.canvas.startArticleCoverRegeneration({
      canvasId: Number(id),
      articleId: Number(articleId),
      userId: authScope.userId ?? 'unknown',
      tenantId: authScope.tenantId,
      imageIds: rawIds.map((item) => Number(item)),
      prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
    });
    return { canvas: doc };
  }

  /**
   * @description 直接使用图库图片设为图文 Canvas 单篇文章封面，只替换首图。
   * @param {string} id - Canvas ID。
   * @param {string} articleId - 文章 ID。
   * @param {{ imageId?: number; imageIds?: number[]; sourceImageIds?: number[] }} body - 选中的图库图片。
   * @returns {Promise<Record<string, unknown>>} 更新后的 Canvas。
   * @keyword-cn 直接设为封面 图片选择
   * @keyword-en cover-select
   * @keyword-en article-cover-only
   */
  @Post(':id/articles/:articleId/cover/select')
  async selectArticleCover(
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Body()
    body: { imageId?: number; imageIds?: number[]; sourceImageIds?: number[] },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const rawIds = Array.isArray(body?.imageIds)
      ? body.imageIds
      : Array.isArray(body?.sourceImageIds)
        ? body.sourceImageIds
        : body?.imageId !== undefined
          ? [body.imageId]
          : [];
    const doc = await this.canvas.selectArticleCoverImage({
      canvasId: Number(id),
      articleId: Number(articleId),
      userId: authScope.userId ?? 'unknown',
      tenantId: authScope.tenantId,
      imageIds: rawIds.map((item) => Number(item)),
    });
    return { canvas: doc };
  }

  /**
   * @description 重新生成图文 Canvas 指定文章的任意图片槽位，imageIndex=0 为封面，1+ 为内页；立即把 Canvas 暂置为 generating。
   * @param {string} id - Canvas ID。
   * @param {string} articleId - 文章 ID。
   * @param {string} imageIndex - 图片下标。
   * @param {{ imageIds?: number[]; sourceImageIds?: number[]; prompt?: string }} body - 参考图片与提示词。
   * @returns {Promise<Record<string, unknown>>} 进入生成中的 Canvas。
   * @keyword-cn 图文内页重生成 图片槽位重生成
   * @keyword-en article-image-regenerate
   * @keyword-en image-slot-regenerate
   */
  @Post(':id/articles/:articleId/images/:imageIndex/regenerate')
  async regenerateArticleImage(
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Param('imageIndex') imageIndex: string,
    @Body()
    body: { imageIds?: number[]; sourceImageIds?: number[]; prompt?: string },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const rawIds = Array.isArray(body?.imageIds)
      ? body.imageIds
      : Array.isArray(body?.sourceImageIds)
        ? body.sourceImageIds
        : [];
    const doc = await this.canvas.startArticleImageRegeneration({
      canvasId: Number(id),
      articleId: Number(articleId),
      imageIndex: Number(imageIndex),
      userId: authScope.userId ?? 'unknown',
      tenantId: authScope.tenantId,
      imageIds: rawIds.map((item) => Number(item)),
      prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
    });
    return { canvas: doc };
  }

  /**
   * @description 直接使用图库图片替换图文 Canvas 指定文章的任意图片槽位，imageIndex=0 为封面，1+ 为内页。
   * @param {string} id - Canvas ID。
   * @param {string} articleId - 文章 ID。
   * @param {string} imageIndex - 图片下标。
   * @param {{ imageId?: number; imageIds?: number[]; sourceImageIds?: number[] }} body - 选中的图库图片。
   * @returns {Promise<Record<string, unknown>>} 更新后的 Canvas。
   * @keyword-cn 图文内页选择 图片槽位替换
   * @keyword-en article-image-select
   * @keyword-en image-slot-select
   */
  @Post(':id/articles/:articleId/images/:imageIndex/select')
  async selectArticleImage(
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Param('imageIndex') imageIndex: string,
    @Body()
    body: { imageId?: number; imageIds?: number[]; sourceImageIds?: number[] },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const rawIds = Array.isArray(body?.imageIds)
      ? body.imageIds
      : Array.isArray(body?.sourceImageIds)
        ? body.sourceImageIds
        : body?.imageId !== undefined
          ? [body.imageId]
          : [];
    const doc = await this.canvas.selectArticleImage({
      canvasId: Number(id),
      articleId: Number(articleId),
      imageIndex: Number(imageIndex),
      userId: authScope.userId ?? 'unknown',
      tenantId: authScope.tenantId,
      imageIds: rawIds.map((item) => Number(item)),
    });
    return { canvas: doc };
  }

  /**
   * @description 重新生成图组 Canvas 指定图组封面，只替换 role=cover 图片并把 Canvas 暂置为 generating。
   * @param {string} id - Canvas ID。
   * @param {string} groupId - 图组 ID。
   * @param {{ imageIds?: number[]; sourceImageIds?: number[]; prompt?: string }} body - 参考图片与提示词。
   * @returns {Promise<Record<string, unknown>>} 进入生成中的 Canvas。
   * @keyword-cn 封面重生成 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en image-group-cover-only
   */
  @Post(':id/image-groups/:groupId/cover/regenerate')
  async regenerateImageGroupCover(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body()
    body: { imageIds?: number[]; sourceImageIds?: number[]; prompt?: string },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const rawIds = Array.isArray(body?.imageIds)
      ? body.imageIds
      : Array.isArray(body?.sourceImageIds)
        ? body.sourceImageIds
        : [];
    const doc = await this.canvas.startImageGroupCoverRegeneration({
      canvasId: Number(id),
      groupId: Number(groupId),
      userId: authScope.userId ?? 'unknown',
      tenantId: authScope.tenantId,
      imageIds: rawIds.map((item) => Number(item)),
      prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
    });
    return { canvas: doc };
  }

  /**
   * @description 直接使用图库图片设为图组 Canvas 指定图组封面，只替换 role=cover 图片。
   * @param {string} id - Canvas ID。
   * @param {string} groupId - 图组 ID。
   * @param {{ imageId?: number; imageIds?: number[]; sourceImageIds?: number[] }} body - 选中的图库图片。
   * @returns {Promise<Record<string, unknown>>} 更新后的 Canvas。
   * @keyword-cn 直接设为封面 图片选择
   * @keyword-en cover-select
   * @keyword-en image-group-cover-only
   */
  @Post(':id/image-groups/:groupId/cover/select')
  async selectImageGroupCover(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body()
    body: { imageId?: number; imageIds?: number[]; sourceImageIds?: number[] },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const rawIds = Array.isArray(body?.imageIds)
      ? body.imageIds
      : Array.isArray(body?.sourceImageIds)
        ? body.sourceImageIds
        : body?.imageId !== undefined
          ? [body.imageId]
          : [];
    const doc = await this.canvas.selectImageGroupCoverImage({
      canvasId: Number(id),
      groupId: Number(groupId),
      userId: authScope.userId ?? 'unknown',
      tenantId: authScope.tenantId,
      imageIds: rawIds.map((item) => Number(item)),
    });
    return { canvas: doc };
  }

  /**
   * @description 重新生成图组 Canvas 指定图组的任意图片槽位，支持 cover 与 inner-1~5，并立即把 Canvas 暂置为 generating。
   * @param {string} id - Canvas ID。
   * @param {string} groupId - 图组 ID。
   * @param {string} role - 图片槽位 role。
   * @param {{ imageIds?: number[]; sourceImageIds?: number[]; prompt?: string }} body - 参考图片与提示词。
   * @returns {Promise<Record<string, unknown>>} 进入生成中的 Canvas。
   * @keyword-cn 内页重生成 图片槽位重生成
   * @keyword-en image-slot-regenerate
   * @keyword-en image-group-image-slot
   */
  @Post(':id/image-groups/:groupId/images/:role/regenerate')
  async regenerateImageGroupImage(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Param('role') role: string,
    @Body()
    body: { imageIds?: number[]; sourceImageIds?: number[]; prompt?: string },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const rawIds = Array.isArray(body?.imageIds)
      ? body.imageIds
      : Array.isArray(body?.sourceImageIds)
        ? body.sourceImageIds
        : [];
    const doc = await this.canvas.startImageGroupImageRegeneration({
      canvasId: Number(id),
      groupId: Number(groupId),
      role,
      userId: authScope.userId ?? 'unknown',
      tenantId: authScope.tenantId,
      imageIds: rawIds.map((item) => Number(item)),
      prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
    });
    return { canvas: doc };
  }

  /**
   * @description 直接使用图库图片替换图组 Canvas 指定图组的任意图片槽位，支持 cover 与 inner-1~5。
   * @param {string} id - Canvas ID。
   * @param {string} groupId - 图组 ID。
   * @param {string} role - 图片槽位 role。
   * @param {{ imageId?: number; imageIds?: number[]; sourceImageIds?: number[] }} body - 选中的图库图片。
   * @returns {Promise<Record<string, unknown>>} 更新后的 Canvas。
   * @keyword-cn 图片槽位替换 内页选择
   * @keyword-en image-slot-select
   * @keyword-en image-group-image-slot
   */
  @Post(':id/image-groups/:groupId/images/:role/select')
  async selectImageGroupImage(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Param('role') role: string,
    @Body()
    body: { imageId?: number; imageIds?: number[]; sourceImageIds?: number[] },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const rawIds = Array.isArray(body?.imageIds)
      ? body.imageIds
      : Array.isArray(body?.sourceImageIds)
        ? body.sourceImageIds
        : body?.imageId !== undefined
          ? [body.imageId]
          : [];
    const doc = await this.canvas.selectImageGroupImage({
      canvasId: Number(id),
      groupId: Number(groupId),
      role,
      userId: authScope.userId ?? 'unknown',
      tenantId: authScope.tenantId,
      imageIds: rawIds.map((item) => Number(item)),
    });
    return { canvas: doc };
  }

  /**
   * @description 将画布文章标记为已发送。
   * @param {string} id - Canvas ID。
   * @param {string} articleId - 文章 ID。
   * @param {{ sentAt?: string }} body - 发送时间。
   * @returns {Promise<Record<string, unknown>>} 更新后的 Canvas。
   * @keyword-en canvas-article-sent
   * @keyword-en mark-sent
   */
  @Patch(':id/articles/:articleId/sent')
  async markArticleSent(
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Body() body: { sentAt?: string },
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const sentAt = body.sentAt ? new Date(body.sentAt) : undefined;
    const doc = await this.canvas.markArticleSent(
      Number(id),
      Number(articleId),
      authScope.tenantId,
      sentAt,
    );
    return { canvas: doc };
  }

  /**
   * @description 删除整个 Canvas（租户隔离）。
   * @param {string} id - Canvas ID。
   * @returns {Promise<Record<string, unknown>>} 删除结果。
   * @keyword-en delete canvas
   */
  @Delete(':id')
  async deleteCanvas(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const deleted = await this.canvas.deleteCanvas(
      Number(id),
      authScope.tenantId,
    );
    return { deleted };
  }

  /**
   * @description 删除 Canvas 中指定文章（租户隔离）。
   * @param {string} id - Canvas ID。
   * @param {string} articleId - 文章 ID。
   * @returns {Promise<Record<string, unknown>>} 更新后的画布。
   * @keyword-en delete article from canvas
   */
  @Delete(':id/articles/:articleId')
  async deleteArticle(
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.canvas.deleteArticle(
      Number(id),
      Number(articleId),
      authScope.tenantId,
    );
    return { canvas: doc };
  }

  /**
   * @description 删除图片组中指定图片（按 imageId，租户隔离）。
   * @param {string} id - Canvas ID。
   * @param {string} groupId - 图片组 ID。
   * @param {string} imageId - 图片 imageId。
   * @returns {Promise<Record<string, unknown>>} 更新后的画布。
   * @keyword-en delete image from canvas image group
   */
  @Delete(':id/image-groups/:groupId/images/:imageId')
  async deleteImageFromGroup(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Param('imageId') imageId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const authScope = await this.resolveAuthScope(req);
    const doc = await this.canvas.deleteImageFromGroup(
      Number(id),
      Number(groupId),
      Number(imageId),
      authScope.tenantId,
    );
    return { canvas: doc };
  }
}
