import { isLeaderProcess } from '../../cluster-runtime/services/cluster-role.js';
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Collection, Db, ObjectId } from 'mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import { AiBillingService } from '../../ai-billing/services/ai-billing.service.js';
import { DouyinPersonaRepositoryService } from '../../douyin-persona/services/douyin-persona-repository.service.js';
import { buildPersonaVoiceSection } from '../../douyin-persona/services/douyin-persona-prompt.js';
import { OssStorageService } from '../../video-library/services/oss-storage.service.js';
import { VideoLibraryService } from '../../video-library/services/video-library.service.js';
import type { WorkflowNodeRuntime } from '../../workflow-model/entities/workflow-model.entity.js';
import { SHUYAN_DEFAULT_BASE_URL } from '../../workflow-model/services/shuyan-model-catalog.js';
import type {
  DouyinOperationEntity,
  DouyinOperationView,
  DouyinStoryboardShot,
  DouyinTopicEntity,
} from '../entities/douyin-workbench.entity.js';
import {
  DouyinWorkbenchRepositoryService,
  normalizeVideoAudio,
} from './douyin-workbench-repository.service.js';
import {
  buildFullVideoPrompt,
  buildShotVideoPrompt,
  readDouyinVideoPlan,
} from './douyin-pixmax-video.service.js';
import { describePixmaxError } from '../../pixmax/services/pixmax-error.js';

type DouyinScope = { tenantId?: string; userId: string };
type ShuyanVideoMode = 'shot' | 'full';

/**
 * @description 从上游报错里认出被拒的是第几张参考图：数眼把图片放在 `content` 数组里，`content[0]` 是提示词，
 *   往后依次是参考图，所以 `content[3]` 就是第 3 张参考图。认不出时返回空串。
 * @keyword-cn 定位被拒参考图, 报错图片序号
 * @keyword-en locate-rejected-image, error-image-index
 * @param raw 原始报错文本。
 * @returns {string} 如「第 1、4、5 张参考图」，认不出为空串。
 */
export function describeRejectedShuyanImages(raw: string): string {
  const indexes = [
    ...new Set(
      [...String(raw ?? '').matchAll(/content\[(\d+)\]/g)]
        .map((match) => Number(match[1]))
        .filter((value) => value > 0),
    ),
  ].sort((a, b) => a - b);
  return indexes.length ? `第 ${indexes.join('、')} 张参考图` : '';
}

/**
 * @description 数眼通道自己的错误说明：网络、密钥、限流这类跟通道有关的错，不能套用 PixMax 那几条（文案里会写错家）。
 *   模型内容审核类的错误码两家通用，交给 `PIXMAX_ERROR_RULES` 处理。
 * @keyword-cn 数眼错误对照, 通道错误
 * @keyword-en shuyan-error-rules, channel-error
 */
export const SHUYAN_VIDEO_ERROR_RULES: ReadonlyArray<{
  pattern: RegExp;
  message: string;
}> = [
  {
    pattern: /SHUYAN_VIDEO_API_KEY_NOT_CONFIGURED/,
    message: '数眼智能的 API Key 还没有配置，请到后台「Ai提供商设置」里填写。',
  },
  {
    pattern:
      /SHUYAN_VIDEO_HTTP_401|SHUYAN_VIDEO_HTTP_403|unauthori[sz]ed|invalid (api )?key/i,
    message:
      '数眼智能的 API Key 无效或没有权限，请到后台「Ai提供商设置」里检查。',
  },
  {
    pattern: /SHUYAN_VIDEO_HTTP_429|RateLimit|too many requests/i,
    message: '请求数眼智能太频繁，请稍等片刻再试。',
  },
  {
    pattern:
      /SHUYAN_VIDEO_NETWORK_ERROR|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i,
    message: '连接数眼智能失败，请检查网络后重试。',
  },
  {
    pattern: /SHUYAN_VIDEO_MODEL_NOT_SUPPORTED/,
    message:
      '所选数眼模型还没有接入对应的原生路由，请到后台「工作流节点模型」换成 Seedance 或 MiniMax-H3 型号。',
  },
  {
    pattern: /SHUYAN_VIDEO_TASK_ID_MISSING/,
    message: '数眼智能没有返回任务 ID，请稍后重试。',
  },
];

/**
 * @description 把数眼通道的原始报错翻译成中文说明：先看通道自己的规则，再复用 PixMax 那套上游模型错误规则
 *   （火山系内容审核错误码两条通道通用），并在认得出的时候点名是哪几张参考图被拒。
 * @keyword-cn 翻译数眼报错, 友好错误提示
 * @keyword-en describe-shuyan-error, friendly-error-message
 * @param raw 原始报错文本。
 * @returns {string} 中文说明。
 */
export function describeShuyanVideoFailure(raw: string): string {
  const text = String(raw ?? '');
  const own = SHUYAN_VIDEO_ERROR_RULES.find((rule) => rule.pattern.test(text));
  if (own) return own.message;
  const subject = describeRejectedShuyanImages(text) || '参考图';
  return describePixmaxError(text, subject);
}

/**
 * @description 数眼创建 / 查询视频任务返回的结构。Seedance 创建与查询都平铺返回、任务 ID 在 `id`、成片在
 *   `content.video_url`；MiniMax-H3 创建只返回 `task_id`，查询把任务包在 `task` 里、成片在 `content.url`。
 * @keyword-cn 数眼视频任务, Seedance任务, H3任务
 * @keyword-en shuyan-video-task, seedance-task, minimax-h3-task
 */
interface ShuyanVideoTask {
  id?: string;
  task_id?: string;
  task?: ShuyanVideoTask;
  model?: string;
  status?: string;
  content?: {
    video_url?: string;
    url?: string;
    last_frame_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
  duration?: number;
  ratio?: string;
  resolution?: string;
  [key: string]: unknown;
}

/**
 * @description 后台轮询数眼 Seedance 任务的间隔；官方建议不低于 10 秒。
 * @keyword-cn 数眼视频轮询间隔, 后台轮询
 * @keyword-en shuyan-video-poll-interval, background-polling
 */
export const DOUYIN_SHUYAN_POLL_MS = 15 * 1000;

/**
 * @description 数眼 Seedance 默认任务过期时间为 48 小时；保存中超过 10 分钟可由下一轮重新认领。
 * @keyword-cn 数眼视频任务超时, 保存中断
 * @keyword-en shuyan-video-task-timeout, saving-stale
 */
export const DOUYIN_SHUYAN_TASK_TIMEOUT_MS = 48 * 60 * 60 * 1000;

/**
 * @description 数眼 Seedance 生视频默认分辨率；官方按 分辨率 x 时长 计费，480p 是最省的档位，
 *   需要更清晰时改成 `720p` / `1080p`（1080p 仅 Seedance 2.x 支持）。
 * @keyword-cn 数眼视频分辨率, 默认清晰度
 * @keyword-en shuyan-video-resolution, default-quality
 */
export const DOUYIN_SHUYAN_VIDEO_RESOLUTION = '480p';
const DOUYIN_SHUYAN_SAVING_STALE_MS = 10 * 60 * 1000;

/**
 * @description 数眼已接入的视频原生路由：`seedance` 走 `/seedance/api/v3/contents/generations/tasks`，
 *   `hailuo-v2`（MiniMax-H3）走 `/hailuo/v2/video_generation`。
 * @keyword-cn 数眼视频路由, 原生端点
 * @keyword-en shuyan-video-route, native-endpoint
 */
export type ShuyanVideoRoute = 'seedance' | 'hailuo-v2';

/**
 * @description MiniMax-H3 接口的 `model` 是枚举，大小写要和文档逐字一致。
 */
const SHUYAN_HAILUO_V2_MODELS = ['MiniMax-H3'];

/**
 * @description 按模型名判断数眼视频走哪条原生路由；Kling / Vidu / 旧版 Hailuo / 即梦等其他视频族还没接入，返回 null。
 * @keyword-cn 数眼视频路由, 视频模型支持
 * @keyword-en resolve-shuyan-video-route, video-model-support
 * @param model 模型编码。
 * @returns {ShuyanVideoRoute | null} 路由，未接入时为 null。
 */
export function resolveShuyanVideoRoute(
  model: string,
): ShuyanVideoRoute | null {
  const value = String(model ?? '')
    .trim()
    .toLowerCase();
  if (value.includes('seedance')) return 'seedance';
  if (/minimax[-_.]?h3/.test(value)) return 'hailuo-v2';
  return null;
}

/**
 * @description 提交前把模型名规整成数眼要求的写法：MiniMax-H3 不分大小写地对齐到枚举值，其余原样返回。
 * @keyword-cn 数眼模型名规整, H3模型枚举
 * @keyword-en normalize-shuyan-video-model, minimax-h3-model-enum
 * @param model 后台填写的模型编码。
 * @returns {string} 提交给数眼的模型名。
 */
export function normalizeShuyanVideoModel(model: string): string {
  const value = String(model ?? '').trim();
  return (
    SHUYAN_HAILUO_V2_MODELS.find(
      (name) => name.toLowerCase() === value.toLowerCase(),
    ) ?? value
  );
}

/**
 * @description 拼出数眼视频任务的创建或查询地址：不传任务 ID 是创建地址，传了是查询地址。
 * @keyword-cn 数眼视频任务地址, 创建与查询
 * @keyword-en shuyan-video-task-url, create-and-query
 * @param gateway 网关根地址（见 `resolveShuyanVideoGateway`）。
 * @param route 原生路由。
 * @param taskId 任务 ID，查询时传。
 * @returns {string} 接口地址。
 */
export function resolveShuyanVideoTaskUrl(
  gateway: string,
  route: ShuyanVideoRoute,
  taskId?: string,
): string {
  const id = taskId ? encodeURIComponent(taskId) : '';
  if (route === 'hailuo-v2') {
    return id
      ? `${gateway}/hailuo/v2/query/video_generation/${id}`
      : `${gateway}/hailuo/v2/video_generation`;
  }
  const base = `${gateway}/seedance/api/v3/contents/generations/tasks`;
  return id ? `${base}/${id}` : base;
}

/**
 * @description MiniMax-H3 查询结果包在 `task` 里，取出来后与 Seedance 平铺结构一致；本来就平铺的原样返回。
 * @keyword-cn 拆包数眼任务, H3查询结果
 * @keyword-en unwrap-shuyan-video-task, minimax-h3-query-result
 * @param raw 接口原始响应。
 * @returns {ShuyanVideoTask} 任务本体。
 */
export function unwrapShuyanVideoTask(raw: ShuyanVideoTask): ShuyanVideoTask {
  return raw.task && typeof raw.task === 'object' ? raw.task : raw;
}

/**
 * @description 把后台 OpenAI 兼容 baseUrl（通常以 `/v1` 结尾）还原成数眼网关根地址。
 * @keyword-cn 数眼视频网关, 移除V1路径
 * @keyword-en shuyan-video-gateway, strip-v1-path
 * @param baseUrl 提供商服务地址。
 * @returns {string} 网关根地址。
 */
export function resolveShuyanVideoGateway(baseUrl?: string): string {
  const value = String(baseUrl ?? '').trim() || SHUYAN_DEFAULT_BASE_URL;
  try {
    const parsed = new URL(value);
    parsed.pathname = parsed.pathname
      .replace(/\/v1\/?$/i, '')
      .replace(/\/$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/v1\/?$/i, '').replace(/\/$/, '');
  }
}

/**
 * @description 返回当前数眼视频型号可选的整数秒数：MiniMax-H3 为 4~15 秒，Seedance 按版本区分，未知新版本按 4~15 秒能力处理。
 * @keyword-cn Seedance可选时长, 型号时长范围
 * @keyword-en seedance-duration-choices, model-duration-range
 * @param model 模型编码。
 * @returns {number[]} 可选秒数。
 */
export function listShuyanVideoDurationChoices(model: string): number[] {
  const value = String(model ?? '')
    .trim()
    .toLowerCase();
  const range =
    resolveShuyanVideoRoute(value) === 'hailuo-v2'
      ? [4, 15]
      : /seedance[-_.]?1[-_.]?0/.test(value)
        ? [2, 12]
        : /seedance[-_.]?1[-_.]?5/.test(value)
          ? [4, 12]
          : [4, 15];
  return Array.from(
    { length: range[1] - range[0] + 1 },
    (_unused, index) => range[0] + index,
  );
}

/**
 * @description 把分镜计划时长收敛到所选数眼视频型号支持的整数秒范围。
 * @keyword-cn Seedance时长收敛, 视频时长
 * @keyword-en clamp-seedance-duration, video-duration
 * @param model 模型编码。
 * @param seconds 计划秒数。
 * @returns {number} 可提交的整数秒数。
 */
export function clampShuyanVideoDuration(
  model: string,
  seconds: number,
): number {
  const choices = listShuyanVideoDurationChoices(model);
  const min = choices[0];
  const max = choices[choices.length - 1];
  const rounded = Math.round(Number(seconds) || min);
  return Math.max(min, Math.min(max, rounded));
}

/**
 * @description 返回当前数眼视频型号可选的清晰度档位（按清晰度升序，写法与接口要求逐字一致）：MiniMax-H3 为
 *   `768P` / `2K`；Seedance 2.x 到 1080p，其余 Seedance 到 720p。官方按「分辨率 × 时长」计费，档位越高越贵。
 * @keyword-cn Seedance可选清晰度, 型号清晰度范围
 * @keyword-en seedance-resolution-choices, model-resolution-range
 * @param model 模型编码。
 * @returns {string[]} 可选档位。
 */
export function listShuyanVideoResolutionChoices(model: string): string[] {
  const value = String(model ?? '')
    .trim()
    .toLowerCase();
  if (resolveShuyanVideoRoute(value) === 'hailuo-v2') return ['768P', '2K'];
  return /seedance[-_.]?2/.test(value)
    ? ['480p', '720p', '1080p']
    : ['480p', '720p'];
}

/**
 * @description 把清晰度档位换算成短边像素，用来就近取档：`720p` → 720，`2K` → 1440，`4K` → 2160；认不出为 0。
 * @keyword-cn 清晰度短边像素, 档位换算
 * @keyword-en resolution-short-edge, resolution-to-pixels
 * @param label 档位写法，大小写不限。
 * @returns {number} 短边像素。
 */
export function shuyanResolutionHeightOf(label: string): number {
  const value = String(label ?? '')
    .trim()
    .toLowerCase();
  const progressive = /^(\d+)p$/.exec(value);
  if (progressive) return Number(progressive[1]);
  if (value === '2k') return 1440;
  if (value === '4k') return 2160;
  return 0;
}

/**
 * @description 把设定的清晰度收敛到所选数眼视频型号支持的档位（大小写不限，返回型号自己的写法）：对不上就取最接近的一档；
 *   没设定时用默认档 `DOUYIN_SHUYAN_VIDEO_RESOLUTION`，型号没有这一档（如 MiniMax-H3）时取最低档。
 * @keyword-cn Seedance清晰度收敛, 视频清晰度
 * @keyword-en clamp-seedance-resolution, video-resolution
 * @param model 模型编码。
 * @param resolution 设定的清晰度，空表示不指定。
 * @returns {string} 可提交的档位。
 */
export function clampShuyanVideoResolution(
  model: string,
  resolution?: string,
): string {
  const choices = listShuyanVideoResolutionChoices(model);
  const want = String(resolution ?? '')
    .trim()
    .toLowerCase();
  const fallback =
    choices.find(
      (item) => item.toLowerCase() === DOUYIN_SHUYAN_VIDEO_RESOLUTION,
    ) ?? choices[0];
  if (!want) return fallback;
  const exact = choices.find((item) => item.toLowerCase() === want);
  if (exact) return exact;
  const wanted = shuyanResolutionHeightOf(want);
  if (!wanted) return fallback;
  return choices.reduce((best, item) =>
    Math.abs(shuyanResolutionHeightOf(item) - wanted) <
    Math.abs(shuyanResolutionHeightOf(best) - wanted)
      ? item
      : best,
  );
}

/**
 * @description 把数眼 Seedance 状态映射成抖音工作台统一状态；任务初建无 status 时仍视为排队。
 * @keyword-cn 数眼视频状态映射, 初建无状态
 * @keyword-en map-shuyan-video-status, missing-status-queued
 * @param status 对端状态。
 * @returns {'queued'|'running'|'completed'|'failed'} 工作台状态。
 */
export function mapShuyanVideoStatus(
  status?: string,
): 'queued' | 'running' | 'completed' | 'failed' {
  const value = String(status ?? '')
    .trim()
    .toLowerCase();
  if (value === 'succeeded') return 'completed';
  if (['failed', 'cancelled', 'expired'].includes(value)) return 'failed';
  if (value === 'running') return 'running';
  return 'queued';
}

/**
 * @description 把数眼任务的结构化错误整理成用户可读中文，保留上游错误码方便排查。
 * @keyword-cn 数眼视频错误, 上游错误码
 * @keyword-en describe-shuyan-video-error, upstream-error-code
 * @param task 数眼任务响应。
 * @returns {string} 用户可读错误。
 */
export function describeShuyanVideoError(task: ShuyanVideoTask): string {
  const code = String(task.error?.code ?? '').trim();
  const message = String(task.error?.message ?? '').trim();
  const detail = [code, message].filter(Boolean).join('：');
  const status = String(task.status ?? '').trim();
  if (!detail)
    return `数眼智能视频任务未完成${status ? `（${status}）` : ''}。`;
  return describeShuyanVideoFailure(detail);
}

/**
 * @description 抖音视频生成的数眼通道（Seedance 与 MiniMax-H3 两条原生路由）：提交文生 / 图生视频任务、持久化调用记录、
 *   后台轮询，成功后在临时地址失效前转存视频库并回填分镜或整片。
 * @keyword-cn 数眼Seedance生视频, 数眼H3生视频, 成片转存, 分镜视频
 * @keyword-en shuyan-seedance-video, shuyan-minimax-h3-video, persist-generated-video, shot-video
 */
@Injectable()
export class DouyinShuyanVideoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DouyinShuyanVideoService.name);
  private readonly operations: Collection<DouyinOperationEntity>;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly personas: DouyinPersonaRepositoryService,
    private readonly billing: AiBillingService,
    private readonly adminService: AdminService,
    private readonly videoLibrary: VideoLibraryService,
    private readonly oss: OssStorageService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
  }

  /**
   * @description 启动数眼任务后台轮询，服务重启后继续跟进未结束记录；多进程时只在 leader 进程上轮询。
   * @keyword-cn 启动数眼视频轮询, 重启续跟
   * @keyword-en start-shuyan-video-polling, resume-after-restart
   */
  onModuleInit(): void {
    if (!isLeaderProcess()) return;
    this.timer = setInterval(() => void this.pollOnce(), DOUYIN_SHUYAN_POLL_MS);
    this.timer.unref?.();
  }

  /**
   * @description 停止数眼任务后台轮询。
   * @keyword-cn 停止数眼视频轮询, 模块销毁
   * @keyword-en stop-shuyan-video-polling, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 提交一次数眼视频生成，按型号走 Seedance 或 MiniMax-H3 路由；分镜带画面时以它为首帧，
   *   整片在 Seedance 2.x 与 MiniMax-H3 下最多带 9 张参考图。
   * @keyword-cn 提交数眼视频, Seedance多模态
   * @keyword-en submit-shuyan-video, seedance-multimodal
   * @param input 脚本、模式、单镜 ID、补充要求、节点运行配置与作用域。
   * @returns {Promise<DouyinOperationView>} 调用记录。
   */
  async start(input: {
    topic: DouyinTopicEntity;
    mode: ShuyanVideoMode;
    shotId?: string;
    prompt?: string;
    runtime: WorkflowNodeRuntime;
    scope: DouyinScope;
  }): Promise<DouyinOperationView> {
    const { topic, mode, runtime, scope } = input;
    const route = resolveShuyanVideoRoute(runtime.model);
    if (!route) {
      throw new BadRequestException(
        `SHUYAN_VIDEO_MODEL_NOT_SUPPORTED:${runtime.model}`,
      );
    }
    if (!String(runtime.apiKey ?? '').trim()) {
      throw new BadRequestException('SHUYAN_VIDEO_API_KEY_NOT_CONFIGURED');
    }
    const shotIndex = input.shotId
      ? topic.storyboard.findIndex((shot) => shot.id === input.shotId)
      : -1;
    if (mode === 'shot' && shotIndex < 0) {
      throw new BadRequestException('DOUYIN_STORYBOARD_SHOT_NOT_FOUND');
    }
    const shots =
      mode === 'shot' ? [topic.storyboard[shotIndex]] : topic.storyboard;
    if (!shots.length) {
      throw new BadRequestException('DOUYIN_STORYBOARD_REQUIRED');
    }

    const extra =
      String(input.prompt ?? '')
        .trim()
        .slice(0, 1000) || undefined;
    const plannedSeconds = shots.reduce(
      (sum, shot) => sum + (Number(shot.duration) || 0),
      0,
    );
    // 整片没设定时长时用模型能生成的最长时长；单镜按这一镜自己的时长
    const chosenSeconds =
      mode === 'full'
        ? Number(topic.fullVideoDuration) > 0
          ? Number(topic.fullVideoDuration)
          : Math.max(...listShuyanVideoDurationChoices(runtime.model))
        : undefined;
    const duration = clampShuyanVideoDuration(
      runtime.model,
      chosenSeconds ?? plannedSeconds,
    );
    // 整片与分镜各有自己的清晰度设定，空串走模型默认档
    const chosenResolution = String(
      (mode === 'full'
        ? topic.fullVideoResolution
        : topic.shotVideoResolution) ?? '',
    ).trim();
    const resolution = clampShuyanVideoResolution(
      runtime.model,
      chosenResolution,
    );
    const audio = normalizeVideoAudio(topic.videoAudio);
    const persona = topic.personaId
      ? await this.personas.get(topic.personaId, scope)
      : null;
    const personaVoice = buildPersonaVoiceSection(persona);
    const images = this.collectImages(shots, mode === 'shot' ? shotIndex : 0);
    // 整片用多图参考：Seedance 2.x 与 MiniMax-H3 都收最多 9 张 reference_image，其余型号只带一张首帧
    const multiReference =
      mode === 'full' &&
      (route === 'hailuo-v2' || /seedance[-_.]?2/i.test(runtime.model));
    const usedImages = images.slice(0, multiReference ? 9 : 1);
    const prompt =
      mode === 'shot'
        ? buildShotVideoPrompt({
            title: topic.title,
            shot: shots[0],
            index: shotIndex,
            hasImage: usedImages.length > 0,
            audio,
            personaVoice,
            extra,
          })
        : buildFullVideoPrompt({
            title: topic.title,
            script: topic.script,
            shots,
            images: usedImages,
            seconds: duration,
            referModel:
              usedImages.length > 1 ? 'referenceImages' : 'imageToVideo',
            audio,
            personaVoice,
            extra,
          });
    const imageContents = await Promise.all(
      usedImages.map(async (image) => ({
        type: 'image_url',
        image_url: { url: await this.toSeedanceImageUrl(image.url) },
        role: multiReference ? 'reference_image' : 'first_frame',
      })),
    );
    const gateway = resolveShuyanVideoGateway(runtime.baseUrl);
    const endpoint = resolveShuyanVideoTaskUrl(gateway, route);
    const content = [{ type: 'text', text: prompt }, ...imageContents];
    // MiniMax-H3 带首帧时宽高比由图片决定，接口要求恒为 adaptive；它没有声音开关，静音只靠提示词【声音】段约束
    const payload =
      route === 'hailuo-v2'
        ? {
            model: normalizeShuyanVideoModel(runtime.model),
            content,
            resolution,
            duration,
            ratio:
              imageContents[0]?.role === 'first_frame' ? 'adaptive' : '9:16',
            aigc_watermark: false,
          }
        : {
            model: runtime.model,
            content,
            resolution,
            ratio: '9:16',
            duration,
            generate_audio: audio.mode !== 'mute',
            watermark: false,
          };
    const operationId = randomUUID();
    const scriptIncluded =
      mode === 'shot'
        ? Boolean(String(shots[0].narration ?? '').trim())
        : Boolean(
            String(topic.script ?? '').trim() ||
            shots.some((shot) => String(shot.narration ?? '').trim()),
          );
    const request = {
      mode,
      model: runtime.model,
      referModel: usedImages.length
        ? imageContents[0]?.role === 'reference_image'
          ? 'referenceImages'
          : 'imageToVideo'
        : undefined,
      duration,
      plannedSeconds,
      targetSeconds: chosenSeconds,
      durationClamped: duration < plannedSeconds,
      imageIds: usedImages.map((image) => image.imageId),
      audio,
      scriptIncluded,
      prompt,
      resolution: payload.resolution,
      targetResolution: chosenResolution || undefined,
      resolutionClamped: Boolean(
        chosenResolution &&
        chosenResolution.toLowerCase() !== payload.resolution.toLowerCase(),
      ),
      ratio: payload.ratio,
    };
    const base = {
      operation: 'generate' as const,
      topicId: topic.id,
      shotId: mode === 'shot' ? input.shotId : undefined,
      provider: 'shuyan' as const,
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
      const task = unwrapShuyanVideoTask(
        await this.fetchJson(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${runtime.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }),
      );
      // Seedance 返回 id，MiniMax-H3 返回 task_id
      const externalId = String(task.id ?? task.task_id ?? '').trim();
      if (!externalId) throw new Error('SHUYAN_VIDEO_TASK_ID_MISSING');
      const doc: DouyinOperationEntity = {
        _id: new ObjectId(),
        id: operationId,
        ...base,
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
      const friendly = describeShuyanVideoFailure(detail);
      await this.operations.insertOne({
        _id: new ObjectId(),
        id: operationId,
        ...base,
        status: 'failed',
        error: friendly,
        errorDetail: detail,
        createdAt: now,
        updatedAt: now,
      });
      throw new BadGatewayException(friendly);
    }
  }

  /**
   * @description 立即同步一条数眼视频调用，供前端手动刷新。
   * @keyword-cn 同步数眼视频调用, 手动刷新
   * @keyword-en sync-shuyan-video-operation, manual-refresh
   * @param id 调用记录 ID。
   * @returns {Promise<DouyinOperationView>} 最新记录。
   */
  async refresh(id: string): Promise<DouyinOperationView> {
    const row = await this.operations.findOne({
      id,
      provider: 'shuyan',
      mode: { $ne: 'store-visit' },
    });
    if (!row) throw new BadRequestException('DOUYIN_OPERATION_NOT_FOUND');
    await this.refreshRow(row);
    const latest = await this.operations.findOne({ id });
    return this.toView(latest ?? row);
  }

  /**
   * @description 跟进一轮未结束的数眼任务，同一进程内不重入；探店分段（`mode=store-visit`）由探店分段通道自己跟进。
   * @keyword-cn 轮询数眼视频调用, 防重入
   * @keyword-en poll-shuyan-video-operations, reentry-guard
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const rows = await this.operations
        .find({
          provider: 'shuyan',
          mode: { $ne: 'store-visit' },
          $or: [
            { status: { $in: ['queued', 'running'] } },
            {
              status: 'saving',
              updatedAt: {
                $lt: new Date(Date.now() - DOUYIN_SHUYAN_SAVING_STALE_MS),
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
            `[pollOnce] 数眼任务跟进失败 operation=${row.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * @description 按调用记录的型号选路由查询并推进一条数眼任务；成功时认领保存权、转存视频并回填脚本。
   * @keyword-cn 推进数眼视频调用, 完成转存
   * @keyword-en advance-shuyan-video-operation, save-on-complete
   * @param row 调用记录。
   */
  private async refreshRow(row: DouyinOperationEntity): Promise<void> {
    if (!row.externalId) {
      await this.fail(row.id, '数眼智能任务 ID 缺失。');
      return;
    }
    const runtime = row.providerId
      ? await this.adminService.getAiProviderRuntimeById(row.providerId)
      : null;
    if (!runtime) {
      await this.fail(
        row.id,
        '数眼智能提供商已删除或停用，无法继续查询这次生成。',
      );
      return;
    }
    const gateway = resolveShuyanVideoGateway(runtime.baseUrl);
    // 接入 H3 之前的记录都是 Seedance
    const route = resolveShuyanVideoRoute(row.model ?? '') ?? 'seedance';
    const endpoint = resolveShuyanVideoTaskUrl(gateway, route, row.externalId);
    const task = unwrapShuyanVideoTask(
      await this.fetchJson(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${runtime.apiKey ?? ''}` },
      }),
    );
    const mapped = mapShuyanVideoStatus(task.status);
    if (mapped === 'failed') {
      await this.fail(
        row.id,
        describeShuyanVideoError(task),
        JSON.stringify(task.error ?? { status: task.status }),
      );
      return;
    }
    if (mapped !== 'completed') {
      if (
        Date.now() - new Date(row.createdAt).getTime() >
        DOUYIN_SHUYAN_TASK_TIMEOUT_MS
      ) {
        await this.fail(
          row.id,
          '数眼智能视频任务超过 48 小时仍未完成，已判定超时。',
        );
        return;
      }
      await this.operations.updateOne(
        { id: row.id, status: { $in: ['queued', 'running'] } },
        {
          $set: {
            status: mapped,
            progress: mapped === 'running' ? 50 : 0,
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
            status: 'failed',
            error: '数眼智能成片转存失败，请稍后同步状态重试。',
          },
          {
            status: 'saving',
            updatedAt: {
              $lt: new Date(Date.now() - DOUYIN_SHUYAN_SAVING_STALE_MS),
            },
          },
        ],
      },
      { $set: { status: 'saving', progress: 100, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!claimed) return;
    try {
      const videoUrl = String(
        task.content?.video_url ?? task.content?.url ?? '',
      ).trim();
      if (!videoUrl) throw new Error('SHUYAN_VIDEO_RESULT_URL_MISSING');
      const scope = { tenantId: row.tenantId, userId: row.userId };
      const topic = await this.repository.get(row.topicId, scope);
      const shotIndex = row.shotId
        ? (topic?.storyboard ?? []).findIndex((shot) => shot.id === row.shotId)
        : -1;
      const name = `${topic?.title ?? `脚本 ${row.topicId}`} ${row.mode === 'shot' ? `第 ${shotIndex + 1} 镜` : '整片'}`;
      const video = await this.saveVideo(videoUrl, {
        name,
        duration: Number(task.duration),
        scope,
        tags: [
          row.mode === 'shot' ? '抖音分镜视频' : '抖音整片视频',
          'AI生成',
          '数眼智能',
        ],
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
            result: { ...task, videoId: video.id, videoUrl: video.url },
            ...(topic
              ? {}
              : { error: '成片已存入视频库，但脚本已被删除，未能回填。' }),
            updatedAt: new Date(),
          },
          $unset: topic ? { error: '', errorDetail: '' } : { errorDetail: '' },
        },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.fail(
        row.id,
        '数眼智能成片转存失败，请稍后同步状态重试。',
        detail,
      );
    }
  }

  /**
   * @description 把数眼返回的临时视频地址（Seedance 24 小时、MiniMax-H3 约 7 天有效）转存到 OSS；
   *   未配置 OSS 时登记临时外链并明确记录警告。
   * @keyword-cn 转存数眼成片, 视频库登记
   * @keyword-en save-shuyan-video, register-video
   * @param url 数眼成片地址。
   * @param input 名称、时长、作用域与标签。
   * @returns 视频库 ID 与地址。
   */
  private async saveVideo(
    url: string,
    input: {
      name: string;
      duration?: number;
      scope: DouyinScope;
      tags: string[];
    },
  ): Promise<{ id: number; url: string }> {
    const common = {
      userId: input.scope.userId,
      tenantId: input.scope.tenantId,
      name: input.name,
      contentType: 'video/mp4',
      durationMs:
        Number.isFinite(input.duration) && Number(input.duration) > 0
          ? Number(input.duration) * 1000
          : null,
      width: null,
      height: null,
      tags: input.tags,
    };
    if (!this.oss.isConfigured()) {
      this.logger.warn('[saveVideo] OSS 未配置，视频库登记数眼临时地址');
      const record = await this.videoLibrary.registerExternal({
        ...common,
        url,
        sizeBytes: 0,
      });
      return { id: record.id, url: record.url };
    }
    const downloaded = await this.download(url);
    const extension = extname(new URL(url).pathname) || '.mp4';
    const key = this.oss.buildObjectKey({
      scene: 'video',
      fileName: `generated${extension}`,
      tenantId: input.scope.tenantId,
    });
    await this.oss.putObject(key, downloaded.buffer, downloaded.contentType);
    const record = await this.videoLibrary.register({
      ...common,
      key,
      sizeBytes: downloaded.buffer.length,
    });
    return { id: record.id, url: record.url };
  }

  /**
   * @description 从分镜顺序收集图片素材并去重，保留它对应的镜头序号供整片提示词引用。
   * @keyword-cn 收集数眼参考图, 分镜图片去重
   * @keyword-en collect-shuyan-reference-images, dedupe-shot-images
   * @param shots 参与生成的分镜。
   * @param offset 单镜在完整分镜中的偏移。
   * @returns 图片列表。
   */
  private collectImages(
    shots: DouyinStoryboardShot[],
    offset: number,
  ): Array<{
    imageId: number;
    url: string;
    name: string;
    shotIndexes: number[];
  }> {
    const byId = new Map<
      number,
      {
        imageId: number;
        url: string;
        name: string;
        shotIndexes: number[];
      }
    >();
    shots.forEach((shot, index) => {
      const media = shot.media;
      if (media?.type !== 'image' || !String(media.url ?? '').trim()) return;
      const shotIndex = offset + index;
      const existing = byId.get(media.id);
      if (existing) {
        existing.shotIndexes.push(shotIndex);
      } else {
        byId.set(media.id, {
          imageId: media.id,
          url: media.url,
          name: media.name || `image-${media.id}.jpg`,
          shotIndexes: [shotIndex],
        });
      }
    });
    return [...byId.values()];
  }

  /**
   * @description 把公网图片原样交给数眼；站内 `/static` 图片读取后转成 data URL（Seedance 与 MiniMax-H3 都接受）。
   * @keyword-cn 数眼图片输入, 本地图片Base64
   * @keyword-en seedance-image-input, local-image-data-url
   * @param url 图库地址。
   * @returns 可被 Seedance 读取的 URL 或 data URL。
   */
  private async toSeedanceImageUrl(url: string): Promise<string> {
    const clean = String(url ?? '').trim();
    if (/^https?:\/\//i.test(clean) || /^data:image\//i.test(clean)) {
      return clean;
    }
    const relative = clean.replace(/^\/static\//, '').replace(/^\/+/, '');
    const buffer = await readFile(join(process.cwd(), 'public', relative));
    const contentType = this.imageContentTypeOf(clean);
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  /**
   * @description 按图片扩展名推断 Seedance data URL 的媒体类型。
   * @keyword-cn 图片媒体类型, 扩展名推断
   * @keyword-en image-content-type, extension-detection
   * @param url 图片地址。
   * @returns MIME 类型。
   */
  private imageContentTypeOf(url: string): string {
    const extension = extname(String(url).split('?')[0]).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.gif') return 'image/gif';
    if (extension === '.bmp') return 'image/bmp';
    return 'image/jpeg';
  }

  /**
   * @description 发起数眼 JSON 请求，非 2xx 时保留对端错误体。
   * @keyword-cn 数眼视频HTTP请求, 错误体保留
   * @keyword-en shuyan-video-http, preserve-error-body
   * @param url 接口地址。
   * @param init fetch 参数。
   * @returns 数眼任务响应。
   */
  private async fetchJson(
    url: string,
    init: RequestInit,
  ): Promise<ShuyanVideoTask> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(10 * 60 * 1000),
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
    if (!response.ok) {
      throw new Error(
        `SHUYAN_VIDEO_HTTP_${response.status}:${JSON.stringify(data).slice(0, 2000)}`,
      );
    }
    return data;
  }

  /**
   * @description 下载数眼 24 小时临时成片，返回二进制与响应媒体类型。
   * @keyword-cn 下载数眼成片, 临时地址
   * @keyword-en download-shuyan-video, temporary-url
   * @param url 成片地址。
   * @returns 视频二进制与媒体类型。
   */
  private async download(
    url: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok) {
      throw new Error(`SHUYAN_VIDEO_DOWNLOAD_FAILED:${response.status}`);
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'video/mp4',
    };
  }

  /**
   * @description 把数眼调用收敛到失败终态并保存用户说明与原始详情。
   * @keyword-cn 数眼视频失败收敛, 原始错误
   * @keyword-en fail-shuyan-video-operation, raw-error-detail
   * @param id 调用记录 ID。
   * @param message 用户说明。
   * @param detail 原始详情。
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
   * @description 移除请求正文后返回数眼视频调用安全视图。
   * @keyword-cn 数眼视频调用视图, 隐藏请求
   * @keyword-en shuyan-video-operation-view, hide-request
   * @param row 调用记录。
   * @returns 前端安全视图。
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
      error: row.error,
      errorDetail: row.errorDetail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
