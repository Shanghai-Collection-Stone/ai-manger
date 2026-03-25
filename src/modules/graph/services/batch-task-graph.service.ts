import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { BatchTaskService } from '../../batch-task/services/batch-task.service.js';
import { CanvasService } from '../../canvas/services/canvas.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import type { GalleryImageEntity } from '../../gallery/entities/gallery-image.entity.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { AgentConfig } from '../../ai-agent/types/agent.types.js';
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

const COLLAGE_WIDTH = 640;
const COLLAGE_HEIGHT = 853;
const COLLAGE_DPI = 96;

type JimpModuleLike = {
  Jimp: {
    read: (input: string) => Promise<unknown>;
    rgbaToInt?: (r: number, g: number, b: number, a: number) => number;
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
export class BatchTaskGraphService implements OnModuleInit, OnModuleDestroy {
  private graphJobTimer: ReturnType<typeof setInterval> | null = null;
  private graphJobBusy = false;

  constructor(
    private readonly canvas: CanvasService,
    private readonly batch: BatchTaskService,
    private readonly gallery: GalleryService,
    private readonly agent: AgentService,
    private readonly format: TextFormatService,
  ) {}

  onModuleInit() {
    if (this.graphJobTimer) return;
    this.graphJobTimer = setInterval(() => {
      void this.tickGraphJobWorker();
    }, 1000);
  }

  onModuleDestroy() {
    if (this.graphJobTimer) clearInterval(this.graphJobTimer);
    this.graphJobTimer = null;
  }

  private async tickGraphJobWorker(): Promise<void> {
    if (this.graphJobBusy) return;
    this.graphJobBusy = true;
    let claimedId: number | null = null;
    try {
      const task = await this.batch.claimNextGraphJob('xhs_batch_publish');
      if (!task) return;
      claimedId = task.id;
      const input = task.graphJob?.input;
      if (!input || input.kind !== 'xhs_batch_publish') {
        await this.batch.markGraphJobFailed(task.id, 'GRAPH_JOB_INPUT_INVALID');
        await this.batch.markFailed(task.id, 'GRAPH_JOB_INPUT_INVALID');
        return;
      }
      const mcpTaskId = task.mcpTaskId ? String(task.mcpTaskId) : '';
      if (!mcpTaskId) {
        await this.batch.markGraphJobFailed(task.id, 'MCP_TASK_NOT_OPENED');
        await this.batch.markFailed(task.id, 'MCP_TASK_NOT_OPENED');
        return;
      }

      await this.runXhsPublishLangGraph({
        userId: task.userId,
        canvasId: input.canvasId,
        batchTaskId: task.id,
        mcpTaskId,
        galleryUserId: input.galleryUserId ?? task.userId,
        galleryGroupId: input.galleryGroupId,
        minImageScore: input.minImageScore,
        callbackUrl: input.callbackUrl,
        payload: input.payload,
        provider: input.provider,
        model: input.model,
        temperature: input.temperature,
      });
      await this.batch.markGraphJobDone(task.id);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (typeof claimedId === 'number') {
        await this.batch.markGraphJobFailed(claimedId, err.message);
        await this.batch.markFailed(claimedId, err.message);
      }
      console.error('[BatchTaskGraph.graphJobWorker] FAILED', err.message);
      if (err.stack) console.error(err.stack);
    } finally {
      this.graphJobBusy = false;
    }
  }

  /**
   * @description 生成指定区间的随机整数（包含两端）。
   * @param {number} min - 最小值。
   * @param {number} max - 最大值。
   * @returns {number} 随机整数。
   * @keyword-en random, int, range
   */
  private randomInt(min: number, max: number): number {
    const a = Math.floor(Number(min));
    const b = Math.floor(Number(max));
    const lo = Number.isFinite(a) ? a : 0;
    const hi = Number.isFinite(b) ? b : lo;
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /**
   * @description 清理小红书正文尾部的 hashtag 块，避免把 tags 写进正文。
   * @param {string} input - 原始正文。
   * @returns {string} 清理后的正文。
   * @keyword-en xhs, content, sanitize, hashtag
   */
  private sanitizeXhsContent(input: string): string {
    const s = String(input ?? '');
    const lines = s.split(/\r?\n/);
    let i = lines.length - 1;
    while (i >= 0) {
      const line = String(lines[i] ?? '').trim();
      if (!line) {
        i -= 1;
        continue;
      }
      if (/^#[^\s#]+/.test(line)) {
        i -= 1;
        continue;
      }
      break;
    }
    const trimmed = lines
      .slice(0, i + 1)
      .join('\n')
      .trim();
    return trimmed;
  }

  /**
   * @description 判断发布链路是否明确要求复用历史拼图。
   * @param {string} text - 语义文本。
   * @returns {boolean} 是否复用历史拼图。
   * @keyword-en publish historical collage intent
   */
  private shouldUseHistoricalCollage(text: string): boolean {
    const s = String(text || '').trim();
    if (!s) return false;
    return /历史拼图|已有拼图|之前拼图|拼图库|复用拼图|历史素材拼图/i.test(s);
  }

  /**
   * @description 提取封面浮动文案（文章类型）。
   * @param {string} title - 发布标题。
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
    if (firstTag) return firstTag.slice(0, 14);
    const clean = String(title || '').replace(/[\s\-_:：]+/g, ' ').trim();
    if (!clean) return '发布封面';
    return clean.slice(0, 14);
  }

  /**
   * @description 映射图库 URL 到本地绝对路径。
   * @param {string} url - 图库URL。
   * @returns {string | undefined} 本地路径。
   * @keyword-en resolve local image path from gallery url
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
   * @description 读取 Jimp 模块。
   * @returns {Promise<JimpModuleLike>} Jimp 模块。
   * @keyword-en load jimp module
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
   * @description 使用 sharp + SVG 渲染发布封面文案。
   * @param {{ collagePath: string; coverText: string; outputPath: string }} input - 渲染入参。
   * @returns {Promise<boolean>} 是否渲染成功。
   * @keyword-en render publish cover with sharp svg
   */
  private async renderPublishCoverWithSharp(input: {
    collagePath: string;
    coverText: string;
    outputPath: string;
  }): Promise<boolean> {
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

      const text = String(input.coverText || '').trim() || '发布封面';
      const lines = text.match(/.{1,12}/g) ?? [text];
      const renderLines = lines.slice(0, 2);
      const multi = renderLines.length > 1;
      const fontSize = multi ? 30 : 34;
      const boxHeight = multi ? 92 : 58;
      const boxWidth = 380;
      const boxX = Math.floor((COLLAGE_WIDTH - boxWidth) / 2);
      const boxY = Math.floor((COLLAGE_HEIGHT - boxHeight) / 2);
      const tspans = lines
        .slice(0, 2)
        .map(
          (line, idx) =>
            `<tspan x="50%" dy="${idx === 0 ? 0 : 1.25}em">${this.escapeSvgText(line)}</tspan>`,
        )
        .join('');

      const svg = `
<svg width="${COLLAGE_WIDTH}" height="${COLLAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .mask{fill:#000000;opacity:.78;}
    .t{fill:#ffffff;font-size:${fontSize}px;font-weight:800;font-family:'Noto Sans CJK SC','WenQuanYi Micro Hei','Source Han Sans SC','Microsoft YaHei','PingFang SC','SimHei',Arial,Helvetica,sans-serif;letter-spacing:1px;}
  </style>
  <rect x="${boxX}" y="${boxY}" rx="8" ry="8" width="${boxWidth}" height="${boxHeight}" class="mask"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="t">${tspans}</text>
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
   * @description 创建双图动态拼图（640x853）。
   * @param {string} pathA - 图片A本地路径。
   * @param {string} pathB - 图片B本地路径。
   * @returns {Promise<{ fileName: string; absPath: string; url: string }>} 文件信息。
   * @keyword-en create publish dynamic collage
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
        crop: (opts: { x: number; y: number; w: number; h: number }) => unknown;
        composite: (img: unknown, x: number, y: number) => unknown;
      }>;
      new (args: { width: number; height: number; color: number }): {
        composite: (img: unknown, x: number, y: number) => unknown;
        write: (path: string, opts?: { quality?: number }) => Promise<unknown>;
      };
      rgbaToInt?: (r: number, g: number, b: number, a: number) => number;
    };

    const [imgA, imgB] = await Promise.all([JimpCtor.read(pathA), JimpCtor.read(pathB)]);
    const white =
      typeof JimpCtor.rgbaToInt === 'function'
        ? JimpCtor.rgbaToInt(255, 255, 255, 255)
        : 0xffffffff;
    const out = new JimpCtor({ width: COLLAGE_WIDTH, height: COLLAGE_HEIGHT, color: white });

    const drawHalf = (
      img: {
        bitmap: { width: number; height: number };
        resize: (opts: { w: number; h: number }) => unknown;
        crop: (opts: { x: number; y: number; w: number; h: number }) => unknown;
      },
      y: number,
      h: number,
    ) => {
      const iw = Math.max(1, Number(img.bitmap?.width ?? 1));
      const ih = Math.max(1, Number(img.bitmap?.height ?? 1));
      const scale = Math.max(COLLAGE_WIDTH / iw, h / ih);
      const rw = Math.max(COLLAGE_WIDTH, Math.ceil(iw * scale));
      const rh = Math.max(h, Math.ceil(ih * scale));
      img.resize({ w: rw, h: rh });
      const cx = Math.max(0, Math.floor((rw - COLLAGE_WIDTH) / 2));
      const cy = Math.max(0, Math.floor((rh - h) / 2));
      img.crop({ x: cx, y: cy, w: COLLAGE_WIDTH, h });
      out.composite(img, 0, y);
    };

    const topH = Math.floor(COLLAGE_HEIGHT / 2);
    drawHalf(imgA, 0, topH);
    drawHalf(imgB, topH, COLLAGE_HEIGHT - topH);

    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const fileName = `${Date.now()}-${randomUUID()}-publish-collage.jpg`;
    const absPath = join(uploadsDir, fileName);
    await out.write(absPath, { quality: 90 });
    return {
      fileName,
      absPath,
      url: `/static/uploads/${fileName}`,
    };
  }

  /**
   * @description 基于拼图生成封面图（浮动文字）。
   * @param {string} collagePath - 拼图本地路径。
   * @param {string} coverText - 封面文字。
   * @returns {Promise<{ fileName: string; absPath: string; url: string }>} 文件信息。
   * @keyword-en create publish cover from collage
   */
  private async createCoverFromCollageFile(
    collagePath: string,
    coverText: string,
  ): Promise<{ fileName: string; absPath: string; url: string }> {
    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const fileName = `${Date.now()}-${randomUUID()}-publish-cover.jpg`;
    const absPath = join(uploadsDir, fileName);

    const sharpOk = await this.renderPublishCoverWithSharp({
      collagePath,
      coverText,
      outputPath: absPath,
    });
    if (sharpOk) {
      return {
        fileName,
        absPath,
        url: `/static/uploads/${fileName}`,
      };
    }

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

    const data = img.bitmap.data;
    const plateTop = Math.floor(COLLAGE_HEIGHT * 0.33);
    const plateBottom = Math.floor(COLLAGE_HEIGHT * 0.68);
    for (let y = plateTop; y < plateBottom; y++) {
      for (let x = 0; x < COLLAGE_WIDTH; x++) {
        const idx = (y * COLLAGE_WIDTH + x) * 4;
        data[idx] = Math.floor(data[idx] * 0.46);
        data[idx + 1] = Math.floor(data[idx + 1] * 0.46);
        data[idx + 2] = Math.floor(data[idx + 2] * 0.46);
      }
    }

    const text = String(coverText || '').trim().slice(0, 16) || '发布封面';
    if (typeof mod.loadFont === 'function') {
      const fontWhite = await this.loadJimpFontFallback(mod, [
        mod.FONT_SANS_64_WHITE,
        mod.FONT_SANS_32_WHITE,
      ]);
      const fontBlack = await this.loadJimpFontFallback(mod, [
        mod.FONT_SANS_64_BLACK,
        mod.FONT_SANS_32_BLACK,
      ]);
      const alignX = mod.HorizontalAlign?.CENTER ?? 1;
      const alignY = mod.VerticalAlign?.MIDDLE ?? 1;
      const style = { text, alignmentX: alignX, alignmentY: alignY };
      const ty = Math.floor(COLLAGE_HEIGHT * 0.42);
      if (fontWhite) {
        if (fontBlack) {
          img.print(fontBlack, 6, ty + 6, style, COLLAGE_WIDTH - 12, 220);
          img.print(fontBlack, -6, ty + 6, style, COLLAGE_WIDTH - 12, 220);
          img.print(fontBlack, 6, ty - 6, style, COLLAGE_WIDTH - 12, 220);
          img.print(fontBlack, -6, ty - 6, style, COLLAGE_WIDTH - 12, 220);
        }
        img.print(fontWhite, 0, ty, style, COLLAGE_WIDTH, 220);
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
   * @description 将发布阶段生成图片持久化到图库。
   * @param {object} input - 入参。
   * @returns {Promise<GalleryImageEntity | null>} 图库实体。
   * @keyword-en save generated publish image to gallery
   */
  private async saveGeneratedImageToGallery(input: {
    userId: string;
    tenantId?: string;
    groupId?: number;
    absPath: string;
    fileName: string;
    url: string;
    tags: string[];
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
    const docs = await this.gallery.createMany([
      {
        userId: input.userId,
        tenantId: input.tenantId,
        groupId: input.groupId,
        originalName: input.fileName,
        fileName: input.fileName,
        absPath: input.absPath,
        url: input.url,
        mimeType,
        size: statSize > 0 ? statSize : undefined,
        tags: input.tags,
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
      },
    ]);
    return Array.isArray(docs) && docs.length > 0 ? docs[0] : null;
  }

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
        input.provider === 'deepseek'
          ? ({
              type: 'json_object',
            } as unknown as AgentConfig['responseFormat'])
          : undefined,
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
      '你是"待办摘要生成器"。根据提供的批量发布任务信息，生成一段简洁、易读的中文摘要描述（1~2句话）。' +
      '描述应包含：发布平台、内容主题/方向、任务数量。' +
      '不要包含任何ID、编号或技术字段。语气自然，像是写给运营同事看的任务简介。' +
      '只输出 JSON 对象，schema：{ "description": string }。';
    const payload = {
      platform: input.platform,
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
        provider === 'deepseek'
          ? ({
              type: 'json_object',
            } as unknown as AgentConfig['responseFormat'])
          : undefined,
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
    const preview = input.tasksPreview.slice(0, 5).join('、');
    const base = `${input.platform}批量发布，共 ${input.taskCount} 条内容。`;
    return preview.length > 0 ? `${base}包含：${preview}` : base;
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
      const contentJson = a.contentJson;
      const markdown =
        contentJson && typeof contentJson === 'object'
          ? (contentJson as { markdown?: unknown }).markdown
          : undefined;
      const content = typeof markdown === 'string' ? markdown : a.contentJson;
      const payload: Record<string, unknown> = {
        ...(input.payload ?? {}),
        canvasId: c.id,
        articleId: a.id,
        title: a.title,
        content,
        tags: a.tags,
        imageUrls: a.imageUrls,
        imageIds: a.imageIds,
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

    await this.batch.runSync(task.id, {
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
    todoId?: number;
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
      todoId: input.todoId,
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

    const baseMs = typeof startMs === 'number' ? startMs : Date.now();
    let cursorMs = baseMs;
    const postsInit: Array<{
      title: string;
      plannedAt?: string;
      payload: Record<string, unknown>;
    }> = [];
    for (let idx = 0; idx < taskCountRaw; idx++) {
      const refIndex = idx < allArticles.length ? idx : undefined;
      const refArticle =
        typeof refIndex === 'number' ? allArticles[refIndex] : undefined;
      const refTitleRaw =
        typeof refArticle?.title === 'string' ? refArticle.title.trim() : '';
      const title =
        refTitleRaw.length > 0 ? refTitleRaw : `小红书图文任务 #${idx + 1}`;

      if (idx === 0) cursorMs = baseMs;
      else {
        const stepMinutes =
          intervalMinutes > 0 ? intervalMinutes : this.randomInt(1, 5);
        cursorMs += stepMinutes * 60_000;
      }
      const plannedAt = new Date(cursorMs).toISOString();

      postsInit.push({
        title,
        plannedAt,
        payload: {
          ...(input.payload ?? {}),
          canvasId: c.id,
          refArticleId:
            typeof refArticle?.id === 'number' ? refArticle.id : undefined,
          refIndex: typeof refIndex === 'number' ? refIndex : undefined,
          refTitle: refTitleRaw.length > 0 ? refTitleRaw : undefined,
        },
      });
    }

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

    await this.batch.enqueueGraphJob(task.id, {
      kind: 'xhs_batch_publish',
      canvasId: c.id,
      galleryUserId: input.galleryUserId ?? input.userId,
      galleryGroupId: input.galleryGroupId,
      minImageScore: input.minImageScore,
      callbackUrl: input.callbackUrl,
      payload: input.payload,
      provider: input.provider,
      model: input.model,
      temperature: input.temperature,
    });
    summary['graphQueued'] = true;

    return { ok: true, result: summary };
  }

  /**
   * @description 小红书批量发布工作流：逐条生成内容、选图入队，最后触发 MCP 批量任务运行。
   * @param {object} input - 运行参数。
   * @param {string} input.userId - 用户ID。
   * @param {number} input.canvasId - 画布ID。
   * @param {number} input.batchTaskId - 本地批量任务ID。
   * @param {string} input.mcpTaskId - MCP 任务ID（已打开）。
   * @param {string} input.galleryUserId - 素材库用户ID。
   * @param {number} [input.galleryGroupId] - 素材库分组ID。
   * @param {number} [input.minImageScore] - 相似度阈值。
   * @param {string} [input.callbackUrl] - MCP 回调地址。
   * @param {Record<string, unknown>} [input.payload] - 额外工作流透传参数。
   * @param {'gemini' | 'deepseek'} [input.provider] - 生成模型提供方。
   * @param {string} [input.model] - 生成模型名。
   * @param {number} [input.temperature] - 生成温度。
   * @returns {Promise<void>} 无返回值。
   * @keyword-en xhs, batch publish, workflow, langgraph
   */
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
      tenantId: Annotation<string | undefined>({
        default: () => undefined,
        reducer: (_a, b) => b,
      }),
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
      enqueuedCount: Annotation<number>({
        default: () => 0,
        reducer: (_a, b) => b,
      }),
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

        const nowMs = Date.now();
        let cursorMs = nowMs;
        for (let i = 0; i < posts.length; i++) {
          const p = posts[i];
          const prevPlanned =
            typeof p?.plannedAt === 'string' ? p.plannedAt : '';
          const prevMs = prevPlanned ? new Date(prevPlanned).getTime() : NaN;

          if (i === 0) cursorMs = nowMs;
          else cursorMs += this.randomInt(1, 5) * 60_000;

          let plannedMs = cursorMs;
          if (Number.isFinite(prevMs) && prevMs > plannedMs) plannedMs = prevMs;
          if (i > 0) {
            const prevOut = posts[i - 1]?.plannedAt;
            const prevOutMs = prevOut ? new Date(prevOut).getTime() : NaN;
            if (Number.isFinite(prevOutMs) && plannedMs - prevOutMs < 60_000) {
              plannedMs = prevOutMs + this.randomInt(1, 5) * 60_000;
            }
          }

          const nextPlanned = new Date(plannedMs).toISOString();
          posts[i] = { ...p, plannedAt: nextPlanned };
          cursorMs = plannedMs;

          if (prevPlanned !== nextPlanned) {
            await this.batch.updatePostPlannedAt({
              batchTaskId: state.batchTaskId,
              postId: p.postId,
              plannedAt: nextPlanned,
            });
          }
        }

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
          tenantId: task.tenantId,
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
          (typeof current.refArticleId === 'number' ||
            typeof current.refIndex === 'number') &&
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
          'content 必须是可直接发布的小红书正文风格：短句短段、真实分享口吻、适量清单化表达。',
          '不要在 content 里输出任何 #话题/#标签；话题标签必须通过 tags 字段返回。',
          '你必须参考 referenceMarkdown 的信息密度与写法，但必须改写为新的表达，避免逐句复刻。',
          'tags 若提供，必须从 availableTags 里选择 0-6 个；不确定就给空数组。',
        ].join('\n');

        const basePayload = {
          task: 'Rewrite and adapt reference article into a publish-ready xhs post',
          titleHint: current.title,
          referenceMarkdown: refMarkdown,
          referenceTags: refTags,
          referenceImageQuery: refImageQuery,
          todoContext:
            state.payload && typeof state.payload === 'object'
              ? state.payload['todoContext']
              : undefined,
          availableTags: state.availableTags,
        };

        const config = {
          provider: state.provider,
          model: state.model,
          temperature: state.temperature,
          system: sys,
          nonStreaming: true,
          responseFormat:
            state.provider === 'deepseek'
              ? ({
                  type: 'json_object',
                } as unknown as AgentConfig['responseFormat'])
              : undefined,
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
        const chosenTagsFromDraft = chosenTagsRaw
          .map((x) => String(x ?? '').trim())
          .filter((x) => x.length > 0 && state.availableTags.includes(x))
          .slice(0, 6);
        const chosenTags =
          chosenTagsFromDraft.length > 0
            ? chosenTagsFromDraft
            : refTags
                .map((x) => String(x ?? '').trim())
                .filter((x) => x.length > 0 && state.availableTags.includes(x))
                .slice(0, 6);

        const cleanedContent = this.sanitizeXhsContent(parsed.content);

        const intentText = [
          current.title,
          current.refTitle,
          parsed.imageQuery,
          refImageQuery,
          JSON.stringify(
            state.payload && typeof state.payload === 'object'
              ? state.payload['todoContext']
              : {},
          ),
        ]
          .filter(Boolean)
          .join('\n');
        const wantsHistoricalCollage =
          this.shouldUseHistoricalCollage(intentText);

        const usedSet = new Set<string>(state.usedImageKeys ?? []);
        const byTagsRaw =
          chosenTags.length > 0
            ? await this.gallery.searchByTags({
                userId: state.galleryUserId,
                tenantId: state.tenantId,
                groupId: state.galleryGroupId,
                tags: chosenTags,
                limit: 48,
                matchCollage: wantsHistoricalCollage,
              })
            : [];
        const randomRaw = await this.gallery.sampleRandom({
          userId: state.galleryUserId,
          tenantId: state.tenantId,
          groupId: state.galleryGroupId,
          limit: 48,
        });

        const basePool = [...byTagsRaw, ...randomRaw].filter((img) => {
          if (!wantsHistoricalCollage && img?.isCollage === true) return false;
          return true;
        });

        const takeUnique = (items: GalleryImageEntity[]): GalleryImageEntity[] => {
          const out: GalleryImageEntity[] = [];
          for (const it of items) {
            const id = typeof it.id === 'number' ? it.id : undefined;
            const url = typeof it.url === 'string' ? it.url.trim() : '';
            const keyId = typeof id === 'number' ? `id:${id}` : '';
            const keyUrl = url ? `url:${url}` : '';
            if (keyId && usedSet.has(keyId)) continue;
            if (keyUrl && usedSet.has(keyUrl)) continue;
            if (keyId) usedSet.add(keyId);
            if (keyUrl) usedSet.add(keyUrl);
            out.push(it);
            if (out.length >= 6) break;
          }
          return out;
        };

        const pickedBase = takeUnique(basePool);
        const rawSources = pickedBase.filter((x) => x?.isCollage !== true).slice(0, 2);

        let publishCollage: GalleryImageEntity | null = null;
        if (!wantsHistoricalCollage && rawSources.length === 2) {
          const p0 = rawSources[0]?.absPath || this.resolveLocalPathFromGalleryUrl(rawSources[0]?.url);
          const p1 = rawSources[1]?.absPath || this.resolveLocalPathFromGalleryUrl(rawSources[1]?.url);
          if (p0 && p1) {
            try {
              const collageFile = await this.createDynamicCollageFile(p0, p1);
              publishCollage = await this.saveGeneratedImageToGallery({
                userId: state.galleryUserId,
                tenantId: state.tenantId,
                groupId: state.galleryGroupId,
                absPath: collageFile.absPath,
                fileName: collageFile.fileName,
                url: collageFile.url,
                tags: Array.from(new Set([...chosenTags, '拼图', '动态拼图'])).slice(0, 24),
                description: `发文动态拼图：#${rawSources[0]?.id ?? '-'} + #${rawSources[1]?.id ?? '-'}`,
                isCollage: true,
                collageSourceImageIds: [rawSources[0]?.id, rawSources[1]?.id].filter(
                  (x): x is number => typeof x === 'number' && Number.isFinite(x),
                ),
              });
            } catch {
              publishCollage = null;
            }
          }
        }

        if (wantsHistoricalCollage) {
          publishCollage =
            pickedBase.find((x) => x?.isCollage === true) ||
            byTagsRaw.find((x) => x?.isCollage === true) ||
            null;
        }

        let publishCover: GalleryImageEntity | null = null;
        if (publishCollage) {
          const collagePath =
            publishCollage.absPath ||
            this.resolveLocalPathFromGalleryUrl(publishCollage.url);
          if (collagePath) {
            try {
              const coverText = this.deriveCoverText(parsed.title, chosenTags);
              const coverFile = await this.createCoverFromCollageFile(
                collagePath,
                coverText,
              );
              publishCover = await this.saveGeneratedImageToGallery({
                userId: state.galleryUserId,
                tenantId: state.tenantId,
                groupId: state.galleryGroupId,
                absPath: coverFile.absPath,
                fileName: coverFile.fileName,
                url: coverFile.url,
                tags: Array.from(new Set([...chosenTags, '封面', '自动封面', coverText])).slice(0, 24),
                description: `发文封面：${coverText}`,
              });
            } catch {
              publishCover = null;
            }
          }
        }

        const images = {
          imageUrls: [] as string[],
          imageIds: [] as number[],
        };
        const pushImage = (it?: { id?: number; url?: string } | null) => {
          if (!it) return;
          const id = typeof it.id === 'number' ? it.id : undefined;
          const url = typeof it.url === 'string' ? it.url.trim() : '';
          if (url && !images.imageUrls.includes(url)) images.imageUrls.push(url);
          if (typeof id === 'number' && Number.isFinite(id) && !images.imageIds.includes(id)) {
            images.imageIds.push(id);
          }
        };

        pushImage(publishCover);
        pushImage(publishCollage);
        for (const it of pickedBase) {
          if (images.imageUrls.length >= 3) break;
          pushImage(it);
        }

        if (images.imageUrls.length === 0) {
          const fallbackUrls = Array.isArray(article?.imageUrls)
            ? article.imageUrls
                .map((x) => String(x ?? '').trim())
                .filter((x) => x.length > 0)
            : [];
          for (const url of fallbackUrls) {
            if (images.imageUrls.length >= 3) break;
            const keyUrl = `url:${url}`;
            if (usedSet.has(keyUrl)) continue;
            images.imageUrls.push(url);
            usedSet.add(keyUrl);
          }
        }

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
          ...(state.payload ?? {}),
          platform: 'xhs',
          canvasId: state.canvasId,
          refArticleId: current.refArticleId,
          refIndex: current.refIndex,
          refTitle: current.refTitle,
          content: cleanedContent,
          tags: chosenTags,
          imageUrls: images.imageUrls,
          imageIds: images.imageIds,
        };

        const enq = await this.batch.enqueuePost({
          batchTaskId: state.batchTaskId,
          postId: current.postId,
          title: parsed.title,
          plannedAt: state.idx === 0 ? undefined : current.plannedAt,
          payload: enqueuePayload,
        });

        return {
          idx: state.idx + 1,
          usedImageKeys: Array.from(usedSet),
          enqueuedCount: state.enqueuedCount + (enq.ok ? 1 : 0),
        };
      })
      .addNode('run_task', async (state) => {
        if (!state.enqueuedCount || state.enqueuedCount <= 0) {
          await this.batch.markFailed(
            state.batchTaskId,
            'MCP_TASK_HAS_NO_POSTS',
          );
          return {};
        }
        const cfg = state.payload ?? {};
        const minDelayRaw = cfg['min_delay_ms'] ?? cfg['minDelayMs'];
        const maxDelayRaw = cfg['max_delay_ms'] ?? cfg['maxDelayMs'];
        const minDelayMs =
          typeof minDelayRaw === 'number' && Number.isFinite(minDelayRaw)
            ? Math.max(0, Math.floor(minDelayRaw))
            : 60_000;
        const maxDelayMs0 =
          typeof maxDelayRaw === 'number' && Number.isFinite(maxDelayRaw)
            ? Math.max(0, Math.floor(maxDelayRaw))
            : 300_000;
        const maxDelayMs = Math.max(minDelayMs, maxDelayMs0);

        await this.batch.runSync(state.batchTaskId, {
          callbackUrl: state.callbackUrl,
          payload: {
            ...(state.payload ?? {}),
            canvasId: state.canvasId,
            min_delay_ms: minDelayMs,
            max_delay_ms: maxDelayMs,
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
      tenantId: undefined,
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
      enqueuedCount: 0,
    });
  }
}
