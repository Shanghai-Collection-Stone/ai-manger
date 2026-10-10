import {
  BadGatewayException,
  BadRequestException,
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
import { WORKFLOW_NODES } from '../../workflow-model/entities/workflow-model.entity.js';
import { isShuyanProvider } from '../../workflow-model/services/shuyan-model-catalog.js';
import { WorkflowModelService } from '../../workflow-model/services/workflow-model.service.js';
import type {
  DouyinMediaReference,
  DouyinOperationEntity,
  DouyinOperationView,
  DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import { DouyinStoreVisitShuyanService } from './douyin-store-visit-shuyan.service.js';
import {
  DouyinVideoStorageService,
  resolveStaticFilePath,
} from './douyin-video-storage.service.js';
import {
  DouyinWorkbenchRepositoryService,
  normalizeStoreVisitLines,
  normalizeVideoAudio,
} from './douyin-workbench-repository.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 探店克隆、设计与视频能力的提供商运行配置（来自后台「Ai提供商设置」+「工作流节点模型」）。
 * @keyword-cn 探店提供商配置, 节点运行配置
 * @keyword-en store-visit-provider-runtime, node-runtime
 */
export interface DouyinStoreVisitRuntime {
  providerId: string;
  providerName: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

/**
 * @description 通用数字人服务的提供商代码：在「Ai提供商设置」里按类别各建一条——音色克隆模型（audio）给「音色克隆」节点，
 *   生视频模型（video）给「探店数字人视频」节点；服务地址指向按本契约实现的服务，具体厂商由那个服务对接。
 * @keyword-cn 数字人提供商代码, 通用契约
 * @keyword-en digital-human-provider-code, generic-contract
 */
export const DIGITAL_HUMAN_PROVIDER_CODE = 'digital-human';

/**
 * @description 通用数字人服务契约的固定路径（拼在提供商服务地址后面）：克隆或设计音色、提交数字人任务、查询任务（`{id}` 为任务 ID）。
 * @keyword-cn 数字人契约路径, 服务地址拼接
 * @keyword-en digital-human-contract-paths, base-url-join
 */
export const DIGITAL_HUMAN_PATHS = {
  voiceClone: '/voice-clone',
  voiceDesign: '/voice-design',
  submitTask: '/digital-human/tasks',
  queryTask: '/digital-human/tasks/{id}',
} as const;

/**
 * @description 把契约路径拼到提供商服务地址后面（去掉多余斜杠，`{id}` 按需替换并编码）。
 * @keyword-cn 拼接契约地址, 服务地址拼接
 * @keyword-en build-contract-url, base-url-join
 * @param {string} baseUrl 提供商服务地址。
 * @param {string} path 契约路径。
 * @param {string} [id] 任务 ID。
 * @returns {string} 完整地址。
 */
export function buildDigitalHumanUrl(
  baseUrl: string,
  path: string,
  id?: string,
): string {
  const resolved = id ? path.replace('{id}', encodeURIComponent(id)) : path;
  return `${String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')}${resolved}`;
}

/**
 * @description 后台跟进数字人生视频任务的间隔（15 秒）。
 * @keyword-cn 数字人轮询间隔, 后台轮询
 * @keyword-en digital-human-poll-interval, background-polling
 */
export const DOUYIN_DIGITAL_HUMAN_POLL_MS = 15 * 1000;

/**
 * @description 数字人任务超过 2 小时未结束判为超时；保存中超过 10 分钟可重新认领。
 * @keyword-cn 数字人任务超时, 保存中断
 * @keyword-en digital-human-task-timeout, saving-stale
 */
export const DOUYIN_DIGITAL_HUMAN_TASK_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DOUYIN_DIGITAL_HUMAN_SAVING_STALE_MS = 10 * 60 * 1000;

/**
 * @description 克隆音色录音的大小上限（10MB），前端上传前也按它拦。
 * @keyword-cn 录音大小上限, 克隆音色录音
 * @keyword-en voice-sample-limit, voice-clone-sample
 */
export const DOUYIN_VOICE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * @description 浏览器没给出 `audio/*` 类型时按扩展名认可的录音格式。
 * @keyword-cn 录音格式, 音频扩展名
 * @keyword-en voice-sample-format, audio-extension
 */
export const DOUYIN_VOICE_SAMPLE_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.webm',
  '.flac',
];

/**
 * @description 探店模式一次最多带给数字人服务的场景参考图（分镜画面）张数。
 * @keyword-cn 场景参考图上限, 分镜画面
 * @keyword-en scene-image-limit, storyboard-frame
 */
export const DOUYIN_STORE_VISIT_SCENE_IMAGE_LIMIT = 4;

/**
 * @description 把直连服务五花八门的状态值收成工作台统一的 queued / running / completed / failed，认不出的按生成中处理。
 * @keyword-cn 数字人状态映射, 直连状态归一
 * @keyword-en map-digital-human-status, direct-status-normalize
 * @param {unknown} status 对端状态值。
 * @returns {'queued'|'running'|'completed'|'failed'} 统一状态。
 */
export function mapDigitalHumanStatus(
  status: unknown,
): 'queued' | 'running' | 'completed' | 'failed' {
  const value = String(status ?? '')
    .trim()
    .toLowerCase();
  if (
    [
      'queued',
      'pending',
      'submitted',
      'accepted',
      'waiting',
      'created',
    ].includes(value)
  )
    return 'queued';
  if (
    [
      'succeeded',
      'success',
      'completed',
      'complete',
      'done',
      'finished',
    ].includes(value)
  )
    return 'completed';
  if (
    [
      'failed',
      'failure',
      'error',
      'canceled',
      'cancelled',
      'aborted',
      'expired',
    ].includes(value)
  )
    return 'failed';
  return 'running';
}

/**
 * @description 从直连服务响应里按候选字段名顺序找值，每个字段名依次查顶层、`data`、`result`、`output`，返回第一个非空值。
 * @keyword-cn 读取响应字段, 多层兜底
 * @keyword-en read-response-field, nested-fallback
 * @param {Record<string, unknown>} response 对端响应。
 * @param {string[]} keys 候选字段名。
 * @returns {string} 找到的值，没有时为空串。
 */
export function readDirectField(
  response: Record<string, unknown>,
  keys: string[],
): string {
  const layers = [
    response,
    response.data,
    response.result,
    response.output,
  ].filter(
    (layer): layer is Record<string, unknown> =>
      Boolean(layer) && typeof layer === 'object',
  );
  /* 字段名优先于层级：先在各层找第一个候选名，再找第二个，避免顶层的请求 ID 抢在 data.voiceId 前面 */
  for (const key of keys) {
    for (const layer of layers) {
      const value = layer[key];
      if (
        (typeof value === 'string' && value.trim()) ||
        typeof value === 'number'
      )
        return String(value).trim();
    }
  }
  return '';
}

/**
 * @description 探店模式：直接使用声音提示词，或录音克隆及可选文字生成固定音色，再按人物、声音与台词提交数字人视频。
 *   三项能力都在后台「Ai提供商设置」里配（提供商代码 `digital-human`，按 `DIGITAL_HUMAN_PATHS` 契约实现），
 *   再到「工作流节点模型 · 抖音视频制作」为「音色克隆」「声音设计」「探店数字人视频」节点指定；
 *   数字人任务后台每 15 秒按任务记录上的提供商跟进，完成后成片转存视频库并设为脚本当前成片。
 * @keyword-cn 探店模式, 克隆音色, 数字人生视频
 * @keyword-en store-visit-mode, voice-clone, digital-human-video
 */
@Injectable()
export class DouyinStoreVisitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DouyinStoreVisitService.name);
  private readonly operations: Collection<DouyinOperationEntity>;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly billing: AiBillingService,
    private readonly storage: DouyinVideoStorageService,
    private readonly workflowModels: WorkflowModelService,
    private readonly adminService: AdminService,
    private readonly shuyanSegments: DouyinStoreVisitShuyanService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
  }

  /**
   * @description 启动数字人任务后台轮询，服务重启后继续跟进；多进程时只在 leader 进程上轮询。
   * @keyword-cn 启动数字人轮询, 重启续跟
   * @keyword-en start-digital-human-polling, resume-after-restart
   */
  onModuleInit(): void {
    if (!isLeaderProcess()) return;
    this.timer = setInterval(
      () => void this.pollOnce(),
      DOUYIN_DIGITAL_HUMAN_POLL_MS,
    );
    this.timer.unref?.();
  }

  /**
   * @description 停止数字人任务后台轮询。
   * @keyword-cn 停止数字人轮询, 模块销毁
   * @keyword-en stop-digital-human-polling, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 用一段录音克隆音色：校验格式与大小后把录音（base64）交给克隆服务，拿到音色 ID 写进脚本的探店设置；录音本身不落盘。
   *   每次调用都记一条 `voice-clone` 审计（不含录音内容）。
   * @keyword-cn 克隆探店音色, 上传录音
   * @keyword-en clone-store-visit-voice, upload-voice-sample
   * @param {number} topicId 子选题（脚本）ID。
   * @param {{buffer: Buffer, originalname: string, mimetype: string, size: number}|undefined} file 上传的录音。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinTopicEntity>} 写好音色后的脚本。
   * @throws {BadRequestException} 没有录音、格式不对或超过 10MB。
   * @throws {ServiceUnavailableException} 「音色克隆」节点没指定提供商。
   * @throws {BadGatewayException} 克隆服务失败或没返回音色 ID。
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
    const mimetype = String(file.mimetype ?? '').toLowerCase();
    if (
      !mimetype.startsWith('audio/') &&
      !DOUYIN_VOICE_SAMPLE_EXTENSIONS.includes(extension)
    )
      throw new BadRequestException(
        '录音格式不支持，请上传 mp3、wav、m4a 等音频文件',
      );
    if (file.size > DOUYIN_VOICE_SAMPLE_MAX_BYTES)
      throw new BadRequestException(
        '录音不能超过 10MB，截一段 10～60 秒的清晰人声即可',
      );
    const topic = await this.requireChild(topicId, scope);
    const runtime = await this.readNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.voiceClone,
      '音色克隆',
    );
    const sample = {
      name: String(file.originalname || `voice${extension || '.mp3'}`).slice(
        0,
        200,
      ),
      contentType: mimetype || 'audio/mpeg',
      sizeBytes: file.size,
    };
    const request = {
      model: runtime.model,
      topicId,
      name: `${topic.title}·探店音色`.slice(0, 60),
      language: normalizeVideoAudio(topic.videoAudio).language,
      audioFileName: sample.name,
      audioContentType: sample.contentType,
    };
    const operationId = randomUUID();
    const now = new Date();
    const base = {
      _id: new ObjectId(),
      id: operationId,
      operation: 'voice-clone' as const,
      topicId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      provider: 'digital-human' as const,
      providerId: runtime.providerId,
      model: runtime.model,
      request,
      createdAt: now,
      updatedAt: now,
    };
    let response: Record<string, unknown>;
    try {
      response = await this.fetchJson(
        buildDigitalHumanUrl(runtime.baseUrl, DIGITAL_HUMAN_PATHS.voiceClone),
        {
          method: 'POST',
          body: JSON.stringify({
            operationId,
            ...request,
            audioBase64: file.buffer.toString('base64'),
          }),
        },
        runtime.apiKey,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.operations.insertOne({
        ...base,
        status: 'failed',
        error: '音色克隆失败',
        errorDetail: detail,
      });
      throw new BadGatewayException(`音色克隆失败：${detail}`);
    }
    const voiceId = readDirectField(response, [
      'voiceId',
      'voice_id',
      'speakerId',
      'speaker_id',
      'id',
    ]);
    await this.operations.insertOne({
      ...base,
      status: voiceId ? 'completed' : 'failed',
      result: response,
      ...(voiceId ? {} : { error: '音色克隆服务没有返回音色 ID' }),
    });
    if (!voiceId) throw new BadGatewayException('音色克隆服务没有返回音色 ID');
    const updated = await this.repository.saveStoreVisitVoice(
      topicId,
      {
        voiceSource: 'clone',
        voiceName: sample.name,
        voiceId,
        voiceProviderId: runtime.providerId,
        voiceModel: runtime.model,
        voiceSample: { ...sample, uploadedAt: now },
      },
      scope,
    );
    if (!updated) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return updated;
  }

  /**
   * @description 通过声音设计节点按文字描述创建音色，成功后保存来源与试听，失败时保留原音色并记录审计。
   * @keyword-cn 设计探店音色, 文字声音设计
   * @keyword-en design-store-visit-voice, text-voice-design
   */
  async designVoice(
    topicId: number,
    input: { description: string; name?: string; previewText?: string },
    scope: DouyinScope,
  ): Promise<DouyinTopicEntity> {
    const description = String(input.description ?? '').trim();
    const name = String(input.name ?? '').trim();
    const previewText =
      input.previewText === undefined
        ? '你好，今天带大家来探店，看看这里有哪些值得推荐的招牌好物。'
        : String(input.previewText).trim();
    if (description.length < 10 || description.length > 1000)
      throw new BadRequestException('声音描述需要 10～1000 个字');
    if (name.length > 60)
      throw new BadRequestException('音色名称不能超过 60 个字');
    if (previewText.length < 10 || previewText.length > 300)
      throw new BadRequestException('试听文本需要 10～300 个字');
    const topic = await this.requireChild(topicId, scope);
    const runtime = await this.readNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.voiceDesign,
      '声音设计',
    );
    const request = {
      model: runtime.model,
      topicId,
      name: name || `${topic.title}·设计音色`.slice(0, 60),
      description,
      previewText,
      language: normalizeVideoAudio(topic.videoAudio).language,
    };
    const operationId = randomUUID();
    const now = new Date();
    const base = {
      _id: new ObjectId(),
      id: operationId,
      operation: 'voice-design' as const,
      topicId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      provider: 'digital-human' as const,
      providerId: runtime.providerId,
      model: runtime.model,
      request,
      createdAt: now,
      updatedAt: now,
    };
    let response: Record<string, unknown>;
    try {
      response = await this.fetchJson(
        buildDigitalHumanUrl(runtime.baseUrl, DIGITAL_HUMAN_PATHS.voiceDesign),
        { method: 'POST', body: JSON.stringify({ operationId, ...request }) },
        runtime.apiKey,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.operations.insertOne({
        ...base,
        status: 'failed',
        error: '声音设计失败',
        errorDetail: detail,
      });
      throw new BadGatewayException(`声音设计失败：${detail}`);
    }
    const voiceId = readDirectField(response, [
      'voiceId',
      'voice_id',
      'speakerId',
      'speaker_id',
    ]);
    await this.operations.insertOne({
      ...base,
      status: voiceId ? 'completed' : 'failed',
      result: response,
      ...(voiceId ? {} : { error: '声音设计服务没有返回音色 ID' }),
    });
    if (!voiceId) throw new BadGatewayException('声音设计服务没有返回音色 ID');
    const previewUrl = readDirectField(response, [
      'previewUrl',
      'preview_url',
      'audioUrl',
      'audio_url',
    ]);
    const updated = await this.repository.saveStoreVisitVoice(
      topicId,
      {
        voiceSource: 'design',
        voiceName: request.name,
        voiceDescription: description,
        voicePreviewText: previewText,
        voicePreviewUrl: /^https?:\/\/\S+$/i.test(previewUrl)
          ? previewUrl
          : undefined,
        voiceId,
        voiceProviderId: runtime.providerId,
        voiceModel: runtime.model,
      },
      scope,
    );
    if (!updated) throw new BadRequestException('DOUYIN_CHILD_TOPIC_NOT_FOUND');
    return updated;
  }

  /**
   * @description 提交探店视频：节点选了数眼智能时交给分段通道（逐段配音对口型、客户端拼接）；否则保存台词，再把人物、固定音色或纯声音提示词、
   *   台词和最多 4 张场景图交给通用数字人服务，按 `video-generation` 扣费；提交失败退款并记失败记录。对端直接给出成片时当场转存，否则后台轮询跟进。
   * @keyword-cn 提交探店视频, 数字人生视频
   * @keyword-en submit-store-visit-video, digital-human-video
   * @param {number} topicId 子选题（脚本）ID。
   * @param {{lines?: string, prompt?: string}} input 台词与补充要求（分段通道不用）。
   * @param {DouyinScope} scope 租户用户作用域。
   * @returns {Promise<DouyinOperationView|{operations: DouyinOperationView[]}>} 调用记录；分段通道为各段调用记录。
   * @throws {BadRequestException} 台词太短、没选人脸或场景、缺克隆音色或声音提示词。
   * @throws {ServiceUnavailableException} 「探店数字人视频」节点没指定提供商。
   */
  async start(
    topicId: number,
    input: { lines?: string; prompt?: string },
    scope: DouyinScope,
  ): Promise<DouyinOperationView | { operations: DouyinOperationView[] }> {
    const topic = await this.requireChild(topicId, scope);
    if (await this.usesShuyanChannel())
      return this.shuyanSegments.startAll(topicId, scope);
    const lines = normalizeStoreVisitLines(input.lines);
    if (lines.length < 10)
      throw new BadRequestException('台词太短，至少写 10 个字');
    const faceImage = topic.storeVisit?.faceImage;
    if (!faceImage) throw new BadRequestException('先选一张出镜人脸照');
    const voiceSource = topic.storeVisit?.voiceSource || 'clone';
    const useVoicePrompt =
      voiceSource === 'design' &&
      (topic.storeVisit?.voiceMode === 'prompt' || !topic.storeVisit?.voiceId);
    const voiceDescription = String(
      topic.storeVisit?.voiceDescription || '',
    ).trim();
    const voiceId = useVoicePrompt ? undefined : topic.storeVisit?.voiceId;
    if (useVoicePrompt && (!voiceDescription || voiceDescription.length > 1000))
      throw new BadRequestException('请填写声音提示词，最多 1000 个字');
    if (!useVoicePrompt && !voiceId)
      throw new BadRequestException(
        '先上传录音克隆音色，或选择声音设计并填写提示词',
      );
    const sceneImages = this.collectSceneImages(topic);
    if (topic.productionMode === 'store-visit' && !sceneImages.length) {
      throw new BadRequestException('先上传或选择至少一张探店场景图');
    }
    const runtime = await this.readNodeRuntime(
      WORKFLOW_NODES.douyinWorkbench.storeVisitVideo,
      '探店数字人视频',
    );
    await this.repository.update(topicId, { storeVisit: { lines } }, scope);

    const audio = normalizeVideoAudio(topic.videoAudio);
    const request = {
      model: runtime.model,
      topicId,
      title: topic.title,
      aspectRatio: '9:16',
      voiceId,
      voiceModel: useVoicePrompt ? undefined : topic.storeVisit?.voiceModel,
      voiceSource,
      voiceMode: useVoicePrompt ? 'prompt' : 'generated',
      voiceDescription: useVoicePrompt ? voiceDescription : undefined,
      voiceProviderId: useVoicePrompt
        ? undefined
        : topic.storeVisit?.voiceProviderId,
      lines,
      sceneDescription:
        String(topic.storeVisit?.sceneDescription ?? '').trim() || undefined,
      language: audio.language,
      resolution: String(topic.fullVideoResolution ?? '').trim() || undefined,
      prompt:
        [
          String(input.prompt ?? '').trim(),
          useVoicePrompt ? `【声音设计】\n${voiceDescription}` : '',
        ]
          .filter(Boolean)
          .join('\n\n') || undefined,
    };
    const operationId = randomUUID();
    await this.billing.chargeService({
      serviceCode: 'video-generation',
      tenantId: scope.tenantId,
      userId: scope.userId,
      operationId,
      source: 'douyin-workbench.store-visit-generation',
      platformScope: !scope.tenantId,
    });
    const now = new Date();
    const base = {
      _id: new ObjectId(),
      id: operationId,
      operation: 'generate' as const,
      topicId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      provider: 'digital-human' as const,
      providerId: runtime.providerId,
      model: runtime.model,
      mode: 'store-visit' as const,
      /* 记录里只留素材 ID，不存 base64 图片 */
      request: {
        ...request,
        faceImageId: faceImage.id,
        sceneImageIds: sceneImages.map((image) => image.id),
      },
      createdAt: now,
      updatedAt: now,
    };
    let response: Record<string, unknown>;
    try {
      response = await this.billing.runWithServiceBilling(async () =>
        this.fetchJson(
          buildDigitalHumanUrl(runtime.baseUrl, DIGITAL_HUMAN_PATHS.submitTask),
          {
            method: 'POST',
            body: JSON.stringify({
              operationId,
              ...request,
              faceImageUrl: await this.toImagePayload(faceImage.url),
              sceneImageUrls: await Promise.all(
                sceneImages.map((image) => this.toImagePayload(image.url)),
              ),
            }),
          },
          runtime.apiKey,
        ),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.billing
        .refundService({
          operationId,
          reason: 'douyin-store-visit-submit-failed',
        })
        .catch(() => false);
      const doc: DouyinOperationEntity = {
        ...base,
        status: 'failed',
        error: '数字人服务没有受理这次生成，已退回扣费，请稍后重试。',
        errorDetail: detail,
      };
      await this.operations.insertOne(doc);
      throw new BadGatewayException(`探店视频提交失败：${detail}`);
    }
    const status = mapDigitalHumanStatus(response.status ?? response.state);
    const externalId =
      readDirectField(response, ['id', 'taskId', 'task_id', 'jobId']) ||
      undefined;
    const doc: DouyinOperationEntity = {
      ...base,
      status: status === 'completed' ? 'running' : status,
      progress: 0,
      externalId,
      result: response,
      ...(status === 'failed'
        ? {
            error: '数字人服务生成失败',
            errorDetail:
              readDirectField(response, ['error', 'errorMessage', 'message']) ||
              undefined,
          }
        : {}),
    };
    await this.operations.insertOne(doc);
    if (status === 'failed') {
      await this.billing
        .refundService({ operationId, reason: 'douyin-store-visit-rejected' })
        .catch(() => false);
    }
    if (status === 'completed') {
      await this.advance(doc, response);
    } else if (status !== 'failed' && !externalId) {
      await this.fail(
        doc.id,
        '数字人服务没有返回任务 ID，也没有直接给出成片，无法跟进这次生成。',
      );
    } else if (status !== 'failed') {
      setTimeout(() => void this.pollOnce(), 5000).unref?.();
    }
    const row = await this.operations.findOne({ id: doc.id });
    return this.toView(row ?? doc);
  }

  /**
   * @description 判断「探店数字人视频」节点当前是否选了数眼智能（走分段通道）；节点没配或配置不可用时按通用数字人处理，由后续校验给出中文原因。
   * @keyword-cn 判断探店通道, 数眼分段通道
   * @keyword-en detect-store-visit-channel, shuyan-segment-channel
   * @returns {Promise<boolean>} 是否走数眼分段通道。
   */
  private async usesShuyanChannel(): Promise<boolean> {
    try {
      const runtime = await this.workflowModels.resolveNodeRuntime(
        WORKFLOW_NODES.douyinWorkbench.key,
        WORKFLOW_NODES.douyinWorkbench.storeVisitVideo,
      );
      return Boolean(runtime && isShuyanProvider(runtime.providerCode));
    } catch {
      return false;
    }
  }

  /**
   * @description 手动同步一条探店调用：数字人任务查一次状态并推进，数眼分段交给分段通道；克隆音色的审计记录原样返回。
   * @keyword-cn 同步探店调用, 手动刷新
   * @keyword-en sync-store-visit-operation, manual-refresh
   * @param {string} id 调用记录 ID。
   * @returns {Promise<DouyinOperationView>} 最新调用记录。
   */
  async refresh(id: string): Promise<DouyinOperationView> {
    const row = await this.operations.findOne({
      id,
      provider: 'digital-human',
    });
    if (!row) return this.shuyanSegments.refresh(id);
    if (row.operation === 'generate') {
      try {
        await this.refreshRow(row);
      } catch (error) {
        throw new BadGatewayException(
          `数字人任务状态查询失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const latest = await this.operations.findOne({ id });
    return this.toView(latest ?? row);
  }

  /**
   * @description 跟进一轮未结束的数字人任务，同一进程内不重入。
   * @keyword-cn 轮询数字人任务, 防重入
   * @keyword-en poll-digital-human-operations, reentry-guard
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const rows = await this.operations
        .find({
          provider: 'digital-human',
          operation: 'generate',
          $or: [
            { status: { $in: ['queued', 'running'] } },
            {
              status: 'saving',
              updatedAt: {
                $lt: new Date(
                  Date.now() - DOUYIN_DIGITAL_HUMAN_SAVING_STALE_MS,
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
            `[pollOnce] 数字人任务跟进失败 operation=${row.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * @description 按任务记录上的提供商查一次数字人任务并推进：提供商删除或停用时收成失败，失败写原因，超过 2 小时判超时，完成时转存成片。
   * @keyword-cn 推进数字人任务, 状态查询
   * @keyword-en advance-digital-human-task, status-query
   * @param {DouyinOperationEntity} row 调用记录。
   */
  private async refreshRow(row: DouyinOperationEntity): Promise<void> {
    if (!['queued', 'running', 'saving'].includes(row.status)) return;
    if (!row.externalId) {
      await this.fail(row.id, '数字人任务 ID 缺失，无法查询进度。');
      return;
    }
    // 按提交时的提供商查询；后台换了节点提供商也不影响已提交的任务
    const provider = row.providerId
      ? await this.adminService.getAiProviderRuntimeById(row.providerId)
      : null;
    const baseUrl = String(provider?.baseUrl ?? '').trim();
    if (!provider || !baseUrl) {
      // 提供商被删掉或停用后不再每 15 秒重试，直接收成失败
      await this.fail(
        row.id,
        '数字人服务提供商已删除、停用或没有服务地址，无法继续查询这次生成。',
      );
      return;
    }
    const response = await this.fetchJson(
      buildDigitalHumanUrl(
        baseUrl,
        DIGITAL_HUMAN_PATHS.queryTask,
        row.externalId,
      ),
      { method: 'GET' },
      provider.apiKey,
    );
    const status = mapDigitalHumanStatus(response.status ?? response.state);
    if (status === 'failed') {
      await this.fail(
        row.id,
        '数字人服务生成失败，请检查人脸照是否清晰正脸、台词是否合规后重试。',
        readDirectField(response, ['error', 'errorMessage', 'message']) ||
          JSON.stringify(response).slice(0, 2000),
      );
      return;
    }
    if (status !== 'completed') {
      if (
        Date.now() - new Date(row.createdAt).getTime() >
        DOUYIN_DIGITAL_HUMAN_TASK_TIMEOUT_MS
      ) {
        await this.fail(row.id, '数字人任务超过 2 小时仍未完成，已判定超时。');
        return;
      }
      const progress = Number(
        readDirectField(response, ['progress', 'percent']),
      );
      await this.operations.updateOne(
        { id: row.id, status: { $in: ['queued', 'running'] } },
        {
          $set: {
            status,
            ...(Number.isFinite(progress) && progress > 0
              ? { progress: Math.min(99, progress) }
              : {}),
            result: response,
            updatedAt: new Date(),
          },
        },
      );
      return;
    }
    await this.advance(row, response);
  }

  /**
   * @description 数字人任务完成后认领保存权（防并发重复转存），把成片存进视频库并设为脚本当前成片；
   *   对端直接给了本服务视频库 ID 时直接绑定。
   * @keyword-cn 转存探店成片, 认领保存
   * @keyword-en save-store-visit-video, claim-saving
   * @param {DouyinOperationEntity} row 调用记录。
   * @param {Record<string, unknown>} response 对端完成时的响应。
   */
  private async advance(
    row: DouyinOperationEntity,
    response: Record<string, unknown>,
  ): Promise<void> {
    const claimed = await this.operations.findOneAndUpdate(
      {
        id: row.id,
        $or: [
          { status: { $in: ['queued', 'running'] } },
          {
            status: 'saving',
            updatedAt: {
              $lt: new Date(Date.now() - DOUYIN_DIGITAL_HUMAN_SAVING_STALE_MS),
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
      const topic = await this.repository.get(row.topicId, scope);
      const ownVideoId = Number(readDirectField(response, ['videoId']));
      let video: { id: number; url: string };
      if (Number.isInteger(ownVideoId) && ownVideoId > 0) {
        const record = await this.repository.requireVideo(ownVideoId, scope);
        video = { id: ownVideoId, url: String(record.url ?? '') };
      } else {
        const videoUrl = readDirectField(response, [
          'videoUrl',
          'video_url',
          'url',
        ]);
        if (!videoUrl) throw new Error('DIGITAL_HUMAN_RESULT_URL_MISSING');
        video = await this.storage.saveRemote(videoUrl, {
          name: `${topic?.title ?? `脚本 ${row.topicId}`} 探店`,
          scope,
          tags: ['抖音探店视频', 'AI生成', '数字人'],
          durationSeconds:
            Number(readDirectField(response, ['duration'])) || undefined,
        });
      }
      if (topic) {
        await this.repository.update(
          row.topicId,
          { generatedVideoId: video.id },
          scope,
        );
      }
      await this.operations.updateOne(
        { id: row.id },
        {
          $set: {
            status: 'completed',
            progress: 100,
            result: { ...response, videoId: video.id, videoUrl: video.url },
            ...(topic
              ? {}
              : { error: '成片已存入视频库，但脚本已被删除，未能回填。' }),
            updatedAt: new Date(),
          },
          $unset: topic ? { error: '', errorDetail: '' } : { errorDetail: '' },
        },
      );
    } catch (error) {
      await this.fail(
        row.id,
        '探店成片转存失败，请稍后同步状态重试。',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * @description 优先收集独立探店场景图，旧数据未保存场景时兼容分镜图片，去重后最多四张。
   * @keyword-cn 收集场景参考图, 分镜画面去重
   * @keyword-en collect-scene-images, dedupe-shot-images
   * @param {DouyinTopicEntity} topic 脚本。
   * @returns {DouyinMediaReference[]} 场景参考图。
   */
  private collectSceneImages(topic: DouyinTopicEntity): DouyinMediaReference[] {
    const seen = new Set<number>();
    const images: DouyinMediaReference[] = [];
    const references =
      topic.storeVisit?.sceneImages ??
      (topic.storyboard ?? []).map((shot) => shot.media);
    for (const media of references) {
      if (
        media?.type !== 'image' ||
        !String(media.url ?? '').trim() ||
        seen.has(media.id)
      )
        continue;
      seen.add(media.id);
      images.push(media);
      if (images.length >= DOUYIN_STORE_VISIT_SCENE_IMAGE_LIMIT) break;
    }
    return images;
  }

  /**
   * @description 图片交给直连服务的写法：公网地址原样给，站内图片读文件转成 data URL（对端访问不到本服务的相对地址）。
   * @keyword-cn 图片转直连入参, 站内图片Base64
   * @keyword-en image-to-direct-payload, local-image-data-url
   * @param {string} url 图库图片地址。
   * @returns {Promise<string>} 公网地址或 data URL。
   */
  private async toImagePayload(url: string): Promise<string> {
    const clean = String(url ?? '').trim();
    if (/^https?:\/\//i.test(clean) || /^data:image\//i.test(clean))
      return clean;
    const filePath = resolveStaticFilePath(clean);
    if (!filePath) throw new BadRequestException('图片地址无效');
    const buffer = await readFile(filePath);
    const extension = extname(clean.split('?')[0]).toLowerCase();
    const contentType =
      extension === '.png'
        ? 'image/png'
        : extension === '.webp'
          ? 'image/webp'
          : 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  /**
   * @description 读取探店节点在「工作流节点模型」里指定的提供商：没指定、提供商被停用或选了运行时不支持的提供商时，
   *   用中文说明拒绝（写明去哪里配）；提供商没填服务地址时同样拒绝。
   * @keyword-cn 读取探店节点提供商, 缺配置拒绝
   * @keyword-en read-store-visit-node-runtime, reject-unconfigured
   * @param {string} nodeKey 节点 key（`voice-clone` / `voice-design` / `store-visit-video`）。
   * @param {string} label 节点中文名。
   * @returns {Promise<DouyinStoreVisitRuntime>} 提供商运行配置。
   * @throws {ServiceUnavailableException} 节点不可用。
   */
  private async readNodeRuntime(
    nodeKey: string,
    label: string,
  ): Promise<DouyinStoreVisitRuntime> {
    let runtime: Awaited<
      ReturnType<WorkflowModelService['resolveNodeRuntime']>
    >;
    try {
      runtime = await this.workflowModels.resolveNodeRuntime(
        WORKFLOW_NODES.douyinWorkbench.key,
        nodeKey,
      );
    } catch {
      throw new ServiceUnavailableException(
        `后台「工作流节点模型 · 抖音视频制作 · ${label}」选的提供商不能用于这一步，请改选提供商代码为 ${DIGITAL_HUMAN_PROVIDER_CODE} 的提供商（「探店数字人视频」也可以选数眼智能）`,
      );
    }
    if (!runtime)
      throw new ServiceUnavailableException(
        `还没有在后台「工作流节点模型 · 抖音视频制作」里为「${label}」指定提供商（或提供商已停用），请联系管理员`,
      );
    const baseUrl = String(runtime.baseUrl ?? '').trim();
    if (!baseUrl)
      throw new ServiceUnavailableException(
        `「${label}」的提供商「${runtime.providerName}」没有填服务地址，请在「Ai提供商设置」里补上`,
      );
    return {
      providerId: runtime.providerId,
      providerName: runtime.providerName,
      model: runtime.model,
      baseUrl,
      apiKey: runtime.apiKey,
    };
  }

  /**
   * @description 发起带超时（10 分钟）和可选 Bearer 密钥的 JSON 请求，非 2xx 时把对端错误体放进报错信息。
   * @keyword-cn 探店直连请求, 超时控制
   * @keyword-en store-visit-direct-request, timeout-control
   * @param {string} url 接口地址。
   * @param {RequestInit} init fetch 参数。
   * @param {string} [apiKey] 密钥。
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
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
    } catch (error) {
      throw new Error(
        `网络错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${JSON.stringify(data).slice(0, 1000)}`,
      );
    }
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
   * @description 标记数字人调用失败，`error` 为中文说明、`detail` 为原始信息。
   * @keyword-cn 标记数字人失败, 失败原因
   * @keyword-en mark-digital-human-failed, failure-reason
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
   * @description 去掉数据库字段与请求正文后的探店调用视图。
   * @keyword-cn 探店调用视图, 隐藏请求
   * @keyword-en store-visit-operation-view, hide-request
   * @param {DouyinOperationEntity} row 调用记录。
   * @returns {DouyinOperationView} 前端安全视图。
   */
  private toView(row: DouyinOperationEntity): DouyinOperationView {
    return {
      id: row.id,
      operation: row.operation,
      topicId: row.topicId,
      provider: row.provider,
      mode: row.mode,
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
