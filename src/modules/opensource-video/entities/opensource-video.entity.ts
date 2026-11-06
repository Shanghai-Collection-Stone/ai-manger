/**
 * @description 自建 MiniMax-H3 视频服务（opensource-video 项目部署在 GPU 服务器上的 HTTP 接口）在后台「Ai提供商设置」里的提供商代码。
 * @keyword-cn 自建视频提供商代码, 提供商识别
 * @keyword-en opensource-video-provider-code, provider-code
 */
export const OPENSOURCE_VIDEO_PROVIDER_CODE = 'opensource-video';

/**
 * @description 调用自建视频服务所需的连接信息：Base URL 填平台映射地址（如 `https://xxx.region1.waas.aigate.cc`），Key 为服务端 `.env` 里的 `VIDEO_API_KEY`。
 * @keyword-cn 自建视频连接信息, 提供商凭证
 * @keyword-en opensource-video-runtime, provider-credential
 */
export interface OpensourceVideoRuntime {
  baseUrl?: string;
  apiKey?: string;
}

/**
 * @description 服务端生成档位：`turbo` 8 步加速（默认），`fast` 4 步（音频有杂音，只适合预览），`quality` 20 步无加速。
 * @keyword-cn 自建视频生成档位, 采样步数
 * @keyword-en opensource-video-mode, sampling-steps
 */
export type OpensourceVideoMode = 'fast' | 'turbo' | 'quality';

/**
 * @description 后台节点可选的模型：模型编码对应服务端 `mode`，节点下拉只能从这里选。
 * @keyword-cn 自建视频模型目录, 节点可选模型
 * @keyword-en opensource-video-models, node-model-options
 */
export const OPENSOURCE_VIDEO_MODELS: ReadonlyArray<{
  code: string;
  name: string;
  mode: OpensourceVideoMode;
}> = [
  {
    code: 'minimax-h3-turbo',
    name: 'MiniMax-H3 Turbo（8 步加速，默认）',
    mode: 'turbo',
  },
  {
    code: 'minimax-h3-fast',
    name: 'MiniMax-H3 Fast（4 步，音频有杂音，只适合预览）',
    mode: 'fast',
  },
  {
    code: 'minimax-h3-quality',
    name: 'MiniMax-H3 Quality（20 步，最慢）',
    mode: 'quality',
  },
];

/**
 * @description 清晰度档位与服务端 `megapixels` 的对照（按清晰度升序）：544P 即 0.5MP（竖屏 544x960，加速 LoRA 训练分辨率，默认档），672P 即 0.8MP（672x1216）。
 * @keyword-cn 自建视频清晰度档位, 像素量对照
 * @keyword-en opensource-video-resolutions, megapixels-mapping
 */
export const OPENSOURCE_VIDEO_RESOLUTIONS: ReadonlyArray<{
  label: string;
  megapixels: number;
}> = [
  { label: '544P', megapixels: 0.5 },
  { label: '672P', megapixels: 0.8 },
];

/**
 * @description 服务端单条视频的时长范围（秒）。
 * @keyword-cn 自建视频时长范围, 最长时长
 * @keyword-en opensource-video-duration-range, max-duration
 */
export const OPENSOURCE_VIDEO_DURATION_RANGE = { min: 1, max: 15 } as const;

/**
 * @description 服务端提示词长度上限（字符）。
 * @keyword-cn 自建视频提示词上限, 提示词截断
 * @keyword-en opensource-video-prompt-max, prompt-truncate
 */
export const OPENSOURCE_VIDEO_PROMPT_MAX = 8000;

/**
 * @description 参考生视频的素材上限（服务端 MiniMaxH3ReferenceToVideo 的 ref_images / ref_audios 上限）。
 * @keyword-cn 参考素材上限, 参考生视频
 * @keyword-en opensource-video-reference-limits, reference-to-video
 */
export const OPENSOURCE_VIDEO_REFERENCE_LIMITS = {
  images: 9,
  audios: 3,
} as const;

/**
 * @description `POST /v1/videos` 请求体，字段名与服务端逐字一致；图片与音频都是 data URL 或纯 base64。
 *   首尾帧（图生视频）与参考图 / 参考音频（参考生视频，提示词里用 `<Picture i>` / `<Audio j>` 指代）二选一。
 * @keyword-cn 自建视频提交参数, 首尾帧
 * @keyword-en opensource-video-create-input, first-last-frame
 */
export interface OpensourceVideoCreateInput {
  prompt: string;
  duration: number;
  aspect_ratio: 'auto' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  megapixels: number;
  mode: OpensourceVideoMode;
  seed?: number;
  first_frame?: string;
  last_frame?: string;
  reference_images?: string[];
  reference_audios?: string[];
  /** @description 完整台词配音，从第 0 帧锚定画面与嘴型，并作为成片音轨。 */
  guide_audio?: string;
}

/**
 * @description 服务端任务状态原值。
 * @keyword-cn 自建视频任务状态, 状态枚举
 * @keyword-en opensource-video-job-status, status-enum
 */
export type OpensourceVideoJobStatus =
  'queued' | 'running' | 'succeeded' | 'failed';

/**
 * @description 服务端任务视图（`POST /v1/videos` 与 `GET /v1/videos/{id}` 的响应）；`queue_position` 只在排队或执行中出现，`video_url` 只在成功后出现。
 * @keyword-cn 自建视频任务, 任务详情
 * @keyword-en opensource-video-job, job-detail
 */
export interface OpensourceVideoJob {
  id: string;
  status: OpensourceVideoJobStatus;
  mode?: OpensourceVideoMode;
  seed?: number;
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  duration?: number;
  has_first_frame?: boolean;
  has_last_frame?: boolean;
  reference_images?: number;
  reference_audios?: number;
  has_guide_audio?: boolean;
  created_at?: string;
  finished_at?: string | null;
  queue_position?: number | null;
  error?: string | null;
  video_url?: string | null;
}
