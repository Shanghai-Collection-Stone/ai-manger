import { BadRequestException, Injectable } from '@nestjs/common';
import * as z from 'zod';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { CreateAgentParams } from 'langchain';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import type { AgentConfig } from '../../ai-agent/types/agent.types';
import { TextFormatService } from '../../format/services/format.service';
import { CanvasService } from '../../canvas/services/canvas.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { McpFunctionCallService } from '../../function-call/mcp/services/mcp.service.js';
import { McpAdaptersService } from '../../function-call/mcp/services/mcp-adapter.service.js';
import { AnalysisFunctionCallService } from '../../function-call/analysis/services/analysis.service.js';

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

const ZTopicOrchestration = z.object({
  outline: z.record(z.any()).optional(),
  style: z.record(z.any()).optional(),
  signals: z.record(z.any()).optional(),
  keywords: z.array(z.string()).optional(),
  sources: z.array(z.record(z.any())).optional(),
});

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
  imageQuery: z.string().min(1).optional(),
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

  private getOrchestrationTools(): NonNullable<CreateAgentParams['tools']> {
    const base: NonNullable<CreateAgentParams['tools']> = [];
    const t1 = this.mcp.getHandle() ?? [];
    const t2 = this.mcpAdapters.getTools() ?? [];
    base.push(...t1, ...t2);
    return base;
  }

  private getRetrievalTools(): NonNullable<CreateAgentParams['tools']> {
    const base: NonNullable<CreateAgentParams['tools']> = [];
    base.push(...this.getOrchestrationTools());
    base.push(...(this.analysisTools.getAllDataSourceTools() ?? []));
    return base;
  }

  private parseJsonFromModelText(text: string): unknown {
    const normalized = this.format.normalizeJsonText(String(text ?? ''));
    const directTry = () => JSON.parse(normalized) as unknown;
    try {
      return directTry();
    } catch {
      void 0;
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
      try {
        return JSON.parse(obj) as unknown;
      } catch {
        void 0;
      }
    }

    const arr = extractBetween('[', ']');
    if (arr) {
      try {
        return JSON.parse(arr) as unknown;
      } catch {
        void 0;
      }
    }

    throw new Error('JSON_PARSE_FAILED');
  }

  private async runJsonWithRepair(input: {
    sys: string;
    basePayload: Record<string, unknown>;
    config: AgentConfig;
    schema: string;
  }): Promise<unknown> {
    let lastNormalized = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? JSON.stringify(input.basePayload, null, 2)
          : JSON.stringify(
              {
                task: 'Fix previous output to match schema',
                previousOutput: lastNormalized,
                required: {
                  schema: input.schema,
                  must: [
                    'Only output JSON object',
                    'No markdown, no code fences, no extra text',
                  ],
                },
                basePayload: input.basePayload,
              },
              null,
              2,
            );

      const messages: BaseMessage[] = [
        new SystemMessage(input.sys),
        new HumanMessage(prompt),
      ];

      try {
        const ai = await this.agent.runWithMessages({
          config: input.config,
          messages,
        });
        const content = (ai as unknown as { content?: unknown }).content;
        const raw =
          typeof content === 'string' ? content : JSON.stringify(content ?? '');
        const normalized = this.format.normalizeJsonText(raw);
        lastNormalized = normalized;
        if (!normalized || normalized.trim().length === 0) continue;
        return this.parseJsonFromModelText(normalized);
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private buildDefaultOutline(input: {
    topic?: string;
    platform: string;
    count: number;
  }): Record<string, unknown> {
    const topic =
      typeof input.topic === 'string' && input.topic.trim().length > 0
        ? input.topic.trim()
        : '通用主题';

    const isXhs = /小红书|xhs/i.test(String(input.platform ?? ''));

    return {
      topic,
      platform: input.platform,
      targetAudience: ['上班族', '大学生', '新手用户'],
      goals: [
        '开头用强利益点抓住注意力',
        '内容可直接照做，少空话',
        '给出避坑点与可复制清单',
      ],
      contentThemes: isXhs
        ? ['开头钩子', '避坑清单', '对比维度', '经验/案例', '结尾CTA与话题']
        : ['误区', '方法', '步骤清单', '案例', '总结'],
      keyMessages: [
        `围绕“${topic}”给出可落地的方法`,
        '避免空泛结论，给出具体动作与检查点',
        '用清单化表达降低理解成本',
      ],
      articleCount: input.count,
      callToAction: ['收藏', '评论提问', '关注获取后续'],
    };
  }

  private buildDefaultStyle(input: {
    platform: string;
  }): Record<string, unknown> {
    return {
      platform: input.platform,
      language: 'zh-CN',
      tone: '务实、直接、友好',
      structure: {
        headline: '短标题 + 强利益点',
        paragraphs: '短段落（1-2句/段）',
        lists: '尽量用编号/要点列表',
        ending: '总结 + CTA',
      },
      formatting: {
        emoji: '适量点缀',
        markdown: true,
        hashtags: '3-6个',
      },
      lengthGuide: {
        perArticle: '300-600字',
      },
    };
  }

  private async pickGalleryTags(input: {
    provider: 'gemini' | 'deepseek';
    model: string;
    temperature: number;
    platform: string;
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
      task: 'Select gallery tags for each article',
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

  async generateToCanvas(input: {
    userId: string;
    platform?: string;
    topic?: string;
    outline?: Record<string, unknown>;
    style?: Record<string, unknown>;
    count?: number;
    galleryUserId?: string;
    galleryGroupId?: number;
    minImageScore?: number;
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature?: number;
  }): Promise<Record<string, unknown>> {
    const GraphState = Annotation.Root({
      userId: Annotation<string>(),
      platform: Annotation<string>(),
      topic: Annotation<string | undefined>(),
      outline: Annotation<Record<string, unknown> | undefined>(),
      style: Annotation<Record<string, unknown> | undefined>(),
      count: Annotation<number>(),
      galleryUserId: Annotation<string>(),
      galleryGroupId: Annotation<number | undefined>(),
      minImageScore: Annotation<number>(),
      provider: Annotation<'gemini' | 'deepseek'>(),
      model: Annotation<string>(),
      temperature: Annotation<number>(),
      canvasId: Annotation<number | undefined>(),
      signals: Annotation<Record<string, unknown> | undefined>(),
      keywords: Annotation<string[]>({
        default: () => [],
        reducer: (_a, b) => b,
      }),
      sources: Annotation<Array<Record<string, unknown>>>({
        default: () => [],
        reducer: (_a, b) => b,
      }),
      result: Annotation<Record<string, unknown> | undefined>({
        reducer: (_a, b) => b,
      }),
      blueprints: Annotation<
        Array<{
          index: number;
          title: string;
          tags?: string[];
          angle?: string;
          imageQuery?: string;
          notes?: string[];
        }>
      >({
        default: () => [],
        reducer: (_a, b) => b,
      }),
      drafts: Annotation<
        Record<
          number,
          {
            title: string;
            tags: string[];
            markdown: string;
            imageQuery?: string;
          }
        >
      >({
        default: () => ({}),
        reducer: (a, b) => ({ ...a, ...b }),
      }),
    });

    let createdCanvasId: number | undefined;

    const workflow = new StateGraph(GraphState)
      .addNode('init_canvas', async (state) => {
        const count =
          typeof state.count === 'number' && Number.isFinite(state.count)
            ? Math.max(3, Math.min(5, Math.floor(state.count)))
            : 3;
        const platform =
          typeof state.platform === 'string' && state.platform.trim().length > 0
            ? state.platform.trim()
            : 'generic';
        const topic =
          typeof state.topic === 'string' && state.topic.trim().length > 0
            ? state.topic.trim()
            : undefined;
        const hasOutline =
          !!state.outline &&
          typeof state.outline === 'object' &&
          Object.keys(state.outline).length > 0;
        const outline = hasOutline
          ? (state.outline as Record<string, unknown>)
          : this.buildDefaultOutline({ topic, platform, count });
        const hasStyle =
          !!state.style &&
          typeof state.style === 'object' &&
          Object.keys(state.style).length > 0;
        const style = hasStyle
          ? (state.style as Record<string, unknown>)
          : this.buildDefaultStyle({ platform });

        const c = await this.canvas.create({
          userId: state.userId,
          topic,
          outline,
          style,
        });
        createdCanvasId = c.id;

        const galleryUserId =
          typeof state.galleryUserId === 'string' &&
          state.galleryUserId.trim().length > 0
            ? state.galleryUserId.trim()
            : state.userId;

        const groupId =
          typeof state.galleryGroupId === 'number' &&
          Number.isFinite(state.galleryGroupId)
            ? state.galleryGroupId
            : undefined;
        const minImageScore =
          typeof state.minImageScore === 'number' &&
          Number.isFinite(state.minImageScore)
            ? Math.max(0, Math.min(1, state.minImageScore))
            : 0.5;

        const provider = state.provider ?? 'deepseek';
        const model =
          typeof state.model === 'string' && state.model.trim().length > 0
            ? state.model.trim()
            : provider === 'deepseek'
              ? 'deepseek-chat'
              : 'gemini-1.5-flash';
        const temperature =
          typeof state.temperature === 'number' &&
          Number.isFinite(state.temperature)
            ? state.temperature
            : 0.2;

        return {
          canvasId: c.id,
          platform,
          topic,
          outline,
          style,
          count,
          galleryUserId,
          galleryGroupId: groupId,
          minImageScore,
          provider,
          model,
          temperature,
        };
      })
      .addNode('orchestrate', async (state) => {
        const tools = this.getRetrievalTools();

        const sys = [
          '你是“话题编排器”。目标：为后续文章生成准备可用的数据与结构。',
          '在输出前必须至少调用一次工具检索有效数据（如平台热文、关键词、用户关注点、典型结构）。',
          '你可以调用工具/服务获取外部数据，但输出必须只包含 JSON 对象。',
          '输出 schema：{ "outline"?: object, "style"?: object, "signals"?: object, "keywords"?: string[], "sources"?: object[] }。',
          '不要输出多余文字、不要输出 Markdown 代码块。',
        ].join('\n');

        const config = {
          provider: state.provider,
          model: state.model,
          temperature: state.temperature,
          nonStreaming: true,
          recursionLimit: 40,
          system: sys,
          tools,
          responseFormat:
            state.provider === 'deepseek' ? { type: 'json_object' } : undefined,
        };

        const parsed = await this.runJsonWithRepair({
          sys,
          basePayload: {
            task: 'Orchestrate topic data for multi-article generation',
            platform: state.platform,
            topic: state.topic,
            count: state.count,
            current: {
              outline: state.outline,
              style: state.style,
            },
            expectations: {
              signalsExamples: [
                '平台热文结构与常见标题模式',
                '热点关键词与相关话题标签',
                '受众关注点与常见避坑点',
              ],
              sources: '如调用工具获取数据，请在 sources 中放入简要结果',
            },
          },
          config,
          schema:
            '{ "outline"?: object, "style"?: object, "signals"?: object, "keywords"?: string[], "sources"?: object[] }',
        });

        if (!parsed) return { signals: undefined };

        const orch = ZTopicOrchestration.safeParse(parsed);
        if (!orch.success) {
          return { signals: undefined };
        }

        const outline =
          orch.data.outline && typeof orch.data.outline === 'object'
            ? (orch.data.outline as Record<string, unknown>)
            : state.outline;
        const style =
          orch.data.style && typeof orch.data.style === 'object'
            ? (orch.data.style as Record<string, unknown>)
            : state.style;
        const signals =
          orch.data.signals && typeof orch.data.signals === 'object'
            ? (orch.data.signals as Record<string, unknown>)
            : undefined;

        const keywords = Array.isArray(orch.data.keywords)
          ? orch.data.keywords
              .filter((x) => typeof x === 'string')
              .map((x) => x.trim())
              .filter((x) => x.length > 0)
              .slice(0, 50)
          : [];

        const sources = Array.isArray(orch.data.sources)
          ? orch.data.sources
              .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
              .slice(0, 50)
              .map((x) => x as Record<string, unknown>)
          : [];

        if (typeof state.canvasId === 'number') {
          await this.canvas.updateMeta(state.canvasId, {
            topic: state.topic,
            outline,
            style,
          });
        }

        return { outline, style, signals, keywords, sources };
      })
      .addNode('plan_blueprints', async (state) => {
        const isXhs = /小红书|xhs/i.test(state.platform);
        const sys = [
          '你是“文章选题规划器”。根据平台、话题与 signals 产出多篇文章的选题与切入点。',
          '你必须只输出 JSON 对象，不要输出任何多余字符。',
          '输出 schema：{ "items": [{"index": number, "title": string, "tags"?: string[], "angle"?: string, "imageQuery"?: string, "notes"?: string[]}] }。',
          `items 数组长度必须等于 ${state.count}，index 从 0 开始连续递增。`,
          isXhs
            ? '平台是小红书：title 要像真实分享，避免过于论文/教科书。'
            : undefined,
        ]
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .join('\n');

        const config = {
          provider: state.provider,
          model: state.model,
          temperature: state.temperature,
          nonStreaming: true,
          system: sys,
          responseFormat:
            state.provider === 'deepseek' ? { type: 'json_object' } : undefined,
        };

        const parsed = await this.runJsonWithRepair({
          sys,
          basePayload: {
            task: 'Plan article blueprints',
            platform: state.platform,
            topic: state.topic,
            count: state.count,
            outline: state.outline,
            style: state.style,
            signals: state.signals,
            keywords: state.keywords,
            sources: state.sources,
          },
          config,
          schema: `{ "items": [{"index": number, "title": string, "tags"?: string[], "angle"?: string, "imageQuery"?: string, "notes"?: string[]}] }`,
        });

        if (parsed) {
          const plan = ZArticleBlueprintPlan.safeParse(parsed);
          if (plan.success) {
            const items = plan.data.items
              .filter((it) => typeof it.index === 'number')
              .sort((a, b) => a.index - b.index)
              .slice(0, state.count);
            const ok =
              items.length === state.count &&
              items.every((it, idx) => it.index === idx);
            if (ok) {
              return { blueprints: items };
            }
          }
        }

        const fallbackTopic =
          typeof state.topic === 'string' && state.topic.length > 0
            ? state.topic
            : '通用主题';
        const items = Array.from({ length: state.count }).map((_, i) => ({
          index: i,
          title: `${fallbackTopic}｜实用攻略 ${i + 1}`,
          tags: [state.platform, fallbackTopic].filter((x) => x.length > 0),
          angle: '给出可直接照做的清单与避坑点',
          imageQuery: `${fallbackTopic} 真实场景`,
          notes: ['开头强钩子', '短句短段', '要点列表优先'],
        }));
        return { blueprints: items };
      })
      .addNode('gen_article_0', async (state) => {
        return await this.generateOneArticleFromBlueprint(state, 0);
      })
      .addNode('gen_article_1', async (state) => {
        return await this.generateOneArticleFromBlueprint(state, 1);
      })
      .addNode('gen_article_2', async (state) => {
        return await this.generateOneArticleFromBlueprint(state, 2);
      })
      .addNode('gen_article_3', async (state) => {
        return await this.generateOneArticleFromBlueprint(state, 3);
      })
      .addNode('gen_article_4', async (state) => {
        return await this.generateOneArticleFromBlueprint(state, 4);
      })
      .addNode('persist_articles', async (state) => {
        if (typeof state.canvasId !== 'number') {
          throw new BadRequestException('CANVAS_NOT_FOUND');
        }

        const drafts = state.drafts ?? {};
        const out: Array<{
          title: string;
          tags: string[];
          markdown: string;
          imageQuery?: string;
        }> = [];
        for (let i = 0; i < state.count; i++) {
          const d = drafts[i];
          if (d) {
            out.push(d);
            continue;
          }
          const bp = state.blueprints.find((x) => x.index === i);
          const title = bp?.title ?? `示例文章 ${i + 1}`;
          out.push({
            title,
            tags: Array.isArray(bp?.tags) ? bp.tags : [],
            markdown: `# ${title}\n\n- 平台：${state.platform}\n- 主题：${state.topic ?? ''}\n\n（生成失败，已写入占位内容）\n`,
            imageQuery: bp?.imageQuery,
          });
        }

        await this.canvas.addArticles(state.canvasId, {
          articles: out.map((a) => ({
            title: a.title,
            tags: a.tags,
            contentJson: {
              platform: state.platform,
              topic: state.topic,
              outline: state.outline,
              style: state.style,
              signals: state.signals,
              keywords: state.keywords,
              sources: state.sources,
              markdown: a.markdown,
              imageQuery: a.imageQuery,
            } as Record<string, unknown>,
          })),
        });

        const withArticles = await this.canvas.get(state.canvasId);
        if (!withArticles) throw new BadRequestException('CANVAS_NOT_FOUND');
        return {};
      })
      .addNode('assign_images', async (state) => {
        if (typeof state.canvasId !== 'number') {
          throw new BadRequestException('CANVAS_NOT_FOUND');
        }

        const withArticles = await this.canvas.get(state.canvasId);
        if (!withArticles) throw new BadRequestException('CANVAS_NOT_FOUND');

        const tags =
          typeof state.galleryGroupId === 'number'
            ? await this.gallery.listDistinctTagsByGroup(
                state.galleryUserId,
                state.galleryGroupId,
                500,
              )
            : await this.gallery.listDistinctTags(state.galleryUserId, 500);

        const tagMap = await this.pickGalleryTags({
          provider: state.provider,
          model: state.model,
          temperature: state.temperature,
          platform: state.platform,
          topic: state.topic,
          availableTags: tags,
          items: (withArticles.articles ?? []).map((a) => {
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
        for (const a of withArticles.articles) {
          const ids = Array.isArray(a.imageIds) ? a.imageIds : [];
          const urls = Array.isArray(a.imageUrls) ? a.imageUrls : [];
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

        for (let idx = 0; idx < withArticles.articles.length; idx++) {
          const article = withArticles.articles[idx];
          const content =
            article.contentJson && typeof article.contentJson === 'object'
              ? article.contentJson
              : undefined;
          const imageQuery =
            typeof content?.['imageQuery'] === 'string'
              ? String(content['imageQuery']).trim()
              : '';

          let pickedFrom: 'QUERY' | 'TAG' | 'RANDOM' | undefined;

          const byQuery = imageQuery
            ? await this.gallery.searchSimilar(
                imageQuery,
                state.galleryUserId,
                12,
                state.minImageScore,
              )
            : [];
          const byQueryFiltered =
            typeof state.galleryGroupId === 'number'
              ? byQuery
                  .map((r) => r.image)
                  .filter((img) => img.groupId === state.galleryGroupId)
              : byQuery.map((r) => r.image);
          const pickedFromQuery = tryPick(byQueryFiltered);

          const fallbackTags = (Array.isArray(article.tags) ? article.tags : [])
            .map((x) => String(x ?? '').trim())
            .filter((t) => t.length > 0 && tags.includes(t))
            .slice(0, 3);
          const chosen = (tagMap.get(idx) ?? []).filter((t) =>
            tags.includes(t),
          );
          const useTags = chosen.length > 0 ? chosen : fallbackTags;
          const byTags =
            useTags.length > 0
              ? await this.gallery.searchByTags({
                  userId: state.galleryUserId,
                  groupId: state.galleryGroupId,
                  tags: useTags,
                  limit: 24,
                })
              : [];

          const pickedFromTags = pickedFromQuery ? undefined : tryPick(byTags);
          const randomList =
            pickedFromQuery || pickedFromTags
              ? []
              : await this.gallery.sampleRandom({
                  userId: state.galleryUserId,
                  groupId: state.galleryGroupId,
                  limit: 24,
                });
          const pickedFromRandom =
            pickedFromQuery || pickedFromTags ? undefined : tryPick(randomList);

          const picked = pickedFromQuery ?? pickedFromTags ?? pickedFromRandom;
          if (pickedFromQuery) pickedFrom = 'QUERY';
          else if (pickedFromTags) pickedFrom = 'TAG';
          else if (pickedFromRandom) pickedFrom = 'RANDOM';

          if (!picked) {
            await this.canvas.updateArticleImages(state.canvasId, article.id, {
              status: 'requires_human',
              doneNote: 'NO_GALLERY_IMAGE',
            });
            continue;
          }

          if (picked.keyId) usedImageKeys.add(picked.keyId);
          if (picked.keyUrl) usedImageKeys.add(picked.keyUrl);
          const imageId = picked.id;
          const imageUrl = picked.url;

          await this.canvas.updateArticleImages(state.canvasId, article.id, {
            imageIds: typeof imageId === 'number' ? [imageId] : undefined,
            imageUrls: typeof imageUrl === 'string' ? [imageUrl] : undefined,
            status: 'done',
            doneNote:
              pickedFrom === 'QUERY'
                ? 'AUTO_QUERY_MATCH'
                : pickedFrom === 'TAG'
                  ? 'AUTO_TAG_MATCH'
                  : 'AUTO_RANDOM_IMAGE',
          });
        }

        const finalCanvas = await this.canvas.get(state.canvasId);
        if (!finalCanvas) throw new BadRequestException('CANVAS_NOT_FOUND');

        const hasHuman = (finalCanvas.articles ?? []).some(
          (a) => a.status === 'requires_human',
        );
        await this.canvas.updateStatus(
          state.canvasId,
          hasHuman ? 'requires_human' : 'completed',
        );

        return {};
      })
      .addNode('finalize', async (state) => {
        if (typeof state.canvasId !== 'number') {
          throw new BadRequestException('CANVAS_NOT_FOUND');
        }
        const after = await this.canvas.get(state.canvasId);
        if (!after) throw new BadRequestException('CANVAS_NOT_FOUND');

        const canvasRec = after as unknown as Record<string, unknown>;
        const articleCount = Array.isArray(canvasRec?.['articles'])
          ? (canvasRec['articles'] as unknown[]).length
          : 0;
        const canvasTags = Array.isArray(after.articles)
          ? Array.from(
              new Set(
                after.articles
                  .flatMap((a) => (Array.isArray(a.tags) ? a.tags : []))
                  .map((t) => String(t ?? '').trim())
                  .filter((t) => t.length > 0),
              ),
            ).slice(0, 50)
          : [];

        return {
          result: {
            canvasId: state.canvasId,
            canvas: {
              id: state.canvasId,
              userId: state.userId,
              topic: state.topic,
              platform: state.platform,
              status: canvasRec?.['status'],
              articleCount,
            },
            canvasTags,
          },
        };
      })
      .addEdge(START, 'init_canvas')
      .addEdge('init_canvas', 'orchestrate')
      .addEdge('orchestrate', 'plan_blueprints')
      .addConditionalEdges('plan_blueprints', (state) => {
        return state.count >= 1 ? 'gen_article_0' : 'persist_articles';
      })
      .addConditionalEdges('gen_article_0', (state) => {
        return state.count >= 2 ? 'gen_article_1' : 'persist_articles';
      })
      .addConditionalEdges('gen_article_1', (state) => {
        return state.count >= 3 ? 'gen_article_2' : 'persist_articles';
      })
      .addConditionalEdges('gen_article_2', (state) => {
        return state.count >= 4 ? 'gen_article_3' : 'persist_articles';
      })
      .addConditionalEdges('gen_article_3', (state) => {
        return state.count >= 5 ? 'gen_article_4' : 'persist_articles';
      })
      .addEdge('gen_article_4', 'persist_articles')
      .addEdge('persist_articles', 'assign_images')
      .addEdge('assign_images', 'finalize')
      .addEdge('finalize', END)
      .compile();

    const provider = input.provider ?? 'deepseek';
    const model =
      input.model ??
      (provider === 'deepseek' ? 'deepseek-chat' : 'gemini-1.5-flash');
    const temperature =
      typeof input.temperature === 'number' &&
      Number.isFinite(input.temperature)
        ? input.temperature
        : 0.2;

    try {
      const out = await workflow.invoke({
        userId: input.userId,
        platform: input.platform ?? 'generic',
        topic:
          typeof input.topic === 'string' && input.topic.trim().length > 0
            ? input.topic.trim()
            : undefined,
        outline:
          input.outline && typeof input.outline === 'object'
            ? input.outline
            : undefined,
        style:
          input.style && typeof input.style === 'object'
            ? input.style
            : undefined,
        count:
          typeof input.count === 'number' && Number.isFinite(input.count)
            ? input.count
            : 3,
        galleryUserId: input.galleryUserId ?? input.userId,
        galleryGroupId: input.galleryGroupId,
        minImageScore:
          typeof input.minImageScore === 'number' &&
          Number.isFinite(input.minImageScore)
            ? input.minImageScore
            : 0.5,
        provider,
        model,
        temperature,
        canvasId: undefined,
        signals: undefined,
        keywords: [],
        sources: [],
      } as unknown as Record<string, unknown>);

      const rec = out as unknown as Record<string, unknown>;
      const result = rec['result'];
      return result && typeof result === 'object'
        ? (result as Record<string, unknown>)
        : { ok: false, error: 'WORKFLOW_NO_RESULT' };
    } catch (err: unknown) {
      const canvasId = createdCanvasId;
      if (typeof canvasId === 'number') {
        try {
          await this.canvas.updateStatus(canvasId, 'failed');
        } catch {
          void 0;
        }
      }
      const e = err instanceof Error ? err : new Error(String(err));
      throw e;
    }
  }

  private async generateOneArticleFromBlueprint(
    state: Record<string, unknown>,
    index: number,
  ): Promise<Record<string, unknown>> {
    const count = typeof state['count'] === 'number' ? state['count'] : 3;
    if (index < 0 || index >= count) return {};

    const platform =
      typeof state['platform'] === 'string' &&
      state['platform'].trim().length > 0
        ? state['platform'].trim()
        : 'generic';
    const topic =
      typeof state['topic'] === 'string' &&
      String(state['topic']).trim().length > 0
        ? String(state['topic']).trim()
        : undefined;
    const outline =
      state['outline'] && typeof state['outline'] === 'object'
        ? (state['outline'] as Record<string, unknown>)
        : {};
    const style =
      state['style'] && typeof state['style'] === 'object'
        ? (state['style'] as Record<string, unknown>)
        : {};
    const signals =
      state['signals'] && typeof state['signals'] === 'object'
        ? (state['signals'] as Record<string, unknown>)
        : undefined;

    const keywords = Array.isArray(state['keywords'])
      ? (state['keywords'] as unknown[])
          .filter((x) => typeof x === 'string')
          .map((x) => String(x).trim())
          .filter((x) => x.length > 0)
          .slice(0, 50)
      : [];

    const sources = Array.isArray(state['sources'])
      ? (state['sources'] as unknown[])
          .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
          .slice(0, 50)
          .map((x) => x as Record<string, unknown>)
      : [];

    const blueprints = Array.isArray(state['blueprints'])
      ? (state['blueprints'] as Array<Record<string, unknown>>)
      : [];
    const bp = blueprints.find((b) => Number(b['index']) === index);
    const bpTitle =
      typeof bp?.['title'] === 'string' ? String(bp['title']) : '';
    const bpTags = Array.isArray(bp?.['tags'])
      ? (bp?.['tags'] as unknown[])
      : [];
    const bpAngle =
      typeof bp?.['angle'] === 'string' ? String(bp['angle']) : undefined;
    const bpImageQuery =
      typeof bp?.['imageQuery'] === 'string'
        ? String(bp['imageQuery'])
        : undefined;
    const bpNotes = Array.isArray(bp?.['notes'])
      ? (bp?.['notes'] as unknown[])
      : [];

    const isXhs = /小红书|xhs/i.test(platform);
    const sys = [
      '你是示例文章生成器。你只负责生成“可直接发布”的单篇文章，不要输出任何策划/方案/流程/解释。',
      '你必须严格复用上游提供的 signals/keywords/sources，不要再次调用任何工具或检索。',
      '你必须只输出 JSON 对象，不要输出任何多余字符。',
      '输出 schema：{ "title": string, "tags"?: string[], "markdown": string, "imageQuery"?: string }。',
      'markdown 至少 120 字。',
      isXhs
        ? [
            '平台是小红书：markdown 必须是“小红书可发”的正文风格。',
            '写作要求：开头 1-2 句强钩子；全篇短句短段；多用要点列表；语气真实分享；不要像教科书。',
            '严禁出现这些栏目名或格式：痛点/误区、方法论、步骤清单、案例/示例、总结复盘。',
            '必须在末尾给 3-6 个话题标签（#标签），独立一行或多行均可。',
          ].join('\n')
        : undefined,
    ]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .join('\n');

    const prompt = JSON.stringify(
      {
        task: 'Generate one publish-ready article',
        platform,
        topic,
        index,
        blueprint: {
          index,
          title: bpTitle,
          angle: bpAngle,
          tags: bpTags,
          imageQuery: bpImageQuery,
          notes: bpNotes
            .map((x) => (typeof x === 'string' ? x.trim() : ''))
            .filter((x) => x.length > 0),
        },
        outline,
        style,
        signals,
        keywords,
        sources,
        requirements: {
          mustDifferentFromOtherArticles: true,
          mustUseBlueprintAngleAndNotes: true,
          avoidGenericChecklistOnly: true,
        },
      },
      null,
      2,
    );

    const provider = (state['provider'] as 'gemini' | 'deepseek') ?? 'deepseek';
    const model =
      typeof state['model'] === 'string'
        ? String(state['model'])
        : 'deepseek-chat';
    const temperature =
      typeof state['temperature'] === 'number' &&
      Number.isFinite(state['temperature'])
        ? state['temperature']
        : 0.2;

    const config = {
      provider,
      model,
      temperature,
      nonStreaming: true,
      recursionLimit: 40,
      system: sys,
      responseFormat:
        provider === 'deepseek' ? { type: 'json_object' } : undefined,
    };

    const parsed = await this.runJsonWithRepair({
      sys,
      basePayload: JSON.parse(prompt) as Record<string, unknown>,
      config,
      schema:
        '{ "title": string, "tags"?: string[], "markdown": string, "imageQuery"?: string }',
    });

    const art = parsed ? ZSingleArticle.safeParse(parsed) : undefined;

    if (art?.success) {
      if (isXhs) {
        const forbiddenRe =
          /(痛点\s*\/\s*误区|方法论|步骤清单|案例\s*\/\s*示例|总结复盘)/;
        const md = String(art.data.markdown ?? '');
        const tags = md.match(/#[^\s#]{1,30}/g) ?? [];
        if (forbiddenRe.test(md) || tags.length < 3) {
          void 0;
        } else {
          const tags2 = Array.isArray(art.data.tags)
            ? art.data.tags.map((x) => x.trim()).filter(Boolean)
            : [];
          return {
            drafts: {
              [index]: {
                title: art.data.title,
                tags: tags2,
                markdown: art.data.markdown,
                imageQuery: art.data.imageQuery,
              },
            },
          };
        }
      } else {
        const tags2 = Array.isArray(art.data.tags)
          ? art.data.tags.map((x) => String(x ?? '').trim()).filter(Boolean)
          : [];
        return {
          drafts: {
            [index]: {
              title: art.data.title,
              tags: tags2,
              markdown: art.data.markdown,
              imageQuery: art.data.imageQuery,
            },
          },
        };
      }
    }

    const fallbackTopic =
      typeof topic === 'string' && topic.length > 0 ? topic : '通用主题';
    const title = bpTitle || `${fallbackTopic}｜示例文章 ${index + 1}`;
    const tagText = isXhs
      ? [
          fallbackTopic.replace(/[\s\u3000#]+/g, '').slice(0, 10),
          '小红书',
          '攻略',
          '避坑',
          '清单',
        ]
          .filter((x) => x.length > 0)
          .slice(0, 6)
          .map((x) => `#${x}`)
          .join(' ')
      : '';

    return {
      drafts: {
        [index]: {
          title,
          tags: bpTags
            .map((x) => (typeof x === 'string' ? x.trim() : ''))
            .filter(Boolean),
          markdown: [
            title,
            '',
            `围绕“${fallbackTopic}”，给你一份可以直接照做的要点清单：`,
            '',
            '- 先确定目标/预算/时间范围',
            '- 关键点提前确认：场地、设备、人员分工',
            '- 现场按“开场破冰-主活动-收尾留念”走',
            '',
            '如果你把人数、预算、时间发我，我可以按你的情况再细化一版。',
            ...(tagText ? ['', tagText] : []),
          ].join('\n'),
          imageQuery: bpImageQuery ?? `${fallbackTopic} 真实场景`,
        },
      },
    };
  }
}
