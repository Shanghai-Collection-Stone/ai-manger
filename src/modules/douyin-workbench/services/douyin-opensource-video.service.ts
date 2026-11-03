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
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Collection, Db, ObjectId } from 'mongodb';
import { AdminService } from '../../admin/services/admin.service.js';
import { AiBillingService } from '../../ai-billing/services/ai-billing.service.js';
import { DouyinPersonaRepositoryService } from '../../douyin-persona/services/douyin-persona-repository.service.js';
import { buildPersonaVoiceSection } from '../../douyin-persona/services/douyin-persona-prompt.js';
import {
  OPENSOURCE_VIDEO_PROMPT_MAX,
  type OpensourceVideoJob,
} from '../../opensource-video/entities/opensource-video.entity.js';
import { OpensourceVideoClientService } from '../../opensource-video/services/opensource-video-client.service.js';
import {
  clampOpensourceVideoDuration,
  clampOpensourceVideoResolution,
  describeOpensourceVideoFailure,
  listOpensourceVideoDurationChoices,
  mapOpensourceVideoStatus,
  resolveOpensourceVideoMode,
  toOpensourceVoiceHint,
} from '../../opensource-video/services/opensource-video-params.js';
import type { WorkflowNodeRuntime } from '../../workflow-model/entities/workflow-model.entity.js';
import type {
  DouyinOperationEntity,
  DouyinOperationView,
  DouyinShotDirection,
  DouyinStoryboardShot,
  DouyinTemplateAspect,
  DouyinTopicEntity,
  DouyinVideoAudioSetting,
} from '../entities/douyin-workbench.entity.js';
import { readDouyinVideoPlan } from './douyin-pixmax-video.service.js';
import {
  activeTemplateAspect,
  cropFrameToAspect,
  describeVideoAspect,
} from './douyin-video-template.js';
import {
  describeDirectionEn,
  freshShotDirection,
} from './douyin-video-director.js';
import {
  DouyinVideoStorageService,
  resolveStaticFilePath,
} from './douyin-video-storage.service.js';
import {
  DouyinWorkbenchRepositoryService,
  normalizeVideoAudio,
} from './douyin-workbench-repository.service.js';
import {
  DouyinVideoQueueService,
  readQueuedShotRequest,
  toVideoQueueView,
} from './douyin-video-queue.service.js';

type DouyinScope = { tenantId?: string; userId: string };
type OpensourceVideoShotMode = 'shot' | 'full';

/**
 * @description 后台跟进自建视频任务的间隔；服务端单卡串行，一段 5 秒视频约 1 分钟，15 秒轮询一次足够。
 * @keyword-cn 自建视频轮询间隔, 后台轮询
 * @keyword-en opensource-video-poll-interval, background-polling
 */
export const DOUYIN_OPENSOURCE_VIDEO_POLL_MS = 15 * 1000;

/**
 * @description 任务超过 6 小时仍未结束判为超时（单卡串行，排队很长时也不会超过这个量级）；保存中超过 10 分钟可由下一轮重新认领。
 * @keyword-cn 自建视频任务超时, 保存中断
 * @keyword-en opensource-video-task-timeout, saving-stale
 */
export const DOUYIN_OPENSOURCE_VIDEO_TASK_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DOUYIN_OPENSOURCE_VIDEO_SAVING_STALE_MS = 10 * 60 * 1000;
const DOUYIN_OPENSOURCE_VIDEO_SAVE_FAILED =
  '自建视频服务成片转存失败，请稍后同步状态重试。';
/** 图片 / 参考音频上限，与服务端 `VIDEO_API_MAX_IMAGE_MB` / `VIDEO_API_MAX_AUDIO_MB` 一致 */
const DOUYIN_OPENSOURCE_VIDEO_MEDIA_MAX_BYTES = 20 * 1024 * 1024;

/**
 * @description 一张参与生成的分镜画面，字段与整片提示词的参考图结构一致。
 * @keyword-cn 分镜首尾帧, 参考画面
 * @keyword-en shot-frame-image, reference-frame
 */
export interface DouyinOpensourceVideoFrame {
  imageId: number;
  url: string;
  name: string;
  shotIndexes: number[];
}

/**
 * @description 挑出首帧与尾帧：首帧是第一个配了图片的分镜，尾帧是最后一个配了图片、且与首帧不是同一张图的分镜（只在整片模式取尾帧）。
 * @keyword-cn 挑选首尾帧, 分镜画面
 * @keyword-en pick-first-last-frames, storyboard-images
 * @param shots 参与生成的分镜。
 * @param offset 单镜在完整分镜中的序号偏移。
 * @param withLast 是否取尾帧。
 * @returns 首帧与尾帧，没有图片时为空。
 */
export function pickOpensourceVideoFrames(
  shots: DouyinStoryboardShot[],
  offset: number,
  withLast: boolean,
): { first?: DouyinOpensourceVideoFrame; last?: DouyinOpensourceVideoFrame } {
  const framed = shots
    .map((shot, index) => ({ media: shot.media, index: offset + index }))
    .filter(
      ({ media }) =>
        media?.type === 'image' && Boolean(String(media.url ?? '').trim()),
    )
    .map(({ media, index }) => ({
      imageId: Number(media?.id),
      url: String(media?.url),
      name: media?.name || `image-${media?.id}.jpg`,
      shotIndexes: [index],
    }));
  const first = framed[0];
  const lastCandidate = framed[framed.length - 1];
  const last =
    withLast && lastCandidate && lastCandidate.imageId !== first?.imageId
      ? lastCandidate
      : undefined;
  return { first, last };
}

/** 声音设置里的语言写成 H3 提示词里的英文说法 */
const OPENSOURCE_VIDEO_SPEECH_LANGUAGES: Record<
  DouyinVideoAudioSetting['language'],
  string
> = {
  'zh-CN': 'Mandarin Chinese',
  yue: 'Cantonese',
  en: 'English',
};

/**
 * @description 自建 MiniMax-H3 提示词的 `Audio:` 行：静音写无声；仅音乐或没有口播时只要音乐和环境声；配音时把口播放在引号里按顺序各说一次，
 *   并明确「从第一秒开始说、口播前后与中间不说别的」——直连模型没有提示词改写，不写清楚会在开头补几个无意义音节。
 *   预设人物的音色句经 `toOpensourceVoiceHint` 转成英文：台词以外的中文会被直连模型念出来。
 * @keyword-cn 自建H3声音行, 口播引号
 * @keyword-en opensource-video-audio-line, quoted-narration
 * @param input 声音设置、按顺序的口播、预设人物音色句与是否压缩时长。
 * @returns {string} `Audio:` 行。
 */
export function buildOpensourceVideoAudioLine(input: {
  audio: DouyinVideoAudioSetting;
  quotes: string[];
  personaVoice?: string;
  clamped?: boolean;
}): string {
  if (input.audio.mode === 'mute')
    return 'Audio: complete silence, no voice, no music and no sound effects.';
  const quotes = input.quotes.map((item) => item.trim()).filter(Boolean);
  if (input.audio.mode === 'music' || !quotes.length)
    return 'Audio: only background music and ambient sound that match the mood; no voice, narration, dialogue or lyrics.';
  const language = OPENSOURCE_VIDEO_SPEECH_LANGUAGES[input.audio.language];
  // 台词以外的中文会被直连模型念出来，人物音色只给英文提示
  const voice = toOpensourceVoiceHint(input.personaVoice);
  return [
    `Audio: one narrator${voice ? ` (${voice})` : ''} says in ${language}, clearly and only once${quotes.length > 1 ? ', in this order' : ''}: ${quotes.map((item) => JSON.stringify(item)).join(' ')}`,
    `The speech starts right at the beginning and nothing else is said before, between or after these lines${input.clamped ? `; the narration may be shortened to fit the duration but stays in ${language}` : ''}`,
    `Soft background music that never covers the voice, no other languages.`,
  ].join(' ');
}

/**
 * @description 自建 MiniMax-H3 的单镜提示词，按官方模板格式写：风格一句 + 首帧说明（`<Picture 1>`）+ `Timeline: [0s-Ns]` 画面 + `Audio:` 口播。
 *   不写标题和「【视频】【口播稿】」这类中文指令段——直连模型会把它们当成台词念出来；有 AI 导演按首帧设计的英文运动时，时间轴用它代替中文画面描述。
 * @keyword-cn 自建H3分镜提示词, 原生提示词格式
 * @keyword-en opensource-shot-prompt, native-prompt-format
 * @param input 分镜、序号、是否带首帧、实际秒数、声音设置、预设人物音色句、补充要求、画面比例（套版式模板时为窗口比例，缺省竖屏 9:16）与 AI 导演的运动设计。
 * @returns {string} 提示词。
 */
export function buildOpensourceShotPrompt(input: {
  shot: DouyinStoryboardShot;
  index: number;
  hasImage: boolean;
  seconds: number;
  audio: DouyinVideoAudioSetting;
  personaVoice?: string;
  extra?: string;
  aspect?: DouyinTemplateAspect;
  direction?: DouyinShotDirection;
}): string {
  const { shot } = input;
  const motion = describeDirectionEn(input.direction);
  return [
    `Realistic live-action ${describeVideoAspect(input.aspect)} short video, shot ${input.index + 1}, ${shot.shotType || 'medium shot'}.`,
    input.hasImage
      ? 'The video starts exactly on <Picture 1>: keep its people, outfits, scene and colors, and bring it to life naturally.'
      : '',
    'Timeline:',
    `[0s-${input.seconds}s] ${motion ? `${motion}.` : String(shot.visual ?? '').trim()}`,
    buildOpensourceVideoAudioLine({
      audio: input.audio,
      quotes: [String(shot.narration ?? '')],
      personaVoice: input.personaVoice,
    }),
    'No subtitles, captions, text, logos or watermarks.',
    input.extra ? `Additional requirement: ${input.extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 自建 MiniMax-H3 的整片提示词：风格一句 + 首尾帧说明 + `Timeline:` 逐镜时间轴（每镜时长按「实际时长 / 分镜总时长」等比缩放）+ `Audio:` 口播。
 *   口播优先用各镜旁白（按时间轴顺序），没有时用脚本正文；不写标题和中文指令段。
 * @keyword-cn 自建H3整片提示词, 多镜头时间轴
 * @keyword-en opensource-full-prompt, multi-shot-timeline
 * @param input 脚本正文、全部分镜、实际秒数、生成方式（firstAndLastFrame / imageToVideo）、声音设置、预设人物音色句、补充要求、画面比例（套版式模板时为窗口比例，缺省竖屏 9:16）与各镜的 AI 导演运动设计（有英文运动时代替中文画面描述）。
 * @returns {string} 提示词。
 */
export function buildOpensourceFullPrompt(input: {
  script?: string;
  shots: DouyinStoryboardShot[];
  seconds: number;
  referModel?: string;
  audio: DouyinVideoAudioSetting;
  personaVoice?: string;
  extra?: string;
  aspect?: DouyinTemplateAspect;
  directions?: Array<DouyinShotDirection | undefined>;
}): string {
  const planned = input.shots.reduce(
    (sum, shot) => sum + (Number(shot.duration) || 0),
    0,
  );
  const scale = planned > 0 ? input.seconds / planned : 1;
  let cursor = 0;
  const timeline = input.shots.map((shot, index) => {
    const length = Math.max(
      1,
      Math.round((Number(shot.duration) || 1) * scale * 10) / 10,
    );
    const start = Math.round(cursor * 10) / 10;
    cursor += length;
    const end = Math.round(cursor * 10) / 10;
    const motion = describeDirectionEn(input.directions?.[index]);
    return `[${start}s-${end}s] Shot ${index + 1} (${shot.shotType || 'medium shot'}): ${motion ? `${motion}.` : String(shot.visual ?? '').trim()}${shot.transition ? ` Transition: ${shot.transition}.` : ''}`;
  });
  const narrations = input.shots
    .map((shot) => String(shot.narration ?? '').trim())
    .filter(Boolean);
  const quotes = narrations.length
    ? narrations
    : [String(input.script ?? '').trim()];
  return [
    `Realistic live-action ${describeVideoAspect(input.aspect)} short video, one continuous complete video of about ${input.seconds}s with hard cuts between shots.`,
    input.referModel === 'firstAndLastFrame'
      ? 'The video opens exactly on <Picture 1> and ends exactly on <Picture 2>; keep the people, outfits, scene and colors consistent.'
      : input.referModel === 'imageToVideo'
        ? 'The video opens exactly on <Picture 1>; the later shots keep its people, outfits, scene and colors.'
        : '',
    'Timeline:',
    ...timeline,
    buildOpensourceVideoAudioLine({
      audio: input.audio,
      quotes,
      personaVoice: input.personaVoice,
      clamped: scale < 1,
    }),
    'No subtitles, captions, text, logos or watermarks.',
    input.extra ? `Additional requirement: ${input.extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 按扩展名推断图片媒体类型，认不出按 JPEG。
 * @keyword-cn 图片媒体类型, 扩展名推断
 * @keyword-en image-content-type, extension-detection
 * @param url 图片地址。
 * @returns MIME 类型。
 */
function imageContentTypeOf(url: string): string {
  const extension = extname(String(url).split('?')[0]).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

/**
 * @description 下载公网素材并限制大小（先看 content-length，再看实际字节），读不到抛 `OPENSOURCE_VIDEO_<kind>_UNREADABLE`，过大抛 `OPENSOURCE_VIDEO_<kind>_TOO_LARGE`。
 * @keyword-cn 下载素材限大小, 公网素材读取
 * @keyword-en fetch-media-with-limit, remote-media-read
 * @param url 公网地址。
 * @param kind 素材类别（错误码里的 IMAGE / AUDIO）。
 * @returns 二进制与响应媒体类型。
 */
async function fetchOpensourceVideoMedia(
  url: string,
  kind: 'IMAGE' | 'AUDIO',
): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60 * 1000),
  }).catch((error: unknown) => {
    throw new Error(
      `OPENSOURCE_VIDEO_${kind}_UNREADABLE:${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!response.ok)
    throw new Error(`OPENSOURCE_VIDEO_${kind}_UNREADABLE:${response.status}`);
  if (
    Number(response.headers.get('content-length')) >
    DOUYIN_OPENSOURCE_VIDEO_MEDIA_MAX_BYTES
  )
    throw new Error(`OPENSOURCE_VIDEO_${kind}_TOO_LARGE`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > DOUYIN_OPENSOURCE_VIDEO_MEDIA_MAX_BYTES)
    throw new Error(`OPENSOURCE_VIDEO_${kind}_TOO_LARGE`);
  return {
    buffer,
    contentType: response.headers.get('content-type')?.split(';')[0] || '',
  };
}

/**
 * @description 把图片转成 data URL 交给自建视频服务（它不收图片地址）：已是 data URL 原样返回，公网地址下载后编码（上限 20MB），站内 `/static` 图片从磁盘读取。
 *   分镜 / 整片通道与探店分段共用。
 * @keyword-cn 分镜画面转Base64, 首帧图片输入
 * @keyword-en image-to-data-url, first-frame-input
 * @param url 图库地址、公网地址或 data URL。
 * @returns {Promise<string>} data URL。
 * @throws {Error} 读不到抛 `OPENSOURCE_VIDEO_IMAGE_UNREADABLE`，过大抛 `OPENSOURCE_VIDEO_IMAGE_TOO_LARGE`。
 */
export async function toOpensourceVideoImageData(url: string): Promise<string> {
  const clean = String(url ?? '').trim();
  if (/^data:image\//i.test(clean)) return clean;
  if (/^https?:\/\//i.test(clean)) {
    const media = await fetchOpensourceVideoMedia(clean, 'IMAGE');
    return `data:${media.contentType || imageContentTypeOf(clean)};base64,${media.buffer.toString('base64')}`;
  }
  const filePath = resolveStaticFilePath(clean);
  if (!filePath) throw new Error(`OPENSOURCE_VIDEO_IMAGE_UNREADABLE:${clean}`);
  const buffer = await readFile(filePath);
  return `data:${imageContentTypeOf(clean)};base64,${buffer.toString('base64')}`;
}

/**
 * @description 把参考音频转成 data URL 交给自建视频服务：已有字节（如百炼合成的 WAV）直接编码，否则公网地址下载、站内 `/static` 文件读盘，上限 20MB。
 * @keyword-cn 参考音频转Base64, 音色参考输入
 * @keyword-en audio-to-data-url, voice-reference-input
 * @param source 音频地址与可选的已有字节。
 * @returns {Promise<string>} data URL。
 * @throws {Error} 读不到抛 `OPENSOURCE_VIDEO_AUDIO_UNREADABLE`，过大抛 `OPENSOURCE_VIDEO_AUDIO_TOO_LARGE`。
 */
export async function toOpensourceVideoAudioData(source: {
  url: string;
  buffer?: Buffer;
}): Promise<string> {
  const clean = String(source.url ?? '').trim();
  let buffer = source.buffer?.length ? source.buffer : undefined;
  let contentType = '';
  if (!buffer && /^https?:\/\//i.test(clean)) {
    const media = await fetchOpensourceVideoMedia(clean, 'AUDIO');
    buffer = media.buffer;
    contentType = media.contentType;
  }
  if (!buffer) {
    const filePath = resolveStaticFilePath(clean);
    if (!filePath)
      throw new Error(`OPENSOURCE_VIDEO_AUDIO_UNREADABLE:${clean}`);
    buffer = await readFile(filePath);
  }
  if (buffer.length > DOUYIN_OPENSOURCE_VIDEO_MEDIA_MAX_BYTES)
    throw new Error('OPENSOURCE_VIDEO_AUDIO_TOO_LARGE');
  return `data:${contentType.startsWith('audio/') ? contentType : 'audio/wav'};base64,${buffer.toString('base64')}`;
}

/**
 * @description 抖音视频生成的自建 MiniMax-H3 通道：分镜或整片提交到 GPU 服务器上的视频接口、持久化调用记录、后台轮询，
 *   成功后带 Key 下载成片存进视频库并回填分镜或整片。分镜 / 整片只用首帧 / 尾帧；探店分段走参考生视频，由探店服务自己提交。
 * @keyword-cn 自建H3生视频, 成片转存, 分镜视频
 * @keyword-en opensource-video-generation, persist-generated-video, shot-video
 */
@Injectable()
export class DouyinOpensourceVideoService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DouyinOpensourceVideoService.name);
  private readonly operations: Collection<DouyinOperationEntity>;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly repository: DouyinWorkbenchRepositoryService,
    private readonly personas: DouyinPersonaRepositoryService,
    private readonly billing: AiBillingService,
    private readonly adminService: AdminService,
    private readonly client: OpensourceVideoClientService,
    private readonly storage: DouyinVideoStorageService,
    private readonly videoQueue: DouyinVideoQueueService,
  ) {
    this.operations = db.collection<DouyinOperationEntity>('douyin_operations');
    this.videoQueue.register(
      'opensource-video',
      ({ row, topic, runtime, scope }) =>
        this.start({
          topic,
          ...readQueuedShotRequest(row),
          runtime,
          scope,
          operationId: row.id,
        }),
    );
  }

  /**
   * @description 启动后台轮询，服务重启后继续跟进未结束记录；多进程时只在 leader 进程上轮询。
   * @keyword-cn 启动自建视频轮询, 重启续跟
   * @keyword-en start-opensource-video-polling, resume-after-restart
   */
  onModuleInit(): void {
    if (!isLeaderProcess()) return;
    this.timer = setInterval(
      () => void this.pollOnce(),
      DOUYIN_OPENSOURCE_VIDEO_POLL_MS,
    );
    this.timer.unref?.();
  }

  /**
   * @description 停止后台轮询。
   * @keyword-cn 停止自建视频轮询, 模块销毁
   * @keyword-en stop-opensource-video-polling, module-destroy
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @description 提交一次自建视频生成：模型编码决定档位（turbo / fast / quality），时长夹到 1～15 秒，清晰度收敛到 544P / 672P；
   *   分镜以这一镜的画面为首帧，整片以第一镜画面为首帧、最后一镜画面为尾帧；有首帧时画幅跟随首帧，否则竖屏 9:16。
   *   先按生视频服务扣费再提交，提交失败写一条失败记录并抛出中文说明。
   *   扣费前按模型申请并发名额，满了存成排队记录直接返回；`operationId` 有值表示从排队里提交（已拿到名额），结果改写那条记录。
   * @keyword-cn 提交自建视频, 首尾帧生成
   * @keyword-en submit-opensource-video, first-last-frame-generation
   * @param input 脚本、模式、单镜 ID、补充要求、节点运行配置、作用域与排队记录 ID。
   * @returns {Promise<DouyinOperationView>} 调用记录。
   */
  async start(input: {
    topic: DouyinTopicEntity;
    mode: OpensourceVideoShotMode;
    shotId?: string;
    prompt?: string;
    runtime: WorkflowNodeRuntime;
    scope: DouyinScope;
    operationId?: string;
  }): Promise<DouyinOperationView> {
    const { topic, mode, runtime, scope } = input;
    const generationMode = resolveOpensourceVideoMode(runtime.model);
    if (!generationMode) {
      throw new BadRequestException(
        describeOpensourceVideoFailure(
          `OPENSOURCE_VIDEO_MODEL_NOT_SUPPORTED:${runtime.model}`,
        ),
      );
    }
    if (!String(runtime.apiKey ?? '').trim()) {
      throw new BadRequestException(
        describeOpensourceVideoFailure(
          'OPENSOURCE_VIDEO_API_KEY_NOT_CONFIGURED',
        ),
      );
    }
    if (!String(runtime.baseUrl ?? '').trim()) {
      throw new BadRequestException(
        describeOpensourceVideoFailure(
          'OPENSOURCE_VIDEO_BASE_URL_NOT_CONFIGURED',
        ),
      );
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
    // 整片没设定时长时用服务能生成的最长时长；单镜按这一镜自己的时长
    const chosenSeconds =
      mode === 'full'
        ? Number(topic.fullVideoDuration) > 0
          ? Number(topic.fullVideoDuration)
          : Math.max(...listOpensourceVideoDurationChoices())
        : undefined;
    const duration = clampOpensourceVideoDuration(
      chosenSeconds ?? plannedSeconds,
    );
    const chosenResolution = String(
      (mode === 'full'
        ? topic.fullVideoResolution
        : topic.shotVideoResolution) ?? '',
    ).trim();
    const resolution = clampOpensourceVideoResolution(chosenResolution);
    const audio = normalizeVideoAudio(topic.videoAudio);
    const persona = topic.personaId
      ? await this.personas.get(topic.personaId, scope)
      : null;
    const personaVoice = buildPersonaVoiceSection(persona);
    const frames = pickOpensourceVideoFrames(
      shots,
      mode === 'shot' ? shotIndex : 0,
      mode === 'full',
    );
    const usedImages = [frames.first, frames.last].filter(
      (frame): frame is DouyinOpensourceVideoFrame => Boolean(frame),
    );
    // 套了版式模板时按窗口比例出片，首尾帧先居中裁成同一比例，免得模型拉伸画面
    const templateAspect = activeTemplateAspect(topic.videoTemplate);
    const referModel = frames.last
      ? 'firstAndLastFrame'
      : frames.first
        ? 'imageToVideo'
        : undefined;
    // 直连模型没有数眼 / PixMax 那层提示词改写，用 H3 原生格式，否则会把中文指令段念出来
    const prompt = (
      mode === 'shot'
        ? buildOpensourceShotPrompt({
            shot: shots[0],
            index: shotIndex,
            hasImage: usedImages.length > 0,
            seconds: duration,
            audio,
            personaVoice,
            extra,
            aspect: templateAspect,
            direction: freshShotDirection(topic, shots[0].id),
          })
        : buildOpensourceFullPrompt({
            script: topic.script,
            shots,
            seconds: duration,
            referModel,
            audio,
            personaVoice,
            extra,
            aspect: templateAspect,
            directions: shots.map((shot) => freshShotDirection(topic, shot.id)),
          })
    ).slice(0, OPENSOURCE_VIDEO_PROMPT_MAX);
    const aspectRatio =
      templateAspect ?? (frames.first ? ('auto' as const) : ('9:16' as const));
    const toFrame = async (url: string) => {
      const data = await toOpensourceVideoImageData(url);
      return templateAspect
        ? await cropFrameToAspect(data, templateAspect)
        : data;
    };
    const operationId = input.operationId ?? randomUUID();
    const fromQueue = Boolean(input.operationId);
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
      generationMode,
      referModel,
      duration,
      plannedSeconds,
      targetSeconds: chosenSeconds,
      durationClamped: duration < plannedSeconds,
      imageIds: usedImages.map((image) => image.imageId),
      audio,
      scriptIncluded,
      prompt,
      resolution: resolution.label,
      megapixels: resolution.megapixels,
      targetResolution: chosenResolution || undefined,
      resolutionClamped: Boolean(
        chosenResolution && chosenResolution.toUpperCase() !== resolution.label,
      ),
      ratio: aspectRatio,
      template: Boolean(templateAspect),
    };
    const base = {
      operation: 'generate' as const,
      topicId: topic.id,
      shotId: mode === 'shot' ? input.shotId : undefined,
      provider: 'opensource-video' as const,
      mode,
      model: runtime.model,
      providerId: runtime.providerId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      request,
    };

    // 模型并发满了先排队，轮到时再扣费提交
    if (!fromQueue && !(await this.videoQueue.admit(runtime, operationId)))
      return this.toView(
        await this.videoQueue.enqueue(
          { id: operationId, ...base },
          { prompt: input.prompt },
        ),
      );
    await this.billing
      .chargeService({
        serviceCode: 'video-generation',
        tenantId: scope.tenantId,
        userId: scope.userId,
        operationId,
        source:
          mode === 'shot'
            ? 'douyin-workbench.shot-video-generation'
            : 'douyin-workbench.full-video-generation',
        platformScope: !scope.tenantId,
      })
      .catch((error) => this.videoQueue.releaseAndThrow(operationId, error));
    const now = new Date();
    try {
      const job = await this.client.createVideo(runtime, {
        prompt,
        duration,
        aspect_ratio: aspectRatio,
        megapixels: resolution.megapixels,
        mode: generationMode,
        first_frame: frames.first ? await toFrame(frames.first.url) : undefined,
        last_frame: frames.last ? await toFrame(frames.last.url) : undefined,
      });
      const externalId = String(job.id ?? '').trim();
      if (!externalId) throw new Error('OPENSOURCE_VIDEO_TASK_ID_MISSING');
      const doc: DouyinOperationEntity = {
        _id: new ObjectId(),
        id: operationId,
        ...base,
        status: mapOpensourceVideoStatus(job.status),
        progress: 0,
        externalId,
        result: job,
        createdAt: now,
        updatedAt: now,
      };
      await this.videoQueue.save(doc, fromQueue);
      setTimeout(() => void this.pollOnce(), 10 * 1000).unref?.();
      return this.toView(doc);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const friendly = describeOpensourceVideoFailure(detail);
      await this.videoQueue.save(
        {
          _id: new ObjectId(),
          id: operationId,
          ...base,
          status: 'failed',
          error: friendly,
          errorDetail: detail,
          createdAt: now,
          updatedAt: now,
        },
        fromQueue,
      );
      await this.videoQueue.release(operationId);
      throw new BadGatewayException(friendly);
    }
  }

  /**
   * @description 立即同步一条自建视频调用（分镜 / 整片；探店分段由探店服务同步），供前端手动刷新；查询失败时抛中文说明。
   * @keyword-cn 同步自建视频调用, 手动刷新
   * @keyword-en sync-opensource-video-operation, manual-refresh
   * @param id 调用记录 ID。
   * @returns {Promise<DouyinOperationView>} 最新记录。
   */
  async refresh(id: string): Promise<DouyinOperationView> {
    const row = await this.operations.findOne({
      id,
      provider: 'opensource-video',
      mode: { $ne: 'store-visit' },
    });
    if (!row) throw new BadRequestException('DOUYIN_OPERATION_NOT_FOUND');
    try {
      await this.refreshRow(row);
    } catch (error) {
      throw new BadGatewayException(
        describeOpensourceVideoFailure(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    const latest = await this.operations.findOne({ id });
    return this.toView(latest ?? row);
  }

  /**
   * @description 跟进一轮未结束的自建视频任务，同一进程内不重入；探店分段（`mode=store-visit`）由探店服务自己跟进；单条跟进失败（多为网络）只记日志，下一轮再试。
   * @keyword-cn 轮询自建视频调用, 防重入
   * @keyword-en poll-opensource-video-operations, reentry-guard
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const rows = await this.operations
        .find({
          provider: 'opensource-video',
          mode: { $ne: 'store-visit' },
          queue: { $exists: false },
          $or: [
            { status: { $in: ['queued', 'running'] } },
            {
              status: 'saving',
              updatedAt: {
                $lt: new Date(
                  Date.now() - DOUYIN_OPENSOURCE_VIDEO_SAVING_STALE_MS,
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
            `[pollOnce] 自建视频任务跟进失败 operation=${row.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * @description 查询并推进一条任务：服务端已失败或任务不存在（404）收敛为失败；未结束时更新状态与排队进度，超过 6 小时判超时；
   *   成功时认领保存权，带 Key 下载成片到临时文件、存进视频库并回填分镜或整片，转存失败可在手动同步时重试。
   * @keyword-cn 推进自建视频调用, 完成转存
   * @keyword-en advance-opensource-video-operation, save-on-complete
   * @param row 调用记录。
   */
  private async refreshRow(row: DouyinOperationEntity): Promise<void> {
    // 还在等模型空位，没提交过
    if (row.queue) return;
    if (!row.externalId) {
      await this.fail(row.id, '自建视频服务任务 ID 缺失。');
      return;
    }
    const runtime = row.providerId
      ? await this.adminService.getAiProviderRuntimeById(row.providerId)
      : null;
    if (!runtime) {
      await this.fail(
        row.id,
        '自建视频服务提供商已删除或停用，无法继续查询这次生成。',
      );
      return;
    }
    let job: OpensourceVideoJob;
    try {
      job = await this.client.getVideo(runtime, row.externalId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/OPENSOURCE_VIDEO_HTTP_404/.test(detail)) {
        await this.fail(row.id, describeOpensourceVideoFailure(detail), detail);
        return;
      }
      throw error;
    }
    const mapped = mapOpensourceVideoStatus(job.status);
    if (mapped === 'failed') {
      await this.fail(
        row.id,
        describeOpensourceVideoFailure(String(job.error ?? '')),
        String(job.error ?? job.status),
      );
      return;
    }
    if (mapped !== 'completed') {
      if (
        Date.now() - new Date(row.createdAt).getTime() >
        DOUYIN_OPENSOURCE_VIDEO_TASK_TIMEOUT_MS
      ) {
        await this.fail(
          row.id,
          '自建视频服务任务超过 6 小时仍未完成，已判定超时。',
        );
        return;
      }
      await this.operations.updateOne(
        { id: row.id, status: { $in: ['queued', 'running'] } },
        {
          $set: {
            status: mapped,
            progress: mapped === 'running' ? 50 : 0,
            result: job,
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
          { status: 'failed', error: DOUYIN_OPENSOURCE_VIDEO_SAVE_FAILED },
          {
            status: 'saving',
            updatedAt: {
              $lt: new Date(
                Date.now() - DOUYIN_OPENSOURCE_VIDEO_SAVING_STALE_MS,
              ),
            },
          },
        ],
      },
      { $set: { status: 'saving', progress: 100, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!claimed) return;
    const target = join(tmpdir(), `opensource-video-${randomUUID()}.mp4`);
    try {
      await this.client.downloadVideo(runtime, row.externalId, target);
      const scope = { tenantId: row.tenantId, userId: row.userId };
      const topic = await this.repository.get(row.topicId, scope);
      const shotIndex = row.shotId
        ? (topic?.storyboard ?? []).findIndex((shot) => shot.id === row.shotId)
        : -1;
      const name = `${topic?.title ?? `脚本 ${row.topicId}`} ${row.mode === 'shot' ? `第 ${shotIndex + 1} 镜` : '整片'}`;
      const video = await this.storage.saveFile(target, {
        name,
        scope,
        tags: [
          row.mode === 'shot' ? '抖音分镜视频' : '抖音整片视频',
          'AI生成',
          '自建MiniMax-H3',
        ],
        durationSeconds: Number(job.duration) || undefined,
        width: Number(job.width) || undefined,
        height: Number(job.height) || undefined,
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
            result: { ...job, videoId: video.id, videoUrl: video.url },
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
      await this.fail(row.id, DOUYIN_OPENSOURCE_VIDEO_SAVE_FAILED, detail);
    } finally {
      await unlink(target).catch(() => undefined);
    }
  }

  /**
   * @description 把调用收敛到失败终态，保存用户说明与原始详情。
   * @keyword-cn 自建视频失败收敛, 原始错误
   * @keyword-en fail-opensource-video-operation, raw-error-detail
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
   * @description 返回调用记录的前端安全视图（不含请求正文）。
   * @keyword-cn 自建视频调用视图, 隐藏请求
   * @keyword-en opensource-video-operation-view, hide-request
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
      queue: toVideoQueueView(row.queue),
      result: row.result,
      error: row.error,
      errorDetail: row.errorDetail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
