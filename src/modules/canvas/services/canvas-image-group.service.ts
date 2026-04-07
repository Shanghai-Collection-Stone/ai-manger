import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import type { GalleryImageEntity } from '../../gallery/entities/gallery-image.entity.js';
import type {
  CanvasImageGroup,
  CanvasGroupImage,
  ImageGroupLayout,
  CanvasImageGroupCreateInput,
} from '../entities/canvas.entity.js';

/** @description 两种固定版式的需求规格 */
const LAYOUT_SPECS: Record<
  ImageGroupLayout,
  { cover: 'portrait' | 'collage'; inner: ('collage' | 'portrait')[] }
> = {
  'portrait-cover-2inner-collage': {
    cover: 'portrait',
    inner: ['collage', 'collage'],
  },
  'collage-cover-2portrait-inner': {
    cover: 'collage',
    inner: ['portrait', 'portrait'],
  },
};

/** @description 内页不允许使用的封面标签集合（系统写入的精确封面标记） */
const COVER_TAG_SET = new Set(['\u5c01\u9762', '\u62fc\u56fe\u5c01\u9762', '\u81ea\u52a8\u5c01\u9762', 'canvas\u5c01\u9762']);

/** @description 拼图标准尺寸 */
const COLLAGE_WIDTH = 640;
const COLLAGE_HEIGHT = 853;

/** @description 模块级封面字体 base64 缓存（undefined=未加载, null=加载失败, string=缓存值） */
let _coverFontBase64: string | null | undefined = undefined;

/** @description 交替版式列表 */
const ALTERNATING_LAYOUTS: ImageGroupLayout[] = [
  'portrait-cover-2inner-collage',
  'collage-cover-2portrait-inner',
];

/**
 * @description Canvas 图片组生成服务
 * 负责根据文章 Tag 从图库匹配配图，按固定版式组合成 ImageGroup，异步写入 Canvas。
 * @keywords-cn image-group, canvas, gallery, layout, collage, tag-match
 * @keywords-en canvas image group generation service
 */
@Injectable()
export class CanvasImageGroupService {
  private readonly logger = new Logger(CanvasImageGroupService.name);
  constructor(
    private readonly gallery: GalleryService,
    private readonly agentService: AgentService,
  ) {}

  /**
   * @description 生成所有图片组（供 CanvasService 后台异步调用）。
   * 先收集全部 tag，一次性拿足图片池（无重复），再按版式分配。
   * @param {CanvasImageGroupCreateInput} input - 创建入参
   * @returns {Promise<CanvasImageGroup[]>} 生成的图片组列表
   * @keyword-en generate image groups from article tags
   */
  async generateImageGroups(
    input: CanvasImageGroupCreateInput,
  ): Promise<CanvasImageGroup[]> {
    const articles = input.articles ?? [];
    if (articles.length === 0) return [];

    // --- 1. 收集全部 tag ---
    const allTags: string[] = [];
    const tagSet = new Set<string>();
    for (const art of articles) {
      for (const t of art.tags ?? []) {
        const normalized = t.trim();
        if (normalized && !tagSet.has(normalized)) {
          tagSet.add(normalized);
          allTags.push(normalized);
        }
      }
    }

    // --- 2. 一次性获取足量图片池（portrait + collage 分别拿） ---
    const [regularPool, rawCollagePool] = await Promise.all([
      this.fetchImagePool(input, allTags, 'regular'),
      this.fetchImagePool(input, allTags, 'collage'),
    ]);
    // 拼图池仅保留真正 isCollage=true 且不带封面标签的图片（排除封面拼图 + 普通封面图）
    const collagePool = rawCollagePool.filter(
      (img) => img.isCollage === true && !this.hasCoverTag(img),
    );
    this.logger.debug(`[image-group] pool_ready regularPool=${regularPool.length} collagePool=${collagePool.length}(raw=${rawCollagePool.length}) tags=${allTags.length}`);

    // --- 3. 批量 LLM 生成封面文案（异步，失败则退回标题截短） ---
    const coverTexts = await this.generateCoverTexts(input.topic, articles);

    // 全局去重集合
    const usedInnerCollageIds = new Set<number>();
    const usedPortraitIds = new Set<number>();

    // --- 4. 按文章分配图片组 ---
    const groups: CanvasImageGroup[] = [];
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const layout =
        art.layout ?? ALTERNATING_LAYOUTS[i % ALTERNATING_LAYOUTS.length];
      const spec = LAYOUT_SPECS[layout];

      const localUsedIds = new Set<number>();
      const groupImages: CanvasGroupImage[] = [];
      let ok = true;

      // 封面
      const coverImg = this.pickImage(spec.cover, regularPool, collagePool, localUsedIds, usedInnerCollageIds, usedPortraitIds, false);
      if (coverImg) {
        const alreadyDesigned = this.hasCoverTag(coverImg);
        const coverText = coverTexts[i] ?? this.buildCoverText(art.title, i);
        // 原图已有封面tag → 自带文字设计，跳过文字合成
        const burnedUrl = alreadyDesigned ? null : await this.burnCoverText(coverImg, coverText);
        const finalImg = burnedUrl ? { ...coverImg, url: burnedUrl, thumbUrl: burnedUrl } : coverImg;
        groupImages.push(this.toGroupImage(finalImg, 'cover', alreadyDesigned ? undefined : coverText));
        localUsedIds.add(coverImg.id);
        if (spec.cover === 'portrait') usedPortraitIds.add(coverImg.id);
      } else {
        ok = false;
      }

      // 内页
      const roles = ['inner-1', 'inner-2'] as const;
      for (let r = 0; r < spec.inner.length; r++) {
        const innerImg = this.pickImage(spec.inner[r], regularPool, collagePool, localUsedIds, usedInnerCollageIds, usedPortraitIds, true);
        if (innerImg) {
          groupImages.push(this.toGroupImage(innerImg, roles[r]));
          localUsedIds.add(innerImg.id);
          if (spec.inner[r] === 'collage') {
            usedInnerCollageIds.add(innerImg.id);
          } else {
            usedPortraitIds.add(innerImg.id);
          }
        } else {
          ok = false;
        }
      }

      groups.push({
        id: i + 1,
        articleId: art.title ? undefined : undefined,
        articleTitle: art.title,
        layout,
        images: groupImages,
        status: ok && groupImages.length >= 2 ? 'done' : 'failed',
      });
      this.logger.debug(`[image-group] group_assigned idx=${i} layout=${layout} imageCount=${groupImages.length} status=${ok && groupImages.length >= 2 ? 'done' : 'failed'}`);
    }

    return groups;
  }

  /**
   * @description 从图库拉取图片池（优先 tag 匹配，不足则补随机）
   * @param {CanvasImageGroupCreateInput} input - 基础作用域
   * @param {string[]} tags - 标签列表
   * @param {'regular'|'collage'} imageType - 图片类型
   * @returns {Promise<GalleryImageEntity[]>} 图片列表（唯一）
   * @keyword-en fetch image pool by tags
   */
  private async fetchImagePool(
    input: Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>,
    tags: string[],
    imageType: 'regular' | 'collage',
  ): Promise<GalleryImageEntity[]> {
    const wantCount = 60;
    let images: GalleryImageEntity[] = [];

    if (tags.length > 0) {
      images = await this.gallery.searchByTags({
        userId: input.userId,
        tenantId: input.tenantId,
        tags,
        limit: wantCount,
        imageType,
      });
    }

    // 去重
    const deduped = this.dedup(images);
    if (deduped.length >= wantCount) return deduped;

    // 不足时补随机
    const more = await this.gallery.findAccessibleImages(
      input.userId,
      input.tenantId,
      { imageType, limit: wantCount },
    );
    const merged = this.dedup([...deduped, ...more]);
    return merged;
  }

  /**
   * @description 判断图片是否带有封面标签（已预设计封面，自带文字设计，无需再合成文字）
   * @param {GalleryImageEntity} img - 图库实体
   * @returns {boolean}
   * @keyword-en check if image has cover tag
   */
  private hasCoverTag(img: GalleryImageEntity): boolean {
    return (img.tags ?? []).some((t) => COVER_TAG_SET.has(t));
  }

  /**
   * @description 批量生成封面文案：优先 LLM 生成，失败则退回标题截短
   * @param {string | undefined} topic - 主题
   * @param {Array<{ title: string; tags: string[] }>} articles - 文章列表
   * @returns {Promise<string[]>} 每篇文章对应的封面文案
   * @keyword-en batch generate cover texts via LLM with fallback
   */
  private async generateCoverTexts(
    topic: string | undefined,
    articles: Array<{ title: string; tags: string[] }>,
  ): Promise<string[]> {
    const fallback = articles.map((a, i) => this.buildCoverText(a.title, i));
    try {
      const llm = await this.agentService.buildLLM({ nonStreaming: true, temperature: 0.8 });
      const titlesBlock = articles
        .map((a, i) => `${i + 1}. ${a.title}`)
        .join('\n');
      const topicCtx = topic ? `\u4e3b\u9898\uff1a${topic}\n` : '';
      const prompt = [
        '\u4f60\u662f\u4e00\u540d\u5c0f\u7ea2\u4e66\u5c01\u9762\u6587\u6848\u4e13\u5bb6\u3002\u6839\u636e\u4ee5\u4e0b\u6587\u7ae0\u6807\u9898\u5217\u8868\uff0c\u4e3a\u6bcf\u7bc7\u6587\u7ae0\u751f\u6210\u4e00\u4e2a\u7b80\u77ed\u5438\u5f15\u773c\u7403\u7684\u5c01\u9762\u6587\u6848\u3002',
        '\u8981\u6c42\uff1a',
        '- \u6bcf\u6761\u6587\u6848\u4e0d\u8d85\u8fc7 12 \u4e2a\u6c49\u5b57',
        '- \u7b80\u6d01\u6709\u529b\u3001\u5438\u5f15\u70b9\u51fb',
        '- \u6bcf\u6761\u552f\u4e00\u4e0d\u91cd\u590d',
        '- \u4e0d\u8981\u52a0\u5f15\u53f7\u3001\u5e8f\u53f7\u6216\u591a\u4f59\u6807\u70b9',
        '',
        topicCtx,
        '\u6587\u7ae0\u6807\u9898\u5217\u8868\uff1a',
        titlesBlock,
        '',
        `\u8bf7\u4e25\u683c\u7528 JSON \u6570\u7ec4\u683c\u5f0f\u56de\u590d\uff0c\u6570\u91cf\u7b49\u4e8e ${articles.length}\u3002\u793a\u4f8b\uff1a["\u6587\u68481","\u6587\u68482"]`,
      ].join('\n');
      const res = await llm.invoke(prompt);
      const raw = typeof res.content === 'string' ? res.content : String(res.content ?? '');
      const jsonMatch = raw.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) return fallback;
      const arr = JSON.parse(jsonMatch[0]) as unknown[];
      if (!Array.isArray(arr) || arr.length !== articles.length) return fallback;
      return arr.map((v, i) => {
        const s = String(v ?? '').trim();
        return s.length > 0 && s.length <= 20 ? s : fallback[i];
      });
    } catch (err) {
      this.logger.warn(`[image-group] LLM cover text failed, using fallback: ${err}`);
      return fallback;
    }
  }

  /**
   * @description 将文章标题截短为适合封面展示的文案（LLM 失败时的兜底方案）
   * @param {string} title - 文章标题
   * @param {number} index - 图组序号
   * @returns {string} 封面文案
   * @keyword-en build cover text from article title
   */
  private buildCoverText(title: string | undefined, index: number): string {
    if (!title) return `第 ${index + 1} 篇`;
    return title.length <= 16 ? title : title.slice(0, 14) + '…';
  }

  /**
   * @description 将图片 URL 解析为本地绝对路径（仅限 /static/uploads/... 本地图）
   * @param {GalleryImageEntity} img - 图库实体
   * @returns {string | undefined} 本地绝对路径
   * @keyword-en resolve local absolute path from gallery image
   */
  private resolveLocalPath(img: GalleryImageEntity): string | undefined {
    if (img.absPath) return img.absPath;
    const url = String(img.url ?? '').trim();
    if (!url || /^https?:\/\//i.test(url)) return undefined;
    if (url.startsWith('/static/uploads/')) {
      return join(process.cwd(), 'public', 'uploads', url.slice('/static/uploads/'.length));
    }
    return undefined;
  }

  /**
   * @description 转义 SVG 文本中的特殊字符
   * @param {string} s - 原始文本
   * @returns {string} 转义后文本
   * @keyword-en escape svg text special characters
   */
  private escapeSvgText(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * @description 使用 sharp + SVG 将文字烧录到封面图片（风格对齐图文发布封面）。
   * 图片会被 resize 到 640x853，居中黑色半透明遮罩 + 白色加粗文字，支持多行。
   * @param {GalleryImageEntity} img - 封面图库实体
   * @param {string} text - 要烧录的文案
   * @returns {Promise<string | null>} 新图片 URL 或 null
   * @keyword-en burn cover text onto image using sharp svg composite
   */
  private async burnCoverText(
    img: GalleryImageEntity,
    text: string,
  ): Promise<string | null> {
    const srcPath = this.resolveLocalPath(img);
    if (!srcPath || !existsSync(srcPath)) {
      this.logger.warn(`[image-group] burnCoverText skip: no local file for imgId=${img.id}`);
      return null;
    }
    try {
      const mod = (await import('sharp')) as unknown as {
        default: (
          src: string,
        ) => {
          resize: (w: number, h: number, opts?: Record<string, unknown>) => unknown;
          composite: (layers: Array<{ input: Buffer; top?: number; left?: number }>) => unknown;
          jpeg: (opts?: Record<string, unknown>) => unknown;
          toFile: (p: string) => Promise<unknown>;
        };
      };
      const sharpFn = mod?.default;
      if (typeof sharpFn !== 'function') return null;

      const outDir = join(process.cwd(), 'public', 'uploads', 'canvas-covers');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const outName = `cover-${randomUUID()}.jpg`;
      const outPath = join(outDir, outName);

      const fontFaceCss = await this.loadCoverFontFaceCss();
      const rawText = text.trim() || '\u5c01\u9762';
      const lines = rawText.match(/.{1,12}/g) ?? [rawText];
      const renderLines = lines.slice(0, 2);
      const multi = renderLines.length > 1;
      const fontSize = multi ? 30 : 34;
      const boxHeight = multi ? 92 : 58;
      const boxWidth = 380;
      const boxX = Math.floor((COLLAGE_WIDTH - boxWidth) / 2);
      const boxY = Math.floor((COLLAGE_HEIGHT - boxHeight) / 2);
      const tspans = renderLines
        .map(
          (line, idx) =>
            `<tspan x="50%" dy="${idx === 0 ? 0 : 1.25}em">${this.escapeSvgText(line)}</tspan>`,
        )
        .join('');

      const svg = `
<svg width="${COLLAGE_WIDTH}" height="${COLLAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    ${fontFaceCss}
    .mask{fill:#000000;opacity:.78;}
    .t{fill:#ffffff;font-size:${fontSize}px;font-weight:800;font-family:'ProjectCoverCJK','Noto Sans CJK SC','WenQuanYi Micro Hei','Source Han Sans SC','Microsoft YaHei','PingFang SC','SimHei',Arial,Helvetica,sans-serif;letter-spacing:1px;}
  </style>
  <rect x="${boxX}" y="${boxY}" rx="8" ry="8" width="${boxWidth}" height="${boxHeight}" class="mask"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="t">${tspans}</text>
</svg>`;

      await (sharpFn(srcPath) as unknown as {
        resize: (w: number, h: number, opts?: Record<string, unknown>) => {
          composite: (layers: Array<{ input: Buffer; top?: number; left?: number }>) => {
            jpeg: (opts?: Record<string, unknown>) => { toFile: (path: string) => Promise<unknown> };
          };
        };
      })
        .resize(COLLAGE_WIDTH, COLLAGE_HEIGHT, { fit: 'cover' })
        .composite([{ input: Buffer.from(svg, 'utf8'), top: 0, left: 0 }])
        .jpeg({ quality: 92 })
        .toFile(outPath);

      return `/static/uploads/canvas-covers/${outName}`;
    } catch (err) {
      this.logger.warn(`[image-group] burnCoverText error imgId=${img.id}: ${err}`);
      return null;
    }
  }

  /**
   * @description 加载封面字体的 @font-face CSS（缓存，字体不存在时返回空串降级为系统字体）
   * @returns {Promise<string>} @font-face CSS 或空串
   * @keyword-en load cover font face css with base64 cache
   */
  private async loadCoverFontFaceCss(): Promise<string> {
    if (_coverFontBase64 === undefined) {
      const candidates = [
        join(process.cwd(), 'public', 'fonts', 'cover-cjk.ttf'),
        join(process.cwd(), 'dist', 'public', 'fonts', 'cover-cjk.ttf'),
      ];
      _coverFontBase64 = null;
      for (const p of candidates) {
        try {
          const buf = await readFile(p);
          _coverFontBase64 = Buffer.from(buf).toString('base64');
          break;
        } catch { /* skip */ }
      }
    }
    if (!_coverFontBase64) return '';
    return `@font-face{font-family:'ProjectCoverCJK';src:url(data:font/ttf;base64,${_coverFontBase64}) format('truetype');font-weight:400 900;font-style:normal;}`;
  }

  /**
   * @description 按 imageId 去重图片列表
   * @param {GalleryImageEntity[]} list - 原始列表
   * @returns {GalleryImageEntity[]} 去重后列表
   * @keyword-en deduplicate gallery images by id
   */
  private dedup(list: GalleryImageEntity[]): GalleryImageEntity[] {
    const map = new Map<number, GalleryImageEntity>();
    for (const img of list) {
      if (!map.has(img.id)) map.set(img.id, img);
    }
    return Array.from(map.values());
  }

  /**
   * @description 从对应类型池中选一张图片
   * - portrait：跨图组优先不重复，不足时降级复用；必须为非拼图图
   * - collage：必须 isCollage=true，跨图组优先不重复
   * @param {'portrait'|'collage'} type - 需要的图片类型
   * @param {GalleryImageEntity[]} regularPool - 普通图库
   * @param {GalleryImageEntity[]} collagePool - 拼图库（已过滤为 isCollage=true）
   * @param {Set<number>} localUsedIds - 组内已使用 id
   * @param {Set<number>} globalCollageIds - 全局内页拼图已用 id
   * @param {Set<number>} globalPortraitIds - 全局竖图已用 id
   * @param {boolean} isInner - 是否为内页位
   * @returns {GalleryImageEntity | null}
   * @keyword-en pick one image with local+global dedup and type enforcement
   */
  private pickImage(
    type: 'portrait' | 'collage',
    regularPool: GalleryImageEntity[],
    collagePool: GalleryImageEntity[],
    localUsedIds: Set<number>,
    globalCollageIds: Set<number>,
    globalPortraitIds: Set<number>,
    isInner = false,
  ): GalleryImageEntity | null {
    const notCover = (img: GalleryImageEntity): boolean =>
      !isInner || !this.hasCoverTag(img);

    if (type === 'collage') {
      // 仅选 isCollage=true 的真拼图
      const valid = (img: GalleryImageEntity) =>
        img.isCollage === true && !localUsedIds.has(img.id) && notCover(img);
      // 优先：跨图组不重复
      const ideal = collagePool.find((img) => valid(img) && !globalCollageIds.has(img.id));
      if (ideal) return ideal;
      // 降级：允许跨图组复用
      return collagePool.find((img) => valid(img)) ?? null;
    }
    // portrait：必须是非拼图图 (isCollage !== true)
    const notLocal = (img: GalleryImageEntity) =>
      !localUsedIds.has(img.id) && notCover(img) && img.isCollage !== true;
    // 1. 竖图 + 跨组不重复
    const p1 = regularPool.find(
      (img) => notLocal(img) && img.isPortrait === true && !globalPortraitIds.has(img.id),
    );
    if (p1) return p1;
    // 2. 任意非拼图 + 跨组不重复
    const p2 = regularPool.find(
      (img) => notLocal(img) && !globalPortraitIds.has(img.id),
    );
    if (p2) return p2;
    // 3. 降级：竖图允许跨组复用
    const p3 = regularPool.find(
      (img) => notLocal(img) && img.isPortrait === true,
    );
    if (p3) return p3;
    // 4. 最终兜底
    return regularPool.find((img) => notLocal(img)) ?? null;
  }

  /**
   * @description 将图库图片实体转换为 CanvasGroupImage
   * @param {GalleryImageEntity} img - 图库实体
   * @param {'cover'|'inner-1'|'inner-2'} role - 版式角色
   * @param {string} [text] - 封面文字叠加文案（仅封面图传入）
   * @returns {CanvasGroupImage} 图片组图片
   * @keyword-en map gallery image to canvas group image
   */
  private toGroupImage(
    img: GalleryImageEntity,
    role: CanvasGroupImage['role'],
    text?: string,
  ): CanvasGroupImage {
    return {
      imageId: img.id,
      url: img.url,
      thumbUrl: img.thumbUrl,
      isCollage: img.isCollage === true,
      isPortrait: img.isPortrait,
      tags: Array.isArray(img.tags) ? img.tags : [],
      role,
      ...(text ? { text } : {}),
    };
  }
}
