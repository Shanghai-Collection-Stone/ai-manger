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
import { TextFormatService } from '../../format/services/format.service';
import { CanvasService } from '../../canvas/services/canvas.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { GalleryGroupService } from '../../gallery/services/gallery-group.service.js';
import type { GalleryImageEntity } from '../../gallery/entities/gallery-image.entity.js';
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
    intToRGBA?: (value: number) => { r: number; g: number; b: number; a: number };
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
  private customCoverFontBase64: string | null = null;
  private customCoverFontLoaded = false;
  private fontconfigSetupDone = false;

  constructor(
    private readonly agent: AgentService,
    private readonly format: TextFormatService,
    private readonly canvas: CanvasService,
    private readonly gallery: GalleryService,
    private readonly galleryGroups: GalleryGroupService,
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
   * @description 组装 LangChain invoke 配置，统一附带 context/configurable。
   * @param {Record<string, unknown>} context - 运行上下文。
   * @returns {{ context: Record<string, unknown>; configurable: Record<string, unknown>; }} invoke 配置。
   * @keyword-en build langchain invoke option
   */
  private buildLangChainInvokeOption(context: Record<string, unknown>): {
    context: Record<string, unknown>;
    configurable: Record<string, unknown>;
  } {
    return {
      context,
      configurable: {
        tenantId: context['tenantId'],
        userId: context['userId'],
      },
    };
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

  /**
   * @description 提取封面浮动文案（文章类型）。
   * @param {string} title - 文章标题。
   * @param {string[]} tags - 标签。
   * @returns {string} 封面文案。
   * @keyword-en derive cover text
   */
  private deriveCoverText(title: string, tags?: string[]): string {
    const firstTag = Array.isArray(tags)
      ? tags
          .map((x) => String(x ?? '').trim())
          .find((x) => x.length > 0)
      : undefined;
    if (firstTag) return firstTag;
    const clean = String(title || '').replace(/[\s\-_:：]+/g, ' ').trim();
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
  private splitTextByVisualWidth(text: string, maxUnitsPerLine: number): string[] {
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
  private normalizeCoverText(text: string, fallback: string, _maxLen: number): string {
    const normalized = String(text ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized.length > 0) return normalized;
    return String(fallback || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || '示例封面';
  }

  /**
   * @description 生成封面文案（主标题+副标题）。
   * @param {object} input - 文章信息。
   * @returns {Promise<{ title: string; subtitle: string }>} 封面文案。
   * @keyword-en generate cover copy by llm
   */
  private async generateCoverCopyByLlm(input: {
    articleTitle: string;
    articleTags?: string[];
    imageQuery?: string;
  }): Promise<{
    title: string;
    subtitle: string;
    titleFromLlm: boolean;
  }> {
    const fallbackTitle = this.deriveCoverText(
      input.articleTitle,
      input.articleTags,
    );
    const fallbackSubtitle = String(input.imageQuery ?? '')
      .replace(/[\s\u3000]+/g, ' ')
      .trim();

    const sys = [
      '你是封面文案生成器。',
      '只输出 JSON：{"title": string, "subtitle": string}',
      'title 与 subtitle 使用中文优先，可包含少量英文或数字。',
      'title 建议 8-16 字，语义必须完整，不要截断。',
      'subtitle 建议 12-24 字，语义必须完整，不要截断。',
      '不要使用引号、emoji、夸张营销词。',
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
              articleTitle: input.articleTitle,
              articleTags: input.articleTags,
              imageQuery: input.imageQuery,
            }),
          ),
        ],
        { callbacks: [] },
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
            rawTitle,
            '沉浸式体验',
            10,
          ),
          subtitle: this.normalizeCoverText(
            rawSubtitle,
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
   * @description 将图库 URL 映射到本地静态文件路径。
   * @param {string} url - 图库 URL。
   * @returns {string | undefined} 本地路径。
   * @keyword-en resolve local path from gallery url
   */
  private resolveLocalPathFromGalleryUrl(url?: string): string | undefined {
    const s = String(url ?? '').trim();
    if (!s || /^https?:\/\//i.test(s)) return undefined;
    if (s.startsWith('/static/uploads/')) {
      return join(process.cwd(), 'public', 'uploads', s.slice('/static/uploads/'.length));
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
    const needsCjk = this.hasCjkChars(safeTitle) || this.hasCjkChars(safeSubtitle);
    const fontFaceCss = needsCjk
      ? await this.buildCustomFontFaceCssOrThrow()
      : '';

    try {
      const mod = (await import('sharp')) as unknown as {
        default: (input: string | Buffer) => {
          resize: (w: number, h: number, opts?: Record<string, unknown>) => unknown;
          composite: (layers: Array<{ input: Buffer; top?: number; left?: number }>) => unknown;
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
      const titleFontSize = Math.max(34, Math.min(60, Math.floor(900 / Math.max(10, titleUnits))));
      const subtitleFontSize = Math.max(22, Math.min(34, Math.floor(760 / Math.max(12, subtitleUnits))));
      const titleLines = this.splitTextByVisualWidth(safeTitle, 20);
      const subtitleLines = this.splitTextByVisualWidth(subtitleForRender, 28);
      const titleStartY = Math.max(34, 41 - (Math.max(1, titleLines.length) - 1) * 4);
      const subtitleStartY = Math.min(74, 54 + (Math.max(1, titleLines.length) - 1) * 3);
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

      await (sharpFn(input.collagePath) as unknown as {
        resize: (w: number, h: number, opts?: Record<string, unknown>) => {
          composite: (layers: Array<{ input: Buffer; top?: number; left?: number }>) => {
            jpeg: (opts?: Record<string, unknown>) => { toFile: (path: string) => Promise<unknown> };
          };
        };
      })
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
      try { await fs.access(tmpFont); } catch { await fs.copyFile(fontFilePath, tmpFont); }
      const confPath = `${tmpDir}/fonts.conf`;
      try { await fs.access(confPath); } catch {
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
   * @description 随机整数（含边界）。
   * @param {number} min - 最小值。
   * @param {number} max - 最大值。
   * @returns {number} 随机结果。
   * @keyword-en random int in range
   */
  private randomInt(min: number, max: number): number {
    const lo = Math.floor(Number(min));
    const hi = Math.floor(Number(max));
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 1;
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
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
  private scoreImagePairDiversity(a: GalleryImageEntity, b: GalleryImageEntity): number {
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
  private async createDynamicCollageFile(pathA: string, pathB: string): Promise<{
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

    const [imgA, imgB] = await Promise.all([JimpCtor.read(pathA), JimpCtor.read(pathB)]);

    const topH = Math.floor(COLLAGE_HEIGHT / 2);
    const bottomH = COLLAGE_HEIGHT - topH;

    // 上图：等比缩到 topH 高度，不裁剪
    const bitmapA = (imgA as unknown as { bitmap: { width: number; height: number } }).bitmap;
    const iwA = Math.max(1, Number(bitmapA?.width ?? 1));
    const ihA = Math.max(1, Number(bitmapA?.height ?? 1));
    const drawWA = Math.max(1, Math.round(iwA * (topH / ihA)));
    imgA.resize({ w: drawWA, h: topH });

    // 下图：等比缩到 bottomH 高度，不裁剪
    const bitmapB = (imgB as unknown as { bitmap: { width: number; height: number } }).bitmap;
    const iwB = Math.max(1, Number(bitmapB?.width ?? 1));
    const ihB = Math.max(1, Number(bitmapB?.height ?? 1));
    const drawWB = Math.max(1, Math.round(iwB * (bottomH / ihB)));
    imgB.resize({ w: drawWB, h: bottomH });

    const black =
      typeof JimpCtor.rgbaToInt === 'function'
        ? JimpCtor.rgbaToInt(0, 0, 0, 255)
        : 0x000000ff;
    const out = new JimpCtor({ width: COLLAGE_WIDTH, height: COLLAGE_HEIGHT, color: black });

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
      title: this.normalizeCoverText(String(coverTitle || '').trim(), '示例文章', 10),
      subtitle: this.normalizeCoverText(String(coverSubtitle || '').trim(), '', 16),
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
    this.logger.warn('[cover-render] sharp_overlay_failed fallback_to_jimp=true');

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
        const titleStyle = { text: title, alignmentX: alignX, alignmentY: alignY };

        if (fontTitleBlack) {
          img.print(fontTitleBlack, 4, ty + 4, titleStyle, COLLAGE_WIDTH - 8, 160);
          img.print(fontTitleBlack, -4, ty + 4, titleStyle, COLLAGE_WIDTH - 8, 160);
          img.print(fontTitleBlack, 4, ty - 4, titleStyle, COLLAGE_WIDTH - 8, 160);
          img.print(fontTitleBlack, -4, ty - 4, titleStyle, COLLAGE_WIDTH - 8, 160);
        }
        img.print(fontTitleWhite, 0, ty, titleStyle, COLLAGE_WIDTH, 160);

        if (subtitle && fontSubWhite) {
          const sy = ty + 126;
          const subStyle = { text: subtitle, alignmentX: alignX, alignmentY: alignY };
          if (fontSubBlack) {
            img.print(fontSubBlack, 3, sy + 3, subStyle, COLLAGE_WIDTH - 8, 120);
            img.print(fontSubBlack, -3, sy + 3, subStyle, COLLAGE_WIDTH - 8, 120);
            img.print(fontSubBlack, 3, sy - 3, subStyle, COLLAGE_WIDTH - 8, 120);
            img.print(fontSubBlack, -3, sy - 3, subStyle, COLLAGE_WIDTH - 8, 120);
          }
          img.print(fontSubWhite, 0, sy, subStyle, COLLAGE_WIDTH, 120);
        }
      } else {
        this.logger.warn('[cover-render] no_title_font_loaded skip_text_render');
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
    groupId?: number;
    absPath: string;
    fileName: string;
    url: string;
    tags?: string[];
    description: string;
    isCollage?: boolean;
    collageSourceImageIds?: number[];
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

    // 为生成的图片（拼图/封面）生成缩略图
    const thumb = await this.gallery.generateThumbnail(input.absPath, input.fileName);

    // 拼图/封面图片使用专用分组
    let finalGroupId = input.groupId;
    if (input.isCollage === true) {
      const collageGroup = await this.galleryGroups.findOrCreateCollageGroup(
        input.userId,
        input.tenantId,
      );
      finalGroupId = collageGroup.id;
    }

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
        tags: input.tags ?? [],
        description: input.description,
        isCollage: input.isCollage === true,
        collageSourceImageIds:
          input.isCollage === true
            ? (input.collageSourceImageIds ?? []).slice(0, 2)
            : undefined,
        collageMeta:
          input.isCollage === true
            ? { width: COLLAGE_WIDTH, height: COLLAGE_HEIGHT, dpi: COLLAGE_DPI }
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
    count?: number;
    galleryUserId?: string;
    galleryGroupId?: number;
    minImageScore?: number;
    langchainContext?: Record<string, unknown>;
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
    const tenantId =
      typeof input.tenantId === 'string' && input.tenantId.trim().length > 0
        ? input.tenantId.trim()
        : undefined;
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
    const langchainContext = {
      ...this.buildLangChainContext({
        userId: input.userId,
        tenantId,
        platform,
        topic,
      }),
      ...(input.langchainContext ?? {}),
    };

    const canvas = await this.canvas.create({
      userId: input.userId,
      tenantId,
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
      langchainContext,
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
        outline: { topic, platform, articleCount: count, blueprints },
      },
      tenantId,
    );

    // 从选题蓝图提取标签，立即可用，无需等待全文生成
    const canvasTags = Array.from(
      new Set(
        blueprints
          .flatMap((bp) => bp.tags ?? [])
          .map((t) => String(t ?? '').trim())
          .filter((t) => t.length > 0),
      ),
    ).slice(0, 50);

    this.logger.debug(
      `[article-gen] canvas_ready canvasId=${canvas.id} blueprints=${blueprints.length} tags=${canvasTags.length}`,
    );

    // 后台异步生成文章正文与配图，立即返回 generating 状态
    void this.runArticleGeneration(canvas.id, {
      blueprints,
      provider,
      model,
      temperature,
      platform,
      topic,
      tenantId,
      galleryUserId,
      galleryGroupId,
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
        angle?: string;
        imageQuery?: string;
        notes?: string[];
      }>;
      provider?: 'gemini' | 'deepseek';
      model?: string;
      temperature: number;
      platform: string;
      topic?: string;
      tenantId?: string;
      galleryUserId: string;
      galleryGroupId?: number;
      minImageScore: number;
      langchainContext: Record<string, unknown>;
    },
  ): Promise<void> {
    this.logger.debug(
      `[article-gen] generation_start canvasId=${canvasId} blueprints=${input.blueprints.length}`,
    );
    try {
      await this.generateArticlesAndImages({ canvasId, ...input });
      await this.canvas.updateStatus(canvasId, 'completed', input.tenantId);
      this.logger.debug(`[article-gen] generation_done canvasId=${canvasId}`);
    } catch (err) {
      await this.canvas.updateStatus(canvasId, 'failed', input.tenantId);
      this.logger.error(
        `[article-gen] generation_failed canvasId=${canvasId}`,
        err,
      );
    }
  }

  private async planArticleTasks(input: {
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature: number;
    platform: string;
    topic?: string;
    count: number;
    langchainContext: Record<string, unknown>;
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
      '若 human message context 中包含搜索结果或热点资讯，必须优先基于这些内容规划选题，确保标题与当前热点/趋势匹配。',
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
    const invokeOption = this.buildLangChainInvokeOption(input.langchainContext);
    let plan = ZArticleBlueprintPlan.safeParse(undefined);
    try {
      const structured = llm.withStructuredOutput(ZArticleBlueprintPlan);
      const output = await structured.invoke(messages, invokeOption);
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
    tenantId?: string;
    galleryUserId: string;
    galleryGroupId?: number;
    minImageScore: number;
    langchainContext: Record<string, unknown>;
  }): Promise<void> {
    const total = input.blueprints.length;
    const startAt = Date.now();
    this.logger.log(
      `[article-gen] parallel_start canvasId=${input.canvasId} total=${total} platform=${input.platform}`,
    );

    // 1. 收集所有蓝图 tag，一次性拉取图片池（与文章生成并行）
    const allTags: string[] = [];
    const tagSeen = new Set<string>();
    for (const bp of input.blueprints) {
      for (const t of bp.tags ?? []) {
        const s = t.trim();
        if (s && !tagSeen.has(s)) { tagSeen.add(s); allTags.push(s); }
      }
    }
    // 1. 先 await 图片池（DB 查询，通常 < 200ms），再批次预分配，避免并行时各自重复选图
    const imagePool = await this.fetchArticleImagePool({
      userId: input.galleryUserId,
      tenantId: input.tenantId,
      tags: allTags,
    });

    // 2. 批次级别贪心预分配图片 slice，全局 usedIds 去重，各篇文章用独立来源
    const imageSlices = this.preAssignImageSlices(imagePool, input.blueprints.length);

    // 3. 每篇文章：内容生成 与 配图渲染 真正并发（各有独立预分配来源）
    await Promise.all(
      input.blueprints.map(async (bp, bpIdx) => {
        const articleId = bp.index + 1;
        const t0 = Date.now();
        this.logger.log(
          `[article-gen] article_start canvasId=${input.canvasId} articleId=${articleId}/${total} title="${bp.title.slice(0, 30)}"`,
        );
        try {
          const [article, imageData] = await Promise.all([
            // 内容生成分支
            this.generateOneArticle({
              provider: input.provider,
              model: input.model,
              temperature: input.temperature,
              platform: input.platform,
              topic: input.topic,
              blueprint: bp,
              langchainContext: input.langchainContext,
            }),
            // 配图分支：使用预分配的图片 slice（已全局去重），与内容生成并行
            this.resolveArticleImages({
              articleTitle: bp.title,
              articleTags: bp.tags,
              imageQuery: bp.imageQuery,
              tenantId: input.tenantId,
              galleryUserId: input.galleryUserId,
              galleryGroupId: input.galleryGroupId,
              imagePool,
              preAssignedSources: imageSlices[bpIdx],
            }),
          ]);

          this.logger.log(
            `[article-gen] article_written canvasId=${input.canvasId} articleId=${articleId}/${total} elapsed=${Date.now() - t0}ms`,
          );

          // 3. 合并回写：正文 + 配图 + 最终状态
          await this.canvas.updateArticle(
            input.canvasId,
            articleId,
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
            input.tenantId,
          );
          await this.canvas.updateArticleImages(
            input.canvasId,
            articleId,
            {
              imageIds: imageData.imageIds.length > 0 ? imageData.imageIds : undefined,
              imageUrls: imageData.imageUrls.length > 0 ? imageData.imageUrls : undefined,
              status: imageData.status,
              doneNote: imageData.doneNote,
            },
            input.tenantId,
          );

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

    this.logger.log(
      `[article-gen] parallel_done canvasId=${input.canvasId} total=${total} elapsed=${Date.now() - startAt}ms`,
    );
  }

  private async generateOneArticle(input: {
    provider?: 'gemini' | 'deepseek';
    model?: string;
    temperature: number;
    platform: string;
    topic?: string;
    langchainContext: Record<string, unknown>;
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
      '若文章适合做“前后对比/双场景展示”，在 imageQuery 中明确两类元素，便于生成阶段即时完成拼图与封面处理。',
      '若 human message context 中包含搜索摘要或参考资料，务必将其融入文章正文，增强内容的时效性与真实感；禁止直接抄录原文，需改写融合。',
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
    const invokeOption = this.buildLangChainInvokeOption(input.langchainContext);
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
      title: String(article.data.title || '').trim(),
      tags,
      markdown: String(article.data.markdown || '').trim(),
      imageQuery:
        article.data.imageQuery?.trim() ||
        input.blueprint.imageQuery ||
        `${input.topic || ''} ${input.blueprint.angle || ''} 场景`,
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
  }): Promise<GalleryImageEntity[]> {
    const wantCount = 60;
    const seen = new Set<string | number>();
    const pool: GalleryImageEntity[] = [];
    const dedup = (imgs: GalleryImageEntity[]) => {
      for (const img of imgs) {
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
      const more = await this.gallery.findAccessibleImages(input.userId, input.tenantId, {
        imageType: 'regular',
        limit: wantCount,
      });
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
          const score = this.scoreImagePairDiversity(remaining[a], remaining[b]);
          if (score > bestScore) {
            bestScore = score;
            bestA = remaining[a];
            bestB = remaining[b];
          }
        }
      }

      const slice: GalleryImageEntity[] = [];
      const pairSet = new Set<GalleryImageEntity>();
      if (bestA) { slice.push(bestA); pairSet.add(bestA); }
      if (bestB) { slice.push(bestB); pairSet.add(bestB); }
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
    /** 批次预分配的图片来源，若提供则直接使用，跳过池内随机选取 */
    preAssignedSources?: GalleryImageEntity[];
  }): Promise<{ imageIds: number[]; imageUrls: string[]; doneNote: string; status: 'done' | 'requires_human' }> {
    const queryText = input.imageQuery?.trim() || input.articleTitle;
    const targetImageCount = this.randomInt(1, 3);
    const needRawSourceCount = 2;
    const maxPickedImages = Math.max(6, targetImageCount * 4);

    // 从共享池选图：优先匹配文章 tag，再降级全池
    const allImageKeys = new Set<string>();
    const pickedImages: GalleryImageEntity[] = [];
    const tryAdd = (img: GalleryImageEntity) => {
      if (!img || typeof img !== 'object') return;
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
        if ((img.tags ?? []).some((t) => tagSet.has(t.toLowerCase()))) tryAdd(img);
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
            (x) => x?.isCollage !== true && !this.isGeneratedCoverImage(x) && x?.isPortrait !== true,
          )
        : this.shuffleArray(
            pickedImages.filter(
              (x) => x?.isCollage !== true && !this.isGeneratedCoverImage(x) && x?.isPortrait !== true,
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

    const coverPair = this.pickMostDiversePair(rawSources.slice(0, Math.min(rawSources.length, 8)));
    const coverSources = coverPair ? [coverPair[0], coverPair[1]] : rawSources.slice(0, 2);
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
            collageSourceImageIds: [coverSources[0]?.id, coverSources[1]?.id].filter(
              (x): x is number => typeof x === 'number' && Number.isFinite(x),
            ),
          });
          const aId = Number(coverSources[0]?.id ?? 0);
          const bId = Number(coverSources[1]?.id ?? 0);
          coverPairKey = `${Math.min(aId, bId)}-${Math.max(aId, bId)}`;
          const diversity = this.scoreImagePairDiversity(coverSources[0], coverSources[1]);
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
      const pairs: Array<{ a: GalleryImageEntity; b: GalleryImageEntity; key: string; diversity: number }> = [];
      for (let i = 0; i < contentSourcePool.length; i++) {
        for (let j = i + 1; j < contentSourcePool.length; j++) {
          const a = contentSourcePool[i];
          const b = contentSourcePool[j];
          const aId = Number(a?.id ?? 0);
          const bId = Number(b?.id ?? 0);
          const key = `${Math.min(aId, bId)}-${Math.max(aId, bId)}`;
          if (coverPairKey && key === coverPairKey) continue;
          pairs.push({ a, b, key, diversity: this.scoreImagePairDiversity(a, b) });
        }
      }

      const orderedPairs = pairs
        .sort((x, y) => y.diversity - x.diversity)
        .slice(0, Math.max(needContentCollageCount * 4, needContentCollageCount));
      const usedContentSourceIds = new Set<number>();
      for (const pair of this.shuffleArray(orderedPairs)) {
        if (contentCollageImages.length >= needContentCollageCount) break;
        const aId = Number(pair.a?.id ?? 0);
        const bId = Number(pair.b?.id ?? 0);
        // 跳过：任一源图已在本轮内容拼图中使用（跨拼图去重）
        if (Number.isFinite(aId) && aId > 0 && usedContentSourceIds.has(aId)) continue;
        if (Number.isFinite(bId) && bId > 0 && usedContentSourceIds.has(bId)) continue;
        const pa = pair.a.absPath || this.resolveLocalPathFromGalleryUrl(pair.a.url);
        const pb = pair.b.absPath || this.resolveLocalPathFromGalleryUrl(pair.b.url);
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
        collageImage.absPath || this.resolveLocalPathFromGalleryUrl(collageImage.url);
      if (collagePath) {
        try {
          const coverCopy = await this.generateCoverCopyByLlm({
            articleTitle: input.articleTitle,
            articleTags: input.articleTags,
            imageQuery: queryText,
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
          });
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
    if (coverImage) finalImages.push(coverImage);
    for (const img of contentCollageImages) {
      if (finalImages.length >= targetImageCount) break;
      finalImages.push(img);
    }

    if (finalImages.length === 0 && collageImage) {
      finalImages.push(collageImage);
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
      } else if (coverImage && finalImages.length > 1) {
        doneNote = 'AUTO_CANVAS_COVER_AND_COLLAGE_IMAGES';
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
      return { imageIds: [], imageUrls: [], doneNote: 'NO_GALLERY_IMAGE', status: 'requires_human' };
    }
  }
}
