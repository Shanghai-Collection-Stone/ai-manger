import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { Collection, Db, ObjectId } from 'mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import { AiBillingService } from '../../ai-billing/services/ai-billing.service.js';
import type {
  PixmaxAsset,
  PixmaxRuntime,
} from '../../pixmax/entities/pixmax.entity.js';
import { PixmaxClientService } from '../../pixmax/services/pixmax-client.service.js';
import {
  describePixmaxError,
  toPixmaxFriendlyError,
} from '../../pixmax/services/pixmax-error.js';
import {
  buildPixmaxVideoParams,
  mapPixmaxTaskStatus,
  requiresPixmaxCompliance,
  type PixmaxVideoMode,
} from '../../pixmax/services/pixmax-video-params.js';
import { OssStorageService } from '../../video-library/services/oss-storage.service.js';
import { VideoLibraryService } from '../../video-library/services/video-library.service.js';
import type { WorkflowNodeRuntime } from '../../workflow-model/entities/workflow-model.entity.js';
import type {
  DouyinOperationEntity,
  DouyinOperationView,
  DouyinStoryboardShot,
  DouyinTopicEntity,
  DouyinVideoAudioSetting,
} from '../entities/douyin-workbench.entity.js';
import {
  DouyinWorkbenchRepositoryService,
  normalizeVideoAudio,
} from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 后台轮询 PixMax 任务的间隔。
 * @keyword-cn PixMax轮询间隔, 后台轮询
 * @keyword-en pixmax-poll-interval, background-polling
 */
export const DOUYIN_PIXMAX_POLL_MS = 15 * 1000;

/**
 * @description 任务提交后超过这么久仍未结束就判定超时失败；「保存中」超过 10 分钟视为上次保存中断，可重新认领。
 * @keyword-cn PixMax任务超时, 保存中断
 * @keyword-en pixmax-task-timeout, saving-stale
 */
export const DOUYIN_PIXMAX_TASK_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DOUYIN_PIXMAX_SAVING_STALE_MS = 10 * 60 * 1000;

/**
 * @description PixMax 任务结果为失败时的中文说明。
 * @keyword-cn PixMax失败原因, 积分不足
 * @keyword-en pixmax-failure-reason, credit-insufficient
 */
const PIXMAX_STATUS_MESSAGES: Record<string, string> = {
  RESOURCE_INSUFFICIENT: 'PixMax 积分不足，请充值后重新生成。',
  ABORTED: 'PixMax 任务已被中止。',
};

/**
 * @description 配音语言的中文名，写进提示词【声音】段。
 * @keyword-cn 配音语言名称, 声音结构
 * @keyword-en voiceover-language-label, audio-structure
 */
export const DOUYIN_VOICE_LANGUAGE_LABELS: Record<
  DouyinVideoAudioSetting['language'],
  string
> = {
  'zh-CN': '标准普通话（中文）',
  yue: '粤语（中文）',
  en: '英语',
};

/**
 * @description 按声音设置生成提示词【声音】段：配音时限定语言并禁止其他语言人声，仅音乐时禁止任何人声，静音时要求无声。
 * @keyword-cn 声音段落, 配音语言约束
 * @keyword-en audio-section, voiceover-language-rule
 * @param audio 声音设置。
 * @param clamped 时长是否被压缩（配音时允许精简口播）。
 * @returns {string} 声音段文本。
 */
export function buildVideoAudioSection(
  audio: DouyinVideoAudioSetting,
  clamped = false,
): string {
  if (audio.mode === 'mute') {
    return '【声音】无声视频：不要任何人声、旁白、音乐或音效。';
  }
  if (audio.mode === 'music') {
    return '【声音】只保留与画面情绪匹配的背景音乐和环境音；不要任何人声、旁白、对白或歌词。';
  }
  const language = DOUYIN_VOICE_LANGUAGE_LABELS[audio.language];
  return [
    `【声音】旁白配音：使用${language}朗读【口播稿】，语速自然、情绪贴合画面；除${language}外不要出现任何其他语言的人声、对白或歌词；背景音乐轻柔，不盖过人声。`,
    clamped ? `时长不够读完时可以精简口播稿，但必须保持${language}。` : '',
  ]
    .filter(Boolean)
    .join('');
}

/**
 * @description 从调用记录的请求里取出前端要展示的生成方案：生成方式、参考图张数、实际与计划时长、是否压缩、声音设置、是否带口播稿。
 * @keyword-cn 读取生成方案, 参考图张数
 * @keyword-en read-video-plan, reference-image-count
 * @param request 调用记录里保存的请求。
 * @returns 生成方案；非 PixMax 记录返回 undefined。
 */
export function readDouyinVideoPlan(
  request: Record<string, unknown> | undefined,
): DouyinOperationView['plan'] {
  if (!request || typeof request !== 'object') return undefined;
  const imageIds = Array.isArray(request.imageIds) ? request.imageIds : [];
  const audio =
    request.audio && typeof request.audio === 'object'
      ? (request.audio as Partial<DouyinVideoAudioSetting>)
      : undefined;
  return {
    referModel:
      typeof request.referModel === 'string' ? request.referModel : undefined,
    imageCount: imageIds.length,
    duration:
      typeof request.duration === 'number' ? request.duration : undefined,
    plannedSeconds:
      typeof request.plannedSeconds === 'number'
        ? request.plannedSeconds
        : undefined,
    durationClamped: request.durationClamped === true,
    targetSeconds:
      typeof request.targetSeconds === 'number'
        ? request.targetSeconds
        : undefined,
    audioMode: audio?.mode,
    audioLanguage: audio?.language,
    scriptIncluded: request.scriptIncluded === true,
  };
}

/**
 * @description 输出调用记录的失败信息：PixMax 通道里还保存着原始报错的旧记录（英文或错误码开头），展示时翻译成中文并把原文放进 `errorDetail`。
 * @keyword-cn 展示视频错误, 旧记录翻译
 * @keyword-en present-video-error, legacy-error-translate
 * @param row 调用记录。
 * @returns 给前端的 `error` 与 `errorDetail`。
 */
export function presentDouyinVideoError(row: {
  provider?: string;
  error?: string;
  errorDetail?: string;
}): { error?: string; errorDetail?: string } {
  if (!row.error || row.provider !== 'pixmax' || row.errorDetail) {
    return { error: row.error, errorDetail: row.errorDetail };
  }
  const looksRaw =
    /^[A-Z][A-Z0-9_]{3,}/.test(row.error) || !/[一-龥]/.test(row.error);
  return looksRaw
    ? { error: describePixmaxError(row.error), errorDetail: row.error }
    : { error: row.error };
}

/**
 * @description 参与视频生成的一张分镜参考图。
 * @keyword-cn 分镜参考图, 图库图片
 * @keyword-en shot-reference-image, gallery-image
 */
interface ShotReferenceImage {
  imageId: number;
  url: string;
  name: string;
  shotIndexes: number[];
}

/**
 * @description 生成一段分镜视频的结构化提示词：【视频】【画面】【口播稿】【声音】【参考图】【限制】【补充要求】。
 * @keyword-cn 分镜视频提示词, 首帧参考, 结构化提示词
 * @keyword-en shot-video-prompt, first-frame-reference, structured-prompt
 * @param input 标题、分镜、序号、是否带参考图、声音设置与补充要求。
 * @returns {string} 提示词。
 */
export function buildShotVideoPrompt(input: {
  title: string;
  shot: DouyinStoryboardShot;
  index: number;
  hasImage: boolean;
  audio: DouyinVideoAudioSetting;
  extra?: string;
}): string {
  const { shot } = input;
  const narration = String(shot.narration ?? '').trim();
  return [
    `【视频】竖屏 9:16 抖音短视频《${input.title}》的第 ${input.index + 1} 个镜头，景别${shot.shotType || '中景'}，时长约 ${shot.duration} 秒。`,
    `【画面】${shot.visual}`,
    narration ? `【口播稿】${narration}` : '【口播稿】本镜没有口播。',
    buildVideoAudioSection(input.audio),
    input.hasImage
      ? '【参考图】参考图是这一镜的首帧与主体外观，保持人物、场景和色调一致，让画面自然动起来。'
      : '',
    '【限制】画面里不要出现字幕、文字、logo 或水印。',
    input.extra ? `【补充要求】${input.extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 生成「所有分镜一次出整片」的结构化提示词：【视频】【分镜时间轴】（逐镜画面、口播、参考图编号、转场）
 *   【口播稿】（完整脚本正文，没有正文时按分镜口播拼接）【声音】【参考图】【时长】【限制】【补充要求】。
 *   每镜时长按「实际时长 / 分镜总时长」等比缩放：更短时压缩并保证所有镜头都出现，更长时放缓节奏。
 * @keyword-cn 整片视频提示词, 多镜头时间轴, 结构化提示词
 * @keyword-en full-video-prompt, multi-shot-timeline, structured-prompt
 * @param input 标题、脚本正文、全部分镜、参考图、实际时长、生成方式、声音设置与补充要求。
 * @returns {string} 提示词。
 */
export function buildFullVideoPrompt(input: {
  title: string;
  script?: string;
  shots: DouyinStoryboardShot[];
  images: ShotReferenceImage[];
  seconds?: number;
  referModel?: string;
  audio: DouyinVideoAudioSetting;
  extra?: string;
}): string {
  const { shots, images } = input;
  const planned = shots.reduce(
    (sum, shot) => sum + (Number(shot.duration) || 0),
    0,
  );
  const total = input.seconds && input.seconds > 0 ? input.seconds : planned;
  // 按实际时长等比缩放每镜：比分镜总时长短就压缩，长就放缓节奏
  const scale = planned > 0 ? total / planned : 1;
  const refOf = new Map<number, number>();
  images.forEach((image, order) =>
    image.shotIndexes.forEach((shotIndex) => refOf.set(shotIndex, order + 1)),
  );
  let cursor = 0;
  const lines = shots.map((shot, index) => {
    const length = Math.max(
      1,
      Math.round((Number(shot.duration) || 1) * scale * 10) / 10,
    );
    const start = Math.round(cursor * 10) / 10;
    cursor += length;
    const end = Math.round(cursor * 10) / 10;
    const ref = refOf.get(index);
    return [
      `镜头${index + 1}（${start}-${end} 秒，${shot.shotType || '中景'}）：${shot.visual}`,
      ref ? `画面参考图${ref}` : '',
      shot.narration ? `口播：${shot.narration}` : '',
      shot.transition ? `转场：${shot.transition}` : '',
    ]
      .filter(Boolean)
      .join('；');
  });
  const script =
    String(input.script ?? '').trim() ||
    shots
      .map((shot) => String(shot.narration ?? '').trim())
      .filter(Boolean)
      .join('\n');
  const referNote =
    input.referModel === 'firstAndLastFrame'
      ? '【参考图】参考图1是开场首帧、参考图2是结尾尾帧，中间镜头按时间轴自然过渡，保持人物外观、服装、场景和色调前后一致。'
      : input.referModel === 'imageToVideo'
        ? '【参考图】参考图是开场首帧，后续镜头沿用其中的人物外观、服装、场景和色调。'
        : images.length
          ? '【参考图】参考图按编号对应时间轴里标注的镜头，保持人物外观、服装、场景和色调前后一致。'
          : '';
  return [
    `【视频】竖屏 9:16 抖音短视频《${input.title}》，一条连续完整的视频，总时长约 ${total} 秒。`,
    '【分镜时间轴】按顺序依次呈现，镜头之间按给出的转场衔接：',
    ...lines,
    script
      ? `【口播稿】${input.audio.mode === 'voiceover' ? '按时间轴节奏朗读' : '仅用于理解内容，不要朗读'}：\n${script}`
      : '',
    buildVideoAudioSection(input.audio, scale < 1),
    referNote,
    scale < 1
      ? `【时长】分镜原计划 ${planned} 秒，本次最长 ${total} 秒，按比例压缩每个镜头，所有镜头都要出现。`
      : '',
    '【限制】画面里不要出现字幕、文字、logo 或水印。',
    input.extra ? `【补充要求】${input.extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 抖音视频生成的 PixMax 通道：把分镜（单镜或整片）组装成 PixMax 任务提交，写入调用记录，
 *   后台轮询任务状态，完成后把成片转存进视频库并回填到分镜或脚本。
 * @keyword-cn PixMax生视频, 整片生成, 分镜视频
 * @keyword-en pixmax-video-generation, full-video, shot-video
 */
@Injectable()
export class DouyinPixmaxVideoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DouyinPixmaxVideoService.name);
  private readonly operations: Collection<DouyinOperationEntity>;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly billing: AiBillingService,
    private readonly adminService: AdminService,
    private readonly pixmax: PixmaxClientService,
    private readonly videoLibrary: VideoLibraryService,
    private readonly oss: OssStorageService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
  }

  /**
   * @description 启动后台轮询，服务重启后会接着跟进未结束的任务。
   * @keyword-cn 启动PixMax轮询, 重启续跟
   * @keyword-en start-pixmax-polling, resume-after-restart
   */
  onModuleInit(): void {
    this.timer = setInterval(() => void this.pollOnce(), DOUYIN_PIXMAX_POLL_MS);
    this.timer.unref?.();
  }

  /**
   * @description 停止后台轮询。
   * @keyword-cn 停止PixMax轮询, 模块销毁
   * @keyword-en stop-pixmax-polling, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 提交一次 PixMax 视频生成：单镜用该镜画面做首帧（没图则文生视频）；整片把所有分镜写进时间轴提示词、
   *   按模型上限带入各镜画面作参考，一次生成一条完整视频。提交前按生视频服务扣费，提交失败也留一条失败记录。
   * @keyword-cn 提交PixMax视频, 整片或单镜
   * @keyword-en submit-pixmax-video, full-or-shot
   * @param input 脚本、模式、单镜 ID、补充要求、节点运行配置与作用域。
   * @returns {Promise<DouyinOperationView>} 调用记录。
   * @throws {BadRequestException} DOUYIN_STORYBOARD_REQUIRED / DOUYIN_STORYBOARD_SHOT_NOT_FOUND / PIXMAX_MODEL_*。
   */
  async start(input: {
    topic: DouyinTopicEntity;
    mode: PixmaxVideoMode;
    shotId?: string;
    prompt?: string;
    runtime: WorkflowNodeRuntime;
    scope: DouyinScope;
  }): Promise<DouyinOperationView> {
    const { topic, mode, runtime, scope } = input;
    const extra =
      String(input.prompt ?? '')
        .trim()
        .slice(0, 1000) || undefined;
    const shotIndex = input.shotId
      ? topic.storyboard.findIndex((shot) => shot.id === input.shotId)
      : -1;
    if (mode === 'shot' && shotIndex < 0) {
      throw new BadRequestException('DOUYIN_STORYBOARD_SHOT_NOT_FOUND');
    }
    const shots =
      mode === 'shot' ? [topic.storyboard[shotIndex]] : topic.storyboard;
    if (!shots.length)
      throw new BadRequestException('DOUYIN_STORYBOARD_REQUIRED');

    const images = this.collectImages(shots, mode === 'shot' ? shotIndex : 0);
    const plannedSeconds = shots.reduce(
      (sum, shot) => sum + (Number(shot.duration) || 0),
      0,
    );
    // 整片可在视频栏设定目标时长，未设定时按分镜总时长；单镜按这一镜的时长
    const chosenSeconds =
      mode === 'full' && Number(topic.fullVideoDuration) > 0
        ? Number(topic.fullVideoDuration)
        : undefined;
    const targetSeconds = chosenSeconds ?? plannedSeconds;
    const audio = normalizeVideoAudio(topic.videoAudio);
    const plan = buildPixmaxVideoParams({
      modelCode: runtime.model,
      prompt: '',
      targetSeconds: targetSeconds || 5,
      mode,
      availableImages: images.length,
      audioEnabled: audio.mode !== 'mute',
    });
    const usedImages =
      plan.referModel === 'firstAndLastFrame' && images.length >= 2
        ? [images[0], images[images.length - 1]]
        : images.slice(0, plan.imageCount);
    const prompt =
      mode === 'shot'
        ? buildShotVideoPrompt({
            title: topic.title,
            shot: shots[0],
            index: shotIndex,
            hasImage: usedImages.length > 0,
            audio,
            extra,
          })
        : buildFullVideoPrompt({
            title: topic.title,
            script: topic.script,
            shots,
            images: usedImages,
            seconds: plan.duration,
            referModel: plan.referModel,
            audio,
            extra,
          });
    const scriptIncluded =
      mode === 'shot'
        ? Boolean(String(shots[0].narration ?? '').trim())
        : Boolean(
            String(topic.script ?? '').trim() ||
            shots.some((shot) => String(shot.narration ?? '').trim()),
          );
    const params = { ...plan.params, prompt };
    const operationId = randomUUID();
    const request = {
      mode,
      model: runtime.model,
      referModel: plan.referModel,
      duration: plan.duration,
      plannedSeconds,
      targetSeconds: chosenSeconds,
      durationClamped:
        plan.duration !== undefined && plan.duration < plannedSeconds,
      imageIds: usedImages.map((image) => image.imageId),
      audio,
      audioSwitchApplied: plan.audioSwitchApplied,
      scriptIncluded,
      params,
    };
    const base = {
      operation: 'generate' as const,
      topicId: topic.id,
      shotId: mode === 'shot' ? input.shotId : undefined,
      provider: 'pixmax' as const,
      mode,
      model: runtime.model,
      providerId: runtime.providerId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      request,
    };

    await this.billing.chargeService({
      serviceCode: 'video-generation',
      tenantId: scope.tenantId,
      userId: scope.userId,
      operationId,
      source:
        mode === 'shot'
          ? 'douyin-workbench.shot-video-generation'
          : 'douyin-workbench.full-video-generation',
      platformScope: !scope.tenantId,
    });
    const now = new Date();
    try {
      const pixmaxRuntime = this.toPixmaxRuntime(runtime);
      const projectUuid = await this.pixmax.ensureProject(
        pixmaxRuntime,
        'AI工作台·抖音视频制作',
      );
      const inputAssetUuids: string[] = [];
      for (const image of usedImages) {
        try {
          inputAssetUuids.push(
            await this.pixmax.uploadAssetCached(pixmaxRuntime, {
              sourceKey: `gallery:${image.imageId}`,
              fileName: image.name,
              contentType: this.contentTypeOf(image.url, 'image/jpeg'),
              load: () => this.readGalleryFile(image.url),
              requireCompliance: requiresPixmaxCompliance(runtime.model),
            }),
          );
        } catch (error) {
          // 标出是哪几镜的画面出了问题，方便用户去分镜里换图
          const shotsLabel = image.shotIndexes
            .map((shotIndex) => shotIndex + 1)
            .join('、');
          throw toPixmaxFriendlyError(error, `第 ${shotsLabel} 镜的画面`);
        }
      }
      const task = await this.pixmax.submitTask(pixmaxRuntime, {
        projectUuid,
        inputAssetUuids,
        params,
      });
      // 刚提交就完成的极少见情况也记成生成中，交给轮询统一转存
      const initial = mapPixmaxTaskStatus(task.status);
      const doc: DouyinOperationEntity = {
        _id: new ObjectId(),
        id: operationId,
        ...base,
        status: initial === 'completed' ? 'running' : initial,
        progress: Number(task.progress) || 0,
        externalId: task.taskUuid,
        result: {
          taskUuid: task.taskUuid,
          nodeUuid: task.nodeUuid,
          projectUuid,
        },
        error: this.readTaskError(task),
        createdAt: now,
        updatedAt: now,
      };
      await this.operations.insertOne(doc);
      setTimeout(() => void this.pollOnce(), 3000).unref?.();
      return this.toView(doc);
    } catch (error) {
      const friendly = toPixmaxFriendlyError(error);
      await this.operations.insertOne({
        _id: new ObjectId(),
        id: operationId,
        ...base,
        status: 'failed',
        error: friendly.message,
        errorDetail: friendly.detail,
        createdAt: now,
        updatedAt: now,
      });
      this.logger.warn(
        `[start] 提交失败 operation=${operationId}: ${friendly.detail}`,
      );
      throw new HttpException(
        friendly.message,
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * @description 立即同步一条 PixMax 调用（前端「同步状态」），返回最新记录。
   * @keyword-cn 同步PixMax调用, 手动刷新
   * @keyword-en sync-pixmax-operation, manual-refresh
   * @param id 调用记录 ID。
   * @returns {Promise<DouyinOperationView>} 最新记录。
   */
  async refresh(id: string): Promise<DouyinOperationView> {
    const row = await this.operations.findOne({ id, provider: 'pixmax' });
    if (!row) throw new BadRequestException('DOUYIN_OPERATION_NOT_FOUND');
    await this.refreshRow(row);
    const latest = await this.operations.findOne({ id });
    return this.toView(latest ?? row);
  }

  /**
   * @description 跟进一轮所有未结束的 PixMax 调用；同一进程内不重入。
   * @keyword-cn 轮询PixMax调用, 防重入
   * @keyword-en poll-pixmax-operations, reentry-guard
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const rows = await this.operations
        .find({
          provider: 'pixmax',
          $or: [
            { status: { $in: ['queued', 'running'] } },
            {
              status: 'saving',
              updatedAt: {
                $lt: new Date(Date.now() - DOUYIN_PIXMAX_SAVING_STALE_MS),
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
            `[pollOnce] 跟进失败 operation=${row.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * @description 查询一条调用对应的 PixMax 任务并推进状态：进行中更新进度，失败写原因，完成后认领并转存成片。
   *   网络等临时错误不改状态，下一轮继续；超过 2 小时仍未结束判为超时失败。
   * @keyword-cn 推进PixMax调用, 完成转存
   * @keyword-en advance-pixmax-operation, save-on-complete
   */
  private async refreshRow(row: DouyinOperationEntity): Promise<void> {
    if (!row.externalId) {
      await this.fail(row.id, 'PIXMAX_TASK_ID_MISSING');
      return;
    }
    const runtime = row.providerId
      ? await this.adminService.getAiProviderRuntimeById(row.providerId)
      : null;
    if (!runtime) {
      await this.fail(
        row.id,
        'PixMax 提供商已删除或停用，无法继续查询这次生成。',
      );
      return;
    }
    const pixmaxRuntime = this.toPixmaxRuntime(runtime);
    const task = await this.pixmax.getTask(pixmaxRuntime, row.externalId);
    const status = mapPixmaxTaskStatus(task.status);
    if (status === 'failed') {
      const raw = this.readTaskError(task) || `PIXMAX_TASK_${task.status}`;
      await this.fail(row.id, describePixmaxError(raw), raw);
      return;
    }
    if (status !== 'completed') {
      if (
        Date.now() - new Date(row.createdAt).getTime() >
        DOUYIN_PIXMAX_TASK_TIMEOUT_MS
      ) {
        await this.fail(row.id, 'PixMax 任务超过 2 小时仍未完成，已判定超时。');
        return;
      }
      await this.operations.updateOne(
        { id: row.id, status: { $in: ['queued', 'running'] } },
        {
          $set: {
            status,
            progress: Number(task.progress) || 0,
            updatedAt: new Date(),
          },
        },
      );
      return;
    }

    // 认领保存权，多进程或连续轮询时只保存一次
    const claimed = await this.operations.findOneAndUpdate(
      {
        id: row.id,
        $or: [
          { status: { $in: ['queued', 'running'] } },
          {
            status: 'saving',
            updatedAt: {
              $lt: new Date(Date.now() - DOUYIN_PIXMAX_SAVING_STALE_MS),
            },
          },
        ],
      },
      { $set: { status: 'saving', progress: 100, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!claimed) return;
    try {
      const asset =
        (task.resultAssets ?? []).find(
          (item) => String(item.fileType).toUpperCase() === 'VIDEO',
        ) ?? (task.resultAssets ?? [])[0];
      if (!asset) throw new Error('PIXMAX_RESULT_EMPTY');
      const scope = { tenantId: row.tenantId, userId: row.userId };
      const topic = await this.repository.get(row.topicId, scope);
      const shotIndex = row.shotId
        ? (topic?.storyboard ?? []).findIndex((shot) => shot.id === row.shotId)
        : -1;
      const name = `${topic?.title ?? `脚本 ${row.topicId}`} ${row.mode === 'shot' ? `第 ${shotIndex + 1} 镜` : '整片'}`;
      const video = await this.saveVideo(pixmaxRuntime, asset, {
        name,
        scope,
        tags: [row.mode === 'shot' ? '抖音分镜视频' : '抖音整片视频', 'AI生成'],
      });
      if (topic) {
        if (row.mode === 'shot' && row.shotId && shotIndex >= 0) {
          await this.repository.updateShot(
            row.topicId,
            row.shotId,
            { videoId: video.id },
            scope,
          );
        } else if (row.mode !== 'shot') {
          await this.repository.update(
            row.topicId,
            { generatedVideoId: video.id },
            scope,
          );
        }
      }
      await this.operations.updateOne(
        { id: row.id },
        {
          $set: {
            status: 'completed',
            progress: 100,
            result: {
              ...(row.result && typeof row.result === 'object'
                ? row.result
                : {}),
              taskUuid: task.taskUuid,
              videoId: video.id,
              videoUrl: video.url,
            },
            error: topic
              ? undefined
              : '成片已存入视频库，但脚本已被删除，未能回填。',
            updatedAt: new Date(),
          },
        },
      );
    } catch (error) {
      const friendly = toPixmaxFriendlyError(error);
      await this.fail(row.id, friendly.message, friendly.detail);
    }
  }

  /**
   * @description 把 PixMax 成片存进视频库：OSS 已配置时下载后转存（连同封面），否则登记 PixMax 返回的地址。
   * @keyword-cn 转存生成视频, 视频库登记
   * @keyword-en save-generated-video, register-video
   */
  private async saveVideo(
    runtime: PixmaxRuntime,
    asset: PixmaxAsset,
    input: { name: string; scope: DouyinScope; tags: string[] },
  ): Promise<{ id: number; url: string }> {
    const url = this.pixmax.resolveAssetUrl(runtime, asset);
    if (!url) throw new Error('PIXMAX_RESULT_URL_MISSING');
    const coverUrl = this.pixmax.resolveAssetUrl(
      runtime,
      asset,
      'previewWebUrl',
    );
    const meta = asset.metaData ?? {};
    const common = {
      userId: input.scope.userId,
      tenantId: input.scope.tenantId,
      name: input.name,
      contentType: 'video/mp4',
      durationMs: meta.duration ? meta.duration * 1000 : null,
      width: asset.width ?? meta.width ?? null,
      height: asset.height ?? meta.height ?? null,
      tags: input.tags,
    };
    if (!this.oss.isConfigured()) {
      this.logger.warn('[saveVideo] OSS 未配置，视频库直接登记 PixMax 地址');
      const record = await this.videoLibrary.registerExternal({
        ...common,
        url,
        coverUrl: coverUrl || undefined,
        sizeBytes: meta.fileSize,
      });
      return { id: record.id, url: record.url };
    }
    const buffer = await this.pixmax.download(url);
    const ext = extname(new URL(url).pathname) || '.mp4';
    const key = this.oss.buildObjectKey({
      scene: 'video',
      fileName: `generated${ext}`,
      tenantId: input.scope.tenantId,
    });
    await this.oss.putObject(key, buffer, this.contentTypeOf(url, 'video/mp4'));
    let coverKey: string | undefined;
    if (coverUrl) {
      try {
        const cover = await this.pixmax.download(coverUrl);
        coverKey = this.oss.buildObjectKey({
          scene: 'poster',
          fileName: 'cover.jpg',
          tenantId: input.scope.tenantId,
        });
        await this.oss.putObject(coverKey, cover, 'image/jpeg');
      } catch (error) {
        coverKey = undefined;
        this.logger.warn(
          `[saveVideo] 封面转存失败，只保存视频: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const record = await this.videoLibrary.register({
      ...common,
      key,
      coverKey,
      sizeBytes: buffer.length,
    });
    return { id: record.id, url: record.url };
  }

  /**
   * @description 从分镜里按顺序收集图库图片（同一张图只取一次，记下对应的镜头序号）。
   * @keyword-cn 收集分镜参考图, 图片去重
   * @keyword-en collect-shot-images, dedupe-images
   * @param shots 参与本次生成的分镜。
   * @param offset 单镜模式下该镜在全部分镜中的序号，整片为 0。
   */
  private collectImages(
    shots: DouyinStoryboardShot[],
    offset: number,
  ): ShotReferenceImage[] {
    const byId = new Map<number, ShotReferenceImage>();
    shots.forEach((shot, index) => {
      const media = shot.media;
      if (media?.type !== 'image' || !media.url) return;
      const existing = byId.get(media.id);
      if (existing) {
        existing.shotIndexes.push(index + offset);
        return;
      }
      byId.set(media.id, {
        imageId: media.id,
        url: media.url,
        name: `${media.name || `image-${media.id}`}${extname(media.url.split('?')[0]) || '.jpg'}`,
        shotIndexes: [index + offset],
      });
    });
    return [...byId.values()];
  }

  /**
   * @description 读取图库图片内容：站内 `/static/...`、`/uploads/...` 读本地文件，站外地址直接下载。
   * @keyword-cn 读取图库文件, 本地或远程
   * @keyword-en read-gallery-file, local-or-remote
   */
  private async readGalleryFile(url: string): Promise<Buffer> {
    const clean = url.split('?')[0];
    if (/^https?:\/\//i.test(clean)) return this.pixmax.download(clean);
    if (clean.startsWith('/static/')) {
      return readFile(
        join(process.cwd(), 'public', clean.slice('/static/'.length)),
      );
    }
    if (clean.startsWith('/uploads/')) {
      return readFile(join(process.cwd(), 'public', clean.slice(1)));
    }
    throw new Error(`DOUYIN_SHOT_IMAGE_UNREADABLE:${url}`);
  }

  /**
   * @description 按扩展名推断 MIME 类型。
   * @keyword-cn 推断文件类型, 扩展名
   * @keyword-en infer-content-type, file-extension
   */
  private contentTypeOf(url: string, fallback: string): string {
    const ext = extname(url.split('?')[0]).toLowerCase();
    const types: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
    };
    return types[ext] ?? fallback;
  }

  /**
   * @description 读出任务失败原因：优先 PixMax 替换后的文案，其次供应商原文，再按状态给中文说明。
   * @keyword-cn 读取任务失败原因, 失败文案
   * @keyword-en read-task-error, failure-text
   */
  private readTaskError(task: {
    status: string;
    replaceProviderErrorMsg?: string | null;
    providerErrorMsg?: string | null;
  }): string | undefined {
    return (
      task.replaceProviderErrorMsg ||
      task.providerErrorMsg ||
      PIXMAX_STATUS_MESSAGES[String(task.status).toUpperCase()] ||
      undefined
    );
  }

  /**
   * @description 把调用记录标为失败：`error` 是给用户看的中文说明，`detail` 保留原始信息供排查。
   * @keyword-cn 标记调用失败, 失败原因
   * @keyword-en mark-operation-failed, failure-reason
   */
  private async fail(
    id: string,
    error: string,
    detail?: string,
  ): Promise<void> {
    await this.operations.updateOne(
      { id },
      {
        $set: {
          status: 'failed',
          error: error.slice(0, 500),
          ...(detail ? { errorDetail: detail.slice(0, 1000) } : {}),
          updatedAt: new Date(),
        },
      },
    );
  }

  /**
   * @description 节点运行配置转成 PixMax 连接信息。
   * @keyword-cn 转换PixMax连接, 节点配置
   * @keyword-en to-pixmax-runtime, node-runtime
   */
  private toPixmaxRuntime(runtime: {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
  }): PixmaxRuntime {
    return {
      providerId: runtime.providerId,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
    };
  }

  /**
   * @description 生成调用记录的前端安全视图。
   * @keyword-cn PixMax调用视图, 隐藏请求
   * @keyword-en pixmax-operation-view, hide-request
   */
  private toView(row: DouyinOperationEntity): DouyinOperationView {
    return {
      id: row.id,
      operation: row.operation,
      topicId: row.topicId,
      shotId: row.shotId,
      provider: row.provider,
      mode: row.mode,
      model: row.model,
      progress: row.progress,
      plan: readDouyinVideoPlan(row.request),
      status: row.status,
      externalId: row.externalId,
      result: row.result,
      ...presentDouyinVideoError(row),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
