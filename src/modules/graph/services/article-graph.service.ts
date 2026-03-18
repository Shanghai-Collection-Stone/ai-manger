import { BadRequestException, Injectable } from '@nestjs/common';
import * as z from 'zod';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { CreateAgentParams } from 'langchain';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { TextFormatService } from '../../format/services/format.service';
import { CanvasService } from '../../canvas/services/canvas.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { McpFunctionCallService } from '../../function-call/mcp/services/mcp.service.js';
import { McpAdaptersService } from '../../function-call/mcp/services/mcp-adapter.service.js';
import { AnalysisFunctionCallService } from '../../function-call/analysis/services/analysis.service.js';

const ZArticleBlueprintPlan = z.object({
  items: z
    .array(
      z.object({
        index: z.number(),
        title: z.string().min(1),
        tags: z.array(z.string()).optional(),
        angle: z.string().optional(),
        imageQuery: z.string().optional(),
        notes: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(5),
});

const ZSingleArticle = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()).optional(),
  markdown: z.string().min(1),
  imageQuery: z.string().optional(),
});

@Injectable()
export class ArticleGraphService {
  constructor(
    private readonly agent: AgentService,
    private readonly format: TextFormatService,
    private readonly canvas: CanvasService,
    private readonly gallery: GalleryService,
    private readonly mcp: McpFunctionCallService,
    private readonly mcpAdapters: McpAdaptersService,
    private readonly analysisTools: AnalysisFunctionCallService,
  ) {}

  private getRetrievalTools(): NonNullable<CreateAgentParams['tools']> {
    const base: NonNullable<CreateAgentParams['tools']> = [];
    const t1 = this.mcp.getHandle() ?? [];
    const t2 = this.mcpAdapters.getTools() ?? [];
    base.push(...t1, ...t2);
    base.push(...(this.analysisTools.getAllDataSourceTools() ?? []));
    return base;
  }

  private parseJsonFromModelText(text: string): unknown {
    const rawText = String(text ?? '');
    const normalized = this.format.normalizeJsonText(rawText);
    try {
      return JSON.parse(normalized) as unknown;
    } catch {
      void 0;
    }

    const removeTrailingCommas = (s: string): string =>
      s.replace(/,\s*([}\]])/g, '$1');

    const tryParse = (
      s: string,
    ): { ok: true; value: unknown } | { ok: false } => {
      const v = this.format.normalizeJsonText(s);
      try {
        return { ok: true, value: JSON.parse(v) as unknown };
      } catch {
        void 0;
      }
      try {
        return {
          ok: true,
          value: JSON.parse(removeTrailingCommas(v)) as unknown,
        };
      } catch {
        return { ok: false };
      }
    };

    const extractedFirst =
      this.extractFirstJsonBlock(rawText) ??
      this.extractFirstJsonBlock(normalized);
    if (extractedFirst) {
      const parsed = tryParse(extractedFirst);
      if (parsed.ok) return parsed.value;
    }

    const extractBetween = (
      open: string,
      close: string,
    ): string | undefined => {
      const start = normalized.indexOf(open);
      const end = normalized.lastIndexOf(close);
      if (start < 0 || end < 0 || end <= start) return undefined;
      return normalized.slice(start, end + 1).trim();
    };

    const obj = extractBetween('{', '}');
    if (obj) {
      const parsed = tryParse(obj);
      if (parsed.ok) return parsed.value;
    }

    const arr = extractBetween('[', ']');
    if (arr) {
      const parsed = tryParse(arr);
      if (parsed.ok) return parsed.value;
    }

    throw new Error('JSON_PARSE_FAILED');
  }

  private extractFirstJsonBlock(text: string): string | undefined {
    const s = String(text ?? '');
    const startObj = s.indexOf('{');
    const startArr = s.indexOf('[');
    let start = -1;
    if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr);
    else start = startObj >= 0 ? startObj : startArr;
    if (start < 0) return undefined;

    let depth = 0;
    let inString = false;
    let quote: string | null = null;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (esc) {
          esc = false;
        } else if (c === '\\') {
          esc = true;
        } else if (quote && c === quote) {
          inString = false;
          quote = null;
        }
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        quote = c;
        continue;
      }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) return s.slice(start, i + 1).trim();
      }
    }
    return undefined;
  }

  private coerceArticleBlueprintPlan(
    candidate: unknown,
    input: { count: number; topic?: string; platform?: string },
  ): unknown {
    const count = Math.max(1, Math.min(5, Math.floor(input.count)));
    const getItems = (v: unknown): unknown[] | undefined => {
      if (!v) return undefined;
      if (Array.isArray(v)) return v as unknown[];
      if (typeof v !== 'object') return undefined;
      const rec = v as Record<string, unknown>;
      const items = rec['items'];
      if (Array.isArray(items)) return items as unknown[];
      const data = rec['data'];
      if (data && typeof data === 'object') {
        const inner = (data as Record<string, unknown>)['items'];
        if (Array.isArray(inner)) return inner as unknown[];
      }
      return undefined;
    };

    const rawItems = getItems(candidate) ?? [];
    const out: Array<Record<string, unknown>> = [];
    for (const it of rawItems) {
      if (out.length >= count) break;
      if (typeof it === 'string') {
        out.push({ title: it });
        continue;
      }
      if (!it || typeof it !== 'object') continue;
      const rec = it as Record<string, unknown>;
      const title =
        (typeof rec['title'] === 'string' && rec['title']) ||
        (typeof rec['name'] === 'string' && rec['name']) ||
        (typeof rec['topic'] === 'string' && rec['topic']) ||
        '';
      const tagsRaw = rec['tags'] ?? rec['keywords'];
      const tags = Array.isArray(tagsRaw)
        ? tagsRaw
            .map((t) => {
              if (
                typeof t === 'string' ||
                typeof t === 'number' ||
                typeof t === 'boolean' ||
                typeof t === 'bigint'
              ) {
                return String(t).trim();
              }
              return '';
            })
            .filter((x) => x.length > 0)
            .slice(0, 12)
        : undefined;
      const angle =
        typeof rec['angle'] === 'string'
          ? rec['angle']
          : typeof rec['desc'] === 'string'
            ? rec['desc']
            : undefined;
      const imageQuery =
        typeof rec['imageQuery'] === 'string'
          ? rec['imageQuery']
          : typeof rec['image_query'] === 'string'
            ? rec['image_query']
            : undefined;
      const notesRaw = rec['notes'] ?? rec['bullets'] ?? rec['points'];
      const notes = Array.isArray(notesRaw)
        ? notesRaw
            .map((n) => {
              if (
                typeof n === 'string' ||
                typeof n === 'number' ||
                typeof n === 'boolean' ||
                typeof n === 'bigint'
              ) {
                return String(n).trim();
              }
              return '';
            })
            .filter((x) => x.length > 0)
            .slice(0, 12)
        : undefined;
      out.push({ title, tags, angle, imageQuery, notes });
    }

    while (out.length < count) {
      const idx = out.length;
      const base = String(input.topic ?? '').trim() || '选题';
      out.push({ title: `${base}：方向${idx + 1}` });
    }

    const normalized = out.map((it, index) => {
      const rec = it;
      const titleRaw = rec['title'];
      const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
      const tagsRaw = rec['tags'];
      const tags = Array.isArray(tagsRaw)
        ? (tagsRaw as unknown[])
            .map((t) => {
              if (typeof t === 'string') return t.trim();
              if (
                typeof t === 'number' ||
                typeof t === 'boolean' ||
                typeof t === 'bigint'
              ) {
                return String(t).trim();
              }
              return '';
            })
            .filter((x) => x.length > 0)
        : undefined;
      return {
        index,
        title: title.length > 0 ? title : `选题：方向${index + 1}`,
        tags,
        angle: typeof rec['angle'] === 'string' ? rec['angle'] : undefined,
        imageQuery:
          typeof rec['imageQuery'] === 'string' ? rec['imageQuery'] : undefined,
        notes: Array.isArray(rec['notes']) ? rec['notes'] : undefined,
      };
    });

    return { items: normalized };
  }

  private extractTextFromModelContent(content: unknown): string {
    if (content === null || content === undefined) return '';
    if (typeof content === 'string') return content;
    if (
      typeof content === 'number' ||
      typeof content === 'boolean' ||
      typeof content === 'bigint'
    ) {
      return String(content);
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (typeof item === 'string') {
          if (item.trim().length > 0) parts.push(item);
          continue;
        }
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const t = rec['text'];
        if (typeof t === 'string' && t.trim().length > 0) {
          parts.push(t);
          continue;
        }
        const c = rec['content'];
        if (typeof c === 'string' && c.trim().length > 0) {
          parts.push(c);
          continue;
        }
      }
      if (parts.length > 0) return parts.join('\n');
      return JSON.stringify(content);
    }
    if (typeof content === 'object') return JSON.stringify(content);
    return '';
  }

  async generateToCanvas(input: {
    userId: string;
    platform?: string;
    topic?: string;
    count?: number;
    galleryUserId?: string;
    galleryGroupId?: number;
    minImageScore?: number;
  }): Promise<Record<string, unknown>> {
    const count =
      typeof input.count === 'number' && Number.isFinite(input.count)
        ? Math.max(1, Math.min(5, Math.floor(input.count)))
        : 3;
    const platform =
      typeof input.platform === 'string' && input.platform.trim().length > 0
        ? input.platform.trim()
        : 'generic';
    const topic =
      typeof input.topic === 'string' && input.topic.trim().length > 0
        ? input.topic.trim()
        : undefined;
    const provider = undefined;
    const model = undefined;
    const temperature = 0.2;
    const galleryUserId =
      typeof input.galleryUserId === 'string' &&
      input.galleryUserId.trim().length > 0
        ? input.galleryUserId.trim()
        : input.userId;
    const galleryGroupId =
      typeof input.galleryGroupId === 'number' &&
      Number.isFinite(input.galleryGroupId)
        ? input.galleryGroupId
        : undefined;
    const minImageScore =
      typeof input.minImageScore === 'number' &&
      Number.isFinite(input.minImageScore)
        ? Math.max(0, Math.min(1, input.minImageScore))
        : 0.5;

    const canvas = await this.canvas.create({
      userId: input.userId,
      topic,
      outline: { topic, platform, articleCount: count },
      style: { platform, language: 'zh-CN' },
    });

    const blueprints = await this.planArticleTasks({
      provider,
      model,
      temperature,
      platform,
      topic,
      count,
    });

    await this.canvas.updateMeta(canvas.id, {
      topic,
      outline: { topic, platform, articleCount: count, blueprints },
    });

    await this.generateArticlesAndImages({
      canvasId: canvas.id,
      blueprints,
      provider,
      model,
      temperature,
      platform,
      topic,
      galleryUserId,
      galleryGroupId,
      minImageScore,
    });

    const after = await this.canvas.get(canvas.id);
    if (!after) throw new BadRequestException('CANVAS_NOT_FOUND');

    const canvasTags = Array.from(
      new Set(
        (after.articles ?? [])
          .flatMap((a) => (Array.isArray(a.tags) ? a.tags : []))
          .map((x) => String(x ?? '').trim())
          .filter((x) => x.length > 0),
      ),
    ).slice(0, 50);

    await this.canvas.updateStatus(canvas.id, 'completed');

    return {
      canvasId: canvas.id,
      canvas: {
        id: canvas.id,
        userId: input.userId,
        topic,
        platform,
        status: 'completed',
        articleCount: Array.isArray(after.articles) ? after.articles.length : 0,
      },
      canvasTags,
    };
  }

  private async planArticleTasks(input: {
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature: number;
    platform: string;
    topic?: string;
    count: number;
  }): Promise<
    Array<{
      index: number;
      title: string;
      tags?: string[];
      angle?: string;
      imageQuery?: string;
      notes?: string[];
    }>
  > {
    const isXhs = /小红书|xhs/i.test(input.platform);
    const sys = [
      '你是文章选题规划器。根据平台和话题，规划多篇文章的选题与切入点。',
      '你必须只输出 JSON 对象，不要输出任何多余字符。',
      '严禁输出 markdown、代码块、解释、前后缀文字。',
      '输出必须可被 JSON.parse 直接解析。',
      `输出 schema：{{ "items": [{{ "index": number, "title": string, "tags"?: string[], "angle"?: string, "imageQuery"?: string, "notes"?: string[] }}] }}。`,
      `items 数组长度必须等于 ${input.count}，index 从 0 开始连续递增。`,
      '每篇文章必须是独立主题，不允许“第1篇/第2篇/上篇/下篇/续篇/连载”这类连续表达。',
      isXhs
        ? '平台是小红书：title 要像真实分享，避免过于论文/教科书。'
        : undefined,
      `示例：{"items":[{"index":0,"title":"示例标题","tags":["tag1"],"angle":"切入点","imageQuery":"配图关键词","notes":["要点1"]}]}`,
    ]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n');

    const config = {
      provider: input.provider,
      model: input.model,
      temperature:
        typeof input.temperature === 'number' &&
        Number.isFinite(input.temperature)
          ? Math.min(0.3, Math.max(0, input.temperature))
          : 0.2,
      nonStreaming: true,
      recursionLimit: 30,
      system: sys,
    };

    const messages: BaseMessage[] = [
      new SystemMessage(sys),
      new HumanMessage(
        JSON.stringify({
          task: 'Plan article tasks',
          platform: input.platform,
          topic: input.topic,
          count: input.count,
        }),
      ),
    ];

    const llm = await this.agent.buildLLM(config);
    let plan = ZArticleBlueprintPlan.safeParse(undefined);
    try {
      const structured = llm.withStructuredOutput(ZArticleBlueprintPlan);
      const output = await structured.invoke(messages);
      console.log('output', output);
      plan = ZArticleBlueprintPlan.safeParse(output);
      if (!plan.success) {
        const coerced = this.coerceArticleBlueprintPlan(output, {
          count: input.count,
          topic: input.topic,
          platform: input.platform,
        });
        plan = ZArticleBlueprintPlan.safeParse(coerced);
      }
    } catch (error) {
      console.error(error);
      void 0;
    }

    if (!plan.success) {
      let lastText = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const payload =
          attempt === 0
            ? {
                task: 'Plan article tasks',
                platform: input.platform,
                topic: input.topic,
                count: input.count,
              }
            : attempt === 1
              ? {
                  task: 'Fix previous output to match schema',
                  previousOutput: lastText,
                  required: {
                    schema:
                      '{ "items": [{"index": number, "title": string, "tags"?: string[], "angle"?: string, "imageQuery"?: string, "notes"?: string[]}] }',
                    must: [
                      'Only output JSON object',
                      `items length must be ${input.count}`,
                      'index must start from 0 and be continuous',
                      'All titles must be non-empty strings',
                    ],
                    outputTemplate: {
                      items: Array.from({ length: input.count }).map(
                        (_, i) => ({
                          index: i,
                          title: `标题${i + 1}`,
                          tags: ['tag1', 'tag2'],
                          angle: '切入点',
                          imageQuery: '配图关键词',
                          notes: ['要点1', '要点2'],
                        }),
                      ),
                    },
                  },
                }
              : {
                  task: 'Rewrite from scratch to match schema strictly',
                  platform: input.platform,
                  topic: input.topic,
                  count: input.count,
                  required: {
                    must: [
                      'Only output JSON object',
                      `items length must be ${input.count}`,
                      'index must start from 0 and be continuous',
                      'Do not add any extra keys',
                    ],
                  },
                };
        const ai = await llm.invoke([
          new SystemMessage(sys),
          new HumanMessage(JSON.stringify(payload)),
        ]);
        const content = (ai as unknown as { content?: unknown }).content;
        const raw = this.extractTextFromModelContent(content);
        lastText = this.format.normalizeJsonText(raw);
        let parsed: unknown;
        try {
          parsed = this.parseJsonFromModelText(lastText);
        } catch {
          continue;
        }
        const ok0 = ZArticleBlueprintPlan.safeParse(parsed);
        const ok = ok0.success
          ? ok0
          : ZArticleBlueprintPlan.safeParse(
              this.coerceArticleBlueprintPlan(parsed, {
                count: input.count,
                topic: input.topic,
                platform: input.platform,
              }),
            );
        if (ok.success) {
          plan = ok;
          break;
        }
      }
    }

    if (!plan.success) throw new BadRequestException('ARTICLE_PLAN_INVALID');

    const items = plan.data.items
      .filter((it) => typeof it.index === 'number')
      .sort((a, b) => a.index - b.index)
      .slice(0, input.count);

    if (items.length !== input.count) {
      throw new BadRequestException('ARTICLE_PLAN_COUNT_MISMATCH');
    }

    return items.map((it) => ({
      index: it.index,
      title: String(it.title || '').trim(),
      tags: Array.isArray(it.tags)
        ? it.tags.map((t) => String(t ?? '').trim()).filter(Boolean)
        : undefined,
      angle: it.angle,
      imageQuery: it.imageQuery,
      notes: Array.isArray(it.notes)
        ? it.notes.map((n) => String(n ?? '').trim()).filter(Boolean)
        : undefined,
    }));
  }

  private async generateArticlesAndImages(input: {
    canvasId: number;
    blueprints: Array<{
      index: number;
      title: string;
      tags?: string[];
      angle?: string;
      imageQuery?: string;
      notes?: string[];
    }>;
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature: number;
    platform: string;
    topic?: string;
    galleryUserId: string;
    galleryGroupId?: number;
    minImageScore: number;
  }): Promise<void> {
    for (const bp of input.blueprints) {
      const article = await this.generateOneArticle({
        provider: input.provider,
        model: input.model,
        temperature: input.temperature,
        platform: input.platform,
        topic: input.topic,
        blueprint: bp,
      });

      await this.canvas.addArticles(input.canvasId, {
        articles: [
          {
            title: article.title,
            tags: article.tags,
            contentJson: {
              platform: input.platform,
              topic: input.topic,
              blueprint: bp,
              markdown: article.markdown,
              imageQuery: article.imageQuery,
            },
          },
        ],
      });

      const updatedCanvas = await this.canvas.get(input.canvasId);
      if (!updatedCanvas) continue;
      const latestArticle =
        updatedCanvas.articles[updatedCanvas.articles.length - 1];

      await this.assignImageToArticle({
        canvasId: input.canvasId,
        articleId: latestArticle.id,
        articleTitle: article.title,
        articleTags: article.tags,
        imageQuery: article.imageQuery,
        galleryUserId: input.galleryUserId,
        galleryGroupId: input.galleryGroupId,
        minImageScore: input.minImageScore,
      });
    }
  }

  private async generateOneArticle(input: {
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature: number;
    platform: string;
    topic?: string;
    blueprint: {
      index: number;
      title: string;
      tags?: string[];
      angle?: string;
      imageQuery?: string;
      notes?: string[];
    };
  }): Promise<{
    title: string;
    tags: string[];
    markdown: string;
    imageQuery: string;
  }> {
    const isXhs = /小红书|xhs/i.test(input.platform);
    const sys = [
      '你是文章生成器。只负责生成可直接发布的文章正文，不要输出任何策划/方案/解释。',
      '你必须只输出 JSON 对象，不要输出任何多余字符。',
      '输出 schema：{ "title": string, "tags"?: string[], "markdown": string, "imageQuery"?: string }。',
      'markdown 必须输出完整正文，不能是提纲/大纲/目录/框架。',
      '正文至少包含 2 段连续叙事段落，每段不少于 50 字。',
      '每篇文章必须独立成篇，不允许“第X篇/上篇/下篇/续篇”等连续叙事词。',
      '正文至少 120 字。',
      'imageQuery 必须返回用于配图检索。',
      isXhs
        ? [
            '平台是小红书：markdown 必须是“小红书可发”的正文风格。',
            '开头 1-2 句强钩子；全篇短句短段；多用要点列表；语气真实分享。',
            '严禁出现痛点/误区、方法论、步骤清单、案例/示例、总结复盘等栏目。',
            '末尾必须给 3-6 个话题标签（#标签）。',
          ].join('\n')
        : undefined,
    ]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n');

    const config = {
      provider: input.provider,
      model: input.model,
      temperature: input.temperature,
      nonStreaming: true,
      recursionLimit: 30,
      system: sys,
    };

    const messages: BaseMessage[] = [
      new SystemMessage(sys),
      new HumanMessage(
        JSON.stringify({
          task: 'Generate one article',
          platform: input.platform,
          topic: input.topic,
          index: input.blueprint.index,
          blueprint: input.blueprint,
        }),
      ),
    ];

    const llm = await this.agent.buildLLM(config);
    let article = ZSingleArticle.safeParse(undefined);
    try {
      const structured = llm.withStructuredOutput(ZSingleArticle);
      const output = await structured.invoke(messages);
      article = ZSingleArticle.safeParse(output);
    } catch {
      void 0;
    }

    if (!article.success) {
      let lastText = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const payload =
          attempt === 0
            ? {
                task: 'Generate one article',
                platform: input.platform,
                topic: input.topic,
                index: input.blueprint.index,
                blueprint: input.blueprint,
              }
            : {
                task: 'Fix previous output to match schema',
                previousOutput: lastText,
                required: {
                  schema:
                    '{ "title": string, "tags"?: string[], "markdown": string, "imageQuery"?: string }',
                  must: ['Only output JSON object'],
                },
              };
        const ai = await llm.invoke([
          new SystemMessage(sys),
          new HumanMessage(JSON.stringify(payload)),
        ]);
        const content = (ai as unknown as { content?: unknown }).content;
        const raw = this.extractTextFromModelContent(content);
        lastText = this.format.normalizeJsonText(raw);
        let parsed: unknown;
        try {
          parsed = this.parseJsonFromModelText(lastText);
        } catch {
          continue;
        }
        const ok = ZSingleArticle.safeParse(parsed);
        if (ok.success) {
          article = ok;
          break;
        }
      }
    }
    if (!article.success) {
      throw new BadRequestException('ARTICLE_DRAFT_INVALID');
    }

    const tags = Array.isArray(article.data.tags)
      ? article.data.tags.map((t) => String(t ?? '').trim()).filter(Boolean)
      : [];

    return {
      title: String(article.data.title || '').trim(),
      tags,
      markdown: String(article.data.markdown || '').trim(),
      imageQuery:
        article.data.imageQuery?.trim() ||
        input.blueprint.imageQuery ||
        `${input.topic || ''} ${input.blueprint.angle || ''} 场景`,
    };
  }

  private async assignImageToArticle(input: {
    canvasId: number;
    articleId: number;
    articleTitle: string;
    articleTags?: string[];
    imageQuery?: string;
    galleryUserId: string;
    galleryGroupId?: number;
    minImageScore: number;
  }): Promise<void> {
    const queryText = input.imageQuery?.trim() || input.articleTitle;
    const allImageKeys = new Set<string>();
    const pickedImages: Array<{ id?: number; url?: string }> = [];

    const tryAddPicked = (img: { id?: number; url?: string }) => {
      const keyId = img.id ? `id:${img.id}` : undefined;
      const keyUrl = img.url ? `url:${img.url}` : undefined;
      if (keyId && allImageKeys.has(keyId)) return false;
      if (keyUrl && allImageKeys.has(keyUrl)) return false;
      if (keyId) allImageKeys.add(keyId);
      if (keyUrl) allImageKeys.add(keyUrl);
      pickedImages.push(img);
      return true;
    };

    const byQuery = await this.gallery.searchSimilar(
      queryText,
      input.galleryUserId,
      12,
      input.minImageScore,
    );
    for (const r of byQuery) {
      if (pickedImages.length >= 3) break;
      tryAddPicked({ id: r.image.id, url: r.image.url });
    }

    if (
      pickedImages.length < 3 &&
      input.articleTags &&
      input.articleTags.length > 0
    ) {
      const validTags = input.articleTags
        .map((t) => String(t ?? '').trim())
        .filter((t) => t.length > 0)
        .slice(0, 3);
      const byTags = await this.gallery.searchByTags({
        userId: input.galleryUserId,
        groupId: input.galleryGroupId,
        tags: validTags,
        limit: 24,
      });
      for (const img of byTags) {
        if (pickedImages.length >= 3) break;
        tryAddPicked({ id: img.id, url: img.url });
      }
    }

    if (pickedImages.length < 3) {
      const needed = 3 - pickedImages.length;
      const randomList = await this.gallery.sampleRandom({
        userId: input.galleryUserId,
        groupId: input.galleryGroupId,
        limit: needed + 12,
      });
      for (const img of randomList) {
        if (pickedImages.length >= 3) break;
        tryAddPicked({ id: img.id, url: img.url });
      }
    }

    const imageIds = pickedImages
      .map((p) => p.id)
      .filter((id): id is number => typeof id === 'number');
    const imageUrls = pickedImages
      .map((p) => p.url)
      .filter(
        (url): url is string => typeof url === 'string' && url.length > 0,
      );

    if (imageIds.length > 0 || imageUrls.length > 0) {
      let doneNote = 'AUTO_QUERY_MATCH';
      if (pickedImages.length === 0) {
        doneNote = 'NO_GALLERY_IMAGE';
      } else if (!imageIds.some(() => true)) {
        doneNote = 'AUTO_RANDOM_IMAGE';
      } else if (pickedImages.length < 2) {
        doneNote = 'AUTO_PARTIAL_IMAGE';
      }
      await this.canvas.updateArticleImages(input.canvasId, input.articleId, {
        imageIds: imageIds.length > 0 ? imageIds : undefined,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        status: 'done',
        doneNote,
      });
    } else {
      await this.canvas.updateArticleImages(input.canvasId, input.articleId, {
        status: 'requires_human',
        doneNote: 'NO_GALLERY_IMAGE',
      });
    }
  }
}
