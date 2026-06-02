import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { promises as fs } from 'fs';
import * as z from 'zod';
import { extname, join } from 'path';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { CreateAgentParams } from 'langchain';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import type { AgentInvokeOption } from '../../ai-agent/types/agent.types.js';
import { TextFormatService } from '../../format/services/format.service';
import { CanvasService } from '../../canvas/services/canvas.service.js';
import type { ImageGroupSourcePreparation } from '../../canvas/services/canvas-image-group.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { GalleryGroupService } from '../../gallery/services/gallery-group.service.js';
import { SassService } from '../../sass/services/sass.service.js';
import type { GalleryImageEntity } from '../../gallery/entities/gallery-image.entity.js';
import type { CanvasImageGroup } from '../../canvas/entities/canvas.entity.js';
import { McpFunctionCallService } from '../../function-call/mcp/services/mcp.service.js';
import { McpAdaptersService } from '../../function-call/mcp/services/mcp-adapter.service.js';
import { AnalysisFunctionCallService } from '../../function-call/analysis/services/analysis.service.js';

const ARTICLE_MIN_COUNT = 1;

const ZArticleBlueprintPlan = z.object({
  items: z
    .array(
      z.object({
        index: z.number(),
        title: z.string().min(1),
        tags: z.array(z.string()).optional(),
        mainIdea: z.string().optional(),
        angle: z.string().optional(),
        imageIntent: z.string().optional(),
        requirements: z.array(z.string()).optional(),
        imageQuery: z.string().optional(),
        notes: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});

const ZSingleArticle = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()).optional(),
  markdown: z.string().min(1),
  imageQuery: z.string().optional(),
});

type ArticleBlueprint = {
  index: number;
  title: string;
  tags?: string[];
  mainIdea?: string;
  angle?: string;
  imageIntent?: string;
  requirements?: string[];
  imageQuery?: string;
  notes?: string[];
};

const ZCoverCopy = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
});

const COLLAGE_WIDTH = 640;
const COLLAGE_HEIGHT = 853;
const COLLAGE_DPI = 96;
const COVER_FONT_RELATIVE_PATH = 'public/fonts/cover-cjk.ttf';

type JimpModuleLike = {
  Jimp: {
    read: (input: string) => Promise<unknown>;
    rgbaToInt?: (r: number, g: number, b: number, a: number) => number;
    intToRGBA?: (value: number) => {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  };
  loadFont?: (font: unknown) => Promise<unknown>;
  HorizontalAlign?: {
    LEFT?: number;
    CENTER?: number;
    RIGHT?: number;
  };
  VerticalAlign?: {
    TOP?: number;
    MIDDLE?: number;
    BOTTOM?: number;
  };
  FONT_SANS_64_WHITE?: unknown;
  FONT_SANS_64_BLACK?: unknown;
  FONT_SANS_32_WHITE?: unknown;
  FONT_SANS_32_BLACK?: unknown;
};

let jimpModulePromise: Promise<unknown> | null = null;

@Injectable()
export class ArticleGraphService {
  private readonly logger = new Logger(ArticleGraphService.name);
  private readonly ARTICLE_TARGET_IMAGE_COUNT = 3;
  private readonly IMAGE_GROUP_MIN_IMAGES_PER_ARTICLE = 6;
  private readonly IMAGE_GROUP_MAX_IMAGES_PER_ARTICLE = 8;
  private customCoverFontBase64: string | null = null;
  private customCoverFontLoaded = false;
  private fontconfigSetupDone = false;

  constructor(
    private readonly agent: AgentService,
    private readonly format: TextFormatService,
    private readonly canvas: CanvasService,
    private readonly gallery: GalleryService,
    private readonly galleryGroups: GalleryGroupService,
    private readonly sassService: SassService,
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

  /**
   * @description 构建文章生成链路的 LangChain 运行上下文。
   * @param {object} input - 上下文输入。
   * @returns {Record<string, unknown>} 传递给 LangChain 的 context 对象。
   * @keyword-en build langchain context
   */
  private buildLangChainContext(input: {
    userId: string;
    tenantId?: string;
    platform: string;
    topic?: string;
  }): Record<string, unknown> {
    return {
      scene: 'graph.generate_to_canvas',
      userId: input.userId,
      tenantId: input.tenantId,
      platform: input.platform,
      topic: input.topic,
    };
  }

  /**
   * @description 归一化图文写作风格；未显式传入时按平台给出保守默认值。
   * @param {string | undefined} writingStyle - 用户确认的文风。
   * @param {string} platform - 平台标签。
   * @returns {string} 归一化后的文风描述。
   * @keyword-en normalize article writing style
   */
  private normalizeWritingStyle(
    writingStyle: string | undefined,
    platform: string,
  ): string {
    const style = String(writingStyle ?? '').trim();
    if (style.length > 0) return style.slice(0, 120);
    if (/知乎|zhihu/i.test(platform)) return '知乎理性分析文风';
    if (/公众号|wechat|weixin/i.test(platform)) return '公众号深度叙事文风';
    if (/小红书|xhs/i.test(platform)) return '小红书真实分享文风';
    return '通用专业图文文风';
  }

  /**
   * @description 组装 LangChain invoke 配置，统一附带 context/configurable，并阻断工具内部 LLM 继承主流 token handler。
   * @param {Record<string, unknown>} context - 运行上下文。
   * @returns {AgentInvokeOption} 内部 LLM 非流式 invoke 配置。
   * @keyword-cn 工具内部非流, 图文生成
   * @keyword-en internal-llm-nostream, invoke-option
   */
  private buildLangChainInvokeOption(
    context: Record<string, unknown>,
  ): AgentInvokeOption {
    return this.agent.buildNoStreamInvokeOption({
      context,
      configurable: {
        tenantId: context['tenantId'],
        userId: context['userId'],
      },
    });
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
    const count = Math.max(ARTICLE_MIN_COUNT, Math.floor(input.count));
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
      const mainIdea =
        typeof rec['mainIdea'] === 'string'
          ? rec['mainIdea']
          : typeof rec['main_idea'] === 'string'
            ? rec['main_idea']
            : typeof rec['thesis'] === 'string'
              ? rec['thesis']
              : typeof rec['summary'] === 'string'
                ? rec['summary']
                : undefined;
      const imageIntent =
        typeof rec['imageIntent'] === 'string'
          ? rec['imageIntent']
          : typeof rec['image_intent'] === 'string'
            ? rec['image_intent']
            : typeof rec['visualIntent'] === 'string'
              ? rec['visualIntent']
              : undefined;
      const imageQuery =
        typeof rec['imageQuery'] === 'string'
          ? rec['imageQuery']
          : typeof rec['image_query'] === 'string'
            ? rec['image_query']
            : undefined;
      const requirementsRaw = rec['requirements'] ?? rec['constraints'];
      const requirements = Array.isArray(requirementsRaw)
        ? requirementsRaw
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
        : typeof requirementsRaw === 'string'
          ? [requirementsRaw.trim()].filter((x) => x.length > 0)
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
      out.push({
        title,
        tags,
        mainIdea,
        angle,
        imageIntent,
        requirements,
        imageQuery,
        notes,
      });
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
        mainIdea:
          typeof rec['mainIdea'] === 'string' ? rec['mainIdea'] : undefined,
        angle: typeof rec['angle'] === 'string' ? rec['angle'] : undefined,
        imageIntent:
          typeof rec['imageIntent'] === 'string'
            ? rec['imageIntent']
            : undefined,
        requirements: Array.isArray(rec['requirements'])
          ? rec['requirements']
          : undefined,
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

  /**
   * @description 提取封面浮动文案（文章类型）。
   * @param {string} title - 文章标题。
   * @param {string[]} tags - 标签。
   * @returns {string} 封面文案。
   * @keyword-en derive cover text
   */
  private deriveCoverText(title: string, tags?: string[]): string {
    const firstTag = Array.isArray(tags)
      ? tags.map((x) => String(x ?? '').trim()).find((x) => x.length > 0)
      : undefined;
    if (firstTag) return firstTag;
    const clean = String(title || '')
      .replace(/[\s\-_:：]+/g, ' ')
      .trim();
    if (!clean) return '示例文章';
    return clean;
  }

  /**
   * @description 计算文本视觉宽度（中日韩按2单位，英文按1单位）。
   * @param {string} text - 原始文本。
   * @returns {number} 视觉单位。
   * @keyword-en visual width units
   */
  private getVisualWidthUnits(text: string): number {
    const s = String(text ?? '').trim();
    let units = 0;
    for (const ch of s) {
      const wide = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch);
      units += wide ? 2 : 1;
    }
    return Math.max(1, units);
  }

  /**
   * @description 按视觉宽度拆分文本为多行（不裁剪内容）。
   * @param {string} text - 原始文本。
   * @param {number} maxUnitsPerLine - 每行最大视觉单位。
   * @returns {string[]} 文本行。
   * @keyword-en split text lines by visual width
   */
  private splitTextByVisualWidth(
    text: string,
    maxUnitsPerLine: number,
  ): string[] {
    const s = String(text ?? '').trim();
    if (!s) return [];
    const max = Math.max(4, Math.floor(Number(maxUnitsPerLine) || 12));
    const lines: string[] = [];
    let cur = '';
    let units = 0;
    for (const ch of s) {
      const wide = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch);
      const step = wide ? 2 : 1;
      if (cur && units + step > max) {
        lines.push(cur.trim());
        cur = ch;
        units = step;
      } else {
        cur += ch;
        units += step;
      }
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }

  /**
   * @description 规范化封面文案（中文优先，清理控制字符）。
   * @param {string} text - 原始文本。
   * @param {string} fallback - 兜底文本。
   * @param {number} _maxLen - 保留参数，兼容旧调用。
   * @returns {string} 可渲染文案。
   * @keyword-en normalize cover text
   */
  private normalizeCoverText(
    text: string,
    fallback: string,
    _maxLen: number,
  ): string {
    const normalized = String(text ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized.length > 0) return normalized;
    return (
      String(fallback || '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || '示例封面'
    );
  }

  /**
   * @description 将创作文案/生图提示词中的高风险 IP、商标、角色专名替换为版权安全的泛化表达。
   * @param {unknown} raw - 原始文本。
   * @returns {string} 泛化后的安全文本。
   * @keyword-en sanitize, copyright-safe, image-prompt
   */
  private sanitizeCopyrightRiskText(raw: unknown): string {
    let text = String(raw ?? '')
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
      .replace(/[ \t\u3000]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) return '';
    const replacements: Array<[RegExp, string]> = [
      [/哈利\s*波特|harry\s*potter/gi, '魔法学院风'],
      [/霍格沃茨|hogwarts/gi, '魔法学院场景'],
      [/格兰芬多|斯莱特林|赫奇帕奇|拉文克劳/gi, '学院分组'],
      [/迪士尼|disney/gi, '童话乐园风'],
      [/米奇|米妮|mickey|minnie/gi, '经典卡通风'],
      [/冰雪奇缘|艾莎|安娜公主|frozen|elsa/gi, '冰雪童话风'],
      [
        /漫威|复仇者联盟|钢铁侠|蜘蛛侠|spider[-\s]?man|iron\s*man|marvel/gi,
        '超级英雄风',
      ],
      [/奥特曼|ultraman/gi, '光之英雄风'],
      [/星球大战|star\s*wars/gi, '太空冒险风'],
      [/马里奥|超级玛丽|mario/gi, '经典像素游戏风'],
      [/宝可梦|精灵宝可梦|口袋妖怪|皮卡丘|pok[eé]mon|pikachu/gi, '萌宠冒险风'],
      [/哆啦A梦|机器猫|doraemon/gi, '未来伙伴风'],
      [/蜡笔小新|樱桃小丸子|名侦探柯南|海贼王|火影忍者|龙珠/gi, '日系动漫风'],
      [/小黄人|minions?/gi, '黄色萌趣角色风'],
      [/芭比|barbie/gi, '粉色时尚玩偶风'],
      [/变形金刚|transformers?/gi, '机甲科幻风'],
      [/hello\s*kitty|凯蒂猫/gi, '可爱猫咪风'],
      [/史努比|snoopy/gi, '简笔卡通风'],
    ];
    for (const [pattern, replacement] of replacements) {
      text = text.replace(pattern, replacement);
    }
    return text
      .replace(/知名\s*IP|原版角色|官方角色|同款角色|复刻角色/gi, '通用主题')
      .replace(/[ \t\u3000]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * @description 清洗列表型创作提示，去重后返回版权安全表达。
   * @param {unknown[] | undefined} items - 原始列表。
   * @returns {string[]} 泛化后的安全列表。
   * @keyword-en sanitize, copyright-safe, list
   */
  private sanitizeCopyrightRiskList(items?: unknown[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(items) ? items : []) {
      const text = this.sanitizeCopyrightRiskText(item);
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
    return out;
  }

  /**
   * @description 为创作/生图提示词构造版权安全蓝图，保留业务主旨但泛化 IP 专名。
   * @param {ArticleBlueprint} blueprint - 原始文章蓝图。
   * @returns {ArticleBlueprint} 可传给 LLM 创作节点的安全蓝图。
   * @keyword-en sanitize, blueprint, copyright-safe
   */
  private sanitizeBlueprintForCreativePrompt(
    blueprint: ArticleBlueprint,
  ): ArticleBlueprint {
    return {
      ...blueprint,
      title: this.sanitizeCopyrightRiskText(blueprint.title),
      tags: this.sanitizeCopyrightRiskList(blueprint.tags),
      mainIdea: this.sanitizeCopyrightRiskText(blueprint.mainIdea),
      angle: this.sanitizeCopyrightRiskText(blueprint.angle),
      imageIntent: this.sanitizeCopyrightRiskText(blueprint.imageIntent),
      requirements: this.sanitizeCopyrightRiskList(blueprint.requirements),
      imageQuery: this.sanitizeCopyrightRiskText(blueprint.imageQuery),
      notes: this.sanitizeCopyrightRiskList(blueprint.notes),
    };
  }

  /**
   * @description 生成封面文案（主标题+副标题）。
   * @param {object} input - 文章信息。
   * @returns {Promise<{ title: string; subtitle: string }>} 封面文案。
   * @keyword-en generate cover copy by llm
   */
  /**
   * @description 构建文章生成节点的实时环境上下文（时间 + 平台AI提示）。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<{ datetime: string; platformAiPrompt: string }>}
   * @keyword-en build article env context datetime platform ai prompt
   */
  private async buildArticleEnvContext(
    tenantId?: string,
  ): Promise<{ datetime: string; platformAiPrompt: string }> {
    const now = new Date();
    const datetime = now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    let platformAiPrompt = '';
    try {
      const info = await this.sassService.getPlatformInfo(tenantId);
      platformAiPrompt = String(info?.aiPromptSupplement ?? '').trim();
    } catch {
      void 0;
    }
    return { datetime, platformAiPrompt };
  }

  private async generateCoverCopyByLlm(input: {
    articleTitle: string;
    articleTags?: string[];
    imageQuery?: string;
    /** 平台AI补充提示（从租户配置注入） */
    platformAiPrompt?: string;
    /** 当前时间字符串 */
    currentDatetime?: string;
  }): Promise<{
    title: string;
    subtitle: string;
    titleFromLlm: boolean;
  }> {
    const safeArticleTitle = this.sanitizeCopyrightRiskText(input.articleTitle);
    const safeArticleTags = this.sanitizeCopyrightRiskList(input.articleTags);
    const safeImageQuery = this.sanitizeCopyrightRiskText(input.imageQuery);
    const fallbackTitle = this.deriveCoverText(
      safeArticleTitle || input.articleTitle,
      safeArticleTags,
    );
    const fallbackSubtitle = String(safeImageQuery ?? '')
      .replace(/[\s\u3000]+/g, ' ')
      .trim();

    const envLines = [
      input.currentDatetime ? `当前时间：${input.currentDatetime}` : '',
      input.platformAiPrompt
        ? `【平台业务说明】\n${input.platformAiPrompt}`
        : '',
    ].filter((x) => x.length > 0);

    const sys = [
      '你是封面文案生成器。',
      '只输出 JSON：{"title": string, "subtitle": string}',
      'title 与 subtitle 使用中文优先，可包含少量英文或数字。',
      'title 建议 8-16 字，语义必须完整，不要截断。',
      'subtitle 建议 12-24 字，语义必须完整，不要截断。',
      '不要使用引号、emoji、夸张营销词。',
      '封面文案必须与业务范围完全吻合，禁止涉及平台业务说明中未提及的服务或场景。',
      '版权合规：title 与 subtitle 严禁出现受版权/商标保护的专有名词（知名 IP、动漫/游戏角色名、品牌名、明星姓名、品牌门店名除外）。',
      '若输入涉及知名 IP/角色/品牌，只能输出泛化主题氛围，例如“魔法学院风”“冰雪童话风”“超级英雄风”，不得复刻或暗示具体角色、学院名、徽章、服装、道具。',
      ...envLines,
    ].join('\n');

    try {
      const llm = await this.agent.buildLLM({
        temperature: 0.3,
        nonStreaming: true,
        recursionLimit: 20,
        system: sys,
      });
      const structured = llm.withStructuredOutput(ZCoverCopy);
      const output = await structured.invoke(
        [
          new SystemMessage(sys),
          new HumanMessage(
            JSON.stringify({
              articleTitle: safeArticleTitle,
              articleTags: safeArticleTags,
              imageQuery: safeImageQuery,
            }),
          ),
        ],
        this.agent.buildNoStreamInvokeOption(),
      );
      const parsed = ZCoverCopy.safeParse(output);
      if (parsed.success) {
        const rawTitle = String(parsed.data.title ?? '').trim();
        const rawSubtitle = String(parsed.data.subtitle ?? '').trim();
        this.logger.debug(
          `[cover-copy] llm_result titleLen=${rawTitle.length} subtitleLen=${rawSubtitle.length}`,
        );
        return {
          title: this.normalizeCoverText(
            this.sanitizeCopyrightRiskText(rawTitle),
            '沉浸式体验',
            10,
          ),
          subtitle: this.normalizeCoverText(
            this.sanitizeCopyrightRiskText(rawSubtitle),
            '现场氛围与互动',
            16,
          ),
          titleFromLlm: rawTitle.length > 0,
        };
      }
      this.logger.warn('[cover-copy] llm_parse_invalid use_fallback=true');
    } catch {
      this.logger.warn('[cover-copy] llm_invoke_failed use_fallback=true');
      void 0;
    }

    return {
      title: this.normalizeCoverText(fallbackTitle, '沉浸式体验', 10),
      subtitle: this.normalizeCoverText(fallbackSubtitle, '现场氛围与互动', 16),
      titleFromLlm: false,
    };
  }

  /**
   * @description 读取租户平台配置中的 AI 封面开关。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<boolean>} 是否启用 AI 封面。
   * @keyword-en resolve ai cover toggle by tenant
   */
  private async isAiCoverEnabled(tenantId?: string): Promise<boolean> {
    try {
      const info = await this.sassService.getPlatformInfo(tenantId);
      return info?.enableAiCover === true;
    } catch {
      return false;
    }
  }

  /**
   * @description 推演封面生图提示词（优先 LLM，失败回退模板）。
   * @param {object} input - 提示词推演输入。
   * @returns {Promise<string>} 生图提示词。
   * @keyword-en build ai cover image prompt
   */
  private async buildAiCoverImagePrompt(input: {
    topic?: string;
    articleTitle: string;
    articleTags?: string[];
    imageQuery?: string;
    coverTitle: string;
    coverSubtitle?: string;
    /** 平台AI补充提示（从租户配置注入） */
    platformAiPrompt?: string;
    /** 当前时间字符串 */
    currentDatetime?: string;
  }): Promise<string> {
    const safeInput = {
      ...input,
      topic: this.sanitizeCopyrightRiskText(input.topic),
      articleTitle: this.sanitizeCopyrightRiskText(input.articleTitle),
      articleTags: this.sanitizeCopyrightRiskList(input.articleTags),
      imageQuery: this.sanitizeCopyrightRiskText(input.imageQuery),
      coverTitle: this.sanitizeCopyrightRiskText(input.coverTitle),
      coverSubtitle: this.sanitizeCopyrightRiskText(input.coverSubtitle),
    };
    const appendCoverTextDirectives = (rawPrompt: string): string => {
      const core = String(rawPrompt ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return [
        this.sanitizeCopyrightRiskText(core),
        safeInput.coverTitle ? `封面主标题:${safeInput.coverTitle}` : '',
        safeInput.coverSubtitle ? `封面副标题:${safeInput.coverSubtitle}` : '',
        '文案呈现:请将封面主标题与副标题以浮动文字形式显示在画面中，确保清晰可读且不被遮挡',
        '视觉风格:实景照片优先，保持真实摄影、现场氛围、自然光影和真实人物比例；只做轻量封面化修图与干净排版',
        '风格限制:不要动画化、卡通化、3D Q版、漫画冲击线、爆裂粒子、霓虹光带、密集贴纸或过度特效',
        '版权安全:画面不得出现或模仿任何具体 IP、角色、品牌、影视/动漫/游戏元素、徽章、制服、学院名、官方道具；只保留通用氛围',
      ]
        .filter((x) => x.length > 0)
        .join('；');
    };

    const fallback = [
      '小红书封面图',
      safeInput.topic ? `主题:${safeInput.topic}` : '',
      `标题:${safeInput.coverTitle}`,
      safeInput.coverSubtitle ? `副标题:${safeInput.coverSubtitle}` : '',
      safeInput.imageQuery ? `视觉线索:${safeInput.imageQuery}` : '',
      Array.isArray(safeInput.articleTags) && safeInput.articleTags.length > 0
        ? `元素:${safeInput.articleTags.slice(0, 10).join(',')}`
        : '',
      '竖版 640x853，实景照片质感，真实现场氛围，高清，干净文字排版，适合移动端浏览',
    ]
      .filter((x) => x.length > 0)
      .join('；');

    try {
      const llm = await this.agent.buildLLM({
        nonStreaming: true,
        temperature: 0.4,
      });
      const res = await llm.invoke(
        [
          '你是一名封面视觉提示词工程师。',
          '请根据输入信息输出 1 条可直接用于生图的中文提示词。',
          '要求：不超过 180 字，包含主体、风格、构图、光线、氛围。',
          '视觉方向：实景照片优先，保持真实摄影质感、自然光影和现场感，只允许轻量封面设计。',
          '严禁动画化、卡通化、3D Q版、漫画化、夸张特效、速度线、爆裂粒子、霓虹光带、密集贴纸。',
          '禁止输出 markdown、代码块、解释性内容。',
          '版权安全硬约束：不得出现任何具体 IP/商标/动漫/游戏/影视角色/明星/品牌名，不得复刻角色服装、徽章、道具、学院名或官方视觉符号；遇到相关输入必须改写成通用氛围词。',
          input.currentDatetime ? `当前时间：${input.currentDatetime}` : '',
          input.platformAiPrompt
            ? `【平台业务说明 - 必须严格遵守，内容不得超出以下范围】\n${input.platformAiPrompt}`
            : '',
          JSON.stringify(safeInput),
        ]
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .join('\n'),
        this.agent.buildNoStreamInvokeOption(),
      );
      const content = res?.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((item) => {
            if (typeof item === 'string') return item;
            if (!item || typeof item !== 'object') return '';
            const rec = item as Record<string, unknown>;
            if (typeof rec['text'] === 'string') return rec['text'];
            if (typeof rec['content'] === 'string') return rec['content'];
            return '';
          })
          .join(' ');
      }
      const normalized = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (normalized.length >= 8) {
        return appendCoverTextDirectives(
          this.sanitizeCopyrightRiskText(normalized).slice(0, 240),
        );
      }
      return appendCoverTextDirectives(fallback);
    } catch {
      return appendCoverTextDirectives(fallback);
    }
  }

  /**
   * @description 调用生图模型生成封面并入图库。
   * @param {object} input - 生图参数。
   * @returns {Promise<GalleryImageEntity | null>} 入库后的封面图。
   * @keyword-en generate ai cover image and save gallery
   */
  private async tryGenerateAiCoverImage(input: {
    tenantId?: string;
    galleryUserId: string;
    galleryGroupId?: number;
    topic?: string;
    articleTitle: string;
    articleTags?: string[];
    imageQuery?: string;
    coverTitle: string;
    coverSubtitle?: string;
    sourceImageIds?: number[];
    baseImageCandidates?: string[];
    /** 平台AI补充提示（从租户配置注入） */
    platformAiPrompt?: string;
    /** 当前时间字符串 */
    currentDatetime?: string;
  }): Promise<GalleryImageEntity | null> {
    try {
      const prompt = await this.buildAiCoverImagePrompt({
        topic: input.topic,
        articleTitle: input.articleTitle,
        articleTags: input.articleTags,
        imageQuery: input.imageQuery,
        coverTitle: input.coverTitle,
        coverSubtitle: input.coverSubtitle,
        platformAiPrompt: input.platformAiPrompt,
        currentDatetime: input.currentDatetime,
      });
      const generated = await this.agent.sendPrompt({
        prompt,
        size: '640x853',
        baseImageCandidates: input.baseImageCandidates,
      });
      const imageUrl = String(generated.imagePath ?? '').trim();
      if (!imageUrl.startsWith('/static/uploads/')) {
        this.logger.warn('[assign-image] ai_cover_generated_invalid_url');
        return null;
      }
      const absPath = this.resolveLocalPathFromGalleryUrl(imageUrl);
      if (!absPath) return null;
      const fileName = imageUrl.slice('/static/uploads/'.length);
      if (!fileName) return null;

      const img = await this.saveGeneratedImageToGallery({
        userId: input.galleryUserId,
        tenantId: input.tenantId,
        groupId: input.galleryGroupId,
        absPath,
        fileName,
        url: imageUrl,
        description: `AI封面图（${generated.providerCode}:${generated.model}）`,
        generatedKind: 'cover',
        collageSourceImageIds: Array.isArray(input.sourceImageIds)
          ? input.sourceImageIds
              .map((x) => Number(x))
              .filter((x) => Number.isFinite(x))
              .slice(0, 2)
          : undefined,
      });
      return img;
    } catch (err) {
      this.logger.warn(
        `[assign-image] ai_cover_generate_failed reason=${String(err)}`,
      );
      return null;
    }
  }

  /**
   * @description 将图库 URL 映射到本地静态文件路径。
   * @param {string} url - 图库 URL。
   * @returns {string | undefined} 本地路径。
   * @keyword-en resolve local path from gallery url
   */
  private resolveLocalPathFromGalleryUrl(url?: string): string | undefined {
    const s = String(url ?? '').trim();
    if (!s || /^https?:\/\//i.test(s)) return undefined;
    if (s.startsWith('/static/uploads/')) {
      return join(
        process.cwd(),
        'public',
        'uploads',
        s.slice('/static/uploads/'.length),
      );
    }
    if (s.startsWith('/static/uploads_thumbs/')) {
      return join(
        process.cwd(),
        'public',
        'uploads_thumbs',
        s.slice('/static/uploads_thumbs/'.length),
      );
    }
    return undefined;
  }

  /**
   * @description 获取 Jimp 模块。
   * @returns {Promise<JimpModuleLike>} Jimp 模块。
   * @keyword-en get jimp module
   */
  private async getJimpModule(): Promise<JimpModuleLike> {
    if (!jimpModulePromise) {
      jimpModulePromise = import('jimp') as Promise<unknown>;
    }
    return (await jimpModulePromise) as JimpModuleLike;
  }

  /**
   * @description 按候选顺序尝试加载 Jimp 字体。
   * @param {JimpModuleLike} mod - Jimp 模块。
   * @param {unknown[]} candidates - 候选字体常量或路径。
   * @returns {Promise<unknown | undefined>} 成功字体对象。
   * @keyword-en load jimp font fallback
   */
  private async loadJimpFontFallback(
    mod: JimpModuleLike,
    candidates: unknown[],
  ): Promise<unknown | undefined> {
    if (typeof mod.loadFont !== 'function') return undefined;
    for (const c of candidates) {
      if (!c) continue;
      try {
        const f = await mod.loadFont(c);
        if (f) return f;
      } catch {
        void 0;
      }
    }
    return undefined;
  }

  /**
   * @description 转义 SVG 文本。
   * @param {string} text - 原始文本。
   * @returns {string} 转义后文本。
   * @keyword-en escape svg text
   */
  private escapeSvgText(text: string): string {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * @description 使用 sharp + SVG 渲染封面文字。
   * @param {object} input - 封面渲染入参。
   * @returns {Promise<boolean>} 是否成功。
   * @keyword-en render cover with sharp svg
   */
  private async renderCoverWithSharp(input: {
    collagePath: string;
    title: string;
    subtitle: string;
    outputPath: string;
  }): Promise<boolean> {
    const safeTitle = String(input.title || '').trim() || '示例封面';
    const safeSubtitle = String(input.subtitle || '').trim();
    const needsCjk =
      this.hasCjkChars(safeTitle) || this.hasCjkChars(safeSubtitle);
    const fontFaceCss = needsCjk
      ? await this.buildCustomFontFaceCssOrThrow()
      : '';

    try {
      const mod = (await import('sharp')) as unknown as {
        default: (input: string | Buffer) => {
          resize: (
            w: number,
            h: number,
            opts?: Record<string, unknown>,
          ) => unknown;
          composite: (
            layers: Array<{ input: Buffer; top?: number; left?: number }>,
          ) => unknown;
          jpeg: (opts?: Record<string, unknown>) => unknown;
          toFile: (path: string) => Promise<unknown>;
        };
      };
      const sharpFn = mod?.default;
      if (typeof sharpFn !== 'function') return false;

      const subtitleForRender = safeSubtitle;
      const subtitleEscaped = this.escapeSvgText(subtitleForRender);
      const titleUnits = this.getVisualWidthUnits(safeTitle);
      const subtitleUnits = this.getVisualWidthUnits(subtitleForRender);
      const titleFontSize = Math.max(
        34,
        Math.min(60, Math.floor(900 / Math.max(10, titleUnits))),
      );
      const subtitleFontSize = Math.max(
        22,
        Math.min(34, Math.floor(760 / Math.max(12, subtitleUnits))),
      );
      const titleLines = this.splitTextByVisualWidth(safeTitle, 20);
      const subtitleLines = this.splitTextByVisualWidth(subtitleForRender, 28);
      const titleStartY = Math.max(
        34,
        41 - (Math.max(1, titleLines.length) - 1) * 4,
      );
      const subtitleStartY = Math.min(
        74,
        54 + (Math.max(1, titleLines.length) - 1) * 3,
      );
      const titleTspans = (titleLines.length > 0 ? titleLines : [''])
        .map(
          (line, idx) =>
            `<tspan x="50%" dy="${idx === 0 ? 0 : 1.18}em">${this.escapeSvgText(line)}</tspan>`,
        )
        .join('');
      const subtitleTspans = subtitleLines
        .map(
          (line, idx) =>
            `<tspan x="50%" dy="${idx === 0 ? 0 : 1.2}em">${this.escapeSvgText(line)}</tspan>`,
        )
        .join('');
      const svg = `
<svg width="${COLLAGE_WIDTH}" height="${COLLAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    ${fontFaceCss}
    .t{fill:#ffffff;font-size:${titleFontSize}px;font-weight:900;font-family:'ProjectCoverCJK','Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Source Han Sans SC','SimHei',Arial,Helvetica,sans-serif;paint-order:stroke;stroke:#000000;stroke-width:8px;}
    .s{fill:#ffffff;font-size:${subtitleFontSize}px;font-weight:700;font-family:'ProjectCoverCJK','Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Source Han Sans SC','SimHei',Arial,Helvetica,sans-serif;paint-order:stroke;stroke:#000000;stroke-width:5px;}
  </style>
  <text x="50%" y="${titleStartY}%" text-anchor="middle" dominant-baseline="middle" class="t">${titleTspans}</text>
  ${subtitleEscaped ? `<text x="50%" y="${subtitleStartY}%" text-anchor="middle" dominant-baseline="middle" class="s">${subtitleTspans}</text>` : ''}
</svg>`;

      await (
        sharpFn(input.collagePath) as unknown as {
          resize: (
            w: number,
            h: number,
            opts?: Record<string, unknown>,
          ) => {
            composite: (
              layers: Array<{ input: Buffer; top?: number; left?: number }>,
            ) => {
              jpeg: (opts?: Record<string, unknown>) => {
                toFile: (path: string) => Promise<unknown>;
              };
            };
          };
        }
      )
        .resize(COLLAGE_WIDTH, COLLAGE_HEIGHT, { fit: 'cover' })
        .composite([{ input: Buffer.from(svg, 'utf8'), top: 0, left: 0 }])
        .jpeg({ quality: 92 })
        .toFile(input.outputPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @description 判断文本是否包含中文字符。
   * @param {string} text - 输入文本。
   * @returns {boolean} 是否包含中文。
   * @keyword-en has cjk chars
   */
  private hasCjkChars(text: string): boolean {
    return /[\u3400-\u9fff]/.test(String(text || ''));
  }

  /**
   * @description 读取项目内自定义中文字体并返回 base64。
   * @returns {Promise<string>} 字体 base64。
   * @keyword-en load custom cover font base64
   */
  private async loadCustomCoverFontBase64OrThrow(): Promise<string> {
    if (this.customCoverFontLoaded && this.customCoverFontBase64) {
      return this.customCoverFontBase64;
    }

    const candidates = this.getCoverFontCandidates();
    for (const absPath of candidates) {
      try {
        const buf = await fs.readFile(absPath);
        const base64 = Buffer.from(buf).toString('base64');
        this.customCoverFontBase64 = base64;
        this.customCoverFontLoaded = true;
        await this.ensureFontconfigSetup(absPath);
        return base64;
      } catch {
        void 0;
      }
    }

    throw new Error(
      `COVER_CUSTOM_FONT_MISSING: place font at ${COVER_FONT_RELATIVE_PATH} (or set COVER_FONT_PATH). tried=${candidates.join('|')}`,
    );
  }

  /**
   * @description 返回封面字体候选绝对路径（兼容 build 后目录）。
   * @returns {string[]} 候选路径列表。
   * @keyword-en cover font candidate paths
   */
  private getCoverFontCandidates(): string[] {
    const envPath = String(process.env.COVER_FONT_PATH || '').trim();
    const out: string[] = [];
    const pushPath = (p: string) => {
      const v = String(p || '').trim();
      if (!v || out.includes(v)) return;
      out.push(v);
    };

    if (envPath) {
      if (/^(?:[a-zA-Z]:\\|\/)/.test(envPath)) {
        pushPath(envPath);
      } else {
        pushPath(join(process.cwd(), envPath));
      }
    }

    pushPath(join(process.cwd(), 'public', 'fonts', 'cover-cjk.ttf'));
    pushPath(join(process.cwd(), 'dist', 'public', 'fonts', 'cover-cjk.ttf'));
    pushPath(join(process.cwd(), 'web', 'public', 'fonts', 'cover-cjk.ttf'));
    return out;
  }

  /**
   * @description 将字体写入 /tmp/cover-fonts 并通过 FONTCONFIG_FILE 使 librsvg 能发现该字体，解决 Alpine 无系统中文字体问题。
   * @param {string} fontFilePath - 字体绝对路径。
   * @keyword-en setup fontconfig for cover cjk font
   */
  private async ensureFontconfigSetup(fontFilePath: string): Promise<void> {
    if (this.fontconfigSetupDone) return;
    try {
      const tmpDir = '/tmp/cover-fonts';
      const cacheDir = `${tmpDir}/cache`;
      await fs.mkdir(cacheDir, { recursive: true });
      const tmpFont = `${tmpDir}/cover-cjk.ttf`;
      try {
        await fs.access(tmpFont);
      } catch {
        await fs.copyFile(fontFilePath, tmpFont);
      }
      const confPath = `${tmpDir}/fonts.conf`;
      try {
        await fs.access(confPath);
      } catch {
        const conf = [
          '<?xml version="1.0"?>',
          '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
          '<fontconfig>',
          `  <dir>${tmpDir}</dir>`,
          `  <cachedir>${cacheDir}</cachedir>`,
          '</fontconfig>',
        ].join('\n');
        await fs.writeFile(confPath, conf, 'utf8');
      }
      process.env.FONTCONFIG_FILE = confPath;
      process.env.FONTCONFIG_PATH = tmpDir;
      this.fontconfigSetupDone = true;
    } catch {
      void 0; // best-effort, Windows dev env 忽略
    }
  }

  /**
   * @description 生成 SVG 可用的自定义字体声明。
   * @returns {Promise<string>} @font-face css。
   * @keyword-en build custom font face css
   */
  private async buildCustomFontFaceCssOrThrow(): Promise<string> {
    const base64 = await this.loadCustomCoverFontBase64OrThrow();
    return `@font-face{font-family:'ProjectCoverCJK';src:url(data:font/ttf;base64,${base64}) format('truetype');font-weight:400 900;font-style:normal;}`;
  }

  /**
   * @description 判断图片是否为历史封面图。
   * @param {GalleryImageEntity} img - 图库图片。
   * @returns {boolean} 是否历史封面。
   * @keyword-en detect generated cover image
   */
  private isGeneratedCoverImage(img?: GalleryImageEntity | null): boolean {
    if (!img || typeof img !== 'object') return false;
    const tags = Array.isArray(img.tags)
      ? img.tags.map((x) => String(x ?? '').trim())
      : [];
    if (tags.some((t) => /封面|自动封面/i.test(t))) return true;
    const desc = String(img.description ?? '').trim();
    if (/封面/.test(desc)) return true;
    const fileName = String(img.fileName ?? img.originalName ?? '').trim();
    if (/-cover\.(jpg|jpeg|png)$/i.test(fileName)) return true;
    return false;
  }

  /**
   * @description 读取本地图片尺寸信息。
   * @param {string} absPath - 图片绝对路径。
   * @returns {Promise<{ width: number; height: number; isPortrait: boolean } | null>} 尺寸信息。
   * @keyword-en read local image dimensions
   */
  private async getImageDimensionsFromAbsPath(absPath: string): Promise<{
    width: number;
    height: number;
    isPortrait: boolean;
  } | null> {
    const src = String(absPath || '').trim();
    if (!src) return null;
    try {
      const mod = await this.getJimpModule();
      const JimpCtor = mod.Jimp as unknown as {
        read: (
          input: string,
        ) => Promise<{ bitmap?: { width?: number; height?: number } }>;
      };
      const img = await JimpCtor.read(src);
      const w = Number(img?.bitmap?.width ?? 0);
      const h = Number(img?.bitmap?.height ?? 0);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        return null;
      }
      const width = Math.floor(w);
      const height = Math.floor(h);
      return {
        width,
        height,
        isPortrait: height > width,
      };
    } catch {
      return null;
    }
  }

  /**
   * @description 获取默认动态分组ID（动态封面/动态拼图），用于过滤来源图。
   * @param {string} userId - 用户ID。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<number[]>} 默认动态分组ID列表。
   * @keyword-en get default generated group ids
   */
  private async getGeneratedAssetDefaultGroupIds(
    userId: string,
    tenantId?: string,
  ): Promise<number[]> {
    return this.galleryGroups.getDefaultDynamicGroupIds(userId, tenantId);
  }

  /**
   * @description 洗牌返回新数组。
   * @param {T[]} input - 原数组。
   * @returns {T[]} 洗牌后的数组。
   * @keyword-en shuffle array
   */
  private shuffleArray<T>(input: T[]): T[] {
    const arr = Array.isArray(input) ? [...input] : [];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * @description 提取图片语义 token（标签+描述+文件名）用于相似度估计。
   * @param {GalleryImageEntity} img - 图片实体。
   * @returns {Set<string>} token 集合。
   * @keyword-en build image semantic tokens
   */
  private buildImageSemanticTokens(img: GalleryImageEntity): Set<string> {
    const tokens = new Set<string>();
    const pushText = (value: unknown) => {
      const s = String(value ?? '').toLowerCase();
      const parts = s
        .split(/[^\p{L}\p{N}]+/u)
        .map((x) => x.trim())
        .filter((x) => x.length >= 2);
      for (const p of parts) tokens.add(p);
    };
    for (const t of Array.isArray(img?.tags) ? img.tags : []) pushText(t);
    pushText(img?.description);
    pushText(img?.fileName);
    pushText(img?.originalName);
    return tokens;
  }

  /**
   * @description 计算两图差异分，越大代表越不相似。
   * @param {GalleryImageEntity} a - 图片A。
   * @param {GalleryImageEntity} b - 图片B。
   * @returns {number} 差异分（0~1）。
   * @keyword-en score collage pair diversity
   */
  private scoreImagePairDiversity(
    a: GalleryImageEntity,
    b: GalleryImageEntity,
  ): number {
    const ta = this.buildImageSemanticTokens(a);
    const tb = this.buildImageSemanticTokens(b);
    if (ta.size === 0 && tb.size === 0) return 0.5;
    let inter = 0;
    for (const t of ta) {
      if (tb.has(t)) inter++;
    }
    const union = ta.size + tb.size - inter;
    const jaccard = union > 0 ? inter / union : 0;
    return Math.max(0, Math.min(1, 1 - jaccard));
  }

  /**
   * @description 在候选图中挑选差异度最高的一组拼图对。
   * @param {GalleryImageEntity[]} input - 候选图列表。
   * @returns {[GalleryImageEntity, GalleryImageEntity] | null} 最优二元组。
   * @keyword-en pick best diverse collage pair
   */
  private pickMostDiversePair(
    input: GalleryImageEntity[],
  ): [GalleryImageEntity, GalleryImageEntity] | null {
    if (!Array.isArray(input) || input.length < 2) return null;
    let best: [GalleryImageEntity, GalleryImageEntity] | null = null;
    let bestScore = -1;
    for (let i = 0; i < input.length; i++) {
      for (let j = i + 1; j < input.length; j++) {
        const a = input[i];
        const b = input[j];
        const score = this.scoreImagePairDiversity(a, b);
        if (score > bestScore) {
          bestScore = score;
          best = [a, b];
        }
      }
    }
    return best;
  }

  /**
   * @description 生成双图动态拼图（640x853）。
   * @param {string} pathA - 图片A本地路径。
   * @param {string} pathB - 图片B本地路径。
   * @returns {Promise<{ fileName: string; absPath: string; url: string }>} 生成文件信息。
   * @keyword-en create dynamic collage file
   */
  private async createDynamicCollageFile(
    pathA: string,
    pathB: string,
  ): Promise<{
    fileName: string;
    absPath: string;
    url: string;
  }> {
    const mod = await this.getJimpModule();
    const JimpCtor = mod.Jimp as unknown as {
      read: (input: string) => Promise<{
        bitmap: { width: number; height: number };
        resize: (opts: { w: number; h: number }) => unknown;
      }>;
      new (args: { width: number; height: number; color: number }): {
        composite: (img: unknown, x: number, y: number) => unknown;
        write: (path: string, opts?: { quality?: number }) => Promise<unknown>;
      };
      rgbaToInt?: (r: number, g: number, b: number, a: number) => number;
    };

    const [imgA, imgB] = await Promise.all([
      JimpCtor.read(pathA),
      JimpCtor.read(pathB),
    ]);

    const topH = Math.floor(COLLAGE_HEIGHT / 2);
    const bottomH = COLLAGE_HEIGHT - topH;

    // 上图：等比缩到 topH 高度，不裁剪
    const bitmapA = (
      imgA as unknown as { bitmap: { width: number; height: number } }
    ).bitmap;
    const iwA = Math.max(1, Number(bitmapA?.width ?? 1));
    const ihA = Math.max(1, Number(bitmapA?.height ?? 1));
    const drawWA = Math.max(1, Math.round(iwA * (topH / ihA)));
    imgA.resize({ w: drawWA, h: topH });

    // 下图：等比缩到 bottomH 高度，不裁剪
    const bitmapB = (
      imgB as unknown as { bitmap: { width: number; height: number } }
    ).bitmap;
    const iwB = Math.max(1, Number(bitmapB?.width ?? 1));
    const ihB = Math.max(1, Number(bitmapB?.height ?? 1));
    const drawWB = Math.max(1, Math.round(iwB * (bottomH / ihB)));
    imgB.resize({ w: drawWB, h: bottomH });

    const black =
      typeof JimpCtor.rgbaToInt === 'function'
        ? JimpCtor.rgbaToInt(0, 0, 0, 255)
        : 0x000000ff;
    const out = new JimpCtor({
      width: COLLAGE_WIDTH,
      height: COLLAGE_HEIGHT,
      color: black,
    });

    // 水平居中合成：超出画布宽度时两侧自然溢出，不足时两侧留黑边
    const xA = Math.floor((COLLAGE_WIDTH - drawWA) / 2);
    const xB = Math.floor((COLLAGE_WIDTH - drawWB) / 2);
    out.composite(imgA, xA, 0);
    out.composite(imgB, xB, topH);

    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const fileName = `${Date.now()}-${randomUUID()}-collage.png`;
    const absPath = join(uploadsDir, fileName);
    await out.write(absPath);
    return {
      fileName,
      absPath,
      url: `/static/uploads/${fileName}`,
    };
  }

  /**
   * @description 基于拼图生成浮动文字封面。
   * @param {string} collagePath - 拼图本地路径。
   * @param {string} coverTitle - 封面主标题。
   * @param {string} coverSubtitle - 封面副标题。
   * @returns {Promise<{ fileName: string; absPath: string; url: string }>} 生成文件信息。
   * @keyword-en create cover from collage
   */
  private async createCoverFromCollageFile(
    collagePath: string,
    coverTitle: string,
    coverSubtitle: string,
  ): Promise<{ fileName: string; absPath: string; url: string }> {
    this.logger.debug(
      `[cover-render] start titleLen=${String(coverTitle ?? '').trim().length} subtitleLen=${String(coverSubtitle ?? '').trim().length}`,
    );
    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const fileName = `${Date.now()}-${randomUUID()}-cover.jpg`;
    const absPath = join(uploadsDir, fileName);

    const sharpOk = await this.renderCoverWithSharp({
      collagePath,
      title: this.normalizeCoverText(
        String(coverTitle || '').trim(),
        '示例文章',
        10,
      ),
      subtitle: this.normalizeCoverText(
        String(coverSubtitle || '').trim(),
        '',
        16,
      ),
      outputPath: absPath,
    });
    if (sharpOk) {
      this.logger.debug('[cover-render] use_sharp_svg_overlay=true');
      return {
        fileName,
        absPath,
        url: `/static/uploads/${fileName}`,
      };
    }

    if (this.hasCjkChars(coverTitle) || this.hasCjkChars(coverSubtitle)) {
      throw new Error(
        `COVER_RENDER_FAILED_WITH_CUSTOM_FONT: ${COVER_FONT_RELATIVE_PATH}`,
      );
    }
    this.logger.warn(
      '[cover-render] sharp_overlay_failed fallback_to_jimp=true',
    );

    const mod = await this.getJimpModule();
    const JimpCtor = mod.Jimp as unknown as {
      read: (input: string) => Promise<{
        bitmap: { width: number; height: number; data: Buffer };
        resize: (opts: { w: number; h: number }) => unknown;
        print: (
          font: unknown,
          x: number,
          y: number,
          text: unknown,
          maxWidth?: number,
          maxHeight?: number,
        ) => unknown;
        write: (path: string, opts?: { quality?: number }) => Promise<unknown>;
      }>;
    };

    const img = await JimpCtor.read(collagePath);
    const iw = Math.max(1, Number(img.bitmap?.width ?? COLLAGE_WIDTH));
    const ih = Math.max(1, Number(img.bitmap?.height ?? COLLAGE_HEIGHT));
    if (iw !== COLLAGE_WIDTH || ih !== COLLAGE_HEIGHT) {
      img.resize({ w: COLLAGE_WIDTH, h: COLLAGE_HEIGHT });
    }

    const title = String(coverTitle || '').trim() || '示例文章';
    const subtitle = String(coverSubtitle || '').trim();
    if (typeof mod.loadFont === 'function') {
      const fontTitleWhite = await this.loadJimpFontFallback(mod, [
        mod.FONT_SANS_64_WHITE,
        mod.FONT_SANS_32_WHITE,
      ]);
      const fontTitleBlack = await this.loadJimpFontFallback(mod, [
        mod.FONT_SANS_64_BLACK,
        mod.FONT_SANS_32_BLACK,
      ]);
      const fontSubWhite = await this.loadJimpFontFallback(mod, [
        mod.FONT_SANS_32_WHITE,
        mod.FONT_SANS_64_WHITE,
      ]);
      const fontSubBlack = await this.loadJimpFontFallback(mod, [
        mod.FONT_SANS_32_BLACK,
        mod.FONT_SANS_64_BLACK,
      ]);

      this.logger.debug(
        `[cover-render] fonts titleWhite=${fontTitleWhite ? 'yes' : 'no'} titleBlack=${fontTitleBlack ? 'yes' : 'no'} subWhite=${fontSubWhite ? 'yes' : 'no'} subBlack=${fontSubBlack ? 'yes' : 'no'}`,
      );

      if (fontTitleWhite) {
        const alignX = mod.HorizontalAlign?.CENTER ?? 1;
        const alignY = mod.VerticalAlign?.MIDDLE ?? 1;
        const ty = Math.floor(COLLAGE_HEIGHT * 0.32);
        const titleStyle = {
          text: title,
          alignmentX: alignX,
          alignmentY: alignY,
        };

        if (fontTitleBlack) {
          img.print(
            fontTitleBlack,
            4,
            ty + 4,
            titleStyle,
            COLLAGE_WIDTH - 8,
            160,
          );
          img.print(
            fontTitleBlack,
            -4,
            ty + 4,
            titleStyle,
            COLLAGE_WIDTH - 8,
            160,
          );
          img.print(
            fontTitleBlack,
            4,
            ty - 4,
            titleStyle,
            COLLAGE_WIDTH - 8,
            160,
          );
          img.print(
            fontTitleBlack,
            -4,
            ty - 4,
            titleStyle,
            COLLAGE_WIDTH - 8,
            160,
          );
        }
        img.print(fontTitleWhite, 0, ty, titleStyle, COLLAGE_WIDTH, 160);

        if (subtitle && fontSubWhite) {
          const sy = ty + 126;
          const subStyle = {
            text: subtitle,
            alignmentX: alignX,
            alignmentY: alignY,
          };
          if (fontSubBlack) {
            img.print(
              fontSubBlack,
              3,
              sy + 3,
              subStyle,
              COLLAGE_WIDTH - 8,
              120,
            );
            img.print(
              fontSubBlack,
              -3,
              sy + 3,
              subStyle,
              COLLAGE_WIDTH - 8,
              120,
            );
            img.print(
              fontSubBlack,
              3,
              sy - 3,
              subStyle,
              COLLAGE_WIDTH - 8,
              120,
            );
            img.print(
              fontSubBlack,
              -3,
              sy - 3,
              subStyle,
              COLLAGE_WIDTH - 8,
              120,
            );
          }
          img.print(fontSubWhite, 0, sy, subStyle, COLLAGE_WIDTH, 120);
        }
      } else {
        this.logger.warn(
          '[cover-render] no_title_font_loaded skip_text_render',
        );
      }
    }

    await img.write(absPath, { quality: 92 });
    return {
      fileName,
      absPath,
      url: `/static/uploads/${fileName}`,
    };
  }

  /**
   * @description 存储动态生成图片到图库。
   * @param {object} input - 入参。
   * @returns {Promise<GalleryImageEntity | null>} 图库实体。
   * @keyword-en save generated image to gallery
   */

  private async saveGeneratedImageToGallery(input: {
    userId: string;
    tenantId?: string;
    groupId?: string | number;
    absPath: string;
    fileName: string;
    url: string;
    tags?: string[];
    description: string;
    isCollage?: boolean;
    collageSourceImageIds?: number[];
    generatedKind?: 'cover' | 'collage';
  }): Promise<GalleryImageEntity | null> {
    let statSize = 0;
    try {
      const stat = await fs.stat(input.absPath);
      statSize = stat.size;
    } catch {
      statSize = 0;
    }
    const ext = extname(input.fileName).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    const dimensions = await this.getImageDimensionsFromAbsPath(input.absPath);
    const generatedKind = input.generatedKind;
    const markAsCollage =
      input.isCollage === true ||
      generatedKind === 'cover' ||
      generatedKind === 'collage';

    // 为生成的图片（拼图/封面）生成缩略图
    const thumb = await this.gallery.generateThumbnail(
      input.absPath,
      input.fileName,
    );

    // 拼图/封面图片使用专用分组
    let finalGroupId = input.groupId;
    if (generatedKind === 'cover') {
      const coverGroup = await this.galleryGroups.findOrCreateDynamicCoverGroup(
        input.userId,
        input.tenantId,
      );
      finalGroupId = coverGroup.id;
    } else if (generatedKind === 'collage' || input.isCollage === true) {
      const collageGroup =
        await this.galleryGroups.findOrCreateDynamicCollageGroup(
          input.userId,
          input.tenantId,
        );
      finalGroupId = collageGroup.id;
    }

    const width =
      dimensions?.width ?? (markAsCollage ? COLLAGE_WIDTH : undefined);
    const height =
      dimensions?.height ?? (markAsCollage ? COLLAGE_HEIGHT : undefined);
    const sourceIds = Array.isArray(input.collageSourceImageIds)
      ? input.collageSourceImageIds
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x))
          .slice(0, 2)
      : [];
    const mergedTags = Array.from(
      new Set([
        ...(input.tags ?? []),
        ...(generatedKind === 'cover' ? ['自动封面', '动态封面'] : []),
        ...(generatedKind === 'collage' ? ['自动拼图', '动态拼图'] : []),
      ]),
    );

    const docs = await this.gallery.createMany([
      {
        userId: input.userId,
        tenantId: input.tenantId,
        groupId: finalGroupId,
        originalName: input.fileName,
        fileName: input.fileName,
        absPath: input.absPath,
        url: input.url,
        mimeType,
        size: statSize > 0 ? statSize : undefined,
        width,
        height,
        tags: mergedTags,
        description: input.description,
        isCollage: markAsCollage,
        collageSourceImageIds: sourceIds.length > 0 ? sourceIds : undefined,
        collageMeta: markAsCollage
          ? {
              width: typeof width === 'number' ? width : COLLAGE_WIDTH,
              height: typeof height === 'number' ? height : COLLAGE_HEIGHT,
              dpi: COLLAGE_DPI,
            }
          : undefined,
        thumbFileName: thumb?.thumbFileName,
        thumbUrl: thumb?.thumbUrl,
      },
    ]);
    return Array.isArray(docs) && docs.length > 0 ? docs[0] : null;
  }

  async generateToCanvas(input: {
    userId: string;
    tenantId?: string;
    platform?: string;
    topic?: string;
    userPrompt?: string;
    dataSummary?: string;
    writingStyle?: string;
    count?: number;
    imageMode?: 'legacy' | 'image-group';
    galleryUserId?: string;
    galleryGroupId?: number;
    imageGroupCanvasIds?: number[];
    minImageScore?: number;
    langchainContext?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const count =
      typeof input.count === 'number' && Number.isFinite(input.count)
        ? Math.max(ARTICLE_MIN_COUNT, Math.floor(input.count))
        : 3;
    const imageMode =
      input.imageMode === 'image-group' ? 'image-group' : 'legacy';
    this.logger.log(
      `[article-gen] request userId=${input.userId} topic=${String(input.topic ?? '')} platform=${String(input.platform ?? '')} count=${count} imageMode=${imageMode}`,
    );
    const platform =
      typeof input.platform === 'string' && input.platform.trim().length > 0
        ? input.platform.trim()
        : 'generic';
    const topic =
      typeof input.topic === 'string' && input.topic.trim().length > 0
        ? input.topic.trim()
        : undefined;
    const userPrompt =
      typeof input.userPrompt === 'string' && input.userPrompt.trim().length > 0
        ? input.userPrompt.trim()
        : undefined;
    const dataSummary =
      typeof input.dataSummary === 'string' &&
      input.dataSummary.trim().length > 0
        ? input.dataSummary.trim().slice(0, 8000)
        : undefined;
    const provider = undefined;
    const model = undefined;
    const temperature = 0.2;
    const galleryUserId =
      typeof input.galleryUserId === 'string' &&
      input.galleryUserId.trim().length > 0
        ? input.galleryUserId.trim()
        : input.userId;
    const tenantId =
      typeof input.tenantId === 'string' && input.tenantId.trim().length > 0
        ? input.tenantId.trim()
        : undefined;
    const galleryGroupId =
      typeof input.galleryGroupId === 'number' &&
      Number.isFinite(input.galleryGroupId)
        ? input.galleryGroupId
        : undefined;
    const imageGroupCanvasIds = Array.isArray(input.imageGroupCanvasIds)
      ? Array.from(
          new Set(
            input.imageGroupCanvasIds
              .map((x) => Number(x))
              .filter((n) => Number.isFinite(n) && n > 0)
              .map((n) => Math.floor(n)),
          ),
        )
      : [];
    const minImageScore =
      typeof input.minImageScore === 'number' &&
      Number.isFinite(input.minImageScore)
        ? Math.max(0, Math.min(1, input.minImageScore))
        : 0.5;
    const langchainContext = {
      ...this.buildLangChainContext({
        userId: input.userId,
        tenantId,
        platform,
        topic,
      }),
      ...(input.langchainContext ?? {}),
    };
    const envCtx = await this.buildArticleEnvContext(tenantId);
    const writingStyle = this.normalizeWritingStyle(
      input.writingStyle,
      platform,
    );
    const explicitImageTags = this.extractExplicitImageTagsFromPrompt({
      topic,
      userPrompt,
    });
    if (
      imageMode === 'image-group' &&
      imageGroupCanvasIds.length === 0 &&
      explicitImageTags.length === 0
    ) {
      this.logger.warn(
        `[article-gen] image_group_missing_explicit_tags topic=${String(topic ?? '')}`,
      );
      return {
        ok: false,
        status: 'missing_image_tags',
        reason: '缺少明确图库标签，未创建图文 Canvas',
        topic,
        platform,
        requestedCount: count,
        articleCount: count,
        canvasTags: [],
        missing: ['图库标签'],
      };
    }

    const plannedBlueprints = await this.planArticleTasks({
      provider,
      model,
      temperature,
      platform,
      topic,
      userPrompt,
      dataSummary,
      writingStyle,
      count,
      platformAiPrompt: envCtx.platformAiPrompt,
      currentDatetime: envCtx.datetime,
      langchainContext,
    });
    const blueprints = this.mergeExplicitImageTagsIntoBlueprints(
      plannedBlueprints,
      explicitImageTags,
    );

    const canvasTags = Array.from(
      new Set(
        blueprints
          .flatMap((bp) => bp.tags ?? [])
          .map((t) => String(t ?? '').trim())
          .filter((t) => t.length > 0),
      ),
    ).slice(0, 50);

    let preAssignedImageGroups: CanvasImageGroup[] = [];
    let prePreparedImageGroupSources:
      | Extract<ImageGroupSourcePreparation, { ok: true }>
      | undefined;
    const strictImageGroupSource =
      imageMode === 'image-group' && imageGroupCanvasIds.length > 0;
    if (imageMode === 'image-group') {
      const articlesForImageGroup = blueprints.map((bp) => ({
        title: bp.title,
        tags: Array.isArray(bp.tags)
          ? bp.tags.map((t) => String(t ?? '').trim()).filter(Boolean)
          : [],
      }));
      if (strictImageGroupSource) {
        preAssignedImageGroups = await this.collectImageGroupsFromCanvases({
          canvasIds: imageGroupCanvasIds,
          tenantId,
        });
        const usablePreAssignedGroups = preAssignedImageGroups.filter(
          (group) =>
            group.status !== 'failed' &&
            Array.isArray(group.images) &&
            group.images.length >= this.IMAGE_GROUP_MIN_IMAGES_PER_ARTICLE,
        );
        if (usablePreAssignedGroups.length < articlesForImageGroup.length) {
          this.logger.warn(
            `[article-gen] image_group_precheck_source_missing requested=${articlesForImageGroup.length} available=${usablePreAssignedGroups.length}`,
          );
          return {
            ok: false,
            status: 'insufficient_image_groups',
            reason: '指定的图组 Canvas 数量不足，未创建图文 Canvas',
            topic,
            platform,
            requestedCount: count,
            articleCount: blueprints.length,
            canvasTags,
            missing: ['图片组数量不足'],
          };
        }
        preAssignedImageGroups = usablePreAssignedGroups.slice(
          0,
          articlesForImageGroup.length,
        );
      } else {
        this.logger.log(
          `[article-gen] image_group_precheck_start articleCount=${articlesForImageGroup.length}`,
        );
        const preparation = await this.canvas.prepareImageGroupsForCanvas({
          canvasId: 0,
          userId: galleryUserId,
          tenantId,
          topic,
          articles: articlesForImageGroup,
        });
        if (!preparation.ok) {
          this.logger.warn(
            `[article-gen] image_group_precheck_insufficient ` +
              `portrait=${preparation.stats.availablePortrait}/${preparation.stats.requiredPortrait} ` +
              `landscape=${preparation.stats.availableLandscape}/${preparation.stats.requiredLandscape}`,
          );
          return {
            ok: false,
            status: 'insufficient_images',
            reason: '图库源图不足，未创建图文 Canvas',
            topic,
            platform,
            requestedCount: count,
            articleCount: blueprints.length,
            canvasTags,
            missing: ['图片素材不足'],
            imageStats: preparation.stats,
          };
        }
        prePreparedImageGroupSources = preparation;
        this.logger.log(
          `[article-gen] image_group_precheck_ok articleCount=${articlesForImageGroup.length} ` +
            `portrait=${preparation.stats.availablePortrait}/${preparation.stats.requiredPortrait} ` +
            `landscape=${preparation.stats.availableLandscape}/${preparation.stats.requiredLandscape}`,
        );
      }
    }

    const canvas = await this.canvas.create({
      userId: input.userId,
      tenantId,
      topic,
      outline: { topic, platform, articleCount: count },
      style: { platform, language: 'zh-CN', writingStyle },
    });

    // 批量预写文章存根（生成前先建列表，保证 ID 预分配），不阻塞接口返回
    await this.canvas.addArticles(
      canvas.id,
      {
        articles: blueprints.map((bp) => ({
          title: bp.title,
          tags: bp.tags ?? [],
          contentJson: {},
        })),
      },
      tenantId,
    );

    await this.canvas.updateMeta(
      canvas.id,
      {
        topic,
        outline: {
          topic,
          platform,
          articleCount: count,
          userPrompt,
          dataSummary,
          writingStyle,
          blueprints,
        },
      },
      tenantId,
    );

    this.logger.debug(
      `[article-gen] canvas_ready canvasId=${canvas.id} blueprints=${blueprints.length} tags=${canvasTags.length}`,
    );

    if (strictImageGroupSource) {
      this.logger.log(
        `[article-gen] preassigned_image_groups canvasId=${canvas.id} sourceCanvasCount=${imageGroupCanvasIds.length} groups=${preAssignedImageGroups.length}`,
      );
    }

    // 后台异步生成文章正文与配图，立即返回 generating 状态
    void this.runArticleGeneration(canvas.id, {
      blueprints,
      provider,
      model,
      temperature,
      platform,
      topic,
      userPrompt,
      dataSummary,
      writingStyle,
      imageMode,
      tenantId,
      galleryUserId,
      galleryGroupId,
      preAssignedImageGroups,
      prePreparedImageGroupSources,
      strictImageGroupSource,
      platformAiPrompt: envCtx.platformAiPrompt,
      currentDatetime: envCtx.datetime,
      minImageScore,
      langchainContext,
    });

    return {
      canvasId: canvas.id,
      canvas: {
        id: canvas.id,
        userId: input.userId,
        topic,
        platform,
        status: 'generating',
        articleCount: blueprints.length,
      },
      canvasTags,
    };
  }

  /**
   * @description 后台异步执行文章正文+配图生成并回写 Canvas 状态。
   * @param {number} canvasId - Canvas ID。
   * @param {object} input - 生成参数（蓝图列表、LLM配置、图库配置等）。
   * @returns {Promise<void>}
   * @keyword-en run article generation in background
   */
  private async runArticleGeneration(
    canvasId: number,
    input: {
      blueprints: Array<{
        index: number;
        title: string;
        tags?: string[];
        mainIdea?: string;
        angle?: string;
        imageIntent?: string;
        requirements?: string[];
        imageQuery?: string;
        notes?: string[];
      }>;
      provider?: 'gemini' | 'deepseek';
      model?: string;
      temperature: number;
      platform: string;
      topic?: string;
      userPrompt?: string;
      dataSummary?: string;
      writingStyle?: string;
      imageMode?: 'legacy' | 'image-group';
      tenantId?: string;
      galleryUserId: string;
      galleryGroupId?: number;
      preAssignedImageGroups?: CanvasImageGroup[];
      prePreparedImageGroupSources?: Extract<
        ImageGroupSourcePreparation,
        { ok: true }
      >;
      /** 指定 imageGroupCanvasIds 时开启：禁止自动兜底生成图组 */
      strictImageGroupSource?: boolean;
      /** 平台AI补充提示（从租户配置注入） */
      platformAiPrompt?: string;
      /** 当前时间字符串 */
      currentDatetime?: string;
      minImageScore: number;
      langchainContext: Record<string, unknown>;
    },
  ): Promise<void> {
    this.logger.debug(
      `[article-gen] generation_start canvasId=${canvasId} blueprints=${input.blueprints.length}`,
    );
    try {
      await this.generateArticlesAndImages({ canvasId, ...input });
      const latest = await this.canvas.get(canvasId, input.tenantId);
      const requiresHuman =
        latest?.articles?.some(
          (article) => article.status === 'requires_human',
        ) === true;
      await this.canvas.updateStatus(
        canvasId,
        requiresHuman ? 'requires_human' : 'completed',
        input.tenantId,
      );
      this.logger.debug(
        `[article-gen] generation_done canvasId=${canvasId} status=${requiresHuman ? 'requires_human' : 'completed'}`,
      );
    } catch (err) {
      await this.canvas.updateStatus(canvasId, 'failed', input.tenantId);
      this.logger.error(
        `[article-gen] generation_failed canvasId=${canvasId}`,
        err,
      );
    }
  }

  /**
   * @description 从文章正文中提取 XHS 风格 #标签，合并到 tags 数组并清除正文中的 tag。
   * @param article - 生文结果对象（title/tags/markdown）。
   * @returns 清洗后的文章对象（tags 已合并，markdown 已去 tag）。
   * @keyword-en post-process article extract remove hashtags from markdown
   */
  private postProcessArticle(article: {
    title: string;
    tags?: string[];
    markdown: string;
    imageQuery?: string;
  }): typeof article {
    // 匹配 #word（中文/字母/数字/_），不带空格，排除 Markdown 标题（# 后有空格）
    const tagRe = /#([\u4e00-\u9fff\w\-]+)/g;
    const extracted: string[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(article.markdown)) !== null) {
      const t = m[1].trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        extracted.push(t);
      }
    }
    // 清除正文中所有 #tag（保留 Markdown 标题 "# " 格式）
    const clean = article.markdown
      .replace(/#[\u4e00-\u9fff\w\-]+/g, '')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
    // 合并 tags（blueprint 已有的 + 正文提取的），去重
    const base = Array.isArray(article.tags) ? article.tags : [];
    const baseSeen = new Set<string>(base);
    const merged = [...base];
    for (const t of extracted) {
      if (!baseSeen.has(t)) {
        baseSeen.add(t);
        merged.push(t);
      }
    }
    return {
      ...article,
      markdown: clean,
      tags: merged.length > 0 ? merged : article.tags,
    };
  }

  /**
   * @description 从最后用户要求中提取显式指定的图库标签，用于选题和配图硬约束。
   * @param {{ topic?: string; userPrompt?: string }} input - 用户话题与原始生成要求。
   * @returns {string[]} 去重后的显式图库标签。
   * @keyword-en extract, explicit-tags, image-group
   */
  private extractExplicitImageTagsFromPrompt(input: {
    topic?: string;
    userPrompt?: string;
  }): string[] {
    const text = [input.userPrompt, input.topic]
      .map((x) => String(x ?? '').trim())
      .filter((x) => x.length > 0)
      .join('\n');
    if (!text) return [];

    const tags: string[] = [];
    const seen = new Set<string>();
    const hashRe = /#([\u4e00-\u9fffA-Za-z0-9_-]{1,40})/g;
    let hashMatch: RegExpExecArray | null;
    while ((hashMatch = hashRe.exec(text)) !== null) {
      const tag = this.normalizeExplicitImageTag(hashMatch[1]);
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }

    const tagSectionRe =
      /(?:tag|tags|标签|话题)\s*(?:带有|包含|包括|含有|为|是|:|：)?\s*([^。；;\n]+)/gi;
    let sectionMatch: RegExpExecArray | null;
    while ((sectionMatch = tagSectionRe.exec(text)) !== null) {
      const segment =
        String(sectionMatch[1] ?? '').split(
          /的图片|图片|给我|用于|用来|生成|拼图|封面|做图|配图/,
        )[0] ?? '';
      for (const raw of segment.split(/[、,，/#\s]+/)) {
        const tag = this.normalizeExplicitImageTag(raw);
        if (tag && !seen.has(tag)) {
          seen.add(tag);
          tags.push(tag);
        }
      }
    }

    return tags.slice(0, 20);
  }

  /**
   * @description 清洗显式图库标签 token，过滤连接词和动作词。
   * @param {unknown} raw - 原始标签 token。
   * @returns {string | null} 可用于图库匹配的标签。
   * @keyword-en normalize, explicit-tags, token
   */
  private normalizeExplicitImageTag(raw: unknown): string | null {
    const tag = String(raw ?? '')
      .trim()
      .replace(/^[：:，,、#\s]+|[：:，,、#\s]+$/g, '');
    if (!tag || tag.length > 40) return null;
    const lower = tag.toLowerCase();
    const blocked = new Set([
      'tag',
      'tags',
      '标签',
      '话题',
      '带有',
      '包含',
      '包括',
      '含有',
      '图片',
      '生成',
      '拼图',
      '封面',
      '配图',
      '给我',
      '用',
      '和',
      '以及',
      '的',
      '用于',
      '用来',
      '做图',
    ]);
    if (blocked.has(tag) || blocked.has(lower)) return null;
    return tag;
  }

  /**
   * @description 将用户显式指定的图库标签合并到每个选题蓝图，防止选题模型遗漏素材匹配条件。
   * @param {ArticleBlueprint[]} blueprints - LLM 规划出的选题蓝图。
   * @param {string[]} explicitTags - 用户显式指定的图库标签。
   * @returns {ArticleBlueprint[]} 已透传显式标签和图片意图的选题蓝图。
   * @keyword-en merge, explicit-tags, blueprint
   */
  private mergeExplicitImageTagsIntoBlueprints(
    blueprints: ArticleBlueprint[],
    explicitTags: string[],
  ): ArticleBlueprint[] {
    const fixedTags = explicitTags
      .map((tag) => this.normalizeExplicitImageTag(tag))
      .filter(
        (tag): tag is string => typeof tag === 'string' && tag.length > 0,
      );
    if (fixedTags.length === 0) return blueprints;

    const explicitText = fixedTags.join('、');
    const safeExplicitText =
      this.sanitizeCopyrightRiskText(explicitText) || '通用主题素材';
    return blueprints.map((bp) => {
      const tags: string[] = [];
      const seen = new Set<string>();
      for (const tag of [...fixedTags, ...(bp.tags ?? [])]) {
        const normalized = this.normalizeExplicitImageTag(tag);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          tags.push(normalized);
        }
      }
      const requirements = [
        `图库匹配标签保留在 tags 字段；对外标题、正文、封面和生图提示词只使用版权安全泛化表达：${safeExplicitText}`,
        ...(bp.requirements ?? []).map((item) =>
          this.sanitizeCopyrightRiskText(item),
        ),
      ].filter((item) => String(item ?? '').trim().length > 0);
      const safeImageIntent = this.sanitizeCopyrightRiskText(bp.imageIntent);
      const imageIntent = safeImageIntent
        ? `${safeImageIntent}；配图语义使用版权安全泛化表达：${safeExplicitText}`
        : `配图语义使用版权安全泛化表达：${safeExplicitText}`;
      return {
        ...bp,
        title: this.sanitizeCopyrightRiskText(bp.title) || bp.title,
        mainIdea: this.sanitizeCopyrightRiskText(bp.mainIdea),
        angle: this.sanitizeCopyrightRiskText(bp.angle),
        tags,
        requirements,
        imageIntent,
        imageQuery: this.sanitizeCopyrightRiskText(bp.imageQuery),
        notes: this.sanitizeCopyrightRiskList(bp.notes),
      };
    });
  }

  /**
   * @description LLM 规划文章蓝图，并继承用户最后要求、写作风格和显式图库标签。
   * @param {object} input - 选题规划参数。
   * @returns {Promise<ArticleBlueprint[]>} 文章蓝图列表。
   * @keyword-en plan, blueprint, explicit-tags
   */
  private async planArticleTasks(input: {
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature: number;
    platform: string;
    topic?: string;
    userPrompt?: string;
    dataSummary?: string;
    writingStyle?: string;
    count: number;
    /** 平台AI补充提示（从租户配置注入） */
    platformAiPrompt?: string;
    /** 当前时间字符串 */
    currentDatetime?: string;
    langchainContext: Record<string, unknown>;
  }): Promise<ArticleBlueprint[]> {
    const isXhs = /小红书|xhs/i.test(input.platform);
    const explicitImageTags = this.extractExplicitImageTagsFromPrompt({
      topic: input.topic,
      userPrompt: input.userPrompt,
    });
    const sys = [
      '你是文章选题规划器。根据平台和话题，规划多篇文章的选题与切入点。',
      '你必须只输出 JSON 对象，不要输出任何多余字符。',
      '严禁输出 markdown、代码块、解释、前后缀文字。',
      '输出必须可被 JSON.parse 直接解析。',
      `输出 schema：{{ "items": [{{ "index": number, "title": string, "tags"?: string[], "mainIdea"?: string, "angle"?: string, "imageIntent"?: string, "requirements"?: string[], "imageQuery"?: string, "notes"?: string[] }}] }}。`,
      `items 数组长度必须等于 ${input.count}，index 从 0 开始连续递增。`,
      '每篇文章必须是独立主题，不允许“第1篇/第2篇/上篇/下篇/续篇/连载”这类连续表达。',
      'title 必须简洁，最多 20 个字，超出则截短，不允许超出。',
      '必须基于最后一条用户生成要求规划选题；若提供 userPrompt，userPrompt 的目标、对象、限制和语气优先级高于泛化平台经验。',
      '选题必须紧贴用户最后要求中的业务主旨、目标人群、痛点和服务卖点；不要只写泛化氛围或玩法体验。',
      '每个 item 必须包含 mainIdea：一句话说明该篇文章主旨；后续正文和封面都将以 title + mainIdea 为唯一锚点，禁止换题。',
      '每个 item 必须包含 imageIntent：一句话说明配图应表达的画面方向，用于统一取图。',
      'requirements 必须列出从用户要求继承到该篇文章的关键约束，尤其是文风、目标人群、禁忌和口径。',
      `本次确认的生文风格：${input.writingStyle ?? '未指定'}`,
      explicitImageTags.length > 0
        ? `用户显式指定的图库标签：${explicitImageTags.join('、')}。所有 item.tags 必须完整包含这些原词，仅用于图库检索；如果其中含知名 IP/商标/角色名，严禁写入 title/mainIdea/imageIntent/imageQuery/requirements/notes，只能用版权安全的泛化表达。`
        : undefined,
      '版权合规硬约束：title/mainIdea/imageIntent/imageQuery/requirements/notes 严禁出现受版权/商标保护的专有名词（知名 IP、动漫/游戏角色名、品牌名、明星姓名等）；也不得规划复刻角色、官方服装、徽章、道具、学院/组织名称、经典造型等场景。',
      '如用户提到知名 IP/角色/品牌，只能保留通用氛围和业务价值，例如“哈利波特”→“魔法学院风”，“马里奥”→“经典像素游戏风”，“迪士尼”→“童话乐园风”。',
      '若 human message context 中包含搜索结果或热点资讯，必须优先基于这些内容规划选题，确保标题与当前热点/趋势匹配。',
      input.currentDatetime ? `当前时间：${input.currentDatetime}` : undefined,
      input.platformAiPrompt
        ? `【平台业务说明 - 必须严格遵守，内容不得超出以下范围】\n${input.platformAiPrompt}`
        : undefined,
      isXhs
        ? '平台是小红书：title 要像真实分享，避免过于论文/教科书；title 必须 ≤20 字（小红书平台硬限制），超长一律改写到 20 字以内，禁止以省略号截断。'
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
          userPrompt: input.userPrompt,
          dataSummary: input.dataSummary,
          writingStyle: input.writingStyle,
          explicitImageTags,
          count: input.count,
        }),
      ),
    ];

    const llm = await this.agent.buildLLM(config);
    const invokeOption = this.buildLangChainInvokeOption(
      input.langchainContext,
    );
    let plan = ZArticleBlueprintPlan.safeParse(undefined);
    try {
      const structured = llm.withStructuredOutput(ZArticleBlueprintPlan);
      const output = await structured.invoke(messages, invokeOption);
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
                userPrompt: input.userPrompt,
                dataSummary: input.dataSummary,
                writingStyle: input.writingStyle,
                explicitImageTags,
                count: input.count,
              }
            : attempt === 1
              ? {
                  task: 'Fix previous output to match schema',
                  previousOutput: lastText,
                  required: {
                    schema:
                      '{ "items": [{"index": number, "title": string, "tags"?: string[], "mainIdea"?: string, "angle"?: string, "imageIntent"?: string, "requirements"?: string[], "imageQuery"?: string, "notes"?: string[]}] }',
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
                          mainIdea: '文章主旨',
                          angle: '切入点',
                          imageIntent: '配图画面方向',
                          requirements: ['用户要求', '文风要求'],
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
                  userPrompt: input.userPrompt,
                  dataSummary: input.dataSummary,
                  writingStyle: input.writingStyle,
                  explicitImageTags,
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
        const ai = await llm.invoke(
          [new SystemMessage(sys), new HumanMessage(JSON.stringify(payload))],
          invokeOption,
        );
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

    // 小红书 title 硬截断到 20 字（按 Unicode code point 计）；其它平台保留原值。
    const enforceXhsTitleLimit = (raw: string): string => {
      const trimmed = String(raw || '').trim();
      if (!isXhs) return trimmed;
      const codepoints = Array.from(trimmed);
      if (codepoints.length <= 20) return trimmed;
      const truncated = codepoints.slice(0, 20).join('');
      this.logger.warn(
        `[plan-article] xhs_title_truncated original_len=${codepoints.length} truncated="${truncated}"`,
      );
      return truncated;
    };

    return items.map((it) => ({
      index: it.index,
      title: enforceXhsTitleLimit(
        this.sanitizeCopyrightRiskText(String(it.title || '')),
      ),
      tags: Array.isArray(it.tags)
        ? it.tags.map((t) => String(t ?? '').trim()).filter(Boolean)
        : undefined,
      mainIdea:
        typeof it.mainIdea === 'string'
          ? this.sanitizeCopyrightRiskText(it.mainIdea)
          : undefined,
      angle: this.sanitizeCopyrightRiskText(it.angle),
      imageIntent:
        typeof it.imageIntent === 'string'
          ? this.sanitizeCopyrightRiskText(it.imageIntent)
          : undefined,
      requirements: Array.isArray(it.requirements)
        ? it.requirements
            .map((r) => this.sanitizeCopyrightRiskText(r))
            .filter(Boolean)
            .slice(0, 12)
        : undefined,
      imageQuery: this.sanitizeCopyrightRiskText(it.imageQuery),
      notes: Array.isArray(it.notes)
        ? it.notes.map((n) => this.sanitizeCopyrightRiskText(n)).filter(Boolean)
        : undefined,
    }));
  }

  /**
   * @description 生成文章正文与配图；image-group 模式先统一分配源图，不足即停止生成正文。
   * @param {object} input - 文章生成、图库和 Canvas 回写参数。
   * @returns {Promise<void>}
   * @keyword-en generate, image-group, pre-allocation
   */
  private async generateArticlesAndImages(input: {
    canvasId: number;
    blueprints: Array<{
      index: number;
      title: string;
      tags?: string[];
      mainIdea?: string;
      angle?: string;
      imageIntent?: string;
      requirements?: string[];
      imageQuery?: string;
      notes?: string[];
    }>;
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature: number;
    platform: string;
    topic?: string;
    userPrompt?: string;
    dataSummary?: string;
    writingStyle?: string;
    imageMode?: 'legacy' | 'image-group';
    tenantId?: string;
    galleryUserId: string;
    galleryGroupId?: number;
    preAssignedImageGroups?: CanvasImageGroup[];
    prePreparedImageGroupSources?: Extract<
      ImageGroupSourcePreparation,
      { ok: true }
    >;
    /** 指定 imageGroupCanvasIds 时开启：禁止自动兜底生成图组 */
    strictImageGroupSource?: boolean;
    /** 平台AI补充提示（从租户配置注入） */
    platformAiPrompt?: string;
    /** 当前时间字符串 */
    currentDatetime?: string;
    minImageScore: number;
    langchainContext: Record<string, unknown>;
  }): Promise<void> {
    const total = input.blueprints.length;
    const startAt = Date.now();
    this.logger.log(
      `[article-gen] parallel_start canvasId=${input.canvasId} total=${total} platform=${input.platform}`,
    );

    const useImageGroupMode = input.imageMode === 'image-group';
    const orderedBlueprintsForImageGroup = useImageGroupMode
      ? [...input.blueprints].sort((a, b) => a.index - b.index)
      : [];
    const articlesForImageGroup = orderedBlueprintsForImageGroup.map((bp) => ({
      title: bp.title,
      tags: Array.isArray(bp.tags)
        ? bp.tags.map((t) => String(t ?? '').trim()).filter((t) => t.length > 0)
        : [],
    }));
    const preAssignedGroups =
      useImageGroupMode && Array.isArray(input.preAssignedImageGroups)
        ? input.preAssignedImageGroups
        : [];
    let imageGroupsForMerge: CanvasImageGroup[] | null = null;
    let imageGroupRenderPromise: Promise<CanvasImageGroup[]> | null = null;
    const imageGroupTagsByBlueprintIndex = new Map<number, string[]>();
    const collectGroupTags = (groups: CanvasImageGroup[]): void => {
      for (let idx = 0; idx < groups.length; idx++) {
        const group = groups[idx];
        const bp = orderedBlueprintsForImageGroup[idx];
        if (!bp || !Array.isArray(group?.images)) continue;
        const tags = [
          ...new Set(
            group.images
              .flatMap((img) => img.tags ?? [])
              .map((tag) => String(tag ?? '').trim())
              .filter(Boolean),
          ),
        ];
        if (tags.length > 0) imageGroupTagsByBlueprintIndex.set(bp.index, tags);
      }
    };

    if (useImageGroupMode) {
      if (preAssignedGroups.length > 0) {
        imageGroupsForMerge = preAssignedGroups;
        collectGroupTags(preAssignedGroups);
        this.logger.log(
          `[article-gen] image_group_preassigned canvasId=${input.canvasId} groups=${preAssignedGroups.length}`,
        );
      } else if (input.strictImageGroupSource) {
        this.logger.warn(
          `[article-gen] image_group_strict_empty canvasId=${input.canvasId}`,
        );
        await this.assignImageGroupsToCanvasArticles({
          canvasId: input.canvasId,
          tenantId: input.tenantId,
          topic: input.topic,
          galleryUserId: input.galleryUserId,
          blueprints: orderedBlueprintsForImageGroup,
          groups: [],
          strictImageGroupSource: true,
        });
        return;
      } else {
        const preparation =
          input.prePreparedImageGroupSources ??
          (await (async () => {
            this.logger.log(
              `[article-gen] image_group_prepare_start canvasId=${input.canvasId} articleCount=${orderedBlueprintsForImageGroup.length}`,
            );
            return await this.canvas.prepareImageGroupsForCanvas({
              canvasId: input.canvasId,
              userId: input.galleryUserId,
              tenantId: input.tenantId,
              topic: input.topic,
              articles: articlesForImageGroup,
            });
          })());
        if (!preparation.ok) {
          await this.canvas.updateImageGroups(
            input.canvasId,
            preparation.imageGroups,
            input.tenantId,
          );
          await this.assignImageGroupsToCanvasArticles({
            canvasId: input.canvasId,
            tenantId: input.tenantId,
            topic: input.topic,
            galleryUserId: input.galleryUserId,
            blueprints: orderedBlueprintsForImageGroup,
            groups: preparation.imageGroups,
          });
          this.logger.warn(
            `[article-gen] image_group_insufficient_stop canvasId=${input.canvasId} ` +
              `portrait=${preparation.stats.availablePortrait}/${preparation.stats.requiredPortrait} ` +
              `landscape=${preparation.stats.availableLandscape}/${preparation.stats.requiredLandscape}`,
          );
          return;
        }
        for (let idx = 0; idx < preparation.imageContexts.length; idx++) {
          const bp = orderedBlueprintsForImageGroup[idx];
          if (!bp) continue;
          const tags = preparation.imageContexts[idx]?.tags ?? [];
          if (tags.length > 0)
            imageGroupTagsByBlueprintIndex.set(bp.index, tags);
        }
        imageGroupRenderPromise =
          this.canvas.renderPreparedImageGroupsForCanvas({
            canvasId: input.canvasId,
            userId: input.galleryUserId,
            tenantId: input.tenantId,
            topic: input.topic,
            articles: articlesForImageGroup,
            preparation,
          });
        this.logger.log(
          `[article-gen] image_group_render_async_start canvasId=${input.canvasId} articleCount=${orderedBlueprintsForImageGroup.length} prechecked=${input.prePreparedImageGroupSources ? 'true' : 'false'}`,
        );
      }
    }
    const excludedGeneratedGroupIds = !useImageGroupMode
      ? await this.getGeneratedAssetDefaultGroupIds(
          input.galleryUserId,
          input.tenantId,
        )
      : [];

    let imagePool: GalleryImageEntity[] = [];
    let imageSlices: GalleryImageEntity[][] = [];
    if (!useImageGroupMode) {
      // 1. 收集所有蓝图 tag，一次性拉取图片池（与文章生成并行）
      const allTags: string[] = [];
      const tagSeen = new Set<string>();
      for (const bp of input.blueprints) {
        for (const t of bp.tags ?? []) {
          const s = t.trim();
          if (s && !tagSeen.has(s)) {
            tagSeen.add(s);
            allTags.push(s);
          }
        }
      }
      // 先 await 图片池（DB 查询，通常 < 200ms），再批次预分配，避免并行时各自重复选图
      imagePool = await this.fetchArticleImagePool({
        userId: input.galleryUserId,
        tenantId: input.tenantId,
        tags: allTags,
        excludedGroupIds: excludedGeneratedGroupIds,
      });
      // 批次级别贪心预分配图片 slice，全局 usedIds 去重，各篇文章用独立来源
      imageSlices = this.preAssignImageSlices(
        imagePool,
        input.blueprints.length,
      );
    }

    // 2. 每篇文章正文并发生成；legacy 模式下继续并发配图
    await Promise.all(
      input.blueprints.map(async (bp, bpIdx) => {
        const articleId = bp.index + 1;
        const t0 = Date.now();
        this.logger.log(
          `[article-gen] article_start canvasId=${input.canvasId} articleId=${articleId}/${total} title="${bp.title.slice(0, 30)}"`,
        );
        try {
          const _matchedGroup =
            useImageGroupMode && Array.isArray(imageGroupsForMerge)
              ? (imageGroupsForMerge.find(
                  (g) => g.articleId === bp.index + 1,
                ) ?? imageGroupsForMerge[bpIdx])
              : undefined;
          const _imageGroupTags =
            _matchedGroup && _matchedGroup.images.length > 0
              ? [
                  ...new Set(
                    _matchedGroup.images
                      .flatMap((img) => img.tags ?? [])
                      .filter(Boolean),
                  ),
                ]
              : imageGroupTagsByBlueprintIndex.get(bp.index);
          const articlePromise = this.generateOneArticle({
            provider: input.provider,
            model: input.model,
            temperature: input.temperature,
            platform: input.platform,
            topic: input.topic,
            userPrompt: input.userPrompt,
            dataSummary: input.dataSummary,
            writingStyle: input.writingStyle,
            blueprint: bp,
            langchainContext: input.langchainContext,
            platformAiPrompt: input.platformAiPrompt,
            currentDatetime: input.currentDatetime,
            imageGroupTags: _imageGroupTags,
          });
          const imagePromise = useImageGroupMode
            ? Promise.resolve(undefined)
            : this.resolveArticleImages({
                articleTitle: bp.title,
                articleTags: bp.tags,
                imageQuery: bp.imageQuery,
                tenantId: input.tenantId,
                galleryUserId: input.galleryUserId,
                galleryGroupId: input.galleryGroupId,
                imagePool,
                excludedGroupIds: excludedGeneratedGroupIds,
                preAssignedSources: imageSlices[bpIdx],
                platformAiPrompt: input.platformAiPrompt,
                currentDatetime: input.currentDatetime,
              });
          const [article, imageData] = await Promise.all([
            articlePromise,
            imagePromise,
          ]);

          this.logger.log(
            `[article-gen] article_written canvasId=${input.canvasId} articleId=${articleId}/${total} elapsed=${Date.now() - t0}ms`,
          );

          // 提取正文中的 #标签 并清除，合并到 tags
          const processed = this.postProcessArticle(article);
          const canonicalTitle =
            String(bp.title ?? '').trim() || processed.title;
          const mergedArticleTags = [
            ...new Set(
              [...(bp.tags ?? []), ...(processed.tags ?? [])]
                .map((tag) => String(tag ?? '').trim())
                .filter((tag) => tag.length > 0),
            ),
          ];

          // 先回写正文，配图根据模式分别处理
          await this.canvas.updateArticle(
            input.canvasId,
            articleId,
            {
              title: canonicalTitle,
              tags:
                mergedArticleTags.length > 0
                  ? mergedArticleTags
                  : processed.tags,
              contentJson: {
                platform: input.platform,
                topic: input.topic,
                userPrompt: input.userPrompt,
                dataSummary: input.dataSummary,
                writingStyle: input.writingStyle,
                blueprint: bp,
                markdown: processed.markdown,
                imageQuery: processed.imageQuery,
              },
            },
            input.tenantId,
          );
          if (!useImageGroupMode && imageData) {
            await this.canvas.updateArticleImages(
              input.canvasId,
              articleId,
              {
                imageIds:
                  imageData.imageIds.length > 0
                    ? imageData.imageIds
                    : undefined,
                imageUrls:
                  imageData.imageUrls.length > 0
                    ? imageData.imageUrls
                    : undefined,
                status: imageData.status,
                doneNote: imageData.doneNote,
              },
              input.tenantId,
            );
          }

          this.logger.log(
            `[article-gen] article_done canvasId=${input.canvasId} articleId=${articleId}/${total} elapsed=${Date.now() - t0}ms`,
          );
        } catch (err) {
          this.logger.error(
            `[article-gen] article_failed canvasId=${input.canvasId} articleId=${articleId}/${total} elapsed=${Date.now() - t0}ms`,
            err,
          );
          await this.canvas
            .updateArticle(
              input.canvasId,
              articleId,
              { status: 'failed' },
              input.tenantId,
            )
            .catch(() => void 0);
        }
      }),
    );

    if (useImageGroupMode) {
      if (!Array.isArray(imageGroupsForMerge) && !imageGroupRenderPromise) {
        throw new Error('IMAGE_GROUP_RENDER_MISSING');
      }
      const groups = imageGroupsForMerge ?? (await imageGroupRenderPromise!);
      this.logger.log(
        `[article-gen] image_group_async_done canvasId=${input.canvasId} groups=${groups.length}`,
      );
      await this.assignImageGroupsToCanvasArticles({
        canvasId: input.canvasId,
        tenantId: input.tenantId,
        topic: input.topic,
        galleryUserId: input.galleryUserId,
        blueprints: orderedBlueprintsForImageGroup,
        groups,
        strictImageGroupSource: input.strictImageGroupSource,
      });
    }

    this.logger.log(
      `[article-gen] parallel_done canvasId=${input.canvasId} total=${total} elapsed=${Date.now() - startAt}ms`,
    );
  }

  /**
   * @description 从指定 image-group Canvas 列表提取图片组，按输入顺序合并返回。
   * @param {{ canvasIds: number[]; tenantId?: string }} input - 指定 Canvas ID 集合。
   * @returns {Promise<CanvasImageGroup[]>} 合并后的图片组列表。
   * @keyword-en collect image groups from specific canvases
   */
  private async collectImageGroupsFromCanvases(input: {
    canvasIds: number[];
    tenantId?: string;
  }): Promise<CanvasImageGroup[]> {
    const groups: CanvasImageGroup[] = [];
    for (const canvasId of input.canvasIds) {
      const canvas = await this.canvas.get(canvasId, input.tenantId);
      if (!canvas) {
        this.logger.warn(
          `[article-gen] preassigned_source_missing canvasId=${canvasId}`,
        );
        continue;
      }
      const sourceGroups = Array.isArray(canvas.imageGroups)
        ? canvas.imageGroups
        : [];
      if (sourceGroups.length === 0) {
        this.logger.warn(
          `[article-gen] preassigned_source_no_groups canvasId=${canvasId}`,
        );
        continue;
      }
      groups.push(...sourceGroups);
    }
    return groups;
  }

  /**
   * @description 使用图组生成同源逻辑为同一 Canvas 的文章批量回写配图信息。
   * @param {object} input - 配图回写参数。
   * @returns {Promise<void>}
   * @keyword-en assign article images via image-group pipeline
   */
  private async assignImageGroupsToCanvasArticles(input: {
    canvasId: number;
    tenantId?: string;
    topic?: string;
    galleryUserId: string;
    blueprints: Array<{
      index: number;
      title: string;
      tags?: string[];
    }>;
    groups?: CanvasImageGroup[];
    strictImageGroupSource?: boolean;
  }): Promise<void> {
    const ordered = [...input.blueprints].sort((a, b) => a.index - b.index);
    this.logger.log(
      `[image-group-merge] start canvasId=${input.canvasId} articleCount=${ordered.length} perArticleTarget=${this.IMAGE_GROUP_MIN_IMAGES_PER_ARTICLE}-${this.IMAGE_GROUP_MAX_IMAGES_PER_ARTICLE}`,
    );
    const groups =
      Array.isArray(input.groups) && input.groups.length > 0
        ? input.groups
        : input.strictImageGroupSource
          ? []
          : await this.canvas.generateImageGroupsForCanvas({
              canvasId: input.canvasId,
              userId: input.galleryUserId,
              tenantId: input.tenantId,
              topic: input.topic,
              articles: ordered.map((bp) => ({
                title: bp.title,
                tags: Array.isArray(bp.tags)
                  ? bp.tags
                      .map((t) => String(t ?? '').trim())
                      .filter((t) => t.length > 0)
                  : [],
              })),
            });

    if (input.strictImageGroupSource && groups.length === 0) {
      this.logger.warn(
        `[image-group-merge] strict_preassigned_empty canvasId=${input.canvasId}`,
      );
    }

    let doneCount = 0;
    let missingCount = 0;
    let mismatchCount = 0;

    await Promise.all(
      ordered.map(async (bp, idx) => {
        const group = groups[idx];
        const articleId = bp.index + 1;
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
        if (!isImageCountValid) mismatchCount++;
        this.logger.log(
          `[image-group-merge] article canvasId=${input.canvasId} articleId=${articleId} title="${bp.title.slice(0, 24)}" groupStatus=${String(group?.status ?? 'missing')} imageCount=${imageUrls.length} status=${status}`,
        );
        await this.canvas.updateArticleImages(
          input.canvasId,
          articleId,
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
      `[image-group-merge] done canvasId=${input.canvasId} done=${doneCount} requires_human=${missingCount} count_mismatch=${mismatchCount}`,
    );
  }

  /**
   * @description 根据单篇蓝图生成正文，并透传平台文风、主旨和配图意图。
   * @param {object} input - 单篇文章生成参数。
   * @returns {Promise<{ title: string; tags: string[]; markdown: string; imageQuery?: string }>}
   * @keyword-en generate, article, writing-style
   */
  private async generateOneArticle(input: {
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature: number;
    platform: string;
    topic?: string;
    userPrompt?: string;
    dataSummary?: string;
    writingStyle?: string;
    langchainContext: Record<string, unknown>;
    /** 平台AI补充提示（从租户配置注入） */
    platformAiPrompt?: string;
    /** 当前时间字符串 */
    currentDatetime?: string;
    blueprint: {
      index: number;
      title: string;
      tags?: string[];
      mainIdea?: string;
      angle?: string;
      imageIntent?: string;
      requirements?: string[];
      imageQuery?: string;
      notes?: string[];
    };
    /** image-group 模式下当前文章对应图组中所有图片的 tags 聚合（用于关联配图内容） */
    imageGroupTags?: string[];
  }): Promise<{
    title: string;
    tags: string[];
    markdown: string;
    imageQuery: string;
  }> {
    const isXhs = /小红书|xhs/i.test(input.platform);
    const safeBlueprint = this.sanitizeBlueprintForCreativePrompt(
      input.blueprint as ArticleBlueprint,
    );
    const safeTopic = this.sanitizeCopyrightRiskText(input.topic);
    const safeUserPrompt = this.sanitizeCopyrightRiskText(input.userPrompt);
    const safeDataSummary = this.sanitizeCopyrightRiskText(input.dataSummary);
    const safeImageGroupTags = this.sanitizeCopyrightRiskList(
      input.imageGroupTags,
    );
    const sys = [
      '你是文章生成器。只负责生成可直接发布的文章正文，不要输出任何策划/方案/解释。',
      '你必须只输出 JSON 对象，不要输出任何多余字符。',
      '输出 schema：{ "title": string, "tags"?: string[], "markdown": string, "imageQuery"?: string }。',
      'markdown 必须输出完整正文，不能是提纲/大纲/目录/框架。',
      '正文至少包含 2 段连续叙事段落，每段不少于 50 字。',
      '每篇文章必须独立成篇，不允许“第X篇/上篇/下篇/续篇”等连续叙事词。',
      '正文至少 120 字。',
      `本篇必须采用的生文风格：${input.writingStyle ?? '通用专业图文文风'}`,
      'blueprint.title 是唯一主标题锚点；正文语义、封面文案和配图都围绕它展开，禁止改写成另一个选题。',
      '必须围绕 blueprint.mainIdea 展开正文；若 mainIdea 存在，不得只套用泛化模板。',
      '必须继承 blueprint.requirements 中的全部关键约束。',
      '若提供 blueprint.imageIntent 或 imageGroupTags，正文场景描写必须与图片意图/图片标签自然对应，避免图文不匹配。',
      '若提供了 userPrompt，必须结合其目标、语气、对象与限制生成正文，不得忽略。',
      '若提供了 dataSummary，必须将其中的数据事实、趋势结论与关键信息融合进正文；禁止杜撰与摘要冲突的数据。',
      'imageQuery 必须返回用于配图检索。',
      '若文章适合做“前后对比/双场景展示”，在 imageQuery 中明确两类元素，便于生成阶段即时完成拼图与封面处理。',
      '文章中不需要出现任何标签,但必须在 tags 字段返回与文章内容高度相关的标签列表，供平台发布时使用。',
      '版权安全硬约束：title、markdown、imageQuery、tags 严禁出现知名 IP/商标/动漫/游戏/影视角色/明星名，也不得描述复刻角色服装、徽章、官方道具、学院/组织名称；相关输入必须泛化成风格氛围。',
      '若 human message context 中包含搜索摘要或参考资料，务必将其融入文章正文，增强内容的时效性与真实感；禁止直接抄录原文，需改写融合。',
      ...[
        input.currentDatetime ? `当前时间：${input.currentDatetime}` : '',
        input.platformAiPrompt
          ? `【平台业务说明 - 必须严格遵守，内容不得超出以下范围】\n${input.platformAiPrompt}`
          : '',
        safeImageGroupTags.length > 0
          ? `【配图关键词 - 必须融合到正文】\n本篇文章已关联以下版权安全图片语义：${safeImageGroupTags.join('、')}\n请将这些关键词自然融入正文内容与场景描述中，使文字与配图形成强关联，不要生硬堆砌。`
          : '',
      ].filter((x) => x.length > 0),
      isXhs
        ? [
            '平台是小红书：markdown 必须是“小红书可发”的正文风格。',
            '',
            '【排版规范 - 严格执行】',
            '1. 开头 1-2 句强钩子，用情绪词或疑问句吸引点击，单独成行。',
            '2. 全篇段落长度：每段 2-4 句，句间用换行隔开，禁止出现超过 4 句的大段文字。',
            '3. 每隔 1-2 段插入一个亮点要点列表（3-5 条），格式：✅ / ✨ / 📌 符号 + 短句（15 字以内）。',
            '4. 关键词/重要数字/品牌词用「」括起来突出显示。',
            '5. 段落之间必须有空行分隔，禁止段落连片堆叠。',
            '6. 末尾收尾 1-2 句引导互动（如：你有没有试过？评论告诉我👇）。',
            '7. 末尾必须给 3-6 个话题标签（#标签），每个标签单独一行。',
            '8. 严禁出现痛点/误区、方法论、步骤清单、案例/示例、总结复盘等标题栏目词。',
            '9. 语气：真实口语化分享，第一人称叙述，避免广告感。',
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
          topic: safeTopic,
          userPrompt: safeUserPrompt,
          dataSummary: safeDataSummary,
          writingStyle: input.writingStyle,
          index: safeBlueprint.index,
          blueprint: safeBlueprint,
        }),
      ),
    ];

    const llm = await this.agent.buildLLM(config);
    const invokeOption = this.buildLangChainInvokeOption(
      input.langchainContext,
    );
    let article = ZSingleArticle.safeParse(undefined);
    try {
      const structured = llm.withStructuredOutput(ZSingleArticle);
      const output = await structured.invoke(messages, invokeOption);
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
                topic: safeTopic,
                userPrompt: safeUserPrompt,
                dataSummary: safeDataSummary,
                writingStyle: input.writingStyle,
                index: safeBlueprint.index,
                blueprint: safeBlueprint,
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
        const ai = await llm.invoke(
          [new SystemMessage(sys), new HumanMessage(JSON.stringify(payload))],
          invokeOption,
        );
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
      title: this.sanitizeCopyrightRiskText(article.data.title),
      tags: this.sanitizeCopyrightRiskList(tags),
      markdown: this.sanitizeCopyrightRiskText(article.data.markdown),
      imageQuery:
        this.sanitizeCopyrightRiskText(article.data.imageQuery) ||
        safeBlueprint.imageQuery ||
        `${safeTopic || ''} ${safeBlueprint.angle || ''} 场景`,
    };
  }

  /**
   * @description 按所有蓝图 tag 一次性拉取图片池（regular 类型），供文章配图并发复用。
   * 优先 tag 匹配，不足则补全量 accessible 图片。
   * @keyword-en fetch article image pool by blueprint tags once for all articles
   */
  private async fetchArticleImagePool(input: {
    userId: string;
    tenantId?: string;
    tags: string[];
    excludedGroupIds?: number[];
  }): Promise<GalleryImageEntity[]> {
    const wantCount = 60;
    const seen = new Set<string | number>();
    const pool: GalleryImageEntity[] = [];
    const excludedGroupIdSet = new Set(
      (input.excludedGroupIds ?? []).filter(
        (id): id is number => typeof id === 'number' && Number.isFinite(id),
      ),
    );
    const dedup = (imgs: GalleryImageEntity[]) => {
      for (const img of imgs) {
        const gid = Number((img as { groupId?: unknown })?.groupId ?? NaN);
        if (Number.isFinite(gid) && excludedGroupIdSet.has(gid)) continue;
        const key = img.id ?? img.url;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        pool.push(img);
      }
    };
    if (input.tags.length > 0) {
      const byTags = await this.gallery.searchByTags({
        userId: input.userId,
        tenantId: input.tenantId,
        tags: input.tags,
        limit: wantCount,
        imageType: 'regular',
      });
      dedup(byTags);
    }
    if (pool.length < wantCount) {
      const more = await this.gallery.findAccessibleImages(
        input.userId,
        input.tenantId,
        {
          imageType: 'regular',
          limit: wantCount,
        },
      );
      dedup(more);
    }
    this.logger.debug(
      `[article-gen] image_pool_ready tags=${input.tags.length} pool=${pool.length}`,
    );
    return pool;
  }

  /**
   * @description 批次级别为每篇文章贪心预分配图片 slice。
   * 维护全局 usedIds，保证跨文章不重复使用同一张图；每个 slice 前两张是多样性最高的 pair，
   * 后续补足到 sliceSize，与图组生成（batch-task-graph）的 usedSet 逻辑一致。
   * @param {GalleryImageEntity[]} pool - 全量图片池。
   * @param {number} count - 文章数量。
   * @returns {GalleryImageEntity[][]} 每篇文章的预分配图片列表。
   * @keyword-en pre-assign diverse image slices per article global dedup usedIds
   */
  private preAssignImageSlices(
    pool: GalleryImageEntity[],
    count: number,
  ): Array<GalleryImageEntity[]> {
    const sliceSize = 6;
    const usedIds = new Set<number>();
    const result: Array<GalleryImageEntity[]> = [];
    const candidates = pool.filter(
      (x) => x?.isCollage !== true && !this.isGeneratedCoverImage(x),
    );

    for (let i = 0; i < count; i++) {
      const remaining = candidates.filter((img) => {
        const id = Number(img.id ?? 0);
        return !(Number.isFinite(id) && id > 0 && usedIds.has(id));
      });

      if (remaining.length === 0) {
        result.push([]);
        continue;
      }

      // 贪心：在前 cap 张中找多样性最高的 pair 作为前两张
      const cap = Math.min(remaining.length, Math.max(sliceSize * 2, 12));
      let bestA: GalleryImageEntity | null = null;
      let bestB: GalleryImageEntity | null = null;
      let bestScore = -Infinity;
      for (let a = 0; a < cap; a++) {
        for (let b = a + 1; b < cap; b++) {
          const score = this.scoreImagePairDiversity(
            remaining[a],
            remaining[b],
          );
          if (score > bestScore) {
            bestScore = score;
            bestA = remaining[a];
            bestB = remaining[b];
          }
        }
      }

      const slice: GalleryImageEntity[] = [];
      const pairSet = new Set<GalleryImageEntity>();
      if (bestA) {
        slice.push(bestA);
        pairSet.add(bestA);
      }
      if (bestB) {
        slice.push(bestB);
        pairSet.add(bestB);
      }
      // 补足到 sliceSize（用于正文拼图候选）
      for (const img of remaining) {
        if (slice.length >= sliceSize) break;
        if (!pairSet.has(img)) slice.push(img);
      }

      for (const img of slice) {
        const id = Number(img.id ?? 0);
        if (Number.isFinite(id) && id > 0) usedIds.add(id);
      }
      result.push(slice);
    }

    this.logger.debug(
      `[article-gen] pre_assign_slices count=${count} poolSize=${candidates.length} assigned=${result.filter((s) => s.length > 0).length}`,
    );
    return result;
  }

  /**
   * @description 从预拉取图片池中为单篇文章选图、生成拼图/封面，返回配图数据（不写库）。
   * 先按文章 tag 在池中优先筛选，不足则降级到全池；后续拼图/封面生成与 image-group 逻辑一致。
   * @keyword-en resolve article images from shared pool tag-priority collage cover
   */
  private async resolveArticleImages(input: {
    articleTitle: string;
    articleTags?: string[];
    imageQuery?: string;
    tenantId?: string;
    galleryUserId: string;
    galleryGroupId?: number;
    imagePool: GalleryImageEntity[];
    excludedGroupIds?: number[];
    /** 批次预分配的图片来源，若提供则直接使用，跳过池内随机选取 */
    preAssignedSources?: GalleryImageEntity[];
    /** 平台AI补充提示（从租户配置注入） */
    platformAiPrompt?: string;
    /** 当前时间字符串 */
    currentDatetime?: string;
  }): Promise<{
    imageIds: number[];
    imageUrls: string[];
    doneNote: string;
    status: 'done' | 'requires_human';
  }> {
    const queryText = input.imageQuery?.trim() || input.articleTitle;
    const targetImageCount = this.ARTICLE_TARGET_IMAGE_COUNT;
    const needRawSourceCount = 2;
    const maxPickedImages = Math.max(6, targetImageCount * 4);
    const aiCoverEnabled = await this.isAiCoverEnabled(input.tenantId);

    // 从共享池选图：优先匹配文章 tag，再降级全池
    const excludedGroupIdSet = new Set(
      (input.excludedGroupIds ?? []).filter(
        (id): id is number => typeof id === 'number' && Number.isFinite(id),
      ),
    );
    const allImageKeys = new Set<string>();
    const pickedImages: GalleryImageEntity[] = [];
    const tryAdd = (img: GalleryImageEntity) => {
      if (!img || typeof img !== 'object') return;
      const gid = Number((img as { groupId?: unknown })?.groupId ?? NaN);
      if (Number.isFinite(gid) && excludedGroupIdSet.has(gid)) return;
      if (img.isCollage === true) return;
      if (this.isGeneratedCoverImage(img)) return;
      const keyId = img.id ? `id:${img.id}` : undefined;
      const keyUrl = img.url ? `url:${img.url}` : undefined;
      if (keyId && allImageKeys.has(keyId)) return;
      if (keyUrl && allImageKeys.has(keyUrl)) return;
      if (keyId) allImageKeys.add(keyId);
      if (keyUrl) allImageKeys.add(keyUrl);
      pickedImages.push(img);
    };
    if (input.articleTags && input.articleTags.length > 0) {
      const tagSet = new Set(input.articleTags.map((t) => t.toLowerCase()));
      for (const img of input.imagePool) {
        if (pickedImages.length >= maxPickedImages) break;
        if ((img.tags ?? []).some((t) => tagSet.has(t.toLowerCase())))
          tryAdd(img);
      }
    }
    for (const img of input.imagePool) {
      if (pickedImages.length >= maxPickedImages) break;
      tryAdd(img);
    }

    this.logger.debug(
      `[assign-image] start title="${input.articleTitle.slice(0, 30)}" picked=${pickedImages.length} targetImageCount=${targetImageCount}`,
    );

    // 优先使用批次预分配来源（已全局去重），否则从 pool 独立随机选取
    // 拼图必须使用横图（isPortrait !== true），不允许竖图参与拼图
    const rawSources =
      input.preAssignedSources && input.preAssignedSources.length > 0
        ? input.preAssignedSources.filter(
            (x) =>
              x?.isCollage !== true &&
              !this.isGeneratedCoverImage(x) &&
              x?.isPortrait !== true,
          )
        : this.shuffleArray(
            pickedImages.filter(
              (x) =>
                x?.isCollage !== true &&
                !this.isGeneratedCoverImage(x) &&
                x?.isPortrait !== true,
            ),
          ).slice(0, Math.max(6, targetImageCount * 3));
    this.logger.debug(
      `[assign-image] source_pool picked=${pickedImages.length} rawSources=${rawSources.length} preAssigned=${input.preAssignedSources ? 'yes' : 'no'}`,
    );
    let collageImage: GalleryImageEntity | null = null;
    let coverImage: GalleryImageEntity | null = null;
    const contentCollageImages: GalleryImageEntity[] = [];
    let coverTitleMissing = false;
    let coverPairKey: string | null = null;

    const coverPair = this.pickMostDiversePair(
      rawSources.slice(0, Math.min(rawSources.length, 8)),
    );
    const coverSources = coverPair
      ? [coverPair[0], coverPair[1]]
      : rawSources.slice(0, 2);
    const coverSourceIds = new Set(
      coverSources
        .map((x) => Number(x?.id ?? 0))
        .filter((x) => Number.isFinite(x) && x > 0),
    );
    const contentSourcePool = rawSources.filter((x) => {
      const id = Number(x?.id ?? 0);
      if (!Number.isFinite(id) || id <= 0) return true;
      return !coverSourceIds.has(id);
    });

    if (coverSources.length >= needRawSourceCount) {
      const p0 =
        coverSources[0]?.absPath ||
        this.resolveLocalPathFromGalleryUrl(coverSources[0]?.url);
      const p1 =
        coverSources[1]?.absPath ||
        this.resolveLocalPathFromGalleryUrl(coverSources[1]?.url);
      if (p0 && p1) {
        try {
          const collageFile = await this.createDynamicCollageFile(p0, p1);
          collageImage = await this.saveGeneratedImageToGallery({
            userId: input.galleryUserId,
            tenantId: input.tenantId,
            groupId: input.galleryGroupId,
            absPath: collageFile.absPath,
            fileName: collageFile.fileName,
            url: collageFile.url,
            description: `Canvas动态拼图：#${coverSources[0]?.id ?? '-'} + #${coverSources[1]?.id ?? '-'}`,
            isCollage: true,
            collageSourceImageIds: [
              coverSources[0]?.id,
              coverSources[1]?.id,
            ].filter(
              (x): x is number => typeof x === 'number' && Number.isFinite(x),
            ),
            generatedKind: 'collage',
          });
          const aId = Number(coverSources[0]?.id ?? 0);
          const bId = Number(coverSources[1]?.id ?? 0);
          coverPairKey = `${Math.min(aId, bId)}-${Math.max(aId, bId)}`;
          const diversity = this.scoreImagePairDiversity(
            coverSources[0],
            coverSources[1],
          );
          this.logger.debug(
            `[assign-image] collage_generated collageId=${String(collageImage?.id ?? '')} sourceA=${String(coverSources[0]?.id ?? '')} sourceB=${String(coverSources[1]?.id ?? '')} diversity=${diversity.toFixed(2)}`,
          );
        } catch {
          this.logger.warn('[assign-image] collage_generate_failed');
          collageImage = null;
        }
      }
    }

    const needContentCollageCount = Math.max(0, targetImageCount - 1);
    if (contentSourcePool.length >= 2 && needContentCollageCount > 0) {
      const pairs: Array<{
        a: GalleryImageEntity;
        b: GalleryImageEntity;
        key: string;
        diversity: number;
      }> = [];
      for (let i = 0; i < contentSourcePool.length; i++) {
        for (let j = i + 1; j < contentSourcePool.length; j++) {
          const a = contentSourcePool[i];
          const b = contentSourcePool[j];
          const aId = Number(a?.id ?? 0);
          const bId = Number(b?.id ?? 0);
          const key = `${Math.min(aId, bId)}-${Math.max(aId, bId)}`;
          if (coverPairKey && key === coverPairKey) continue;
          pairs.push({
            a,
            b,
            key,
            diversity: this.scoreImagePairDiversity(a, b),
          });
        }
      }

      const orderedPairs = pairs
        .sort((x, y) => y.diversity - x.diversity)
        .slice(
          0,
          Math.max(needContentCollageCount * 4, needContentCollageCount),
        );
      const usedContentSourceIds = new Set<number>();
      for (const pair of this.shuffleArray(orderedPairs)) {
        if (contentCollageImages.length >= needContentCollageCount) break;
        const aId = Number(pair.a?.id ?? 0);
        const bId = Number(pair.b?.id ?? 0);
        // 跳过：任一源图已在本轮内容拼图中使用（跨拼图去重）
        if (Number.isFinite(aId) && aId > 0 && usedContentSourceIds.has(aId))
          continue;
        if (Number.isFinite(bId) && bId > 0 && usedContentSourceIds.has(bId))
          continue;
        const pa =
          pair.a.absPath || this.resolveLocalPathFromGalleryUrl(pair.a.url);
        const pb =
          pair.b.absPath || this.resolveLocalPathFromGalleryUrl(pair.b.url);
        if (!pa || !pb) continue;
        try {
          const file = await this.createDynamicCollageFile(pa, pb);
          const img = await this.saveGeneratedImageToGallery({
            userId: input.galleryUserId,
            tenantId: input.tenantId,
            groupId: input.galleryGroupId,
            absPath: file.absPath,
            fileName: file.fileName,
            url: file.url,
            description: `Canvas正文拼图：#${pair.a?.id ?? '-'} + #${pair.b?.id ?? '-'}`,
            isCollage: true,
            collageSourceImageIds: [pair.a?.id, pair.b?.id].filter(
              (x): x is number => typeof x === 'number' && Number.isFinite(x),
            ),
            generatedKind: 'collage',
          });
          if (img) {
            contentCollageImages.push(img);
            if (Number.isFinite(aId) && aId > 0) usedContentSourceIds.add(aId);
            if (Number.isFinite(bId) && bId > 0) usedContentSourceIds.add(bId);
            this.logger.debug(
              `[assign-image] content_collage_generated collageId=${String(img?.id ?? '')} sourceA=${String(pair.a?.id ?? '')} sourceB=${String(pair.b?.id ?? '')} diversity=${pair.diversity.toFixed(2)}`,
            );
          }
        } catch {
          this.logger.warn('[assign-image] content_collage_generate_failed');
        }
      }
    }

    if (collageImage) {
      const collagePath =
        collageImage.absPath ||
        this.resolveLocalPathFromGalleryUrl(collageImage.url);
      if (collagePath) {
        try {
          const coverCopy = await this.generateCoverCopyByLlm({
            articleTitle: input.articleTitle,
            articleTags: input.articleTags,
            imageQuery: queryText,
            platformAiPrompt: input.platformAiPrompt,
            currentDatetime: input.currentDatetime,
          });
          coverTitleMissing = !coverCopy.titleFromLlm;
          this.logger.debug(
            `[assign-image] cover_copy titleFromLlm=${coverCopy.titleFromLlm ? 'yes' : 'no'} titleLen=${String(coverCopy.title ?? '').trim().length}`,
          );
          const finalCoverTitle =
            String(coverCopy.title || '').trim() ||
            this.normalizeCoverText(
              this.deriveCoverText(input.articleTitle, input.articleTags),
              '沉浸式体验',
              10,
            );
          if (!finalCoverTitle) {
            this.logger.warn('[assign-image] cover_title_missing');
            throw new Error('COVER_TITLE_MISSING');
          }
          coverImage = aiCoverEnabled
            ? await this.tryGenerateAiCoverImage({
                tenantId: input.tenantId,
                galleryUserId: input.galleryUserId,
                galleryGroupId: input.galleryGroupId,
                topic: input.imageQuery,
                articleTitle: input.articleTitle,
                articleTags: input.articleTags,
                imageQuery: queryText,
                coverTitle: finalCoverTitle,
                coverSubtitle: coverCopy.subtitle,
                sourceImageIds: [
                  coverSources[0]?.id,
                  coverSources[1]?.id,
                ].filter(
                  (x): x is number =>
                    typeof x === 'number' && Number.isFinite(x),
                ),
                baseImageCandidates: [
                  collagePath,
                  coverSources[0]?.absPath,
                  this.resolveLocalPathFromGalleryUrl(coverSources[0]?.url),
                  coverSources[1]?.absPath,
                  this.resolveLocalPathFromGalleryUrl(coverSources[1]?.url),
                ]
                  .map((x) => String(x ?? '').trim())
                  .filter((x) => x.length > 0),
                platformAiPrompt: input.platformAiPrompt,
                currentDatetime: input.currentDatetime,
              })
            : null;

          if (!coverImage) {
            const coverFile = await this.createCoverFromCollageFile(
              collagePath,
              finalCoverTitle,
              coverCopy.subtitle,
            );
            coverImage = await this.saveGeneratedImageToGallery({
              userId: input.galleryUserId,
              tenantId: input.tenantId,
              groupId: input.galleryGroupId,
              absPath: coverFile.absPath,
              fileName: coverFile.fileName,
              url: coverFile.url,
              description: `Canvas封面：${finalCoverTitle}${
                coverCopy.subtitle ? `｜${coverCopy.subtitle}` : ''
              }（titleFromLlm=${coverCopy.titleFromLlm ? 'yes' : 'no'}）`,
              generatedKind: 'cover',
            });
          }
          this.logger.debug(
            `[assign-image] cover_generated coverId=${String(coverImage?.id ?? '')}`,
          );
        } catch {
          this.logger.warn('[assign-image] cover_generate_failed');
          coverImage = null;
        }
      }
    }

    const finalImages: Array<GalleryImageEntity> = [];
    const finalImageKeys = new Set<string>();
    const pushFinalImage = (
      img: GalleryImageEntity | null | undefined,
    ): void => {
      if (!img || typeof img !== 'object') return;
      const key =
        typeof img.id === 'number' && Number.isFinite(img.id)
          ? `id:${img.id}`
          : typeof img.url === 'string' && img.url.length > 0
            ? `url:${img.url}`
            : '';
      if (!key || finalImageKeys.has(key)) return;
      finalImageKeys.add(key);
      finalImages.push(img);
    };

    pushFinalImage(coverImage);
    for (const img of contentCollageImages) {
      if (finalImages.length >= targetImageCount) break;
      pushFinalImage(img);
    }

    if (finalImages.length === 0 && collageImage) {
      pushFinalImage(collageImage);
    }

    // 拼图不足时回填普通图，避免单篇经常降到 1-2 张
    if (finalImages.length < targetImageCount) {
      const fallbackRegular = this.shuffleArray(
        pickedImages.filter(
          (x) => x?.isCollage !== true && !this.isGeneratedCoverImage(x),
        ),
      );
      for (const img of fallbackRegular) {
        if (finalImages.length >= targetImageCount) break;
        pushFinalImage(img);
      }
    }

    const imageIds = finalImages
      .map((p) => p.id)
      .filter((id): id is number => typeof id === 'number');
    const imageUrls = finalImages
      .map((p) => p.url)
      .filter(
        (url): url is string => typeof url === 'string' && url.length > 0,
      );

    if (imageIds.length > 0 || imageUrls.length > 0) {
      let doneNote = 'AUTO_QUERY_MATCH';
      if (finalImages.length === 0) {
        doneNote = 'NO_GALLERY_IMAGE';
      } else if (coverImage && contentCollageImages.length > 0) {
        doneNote = 'AUTO_CANVAS_COVER_AND_COLLAGE_IMAGES';
      } else if (coverImage && finalImages.length > 1) {
        doneNote = 'AUTO_CANVAS_COVER_WITH_FALLBACK_IMAGES';
      } else if (coverImage) {
        doneNote = 'AUTO_CANVAS_COVER_IMAGE';
      } else if (collageImage && coverTitleMissing) {
        doneNote = 'AUTO_CANVAS_COVER_TITLE_FALLBACK';
      } else if (collageImage) {
        doneNote = 'AUTO_CANVAS_DYNAMIC_COLLAGE_IMAGE';
      } else if (finalImages.length < 2) {
        doneNote = 'AUTO_PARTIAL_IMAGE';
      }
      this.logger.debug(
        `[assign-image] done title="${input.articleTitle.slice(0, 30)}" doneNote=${doneNote} imageCount=${imageUrls.length}`,
      );
      return { imageIds, imageUrls, doneNote, status: 'done' };
    } else {
      this.logger.warn(
        `[assign-image] no_image title="${input.articleTitle.slice(0, 30)}"`,
      );
      return {
        imageIds: [],
        imageUrls: [],
        doneNote: 'NO_GALLERY_IMAGE',
        status: 'requires_human',
      };
    }
  }
}
