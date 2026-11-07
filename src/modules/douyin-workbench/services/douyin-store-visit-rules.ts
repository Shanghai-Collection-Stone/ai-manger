import type {
  DouyinStoreVisitSceneImage,
  DouyinStoreVisitSceneVideo,
  DouyinStoreVisitSegment,
} from '../entities/douyin-workbench.entity.js';
import type {
  DouyinStoreVisitSpot,
  DouyinStoreVisitSpotImage,
} from '../entities/douyin-store-visit-store.entity.js';
import {
  isStoreVisitVisualStart,
  storeVisitVisualSource,
} from './douyin-store-visit-continuity.js';
import { STORE_VISIT_SCENE_IMAGES_PER_SPOT } from './douyin-store-visit-planner.service.js';
import { DOUYIN_STORE_VISIT_CLASSIFY_BATCH } from './douyin-store-visit-spot.service.js';

/**
 * @description 探店出镜方式：只配解说、开头有人打招呼，以及旧数据里的全程出镜、首尾出镜。
 * @keyword-cn 探店出镜方式, 镜头模板
 * @keyword-en store-visit-template, shot-template
 */
export type StoreVisitTemplateKey =
  'voiceover' | 'opening' | 'presenter-all' | 'bookend';

/**
 * @description 按台词字数估算口播秒数（每秒约 4.5 字，与桌面端 `estimateLinesSeconds` 同规则），出片前拦下超出单段上限的段。
 * @keyword-cn 台词时长估算, 单段时长校验
 * @keyword-en estimate-lines-seconds, segment-duration-check
 * @param {string} lines 台词。
 * @returns {number} 估算秒数，空台词为 0。
 */
export function estimateStoreVisitLinesSeconds(lines: string): number {
  const count = String(lines || '').replace(/\s+/g, '').length;
  return count ? Math.max(1, Math.round(count / 4.5)) : 0;
}

/**
 * @description 生成探店分段 ID（`seg-时间-随机`），与桌面端 `createStoreVisitSegmentId` 同格式。
 * @keyword-cn 分段ID生成, 探店分段
 * @keyword-en create-segment-id, store-visit-segment
 * @returns {string} 分段 ID。
 */
export function createStoreVisitSegmentId(): string {
  return `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @description 按出镜方式重排各段镜头类型（与桌面端 `applyStoreVisitTemplate` 同规则）：要出镜的段改成人物镜头并沿用或补上画面来源，
 *   其余段回到实景镜头，原来是人物或体验镜头的去掉画面来源（有场景图时用照片来源）。
 * @keyword-cn 套用出镜方式, 镜头类型重排
 * @keyword-en apply-store-visit-template, reassign-shots
 * @param {DouyinStoreVisitSegment[]} segments 分段。
 * @param {StoreVisitTemplateKey} template 出镜方式。
 * @param {'generated'|'references'} [presenterSource] 人物镜头的画面来源。
 * @param {'original'} [photoSource] 实景镜头的照片来源。
 * @returns {DouyinStoreVisitSegment[]} 重排后的分段。
 */
export function applyStoreVisitTemplate(
  segments: DouyinStoreVisitSegment[],
  template: string,
  presenterSource: 'generated' | 'references' = 'generated',
  photoSource: 'original' = 'original',
): DouyinStoreVisitSegment[] {
  const last = segments.length - 1;
  /** @description 这一段按出镜方式是否要人物出镜。 @keyword-cn 判断出镜段, 出镜位置 @keyword-en presenter-at, presenter-position */
  const presenterAt = (index: number) =>
    template === 'presenter-all'
      ? true
      : template === 'bookend'
        ? index === 0 || index === last
        : template === 'opening'
          ? index === 0
          : false;
  if (!['presenter-all', 'bookend', 'opening', 'voiceover'].includes(template))
    return segments;
  return segments.map((segment, index) => {
    if (presenterAt(index))
      return {
        ...segment,
        shot: 'presenter',
        visualSource:
          segment.shot === 'presenter' && segment.visualSource
            ? segment.visualSource
            : presenterSource,
      };
    if (segment.shot !== 'presenter' && segment.shot !== 'experience')
      return { ...segment, shot: 'broll' };
    const rest: DouyinStoreVisitSegment = { ...segment };
    delete rest.visualSource;
    return {
      ...rest,
      shot: 'broll',
      ...(segment.sceneImageId ? { visualSource: photoSource } : {}),
    };
  });
}

/**
 * @description 分段转保存参数（与桌面端 `toSegmentsPayload` 同规则）：去掉出片结果等服务端字段，台词、场景名与念法去空白，视频素材与照片素材二选一，空台词段丢掉。
 * @keyword-cn 分段保存参数, 分段清洗
 * @keyword-en segments-payload, clean-segments
 * @param {DouyinStoreVisitSegment[]} segments 分段。
 * @returns {DouyinStoreVisitSegment[]} 保存参数。
 */
export function toStoreVisitSegmentsPayload(
  segments: DouyinStoreVisitSegment[],
): DouyinStoreVisitSegment[] {
  return segments
    .map((segment) => ({
      id: segment.id,
      lines: String(segment.lines ?? '').trim(),
      ...(segment.scene?.trim()
        ? { scene: segment.scene.trim().slice(0, 60) }
        : {}),
      ...(segment.sceneVideoId
        ? {
            sceneVideoId: segment.sceneVideoId,
            ...(Number(segment.clipStart) > 0
              ? { clipStart: Number(segment.clipStart) }
              : {}),
          }
        : segment.sceneImageId
          ? {
              sceneImageId: segment.sceneImageId,
              ...((segment.sceneImageIds?.length ?? 0) > 1
                ? { sceneImageIds: segment.sceneImageIds!.slice(0, 3) }
                : {}),
            }
          : {}),
      ...(segment.spotId ? { spotId: segment.spotId } : {}),
      ...(!segment.sceneVideoId && segment.motion
        ? { motion: segment.motion }
        : {}),
      ...(segment.action?.trim() ? { action: segment.action.trim() } : {}),
      ...(segment.delivery?.trim()
        ? { delivery: segment.delivery.trim().slice(0, 40) }
        : {}),
      ...(segment.shot === 'presenter' || segment.shot === 'experience'
        ? { shot: segment.shot }
        : {}),
      ...(!segment.sceneVideoId && segment.visualSource
        ? { visualSource: segment.visualSource }
        : {}),
    }))
    .filter((segment) => segment.lines);
}

/**
 * @description 去掉一段的场景（点位、照片、实拍视频与入点），换店或重新配场景前用。
 * @keyword-cn 清掉分段场景, 换店清场景
 * @keyword-en clear-segment-scene, reset-on-store-switch
 * @param {DouyinStoreVisitSegment} segment 分段。
 * @returns {DouyinStoreVisitSegment} 不带场景的分段。
 */
export function withoutStoreVisitScene(
  segment: DouyinStoreVisitSegment,
): DouyinStoreVisitSegment {
  const rest: DouyinStoreVisitSegment = { ...segment };
  delete rest.spotId;
  delete rest.sceneImageId;
  delete rest.sceneImageIds;
  delete rest.sceneVideoId;
  delete rest.clipStart;
  return rest;
}

/**
 * @description 点位图片按精细度打分从高到低排，同分保持原顺序（与桌面端 `rankSpotImages` 同规则）。
 * @keyword-cn 点位图片排序, 打分优先
 * @keyword-en rank-spot-images, score-first
 * @param {Pick<DouyinStoreVisitSpot, 'images'>} spot 点位。
 * @returns {DouyinStoreVisitSpotImage[]} 排好的图片。
 */
export function rankStoreVisitSpotImages(
  spot: Pick<DouyinStoreVisitSpot, 'images'> | undefined,
): DouyinStoreVisitSpotImage[] {
  return [...(spot?.images ?? [])]
    .map((image, index) => ({ image, index }))
    .sort(
      (a, b) =>
        (Number(b.image.score) || 0) - (Number(a.image.score) || 0) ||
        a.index - b.index,
    )
    .map((item) => item.image);
}

/**
 * @description 分段用到的门店点位（按出现顺序去重，只认这家店还在的点位）。
 * @keyword-cn 分段所用点位, 点位顺序
 * @keyword-en segment-used-spots, spot-order
 * @param {DouyinStoreVisitSegment[]} segments 分段。
 * @param {{spots: DouyinStoreVisitSpot[]}} store 门店。
 * @returns {string[]} 点位 ID。
 */
export function usedStoreVisitSpotIds(
  segments: DouyinStoreVisitSegment[],
  store: { spots: DouyinStoreVisitSpot[] },
): string[] {
  return [
    ...new Set(
      segments
        .map((segment) => segment.spotId)
        .filter((id): id is string =>
          Boolean(id && store.spots.some((spot) => spot.id === id)),
        ),
    ),
  ];
}

/**
 * @description 把分段用到的点位同步成选题的参考素材（与桌面端 `spotsToTopicMaterials` 同规则）：每个点位按打分取最多 4 张图，
 *   只有实拍视频的点位带它的第一段视频，开场门头点位的最高分图作开场素材。
 * @keyword-cn 点位转选题素材, 参考图同步
 * @keyword-en spots-to-topic-materials, reference-sync
 * @param {{spots: DouyinStoreVisitSpot[]}} store 门店。
 * @param {string[]} spotIds 分段用到的点位 ID。
 * @returns {{sceneImages: DouyinStoreVisitSceneImage[], sceneVideos: DouyinStoreVisitSceneVideo[], openingScene: {type: 'image', id: number}|null}} 选题素材。
 */
export function spotsToStoreVisitMaterials(
  store: { spots: DouyinStoreVisitSpot[] },
  spotIds: string[],
): {
  sceneImages: DouyinStoreVisitSceneImage[];
  sceneVideos: DouyinStoreVisitSceneVideo[];
  openingScene: { type: 'image'; id: number } | null;
} {
  const picked = spotIds
    .map((id) => store.spots.find((spot) => spot.id === id))
    .filter((spot): spot is DouyinStoreVisitSpot => Boolean(spot));
  const sceneImages = picked.flatMap((spot) =>
    rankStoreVisitSpotImages(spot)
      .slice(0, STORE_VISIT_SCENE_IMAGES_PER_SPOT)
      .map((image, index) => ({
        type: 'image' as const,
        id: Number(image.imageId),
        name: `${spot.name} · 图${index + 1}`,
        url: image.url,
        coverUrl: image.thumbUrl || image.url,
        description:
          `${spot.name}：${image.description || spot.description || spot.name}`.slice(
            0,
            500,
          ),
        tags: [String(spot.name).slice(0, 30)],
      })),
  );
  const sceneVideos = picked
    .filter((spot) => !spot.images?.length && spot.videos?.length)
    .map((spot) => {
      const video = spot.videos[0];
      return {
        type: 'video' as const,
        id: Number(video.videoId),
        name: video.name || spot.name,
        url: video.url,
        ...(video.coverUrl ? { coverUrl: video.coverUrl } : {}),
        description:
          `${spot.name}：${video.description || spot.description || spot.name}`.slice(
            0,
            500,
          ),
        tags: [String(spot.name).slice(0, 30)],
        ...(video.durationSeconds
          ? { durationSeconds: video.durationSeconds }
          : {}),
      };
    });
  const opening = picked.find((spot) => spot.opening && spot.images?.length);
  return {
    sceneImages,
    sceneVideos,
    openingScene: opening
      ? {
          type: 'image',
          id: Number(rankStoreVisitSpotImages(opening)[0].imageId),
        }
      : null,
  };
}

/**
 * @description 需要先生成人物首帧的镜头起点（与桌面端 `storeVisitSceneStarts` 同规则）：只挑 AI 合成人物画面的新镜头，同场景同用途只挑一次。
 * @keyword-cn 场景画面准备, 人物首帧起点
 * @keyword-en scene-frame-preparation, presenter-keyframe-starts
 * @param {DouyinStoreVisitSegment[]} segments 分段。
 * @returns {DouyinStoreVisitSegment[]} 要准备首帧的段。
 */
export function storeVisitSceneStarts(
  segments: DouyinStoreVisitSegment[],
): DouyinStoreVisitSegment[] {
  const seen = new Set<string>();
  return segments.filter((segment, index) => {
    const starts = isStoreVisitVisualStart(segments, index);
    const key = `${segment.sceneImageId}:${segment.shot}`;
    if (
      !starts ||
      storeVisitVisualSource(segment) !== 'generated' ||
      seen.has(key)
    )
      return false;
    seen.add(key);
    return true;
  });
}

/**
 * @description 已保存的分段里同场景同用途的人物首帧（与桌面端 `keyframeOf` 同规则），有就不必再生成。
 * @keyword-cn 复用人物首帧, 首帧查找
 * @keyword-en reuse-keyframe, find-keyframe
 * @param {DouyinStoreVisitSegment} segment 要生成的分段。
 * @param {DouyinStoreVisitSegment[]} saved 已保存的分段。
 * @returns {DouyinStoreVisitSegment['keyframe']|null} 首帧引用。
 */
export function storeVisitKeyframeOf(
  segment: DouyinStoreVisitSegment,
  saved: DouyinStoreVisitSegment[],
): DouyinStoreVisitSegment['keyframe'] | null {
  if (storeVisitVisualSource(segment) !== 'generated') return null;
  return (
    saved.find(
      (item) =>
        item.sceneImageId === segment.sceneImageId &&
        item.shot === segment.shot &&
        storeVisitVisualSource(item) === 'generated' &&
        item.keyframe,
    )?.keyframe || null
  );
}

/**
 * @description 把 AI 配好的场景写进分段（与桌面端 `matchScenes` 同规则）：配上的段先清旧场景再写点位与实拍视频或 1～3 张照片，没配上的保持原样。
 * @keyword-cn 写入配好的场景, 分段配图
 * @keyword-en apply-scene-matches, segment-scenes
 * @param {DouyinStoreVisitSegment[]} segments 分段。
 * @param {Array<{id: string, spotId: string, sceneImageId?: number, sceneImageIds?: number[], sceneVideoId?: number}>} matches 配场景结果。
 * @returns {DouyinStoreVisitSegment[]} 配好场景的分段。
 */
export function applyStoreVisitSceneMatches(
  segments: DouyinStoreVisitSegment[],
  matches: Array<{
    id: string;
    spotId: string;
    sceneImageId?: number;
    sceneImageIds?: number[];
    sceneVideoId?: number;
  }>,
): DouyinStoreVisitSegment[] {
  const byId = new Map(matches.map((item) => [item.id, item]));
  return segments.map((segment) => {
    const match = byId.get(segment.id);
    if (!match?.spotId) return segment;
    return {
      ...withoutStoreVisitScene(segment),
      spotId: match.spotId,
      ...(match.sceneVideoId
        ? { sceneVideoId: match.sceneVideoId }
        : match.sceneImageId
          ? {
              sceneImageId: match.sceneImageId,
              ...((match.sceneImageIds?.length ?? 0) > 1
                ? { sceneImageIds: match.sceneImageIds }
                : {}),
            }
          : {}),
    };
  });
}

/**
 * @description 按相似度预分组打包 AI 归类批次（与桌面端 `packClassifyBatches` 同规则）：同组尽量同批，组太大时拆开，每批不超过上限，组外散图补空位。
 * @keyword-cn 归类批次打包, 预分组同批
 * @keyword-en pack-classify-batches, keep-clusters-together
 * @param {number[][]} clusters 预分组（单张也成组）。
 * @param {number} [size] 每批上限。
 * @returns {number[][]} 批次。
 */
export function packStoreVisitClassifyBatches(
  clusters: number[][],
  size: number = DOUYIN_STORE_VISIT_CLASSIFY_BATCH,
): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  for (const cluster of clusters) {
    for (let start = 0; start < cluster.length; start += size) {
      const chunk = cluster.slice(start, start + size);
      if (current.length + chunk.length > size) {
        if (current.length) batches.push(current);
        current = [];
      }
      current = [...current, ...chunk];
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * @description 点位转整体保存参数（与桌面端 `toSpotsPayload` 同规则）：已有点位带 ID，图片只带 ID、描述与打分，视频只带 ID 与说明。
 * @keyword-cn 点位保存参数, 编辑态转换
 * @keyword-en spots-payload, draft-to-payload
 * @param {Array<Partial<DouyinStoreVisitSpot>>} spots 点位。
 * @returns {Array<{id?: string, name: string, description: string, opening?: boolean, images: Array<{imageId: number, description: string, score: number}>, videos: Array<{videoId: number, description: string}>}>} 保存参数。
 */
export function toStoreVisitSpotsPayload(
  spots: Array<{
    id?: string;
    name?: string;
    description?: string;
    opening?: boolean;
    images?: Array<{ imageId: number; description?: string; score?: number }>;
    videos?: Array<{ videoId: number; description?: string }>;
  }>,
) {
  return spots.map((spot) => ({
    ...(spot.id ? { id: spot.id } : {}),
    name: String(spot.name || '')
      .trim()
      .slice(0, 30),
    description: String(spot.description || '')
      .trim()
      .slice(0, 500),
    ...(spot.opening ? { opening: true } : {}),
    images: (spot.images || []).map((image) => ({
      imageId: Number(image.imageId),
      description: String(image.description || '').slice(0, 300),
      score: Number(image.score) || 5,
    })),
    videos: (spot.videos || []).map((video) => ({
      videoId: Number(video.videoId),
      description: String(video.description || '').slice(0, 500),
    })),
  }));
}
