import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(GraphWorkflowFunctionCallService.name);
  private readonly orchestrateInFlight = new Map<string, Promise<string>>();
  private readonly orchestrateRecent = new Map<
    string,
    { at: number; result: string }
  >();
  private readonly orchestrateTtlMs = 120000;

  constructor(
    private readonly articles: ArticleGraphService,
    private readonly batch: BatchTaskGraphService,
    private readonly canvas: CanvasService,
    private readonly gallery: GalleryService,
  ) {}

  /**
   * @description 判定标签/描述是否包含封面语义。
   * @param {string[]} tags - 标签数组。
   * @param {string | undefined} description - 图片描述。
   * @returns {boolean} 是否封面语义。
   * @keyword-en detect cover-like semantics
   */
  private isCoverLike(tags: string[], description?: string): boolean {
    const text = [
      ...(Array.isArray(tags) ? tags : []),
      typeof description === 'string' ? description : '',
    ]
      .map((x) =>
        String(x ?? '')
          .trim()
          .toLowerCase(),
      )
      .filter((x) => x.length > 0)
      .join(' ');
    if (!text) return false;
    return /(封面|拼图封面|自动封面|canvas封面|cover)/i.test(text);
  }

  /**
   * @description 按目标图片类型判断是否命中。
   * @param {{ isCollage?: boolean; tags?: string[]; description?: string }} image - 图片对象。
   * @param {'all' | 'regular' | 'collage' | undefined} type - 目标类型。
   * @returns {boolean} 是否命中类型。
   * @keyword-en classify image by type
   */
  private isMatchedImageType(
    image: { isCollage?: boolean; tags?: string[]; description?: string },
    type: 'all' | 'regular' | 'collage' | undefined,
  ): boolean {
    const resolvedType = type ?? 'regular';
    const isCollage = image?.isCollage === true;
    if (resolvedType === 'all') return true;
    if (resolvedType === 'collage') {
      return isCollage || this.isCoverLike(image.tags ?? [], image.description);
    }
    if (isCollage) return false;
    if (this.isCoverLike(image.tags ?? [], image.description)) return false;
    return true;
  }

  private normalizeKeyString(v: unknown): string {
    if (typeof v === 'string') return v.trim().toLowerCase();
    if (typeof v === 'number' || typeof v === 'boolean') {
      return String(v).trim().toLowerCase();
    }
    return '';
  }

  private stableStringify(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      return `[${v.map((x) => this.stableStringify(x)).join(',')}]`;
    }
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).sort((a, b) => a.localeCompare(b));
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${this.stableStringify(rec[k])}`)
      .join(',')}}`;
  }

  private buildTopicOrchestrateDedupKey(input: {
    userId: string;
    platform?: string;
    topic?: string;
    userPrompt?: string;
    dataSummary?: string;
    writingStyle?: string;
    outline?: Record<string, unknown>;
    style?: Record<string, unknown>;
    count?: number;
    galleryUserId?: string;
    galleryGroupId?: number;
    imageGroupCanvasIds?: number[];
    minImageScore?: number;
    dedup?: boolean;
  }): string {
    return [
      this.normalizeKeyString(input.userId),
      this.normalizeKeyString(input.platform),
      this.normalizeKeyString(input.topic),
      this.normalizeKeyString(input.userPrompt),
      this.normalizeKeyString(input.dataSummary),
      this.normalizeKeyString(input.writingStyle),
      this.stableStringify(input.outline),
      this.stableStringify(input.style),
      Number.isFinite(Number(input.count)) ? String(Number(input.count)) : '',
      this.normalizeKeyString(input.galleryUserId),
      Number.isFinite(Number(input.galleryGroupId))
        ? String(Number(input.galleryGroupId))
        : '',
      Array.isArray(input.imageGroupCanvasIds)
        ? input.imageGroupCanvasIds
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0)
            .map((n) => Math.floor(n))
            .sort((a, b) => a - b)
            .join(',')
        : '',
      Number.isFinite(Number(input.minImageScore))
        ? String(Number(input.minImageScore))
        : '',
      input.dedup === false ? 'nodedup' : 'dedup',
    ].join('|');
  }

  private clearExpiredOrchestrateCache(now: number): void {
    for (const [k, v] of this.orchestrateRecent.entries()) {
      if (now - v.at > this.orchestrateTtlMs) this.orchestrateRecent.delete(k);
    }
  }

  /**
   * @description 归一化用户/LLM指定的文章篇数，不做 6-8 强制限制。
   * @param {number | undefined} count - 用户输入数量。
   * @returns {number | undefined} 归一化后的数量。
   * @keyword-en normalize requested article count
   */
  private normalizeRequestedArticleCount(
    count: number | undefined,
  ): number | undefined {
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      return undefined;
    }
    const parsed = Math.trunc(count);
    return Math.max(1, parsed);
  }

  /**
   * @description 从用户提示、数据摘要或主题中提取显式文章篇数，防止“开始生成”等延续指令被模型压成 1 篇。
   * @param {unknown[]} parts - 候选文本片段。
   * @returns {number | undefined} 识别到的文章篇数。
   * @keyword-cn 篇数提取, 意图延续, 图文生成
   * @keyword-en extract-article-count, continuation-intent, article-generation
   */
  private extractArticleCountFromText(...parts: unknown[]): number | undefined {
    const text = parts
      .filter((part): part is string => typeof part === 'string')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join('\n');
    if (!text) return undefined;

    const digitMatch = text.match(
      /(?:生成|写|来|产出|出|做|准备|确认|共|总共|一共)?\s*(\d{1,2})\s*(?:篇|篇图文|篇文章|篇笔记|个选题|组图文|组笔记|组)/,
    );
    if (digitMatch) {
      const n = Number.parseInt(digitMatch[1], 10);
      if (Number.isFinite(n) && n > 0) return Math.min(20, n);
    }

    const cnMap: Record<string, number> = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
    };
    const cnMatch = text.match(
      /(?:生成|写|来|产出|出|做|准备|确认|共|总共|一共)?\s*([一二两三四五六七八九十])\s*(?:篇|篇图文|篇文章|篇笔记|个选题|组图文|组笔记|组)/,
    );
    if (cnMatch) {
      const n = cnMap[cnMatch[1]];
      if (Number.isFinite(n) && n > 0) return n;
    }
    return undefined;
  }

  private resolveScopedUserId(
    userId: string | undefined,
    scope?: { tenantId?: string; userId?: string },
  ): string {
    const scoped = scope?.userId?.trim();
    const requested = typeof userId === 'string' ? userId.trim() : '';
    if (scoped) {
      // 作用域用户是硬限制：当工具参数与作用域冲突时，强制使用作用域用户而不是抛错中断流程
      return scoped;
    }
    return requested || 'default';
  }

  private resolveScopedOptionalUserId(
    userId: string | undefined,
    scope?: { tenantId?: string; userId?: string },
  ): string | undefined {
    const scoped = scope?.userId?.trim();
    const requested = typeof userId === 'string' ? userId.trim() : '';
    if (scoped) {
      // 作用域用户优先，参数仅作补充
      return scoped;
    }
    return requested || undefined;
  }

  private resolveScopedGalleryUserId(
    galleryUserId: string | undefined,
    finalUserId: string,
    scope?: { tenantId?: string; userId?: string },
  ): string {
    const scoped = scope?.userId?.trim();
    const requested =
      typeof galleryUserId === 'string' ? galleryUserId.trim() : '';
    if (scoped) {
      // 图库 owner 也必须受同一作用域约束
      return scoped;
    }
    return requested || finalUserId;
  }

  /**
   * @description 归一化平台类型标签：小红书相关别名统一为 "xhs"，其余保持原值。
   * 当前有效值：普通 | xhs。
   * @param {string | undefined} platform - 原始平台标签。
   * @returns {string | undefined} 归一化后的平台标签。
   * @keyword-en normalize platform type, xhs alias soft correct
   */
  private normalizePlatformType(platform?: string): string | undefined {
    if (!platform) return platform;
    const t = platform.trim();
    if (!t) return platform;
    if (/小红书|xhs/i.test(t)) return 'xhs';
    return t;
  }

  /**
   * @description 从显式 writingStyle 或兼容的 style 对象中解析生文风格。
   * @param {string | undefined} writingStyle - 工具显式文风参数。
   * @param {Record<string, unknown> | undefined} style - 兼容旧 style 对象。
   * @param {string | undefined} platform - 平台标签。
   * @returns {string | undefined} 解析后的文风。
   * @keyword-en resolve topic writing style
   */
  private resolveTopicWritingStyle(
    writingStyle: string | undefined,
    style: Record<string, unknown> | undefined,
    platform: string | undefined,
  ): string | undefined {
    const explicit =
      typeof writingStyle === 'string' ? writingStyle.trim() : '';
    if (explicit) return explicit.slice(0, 120);
    const styleKeys = ['writingStyle', 'writing_style', 'articleStyle', 'tone'];
    for (const key of styleKeys) {
      const value = style?.[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim().slice(0, 120);
      }
    }
    if (platform && /知乎|zhihu/i.test(platform)) return '知乎理性分析文风';
    if (platform && /公众号|wechat|weixin/i.test(platform))
      return '公众号深度叙事文风';
    if (platform && /小红书|xhs/i.test(platform)) return '小红书真实分享文风';
    return undefined;
  }

  /**
   * @description 返回 Graph 工作流相关的工具句柄集合（topic_orchestrate）。
   * @param {(msg: string) => void} [streamWriter] - 可选的流式日志输出。
   * @returns {CreateAgentParams['tools']} 工具集合。
   * @keyword graph, workflow, tools
   * @since 2026-02-04
   */
  getHandle(
    streamWriter?: (msg: string) => void,
    scope?: { tenantId?: string; userId?: string },
  ): CreateAgentParams['tools'] {
    /** LLM 有时将 outline/style 序列化为 JSON 字符串，此处统一反序列化 */
    const coerceRecord = (v: unknown): Record<string, unknown> | undefined => {
      if (!v) return undefined;
      if (typeof v === 'object' && !Array.isArray(v))
        return v as Record<string, unknown>;
      if (typeof v === 'string') {
        try {
          const p = JSON.parse(v);
          if (p && typeof p === 'object' && !Array.isArray(p))
            return p as Record<string, unknown>;
        } catch {
          /* ignore */
        }
      }
      return undefined;
    };

    const topicOrchestrate = tool(
      async ({
        userId,
        platform,
        topic,
        userPrompt,
        dataSummary,
        writingStyle,
        outline: outlineRaw,
        style: styleRaw,
        count,
        galleryUserId,
        galleryGroupId,
        imageGroupCanvasIds,
        minImageScore,
        dedup,
      }) => {
        const outline = coerceRecord(outlineRaw);
        const style = coerceRecord(styleRaw);
        const finalWritingStyle = this.resolveTopicWritingStyle(
          writingStyle,
          style,
          platform,
        );
        const modelRequestedCount = this.normalizeRequestedArticleCount(count);
        const explicitTextCount = this.extractArticleCountFromText(
          userPrompt,
          dataSummary,
          topic,
        );
        const requestedCount =
          explicitTextCount &&
          (!modelRequestedCount ||
            modelRequestedCount === 1 ||
            explicitTextCount > modelRequestedCount)
            ? explicitTextCount
            : modelRequestedCount;
        const normalizedImageGroupCanvasIds = Array.isArray(imageGroupCanvasIds)
          ? Array.from(
              new Set(
                imageGroupCanvasIds
                  .map((x) => Number(x))
                  .filter((n) => Number.isFinite(n) && n > 0)
                  .map((n) => Math.floor(n)),
              ),
            )
          : [];
        if (typeof galleryGroupId === 'string') {
          const msg =
            '[topic_orchestrate] galleryGroupId must be a number (group ID), not a string. Please provide the numeric group ID. You may need to look up the group ID first using gallery_group_find.';
          this.logger.warn(msg);
          return JSON.stringify({
            ok: false,
            error: 'GALLERY_GROUP_ID_MUST_BE_NUMBER',
            message: msg,
          });
        }
        if (streamWriter) streamWriter('[Graph] Orchestrating topic workflow');
        const finalUserId = this.resolveScopedUserId(userId, scope);
        const finalPlatform = this.normalizePlatformType(platform);
        const finalGalleryUserId = this.resolveScopedGalleryUserId(
          galleryUserId,
          finalUserId,
          scope,
        );
        this.logger.log(
          `[topic_orchestrate] start userId=${finalUserId} platform=${String(finalPlatform ?? '')} requestedCount=${requestedCount ?? 'auto'} topic=${String(topic ?? '')} dataSummaryLen=${String(dataSummary?.length ?? 0)} userPromptLen=${String(userPrompt?.length ?? 0)}`,
        );

        const dedupKey = this.buildTopicOrchestrateDedupKey({
          userId: finalUserId,
          platform: finalPlatform,
          topic,
          userPrompt,
          dataSummary,
          writingStyle: finalWritingStyle,
          outline,
          style,
          count: requestedCount,
          galleryUserId: finalGalleryUserId,
          galleryGroupId,
          imageGroupCanvasIds: normalizedImageGroupCanvasIds,
          minImageScore,
          dedup,
        });
        const now = Date.now();
        this.clearExpiredOrchestrateCache(now);
        const recent = this.orchestrateRecent.get(dedupKey);
        if (recent && now - recent.at <= this.orchestrateTtlMs) {
          if (streamWriter) {
            streamWriter('[Graph] Reusing recent topic_orchestrate result');
          }
          return recent.result;
        }
        const inflight = this.orchestrateInFlight.get(dedupKey);
        if (inflight) {
          if (streamWriter) {
            streamWriter('[Graph] Waiting existing topic_orchestrate run');
          }
          return await inflight;
        }

        const runPromise = (async () => {
          const gen = await this.articles.generateToCanvas({
            userId: finalUserId,
            tenantId: scope?.tenantId,
            platform: finalPlatform,
            topic,
            userPrompt,
            dataSummary,
            writingStyle: finalWritingStyle,
            count: requestedCount,
            imageMode: 'image-group',
            galleryUserId: finalGalleryUserId,
            galleryGroupId,
            imageGroupCanvasIds: normalizedImageGroupCanvasIds,
            minImageScore,
            dedup: dedup === false ? false : undefined,
            langchainContext: {
              source: 'tool.topic_orchestrate',
              userId: finalUserId,
              tenantId: scope?.tenantId,
              platform: finalPlatform,
              topic,
            },
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
          const canvasRec =
            canvas && typeof canvas === 'object'
              ? (canvas as Record<string, unknown>)
              : undefined;
          const genStatus =
            typeof genObj['status'] === 'string'
              ? String(genObj['status'])
              : undefined;
          const imageStats =
            genObj['imageStats'] && typeof genObj['imageStats'] === 'object'
              ? (genObj['imageStats'] as Record<string, unknown>)
              : undefined;
          const articleCount =
            typeof canvasRec?.['articleCount'] === 'number'
              ? canvasRec['articleCount']
              : typeof genObj['articleCount'] === 'number'
                ? genObj['articleCount']
                : undefined;

          const base: Record<string, unknown> = {
            ok: genObj['ok'] !== false,
            canvasId,
            platform: finalPlatform,
            topic,
            requestedCount,
            status:
              typeof canvasRec?.['status'] === 'string'
                ? canvasRec['status']
                : genStatus,
            articleCount,
            needHuman:
              needFields.length > 0 ||
              canvasRec?.['status'] === 'requires_human' ||
              genObj['ok'] === false ||
              genStatus === 'missing_image_tags' ||
              genStatus === 'insufficient_images' ||
              genStatus === 'insufficient_image_groups',
            needFields,
            perArticleImageTarget: '6-8',
          };
          const cid =
            typeof canvasId === 'number' ? canvasId : Number(canvasId);
          if (Number.isFinite(cid)) {
            this.logger.log(
              `[topic_orchestrate] canvas_ready canvasId=${String(canvasId ?? '')} articleCount=${String(base.articleCount ?? '')} requestedCount=${requestedCount ?? 'auto'} needHuman=${base.needHuman ? 'true' : 'false'}`,
            );
          } else {
            this.logger.warn(
              `[topic_orchestrate] canvas_not_created status=${String(base.status ?? 'unknown')} articleCount=${String(base.articleCount ?? '')} requestedCount=${requestedCount ?? 'auto'} needHuman=${base.needHuman ? 'true' : 'false'}`,
            );
          }

          // 拼接 canvas-it 代码块（与 xhs_create_image_group_canvas 保持一致），让子代理原样透传给上层，前端立即渲染看板入口
          const canvasBlock = Number.isFinite(cid)
            ? `\`\`\`canvas-it\n${JSON.stringify({ canvasId: cid, status: base.status ?? 'generating', type: 'article', topic: String(topic ?? ''), articleCount: base.articleCount ?? 0 })}\n\`\`\``
            : '';
          const statsText = imageStats
            ? `竖图 ${String(imageStats['availablePortrait'] ?? 0)}/${String(imageStats['requiredPortrait'] ?? 0)}，横图 ${String(imageStats['availableLandscape'] ?? 0)}/${String(imageStats['requiredLandscape'] ?? 0)}`
            : '';
          const summary = Number.isFinite(cid)
            ? `图文 Canvas 已创建并开始生成，canvasId=${cid}，文章数=${String(base.articleCount ?? requestedCount ?? 0)}，状态=${String(base.status ?? 'generating')}。`
            : genStatus === 'missing_image_tags' ||
                genStatus === 'insufficient_images' ||
                genStatus === 'insufficient_image_groups'
              ? `图文生成前置检查未通过，已停止创建图文 Canvas；文章数=${String(articleCount ?? requestedCount ?? 0)}，原因=${needFields.join('、') || String(genObj['reason'] ?? '图片素材不足')}。${statsText ? `素材情况：${statsText}。` : ''}`
              : `图文 Canvas 未创建，状态=${String(base.status ?? 'unknown')}。`;
          return [
            summary,
            base.needHuman && Number.isFinite(cid)
              ? `当前 Canvas 可能需要人工补充素材：${needFields.join('、') || '图片素材不足'}。`
              : '',
            canvasBlock
              ? `请只将以下 canvas-it 代码块原样输出给用户（不要输出工具 JSON、canvas 对象或文章 items）：`
              : '',
            canvasBlock,
          ]
            .filter(Boolean)
            .join('\n');
        })();
        this.orchestrateInFlight.set(dedupKey, runPromise);
        try {
          const result = await runPromise;
          if (result.includes('```canvas-it')) {
            this.orchestrateRecent.set(dedupKey, { at: Date.now(), result });
          }
          return result;
        } finally {
          this.logger.log(
            `[topic_orchestrate] end dedupKey=${dedupKey.slice(0, 60)}...`,
          );
          this.orchestrateInFlight.delete(dedupKey);
        }
      },
      {
        name: 'topic_orchestrate',
        description:
          'Topic Orchestration Tool. Generates articles in a SINGLE Canvas based on user requirements and merges image-group matching into each article. Image matching requires explicit gallery tags in userPrompt (e.g. #月亮湾 #生日派对) unless imageGroupCanvasIds are provided; never invent/search tags yourself. Article count follows user/LLM request when provided; for continuation confirmations like "开始生成", preserve the count already confirmed in recent context. **CRITICAL — ONE CALL PER REQUEST**: when user asks for N articles, set count=N and call this tool ONCE; the N articles all live in the same Canvas. Never loop-call this tool to produce multiple Canvases for the same request.',
        schema: z.object({
          userId: z
            .string()
            .optional()
            .describe(
              'Target user id (injected from session scope if omitted)',
            ),
          platform: z.string().optional().describe('Publishing platform label'),
          topic: z.string().optional().describe('Topic for the canvas'),
          userPrompt: z
            .string()
            .optional()
            .describe(
              'User original intent/prompt summary for article generation context. Must include explicit gallery tags like #tag when image matching is needed and no imageGroupCanvasIds are provided.',
            ),
          dataSummary: z
            .string()
            .optional()
            .describe(
              'Collected data summary (facts/trends/evidence) used to ground article generation',
            ),
          writingStyle: z
            .string()
            .optional()
            .describe(
              'Confirmed article writing style, e.g. 小红书真实分享、知乎理性分析、公众号深度叙事. Ask user before calling if unclear.',
            ),
          outline: z
            .union([z.record(z.string(), z.any()), z.string()])
            .optional()
            .describe('Outline object (optional; auto-generated if omitted)'),
          style: z
            .union([z.record(z.string(), z.any()), z.string()])
            .optional()
            .describe('Style object (optional; auto-generated if omitted)'),
          count: z
            .number()
            .optional()
            .describe(
              'Article count for THIS Canvas. Preserve previously confirmed N on continuation/confirmation messages; set total N when user asks for N articles; do NOT split into multiple count=1 calls.',
            ),
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
          imageGroupCanvasIds: z
            .array(z.number().int().positive())
            .optional()
            .describe(
              'Optional image-group canvas IDs. When provided, reuse currently unused canvas image groups as article image sources by order; after successful article image assignment, consumed source groups are automatically marked used.',
            ),
          dedup: z
            .boolean()
            .optional()
            .describe(
              '是否图片去重，默认 true(去重: 排除已用图、每张源图只用一次)。当用户消息包含"不去重"/"允许重复"/"可重复取图"等意图时传 false(不去重: 按标签取图不排除已用图，图片可复用)。用户未提及则不传。',
            ),
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
        if (!userId) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'userId 参数必填',
          });
        }
        if (!canvasId) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'canvasId 参数必填',
          });
        }
        const finalUserId = this.resolveScopedUserId(userId, scope);
        const finalPlatformExec = this.normalizePlatformType(platform);
        const finalGalleryUserId = this.resolveScopedGalleryUserId(
          galleryUserId,
          finalUserId,
          scope,
        );
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
            userId: finalUserId,
            canvasId,
            platform: finalPlatformExec,
            galleryUserId: finalGalleryUserId,
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
            `[Graph] Executing canvas workflow (canvasId=${canvasIdNum}, platform=${String(finalPlatformExec ?? '')})`,
          );
        }
        const res = await this.batch.runFromCanvas({
          userId: finalUserId,
          canvasId: canvasIdNum,
          platform: finalPlatformExec,
          galleryUserId: finalGalleryUserId,
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
          userId: z.string().optional().describe('Target user id (required)'),
          canvasId: z
            .union([z.number(), z.string()])
            .optional()
            .describe('Canvas id (required)'),
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
            .record(z.string(), z.any())
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
        if (!userId) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'userId 参数必填',
          });
        }
        if (!canvasId) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'canvasId 参数必填',
          });
        }
        if (taskCount === undefined || taskCount === null) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'taskCount 参数必填',
          });
        }
        const finalUserId = this.resolveScopedUserId(userId, scope);
        const finalPlatformXhs = this.normalizePlatformType(platform);
        const finalGalleryUserId = this.resolveScopedGalleryUserId(
          galleryUserId,
          finalUserId,
          scope,
        );
        const canvasIdNum = Number(canvasId);
        if (!Number.isFinite(canvasIdNum)) {
          return JSON.stringify({ ok: false, error: 'CANVAS_ID_INVALID' });
        }

        console.log('[xhs_batch_publish] payload', {
          userId: finalUserId,
          canvasId: canvasIdNum,
          platform: finalPlatformXhs,
          galleryUserId: finalGalleryUserId,
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
            userId: finalUserId,
            canvasId: canvasIdNum,
            platform: finalPlatformXhs,
            galleryUserId: finalGalleryUserId,
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
          'XHS Batch Publish Tool. Creates an async queue job, then runs the publish graph in the background. IMPORTANT: Provide taskCount; Canvas articles are only references for generation.',
        schema: z.object({
          userId: z.string().optional().describe('Target user id (required)'),
          canvasId: z
            .union([z.number(), z.string()])
            .optional()
            .describe('Canvas id (required)'),
          taskCount: z
            .number()
            .optional()
            .describe('Number of posts to generate (required)'),
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
            .record(z.string(), z.any())
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
        count,
        galleryUserId,
        galleryGroupId,
        minImageScore,
        plannedAtStart,
        intervalMinutes,
        concurrency,
        callbackUrl,
        payload,
      }) => {
        const finalUserId = this.resolveScopedUserId(userId, scope);
        const finalGalleryUserId = this.resolveScopedGalleryUserId(
          galleryUserId,
          finalUserId,
          scope,
        );
        let canvasIdNum = Number(canvasId);
        let canvas: unknown = undefined;
        let needFields: string[] = [];
        if (!Number.isFinite(canvasIdNum)) {
          if (streamWriter)
            streamWriter(
              '[Graph] Orchestrating topic workflow (batch publish)',
            );

          const gen = await this.articles.generateToCanvas({
            userId: finalUserId,
            tenantId: scope?.tenantId,
            platform,
            topic,
            count,
            galleryUserId: finalGalleryUserId,
            galleryGroupId,
            minImageScore,
            langchainContext: {
              source: 'tool.batch_publish_auto_generate',
              userId: finalUserId,
              tenantId: scope?.tenantId,
              platform,
              topic,
            },
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
          userId: finalUserId,
          canvasId: canvasIdNum,
          platform,
          galleryUserId: finalGalleryUserId,
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
          userId: z.string().optional().describe('Target user id (required)'),
          canvasId: z
            .union([z.number(), z.string()])
            .optional()
            .describe('Existing canvas id (optional) to run directly'),
          platform: z.string().optional().describe('Publishing platform label'),
          topic: z.string().optional().describe('Topic for the canvas'),
          outline: z
            .union([z.record(z.string(), z.any()), z.string()])
            .optional()
            .describe('Outline object (optional; auto-generated if omitted)'),
          style: z
            .union([z.record(z.string(), z.any()), z.string()])
            .optional()
            .describe('Style object (optional; auto-generated if omitted)'),
          count: z
            .number()
            .optional()
            .describe('Article count (max 5, default 3)'),
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
          concurrency: z
            .number()
            .optional()
            .describe('Max concurrency for enqueue calls'),
          callbackUrl: z
            .string()
            .optional()
            .describe('Callback URL for MCP task status updates'),
          payload: z
            .record(z.string(), z.any())
            .optional()
            .describe('Extra payload merged into each post and run request'),
        }),
      },
    );

    void canvasExecute;
    void batchPublish;

    const canvasAppendArticle = tool(
      async ({ canvasId, title, tags, markdown, imageQuery, meta }) => {
        if (!canvasId) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'canvasId 参数必填',
          });
        }
        if (!title) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'title 参数必填',
          });
        }
        if (!markdown) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'markdown 参数必填',
          });
        }
        const canvasIdNum = Number(canvasId);
        if (!Number.isFinite(canvasIdNum)) {
          return JSON.stringify({ ok: false, error: 'CANVAS_ID_INVALID' });
        }
        const next = await this.canvas.addArticles(canvasIdNum, {
          articles: [
            {
              title: String(title || '').trim() || '示例文章',
              tags: Array.isArray(tags)
                ? tags
                    .map((x) => String(x ?? '').trim())
                    .filter((x) => x.length > 0)
                : [],
              contentJson: {
                markdown: String(markdown || '').trim(),
                imageQuery:
                  typeof imageQuery === 'string' && imageQuery.trim().length > 0
                    ? imageQuery.trim()
                    : undefined,
                meta: meta && typeof meta === 'object' ? meta : {},
              },
            },
          ],
        });
        if (!next)
          return JSON.stringify({ ok: false, error: 'CANVAS_NOT_FOUND' });
        const articles = Array.isArray(next.articles) ? next.articles : [];
        const last =
          articles.length > 0 ? articles[articles.length - 1] : undefined;
        return JSON.stringify({
          ok: true,
          canvasId: canvasIdNum,
          articleId: last?.id,
          articleCount: articles.length,
          status: next.status,
        });
      },
      {
        name: 'canvas_append_article',
        description:
          'Canvas Append Article Tool. Writes exactly one article into a canvas each call.',
        schema: z.object({
          canvasId: z
            .union([z.number(), z.string()])
            .optional()
            .describe('Canvas id (required)'),
          title: z.string().optional().describe('Article title (required)'),
          tags: z.array(z.string()).optional().describe('Article tags'),
          markdown: z
            .string()
            .optional()
            .describe('Article markdown content (required)'),
          imageQuery: z.string().optional().describe('Image retrieval query'),
          meta: z
            .record(z.string(), z.any())
            .optional()
            .describe('Article generation metadata'),
        }),
      },
    );

    // 新增：获取 canvas 详情工具，让 LLM 能查看实际数据
    const getCanvasDetail = tool(
      async ({ canvasId }) => {
        if (!canvasId) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'canvasId 参数必填',
          });
        }
        const canvasIdNum = Number(canvasId);
        if (!Number.isFinite(canvasIdNum)) {
          return JSON.stringify({ ok: false, error: 'CANVAS_ID_INVALID' });
        }

        try {
          const c = await this.canvas.get(canvasIdNum);
          if (!c) {
            return JSON.stringify({ ok: false, error: 'CANVAS_NOT_FOUND' });
          }
          const scopedUserId = scope?.userId?.trim();
          if (scopedUserId && c.userId !== scopedUserId) {
            return JSON.stringify({
              ok: false,
              error: 'CANVAS_SCOPE_FORBIDDEN',
            });
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
            .optional()
            .describe('Canvas id to get details for (required)'),
        }),
      },
    );

    const galleryListTags = tool(
      async ({ userId, groupId, limit }) => {
        const uid = this.resolveScopedOptionalUserId(userId, scope);
        const tid = scope?.tenantId?.trim() || undefined;
        const gid =
          groupId !== undefined &&
          ((typeof groupId === 'number' && Number.isFinite(groupId)) ||
            typeof groupId === 'string')
            ? groupId
            : undefined;
        const lim =
          typeof limit === 'number' && Number.isFinite(limit)
            ? Math.max(1, Math.min(5000, Math.floor(limit)))
            : 500;
        const tags = await this.gallery.listDistinctTagsWithTenant(
          uid,
          tid,
          lim,
        );
        return JSON.stringify({ ok: true, tags });
      },
      {
        name: 'gallery_list_tags',
        description:
          'Gallery Tags Tool. Lists all distinct image tags in the gallery, optionally filtered by userId and tenantId.',
        schema: z.object({
          userId: z.string().optional().describe('Gallery owner user id'),
          groupId: z
            .number()
            .optional()
            .describe(
              'Gallery group id filter (deprecated, use tenant isolation)',
            ),
          limit: z
            .number()
            .optional()
            .describe('Max tags to return (default 500)'),
        }),
      },
    );

    const gallerySearchImages = tool(
      async ({ userId, groupId, tags, limit, matchCollage, image_type }) => {
        if (!tags) {
          return JSON.stringify({
            ok: false,
            error: 'PARAM_REQUIRED',
            message: 'tags 参数必填',
          });
        }
        const uid = this.resolveScopedOptionalUserId(userId, scope);
        const tid = scope?.tenantId?.trim() || undefined;
        const gid =
          groupId !== undefined &&
          ((typeof groupId === 'number' && Number.isFinite(groupId)) ||
            typeof groupId === 'string')
            ? groupId
            : undefined;
        const lim =
          typeof limit === 'number' && Number.isFinite(limit)
            ? Math.max(1, Math.min(200, Math.floor(limit)))
            : 12;
        const imageType =
          image_type === 'all' ||
          image_type === 'regular' ||
          image_type === 'collage'
            ? image_type
            : undefined;
        const effectiveMatchCollage =
          imageType === 'regular'
            ? false
            : imageType === 'collage' || imageType === 'all'
              ? true
              : typeof matchCollage === 'boolean'
                ? matchCollage
                : false;
        const fetchLimit =
          imageType === 'collage' ? Math.max(lim, Math.min(200, lim * 4)) : lim;
        const tagList = Array.isArray(tags)
          ? tags.map((t) => String(t ?? '').trim()).filter((t) => t.length > 0)
          : [];
        const images = await this.gallery.searchByTags({
          userId: uid,
          tenantId: tid,
          groupId: gid,
          tags: tagList,
          limit: fetchLimit,
          matchCollage: effectiveMatchCollage,
        });
        const finalImages = images
          .filter((img) => this.isMatchedImageType(img, imageType))
          .slice(0, lim);
        if (!finalImages || finalImages.length === 0) {
          return '未找到匹配的图片。';
        }
        // 只返回纯 markdown 图片语法，让 LLM 直接透传，不附加任何说明文字
        return (finalImages ?? [])
          .map((img) => {
            const displayUrl = img.thumbUrl || img.url;
            const desc =
              typeof img.description === 'string' && img.description.trim()
                ? img.description.trim()
                : '';
            return `![${desc}](${displayUrl})`;
          })
          .join('\n');
      },
      {
        name: 'gallery_search_images',
        description:
          'Gallery Search Tool. Searches images by tag list; typically call gallery_list_tags first, then provide selected tags. IMPORTANT: Return image paths as-is — do NOT prepend any domain, hostname, or base URL. Output markdown image syntax exactly as provided, e.g. ![alt text](/static/uploads/xxx.jpg). Never convert relative paths to absolute URLs.',
        schema: z.object({
          userId: z.string().optional().describe('Gallery owner user id'),
          groupId: z.number().optional().describe('Gallery group id filter'),
          tags: z
            .array(z.string())
            .optional()
            .describe('Selected tags (required)'),
          image_type: z
            .enum(['all', 'regular', 'collage'])
            .optional()
            .describe('Image type filter: regular (default), collage, all'),
          matchCollage: z
            .boolean()
            .optional()
            .describe(
              'Deprecated: whether to include collage images (default false unless image_type overrides)',
            ),
          limit: z
            .number()
            .optional()
            .describe('Max images to return (default 12)'),
        }),
      },
    );

    return [
      topicOrchestrate,
      canvasAppendArticle,
      getCanvasDetail,
      galleryListTags,
      gallerySearchImages,
      xhsBatchPublish,
    ];
  }
}
