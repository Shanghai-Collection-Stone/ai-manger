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
} from '@nestjs/common';
import type { Request } from 'express';
import { ArticleLibraryService } from '../services/article-library.service.js';
import { ArticleService } from '../services/article.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import type {
  ArticleLibraryPushConfig,
  ArticlePublishStatus,
} from '../entities/article-library.entity.js';
import type { ArticleCreateInput } from '../entities/article.entity.js';

/**
 * @description 合法发布状态集合（运行时校验）
 * @keyword-en valid publish status set
 */
const VALID_PUBLISH_STATUSES = new Set<ArticlePublishStatus>([
  'unpublished',
  'published',
]);

/**
 * @title 文章库管理控制器 Article Library Admin Controller
 * @description 前端用户态（Bearer token 鉴权）的文章库 CRUD + 文章入库 / 状态更新 / 队列领取。
 * @keyword-en article library admin controller crud status lease
 */
@Controller('api/article-library')
export class ArticleLibraryController {
  constructor(
    private readonly library: ArticleLibraryService,
    private readonly article: ArticleService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @description 解析请求鉴权范围（Bearer token → {tenantId, userId}）
   * @keyword-en resolve auth scope from request bearer
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
    if (!token) throw new UnauthorizedException('AUTH_REQUIRED');
    const user = await this.adminService.getUserByToken(token);
    if (!user) throw new UnauthorizedException('AUTH_REQUIRED');
    return { tenantId: user.tenantId, userId: user.username };
  }

  // ───── 文章库 CRUD ─────────────────────────────────────────────────────────

  /**
   * @description 创建文章库
   * @keyword-en article library create endpoint
   */
  @Post()
  async createLibrary(
    @Body()
    body: {
      name?: string;
      type?: string;
      pushConfig?: Partial<ArticleLibraryPushConfig>;
    },
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    if (!scope.userId) throw new UnauthorizedException('USER_REQUIRED');
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('NAME_REQUIRED');
    const type = String(body?.type ?? '').trim();
    const lib = await this.library.create({
      userId: scope.userId,
      tenantId: scope.tenantId,
      name,
      type,
      pushConfig: body?.pushConfig,
    });
    return { library: lib };
  }

  /**
   * @description 列出文章库（返回统计与缩略图）
   * @keyword-en article library list endpoint with stats and thumbnails
   */
  @Get()
  async listLibraries(
    @Query('type') type: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const { items, total } = await this.library.list({
      tenantId: scope.tenantId,
      type,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    const enriched = await Promise.all(
      items.map(async (lib) => {
        const [stats, thumbnails] = await Promise.all([
          this.library.getStats(lib.id),
          this.library.getThumbnailImages(lib.id, 4),
        ]);
        return { ...lib, stats, thumbnails };
      }),
    );
    return { items: enriched, total };
  }

  /**
   * @description 获取单个文章库（含统计与缩略图）
   * @keyword-en article library detail endpoint
   */
  @Get(':libraryId')
  async getLibrary(
    @Param('libraryId') libraryId: string,
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const id = Number(libraryId);
    const lib = await this.library.get(id, scope.tenantId);
    if (!lib) throw new NotFoundException('LIBRARY_NOT_FOUND');
    const [stats, thumbnails] = await Promise.all([
      this.library.getStats(id),
      this.library.getThumbnailImages(id, 4),
    ]);
    return { library: { ...lib, stats, thumbnails } };
  }

  /**
   * @description 获取文章库二维码内容（JSON：{ token, articleLibraryId }）
   * @keyword-en article library admin get push qr payload
   */
  @Get(':libraryId/push-qr')
  async getPushQr(
    @Param('libraryId') libraryId: string,
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const id = Number(libraryId);
    const lib = await this.library.get(id, scope.tenantId);
    if (!lib) throw new NotFoundException('LIBRARY_NOT_FOUND');
    const token = await this.library.ensureQrToken(id, scope.tenantId);
    const qrPayload = { token, articleLibraryId: id };
    return {
      pushUrl: lib.pushConfig.pushUrl ?? null,
      statusFilter: lib.pushConfig.statusFilter,
      qrPayload,
      qrContent: JSON.stringify(qrPayload),
    };
  }

  /**
   * @description 更新文章库基础信息 / 推送配置
   * @keyword-en article library update endpoint
   */
  @Patch(':libraryId')
  async updateLibrary(
    @Param('libraryId') libraryId: string,
    @Body()
    body: {
      name?: string;
      type?: string;
      pushConfig?: Partial<ArticleLibraryPushConfig>;
    },
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const updated = await this.library.update({
      id: Number(libraryId),
      tenantId: scope.tenantId,
      name: body?.name,
      type: body?.type,
      pushConfig: body?.pushConfig,
    });
    if (!updated) throw new NotFoundException('LIBRARY_NOT_FOUND');
    return { library: updated };
  }

  /**
   * @description 删除文章库（级联删除所属文章）
   * @keyword-en article library delete endpoint
   */
  @Delete(':libraryId')
  async deleteLibrary(
    @Param('libraryId') libraryId: string,
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const ok = await this.library.delete(Number(libraryId), scope.tenantId);
    return { ok };
  }

  // ───── 文章 ────────────────────────────────────────────────────────────────

  /**
   * @description 文章入库（接口 #2）：接收一篇或一批文章内容直接落库
   * @keyword-en article put into library single or bulk
   */
  @Post(':libraryId/articles')
  async createArticle(
    @Param('libraryId') libraryId: string,
    @Body()
    body: {
      articles?: Array<Omit<ArticleCreateInput, 'libraryId' | 'userId' | 'tenantId'>>;
      article?: Omit<ArticleCreateInput, 'libraryId' | 'userId' | 'tenantId'>;
    },
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    if (!scope.userId) throw new UnauthorizedException('USER_REQUIRED');
    const libId = Number(libraryId);
    const lib = await this.library.get(libId, scope.tenantId);
    if (!lib) throw new NotFoundException('LIBRARY_NOT_FOUND');

    const batch = Array.isArray(body?.articles)
      ? body.articles
      : body?.article
        ? [body.article]
        : [];
    if (batch.length === 0) throw new BadRequestException('ARTICLE_REQUIRED');
    const missing = batch.findIndex(
      (a) => !a || typeof a.title !== 'string' || a.title.trim().length === 0,
    );
    if (missing >= 0)
      throw new BadRequestException(`ARTICLE_TITLE_MISSING_AT_${missing}`);

    const created = await this.article.bulkCreate(
      batch.map((a) => ({
        ...a,
        libraryId: libId,
        userId: scope.userId!,
        tenantId: scope.tenantId,
      })),
    );
    return { items: created, count: created.length };
  }

  /**
   * @description 列出文章（按状态过滤，FIFO 顺序）
   * @keyword-en article list endpoint by library
   */
  @Get(':libraryId/articles')
  async listArticles(
    @Param('libraryId') libraryId: string,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const normalizedStatus: ArticlePublishStatus | 'all' | undefined =
      status === 'all' || status === undefined
        ? 'all'
        : VALID_PUBLISH_STATUSES.has(status as ArticlePublishStatus)
          ? (status as ArticlePublishStatus)
          : 'all';
    const { items, total } = await this.article.list({
      libraryId: Number(libraryId),
      tenantId: scope.tenantId,
      status: normalizedStatus,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { items, total };
  }

  /**
   * @description 更新文章状态（接口 #3）
   * @keyword-en article update publish status endpoint
   */
  @Patch(':libraryId/articles/:articleId/status')
  async updateArticleStatus(
    @Param('libraryId') libraryId: string,
    @Param('articleId') articleId: string,
    @Body() body: { status?: string },
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const status = body?.status as ArticlePublishStatus | undefined;
    if (!status || !VALID_PUBLISH_STATUSES.has(status)) {
      throw new BadRequestException('INVALID_STATUS');
    }
    const updated = await this.article.updatePublishStatus(
      Number(articleId),
      status,
      { tenantId: scope.tenantId, libraryId: Number(libraryId) },
    );
    if (!updated) throw new NotFoundException('ARTICLE_NOT_FOUND');
    return { article: updated };
  }

  /**
   * @description 删除文章
   * @keyword-en article delete endpoint
   */
  @Delete(':libraryId/articles/:articleId')
  async deleteArticle(
    @Param('libraryId') libraryId: string,
    @Param('articleId') articleId: string,
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const ok = await this.article.delete(Number(articleId), scope.tenantId);
    void libraryId;
    return { ok };
  }

  /**
   * @description 队列领取下一篇文章（接口 #4，管理端测试用；生产主要走 task-api）
   * @keyword-en article lease next endpoint admin
   */
  @Post(':libraryId/articles/lease-next')
  async leaseNext(
    @Param('libraryId') libraryId: string,
    @Req() req: Request,
  ) {
    const scope = await this.resolveAuthScope(req);
    const lib = await this.library.get(Number(libraryId), scope.tenantId);
    if (!lib) throw new NotFoundException('LIBRARY_NOT_FOUND');
    const result = await this.article.leaseNext({
      libraryId: Number(libraryId),
      tenantId: scope.tenantId,
    });
    if (!result) return { article: null };
    return result;
  }
}
