import {
  OPENSOURCE_VIDEO_DURATION_RANGE,
  OPENSOURCE_VIDEO_MODELS,
  OPENSOURCE_VIDEO_PROVIDER_CODE,
  OPENSOURCE_VIDEO_RESOLUTIONS,
  type OpensourceVideoMode,
} from '../entities/opensource-video.entity.js';

/**
 * @description 判断提供商代码是否自建 MiniMax-H3 视频服务（大小写与首尾空格不限）。
 * @keyword-cn 自建视频识别, 提供商代码
 * @keyword-en is-opensource-video-provider, provider-code
 * @param providerCode 后台提供商代码。
 * @returns {boolean} 是否自建视频服务。
 */
export function isOpensourceVideoProvider(providerCode?: string): boolean {
  return (
    String(providerCode ?? '')
      .trim()
      .toLowerCase() === OPENSOURCE_VIDEO_PROVIDER_CODE
  );
}

/**
 * @description 节点模型编码换成服务端生成档位，不在 `OPENSOURCE_VIDEO_MODELS` 里返回 null。
 * @keyword-cn 解析生成档位, 模型编码
 * @keyword-en resolve-opensource-video-mode, model-code
 * @param model 节点模型编码。
 * @returns {OpensourceVideoMode|null} 生成档位。
 */
export function resolveOpensourceVideoMode(
  model?: string,
): OpensourceVideoMode | null {
  const code = String(model ?? '')
    .trim()
    .toLowerCase();
  return (
    OPENSOURCE_VIDEO_MODELS.find((item) => item.code === code)?.mode ?? null
  );
}

/**
 * @description 可选的整数秒数（1～15 秒）。
 * @keyword-cn 自建视频可选时长, 时长范围
 * @keyword-en opensource-video-duration-choices, duration-range
 * @returns {number[]} 升序秒数。
 */
export function listOpensourceVideoDurationChoices(): number[] {
  const { min, max } = OPENSOURCE_VIDEO_DURATION_RANGE;
  return Array.from({ length: max - min + 1 }, (_unused, index) => min + index);
}

/**
 * @description 把计划秒数四舍五入并夹到 1～15 秒；非数字或不大于 0 时取最短 1 秒。
 * @keyword-cn 自建视频时长收敛, 视频时长
 * @keyword-en clamp-opensource-video-duration, video-duration
 * @param seconds 计划秒数。
 * @returns {number} 可提交的整数秒数。
 */
export function clampOpensourceVideoDuration(seconds: number): number {
  const { min, max } = OPENSOURCE_VIDEO_DURATION_RANGE;
  const rounded = Math.round(Number(seconds));
  if (!Number.isFinite(rounded) || rounded < min) return min;
  return Math.min(max, rounded);
}

/**
 * @description 可选清晰度档位写法（升序）。
 * @keyword-cn 自建视频可选清晰度, 清晰度档位
 * @keyword-en opensource-video-resolution-choices, resolution-tiers
 * @returns {string[]} 档位。
 */
export function listOpensourceVideoResolutionChoices(): string[] {
  return OPENSOURCE_VIDEO_RESOLUTIONS.map((item) => item.label);
}

/**
 * @description 把设定的清晰度（`720p`、`1080P`、`2K` 等任意写法）收敛到服务端档位：完全一致直接用，认得出短边像素时就近取，
 *   没设定或认不出时用最低档 544P（与加速 LoRA 训练分辨率一致、最快）。
 * @keyword-cn 自建视频清晰度收敛, 就近取档
 * @keyword-en clamp-opensource-video-resolution, nearest-tier
 * @param resolution 设定的清晰度，空表示跟随默认档。
 * @returns 档位写法与对应的 megapixels。
 */
export function clampOpensourceVideoResolution(resolution?: string): {
  label: string;
  megapixels: number;
} {
  const fallback = OPENSOURCE_VIDEO_RESOLUTIONS[0];
  const want = String(resolution ?? '')
    .trim()
    .toUpperCase();
  if (!want) return { ...fallback };
  const exact = OPENSOURCE_VIDEO_RESOLUTIONS.find(
    (item) => item.label === want,
  );
  if (exact) return { ...exact };
  const progressive = /^(\d+)P$/.exec(want);
  const height = progressive
    ? Number(progressive[1])
    : want === '2K'
      ? 1440
      : want === '4K'
        ? 2160
        : 0;
  if (!height) return { ...fallback };
  const nearest = OPENSOURCE_VIDEO_RESOLUTIONS.reduce((best, item) =>
    Math.abs(parseInt(item.label, 10) - height) <
    Math.abs(parseInt(best.label, 10) - height)
      ? item
      : best,
  );
  return { ...nearest };
}

/** 中文音色描述里的关键词 → 英文说法（按顺序取，每组只取第一个命中） */
const VOICE_HINT_RULES: ReadonlyArray<{
  slot: 'age' | 'texture' | 'gender' | 'accent' | 'style' | 'pace';
  pattern: RegExp;
  text: string;
}> = [
  { slot: 'age', pattern: /二十|20多|年轻|青年|小伙|少年|少女/, text: 'young' },
  {
    slot: 'age',
    pattern: /三十|四十|中年|成熟|大哥|大叔|大姐/,
    text: 'mature',
  },
  { slot: 'age', pattern: /年长|老年|阅历|大爷|奶奶/, text: 'elderly' },
  { slot: 'texture', pattern: /低音|浑厚|低沉/, text: 'deep' },
  { slot: 'texture', pattern: /沙哑/, text: 'slightly husky' },
  { slot: 'texture', pattern: /清亮|清脆|明亮|干脆/, text: 'bright' },
  { slot: 'texture', pattern: /温柔|轻柔|柔和/, text: 'soft' },
  { slot: 'texture', pattern: /中气足|洪亮|响亮/, text: 'strong' },
  { slot: 'gender', pattern: /女/, text: 'female' },
  { slot: 'gender', pattern: /男/, text: 'male' },
  { slot: 'accent', pattern: /东北/, text: 'Northeastern Chinese accent' },
  { slot: 'accent', pattern: /四川|川渝|重庆/, text: 'Sichuan accent' },
  { slot: 'accent', pattern: /粤语|广东|港/, text: 'Cantonese accent' },
  { slot: 'accent', pattern: /台湾/, text: 'Taiwanese accent' },
  { slot: 'accent', pattern: /北京|京腔|京片子/, text: 'Beijing accent' },
  { slot: 'accent', pattern: /天津/, text: 'Tianjin accent' },
  { slot: 'accent', pattern: /上海/, text: 'Shanghai accent' },
  { slot: 'accent', pattern: /山东/, text: 'Shandong accent' },
  { slot: 'accent', pattern: /河南/, text: 'Henan accent' },
  { slot: 'accent', pattern: /湖南/, text: 'Hunan accent' },
  { slot: 'accent', pattern: /陕西/, text: 'Shaanxi accent' },
  {
    slot: 'style',
    pattern: /豪爽|直率|爽朗|大大咧咧/,
    text: 'hearty and straightforward',
  },
  { slot: 'style', pattern: /活泼|元气|俏皮/, text: 'lively' },
  { slot: 'style', pattern: /沉稳|稳重|冷静/, text: 'calm and steady' },
  { slot: 'style', pattern: /亲切|温暖|热情/, text: 'warm and friendly' },
  { slot: 'style', pattern: /幽默|搞笑|逗/, text: 'humorous' },
  { slot: 'pace', pattern: /语速偏快|语速快|快语速/, text: 'fast pace' },
  { slot: 'pace', pattern: /语速偏慢|语速慢|慢条斯理/, text: 'slow pace' },
];

/**
 * @description 把中文音色描述（预设音色句、用户写的音色提示词、预设人物音色句）按关键词转成英文提示，如「young deep male voice, Northeastern Chinese accent, hearty and straightforward」。
 *   直连 MiniMax-H3 会把提示词里台词以外的中文念出来（实测念出「自然口语」「老铁们」），所以音色只给英文；认不出任何关键词时返回空串。
 * @keyword-cn 音色英文提示, 中文音色转换
 * @keyword-en voice-hint-english, chinese-voice-convert
 * @param description 中文音色描述。
 * @returns {string} 英文音色提示，可能为空串。
 */
export function toOpensourceVoiceHint(description?: string): string {
  const text = String(description ?? '');
  const picked = new Map<string, string>();
  const texture: string[] = [];
  for (const rule of VOICE_HINT_RULES) {
    if (!rule.pattern.test(text)) continue;
    if (rule.slot === 'texture') {
      if (texture.length < 3) texture.push(rule.text);
    } else if (!picked.has(rule.slot)) picked.set(rule.slot, rule.text);
  }
  const head = [picked.get('age'), ...texture, picked.get('gender')]
    .filter(Boolean)
    .join(' ');
  return [
    head ? `${head} voice` : '',
    picked.get('accent'),
    picked.get('style'),
    picked.get('pace'),
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * @description 服务端任务状态映射成抖音工作台统一状态：succeeded → completed，failed → failed，running → running，其余（含 queued）视为排队。
 * @keyword-cn 自建视频状态映射, 工作台状态
 * @keyword-en map-opensource-video-status, workbench-status
 * @param status 服务端状态。
 * @returns {'queued'|'running'|'completed'|'failed'} 工作台状态。
 */
export function mapOpensourceVideoStatus(
  status?: string,
): 'queued' | 'running' | 'completed' | 'failed' {
  const value = String(status ?? '')
    .trim()
    .toLowerCase();
  if (value === 'succeeded') return 'completed';
  if (value === 'failed') return 'failed';
  if (value === 'running') return 'running';
  return 'queued';
}

/**
 * @description 自建视频服务的错误说明对照：配置缺失、分镜画面或参考声音过大 / 读不到、缺任务 ID、模型编码不认识、Key 无效、任务不存在、参数或素材不合格、ComfyUI 不可用、网络不通。
 *   图片 / 音频类规则排在网络规则前面，因为素材下载失败的原文里也会带 `fetch failed`。
 * @keyword-cn 自建视频错误对照, 通道错误
 * @keyword-en opensource-video-error-rules, channel-error
 */
export const OPENSOURCE_VIDEO_ERROR_RULES: ReadonlyArray<{
  pattern: RegExp;
  message: string;
}> = [
  {
    pattern: /OPENSOURCE_VIDEO_API_KEY_NOT_CONFIGURED/,
    message:
      '自建视频服务的 API Key 还没有配置，请到后台「Ai提供商设置」里填写（服务器 .env 里的 VIDEO_API_KEY）。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_BASE_URL_NOT_CONFIGURED/,
    message:
      '自建视频服务的 Base URL 还没有配置，请到后台「Ai提供商设置」里填写 GPU 服务器的映射地址。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_IMAGE_TOO_LARGE/,
    message: '分镜画面超过 20MB，请换一张小一点的图片后重试。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_IMAGE_UNREADABLE/,
    message: '读不到分镜画面，请重新选择或生成这一镜的画面后重试。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_AUDIO_TOO_LARGE/,
    message: '参考声音超过 20MB，请换一段短一点的录音后重试。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_AUDIO_UNREADABLE/,
    message: '读不到参考声音，请重新录制或重新生成音色后重试。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_TASK_ID_MISSING/,
    message: '自建视频服务没有返回任务 ID，请稍后重试。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_MODEL_NOT_SUPPORTED/,
    message:
      '自建视频服务不认识这个模型，请到后台「工作流节点模型」改选 minimax-h3-turbo、minimax-h3-fast 或 minimax-h3-quality。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_HTTP_40[13]/,
    message:
      '自建视频服务的 API Key 无效，请到后台「Ai提供商设置」里检查（服务器换过 Key 时要同步更新）。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_HTTP_404/,
    message:
      '自建视频服务上找不到这次任务（可能换了服务器或映射地址指错了），请重新生成。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_HTTP_422/,
    message:
      '自建视频服务拒绝了这次请求：图片或参考声音无法识别，或参数不合格，请换一份素材后重试。',
  },
  {
    pattern: /OPENSOURCE_VIDEO_HTTP_502/,
    message: 'GPU 服务器上的 ComfyUI 暂时不可用（可能在重启），请稍后重试。',
  },
  {
    pattern:
      /OPENSOURCE_VIDEO_NETWORK_ERROR|OPENSOURCE_VIDEO_HTTP_5\d\d|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i,
    message:
      '连接自建视频服务失败，请检查 GPU 服务器是否开机、映射地址是否变了。',
  },
];

/**
 * @description 把自建视频服务的原始报错翻译成中文说明；规则都不命中时（多为服务端生成失败的原文）原样附在说明后面。
 * @keyword-cn 翻译自建视频报错, 友好错误提示
 * @keyword-en describe-opensource-video-error, friendly-error-message
 * @param raw 原始报错文本。
 * @returns {string} 中文说明。
 */
export function describeOpensourceVideoFailure(raw: string): string {
  const text = String(raw ?? '');
  const rule = OPENSOURCE_VIDEO_ERROR_RULES.find((item) =>
    item.pattern.test(text),
  );
  if (rule) return rule.message;
  const detail = text.trim().slice(0, 300);
  return detail
    ? `自建视频服务生成失败：${detail}`
    : '自建视频服务生成失败，请稍后重试。';
}
