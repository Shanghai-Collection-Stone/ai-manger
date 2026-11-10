import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { GalleryGroupService } from '../../gallery/services/gallery-group.service.js';
import { GalleryService } from '../../gallery/services/gallery.service.js';
import { KnowledgeService } from '../../knowledge/services/knowledge.service.js';
import type { DouyinPersonaView } from '../../douyin-persona/entities/douyin-persona.entity.js';
import { DouyinPersonaRepositoryService } from '../../douyin-persona/services/douyin-persona-repository.service.js';
import {
  CreateDouyinMotherTopicDto,
  CreateDouyinStoreVisitStoreDto,
  SaveDouyinStoreVisitSpotsDto,
  UpdateDouyinTopicDto,
} from '../controller/douyin-workbench.dto.js';
import type {
  DouyinStoreVisitSpot,
  DouyinStoreVisitStoreEntity,
  DouyinStoreVisitStoreView,
} from '../entities/douyin-store-visit-store.entity.js';
import type {
  DouyinOperationView,
  DouyinScriptStyle,
  DouyinStoreVisitSegment,
  DouyinStoreVisitStart,
  DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import {
  isStoreVisitSegmentReady,
  storeVisitStart,
} from './douyin-store-visit-continuity.js';
import {
  applyStoreVisitSceneMatches,
  applyStoreVisitTemplate,
  createStoreVisitSegmentId,
  estimateStoreVisitLinesSeconds,
  packStoreVisitClassifyBatches,
  rankStoreVisitSpotImages,
  spotsToStoreVisitMaterials,
  storeVisitKeyframeOf,
  storeVisitSceneStarts,
  toStoreVisitSegmentsPayload,
  toStoreVisitSpotsPayload,
  usedStoreVisitSpotIds,
  withoutStoreVisitScene,
} from './douyin-store-visit-rules.js';
import { DouyinGenerationJobService } from './douyin-generation-job.service.js';
import { DouyinOperationService } from './douyin-operation.service.js';
import { DouyinSegmentImageService } from './douyin-segment-image.service.js';
import { DouyinStoreVisitPipelineService } from './douyin-store-visit-pipeline.service.js';
import { DouyinStoreVisitPlannerService } from './douyin-store-visit-planner.service.js';
import { DouyinStoreVisitSpotService } from './douyin-store-visit-spot.service.js';
import { DouyinStoreVisitService } from './douyin-store-visit.service.js';
import { DouyinUnifyService } from './douyin-unify.service.js';
import { DouyinVideoDirectorService } from './douyin-video-director.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 一次最多交给 AI 归类的门店照片数：两批视觉模型调用，单次 MCP 调用控制在几十秒内。
 * @keyword-cn 单次归类上限, 归类分次
 * @keyword-en classify-call-limit, classify-in-chunks
 */
export const DOUYIN_AGENT_CLASSIFY_LIMIT = 16;

/**
 * @description 探店节点没配好时的中文说明（与桌面端 `describeStoreVisitNode` 同规则），配好时为空。
 * @keyword-cn 探店节点配置说明, 未配置提示
 * @keyword-en store-visit-node-hint, unconfigured-hint
 * @param {{configured: boolean, error?: string}|undefined} node 节点状态。
 * @param {string} label 节点中文名。
 * @returns {string} 说明。
 */
export function describeStoreVisitNode(
  node: { configured: boolean; error?: string } | undefined,
  label: string,
): string {
  if (!node || node.configured) return '';
  return node.error
    ? `「${label}」不可用：${node.error}`
    : `「${label}」还没指定提供商`;
}

/**
 * @description 预设人物的出镜形象图引用：优先正面全身图，其次面部特写（与桌面端 `toStoreVisitPersonaFace` 同规则），没有可用图时为空。
 * @keyword-cn 预设人物形象图, 出镜人物引用
 * @keyword-en persona-face-reference, presenter-image
 * @param {DouyinPersonaView} persona 预设人物。
 * @returns {{type: 'image', id: number, name: string, url: string, coverUrl: string}|null} 形象图引用。
 */
export function personaFaceReference(persona: DouyinPersonaView): {
  type: 'image';
  id: number;
  name: string;
  url: string;
  coverUrl: string;
} | null {
  const images = (persona.referenceImages ?? []).filter(
    (image) => Number(image.imageId) > 0 && image.url,
  );
  const image =
    images.find((item) => item.view === 'front') ||
    images.find((item) => item.view === 'closeup') ||
    images[0];
  return image
    ? {
        type: 'image',
        id: Number(image.imageId),
        name: `${persona.name} · 人物形象`.slice(0, 200),
        url: image.url,
        coverUrl: image.coverUrl || image.url,
      }
    : null;
}

/**
 * @description 把 class-validator 的嵌套错误摊平成一句中文可读的说明。
 * @keyword-cn 校验错误说明, 参数错误
 * @keyword-en validation-error-message, invalid-input
 * @param {ValidationError[]} errors 校验错误。
 * @returns {string} 说明。
 */
function describeValidationErrors(errors: ValidationError[]): string {
  const messages: string[] = [];
  /** @description 逐层收集约束说明。 @keyword-cn 收集校验说明, 嵌套错误 @keyword-en collect-constraints, nested-errors */
  const walk = (items: ValidationError[], path: string) => {
    for (const item of items) {
      const key = path ? `${path}.${item.property}` : item.property;
      for (const message of Object.values(item.constraints ?? {}))
        messages.push(`${key}: ${message}`);
      walk(item.children ?? [], key);
    }
  };
  walk(errors, '');
  return messages.slice(0, 5).join('；') || '参数不合法';
}

/**
 * @description 给 AI 操作抖音工作台（MCP）用的编排服务：每个方法完成桌面端一步的完整操作并落库（AI 写脚本、按脚本生成台词、配场景、出片、门店照片归类等），
 *   规则与桌面端一致（见 `douyin-store-visit-rules.ts`），入参都带租户用户作用域。拼接成片、尾帧续段与统一音色仍由打开「视频制作」页的桌面端完成。
 * @keyword-cn 抖音工作台编排, AI操作工作台
 * @keyword-en douyin-workbench-agent, ai-operated-workbench
 */
@Injectable()
export class DouyinWorkbenchAgentService {
  /**
   * @description 注入抖音工作台各业务服务与人物、知识、图库服务。
   * @keyword-cn 编排服务依赖, 复用业务服务
   * @keyword-en agent-dependencies, reuse-services
   */
  constructor(
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly storeVisit: DouyinStoreVisitService,
    private readonly planner: DouyinStoreVisitPlannerService,
    private readonly spots: DouyinStoreVisitSpotService,
    private readonly operations: DouyinOperationService,
    private readonly generationJobs: DouyinGenerationJobService,
    private readonly unify: DouyinUnifyService,
    private readonly director: DouyinVideoDirectorService,
    private readonly personas: DouyinPersonaRepositoryService,
    private readonly knowledge: KnowledgeService,
    private readonly gallery: GalleryService,
    private readonly galleryGroups: GalleryGroupService,
    private readonly pipeline: DouyinStoreVisitPipelineService,
    private readonly segmentImages: DouyinSegmentImageService,
  ) {}

  /**
   * @description 读一条脚本（子选题），不存在或不是脚本时报错。
   * @keyword-cn 读取脚本, 子选题校验
   * @keyword-en require-child-topic, child-topic-check
   */
  private async requireChild(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new NotFoundException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return topic;
  }

  /**
   * @description 读一条统一出片流程的脚本：旧分镜脚本先自动转成从脚本开始的统一流程（与桌面端打开时转换同规则）。
   * @keyword-cn 读取统一流程脚本, 旧分镜自动转换
   * @keyword-en require-unified-topic, auto-unify
   */
  private async requireStoreVisit(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.requireChild(topicId, scope);
    if (topic.productionMode === 'store-visit') return topic;
    return (await this.unify.unify(topic.id, scope)).topic;
  }

  /**
   * @description 按和 HTTP 接口同一套 DTO 校验（白名单、拒绝多余字段）后保存选题，再像接口一样让 AI 导演按新画面重新规划。
   * @keyword-cn 校验后保存选题, 同步导演规划
   * @keyword-en validated-topic-save, reschedule-director
   * @param {number} topicId 选题 ID。
   * @param {Record<string, unknown>} patch 修改内容（`UpdateDouyinTopicDto` 结构）。
   * @param {DouyinScope} scope 作用域。
   * @returns {Promise<DouyinTopicEntity>} 保存后的选题。
   */
  private async save(
    topicId: number,
    patch: Record<string, unknown>,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const dto = plainToInstance(UpdateDouyinTopicDto, patch);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      throw new BadRequestException(describeValidationErrors(errors));
    const saved = await this.repository.update(topicId, dto, scope);
    if (!saved) throw new NotFoundException('DOUYIN_TOPIC_NOT_FOUND');
    await this.director.schedule(saved.id, scope);
    return (await this.repository.get(saved.id, scope)) ?? saved;
  }

  /**
   * @description 按 DTO 校验一份入参，失败时抛出中文说明。
   * @keyword-cn DTO校验, 入参校验
   * @keyword-en validate-dto, input-validation
   */
  private async validated<T extends object>(
    type: new () => T,
    input: Record<string, unknown>,
  ): Promise<T> {
    const dto = plainToInstance(type, input);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      throw new BadRequestException(describeValidationErrors(errors));
    return dto;
  }

  /**
   * @description 读这条脚本选的门店，没选、门店已删除或从脚本开始时为空。
   * @keyword-cn 读取脚本门店, 门店可能已删
   * @keyword-en topic-store, store-may-be-deleted
   */
  private async storeOf(
    topic: DouyinTopicEntity,
    scope: DouyinScope,
  ): Promise<DouyinStoreVisitStoreEntity | null> {
    if (storeVisitStart(topic.storeVisit) === 'script') return null;
    const storeId = Number(topic.storeVisit?.storeId);
    if (!storeId) return null;
    return this.spots.requireStore(storeId, scope).catch(() => null);
  }

  /**
   * @description 保存分段：选了门店时一并把分段用到的点位同步成选题素材（与桌面端 `persistSegments` 同规则）。
   * @keyword-cn 保存分段与素材, 点位同步素材
   * @keyword-en persist-segments, sync-spot-materials
   */
  private async persistSegments(
    topic: DouyinTopicEntity,
    segments: DouyinStoreVisitSegment[],
    extra: Record<string, unknown>,
    scope: DouyinScope,
    store?: DouyinStoreVisitStoreEntity | null,
  ): Promise<DouyinTopicEntity> {
    const target =
      store === undefined ? await this.storeOf(topic, scope) : store;
    const spotIds = target ? usedStoreVisitSpotIds(segments, target) : [];
    return this.save(
      topic.id,
      {
        storeVisit: {
          ...(target
            ? { spotIds, ...spotsToStoreVisitMaterials(target, spotIds) }
            : {}),
          segments: toStoreVisitSegmentsPayload(segments),
          ...extra,
        },
      },
      scope,
    );
  }

  /**
   * @description 人物镜头的画面来源：人物节点支持多图参考时用参考图，否则 AI 合成首帧（与桌面端 `defaultPresenterSource` 同规则）。
   * @keyword-cn 人物画面来源, 多图参考
   * @keyword-en presenter-source, multi-reference
   */
  private async presenterSource(): Promise<'generated' | 'references'> {
    const options = await this.operations.getVideoOptions();
    return options.storeVisit.avatar?.multiReference
      ? 'references'
      : 'generated';
  }

  /**
   * @description 出片前的拦截原因（与桌面端 `generateBlocked` 同规则与顺序），可以出片时为空。
   * @keyword-cn 出片拦截原因, 出片前检查
   * @keyword-en generate-blocker, pre-generate-check
   * @param {DouyinTopicEntity} topic 探店脚本。
   * @param {DouyinStoreVisitStoreEntity|null} store 门店。
   * @returns {Promise<string>} 拦截原因。
   */
  private async generateBlocker(
    topic: DouyinTopicEntity,
    store: DouyinStoreVisitStoreEntity | null,
  ): Promise<string> {
    const setting = topic.storeVisit ?? {};
    const segments = setting.segments ?? [];
    const script = String(setting.script ?? '').trim();
    const linesCurrent =
      segments.length > 0 &&
      (setting.linesScript ? setting.linesScript === script : !script);
    const template =
      setting.template === 'voiceover' || setting.template === 'opening'
        ? setting.template
        : '';
    const presenter = template === 'opening';
    const nodes = (await this.operations.getVideoOptions()).storeVisit;
    const videoMax = nodes.video?.durations?.length
      ? Math.max(...nodes.video.durations)
      : 15;
    const presenterMax = nodes.avatar?.durations?.length
      ? Math.max(...nodes.avatar.durations)
      : 15;
    /** @description 一段的台词有没有超过单段时长上限（人物镜头按人物节点）。 @keyword-cn 台词时长校验, 单段上限 @keyword-en lines-duration-check, segment-limit */
    const fits = (segment: DouyinStoreVisitSegment) =>
      estimateStoreVisitLinesSeconds(segment.lines) <=
      (segment.shot === 'presenter' && !segment.sceneVideoId
        ? presenterMax
        : videoMax);
    // 从脚本开始的画面是图库挑图或 AI 生图，直接在脚本素材里，不按门店点位算
    const materials =
      store && storeVisitStart(setting) === 'store'
        ? spotsToStoreVisitMaterials(
            store,
            usedStoreVisitSpotIds(segments, store),
          )
        : {
            sceneImages: setting.sceneImages ?? [],
            sceneVideos: setting.sceneVideos ?? [],
          };
    /** @description 一段配好了场景：素材在这家店同步出的素材里，人物镜头不能用实拍视频。 @keyword-cn 分段场景就绪, 素材校验 @keyword-en segment-scene-ready, material-check */
    const placed = (segment: DouyinStoreVisitSegment) =>
      segment.sceneVideoId
        ? segment.shot !== 'presenter' &&
          materials.sceneVideos.some(
            (video) => Number(video.id) === Number(segment.sceneVideoId),
          )
        : materials.sceneImages.some(
            (image) => Number(image.id) === Number(segment.sceneImageId),
          );
    const videoHint = describeStoreVisitNode(nodes.video, '探店画面视频');
    const avatarHint = describeStoreVisitNode(nodes.avatar, '探店人物对口型');
    if (!segments.length) return '请先根据脚本生成台词';
    if (!linesCurrent) return '脚本已修改，请先根据当前脚本重新生成台词';
    if (!template) return '还没选出镜方式';
    if (!(setting.voiceId || setting.voicePrompt?.trim())) return '还没有音色';
    if (presenter && !setting.faceImage) return '还没有出镜人物';
    if (!segments.every((segment) => segment.lines?.trim() && fits(segment)))
      return '有段没写台词或台词太长';
    if (!store && storeVisitStart(setting) === 'store') return '还没选门店';
    if (!segments.every(placed)) return '还有段没配画面';
    if (videoHint) return videoHint;
    if (presenter && avatarHint) return avatarHint;
    return '';
  }

  /**
   * @description 一条调用记录的简明状态：等模型空位、等桌面端截尾帧续段、生成中、完成或失败（带原因）。
   * @keyword-cn 调用简明状态, 等桌面端
   * @keyword-en operation-brief, waiting-for-desktop
   */
  private operationBrief(operation: DouyinOperationView | undefined) {
    if (!operation) return undefined;
    const waitingDesktop =
      operation.status === 'queued' &&
      operation.continuity?.stage === 'waiting';
    return {
      id: operation.id,
      status: waitingDesktop
        ? 'waiting-desktop'
        : operation.queue
          ? 'waiting-model-slot'
          : operation.status,
      ...(operation.progress !== undefined
        ? { progress: operation.progress }
        : {}),
      ...(operation.error ? { error: operation.error } : {}),
    };
  }

  /**
   * @description 读视频记录的播放地址，读不到时为空。
   * @keyword-cn 读取视频地址, 成片地址
   * @keyword-en video-url, merged-video-url
   */
  private async videoUrl(
    videoId: number | undefined,
    scope: DouyinScope,
  ): Promise<string | undefined> {
    if (!videoId) return undefined;
    try {
      const row = await this.repository.requireVideo(videoId, scope);
      return typeof row.url === 'string' ? row.url : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * @description 门店的简明视图：点位名称、说明、开场标记、图片与视频数和最高分图。
   * @keyword-cn 门店简明视图, 点位概览
   * @keyword-en store-brief, spot-overview
   */
  private storeBrief(store: DouyinStoreVisitStoreView) {
    return {
      id: store.id,
      name: store.name,
      description: store.description,
      spots: store.spots.map((spot) => ({
        id: spot.id,
        name: spot.name,
        description: spot.description,
        ...(spot.opening ? { opening: true } : {}),
        images: rankStoreVisitSpotImages(spot).map((image) => ({
          imageId: image.imageId,
          description: image.description,
          score: image.score,
        })),
        videoCount: spot.videos.length,
      })),
    };
  }

  /**
   * @description 工作台概览：每个母选题下的脚本与制作进度一句话摘要。
   * @keyword-cn 工作台概览, 制作进度摘要
   * @keyword-en workspace-overview, production-summary
   * @param {DouyinScope} scope 作用域。
   * @returns 母选题与脚本摘要。
   */
  async workspace(scope: DouyinScope) {
    const groups = await this.repository.listWorkspace(scope);
    return {
      motherTopics: groups.map((group) => ({
        id: group.id,
        title: group.title,
        productionMode: group.productionMode || 'storyboard',
        knowledgeIds: group.knowledgeIds ?? [],
        scripts: group.children.map((child) => {
          const segments = child.storeVisit?.segments ?? [];
          const scriptFirst = storeVisitStart(child.storeVisit) === 'script';
          const progress =
            child.productionMode === 'store-visit'
              ? `${scriptFirst ? '从脚本开始' : `从门店开始（门店：${child.storeVisit?.storeName || '未选'}）`}；脚本：${child.storeVisit?.script?.trim() ? '已写' : '未写'}；分段 ${segments.length} 段，已出片 ${segments.filter(isStoreVisitSegmentReady).length} 段；成片：${child.generatedVideoId ? '有' : '无'}`
              : `旧分镜脚本（${child.storyboard.length} 镜），任一工具操作它时会自动转成从脚本开始的新流程；成片：${child.generatedVideoId ? '有' : '无'}`;
          return {
            id: child.id,
            title: child.title,
            productionMode: child.productionMode || 'storyboard',
            ...(child.productionMode === 'store-visit'
              ? { start: scriptFirst ? 'script' : 'store' }
              : {}),
            status: child.status,
            progress,
          };
        }),
      })),
    };
  }

  /**
   * @description 一条脚本的完整状态：起点、门店、出镜、人物、音色、脚本与各段（画面、出片、生成状态），成片地址、出片前还差什么、下一步建议，
   *   以及是否在等桌面端续段或拼接；旧分镜脚本先自动转成统一流程。
   * @keyword-cn 脚本完整状态, 下一步建议
   * @keyword-en topic-detail, next-step
   * @param {number} topicId 脚本 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本状态。
   */
  async topicDetail(topicId: number, scope: DouyinScope) {
    const topic = await this.requireStoreVisit(topicId, scope);
    const operations = (await this.operations.list(scope)).filter(
      (operation) => operation.topicId === topic.id,
    );
    /** @description 某段或某镜最近的一条生成调用。 @keyword-cn 最近生成调用, 分段状态 @keyword-en latest-operation, segment-status */
    const latest = (key: 'segmentId', id: string) =>
      operations
        .filter(
          (operation) =>
            operation.operation === 'generate' && operation[key] === id,
        )
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
    const merge = operations
      .filter((operation) => operation.mode === 'concat')
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
    const base = {
      id: topic.id,
      parentId: topic.parentId,
      title: topic.title,
      productionMode: topic.productionMode || 'storyboard',
      status: topic.status,
      autoMerge: Boolean(topic.autoConcatShots),
      mergedVideo: topic.generatedVideoId
        ? {
            videoId: topic.generatedVideoId,
            url: await this.videoUrl(topic.generatedVideoId, scope),
          }
        : null,
      merge: this.operationBrief(merge),
    };
    const setting = topic.storeVisit ?? {};
    const store = await this.storeOf(topic, scope);
    const spotName = new Map(
      (store?.spots ?? []).map((spot) => [spot.id, spot.name]),
    );
    const segments = await Promise.all(
      (setting.segments ?? []).map(async (segment) => ({
        id: segment.id,
        lines: segment.lines,
        ...(segment.delivery ? { delivery: segment.delivery } : {}),
        seconds: estimateStoreVisitLinesSeconds(segment.lines),
        shot: segment.shot || 'broll',
        ...(segment.spotId
          ? { spot: { id: segment.spotId, name: spotName.get(segment.spotId) } }
          : {}),
        ...(segment.sceneVideoId
          ? { sceneVideoId: segment.sceneVideoId }
          : segment.sceneImageId
            ? {
                sceneImageIds: segment.sceneImageIds?.length
                  ? segment.sceneImageIds
                  : [segment.sceneImageId],
              }
            : {}),
        ready: isStoreVisitSegmentReady(segment),
        ...(segment.videoId
          ? {
              video: {
                videoId: segment.videoId,
                url: await this.videoUrl(segment.videoId, scope),
              },
            }
          : {}),
        generation: this.operationBrief(latest('segmentId', segment.id)),
      })),
    );
    const script = String(setting.script ?? '').trim();
    const linesCurrent =
      segments.length > 0 &&
      (setting.linesScript ? setting.linesScript === script : !script);
    const blocker = await this.generateBlocker(topic, store);
    const allReady =
      segments.length > 0 && segments.every((item) => item.ready);
    const waitingDesktop = segments.some(
      (item) => item.generation?.status === 'waiting-desktop',
    );
    const scriptFirst = storeVisitStart(setting) === 'script';
    const nextStep =
      !scriptFirst && !store
        ? '先用 douyin_store_visit_set_store 选门店（没有门店先 douyin_store_create 并上传照片归类）；不拍门店就用 douyin_store_visit_set_start 改成从脚本开始'
        : !script
          ? '用 douyin_store_visit_write_script 让 AI 写脚本'
          : !linesCurrent
            ? '用 douyin_store_visit_generate_lines 按脚本生成分段台词'
            : blocker && blocker !== '还有段没配画面'
              ? `出片前还差：${blocker}`
              : blocker
                ? scriptFirst
                  ? '用 douyin_store_visit_pick_pictures 从图库配画面，或 douyin_store_visit_generate_pictures 让 AI 生图'
                  : '用 douyin_store_visit_match_scenes 让 AI 配场景'
                : topic.generatedVideoId && allReady
                  ? '已有成片'
                  : allReady
                    ? '全部分段已出片：桌面端打开「视频制作」页后自动拼接（可用 douyin_video_merge 打开自动拼接）'
                    : setting.pipeline?.state === 'paused'
                      ? '导演已暂停：改好后用 douyin_store_visit_pipeline（resume）继续'
                      : segments.some((item) => item.generation)
                        ? '出片进行中，稍后再用 douyin_topic_get 查看'
                        : '可以用 douyin_store_visit_generate 出片';
    return {
      ...base,
      start: scriptFirst ? 'script' : 'store',
      store: store ? { id: store.id, name: store.name } : null,
      template: setting.template ?? null,
      persona: topic.personaId ?? null,
      hasPresenterImage: Boolean(setting.faceImage),
      voice: setting.voiceId
        ? {
            source: setting.voiceSource,
            voiceId: setting.voiceId,
            name: setting.voiceName,
          }
        : setting.voicePrompt?.trim()
          ? { source: 'prompt', prompt: setting.voicePrompt.trim() }
          : null,
      script,
      linesCurrent,
      segments,
      pipeline: setting.pipeline
        ? {
            state: setting.pipeline.state,
            ...(setting.pipeline.pauseReason
              ? { pauseReason: setting.pipeline.pauseReason }
              : {}),
            ...(setting.pipeline.error
              ? { error: setting.pipeline.error }
              : {}),
            ...(setting.pipeline.currentSegmentId
              ? { currentSegmentId: setting.pipeline.currentSegmentId }
              : {}),
          }
        : null,
      blocker,
      ...(waitingDesktop
        ? {
            desktop:
              '有段在等桌面端截上一段尾帧续段：请用同一账号打开桌面端「视频制作」页',
          }
        : {}),
      nextStep,
    };
  }

  /**
   * @description 新建母选题（分镜或探店模式，可带引用知识）；探店模式会自动带出一条空脚本。
   * @keyword-cn 新建母选题, 探店带脚本
   * @keyword-en create-mother-topic, store-visit-draft
   * @param {{title: string, productionMode: 'storyboard'|'store-visit', knowledgeIds?: string[]}} input 母选题。
   * @param {DouyinScope} scope 作用域。
   * @returns 母选题与它下面的脚本。
   */
  async createTopic(
    input: {
      title: string;
      productionMode: 'storyboard' | 'store-visit';
      knowledgeIds?: string[];
    },
    scope: DouyinScope,
  ) {
    const dto = await this.validated(CreateDouyinMotherTopicDto, {
      kind: 'mother',
      ...input,
    });
    const mother = await this.repository.create(dto, scope);
    const group = (await this.repository.listWorkspace(scope)).find(
      (item) => item.id === mother.id,
    );
    return {
      motherTopic: {
        id: mother.id,
        title: mother.title,
        productionMode: mother.productionMode,
      },
      scripts: (group?.children ?? []).map((child) => ({
        id: child.id,
        title: child.title,
      })),
    };
  }

  /**
   * @description 修改脚本：标题、脚本正文、各段台词与念法（只改给出的项）；旧分镜脚本先自动转成统一流程。
   * @keyword-cn 修改脚本内容, 手动改台词
   * @keyword-en update-topic-content, edit-lines
   * @param {number} topicId 脚本 ID。
   * @param {{title?: string, script?: string, segments?: Array<{id: string, lines?: string, delivery?: string}>}} input 修改。
   * @param {DouyinScope} scope 作用域。
   * @returns 修改后的脚本状态。
   */
  async updateTopic(
    topicId: number,
    input: {
      title?: string;
      script?: string;
      segments?: Array<{ id: string; lines?: string; delivery?: string }>;
    },
    scope: DouyinScope,
  ) {
    let topic = await this.requireStoreVisit(topicId, scope);
    if (input.title !== undefined)
      topic = await this.save(topic.id, { title: input.title }, scope);
    if (input.script !== undefined || input.segments?.length) {
      if (input.script !== undefined)
        topic = await this.save(
          topic.id,
          { storeVisit: { script: input.script.trim() } },
          scope,
        );
      if (input.segments?.length) {
        const edits = new Map(input.segments.map((item) => [item.id, item]));
        const segments = topic.storeVisit?.segments ?? [];
        const unknown = [...edits.keys()].filter(
          (id) => !segments.some((segment) => segment.id === id),
        );
        if (unknown.length)
          throw new BadRequestException(`没有这些分段：${unknown.join('、')}`);
        topic = await this.persistSegments(
          topic,
          segments.map((segment) => {
            const edit = edits.get(segment.id);
            if (!edit) return segment;
            return {
              ...segment,
              ...(edit.lines !== undefined ? { lines: edit.lines } : {}),
              ...(edit.delivery !== undefined
                ? { delivery: edit.delivery }
                : {}),
            };
          }),
          {},
          scope,
        );
      }
    }
    return this.topicDetail(topic.id, scope);
  }

  /**
   * @description 删除选题（删母选题时连同下面的脚本）。
   * @keyword-cn 删除选题, 级联删除
   * @keyword-en delete-topic, cascade-delete
   * @param {number} topicId 选题 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns {Promise<{deleted: number}>} 删除条数。
   */
  async deleteTopic(topicId: number, scope: DouyinScope) {
    const deleted = await this.repository.remove(topicId, scope);
    if (!deleted) throw new NotFoundException('DOUYIN_TOPIC_NOT_FOUND');
    return { deleted };
  }

  /**
   * @description 视频节点概况：整片 / 分镜出片通道与可选时长，探店三个节点（音色、画面视频、人物）是否配好及原因。
   * @keyword-cn 视频节点概况, 节点可用性
   * @keyword-en video-options, node-availability
   * @returns 节点概况。
   */
  async videoOptions() {
    const options = await this.operations.getVideoOptions();
    return {
      full: options.full,
      shot: options.shot,
      storeVisit: Object.fromEntries(
        Object.entries(options.storeVisit).map(([key, node]) => [
          key,
          {
            configured: node.configured,
            model: node.model,
            durations: node.durations,
            ...(node.error ? { error: node.error } : {}),
          },
        ]),
      ),
    };
  }

  /**
   * @description 可选的预设出镜人物：名称、简介、有没有可用形象图（探店开头出镜必须有）。
   * @keyword-cn 预设人物列表, 形象图可用
   * @keyword-en persona-list, face-image-available
   * @param {DouyinScope} scope 作用域。
   * @returns 人物列表。
   */
  async personaList(scope: DouyinScope) {
    return {
      personas: (await this.personas.list(scope)).map((persona) => ({
        id: persona.id,
        name: persona.name,
        summary: persona.summary,
        hasPresenterImage: Boolean(personaFaceReference(persona)),
      })),
    };
  }

  /**
   * @description 引用知识列表（可按关键词搜索），新建母选题时可引用，AI 写脚本会照着它写。
   * @keyword-cn 引用知识列表, 知识搜索
   * @keyword-en knowledge-list, knowledge-search
   * @param {string|undefined} keyword 关键词。
   * @param {DouyinScope} scope 作用域。
   * @returns 知识列表。
   */
  async knowledgeList(keyword: string | undefined, scope: DouyinScope) {
    const items = await this.knowledge.list(keyword, scope);
    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        excerpt: String(item.content ?? '').slice(0, 200),
      })),
    };
  }

  /**
   * @description 请求拼接成片：打开「全部出片后自动拼接」，由打开「视频制作」页的桌面端在全部出片后领取合成。
   * @keyword-cn 请求拼接成片, 自动拼接
   * @keyword-en request-merge, auto-merge
   * @param {number} topicId 脚本 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns 是否已全部出片与说明。
   */
  async requestMerge(topicId: number, scope: DouyinScope) {
    const topic = await this.save(topicId, { autoConcatShots: true }, scope);
    const ready =
      topic.productionMode === 'store-visit'
        ? (topic.storeVisit?.segments ?? []).length > 0 &&
          (topic.storeVisit?.segments ?? []).every(isStoreVisitSegmentReady)
        : topic.storyboard.length > 0 &&
          topic.storyboard.every((shot) => shot.videoId);
    return {
      autoMerge: true,
      allClipsReady: ready,
      message: ready
        ? '已全部出片，桌面端打开「视频制作」页后会自动拼接成片'
        : '还有片段没出片，全部出片后桌面端会自动拼接',
    };
  }

  /**
   * @description 门店列表（租户内共享）与各点位概况。
   * @keyword-cn 门店列表, 点位概况
   * @keyword-en store-list, spot-overview
   * @param {DouyinScope} scope 作用域。
   * @returns 门店列表。
   */
  async storeList(scope: DouyinScope) {
    return {
      stores: (await this.spots.listStores(scope)).map((store) =>
        this.storeBrief(store),
      ),
    };
  }

  /**
   * @description 新建门店（同租户同名直接返回已有门店）。
   * @keyword-cn 新建门店, 同名复用
   * @keyword-en create-store, reuse-same-name
   * @param {{name: string, description?: string}} input 门店名与整体说明。
   * @param {DouyinScope} scope 作用域。
   * @returns 门店。
   */
  async createStore(
    input: { name: string; description?: string },
    scope: DouyinScope,
  ) {
    const dto = await this.validated(CreateDouyinStoreVisitStoreDto, input);
    return { store: this.storeBrief(await this.spots.createStore(dto, scope)) };
  }

  /**
   * @description 把一张已落盘的门店照片登记进图库「场景图库」分组（带门店名标签），供 AI 归类成点位。
   * @keyword-cn 登记门店照片, 场景图库入库
   * @keyword-en register-store-photo, scene-gallery-intake
   * @param {number} storeId 门店 ID。
   * @param {{originalName: string, fileName: string, absPath: string, url: string, mimeType: string, size: number, width?: number, height?: number}} file 已落盘的图片。
   * @param {DouyinScope} scope 作用域。
   * @param {string} username 图库按用户名记录归属。
   * @returns 图片 ID 与地址。
   */
  async registerStorePhoto(
    storeId: number,
    file: {
      originalName: string;
      fileName: string;
      absPath: string;
      url: string;
      mimeType: string;
      size: number;
      width?: number;
      height?: number;
    },
    scope: DouyinScope,
    username: string,
  ) {
    const store = await this.spots.requireStore(storeId, scope);
    const group = await this.galleryGroups.findOrCreateSceneGroup(
      username,
      scope.tenantId,
    );
    const [image] = await this.gallery.createMany([
      {
        userId: username,
        tenantId: scope.tenantId,
        scope: 'tenant',
        groupId: group.id,
        ...file,
        tags: [String(store.name).slice(0, 30)],
      },
    ]);
    return { imageId: image.id, url: image.url };
  }

  /**
   * @description AI 把一批门店照片（最多 16 张）归类成点位并直接保存（与桌面端 `runClassification` 同流程：相似度预分组 → 每批 8 张交给视觉模型 → 合并进门店点位）；
   *   新点位名称由 AI 起，可用整体保存点位改名；中途失败时已归好的照片照常保存。
   * @keyword-cn AI归类门店照片, 归类并保存
   * @keyword-en classify-store-photos, classify-and-save
   * @param {number} storeId 门店 ID。
   * @param {number[]} imageIds 场景图库里的图片 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns 保存后的门店、归上的张数、没认出的图片、新点位名称与中途失败原因。
   */
  async classifyStorePhotos(
    storeId: number,
    imageIds: number[],
    scope: DouyinScope,
  ) {
    const ids = [...new Set(imageIds.map(Number))].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (!ids.length || ids.length > DOUYIN_AGENT_CLASSIFY_LIMIT)
      throw new BadRequestException(
        `每次归类 1～${DOUYIN_AGENT_CLASSIFY_LIMIT} 张图片`,
      );
    const store = await this.spots.requireStore(storeId, scope);
    let clusters = ids.map((id) => [id]);
    try {
      const result = await this.spots.similarity(storeId, ids, scope);
      const grouped = result.clusters.filter((cluster) => cluster.length);
      const inGroups = new Set(grouped.flat());
      clusters = [
        ...grouped,
        ...ids.filter((id) => !inGroups.has(id)).map((id) => [id]),
      ];
    } catch {
      // 相似度算不出来不影响视觉模型逐张判断
    }
    const similar = clusters.filter((cluster) => cluster.length > 1);
    const working: Array<{
      key: string;
      id?: string;
      name: string;
      description: string;
      opening?: boolean;
      images: Array<{ imageId: number; description: string; score: number }>;
      videos: Array<{ videoId: number; description: string }>;
    }> = store.spots.map((spot: DouyinStoreVisitSpot) => ({
      key: spot.id,
      id: spot.id,
      name: spot.name,
      description: spot.description,
      opening: spot.opening,
      images: spot.images.map((image) => ({
        imageId: image.imageId,
        description: image.description,
        score: image.score,
      })),
      videos: spot.videos.map((video) => ({
        videoId: video.videoId,
        description: video.description,
      })),
    }));
    const missed = new Set<number>();
    const created: string[] = [];
    let assigned = 0;
    let failure = '';
    for (const batch of packStoreVisitClassifyBatches(clusters)) {
      if (failure) {
        batch.forEach((id) => missed.add(id));
        continue;
      }
      const drafts = working
        .filter((spot) => !spot.id)
        .map((spot) => {
          const cover = rankStoreVisitSpotImages({
            images: spot.images.map((image) => ({ ...image, url: '' })),
          })[0];
          return {
            key: spot.key,
            name: spot.name.trim() || '未命名点位',
            description: spot.description,
            ...(cover ? { coverImageId: cover.imageId } : {}),
          };
        });
      const placedInBatch = new Set<number>();
      try {
        await this.spots.classify(
          storeId,
          {
            imageIds: batch,
            groups: similar.filter((cluster) =>
              cluster.some((id) => batch.includes(id)),
            ),
            drafts,
          },
          scope,
          (event) => {
            if (event.type === 'spot') {
              if (working.some((spot) => spot.key === event.key)) return;
              working.push({
                key: event.key,
                name: event.name,
                description: event.description,
                opening: event.opening,
                images: [],
                videos: [],
              });
              created.push(event.name);
            } else if (event.type === 'assign') {
              const target = working.find((spot) => spot.key === event.spotKey);
              if (!target) return;
              for (const spot of working)
                spot.images = spot.images.filter(
                  (image) => image.imageId !== event.imageId,
                );
              target.images.push({
                imageId: event.imageId,
                description: event.description,
                score: event.score,
              });
              placedInBatch.add(event.imageId);
              assigned += 1;
            } else if (event.type === 'done') {
              event.missed.forEach((id) => missed.add(id));
            } else if (event.type === 'error') {
              failure = event.message;
            }
          },
        );
      } catch (error) {
        failure = error instanceof Error ? error.message : 'AI 归类失败';
      }
      if (failure)
        batch
          .filter((id) => !placedInBatch.has(id))
          .forEach((id) => missed.add(id));
    }
    const saved = await this.spots.saveSpots(
      storeId,
      toStoreVisitSpotsPayload(
        working.filter((spot) => spot.id || spot.images.length),
      ),
      scope,
    );
    return {
      store: this.storeBrief(saved),
      assigned,
      missed: [...missed],
      newSpots: created,
      ...(failure ? { error: `AI 归类中途停了：${failure}` } : {}),
    };
  }

  /**
   * @description 整体保存门店点位（改名、改说明、调整图片归属或打分；没列出的已有点位会被删除）。
   * @keyword-cn 保存门店点位, 点位改名
   * @keyword-en save-store-spots, rename-spot
   * @param {number} storeId 门店 ID。
   * @param {Array<{id?: string, name: string, description?: string, opening?: boolean, images: Array<{imageId: number, description?: string, score?: number}>, videos?: Array<{videoId: number, description?: string}>}>} spots 全部点位。
   * @param {DouyinScope} scope 作用域。
   * @returns 保存后的门店。
   */
  async saveStoreSpots(
    storeId: number,
    spots: Array<{
      id?: string;
      name: string;
      description?: string;
      opening?: boolean;
      images: Array<{ imageId: number; description?: string; score?: number }>;
      videos?: Array<{ videoId: number; description?: string }>;
    }>,
    scope: DouyinScope,
  ) {
    const dto = await this.validated(SaveDouyinStoreVisitSpotsDto, {
      spots: toStoreVisitSpotsPayload(spots),
    });
    return {
      store: this.storeBrief(
        await this.spots.saveSpots(storeId, dto.spots, scope),
      ),
    };
  }

  /**
   * @description 给探店脚本选门店（与桌面端 `chooseStore` 同规则）：换店时清掉已配的场景与台词来源，脚本正文保留。
   * @keyword-cn 选用门店, 换店清场景
   * @keyword-en choose-store, switch-store-reset
   * @param {number} topicId 脚本 ID。
   * @param {number} storeId 门店 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本状态。
   */
  async setStore(topicId: number, storeId: number, scope: DouyinScope) {
    const topic = await this.requireStoreVisit(topicId, scope);
    const store = await this.spots.requireStore(storeId, scope);
    const setting = topic.storeVisit ?? {};
    const switching =
      Boolean(setting.storeId) && Number(setting.storeId) !== store.id;
    const cleared = switching
      ? (setting.segments ?? []).map(withoutStoreVisitScene)
      : [];
    await this.save(
      topic.id,
      {
        storeVisit: {
          storeId: store.id,
          storeName: store.name,
          sceneDescription: store.description || '',
          ...(switching
            ? {
                linesScript: '',
                spotIds: [],
                sceneImages: [],
                sceneVideos: [],
                openingScene: null,
                segments: toStoreVisitSegmentsPayload(cleared),
              }
            : {}),
        },
      },
      scope,
    );
    return this.topicDetail(topic.id, scope);
  }

  /**
   * @description AI 读引用知识写探店脚本正文并保存（与桌面端 `applyScript` 同规则）：不沿用人物音色时一并定出镜方式、预设人物（要有形象图）与音色；
   *   门店还没定时只返回 AI 的门店确认问题，不落库。
   * @keyword-cn AI写探店脚本, 人物音色落库
   * @keyword-en write-store-visit-script, save-cast
   * @param {number} topicId 脚本 ID。
   * @param {{prompt?: string, keepCast?: boolean, issues?: string[]}} input 补充要求、是否沿用人物音色、按自检问题修改。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本、自检结果、AI 选的人物与音色，或门店确认问题。
   */
  async writeScript(
    topicId: number,
    input: { prompt?: string; keepCast?: boolean; issues?: string[] },
    scope: DouyinScope,
  ) {
    const topic = await this.requireStoreVisit(topicId, scope);
    const result = await this.planner.writeScript(topic.id, input, scope);
    if ('needsStore' in result && result.needsStore)
      return { needsStore: true, storeQuestion: result.storeQuestion };
    const written = result as {
      script: string;
      presenter: boolean;
      persona?: { personaId: number; name: string; reason: string } | null;
      voice?: {
        voiceId: string;
        voiceName: string;
        reason: string;
        voicePrompt: string;
      };
      review?: unknown;
    };
    const keepCast = Boolean(input.keepCast || input.issues?.length);
    const current = topic.storeVisit?.template;
    const template = keepCast
      ? current === 'opening' || current === 'voiceover'
        ? current
        : 'voiceover'
      : written.presenter
        ? 'opening'
        : 'voiceover';
    await this.save(
      topic.id,
      { storeVisit: { script: written.script.trim(), template } },
      scope,
    );
    const cast: Record<string, unknown> = {};
    if (!keepCast) {
      const persona = written.persona
        ? (await this.personas.list(scope)).find(
            (item) => item.id === Number(written.persona?.personaId),
          )
        : undefined;
      const face =
        written.presenter && persona ? personaFaceReference(persona) : null;
      if (persona && face) {
        await this.save(
          topic.id,
          { personaId: persona.id, storeVisit: { faceImage: face } },
          scope,
        );
        cast.persona = {
          id: persona.id,
          name: persona.name,
          reason: written.persona?.reason,
        };
      } else if (written.presenter)
        cast.personaHint =
          'AI 没挑到带形象图的人物，请用 douyin_store_visit_set_cast 指定一个';
      const nodes = (await this.operations.getVideoOptions()).storeVisit;
      const voiceHint = describeStoreVisitNode(
        nodes.voiceClone,
        '音色克隆与配音',
      );
      try {
        if (written.voice?.voiceId && !voiceHint) {
          await this.storeVisit.usePresetVoice(
            topic.id,
            written.voice.voiceId,
            scope,
          );
          cast.voice = {
            voiceId: written.voice.voiceId,
            name: written.voice.voiceName,
            reason: written.voice.reason,
          };
        } else if (written.voice?.voicePrompt) {
          await this.save(
            topic.id,
            { storeVisit: { voicePrompt: written.voice.voicePrompt } },
            scope,
          );
          cast.voice = {
            prompt: written.voice.voicePrompt,
            reason: written.voice.reason,
          };
        }
      } catch (error) {
        cast.voiceError = `音色保存失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return {
      script: written.script.trim(),
      template,
      review: written.review,
      ...cast,
    };
  }

  /**
   * @description 按已保存的脚本正文生成分段台词并保存（与桌面端 `generateScriptLines` 同规则）：每段新 ID，按出镜方式排好镜头，已有台词与场景会被替换。
   * @keyword-cn 按脚本生成台词, 保存台词来源
   * @keyword-en generate-script-lines, save-lines-source
   * @param {number} topicId 脚本 ID。
   * @param {string|undefined} prompt 台词要求。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本状态。
   */
  async generateLines(
    topicId: number,
    prompt: string | undefined,
    scope: DouyinScope,
  ) {
    const topic = await this.requireStoreVisit(topicId, scope);
    const store = await this.storeOf(topic, scope);
    if (!store)
      throw new BadRequestException(
        '请先选门店（douyin_store_visit_set_store）',
      );
    const source = String(topic.storeVisit?.script ?? '').trim();
    if (!source) throw new BadRequestException('请先写脚本正文');
    const result = await this.planner.generateLines(
      topic.id,
      { prompt: prompt?.trim() },
      scope,
    );
    if (!result?.segments?.length || result.linesScript !== source)
      throw new BadRequestException('台词未对应当前脚本，请重试');
    const drafts: DouyinStoreVisitSegment[] = result.segments.map(
      (segment: { lines: string; scene?: string; delivery?: string }) => ({
        id: createStoreVisitSegmentId(),
        lines: segment.lines,
        scene: segment.scene || '',
        action: '',
        ...(segment.delivery ? { delivery: segment.delivery } : {}),
        shot: 'broll',
      }),
    );
    const next = applyStoreVisitTemplate(
      drafts,
      topic.storeVisit?.template || 'voiceover',
      await this.presenterSource(),
      'original',
    );
    await this.persistSegments(
      topic,
      next,
      { linesScript: source },
      scope,
      store,
    );
    return this.topicDetail(topic.id, scope);
  }

  /**
   * @description 设定出镜方式、预设人物与音色（只改给出的项）：换出镜方式时按它重排各段镜头；音色可选音色库或按一句描述定制（定制会调用百炼声音设计）；
   *   只换人物没给音色时，音色按 `matchPersonaVoice` 跟着人物走（录音克隆与描述定制的不动）。
   * @keyword-cn 设定人物音色, 切换出镜方式
   * @keyword-en set-cast, switch-template
   * @param {number} topicId 脚本 ID。
   * @param {{template?: 'voiceover'|'opening', personaId?: number, voiceId?: string, voiceDesignPrompt?: string, voiceName?: string}} input 设定。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本状态。
   */
  async setCast(
    topicId: number,
    input: {
      template?: 'voiceover' | 'opening';
      personaId?: number;
      voiceId?: string;
      voiceDesignPrompt?: string;
      voiceName?: string;
    },
    scope: DouyinScope,
  ) {
    let topic = await this.requireStoreVisit(topicId, scope);
    if (input.voiceId && input.voiceDesignPrompt)
      throw new BadRequestException('音色库音色与描述定制只能选一个');
    if (input.template && input.template !== topic.storeVisit?.template) {
      const next = applyStoreVisitTemplate(
        topic.storeVisit?.segments ?? [],
        input.template,
        await this.presenterSource(),
        'original',
      ).map((segment) => {
        if (segment.shot !== 'presenter') return segment;
        const copy = { ...segment };
        delete copy.sceneImageIds;
        return copy;
      });
      topic = await this.persistSegments(
        topic,
        next,
        { template: input.template },
        scope,
      );
    }
    if (input.personaId) {
      const persona = (await this.personas.list(scope)).find(
        (item) => item.id === input.personaId,
      );
      if (!persona) throw new NotFoundException('没有这个预设人物');
      const face = personaFaceReference(persona);
      if (!face)
        throw new BadRequestException(
          '该预设人物还没有可用形象图，请先在人物管理中生成形象图',
        );
      topic = await this.save(
        topic.id,
        { personaId: persona.id, storeVisit: { faceImage: face } },
        scope,
      );
    }
    if (input.personaId && !input.voiceId && !input.voiceDesignPrompt)
      await this.storeVisit.matchPersonaVoice(topic.id, scope);
    if (input.voiceId)
      await this.storeVisit.usePresetVoice(topic.id, input.voiceId, scope);
    if (input.voiceDesignPrompt)
      await this.storeVisit.designVoice(
        topic.id,
        {
          prompt: input.voiceDesignPrompt.trim(),
          ...(input.voiceName ? { name: input.voiceName } : {}),
        },
        scope,
      );
    return this.topicDetail(topic.id, scope);
  }

  /**
   * @description 音色库：按风格分类的百炼预置音色（男女声、特质、方言）。
   * @keyword-cn 音色库列表, 预置音色
   * @keyword-en preset-voice-list, voice-catalog
   * @returns 分类与音色。
   */
  voices() {
    return {
      categories: this.storeVisit.listPresetCategories(),
      voices: this.storeVisit.listPresetVoices().map((voice) => ({
        voiceId: voice.voiceId,
        name: voice.voiceName,
        gender: voice.gender,
        category: voice.category,
        trait: voice.trait,
        ...(voice.dialect ? { dialect: voice.dialect } : {}),
      })),
    };
  }

  /**
   * @description AI 按脚本从门店点位给每段配 1～3 张实拍图或实拍视频并保存（与桌面端 `matchScenes` 同规则），已配的场景会被替换。
   * @keyword-cn AI配场景, 分段配图落库
   * @keyword-en match-scenes, save-segment-scenes
   * @param {number} topicId 脚本 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本状态。
   */
  async matchScenes(topicId: number, scope: DouyinScope) {
    const topic = await this.requireStoreVisit(topicId, scope);
    const result = await this.planner.matchScenes(topic.id, scope);
    const next = applyStoreVisitSceneMatches(
      topic.storeVisit?.segments ?? [],
      result?.segments ?? [],
    );
    await this.persistSegments(topic, next, {}, scope);
    return this.topicDetail(topic.id, scope);
  }

  /**
   * @description 探店出片（与桌面端「开始生成」同流程，会按段扣费）：先做出片前检查并保存分段，缺人物首帧的镜头先生成首帧，再启动 AI 导演流水线一段一段地出片；
   *   有段已出片时只接着生成没出片的段（`all` 为真时清掉全部重做），全部出完后自动拼接。同点位续段与统一音色要桌面端打开「视频制作」页完成。
   * @keyword-cn 提交探店出片, 启动导演流水线
   * @keyword-en submit-store-visit, start-director-pipeline
   * @param {number} topicId 脚本 ID。
   *   `full` 为真时改成「整条一次出」：视频模型一次生成整条视频（分段当成分镜），快但不能单段改，声音由视频模型自己出，出好后直接作为成片。
   * @param {{all?: boolean, unifiedVoice?: boolean, full?: boolean, prompt?: string}} input 是否全部重做、是否用第 1 段的声音统一后面各段、是否整条一次出与整条时的补充要求。
   * @param {DouyinScope} scope 作用域。
   * @returns 流水线状态与说明，整条一次出时为提交的调用。
   */
  async generateStoreVisit(
    topicId: number,
    input: {
      all?: boolean;
      unifiedVoice?: boolean;
      full?: boolean;
      prompt?: string;
    },
    scope: DouyinScope,
  ) {
    if (input.full) {
      const topic = await this.requireStoreVisit(topicId, scope);
      const blocker = await this.generateBlocker(
        topic,
        await this.storeOf(topic, scope),
      );
      if (blocker && !['还没有音色', '还没选出镜方式'].includes(blocker))
        throw new BadRequestException(blocker);
      const operation = await this.operations.createGeneration(
        topic.id,
        input.prompt,
        scope,
      );
      return {
        operation: this.operationBrief(operation),
        note: '整条一次出已提交：出好后直接作为成片，用 douyin_topic_get 查看',
      };
    }
    const topic = await this.prepareStoreVisitGenerate(topicId, scope);
    const latest = await this.pipeline.start(topic.id, scope, {
      voiceAnchor: input.unifiedVoice !== false,
      restart: input.all === true,
    });
    return this.pipelineBrief(latest);
  }

  /**
   * @description 让 AI 导演重做探店某一段（以及接它尾帧的续段），会扣费：先保存分段，缺人物首帧时先生成，清掉这段的出片结果后由导演按顺序重做；
   *   导演还没开始时直接开始生成，暂停中时要再继续。
   * @keyword-cn 重新生成探店分段, 单段重做
   * @keyword-en regenerate-store-visit-segment, segment-retry
   * @param {number} topicId 脚本 ID。
   * @param {string} segmentId 分段 ID。
   * @param {{unifiedVoice?: boolean}} input 是否用第 1 段的声音统一音色（导演还没开始时生效）。
   * @param {DouyinScope} scope 作用域。
   * @returns 流水线状态与说明。
   */
  async regenerateStoreVisitSegment(
    topicId: number,
    segmentId: string,
    input: { unifiedVoice?: boolean },
    scope: DouyinScope,
  ) {
    const topic = await this.prepareStoreVisitGenerate(
      topicId,
      scope,
      segmentId,
    );
    let latest = await this.pipeline.redo(topic.id, segmentId, scope);
    const state = latest.storeVisit?.pipeline?.state;
    if (!state || state === 'idle')
      latest = await this.pipeline.start(topic.id, scope, {
        voiceAnchor: input.unifiedVoice !== false,
      });
    return this.pipelineBrief(latest);
  }

  /**
   * @description 控制 AI 导演流水线：暂停（不再提交下一段，在跑的段跑完为止）、继续（失败或编辑后手动继续）、重做某段（排进重做，不改暂停状态）。
   * @keyword-cn 控制导演流水线, 暂停继续重做
   * @keyword-en control-director-pipeline, pause-resume-redo
   * @param {number} topicId 脚本 ID。
   * @param {{action: 'pause'|'resume'|'redo', segmentId?: string}} input 动作与要重做的分段。
   * @param {DouyinScope} scope 作用域。
   * @returns 流水线状态与说明。
   * @throws {BadRequestException} 重做时没给分段 ID。
   */
  async controlStoreVisitPipeline(
    topicId: number,
    input: { action: 'pause' | 'resume' | 'redo'; segmentId?: string },
    scope: DouyinScope,
  ) {
    const topic = await this.requireStoreVisit(topicId, scope);
    if (input.action === 'pause')
      return this.pipelineBrief(
        await this.pipeline.pause(topic.id, 'user', scope),
      );
    if (input.action === 'resume')
      return this.pipelineBrief(await this.pipeline.resume(topic.id, scope));
    if (!input.segmentId) throw new BadRequestException('重做要给分段 ID');
    return this.pipelineBrief(
      await this.pipeline.redo(topic.id, input.segmentId, scope),
    );
  }

  /**
   * @description 出片前准备：出片前检查（不过就报错、不扣费）、保存分段，缺人物首帧的镜头先生成首帧；给了 `segmentId` 时只补这一段的首帧。
   * @keyword-cn 出片前准备, 自动补首帧
   * @keyword-en prepare-store-visit-generate, auto-keyframes
   * @param {number} topicId 脚本 ID。
   * @param {DouyinScope} scope 作用域。
   * @param {string} [segmentId] 只重做这一段时的分段 ID。
   * @returns 保存后的脚本。
   * @throws {NotFoundException} 没有这个分段。
   */
  private async prepareStoreVisitGenerate(
    topicId: number,
    scope: DouyinScope,
    segmentId?: string,
  ): Promise<DouyinTopicEntity> {
    let topic = await this.requireStoreVisit(topicId, scope);
    const store = await this.storeOf(topic, scope);
    const blocker = await this.generateBlocker(topic, store);
    if (blocker) throw new BadRequestException(blocker);
    if (
      segmentId &&
      !(topic.storeVisit?.segments ?? []).some((item) => item.id === segmentId)
    )
      throw new NotFoundException('没有这个分段');
    topic = await this.persistSegments(
      topic,
      topic.storeVisit?.segments ?? [],
      segmentId ? {} : { template: topic.storeVisit?.template },
      scope,
      store,
    );
    const saved = topic.storeVisit?.segments ?? [];
    for (const segment of storeVisitSceneStarts(saved)) {
      if (segmentId && segment.id !== segmentId) continue;
      if (storeVisitKeyframeOf(segment, saved)) continue;
      await this.storeVisit.generateKeyframe(
        topic.id,
        segment.id,
        undefined,
        scope,
      );
    }
    return topic;
  }

  /**
   * @description 流水线状态的简报：状态、暂停原因、失败原因、正在生成第几段、已出片段数与下一步说明。
   * @keyword-cn 流水线简报, 出片进度
   * @keyword-en pipeline-brief, generation-progress
   * @param {DouyinTopicEntity} topic 脚本。
   * @returns 简报。
   */
  private pipelineBrief(topic: DouyinTopicEntity) {
    const pipeline = topic.storeVisit?.pipeline;
    const segments = topic.storeVisit?.segments ?? [];
    const current = segments.findIndex(
      (item) => item.id === pipeline?.currentSegmentId,
    );
    return {
      state: pipeline?.state ?? 'idle',
      ...(pipeline?.pauseReason ? { pauseReason: pipeline.pauseReason } : {}),
      ...(pipeline?.error ? { error: pipeline.error } : {}),
      ...(current >= 0 ? { currentSegment: current + 1 } : {}),
      ready: segments.filter(isStoreVisitSegmentReady).length,
      total: segments.length,
      note:
        pipeline?.state === 'paused'
          ? '导演已暂停：改好后用 douyin_store_visit_pipeline（resume）继续'
          : '导演一段一段地出片，前一段出完才接下一段，全部出完自动拼接；同点位续段与统一音色要桌面端同一账号打开「视频制作」页。之后用 douyin_topic_get 查看进度',
    };
  }

  /**
   * @description 按母选题让 AI 生成候选脚本（后台任务，立即返回任务），候选出来后用确认候选入库；都进统一出片流程，`start` 决定从门店开始还是从脚本开始（缺省从脚本开始）。
   * @keyword-cn AI生成候选脚本, 后台任务
   * @keyword-en generate-script-candidates, background-job
   * @param {number} motherId 母选题 ID。
   * @param {{prompt?: string, personaId?: number, scriptStyle?: string, start?: 'store'|'script'}} input 要求、人物、风格与起点。
   * @param {DouyinScope} scope 作用域。
   * @returns 任务。
   */
  async generateChildren(
    motherId: number,
    input: {
      prompt?: string;
      personaId?: number;
      scriptStyle?: string;
      start?: DouyinStoreVisitStart;
    },
    scope: DouyinScope,
  ) {
    const job = await this.generationJobs.start(
      'children',
      motherId,
      input.prompt,
      scope,
      {
        personaId: input.personaId,
        scriptStyle: input.scriptStyle as DouyinScriptStyle | undefined,
        productionMode: 'store-visit',
        start: input.start === 'store' ? 'store' : 'script',
      },
    );
    return { job: this.jobBrief(job) };
  }

  /**
   * @description 后台任务的简明视图：类型、状态、进度、错误与候选脚本（候选只给标题和开头）。
   * @keyword-cn 后台任务简明视图, 候选脚本
   * @keyword-en job-brief, script-candidates
   */
  private jobBrief(
    job: Awaited<ReturnType<DouyinGenerationJobService['list']>>[number],
  ) {
    return {
      id: job.id,
      kind: job.kind,
      topicId: job.topicId,
      status: job.status,
      progress: job.progress,
      ...(job.errorMessage || job.error
        ? { error: job.errorMessage || job.error }
        : {}),
      ...(job.result?.drafts?.length && !job.result.draftsSettledAt
        ? {
            drafts: job.result.drafts.map((draft) => ({
              key: draft.key,
              title: draft.title,
              script: draft.script,
            })),
          }
        : {}),
      ...(job.result?.createdTopicIds?.length
        ? { createdTopicIds: job.result.createdTopicIds }
        : {}),
    };
  }

  /**
   * @description 运行中与最近 24 小时的后台任务（生成候选脚本等），含待确认的候选。
   * @keyword-cn 后台任务列表, 待确认候选
   * @keyword-en generation-jobs, pending-drafts
   * @param {DouyinScope} scope 作用域。
   * @returns 任务列表。
   */
  async generationJobList(scope: DouyinScope) {
    return {
      jobs: (await this.generationJobs.list(scope)).map((job) =>
        this.jobBrief(job),
      ),
    };
  }

  /**
   * @description 把挑中的候选脚本入库（可改标题与正文），新脚本按这批任务的起点进统一出片流程。
   * @keyword-cn 确认候选脚本, 候选入统一流程
   * @keyword-en confirm-script-drafts, drafts-to-unified-flow
   * @param {string} jobId 任务 ID。
   * @param {Array<{key: string, title?: string, script?: string}>} items 挑中的候选。
   * @param {DouyinScope} scope 作用域。
   * @returns 入库结果。
   */
  async confirmDrafts(
    jobId: string,
    items: Array<{ key: string; title?: string; script?: string }>,
    scope: DouyinScope,
  ) {
    return await this.generationJobs.confirmDrafts(jobId, items, scope);
  }

  /**
   * @description 设定这条脚本的起点（从门店开始 / 从脚本开始，与桌面端 `chooseStart` 同规则）：两种起点画面来源不同，已配的画面会清空，脚本和台词保留。
   * @keyword-cn 设定出片起点, 切换起点清画面
   * @keyword-en set-production-start, switch-start-clear-pictures
   * @param {number} topicId 脚本 ID。
   * @param {'store'|'script'} start 起点。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本状态。
   */
  async setStart(
    topicId: number,
    start: DouyinStoreVisitStart,
    scope: DouyinScope,
  ) {
    const topic = await this.requireStoreVisit(topicId, scope);
    if (storeVisitStart(topic.storeVisit) === start)
      return this.topicDetail(topic.id, scope);
    const segments = topic.storeVisit?.segments ?? [];
    const placed = segments.some(
      (segment) =>
        segment.sceneImageId || segment.sceneVideoId || segment.spotId,
    );
    await this.save(
      topic.id,
      {
        storeVisit: {
          start,
          ...(placed
            ? {
                spotIds: [],
                sceneImages: [],
                sceneVideos: [],
                openingScene: null,
                segments: toStoreVisitSegmentsPayload(
                  segments.map((segment) => {
                    const copy = { ...segment };
                    delete copy.spotId;
                    delete copy.sceneImageId;
                    delete copy.sceneImageIds;
                    delete copy.sceneVideoId;
                    delete copy.clipStart;
                    return copy;
                  }),
                ),
              }
            : {}),
        },
      },
      scope,
    );
    return this.topicDetail(topic.id, scope);
  }

  /**
   * @description 从脚本开始：按台词从图库给每段挑一张图并保存（与桌面端 `pickGalleryPictures` 同规则），已配的画面会被替换。
   * @keyword-cn 从图库配画面, 分段图库配图落库
   * @keyword-en pick-gallery-pictures, save-segment-pictures
   * @param {number} topicId 脚本 ID。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本状态。
   */
  async pickPictures(topicId: number, scope: DouyinScope) {
    const topic = await this.requireStoreVisit(topicId, scope);
    const result = await this.segmentImages.pickImages(topic.id, scope);
    const byId = new Map(
      result.segments.map((item) => [item.id, Number(item.sceneImageId)]),
    );
    const segments = (topic.storeVisit?.segments ?? []).map((segment) => {
      const imageId = byId.get(segment.id);
      if (!imageId) return segment;
      const copy: DouyinStoreVisitSegment = {
        ...segment,
        sceneImageId: imageId,
      };
      delete copy.sceneImageIds;
      delete copy.sceneVideoId;
      delete copy.spotId;
      return copy;
    });
    const used = new Set(
      segments.map((segment) => Number(segment.sceneImageId)).filter(Boolean),
    );
    const sceneImages = [
      ...(topic.storeVisit?.sceneImages ?? []),
      ...result.sceneImages,
    ].filter(
      (image, index, list) =>
        used.has(Number(image.id)) &&
        list.findIndex((item) => Number(item.id) === Number(image.id)) ===
          index,
    );
    await this.persistSegments(topic, segments, { sceneImages }, scope, null);
    return this.topicDetail(topic.id, scope);
  }

  /**
   * @description 从脚本开始：一段接一段 AI 生图（后一段延续前一段的画面），每张生成后直接保存；给了 `segmentId` 时只重新生成这一段。会按张计生图费用。
   * @keyword-cn AI生成画面, 逐段生图落库
   * @keyword-en generate-ai-pictures, per-segment-imaging
   * @param {number} topicId 脚本 ID。
   * @param {{segmentId?: string, prompt?: string}} input 只重新生成的分段与这次的补充描述。
   * @param {DouyinScope} scope 作用域。
   * @returns 脚本状态。
   * @throws {NotFoundException} 没有这个分段。
   */
  async generatePictures(
    topicId: number,
    input: { segmentId?: string; prompt?: string },
    scope: DouyinScope,
  ) {
    const topic = await this.requireStoreVisit(topicId, scope);
    const segments = topic.storeVisit?.segments ?? [];
    const targets = input.segmentId
      ? segments.filter((segment) => segment.id === input.segmentId)
      : segments;
    if (input.segmentId && !targets.length)
      throw new NotFoundException('没有这个分段');
    if (!targets.length) throw new BadRequestException('请先按脚本生成台词');
    for (const segment of targets)
      await this.segmentImages.generateImage(
        topic.id,
        segment.id,
        input.segmentId ? input.prompt : undefined,
        scope,
      );
    await this.director.schedule(topic.id, scope);
    return this.topicDetail(topic.id, scope);
  }
}
