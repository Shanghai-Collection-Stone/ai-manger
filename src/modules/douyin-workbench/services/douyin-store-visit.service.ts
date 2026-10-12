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
import { extname } from 'node:path';
import { Collection, Db, ObjectId } from 'mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import { AiBillingService } from '../../ai-billing/services/ai-billing.service.js';
import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import {
  WORKFLOW_NODES,
  type WorkflowNodeRuntime,
} from '../../workflow-model/entities/workflow-model.entity.js';
import { isShuyanProvider } from '../../workflow-model/services/shuyan-model-catalog.js';
import { WorkflowModelService } from '../../workflow-model/services/workflow-model.service.js';
import type {
  DouyinOperationEntity,
  DouyinOperationView,
  DouyinStoreVisitSegment,
  DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import {
  buildCosyVoicePrefix,
  COSYVOICE_CLONE_MODEL,
  COSYVOICE_PRESET_MODEL,
  COSYVOICE_PRESET_VOICES,
  type CosyVoicePresetVoice,
  DASHSCOPE_PROVIDER_CODE,
  type DashScopeRuntime,
  describeCosyVoiceFailure,
  DouyinCosyVoiceService,
} from './douyin-cosyvoice.service.js';
import {
  clampShuyanVideoDuration,
  clampShuyanVideoResolution,
  describeShuyanVideoError,
  describeShuyanVideoFailure,
  listShuyanVideoDurationChoices,
  mapShuyanVideoStatus,
  normalizeShuyanVideoModel,
  resolveShuyanVideoGateway,
  resolveShuyanVideoRoute,
  resolveShuyanVideoTaskUrl,
  type ShuyanVideoRoute,
  type ShuyanVideoTask,
  unwrapShuyanVideoTask,
} from './douyin-shuyan-video.service.js';
import {
  DouyinVideoStorageService,
  resolveStaticFilePath,
} from './douyin-video-storage.service.js';
import { DouyinWorkbenchRepositoryService } from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 克隆音色录音的大小上限（10MB），前端上传前也按它拦。
 * @keyword-cn 录音大小上限, 克隆音色录音
 * @keyword-en voice-sample-limit, voice-clone-sample
 */
export const DOUYIN_VOICE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * @description 百炼声音复刻接受的录音格式（WAV 16bit、MP3、M4A），按扩展名认。
 * @keyword-cn 录音格式, 音频扩展名
 * @keyword-en voice-sample-format, audio-extension
 */
export const DOUYIN_VOICE_SAMPLE_EXTENSIONS: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

/**
 * @description 后台跟进探店分段空镜视频的间隔（15 秒）。
 * @keyword-cn 探店分段轮询间隔, 后台轮询
 * @keyword-en store-visit-segment-poll-interval, background-polling
 */
export const DOUYIN_STORE_VISIT_POLL_MS = 15 * 1000;

/**
 * @description 探店分段空镜视频超过 3 小时未完成判超时；保存中超过 10 分钟可重新认领。
 * @keyword-cn 探店分段超时, 保存中断
 * @keyword-en store-visit-segment-timeout, saving-stale
 */
export const DOUYIN_STORE_VISIT_TASK_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const DOUYIN_STORE_VISIT_SAVING_STALE_MS = 10 * 60 * 1000;

/**
 * @description 配音比画面模型单段最长秒数多出这几秒以内时，合成阶段把画面最后一帧定格补齐；再长就要求拆短。
 * @keyword-cn 定格补齐容差, 单段配音上限
 * @keyword-en freeze-frame-tolerance, segment-audio-limit
 */
export const DOUYIN_STORE_VISIT_FREEZE_TOLERANCE_SECONDS = 3;

/**
 * @description 探店空镜视频默认清晰度：在型号支持的档位里取最接近 720p 的一档。
 * @keyword-cn 空镜视频清晰度, 默认清晰度
 * @keyword-en broll-resolution, default-resolution
 */
export const DOUYIN_STORE_VISIT_VIDEO_RESOLUTION = '720p';

/**
 * @description 系统音色与克隆音色的试听句子。
 * @keyword-cn 音色试听文本, 试听句子
 * @keyword-en voice-preview-text, trial-sentence
 */
export const DOUYIN_STORE_VISIT_PREVIEW_TEXT =
  '大家好，今天带大家去探一家宝藏小店，环境和味道都特别不错，一起来看看吧。';

/**
 * @description 写探店某一段空镜视频的提示词：以场景图为首帧、按画面描述运镜，旁白只用来理解内容，
 *   画面里不要文字、不要有人对镜头说话、不要声音（配音和字幕由桌面端合成时加上）。
 * @keyword-cn 空镜视频提示词, 探店画面
 * @keyword-en broll-video-prompt, store-visit-footage
 * @param {{title: string, sceneDescription?: string, action?: string, lines: string, seconds: number}} input 脚本标题、场景说明、画面描述、本段旁白与秒数。
 * @returns {string} 提示词。
 */
export function buildStoreVisitBrollPrompt(input: {
  title: string;
  sceneDescription?: string;
  action?: string;
  lines: string;
  seconds: number;
}): string {
  return [
    `探店短视频「${input.title}」的空镜画面，竖屏 9:16，时长约 ${input.seconds} 秒。`,
    `以首帧画面为起点：${input.action?.trim() || '镜头缓慢推近，展现门店环境、产品与细节'}。`,
    input.sceneDescription?.trim()
      ? `门店与场景：${input.sceneDescription.trim().slice(0, 300)}`
      : '',
    `这一段的旁白（只用来理解画面内容，不要出现在画面里）：${input.lines.slice(0, 200)}`,
    '要求：真实自然的门店实拍质感，光线明亮，运镜平稳；画面里不要出现任何文字、字幕、水印或 Logo；不要有人对着镜头说话。',
    '【声音】静音，不要人声，不要背景音乐。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 把分段生成失败的原始信息翻成中文：百炼语音的报错按语音规则解释，其余按数眼视频规则解释。
 * @keyword-cn 探店分段失败说明, 报错翻译
 * @keyword-en store-visit-segment-failure, error-translation
 * @param {string} raw 原始报错。
 * @returns {string} 用户可读说明。
 */
export function describeStoreVisitSegmentFailure(raw: string): string {
  const text = String(raw ?? '');
  return /^DASHSCOPE_/.test(text)
    ? describeCosyVoiceFailure(text)
    : describeShuyanVideoFailure(text);
}

/**
 * @description 探店画外音：音色来自百炼 CosyVoice（录音克隆或系统音色），每段台词先配成音，再以这一段的场景图为首帧，
 *   用数眼智能（Seedance / MiniMax-H3）生成同样长的空镜视频；各段出片后桌面端把画面、配音与字幕按顺序拼成成片。
 *   音色走后台「工作流节点模型 · 抖音视频制作 · 音色克隆与配音」节点（百炼提供商），空镜走「探店画面视频」节点（数眼智能）；
 *   分段任务后台每 15 秒跟进一次，完成后转存视频库并绑定到分段。
 * @keyword-cn 探店画外音, 克隆音色, 空镜视频
 * @keyword-en store-visit-voiceover, voice-clone, broll-video
 */
@Injectable()
export class DouyinStoreVisitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DouyinStoreVisitService.name);
  private readonly operations: Collection<DouyinOperationEntity>;
  private timer?: NodeJS.Timeout;
  private polling = false;
  /** @description 试听地址缓存（`模型:音色` → 地址与过期时间），百炼临时地址 24 小时有效，这里只留 20 小时 */
  private readonly previews = new Map<string, { url: string; expiresAt: number }>();

  /**
   * @description 初始化调用集合与音色、存储、计费依赖。
   * @keyword-cn 初始化探店服务, 画外音依赖
   * @keyword-en init-store-visit-service, voiceover-dependencies
   */
  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly billing: AiBillingService,
    private readonly storage: DouyinVideoStorageService,
    private readonly workflowModels: WorkflowModelService,
    private readonly adminService: AdminService,
    private readonly cosyVoice: DouyinCosyVoiceService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
  }

  /**
   * @description 启动分段任务后台轮询，服务重启后继续跟进；多进程时只在 leader 进程上轮询。
   * @keyword-cn 启动探店分段轮询, 重启续跟
   * @keyword-en start-store-visit-polling, resume-after-restart
   */
  onModuleInit(): void {
    if (!isLeaderProcess()) return;
    this.timer = setInterval(
      () => void this.pollOnce(),
      DOUYIN_STORE_VISIT_POLL_MS,
    );
    this.timer.unref?.();
  }

  /**
   * @description 停止分段任务后台轮询。
   * @keyword-cn 停止探店分段轮询, 模块销毁
   * @keyword-en stop-store-visit-polling, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 用一段录音克隆音色：录音临时传到 OSS 拿公网地址交给百炼声音复刻，等审核通过后立即删掉录音；
   *   音色 ID、合成模型与提供商写进脚本，换音色时顺手删掉这条脚本之前克隆的旧音色。每次调用记一条 `voice-clone` 审计（不含录音）。
   * @keyword-cn 克隆探店音色, 上传录音
   * @keyword-en clone-store-visit-voice, upload-voice-sample
   * @param {number} topicId 子选题（脚本）ID。
   * @param {{buffer: Buffer, originalname: string, mimetype: string, size: number}|undefined} file 上传的录音。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 写好音色后的脚本。
   * @throws {BadRequestException} 没有录音、格式不对或超过 10MB。
   * @throws {ServiceUnavailableException} 没配百炼节点或没配 OSS。
   * @throws {BadGatewayException} 克隆失败或审核不通过。
   */
  async cloneVoice(
    topicId: number,
    file:
      | { buffer: Buffer; originalname: string; mimetype: string; size: number }
      | undefined,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    if (!file?.buffer?.length) throw new BadRequestException('请上传一段录音');
    const extension = extname(String(file.originalname ?? '')).toLowerCase();
    const contentType = DOUYIN_VOICE_SAMPLE_EXTENSIONS[extension];
    if (!contentType)
      throw new BadRequestException(
        '录音格式不支持，请上传 mp3、wav 或 m4a 音频文件',
      );
    if (file.size > DOUYIN_VOICE_SAMPLE_MAX_BYTES)
      throw new BadRequestException(
        '录音不能超过 10MB，截一段 10～20 秒的清晰人声即可',
      );
    const topic = await this.requireChild(topicId, scope);
    const runtime = await this.readVoiceRuntime();
    if (!this.storage.hasPublicStorage())
      throw new ServiceUnavailableException(
        '克隆音色需要先在后台配置视频库 OSS（录音要临时传到 OSS 交给百炼）',
      );
    const targetModel = /^cosyvoice/i.test(runtime.model)
      ? runtime.model
      : COSYVOICE_CLONE_MODEL;
    const sample = {
      name: String(file.originalname || `voice${extension}`).slice(0, 200),
      contentType,
      sizeBytes: file.size,
    };
    const now = new Date();
    const base = {
      _id: new ObjectId(),
      id: randomUUID(),
      operation: 'voice-clone' as const,
      topicId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      provider: 'dashscope' as const,
      providerId: runtime.providerId,
      model: targetModel,
      request: { audioFileName: sample.name, audioContentType: contentType },
      createdAt: now,
      updatedAt: now,
    };
    const uploaded = await this.storage.saveAudio(file.buffer, {
      scope,
      fileName: `voice-sample${extension}`,
      contentType,
    });
    let voiceId = '';
    try {
      voiceId = await this.cosyVoice.createVoice(runtime, {
        targetModel,
        prefix: buildCosyVoicePrefix(topicId),
        audioUrl: uploaded.url,
      });
      await this.cosyVoice.waitVoiceReady(runtime, voiceId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (voiceId) await this.cosyVoice.deleteVoice(runtime, voiceId);
      await this.operations.insertOne({
        ...base,
        status: 'failed',
        error: describeCosyVoiceFailure(detail),
        errorDetail: detail,
      });
      throw new BadGatewayException(describeCosyVoiceFailure(detail));
    } finally {
      if (uploaded.key) await this.storage.deleteAudio(uploaded.key);
    }
    await this.operations.insertOne({
      ...base,
      status: 'completed',
      result: { voiceId },
    });
    const previous = topic.storeVisit;
    if (
      previous?.voiceSource === 'clone' &&
      previous.voiceId &&
      previous.voiceId !== voiceId &&
      previous.voiceProviderId === runtime.providerId
    )
      await this.cosyVoice.deleteVoice(runtime, previous.voiceId);
    const updated = await this.repository.saveStoreVisitVoice(
      topicId,
      {
        voiceSource: 'clone',
        voiceName: sample.name,
        voiceId,
        voiceProviderId: runtime.providerId,
        voiceModel: targetModel,
        voiceSample: { ...sample, uploadedAt: now },
      },
      scope,
    );
    if (!updated) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return updated;
  }

  /**
   * @description 列出探店可选的百炼系统音色。
   * @keyword-cn 系统音色列表, 探店音色库
   * @keyword-en list-preset-voices, store-visit-voice-library
   * @returns {readonly CosyVoicePresetVoice[]} 音色目录。
   */
  listPresetVoices(): readonly CosyVoicePresetVoice[] {
    return COSYVOICE_PRESET_VOICES;
  }

  /**
   * @description 选用一个百炼系统音色作为这条脚本的音色（合成模型固定为 `COSYVOICE_PRESET_MODEL`），清掉克隆录音信息。
   * @keyword-cn 选用系统音色, 保存预置音色
   * @keyword-en use-preset-voice, save-preset-voice
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} voiceId 系统音色 ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 更新后的脚本。
   * @throws {BadRequestException} 音色不在目录里或脚本不存在。
   */
  async usePresetVoice(
    topicId: number,
    voiceId: string,
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const voice = COSYVOICE_PRESET_VOICES.find(
      (item) => item.voiceId === voiceId,
    );
    if (!voice) throw new BadRequestException('这个音色不在可选音色里');
    await this.requireChild(topicId, scope);
    const runtime = await this.readVoiceRuntime();
    const updated = await this.repository.saveStoreVisitVoice(
      topicId,
      {
        voiceSource: 'preset',
        voiceName: `${voice.voiceName} · ${voice.trait}`,
        voiceId: voice.voiceId,
        voiceProviderId: runtime.providerId,
        voiceModel: COSYVOICE_PRESET_MODEL,
      },
      scope,
    );
    if (!updated) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return updated;
  }

  /**
   * @description 合成一句试听：系统音色直接合成；其他音色只允许这条脚本自己克隆的音色，并用它绑定的模型合成。结果缓存 20 小时。
   * @keyword-cn 音色试听, 合成试听
   * @keyword-en preview-voice, synthesize-trial
   * @param {number} topicId 子选题（脚本）ID。
   * @param {string} voiceId 要试听的音色 ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<{url: string}>} 试听音频地址。
   * @throws {BadRequestException} 音色既不是系统音色也不是这条脚本的克隆音色。
   * @throws {BadGatewayException} 合成失败。
   */
  async previewVoice(
    topicId: number,
    voiceId: string,
    scope: DouyinScope,
  ): Promise<{ url: string }> {
    const topic = await this.requireChild(topicId, scope);
    const preset = COSYVOICE_PRESET_VOICES.some(
      (item) => item.voiceId === voiceId,
    );
    const own =
      topic.storeVisit?.voiceSource === 'clone' &&
      topic.storeVisit.voiceId === voiceId;
    if (!preset && !own)
      throw new BadRequestException('只能试听系统音色或这条脚本克隆的音色');
    const model = preset
      ? COSYVOICE_PRESET_MODEL
      : String(topic.storeVisit?.voiceModel || COSYVOICE_CLONE_MODEL);
    const cacheKey = `${model}:${voiceId}`;
    const cached = this.previews.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { url: cached.url };
    const runtime = preset
      ? await this.readVoiceRuntime()
      : await this.readVoiceRuntimeFor(topic.storeVisit?.voiceProviderId);
    try {
      const { url } = await this.cosyVoice.synthesizePreview(runtime, {
        model,
        voice: voiceId,
        text: DOUYIN_STORE_VISIT_PREVIEW_TEXT,
      });
      this.previews.set(cacheKey, {
        url,
        expiresAt: Date.now() + 20 * 60 * 60 * 1000,
      });
      return { url };
    } catch (error) {
      throw new BadGatewayException(
        describeCosyVoiceFailure(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  /**
   * @description 生成这条脚本的全部分段（画外音配音 + 空镜视频），返回各段调用记录。
   * @keyword-cn 提交探店视频, 全部分段生成
   * @keyword-en submit-store-visit-video, generate-all-segments
   * @param {number} topicId 子选题（脚本）ID。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<{operations: DouyinOperationView[]}>} 各段调用记录。
   * @throws {BadRequestException} 还没分段。
   */
  async start(
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
    const segment = (topic.storeVisit?.segments ?? []).find(
      (item) => item.id === segmentId,
    );
    if (!segment)
      throw new BadRequestException('这一段还没保存或已被删除，请先保存台词');
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
                $lt: new Date(Date.now() - DOUYIN_STORE_VISIT_SAVING_STALE_MS),
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
   * @description 校验并提交若干段：要有场景图、每段选了场景、选好音色、两个节点都配好、没有段在生成；
   *   先清掉这些段的旧成片、打上自动合成标记，再逐段配音并提交空镜视频。全部失败时抛出第一个错误。
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
    const setting = topic.storeVisit ?? {};
    const all = setting.segments ?? [];
    const indexOf = (segment: DouyinStoreVisitSegment) =>
      all.findIndex((item) => item.id === segment.id) + 1;
    const scenes = new Map(
      (setting.sceneImages ?? []).map((image) => [image.id, image]),
    );
    if (!scenes.size)
      throw new BadRequestException('先在「场景」步骤上传至少一张场景图');
    const noScene = segments.filter(
      (segment) => !segment.sceneImageId || !scenes.has(segment.sceneImageId),
    );
    if (noScene.length)
      throw new BadRequestException(
        `第 ${noScene.map(indexOf).join('、')} 段还没选场景图`,
      );
    const voiceId = String(setting.voiceId ?? '').trim();
    const voiceModel = String(setting.voiceModel ?? '').trim();
    if (!voiceId || !voiceModel || !setting.voiceSource)
      throw new BadRequestException('先在「音色」步骤克隆或选一个音色');
    const voiceRuntime =
      setting.voiceSource === 'preset'
        ? await this.readVoiceRuntime()
        : await this.readVoiceRuntimeFor(setting.voiceProviderId);
    const videoRuntime = await this.readVideoRuntime();
    const route = resolveShuyanVideoRoute(videoRuntime.model) as ShuyanVideoRoute;
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
        null,
        scope,
      );
    }
    await this.repository.update(topic.id, { autoConcatShots: true }, scope);
    const views: DouyinOperationView[] = [];
    let firstError: Error | undefined;
    for (const segment of segments) {
      try {
        views.push(
          await this.submitSegment({
            topic,
            segment,
            index: indexOf(segment),
            sceneUrl: String(scenes.get(Number(segment.sceneImageId))?.url ?? ''),
            voice: { voiceId, model: voiceModel, runtime: voiceRuntime },
            videoRuntime,
            route,
            scope,
          }),
        );
      } catch (error) {
        firstError ??=
          error instanceof Error ? error : new Error(String(error ?? '提交失败'));
      }
    }
    if (!views.length && firstError) throw firstError;
    return views;
  }

  /**
   * @description 提交一段：按 `video-generation` 扣费 → 百炼配音（WAV，校验时长不超过画面上限 + 定格容差）→ 配音存储 →
   *   以场景图为首帧提交数眼空镜视频（时长取配音秒数向上取整再收敛到型号范围），写排队中的调用记录；任一步失败退款并写失败记录。
   * @keyword-cn 提交单段画外音, 分段配音
   * @keyword-en submit-segment-voiceover, segment-broll
   * @param input 脚本、分段及序号、场景图地址、音色、视频节点运行配置、路由与作用域。
   * @returns {Promise<DouyinOperationView>} 调用记录。
   * @throws {BadRequestException} 配音太长。
   * @throws {BadGatewayException} 配音、存储或提交失败。
   */
  private async submitSegment(input: {
    topic: DouyinTopicEntity;
    segment: DouyinStoreVisitSegment;
    index: number;
    sceneUrl: string;
    voice: { voiceId: string; model: string; runtime: DashScopeRuntime };
    videoRuntime: WorkflowNodeRuntime;
    route: ShuyanVideoRoute;
    scope: DouyinScope;
  }): Promise<DouyinOperationView> {
    const { topic, segment, videoRuntime, route, scope } = input;
    const operationId = randomUUID();
    const request: Record<string, unknown> = {
      segmentId: segment.id,
      segmentIndex: input.index,
      lines: segment.lines,
      action: segment.action ?? '',
      sceneImageId: segment.sceneImageId,
      voiceId: input.voice.voiceId,
      voiceModel: input.voice.model,
    };
    const base = {
      operation: 'generate' as const,
      topicId: topic.id,
      segmentId: segment.id,
      provider: 'shuyan' as const,
      mode: 'store-visit' as const,
      model: videoRuntime.model,
      providerId: videoRuntime.providerId,
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
      const speech = await this.cosyVoice.synthesize(input.voice.runtime, {
        model: input.voice.model,
        voice: input.voice.voiceId,
        text: segment.lines,
      });
      const choices = listShuyanVideoDurationChoices(videoRuntime.model);
      const maxSeconds = choices[choices.length - 1];
      if (
        speech.seconds >
        maxSeconds + DOUYIN_STORE_VISIT_FREEZE_TOLERANCE_SECONDS
      )
        throw new BadRequestException(
          `第 ${input.index} 段配音约 ${Math.round(speech.seconds)} 秒，超过单段画面上限 ${maxSeconds} 秒，请把这段拆短`,
        );
      const audio = await this.storage.saveAudio(speech.buffer, {
        scope,
        fileName: 'voiceover.wav',
        contentType: 'audio/wav',
      });
      const seconds = clampShuyanVideoDuration(
        videoRuntime.model,
        Math.ceil(speech.seconds),
      );
      const resolution = clampShuyanVideoResolution(
        videoRuntime.model,
        DOUYIN_STORE_VISIT_VIDEO_RESOLUTION,
      );
      Object.assign(request, {
        audioUrl: audio.url,
        audioSeconds: speech.seconds,
        characters: speech.characters,
        duration: seconds,
        resolution,
      });
      const content = [
        {
          type: 'text',
          text: buildStoreVisitBrollPrompt({
            title: topic.title,
            sceneDescription: topic.storeVisit?.sceneDescription,
            action: segment.action,
            lines: segment.lines,
            seconds,
          }),
        },
        {
          type: 'image_url',
          image_url: { url: await this.toVideoImageUrl(input.sceneUrl) },
          role: 'first_frame',
        },
      ];
      // MiniMax-H3 带首帧时宽高比由图片决定、没有声音开关；Seedance 关掉声音，合成时用配音替换
      const payload =
        route === 'hailuo-v2'
          ? {
              model: normalizeShuyanVideoModel(videoRuntime.model),
              content,
              resolution,
              duration: seconds,
              ratio: 'adaptive',
              aigc_watermark: false,
            }
          : {
              model: videoRuntime.model,
              content,
              resolution,
              ratio: '9:16',
              duration: seconds,
              generate_audio: false,
              watermark: false,
            };
      const task = unwrapShuyanVideoTask(
        await this.fetchShuyan(
          resolveShuyanVideoTaskUrl(
            resolveShuyanVideoGateway(videoRuntime.baseUrl),
            route,
          ),
          { method: 'POST', body: JSON.stringify(payload) },
          videoRuntime.apiKey,
        ),
      );
      const externalId = String(task.id ?? task.task_id ?? '').trim();
      if (!externalId) throw new Error('SHUYAN_VIDEO_TASK_ID_MISSING');
      const doc: DouyinOperationEntity = {
        _id: new ObjectId(),
        id: operationId,
        ...base,
        request,
        status: 'queued',
        progress: 0,
        externalId,
        result: task,
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
   * @description 按调用记录上的提供商查一次分段空镜任务并推进：失败写原因，超时判失败，完成时认领保存权、转存视频库，
   *   连同这段的配音一起绑定到分段；生成期间台词、场景、画面描述或音色被改过时不绑定，免得旧内容混进成片。
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
    const route = resolveShuyanVideoRoute(row.model ?? '') ?? 'seedance';
    const task = unwrapShuyanVideoTask(
      await this.fetchShuyan(
        resolveShuyanVideoTaskUrl(
          resolveShuyanVideoGateway(provider.baseUrl),
          route,
          row.externalId,
        ),
        { method: 'GET' },
        provider.apiKey,
      ),
    );
    const status = mapShuyanVideoStatus(task.status);
    const index = Number(row.request?.segmentIndex) || 0;
    if (status === 'failed') {
      await this.fail(
        row.id,
        `第 ${index} 段空镜视频生成失败：${describeShuyanVideoError(task)}`,
        JSON.stringify(task.error ?? { status: task.status }).slice(0, 2000),
      );
      return;
    }
    if (status !== 'completed') {
      if (
        Date.now() - new Date(row.createdAt).getTime() >
        DOUYIN_STORE_VISIT_TASK_TIMEOUT_MS
      ) {
        await this.fail(row.id, '这段空镜视频超过 3 小时仍未完成，已判定超时。');
        return;
      }
      await this.operations.updateOne(
        { id: row.id, status: { $in: ['queued', 'running'] } },
        {
          $set: {
            status,
            progress: status === 'running' ? 50 : 0,
            result: task,
            updatedAt: new Date(),
          },
        },
      );
      return;
    }
    const claimed = await this.operations.findOneAndUpdate(
      {
        id: row.id,
        $or: [
          { status: { $in: ['queued', 'running'] } },
          {
            status: 'saving',
            updatedAt: {
              $lt: new Date(Date.now() - DOUYIN_STORE_VISIT_SAVING_STALE_MS),
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
      const videoUrl = String(
        task.content?.video_url ?? task.content?.url ?? '',
      ).trim();
      if (!videoUrl) throw new Error('SHUYAN_VIDEO_RESULT_URL_MISSING');
      const topic = await this.repository.get(row.topicId, scope);
      const saved = await this.storage.saveRemote(videoUrl, {
        name: `${topic?.title ?? `脚本 ${row.topicId}`} 探店第 ${index} 段`,
        scope,
        tags: ['抖音探店空镜', 'AI生成', '数眼智能'],
        durationSeconds: Number(task.duration) || Number(row.request?.duration),
      });
      const segment = (topic?.storeVisit?.segments ?? []).find(
        (item) => item.id === row.segmentId,
      );
      const audioUrl = String(row.request?.audioUrl ?? '');
      const voiceId = String(row.request?.voiceId ?? '');
      const stale =
        !segment ||
        !audioUrl ||
        segment.lines !== row.request?.lines ||
        segment.sceneImageId !== row.request?.sceneImageId ||
        (segment.action ?? '') !== (row.request?.action ?? '') ||
        topic?.storeVisit?.voiceId !== voiceId;
      if (!stale && row.segmentId) {
        await this.repository.updateStoreVisitSegment(
          row.topicId,
          row.segmentId,
          {
            videoId: saved.id,
            audioUrl,
            audioSeconds: Number(row.request?.audioSeconds) || 0,
            voiceId,
          },
          scope,
        );
      }
      await this.operations.updateOne(
        { id: row.id },
        {
          $set: {
            status: 'completed',
            progress: 100,
            result: { ...task, videoId: saved.id, videoUrl: saved.url },
            ...(stale
              ? {
                  error:
                    '空镜已存入视频库，但这段的台词、场景或音色在生成期间改过，没有绑定到分段。',
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
        '这段空镜视频转存失败，请稍后同步状态重试。',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * @description 读取「音色克隆与配音」节点的百炼运行配置：没指定、不是百炼或没填 Key 时用中文说明拒绝。
   * @keyword-cn 读取百炼节点配置, 缺配置拒绝
   * @keyword-en read-dashscope-runtime, reject-unconfigured
   * @returns {Promise<WorkflowNodeRuntime>} 运行配置。
   * @throws {ServiceUnavailableException} 节点不可用。
   */
  private async readVoiceRuntime(): Promise<WorkflowNodeRuntime> {
    let runtime: WorkflowNodeRuntime | null;
    try {
      runtime = await this.workflowModels.resolveNodeRuntime(
        WORKFLOW_NODES.douyinWorkbench.key,
        WORKFLOW_NODES.douyinWorkbench.voiceClone,
      );
    } catch {
      runtime = null;
    }
    if (
      !runtime ||
      String(runtime.providerCode).toLowerCase() !== DASHSCOPE_PROVIDER_CODE
    )
      throw new ServiceUnavailableException(
        '后台「工作流节点模型 · 抖音视频制作 · 音色克隆与配音」还没有选阿里云百炼（dashscope）提供商',
      );
    if (!String(runtime.apiKey ?? '').trim())
      throw new ServiceUnavailableException(
        '阿里云百炼的 API Key 还没有配置，请到后台「Ai提供商设置」里填写',
      );
    return runtime;
  }

  /**
   * @description 克隆音色属于克隆时那个百炼账号：优先用音色记录上的提供商取 Key，提供商已删除时退回节点当前的提供商。
   * @keyword-cn 读取音色所属提供商, 克隆音色账号
   * @keyword-en read-voice-owner-runtime, cloned-voice-account
   * @param {string} [providerId] 音色记录上的提供商 ID。
   * @returns {Promise<DashScopeRuntime>} 百炼地址与 Key。
   */
  private async readVoiceRuntimeFor(
    providerId?: string,
  ): Promise<DashScopeRuntime> {
    const owner = providerId
      ? await this.adminService.getAiProviderRuntimeById(providerId)
      : null;
    if (owner && String(owner.apiKey ?? '').trim()) return owner;
    return await this.readVoiceRuntime();
  }

  /**
   * @description 读取「探店画面视频」节点的数眼运行配置：没指定、不是数眼智能、型号没有接入原生路由或没填 Key 时用中文说明拒绝。
   * @keyword-cn 读取探店画面节点, 缺配置拒绝
   * @keyword-en read-broll-runtime, reject-unconfigured
   * @returns {Promise<WorkflowNodeRuntime>} 运行配置。
   * @throws {ServiceUnavailableException} 节点不可用。
   */
  private async readVideoRuntime(): Promise<WorkflowNodeRuntime> {
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
        '后台「工作流节点模型 · 抖音视频制作 · 探店画面视频」还没有选数眼智能',
      );
    if (!resolveShuyanVideoRoute(runtime.model))
      throw new ServiceUnavailableException(
        `「探店画面视频」节点的模型「${runtime.model}」还没接入，请改选 Seedance 或 MiniMax-H3 型号`,
      );
    if (!String(runtime.apiKey ?? '').trim())
      throw new ServiceUnavailableException(
        '数眼智能的 API Key 还没有配置，请到后台「Ai提供商设置」里填写',
      );
    return runtime;
  }

  /**
   * @description 场景图入参：公网地址原样给数眼，站内 `/static` 图片读文件转成 data URL（Seedance 与 MiniMax-H3 都接受）。
   * @keyword-cn 场景图入参, 本地图片Base64
   * @keyword-en scene-image-input, local-image-data-url
   * @param {string} url 图库地址。
   * @returns {Promise<string>} 公网地址或 data URL。
   * @throws {BadRequestException} 地址无效。
   */
  private async toVideoImageUrl(url: string): Promise<string> {
    const clean = String(url ?? '').trim();
    if (/^https?:\/\//i.test(clean) || /^data:image\//i.test(clean)) return clean;
    const filePath = resolveStaticFilePath(clean);
    if (!filePath) throw new BadRequestException('场景图地址无效');
    const extension = extname(clean.split('?')[0]).toLowerCase();
    const contentType =
      extension === '.png'
        ? 'image/png'
        : extension === '.webp'
          ? 'image/webp'
          : 'image/jpeg';
    return `data:${contentType};base64,${(await readFile(filePath)).toString('base64')}`;
  }

  /**
   * @description 发起带 Bearer 与超时（5 分钟）的数眼 JSON 请求；非 2xx 抛 `SHUYAN_VIDEO_HTTP_<状态码>`，保留对端报错供排查。
   * @keyword-cn 数眼探店请求, 错误体保留
   * @keyword-en shuyan-store-visit-request, preserve-error-body
   * @param {string} url 接口地址。
   * @param {RequestInit} init fetch 参数。
   * @param {string} [apiKey] 数眼 Key。
   * @returns {Promise<ShuyanVideoTask>} 任务响应。
   */
  private async fetchShuyan(
    url: string,
    init: RequestInit,
    apiKey?: string,
  ): Promise<ShuyanVideoTask> {
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
    let data: ShuyanVideoTask = {};
    try {
      data = text ? (JSON.parse(text) as ShuyanVideoTask) : {};
    } catch {
      data = { error: { message: text.slice(0, 1000) } };
    }
    if (!response.ok)
      throw new Error(
        `SHUYAN_VIDEO_HTTP_${response.status}:${JSON.stringify(data).slice(0, 2000)}`,
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
