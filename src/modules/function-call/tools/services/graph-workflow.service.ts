import { Injectable } from '@nestjs/common';
import { tool, CreateAgentParams } from 'langchain';
import * as z from 'zod';
import { ArticleGraphService } from '../../../graph/services/article-graph.service.js';
import { BatchTaskGraphService } from '../../../graph/services/batch-task-graph.service.js';
import { CanvasService } from '../../../canvas/services/canvas.service.js';
import { GalleryService } from '../../../gallery/services/gallery.service.js';

/**
 * @title 话题编排工具 Graph Workflow Tools
 * @description 为主对话提供“话题编排 -> 文章生成 -> 可选批量发布”的工具句柄封装。
 * @keywords-cn 话题编排, 工作流, Canvas, 批量发布
 * @keywords-en topic orchestration, workflow, canvas, batch publishing
 */
@Injectable()
export class GraphWorkflowFunctionCallService {
  constructor(
    private readonly articles: ArticleGraphService,
    private readonly batch: BatchTaskGraphService,
    private readonly canvas: CanvasService,
    private readonly gallery: GalleryService,
  ) {}

  /**
   * @description 返回 Graph 工作流相关的工具句柄集合（topic_orchestrate）。
   * @param {(msg: string) => void} [streamWriter] - 可选的流式日志输出。
   * @returns {CreateAgentParams['tools']} 工具集合。
   * @keyword graph, workflow, tools
   * @since 2026-02-04
   */
  getHandle(streamWriter?: (msg: string) => void): CreateAgentParams['tools'] {
    const topicOrchestrate = tool(
      async ({
        userId,
        platform,
        topic,
        outline,
        style,
        count,
        galleryUserId,
        galleryGroupId,
        minImageScore,
        provider,
        model,
        temperature,
      }) => {
        if (streamWriter) streamWriter('[Graph] Orchestrating topic workflow');

        try {
          const gen = await this.articles.generateToCanvas({
            userId,
            platform,
            topic,
            outline,
            style,
            count,
            galleryUserId,
            galleryGroupId,
            minImageScore,
            provider,
            model,
            temperature,
          });

          const genObj: Record<string, unknown> =
            gen && typeof gen === 'object' ? gen : {};

          const needFields = Array.isArray(genObj['missing'])
            ? (genObj['missing'] as unknown[])
                .map((x) => (typeof x === 'string' ? x : ''))
                .filter((x) => x.length > 0)
            : [];

          const canvasId = genObj['canvasId'];
          const canvas = genObj['canvas'];
          const canvasTags = genObj['canvasTags'];
          const canvasRec =
            canvas && typeof canvas === 'object'
              ? (canvas as Record<string, unknown>)
              : undefined;

          const base: Record<string, unknown> = {
            ok: true,
            canvasId,
            canvas,
            canvasTags: Array.isArray(canvasTags) ? canvasTags : [],
            platform,
            topic,
            status:
              typeof canvasRec?.['status'] === 'string'
                ? canvasRec['status']
                : undefined,
            articleCount:
              typeof canvasRec?.['articleCount'] === 'number'
                ? canvasRec['articleCount']
                : undefined,
            needHuman:
              needFields.length > 0 ||
              canvasRec?.['status'] === 'requires_human',
            needFields,
          };

          return JSON.stringify(base);
        } catch (err: unknown) {
          const e = err instanceof Error ? err : new Error(String(err));
          return JSON.stringify({
            ok: false,
            error: 'TOPIC_ORCHESTRATE_FAILED',
            message: e.message,
          });
        }
      },
      {
        name: 'topic_orchestrate',
        description:
          'Topic Orchestration Tool. Generates a sample-article Canvas from topic/outline/style.',
        schema: z.object({
          userId: z.string().describe('Target user id'),
          platform: z.string().optional().describe('Publishing platform label'),
          topic: z.string().optional().describe('Topic for the canvas'),
          outline: z
            .record(z.any())
            .optional()
            .describe('Outline object (optional; auto-generated if omitted)'),
          style: z
            .record(z.any())
            .optional()
            .describe('Style object (optional; auto-generated if omitted)'),
          count: z
            .number()
            .optional()
            .describe('Article count (3-5 recommended)'),
          galleryUserId: z
            .string()
            .optional()
            .describe('Gallery owner for image matching'),
          galleryGroupId: z
            .number()
            .optional()
            .describe('Gallery group id filter'),
          minImageScore: z
            .number()
            .optional()
            .describe('Min similarity score for image matching'),
          provider: z.enum(['gemini', 'deepseek']).optional(),
          model: z.string().optional(),
          temperature: z.number().optional(),
        }),
      },
    );

    const canvasExecute = tool(
      async ({
        userId,
        canvasId,
        platform,
        galleryUserId,
        galleryGroupId,
        plannedAtStart,
        intervalMinutes,
        concurrency,
        callbackUrl,
        payload,
      }) => {
        const toolDebug =
          process.env.TOOL_DEBUG === '1'
            ? true
            : process.env.TOOL_DEBUG === '0'
              ? false
              : process.env.NODE_ENV !== 'production';
        if (toolDebug) {
          const payloadKeys =
            payload && typeof payload === 'object'
              ? Object.keys(payload).slice(0, 50)
              : [];
          console.log('[Tool.canvas_execute] args', {
            userId,
            canvasId,
            platform,
            galleryUserId,
            galleryGroupId,
            plannedAtStart,
            intervalMinutes,
            concurrency,
            callbackUrl,
            payloadKeys,
          });
        }

        const canvasIdNum = Number(canvasId);
        if (!Number.isFinite(canvasIdNum)) {
          return JSON.stringify({ ok: false, error: 'CANVAS_ID_INVALID' });
        }

        if (streamWriter) {
          streamWriter(
            `[Graph] Executing canvas workflow (canvasId=${canvasIdNum}, platform=${String(platform ?? '')})`,
          );
        }
        const res = await this.batch.runFromCanvas({
          userId,
          canvasId: canvasIdNum,
          platform,
          galleryUserId,
          galleryGroupId,
          plannedAtStart,
          intervalMinutes,
          concurrency,
          callbackUrl,
          payload,
        });
        return JSON.stringify({ ok: true, result: res });
      },
      {
        name: 'canvas_execute',
        description:
          'Canvas Execute Tool. Runs batch publishing / execution from an existing Canvas.',
        schema: z.object({
          userId: z.string().describe('Target user id'),
          canvasId: z.union([z.number(), z.string()]).describe('Canvas id'),
          platform: z.string().optional().describe('Publishing platform label'),
          galleryUserId: z
            .string()
            .optional()
            .describe('Gallery owner for image matching'),
          galleryGroupId: z
            .number()
            .optional()
            .describe('Gallery group id filter'),
          plannedAtStart: z
            .string()
            .optional()
            .describe('ISO start time for scheduled posts'),
          intervalMinutes: z
            .number()
            .optional()
            .describe('Interval minutes between posts'),
          concurrency: z
            .number()
            .optional()
            .describe('Max concurrency for enqueue calls'),
          callbackUrl: z
            .string()
            .optional()
            .describe('Callback URL for MCP task status updates'),
          payload: z
            .record(z.any())
            .optional()
            .describe('Extra payload merged into each post and run request'),
        }),
      },
    );

    const xhsBatchPublish = tool(
      async ({
        userId,
        canvasId,
        platform,
        galleryUserId,
        galleryGroupId,
        minImageScore,
        plannedAtStart,
        intervalMinutes,
        callbackUrl,
        payload,
        forceNew,
        provider,
        model,
        temperature,
        taskCount,
      }) => {
        const canvasIdNum = Number(canvasId);
        if (!Number.isFinite(canvasIdNum)) {
          return JSON.stringify({ ok: false, error: 'CANVAS_ID_INVALID' });
        }

        if (streamWriter) streamWriter('[Graph] Starting XHS batch publish');
        console.log('[xhs_batch_publish] payload', {
          userId,
          canvasId: canvasIdNum,
          platform,
          galleryUserId,
          galleryGroupId,
          minImageScore,
          plannedAtStart,
          intervalMinutes,
          callbackUrl,
          payload,
          forceNew,
          provider,
          model,
          temperature,
          taskCount,
        });

        try {
          const res = await this.batch.openAndStartXhsFromCanvas({
            userId,
            canvasId: canvasIdNum,
            platform,
            galleryUserId,
            galleryGroupId,
            minImageScore,
            plannedAtStart,
            intervalMinutes,
            callbackUrl,
            payload,
            forceNew,
            provider,
            model,
            temperature,
            taskCount,
          });
          console.log('[xhs_batch_publish] 创建成功', res);
          return JSON.stringify(res);
        } catch (err: unknown) {
          const e = err instanceof Error ? err : new Error(String(err));
          console.error('[xhs_batch_publish] Error:', e.message, e.stack);
          return JSON.stringify({
            ok: false,
            error: 'XHS_BATCH_PUBLISH_FAILED',
            message: e.message,
          });
        }
      },
      {
        name: 'xhs_batch_publish',
        description:
          'XHS Batch Publish Tool. Opens an MCP batch task, creates a tracking todo with todo items for each post, then asynchronously executes the publishing workflow. IMPORTANT: Provide taskCount; Canvas articles are only references for generation.',
        schema: z.object({
          userId: z.string().describe('Target user id'),
          canvasId: z.union([z.number(), z.string()]).describe('Canvas id'),
          taskCount: z.number().describe('Number of posts to generate'),
          platform: z
            .string()
            .optional()
            .describe('Publishing platform label (only xhs supported)'),
          galleryUserId: z
            .string()
            .optional()
            .describe('Gallery owner for image matching'),
          galleryGroupId: z
            .number()
            .optional()
            .describe('Gallery group id filter'),
          minImageScore: z
            .number()
            .optional()
            .describe('Min similarity score for image matching'),
          plannedAtStart: z
            .string()
            .optional()
            .describe('ISO start time for scheduled posts'),
          intervalMinutes: z
            .number()
            .optional()
            .describe('Interval minutes between posts'),
          callbackUrl: z
            .string()
            .optional()
            .describe('Callback URL for MCP task status updates'),
          payload: z
            .record(z.any())
            .optional()
            .describe('Extra payload merged into each post and run request'),
          forceNew: z
            .boolean()
            .optional()
            .describe(
              'Force creating a new batch task even if an active one exists',
            ),
          provider: z.enum(['gemini', 'deepseek']).optional(),
          model: z.string().optional(),
          temperature: z.number().optional(),
        }),
      },
    );

    const batchPublish = tool(
      async ({
        userId,
        canvasId,
        platform,
        topic,
        outline,
        style,
        count,
        galleryUserId,
        galleryGroupId,
        minImageScore,
        provider,
        model,
        temperature,
        plannedAtStart,
        intervalMinutes,
        concurrency,
        callbackUrl,
        payload,
      }) => {
        let canvasIdNum = Number(canvasId);
        let canvas: unknown = undefined;
        let needFields: string[] = [];
        if (!Number.isFinite(canvasIdNum)) {
          if (streamWriter)
            streamWriter(
              '[Graph] Orchestrating topic workflow (batch publish)',
            );

          const gen = await this.articles.generateToCanvas({
            userId,
            platform,
            topic,
            outline,
            style,
            count,
            galleryUserId,
            galleryGroupId,
            minImageScore,
            provider,
            model,
            temperature,
          });

          const genObj: Record<string, unknown> =
            gen && typeof gen === 'object' ? gen : {};

          needFields = Array.isArray(genObj['missing'])
            ? (genObj['missing'] as unknown[])
                .map((x) => (typeof x === 'string' ? x : ''))
                .filter((x) => x.length > 0)
            : [];

          canvasIdNum = Number(genObj['canvasId']);
          canvas = genObj['canvas'];

          if (!Number.isFinite(canvasIdNum)) {
            return JSON.stringify({
              ok: false,
              error: 'CANVAS_ID_INVALID',
              needHuman: needFields.length > 0,
              needFields,
              canvas,
            });
          }
        }

        if (needFields.length > 0) {
          return JSON.stringify({
            ok: true,
            canvasId: canvasIdNum,
            canvas,
            needHuman: true,
            needFields,
          });
        }

        if (streamWriter)
          streamWriter('[Graph] Executing canvas workflow (batch publish)');

        const res = await this.batch.runFromCanvas({
          userId,
          canvasId: canvasIdNum,
          platform,
          galleryUserId,
          galleryGroupId,
          plannedAtStart,
          intervalMinutes,
          concurrency,
          callbackUrl,
          payload,
        });

        return JSON.stringify({
          ok: true,
          canvasId: canvasIdNum,
          canvas,
          needHuman: false,
          needFields: [],
          result: res,
        });
      },
      {
        name: 'batch_publish',
        description:
          'Batch Publish Tool. Orchestrates a Canvas from topic/outline/style then runs batch publishing from that Canvas.',
        schema: z.object({
          userId: z.string().describe('Target user id'),
          canvasId: z
            .union([z.number(), z.string()])
            .optional()
            .describe('Existing canvas id (optional) to run directly'),
          platform: z.string().optional().describe('Publishing platform label'),
          topic: z.string().optional().describe('Topic for the canvas'),
          outline: z
            .record(z.any())
            .optional()
            .describe('Outline object (optional; auto-generated if omitted)'),
          style: z
            .record(z.any())
            .optional()
            .describe('Style object (optional; auto-generated if omitted)'),
          count: z
            .number()
            .optional()
            .describe('Article count (3-5 recommended)'),
          galleryUserId: z
            .string()
            .optional()
            .describe('Gallery owner for image matching'),
          galleryGroupId: z
            .number()
            .optional()
            .describe('Gallery group id filter'),
          minImageScore: z
            .number()
            .optional()
            .describe('Min similarity score for image matching'),
          provider: z.enum(['gemini', 'deepseek']).optional(),
          model: z.string().optional(),
          temperature: z.number().optional(),
          plannedAtStart: z
            .string()
            .optional()
            .describe('ISO start time for scheduled posts'),
          intervalMinutes: z
            .number()
            .optional()
            .describe('Interval minutes between posts'),
          concurrency: z
            .number()
            .optional()
            .describe('Max concurrency for enqueue calls'),
          callbackUrl: z
            .string()
            .optional()
            .describe('Callback URL for MCP task status updates'),
          payload: z
            .record(z.any())
            .optional()
            .describe('Extra payload merged into each post and run request'),
        }),
      },
    );

    void canvasExecute;
    void batchPublish;

    // 新增：获取 canvas 详情工具，让 LLM 能查看实际数据
    const getCanvasDetail = tool(
      async ({ canvasId }) => {
        const canvasIdNum = Number(canvasId);
        if (!Number.isFinite(canvasIdNum)) {
          return JSON.stringify({ ok: false, error: 'CANVAS_ID_INVALID' });
        }

        try {
          const c = await this.canvas.get(canvasIdNum);
          if (!c) {
            return JSON.stringify({ ok: false, error: 'CANVAS_NOT_FOUND' });
          }

          const articles = Array.isArray(c.articles) ? c.articles : [];
          const articlesSummary = articles.map((a, idx) => ({
            id: a.id,
            index: idx,
            title: a.title,
            tags: Array.isArray(a.tags) ? a.tags : [],
            hasImages:
              (Array.isArray(a.imageIds) && a.imageIds.length > 0) ||
              (Array.isArray(a.imageUrls) && a.imageUrls.length > 0),
            imageCount: (a.imageIds?.length ?? 0) + (a.imageUrls?.length ?? 0),
            status: a.status,
            contentPreview:
              typeof a.contentJson?.['markdown'] === 'string'
                ? String(a.contentJson['markdown']).slice(0, 200)
                : undefined,
          }));

          const readyCount = articlesSummary.filter(
            (a) => a.status === 'done' || a.hasImages,
          ).length;
          const needImageCount = articlesSummary.filter(
            (a) => !a.hasImages,
          ).length;

          return JSON.stringify({
            ok: true,
            canvas: {
              id: c.id,
              userId: c.userId,
              topic: c.topic,
              platform: c.outline?.['platform'] ?? c.style?.['platform'],
              status: c.status,
              articleCount: articles.length,
              readyToPublishCount: readyCount,
              needImageCount: needImageCount,
            },
            articles: articlesSummary,
            suggestion: {
              canPublish: readyCount > 0,
              recommendedCount: readyCount,
              message:
                readyCount === 0
                  ? '没有可发布的文章，请先生成文章或添加图片'
                  : needImageCount > 0
                    ? `有 ${needImageCount} 篇文章缺少图片，建议先配图或跳过这些文章`
                    : `共 ${readyCount} 篇文章可发布`,
            },
          });
        } catch (err: unknown) {
          const e = err instanceof Error ? err : new Error(String(err));
          return JSON.stringify({
            ok: false,
            error: 'GET_CANVAS_DETAIL_FAILED',
            message: e.message,
          });
        }
      },
      {
        name: 'get_canvas_detail',
        description:
          'Get Canvas Detail Tool. Retrieves detailed information about a canvas including all articles, their status, and image availability. Use this BEFORE calling xhs_batch_publish to understand the canvas content and decide how many articles to publish.',
        schema: z.object({
          canvasId: z
            .union([z.number(), z.string()])
            .describe('Canvas id to get details for'),
        }),
      },
    );

    const galleryListTags = tool(
      async ({ userId, groupId, limit }) => {
        const uid =
          typeof userId === 'string' && userId.trim().length > 0
            ? userId.trim()
            : undefined;
        const gid =
          typeof groupId === 'number' && Number.isFinite(groupId)
            ? groupId
            : undefined;
        const lim =
          typeof limit === 'number' && Number.isFinite(limit)
            ? Math.max(1, Math.min(5000, Math.floor(limit)))
            : 500;
        const tags = gid
          ? await this.gallery.listDistinctTagsByGroup(uid, gid, lim)
          : await this.gallery.listDistinctTags(uid, lim);
        return JSON.stringify({ ok: true, tags });
      },
      {
        name: 'gallery_list_tags',
        description:
          'Gallery Tags Tool. Lists all distinct image tags in the gallery, optionally filtered by userId and groupId.',
        schema: z.object({
          userId: z.string().optional().describe('Gallery owner user id'),
          groupId: z.number().optional().describe('Gallery group id filter'),
          limit: z
            .number()
            .optional()
            .describe('Max tags to return (default 500)'),
        }),
      },
    );

    const gallerySearchImages = tool(
      async ({ userId, groupId, tags, limit }) => {
        const uid =
          typeof userId === 'string' && userId.trim().length > 0
            ? userId.trim()
            : undefined;
        const gid =
          typeof groupId === 'number' && Number.isFinite(groupId)
            ? groupId
            : undefined;
        const lim =
          typeof limit === 'number' && Number.isFinite(limit)
            ? Math.max(1, Math.min(200, Math.floor(limit)))
            : 12;
        const tagList = Array.isArray(tags)
          ? tags.map((t) => String(t ?? '').trim()).filter((t) => t.length > 0)
          : [];
        const images = await this.gallery.searchByTags({
          userId: uid,
          groupId: gid,
          tags: tagList,
          limit: lim,
        });
        return JSON.stringify({
          ok: true,
          images: (images ?? []).map((img) => ({
            id: img.id,
            url: img.url,
            thumbUrl: img.thumbUrl,
            absPath: img.absPath,
            fileName: img.fileName,
            thumbFileName: img.thumbFileName,
            userId: img.userId,
            groupId: img.groupId,
            tags: img.tags,
            description: img.description,
          })),
        });
      },
      {
        name: 'gallery_search_images',
        description:
          'Gallery Search Tool. Searches images by tag list; typically call gallery_list_tags first, then provide selected tags.',
        schema: z.object({
          userId: z.string().optional().describe('Gallery owner user id'),
          groupId: z.number().optional().describe('Gallery group id filter'),
          tags: z.array(z.string()).describe('Selected tags'),
          limit: z
            .number()
            .optional()
            .describe('Max images to return (default 12)'),
        }),
      },
    );

    return [
      topicOrchestrate,
      getCanvasDetail,
      galleryListTags,
      gallerySearchImages,
      xhsBatchPublish,
    ];
  }
}
