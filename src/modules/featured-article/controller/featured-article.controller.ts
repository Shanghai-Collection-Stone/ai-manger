import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { FeaturedArticleService } from '../services/featured-article.service.js';
import type {
  FeaturedArticleAuthScope,
  FeaturedArticlePageInput,
} from '../entities/featured-article.entity.js';

/**
 * @description Featured article admin controller for workspaces, pages, and article-library storage.
 * @keyword-en featured-article, admin-controller
 * @keyword-cn 精选文章, 管理端控制器
 */
@Controller('api/featured-article')
export class FeaturedArticleController {
  constructor(private readonly featuredArticle: FeaturedArticleService) {}

  /**
   * @description Require an authenticated admin user and convert it into a featured article scope.
   * @keyword-en featured-article, require-auth-scope
   * @keyword-cn 精选文章, 鉴权作用域
   */
  private requireScope(req: Request): FeaturedArticleAuthScope {
    const user = (req as AdminRequest).adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return { tenantId: user.tenantId, userId: user.username };
  }

  /**
   * @description Parse a path parameter as a positive numeric id.
   * @keyword-en featured-article, parse-numeric-id
   * @keyword-cn 精选文章, 数字编号
   */
  private parseNumericId(value: string, errorCode: string): number {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException(errorCode);
    }
    return Math.floor(id);
  }

  /**
   * @description List featured article workspaces for the current admin scope.
   * @keyword-en featured-article, list-workspaces-endpoint
   * @keyword-cn 精选文章, 工作区列表接口
   */
  @UseGuards(AdminAuthGuard)
  @Get('workspaces')
  async listWorkspaces(
    @Req() req: Request,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
  ) {
    return this.featuredArticle.listWorkspaces({
      scope: this.requireScope(req),
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * @description Create a featured article workspace.
   * @keyword-en featured-article, create-workspace-endpoint
   * @keyword-cn 精选文章, 创建工作区接口
   */
  @UseGuards(AdminAuthGuard)
  @Post('workspaces')
  async createWorkspace(
    @Req() req: Request,
    @Body() body: { name?: string; pages?: FeaturedArticlePageInput[] },
  ) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('WORKSPACE_NAME_REQUIRED');
    const workspace = await this.featuredArticle.createWorkspace(
      this.requireScope(req),
      {
        name,
        pages: Array.isArray(body?.pages) ? body.pages : undefined,
      },
    );
    return { workspace };
  }

  /**
   * @description Get one featured article workspace.
   * @keyword-en featured-article, get-workspace-endpoint
   * @keyword-cn 精选文章, 工作区详情接口
   */
  @UseGuards(AdminAuthGuard)
  @Get('workspaces/:workspaceId')
  async getWorkspace(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
  ) {
    const workspace = await this.featuredArticle.getWorkspace(
      this.requireScope(req),
      this.parseNumericId(workspaceId, 'WORKSPACE_ID_REQUIRED'),
    );
    if (!workspace) throw new NotFoundException('WORKSPACE_NOT_FOUND');
    return { workspace };
  }

  /**
   * @description Update featured article workspace metadata.
   * @keyword-en featured-article, update-workspace-endpoint
   * @keyword-cn 精选文章, 更新工作区接口
   */
  @UseGuards(AdminAuthGuard)
  @Patch('workspaces/:workspaceId')
  async updateWorkspace(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { name?: string },
  ) {
    const workspace = await this.featuredArticle.updateWorkspace(
      this.requireScope(req),
      this.parseNumericId(workspaceId, 'WORKSPACE_ID_REQUIRED'),
      { name: body?.name },
    );
    if (!workspace) throw new NotFoundException('WORKSPACE_NOT_FOUND');
    return { workspace };
  }

  /**
   * @description Delete a featured article workspace.
   * @keyword-en featured-article, delete-workspace-endpoint
   * @keyword-cn 精选文章, 删除工作区接口
   */
  @UseGuards(AdminAuthGuard)
  @Delete('workspaces/:workspaceId')
  async deleteWorkspace(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
  ) {
    const ok = await this.featuredArticle.deleteWorkspace(
      this.requireScope(req),
      this.parseNumericId(workspaceId, 'WORKSPACE_ID_REQUIRED'),
    );
    return { ok };
  }

  /**
   * @description Create a page in a featured article workspace.
   * @keyword-en featured-article, create-page-endpoint
   * @keyword-cn 精选文章, 创建页面接口
   */
  @UseGuards(AdminAuthGuard)
  @Post('workspaces/:workspaceId/pages')
  async createPage(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
    @Body() body: FeaturedArticlePageInput,
  ) {
    const result = await this.featuredArticle.createPage(
      this.requireScope(req),
      this.parseNumericId(workspaceId, 'WORKSPACE_ID_REQUIRED'),
      body,
    );
    if (!result) throw new NotFoundException('WORKSPACE_NOT_FOUND');
    return result;
  }

  /**
   * @description Update a page in a featured article workspace.
   * @keyword-en featured-article, update-page-endpoint
   * @keyword-cn 精选文章, 更新页面接口
   */
  @UseGuards(AdminAuthGuard)
  @Patch('workspaces/:workspaceId/pages/:pageId')
  async updatePage(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('pageId') pageId: string,
    @Body() body: FeaturedArticlePageInput,
  ) {
    const result = await this.featuredArticle.updatePage(
      this.requireScope(req),
      this.parseNumericId(workspaceId, 'WORKSPACE_ID_REQUIRED'),
      pageId,
      body,
    );
    if (!result) throw new NotFoundException('PAGE_NOT_FOUND');
    return result;
  }

  /**
   * @description Delete a page from a featured article workspace.
   * @keyword-en featured-article, delete-page-endpoint
   * @keyword-cn 精选文章, 删除页面接口
   */
  @UseGuards(AdminAuthGuard)
  @Delete('workspaces/:workspaceId/pages/:pageId')
  async deletePage(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('pageId') pageId: string,
  ) {
    const workspace = await this.featuredArticle.deletePage(
      this.requireScope(req),
      this.parseNumericId(workspaceId, 'WORKSPACE_ID_REQUIRED'),
      pageId,
    );
    if (!workspace) throw new NotFoundException('PAGE_NOT_FOUND');
    return { workspace };
  }

  /**
   * @description Store a featured article page into an article library.
   * @keyword-en featured-article, store-to-library-endpoint
   * @keyword-cn 精选文章, 存入文章库接口
   */
  @UseGuards(AdminAuthGuard)
  @Post('workspaces/:workspaceId/pages/:pageId/store-to-library')
  async storePageToLibrary(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('pageId') pageId: string,
    @Body() body: { libraryId?: number | string },
  ) {
    const libraryId = this.parseNumericId(
      String(body?.libraryId ?? ''),
      'LIBRARY_ID_REQUIRED',
    );
    const result = await this.featuredArticle.storePageToLibrary({
      scope: this.requireScope(req),
      workspaceId: this.parseNumericId(workspaceId, 'WORKSPACE_ID_REQUIRED'),
      pageId,
      libraryId,
    });
    if (!result) throw new NotFoundException('PAGE_NOT_FOUND');
    return result;
  }
}
