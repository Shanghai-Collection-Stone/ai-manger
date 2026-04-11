import { Injectable, Logger } from '@nestjs/common';
import { CreateAgentParams } from 'langchain';
import { tool } from 'langchain';
import * as z from 'zod';
import { CanvasService } from '../../canvas/services/canvas.service.js';
import type {
  CanvasArticleEntity,
  CanvasImageGroup,
} from '../../canvas/entities/canvas.entity.js';

/**
 * @title XHS Tools Service
 * @description 提供小红书/Canvas 操作相关的 LangChain 工具，包含 Canvas 列表、详情及图片组创建
 * @keywords-cn xhs tools, canvas, langchain
 * @keywords-en xhs tools, canvas, langchain
 */
@Injectable()
export class XhsToolsService {
  private readonly logger = new Logger(XhsToolsService.name);
  private readonly IMAGE_GROUP_MIN_IMAGES_PER_ARTICLE = 6;
  private readonly IMAGE_GROUP_MAX_IMAGES_PER_ARTICLE = 8;
  private readonly MAX_GROUP_COUNT = 20;

  constructor(private readonly canvasService: CanvasService) {}

  /**
  * @description 将输入文章数量对齐到 groupCount 或 articles 数量，不强制 6-8。
   * @param {object} input - 输入参数。
   * @returns {Array<{ title: string; tags: string[] }>} 归一化后的文章列表。
   * @keyword-en normalize image-group articles
   */
  private normalizeImageGroupArticles(input: {
    topic?: string;
    groupCount?: number;
    articles?: Array<{ title: string; tags?: string[] }>;
  }): Array<{ title: string; tags: string[] }> {
    const normalizedGroupCount =
      typeof input.groupCount === 'number' && Number.isFinite(input.groupCount)
        ? Math.max(1, Math.min(this.MAX_GROUP_COUNT, Math.trunc(input.groupCount)))
        : undefined;
    const safeInputArticles = Array.isArray(input.articles)
      ? input.articles.slice(0, this.MAX_GROUP_COUNT)
      : [];
    const targetCount = Math.max(
      normalizedGroupCount ?? 0,
      safeInputArticles.length,
      1,
    );
    const articles = safeInputArticles.map((a) => ({
      title: String(a?.title ?? '').trim(),
      tags: Array.isArray(a?.tags)
        ? a.tags.map((t) => String(t ?? '').trim()).filter((t) => t.length > 0)
        : [],
    }));
    if (targetCount > articles.length) {
      const topic = input.topic ?? '图组';
      for (let i = articles.length + 1; i <= targetCount; i++) {
        articles.push({ title: `${topic}第${i}组`, tags: [] });
      }
    }
    return articles.map((a, idx) => ({
      title: a.title || `${input.topic ?? '图组'}第${idx + 1}组`,
      tags: a.tags,
    }));
  }

  /**
   * @description 将 imageGroups 的图片结果回写到同一 Canvas 的文章字段。
   * @param {object} input - 回写参数。
  * @returns {Promise<{ doneCount: number; missingCount: number; countMismatch: number }>} 回写统计。
   * @keyword-en merge image groups into canvas articles
   */
  private async mergeImageGroupsToArticles(input: {
    canvasId: number;
    tenantId?: string;
    articles: CanvasArticleEntity[];
    imageGroups: CanvasImageGroup[];
  }): Promise<{ doneCount: number; missingCount: number; countMismatch: number }> {
    const orderedArticles = [...(input.articles ?? [])].sort(
      (a, b) => Number(a.id) - Number(b.id),
    );
    this.logger.log(
      `[xhs-image-group-merge] start canvasId=${input.canvasId} articleCount=${orderedArticles.length} perArticleTarget=${this.IMAGE_GROUP_MIN_IMAGES_PER_ARTICLE}-${this.IMAGE_GROUP_MAX_IMAGES_PER_ARTICLE}`,
    );
    let doneCount = 0;
    let missingCount = 0;
    let countMismatch = 0;
    await Promise.all(
      orderedArticles.map(async (article, idx) => {
        const group = input.imageGroups[idx];
        const imageUrls = Array.isArray(group?.images)
          ? group.images
              .map((img) =>
                typeof img?.url === 'string' ? img.url.trim() : '',
              )
              .filter((u) => u.length > 0)
          : [];
        const imageIds = Array.isArray(group?.images)
          ? group.images
              .map((img) => Number(img?.imageId))
              .filter((n) => Number.isFinite(n) && n > 0)
          : [];
        const isImageCountValid =
          imageUrls.length >= this.IMAGE_GROUP_MIN_IMAGES_PER_ARTICLE &&
          imageUrls.length <= this.IMAGE_GROUP_MAX_IMAGES_PER_ARTICLE;
        const status =
          group?.status === 'done' && isImageCountValid
            ? 'done'
            : 'requires_human';
        if (status === 'done') doneCount++;
        else missingCount++;
        if (!isImageCountValid) countMismatch++;
        this.logger.log(
          `[xhs-image-group-merge] article canvasId=${input.canvasId} articleId=${article.id} groupStatus=${String(group?.status ?? 'missing')} imageCount=${imageUrls.length} status=${status}`,
        );
        await this.canvasService.updateArticleImages(
          input.canvasId,
          article.id,
          {
            imageIds: imageIds.length > 0 ? imageIds : undefined,
            imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
            status,
            doneNote:
              status === 'done'
                ? 'AUTO_CANVAS_IMAGE_GROUP_IMAGES'
                : isImageCountValid
                  ? 'AUTO_CANVAS_IMAGE_GROUP_MISSING'
                  : 'AUTO_CANVAS_IMAGE_GROUP_COUNT_MISMATCH',
          },
          input.tenantId,
        );
      }),
    );
    this.logger.log(
      `[xhs-image-group-merge] done canvasId=${input.canvasId} done=${doneCount} requires_human=${missingCount} countMismatch=${countMismatch}`,
    );
    return { doneCount, missingCount, countMismatch };
  }

  /**
   * @description 获取 XHS 工具句柄
   * @param {{ tenantId?: string; userId?: string }} scope - 租户和用户范围
   * @returns {CreateAgentParams['tools']} LangChain 工具列表
   * @keyword-en get XHS tools handle
   * @since 2026-03-23
   */
  getHandle(
    scope?: { tenantId?: string; userId?: string },
  ): CreateAgentParams['tools'] {
    return [
      this.createListCanvasesTool(scope),
      this.createGetCanvasDetailTool(scope),
      this.createImageGroupCanvasTool(scope),
    ];
  }

  /**
   * @description 列出 Canvas 列表工具
   * @keyword-en list canvases tool
   */
  private createListCanvasesTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: { limit?: number }) => {
        const { limit = 50 } = input;
        const canvases = await this.canvasService.list(
          scope?.userId,
          scope?.tenantId,
          limit,
        );
        return JSON.stringify({
          canvases: canvases.map((c) => ({
            id: c.id,
            topic: c.topic,
            status: c.status,
            type: c.type ?? 'article',
            articleCount: Array.isArray(c.articles) ? c.articles.length : 0,
            imageGroupCount: Array.isArray(c.imageGroups) ? c.imageGroups.length : 0,
            createdAt: c.createdAt,
          })),
          total: canvases.length,
        });
      },
      {
        name: 'xhs_list_canvases',
        description: 'List all available Canvas collections for content management',
        schema: z.object({
          limit: z.number().optional().describe('Max results, default 50'),
        }),
      },
    );
  }

  /**
   * @description 获取 Canvas 详情工具
   * @keyword-en get canvas detail tool
   */
  private createGetCanvasDetailTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: { canvas_id: number }) => {
        const { canvas_id } = input;
        const canvas = await this.canvasService.get(canvas_id, scope?.tenantId);
        if (!canvas) {
          return JSON.stringify({ error: 'Canvas not found', canvas_id });
        }
        return JSON.stringify({
          id: canvas.id,
          topic: canvas.topic,
          status: canvas.status,
          type: canvas.type ?? 'article',
          articles: (canvas.articles ?? []).map((a) => ({
            id: a.id,
            title: a.title,
            tags: a.tags,
            status: a.status,
            imageUrls: a.imageUrls,
          })),
          imageGroups: Array.isArray(canvas.imageGroups)
            ? canvas.imageGroups.map((g) => ({
                id: g.id,
                layout: g.layout,
                status: g.status,
                imageCount: Array.isArray(g.images) ? g.images.length : 0,
              }))
            : [],
          createdAt: canvas.createdAt,
        });
      },
      {
        name: 'xhs_get_canvas_detail',
        description: 'Get detailed information about a specific Canvas including its articles and image groups',
        schema: z.object({
          canvas_id: z.number().describe('Canvas ID to retrieve'),
        }),
      },
    );
  }

  /**
   * @description 创建图片组 Canvas 工具（异步生成，立即返回 generating 状态）
   * @keyword-en create image group canvas tool
   */
  private createImageGroupCanvasTool(
    scope?: { tenantId?: string; userId?: string },
  ) {
    return tool(
      async (input: {
        canvasId?: number | string;
        topic?: string;
        groupCount?: number;
        articles?: Array<{ title: string; tags?: string[] }>;
      }) => {
        if (!scope?.userId) {
          return JSON.stringify({ error: 'USER_REQUIRED: userId is required for canvas creation' });
        }
        const requestedCanvasId = Number(input.canvasId);
        const hasCanvasId = Number.isFinite(requestedCanvasId);
        this.logger.log(
          `[xhs_create_image_group_canvas] start canvasId=${hasCanvasId ? requestedCanvasId : 'new'} groupCount=${String(input.groupCount ?? '')} articleInputCount=${Array.isArray(input.articles) ? input.articles.length : 0}`,
        );
        const normalizedArticles = this.normalizeImageGroupArticles({
          topic: input.topic,
          groupCount: input.groupCount,
          articles: input.articles,
        });

        if (hasCanvasId) {
          const existing = await this.canvasService.get(
            requestedCanvasId,
            scope.tenantId,
          );
          if (!existing) {
            return JSON.stringify({
              error: 'CANVAS_NOT_FOUND',
              canvasId: requestedCanvasId,
            });
          }
          if (existing.userId !== scope.userId) {
            return JSON.stringify({
              error: 'CANVAS_SCOPE_FORBIDDEN',
              canvasId: requestedCanvasId,
            });
          }

          const sourceArticles =
            Array.isArray(input.articles) && input.articles.length > 0
              ? normalizedArticles
              : this.normalizeImageGroupArticles({
                  topic: input.topic ?? existing.topic,
                  groupCount: input.groupCount,
                  articles: (existing.articles ?? []).map((a) => ({
                    title: a.title,
                    tags: Array.isArray(a.tags) ? a.tags : [],
                  })),
                });
          const groups = await this.canvasService.generateImageGroupsForCanvas({
            canvasId: requestedCanvasId,
            userId: scope.userId,
            tenantId: scope.tenantId,
            topic: input.topic ?? existing.topic,
            articles: sourceArticles.map((a) => ({
              title: a.title,
              tags: a.tags,
            })),
          });
          const mergeSummary = await this.mergeImageGroupsToArticles({
            canvasId: requestedCanvasId,
            tenantId: scope.tenantId,
            articles: Array.isArray(existing.articles) ? existing.articles : [],
            imageGroups: groups,
          });
          const canvasBlock = `\`\`\`canvas-it\n${JSON.stringify({ canvasId: requestedCanvasId, status: existing.status ?? 'generating', type: existing.type ?? 'article', topic: input.topic ?? existing.topic ?? '', articleCount: Array.isArray(existing.articles) ? existing.articles.length : 0 })}\n\`\`\``;
          return [
            `已在同一 Canvas（ID=${requestedCanvasId}）完成图组生成并合并文章配图。`,
            `每篇文章配图目标：${this.IMAGE_GROUP_MIN_IMAGES_PER_ARTICLE}-${this.IMAGE_GROUP_MAX_IMAGES_PER_ARTICLE} 张（当前图组模板默认 6 张）。`,
            `文章配图回写：done=${mergeSummary.doneCount}，requires_human=${mergeSummary.missingCount}，countMismatch=${mergeSummary.countMismatch}。`,
            `请将以下代码块原样输出给用户（**必须输出，不能省略**）：`,
            canvasBlock,
            `JSON 详情：${JSON.stringify({ canvas: { id: requestedCanvasId, status: existing.status, type: existing.type ?? 'article', topic: input.topic ?? existing.topic, articleCount: Array.isArray(existing.articles) ? existing.articles.length : 0 }, imageGroupCount: groups.length, mergeSummary })}`,
          ].join('\n');
        }

        const articles = normalizedArticles;
        const canvas = await this.canvasService.createImageGroupCanvas({
          userId: scope.userId,
          tenantId: scope.tenantId,
          topic: input.topic,
          articles: articles.map((a) => ({ title: a.title, tags: a.tags ?? [] })),
        });
        const canvasBlock = `\`\`\`canvas-it\n${JSON.stringify({ canvasId: canvas.id, status: 'generating', type: 'image-group', topic: canvas.topic ?? '', articleCount: Array.isArray(canvas.articles) ? canvas.articles.length : 0 })}\n\`\`\``;
        return [
          `图片组 Canvas 已创建（ID=${canvas.id}），正在后台匹配并生成图片。`,
          `每篇文章配图目标：${this.IMAGE_GROUP_MIN_IMAGES_PER_ARTICLE}-${this.IMAGE_GROUP_MAX_IMAGES_PER_ARTICLE} 张（当前图组模板默认 6 张）。`,
          `请将以下代码块原样输出给用户（**必须输出，不能省略**）：`,
          canvasBlock,
          `JSON 详情：${JSON.stringify({ canvas: { id: canvas.id, status: canvas.status, type: canvas.type, topic: canvas.topic, articleCount: Array.isArray(canvas.articles) ? canvas.articles.length : 0 } })}`,
        ].join('\n');
      },
      {
        name: 'xhs_create_image_group_canvas',
        description:
          '创建图片组 Canvas 或在已有 Canvas 内生成图片组。根据文章列表（标题+标签）从图库中匹配图片，自动生成固定布局的图片组。**重要**：一个 Canvas 的 articles 数组可以包含多个文章（对应多个 imageGroup），**"生成 N 组图片"是指一个 Canvas 包含 N 个 imageGroup，不是创建 N 个 Canvas**。传入 canvasId 时会复用同一 Canvas 并回写文章配图；每篇文章配图目标为 6-8 张（当前模板默认 6 张）。',
        schema: z.object({
          canvasId: z
            .union([z.number(), z.string()])
            .optional()
            .describe('已有 Canvas ID；传入后在同一 Canvas 内生成并合并图组配图'),
          topic: z.string().optional().describe('Canvas 主题，可选'),
          groupCount: z.number().int().min(1).max(20).optional()
            .describe('图片组数量（与 articles 数量保持一致；未传时取 articles 长度）'),
          articles: z
            .array(
              z.object({
                title: z.string().describe('文章标题'),
                tags: z.array(z.string()).optional().describe('标签列表，用于图片匹配（标签越准确匹配越好）'),
              }),
            )
            .optional()
            .describe('文章列表，每篇对应一个 imageGroup。传入 canvasId 且未传 articles 时，会使用该 Canvas 现有文章作为图组输入。'),
        }),
      },
    );
  }
}
