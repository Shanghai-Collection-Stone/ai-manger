import { Injectable, Logger } from '@nestjs/common';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import type { GalleryImageEntity } from '../../gallery/entities/gallery-image.entity.js';
import type {
  DouyinMediaReference,
  DouyinStoryboardShot,
} from '../entities/douyin-workbench.entity.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 分镜自动配图时交给 LLM 的一张候选图片：只保留选图需要的语义信息和写回分镜的地址。
 * @keyword-cn 分镜候选图片, 自动配图
 * @keyword-en storyboard-image-candidate, auto-image-attach
 */
export interface StoryboardImageCandidate {
  id: number;
  name: string;
  url: string;
  coverUrl: string;
  tags: string[];
  description: string;
  isPortrait: boolean;
}

/**
 * @description 一次分镜生成最多给 LLM 看多少张候选图，太多会挤占上下文并让选择变随机。
 * @keyword-cn 候选图片上限, 上下文预算
 * @keyword-en image-candidate-limit, context-budget
 */
export const STORYBOARD_IMAGE_CANDIDATE_LIMIT = 40;

/**
 * @description 不参与分镜配图的系统标签：各类生成封面与 AI 文字海报素材都已带字或是拼贴成品，不适合作为镜头画面。
 * @keyword-cn 排除系统标签, 封面素材
 * @keyword-en excluded-system-tags, cover-material
 */
export const STORYBOARD_EXCLUDED_IMAGE_TAGS = [
  '封面',
  '拼图封面',
  '自动封面',
  'canvas封面',
  'ai素材',
];

/**
 * @description 把图库实体转成候选图片，缺地址的记录返回 null。
 * @keyword-cn 图库转候选, 候选图片
 * @keyword-en gallery-to-candidate, storyboard-image-candidate
 */
function toCandidate(
  image: GalleryImageEntity,
): StoryboardImageCandidate | null {
  const url = String(image?.url ?? '').trim();
  const id = Number(image?.id);
  if (!url || !Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    name: String(image.originalName || image.fileName || `图片 #${id}`),
    url,
    coverUrl: String(image.thumbUrl || url),
    tags: (Array.isArray(image.tags) ? image.tags : [])
      .map((tag) => String(tag ?? '').trim())
      .filter(Boolean),
    description: String(image.description ?? '').trim(),
    isPortrait: image.isPortrait === true,
  };
}

/**
 * @description 把候选图片转成分镜素材引用，结构与前端手动「引用素材」一致。
 * @keyword-cn 候选转素材引用, 分镜素材
 * @keyword-en candidate-to-media-reference, storyboard-media
 */
export function toImageMediaReference(
  candidate: StoryboardImageCandidate,
): DouyinMediaReference {
  return {
    type: 'image',
    id: candidate.id,
    name: candidate.name,
    url: candidate.url,
    coverUrl: candidate.coverUrl,
  };
}

/**
 * @description 生成给 LLM 的候选图片清单：每行 `#ID｜竖/横｜标签｜描述`，描述截断避免占满上下文。
 * @keyword-cn 候选图片清单, 选图提示词
 * @keyword-en image-candidate-list, image-pick-prompt
 */
export function buildImageCandidatePrompt(
  candidates: StoryboardImageCandidate[],
): string {
  if (!candidates.length) {
    return '当前图库没有可用图片，分镜不要传 image_id。';
  }
  const lines = candidates.map((candidate) =>
    [
      `#${candidate.id}`,
      candidate.isPortrait ? '竖图' : '横图',
      candidate.tags.length
        ? `标签：${candidate.tags.slice(0, 6).join('、')}`
        : '无标签',
      candidate.description ? candidate.description.slice(0, 60) : '',
    ]
      .filter(Boolean)
      .join('｜'),
  );
  return [
    '【可用图片】以下是当前租户图库里与本选题相关的真实图片，每段分镜从中挑一张最贴合画面的，把编号数字传给 image_id：',
    ...lines,
    '选图规则：优先选标签和描述与本镜头画面最匹配的图；尽量不同镜头用不同图片；实在没有贴合的可以不传 image_id，系统会按相关度自动补图。',
  ].join('\n');
}

/**
 * @description 按镜头文字与候选图片标签、描述的重合度打分：命中一个标签 +3，描述里每个在镜头文字中出现的二字片段 +1。
 * @keyword-cn 镜头配图打分, 标签重合
 * @keyword-en shot-image-score, tag-overlap
 */
export function scoreImageForShot(
  shot: Pick<DouyinStoryboardShot, 'visual' | 'narration' | 'shotType'>,
  candidate: StoryboardImageCandidate,
): number {
  const text = `${shot.visual} ${shot.narration} ${shot.shotType}`;
  let score = 0;
  for (const tag of candidate.tags) {
    if (tag.length >= 2 && text.includes(tag)) score += 3;
  }
  const description = candidate.description.replace(/\s+/g, '').slice(0, 80);
  const seen = new Set<string>();
  for (let index = 0; index < description.length - 1; index += 1) {
    const gram = description.slice(index, index + 2);
    if (seen.has(gram) || !/[一-龥]{2}/.test(gram)) continue;
    seen.add(gram);
    if (text.includes(gram)) score += 1;
  }
  return score;
}

/**
 * @description 给还没有素材的镜头自动补图：优先选没被用过且得分最高的候选，分数相同按候选相关度顺序；
 *   候选都用过一轮后才允许重复。已有素材（LLM 选的或用户引用的）不动。返回补图数量。
 * @keyword-cn 自动补图, 镜头配图
 * @keyword-en auto-assign-shot-images, shot-image-match
 */
export function autoAssignShotImages(
  shots: DouyinStoryboardShot[],
  candidates: StoryboardImageCandidate[],
): number {
  if (!candidates.length) return 0;
  const usage = new Map<number, number>();
  for (const shot of shots) {
    if (shot.media?.type === 'image') {
      usage.set(shot.media.id, (usage.get(shot.media.id) ?? 0) + 1);
    }
  }
  let assigned = 0;
  for (const shot of shots) {
    if (shot.media) continue;
    // 先比使用次数（少的优先），再比得分（高的优先）；都相同时保留靠前的候选（相关度更高）
    let best = candidates[0];
    let bestUsage = usage.get(best.id) ?? 0;
    let bestScore = scoreImageForShot(shot, best);
    for (const candidate of candidates.slice(1)) {
      const candidateUsage = usage.get(candidate.id) ?? 0;
      const candidateScore = scoreImageForShot(shot, candidate);
      if (
        candidateUsage < bestUsage ||
        (candidateUsage === bestUsage && candidateScore > bestScore)
      ) {
        best = candidate;
        bestUsage = candidateUsage;
        bestScore = candidateScore;
      }
    }
    shot.media = toImageMediaReference(best);
    usage.set(best.id, bestUsage + 1);
    assigned += 1;
  }
  return assigned;
}

/**
 * @description 为分镜生成挑选候选图片：先按选题语义做向量检索，再按命中选题文字的图库标签取图，
 *   不够时用随机普通图补足；排除拼图、各类封面与 AI 文字素材，全部按当前租户隔离。
 * @keyword-cn 分镜候选图片, 自动配图
 * @keyword-en storyboard-image-candidate, auto-image-attach
 */
@Injectable()
export class DouyinStoryboardImageService {
  private readonly logger = new Logger(DouyinStoryboardImageService.name);

  constructor(private readonly gallery: GalleryService) {}

  /**
   * @description 按「向量检索 → 标签命中 → 随机补足」的顺序收集去重候选图，任一路失败只记日志不影响分镜生成。
   *   传了 `limitTags` 时只收带其中任一标签的图：向量结果按标签过滤，随机补足也只在这些标签里取，不会混入其他图。
   * @keyword-cn 收集候选图片, 相关度排序, 图库标签限定
   * @keyword-en load-image-candidates, relevance-order, gallery-tag-filter
   * @param query 母题、子题与补充要求拼成的检索文本。
   * @param scope 当前租户用户作用域。
   * @param limitTags 用户为脚本限定的图库标签，空数组表示不限。
   * @returns {Promise<StoryboardImageCandidate[]>} 按相关度排好的候选图，最多 40 张。
   */
  async loadCandidates(
    query: string,
    scope: DouyinScope,
    limitTags: string[] = [],
  ): Promise<StoryboardImageCandidate[]> {
    const excluded = new Set(STORYBOARD_EXCLUDED_IMAGE_TAGS);
    const allowed = new Set(limitTags.filter((tag) => !excluded.has(tag)));
    const limited = limitTags.length > 0;
    const picked = new Map<number, StoryboardImageCandidate>();
    const add = (images: GalleryImageEntity[]) => {
      for (const image of images) {
        if (picked.size >= STORYBOARD_IMAGE_CANDIDATE_LIMIT) return;
        if (image?.isCollage === true) continue;
        if ((image?.tags ?? []).some((tag) => excluded.has(tag))) continue;
        if (limited && !(image?.tags ?? []).some((tag) => allowed.has(tag)))
          continue;
        const candidate = toCandidate(image);
        if (candidate && !picked.has(candidate.id)) {
          picked.set(candidate.id, candidate);
        }
      }
    };

    try {
      const similar = await this.gallery.searchSimilar(
        query,
        undefined,
        scope.tenantId,
        // 限定标签时向量结果还要再过滤一轮，多取一些才留得下足够的相关图
        limited ? 60 : 24,
        0.35,
        'regular',
      );
      add(similar.map((row) => row.image));
    } catch (error) {
      this.logger.warn(
        `[loadCandidates] 向量检索不可用，改用标签匹配：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      if (limited) {
        if (allowed.size && picked.size < STORYBOARD_IMAGE_CANDIDATE_LIMIT) {
          add(
            await this.gallery.sampleRandom({
              tenantId: scope.tenantId,
              tags: [...allowed],
              imageType: 'regular',
              excludedTags: STORYBOARD_EXCLUDED_IMAGE_TAGS,
              includeUsed: true,
              limit: STORYBOARD_IMAGE_CANDIDATE_LIMIT,
            }),
          );
        }
        return [...picked.values()];
      }
      if (picked.size < STORYBOARD_IMAGE_CANDIDATE_LIMIT) {
        const tags = await this.gallery.listDistinctTagsWithTenant(
          undefined,
          scope.tenantId,
          2000,
        );
        const matchedTags = tags
          .filter((tag) => tag.length >= 2 && !excluded.has(tag))
          .filter((tag) => query.includes(tag))
          .slice(0, 12);
        if (matchedTags.length) {
          add(
            await this.gallery.sampleRandom({
              tenantId: scope.tenantId,
              tags: matchedTags,
              imageType: 'regular',
              excludedTags: STORYBOARD_EXCLUDED_IMAGE_TAGS,
              includeUsed: true,
              limit: 30,
            }),
          );
        }
      }
      if (picked.size < STORYBOARD_IMAGE_CANDIDATE_LIMIT) {
        add(
          await this.gallery.sampleRandom({
            tenantId: scope.tenantId,
            imageType: 'regular',
            excludedTags: STORYBOARD_EXCLUDED_IMAGE_TAGS,
            includeUsed: true,
            limit: STORYBOARD_IMAGE_CANDIDATE_LIMIT,
          }),
        );
      }
    } catch (error) {
      this.logger.warn(
        `[loadCandidates] 读取图库失败，本次分镜不配图：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return [...picked.values()];
  }
}
