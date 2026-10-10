import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Collection, Db, Filter, ObjectId } from 'mongodb';
import { normalizeKnowledgeIds } from '../../knowledge/services/knowledge-ids.js';
import {
  DOUYIN_SCRIPT_STYLES,
  type DouyinFaceMaskStyle,
  type DouyinMediaReference,
  type DouyinPublishCopy,
  type DouyinScriptStyle,
  type DouyinStoryboardPreference,
  type DouyinStoryboardShot,
  type DouyinStoreVisitSegment,
  type DouyinStoreVisitVoiceSample,
  type DouyinTopicEntity,
  type DouyinVideoAudioSetting,
  type DouyinWorkspaceGroup,
} from '../entities/douyin-workbench.entity.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 规整脚本的配图偏向：非法来源回退为图库自找，标签去空去重、单个最长 50 字、最多 20 个。
 * @keyword-cn 规整配图偏向, 图库标签限定
 * @keyword-en normalize-storyboard-preference, gallery-tag-filter
 * @param input 前端或旧数据里的偏向，可为空。
 * @returns {DouyinStoryboardPreference} 规整后的偏向。
 */
export function normalizeStoryboardPreference(
  input?: Partial<DouyinStoryboardPreference> | null,
): DouyinStoryboardPreference {
  const galleryTags = [
    ...new Set(
      (Array.isArray(input?.galleryTags) ? input.galleryTags : [])
        .map((tag) =>
          String(tag ?? '')
            .trim()
            .slice(0, 50),
        )
        .filter(Boolean),
    ),
  ].slice(0, 20);
  return {
    imageSource: input?.imageSource === 'generate' ? 'generate' : 'gallery',
    galleryTags,
  };
}

/**
 * @description 规整视频声音设置：非法方式回退为配音，非法语言回退为普通话。
 * @keyword-cn 规整声音设置, 默认普通话配音
 * @keyword-en normalize-video-audio, default-mandarin-voiceover
 * @param input 前端或旧数据里的声音设置，可为空。
 * @returns {DouyinVideoAudioSetting} 规整后的设置。
 */
export function normalizeVideoAudio(
  input?: Partial<DouyinVideoAudioSetting> | null,
): DouyinVideoAudioSetting {
  const mode = input?.mode;
  const language = input?.language;
  return {
    mode: mode === 'music' || mode === 'mute' ? mode : 'voiceover',
    language: language === 'yue' || language === 'en' ? language : 'zh-CN',
  };
}

/**
 * @description 规整脚本发布文案：标题压成单行最多 60 字、正文最多 1000 字，话题去井号去重、单个最多 20 字、最多 5 个；
 *   三项都为空时返回 null，表示清掉发布文案。
 * @keyword-cn 规整发布文案, 话题去井号
 * @keyword-en normalize-publish-copy, strip-hashtag
 * @param input 前端或 LLM 给出的发布文案，可为空。
 * @returns {DouyinPublishCopy|null} 规整后的发布文案，全空时为 null。
 */
export function normalizePublishCopy(
  input?: Partial<DouyinPublishCopy> | null,
): DouyinPublishCopy | null {
  const title = String(input?.title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const description = String(input?.description ?? '')
    .trim()
    .slice(0, 1000);
  const tags = [
    ...new Set(
      (Array.isArray(input?.tags) ? input.tags : [])
        .map((tag) =>
          String(tag ?? '')
            .replace(/^#+/, '')
            .replace(/\s+/g, '')
            .slice(0, 20),
        )
        .filter(Boolean),
    ),
  ].slice(0, 5);
  return title || description || tags.length
    ? { title, description, tags }
    : null;
}

/**
 * @description 规整脚本风格：未登记的风格键一律回退为不指定（undefined）。
 * @keyword-cn 规整脚本风格, 默认不指定风格
 * @keyword-en normalize-script-style, default-no-style
 * @param input 前端传入的风格键。
 * @returns {DouyinScriptStyle|undefined} 规整后的风格，不指定时为 undefined。
 */
export function normalizeScriptStyle(
  input?: string | null,
): DouyinScriptStyle | undefined {
  const key = String(input ?? '') as DouyinScriptStyle;
  return key in DOUYIN_SCRIPT_STYLES ? key : undefined;
}

/**
 * @description 规整脚本参考图引用：只保留图片、去重、最多 4 张，越权与伪造由 `validateMediaReferences` 另行拦截。
 * @keyword-cn 规整脚本参考图, 参考图去重
 * @keyword-en normalize-reference-images, reference-dedupe
 * @param input 前端传入的参考图列表。
 * @returns {DouyinMediaReference[]} 规整后的参考图。
 */
export function normalizeReferenceImages(
  input?: Array<Partial<DouyinMediaReference>> | null,
): DouyinMediaReference[] {
  const seen = new Set<number>();
  const list: DouyinMediaReference[] = [];
  for (const item of Array.isArray(input) ? input : []) {
    const id = Number(item?.id);
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    list.push({
      type: 'image',
      id,
      name: String(item?.name ?? `图片 #${id}`).slice(0, 200),
      url: String(item?.url ?? '').slice(0, 2000),
      ...(item?.coverUrl
        ? { coverUrl: String(item.coverUrl).slice(0, 2000) }
        : {}),
    });
    if (list.length >= 4) break;
  }
  return list;
}

/**
 * @description 规整探店台词：统一换行、去掉首尾空白，最多 2000 字；空串表示清掉。
 * @keyword-cn 规整探店台词, 台词字数
 * @keyword-en normalize-store-visit-lines, lines-length
 * @param input 前端传入的台词。
 * @returns {string} 规整后的台词。
 */
export function normalizeStoreVisitLines(input?: string | null): string {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, 2000);
}

/**
 * @description 探店分段上限：最多 8 段；单段台词最多 1000 字（可灵语音合成单次上限），动作描述最多 300 字。
 * @keyword-cn 探店分段上限, 单段台词上限
 * @keyword-en store-visit-segment-limit, segment-lines-limit
 */
export const DOUYIN_STORE_VISIT_SEGMENT_LIMITS = {
  count: 8,
  lines: 1000,
  action: 300,
} as const;

/**
 * @description 规整探店分段（只收台词、场景图 ID、动作与段 ID，关键帧和成片由服务端写）：去掉空台词段，
 *   段 ID 不合法或重复时换新，场景图不在本选题场景里时清空，最多 8 段。
 * @keyword-cn 规整探店分段, 分段校验
 * @keyword-en normalize-store-visit-segments, segment-validation
 * @param input 前端传入的分段。
 * @param sceneImageIds 本选题当前的场景图 ID。
 * @returns {DouyinStoreVisitSegment[]} 规整后的分段（不含关键帧与成片）。
 */
export function normalizeStoreVisitSegments(
  input: Array<Partial<DouyinStoreVisitSegment>> | null | undefined,
  sceneImageIds: number[],
): DouyinStoreVisitSegment[] {
  const seen = new Set<string>();
  const list: DouyinStoreVisitSegment[] = [];
  for (const item of Array.isArray(input) ? input : []) {
    const lines = normalizeStoreVisitLines(item?.lines).slice(
      0,
      DOUYIN_STORE_VISIT_SEGMENT_LIMITS.lines,
    );
    if (!lines) continue;
    let id = String(item?.id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || seen.has(id))
      id = randomUUID().slice(0, 12);
    seen.add(id);
    const sceneImageId = Number(item?.sceneImageId);
    const action = String(item?.action ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, DOUYIN_STORE_VISIT_SEGMENT_LIMITS.action);
    list.push({
      id,
      lines,
      ...(sceneImageIds.includes(sceneImageId) ? { sceneImageId } : {}),
      ...(action ? { action } : {}),
    });
    if (list.length >= DOUYIN_STORE_VISIT_SEGMENT_LIMITS.count) break;
  }
  return list;
}

/**
 * @description 保存分段时接上服务端写入的字段：同一段场景没变就保留关键帧；台词、场景、动作都没变且关键帧还在时保留成片。
 * @keyword-cn 合并探店分段, 保留关键帧
 * @keyword-en merge-store-visit-segments, keep-keyframe
 * @param next 规整后的新分段。
 * @param current 选题里已保存的分段。
 * @returns {DouyinStoreVisitSegment[]} 合并后的分段。
 */
export function mergeStoreVisitSegments(
  next: DouyinStoreVisitSegment[],
  current: DouyinStoreVisitSegment[] | undefined,
): DouyinStoreVisitSegment[] {
  const byId = new Map((current ?? []).map((segment) => [segment.id, segment]));
  return next.map((segment) => {
    const previous = byId.get(segment.id);
    if (!previous || previous.sceneImageId !== segment.sceneImageId)
      return segment;
    const keyframe = previous.keyframe;
    const unchanged =
      previous.lines === segment.lines &&
      (previous.action ?? '') === (segment.action ?? '');
    return {
      ...segment,
      ...(keyframe ? { keyframe } : {}),
      ...(keyframe && unchanged && previous.videoId
        ? { videoId: previous.videoId }
        : {}),
    };
  });
}

/**
 * @description 持久化抖音母子选题、分镜与真实素材引用，并强制租户用户隔离。
 * @keyword-cn 抖音工作台仓储, 租户隔离
 * @keyword-en douyin-workbench-repository, tenant-isolation
 */
@Injectable()
export class DouyinWorkbenchRepositoryService {
  private readonly topics: Collection<DouyinTopicEntity>;
  private readonly counters: Collection<{ _id: string; seq: number }>;
  private readonly gallery: Collection<Record<string, unknown>>;
  private readonly videos: Collection<Record<string, unknown>>;

  constructor(@Inject('DS_MONGO_DB') private readonly db: Db) {
    this.topics = db.collection<DouyinTopicEntity>('douyin_topics');
    this.counters = db.collection<{ _id: string; seq: number }>('counters');
    this.gallery = db.collection('gallery_images');
    this.videos = db.collection('videos');
    void this.ensureIndexes();
  }

  /**
   * @description 创建选题业务 ID、租户用户和父子查询索引。
   * @keyword-cn 抖音选题索引, 父子查询
   * @keyword-en douyin-topic-indexes, parent-child-query
   */
  async ensureIndexes(): Promise<void> {
    await this.topics.createIndex({ id: 1 }, { unique: true });
    await this.topics.createIndex({
      tenantId: 1,
      userId: 1,
      kind: 1,
      updatedAt: -1,
    });
    await this.topics.createIndex({
      tenantId: 1,
      userId: 1,
      parentId: 1,
      updatedAt: -1,
    });
    await this.topics.createIndex({
      tenantId: 1,
      userId: 1,
      createdAt: 1,
    });
  }

  /**
   * @description 返回当前用户真实母选题及其子选题和分镜。
   * @keyword-cn 查询抖音工作台, 母子聚合
   * @keyword-en list-douyin-workspace, parent-child-aggregation
   */
  async listWorkspace(scope: DouyinScope): Promise<DouyinWorkspaceGroup[]> {
    const rows = await this.topics
      .find(this.scopeFilter(scope))
      .sort({ createdAt: 1 })
      .toArray();
    const children = new Map<number, Array<Omit<DouyinTopicEntity, '_id'>>>();
    for (const row of rows) {
      if (row.kind !== 'child' || !row.parentId) continue;
      const bucket = children.get(row.parentId) ?? [];
      bucket.push(this.toView(row));
      children.set(row.parentId, bucket);
    }
    return rows
      .filter((row) => row.kind === 'mother')
      .map((row) => ({
        ...this.toView(row),
        children: children.get(row.id) ?? [],
      }));
  }

  /**
   * @description 人工新建真实母选题；探店模式同时建立独立制作草稿，分镜模式的脚本由 LLM 生成链路写入。
   * @keyword-cn 新建抖音母题, 人工母题
   * @keyword-en create-douyin-mother, manual-mother-topic
   */
  async create(
    input: {
      kind: 'mother';
      title: string;
      productionMode?: 'storyboard' | 'store-visit';
      knowledgeIds?: string[];
    },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const now = new Date();
    const doc: DouyinTopicEntity = {
      _id: new ObjectId(),
      id: await this.nextId(),
      tenantId: scope.tenantId,
      userId: scope.userId,
      kind: 'mother',
      title: input.title.trim(),
      productionMode: input.productionMode || 'storyboard',
      knowledgeIds: normalizeKnowledgeIds(input.knowledgeIds),
      platform: 'douyin',
      storyboard: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    if (doc.productionMode === 'store-visit') {
      const draft: DouyinTopicEntity = {
        ...doc,
        _id: new ObjectId(),
        id: await this.nextId(),
        kind: 'child',
        parentId: doc.id,
        knowledgeIds: undefined,
        storeVisit: {},
      };
      await this.topics.insertMany([doc, draft]);
    } else {
      await this.topics.insertOne(doc);
    }
    return doc;
  }

  /**
   * @description 校验母选题归属后批量保存用户挑中的脚本（子选题），标题、口播正文与配图偏向一并入库，内容类型固定为短视频。
   * @keyword-cn 保存AI脚本, 脚本正文, 固定短视频, 分镜配图偏向
   * @keyword-en persist-ai-scripts, script-body, fixed-short-video, storyboard-image-preference
   */
  async createChildren(
    parentId: number,
    candidates: Array<{
      title: string;
      script?: string;
      storyboardPreference?: Partial<DouyinStoryboardPreference>;
      personaId?: number;
      scriptStyle?: string;
      referenceImages?: Array<Partial<DouyinMediaReference>>;
    }>,
    scope: DouyinScope,
  ): Promise<Array<Omit<DouyinTopicEntity, '_id'>>> {
    const parent = await this.topics.findOne({
      ...this.scopeFilter(scope),
      id: parentId,
      kind: 'mother',
    });
    if (!parent) throw new NotFoundException('DOUYIN_PARENT_NOT_FOUND');

    const normalized = candidates
      .map((candidate) => ({
        title: String(candidate?.title ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100),
        script: String(candidate?.script ?? '')
          .trim()
          .slice(0, 8000),
        storyboardPreference: normalizeStoryboardPreference(
          candidate?.storyboardPreference,
        ),
        personaId:
          Number.isInteger(Number(candidate?.personaId)) &&
          Number(candidate?.personaId) > 0
            ? Number(candidate?.personaId)
            : undefined,
        scriptStyle: normalizeScriptStyle(candidate?.scriptStyle),
        referenceImages: normalizeReferenceImages(candidate?.referenceImages),
      }))
      .filter((candidate) => candidate.title.length > 0);
    if (!normalized.length) {
      throw new BadRequestException('DOUYIN_CHILD_TOPICS_REQUIRED');
    }
    const uniqueTitles = new Set(
      normalized.map((candidate) => candidate.title.toLocaleLowerCase()),
    );
    if (uniqueTitles.size !== normalized.length) {
      throw new BadRequestException('DOUYIN_CHILD_TOPICS_DUPLICATED');
    }

    for (const candidate of normalized) {
      await this.validateMediaReferences(candidate.referenceImages, scope);
    }

    const now = new Date();
    const docs: DouyinTopicEntity[] = [];
    for (const candidate of normalized) {
      docs.push({
        _id: new ObjectId(),
        id: await this.nextId(),
        tenantId: scope.tenantId,
        userId: scope.userId,
        kind: 'child',
        parentId,
        title: candidate.title,
        script: candidate.script || undefined,
        topicType: '短视频',
        storyboardPreference: candidate.storyboardPreference,
        personaId: candidate.personaId,
        scriptStyle: candidate.scriptStyle,
        ...(candidate.referenceImages.length
          ? { referenceImages: candidate.referenceImages }
          : {}),
        platform: 'douyin',
        storyboard: [],
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.topics.insertMany(docs);
    return docs.map((doc) => this.toView(doc));
  }

  /**
   * @description 按作用域读取一个真实抖音选题。
   * @keyword-cn 读取抖音选题, 所有权校验
   * @keyword-en get-douyin-topic, ownership-check
   */
  async get(id: number, scope: DouyinScope): Promise<DouyinTopicEntity | null> {
    return await this.topics.findOne({ ...this.scopeFilter(scope), id });
  }

  /**
   * @description 保存标题、脚本正文、类型、配图偏向、视频声音设置、整片目标时长（0 表示改回自动）、整片清晰度
   *   （空串表示改回模型默认档）、发布文案（三项全空表示清掉）、完整分镜或最终视频素材绑定。
   * @keyword-cn 更新抖音选题, 保存脚本正文, 持久化分镜
   * @keyword-en update-douyin-topic, persist-script-body, persist-storyboard
   */
  async update(
    id: number,
    input: {
      title?: string;
      knowledgeIds?: string[];
      script?: string;
      topicType?: string;
      storyboardPreference?: Partial<DouyinStoryboardPreference>;
      personaId?: number;
      scriptStyle?: string;
      referenceImages?: Array<Partial<DouyinMediaReference>>;
      videoAudio?: Partial<DouyinVideoAudioSetting>;
      fullVideoDuration?: number;
      fullVideoResolution?: string;
      shotVideoResolution?: string;
      publishCopy?: Partial<DouyinPublishCopy>;
      storeVisit?: {
        faceImage?: Partial<DouyinMediaReference> | null;
        sceneImages?: Array<Partial<DouyinMediaReference>>;
        sceneDescription?: string;
        voiceMode?: 'prompt';
        voiceDescription?: string;
        lines?: string;
        segments?: Array<Partial<DouyinStoreVisitSegment>>;
      };
      autoConcatShots?: boolean;
      storyboard?: DouyinStoryboardShot[];
      generatedVideoId?: number;
    },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity | null> {
    const current = await this.get(id, scope);
    if (!current) return null;
    if (input.storyboard)
      await this.validateStoryboardMedia(input.storyboard, scope);
    if (input.generatedVideoId)
      await this.requireVideo(input.generatedVideoId, scope);
    const updates: Partial<DouyinTopicEntity> = { updatedAt: new Date() };
    /* 探店设置按子字段写，避免前端改人脸或台词时冲掉服务端写入的音色 */
    const nested: Record<string, unknown> = {};
    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.knowledgeIds !== undefined && current.kind === 'mother')
      updates.knowledgeIds = normalizeKnowledgeIds(input.knowledgeIds);
    if (input.script !== undefined)
      updates.script = input.script.trim() || undefined;
    if (input.topicType !== undefined)
      updates.topicType = input.topicType.trim() || undefined;
    if (input.storyboardPreference !== undefined)
      updates.storyboardPreference = normalizeStoryboardPreference(
        input.storyboardPreference,
      );
    if (input.videoAudio !== undefined)
      updates.videoAudio = normalizeVideoAudio(input.videoAudio);
    // 0 表示改回自动，清掉字段
    const unset: Record<string, ''> = {};
    // personaId 传 0 表示取消选用人物；scriptStyle 传空串表示取消风格
    if (input.personaId !== undefined) {
      const personaId = Math.round(Number(input.personaId) || 0);
      if (personaId > 0) updates.personaId = personaId;
      else unset.personaId = '';
    }
    if (input.scriptStyle !== undefined) {
      const style = normalizeScriptStyle(input.scriptStyle);
      if (style) updates.scriptStyle = style;
      else unset.scriptStyle = '';
    }
    if (input.referenceImages !== undefined) {
      const references = normalizeReferenceImages(input.referenceImages);
      await this.validateMediaReferences(references, scope);
      if (references.length) updates.referenceImages = references;
      else unset.referenceImages = '';
    }
    if (input.fullVideoDuration !== undefined) {
      const seconds = Math.round(Number(input.fullVideoDuration) || 0);
      if (seconds > 0) updates.fullVideoDuration = Math.min(120, seconds);
      else unset.fullVideoDuration = '';
    }
    // 空串表示改回模型默认清晰度；只收模型档位那种短标识，挡掉乱填
    if (input.fullVideoResolution !== undefined) {
      const resolution = String(input.fullVideoResolution ?? '').trim();
      if (/^[A-Za-z0-9_]{1,20}$/.test(resolution))
        updates.fullVideoResolution = resolution;
      else unset.fullVideoResolution = '';
    }
    // 分镜清晰度同一套规则，整条脚本的分镜共用
    if (input.shotVideoResolution !== undefined) {
      const resolution = String(input.shotVideoResolution ?? '').trim();
      if (/^[A-Za-z0-9_]{1,20}$/.test(resolution))
        updates.shotVideoResolution = resolution;
      else unset.shotVideoResolution = '';
    }
    if (input.publishCopy !== undefined) {
      const publishCopy = normalizePublishCopy(input.publishCopy);
      if (publishCopy) updates.publishCopy = publishCopy;
      else unset.publishCopy = '';
    }
    if (input.storeVisit?.faceImage !== undefined) {
      const [faceImage] = normalizeReferenceImages(
        input.storeVisit.faceImage ? [input.storeVisit.faceImage] : [],
      );
      if (faceImage) {
        await this.validateMediaReferences([faceImage], scope);
        nested['storeVisit.faceImage'] = faceImage;
      } else unset['storeVisit.faceImage'] = '';
    }
    if (input.storeVisit?.lines !== undefined) {
      const lines = normalizeStoreVisitLines(input.storeVisit.lines);
      if (lines) nested['storeVisit.lines'] = lines;
      else unset['storeVisit.lines'] = '';
    }
    if (input.autoConcatShots !== undefined) {
      if (input.autoConcatShots) updates.autoConcatShots = true;
      else unset.autoConcatShots = '';
    }
    let sceneImages = current.storeVisit?.sceneImages ?? [];
    if (input.storeVisit?.sceneImages !== undefined) {
      const images = normalizeReferenceImages(input.storeVisit.sceneImages);
      await this.validateMediaReferences(images, scope);
      nested['storeVisit.sceneImages'] = images;
      sceneImages = images;
    }
    // 分段只收台词、场景与动作，关键帧和成片按段 ID 从已保存的分段接上；全文台词跟着分段走
    if (input.storeVisit?.segments !== undefined) {
      if (current.kind !== 'child')
        throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
      const segments = mergeStoreVisitSegments(
        normalizeStoreVisitSegments(
          input.storeVisit.segments,
          sceneImages.map((image) => image.id),
        ),
        current.storeVisit?.segments,
      );
      nested['storeVisit.segments'] = segments;
      if (input.storeVisit.lines === undefined) {
        const lines = normalizeStoreVisitLines(
          segments.map((segment) => segment.lines).join('\n'),
        );
        if (lines) {
          nested['storeVisit.lines'] = lines;
          delete unset['storeVisit.lines'];
        } else unset['storeVisit.lines'] = '';
      }
    }
    if (input.storeVisit?.sceneDescription !== undefined) {
      nested['storeVisit.sceneDescription'] = String(
        input.storeVisit.sceneDescription,
      )
        .trim()
        .slice(0, 2000);
    }
    if (
      input.storeVisit?.voiceDescription !== undefined ||
      input.storeVisit?.voiceMode !== undefined
    ) {
      if (current.kind !== 'child')
        throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
      if (input.storeVisit.voiceDescription !== undefined) {
        nested['storeVisit.voiceDescription'] = String(
          input.storeVisit.voiceDescription,
        )
          .trim()
          .slice(0, 1000);
      }
      if (input.storeVisit.voiceMode === 'prompt') {
        nested['storeVisit.voiceSource'] = 'design';
        nested['storeVisit.voiceMode'] = 'prompt';
        for (const key of [
          'voiceId',
          'voiceName',
          'voiceProviderId',
          'voiceModel',
          'voiceSample',
          'voicePreviewText',
          'voicePreviewUrl',
          'voiceLanguage',
          'voiceCreatedAt',
          'voiceClonedAt',
        ]) {
          unset[`storeVisit.${key}`] = '';
        }
      }
    }
    if (input.storyboard !== undefined) {
      updates.storyboard = input.storyboard;
      updates.status = input.storyboard.length ? 'storyboard_ready' : 'draft';
    }
    if (input.generatedVideoId !== undefined) {
      updates.generatedVideoId = input.generatedVideoId;
      updates.status = 'video_ready';
    }
    const $set = { ...updates, ...nested };
    return await this.topics.findOneAndUpdate(
      { ...this.scopeFilter(scope), id },
      Object.keys(unset).length ? { $set, $unset: unset } : { $set },
      { returnDocument: 'after' },
    );
  }

  /**
   * @description 写入克隆、设计服务返回的音色或从数眼可灵音色库选的音色，并清除上一来源的样本、描述、试听和语种信息，人脸与台词保持不变。
   * @keyword-cn 保存克隆音色, 探店音色
   * @keyword-en save-cloned-voice, store-visit-voice
   * @param {number} id 子选题（脚本）ID。
   * @param {object} voice 音色来源、ID、提供商、模型，以及录音样本、设计描述、试听或语种。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity|null>} 更新后的选题，不存在时为 null。
   */
  async saveStoreVisitVoice(
    id: number,
    voice: {
      voiceSource: 'clone' | 'design' | 'preset';
      voiceName: string;
      voiceSample?: DouyinStoreVisitVoiceSample;
      voiceDescription?: string;
      voicePreviewText?: string;
      voicePreviewUrl?: string;
      voiceLanguage?: 'zh' | 'en';
      voiceId: string;
      voiceProviderId: string;
      voiceModel: string;
    },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity | null> {
    const now = new Date();
    const optional = {
      voiceSample: voice.voiceSample,
      voiceDescription: voice.voiceDescription,
      voicePreviewText: voice.voicePreviewText,
      voicePreviewUrl: voice.voicePreviewUrl,
      voiceLanguage: voice.voiceLanguage,
      voiceClonedAt: voice.voiceSource === 'clone' ? now : undefined,
    };
    const fields: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined) fields[`storeVisit.${key}`] = value;
      else unset[`storeVisit.${key}`] = '';
    }
    return await this.topics.findOneAndUpdate(
      { ...this.scopeFilter(scope), id, kind: 'child' },
      {
        $set: {
          ...fields,
          'storeVisit.voiceSource': voice.voiceSource,
          'storeVisit.voiceMode': 'generated',
          'storeVisit.voiceName': voice.voiceName,
          'storeVisit.voiceId': voice.voiceId,
          'storeVisit.voiceProviderId': voice.voiceProviderId,
          'storeVisit.voiceModel': voice.voiceModel,
          'storeVisit.voiceCreatedAt': now,
          updatedAt: now,
        },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * @description 原子地清掉「全部出片后自动合成」标记，只有真的清掉（之前是 true）的那次调用返回 true，
   *   多个分镜同时出片时保证只触发一次合成。
   * @keyword-cn 认领自动合成, 防重复合成
   * @keyword-en claim-auto-concat, dedupe-concat
   * @param {number} id 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<boolean>} 是否由本次调用认领到。
   */
  async claimAutoConcat(id: number, scope: DouyinScope): Promise<boolean> {
    const result = await this.topics.updateOne(
      { ...this.scopeFilter(scope), id, autoConcatShots: true },
      { $unset: { autoConcatShots: '' }, $set: { updatedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }

  /**
   * @description 只更新探店某一段的服务端字段：`keyframe` 写入新关键帧（同时作废这段的成片），`videoId` 绑定成片（先校验视频库归属），
   *   `videoId: null` 清掉成片。按段 ID 定位写入，多段同时出片时互不覆盖；段已被删掉时返回 null。
   * @keyword-cn 更新探店分段, 分段局部写入
   * @keyword-en update-store-visit-segment, partial-segment-write
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} segmentId 分段 ID。
   * @param {{keyframe?: DouyinMediaReference, videoId?: number|null}} patch 要写入的字段。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity|null>} 更新后的选题，选题或分段不存在时为 null。
   */
  async updateStoreVisitSegment(
    topicId: number,
    segmentId: string,
    patch: { keyframe?: DouyinMediaReference; videoId?: number | null },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity | null> {
    if (patch.videoId) await this.requireVideo(patch.videoId, scope);
    if (patch.keyframe)
      await this.validateMediaReferences([patch.keyframe], scope);
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    const $unset: Record<string, ''> = {};
    if (patch.keyframe) {
      $set['storeVisit.segments.$[segment].keyframe'] = patch.keyframe;
      $unset['storeVisit.segments.$[segment].videoId'] = '';
    }
    if (patch.videoId)
      $set['storeVisit.segments.$[segment].videoId'] = patch.videoId;
    else if (patch.videoId === null)
      $unset['storeVisit.segments.$[segment].videoId'] = '';
    return await this.topics.findOneAndUpdate(
      {
        ...this.scopeFilter(scope),
        id: topicId,
        'storeVisit.segments.id': segmentId,
      },
      Object.keys($unset).length ? { $set, $unset } : { $set },
      {
        returnDocument: 'after',
        arrayFilters: [{ 'segment.id': segmentId }],
      },
    );
  }

  /**
   * @description 只更新已保存分镜里的某一段，用于重新生成画面或绑定分镜视频，不覆盖同选题其他镜头的编辑。
   *   `media` 传 null 表示清空配图；`videoId` 会先校验视频库归属。
   * @keyword-cn 更新单段分镜, 分镜局部写入
   * @keyword-en update-single-shot, partial-storyboard-write
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} shotId 分镜段落 ID。
   * @param {{media?: DouyinMediaReference|null, imagePrompt?: string, videoId?: number}} patch 要写入的字段。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 更新后的选题。
   * @throws {NotFoundException} 选题或分镜不存在时抛出。
   */
  async updateShot(
    topicId: number,
    shotId: string,
    patch: {
      media?: DouyinMediaReference | null;
      originalMedia?: DouyinMediaReference | null;
      faceMaskStyle?: DouyinFaceMaskStyle | null;
      imagePrompt?: string;
      videoId?: number;
    },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    if (patch.videoId) await this.requireVideo(patch.videoId, scope);
    if (patch.media) {
      await this.validateStoryboardMedia(
        [{ media: patch.media } as DouyinStoryboardShot],
        scope,
      );
    }
    /* 按段落 ID 定位写入，多段同时重生成画面时互不覆盖 */
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) $set[`storyboard.$[shot].${key}`] = value;
    }
    const updated = await this.topics.findOneAndUpdate(
      { ...this.scopeFilter(scope), id: topicId, 'storyboard.id': shotId },
      { $set },
      { returnDocument: 'after', arrayFilters: [{ 'shot.id': shotId }] },
    );
    if (!updated) {
      const exists = await this.get(topicId, scope);
      throw new NotFoundException(
        exists ? 'DOUYIN_STORYBOARD_SHOT_NOT_FOUND' : 'DOUYIN_TOPIC_NOT_FOUND',
      );
    }
    return updated;
  }

  /**
   * @description 删除当前用户选题，母题会级联删除其全部子题。
   * @keyword-cn 删除抖音选题, 级联删除
   * @keyword-en delete-douyin-topic, cascade-delete
   */
  async remove(id: number, scope: DouyinScope): Promise<number> {
    const current = await this.get(id, scope);
    if (!current) return 0;
    const ids =
      current.kind === 'mother'
        ? (
            await this.topics
              .find({ ...this.scopeFilter(scope), parentId: id })
              .toArray()
          )
            .map((row) => row.id)
            .concat(id)
        : [id];
    const result = await this.topics.deleteMany({
      ...this.scopeFilter(scope),
      id: { $in: ids },
    });
    return result.deletedCount;
  }

  /**
   * @description 校验并返回当前租户可见的真实视频库记录。
   * @keyword-cn 校验视频素材, 视频库归属
   * @keyword-en require-video-asset, video-library-ownership
   */
  async requireVideo(
    id: number,
    scope: DouyinScope,
  ): Promise<Record<string, unknown>> {
    const row = await this.videos.findOne({
      id,
      ...this.tenantFilter(scope.tenantId),
    });
    if (!row) throw new NotFoundException('DOUYIN_VIDEO_ASSET_NOT_FOUND');
    return row;
  }

  /**
   * @description 校验分镜里每个素材 ID 确实属于当前租户的图库或视频库。
   * @keyword-cn 校验分镜素材, 防伪造引用
   * @keyword-en validate-storyboard-media, prevent-forged-reference
   */
  private async validateStoryboardMedia(
    storyboard: DouyinStoryboardShot[],
    scope: DouyinScope,
  ): Promise<void> {
    for (const shot of storyboard) {
      const media = shot.media;
      if (!media) continue;
      const collection = media.type === 'video' ? this.videos : this.gallery;
      const row = await collection.findOne({
        id: media.id,
        ...this.tenantFilter(scope.tenantId),
      });
      if (!row)
        throw new BadRequestException('DOUYIN_STORYBOARD_MEDIA_NOT_FOUND');
    }
  }

  /**
   * @description 校验一组素材引用确实是本租户图库或视频库里的真实记录，阻止前端伪造 ID 借用他人素材。
   * @keyword-cn 校验素材引用, 防伪造引用
   * @keyword-en validate-media-references, prevent-forged-reference
   * @param references 待校验的素材引用。
   * @param scope 租户用户作用域。
   * @throws {BadRequestException} 任意一条引用不存在或不属于本租户时抛出。
   */
  private async validateMediaReferences(
    references: DouyinMediaReference[],
    scope: DouyinScope,
  ): Promise<void> {
    for (const media of references) {
      const collection = media.type === 'video' ? this.videos : this.gallery;
      const row = await collection.findOne({
        id: media.id,
        ...this.tenantFilter(scope.tenantId),
      });
      if (!row)
        throw new BadRequestException('DOUYIN_REFERENCE_MEDIA_NOT_FOUND');
    }
  }

  /**
   * @description 生成全局递增的抖音选题业务 ID。
   * @keyword-cn 抖音选题自增ID, 计数器
   * @keyword-en next-douyin-topic-id, counter
   */
  private async nextId(): Promise<number> {
    const result = await this.counters.findOneAndUpdate(
      { _id: 'douyin_topics' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    return result.value?.seq ?? 1;
  }

  /**
   * @description 构造用户与租户双重作用域过滤。
   * @keyword-cn 抖音作用域过滤, 用户隔离
   * @keyword-en douyin-scope-filter, user-isolation
   */
  private scopeFilter(scope: DouyinScope): Filter<DouyinTopicEntity> {
    return { userId: scope.userId, ...this.tenantFilter(scope.tenantId) };
  }

  /**
   * @description 构造租户过滤，母平台只访问无 tenantId 的平台数据。
   * @keyword-cn 母平台数据边界, 租户过滤
   * @keyword-en platform-data-boundary, tenant-filter
   */
  private tenantFilter(tenantId?: string): Record<string, unknown> {
    return tenantId
      ? { tenantId }
      : {
          $or: [
            { tenantId: { $exists: false } },
            { tenantId: null },
            { tenantId: '' },
          ],
        };
  }

  /**
   * @description 移除 Mongo _id 后生成前端安全选题视图。
   * @keyword-cn 抖音选题视图, 隐藏数据库ID
   * @keyword-en douyin-topic-view, hide-database-id
   */
  private toView(row: DouyinTopicEntity): Omit<DouyinTopicEntity, '_id'> {
    const view = { ...row } as Partial<DouyinTopicEntity>;
    delete view._id;
    return view as Omit<DouyinTopicEntity, '_id'>;
  }
}
