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
    if (todo.id !== todoId) throw new UnauthorizedException('TASK_TOKEN_MISMATCH');
    const bound = (todo.associatedResources ?? []).some(
      (r) =>
        r.type === RESOURCE_TYPE && Number(r.resourceId) === Number(libraryId),
    );
    if (!bound) throw new UnauthorizedException('LIBRARY_NOT_BOUND_TO_TASK');
    return todo;
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
   * @description 获取推送链接（接口 #5 占位：未接二维码前先返回配置中的 pushUrl）
   * @keyword-en article library task api push url placeholder qrcode
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
    return {
      pushUrl: lib.pushConfig.pushUrl ?? null,
      statusFilter: lib.pushConfig.statusFilter,
    };
  }

  /**
   * @description 队列领取下一篇（接口 #4）
   * @keyword-en article library task api lease next fifo
   */
  @Post(':todoId/article-library/:libraryId/lease-next')
  async leaseNext(
    @Param('todoId') todoId: string,
    @Param('libraryId') libraryId: string,
    @Body() body: { statusFilter?: ArticlePublishStatus[] } | undefined,
    @Req() req: Request,
  ) {
    const todo = await this.resolveTodoForLibrary(
      req,
      Number(todoId),
      Number(libraryId),
    );
    const lib = await this.library.get(Number(libraryId), todo.tenantId);
    if (!lib) throw new NotFoundException('LIBRARY_NOT_FOUND');
    const statusFilter =
      Array.isArray(body?.statusFilter) && body!.statusFilter.length > 0
        ? body!.statusFilter.filter((s): s is ArticlePublishStatus =>
            VALID_PUBLISH_STATUSES.has(s),
          )
        : lib.pushConfig.statusFilter;
    const result = await this.article.leaseNext({
      libraryId: Number(libraryId),
      tenantId: todo.tenantId,
      statusFilter,
    });
    this.logger.log(
      `[leaseNext] todoId=${todoId} libraryId=${libraryId} leased=${result ? result.article.id : 'none'}`,
    );
    if (!result) return { article: null };
    return result;
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
        leaseToken:
          typeof body?.leaseToken === 'string' && body.leaseToken.trim().length > 0
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
    if (updated.libraryId !== Number(libraryId)) {
      throw new BadRequestException('ARTICLE_NOT_IN_LIBRARY');
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
    await this.resolveTodoForLibrary(
      req,
      Number(todoId),
      Number(libraryId),
    );
    const leaseToken = String(body?.leaseToken ?? '').trim();
    if (!leaseToken) throw new BadRequestException('LEASE_TOKEN_REQUIRED');
    const ok = await this.article.releaseLease(Number(articleId), leaseToken);
    return { ok };
  }
}
