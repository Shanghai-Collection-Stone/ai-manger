import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Collection, Db, ObjectId } from 'mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { AiBillingService } from '../../ai-billing/services/ai-billing.service.js';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import { DouyinPersonaRepositoryService } from '../../douyin-persona/services/douyin-persona-repository.service.js';
import { buildPersonaImageBrief } from '../../douyin-persona/services/douyin-persona-prompt.js';
import { GalleryAiImageService } from '../../gallery/services/gallery-ai-image.service.js';
import {
  WORKFLOW_NODES,
  type WorkflowNodeRuntime,
} from '../../workflow-model/entities/workflow-model.entity.js';
import { isShuyanProvider } from '../../workflow-model/services/shuyan-model-catalog.js';
import { WorkflowModelService } from '../../workflow-model/services/workflow-model.service.js';
import {
  DOUYIN_SCRIPT_STYLES,
  type DouyinMediaReference,
  type DouyinOperationEntity,
  type DouyinOperationView,
  type DouyinStoreVisitSegment,
  type DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import { DOUYIN_SHOT_IMAGE_SIZE } from './douyin-shot-image.service.js';
import {
  describeShuyanVideoFailure,
  resolveShuyanVideoGateway,
} from './douyin-shuyan-video.service.js';
import {
  DouyinVideoStorageService,
  resolveStaticFilePath,
} from './douyin-video-storage.service.js';
import {
  DouyinWorkbenchRepositoryService,
  normalizeVideoAudio,
} from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 数眼探店分段对口型用的数字人引擎：`kling-avatar` 为可灵数字人（图片 + 音频，音频 2～300 秒），
 *   `wan-s2v` 为万相数字人 wan2.2-s2v（图片 + 音频，音频少于 20 秒、图片与音频都要公网地址）。
 * @keyword-cn 探店数字人引擎, 可灵数字人, 万相数字人
 * @keyword-en store-visit-avatar-engine, kling-avatar, wan-s2v
 */
export type StoreVisitAvatarEngine = 'kling-avatar' | 'wan-s2v';

/**
 * @description 探店分段在数眼上的数字人任务后台跟进间隔（15 秒）。
 * @keyword-cn 探店分段轮询间隔, 后台轮询
 * @keyword-en store-visit-segment-poll-interval, background-polling
 */
export const DOUYIN_STORE_VISIT_SEGMENT_POLL_MS = 15 * 1000;

/**
 * @description 探店分段任务超过 3 小时未结束判为超时；保存中超过 10 分钟可重新认领。
 * @keyword-cn 探店分段超时, 保存中断
 * @keyword-en store-visit-segment-timeout, saving-stale
 */
export const DOUYIN_STORE_VISIT_SEGMENT_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const DOUYIN_STORE_VISIT_SEGMENT_SAVING_STALE_MS = 10 * 60 * 1000;

/**
 * @description 各数字人引擎接受的单段配音时长（秒）：可灵 2～300 秒，万相少于 20 秒。
 * @keyword-cn 单段配音时长, 数字人音频上限
 * @keyword-en segment-audio-limit, avatar-audio-range
 */
export const STORE_VISIT_AVATAR_AUDIO_SECONDS: Record<
  StoreVisitAvatarEngine,
  { min: number; max: number }
> = {
  'kling-avatar': { min: 2, max: 300 },
  'wan-s2v': { min: 2, max: 19.9 },
};

/**
 * @description 把对端响应里的字段读成去掉首尾空白的字符串：只认字符串与数字，其余（对象、空值）返回空串。
 * @keyword-cn 读取响应文本, 字段转字符串
 * @keyword-en read-response-text, field-to-string
 * @param {unknown} value 响应字段。
 * @returns {string} 文本。
 */
export function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' ? String(value) : '';
}

/**
 * @description 按后台给「探店数字人视频」节点填的模型名选引擎：含 `s2v` 走万相数字人，含 `kling` 或 `avatar` 走可灵数字人
 *   （含 `pro` 用高品质模式，否则标准模式）；认不出返回 null。
 * @keyword-cn 解析探店数字人引擎, 模型名路由
 * @keyword-en resolve-store-visit-avatar-engine, model-routing
 * @param {string} model 节点模型名。
 * @returns {{engine: StoreVisitAvatarEngine, mode?: 'std'|'pro'}|null} 引擎与可灵模式。
 */
export function resolveStoreVisitAvatarEngine(
  model: string,
): { engine: StoreVisitAvatarEngine; mode?: 'std' | 'pro' } | null {
  const value = String(model ?? '')
    .trim()
    .toLowerCase();
  if (/s2v/.test(value)) return { engine: 'wan-s2v' };
  if (/kling|avatar/.test(value))
    return { engine: 'kling-avatar', mode: /pro/.test(value) ? 'pro' : 'std' };
  return null;
}

/**
 * @description 拼数字人任务的创建或查询地址：可灵 `/kling/v1/videos/avatar/image2video[/{id}]`；
 *   万相创建 `/ali/api/v1/services/aigc/image2video/video-synthesis`、查询 `/ali/api/v1/tasks/{id}`。
 * @keyword-cn 探店数字人任务地址, 创建与查询
 * @keyword-en store-visit-avatar-task-url, create-and-query
 * @param {string} gateway 数眼网关根地址。
 * @param {StoreVisitAvatarEngine} engine 引擎。
 * @param {string} [taskId] 任务 ID，查询时传。
 * @returns {string} 接口地址。
 */
export function buildStoreVisitAvatarUrl(
  gateway: string,
  engine: StoreVisitAvatarEngine,
  taskId?: string,
): string {
  const id = taskId ? encodeURIComponent(taskId) : '';
  if (engine === 'wan-s2v') {
    return id
      ? `${gateway}/ali/api/v1/tasks/${id}`
      : `${gateway}/ali/api/v1/services/aigc/image2video/video-synthesis`;
  }
  const base = `${gateway}/kling/v1/videos/avatar/image2video`;
  return id ? `${base}/${id}` : base;
}

/**
 * @description 把可灵（submitted / processing / succeed / failed）或万相（PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED / UNKNOWN）
 *   的任务状态收成工作台统一状态。
 * @keyword-cn 探店数字人状态映射, 可灵万相状态
 * @keyword-en map-store-visit-avatar-status, kling-wan-status
 * @param {string} [status] 对端状态。
 * @returns {'queued'|'running'|'completed'|'failed'} 统一状态。
 */
export function mapStoreVisitAvatarStatus(
  status?: string,
): 'queued' | 'running' | 'completed' | 'failed' {
  const value = String(status ?? '')
    .trim()
    .toLowerCase();
  if (['succeed', 'succeeded', 'success'].includes(value)) return 'completed';
  if (['failed', 'canceled', 'cancelled', 'unknown'].includes(value))
    return 'failed';
  if (['processing', 'running'].includes(value)) return 'running';
  return 'queued';
}

/**
 * @description 推断可灵音色的语种（语音合成要求与音色一致）：ID 以 `oversea` / `en_` 开头或名称是纯英文的按英文，其余按中文。
 * @keyword-cn 推断音色语种, 可灵音色
 * @keyword-en infer-voice-language, kling-voice
 * @param {string} voiceId 音色 ID。
 * @param {string} voiceName 音色名称。
 * @returns {'zh'|'en'} 语种。
 */
export function inferKlingVoiceLanguage(
  voiceId: string,
  voiceName: string,
): 'zh' | 'en' {
  if (/^(oversea|en[_-])/i.test(String(voiceId ?? ''))) return 'en';
  const name = String(voiceName ?? '').trim();
  return name && /^[\x20-\x7e]+$/.test(name) ? 'en' : 'zh';
}

/**
 * @description 把分段通道的原始报错翻译成中文：可灵业务错误与语音合成失败带上对端原话，其余交给数眼通道的通用对照。
 * @keyword-cn 翻译分段报错, 可灵错误
 * @keyword-en describe-segment-failure, kling-error
 * @param {string} raw 原始报错。
 * @returns {string} 中文说明。
 */
export function describeStoreVisitSegmentFailure(raw: string): string {
  const text = String(raw ?? '');
  const kling = /SHUYAN_KLING_ERROR:(-?\d+):?(.*)/s.exec(text);
  if (kling)
    return `可灵返回错误（${kling[1]}）${kling[2] ? `：${kling[2].trim().slice(0, 200)}` : ''}`;
  const tts = /SHUYAN_KLING_TTS_FAILED:?(.*)/s.exec(text);
  if (tts)
    return `可灵语音合成没有出音频${tts[1] ? `：${tts[1].trim().slice(0, 200)}` : ''}，请换个音色或改短台词后重试`;
  return describeShuyanVideoFailure(text);
}

/**
 * @description 拼探店关键帧的图像编辑提示词：底图是出镜人物、第二张参考图是本段场景，生成「这个人在这个场景里」的竖屏口播首帧。
 * @keyword-cn 探店关键帧提示词, 人物进场景
 * @keyword-en store-visit-keyframe-prompt, person-in-scene
 * @param input 标题、本段台词与动作、场景名称与说明、人物外貌段、风格画面描述、是否带场景图、补充描述。
 * @returns {string} 提示词。
 */
export function buildStoreVisitKeyframePrompt(input: {
  title: string;
  lines: string;
  action?: string;
  sceneName?: string;
  sceneDescription?: string;
  personaBrief?: string;
  styleVisual?: string;
  hasSceneImage: boolean;
  requirement?: string;
}): string {
  return [
    `抖音竖屏探店短视频《${input.title}》里的一个口播镜头首帧。`,
    input.hasSceneImage
      ? '第一张图是出镜人物：保持他的五官、发型、肤色、体型与穿着完全一致。第二张图是门店场景：保持场景的布局、装修、陈设、招牌与光线。把这个人物自然地放进第二张图的场景里，人物和场景的光线、透视、投影要一致，不要像抠图贴上去。'
      : '所给图片是出镜人物：保持他的五官、发型、肤色、体型与穿着完全一致，把他放到下面描述的门店场景里。',
    input.sceneName || input.sceneDescription
      ? `场景：${[input.sceneName, input.sceneDescription].filter(Boolean).join('；')}`
      : '',
    `这一段他要说：「${input.lines.slice(0, 200)}」`,
    `动作与神态：${input.requirement || input.action || '自然地面对镜头准备开口介绍，表情亲切，带一点手势'}`,
    input.personaBrief || '',
    input.styleVisual ? `画面风格：${input.styleVisual}` : '',
    '要求：9:16 竖构图，人物半身到七分身、正面或微侧面向镜头，面部清晰完整、不被遮挡，嘴巴自然闭合，画面中只有这一个人物。',
    '画面中不要出现任何文字、字幕、水印、logo 或拼贴边框。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 数眼可灵音色库里的一个音色：ID、名称、试听地址与推断的语种。
 * @keyword-cn 可灵音色条目, 音色试听
 * @keyword-en kling-preset-voice, voice-trial
 */
export interface StoreVisitPresetVoice {
  voiceId: string;
  voiceName: string;
  trialUrl?: string;
  language: 'zh' | 'en';
}

/**
 * @description 探店模式的数眼分段通道：每段台词用可灵语音合成按固定音色配音，再把「人物在场景里」的关键帧和这段配音交给可灵数字人或万相数字人对口型，
 *   各段成片转存视频库并绑定到分段，全部出片后由桌面端拼接（复用客户端合成）。另提供可灵音色库与关键帧生成。
 * @keyword-cn 数眼探店分段, 分段对口型, 可灵语音合成
 * @keyword-en shuyan-store-visit-segments, segment-lip-sync, kling-tts
 */
@Injectable()
export class DouyinStoreVisitShuyanService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DouyinStoreVisitShuyanService.name);
  private readonly operations: Collection<DouyinOperationEntity>;
  private timer?: NodeJS.Timeout;
  private polling = false;
  private voiceCache?: {
    providerId: string;
    expiresAt: number;
    voices: StoreVisitPresetVoice[];
  };

  /**
   * @description 初始化调用集合与配音、关键帧、转存依赖。
   * @keyword-cn 初始化数眼探店服务, 分段依赖
   * @keyword-en init-shuyan-store-visit, segment-dependencies
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly billing: AiBillingService,
    private readonly storage: DouyinVideoStorageService,
    private readonly workflowModels: WorkflowModelService,
    private readonly adminService: AdminService,
    private readonly agentService: AgentService,
    private readonly aiImages: GalleryAiImageService,
    private readonly personas: DouyinPersonaRepositoryService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
  }

  /**
   * @description 启动分段任务后台轮询，服务重启后继续跟进；多进程时只在 leader 进程上轮询。
   * @keyword-cn 启动分段轮询, 重启续跟
   * @keyword-en start-segment-polling, resume-after-restart
   */
  onModuleInit(): void {
    if (!isLeaderProcess()) return;
    this.timer = setInterval(
      () => void this.pollOnce(),
      DOUYIN_STORE_VISIT_SEGMENT_POLL_MS,
    );
    this.timer.unref?.();
  }

  /**
   * @description 停止分段任务后台轮询。
   * @keyword-cn 停止分段轮询, 模块销毁
   * @keyword-en stop-segment-polling, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 列出数眼可灵音色库（官方预置音色），按「探店数字人视频」节点的数眼 Key 拉取，30 分钟内存缓存。
   * @keyword-cn 可灵音色库, 预置音色列表
   * @keyword-en list-kling-preset-voices, preset-voice-list
   * @returns {Promise<StoreVisitPresetVoice[]>} 音色列表。
   * @throws {ServiceUnavailableException} 节点没选数眼智能。
   */
  async listPresetVoices(): Promise<StoreVisitPresetVoice[]> {
    const runtime = await this.readRuntime();
    if (
      this.voiceCache?.providerId === runtime.providerId &&
      this.voiceCache.expiresAt > Date.now()
    )
      return this.voiceCache.voices;
    const gateway = resolveShuyanVideoGateway(runtime.baseUrl);
    const seen = new Set<string>();
    const voices: StoreVisitPresetVoice[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await this.fetchJson(
        `${gateway}/kling/v1/general/presets-voices?pageNum=${page}&pageSize=100`,
        { method: 'GET' },
        runtime.apiKey,
      );
      const tasks = Array.isArray(response.data)
        ? (response.data as Array<Record<string, unknown>>)
        : [];
      let added = 0;
      for (const task of tasks) {
        const result = task.task_result as
          { voices?: Array<Record<string, unknown>> } | undefined;
        for (const voice of result?.voices ?? []) {
          const voiceId = textOf(voice.voice_id);
          if (!voiceId || seen.has(voiceId)) continue;
          seen.add(voiceId);
          added += 1;
          const voiceName = textOf(voice.voice_name) || voiceId;
          const trialUrl = textOf(voice.trial_url);
          voices.push({
            voiceId,
            voiceName,
            ...(/^https?:\/\//i.test(trialUrl) ? { trialUrl } : {}),
            language: inferKlingVoiceLanguage(voiceId, voiceName),
          });
        }
      }
      if (!added || tasks.length < 100) break;
    }
    this.voiceCache = {
      providerId: runtime.providerId,
      expiresAt: Date.now() + 30 * 60 * 1000,
      voices,
    };
    return voices;
  }

  /**
   * @description 选用可灵音色库里的一个音色作为这条脚本的固定音色（来源 `preset`），清掉上一来源的样本与描述。
   * @keyword-cn 选用可灵音色, 保存预置音色
   * @keyword-en use-kling-preset-voice, save-preset-voice
   * @param {number} topicId 子选题（脚本）ID。
   * @param {{voiceId: string, voiceName: string, trialUrl?: string, language?: 'zh'|'en'}} input 音色。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 更新后的脚本。
   */
  async usePresetVoice(
    topicId: number,
    input: {
      voiceId: string;
      voiceName: string;
      trialUrl?: string;
      language?: 'zh' | 'en';
    },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    await this.requireChild(topicId, scope);
    const runtime = await this.readRuntime();
    const voiceId = String(input.voiceId ?? '').trim();
    const voiceName = String(input.voiceName ?? '')
      .trim()
      .slice(0, 60);
    const trialUrl = String(input.trialUrl ?? '').trim();
    const updated = await this.repository.saveStoreVisitVoice(
      topicId,
      {
        voiceSource: 'preset',
        voiceName: voiceName || voiceId,
        voiceId,
        voiceProviderId: runtime.providerId,
        voiceModel: 'kling-tts',
        voiceLanguage:
          input.language ?? inferKlingVoiceLanguage(voiceId, voiceName),
        voicePreviewUrl: /^https?:\/\/\S+$/i.test(trialUrl)
          ? trialUrl
          : undefined,
      },
      scope,
    );
    if (!updated) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return updated;
  }

  /**
   * @description 为一段生成「人物在这个场景里」的关键帧：出镜人物作底图、本段场景图作第二张参考图，按「分镜画面」节点的生图模型出竖屏图，
   *   入图库后写进这一段（同时作废这段旧成片）。
   * @keyword-cn 生成探店关键帧, 人物进场景
   * @keyword-en generate-store-visit-keyframe, person-in-scene
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} segmentId 分段 ID。
   * @param {string|undefined} prompt 这次的补充描述。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<{topic: DouyinTopicEntity, segmentId: string, keyframe: DouyinMediaReference}>} 更新结果。
   * @throws {BadRequestException} 分段不存在、没选出镜人物或生图失败。
   */
  async generateKeyframe(
    topicId: number,
    segmentId: string,
    prompt: string | undefined,
    scope: DouyinScope,
  ): Promise<{
    topic: DouyinTopicEntity;
    segmentId: string;
    keyframe: DouyinMediaReference;
  }> {
    const topic = await this.requireChild(topicId, scope);
    const segment = this.requireSegment(topic, segmentId);
    const face = topic.storeVisit?.faceImage;
    if (!face?.url)
      throw new BadRequestException('先在「人物」步骤选好出镜人物');
    const scene = (topic.storeVisit?.sceneImages ?? []).find(
      (image) => image.id === segment.sceneImageId,
    );
    const persona = topic.personaId
      ? await this.personas.get(topic.personaId, scope)
      : null;
    const style =
      topic.scriptStyle && topic.scriptStyle in DOUYIN_SCRIPT_STYLES
        ? DOUYIN_SCRIPT_STYLES[topic.scriptStyle]
        : undefined;
    const requirement = String(prompt ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    const imagePrompt = buildStoreVisitKeyframePrompt({
      title: topic.title,
      lines: segment.lines,
      action: segment.action,
      sceneName: scene?.name,
      sceneDescription: String(topic.storeVisit?.sceneDescription ?? '')
        .trim()
        .slice(0, 300),
      personaBrief: buildPersonaImageBrief(persona),
      styleVisual: style?.visual,
      hasSceneImage: Boolean(scene?.url),
      requirement,
    });
    const nodeRuntime = await this.workflowModels.resolveNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.key,
      WORKFLOW_NODES.douyinWorkbench.shotImage,
    );
    const generated = await this.agentService.sendPrompt({
      prompt: imagePrompt,
      runtimeOverride: nodeRuntime ?? undefined,
      size: DOUYIN_SHOT_IMAGE_SIZE,
      includeSystemPrompt: false,
      baseImageCandidates: [face.url],
      ...(scene?.url ? { extraImageCandidates: [scene.url] } : {}),
      billingContext: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        platformScope: !scope.tenantId,
        source: 'douyin-workbench.store-visit-keyframe',
      },
    });
    const image = await this.aiImages.persistGeneratedImage({
      imagePath: String(generated?.imagePath ?? ''),
      userId: scope.userId,
      tenantId: scope.tenantId,
      originalName: `${topic.title} 探店关键帧`,
      description: `抖音探店关键帧:${segment.lines.slice(0, 100)}`,
      tags: ['抖音探店关键帧'],
    });
    const keyframe: DouyinMediaReference = {
      type: 'image',
      id: image.id,
      name: image.originalName || `图片 #${image.id}`,
      url: image.url,
      coverUrl: image.thumbUrl || image.url,
    };
    const updated = await this.repository.updateStoreVisitSegment(
      topicId,
      segmentId,
      { keyframe },
      scope,
    );
    if (!updated)
      throw new BadRequestException('这一段已被删除，关键帧已存进图库');
    return { topic: updated, segmentId, keyframe };
  }

  /**
   * @description 按分段生成整条探店视频：校验每段都有台词与关键帧、音色来自可灵音色库、没有分段正在生成，清掉各段旧成片并打上
   *   「全部出片后自动合成」标记，再逐段配音并提交对口型任务；部分段提交失败不影响其他段，全部失败时报第一条原因。
   * @keyword-cn 提交探店分段生成, 分段对口型
   * @keyword-en submit-store-visit-segments, segment-lip-sync
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<{operations: DouyinOperationView[]}>} 各段调用记录。
   */
  async startAll(
    topicId: number,
    scope: DouyinScope,
  ): Promise<{ operations: DouyinOperationView[] }> {
    const topic = await this.requireChild(topicId, scope);
    const segments = topic.storeVisit?.segments ?? [];
    if (!segments.length)
      throw new BadRequestException('先在「台词」步骤把台词按场景分好段');
    return { operations: await this.startSegments(topic, segments, scope) };
  }

  /**
   * @description 重新生成某一段：只清掉这一段的旧成片并打上自动合成标记，其余段保持不变。
   * @keyword-cn 重新生成探店分段, 单段重做
   * @keyword-en regenerate-store-visit-segment, single-segment-retry
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} segmentId 分段 ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<{operations: DouyinOperationView[]}>} 这一段的调用记录。
   */
  async startOne(
    topicId: number,
    segmentId: string,
    scope: DouyinScope,
  ): Promise<{ operations: DouyinOperationView[] }> {
    const topic = await this.requireChild(topicId, scope);
    const segment = this.requireSegment(topic, segmentId);
    return { operations: await this.startSegments(topic, [segment], scope) };
  }

  /**
   * @description 手动同步一条分段调用。
   * @keyword-cn 同步探店分段, 手动刷新
   * @keyword-en sync-store-visit-segment, manual-refresh
   * @param {string} id 调用记录 ID。
   * @returns {Promise<DouyinOperationView>} 最新记录。
   */
  async refresh(id: string): Promise<DouyinOperationView> {
    const row = await this.operations.findOne({
      id,
      provider: 'shuyan',
      mode: 'store-visit',
    });
    if (!row) throw new BadRequestException('DOUYIN_OPERATION_NOT_FOUND');
    try {
      await this.refreshRow(row);
    } catch (error) {
      throw new BadGatewayException(
        describeStoreVisitSegmentFailure(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    const latest = await this.operations.findOne({ id });
    return this.toView(latest ?? row);
  }

  /**
   * @description 跟进一轮未结束的分段任务，同一进程内不重入。
   * @keyword-cn 轮询探店分段, 防重入
   * @keyword-en poll-store-visit-segments, reentry-guard
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const rows = await this.operations
        .find({
          provider: 'shuyan',
          mode: 'store-visit',
          $or: [
            { status: { $in: ['queued', 'running'] } },
            {
              status: 'saving',
              updatedAt: {
                $lt: new Date(
                  Date.now() - DOUYIN_STORE_VISIT_SEGMENT_SAVING_STALE_MS,
                ),
              },
            },
          ],
        })
        .sort({ updatedAt: 1 })
        .limit(20)
        .toArray();
      for (const row of rows) {
        await this.refreshRow(row).catch((error) =>
          this.logger.warn(
            `[pollOnce] 探店分段跟进失败 operation=${row.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * @description 校验并提交若干段：段要有台词、关键帧，音色要是可灵音色库里的；有段在生成时拒绝；先清旧成片、打自动合成标记，再逐段提交。
   * @keyword-cn 提交探店分段, 分段前置校验
   * @keyword-en submit-store-visit-segment-batch, segment-precheck
   * @param {DouyinTopicEntity} topic 脚本。
   * @param {DouyinStoreVisitSegment[]} segments 要生成的段。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinOperationView[]>} 提交成功的调用记录。
   */
  private async startSegments(
    topic: DouyinTopicEntity,
    segments: DouyinStoreVisitSegment[],
    scope: DouyinScope,
  ): Promise<DouyinOperationView[]> {
    const all = topic.storeVisit?.segments ?? [];
    const indexOf = (segment: DouyinStoreVisitSegment) =>
      all.findIndex((item) => item.id === segment.id) + 1;
    const missing = segments.filter((segment) => !segment.keyframe?.url);
    if (missing.length)
      throw new BadRequestException(
        `第 ${missing.map(indexOf).join('、')} 段还没有关键帧，先生成关键帧`,
      );
    const voiceId = String(topic.storeVisit?.voiceId ?? '').trim();
    if (topic.storeVisit?.voiceSource !== 'preset' || !voiceId)
      throw new BadRequestException(
        '数眼通道要先在「音色」步骤从可灵音色库选一个音色',
      );
    const runtime = await this.readRuntime();
    const route = resolveStoreVisitAvatarEngine(runtime.model);
    if (!route)
      throw new ServiceUnavailableException(
        `「探店数字人视频」节点的模型「${runtime.model}」认不出数字人引擎，请改填 kling-avatar-std、kling-avatar-pro 或 wan2.2-s2v`,
      );
    const running = await this.operations.findOne({
      topicId: topic.id,
      provider: 'shuyan',
      mode: 'store-visit',
      status: { $in: ['queued', 'running', 'saving'] },
      userId: scope.userId,
    });
    if (running)
      throw new ConflictException('这条脚本还有分段在生成，完成后再试');
    for (const segment of segments) {
      await this.repository.updateStoreVisitSegment(
        topic.id,
        segment.id,
        { videoId: null },
        scope,
      );
    }
    await this.repository.update(topic.id, { autoConcatShots: true }, scope);
    const language =
      topic.storeVisit?.voiceLanguage ??
      (normalizeVideoAudio(topic.videoAudio).language === 'en' ? 'en' : 'zh');
    const views: DouyinOperationView[] = [];
    let firstError: Error | undefined;
    for (const segment of segments) {
      try {
        views.push(
          await this.submitSegment({
            topic,
            segment,
            index: indexOf(segment),
            runtime,
            route,
            voice: { voiceId, language },
            scope,
          }),
        );
      } catch (error) {
        firstError ??=
          error instanceof Error
            ? error
            : new Error(textOf(error) || '提交失败');
      }
    }
    if (!views.length && firstError) throw firstError;
    return views;
  }

  /**
   * @description 提交一段：按 `video-generation` 扣费 → 可灵语音合成配音（校验时长在引擎范围内）→ 关键帧 + 配音交给数字人引擎，写排队中的调用记录；
   *   任一步失败退款并写失败记录。
   * @keyword-cn 提交单段对口型, 分段配音
   * @keyword-en submit-segment-lip-sync, segment-voiceover
   * @param input 脚本、分段及序号、节点运行配置、引擎、音色与作用域。
   * @returns {Promise<DouyinOperationView>} 调用记录。
   * @throws {BadGatewayException} 配音或提交失败。
   */
  private async submitSegment(input: {
    topic: DouyinTopicEntity;
    segment: DouyinStoreVisitSegment;
    index: number;
    runtime: WorkflowNodeRuntime;
    route: { engine: StoreVisitAvatarEngine; mode?: 'std' | 'pro' };
    voice: { voiceId: string; language: 'zh' | 'en' };
    scope: DouyinScope;
  }): Promise<DouyinOperationView> {
    const { topic, segment, runtime, route, scope } = input;
    const gateway = resolveShuyanVideoGateway(runtime.baseUrl);
    const operationId = randomUUID();
    const resolution = /720|1080|2k/i.test(String(topic.fullVideoResolution))
      ? '720P'
      : '480P';
    const request: Record<string, unknown> = {
      segmentId: segment.id,
      segmentIndex: input.index,
      engine: route.engine,
      avatarMode: route.mode,
      voiceId: input.voice.voiceId,
      voiceLanguage: input.voice.language,
      lines: segment.lines,
      action: segment.action,
      sceneImageId: segment.sceneImageId,
      keyframeImageId: segment.keyframe?.id,
      ...(route.engine === 'wan-s2v' ? { resolution } : {}),
    };
    const base = {
      operation: 'generate' as const,
      topicId: topic.id,
      segmentId: segment.id,
      provider: 'shuyan' as const,
      mode: 'store-visit' as const,
      model: runtime.model,
      providerId: runtime.providerId,
      tenantId: scope.tenantId,
      userId: scope.userId,
    };
    await this.billing.chargeService({
      serviceCode: 'video-generation',
      tenantId: scope.tenantId,
      userId: scope.userId,
      operationId,
      source: 'douyin-workbench.store-visit-segment',
      platformScope: !scope.tenantId,
    });
    const now = new Date();
    try {
      const audio = await this.synthesize(gateway, runtime.apiKey, {
        text: segment.lines,
        voiceId: input.voice.voiceId,
        language: input.voice.language,
      });
      Object.assign(request, {
        audioId: audio.id,
        audioUrl: audio.url,
        audioSeconds: audio.seconds,
      });
      const range = STORE_VISIT_AVATAR_AUDIO_SECONDS[route.engine];
      if (audio.seconds && audio.seconds < range.min)
        throw new BadRequestException(
          `第 ${input.index} 段配音只有 ${audio.seconds} 秒，至少要 ${range.min} 秒，请多写几句`,
        );
      if (audio.seconds && audio.seconds > range.max)
        throw new BadRequestException(
          `第 ${input.index} 段配音约 ${Math.round(audio.seconds)} 秒，${route.engine === 'wan-s2v' ? '万相数字人单段要少于 20 秒' : '可灵数字人单段最多 300 秒'}，请把这段拆短`,
        );
      const keyframeUrl = String(segment.keyframe?.url ?? '').trim();
      const payload =
        route.engine === 'wan-s2v'
          ? {
              model: 'wan2.2-s2v',
              input: {
                image_url: this.requirePublicUrl(keyframeUrl, '关键帧'),
                audio_url: this.requirePublicUrl(audio.url, '配音'),
              },
              parameters: { resolution, style: 'speech' },
            }
          : {
              image: await this.toKlingImage(keyframeUrl),
              ...(audio.id
                ? { audio_id: audio.id }
                : { sound_file: audio.url }),
              prompt:
                segment.action ||
                '自然地对着镜头说话，表情亲切，带一点手势，像朋友分享探店体验',
              mode: route.mode ?? 'std',
            };
      const response = await this.fetchJson(
        buildStoreVisitAvatarUrl(gateway, route.engine),
        { method: 'POST', body: JSON.stringify(payload) },
        runtime.apiKey,
      );
      const externalId =
        route.engine === 'wan-s2v'
          ? textOf(
              (response.output as Record<string, unknown> | undefined)?.task_id,
            )
          : textOf(
              (response.data as Record<string, unknown> | undefined)?.task_id,
            );
      if (!externalId) throw new Error('SHUYAN_VIDEO_TASK_ID_MISSING');
      const doc: DouyinOperationEntity = {
        _id: new ObjectId(),
        id: operationId,
        ...base,
        request,
        status: 'queued',
        progress: 0,
        externalId,
        result: response,
        createdAt: now,
        updatedAt: now,
      };
      await this.operations.insertOne(doc);
      setTimeout(() => void this.pollOnce(), 10 * 1000).unref?.();
      return this.toView(doc);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const friendly =
        error instanceof BadRequestException
          ? detail
          : `第 ${input.index} 段提交失败：${describeStoreVisitSegmentFailure(detail)}`;
      await this.billing
        .refundService({
          operationId,
          reason: 'douyin-store-visit-segment-submit-failed',
        })
        .catch(() => false);
      await this.operations.insertOne({
        _id: new ObjectId(),
        id: operationId,
        ...base,
        request,
        status: 'failed',
        error: `${friendly}（已退回扣费）`,
        errorDetail: detail,
        createdAt: now,
        updatedAt: now,
      });
      throw new BadGatewayException(friendly);
    }
  }

  /**
   * @description 用可灵语音合成把一段台词念成配音：创建时直接给出音频就用，否则按任务 ID 轮询至多 60 秒。
   * @keyword-cn 可灵语音合成, 分段配音
   * @keyword-en kling-tts, segment-voiceover
   * @param {string} gateway 数眼网关根地址。
   * @param {string|undefined} apiKey 数眼 Key。
   * @param {{text: string, voiceId: string, language: 'zh'|'en'}} input 台词、音色与语种。
   * @returns {Promise<{id?: string, url: string, seconds: number}>} 音频 ID、地址与时长（秒）。
   * @throws {Error} 合成失败或超时。
   */
  private async synthesize(
    gateway: string,
    apiKey: string | undefined,
    input: { text: string; voiceId: string; language: 'zh' | 'en' },
  ): Promise<{ id?: string; url: string; seconds: number }> {
    const readAudio = (response: Record<string, unknown>) => {
      const data = (response.data ?? {}) as Record<string, unknown>;
      const result = (data.task_result ?? {}) as {
        audios?: Array<Record<string, unknown>>;
      };
      const first = result.audios?.[0];
      return {
        taskId: textOf(data.task_id),
        status: mapStoreVisitAvatarStatus(textOf(data.task_status)),
        message: textOf(data.task_status_msg),
        audio: textOf(first?.url)
          ? {
              id: textOf(first?.id) || undefined,
              url: textOf(first?.url),
              seconds: Number(first?.duration) || 0,
            }
          : null,
      };
    };
    let state = readAudio(
      await this.fetchJson(
        `${gateway}/kling/v1/audio/tts`,
        {
          method: 'POST',
          body: JSON.stringify({
            text: input.text,
            voice_id: input.voiceId,
            voice_language: input.language,
            voice_speed: 1,
          }),
        },
        apiKey,
      ),
    );
    for (let attempt = 0; !state.audio && attempt < 30; attempt += 1) {
      if (state.status === 'failed' || !state.taskId) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      state = readAudio(
        await this.fetchJson(
          `${gateway}/kling/v1/audio/tts/${encodeURIComponent(state.taskId)}`,
          { method: 'GET' },
          apiKey,
        ),
      );
    }
    if (!state.audio)
      throw new Error(
        `SHUYAN_KLING_TTS_FAILED:${state.message || state.status}`,
      );
    return state.audio;
  }

  /**
   * @description 按调用记录上的提供商与引擎查一次分段任务并推进：失败写原因，超时判失败，完成时认领保存权、转存视频库并绑定到分段；
   *   提交后这段台词或关键帧已被改掉时不再绑定，免得旧画面混进成片。
   * @keyword-cn 推进探店分段, 分段转存
   * @keyword-en advance-store-visit-segment, save-segment-video
   * @param {DouyinOperationEntity} row 调用记录。
   */
  private async refreshRow(row: DouyinOperationEntity): Promise<void> {
    if (!['queued', 'running', 'saving'].includes(row.status)) return;
    if (!row.externalId) {
      await this.fail(row.id, '数眼任务 ID 缺失，无法查询进度。');
      return;
    }
    const provider = row.providerId
      ? await this.adminService.getAiProviderRuntimeById(row.providerId)
      : null;
    if (!provider) {
      await this.fail(
        row.id,
        '数眼智能提供商已删除或停用，无法继续查询这段视频。',
      );
      return;
    }
    const engine: StoreVisitAvatarEngine =
      row.request?.engine === 'wan-s2v' ? 'wan-s2v' : 'kling-avatar';
    const response = await this.fetchJson(
      buildStoreVisitAvatarUrl(
        resolveShuyanVideoGateway(provider.baseUrl),
        engine,
        row.externalId,
      ),
      { method: 'GET' },
      provider.apiKey,
    );
    const output = (engine === 'wan-s2v' ? response.output : response.data) as
      Record<string, unknown> | undefined;
    const status = mapStoreVisitAvatarStatus(textOf(output?.task_status));
    if (status === 'failed') {
      const reason =
        engine === 'wan-s2v'
          ? [textOf(output?.code), textOf(output?.message)]
              .filter(Boolean)
              .join('：')
          : textOf(output?.task_status_msg);
      await this.fail(
        row.id,
        `第 ${Number(row.request?.segmentIndex) || ''} 段数字人生成失败${reason ? `：${reason.slice(0, 200)}` : '，请检查关键帧人脸是否清晰、台词是否合规后重试'}`,
        JSON.stringify(output ?? response).slice(0, 2000),
      );
      return;
    }
    if (status !== 'completed') {
      if (
        Date.now() - new Date(row.createdAt).getTime() >
        DOUYIN_STORE_VISIT_SEGMENT_TIMEOUT_MS
      ) {
        await this.fail(
          row.id,
          '这段数字人视频超过 3 小时仍未完成，已判定超时。',
        );
        return;
      }
      await this.operations.updateOne(
        { id: row.id, status: { $in: ['queued', 'running'] } },
        {
          $set: {
            status,
            progress: status === 'running' ? 50 : 0,
            result: response,
            updatedAt: new Date(),
          },
        },
      );
      return;
    }
    const video =
      engine === 'wan-s2v'
        ? {
            url: textOf(output?.video_url),
            seconds:
              Number(
                (response.usage as Record<string, unknown> | undefined)
                  ?.output_video_duration,
              ) ||
              Number(row.request?.audioSeconds) ||
              undefined,
          }
        : (() => {
            const first = ((
              output?.task_result as
                { videos?: Array<Record<string, unknown>> } | undefined
            )?.videos ?? [])[0];
            return {
              url: textOf(first?.url),
              seconds: Number(first?.duration) || undefined,
            };
          })();
    const claimed = await this.operations.findOneAndUpdate(
      {
        id: row.id,
        $or: [
          { status: { $in: ['queued', 'running'] } },
          {
            status: 'saving',
            updatedAt: {
              $lt: new Date(
                Date.now() - DOUYIN_STORE_VISIT_SEGMENT_SAVING_STALE_MS,
              ),
            },
          },
        ],
      },
      { $set: { status: 'saving', progress: 100, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!claimed) return;
    const scope = { tenantId: row.tenantId, userId: row.userId };
    try {
      if (!video.url) throw new Error('SHUYAN_STORE_VISIT_RESULT_URL_MISSING');
      const topic = await this.repository.get(row.topicId, scope);
      const index = Number(row.request?.segmentIndex) || 0;
      const saved = await this.storage.saveRemote(video.url, {
        name: `${topic?.title ?? `脚本 ${row.topicId}`} 探店第 ${index} 段`,
        scope,
        tags: ['抖音探店视频', 'AI生成', '数眼智能'],
        durationSeconds: video.seconds,
      });
      const segment = (topic?.storeVisit?.segments ?? []).find(
        (item) => item.id === row.segmentId,
      );
      const stale =
        !segment ||
        segment.lines !== row.request?.lines ||
        segment.keyframe?.id !== row.request?.keyframeImageId;
      if (!stale && row.segmentId) {
        await this.repository.updateStoreVisitSegment(
          row.topicId,
          row.segmentId,
          { videoId: saved.id },
          scope,
        );
      }
      await this.operations.updateOne(
        { id: row.id },
        {
          $set: {
            status: 'completed',
            progress: 100,
            result: { ...response, videoId: saved.id, videoUrl: saved.url },
            ...(stale
              ? {
                  error:
                    '视频已存入视频库，但这段的台词或关键帧在生成期间改过，没有绑定到分段。',
                }
              : {}),
            updatedAt: new Date(),
          },
          ...(stale ? {} : { $unset: { error: '', errorDetail: '' } }),
        },
      );
    } catch (error) {
      await this.fail(
        row.id,
        '这段视频转存失败，请稍后同步状态重试。',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * @description 读取「探店数字人视频」节点的数眼运行配置：没指定、不是数眼智能或没填 Key 时用中文说明拒绝。
   * @keyword-cn 读取数眼探店配置, 缺配置拒绝
   * @keyword-en read-shuyan-store-visit-runtime, reject-unconfigured
   * @returns {Promise<WorkflowNodeRuntime>} 运行配置。
   * @throws {ServiceUnavailableException} 节点不可用。
   */
  private async readRuntime(): Promise<WorkflowNodeRuntime> {
    let runtime: WorkflowNodeRuntime | null;
    try {
      runtime = await this.workflowModels.resolveNodeRuntime(
        WORKFLOW_NODES.douyinWorkbench.key,
        WORKFLOW_NODES.douyinWorkbench.storeVisitVideo,
      );
    } catch {
      runtime = null;
    }
    if (!runtime || !isShuyanProvider(runtime.providerCode))
      throw new ServiceUnavailableException(
        '后台「工作流节点模型 · 抖音视频制作 · 探店数字人视频」没有选数眼智能，不能使用可灵音色和分段生成',
      );
    if (!String(runtime.apiKey ?? '').trim())
      throw new ServiceUnavailableException(
        '数眼智能的 API Key 还没有配置，请到后台「Ai提供商设置」里填写',
      );
    return runtime;
  }

  /**
   * @description 可灵图片入参：公网地址原样给，站内图片读文件转成不带前缀的 Base64（可灵要求）。
   * @keyword-cn 可灵图片入参, 站内图片Base64
   * @keyword-en kling-image-input, local-image-base64
   * @param {string} url 图库地址。
   * @returns {Promise<string>} 公网地址或 Base64。
   */
  private async toKlingImage(url: string): Promise<string> {
    if (/^https?:\/\//i.test(url)) return url;
    const filePath = resolveStaticFilePath(url);
    if (!filePath) throw new BadRequestException('关键帧图片地址无效');
    return (await readFile(filePath)).toString('base64');
  }

  /**
   * @description 万相数字人只收公网地址：不是 http(s) 时说明原因（需要给图库配置 OSS）。
   * @keyword-cn 校验公网地址, 万相入参
   * @keyword-en require-public-url, wan-input
   * @param {string} url 地址。
   * @param {string} label 素材名（关键帧 / 配音）。
   * @returns {string} 原地址。
   * @throws {BadRequestException} 不是公网地址。
   */
  private requirePublicUrl(url: string, label: string): string {
    if (/^https?:\/\//i.test(String(url ?? ''))) return url;
    throw new BadRequestException(
      `万相数字人要求${label}是公网地址，请先给图库配置 OSS，或把节点模型换成 kling-avatar-std`,
    );
  }

  /**
   * @description 发起带超时（5 分钟）与 Bearer 的数眼 JSON 请求；非 2xx 抛 `SHUYAN_VIDEO_HTTP_<状态码>`，
   *   可灵业务码非 0 抛 `SHUYAN_KLING_ERROR`，都保留对端报错供排查。
   * @keyword-cn 数眼探店请求, 错误体保留
   * @keyword-en shuyan-store-visit-request, preserve-error-body
   * @param {string} url 接口地址。
   * @param {RequestInit} init fetch 参数。
   * @param {string} [apiKey] 数眼 Key。
   * @returns {Promise<Record<string, unknown>>} JSON 响应。
   */
  private async fetchJson(
    url: string,
    init: RequestInit,
    apiKey?: string,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    } catch (error) {
      throw new Error(`SHUYAN_VIDEO_NETWORK_ERROR:${String(error)}`);
    }
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { raw: text.slice(0, 1000) };
    }
    if (!response.ok)
      throw new Error(
        `SHUYAN_VIDEO_HTTP_${response.status}:${JSON.stringify(data).slice(0, 2000)}`,
      );
    if (typeof data.code === 'number' && data.code !== 0)
      throw new Error(
        `SHUYAN_KLING_ERROR:${data.code}:${textOf(data.message).slice(0, 500)}`,
      );
    return data;
  }

  /**
   * @description 校验当前用户拥有的子选题（脚本）。
   * @keyword-cn 校验探店脚本, 操作所有权
   * @keyword-en require-store-visit-topic, operation-ownership
   * @param {number} topicId 子选题 ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 脚本。
   */
  private async requireChild(
    topicId: number,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const topic = await this.repository.get(topicId, scope);
    if (!topic || topic.kind !== 'child')
      throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return topic;
  }

  /**
   * @description 取脚本里的一段，找不到时报错（先保存分段再操作）。
   * @keyword-cn 读取探店分段, 分段校验
   * @keyword-en require-store-visit-segment, segment-check
   * @param {DouyinTopicEntity} topic 脚本。
   * @param {string} segmentId 分段 ID。
   * @returns {DouyinStoreVisitSegment} 分段。
   */
  private requireSegment(
    topic: DouyinTopicEntity,
    segmentId: string,
  ): DouyinStoreVisitSegment {
    const segment = (topic.storeVisit?.segments ?? []).find(
      (item) => item.id === segmentId,
    );
    if (!segment)
      throw new BadRequestException('这一段还没保存或已被删除，请先保存台词');
    return segment;
  }

  /**
   * @description 标记分段调用失败，`error` 为中文说明、`detail` 为原始信息。
   * @keyword-cn 标记分段失败, 失败原因
   * @keyword-en mark-segment-failed, failure-reason
   * @param {string} id 调用记录 ID。
   * @param {string} message 中文说明。
   * @param {string} [detail] 原始信息。
   */
  private async fail(
    id: string,
    message: string,
    detail?: string,
  ): Promise<void> {
    await this.operations.updateOne(
      { id },
      {
        $set: {
          status: 'failed',
          error: message,
          ...(detail ? { errorDetail: detail } : {}),
          updatedAt: new Date(),
        },
      },
    );
  }

  /**
   * @description 去掉数据库字段与请求正文后的分段调用视图。
   * @keyword-cn 分段调用视图, 隐藏请求
   * @keyword-en segment-operation-view, hide-request
   * @param {DouyinOperationEntity} row 调用记录。
   * @returns {DouyinOperationView} 前端安全视图。
   */
  private toView(row: DouyinOperationEntity): DouyinOperationView {
    return {
      id: row.id,
      operation: row.operation,
      topicId: row.topicId,
      segmentId: row.segmentId,
      provider: row.provider,
      mode: row.mode,
      model: row.model,
      progress: row.progress,
      status: row.status,
      externalId: row.externalId,
      result: row.result,
      error: row.error,
      errorDetail: row.errorDetail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
