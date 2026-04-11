import { extname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, mkdir, access, copyFile, writeFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { GalleryGroupService } from '../../gallery/services/gallery-group.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { SassService } from '../../sass/services/sass.service.js';
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
    private readonly galleryGroups: GalleryGroupService,
    private readonly agentService: AgentService,
    private readonly sassService: SassService,
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
    const defaultGeneratedGroups =
      await this.galleryGroups.ensureDefaultDynamicGroups(
        input.userId,
        input.tenantId,
      );
    const dynamicCoverGroupId = defaultGeneratedGroups.coverGroup.id;
    const dynamicCollageGroupId = defaultGeneratedGroups.collageGroup.id;
    const aiCoverEnabled = await this.isAiCoverEnabled(input.tenantId);
    const excludedGeneratedGroupIds: (string | number)[] = [
      dynamicCoverGroupId,
      dynamicCollageGroupId,
    ].filter(
      (id): id is string | number =>
        (typeof id === 'number' && Number.isFinite(id)) || typeof id === 'string',
    );
    let pool = await this.fetchImagePool(
      input,
      allTags,
      poolSize,
      'regular',
      excludedGeneratedGroupIds,
    );
    pool = await this.supplementPoolWithRelatedTags(
      pool,
      input,
      allTags,
      poolSize,
      'regular',
      excludedGeneratedGroupIds,
    );
    pool = await this.supplementPoolWithRandom(
      pool,
      input,
      poolSize,
      excludedGeneratedGroupIds,
    );
    // 对图片池进行随机打乱，避免封面和内页出现顺序性重复
    this.shuffleArray(pool);
    this.logger.debug(`[image-group] pool_ready pool=${pool.length} tags=${allTags.length}`);

    // --- 3. 全局去重集合 ---
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
      const contextImages: GalleryImageEntity[] = [];
      const contextImageIds = new Set<number>();
      const collectContextImage = (img: GalleryImageEntity | null | undefined): void => {
        if (!img) return;
        if (contextImageIds.has(img.id)) return;
        contextImageIds.add(img.id);
        contextImages.push(img);
      };
      let ok = true;

      // 封面
      let coverPlan:
        | { kind: 'collage'; image: GalleryImageEntity; imgA: GalleryImageEntity; imgB: GalleryImageEntity; collageUrl: string }
        | { kind: 'portrait'; image: GalleryImageEntity; alreadyDesigned: boolean }
        | null = null;
      if (spec.cover === 'collage') {
        // 动态拼图封面：选 2 张横图合成
        const collageResult = await this.pickAndMakeCollage(
          pool,
          localUsedIds,
          globalUsedIds,
          globalUsedLandscapeIds,
          input,
          excludedGeneratedGroupIds,
          art.tags,
          dynamicCoverGroupId,
          'cover',
        );
        if (collageResult) {
          coverPlan = {
            kind: 'collage',
            image: collageResult.image,
            imgA: collageResult.imgA,
            imgB: collageResult.imgB,
            collageUrl: collageResult.collageUrl,
          };
          collectContextImage(collageResult.imgA);
          collectContextImage(collageResult.imgB);
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
          coverPlan = {
            kind: 'portrait',
            image: coverImg,
            alreadyDesigned,
          };
          collectContextImage(coverImg);
          localUsedIds.add(coverImg.id);
          globalUsedIds.add(coverImg.id);
          globalUsedPortraitIds.add(coverImg.id);
        }
      }
      if (!coverPlan) ok = false;

      // 内页
      const roleTypes: Array<'cover' | 'inner-1' | 'inner-2' | 'inner-3' | 'inner-4' | 'inner-5'> = ['inner-1', 'inner-2', 'inner-3', 'inner-4', 'inner-5'];
      for (let r = 0; r < spec.inner.length; r++) {
        const role = spec.inner[r];
        if (role === 'collage') {
          // 动态合成拼图：选 2 张横图合成
          const collageResult = await this.pickAndMakeCollage(
            pool,
            localUsedIds,
            globalUsedIds,
            globalUsedLandscapeIds,
            input,
            excludedGeneratedGroupIds,
            art.tags,
            dynamicCollageGroupId,
            'collage',
          );
          if (collageResult) {
            groupImages.push(this.toGroupImage(collageResult.image, roleTypes[r]));
            collectContextImage(collageResult.imgA);
            collectContextImage(collageResult.imgB);
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
            collectContextImage(portraitImg);
            localUsedIds.add(portraitImg.id);
            globalUsedIds.add(portraitImg.id);
            globalUsedPortraitIds.add(portraitImg.id);
          } else {
            ok = false;
          }
        }
      }

      // 封面文案：按“本组最终配图”语义生成（tags + description 汇总）
      if (coverPlan) {
        const imageContext = this.summarizeImageContext(contextImages);
        const coverText =
          (await this.generateCoverTexts(input.topic, [art], [imageContext]))[0] ??
          this.buildCoverText(art.title, i);

        const aiCover = aiCoverEnabled
          ? await this.tryGenerateAiCoverToGallery({
              userId: input.userId,
              tenantId: input.tenantId,
              topic: input.topic,
              articleTitle: art.title,
              articleTags: art.tags,
              imageContext,
              coverText,
              coverType: coverPlan.kind,
              sourceImages:
                coverPlan.kind === 'collage'
                  ? [coverPlan.imgA, coverPlan.imgB]
                  : [coverPlan.image],
              dynamicCoverGroupId,
            })
          : null;

        if (aiCover) {
          groupImages.unshift(this.toGroupImage(aiCover, 'cover', coverText));
          groups.push({
            id: i + 1,
            articleId: art.title ? undefined : undefined,
            articleTitle: art.title,
            layout,
            images: groupImages,
            status: ok ? 'done' : 'failed',
          });
          this.logger.debug(
            `[image-group] group_assigned idx=${i} layout=${layout} imageCount=${groupImages.length} status=${ok ? 'done' : 'failed'} cover=ai`,
          );
          continue;
        }

        if (coverPlan.kind === 'collage') {
          const burnedUrl = await this.burnCollageCoverText(
            { imgA: coverPlan.imgA, imgB: coverPlan.imgB },
            coverText,
          );
          const finalUrl = burnedUrl ?? coverPlan.collageUrl;
          const persistedCover = finalUrl === coverPlan.image.url
            ? coverPlan.image
            : await this.persistGeneratedAssetToGallery({
                userId: input.userId,
                tenantId: input.tenantId,
                url: finalUrl,
                generatedKind: 'cover',
                groupId: dynamicCoverGroupId,
                sourceImageIds: [coverPlan.imgA.id, coverPlan.imgB.id],
                sourceImages: [coverPlan.imgA, coverPlan.imgB],
                description: burnedUrl
                  ? '画布拼图封面（已烧录文案）'
                  : '画布拼图封面',
              });
          const finalCover = persistedCover ?? coverPlan.image;
          groupImages.unshift(this.toGroupImage(finalCover, 'cover', coverText));
        } else {
          const burnedUrl = coverPlan.alreadyDesigned
            ? null
            : await this.burnCoverText(coverPlan.image, coverText);
          const persistedCover = burnedUrl
            ? await this.persistGeneratedAssetToGallery({
                userId: input.userId,
                tenantId: input.tenantId,
                url: burnedUrl,
                generatedKind: 'cover',
                groupId: dynamicCoverGroupId,
                sourceImageIds: [coverPlan.image.id],
                sourceImages: [coverPlan.image],
                description: '画布单图封面（已烧录文案）',
              })
            : null;
          const finalCover = persistedCover ?? coverPlan.image;
          const coverCopy =
            coverPlan.alreadyDesigned || !persistedCover ? undefined : coverText;
          groupImages.unshift(
            this.toGroupImage(finalCover, 'cover', coverCopy),
          );
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
      this.logger.debug(`[image-group] group_assigned idx=${i} layout=${layout} imageCount=${groupImages.length} status=${ok ? 'done' : 'failed'}`);
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
  * @param {number[]} [excludedGroupIds] - 需排除的默认动态分组ID
  * @param {string[]} [relatedTags] - 本篇文章相关标签（用于相近标签补池）
  * @param {string | number} [targetGroupId] - 生成图入库目标分组ID
  * @param {'cover'|'collage'} [generatedKind='collage'] - 生成图类型
   * @returns {Promise<{ image: GalleryImageEntity; sourceIds: number[]; imgA: GalleryImageEntity; imgB: GalleryImageEntity; collageUrl: string } | null>}
   * @keyword-en pick two landscape images and make collage
   */
  private async pickAndMakeCollage(
    pool: GalleryImageEntity[],
    localUsedIds: Set<number>,
    globalUsedIds: Set<number>,
    globalLandscapeIds: Set<number>,
    userInput: Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>,
    excludedGroupIds?: (string | number)[],
    relatedTags?: string[],
    targetGroupId?: string | number,
    generatedKind: 'cover' | 'collage' = 'collage',
  ): Promise<{ image: GalleryImageEntity; sourceIds: number[]; imgA: GalleryImageEntity; imgB: GalleryImageEntity; collageUrl: string } | null> {
    const pairKey = (a: GalleryImageEntity, b: GalleryImageEntity): string =>
      a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;

    const pickPair = (
      candidates: GalleryImageEntity[],
      options: {
        requireBothFreshLandscape?: boolean;
        requireAtLeastOneFreshLandscape?: boolean;
      } = {},
      tried: Set<string>,
    ): [GalleryImageEntity, GalleryImageEntity] | null => {
      if (candidates.length < 2) return null;
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i];
          const b = candidates[j];
          if (a.id === b.id) continue;
          const k = pairKey(a, b);
          if (tried.has(k)) continue;

          if (options.requireBothFreshLandscape) {
            if (globalLandscapeIds.has(a.id) || globalLandscapeIds.has(b.id)) continue;
          }
          if (options.requireAtLeastOneFreshLandscape) {
            if (globalLandscapeIds.has(a.id) && globalLandscapeIds.has(b.id)) continue;
          }
          return [a, b];
        }
      }
      return null;
    };

    const buildCandidates = (
      allowGlobalReuse: boolean,
    ): { landscape: GalleryImageEntity[]; any: GalleryImageEntity[] } => {
      const any = pool.filter((img) => {
        if (localUsedIds.has(img.id)) return false;
        if (!allowGlobalReuse && globalUsedIds.has(img.id)) return false;
        return this.isLocalImageReadable(img);
      });
      const landscape = any.filter((img) => img.isPortrait !== true);
      return { landscape, any };
    };

    const triedPairs = new Set<string>();
    pool = await this.supplementPoolWithRelatedTags(
      pool,
      userInput,
      Array.isArray(relatedTags) ? relatedTags : [],
      Math.max(120, pool.length + 40),
      'regular',
      excludedGroupIds,
    );
    // 先拉一次补充池，优先保证有足够可读本地图可用于拼图
    pool = await this.supplementPoolWithRandom(
      pool,
      userInput,
      Math.max(120, pool.length + 40),
      excludedGroupIds,
    );

    const attemptPick = (): [GalleryImageEntity, GalleryImageEntity] | null => {
      // 1) 横图 + 两张都未占用（全局唯一优先）
      {
        const { landscape } = buildCandidates(false);
        const pair = pickPair(landscape, { requireBothFreshLandscape: true }, triedPairs);
        if (pair) return pair;
      }
      // 2) 横图 + 至少一张未占用
      {
        const { landscape } = buildCandidates(false);
        const pair = pickPair(landscape, { requireAtLeastOneFreshLandscape: true }, triedPairs);
        if (pair) return pair;
      }
      // 3) 任意方向 + 两张都未占用（仍保持全局唯一）
      {
        const { any } = buildCandidates(false);
        const pair = pickPair(any, {}, triedPairs);
        if (pair) return pair;
      }
      // 4) 最后降级：允许跨组复用，但仍要求组内不重复，且绝不允许同图双拼
      {
        const { any } = buildCandidates(true);
        const pair = pickPair(any, {}, triedPairs);
        if (pair) return pair;
      }
      return null;
    };

    // 多轮尝试：合成失败就换一对继续尝试
    for (let round = 0; round < 8; round++) {
      const pair = attemptPick();
      if (!pair) break;
      const [pickA, pickB] = pair;
      triedPairs.add(pairKey(pickA, pickB));
      const collageUrl = await this.createDynamicCollageFile(pickA, pickB);
      if (!collageUrl) continue;

      const sourceIds = [pickA.id, pickB.id];
      const persisted = await this.persistGeneratedAssetToGallery({
        userId: userInput.userId,
        tenantId: userInput.tenantId,
        url: collageUrl,
        generatedKind,
        groupId: targetGroupId,
        sourceImageIds: sourceIds,
        sourceImages: [pickA, pickB],
        description:
          generatedKind === 'cover' ? '画布动态拼图封面' : '画布动态拼图内页',
      });
      if (!persisted) {
        this.logger.warn(
          `[image-group] generated collage not persisted, skip pair a=${pickA.id} b=${pickB.id}`,
        );
        continue;
      }
      return {
        image: persisted,
        sourceIds,
        imgA: pickA,
        imgB: pickB,
        collageUrl: persisted.url,
      };
    }

    this.logger.warn(`[image-group] collage synthesis failed after retries`);
    return null;
  }

  /**
   * @description 判断当前租户是否开启 AI 封面。
   * @param {string | undefined} tenantId - 租户ID。
   * @returns {Promise<boolean>} 是否开启。
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
   * @description 推演封面生图提示词（优先LLM，失败回退模板）。
   * @param {object} input - 提示词上下文。
   * @returns {Promise<string>} 生图提示词。
   * @keyword-en infer ai cover prompt by llm
   */
  private async buildAiCoverPrompt(input: {
    topic?: string;
    articleTitle?: string;
    articleTags?: string[];
    imageContext: { tags: string[]; descriptions: string[] };
    coverText: { title: string; subtitle: string };
    coverType: 'portrait' | 'collage';
  }): Promise<string> {
    const appendCoverTextDirectives = (rawPrompt: string): string => {
      const core = String(rawPrompt ?? '').replace(/\s+/g, ' ').trim();
      return [
        core,
        input.coverText.title ? `封面主标题:${input.coverText.title}` : '',
        input.coverText.subtitle ? `封面副标题:${input.coverText.subtitle}` : '',
        '文案呈现:请将封面主标题与副标题以浮动文字形式显示在画面中，确保清晰可读且不被遮挡',
      ]
        .filter((x) => x.length > 0)
        .join('；');
    };

    const fallback = [
      '小红书封面图',
      input.coverType === 'collage' ? '拼图风格' : '单图风格',
      input.topic ? `主题:${input.topic}` : '',
      input.articleTitle ? `标题:${input.articleTitle}` : '',
      input.coverText.title ? `主文案:${input.coverText.title}` : '',
      input.coverText.subtitle ? `副文案:${input.coverText.subtitle}` : '',
      input.imageContext.tags.length > 0
        ? `视觉元素:${input.imageContext.tags.slice(0, 10).join(',')}`
        : '',
      '竖版 640x853，清晰，高对比，适合移动端封面',
    ]
      .filter((x) => x.length > 0)
      .join('；');

    try {
      const llm = await this.agentService.buildLLM({
        nonStreaming: true,
        temperature: 0.4,
      });
      const msg = [
        '你是一名封面视觉提示词工程师。',
        '请根据输入信息输出 1 条中文生图提示词。',
        '要求：不超过 180 字，必须可直接用于图片生成；包含主体、风格、构图、光线、质感。',
        '禁止输出 markdown、代码块、解释性文字。',
        JSON.stringify({
          topic: input.topic,
          articleTitle: input.articleTitle,
          articleTags: input.articleTags,
          coverType: input.coverType,
          coverText: input.coverText,
          imageContext: input.imageContext,
        }),
      ].join('\n');
      const result = await llm.invoke(msg);
      const content = result?.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') {
              const rec = item as Record<string, unknown>;
              if (typeof rec['text'] === 'string') return rec['text'];
              if (typeof rec['content'] === 'string') return rec['content'];
            }
            return '';
          })
          .join(' ');
      }
      const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (normalized.length >= 8) {
        return appendCoverTextDirectives(normalized.slice(0, 240));
      }
      return appendCoverTextDirectives(fallback);
    } catch {
      return appendCoverTextDirectives(fallback);
    }
  }

  /**
   * @description 调用生图模型生成封面并落图库。
   * @param {object} input - 生图输入。
   * @returns {Promise<GalleryImageEntity | null>} 生成并入库后的封面图。
   * @keyword-en generate ai cover and persist to gallery
   */
  private async tryGenerateAiCoverToGallery(input: {
    userId: string;
    tenantId?: string;
    topic?: string;
    articleTitle?: string;
    articleTags?: string[];
    imageContext: { tags: string[]; descriptions: string[] };
    coverText: { title: string; subtitle: string };
    coverType: 'portrait' | 'collage';
    sourceImages: GalleryImageEntity[];
    dynamicCoverGroupId: string | number;
  }): Promise<GalleryImageEntity | null> {
    try {
      const prompt = await this.buildAiCoverPrompt({
        topic: input.topic,
        articleTitle: input.articleTitle,
        articleTags: input.articleTags,
        imageContext: input.imageContext,
        coverText: input.coverText,
        coverType: input.coverType,
      });
      const baseImageCandidates = input.sourceImages
        .map((img) => this.resolveLocalPath(img) ?? String(img.url ?? '').trim())
        .filter((x): x is string => String(x ?? '').trim().length > 0)
        .slice(0, 6);

      const generated = await this.agentService.sendPrompt({
        prompt,
        size: '640x853',
        baseImageCandidates,
      });

      const sourceImageIds = input.sourceImages
        .map((img) => Number(img?.id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .slice(0, 2);

      return await this.persistGeneratedAssetToGallery({
        userId: input.userId,
        tenantId: input.tenantId,
        url: generated.imagePath,
        generatedKind: 'cover',
        groupId: input.dynamicCoverGroupId,
        sourceImageIds,
        sourceImages: input.sourceImages,
        description: `AI生成封面（${generated.providerCode}:${generated.model}）`,
      });
    } catch (err) {
      this.logger.warn(`[image-group] ai_cover_generate_failed: ${err}`);
      return null;
    }
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
    excludedGroupIds?: (string | number)[],
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
    const deduped = this.dedup(this.filterOutExcludedGroups(images, excludedGroupIds));
    if (deduped.length >= wantCount) return deduped;

    // 不足时补随机
    const more = await this.gallery.findAccessibleImages(
      input.userId,
      input.tenantId,
      { imageType: imgType, limit: wantCount },
    );
    const merged = this.dedup([
      ...deduped,
      ...this.filterOutExcludedGroups(more, excludedGroupIds),
    ]);
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
   * @description 汇总一组配图的语义上下文（标签 + 描述），用于生成相关封面文案
   * @param {GalleryImageEntity[]} images - 本组配图来源图（去重后）
   * @returns {{ tags: string[]; descriptions: string[] }}
   * @keyword-en summarize image semantic context for cover copy
   */
  private summarizeImageContext(
    images: GalleryImageEntity[],
  ): { tags: string[]; descriptions: string[] } {
    const tagSet = new Set<string>();
    const descSet = new Set<string>();

    for (const img of images) {
      for (const t of Array.isArray(img.tags) ? img.tags : []) {
        const s = String(t ?? '').trim();
        if (!s) continue;
        tagSet.add(s);
      }
      const d = String(img.description ?? '').trim();
      if (d.length > 0) descSet.add(d);
    }

    return {
      tags: Array.from(tagSet).slice(0, 40),
      descriptions: Array.from(descSet).slice(0, 10),
    };
  }

  /**
   * @description 批量生成封面文案（主标题+副标题）：优先 LLM 生成，失败则退回标题截短
   * @param {string | undefined} topic - 主题
   * @param {Array<{ title: string; tags: string[] }>} articles - 文章列表
   * @param {Array<{ tags: string[]; descriptions: string[] }>} [imageContexts] - 每篇文章对应的配图语义上下文
   * @returns {Promise<Array<{title: string; subtitle: string}>>} 每篇文章对应的封面主副标题
   * @keyword-en batch generate cover title and subtitle via LLM with fallback
   */
  private async generateCoverTexts(
    topic: string | undefined,
    articles: Array<{ title: string; tags: string[] }>,
    imageContexts?: Array<{ tags: string[]; descriptions: string[] }>,
  ): Promise<Array<{ title: string; subtitle: string }>> {
    const fallback = articles.map((a, i) => this.buildCoverText(a.title, i));
    try {
      const llm = await this.agentService.buildLLM({ nonStreaming: true, temperature: 0.8 });
      const titlesBlock = articles
        .map((a, i) => {
          const articleTags = Array.isArray(a.tags) ? a.tags.filter((t) => String(t ?? '').trim().length > 0) : [];
          const ctx = imageContexts?.[i];
          const ctxTags = Array.isArray(ctx?.tags) ? ctx!.tags.slice(0, 24) : [];
          const ctxDescs = Array.isArray(ctx?.descriptions) ? ctx!.descriptions.slice(0, 6) : [];
          const parts = [
            `${i + 1}. 文章标题：${a.title}`,
            articleTags.length > 0 ? `   文章标签：${articleTags.join('、')}` : '',
            ctxTags.length > 0 ? `   配图标签汇总：${ctxTags.join('、')}` : '',
            ctxDescs.length > 0 ? `   配图描述汇总：${ctxDescs.join('；')}` : '',
          ].filter((x) => x.length > 0);
          return parts.join('\n');
        })
        .join('\n');
      const topicCtx = topic ? `主题：${topic}\n` : '';
      const prompt = [
        '你是一名小红书封面文案专家。根据以下文章与配图语义信息，为每篇文章生成封面主标题和副标题。',
        '要求：',
        '- 主标题：6-16 个汉字，简洁有力、吸引点击',
        '- 副标题：10-24 个汉字，补充描述或引发兴趣',
        '- 文案必须与配图标签和配图描述强相关，不得脱离配图语义凭空发挥',
        '- 若文章标题与配图语义冲突，优先以配图语义为准，并尽量兼顾文章主题',
        '- 每条唯一不重复，不加引号、序号或多余标点，特别是禁止使用破折号（——或--）和省略号（…或...）',
        '',
        topicCtx,
        '文章与配图信息列表：',
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
   * @description 过滤掉指定分组中的图片（用于排除动态封面/动态拼图来源图）。
   * @param {GalleryImageEntity[]} list - 原始图片列表。
   * @param {number[]} [excludedGroupIds] - 需排除的分组ID。
   * @returns {GalleryImageEntity[]} 过滤后列表。
   * @keyword-en filter out excluded group images
   */
  private filterOutExcludedGroups(
    list: GalleryImageEntity[],
    excludedGroupIds?: (string | number)[],
  ): GalleryImageEntity[] {
    const excluded = new Set(
      (excludedGroupIds ?? []).filter(
        (id): id is number => typeof id === 'number' && Number.isFinite(id),
      ),
    );
    if (excluded.size === 0) return Array.isArray(list) ? list : [];
    return (Array.isArray(list) ? list : []).filter((img) => {
      const gid = Number((img as { groupId?: unknown })?.groupId ?? NaN);
      return !(Number.isFinite(gid) && excluded.has(gid));
    });
  }

  /**
   * @description 通过随机样本补充图片池到目标规模（尽量去重）
   * @param {GalleryImageEntity[]} pool - 当前池
   * @param {Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>} input - 用户作用域
   * @param {number} targetSize - 目标数量
   * @returns {Promise<GalleryImageEntity[]>}
   * @keyword-en supplement image pool by random samples
   */
  private async supplementPoolWithRandom(
    pool: GalleryImageEntity[],
    input: Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>,
    targetSize: number,
    excludedGroupIds?: (string | number)[],
  ): Promise<GalleryImageEntity[]> {
    let merged = this.dedup(this.filterOutExcludedGroups(pool, excludedGroupIds));
    if (merged.length >= targetSize) return merged;
    for (let i = 0; i < 4 && merged.length < targetSize; i++) {
      try {
        const random = await this.gallery.sampleRandom({
          userId: input.userId,
          tenantId: input.tenantId,
          limit: 60,
        });
        const next = this.dedup([
          ...merged,
          ...this.filterOutExcludedGroups(random, excludedGroupIds),
        ]);
        if (next.length === merged.length) break;
        merged = next;
      } catch {
        break;
      }
    }
    return merged;
  }

  /**
   * @description 构造相近标签集合：保留原标签并提取关键词，供图片不足时做相近补池。
   * @param {string[]} tags - 原始标签。
   * @returns {string[]} 扩展后的相近标签列表。
   * @keyword-en build related tags for fallback search
   */
  private buildRelatedTags(tags: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: unknown): void => {
      const t = String(raw ?? '').trim();
      if (!t) return;
      if (seen.has(t)) return;
      seen.add(t);
      out.push(t);
    };

    for (const raw of Array.isArray(tags) ? tags : []) {
      const tag = String(raw ?? '').trim();
      if (!tag) continue;
      push(tag);

      const normalized = tag
        .replace(/^#+/g, '')
        .replace(/[【】\[\]()（）]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      push(normalized);

      const tokens = normalized
        .split(/[,\s，、/|_\\-]+/g)
        .map((x) => x.trim())
        .filter((x) => x.length >= 2);
      for (const token of tokens) push(token);

      if (normalized.length >= 4) {
        push(normalized.slice(0, 4));
        push(normalized.slice(-4));
      }
      if (normalized.length >= 6) {
        const midStart = Math.floor((normalized.length - 4) / 2);
        push(normalized.slice(midStart, midStart + 4));
      }
    }

    return out.slice(0, 80);
  }

  /**
   * @description 使用相近标签补充图片池，避免仅随机补图导致语义漂移。
   * @param {GalleryImageEntity[]} pool - 当前图片池。
   * @param {Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>} input - 用户作用域。
   * @param {string[]} seedTags - 原始标签。
   * @param {number} targetSize - 目标池大小。
   * @param {'regular'|'collage'} imageType - 目标图片类型。
   * @param {number[]} [excludedGroupIds] - 需排除分组。
   * @returns {Promise<GalleryImageEntity[]>} 补充后的图片池。
   * @keyword-en supplement pool with semantically related tags
   */
  private async supplementPoolWithRelatedTags(
    pool: GalleryImageEntity[],
    input: Pick<CanvasImageGroupCreateInput, 'userId' | 'tenantId'>,
    seedTags: string[],
    targetSize: number,
    imageType: 'regular' | 'collage',
    excludedGroupIds?: (string | number)[],
  ): Promise<GalleryImageEntity[]> {
    let merged = this.dedup(this.filterOutExcludedGroups(pool, excludedGroupIds));
    if (merged.length >= targetSize) return merged;

    const relatedTags = this.buildRelatedTags(seedTags);
    if (relatedTags.length === 0) return merged;

    const chunkSize = 24;
    for (let i = 0; i < 4 && merged.length < targetSize; i++) {
      const chunk = relatedTags.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.length === 0) break;
      try {
        const fetched = await this.gallery.searchByTags({
          userId: input.userId,
          tenantId: input.tenantId,
          tags: chunk,
          limit: Math.max(40, Math.min(120, targetSize - merged.length + 20)),
          imageType,
        });
        const next = this.dedup([
          ...merged,
          ...this.filterOutExcludedGroups(fetched, excludedGroupIds),
        ]);
        if (next.length === merged.length) continue;
        merged = next;
      } catch {
        break;
      }
    }
    return merged;
  }

  /**
   * @description 从上传URL解析图库落库所需的文件名与绝对路径。
   * @param {string} url - 图片URL。
   * @returns {{ fileName: string; absPath: string; normalizedUrl: string } | null} 解析结果。
   * @keyword-en resolve generated upload file info from url
   */
  private resolveGeneratedUploadFileInfo(
    url: string,
  ): { fileName: string; absPath: string; normalizedUrl: string } | null {
    const raw = String(url ?? '').trim().replace(/\\/g, '/');
    if (!raw || /^https?:\/\//i.test(raw)) return null;

    const staticPrefix = '/static/uploads/';
    const uploadPrefix = '/uploads/';
    let rel = '';

    if (raw.startsWith(staticPrefix)) {
      rel = raw.slice(staticPrefix.length);
    } else if (raw.startsWith(uploadPrefix)) {
      rel = raw.slice(uploadPrefix.length);
    } else if (raw.startsWith('/')) {
      rel = raw.replace(/^\/+/, '');
      if (rel.startsWith('static/uploads/')) rel = rel.slice('static/uploads/'.length);
      if (rel.startsWith('uploads/')) rel = rel.slice('uploads/'.length);
    } else {
      rel = raw;
    }

    const safeRel = rel
      .split('/')
      .map((seg) => seg.trim())
      .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
      .join('/');
    if (!safeRel) return null;

    return {
      fileName: safeRel,
      absPath: join(process.cwd(), 'public', 'uploads', safeRel),
      normalizedUrl: `${staticPrefix}${safeRel}`,
    };
  }

  /**
   * @description 读取图片尺寸信息（宽/高/是否竖图）。
   * @param {string} absPath - 图片绝对路径。
   * @returns {Promise<{ width: number; height: number; isPortrait: boolean } | null>} 尺寸信息。
   * @keyword-en read local image dimensions
   */
  private async getImageDimensionsFromAbsPath(
    absPath: string,
  ): Promise<{ width: number; height: number; isPortrait: boolean } | null> {
    const sharp = await this.loadSharp();
    if (!sharp) return null;
    try {
      const meta = await sharp(absPath).metadata();
      const width = Number(meta.width);
      const height = Number(meta.height);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
      if (width <= 0 || height <= 0) return null;
      return {
        width: Math.floor(width),
        height: Math.floor(height),
        isPortrait: height > width,
      };
    } catch {
      return null;
    }
  }

  /**
   * @description 组装生成图片标签（保留来源语义并打上动态封面/拼图类型标签）。
   * @param {'cover'|'collage'} generatedKind - 生成类型。
   * @param {GalleryImageEntity[]} [sourceImages] - 来源图片。
   * @returns {string[]} 标签列表。
   * @keyword-en build generated asset tags
   */
  private buildGeneratedAssetTags(
    generatedKind: 'cover' | 'collage',
    sourceImages?: GalleryImageEntity[],
  ): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: unknown): void => {
      const t = String(raw ?? '').trim();
      if (!t) return;
      if (seen.has(t)) return;
      seen.add(t);
      out.push(t);
    };

    for (const img of Array.isArray(sourceImages) ? sourceImages : []) {
      for (const t of Array.isArray(img.tags) ? img.tags : []) {
        push(t);
      }
    }

    if (generatedKind === 'cover') {
      ['封面', 'canvas封面', '自动封面', '动态封面', '自动生成'].forEach(push);
    } else {
      ['拼图', '拼图封面', '动态拼图', '自动拼图', '自动生成'].forEach(push);
    }
    return out.slice(0, 40);
  }

  /**
   * @description 将画布生成出的拼图/封面文件持久化到图库，确保返回真实 imageId。
   * @param {{ userId: string; tenantId?: string; url: string; generatedKind: 'cover'|'collage'; groupId?: string | number; sourceImageIds?: number[]; sourceImages?: GalleryImageEntity[]; description?: string }} input - 持久化入参。
   * @returns {Promise<GalleryImageEntity | null>} 入库后的图库实体。
   * @keyword-en persist generated canvas asset to gallery
   */
  private async persistGeneratedAssetToGallery(input: {
    userId: string;
    tenantId?: string;
    url: string;
    generatedKind: 'cover' | 'collage';
    groupId?: string | number;
    sourceImageIds?: number[];
    sourceImages?: GalleryImageEntity[];
    description?: string;
  }): Promise<GalleryImageEntity | null> {
    const file = this.resolveGeneratedUploadFileInfo(input.url);
    if (!file) {
      this.logger.warn(
        `[image-group] persistGeneratedAssetToGallery skip: invalid url=${input.url}`,
      );
      return null;
    }
    if (!existsSync(file.absPath)) {
      this.logger.warn(
        `[image-group] persistGeneratedAssetToGallery skip: file not found path=${file.absPath}`,
      );
      return null;
    }

    const isValidGroupId = (id: unknown): id is string | number =>
      (typeof id === 'number' && Number.isFinite(id)) || typeof id === 'string';
    let finalGroupId = isValidGroupId(input.groupId) ? input.groupId : undefined;
    if (finalGroupId === undefined) {
      if (input.generatedKind === 'cover') {
        const coverGroup = await this.galleryGroups.findOrCreateDynamicCoverGroup(
          input.userId,
          input.tenantId,
        );
        finalGroupId = coverGroup.id;
      } else {
        const collageGroup =
          await this.galleryGroups.findOrCreateDynamicCollageGroup(
            input.userId,
            input.tenantId,
          );
        finalGroupId = collageGroup.id;
      }
    }

    let size: number | undefined;
    try {
      const st = await stat(file.absPath);
      if (Number.isFinite(st.size) && st.size > 0) {
        size = Math.floor(st.size);
      }
    } catch {
      size = undefined;
    }

    const dimensions = await this.getImageDimensionsFromAbsPath(file.absPath);
    const width = dimensions?.width ?? COLLAGE_WIDTH;
    const height = dimensions?.height ?? COLLAGE_HEIGHT;
    const isPortrait = dimensions?.isPortrait ?? height > width;

    const ext = extname(file.fileName).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    const thumb = await this.gallery.generateThumbnail(file.absPath, file.fileName);

    const sourceIds = Array.isArray(input.sourceImageIds)
      ? input.sourceImageIds
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x))
          .slice(0, 2)
      : [];

    const tags = this.buildGeneratedAssetTags(input.generatedKind, input.sourceImages);
    const originalName = file.fileName.includes('/')
      ? file.fileName.slice(file.fileName.lastIndexOf('/') + 1)
      : file.fileName;

    try {
      const docs = await this.gallery.createMany([
        {
          userId: input.userId,
          tenantId: input.tenantId,
          groupId: finalGroupId,
          originalName,
          fileName: file.fileName,
          url: file.normalizedUrl,
          absPath: file.absPath,
          thumbFileName: thumb?.thumbFileName,
          thumbUrl: thumb?.thumbUrl,
          mimeType,
          size,
          width,
          height,
          tags,
          description:
            input.description ??
            (input.generatedKind === 'cover' ? '画布动态封面' : '画布动态拼图'),
          isCollage: true,
          collageSourceImageIds: sourceIds.length > 0 ? sourceIds : undefined,
          collageMeta: {
            width,
            height,
            dpi: 96,
          },
        },
      ]);
      const first = Array.isArray(docs) && docs.length > 0 ? docs[0] : null;
      if (!first) return null;
      return {
        ...first,
        isPortrait,
      } as GalleryImageEntity;
    } catch (error) {
      this.logger.warn(
        `[image-group] persistGeneratedAssetToGallery failed url=${file.normalizedUrl} err=${error}`,
      );
      return null;
    }
  }

  /**
   * @description 判断图片是否可作为拼图源图（可解析到本地且文件存在）
   * @param {GalleryImageEntity} img - 图片实体
   * @returns {boolean}
   * @keyword-en check collage source local readability
   */
  private isLocalImageReadable(img: GalleryImageEntity): boolean {
    const p = this.resolveLocalPath(img);
    return !!p && existsSync(p);
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
