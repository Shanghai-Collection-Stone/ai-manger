import type {
  DouyinMediaReference,
  DouyinStoreVisitSceneImage,
  DouyinStoreVisitSceneVideo,
  DouyinStoreVisitSegment,
  DouyinStoreVisitSetting,
  DouyinStoryboardShot,
  DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import { createStoreVisitSegmentId } from './douyin-store-visit-rules.js';
import { DOUYIN_STORE_VISIT_SEGMENT_LIMITS } from './douyin-workbench-repository.service.js';

/**
 * @description 把镜头合并到不超过分段上限：每次合并相邻两镜里旁白加起来最短的一对，合并后保留前一镜的 ID、画面与配图，旁白按顺序接起来。
 * @keyword-cn 合并分镜镜头, 分段上限
 * @keyword-en merge-shots-to-limit, segment-limit
 * @param {DouyinStoryboardShot[]} shots 有旁白的镜头。
 * @param {number} limit 最多几段。
 * @returns {DouyinStoryboardShot[]} 合并后的镜头。
 */
export function mergeShotsToLimit(
  shots: DouyinStoryboardShot[],
  limit: number,
): DouyinStoryboardShot[] {
  const list = shots.map((shot) => ({ ...shot }));
  while (list.length > Math.max(1, limit)) {
    let best = 0;
    for (let index = 1; index < list.length - 1; index += 1) {
      const length = (index: number) =>
        list[index].narration.length + list[index + 1].narration.length;
      if (length(index) < length(best)) best = index;
    }
    const [first, second] = list.slice(best, best + 2);
    list.splice(best, 2, {
      ...first,
      narration: `${first.narration}${second.narration}`,
      media: first.media || second.media,
      visual: first.visual || second.visual,
    });
  }
  return list;
}

/**
 * @description 旧分镜脚本转成统一出片流程的设置（从脚本开始）：有旁白的镜头变成分段（旁白 → 台词，画面描述 → 配图画面，配的图或视频沿用），
 *   超过 8 段时按 `mergeShotsToLimit` 合并；配的图和视频并进脚本素材，脚本正文沿用（没有时用台词拼起来），台词算作按这版脚本拆好，出镜方式为不露脸。
 * @keyword-cn 分镜转统一流程, 旧脚本迁移
 * @keyword-en storyboard-to-unified, legacy-script-migration
 * @param {Pick<DouyinTopicEntity, 'script' | 'storyboard'>} topic 旧分镜脚本。
 * @returns {DouyinStoreVisitSetting} 统一流程的设置。
 */
export function storyboardToStoreVisit(
  topic: Pick<DouyinTopicEntity, 'script' | 'storyboard'>,
): DouyinStoreVisitSetting {
  const shots = mergeShotsToLimit(
    (topic.storyboard ?? [])
      .map((shot) => ({
        ...shot,
        narration: String(shot.narration ?? '').trim(),
        visual: String(shot.visual ?? '').trim(),
      }))
      .filter((shot) => shot.narration),
    DOUYIN_STORE_VISIT_SEGMENT_LIMITS.count,
  );
  const sceneImages = new Map<number, DouyinStoreVisitSceneImage>();
  const sceneVideos = new Map<number, DouyinStoreVisitSceneVideo>();
  const usable = (media?: DouyinMediaReference | null) =>
    media && Number(media.id) > 0 && media.url ? media : null;
  const segments: DouyinStoreVisitSegment[] = shots.map((shot) => {
    const media = usable(shot.media);
    const material = media
      ? {
          type: media.type,
          id: Number(media.id),
          name:
            media.name ||
            `${media.type === 'video' ? '视频' : '图片'} #${media.id}`,
          url: media.url,
          ...(media.coverUrl ? { coverUrl: media.coverUrl } : {}),
          ...(shot.visual ? { description: shot.visual.slice(0, 300) } : {}),
        }
      : null;
    if (material?.type === 'image' && !sceneImages.has(material.id))
      sceneImages.set(material.id, material);
    if (material?.type === 'video' && !sceneVideos.has(material.id))
      sceneVideos.set(material.id, material);
    const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(shot.id ?? ''))
      ? String(shot.id)
      : createStoreVisitSegmentId();
    return {
      id,
      lines: shot.narration.slice(0, DOUYIN_STORE_VISIT_SEGMENT_LIMITS.lines),
      ...(shot.visual
        ? {
            scene: shot.visual.slice(
              0,
              DOUYIN_STORE_VISIT_SEGMENT_LIMITS.scene,
            ),
          }
        : {}),
      shot: 'broll',
      ...(material?.type === 'image' ? { sceneImageId: material.id } : {}),
      ...(material?.type === 'video' ? { sceneVideoId: material.id } : {}),
    };
  });
  const script =
    String(topic.script ?? '').trim() ||
    segments.map((segment) => segment.lines).join('\n');
  return {
    start: 'script',
    script,
    linesScript: script,
    template: 'voiceover',
    sceneImages: [...sceneImages.values()],
    sceneVideos: [...sceneVideos.values()],
    segments,
  };
}

/**
 * @description 统一流程的「整条一次出」：把分段临时当成分镜交给整片生成——台词作旁白、画面描述或配图画面作画面、配的图或视频作参考，
 *   口播稿用台词拼起来（统一流程的脚本正文是编导方案，不能当口播念）；只在内存里换，不落库。不是统一流程的脚本原样返回。
 * @keyword-cn 分段当分镜, 整条一次出
 * @keyword-en segments-as-storyboard, one-shot-full-video
 * @param {DouyinTopicEntity} topic 子选题。
 * @returns {DouyinTopicEntity} 带分镜视图的子选题。
 */
export function storeVisitAsStoryboard(
  topic: DouyinTopicEntity,
): DouyinTopicEntity {
  if (topic.productionMode !== 'store-visit') return topic;
  const setting = topic.storeVisit ?? {};
  const images = new Map(
    (setting.sceneImages ?? []).map((image) => [Number(image.id), image]),
  );
  const videos = new Map(
    (setting.sceneVideos ?? []).map((video) => [Number(video.id), video]),
  );
  const storyboard: DouyinStoryboardShot[] = (setting.segments ?? [])
    .filter((segment) => String(segment.lines ?? '').trim())
    .map((segment) => {
      const material =
        (segment.sceneVideoId
          ? videos.get(Number(segment.sceneVideoId))
          : undefined) ??
        (segment.sceneImageId
          ? images.get(Number(segment.sceneImageId))
          : undefined);
      const lines = String(segment.lines).trim();
      return {
        id: segment.id,
        duration: Math.min(15, Math.max(2, Math.ceil(lines.length / 4.5))),
        shotType: '中景',
        visual: String(segment.action || segment.scene || '').trim(),
        narration: lines,
        transition: '',
        media: material
          ? {
              type: material.type,
              id: Number(material.id),
              name: material.name,
              url: material.url,
              ...(material.coverUrl ? { coverUrl: material.coverUrl } : {}),
            }
          : null,
      };
    });
  return {
    ...topic,
    script: storyboard.map((shot) => shot.narration).join('\n'),
    storyboard,
  };
}
