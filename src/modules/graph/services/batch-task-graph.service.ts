import { BadRequestException, Injectable } from '@nestjs/common';
import * as z from 'zod';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { BatchTaskService } from '../../batch-task/services/batch-task.service.js';
import { CanvasService } from '../../canvas/services/canvas.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { TextFormatService } from '../../format/services/format.service';

const ZGalleryTagSelection = z.object({
  selections: z
    .array(
      z.object({
        index: z.number(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const ZXhsDraft = z.object({
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  imageQuery: z.string().optional(),
});

@Injectable()
export class BatchTaskGraphService {
  constructor(
    private readonly canvas: CanvasService,
    private readonly batch: BatchTaskService,
    private readonly gallery: GalleryService,
    private readonly agent: AgentService,
    private readonly format: TextFormatService,
  ) {}

  private async pickGalleryTags(input: {
    provider: 'gemini' | 'deepseek';
    model: string;
    temperature: number;
    platform?: string;
    topic?: string;
    availableTags: string[];
    items: Array<{ title: string; tags: string[]; imageQuery?: string }>;
  }): Promise<Map<number, string[]>> {
    const available = Array.isArray(input.availableTags)
      ? input.availableTags
          .map((x) => String(x ?? '').trim())
          .filter(Boolean)
          .slice(0, 200)
      : [];
    const map = new Map<number, string[]>();
    if (available.length === 0 || input.items.length === 0) return map;

    const sys =
      '你是“图库标签选择器”。你必须只输出 JSON 对象，不要输出任何多余字符。你只能从 availableTags 中选择标签。输出 schema：{ "selections": [{"index": number, "tags": string[]}] }。tags 建议 1-3 个；不确定就返回空数组。';

    const basePayload = {
      task: 'Select gallery tags for batch publishing',
      platform: input.platform,
      topic: input.topic,
      availableTags: available,
      items: input.items.map((it, index) => ({
        index,
        title: it.title,
        tags: it.tags,
        imageQuery: it.imageQuery,
      })),
    };

    const config = {
      provider: input.provider,
      model: input.model,
      temperature: input.temperature,
      system: sys,
      responseFormat:
        input.provider === 'deepseek' ? { type: 'json_object' } : undefined,
    };

    let lastNormalized = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? JSON.stringify(basePayload, null, 2)
          : JSON.stringify(
              {
                task: 'Fix previous output to match schema',
                previousOutput: lastNormalized,
                required: {
                  schema:
                    '{ "selections": [{"index": number, "tags": string[]}] }',
                  must: [
                    'Only output JSON object',
                    'tags must be chosen from availableTags',
                    'index must match an item index',
                  ],
                },
                basePayload,
              },
              null,
              2,
            );

      const messages: BaseMessage[] = [
        new SystemMessage(sys),
        new HumanMessage(prompt),
      ];

      let normalized = '';
      try {
        const ai = await this.agent.runWithMessages({ config, messages });
        const content = (ai as unknown as { content?: unknown }).content;
        const raw =
          typeof content === 'string' ? content : JSON.stringify(content ?? '');
        normalized = this.format.normalizeJsonText(raw);
        lastNormalized = normalized;
      } catch {
        void 0;
      }

      if (!normalized || normalized.trim().length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(normalized) as unknown;
      } catch {
        continue;
      }

      const sel = ZGalleryTagSelection.safeParse(parsed);
      if (!sel.success) continue;
      const selections = Array.isArray(sel.data.selections)
        ? sel.data.selections
        : [];
      for (const s of selections) {
        const idx = typeof s.index === 'number' ? s.index : Number.NaN;
        if (!Number.isFinite(idx)) continue;
        const tagsRaw = Array.isArray(s.tags) ? s.tags : [];
        const tags = tagsRaw
          .map((x) => String(x ?? '').trim())
          .filter((t) => t.length > 0 && available.includes(t))
          .slice(0, 3);
        map.set(idx, tags);
      }

      if (map.size > 0) break;
    }

    return map;
  }

  private async ensureCanvasImages(input: {
    userId: string;
    canvasId: number;
    platform?: string;
    galleryUserId?: string;
    galleryGroupId?: number;
  }): Promise<void> {
    const c = await this.canvas.get(input.canvasId);
    if (!c) return;
    const articles = Array.isArray(c.articles) ? c.articles : [];
    const need = articles
      .map((a, idx) => ({ a, idx }))
      .filter(({ a }) => {
        const hasIds = Array.isArray(a.imageIds) && a.imageIds.length > 0;
        const hasUrls = Array.isArray(a.imageUrls) && a.imageUrls.length > 0;
        return !(hasIds || hasUrls);
      });
    if (need.length === 0) return;

    const galleryUserId =
      typeof input.galleryUserId === 'string' &&
      input.galleryUserId.trim().length > 0
        ? input.galleryUserId.trim()
        : input.userId;
    const groupId =
      typeof input.galleryGroupId === 'number' &&
      Number.isFinite(input.galleryGroupId)
        ? input.galleryGroupId
        : undefined;

    const tags =
      typeof groupId === 'number'
        ? await this.gallery.listDistinctTagsByGroup(
            galleryUserId,
            groupId,
            500,
          )
        : await this.gallery.listDistinctTags(galleryUserId, 500);

    const provider = 'deepseek' as const;
    const model = 'deepseek-chat';
    const temperature = 0.2;
    const tagMap = await this.pickGalleryTags({
      provider,
      model,
      temperature,
      platform: input.platform,
      topic: typeof c.topic === 'string' ? c.topic : undefined,
      availableTags: tags,
      items: need.map(({ a }) => {
        const content =
          a.contentJson && typeof a.contentJson === 'object'
            ? a.contentJson
            : undefined;
        const imageQuery =
          typeof content?.['imageQuery'] === 'string'
            ? String(content['imageQuery']).trim()
            : undefined;
        return {
          title: a.title,
          tags: Array.isArray(a.tags) ? a.tags : [],
          imageQuery,
        };
      }),
    });

    const usedImageKeys = new Set<string>();
    for (const art of articles) {
      const ids = Array.isArray(art.imageIds) ? art.imageIds : [];
      const urls = Array.isArray(art.imageUrls) ? art.imageUrls : [];
      for (const id of ids) {
        if (typeof id === 'number' && Number.isFinite(id)) {
          usedImageKeys.add(`id:${id}`);
        }
      }
      for (const url of urls) {
        const u = String(url ?? '').trim();
        if (u) usedImageKeys.add(`url:${u}`);
      }
    }

    for (let i = 0; i < need.length; i++) {
      const { a } = need[i];
      const fallbackTags = (Array.isArray(a.tags) ? a.tags : [])
        .map((x) => String(x ?? '').trim())
        .filter((t) => t.length > 0 && tags.includes(t))
        .slice(0, 3);
      const chosen = (tagMap.get(i) ?? []).filter((t) => tags.includes(t));
      const useTags = chosen.length > 0 ? chosen : fallbackTags;

      const byTags =
        useTags.length > 0
          ? await this.gallery.searchByTags({
              userId: galleryUserId,
              groupId,
              tags: useTags,
              limit: 24,
            })
          : [];

      const tryPick = (imgs: Array<{ id?: unknown; url?: unknown }>) => {
        for (const it of imgs) {
          const id = typeof it.id === 'number' ? it.id : undefined;
          const url = typeof it.url === 'string' ? it.url.trim() : undefined;
          const keyId = typeof id === 'number' ? `id:${id}` : undefined;
          const keyUrl = url ? `url:${url}` : undefined;
          if (keyId && usedImageKeys.has(keyId)) continue;
          if (keyUrl && usedImageKeys.has(keyUrl)) continue;
          return { id, url, keyId, keyUrl };
        }
        const first = imgs[0];
        if (!first) return undefined;
        const id = typeof first.id === 'number' ? first.id : undefined;
        const url =
          typeof first.url === 'string' ? first.url.trim() : undefined;
        const keyId = typeof id === 'number' ? `id:${id}` : undefined;
        const keyUrl = url ? `url:${url}` : undefined;
        return { id, url, keyId, keyUrl };
      };

      const pickedFromTags = tryPick(byTags);
      const randomList = pickedFromTags
        ? []
        : await this.gallery.sampleRandom({
            userId: galleryUserId,
            groupId,
            limit: 24,
          });
      const pickedFromRandom = pickedFromTags ? undefined : tryPick(randomList);
      const picked = pickedFromTags ?? pickedFromRandom;

      if (!picked) {
        await this.canvas.updateArticleImages(c.id, a.id, {
          status: 'requires_human',
          doneNote: 'NO_GALLERY_IMAGE',
        });
        continue;
      }

      const imageId = typeof picked.id === 'number' ? picked.id : undefined;
      const imageUrl = typeof picked.url === 'string' ? picked.url : undefined;
      if (typeof imageId === 'number' && Number.isFinite(imageId)) {
        usedImageKeys.add(`id:${imageId}`);
      }
      if (typeof imageUrl === 'string' && imageUrl.trim().length > 0) {
        usedImageKeys.add(`url:${imageUrl.trim()}`);
      }
      await this.canvas.updateArticleImages(c.id, a.id, {
        imageIds: typeof imageId === 'number' ? [imageId] : undefined,
        imageUrls: typeof imageUrl === 'string' ? [imageUrl] : undefined,
        status: 'done',
        doneNote: pickedFromTags ? 'AUTO_TAG_MATCH' : 'AUTO_RANDOM_IMAGE',
      });
    }

    const after = await this.canvas.get(c.id);
    const hasHuman = (after?.articles ?? []).some(
      (x) => x.status === 'requires_human',
    );
    await this.canvas.updateStatus(
      c.id,
      hasHuman ? 'requires_human' : 'completed',
    );
  }

  /**
   * @description 生成批量发布待办的中文总览描述。
   * @param {object} input - 生成输入。
   * @param {string} input.platform - 发布平台名称。
   * @param {number} input.canvasId - 画布ID。
   * @param {string} input.taskId - MCP 任务ID。
   * @param {number} input.todoId - 待办ID。
   * @param {number} input.taskCount - 任务数量。
   * @param {string[]} input.tasksPreview - 任务标题预览。
   * @param {'gemini' | 'deepseek'} [input.provider] - 模型提供商。
   * @param {string} [input.model] - 模型名称。
   * @param {number} [input.temperature] - 采样温度。
   * @returns {Promise<string>} 中文描述文本。
   * @keyword todo, description, llm
   * @since 2026-02-05
   */
  private async buildTodoDescription(input: {
    platform: string;
    canvasId: number;
    taskId: string;
    todoId: number;
    taskCount: number;
    tasksPreview: string[];
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature?: number;
  }): Promise<string> {
    const sys =
      '你是“待办总览描述生成器”。只输出 JSON 对象，schema：{ "description": string }。description 必须是中文，包含任务数、平台、canvasId、taskId、todoId 与任务概览。';
    const payload = {
      platform: input.platform,
      canvasId: input.canvasId,
      taskId: input.taskId,
      todoId: input.todoId,
      taskCount: input.taskCount,
      tasksPreview: input.tasksPreview.slice(0, 10),
    };
    const provider = input.provider ?? 'deepseek';
    const config = {
      provider,
      model: input.model ?? 'deepseek-chat',
      temperature:
        typeof input.temperature === 'number' &&
        Number.isFinite(input.temperature)
          ? input.temperature
          : 0.2,
      system: sys,
      responseFormat:
        provider === 'deepseek' ? { type: 'json_object' } : undefined,
    };
    try {
      const messages: BaseMessage[] = [
        new SystemMessage(sys),
        new HumanMessage(JSON.stringify(payload, null, 2)),
      ];
      const ai = await this.agent.runWithMessages({ config, messages });
      const content = (ai as unknown as { content?: unknown }).content;
      const raw =
        typeof content === 'string' ? content : JSON.stringify(content ?? '');
      const normalized = this.format.normalizeJsonText(raw);
      const parsed = JSON.parse(normalized) as { description?: unknown };
      const desc =
        typeof parsed?.description === 'string'
          ? parsed.description.trim()
          : '';
      if (desc.length > 0) return desc;
    } catch {
      void 0;
    }
    const preview = input.tasksPreview.slice(0, 10).join('、');
    const base =
      `批量发布任务（${input.platform}），任务数 ${input.taskCount}。` +
      `canvasId=${input.canvasId}，taskId=${input.taskId}，todoId=${input.todoId}。`;
    return preview.length > 0 ? `${base} 示例任务：${preview}` : base;
  }

  async runFromCanvas(input: {
    userId: string;
    canvasId: number;
    platform?: string;
    galleryUserId?: string;
    galleryGroupId?: number;
    plannedAtStart?: string;
    intervalMinutes?: number;
    concurrency?: number;
    callbackUrl?: string;
    payload?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const toolDebug =
      process.env.TOOL_DEBUG === '1'
        ? true
        : process.env.TOOL_DEBUG === '0'
          ? false
          : process.env.NODE_ENV !== 'production';
    if (toolDebug) {
      const payloadKeys =
        input.payload && typeof input.payload === 'object'
          ? Object.keys(input.payload).slice(0, 50)
          : [];
      console.log('[BatchTaskGraph.runFromCanvas] input', {
        userId: input.userId,
        canvasId: input.canvasId,
        platform: input.platform,
        galleryUserId: input.galleryUserId,
        galleryGroupId: input.galleryGroupId,
        plannedAtStart: input.plannedAtStart,
        intervalMinutes: input.intervalMinutes,
        concurrency: input.concurrency,
        callbackUrl: input.callbackUrl,
        payloadKeys,
      });
    }

    const payloadRec =
      input.payload && typeof input.payload === 'object'
        ? input.payload
        : undefined;
    const groupFromPayloadRaw = payloadRec?.['galleryGroupId'];
    const groupFromPayload =
      typeof groupFromPayloadRaw === 'number' &&
      Number.isFinite(groupFromPayloadRaw)
        ? groupFromPayloadRaw
        : undefined;
    const userFromPayloadRaw = payloadRec?.['galleryUserId'];
    const userFromPayload =
      typeof userFromPayloadRaw === 'string' &&
      userFromPayloadRaw.trim().length > 0
        ? userFromPayloadRaw.trim()
        : undefined;

    await this.ensureCanvasImages({
      userId: input.userId,
      canvasId: input.canvasId,
      platform: input.platform,
      galleryUserId: input.galleryUserId ?? userFromPayload,
      galleryGroupId: input.galleryGroupId ?? groupFromPayload,
    });
    if (toolDebug) {
      console.log('[BatchTaskGraph.runFromCanvas] ensureCanvasImages done', {
        canvasId: input.canvasId,
      });
    }

    const c = await this.canvas.get(input.canvasId);
    if (!c) throw new BadRequestException('CANVAS_NOT_FOUND');
    if (c.userId !== input.userId)
      throw new BadRequestException('CANVAS_USER_MISMATCH');

    const articles = Array.isArray(c.articles) ? c.articles : [];
    if (articles.length === 0)
      throw new BadRequestException('CANVAS_HAS_NO_ARTICLES');

    if (toolDebug) {
      console.log('[BatchTaskGraph.runFromCanvas] canvas loaded', {
        canvasId: c.id,
        topic: c.topic,
        platform: input.platform,
        articleCount: articles.length,
        articleStatusCounts: articles.reduce<Record<string, number>>(
          (acc, a) => {
            const k = String(a.status ?? 'unknown');
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
          },
          {},
        ),
      });
    }

    const task = await this.batch.create({
      userId: input.userId,
      platform: input.platform,
      topic: typeof c.topic === 'string' ? c.topic : undefined,
      canvasId: String(c.id),
    });

    await this.batch.openMcpTask(task.id);
    const opened = await this.batch.get(task.id);
    if (!opened?.mcpTaskId)
      throw new BadRequestException('MCP_TASK_NOT_OPENED');

    if (toolDebug) {
      console.log('[BatchTaskGraph.runFromCanvas] task opened', {
        batchTaskId: task.id,
        mcpTaskId: String(opened?.mcpTaskId ?? ''),
      });
    }

    let startMs: number | undefined;
    if (
      typeof input.plannedAtStart === 'string' &&
      input.plannedAtStart.length > 0
    ) {
      const d = new Date(input.plannedAtStart);
      const ms = d.getTime();
      if (Number.isFinite(ms)) startMs = ms;
    }
    const intervalMinutes =
      typeof input.intervalMinutes === 'number' &&
      Number.isFinite(input.intervalMinutes)
        ? Math.max(0, Math.floor(input.intervalMinutes))
        : 0;

    const posts = articles.map((a, idx) => {
      const plannedAt =
        typeof startMs === 'number'
          ? new Date(startMs + idx * intervalMinutes * 60_000).toISOString()
          : undefined;
      const payload: Record<string, unknown> = {
        canvasId: c.id,
        articleId: a.id,
        title: a.title,
        tags: a.tags,
        content: a.contentJson,
        imageUrls: a.imageUrls,
        imageIds: a.imageIds,
        ...(input.payload ?? {}),
      };
      return { title: a.title, plannedAt, payload };
    });

    if (toolDebug) {
      console.log('[BatchTaskGraph.runFromCanvas] prepared posts', {
        batchTaskId: task.id,
        posts: posts.length,
        firstPlannedAt: posts[0]?.plannedAt,
        sampleTitles: posts
          .map((p) => String(p.title ?? '').trim())
          .filter((x) => x.length > 0)
          .slice(0, 5),
      });
    }

    await this.batch.addPostsParallel(task.id, {
      posts,
      concurrency:
        typeof input.concurrency === 'number' &&
        Number.isFinite(input.concurrency)
          ? input.concurrency
          : undefined,
    });

    if (toolDebug) {
      console.log('[BatchTaskGraph.runFromCanvas] addPostsParallel done', {
        batchTaskId: task.id,
      });
    }

    await this.batch.run(task.id, {
      callbackUrl: input.callbackUrl,
      payload: {
        canvasId: c.id,
        ...(input.payload ?? {}),
      },
    });

    if (toolDebug) {
      console.log('[BatchTaskGraph.runFromCanvas] batch run invoked', {
        batchTaskId: task.id,
        callbackUrl: input.callbackUrl,
      });
    }

    const next = await this.batch.get(task.id);
    return { batchTaskId: task.id, task: next };
  }

  /**
   * @description 打开小红书批量任务并异步执行 LangGraph 发布流。
   * @param {object} input - 输入参数。
   * @param {string} input.userId - 用户ID。
   * @param {number} input.canvasId - 画布ID。
   * @param {string} [input.platform] - 平台名称。
   * @param {string} [input.galleryUserId] - 图库用户ID。
   * @param {number} [input.galleryGroupId] - 图库分组ID。
   * @param {number} [input.minImageScore] - 相似度阈值。
   * @param {string} [input.plannedAtStart] - 计划开始时间。
   * @param {number} [input.intervalMinutes] - 间隔分钟数。
   * @param {string} [input.callbackUrl] - 回调地址。
   * @param {Record<string, unknown>} [input.payload] - 额外负载。
   * @param {boolean} [input.forceNew] - 是否强制新建任务。
   * @param {'gemini' | 'deepseek'} [input.provider] - 模型提供商。
   * @param {string} [input.model] - 模型名称。
   * @param {number} [input.temperature] - 采样温度。
   * @param {number} input.taskCount - 生成任务数量。
   * @returns {Promise<Record<string, unknown>>} 任务概览输出。
   * @throws {BadRequestException} 当平台不支持或画布不存在时抛出。
   * @keyword batch-task, xhs, langgraph
   * @since 2026-02-05
   */
  async openAndStartXhsFromCanvas(input: {
    userId: string;
    canvasId: number;
    platform?: string;
    galleryUserId?: string;
    galleryGroupId?: number;
    minImageScore?: number;
    plannedAtStart?: string;
    intervalMinutes?: number;
    callbackUrl?: string;
    payload?: Record<string, unknown>;
    forceNew?: boolean;
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature?: number;
    taskCount: number;
  }): Promise<Record<string, unknown>> {
    const platform =
      typeof input.platform === 'string' && input.platform.trim().length > 0
        ? input.platform.trim()
        : '小红书';
    if (!/小红书|xhs/i.test(platform)) {
      console.log('不是小红书发不了');
      throw new BadRequestException('PLATFORM_NOT_SUPPORTED');
    }

    const c = await this.canvas.get(input.canvasId);
    if (!c) throw new BadRequestException('CANVAS_NOT_FOUND');
    if (c.userId !== input.userId)
      throw new BadRequestException('CANVAS_USER_MISMATCH');

    const canvasIdStr = String(c.id);
    const existing =
      input.forceNew === true
        ? null
        : await this.batch.findLatestActiveByUserCanvas(
            input.userId,
            canvasIdStr,
          );
    console.log(existing);
    if (existing) {
      const opened = existing.mcpTaskId
        ? existing
        : ((await this.batch.openMcpTask(existing.id)) ?? existing);
      const preview = (opened.posts ?? [])
        .map((p) => String(p.title ?? '').trim())
        .filter((x) => x.length > 0)
        .slice(0, 20);

      const summary = {
        platform: opened.platform ?? platform,
        canvasId: c.id,
        topic: typeof c.topic === 'string' ? c.topic : undefined,
        batchTaskId: opened.id,
        todoId: opened.todoId,
        taskId: String(opened?.mcpTaskId ?? ''),
        taskCount: (opened.posts ?? []).length,
        tasksPreview: preview,
        status: opened.status,
        reused: true,
      } as Record<string, unknown>;

      if (typeof summary.todoId === 'number') {
        const desc = await this.buildTodoDescription({
          platform:
            typeof summary.platform === 'string' ? summary.platform : platform,
          canvasId: c.id,
          taskId: typeof summary.taskId === 'string' ? summary.taskId : '',
          todoId: summary.todoId,
          taskCount: Number(summary.taskCount ?? 0),
          tasksPreview: Array.isArray(summary.tasksPreview)
            ? (summary.tasksPreview as string[])
            : [],
          provider: input.provider,
          model: input.model,
          temperature: input.temperature,
        });
        await this.batch.updateTodoSummary({
          batchTaskId: opened.id,
          description: desc,
        });
      }

      return { ok: true, result: summary };
    }

    // 获取所有文章
    const allArticles = Array.isArray(c.articles) ? c.articles : [];
    console.log('allArticles', allArticles);
    if (allArticles.length === 0)
      throw new BadRequestException('CANVAS_HAS_NO_ARTICLES');
    const taskCountRaw =
      typeof input.taskCount === 'number' ? Math.floor(input.taskCount) : 0;
    if (!Number.isFinite(taskCountRaw) || taskCountRaw <= 0)
      throw new BadRequestException('TASK_COUNT_INVALID');

    console.log('[openAndStartXhsFromCanvas] Creating batch task...');
    const task = await this.batch.create({
      userId: input.userId,
      platform,
      topic: typeof c.topic === 'string' ? c.topic : undefined,
      canvasId: canvasIdStr,
    });
    console.log('[openAndStartXhsFromCanvas] Batch task created:', task.id);

    console.log('[openAndStartXhsFromCanvas] Opening MCP task...');
    await this.batch.openMcpTask(task.id);
    console.log('[openAndStartXhsFromCanvas] MCP task opened');

    const opened = await this.batch.get(task.id);
    if (!opened?.mcpTaskId)
      throw new BadRequestException('MCP_TASK_NOT_OPENED');
    console.log('[openAndStartXhsFromCanvas] MCP taskId:', opened.mcpTaskId);

    let startMs: number | undefined;
    if (
      typeof input.plannedAtStart === 'string' &&
      input.plannedAtStart.length > 0
    ) {
      const d = new Date(input.plannedAtStart);
      const ms = d.getTime();
      if (Number.isFinite(ms)) startMs = ms;
    }
    const intervalMinutes =
      typeof input.intervalMinutes === 'number' &&
      Number.isFinite(input.intervalMinutes)
        ? Math.max(0, Math.floor(input.intervalMinutes))
        : 0;

    const postsInit = Array.from({ length: taskCountRaw }).map((_, idx) => {
      const refIndex = idx % allArticles.length;
      const refArticle = allArticles[refIndex];
      const refTitleRaw =
        typeof refArticle?.title === 'string' ? refArticle.title.trim() : '';
      const title =
        refTitleRaw.length > 0 ? refTitleRaw : `小红书图文任务 #${idx + 1}`;
      const plannedAt =
        typeof startMs === 'number'
          ? new Date(startMs + idx * intervalMinutes * 60_000).toISOString()
          : undefined;
      return {
        title,
        plannedAt,
        payload: {
          canvasId: c.id,
          refArticleId:
            typeof refArticle?.id === 'number' ? refArticle.id : undefined,
          refIndex,
          refTitle: refTitleRaw.length > 0 ? refTitleRaw : undefined,
          ...(input.payload ?? {}),
        },
      };
    });

    console.log(
      '[openAndStartXhsFromCanvas] Initializing posts:',
      postsInit.length,
    );
    const afterInit = await this.batch.initPosts(task.id, {
      posts: postsInit,
    });
    console.log('[openAndStartXhsFromCanvas] Posts initialized');

    const tasksPreview = postsInit
      .map((p) => String(p.title ?? '').trim())
      .filter((x) => x.length > 0)
      .slice(0, 20);
    const summary = {
      platform,
      canvasId: c.id,
      topic: typeof c.topic === 'string' ? c.topic : undefined,
      batchTaskId: task.id,
      todoId: afterInit?.todoId ?? opened?.todoId,
      taskId: opened?.mcpTaskId,
      taskCount: postsInit.length,
      tasksPreview,
      status: afterInit?.status ?? opened?.status,
      callbackUrlTodo: 'TODO: 支持配置回调地址的校验/签名与更细粒度状态同步',
    } as Record<string, unknown>;

    if (typeof summary.todoId === 'number') {
      const desc = await this.buildTodoDescription({
        platform,
        canvasId: c.id,
        taskId: opened.mcpTaskId,
        todoId: summary.todoId,
        taskCount: postsInit.length,
        tasksPreview,
        provider: input.provider,
        model: input.model,
        temperature: input.temperature,
      });
      await this.batch.updateTodoSummary({
        batchTaskId: task.id,
        description: desc,
      });
    }

    setTimeout(() => {
      void this.runXhsPublishLangGraph({
        userId: input.userId,
        canvasId: c.id,
        batchTaskId: task.id,
        mcpTaskId: String(opened?.mcpTaskId ?? ''),
        galleryUserId: input.galleryUserId ?? input.userId,
        galleryGroupId: input.galleryGroupId,
        minImageScore: input.minImageScore,
        callbackUrl: input.callbackUrl,
        payload: input.payload,
        provider: input.provider,
        model: input.model,
        temperature: input.temperature,
      });
    }, 10);

    return { ok: true, result: summary };
  }

  private async runXhsPublishLangGraph(input: {
    userId: string;
    canvasId: number;
    batchTaskId: number;
    mcpTaskId: string;
    galleryUserId: string;
    galleryGroupId?: number;
    minImageScore?: number;
    callbackUrl?: string;
    payload?: Record<string, unknown>;
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature?: number;
  }): Promise<void> {
    const GraphState = Annotation.Root({
      userId: Annotation<string>({ default: () => '', reducer: (_a, b) => b }),
      canvasId: Annotation<number>({ default: () => 0, reducer: (_a, b) => b }),
      batchTaskId: Annotation<number>({
        default: () => 0,
        reducer: (_a, b) => b,
      }),
      mcpTaskId: Annotation<string>({
        default: () => '',
        reducer: (_a, b) => b,
      }),
      galleryUserId: Annotation<string>({
        default: () => '',
        reducer: (_a, b) => b,
      }),
      galleryGroupId: Annotation<number | undefined>({
        default: () => undefined,
        reducer: (_a, b) => b,
      }),
      minImageScore: Annotation<number>({
        default: () => 0.62,
        reducer: (_a, b) => b,
      }),
      callbackUrl: Annotation<string | undefined>({
        default: () => undefined,
        reducer: (_a, b) => b,
      }),
      payload: Annotation<Record<string, unknown> | undefined>({
        default: () => undefined,
        reducer: (_a, b) => b,
      }),
      provider: Annotation<'gemini' | 'deepseek'>({
        default: () => 'deepseek',
        reducer: (_a, b) => b,
      }),
      model: Annotation<string>({
        default: () => 'deepseek-chat',
        reducer: (_a, b) => b,
      }),
      temperature: Annotation<number>({
        default: () => 0.2,
        reducer: (_a, b) => b,
      }),
      availableTags: Annotation<string[]>({
        default: () => [],
        reducer: (_a, b) => b,
      }),
      posts: Annotation<
        Array<{
          postId: number;
          title: string;
          plannedAt?: string;
          todoItemId?: number;
          refArticleId?: number;
          refIndex?: number;
          refTitle?: string;
        }>
      >({
        default: () => [],
        reducer: (_a, b) => b,
      }),
      idx: Annotation<number>({ default: () => 0, reducer: (_a, b) => b }),
      usedImageKeys: Annotation<string[]>({
        default: () => [],
        reducer: (a, b) => [...a, ...b],
      }),
    });

    const workflow = new StateGraph(GraphState)
      .addNode('load_context', async (state) => {
        const c = await this.canvas.get(state.canvasId);
        if (!c) throw new BadRequestException('CANVAS_NOT_FOUND');
        if (c.userId !== state.userId)
          throw new BadRequestException('CANVAS_USER_MISMATCH');

        const task = await this.batch.get(state.batchTaskId);
        if (!task) throw new BadRequestException('BATCH_TASK_NOT_FOUND');

        const posts = (task.posts ?? []).map((p) => {
          const payload =
            p.payload && typeof p.payload === 'object' ? p.payload : undefined;
          const refArticleIdRaw =
            payload?.['refArticleId'] ?? payload?.['articleId'];
          const refArticleId =
            typeof refArticleIdRaw === 'number' &&
            Number.isFinite(refArticleIdRaw)
              ? refArticleIdRaw
              : undefined;
          const refIndexRaw = payload?.['refIndex'];
          const refIndex =
            typeof refIndexRaw === 'number' && Number.isFinite(refIndexRaw)
              ? refIndexRaw
              : undefined;
          const refTitleRaw = payload?.['refTitle'];
          const refTitle =
            typeof refTitleRaw === 'string' ? refTitleRaw.trim() : undefined;
          return {
            postId: p.id,
            title: p.title,
            plannedAt: p.plannedAt ? p.plannedAt.toISOString() : undefined,
            todoItemId: p.todoItemId,
            refArticleId,
            refIndex,
            refTitle,
          };
        });

        const tags =
          typeof state.galleryGroupId === 'number'
            ? await this.gallery.listDistinctTagsByGroup(
                state.galleryUserId,
                state.galleryGroupId,
                500,
              )
            : await this.gallery.listDistinctTags(state.galleryUserId, 500);

        return {
          posts,
          availableTags: tags,
        };
      })
      .addNode('generate_one', async (state) => {
        const current = state.posts[state.idx];
        if (!current) return {};

        await this.batch.updatePostProgress({
          batchTaskId: state.batchTaskId,
          postId: current.postId,
          status: 'in_progress',
          stage: '生成中',
        });

        const c = await this.canvas.get(state.canvasId);
        if (!c) throw new BadRequestException('CANVAS_NOT_FOUND');
        const articles = Array.isArray(c.articles) ? c.articles : [];
        const byId =
          typeof current.refArticleId === 'number'
            ? articles.find((a) => a.id === current.refArticleId)
            : undefined;
        const byIndex =
          typeof current.refIndex === 'number' &&
          current.refIndex >= 0 &&
          current.refIndex < articles.length
            ? articles[current.refIndex]
            : undefined;
        const byFallback =
          articles.length > 0
            ? articles[state.idx % articles.length]
            : undefined;
        const article = byId ?? byIndex ?? byFallback;
        const content =
          article?.contentJson && typeof article.contentJson === 'object'
            ? article.contentJson
            : undefined;
        const refMarkdown =
          typeof content?.['markdown'] === 'string'
            ? String(content['markdown'])
            : '';
        const refTags = Array.isArray(article?.tags)
          ? article?.tags
              .map((x) => String(x ?? '').trim())
              .filter((x) => x.length > 0)
              .slice(0, 20)
          : [];
        const refImageQuery =
          typeof content?.['imageQuery'] === 'string'
            ? String(content['imageQuery']).trim()
            : undefined;

        const sys = [
          '你是“小红书图文文案生成器”。你必须只输出 JSON 对象，不要输出任何多余字符。',
          '输出 schema：{ "title": string, "content": string, "tags"?: string[], "imageQuery"?: string }。',
          'content 必须是可直接发布的小红书正文风格：短句短段、真实分享口吻、适量清单化表达、结尾带 3-6 个 #话题。',
          '你必须参考 referenceMarkdown 的信息密度与写法，但必须改写为新的表达，避免逐句复刻。',
          'tags 若提供，必须从 availableTags 里选择 0-6 个；不确定就给空数组。',
        ].join('\n');

        const basePayload = {
          task: 'Rewrite and adapt reference article into a publish-ready xhs post',
          titleHint: current.title,
          referenceMarkdown: refMarkdown,
          referenceTags: refTags,
          referenceImageQuery: refImageQuery,
          availableTags: state.availableTags,
        };

        const config = {
          provider: state.provider,
          model: state.model,
          temperature: state.temperature,
          system: sys,
          nonStreaming: true,
          responseFormat:
            state.provider === 'deepseek' ? { type: 'json_object' } : undefined,
        };

        let parsed: z.infer<typeof ZXhsDraft> | null = null;
        let lastNormalized = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          const prompt =
            attempt === 0
              ? JSON.stringify(basePayload, null, 2)
              : JSON.stringify(
                  {
                    task: 'Fix previous output to match schema',
                    previousOutput: lastNormalized,
                    required: {
                      schema:
                        '{ "title": string, "content": string, "tags"?: string[], "imageQuery"?: string }',
                      must: ['Only output JSON object'],
                    },
                    basePayload,
                  },
                  null,
                  2,
                );

          const messages: BaseMessage[] = [
            new SystemMessage(sys),
            new HumanMessage(prompt),
          ];

          let normalized = '';
          try {
            const ai = await this.agent.runWithMessages({ config, messages });
            const content = (ai as unknown as { content?: unknown }).content;
            const raw =
              typeof content === 'string'
                ? content
                : JSON.stringify(content ?? '');
            normalized = this.format.normalizeJsonText(raw);
            lastNormalized = normalized;
          } catch {
            void 0;
          }

          if (!normalized || normalized.trim().length === 0) continue;

          try {
            const obj = JSON.parse(normalized) as unknown;
            const ok = ZXhsDraft.safeParse(obj);
            if (ok.success) {
              parsed = ok.data;
              break;
            }
          } catch {
            void 0;
          }
        }

        if (!parsed) {
          await this.batch.updatePostProgress({
            batchTaskId: state.batchTaskId,
            postId: current.postId,
            status: 'failed',
            stage: '生成失败',
            doneNote: 'LLM_OUTPUT_INVALID',
          });
          return { idx: state.idx + 1 };
        }

        const chosenTagsRaw = Array.isArray(parsed.tags) ? parsed.tags : [];
        const chosenTags = chosenTagsRaw
          .map((x) => String(x ?? '').trim())
          .filter((x) => x.length > 0 && state.availableTags.includes(x))
          .slice(0, 6);

        const usedSet = new Set<string>(state.usedImageKeys ?? []);
        const pickImages = async (): Promise<{
          imageUrls: string[];
          imageIds: number[];
        }> => {
          const query =
            typeof parsed?.imageQuery === 'string' &&
            parsed.imageQuery.trim().length > 0
              ? parsed.imageQuery.trim()
              : refImageQuery;

          const byQuery = query
            ? await this.gallery.searchSimilar(
                query,
                state.galleryUserId,
                24,
                state.minImageScore,
              )
            : [];

          const byQueryFiltered =
            typeof state.galleryGroupId === 'number'
              ? byQuery
                  .map((r) => r.image)
                  .filter((img) => img.groupId === state.galleryGroupId)
              : byQuery.map((r) => r.image);

          const byTags =
            chosenTags.length > 0
              ? await this.gallery.searchByTags({
                  userId: state.galleryUserId,
                  groupId: state.galleryGroupId,
                  tags: chosenTags,
                  limit: 48,
                })
              : [];

          const randomList = await this.gallery.sampleRandom({
            userId: state.galleryUserId,
            groupId: state.galleryGroupId,
            limit: 48,
          });

          const pool = [...byQueryFiltered, ...byTags, ...randomList]
            .map((it) => {
              const id = typeof it.id === 'number' ? it.id : undefined;
              const url =
                typeof it.url === 'string' ? it.url.trim() : undefined;
              const keyId = typeof id === 'number' ? `id:${id}` : undefined;
              const keyUrl = url ? `url:${url}` : undefined;
              return { id, url, keyId, keyUrl };
            })
            .filter((it) => it.id || it.url);

          const imageUrls: string[] = [];
          const imageIds: number[] = [];
          for (const it of pool) {
            if (imageUrls.length >= 3) break;
            if (it.keyId && usedSet.has(it.keyId)) continue;
            if (it.keyUrl && usedSet.has(it.keyUrl)) continue;
            if (typeof it.url === 'string' && it.url.length > 0)
              imageUrls.push(it.url);
            if (typeof it.id === 'number' && Number.isFinite(it.id))
              imageIds.push(it.id);
            if (it.keyId) usedSet.add(it.keyId);
            if (it.keyUrl) usedSet.add(it.keyUrl);
          }
          return { imageUrls, imageIds };
        };

        const images = await pickImages();

        if (typeof current.refArticleId === 'number') {
          await this.canvas.updateArticleImages(
            state.canvasId,
            current.refArticleId,
            {
              imageUrls: images.imageUrls,
              imageIds: images.imageIds,
              status: 'done',
              doneNote: 'REIMAGE_FOR_XHS_BATCH',
            },
          );
        }

        const enqueuePayload: Record<string, unknown> = {
          platform: 'xhs',
          content: parsed.content,
          tags: chosenTags,
          imageUrls: images.imageUrls,
          imageIds: images.imageIds,
          canvasId: state.canvasId,
          refArticleId: current.refArticleId,
          refIndex: current.refIndex,
          refTitle: current.refTitle,
          ...(state.payload ?? {}),
        };

        await this.batch.enqueuePost({
          batchTaskId: state.batchTaskId,
          postId: current.postId,
          title: parsed.title,
          plannedAt: current.plannedAt,
          payload: enqueuePayload,
        });

        return {
          idx: state.idx + 1,
          usedImageKeys: Array.from(usedSet),
        };
      })
      .addNode('run_task', async (state) => {
        await this.batch.run(state.batchTaskId, {
          callbackUrl: state.callbackUrl,
          payload: {
            canvasId: state.canvasId,
            ...(state.payload ?? {}),
          },
        });
        return {};
      })
      .addEdge(START, 'load_context')
      .addConditionalEdges('load_context', () => 'generate_one', {
        generate_one: 'generate_one',
      })
      .addConditionalEdges(
        'generate_one',
        (state) =>
          state.idx >= state.posts.length ? 'run_task' : 'generate_one',
        {
          generate_one: 'generate_one',
          run_task: 'run_task',
        },
      )
      .addEdge('run_task', END);

    const app = workflow.compile();
    await app.invoke({
      userId: input.userId,
      canvasId: input.canvasId,
      batchTaskId: input.batchTaskId,
      mcpTaskId: input.mcpTaskId,
      galleryUserId: input.galleryUserId,
      galleryGroupId: input.galleryGroupId,
      minImageScore:
        typeof input.minImageScore === 'number' &&
        Number.isFinite(input.minImageScore)
          ? input.minImageScore
          : 0.62,
      callbackUrl: input.callbackUrl,
      payload: input.payload,
      provider: input.provider ?? 'deepseek',
      model: input.model ?? 'deepseek-chat',
      temperature:
        typeof input.temperature === 'number' &&
        Number.isFinite(input.temperature)
          ? input.temperature
          : 0.2,
    });
  }
}
