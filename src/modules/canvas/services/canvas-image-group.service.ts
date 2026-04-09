import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, mkdir, access, copyFile, writeFile } from 'node:fs/promises';
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

/** @description 两种固定版式的需求规格（每组 6 张：1 封面 + 5 内页） */
const LAYOUT_SPECS: Record<
  ImageGroupLayout,
  { cover: 'portrait' | 'collage'; inner: ('collage' | 'portrait')[] }
> = {
  'portrait-cover-5inner': {
    cover: 'portrait',
    inner: ['collage', 'portrait', 'collage', 'portrait', 'collage'],
  },
  'collage-cover-5inner': {
    cover: 'collage',
    inner: ['portrait', 'portrait', 'collage', 'portrait', 'portrait'],
  },
};

/** @description 内页不允许使用的封面标签集合（系统写入的精确封面标记） */
const COVER_TAG_SET = new Set(['\u5c01\u9762', '\u62fc\u56fe\u5c01\u9762', '\u81ea\u52a8\u5c01\u9762', 'canvas\u5c01\u9762']);

/** @description 拼图标准尺寸 */
const COLLAGE_WIDTH = 640;
const COLLAGE_HEIGHT = 853;

/** @description 模块级封面字体 base64 缓存（undefined=未加载, null=加载失败, string=缓存值） */
let _coverFontBase64: string | null | undefined = undefined;
/** @description 模块级封面字体已解析的绝对路径缓存 */
let _coverFontPath: string | null | undefined = undefined;

/** @description 交替版式列表 */
const ALTERNATING_LAYOUTS: ImageGroupLayout[] = [
  'portrait-cover-5inner',
  'collage-cover-5inner',
];

/**
 * @description Canvas 图片组生成服务
 * 负责根据文章 Tag 从图库匹配配图，按固定版式组合成 ImageGroup，异步写入 Canvas。
 * 拼图采用动态合成：从 regularPool 中选 2 张横图实时合成。
 * @keywords-cn image-group, canvas, gallery, layout, collage, tag-match
 * @keywords-en canvas image group generation service
 */
@Injectable()
export class CanvasImageGroupService {
  private readonly logger = new Logger(CanvasImageGroupService.name);
  /** @description 进程级 fontconfig 是否已写入（Linux/Alpine 兼容） */
  private fontconfigSetupDone = false;
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

    // --- 2. 一次性获取足量图片池（统一池，排除封面图） ---
    // 每组需要最多 6 张图（1封面+5内页），每组需要 3 个拼图（各需 2 张横图）
    // 所以横图需求最大 = articles * 3 * 2 = articles * 6
    // 竖图需求最大 = articles * 6
    // 估算需要图片数 = articles * 12 + 20 张冗余
    const poolSize = Math.max(80, articles.length * 12 + 20);
    let pool = await this.fetchImagePool(input, allTags, poolSize, 'regular');
    // 对图片池进行随机打乱，避免封面和内页出现顺序性重复
    this.shuffleArray(pool);
    this.logger.debug(`[image-group] pool_ready pool=${pool.length} tags=${allTags.length}`);

    // --- 3. 批量 LLM 生成封面文案（异步，失败则退回标题截短） ---
    const coverTexts = await this.generateCoverTexts(input.topic, articles);

    // 全局已使用图片 ID 集合（跨图组去重）
    const globalUsedIds = new Set<number>();
    // 全局已使用横图 ID 集合（拼图去重：避免同一张横图用于多个拼图）
    const globalUsedPortraitIds = new Set<number>();
    // 全局已使用竖图 ID 集合（避免同一张竖图用于多个位置）
    const globalUsedLandscapeIds = new Set<number>();

    // --- 4. 按文章分配图片组 ---
    const groups: CanvasImageGroup[] = [];
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const layout =
        art.layout ?? ALTERNATING_LAYOUTS[i % ALTERNATING_LAYOUTS.length];
      const spec = LAYOUT_SPECS[layout];

      // 当前图组内已使用图片 ID（组内去重）
      const localUsedIds = new Set<number>();
      const groupImages: CanvasGroupImage[] = [];
      let ok = true;

      // 封面
      let coverResult: { img: GalleryImageEntity; text?: { title: string; subtitle: string } } | null = null;
      if (spec.cover === 'collage') {
        // 动态拼图封面：选 2 张横图合成
        const collageResult = await this.pickAndMakeCollage(pool, localUsedIds, globalUsedIds, globalUsedLandscapeIds, input);
        if (collageResult) {
          const coverText = coverTexts[i] ?? this.buildCoverText(art.title, i);
          const burnedUrl = await this.burnCollageCoverText({ imgA: collageResult.imgA, imgB: collageResult.imgB }, coverText);
          const finalUrl = burnedUrl ?? collageResult.collageUrl;
          coverResult = {
            img: { ...collageResult.image, url: finalUrl, thumbUrl: finalUrl },
            text: coverText,
          };
          // 拼图来源图加入全局去重
          for (const sid of collageResult.sourceIds) {
            localUsedIds.add(sid);
            globalUsedIds.add(sid);
            globalUsedLandscapeIds.add(sid);
          }
        }
      } else {
        // 单竖图封面
        const coverImg = this.pickPortrait(pool, localUsedIds, globalUsedIds, globalUsedPortraitIds);
        if (coverImg) {
          const alreadyDesigned = this.hasCoverTag(coverImg);
          const coverText = coverTexts[i] ?? this.buildCoverText(art.title, i);
          // 原图已有封面tag → 自带文字设计，跳过文字合成
          const burnedUrl = alreadyDesigned ? null : await this.burnCoverText(coverImg, coverText);
          const finalImg = burnedUrl ? { ...coverImg, url: burnedUrl, thumbUrl: burnedUrl } : coverImg;
          coverResult = {
            img: finalImg,
            text: alreadyDesigned ? undefined : coverText,
          };
          localUsedIds.add(coverImg.id);
          globalUsedIds.add(coverImg.id);
          globalUsedPortraitIds.add(coverImg.id);
        }
      }
      if (coverResult) {
        groupImages.push(this.toGroupImage(coverResult.img, 'cover', coverResult.text));
      } else {
        ok = false;
      }

      // 内页
      const roleTypes: Array<'cover' | 'inner-1' | 'inner-2' | 'inner-3' | 'inner-4' | 'inner-5'> = ['inner-1', 'inner-2', 'inner-3', 'inner-4', 'inner-5'];
      for (let r = 0; r < spec.inner.length; r++) {
        const role = spec.inner[r];
        if (role === 'collage') {
          // 动态合成拼图：选 2 张横图合成
          const collageResult = await this.pickAndMakeCollage(pool, localUsedIds, globalUsedIds, globalUsedLandscapeIds, input);
          if (collageResult) {
            groupImages.push(this.toGroupImage(collageResult.image, roleTypes[r]));
            // 合成图本身 ID=0 不加入任何集合，但要把来源图 ID 加入组内和全局去重集合
            for (const sid of collageResult.sourceIds) {
              localUsedIds.add(sid);
              globalUsedIds.add(sid);
              globalUsedLandscapeIds.add(sid);
            }
          } else {
            ok = false;
          }
        } else {
          // portrait：选竖图
          const portraitImg = this.pickPortrait(pool, localUsedIds, globalUsedIds, globalUsedPortraitIds);
          if (portraitImg) {
            groupImages.push(this.toGroupImage(portraitImg, roleTypes[r]));
            localUsedIds.add(portraitImg.id);
            globalUsedIds.add(portraitImg.id);
            globalUsedPortraitIds.add(portraitImg.id);
          } else {
            ok = false;
          }
        }
      }

      groups.push({
        id: i + 1,
        articleId: art.title ? undefined : undefined,
        articleTitle: art.title,
        layout,
        images: groupImages,
        status: ok ? 'done' : 'failed',
      });
      this.logger.debug(`[image-group] group_assigned idx=${i} layout=${layout} imageCount=${groupImages.length} status=${ok && groupImages.length >= 2 ? 'done' : 'failed'}`);
    }

    return groups;
  }

  /**
   * @description 选 2 张横图并动态合成拼图（优先横图，不够时从图库补充随机横图）
   * @param {GalleryImageEntity[]} pool - 图片池
   * @param {Set<number>} localUsedIds - 组内已使用 ID
   * @param {Set<number>} globalUsedIds - 全局已使用 ID
   * @param {Set<number>} globalLandscapeIds - 全局已使用横图 ID
   * @param {Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>} input - 用户信息
   * @returns {Promise<{ image: GalleryImageEntity; sourceIds: number[]; imgA: GalleryImageEntity; imgB: GalleryImageEntity; collageUrl: string } | null>}
   * @keyword-en pick two landscape images and make collage
   */
  private async pickAndMakeCollage(
    pool: GalleryImageEntity[],
    localUsedIds: Set<number>,
    globalUsedIds: Set<number>,
    globalLandscapeIds: Set<number>,
    userInput: Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>,
  ): Promise<{ image: GalleryImageEntity; sourceIds: number[]; imgA: GalleryImageEntity; imgB: GalleryImageEntity; collageUrl: string } | null> {
    // 优先：从横图中选 2 张都未在全局使用过的
    const landscapeAvailable = pool.filter(
      (img) =>
        !localUsedIds.has(img.id) &&
        !globalUsedIds.has(img.id) &&
        img.isPortrait !== true,
    );
    let pickA: GalleryImageEntity | null = null;
    let pickB: GalleryImageEntity | null = null;
    // 优先1：两张横图都未使用
    for (let i = 0; i < landscapeAvailable.length; i++) {
      for (let j = i + 1; j < landscapeAvailable.length; j++) {
        const a = landscapeAvailable[i];
        const b = landscapeAvailable[j];
        if (!globalLandscapeIds.has(a.id) && !globalLandscapeIds.has(b.id)) {
          pickA = a; pickB = b; break;
        }
      }
      if (pickA) break;
    }
    // 优先2：降级——允许一张已使用
    if (!pickA) {
      for (let i = 0; i < landscapeAvailable.length; i++) {
        for (let j = i + 1; j < landscapeAvailable.length; j++) {
          const a = landscapeAvailable[i];
          const b = landscapeAvailable[j];
          const aUsed = globalLandscapeIds.has(a.id);
          const bUsed = globalLandscapeIds.has(b.id);
          if (aUsed && !bUsed) { pickA = b; pickB = a; break; }
          if (!aUsed && bUsed) { pickA = a; pickB = b; break; }
        }
        if (pickA) break;
      }
    }
    // 降级3：横图不够时，从图库补充随机横图（不能是拼图或封面）
    if (!pickA) {
      try {
        // 从图库获取随机图片，在内存中过滤横图
        const randomImages = await this.gallery.sampleRandom({
          userId: userInput.userId,
          tenantId: userInput.tenantId,
          limit: 20,
        });
        const randomLandscape = randomImages.filter(
          (img) =>
            !localUsedIds.has(img.id) &&
            !globalUsedIds.has(img.id) &&
            img.isPortrait !== true,
        );
        if (randomLandscape.length >= 2) {
          pickA = randomLandscape[0];
          pickB = randomLandscape[1];
        } else if (randomLandscape.length === 1) {
          // 只有 1 张随机横图，再从池子里找 1 张
          const remaining = landscapeAvailable.filter(
            (img) => !localUsedIds.has(img.id) && !globalUsedIds.has(img.id),
          );
          if (remaining.length > 0) {
            pickA = remaining[0];
            pickB = randomLandscape[0];
          }
        }
      } catch (err) {
        this.logger.warn(`[image-group] failed to fetch random landscape images: ${err}`);
      }
    }
    if (!pickA || !pickB) {
      this.logger.warn(`[image-group] not enough landscape images for collage`);
      return null;
    }

    const sourceIds = [pickA!.id, pickB!.id];
    // 动态合成拼图
    const collageUrl = await this.createDynamicCollageFile(pickA!, pickB!);
    if (!collageUrl) {
      this.logger.warn(`[image-group] collage synthesis failed`);
      return null;
    }
    // 构造一个合成图的虚拟 entity（isCollage=true，collageSourceImageIds 记录来源）
    const collageImage = {
      id: 0, // 临时 ID，实际不会用
      url: collageUrl,
      thumbUrl: collageUrl,
      isCollage: true,
      isPortrait: false,
      collageSourceImageIds: sourceIds,
      tags: [],
    } as unknown as GalleryImageEntity;
    return { image: collageImage, sourceIds, imgA: pickA!, imgB: pickB!, collageUrl };
  }

  /**
   * @description 为拼图封面烧录主副标题（使用 sharp + SVG）
   * @param {{ imgA: GalleryImageEntity; imgB: GalleryImageEntity }} sources - 拼图源图片
   * @param {{ title: string; subtitle: string }} coverText - 主副标题
   * @returns {Promise<string | null>} 烧录后图片 URL 或 null
   * @keyword-en burn text onto collage cover
   */
  private async burnCollageCoverText(
    sources: { imgA: GalleryImageEntity; imgB: GalleryImageEntity },
    coverText: { title: string; subtitle: string },
  ): Promise<string | null> {
    const { imgA, imgB } = sources;
    const pathA = this.resolveLocalPath(imgA);
    const pathB = this.resolveLocalPath(imgB);
    if (!pathA || !pathB) {
      this.logger.warn(`[image-group] burnCollageCoverText skip: no local path resolved imgA=${imgA.id} imgB=${imgB.id}`);
      return null;
    }
    if (!existsSync(pathA)) {
      this.logger.warn(`[image-group] burnCollageCoverText skip: file not exist imgA=${imgA.id} pathA=${pathA}`);
      return null;
    }
    if (!existsSync(pathB)) {
      this.logger.warn(`[image-group] burnCollageCoverText skip: file not exist imgB=${imgB.id} pathB=${pathB}`);
      return null;
    }
    try {
      const fontFaceCss = await this.loadCoverFontFaceCss();
      if (_coverFontPath) await this.ensureFontconfigSetup(_coverFontPath);
      const sharp = await this.loadSharp();
      if (!sharp) return null;

      const outDir = join(process.cwd(), 'public', 'uploads', 'canvas-covers');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const outName = `collage-cover-${randomUUID()}.jpg`;
      const outPath = join(outDir, outName);

      const safeTitle = coverText.title.trim() || '封面';
      const safeSubtitle = coverText.subtitle.trim();

      // 计算文本视觉宽度
      const visualWidth = (s: string): number =>
        [...String(s)].reduce((n, c) => n + (/[\u3400-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0);

      // 按视觉宽度拆行
      const splitLines = (s: string, maxUnits: number): string[] => {
        const lines: string[] = [];
        let cur = '';
        let curUnits = 0;
        for (const ch of s) {
          const w = /[\u3400-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
          if (curUnits + w > maxUnits && cur.length > 0) { lines.push(cur); cur = ch; curUnits = w; }
          else { cur += ch; curUnits += w; }
        }
        if (cur.length > 0) lines.push(cur);
        return lines;
      };

      const topH = Math.floor(COLLAGE_HEIGHT / 2);
      const bottomH = COLLAGE_HEIGHT - topH;

      // 上图：等比缩到 topH 高度，不裁剪
      const bufA = await sharp(pathA).resize({ width: COLLAGE_WIDTH, height: topH }).toBuffer();
      // 下图：等比缩到 bottomH 高度，不裁剪
      const bufB = await sharp(pathB).resize({ width: COLLAGE_WIDTH, height: bottomH }).toBuffer();

      // 计算字体大小
      const titleFontSize = Math.max(34, Math.min(60, Math.floor(900 / Math.max(10, visualWidth(safeTitle)))));
      const subtitleFontSize = safeSubtitle
        ? Math.max(22, Math.min(34, Math.floor(760 / Math.max(12, visualWidth(safeSubtitle)))))
        : 28;

      // 标题最多 30 个视觉字（字体大小已自适应，不强制截断）
      const titleLines = splitLines(safeTitle, 30);
      // 副标题最多 30 个视觉字
      const subtitleLines = safeSubtitle ? splitLines(safeSubtitle, 30) : [];

      // 文案围绕两图拼接中线（50%）上下居中
      const titleStartY = safeSubtitle
        ? Math.max(40, 46 - (Math.max(1, titleLines.length) - 1) * 1.8)
        : 50;
      const subtitleStartY = safeSubtitle
        ? Math.min(60, 54 + (Math.max(1, subtitleLines.length) - 1) * 1.2)
        : 58;
      // 中线遮挡带：弱化拼接缝并提升文字可读性
      const seamMaskHeight = safeSubtitle
        ? Math.min(
          280,
          Math.max(
            150,
            titleFontSize * Math.max(1, titleLines.length) +
            subtitleFontSize * Math.max(1, subtitleLines.length) +
            56,
          ),
        )
        : Math.min(220, Math.max(110, titleFontSize * Math.max(1, titleLines.length) + 48));
      const seamMaskY = Math.floor((COLLAGE_HEIGHT - seamMaskHeight) / 2);

      const titleTspans = (titleLines.length > 0 ? titleLines : [''])
        .map((line, idx) => `<tspan x="50%" dy="${idx === 0 ? 0 : 1.15}em">${this.escapeSvgText(line)}</tspan>`)
        .join('');
      const subtitleTspans = subtitleLines
        .map((line, idx) => `<tspan x="50%" dy="${idx === 0 ? 0 : 1.2}em">${this.escapeSvgText(line)}</tspan>`)
        .join('');

      const fontFamily = `'ProjectCoverCJK','Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Source Han Sans SC','SimHei',Arial,Helvetica,sans-serif`;
      const svgText = `
<svg width="${COLLAGE_WIDTH}" height="${COLLAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="seamMask" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="20%" stop-color="#000000" stop-opacity="0.22"/>
      <stop offset="50%" stop-color="#000000" stop-opacity="0.36"/>
      <stop offset="80%" stop-color="#000000" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <style>
    ${fontFaceCss}
    .t{fill:#ffffff;font-size:${titleFontSize}px;font-weight:900;font-family:${fontFamily};paint-order:stroke;stroke:#000000;stroke-width:8px;}
    .s{fill:#ffffff;font-size:${subtitleFontSize}px;font-weight:700;font-family:${fontFamily};paint-order:stroke;stroke:#000000;stroke-width:5px;}
  </style>
  <rect x="0" y="${seamMaskY}" width="${COLLAGE_WIDTH}" height="${seamMaskHeight}" fill="url(#seamMask)"/>
  <text x="50%" y="${titleStartY}%" text-anchor="middle" dominant-baseline="middle" class="t">${titleTspans}</text>
  ${safeSubtitle ? `<text x="50%" y="${subtitleStartY}%" text-anchor="middle" dominant-baseline="middle" class="s">${subtitleTspans}</text>` : ''}
</svg>`;

      // 先创建拼图底图（复用顶部已导入的 sharp）
      const collageBuf = await sharp(pathA)
        .resize({ width: COLLAGE_WIDTH, height: COLLAGE_HEIGHT })
        .composite([
          { input: bufA, top: 0, left: 0 },
          { input: bufB, top: topH, left: 0 },
        ])
        .toBuffer();

      // 再烧录文字
      await sharp(collageBuf)
        .composite([{ input: Buffer.from(svgText, 'utf8'), top: 0, left: 0 }])
        .jpeg({ quality: 92 })
        .toFile(outPath);

      return `/static/uploads/canvas-covers/${outName}`;
    } catch (err) {
      this.logger.warn(`[image-group] burnCollageCoverText error: ${err}`);
      return null;
    }
  }

  /**
   * @description 选一张竖图（优先未使用的）
   * @param {GalleryImageEntity[]} pool - 图片池
   * @param {Set<number>} localUsedIds - 组内已使用 ID
   * @param {Set<number>} globalUsedIds - 全局已使用 ID
   * @param {Set<number>} globalPortraitIds - 全局已使用竖图 ID
   * @returns {GalleryImageEntity | null}
   * @keyword-en pick one portrait image
   */
  private pickPortrait(
    pool: GalleryImageEntity[],
    localUsedIds: Set<number>,
    globalUsedIds: Set<number>,
    globalPortraitIds: Set<number>,
  ): GalleryImageEntity | null {
    // 优先：竖图 + 未在全局使用
    const p1 = pool.find(
      (img) =>
        !localUsedIds.has(img.id) &&
        !globalUsedIds.has(img.id) &&
        img.isPortrait === true,
    );
    if (p1) return p1;
    // 降级1：竖图 + 仅未在全局使用
    const p2 = pool.find(
      (img) =>
        !localUsedIds.has(img.id) &&
        img.isPortrait === true,
    );
    if (p2) return p2;
    // 降级2：任意未使用图片
    const p3 = pool.find(
      (img) => !localUsedIds.has(img.id) && !globalUsedIds.has(img.id),
    );
    if (p3) return p3;
    // 最终降级：任意未使用
    return pool.find((img) => !localUsedIds.has(img.id)) ?? null;
  }

  /**
   * @description 从图库拉取图片池（优先 tag 匹配，不足则补随机）
   * @param {Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>} input - 基础作用域
   * @param {string[]} tags - 标签列表
   * @param {number|'regular'|'collage'} wantCountOrType - 要获取的数量或图片类型
   * @param {'regular'|'collage'} [imageType] - 图片类型（当 wantCountOrType 为数字时使用）
   * @returns {Promise<GalleryImageEntity[]>} 图片列表（唯一）
   * @keyword-en fetch image pool by tags
   */
  private async fetchImagePool(
    input: Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>,
    tags: string[],
    wantCountOrType: number | 'regular' | 'collage',
    imageType?: 'regular' | 'collage',
  ): Promise<GalleryImageEntity[]> {
    let wantCount = 60;
    let imgType: 'regular' | 'collage' = 'regular';
    if (typeof wantCountOrType === 'number') {
      wantCount = wantCountOrType;
      imgType = imageType ?? 'regular';
    } else {
      imgType = wantCountOrType;
    }
    let images: GalleryImageEntity[] = [];

    if (tags.length > 0) {
      images = await this.gallery.searchByTags({
        userId: input.userId,
        tenantId: input.tenantId,
        tags,
        limit: wantCount,
        imageType: imgType,
      });
    }

    // 去重
    const deduped = this.dedup(images);
    if (deduped.length >= wantCount) return deduped;

    // 不足时补随机
    const more = await this.gallery.findAccessibleImages(
      input.userId,
      input.tenantId,
      { imageType: imgType, limit: wantCount },
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
   * @description 批量生成封面文案（主标题+副标题）：优先 LLM 生成，失败则退回标题截短
   * @param {string | undefined} topic - 主题
   * @param {Array<{ title: string; tags: string[] }>} articles - 文章列表
   * @returns {Promise<Array<{title: string; subtitle: string}>>} 每篇文章对应的封面主副标题
   * @keyword-en batch generate cover title and subtitle via LLM with fallback
   */
  private async generateCoverTexts(
    topic: string | undefined,
    articles: Array<{ title: string; tags: string[] }>,
  ): Promise<Array<{ title: string; subtitle: string }>> {
    const fallback = articles.map((a, i) => this.buildCoverText(a.title, i));
    try {
      const llm = await this.agentService.buildLLM({ nonStreaming: true, temperature: 0.8 });
      const titlesBlock = articles
        .map((a, i) => `${i + 1}. ${a.title}`)
        .join('\n');
      const topicCtx = topic ? `主题：${topic}\n` : '';
      const prompt = [
        '你是一名小红书封面文案专家。根据以下文章标题列表，为每篇文章生成封面主标题和副标题。',
        '要求：',
        '- 主标题：6-16 个汉字，简洁有力、吸引点击',
        '- 副标题：10-24 个汉字，补充描述或引发兴趣',
        '- 每条唯一不重复，不加引号、序号或多余标点，特别是禁止使用破折号（——或--）和省略号（…或...）',
        '',
        topicCtx,
        '文章标题列表：',
        titlesBlock,
        '',
        `请严格用 JSON 数组格式回复，数量等于 ${articles.length}。示例：[{"title":"主标题1","subtitle":"副标题1"},{"title":"主标题2","subtitle":"副标题2"}]`,
      ].join('\n');
      const res = await llm.invoke(prompt);
      const parseArray = (input: unknown): unknown[] | null => {
        if (Array.isArray(input)) {
          const looksLikeCoverItems = input.every(
            (item) =>
              item &&
              typeof item === 'object' &&
              !Array.isArray(item) &&
              ('title' in item || 'subtitle' in item),
          );
          if (looksLikeCoverItems) return input;
          const stitched = input
            .map((item) => {
              if (typeof item === 'string') return item;
              if (!item || typeof item !== 'object') return '';
              const rec = item as Record<string, unknown>;
              if (typeof rec.text === 'string') return rec.text;
              if (typeof rec.output_text === 'string') return rec.output_text;
              if (typeof rec.content === 'string') return rec.content;
              return '';
            })
            .join('')
            .trim();
          return stitched ? parseArray(stitched) : null;
        }

        if (input && typeof input === 'object') {
          const rec = input as Record<string, unknown>;
          if (Array.isArray(rec.items)) return rec.items;
          if (Array.isArray(rec.data)) return rec.data;
          if (Array.isArray(rec.content)) {
            const parsed = parseArray(rec.content);
            if (parsed) return parsed;
          }
          if (typeof rec.content === 'string') {
            const parsed = parseArray(rec.content);
            if (parsed) return parsed;
          }
          if (typeof rec.text === 'string') {
            const parsed = parseArray(rec.text);
            if (parsed) return parsed;
          }
          return null;
        }

        if (typeof input !== 'string') return null;

        const raw = input.trim();
        if (!raw) return null;

        const parseRawJson = (text: string): unknown[] | null => {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === 'object') {
              const rec = parsed as Record<string, unknown>;
              if (Array.isArray(rec.items)) return rec.items;
              if (Array.isArray(rec.data)) return rec.data;
            }
          } catch {
            void 0;
          }
          return null;
        };

        const direct = parseRawJson(raw);
        if (direct) return direct;

        const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fencedMatch?.[1]) {
          const fencedParsed = parseRawJson(fencedMatch[1].trim());
          if (fencedParsed) return fencedParsed;
        }

        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        if (start >= 0 && end > start) {
          const sliced = parseRawJson(raw.slice(start, end + 1));
          if (sliced) return sliced;
        }
        return null;
      };

      const arr = parseArray(res.content);
      if (!arr || arr.length === 0) return fallback;
      return fallback.map((fb, i) => {
        const v = arr[i];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const item = v as Record<string, unknown>;
          const rawTitle = String(item.title ?? '').trim();
          const rawSubtitle = String(item.subtitle ?? '').trim();
          // 清理破折号、连接号等奇怪符号
          const cleanDash = (s: string): string => s.replace(/[—–−‐‑‒–ー]/g, '');
          const title = cleanDash(rawTitle);
          const subtitle = cleanDash(rawSubtitle);
          return { title: title.length >= 2 ? title : fb.title, subtitle };
        }
        return fb;
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
  private buildCoverText(title: string | undefined, index: number): { title: string; subtitle: string } {
    // 标题：不截断，保持完整
    const safeTitle = title?.trim() || `第 ${index + 1} 篇`;
    // 副标题：使用文章标题的描述性关键词，不从标题中间截取
    const subtitle = '';
    return { title: safeTitle, subtitle };
  }

  /**
   * @description 将图片 URL 解析为本地绝对路径（仅限 /static/uploads/... 本地图）
   * @param {GalleryImageEntity} img - 图库实体
   * @returns {string | undefined} 本地绝对路径
   * @keyword-en resolve local absolute path from gallery image
   */
  private resolveLocalPath(img: GalleryImageEntity): string | undefined {
    // 优先使用 absPath
    if (img.absPath) {
      let abs = img.absPath.trim();
      // 统一路径分隔符
      abs = abs.replace(/\\/g, '/');
      // 已经是绝对路径
      if (abs.startsWith('/') || abs.match(/^[a-zA-Z]:/)) {
        return abs;
      }
      // 相对路径，拼接到 cwd
      return join(process.cwd(), abs);
    }
    // 从 URL 解析
    const url = String(img.url ?? '').trim().replace(/\\/g, '/');
    if (!url || /^https?:\/\//i.test(url)) return undefined;
    if (url.startsWith('/static/uploads/')) {
      return join(process.cwd(), 'public', 'uploads', url.slice('/static/uploads/'.length));
    }
    if (url.startsWith('/uploads/')) {
      return join(process.cwd(), 'public', url.slice(1));
    }
    if (url.startsWith('/')) {
      return join(process.cwd(), 'public', url.slice(1));
    }
    return undefined
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
   * @description 使用 sharp + SVG 将主副标题烧录到封面图片（无背景框，白色描边文字，对齐图文发布封面风格）。
   * 图片会被 resize 到 640x853，标题居中 ~41% 高度，副标题 ~54% 高度。
   * @param {GalleryImageEntity} img - 封面图库实体
   * @param {{ title: string; subtitle: string }} coverText - 主副标题
   * @returns {Promise<string | null>} 新图片 URL 或 null
   * @keyword-en burn cover title and subtitle onto image using sharp svg stroke text
   */
  private async burnCoverText(
    img: GalleryImageEntity,
    coverText: { title: string; subtitle: string },
  ): Promise<string | null> {
    const srcPath = this.resolveLocalPath(img);
    if (!srcPath || !existsSync(srcPath)) {
      this.logger.warn(`[image-group] burnCoverText skip: no local file for imgId=${img.id}`);
      return null;
    }
    try {
      // 加载封面字体（含 Linux fontconfig 设置）
      const fontFaceCss = await this.loadCoverFontFaceCss();
      if (_coverFontPath) await this.ensureFontconfigSetup(_coverFontPath);
      const sharp = await this.loadSharp();
      if (!sharp) return null;

      const outDir = join(process.cwd(), 'public', 'uploads', 'canvas-covers');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const outName = `cover-${randomUUID()}.jpg`;
      const outPath = join(outDir, outName);

      const safeTitle = coverText.title.trim() || '封面';
      const safeSubtitle = coverText.subtitle.trim();

      /** @description 计算文本视觉宽度单位（CJK=2, ASCII=1）*/
      const visualWidth = (s: string): number =>
        [...String(s)].reduce((n, c) => n + (/[\u3400-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0);

      /** @description 按视觉宽度拆行 */
      const splitLines = (s: string, maxUnits: number): string[] => {
        const lines: string[] = [];
        let cur = '';
        let curUnits = 0;
        for (const ch of s) {
          const w = /[\u3400-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
          if (curUnits + w > maxUnits && cur.length > 0) { lines.push(cur); cur = ch; curUnits = w; }
          else { cur += ch; curUnits += w; }
        }
        if (cur.length > 0) lines.push(cur);
        return lines;
      };

      const titleFontSize = Math.max(34, Math.min(60, Math.floor(900 / Math.max(10, visualWidth(safeTitle)))));
      const subtitleFontSize = safeSubtitle
        ? Math.max(22, Math.min(34, Math.floor(760 / Math.max(12, visualWidth(safeSubtitle)))))
        : 28;
      const titleLines = splitLines(safeTitle, 30);
      const subtitleLines = safeSubtitle ? splitLines(safeSubtitle, 30) : [];
      const titleStartY = Math.max(34, 41 - (Math.max(1, titleLines.length) - 1) * 4);
      const subtitleStartY = Math.min(74, 54 + (Math.max(1, titleLines.length) - 1) * 3);

      const titleTspans = (titleLines.length > 0 ? titleLines : [''])
        .map((line, idx) => `<tspan x="50%" dy="${idx === 0 ? 0 : 1.18}em">${this.escapeSvgText(line)}</tspan>`)
        .join('');
      const subtitleTspans = subtitleLines
        .map((line, idx) => `<tspan x="50%" dy="${idx === 0 ? 0 : 1.2}em">${this.escapeSvgText(line)}</tspan>`)
        .join('');
      const subtitleEscaped = safeSubtitle ? this.escapeSvgText(safeSubtitle) : '';

      const fontFamily = `'ProjectCoverCJK','Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Source Han Sans SC','SimHei',Arial,Helvetica,sans-serif`;
      const svg = `
<svg width="${COLLAGE_WIDTH}" height="${COLLAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    ${fontFaceCss}
    .t{fill:#ffffff;font-size:${titleFontSize}px;font-weight:900;font-family:${fontFamily};paint-order:stroke;stroke:#000000;stroke-width:8px;}
    .s{fill:#ffffff;font-size:${subtitleFontSize}px;font-weight:700;font-family:${fontFamily};paint-order:stroke;stroke:#000000;stroke-width:5px;}
  </style>
  <text x="50%" y="${titleStartY}%" text-anchor="middle" dominant-baseline="middle" class="t">${titleTspans}</text>
  ${subtitleEscaped ? `<text x="50%" y="${subtitleStartY}%" text-anchor="middle" dominant-baseline="middle" class="s">${subtitleTspans}</text>` : ''}
</svg>`;

      await sharp(srcPath)
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
        join(process.cwd(), 'web', 'public', 'fonts', 'cover-cjk.ttf'),
      ];
      _coverFontBase64 = null;
      _coverFontPath = null;
      for (const p of candidates) {
        try {
          const buf = await readFile(p);
          _coverFontBase64 = Buffer.from(buf).toString('base64');
          _coverFontPath = p;
          break;
        } catch { /* skip */ }
      }
    }
    if (!_coverFontBase64) return '';
    return `@font-face{font-family:'ProjectCoverCJK';src:url(data:font/ttf;base64,${_coverFontBase64}) format('truetype');font-weight:400 900;font-style:normal;}`;
  }

  /**
   * @description 将字体写入 /tmp/cover-fonts 并通过 FONTCONFIG_FILE 使 librsvg 能发现该字体，解决 Alpine/Linux 无系统中文字体问题。
   * @param {string} fontFilePath - 字体绝对路径。
   * @keyword-en setup fontconfig for cover cjk font on linux
   */
  private async ensureFontconfigSetup(fontFilePath: string): Promise<void> {
    if (this.fontconfigSetupDone) return;
    try {
      const tmpDir = '/tmp/cover-fonts';
      const cacheDir = `${tmpDir}/cache`;
      await mkdir(cacheDir, { recursive: true });
      const tmpFont = `${tmpDir}/cover-cjk.ttf`;
      try { await access(tmpFont); } catch { await copyFile(fontFilePath, tmpFont); }
      const confPath = `${tmpDir}/fonts.conf`;
      try { await access(confPath); } catch {
        const conf = [
          '<?xml version="1.0"?>',
          '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
          '<fontconfig>',
          `  <dir>${tmpDir}</dir>`,
          `  <cachedir>${cacheDir}</cachedir>`,
          '</fontconfig>',
        ].join('\n');
        await writeFile(confPath, conf, 'utf8');
      }
      process.env.FONTCONFIG_FILE = confPath;
      process.env.FONTCONFIG_PATH = tmpDir;
      this.fontconfigSetupDone = true;
    } catch {
      void 0; // best-effort，Windows dev env 忽略
    }
  }

  /**
   * @description Fisher-Yates 洗牌算法打乱数组顺序（原地操作）
   * @param {T[]} arr - 待打乱数组
   * @keyword-en fisher-yates shuffle array in-place
   */
  private shuffleArray<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
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
   * @description 兼容加载 sharp（支持 default export / namespace export）
   * @returns {Promise<typeof import('sharp') | null>} sharp 可调用实例或 null
   * @keyword-en load sharp with module interop compatibility
   */
  private async loadSharp(): Promise<typeof import('sharp') | null> {
    try {
      const mod = (await import('sharp')) as unknown;
      const maybeDefault = (mod as { default?: unknown }).default;
      const sharp = (typeof maybeDefault === 'function' ? maybeDefault : mod) as unknown;
      if (typeof sharp === 'function') return sharp as typeof import('sharp');
      this.logger.warn('[image-group] sharp module is not callable');
      return null;
    } catch (err) {
      this.logger.warn(`[image-group] sharp load failed: ${err}`);
      return null;
    }
  }

  /**
   * @description 生成双图动态拼图（640x853，上下拼图，横图等比缩放不裁切）。
   * @param {GalleryImageEntity} imgA - 图片A
   * @param {GalleryImageEntity} imgB - 图片B
   * @returns {Promise<string | null>} 合成图 URL 或 null
   * @keyword-en create dynamic collage file
   */
  private async createDynamicCollageFile(imgA: GalleryImageEntity, imgB: GalleryImageEntity): Promise<string | null> {
    const pathA = this.resolveLocalPath(imgA);
    const pathB = this.resolveLocalPath(imgB);
    if (!pathA || !pathB) {
      this.logger.warn(`[image-group] createDynamicCollageFile skip: no local path resolved for imgA=${imgA.id} imgB=${imgB.id}`);
      return null;
    }
    if (!existsSync(pathA)) {
      this.logger.warn(`[image-group] createDynamicCollageFile skip: file not exist imgA=${imgA.id} pathA=${pathA}`);
      return null;
    }
    if (!existsSync(pathB)) {
      this.logger.warn(`[image-group] createDynamicCollageFile skip: file not exist imgB=${imgB.id} pathB=${pathB}`);
      return null;
    }
    try {
      const sharp = await this.loadSharp();
      if (!sharp) return null;

      const topH = Math.floor(COLLAGE_HEIGHT / 2);
      const bottomH = COLLAGE_HEIGHT - topH;

      // 上图：等比缩到 topH 高度，不裁剪
      const bufA = await sharp(pathA).resize({ width: COLLAGE_WIDTH, height: topH }).toBuffer();
      // 下图：等比缩到 bottomH 高度，不裁剪
      const bufB = await sharp(pathB).resize({ width: COLLAGE_WIDTH, height: bottomH }).toBuffer();

      const outDir = join(process.cwd(), 'public', 'uploads', 'canvas-collages');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const outName = `collage-${randomUUID()}.png`;
      const outPath = join(outDir, outName);

      await sharp(pathA)
        .resize({ width: COLLAGE_WIDTH, height: COLLAGE_HEIGHT })
        .composite([
          { input: bufA, top: 0, left: 0 },
          { input: bufB, top: topH, left: 0 },
        ])
        .toFile(outPath);

      return `/static/uploads/canvas-collages/${outName}`;
    } catch (err) {
      this.logger.warn(`[image-group] createDynamicCollageFile error imgA=${imgA.id} imgB=${imgB.id}: ${err}`);
      return null;
    }
  }

  /**
   * @description 将图库图片实体转换为 CanvasGroupImage
   * @param {GalleryImageEntity} img - 图库实体
   * @param {'cover'|'inner-1'|'inner-2'|'inner-3'|'inner-4'|'inner-5'} role - 版式角色
   * @param {{ title: string; subtitle: string }} [coverCopy] - 封面主副标题（仅封面图传入）
   * @returns {CanvasGroupImage} 图片组图片
   * @keyword-en map gallery image to canvas group image
   */
  private toGroupImage(
    img: GalleryImageEntity,
    role: CanvasGroupImage['role'],
    coverCopy?: { title: string; subtitle: string },
  ): CanvasGroupImage {
    return {
      imageId: img.id,
      url: img.url,
      thumbUrl: img.thumbUrl,
      isCollage: img.isCollage === true,
      isPortrait: img.isPortrait,
      tags: Array.isArray(img.tags) ? img.tags : [],
      role,
      ...(coverCopy?.title ? { text: coverCopy.title, subtitle: coverCopy.subtitle } : {}),
    };
  }
}
