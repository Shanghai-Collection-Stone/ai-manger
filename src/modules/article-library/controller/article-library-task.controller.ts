import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TodoService } from '../../todo/services/todo.service.js';
import { ArticleLibraryService } from '../services/article-library.service.js';
import { ArticleService } from '../services/article.service.js';
import type { TodoEntity } from '../../todo/entities/todo.entity.js';
import type { ArticlePublishStatus } from '../entities/article-library.entity.js';

/**
 * @description 合法发布状态集合（运行时校验）
 * @keyword-en valid publish status set task api
 */
const VALID_PUBLISH_STATUSES = new Set<ArticlePublishStatus>([
  'unpublished',
  'published',
]);

/** 关联资源类型标识 */
const RESOURCE_TYPE = 'article-library';

/**
 * @title 文章库 task-token 专项接口 Article Library Task API
 * @description 供推送机器人 / 自动任务通过 taskToken 鉴权后读取与消费文章库。
 * 鉴权流程对齐 TodoTaskController：Bearer token → 取 todo → 校验 associatedResources 含本库。
 * @keyword-en article library task api controller token auth
 */
@Controller('task-api')
export class ArticleLibraryTaskController {
  private readonly logger = new Logger(ArticleLibraryTaskController.name);

  constructor(
    private readonly todo: TodoService,
    private readonly library: ArticleLibraryService,
    private readonly article: ArticleService,
  ) {}

  /**
   * @description 解析 taskToken → todo → 校验 todo 关联了本 libraryId
   * @keyword-en resolve todo by task token and verify library binding
   */
  private async resolveTodoForLibrary(
    req: Request,
    todoId: number,
    libraryId: number,
  ): Promise<TodoEntity> {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('TASK_TOKEN_REQUIRED');
    }
    const token = auth.slice(7).trim();
    if (!token) throw new UnauthorizedException('TASK_TOKEN_REQUIRED');
    const todo = await this.todo.getByTaskToken(token);
    if (!todo) throw new UnauthorizedException('INVALID_TASK_TOKEN');
    if (todo.id !== todoId)
      throw new UnauthorizedException('TASK_TOKEN_MISMATCH');
    const bound = (todo.associatedResources ?? []).some(
      (r) =>
        r.type === RESOURCE_TYPE && Number(r.resourceId) === Number(libraryId),
    );
    if (!bound) throw new UnauthorizedException('LIBRARY_NOT_BOUND_TO_TASK');
    return todo;
  }

  /**
   * @description 通过二维码携带的文章库 token 校验文章库
   * @keyword-en resolve article library by qr token
   */
  private async resolveLibraryByQrToken(token: string, libraryId: number) {
    const trimmed = String(token ?? '').trim();
    if (!trimmed)
      throw new UnauthorizedException('ARTICLE_LIBRARY_TOKEN_REQUIRED');
    const lib = await this.library.getByQrToken(libraryId, trimmed);
    if (!lib) throw new UnauthorizedException('INVALID_ARTICLE_LIBRARY_TOKEN');
    return lib;
  }

  /**
   * @description 获取文章库信息（含统计）
   * @keyword-en article library task api get detail
   */
  @Get(':todoId/article-library/:libraryId')
  async getLibrary(
    @Param('todoId') todoId: string,
    @Param('libraryId') libraryId: string,
    @Req() req: Request,
  ) {
    const todo = await this.resolveTodoForLibrary(
      req,
      Number(todoId),
      Number(libraryId),
    );
    const lib = await this.library.get(Number(libraryId), todo.tenantId);
    if (!lib) throw new NotFoundException('LIBRARY_NOT_FOUND');
    const stats = await this.library.getStats(lib.id);
    return { library: { ...lib, stats } };
  }

  /**
   * @description 获取推送链接与二维码内容（二维码内容为 JSON：{ token, articleLibraryId }）
   * @keyword-en article library task api push url qrcode json payload
   */
  @Get(':todoId/article-library/:libraryId/push-url')
  async getPushUrl(
    @Param('todoId') todoId: string,
    @Param('libraryId') libraryId: string,
    @Req() req: Request,
  ) {
    const todo = await this.resolveTodoForLibrary(
      req,
      Number(todoId),
      Number(libraryId),
    );
    const lib = await this.library.get(Number(libraryId), todo.tenantId);
    if (!lib) throw new NotFoundException('LIBRARY_NOT_FOUND');
    const token = await this.library.ensureQrToken(lib.id, todo.tenantId);
    const qrPayload = {
      token,
      articleLibraryId: lib.id,
    };
    return {
      pushUrl: lib.pushConfig.pushUrl ?? null,
      qrPayload,
      qrContent: JSON.stringify(qrPayload),
      statusFilter: lib.pushConfig.statusFilter,
    };
  }

  /**
   * @description token 版获取文章库信息；用于扫码端只拿到二维码 JSON 的场景
   * @keyword-en article library token api get detail
   */
  @Post('article-library/detail')
  async getLibraryByToken(
    @Body()
    body: {
      token?: string;
      articleLibraryId?: number | string;
      libraryId?: number | string;
    },
  ) {
    const rawLibraryId = body?.articleLibraryId ?? body?.libraryId;
    const libraryId = Number(rawLibraryId);
    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      throw new BadRequestException('ARTICLE_LIBRARY_ID_REQUIRED');
    }
    const lib = await this.resolveLibraryByQrToken(
      body?.token ?? '',
      libraryId,
    );
    const stats = await this.library.getStats(lib.id);
    return { library: { ...lib, stats } };
  }

  /**
   * @description 队列领取下一篇（接口 #4）
   * @keyword-en article library task api lease next fifo
   */
  @Post(':todoId/article-library/:libraryId/lease-next')
  async leaseNext(
    @Param('todoId') todoId: string,
    @Param('libraryId') libraryId: string,
    @Req() req: Request,
  ) {
    const todo = await this.resolveTodoForLibrary(
      req,
      Number(todoId),
      Number(libraryId),
    );
    const lib = await this.library.get(Number(libraryId), todo.tenantId);
    if (!lib) throw new NotFoundException('LIBRARY_NOT_FOUND');
    const result = await this.article.leaseNext({
      libraryId: Number(libraryId),
      tenantId: todo.tenantId,
    });
    this.logger.log(
      `[leaseNext] todoId=${todoId} libraryId=${libraryId} leased=${result ? result.article.id : 'none'}`,
    );
    if (!result) return { article: null };
    return result;
  }

  /**
   * @description token 版队列领取下一篇；请求体可直接传二维码 JSON：{ token, articleLibraryId }
   * @keyword-en article library token api lease next from qrcode payload
   */
  @Post('article-library/lease-next')
  async leaseNextByToken(
    @Body()
    body:
      | {
          token?: string;
          articleLibraryId?: number | string;
          libraryId?: number | string;
        }
      | undefined,
  ) {
    const rawLibraryId = body?.articleLibraryId ?? body?.libraryId;
    const libraryId = Number(rawLibraryId);
    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      throw new BadRequestException('ARTICLE_LIBRARY_ID_REQUIRED');
    }
    const lib = await this.resolveLibraryByQrToken(
      body?.token ?? '',
      libraryId,
    );
    const result = await this.article.leaseNext({
      libraryId,
      tenantId: lib.tenantId,
    });
    this.logger.log(
      `[leaseNextByToken] libraryId=${libraryId} leased=${result ? result.article.id : 'none'}`,
    );
    if (!result) return { article: null };
    return result;
  }

  /**
   * @description token 版更新文章状态；扫码端发布完成后可直接按文章库 token 回写，不依赖 todo/taskToken。
   * @keyword-en article library token api update status from qrcode payload
   */
  @Patch('article-library/articles/:articleId/status')
  async updateStatusByToken(
    @Param('articleId') articleId: string,
    @Body()
    body:
      | {
          token?: string;
          articleLibraryId?: number | string;
          libraryId?: number | string;
          status?: string;
          leaseToken?: string;
        }
      | undefined,
  ) {
    const rawLibraryId = body?.articleLibraryId ?? body?.libraryId;
    const libraryId = Number(rawLibraryId);
    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      throw new BadRequestException('ARTICLE_LIBRARY_ID_REQUIRED');
    }
    const articleIdNum = Number(articleId);
    if (!Number.isFinite(articleIdNum) || articleIdNum <= 0) {
      throw new BadRequestException('ARTICLE_ID_REQUIRED');
    }
    const lib = await this.resolveLibraryByQrToken(
      body?.token ?? '',
      libraryId,
    );
    const status = body?.status as ArticlePublishStatus | undefined;
    if (!status || !VALID_PUBLISH_STATUSES.has(status)) {
      throw new BadRequestException('INVALID_STATUS');
    }
    const updated = await this.article.updatePublishStatus(
      articleIdNum,
      status,
      {
        tenantId: lib.tenantId,
        libraryId: lib.id,
        leaseToken:
          typeof body?.leaseToken === 'string' &&
          body.leaseToken.trim().length > 0
            ? body.leaseToken.trim()
            : undefined,
      },
    );
    if (!updated) {
      this.logger.warn(
        `[updateStatusByToken] not found or lease mismatch articleId=${articleId} libraryId=${libraryId}`,
      );
      return { ok: false, article: null };
    }
    return { ok: true, article: updated };
  }

  /**
   * @description token 版主动释放租约；扫码端放弃本次领取时可立即放回队列，不必等待 15 分钟过期。
   * @keyword-en article library token api release lease
   */
  @Post('article-library/articles/:articleId/release')
  async releaseLeaseByToken(
    @Param('articleId') articleId: string,
    @Body()
    body:
      | {
          token?: string;
          articleLibraryId?: number | string;
          libraryId?: number | string;
          leaseToken?: string;
        }
      | undefined,
  ) {
    const rawLibraryId = body?.articleLibraryId ?? body?.libraryId;
    const libraryId = Number(rawLibraryId);
    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      throw new BadRequestException('ARTICLE_LIBRARY_ID_REQUIRED');
    }
    const articleIdNum = Number(articleId);
    if (!Number.isFinite(articleIdNum) || articleIdNum <= 0) {
      throw new BadRequestException('ARTICLE_ID_REQUIRED');
    }
    const leaseToken = String(body?.leaseToken ?? '').trim();
    if (!leaseToken) throw new BadRequestException('LEASE_TOKEN_REQUIRED');
    const lib = await this.resolveLibraryByQrToken(
      body?.token ?? '',
      libraryId,
    );
    const ok = await this.article.releaseLease(articleIdNum, leaseToken, {
      tenantId: lib.tenantId,
      libraryId: lib.id,
    });
    return { ok };
  }

  /**
   * @description 更新文章状态（接口 #3，通常由推送方在发布成功后调用；支持带 leaseToken 做乐观锁）
   * @keyword-en article library task api update status with lease token
   */
  @Patch(':todoId/article-library/:libraryId/articles/:articleId/status')
  async updateStatus(
    @Param('todoId') todoId: string,
    @Param('libraryId') libraryId: string,
    @Param('articleId') articleId: string,
    @Body() body: { status?: string; leaseToken?: string },
    @Req() req: Request,
  ) {
    const todo = await this.resolveTodoForLibrary(
      req,
      Number(todoId),
      Number(libraryId),
    );
    const status = body?.status as ArticlePublishStatus | undefined;
    if (!status || !VALID_PUBLISH_STATUSES.has(status)) {
      throw new BadRequestException('INVALID_STATUS');
    }
    const updated = await this.article.updatePublishStatus(
      Number(articleId),
      status,
      {
        tenantId: todo.tenantId,
        libraryId: Number(libraryId),
        leaseToken:
          typeof body?.leaseToken === 'string' &&
          body.leaseToken.trim().length > 0
            ? body.leaseToken.trim()
            : undefined,
      },
    );
    if (!updated) {
      this.logger.warn(
        `[updateStatus] not found or lease mismatch articleId=${articleId} libraryId=${libraryId}`,
      );
      return { ok: false, article: null };
    }
    return { ok: true, article: updated };
  }

  /**
   * @description 主动释放租约（任务失败时可调用，将文章放回池）
   * @keyword-en article library task api release lease
   */
  @Post(':todoId/article-library/:libraryId/articles/:articleId/release')
  async releaseLease(
    @Param('todoId') todoId: string,
    @Param('libraryId') libraryId: string,
    @Param('articleId') articleId: string,
    @Body() body: { leaseToken?: string },
    @Req() req: Request,
  ) {
    const todo = await this.resolveTodoForLibrary(
      req,
      Number(todoId),
      Number(libraryId),
    );
    const leaseToken = String(body?.leaseToken ?? '').trim();
    if (!leaseToken) throw new BadRequestException('LEASE_TOKEN_REQUIRED');
    const ok = await this.article.releaseLease(Number(articleId), leaseToken, {
      tenantId: todo.tenantId,
      libraryId: Number(libraryId),
    });
    return { ok };
  }
}
