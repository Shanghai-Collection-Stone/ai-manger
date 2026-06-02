import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateAgentParams } from 'langchain';
import { tool } from 'langchain';
import * as z from 'zod';
import { CanvasService } from '../../canvas/services/canvas.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
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
  /** @description 每个图组消耗的源图最少数量（用于不足量预检；含拼图来源图） */
  private readonly MIN_SOURCE_IMAGES_PER_GROUP = 6;

  constructor(
    private readonly canvasService: CanvasService,
    private readonly gallery: GalleryService,
  ) {}

  /**
   * @description 不足量预检：根据 articles 总 tags 统计当前可用图片(已排除 isUsed),
   *  返回是否充足 + 总可用数 + 预计可生成组数。中断由调用方根据结果决定。
   * @keyword-en precheck image capacity for image-group generation
   */
  private async precheckImageCapacity(input: {
    userId: string;
    tenantId?: string;
    articles: Array<{ title: string; tags: string[] }>;
  }): Promise<{
    sufficient: boolean;
    available: number;
    expectedGroups: number;
    expectedMinImages: number;
    estimatedGroups: number;
    tags: string[];
    byTag: Record<string, number>;
  }> {
    const tagSet = new Set<string>();
    for (const a of input.articles) {
      for (const t of a.tags ?? []) {
        const v = String(t ?? '').trim();
        if (v) tagSet.add(v);
      }
    }
    const tags = Array.from(tagSet);
    const expectedGroups = input.articles.length;
    const expectedMinImages = expectedGroups * this.MIN_SOURCE_IMAGES_PER_GROUP;

    if (tags.length === 0) {
      return {
        sufficient: false,
        available: 0,
        expectedGroups,
        expectedMinImages,
        estimatedGroups: 0,
        tags,
        byTag: {},
      };
    }
    const { total, byTag } = await this.gallery.countAvailableByTags({
      userId: input.userId,
      tenantId: input.tenantId,
      tags,
      imageType: 'regular',
    });
    const estimatedGroups = Math.floor(
      total / this.MIN_SOURCE_IMAGES_PER_GROUP,
    );
    return {
      sufficient: total >= expectedMinImages,
      available: total,
      expectedGroups,
      expectedMinImages,
      estimatedGroups,
      tags,
      byTag,
    };
  }

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
        ? Math.max(
            1,
            Math.min(this.MAX_GROUP_COUNT, Math.trunc(input.groupCount)),
          )
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
  }): Promise<{
    doneCount: number;
    missingCount: number;
    countMismatch: number;
  }> {
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
        const isInsufficientSourceImages =
          group?.status === 'failed' && imageUrls.length === 0;
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
                : isInsufficientSourceImages
                  ? 'AUTO_CANVAS_IMAGE_GROUP_INSUFFICIENT_SOURCE_IMAGES'
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
  getHandle(scope?: {
    tenantId?: string;
    userId?: string;
    earlyEmit?: (text: string) => void;
  }): CreateAgentParams['tools'] {
    return [
      this.createListCanvasesTool(scope),
      this.createGetCanvasDetailTool(scope),
      this.createImageGroupCanvasTool(scope),
      this.createTagSelectRequestTool(scope),
      this.createRegenerateCanvasCoverTool(scope),
      this.createRegenerateArticleImagesTool(scope),
    ];
  }

  /**
   * @description 发出 tag 选择卡片工具。调用后通过 earlyEmit 推送 markdown fence
   *  ` ```tag-select-it ... ``` `，前端识别后渲染为卡片;点击卡片打开搜索/推荐弹窗,
   *  用户选完通过用户消息回写。生成图组/图文/拼图前可强制调用本工具收集 tags。
   * @keyword-en emit tag-select card request fence to chat stream
   */
  private createTagSelectRequestTool(scope?: {
    tenantId?: string;
    userId?: string;
    earlyEmit?: (text: string) => void;
  }) {
    return tool(
      async (input: {
        purpose?: string;
        title?: string;
        hint?: string;
        minTags?: number;
        maxTags?: number;
        multi?: boolean;
        recommendCount?: number;
      }) => {
        const recommendLimit = Math.max(
          3,
          Math.min(20, Math.trunc(Number(input.recommendCount ?? 10))),
        );
        let recommendTags: Array<{ tag: string; count: number }> = [];
        try {
          recommendTags = await this.gallery.listTopTagsWithCount({
            userId: scope?.userId,
            tenantId: scope?.tenantId,
            limit: recommendLimit,
            imageType: 'regular',
          });
        } catch (e) {
          this.logger.warn(
            `[tag_select_request] listTopTagsWithCount failed: ${String(e)}`,
          );
        }

        const payload = {
          selectorId: randomUUID(),
          title:
            String(input.title ?? '请选择素材标签').trim() || '请选择素材标签',
          hint:
            String(input.hint ?? '').trim() ||
            (input.purpose
              ? `用于：${String(input.purpose).trim()}`
              : '选择本次生成所要匹配的标签（可多选）'),
          purpose: String(input.purpose ?? '').trim() || undefined,
          minTags: Math.max(1, Math.trunc(Number(input.minTags ?? 1))),
          maxTags: Math.max(1, Math.trunc(Number(input.maxTags ?? 8))),
          multi: input.multi !== false,
          recommendTags,
        };
        const fence = `\`\`\`tag-select-it\n${JSON.stringify(payload)}\n\`\`\``;
        try {
          scope?.earlyEmit?.(fence);
        } catch {
          // 推送失败不影响主流程
        }
        // 仅返回简短文字给 LLM,fence 已通过 earlyEmit 直接推到前端,无需 LLM 二次输出
        return '已向用户发出 tag 选择卡片(已直接推送给前端,无需在回复中重复 fence)。请用一句简短中文告诉用户卡片已弹出,等待用户在卡片内多选 tags 并以"我选定标签：#A #B"形式回传后,再按场景调用对应生成工具继续生成: 图文用 topic_orchestrate, 图组用 xhs_create_image_group_canvas。';
      },
      {
        name: 'tag_select_request',
        description:
          '当用户请求生成图组/拼图/封面/图文**但未明确提供具体 tags** 时,先调用本工具向用户发出 tag 选择卡片收集标签。前端会渲染卡片+搜索弹窗,提供热门 tag 推荐供多选。用户选完会以"我选定标签：#X #Y"消息回传,之后按场景调用对应生成工具: 图文用 topic_orchestrate,图组用 xhs_create_image_group_canvas。**如果用户消息中已明确给出 tags(如"用#团建生成图组"、"我选定标签：#X")则跳过本工具直接生成**,避免无意义重复发卡。本工具每次对话最多调用 1 次。',
        schema: z.object({
          purpose: z
            .string()
            .optional()
            .describe(
              '本次 tag 选择的用途，例如"生成小红书图文"、"生成小红书图组"、"生成动态拼图封面"',
            ),
          title: z
            .string()
            .optional()
            .describe('卡片标题，默认"请选择素材标签"'),
          hint: z.string().optional().describe('卡片提示文字'),
          minTags: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('最少选择数，默认 1'),
          maxTags: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('最多选择数，默认 8'),
          multi: z.boolean().optional().describe('是否多选，默认 true'),
          recommendCount: z
            .number()
            .int()
            .min(3)
            .max(20)
            .optional()
            .describe('推荐 tag 数量，默认 10'),
        }),
      },
    );
  }

  /**
   * @description 列出 Canvas 列表工具
   * @keyword-en list canvases tool
   */
  private createListCanvasesTool(scope?: {
    tenantId?: string;
    userId?: string;
  }) {
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
            imageGroupCount: Array.isArray(c.imageGroups)
              ? c.imageGroups.length
              : 0,
            createdAt: c.createdAt,
          })),
          total: canvases.length,
        });
      },
      {
        name: 'xhs_list_canvases',
        description:
          'List all available Canvas collections for content management',
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
  private createGetCanvasDetailTool(scope?: {
    tenantId?: string;
    userId?: string;
  }) {
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
        description:
          'Get detailed information about a specific Canvas including its articles and image groups',
        schema: z.object({
          canvas_id: z.number().describe('Canvas ID to retrieve'),
        }),
      },
    );
  }

  /**
   * @description 只重生成 Canvas 封面的专用工具，不改正文、标签或内页图片。
   * @keyword-cn 封面重生成, 只改封面
   * @keyword-en cover-regenerate
   * @keyword-en canvas-cover-only-tool
   */
  private createRegenerateCanvasCoverTool(scope?: {
    tenantId?: string;
    userId?: string;
    earlyEmit?: (text: string) => void;
  }) {
    return tool(
      async (input: {
        canvas_id: number;
        target_type: 'article' | 'image-group';
        article_index?: number;
        article_id?: number;
        image_group_id?: number;
        group_index?: number;
        image_ids: number[];
        prompt?: string;
      }) => {
        if (!scope?.userId) {
          return JSON.stringify({ error: 'USER_REQUIRED' });
        }
        const canvas = await this.canvasService.get(
          input.canvas_id,
          scope.tenantId,
        );
        if (!canvas) {
          return JSON.stringify({
            error: 'CANVAS_NOT_FOUND',
            canvas_id: input.canvas_id,
          });
        }
        if (canvas.userId !== scope.userId) {
          return JSON.stringify({
            error: 'CANVAS_SCOPE_FORBIDDEN',
            canvas_id: input.canvas_id,
          });
        }
        const imageIds = (Array.isArray(input.image_ids)
          ? input.image_ids
          : []
        )
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0);
        if (imageIds.length === 0) {
          return JSON.stringify({
            error: 'COVER_SOURCE_IMAGES_REQUIRED',
            hint: '需要先选择一张或多张图库图片作为封面参考图。',
          });
        }

        let targetLabel = '';
        if (input.target_type === 'article') {
          const orderedArticles = [...(canvas.articles ?? [])].sort(
            (a, b) => Number(a.id) - Number(b.id),
          );
          const explicitArticleId = Number(input.article_id);
          const article = Number.isFinite(explicitArticleId)
            ? orderedArticles.find(
                (item) => Number(item.id) === explicitArticleId,
              )
            : orderedArticles[Number(input.article_index ?? 0)];
          if (!article) {
            return JSON.stringify({
              error: 'ARTICLE_TARGET_NOT_FOUND',
              canvas_id: input.canvas_id,
              articleCount: orderedArticles.length,
            });
          }
          await this.canvasService.startArticleCoverRegeneration({
            canvasId: input.canvas_id,
            articleId: article.id,
            userId: scope.userId,
            tenantId: scope.tenantId,
            imageIds,
            prompt: input.prompt,
          });
          targetLabel = `第${orderedArticles.findIndex((item) => item.id === article.id) + 1}篇文章封面`;
        } else {
          const orderedGroups = [...(canvas.imageGroups ?? [])].sort(
            (a, b) => Number(a.id) - Number(b.id),
          );
          const explicitGroupId = Number(input.image_group_id);
          const group = Number.isFinite(explicitGroupId)
            ? orderedGroups.find((item) => Number(item.id) === explicitGroupId)
            : orderedGroups[Number(input.group_index ?? 0)];
          if (!group) {
            return JSON.stringify({
              error: 'IMAGE_GROUP_TARGET_NOT_FOUND',
              canvas_id: input.canvas_id,
              groupCount: orderedGroups.length,
            });
          }
          await this.canvasService.startImageGroupCoverRegeneration({
            canvasId: input.canvas_id,
            groupId: group.id,
            userId: scope.userId,
            tenantId: scope.tenantId,
            imageIds,
            prompt: input.prompt,
          });
          targetLabel = `图组#${group.id}封面`;
        }

        const canvasBlock = `\`\`\`canvas-it\n${JSON.stringify({ canvasId: input.canvas_id, status: 'generating', type: canvas.type ?? 'article', topic: canvas.topic ?? '', articleCount: Array.isArray(canvas.articles) ? canvas.articles.length : 0 })}\n\`\`\``;
        try {
          scope?.earlyEmit?.(canvasBlock);
        } catch {
          // ignore
        }
        return `已开始重生成 Canvas#${input.canvas_id} 的${targetLabel}，Canvas 已进入 generating；本次只会替换封面，其他图片和正文不会改动。`;
      },
      {
        name: 'xhs_regenerate_canvas_cover',
        description:
          '只重生成 Canvas 封面的专用工具。适用于图文 Canvas 文章首图封面或图片组 Canvas role=cover 图片；必须传 image_ids(可多张)，这些图会合并为一次封面生成请求。不要用 xhs_regenerate_article_images 处理只换封面的需求。',
        schema: z.object({
          canvas_id: z.number().describe('Canvas ID'),
          target_type: z
            .enum(['article', 'image-group'])
            .describe('封面所在目标类型：article=图文文章首图，image-group=图片组封面'),
          article_index: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('图文文章在 xhs_get_canvas_detail 返回 articles 数组中的下标'),
          article_id: z
            .number()
            .optional()
            .describe('图文文章 ID，可替代 article_index'),
          image_group_id: z.number().optional().describe('图片组 ID'),
          group_index: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('图片组在 xhs_get_canvas_detail 返回 imageGroups 数组中的下标'),
          image_ids: z
            .array(z.number())
            .min(1)
            .max(8)
            .describe('用户选择的图库图片 ID，可多张，会作为一次封面生成请求的参考图'),
          prompt: z.string().optional().describe('用户输入的封面重生成提示词'),
        }),
      },
    );
  }

  /**
   * @description 重新为 Canvas 中某一篇文章生成配图。图源不足时返回 insufficient_images。
   * @keyword-en regenerate single article images tool, canvas article index
   */
  private createRegenerateArticleImagesTool(scope?: {
    tenantId?: string;
    userId?: string;
    earlyEmit?: (text: string) => void;
  }) {
    return tool(
      async (input: { canvas_id: number; article_index: number }) => {
        if (!scope?.userId) {
          return JSON.stringify({ error: 'USER_REQUIRED' });
        }
        const canvas = await this.canvasService.get(
          input.canvas_id,
          scope.tenantId,
        );
        if (!canvas) {
          return JSON.stringify({
            error: 'CANVAS_NOT_FOUND',
            canvas_id: input.canvas_id,
          });
        }
        if (canvas.userId !== scope.userId) {
          return JSON.stringify({
            error: 'CANVAS_SCOPE_FORBIDDEN',
            canvas_id: input.canvas_id,
          });
        }

        const orderedArticles = [...(canvas.articles ?? [])].sort(
          (a, b) => Number(a.id) - Number(b.id),
        );
        const article = orderedArticles[input.article_index];
        if (!article) {
          return JSON.stringify({
            error: 'ARTICLE_INDEX_OUT_OF_RANGE',
            canvas_id: input.canvas_id,
            article_index: input.article_index,
            articleCount: orderedArticles.length,
          });
        }

        const singleArticle = {
          title: article.title,
          tags: Array.isArray(article.tags) ? article.tags : [],
        };

        // 不足量预检
        let capacity = null;
        try {
          capacity = await this.precheckImageCapacity({
            userId: scope.userId,
            tenantId: scope.tenantId,
            articles: [singleArticle],
          });
        } catch (e) {
          this.logger.warn(
            `[xhs_regenerate_article_images] precheck failed (degraded to allow): ${String(e)}`,
          );
        }
        if (capacity && !capacity.sufficient) {
          this.logger.log(
            `[xhs_regenerate_article_images] insufficient canvas=${input.canvas_id} article_index=${input.article_index} available=${capacity.available} expected>=${capacity.expectedMinImages}`,
          );
          return JSON.stringify({
            status: 'insufficient_images',
            canvasId: input.canvas_id,
            articleIndex: input.article_index,
            articleTitle: article.title,
            tags: capacity.tags,
            availableImages: capacity.available,
            expectedMinImages: capacity.expectedMinImages,
            hint: '该文章的 tag 下图源不足。请用自然语言告知用户当前可用图片数，并询问是否补图或取消。不要继续调用本工具，等待用户决策。',
          });
        }

        const groups = await this.canvasService.generateImageGroupsForCanvas({
          canvasId: input.canvas_id,
          userId: scope.userId,
          tenantId: scope.tenantId,
          topic: canvas.topic,
          articles: [singleArticle],
          append: true,
        });

        const group = groups[0];
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
        const isInsufficientSourceImages =
          group?.status === 'failed' && imageUrls.length === 0;

        await this.canvasService.updateArticleImages(
          input.canvas_id,
          article.id,
          {
            imageIds: imageIds.length > 0 ? imageIds : undefined,
            imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
            status,
            doneNote:
              status === 'done'
                ? 'AUTO_CANVAS_IMAGE_GROUP_IMAGES'
                : isInsufficientSourceImages
                  ? 'AUTO_CANVAS_IMAGE_GROUP_INSUFFICIENT_SOURCE_IMAGES'
                  : isImageCountValid
                    ? 'AUTO_CANVAS_IMAGE_GROUP_MISSING'
                    : 'AUTO_CANVAS_IMAGE_GROUP_COUNT_MISMATCH',
          },
          scope.tenantId,
        );

        const canvasBlock = `\`\`\`canvas-it\n${JSON.stringify({ canvasId: input.canvas_id, status: canvas.status ?? 'generating', type: canvas.type ?? 'article', topic: canvas.topic ?? '', articleCount: orderedArticles.length })}\n\`\`\``;
        try {
          scope?.earlyEmit?.(canvasBlock);
        } catch {
          // 推送失败不影响主流程
        }
        return `已重新生成 Canvas#${input.canvas_id} 第${input.article_index + 1}篇（${article.title}）的配图（status=${status}, imageCount=${imageUrls.length}）。卡片已直接推送到前端，请用一句简短中文告诉用户结果即可，不要复述 fence。`;
      },
      {
        name: 'xhs_regenerate_article_images',
        description:
          '重新为 Canvas 中某一篇文章生成配图（指定 canvas_id + article_index）。适用于：某篇图片不满意、生成失败需重试、或只更换单篇配图而不影响其他文章。**调用前必须先用 xhs_get_canvas_detail 获取 Canvas 详情**，article_index 即该接口返回的 articles 数组的下标（第一篇=0，第二篇=1，以此类推）。图源不足时返回 insufficient_images，等待用户决策，不阻断其他文章。',
        schema: z.object({
          canvas_id: z.number().describe('Canvas ID'),
          article_index: z
            .number()
            .int()
            .min(0)
            .describe(
              '文章在 xhs_get_canvas_detail 返回的 articles 数组中的下标（第一篇=0，第二篇=1，以此类推）',
            ),
        }),
      },
    );
  }

  /**
   * @description 创建图片组 Canvas 工具（异步生成，立即返回 generating 状态）
   * @keyword-en create image group canvas tool
   */
  private createImageGroupCanvasTool(scope?: {
    tenantId?: string;
    userId?: string;
    earlyEmit?: (text: string) => void;
  }) {
    return tool(
      async (input: {
        canvasId?: number | string;
        topic?: string;
        groupCount?: number;
        articles?: Array<{ title: string; tags?: string[] }>;
      }) => {
        if (!scope?.userId) {
          return JSON.stringify({
            error: 'USER_REQUIRED: userId is required for canvas creation',
          });
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

          // 不足量预检：图源不足直接中断，返回结构化结果给 LLM 让其用自然语言询问用户
          // 预检失败(异常)时降级为放行,不阻断主生成链路
          let capacity = null;
          try {
            capacity = await this.precheckImageCapacity({
              userId: scope.userId,
              tenantId: scope.tenantId,
              articles: sourceArticles,
            });
          } catch (e) {
            this.logger.warn(
              `[xhs_create_image_group_canvas] precheck failed (degraded to allow): ${String(e)}`,
            );
          }
          if (capacity && !capacity.sufficient) {
            this.logger.log(
              `[xhs_create_image_group_canvas] insufficient available=${capacity.available} expected>=${capacity.expectedMinImages} estimatedGroups=${capacity.estimatedGroups}`,
            );
            return JSON.stringify({
              status: 'insufficient_images',
              canvasId: requestedCanvasId,
              expectedGroups: capacity.expectedGroups,
              expectedMinImages: capacity.expectedMinImages,
              availableImages: capacity.available,
              estimatedGroups: capacity.estimatedGroups,
              tags: capacity.tags,
              byTag: capacity.byTag,
              hint: '图源不足且不再跨 tag 补充。请用自然语言告知用户当前可用图片数与预计可生成组数，并询问是否接受降级方案（减少组数）、追加上传图片、或取消任务。不要继续调用本工具，等待用户决策。',
            });
          }

          const groups = await this.canvasService.generateImageGroupsForCanvas({
            canvasId: requestedCanvasId,
            userId: scope.userId,
            tenantId: scope.tenantId,
            topic: input.topic ?? existing.topic,
            articles: sourceArticles.map((a) => ({
              title: a.title,
              tags: a.tags,
            })),
            // 复用已有 Canvas 再生成 → 追加图组,不覆盖上一组生成结果
            append: true,
          });
          const mergeSummary = await this.mergeImageGroupsToArticles({
            canvasId: requestedCanvasId,
            tenantId: scope.tenantId,
            articles: Array.isArray(existing.articles) ? existing.articles : [],
            imageGroups: groups,
          });
          const canvasBlock = `\`\`\`canvas-it\n${JSON.stringify({ canvasId: requestedCanvasId, status: existing.status ?? 'generating', type: existing.type ?? 'article', topic: input.topic ?? existing.topic ?? '', articleCount: Array.isArray(existing.articles) ? existing.articles.length : 0 })}\n\`\`\``;
          try {
            scope?.earlyEmit?.(canvasBlock);
          } catch {
            // 推送失败不影响主流程
          }
          // 工具结果只返回简洁文字给 LLM,canvas-it fence 已通过 earlyEmit 直接推到前端
          return `已在 Canvas#${requestedCanvasId} 完成图组生成并合并文章配图(done=${mergeSummary.doneCount}, requires_human=${mergeSummary.missingCount}, countMismatch=${mergeSummary.countMismatch})。卡片已直接推送到前端,请用一句简短中文告诉用户结果即可,不要复述 fence。`;
        }

        const articles = normalizedArticles;

        // 不足量预检：图源不足直接中断，让 AI 用自然语言询问用户
        // 预检失败(异常)时降级为放行,不阻断主生成链路
        let capacity = null;
        try {
          capacity = await this.precheckImageCapacity({
            userId: scope.userId,
            tenantId: scope.tenantId,
            articles,
          });
        } catch (e) {
          this.logger.warn(
            `[xhs_create_image_group_canvas] precheck failed (degraded to allow): ${String(e)}`,
          );
        }
        if (capacity && !capacity.sufficient) {
          this.logger.log(
            `[xhs_create_image_group_canvas] insufficient available=${capacity.available} expected>=${capacity.expectedMinImages} estimatedGroups=${capacity.estimatedGroups}`,
          );
          return JSON.stringify({
            status: 'insufficient_images',
            expectedGroups: capacity.expectedGroups,
            expectedMinImages: capacity.expectedMinImages,
            availableImages: capacity.available,
            estimatedGroups: capacity.estimatedGroups,
            tags: capacity.tags,
            byTag: capacity.byTag,
            hint: '图源不足且不再跨 tag 补充。请用自然语言告知用户当前可用图片数与预计可生成组数，并询问是否接受降级方案（减少组数）、追加上传图片、或取消任务。不要继续调用本工具，等待用户决策。',
          });
        }

        const canvas = await this.canvasService.createImageGroupCanvas({
          userId: scope.userId,
          tenantId: scope.tenantId,
          topic: input.topic,
          articles: articles.map((a) => ({
            title: a.title,
            tags: a.tags ?? [],
          })),
        });
        const canvasBlock = `\`\`\`canvas-it\n${JSON.stringify({ canvasId: canvas.id, status: 'generating', type: 'image-group', topic: canvas.topic ?? '', articleCount: Array.isArray(canvas.articles) ? canvas.articles.length : 0 })}\n\`\`\``;
        try {
          scope?.earlyEmit?.(canvasBlock);
        } catch {
          // 推送失败不影响主流程
        }
        // 工具结果只返回简洁文字给 LLM,canvas-it fence 已通过 earlyEmit 直接推到前端
        return `图片组 Canvas#${canvas.id} 已创建,正在后台匹配并生成图片。卡片已直接推送到前端,请用一句简短中文告诉用户已开始生成即可,不要复述 fence。`;
      },
      {
        name: 'xhs_create_image_group_canvas',
        description:
          '创建图片组 Canvas 或在已有 Canvas 内生成图片组。根据文章列表（标题+标签）从图库中匹配图片，自动生成固定布局的图片组。**重要**：一个 Canvas 的 articles 数组可以包含多个文章（对应多个 imageGroup），**"生成 N 组图片"是指一个 Canvas 包含 N 个 imageGroup，不是创建 N 个 Canvas**。**数量缺省规则**：用户未明确给出组数/篇数时，默认 articles 只传 1 篇（生成 1 个 imageGroup），严禁把单一主题（如"团建"）自行拆成多个子场景来凑多组。"一组/一套/一份"在中文里就是 1 组。传入 canvasId 时会复用同一 Canvas 并回写文章配图；每篇文章配图目标为 6-8 张（当前模板默认 6 张）。',
        schema: z.object({
          canvasId: z
            .union([z.number(), z.string()])
            .optional()
            .describe(
              '已有 Canvas ID；传入后在同一 Canvas 内生成并合并图组配图',
            ),
          topic: z.string().optional().describe('Canvas 主题，可选'),
          groupCount: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe(
              '图片组数量（与 articles 数量保持一致；未传时取 articles 长度）',
            ),
          articles: z
            .array(
              z.object({
                title: z.string().describe('文章标题'),
                tags: z
                  .array(z.string())
                  .optional()
                  .describe('标签列表，用于图片匹配（标签越准确匹配越好）'),
              }),
            )
            .optional()
            .describe(
              '文章列表，每篇对应一个 imageGroup。传入 canvasId 且未传 articles 时，会使用该 Canvas 现有文章作为图组输入。',
            ),
        }),
      },
    );
  }
}
