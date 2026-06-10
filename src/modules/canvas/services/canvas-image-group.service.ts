import { extname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import {
  readFile,
  mkdir,
  access,
  copyFile,
  writeFile,
  stat,
} from 'node:fs/promises';
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
  'collage-cover-5collage': {
    cover: 'collage',
    inner: ['collage', 'collage', 'collage', 'collage', 'collage'],
  },
};

/** @description 内页不允许使用的封面标签集合（系统写入的精确封面标记） */
const COVER_TAG_SET = new Set([
  '\u5c01\u9762',
  '\u62fc\u56fe\u5c01\u9762',
  '\u81ea\u52a8\u5c01\u9762',
  'canvas\u5c01\u9762',
]);

/** @description 拼图标准尺寸 */
const COLLAGE_WIDTH = 640;
const COLLAGE_HEIGHT = 853;

/**
 * @description 封面和内页重生成最多接收的参考图数量。
 * @keyword-cn 图片选择, 图片槽位重生成
 * @keyword-en selected-source-images
 * @keyword-en image-slot-regenerate
 */
const REGENERATE_SOURCE_IMAGE_LIMIT = 4;

/** @description 模块级封面字体 base64 缓存（undefined=未加载, null=加载失败, string=缓存值） */
let _coverFontBase64: string | null | undefined = undefined;
/** @description 模块级封面字体已解析的绝对路径缓存 */
let _coverFontPath: string | null | undefined = undefined;

/** @description 交替版式列表 */
const ALTERNATING_LAYOUTS: ImageGroupLayout[] = [
  'portrait-cover-5inner',
  'collage-cover-5inner',
];

export type ImageGroupImageRole = CanvasGroupImage['role'];

type ImageGroupSlotRequirement = {
  kind: 'portrait' | 'collage';
  role: ImageGroupImageRole;
};

type ImageGroupAllocationRequest = {
  articleIndex: number;
  articleTitle?: string;
  layout: ImageGroupLayout;
  slots: ImageGroupSlotRequirement[];
};

type GeneratedAssetKind = 'cover' | 'collage' | 'inner';

export type ImageGroupPlannedSlot =
  | { kind: 'portrait'; role: ImageGroupImageRole; image: GalleryImageEntity }
  | {
      kind: 'collage';
      role: ImageGroupImageRole;
      imgA: GalleryImageEntity;
      imgB: GalleryImageEntity;
    };

export interface ImageGroupAllocationPlan {
  articleIndex: number;
  articleTitle?: string;
  layout: ImageGroupLayout;
  slots: ImageGroupPlannedSlot[];
}

export interface ImageGroupAllocationStats {
  requiredPortrait: number;
  availablePortrait: number;
  missingPortrait: number;
  requiredLandscape: number;
  availableLandscape: number;
  missingLandscape: number;
}

export type ImageGroupAllocationResult =
  | {
      ok: true;
      plans: ImageGroupAllocationPlan[];
      stats: ImageGroupAllocationStats;
    }
  | {
      ok: false;
      stats: ImageGroupAllocationStats;
    };

export type ImageGroupSourcePreparation =
  | {
      ok: true;
      plans: ImageGroupAllocationPlan[];
      stats: ImageGroupAllocationStats;
      imageContexts: Array<{ tags: string[]; descriptions: string[] }>;
      dynamicCoverGroupId: string | number;
      dynamicCollageGroupId: string | number;
      aiCoverEnabled: boolean;
    }
  | {
      ok: false;
      imageGroups: CanvasImageGroup[];
      stats: ImageGroupAllocationStats;
    };

async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

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

  private coercePlainText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    return '';
  }

  private copyUnknownArray(value: unknown): unknown[] | null {
    if (!Array.isArray(value)) return null;
    const items: unknown[] = [];
    for (const item of value as unknown[]) {
      items.push(item);
    }
    return items;
  }

  private describeUnknown(value: unknown): string {
    if (value instanceof Error) {
      const details = value.stack?.trim() || value.message || value.name;
      if (details) return details;
    }

    const text = this.coercePlainText(value).trim();
    if (text) return text;

    try {
      const json = JSON.stringify(value);
      if (typeof json === 'string' && json.trim()) return json;
    } catch {
      void 0;
    }

    return Object.prototype.toString.call(value);
  }

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
    const preparation = await this.prepareImageGroupSources(input);
    if (!preparation.ok) return preparation.imageGroups;
    return await this.renderPreparedImageGroups(input, preparation);
  }

  /**
   * @description 基于用户本次选择的最多 4 张图库图片，一次性生成新的 Canvas 封面图并写入动态封面图库。
   * @param {object} input - 封面重生成输入。
   * @returns {Promise<CanvasGroupImage>} 可直接回写到 Canvas 的封面图片。
   * @keyword-cn 封面重生成, 只改封面, 图片选择
   * @keyword-en cover-regenerate
   * @keyword-en selected-source-images
   */
  async regenerateCoverImage(input: {
    userId: string;
    tenantId?: string;
    topic?: string;
    articleTitle?: string;
    articleTags?: string[];
    prompt?: string;
    includeSystemPrompt?: boolean;
    sourceImageIds: number[];
  }): Promise<CanvasGroupImage> {
    const sourceImageIds = Array.from(
      new Set(
        (Array.isArray(input.sourceImageIds) ? input.sourceImageIds : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.floor(id)),
      ),
    ).slice(0, REGENERATE_SOURCE_IMAGE_LIMIT);
    if (sourceImageIds.length === 0) {
      throw new Error('COVER_SOURCE_IMAGES_REQUIRED');
    }

    const sourceImages = await this.gallery.findAccessibleImagesByIds(
      input.userId,
      input.tenantId,
      sourceImageIds,
    );
    if (sourceImages.length === 0) {
      throw new Error('COVER_SOURCE_IMAGES_NOT_FOUND');
    }

    const baseImageCandidates = sourceImages
      .map((img) => this.resolveLocalPath(img) ?? String(img.url ?? '').trim())
      .filter((path): path is string => path.length > 0)
      .slice(0, REGENERATE_SOURCE_IMAGE_LIMIT);
    if (baseImageCandidates.length === 0) {
      throw new Error('COVER_SOURCE_IMAGES_NOT_READABLE');
    }

    const rawPrompt = this.coercePlainText(input.prompt).trim();
    // 是否叠加系统自带封面提示词;未勾选时只用用户本次提示词,此时提示词必填
    const includeSystemPrompt = input.includeSystemPrompt !== false;
    if (!includeSystemPrompt && rawPrompt.length === 0) {
      throw new Error('COVER_PROMPT_REQUIRED');
    }
    const coverTheme =
      this.coercePlainText(input.topic).trim() ||
      this.coercePlainText(input.articleTitle).trim() ||
      rawPrompt ||
      'Canvas封面主题';
    const standardPrompt = [
      `主题:${coverTheme}`,
      rawPrompt ? `补充提示词:${rawPrompt}` : '',
    ]
      .filter((part) => part.length > 0)
      .join('\n');
    const safeCoverText = this.sanitizeCoverText({
      title:
        this.coercePlainText(input.articleTitle).trim() ||
        coverTheme ||
        '封面',
      subtitle:
        rawPrompt ||
        coverTheme,
    });
    const tags = (Array.isArray(input.articleTags) ? input.articleTags : [])
      .map((tag) => this.coercePlainText(tag).trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 12);
    const prompt = includeSystemPrompt
      ? this.sanitizeCopyrightRiskText(
          [
            '请基于用户选择的参考图片一次性生成一张小红书图文封面。',
            '只使用本次选择的参考图片和本次输入的提示词，不复用旧封面提示词、旧封面文案或旧版式。',
            '多张参考图需要融合为同一张封面，不要分别出图，不要生成组图。',
            '仅生成封面图：保持主体真实、画面清晰、构图适合 3:4 竖版封面。',
            '可以做轻量修图、色彩校正、局部对比、干净排版和封面化增强。',
            '不要改变原图核心主体身份，不要影响 Canvas 中除封面外的其他图片。',
            `标准生图请求:\n${standardPrompt}`,
            '封面必须首先服务于主题，参考图只作为人物、场景、物料与风格来源。',
            '请围绕主题、文章标题和标签组织主体、场景和氛围，不要生成与主题无关的通用拼贴。',
            '如果参考图与主题冲突，优先保持主题相关性。',
            rawPrompt ? `用户提示词:${rawPrompt}` : '',
            input.topic ? `Canvas主题:${input.topic}` : '',
            input.articleTitle ? `文章标题:${input.articleTitle}` : '',
            tags.length > 0 ? `文章标签:${tags.join(', ')}` : '',
            safeCoverText.title ? `封面主标题:${safeCoverText.title}` : '',
            safeCoverText.subtitle
              ? `封面副标题:${safeCoverText.subtitle}`
              : '',
          ]
            .filter((part) => part.length > 0)
            .join('\n'),
        )
      : this.sanitizeCopyrightRiskText(rawPrompt);

    const generated = await this.agentService.sendPrompt({
      prompt,
      size: '640x853',
      baseImageCandidates,
      kind: 'cover',
      includeSystemPrompt,
    });
    const generatedRecord =
      generated && typeof generated === 'object'
        ? (generated as Record<string, unknown>)
        : {};
    const imagePath = this.coercePlainText(generatedRecord.imagePath).trim();
    if (!imagePath) {
      throw new Error('COVER_GENERATED_IMAGE_EMPTY');
    }
    const providerLabel = [
      this.coercePlainText(generatedRecord.providerCode).trim(),
      this.coercePlainText(generatedRecord.model).trim(),
    ]
      .filter((part) => part.length > 0)
      .join(':');
    const persisted = await this.persistGeneratedAssetToGallery({
      userId: input.userId,
      tenantId: input.tenantId,
      url: imagePath,
      generatedKind: 'cover',
      sourceImageIds,
      sourceImages,
      description: `Canvas封面重生成${providerLabel ? `(${providerLabel})` : ''}`,
    });
    if (!persisted) {
      throw new Error('COVER_GENERATED_IMAGE_PERSIST_FAILED');
    }
    return this.toGroupImage(persisted, 'cover', safeCoverText);
  }

  /**
   * @description 基于用户本次选择的最多 4 张图库图片重新生成图片组内页图，不添加封面标题并写入动态内页图库。
   * @param {object} input - 内页重生成输入。
   * @returns {Promise<CanvasGroupImage>} 可直接回写到 Canvas 指定内页 role 的图片。
   * @keyword-cn 内页重生成, 图片选择
   * @keyword-en inner-regenerate
   * @keyword-en image-group-image-slot
   */
  async regenerateInnerImage(input: {
    userId: string;
    tenantId?: string;
    topic?: string;
    articleTitle?: string;
    articleTags?: string[];
    role: Exclude<CanvasGroupImage['role'], 'cover'>;
    prompt?: string;
    includeSystemPrompt?: boolean;
    sourceImageIds: number[];
  }): Promise<CanvasGroupImage> {
    const sourceImageIds = Array.from(
      new Set(
        (Array.isArray(input.sourceImageIds) ? input.sourceImageIds : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.floor(id)),
      ),
    ).slice(0, REGENERATE_SOURCE_IMAGE_LIMIT);
    if (sourceImageIds.length === 0) {
      throw new Error('INNER_SOURCE_IMAGES_REQUIRED');
    }

    const sourceImages = await this.gallery.findAccessibleImagesByIds(
      input.userId,
      input.tenantId,
      sourceImageIds,
    );
    if (sourceImages.length === 0) {
      throw new Error('INNER_SOURCE_IMAGES_NOT_FOUND');
    }

    const baseImageCandidates = sourceImages
      .map((img) => this.resolveLocalPath(img) ?? String(img.url ?? '').trim())
      .filter((path): path is string => path.length > 0)
      .slice(0, REGENERATE_SOURCE_IMAGE_LIMIT);
    if (baseImageCandidates.length === 0) {
      throw new Error('INNER_SOURCE_IMAGES_NOT_READABLE');
    }

    const rawPrompt = this.coercePlainText(input.prompt).trim();
    // 是否叠加系统自带内页提示词;未勾选时只用用户本次提示词,此时提示词必填
    const includeSystemPrompt = input.includeSystemPrompt !== false;
    if (!includeSystemPrompt && rawPrompt.length === 0) {
      throw new Error('INNER_PROMPT_REQUIRED');
    }
    const tags = (Array.isArray(input.articleTags) ? input.articleTags : [])
      .map((tag) => this.coercePlainText(tag).trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 12);
    const prompt = includeSystemPrompt
      ? this.sanitizeCopyrightRiskText(
          [
            '请基于用户选择的参考图片生成一张小红书图文内页图片。',
            '只使用本次选择的参考图片和本次输入的提示词，不复用旧内页提示词、旧内页文字或旧版式。',
            '多张参考图需要融合为同一张内页图，不要分别出图，不要生成封面。',
            '画面比例为 3:4 竖版，主体真实清晰，构图适合手机端连续浏览。',
            '允许做轻量修图、调色、局部重构、背景整理和氛围增强，但不要影响 Canvas 中其他图片。',
            '内页重内容少文字：禁止添加封面主标题、副标题、营销大字、水印、平台 logo、网址、二维码或无关文字。',
            `目标内页:${input.role}`,
            rawPrompt ? `用户提示词:${rawPrompt}` : '',
            input.topic ? `Canvas主题:${input.topic}` : '',
            input.articleTitle ? `文章标题:${input.articleTitle}` : '',
            tags.length > 0 ? `文章标签:${tags.join(', ')}` : '',
          ]
            .filter((part) => part.length > 0)
            .join('\n'),
        )
      : this.sanitizeCopyrightRiskText(rawPrompt);

    const generated = await this.agentService.sendPrompt({
      prompt,
      size: '640x853',
      baseImageCandidates,
      kind: 'inner',
      includeSystemPrompt,
    });
    const generatedRecord =
      generated && typeof generated === 'object'
        ? (generated as Record<string, unknown>)
        : {};
    const imagePath = this.coercePlainText(generatedRecord.imagePath).trim();
    if (!imagePath) {
      throw new Error('INNER_GENERATED_IMAGE_EMPTY');
    }
    const providerLabel = [
      this.coercePlainText(generatedRecord.providerCode).trim(),
      this.coercePlainText(generatedRecord.model).trim(),
    ]
      .filter((part) => part.length > 0)
      .join(':');
    const persisted = await this.persistGeneratedAssetToGallery({
      userId: input.userId,
      tenantId: input.tenantId,
      url: imagePath,
      generatedKind: 'inner',
      sourceImageIds,
      sourceImages,
      description: `Canvas内页重生成${providerLabel ? `(${providerLabel})` : ''}`,
    });
    if (!persisted) {
      throw new Error('INNER_GENERATED_IMAGE_PERSIST_FAILED');
    }
    return this.toGroupImage(persisted, input.role);
  }

  /**
   * @description 仅做图片组源图准备：统一取图、统一分配竖图/横图，不生成 AI 封面、带文封面或拼图文件。
   * @param {CanvasImageGroupCreateInput} input - 创建入参。
   * @returns {Promise<ImageGroupSourcePreparation>} 分配结果；不足时返回 failed 图组。
   * @keyword-en prepare, source-allocation, no-render
   */
  async prepareImageGroupSources(
    input: CanvasImageGroupCreateInput,
  ): Promise<ImageGroupSourcePreparation> {
    const articles = input.articles ?? [];
    if (articles.length === 0) {
      return {
        ok: true,
        plans: [],
        stats: {
          requiredPortrait: 0,
          availablePortrait: 0,
          missingPortrait: 0,
          requiredLandscape: 0,
          availableLandscape: 0,
          missingLandscape: 0,
        },
        imageContexts: [],
        dynamicCoverGroupId: 0,
        dynamicCollageGroupId: 0,
        aiCoverEnabled: false,
      };
    }

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
    const excludedGeneratedGroupIds: (string | number)[] = [
      dynamicCoverGroupId,
      dynamicCollageGroupId,
    ].filter(
      (id): id is string | number =>
        (typeof id === 'number' && Number.isFinite(id)) ||
        typeof id === 'string',
    );
    // 严格按 tags 取池：图源不足不再跨 tag 补充（不足量由上游工具预检并询问用户）
    const pool = await this.fetchImagePool(
      input,
      allTags,
      poolSize,
      'regular',
      excludedGeneratedGroupIds,
    );
    // 对图片池进行随机打乱，避免封面和内页出现顺序性重复
    this.shuffleArray(pool);
    this.logger.debug(
      `[image-group] pool_ready pool=${pool.length} tags=${allTags.length}`,
    );

    // --- 3. 先做 Canvas 级统一分配；不足时整体进入补图流程，不再跨组复用 ---
    const allocation = this.planImageGroupAllocation(pool, articles);
    if (!allocation.ok) {
      this.logger.warn(
        `[image-group] insufficient_source_images articleCount=${articles.length} ` +
          `portrait=${allocation.stats.availablePortrait}/${allocation.stats.requiredPortrait} ` +
          `landscape=${allocation.stats.availableLandscape}/${allocation.stats.requiredLandscape}`,
      );
      return {
        ok: false,
        imageGroups: this.buildInsufficientImageGroups(articles),
        stats: allocation.stats,
      };
    }

    const imageContexts = allocation.plans.map((plan) =>
      this.summarizeImageContext(this.collectPlanSourceImages(plan)),
    );
    return {
      ok: true,
      plans: allocation.plans,
      stats: allocation.stats,
      imageContexts,
      dynamicCoverGroupId,
      dynamicCollageGroupId,
      aiCoverEnabled: await this.isAiCoverEnabled(input.tenantId),
    };
  }

  /**
   * @description 根据已完成的源图分配渲染图组：生成拼图、封面文案、AI 封面或烧字封面，并写入图库。
   * 并发数由 IMAGE_GROUP_RENDER_CONCURRENCY 环境变量控制，默认 1（串行）。
   * @param {CanvasImageGroupCreateInput} input - 创建入参。
   * @param {Extract<ImageGroupSourcePreparation, {ok: true}>} preparation - 已完成的源图分配结果。
   * @returns {Promise<CanvasImageGroup[]>} 渲染后的图片组。
   * @keyword-en render, prepared, image-group, concurrency
   */
  async renderPreparedImageGroups(
    input: CanvasImageGroupCreateInput,
    preparation: Extract<ImageGroupSourcePreparation, { ok: true }>,
  ): Promise<CanvasImageGroup[]> {
    const concurrency = Math.max(
      1,
      Number.parseInt(
        process.env['IMAGE_GROUP_RENDER_CONCURRENCY'] ?? '1',
        10,
      ) || 1,
    );
    const tasks = preparation.plans.map(
      (plan) => () => this.renderOnePlan(plan, input, preparation),
    );
    const results = await runConcurrent(tasks, concurrency);

    const groups: CanvasImageGroup[] = [];
    const usedSourceIds = new Set<number>();
    for (const { group, usedIds } of results) {
      groups.push(group);
      for (const id of usedIds) usedSourceIds.add(id);
    }

    if (usedSourceIds.size > 0) {
      try {
        await this.gallery.markUsedBatch({ ids: Array.from(usedSourceIds) });
        this.logger.debug(
          `[image-group] mark_used count=${usedSourceIds.size}`,
        );
      } catch (e) {
        this.logger.warn(`[image-group] mark_used failed: ${String(e)}`);
      }
    }

    return groups;
  }

  /**
   * @description 渲染单个图组计划（封面、内页、封面文案、AI 封面或烧字）。供 renderPreparedImageGroups 并发调用。
   * @keyword-en render, single-plan, image-group, cover-text
   */
  private async renderOnePlan(
    plan: ImageGroupAllocationPlan,
    input: CanvasImageGroupCreateInput,
    preparation: Extract<ImageGroupSourcePreparation, { ok: true }>,
  ): Promise<{ group: CanvasImageGroup; usedIds: number[] }> {
    const articles = input.articles ?? [];
    const i = plan.articleIndex;
    const art = articles[i];
    const layout = plan.layout;
    const coverSlot = plan.slots.find((slot) => slot.role === 'cover');
    const innerSlots = plan.slots.filter((slot) => slot.role !== 'cover');
    const groupImages: CanvasGroupImage[] = [];
    const contextImages: GalleryImageEntity[] = [];
    const contextImageIds = new Set<number>();
    const localUsedIds: number[] = [];

    const collectContextImage = (
      img: GalleryImageEntity | null | undefined,
    ): void => {
      if (!img) return;
      if (contextImageIds.has(img.id)) return;
      contextImageIds.add(img.id);
      contextImages.push(img);
    };
    const addUsedIds = (ids: number[]): void => {
      for (const id of ids) {
        if (Number.isFinite(id) && id > 0) localUsedIds.push(id);
      }
    };

    let ok = true;

    // 封面
    let coverPlan:
      | {
          kind: 'collage';
          image: GalleryImageEntity;
          imgA: GalleryImageEntity;
          imgB: GalleryImageEntity;
          collageUrl: string;
        }
      | {
          kind: 'portrait';
          image: GalleryImageEntity;
          alreadyDesigned: boolean;
        }
      | null = null;
    if (!coverSlot) {
      ok = false;
    } else if (coverSlot.kind === 'collage') {
      const collageResult = await this.persistPlannedCollage({
        userId: input.userId,
        tenantId: input.tenantId,
        imgA: coverSlot.imgA,
        imgB: coverSlot.imgB,
        targetGroupId: preparation.dynamicCoverGroupId,
        generatedKind: 'cover',
      });
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
        addUsedIds(collageResult.sourceIds);
      } else {
        ok = false;
      }
    } else {
      const coverImg = coverSlot.image;
      const alreadyDesigned = this.hasCoverTag(coverImg);
      coverPlan = {
        kind: 'portrait',
        image: coverImg,
        alreadyDesigned,
      };
      collectContextImage(coverImg);
      addUsedIds([coverImg.id]);
    }
    if (!coverPlan) ok = false;

    // 内页
    for (const slot of innerSlots) {
      if (slot.kind === 'collage') {
        const collageResult = await this.persistPlannedCollage({
          userId: input.userId,
          tenantId: input.tenantId,
          imgA: slot.imgA,
          imgB: slot.imgB,
          targetGroupId: preparation.dynamicCollageGroupId,
          generatedKind: 'collage',
        });
        if (collageResult) {
          groupImages.push(this.toGroupImage(collageResult.image, slot.role));
          collectContextImage(collageResult.imgA);
          collectContextImage(collageResult.imgB);
          addUsedIds(collageResult.sourceIds);
        } else {
          ok = false;
        }
      } else {
        const portraitImg = slot.image;
        groupImages.push(this.toGroupImage(portraitImg, slot.role));
        collectContextImage(portraitImg);
        addUsedIds([portraitImg.id]);
      }
    }

    // 封面文案：按”本组最终配图”语义生成（tags + description 汇总）
    if (coverPlan) {
      const imageContext =
        preparation.imageContexts[i] ??
        this.summarizeImageContext(contextImages);
      const rawCoverText =
        (
          await this.generateCoverTexts(
            input.topic,
            [art],
            [imageContext],
            input.tenantId,
          )
        )[0] ?? this.buildCoverText(art.title, i);
      const coverText = this.sanitizeCoverText(rawCoverText);

      const aiCover = preparation.aiCoverEnabled
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
            dynamicCoverGroupId: preparation.dynamicCoverGroupId,
          })
        : null;

      if (aiCover) {
        groupImages.unshift(this.toGroupImage(aiCover, 'cover', coverText));
        this.logger.debug(
          `[image-group] group_assigned idx=${i} layout=${layout} imageCount=${groupImages.length} status=${ok ? 'done' : 'failed'} cover=ai`,
        );
        return {
          group: {
            id: i + 1,
            articleId: art.title ? undefined : undefined,
            articleTitle: art.title,
            layout,
            images: groupImages,
            status: ok ? 'done' : 'failed',
          },
          usedIds: localUsedIds,
        };
      }

      if (coverPlan.kind === 'collage') {
        const burnedUrl = await this.burnCollageCoverText(
          { imgA: coverPlan.imgA, imgB: coverPlan.imgB },
          coverText,
        );
        const finalUrl = burnedUrl ?? coverPlan.collageUrl;
        const persistedCover =
          finalUrl === coverPlan.image.url
            ? coverPlan.image
            : await this.persistGeneratedAssetToGallery({
                userId: input.userId,
                tenantId: input.tenantId,
                url: finalUrl,
                generatedKind: 'cover',
                groupId: preparation.dynamicCoverGroupId,
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
              groupId: preparation.dynamicCoverGroupId,
              sourceImageIds: [coverPlan.image.id],
              sourceImages: [coverPlan.image],
              description: '画布单图封面（已烧录文案）',
            })
          : null;
        const finalCover = persistedCover ?? coverPlan.image;
        const coverCopy =
          coverPlan.alreadyDesigned || !persistedCover ? undefined : coverText;
        groupImages.unshift(this.toGroupImage(finalCover, 'cover', coverCopy));
      }
    }

    this.logger.debug(
      `[image-group] group_assigned idx=${i} layout=${layout} imageCount=${groupImages.length} status=${ok ? 'done' : 'failed'}`,
    );
    return {
      group: {
        id: i + 1,
        articleId: art.title ? undefined : undefined,
        articleTitle: art.title,
        layout,
        images: groupImages,
        status: ok ? 'done' : 'failed',
      },
      usedIds: localUsedIds,
    };
  }

  /**
   * @description 在 Canvas 级别一次性规划所有图组的源图，严格全局去重，不做跨组复用。
   * @param {GalleryImageEntity[]} pool - 已按 tags 取回并打乱的图片池。
   * @param {CanvasImageGroupCreateInput['articles']} articles - 图组文章列表。
   * @returns {ImageGroupAllocationResult} 分配结果与缺口统计。
   * @keyword-en plan, allocation, no-reuse
   */
  private planImageGroupAllocation(
    pool: GalleryImageEntity[],
    articles: CanvasImageGroupCreateInput['articles'],
  ): ImageGroupAllocationResult {
    const portraitPool = this.dedup(
      pool.filter((img) => img.isPortrait === true),
    );
    const landscapePool = this.dedup(
      pool.filter(
        (img) => img.isPortrait !== true && this.isLocalImageReadable(img),
      ),
    );

    let requestedGroups = this.buildImageGroupAllocationRequests(articles);
    let stats = this.summarizeImageGroupAllocationStats(
      requestedGroups,
      portraitPool.length,
      landscapePool.length,
    );

    const hasExplicitLayout = articles.some(
      (art) => typeof art.layout === 'string' && art.layout.length > 0,
    );
    if (stats.missingPortrait > 0 && !hasExplicitLayout) {
      const collageOnlyGroups = this.buildImageGroupAllocationRequests(
        articles,
        {
          forceAutoLayout: 'collage-cover-5collage',
        },
      );
      const collageOnlyStats = this.summarizeImageGroupAllocationStats(
        collageOnlyGroups,
        portraitPool.length,
        landscapePool.length,
      );
      if (collageOnlyStats.missingPortrait === 0) {
        this.logger.debug(
          `[image-group] allocation_layout_fallback layout=collage-cover-5collage ` +
            `portrait=${collageOnlyStats.availablePortrait}/${collageOnlyStats.requiredPortrait} ` +
            `landscape=${collageOnlyStats.availableLandscape}/${collageOnlyStats.requiredLandscape}`,
        );
        requestedGroups = collageOnlyGroups;
        stats = collageOnlyStats;
      }
    }

    if (stats.missingPortrait > 0 || stats.missingLandscape > 0) {
      return { ok: false, stats };
    }

    return this.allocateRequestedImageGroups(
      requestedGroups,
      portraitPool,
      landscapePool,
      stats,
    );
  }

  /**
   * @description 根据文章列表生成图组版式槽位需求；未显式指定版式时可由调用方强制使用自适应版式。
   * @param {CanvasImageGroupCreateInput['articles']} articles - 图组文章列表。
   * @param {{ forceAutoLayout?: ImageGroupLayout }} [options] - 自动版式覆盖参数。
   * @returns {ImageGroupAllocationRequest[]} 每个图组的槽位需求。
   * @keyword-en plan, allocation, layout
   */
  private buildImageGroupAllocationRequests(
    articles: CanvasImageGroupCreateInput['articles'],
    options?: { forceAutoLayout?: ImageGroupLayout },
  ): ImageGroupAllocationRequest[] {
    const innerRoles: ImageGroupImageRole[] = [
      'inner-1',
      'inner-2',
      'inner-3',
      'inner-4',
      'inner-5',
    ];
    return articles.map((art, articleIndex) => {
      const layout =
        art.layout ??
        options?.forceAutoLayout ??
        ALTERNATING_LAYOUTS[articleIndex % ALTERNATING_LAYOUTS.length];
      const spec = LAYOUT_SPECS[layout];
      const slots: ImageGroupSlotRequirement[] = [
        { kind: spec.cover, role: 'cover' },
        ...spec.inner.map(
          (kind, idx): ImageGroupSlotRequirement => ({
            kind,
            role: innerRoles[idx] ?? 'inner-5',
          }),
        ),
      ];
      return {
        articleIndex,
        articleTitle: art.title,
        layout,
        slots,
      };
    });
  }

  /**
   * @description 统计一次图组分配所需的竖图/横图数量以及当前素材池缺口。
   * @param {ImageGroupAllocationRequest[]} requestedGroups - 图组槽位需求。
   * @param {number} availablePortrait - 可用竖图数量。
   * @param {number} availableLandscape - 可用横图数量。
   * @returns {ImageGroupAllocationStats} 分配需求与缺口统计。
   * @keyword-en stats, allocation, shortage
   */
  private summarizeImageGroupAllocationStats(
    requestedGroups: ImageGroupAllocationRequest[],
    availablePortrait: number,
    availableLandscape: number,
  ): ImageGroupAllocationStats {
    const requiredPortrait = requestedGroups.reduce(
      (sum, group) =>
        sum + group.slots.filter((slot) => slot.kind === 'portrait').length,
      0,
    );
    const requiredLandscape = requestedGroups.reduce(
      (sum, group) =>
        sum + group.slots.filter((slot) => slot.kind === 'collage').length * 2,
      0,
    );
    return {
      requiredPortrait,
      availablePortrait,
      missingPortrait: Math.max(0, requiredPortrait - availablePortrait),
      requiredLandscape,
      availableLandscape,
      missingLandscape: Math.max(0, requiredLandscape - availableLandscape),
    };
  }

  /**
   * @description 按已确认的槽位需求实际领取源图，保证同一 Canvas 内源图不跨组复用。
   * @param {ImageGroupAllocationRequest[]} requestedGroups - 图组槽位需求。
   * @param {GalleryImageEntity[]} portraitPool - 去重后的竖图池。
   * @param {GalleryImageEntity[]} landscapePool - 去重后的横图池。
   * @param {ImageGroupAllocationStats} stats - 已计算的需求统计。
   * @returns {ImageGroupAllocationResult} 分配好的图组计划。
   * @keyword-en allocate, no-reuse, image-group
   */
  private allocateRequestedImageGroups(
    requestedGroups: ImageGroupAllocationRequest[],
    portraitPool: GalleryImageEntity[],
    landscapePool: GalleryImageEntity[],
    stats: ImageGroupAllocationStats,
  ): ImageGroupAllocationResult {
    let portraitCursor = 0;
    let landscapeCursor = 0;
    const usedSourceIds = new Set<number>();
    const takePortrait = (): GalleryImageEntity | null => {
      while (portraitCursor < portraitPool.length) {
        const img = portraitPool[portraitCursor++];
        if (usedSourceIds.has(img.id)) continue;
        usedSourceIds.add(img.id);
        return img;
      }
      return null;
    };
    const takeLandscape = (): GalleryImageEntity | null => {
      while (landscapeCursor < landscapePool.length) {
        const img = landscapePool[landscapeCursor++];
        if (usedSourceIds.has(img.id)) continue;
        usedSourceIds.add(img.id);
        return img;
      }
      return null;
    };

    const plans: ImageGroupAllocationPlan[] = [];
    for (const group of requestedGroups) {
      const slots: ImageGroupPlannedSlot[] = [];
      for (const slot of group.slots) {
        if (slot.kind === 'portrait') {
          const image = takePortrait();
          if (!image) return { ok: false, stats };
          slots.push({ kind: 'portrait', role: slot.role, image });
          continue;
        }
        const imgA = takeLandscape();
        const imgB = takeLandscape();
        if (!imgA || !imgB) return { ok: false, stats };
        slots.push({ kind: 'collage', role: slot.role, imgA, imgB });
      }
      plans.push({
        articleIndex: group.articleIndex,
        articleTitle: group.articleTitle,
        layout: group.layout,
        slots,
      });
    }

    return { ok: true, plans, stats };
  }

  /**
   * @description 构造图源不足时的失败图组，让上游把文章/Canvas 标记为需要人工补图。
   * @param {CanvasImageGroupCreateInput['articles']} articles - 图组文章列表。
   * @returns {CanvasImageGroup[]} 空图片失败图组列表。
   * @keyword-en insufficient, requires-human, image-group
   */
  private buildInsufficientImageGroups(
    articles: CanvasImageGroupCreateInput['articles'],
  ): CanvasImageGroup[] {
    return articles.map((art, idx) => ({
      id: idx + 1,
      articleId: art.title ? undefined : undefined,
      articleTitle: art.title,
      layout:
        art.layout ?? ALTERNATING_LAYOUTS[idx % ALTERNATING_LAYOUTS.length],
      images: [],
      status: 'failed',
    }));
  }

  /**
   * @description 收集一个图组分配计划中的全部源图，用于文章正文和封面文案共享图片语义。
   * @param {ImageGroupAllocationPlan} plan - 已分配的图组计划。
   * @returns {GalleryImageEntity[]} 去重后的源图列表。
   * @keyword-en collect, allocation, image-context
   */
  private collectPlanSourceImages(
    plan: ImageGroupAllocationPlan,
  ): GalleryImageEntity[] {
    const map = new Map<number, GalleryImageEntity>();
    for (const slot of plan.slots) {
      if (slot.kind === 'portrait') {
        map.set(slot.image.id, slot.image);
        continue;
      }
      map.set(slot.imgA.id, slot.imgA);
      map.set(slot.imgB.id, slot.imgB);
    }
    return Array.from(map.values());
  }

  /**
   * @description 将已经统一分配好的两张横图合成为拼图并入库。
   * @param {object} input - 拼图生成与入库参数。
   * @returns {Promise<{ image: GalleryImageEntity; sourceIds: number[]; imgA: GalleryImageEntity; imgB: GalleryImageEntity; collageUrl: string } | null>} 入库后的拼图信息。
   * @keyword-en collage, allocation, gallery
   */
  private async persistPlannedCollage(input: {
    userId: string;
    tenantId?: string;
    imgA: GalleryImageEntity;
    imgB: GalleryImageEntity;
    targetGroupId?: string | number;
    generatedKind: 'cover' | 'collage';
  }): Promise<{
    image: GalleryImageEntity;
    sourceIds: number[];
    imgA: GalleryImageEntity;
    imgB: GalleryImageEntity;
    collageUrl: string;
  } | null> {
    const collageUrl = await this.createDynamicCollageFile(
      input.imgA,
      input.imgB,
    );
    if (!collageUrl) return null;
    const sourceIds = [input.imgA.id, input.imgB.id];
    const persisted = await this.persistGeneratedAssetToGallery({
      userId: input.userId,
      tenantId: input.tenantId,
      url: collageUrl,
      generatedKind: input.generatedKind,
      groupId: input.targetGroupId,
      sourceImageIds: sourceIds,
      sourceImages: [input.imgA, input.imgB],
      description:
        input.generatedKind === 'cover'
          ? '画布动态拼图封面'
          : '画布动态拼图内页',
    });
    if (!persisted) {
      this.logger.warn(
        `[image-group] generated collage not persisted, skip pair a=${input.imgA.id} b=${input.imgB.id}`,
      );
      return null;
    }
    return {
      image: persisted,
      sourceIds,
      imgA: input.imgA,
      imgB: input.imgB,
      collageUrl: persisted.url,
    };
  }

  /**
   * @description 选 2 张横图并动态合成拼图（仅接受横图，不降级为竖图或任意方向图片）
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
  ): Promise<{
    image: GalleryImageEntity;
    sourceIds: number[];
    imgA: GalleryImageEntity;
    imgB: GalleryImageEntity;
    collageUrl: string;
  } | null> {
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
            if (globalLandscapeIds.has(a.id) || globalLandscapeIds.has(b.id))
              continue;
          }
          if (options.requireAtLeastOneFreshLandscape) {
            if (globalLandscapeIds.has(a.id) && globalLandscapeIds.has(b.id))
              continue;
          }
          return [a, b];
        }
      }
      return null;
    };

    const buildCandidates = (
      allowGlobalReuse: boolean,
    ): { landscape: GalleryImageEntity[] } => {
      const landscape = pool.filter((img) => {
        if (localUsedIds.has(img.id)) return false;
        if (!allowGlobalReuse && globalUsedIds.has(img.id)) return false;
        if (img.isPortrait === true) return false;
        return this.isLocalImageReadable(img);
      });
      return { landscape };
    };

    const triedPairs = new Set<string>();
    // 严格按已收集池选对，图源不足不再额外补充（参数 relatedTags 仍保留以便日志/后续策略）
    void relatedTags;

    const attemptPick = (): [GalleryImageEntity, GalleryImageEntity] | null => {
      // 1) 横图 + 两张都未占用（全局唯一优先）
      {
        const { landscape } = buildCandidates(false);
        const pair = pickPair(
          landscape,
          { requireBothFreshLandscape: true },
          triedPairs,
        );
        if (pair) return pair;
      }
      // 2) 横图 + 至少一张未占用
      {
        const { landscape } = buildCandidates(false);
        const pair = pickPair(
          landscape,
          { requireAtLeastOneFreshLandscape: true },
          triedPairs,
        );
        if (pair) return pair;
      }
      // 3) 横图 + 两张都未占用（仍保持全局唯一）
      {
        const { landscape } = buildCandidates(false);
        const pair = pickPair(landscape, {}, triedPairs);
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
   * @description 将封面文案/生图提示中的高风险 IP、商标和角色专名替换为版权安全泛化表达。
   * @param {unknown} raw - 原始文本。
   * @returns {string} 可用于封面文案和生图提示的安全文本。
   * @keyword-en sanitize, copyright-safe, image-prompt
   */
  private sanitizeCopyrightRiskText(raw: unknown): string {
    let text = this.coercePlainText(raw)
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
      .replace(/[\u0020\u0009\u3000]+/g, ' ')
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
   * @description 清洗列表型封面上下文，去重后返回版权安全表达。
   * @param {unknown[] | undefined} items - 原始列表。
   * @returns {string[]} 安全文案列表。
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
   * @description 清洗封面主副标题，避免可见文案携带 IP/商标专名。
   * @param {{ title: string; subtitle: string }} coverText - 原始封面文案。
   * @returns {{ title: string; subtitle: string }} 安全封面文案。
   * @keyword-en sanitize, cover-copy, copyright-safe
   */
  private sanitizeCoverText(coverText: { title: string; subtitle: string }): {
    title: string;
    subtitle: string;
  } {
    return {
      title: this.sanitizeCopyrightRiskText(coverText.title) || '沉浸式体验',
      subtitle:
        this.sanitizeCopyrightRiskText(coverText.subtitle) || '现场氛围与互动',
    };
  }

  /**
   * @description 构建封面生图提示词。封面元信息骨架（选题/文章标题/封面主副标题/封面版式）
   * 之外，显式注入封面专属的视觉调性（小红书生活方式封面感、动态视觉元素、装饰丰富度、文案
   * 排版、活力色彩、情绪氛围等）—— 让底图编辑模型在保持底图主体的前提下产出更"封面化、
   * 更有活力"的成图。通用图生图硬约束（底图保真/输出纯净度等）由
   * {@link AgentService.buildMeituEditPrompt} 在下游补齐。
   * @param {object} input - 提示词上下文。
   * @returns {string} 生图提示词。
   * @keyword-en build ai cover prompt with rich visual style directives
   */
  private buildAiCoverPrompt(input: {
    topic?: string;
    articleTitle?: string;
    coverText: { title: string; subtitle: string };
    coverType: 'portrait' | 'collage';
  }): string {
    const safeTopic = this.sanitizeCopyrightRiskText(input.topic);
    const safeArticleTitle = this.sanitizeCopyrightRiskText(input.articleTitle);
    const safeCoverText = this.sanitizeCoverText(input.coverText);
    // 封面视觉调性：实景优先，轻设计增强。
    const themeAnchor = safeTopic || safeArticleTitle || '所给主题';
    const styleDirectives = [
      '【封面视觉要求 - 实景照片优先，轻量封面设计】',
      '- 第一优先级:保持真实摄影/现场实拍质感，保留原图人物、空间、活动氛围和真实光影，不改成插画、卡通、3D Q版、漫画、像素、赛博或二次元风格。',
      '- 画面增强:只做轻量修图与封面化处理，包括适度提亮、清晰度增强、自然色彩校正、轻微景深、局部对比和干净排版。',
      '- 主体表达:主体保持真实比例和真实动作，允许轻微优化表情与姿态，但不要夸张变形、不要新增夸张肢体动作。',
      '- 装饰控制:最多 1-2 个轻量标签、箭头或简洁色块作为辅助，禁止大量贴纸、emoji、手绘涂鸦、漫画气泡和密集几何拼贴。',
      '- 特效控制:不要流动光带、爆裂粒子、速度线、漫画冲击线、拟声词图形、故障艺术、霓虹大片光效；如需氛围，只允许自然光晕或柔和高光。',
      '- 色彩:真实、明亮、干净，适合小红书生活方式封面；避免过饱和撞色、糖果色堆叠和强烈渐变。',
      '- 文案表现:封面主标题清晰可读，使用干净粗体或描边字体；副标题用小字辅助；文字不要遮挡人物脸部、产品或关键场景。',
      '- 构图:以真实场景中的人物/空间/活动为核心，三分法或居中构图，留出文字区域，画面自然有呼吸感。',
      `- 情绪锚定:贴合"${themeAnchor}"的核心情绪，表达真实、轻松、沉浸、有现场感的体验。`,
      '- 严禁:动画化、漫画化、游戏化、夸张特效、虚构角色、过度滤镜、过度磨皮、低清晰度、脏污背景、复杂装饰堆砌。',
    ].join('\n');

    const safeMeta = [
      input.coverType === 'collage' ? '封面版式:拼图封面' : '封面版式:单图封面',
      safeTopic ? `选题:${safeTopic}` : '',
      safeArticleTitle ? `文章标题:${safeArticleTitle}` : '',
      safeCoverText.title ? `封面主标题:${safeCoverText.title}` : '',
      safeCoverText.subtitle ? `封面副标题:${safeCoverText.subtitle}` : '',
      '版权安全:不得出现或模仿任何具体 IP、商标、影视动漫游戏角色、官方徽章、制服、学院组织名、经典道具或官方视觉符号；只保留通用氛围。',
    ]
      .filter((x) => x.length > 0)
      .join('；');

    return [safeMeta, this.sanitizeCopyrightRiskText(styleDirectives)]
      .filter((x) => x.length > 0)
      .join('\n\n');
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
      const prompt = this.sanitizeCopyrightRiskText(
        this.buildAiCoverPrompt({
          topic: input.topic,
          articleTitle: input.articleTitle,
          coverText: input.coverText,
          coverType: input.coverType,
        }),
      );
      const baseImageCandidates = input.sourceImages
        .map(
          (img) => this.resolveLocalPath(img) ?? String(img.url ?? '').trim(),
        )
        .filter((x): x is string => String(x ?? '').trim().length > 0)
        .slice(0, 6);

      const generated = await this.agentService.sendPrompt({
        prompt,
        size: '640x853',
        baseImageCandidates,
      });
      const generatedRecord =
        generated && typeof generated === 'object'
          ? (generated as Record<string, unknown>)
          : {};
      const imagePath = this.coercePlainText(generatedRecord.imagePath).trim();
      if (!imagePath) {
        this.logger.warn(
          '[image-group] ai_cover_generate_failed: empty imagePath',
        );
        return null;
      }
      const providerLabel = [
        this.coercePlainText(generatedRecord.providerCode).trim(),
        this.coercePlainText(generatedRecord.model).trim(),
      ]
        .filter((part) => part.length > 0)
        .join(':');

      const sourceImageIds = input.sourceImages
        .map((img) => Number(img?.id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .slice(0, 2);

      return await this.persistGeneratedAssetToGallery({
        userId: input.userId,
        tenantId: input.tenantId,
        url: imagePath,
        generatedKind: 'cover',
        groupId: input.dynamicCoverGroupId,
        sourceImageIds,
        sourceImages: input.sourceImages,
        description: `AI生成封面（${providerLabel || 'unknown'}）`,
      });
    } catch (err) {
      this.logger.warn(
        `[image-group] ai_cover_generate_failed: ${this.describeUnknown(err)}`,
      );
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
      this.logger.warn(
        `[image-group] burnCollageCoverText skip: no local path resolved imgA=${imgA.id} imgB=${imgB.id}`,
      );
      return null;
    }
    if (!existsSync(pathA)) {
      this.logger.warn(
        `[image-group] burnCollageCoverText skip: file not exist imgA=${imgA.id} pathA=${pathA}`,
      );
      return null;
    }
    if (!existsSync(pathB)) {
      this.logger.warn(
        `[image-group] burnCollageCoverText skip: file not exist imgB=${imgB.id} pathB=${pathB}`,
      );
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
        [...String(s)].reduce(
          (n, c) => n + (/[\u3400-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1),
          0,
        );

      // 按视觉宽度拆行
      const splitLines = (s: string, maxUnits: number): string[] => {
        const lines: string[] = [];
        let cur = '';
        let curUnits = 0;
        for (const ch of s) {
          const w = /[\u3400-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
          if (curUnits + w > maxUnits && cur.length > 0) {
            lines.push(cur);
            cur = ch;
            curUnits = w;
          } else {
            cur += ch;
            curUnits += w;
          }
        }
        if (cur.length > 0) lines.push(cur);
        return lines;
      };

      const topH = Math.floor(COLLAGE_HEIGHT / 2);
      const bottomH = COLLAGE_HEIGHT - topH;

      // 上图：等比缩到 topH 高度，不裁剪
      const bufA = await sharp(pathA)
        .resize({ width: COLLAGE_WIDTH, height: topH })
        .toBuffer();
      // 下图：等比缩到 bottomH 高度，不裁剪
      const bufB = await sharp(pathB)
        .resize({ width: COLLAGE_WIDTH, height: bottomH })
        .toBuffer();

      // 计算字体大小
      const titleFontSize = Math.max(
        34,
        Math.min(60, Math.floor(900 / Math.max(10, visualWidth(safeTitle)))),
      );
      const subtitleFontSize = safeSubtitle
        ? Math.max(
            22,
            Math.min(
              34,
              Math.floor(760 / Math.max(12, visualWidth(safeSubtitle))),
            ),
          )
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
        : Math.min(
            220,
            Math.max(110, titleFontSize * Math.max(1, titleLines.length) + 48),
          );
      const seamMaskY = Math.floor((COLLAGE_HEIGHT - seamMaskHeight) / 2);

      const titleTspans = (titleLines.length > 0 ? titleLines : [''])
        .map(
          (line, idx) =>
            `<tspan x="50%" dy="${idx === 0 ? 0 : 1.15}em">${this.escapeSvgText(line)}</tspan>`,
        )
        .join('');
      const subtitleTspans = subtitleLines
        .map(
          (line, idx) =>
            `<tspan x="50%" dy="${idx === 0 ? 0 : 1.2}em">${this.escapeSvgText(line)}</tspan>`,
        )
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
      this.logger.warn(
        `[image-group] burnCollageCoverText error: ${this.describeUnknown(err)}`,
      );
      return null;
    }
  }

  /**
   * @description 选一张竖图（优先未使用的；不降级为横图）
   * @param {GalleryImageEntity[]} pool - 图片池
   * @param {Set<number>} localUsedIds - 组内已使用 ID
   * @param {Set<number>} globalUsedIds - 全局已使用 ID
   * @returns {GalleryImageEntity | null}
   * @keyword-en pick one portrait image
   */
  private pickPortrait(
    pool: GalleryImageEntity[],
    localUsedIds: Set<number>,
    globalUsedIds: Set<number>,
  ): GalleryImageEntity | null {
    // 优先：竖图 + 未在全局使用
    const p1 = pool.find(
      (img) =>
        !localUsedIds.has(img.id) &&
        !globalUsedIds.has(img.id) &&
        img.isPortrait === true,
    );
    return p1 ?? null;
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

    // 去重；不足时不再补随机/跨 tag，保留原样供上游做不足量决策
    return this.dedup(this.filterOutExcludedGroups(images, excludedGroupIds));
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
  private summarizeImageContext(images: GalleryImageEntity[]): {
    tags: string[];
    descriptions: string[];
  } {
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
   * @keyword-cn 封面文案, 工具内部非流
   * @keyword-en cover-text, internal-llm-nostream
   */
  private async generateCoverTexts(
    topic: string | undefined,
    articles: Array<{ title: string; tags: string[] }>,
    imageContexts?: Array<{ tags: string[]; descriptions: string[] }>,
    tenantId?: string,
  ): Promise<Array<{ title: string; subtitle: string }>> {
    const fallback = articles.map((a, i) => this.buildCoverText(a.title, i));
    try {
      const llm = await this.agentService.buildLLM({
        nonStreaming: true,
        temperature: 0.8,
        tenantId,
      });
      const titlesBlock = articles
        .map((a, i) => {
          const articleTags = this.sanitizeCopyrightRiskList(
            Array.isArray(a.tags) ? a.tags : [],
          );
          const ctx = imageContexts?.[i];
          const ctxTags = this.sanitizeCopyrightRiskList(
            Array.isArray(ctx?.tags) ? ctx.tags : [],
          ).slice(0, 24);
          const ctxDescs = this.sanitizeCopyrightRiskList(
            Array.isArray(ctx?.descriptions) ? ctx.descriptions : [],
          ).slice(0, 6);
          const parts = [
            `${i + 1}. 文章标题：${a.title}`,
            articleTags.length > 0
              ? `   文章标签：${articleTags.join('、')}`
              : '',
            ctxTags.length > 0 ? `   配图标签汇总：${ctxTags.join('、')}` : '',
            ctxDescs.length > 0
              ? `   配图描述汇总：${ctxDescs.join('；')}`
              : '',
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
      const res = await llm.invoke(
        prompt,
        this.agentService.buildNoStreamInvokeOption(),
      );
      const parseArray = (input: unknown): unknown[] | null => {
        const inputArray = this.copyUnknownArray(input);
        if (inputArray) {
          const looksLikeCoverItems = inputArray.every(
            (item) =>
              item &&
              typeof item === 'object' &&
              !Array.isArray(item) &&
              ('title' in item || 'subtitle' in item),
          );
          if (looksLikeCoverItems) return inputArray;
          const stitched = inputArray
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
          const items = this.copyUnknownArray(rec.items);
          if (items) return items;
          const data = this.copyUnknownArray(rec.data);
          if (data) return data;
          const contentItems = this.copyUnknownArray(rec.content);
          if (contentItems) {
            const parsed = parseArray(contentItems);
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
            const direct = this.copyUnknownArray(parsed);
            if (direct) return direct;
            if (parsed && typeof parsed === 'object') {
              const rec = parsed as Record<string, unknown>;
              const items = this.copyUnknownArray(rec.items);
              if (items) return items;
              const data = this.copyUnknownArray(rec.data);
              if (data) return data;
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
      if (!arr || arr.length === 0)
        return fallback.map((fb) => this.sanitizeCoverText(fb));
      return fallback.map((fb, i) => {
        const v = arr[i];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const item = v as Record<string, unknown>;
          const rawTitle = this.coercePlainText(item.title).trim();
          const rawSubtitle = this.coercePlainText(item.subtitle).trim();
          // 清理破折号、连接号等奇怪符号
          const cleanDash = (s: string): string =>
            s.replace(/[—–−‐‑‒–ー]/g, '');
          const title = this.sanitizeCopyrightRiskText(cleanDash(rawTitle));
          const subtitle = this.sanitizeCopyrightRiskText(
            cleanDash(rawSubtitle),
          );
          return this.sanitizeCoverText({
            title: title.length >= 2 ? title : fb.title,
            subtitle,
          });
        }
        return this.sanitizeCoverText(fb);
      });
    } catch (err) {
      this.logger.warn(
        `[image-group] LLM cover text failed, using fallback: ${this.describeUnknown(err)}`,
      );
      return fallback.map((fb) => this.sanitizeCoverText(fb));
    }
  }

  /**
   * @description 将文章标题截短为适合封面展示的文案（LLM 失败时的兜底方案）
   * @param {string} title - 文章标题
   * @param {number} index - 图组序号
   * @returns {string} 封面文案
   * @keyword-en build cover text from article title
   */
  private buildCoverText(
    title: string | undefined,
    index: number,
  ): { title: string; subtitle: string } {
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
    const url = String(img.url ?? '')
      .trim()
      .replace(/\\/g, '/');
    if (!url || /^https?:\/\//i.test(url)) return undefined;
    if (url.startsWith('/static/uploads/')) {
      return join(
        process.cwd(),
        'public',
        'uploads',
        url.slice('/static/uploads/'.length),
      );
    }
    if (url.startsWith('/uploads/')) {
      return join(process.cwd(), 'public', url.slice(1));
    }
    if (url.startsWith('/')) {
      return join(process.cwd(), 'public', url.slice(1));
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
      this.logger.warn(
        `[image-group] burnCoverText skip: no local file for imgId=${img.id}`,
      );
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
        [...String(s)].reduce(
          (n, c) => n + (/[\u3400-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1),
          0,
        );

      /** @description 按视觉宽度拆行 */
      const splitLines = (s: string, maxUnits: number): string[] => {
        const lines: string[] = [];
        let cur = '';
        let curUnits = 0;
        for (const ch of s) {
          const w = /[\u3400-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
          if (curUnits + w > maxUnits && cur.length > 0) {
            lines.push(cur);
            cur = ch;
            curUnits = w;
          } else {
            cur += ch;
            curUnits += w;
          }
        }
        if (cur.length > 0) lines.push(cur);
        return lines;
      };

      const titleFontSize = Math.max(
        34,
        Math.min(60, Math.floor(900 / Math.max(10, visualWidth(safeTitle)))),
      );
      const subtitleFontSize = safeSubtitle
        ? Math.max(
            22,
            Math.min(
              34,
              Math.floor(760 / Math.max(12, visualWidth(safeSubtitle))),
            ),
          )
        : 28;
      const titleLines = splitLines(safeTitle, 30);
      const subtitleLines = safeSubtitle ? splitLines(safeSubtitle, 30) : [];
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
      const subtitleEscaped = safeSubtitle
        ? this.escapeSvgText(safeSubtitle)
        : '';

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
      this.logger.warn(
        `[image-group] burnCoverText error imgId=${img.id}: ${this.describeUnknown(err)}`,
      );
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
        } catch {
          /* skip */
        }
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
      try {
        await access(tmpFont);
      } catch {
        await copyFile(fontFilePath, tmpFont);
      }
      const confPath = `${tmpDir}/fonts.conf`;
      try {
        await access(confPath);
      } catch {
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
   * @description 从上传URL解析图库落库所需的文件名与绝对路径。
   * @param {string} url - 图片URL。
   * @returns {{ fileName: string; absPath: string; normalizedUrl: string } | null} 解析结果。
   * @keyword-en resolve generated upload file info from url
   */
  private resolveGeneratedUploadFileInfo(
    url: string,
  ): { fileName: string; absPath: string; normalizedUrl: string } | null {
    const raw = String(url ?? '')
      .trim()
      .replace(/\\/g, '/');
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
      if (rel.startsWith('static/uploads/'))
        rel = rel.slice('static/uploads/'.length);
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
   * @param {'cover'|'collage'|'inner'} generatedKind - 生成类型。
   * @param {GalleryImageEntity[]} [sourceImages] - 来源图片。
   * @returns {string[]} 标签列表。
   * @keyword-en build generated asset tags
   */
  private buildGeneratedAssetTags(
    generatedKind: GeneratedAssetKind,
    sourceImages?: GalleryImageEntity[],
  ): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: unknown): void => {
      const t = this.coercePlainText(raw).trim();
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
    } else if (generatedKind === 'collage') {
      ['拼图', '拼图封面', '动态拼图', '自动拼图', '自动生成'].forEach(push);
    } else {
      ['内页', 'canvas内页', '动态内页', '自动内页', '自动生成'].forEach(push);
    }
    return out.slice(0, 40);
  }

  /**
   * @description 将画布生成出的封面/拼图/内页文件持久化到图库，确保返回真实 imageId。
   * @param {{ userId: string; tenantId?: string; url: string; generatedKind: 'cover'|'collage'|'inner'; groupId?: string | number; sourceImageIds?: number[]; sourceImages?: GalleryImageEntity[]; description?: string }} input - 持久化入参。
   * @returns {Promise<GalleryImageEntity | null>} 入库后的图库实体。
   * @keyword-en persist generated canvas asset to gallery
   */
  private async persistGeneratedAssetToGallery(input: {
    userId: string;
    tenantId?: string;
    url: string;
    generatedKind: GeneratedAssetKind;
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
    let finalGroupId = isValidGroupId(input.groupId)
      ? input.groupId
      : undefined;
    if (finalGroupId === undefined) {
      if (input.generatedKind === 'cover') {
        const coverGroup =
          await this.galleryGroups.findOrCreateDynamicCoverGroup(
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
    const thumb = await this.gallery.generateThumbnail(
      file.absPath,
      file.fileName,
    );

    const sourceIds = Array.isArray(input.sourceImageIds)
      ? input.sourceImageIds
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x))
          .slice(0, 8)
      : [];

    const tags = this.buildGeneratedAssetTags(
      input.generatedKind,
      input.sourceImages,
    );
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
            (input.generatedKind === 'cover'
              ? '画布动态封面'
              : input.generatedKind === 'inner'
                ? '画布动态内页'
                : '画布动态拼图'),
          isCollage: input.generatedKind !== 'inner',
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
      const normalizedUrl = this.coercePlainText(file.normalizedUrl).trim();
      this.logger.warn(
        `[image-group] persistGeneratedAssetToGallery failed url=${normalizedUrl} err=${this.describeUnknown(error)}`,
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
      const sharp = typeof maybeDefault === 'function' ? maybeDefault : mod;
      if (typeof sharp === 'function') return sharp as typeof import('sharp');
      this.logger.warn('[image-group] sharp module is not callable');
      return null;
    } catch (err) {
      this.logger.warn(
        `[image-group] sharp load failed: ${this.describeUnknown(err)}`,
      );
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
  private async createDynamicCollageFile(
    imgA: GalleryImageEntity,
    imgB: GalleryImageEntity,
  ): Promise<string | null> {
    const pathA = this.resolveLocalPath(imgA);
    const pathB = this.resolveLocalPath(imgB);
    if (!pathA || !pathB) {
      this.logger.warn(
        `[image-group] createDynamicCollageFile skip: no local path resolved for imgA=${imgA.id} imgB=${imgB.id}`,
      );
      return null;
    }
    if (!existsSync(pathA)) {
      this.logger.warn(
        `[image-group] createDynamicCollageFile skip: file not exist imgA=${imgA.id} pathA=${pathA}`,
      );
      return null;
    }
    if (!existsSync(pathB)) {
      this.logger.warn(
        `[image-group] createDynamicCollageFile skip: file not exist imgB=${imgB.id} pathB=${pathB}`,
      );
      return null;
    }
    try {
      const sharp = await this.loadSharp();
      if (!sharp) return null;

      const topH = Math.floor(COLLAGE_HEIGHT / 2);
      const bottomH = COLLAGE_HEIGHT - topH;

      // 上图：等比缩到 topH 高度，不裁剪
      const bufA = await sharp(pathA)
        .resize({ width: COLLAGE_WIDTH, height: topH })
        .toBuffer();
      // 下图：等比缩到 bottomH 高度，不裁剪
      const bufB = await sharp(pathB)
        .resize({ width: COLLAGE_WIDTH, height: bottomH })
        .toBuffer();

      const outDir = join(
        process.cwd(),
        'public',
        'uploads',
        'canvas-collages',
      );
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
      this.logger.warn(
        `[image-group] createDynamicCollageFile error imgA=${imgA.id} imgB=${imgB.id}: ${this.describeUnknown(err)}`,
      );
      return null;
    }
  }

  /**
   * @description 计算 2/3/4 张拼图在固定 640×853(3:4) 画布上的网格单元格位置。
   * @param {number} count - 图片数量（2/3/4）。
   * @returns {Array<{ left: number; top: number; width: number; height: number }>} 单元格列表，顺序对应输入图片。
   * @keyword-cn 拼图版式, 多图拼图
   * @keyword-en multi-collage, collage-layout
   */
  private resolveMultiCollageCells(
    count: number,
  ): Array<{ left: number; top: number; width: number; height: number }> {
    const W = COLLAGE_WIDTH;
    const H = COLLAGE_HEIGHT;
    const topH = Math.floor(H / 2);
    const bottomH = H - topH;
    const halfW = Math.floor(W / 2);
    const rightW = W - halfW;
    if (count <= 2) {
      // 2 张：上下两等分
      return [
        { left: 0, top: 0, width: W, height: topH },
        { left: 0, top: topH, width: W, height: bottomH },
      ];
    }
    if (count === 3) {
      // 3 张：上 1 通栏 + 下 2 并排
      return [
        { left: 0, top: 0, width: W, height: topH },
        { left: 0, top: topH, width: halfW, height: bottomH },
        { left: halfW, top: topH, width: rightW, height: bottomH },
      ];
    }
    // 4 张：2×2 宫格
    return [
      { left: 0, top: 0, width: halfW, height: topH },
      { left: halfW, top: 0, width: rightW, height: topH },
      { left: 0, top: topH, width: halfW, height: bottomH },
      { left: halfW, top: topH, width: rightW, height: bottomH },
    ];
  }

  /**
   * @description 将 2/3/4 张图库图片合成为固定 640×853(3:4) 竖版拼图，按网格充满单元格(fit:cover)，不烧录任何文字。
   * @param {GalleryImageEntity[]} images - 2-4 张待合成图片（多余的截断到 4 张）。
   * @returns {Promise<string | null>} 拼图静态路径(/static/uploads/canvas-collages/...)，失败返回 null。
   * @keyword-cn 多图拼图, 拼图合成
   * @keyword-en multi-collage, collage-compose
   */
  private async createMultiCollageFile(
    images: GalleryImageEntity[],
  ): Promise<string | null> {
    const picked = (Array.isArray(images) ? images : []).slice(0, 4);
    if (picked.length < 2) return null;
    if (picked.length === 2) {
      // 复用经过验证的双图上下拼实现
      return this.createDynamicCollageFile(picked[0], picked[1]);
    }
    const paths = picked.map((img) => this.resolveLocalPath(img));
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      if (!p || !existsSync(p)) {
        this.logger.warn(
          `[image-group] createMultiCollageFile skip: no readable local path img=${picked[i]?.id}`,
        );
        return null;
      }
    }
    try {
      const sharp = await this.loadSharp();
      if (!sharp) return null;
      const cells = this.resolveMultiCollageCells(picked.length);
      const tiles = await Promise.all(
        paths.map(async (p, idx) => {
          const cell = cells[idx];
          const buf = await sharp(p as string)
            .resize({ width: cell.width, height: cell.height, fit: 'cover' })
            .toBuffer();
          return { input: buf, top: cell.top, left: cell.left };
        }),
      );
      const outDir = join(process.cwd(), 'public', 'uploads', 'canvas-collages');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const outName = `collage-${randomUUID()}.png`;
      const outPath = join(outDir, outName);
      await sharp({
        create: {
          width: COLLAGE_WIDTH,
          height: COLLAGE_HEIGHT,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite(tiles)
        .png()
        .toFile(outPath);
      return `/static/uploads/canvas-collages/${outName}`;
    } catch (err) {
      this.logger.warn(
        `[image-group] createMultiCollageFile error count=${picked.length}: ${this.describeUnknown(err)}`,
      );
      return null;
    }
  }

  /**
   * @description 将用户本次多选的 2-4 张图库图片合成为 3:4 拼图并写入动态拼图图库，返回持久化图片，供"直接设图"槽位复用。
   * @param {object} input - 合成入参（当前租户 + 源图 ID + 生成类型 + 可选目标分组）。
   * @returns {Promise<GalleryImageEntity | null>} 入库后的拼图图片实体，失败返回 null。
   * @keyword-cn 多图拼图, 直接设图拼图
   * @keyword-en multi-collage, select-collage
   */
  async composeSelectedCollage(input: {
    userId: string;
    tenantId?: string;
    sourceImageIds: number[];
    generatedKind?: 'cover' | 'collage';
    groupId?: string | number;
  }): Promise<GalleryImageEntity | null> {
    const sourceImageIds = Array.from(
      new Set(
        (Array.isArray(input.sourceImageIds) ? input.sourceImageIds : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.floor(id)),
      ),
    ).slice(0, 4);
    if (sourceImageIds.length < 2) return null;

    const sourceImages = await this.gallery.findAccessibleImagesByIds(
      input.userId,
      input.tenantId,
      sourceImageIds,
    );
    if (sourceImages.length < 2) return null;

    const collageUrl = await this.createMultiCollageFile(sourceImages);
    if (!collageUrl) return null;

    const generatedKind = input.generatedKind ?? 'collage';
    return this.persistGeneratedAssetToGallery({
      userId: input.userId,
      tenantId: input.tenantId,
      url: collageUrl,
      generatedKind,
      groupId: input.groupId,
      sourceImageIds: sourceImages.map((img) => Number(img.id)),
      sourceImages,
      description:
        generatedKind === 'cover'
          ? `画布多图拼图封面(${sourceImages.length}图)`
          : `画布多图拼图(${sourceImages.length}图)`,
    });
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
      ...(coverCopy?.title
        ? { text: coverCopy.title, subtitle: coverCopy.subtitle }
        : {}),
    };
  }
}
