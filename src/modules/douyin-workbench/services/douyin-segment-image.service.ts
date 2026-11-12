import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  DouyinStoreVisitSceneImage,
  DouyinStoreVisitSegment,
  DouyinStoryboardShot,
  DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import { storeVisitStart } from './douyin-store-visit-continuity.js';
import { DouyinShotImageService } from './douyin-shot-image.service.js';
import { DouyinStoryboardGenerationService } from './douyin-storyboard-generation.service.js';
import {
  autoAssignShotImages,
  DouyinStoryboardImageService,
  type StoryboardImageCandidate,
} from './douyin-storyboard-image.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 一段要配的画面文字：画面描述优先，其次脚本里的配图画面，最后用台词。
 * @keyword-cn 分段画面文字, 配图描述
 * @keyword-en segment-visual-text, image-description
 * @param {DouyinStoreVisitSegment} segment 分段。
 * @returns {string} 画面文字。
 */
export function describeSegmentVisual(
  segment: DouyinStoreVisitSegment,
): string {
  return (
    String(segment.action ?? '').trim() ||
    String(segment.scene ?? '').trim() ||
    String(segment.lines ?? '').trim()
  );
}

/**
 * @description 把分段转成分镜选图要的结构（画面、旁白、景别），这样能直接复用分镜的选图与按相关度补图。
 * @keyword-cn 分段转选图结构, 复用分镜选图
 * @keyword-en segment-to-pick-shot, reuse-shot-pick
 * @param {DouyinStoreVisitSegment} segment 分段。
 * @returns {DouyinStoryboardShot} 选图用的分镜结构，`media` 为空。
 */
export function toPickShot(
  segment: DouyinStoreVisitSegment,
): DouyinStoryboardShot {
  return {
    id: segment.id,
    duration: 5,
    shotType: '中景',
    visual: describeSegmentVisual(segment),
    narration: String(segment.lines ?? '').trim(),
    transition: '',
    media: null,
  };
}

/**
 * @description 图库候选图转成脚本素材里的场景图：带上图片说明与标签，供生成提示词和导演看图时理解画面。
 * @keyword-cn 候选图转场景图, 素材说明
 * @keyword-en candidate-to-scene-image, material-description
 * @param {StoryboardImageCandidate} candidate 候选图。
 * @param {string} fallback 候选图没有说明时用的画面文字。
 * @returns {DouyinStoreVisitSceneImage} 场景图。
 */
export function toSceneImage(
  candidate: StoryboardImageCandidate,
  fallback: string,
): DouyinStoreVisitSceneImage {
  return {
    type: 'image',
    id: candidate.id,
    name: candidate.name || `图片 #${candidate.id}`,
    url: candidate.url,
    ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl } : {}),
    description: String(candidate.description || fallback).slice(0, 300),
    ...(candidate.tags?.length ? { tags: candidate.tags.slice(0, 10) } : {}),
  };
}

/**
 * @description 统一出片流程「从脚本开始」的分段配图：没有门店实拍，画面按脚本从租户图库挑（复用分镜的候选图、模型选图与按相关度补图），
 *   或逐段 AI 生图（复用分镜生图，带上一段的画面延续场景与色调）。从门店开始的脚本不走这里，用门店点位配场景。
 * @keyword-cn 分段配图服务, 从脚本开始配图
 * @keyword-en segment-image-service, script-first-imaging
 */
@Injectable()
export class DouyinSegmentImageService {
  /**
   * @description 注入选题仓库、图库候选、分镜选图与生图依赖。
   * @keyword-cn 初始化分段配图, 配图依赖
   * @keyword-en init-segment-image, imaging-dependencies
   */
  constructor(
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly candidates: DouyinStoryboardImageService,
    private readonly storyboard: DouyinStoryboardGenerationService,
    private readonly shotImages: DouyinShotImageService,
  ) {}

  /**
   * @description 按脚本从图库给每段挑一张图：先让模型按每段画面挑，挑不上的按相关度补，同一张图尽量不重复用；只返回、不落库，
   *   前端把用到的图并进脚本素材后连同分段一起保存。图库限定标签沿用脚本的配图偏向。
   * @keyword-cn 分段图库配图, 按脚本挑图
   * @keyword-en segment-gallery-pick, pick-by-script
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns 每段挑中的图片 ID 与用到的场景图。
   * @throws {BadRequestException} 不是从脚本开始、还没有台词或图库里没有可用图片。
   */
  async pickImages(
    topicId: number,
    scope: DouyinScope,
  ): Promise<{
    segments: Array<{ id: string; sceneImageId: number }>;
    sceneImages: DouyinStoreVisitSceneImage[];
  }> {
    const topic = await this.requireScriptFirst(topicId, scope);
    const segments = (topic.storeVisit?.segments ?? []).filter((segment) =>
      segment.lines?.trim(),
    );
    if (!segments.length)
      throw new BadRequestException('请先根据脚本生成台词，再配画面');
    const mother = topic.parentId
      ? await this.repository.get(topic.parentId, scope)
      : null;
    const candidates = await this.candidates.loadCandidates(
      [
        mother?.title,
        topic.title,
        String(topic.storeVisit?.script ?? '').slice(0, 400),
      ]
        .filter(Boolean)
        .join(' '),
      scope,
      topic.storyboardPreference?.galleryTags ?? [],
    );
    if (!candidates.length)
      throw new BadRequestException(
        '图库里还没有能用的图片，可以先上传图片，或改用 AI 生图',
      );
    const shots = segments.map(toPickShot);
    await this.storyboard.pickShotImages(shots, candidates, scope);
    autoAssignShotImages(shots, candidates);
    const byId = new Map(candidates.map((item) => [item.id, item]));
    const picked: Array<{ id: string; sceneImageId: number }> = [];
    const sceneImages = new Map<number, DouyinStoreVisitSceneImage>();
    shots.forEach((shot, index) => {
      const candidate = shot.media ? byId.get(Number(shot.media.id)) : null;
      if (!candidate) return;
      picked.push({ id: shot.id, sceneImageId: candidate.id });
      if (!sceneImages.has(candidate.id))
        sceneImages.set(
          candidate.id,
          toSceneImage(candidate, describeSegmentVisual(segments[index])),
        );
    });
    return { segments: picked, sceneImages: [...sceneImages.values()] };
  }

  /**
   * @description 给一段 AI 生一张图并直接保存：画面按补充描述、画面描述、配图画面或台词，上一段有图时以它为底图延续场景与色调；
   *   新图并进脚本素材、绑定到这一段（换图会作废这段已出的视频），旧图没有别的段在用就从素材里移走（图库里仍保留）。
   * @keyword-cn 分段AI生图, 逐段生图
   * @keyword-en segment-ai-image, per-segment-imaging
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} segmentId 分段 ID。
   * @param {string|undefined} prompt 这次的补充描述。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns 更新后的选题与新图。
   * @throws {BadRequestException} 不是从脚本开始或分段不存在。
   */
  async generateImage(
    topicId: number,
    segmentId: string,
    prompt: string | undefined,
    scope: DouyinScope,
  ): Promise<{
    topic: DouyinTopicEntity;
    segmentId: string;
    imageId: number;
    imageUrl: string;
  }> {
    const topic = await this.requireScriptFirst(topicId, scope);
    const segments = topic.storeVisit?.segments ?? [];
    const index = segments.findIndex((item) => item.id === segmentId);
    if (index < 0)
      throw new BadRequestException('这一段已经不存在，请刷新后再试');
    const segment = segments[index];
    const sceneImages = topic.storeVisit?.sceneImages ?? [];
    const previous =
      index > 0
        ? sceneImages.find(
            (image) => image.id === segments[index - 1].sceneImageId,
          )
        : undefined;
    const requirement = String(prompt ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    const image = await this.shotImages.generateImage({
      topic,
      description: requirement || describeSegmentVisual(segment),
      previousImageUrl: previous?.url,
      scope,
    });
    const oldId = segment.sceneImageId;
    const oldStillUsed = segments.some(
      (item, position) => position !== index && item.sceneImageId === oldId,
    );
    const nextImages: DouyinStoreVisitSceneImage[] = [
      ...sceneImages.filter((item) => oldStillUsed || item.id !== oldId),
      {
        type: 'image',
        id: image.id,
        name: image.originalName || `图片 #${image.id}`,
        url: image.url,
        coverUrl: image.thumbUrl || image.url,
        description: (requirement || describeSegmentVisual(segment)).slice(
          0,
          300,
        ),
      },
    ];
    const nextSegments = segments.map((item, position) => {
      if (position !== index) return item;
      const copy: DouyinStoreVisitSegment = { ...item, sceneImageId: image.id };
      delete copy.sceneImageIds;
      delete copy.sceneVideoId;
      return copy;
    });
    const updated = await this.repository.update(
      topicId,
      { storeVisit: { sceneImages: nextImages, segments: nextSegments } },
      scope,
    );
    if (!updated) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return {
      topic: updated,
      segmentId,
      imageId: image.id,
      imageUrl: image.url,
    };
  }

  /**
   * @description 读取从脚本开始的子选题；从门店开始的脚本画面要用门店实拍，不在这里配图。
   * @keyword-cn 读取从脚本开始的选题, 起点校验
   * @keyword-en require-script-first-topic, start-check
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 子选题。
   * @throws {BadRequestException} 选题不存在或不是从脚本开始。
   */
  private async requireScriptFirst(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    if (storeVisitStart(topic.storeVisit) !== 'script')
      throw new BadRequestException(
        '从门店开始的脚本画面要用门店实拍，请在「画面」步骤按脚本配门店场景',
      );
    return topic;
  }
}
