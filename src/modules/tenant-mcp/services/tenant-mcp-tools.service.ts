import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Db, ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { z } from 'zod';
import { ArticleLibraryService } from '../../article-library/services/article-library.service.js';
import { ArticleService } from '../../article-library/services/article.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import type { ArticleEntity } from '../../article-library/entities/article.entity.js';
import type { ArticleLibraryEntity } from '../../article-library/entities/article-library.entity.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import type { XhsPostStatEntity } from '../../todo/entities/xhs-post-stat.entity.js';
import type { XhsCrawlTaskEntity } from '../../xhs-topic-data/entities/xhs-topic-data.entity.js';
import { XhsTopicCrawlService } from '../../xhs-topic-data/services/xhs-topic-crawl.service.js';
import { XhsTopicRepositoryService } from '../../xhs-topic/services/xhs-topic-repository.service.js';
import type { TenantMcpPrincipal } from '../entities/tenant-mcp.entity.js';
import {
  decodeMcpBase64,
  MCP_ARTICLE_CONTENT_SCHEMA,
  TENANT_MCP_TOOLS,
  type TenantMcpToolName,
} from '../tenant-mcp.tools.js';

/** @keyword-en mcp-tool-execution, tenant-isolation */
@Injectable()
export class TenantMcpToolsService {
  /** @keyword-en mcp-tool-execution, tenant-isolation */
  constructor(
    @Inject('DS_MONGO_DB') private readonly db: Db,
    private readonly libraries: ArticleLibraryService,
    private readonly articles: ArticleService,
    private readonly gallery: GalleryService,
    private readonly crawl: XhsTopicCrawlService,
    private readonly topics: XhsTopicRepositoryService,
    private readonly config: ConfigService,
  ) {}

  /** @keyword-en mcp-library-check, tenant-isolation */
  private async requireLibrary(principal: TenantMcpPrincipal, id: number) {
    const library = await this.libraries.get(id, principal.tenantId);
    if (!library || library.tenantId !== principal.tenantId)
      throw new NotFoundException('LIBRARY_NOT_FOUND');
    return library;
  }

  /** @keyword-en mcp-article-check, tenant-isolation */
  private async requireArticle(principal: TenantMcpPrincipal, id: number) {
    const article = await this.articles.get(id, principal.tenantId);
    if (!article || article.tenantId !== principal.tenantId)
      throw new NotFoundException('ARTICLE_NOT_FOUND');
    await this.requireLibrary(principal, article.libraryId);
    return article;
  }

  /** @keyword-en mcp-library-view, secret-redaction */
  private libraryView(library: ArticleLibraryEntity) {
    return {
      id: library.id,
      name: library.name,
      type: library.type,
      createdAt: library.createdAt,
      updatedAt: library.updatedAt,
    };
  }

  /** @keyword-en mcp-image-url, absolute-url */
  private absoluteUrl(value: string): string {
    if (/^https?:\/\//i.test(value)) return value;
    const base = String(this.config.get<string>('APP_URL') || '').replace(
      /\/+$/,
      '',
    );
    return `${base}/${value.replace(/^\/+/, '')}`;
  }

  /** @keyword-en mcp-article-view, secret-redaction */
  private articleView(article: ArticleEntity) {
    return {
      id: article.id,
      libraryId: article.libraryId,
      title: article.title,
      text: article.text,
      tags: article.tags,
      imageUrls: article.imageUrls?.map((url) => this.absoluteUrl(url)),
      publishStatus: article.publishStatus,
      publishedAt: article.publishedAt,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    };
  }

  /** @keyword-en mcp-image-view, secret-redaction */
  private imageView(image: {
    id: number;
    url: string;
    thumbUrl?: string;
    originalName: string;
    tags: string[];
    description?: string;
    width?: number;
    height?: number;
  }) {
    return {
      id: image.id,
      url: this.absoluteUrl(image.url),
      thumbUrl: image.thumbUrl ? this.absoluteUrl(image.thumbUrl) : undefined,
      originalName: image.originalName,
      tags: image.tags,
      description: image.description,
      width: image.width,
      height: image.height,
    };
  }

  /** @keyword-en mcp-image-upload, upload-validation */
  private async uploadImage(
    principal: TenantMcpPrincipal,
    input: z.infer<typeof TENANT_MCP_TOOLS.image_upload.schema>,
  ) {
    const buffer = decodeMcpBase64(input.base64, 10 * 1024 * 1024);
    const processor = sharp(buffer, {
      limitInputPixels: 40000000,
      animated: false,
    });
    const metadata = await processor.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format || ''))
      throw new BadRequestException('UNSUPPORTED_IMAGE_FORMAT');
    const output = await processor
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    const fileName = `mcp-${randomUUID()}.jpg`;
    const directory = join(process.cwd(), 'public', 'uploads');
    const absPath = join(directory, fileName);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(absPath, output.data, { flag: 'wx' });
    try {
      const [image] = await this.gallery.createMany([
        {
          userId: principal.username,
          tenantId: principal.tenantId,
          scope: 'tenant',
          originalName: input.originalName,
          fileName,
          absPath,
          url: `/static/uploads/${fileName}`,
          mimeType: 'image/jpeg',
          size: output.data.length,
          width: output.info.width,
          height: output.info.height,
          tags: input.tags,
          description: input.description,
        },
      ]);
      return { image: this.imageView(image) };
    } catch (error) {
      await fs.unlink(absPath).catch(() => undefined);
      throw error;
    }
  }

  /** @keyword-en mcp-article-create, article-intake */
  private async createArticle(
    principal: TenantMcpPrincipal,
    libraryId: number,
    input: z.infer<typeof MCP_ARTICLE_CONTENT_SCHEMA>,
  ) {
    await this.requireLibrary(principal, libraryId);
    const article = await this.articles.create({
      ...input,
      libraryId,
      tenantId: principal.tenantId,
      userId: principal.username,
      source: 'mcp',
      publishStatus: 'unpublished',
    });
    return { article: this.articleView(article) };
  }

  /** @keyword-en mcp-crawl-target, tenant-isolation */
  private async crawlTarget(principal: TenantMcpPrincipal, articleId: number) {
    const article = await this.requireArticle(principal, articleId);
    const topicId = Number(article.meta?.xhsTopicId);
    const noteId = String(article.meta?.NoteId || '');
    if (
      article.publishStatus !== 'published' ||
      !Number.isSafeInteger(topicId) ||
      topicId <= 0 ||
      !/^[a-f\d]{24}$/i.test(noteId)
    )
      throw new BadRequestException('ARTICLE_REQUIRES_PUBLISHED_XHS_NOTE');
    const topic = await this.topics.getChildTopicById(topicId);
    if (!topic || topic.tenantId !== principal.tenantId)
      throw new NotFoundException('XHS_TOPIC_NOT_FOUND');
    return { article, topic, noteId };
  }

  /** @keyword-en mcp-crawl-binding, published-article */
  private async prepareCrawlTarget(
    principal: TenantMcpPrincipal,
    articleId: number,
  ): Promise<void> {
    const article = await this.requireArticle(principal, articleId);
    if (article.meta?.xhsTopicId) return;
    if (
      article.publishStatus !== 'published' ||
      !/^[a-f\d]{24}$/i.test(String(article.meta?.NoteId || ''))
    )
      throw new BadRequestException('ARTICLE_REQUIRES_PUBLISHED_XHS_NOTE');
    const scope = { tenantId: principal.tenantId, userId: principal.userId };
    const topic = await this.topics.createManualLinkTopic(
      { title: article.title },
      scope,
    );
    let attached = false;
    try {
      const result = await this.db
        .collection<ArticleEntity>('articles')
        .updateOne(
          {
            id: articleId,
            tenantId: principal.tenantId,
            publishStatus: 'published',
            'meta.xhsTopicId': { $exists: false },
          },
          {
            $set: {
              source: 'xhs-topic',
              'meta.xhsTopicId': topic.id,
              updatedAt: new Date(),
            },
          },
        );
      attached = result.modifiedCount === 1;
    } finally {
      // 并发首次抓取仅保留成功绑定的选题，其余回收，避免出现冗余监控记录。
      if (!attached) await this.topics.deleteMany([topic.id], scope);
    }
  }

  /** @keyword-en mcp-recent-data, crawl-result */
  private async recentData(
    principal: TenantMcpPrincipal,
    input: z.infer<typeof TENANT_MCP_TOOLS.article_recent_data.schema>,
  ) {
    const { topic, noteId } = await this.crawlTarget(
      principal,
      input.articleId,
    );
    let task: XhsCrawlTaskEntity | null = null;
    if (input.taskId) {
      await this.crawl.syncTaskStatuses(topic.id);
      task = await this.db
        .collection<XhsCrawlTaskEntity>('xhs_topic_crawl_tasks')
        .findOne({
          id: input.taskId,
          topicId: topic.id,
          tenantId: principal.tenantId,
        });
      if (!task) throw new NotFoundException('MCP_CRAWL_TASK_NOT_FOUND');
    }
    const filter = {
      topicId: topic.id,
      postUrl: { $regex: noteId, $options: 'i' },
      dataAt: { $gte: new Date(Date.now() - input.days * 86400000) },
      ...(input.taskId ? { crawlRunId: input.taskId } : {}),
    };
    const stats = this.db.collection<XhsPostStatEntity>('xhs_post_stats');
    const [items, total] = await Promise.all([
      stats
        .find(filter, { projection: { _id: 0, postHash: 0 } })
        .sort({ dataAt: -1, id: -1 })
        .skip(input.offset)
        .limit(input.limit)
        .toArray(),
      stats.countDocuments(filter),
    ]);
    return {
      articleId: input.articleId,
      items,
      total,
      limit: input.limit,
      offset: input.offset,
      ...(task
        ? {
            task: {
              id: task.id,
              status: task.status,
              channel: task.channel,
              collectedCount: task.collectedCount,
              error: task.error,
              startedAt: task.startedAt,
              finishedAt: task.finishedAt,
            },
          }
        : {}),
    };
  }

  /** @keyword-en mcp-tool-execution, tool-permission */
  async execute(
    principal: TenantMcpPrincipal,
    name: string,
    raw: unknown,
  ): Promise<unknown> {
    if (
      !Object.hasOwn(TENANT_MCP_TOOLS, name) ||
      !principal.permissions.includes(name)
    )
      throw new ForbiddenException('MCP_TOOL_NOT_ALLOWED');
    const toolName = name as TenantMcpToolName;
    // 每个分支以自己的严格 schema 解析，不能通过附带 tenantId/userId 覆盖调用身份。
    switch (toolName) {
      case 'gallery_search': {
        const input = TENANT_MCP_TOOLS.gallery_search.schema.parse(raw);
        if (input.query) {
          if (input.tags?.length)
            throw new BadRequestException('MCP_USE_QUERY_OR_TAGS');
          const rows = await this.gallery.searchSimilar(
            input.query,
            principal.username,
            principal.tenantId,
            input.limit,
          );
          return {
            items: rows.map((row) => ({
              ...this.imageView(row.image),
              score: row.score,
            })),
          };
        }
        const rows = await this.gallery.findAccessibleImages(
          principal.username,
          principal.tenantId,
          input,
        );
        return { items: rows.map((row) => this.imageView(row)) };
      }
      case 'image_upload':
        return this.uploadImage(
          principal,
          TENANT_MCP_TOOLS.image_upload.schema.parse(raw),
        );
      case 'library_list': {
        const input = TENANT_MCP_TOOLS.library_list.schema.parse(raw);
        const result = await this.libraries.list({
          ...input,
          tenantId: principal.tenantId,
        });
        return {
          ...result,
          items: result.items.map((item) => this.libraryView(item)),
        };
      }
      case 'library_get': {
        const { libraryId } = TENANT_MCP_TOOLS.library_get.schema.parse(raw);
        const library = await this.requireLibrary(principal, libraryId);
        return {
          library: this.libraryView(library),
          stats: await this.libraries.getStats(libraryId),
        };
      }
      case 'library_create': {
        const input = TENANT_MCP_TOOLS.library_create.schema.parse(raw);
        const user = await this.db
          .collection<AdminUserEntity>('admin_users')
          .findOne({ _id: new ObjectId(principal.userId), enabled: true });
        if (!user) throw new ForbiddenException('MCP_OWNER_UNAVAILABLE');
        const library = await this.libraries.createWithWorkspace(user, {
          ...input,
          tenantId: principal.tenantId,
        });
        return { library: this.libraryView(library) };
      }
      case 'library_update': {
        const { libraryId, ...input } =
          TENANT_MCP_TOOLS.library_update.schema.parse(raw);
        await this.requireLibrary(principal, libraryId);
        const library = await this.libraries.update({
          ...input,
          id: libraryId,
          tenantId: principal.tenantId,
        });
        if (!library) throw new NotFoundException('LIBRARY_NOT_FOUND');
        return { library: this.libraryView(library) };
      }
      case 'article_publish': {
        const { libraryId, ...input } =
          TENANT_MCP_TOOLS.article_publish.schema.parse(raw);
        return this.createArticle(principal, libraryId, input);
      }
      case 'article_upload': {
        const input = TENANT_MCP_TOOLS.article_upload.schema.parse(raw);
        const buffer = decodeMcpBase64(input.base64, 1024 * 1024);
        let content: unknown;
        try {
          content = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(buffer),
          );
        } catch {
          throw new BadRequestException('INVALID_ARTICLE_JSON');
        }
        return this.createArticle(
          principal,
          input.libraryId,
          MCP_ARTICLE_CONTENT_SCHEMA.parse(content),
        );
      }
      case 'article_get': {
        const { articleId } = TENANT_MCP_TOOLS.article_get.schema.parse(raw);
        return {
          article: this.articleView(
            await this.requireArticle(principal, articleId),
          ),
        };
      }
      case 'article_update': {
        const { articleId, ...input } =
          TENANT_MCP_TOOLS.article_update.schema.parse(raw);
        await this.requireArticle(principal, articleId);
        const article = await this.articles.update({
          ...input,
          id: articleId,
          tenantId: principal.tenantId,
        });
        if (!article) throw new NotFoundException('ARTICLE_NOT_FOUND');
        return { article: this.articleView(article) };
      }
      case 'article_list':
      case 'article_list_published':
      case 'article_list_unpublished': {
        const input = TENANT_MCP_TOOLS[toolName].schema.parse(raw);
        await this.requireLibrary(principal, input.libraryId);
        const status =
          toolName === 'article_list_published'
            ? 'published'
            : toolName === 'article_list_unpublished'
              ? 'unpublished'
              : TENANT_MCP_TOOLS.article_list.schema.parse(raw).status;
        const result = await this.articles.list({
          ...input,
          status,
          tenantId: principal.tenantId,
        });
        return {
          ...result,
          items: result.items.map((article) => this.articleView(article)),
        };
      }
      case 'library_publish_qr': {
        const { libraryId } =
          TENANT_MCP_TOOLS.library_publish_qr.schema.parse(raw);
        await this.requireLibrary(principal, libraryId);
        const token = await this.libraries.ensureQrToken(
          libraryId,
          principal.tenantId,
        );
        return this.libraries.buildPushQrContent({
          token,
          articleLibraryId: libraryId,
        });
      }
      case 'article_recent_data':
        return this.recentData(
          principal,
          TENANT_MCP_TOOLS.article_recent_data.schema.parse(raw),
        );
      case 'article_crawl': {
        const { articleId } = TENANT_MCP_TOOLS.article_crawl.schema.parse(raw);
        await this.prepareCrawlTarget(principal, articleId);
        const { topic, article } = await this.crawlTarget(principal, articleId);
        if (!(await this.crawl.getScheduleStatus(topic.id)))
          await this.crawl.syncArticlePublishSchedule({
            topicId: topic.id,
            articleId,
            libraryId: article.libraryId,
            status: 'published',
          });
        const task = await this.crawl.createCrawlTask(topic, 'manual');
        if (!task) throw new BadRequestException('MCP_CRAWL_UNAVAILABLE');
        const result = await this.recentData(principal, {
          articleId,
          taskId: task.id,
          days: 7,
          limit: 100,
          offset: 0,
        });
        return {
          ...result,
          taskId: task.id,
          completed: ['done', 'failed', 'cancelled'].includes(task.status),
          pollTool: 'article_recent_data',
        };
      }
    }
  }
}
