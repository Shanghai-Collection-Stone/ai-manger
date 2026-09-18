import { BadRequestException } from '@nestjs/common';
import { PIXMAX_MODEL_CATALOG } from '../entities/pixmax-model-catalog.js';
import type {
  PixmaxModelSpec,
  PixmaxParamSpec,
} from '../entities/pixmax.entity.js';

/**
 * @description 视频生成的两种用法：`shot` 一段分镜出一段视频，`full` 所有分镜一次生成一条完整视频。
 * @keyword-cn 视频生成模式, 分镜与整片
 * @keyword-en video-generation-mode, shot-and-full
 */
export type PixmaxVideoMode = 'shot' | 'full';

/**
 * @description 组装好的 PixMax 生视频参数与本次实际采用的取舍。
 * @keyword-cn 生视频参数结果, 参数取舍
 * @keyword-en video-params-result, param-decisions
 */
export interface PixmaxVideoParamsResult {
  params: Record<string, unknown>;
  referModel?: string;
  /** 本次实际带入的参考图数量（取前 N 张） */
  imageCount: number;
  duration?: number;
  /** 目标时长超过模型上限时为 true */
  durationClamped: boolean;
  /** 模型有「是否包含音频」参数，本次已按声音设置写入 */
  audioSwitchApplied: boolean;
}

/**
 * @description 按模型编码（或展示名）查找规格，找不到返回 undefined，调用方按通用参数兜底。
 * @keyword-cn 查找PixMax模型, 编码或名称
 * @keyword-en find-pixmax-model, code-or-name
 * @param code 模型编码。
 * @param name 可选展示名。
 * @returns 模型规格。
 */
export function findPixmaxModel(
  code: string,
  name?: string,
): PixmaxModelSpec | undefined {
  const normalized = String(code ?? '')
    .trim()
    .toLowerCase();
  const byName = String(name ?? '')
    .trim()
    .toLowerCase();
  return PIXMAX_MODEL_CATALOG.find(
    (item) =>
      item.code.toLowerCase() === normalized ||
      item.name.toLowerCase() === normalized ||
      (byName && item.name.toLowerCase() === byName),
  );
}

/**
 * @description 火山系模型（Seedance / Doubao）引用素材前需要先通过 PixMax 资产合规审核。
 * @keyword-cn 需要合规审核, 火山系模型
 * @keyword-en requires-compliance, volc-models
 * @param code 模型编码或名称。
 * @returns {boolean} 是否需要审核。
 */
export function requiresPixmaxCompliance(code: string): boolean {
  return /seedance|pixdance|doubao/i.test(String(code ?? ''));
}

/**
 * @description 在模型允许的时长里取不小于目标的最短一档，没有则取最长一档；滑块型按步长取整后夹到范围内。
 * @keyword-cn 选择生成时长, 时长夹取
 * @keyword-en pick-duration, clamp-duration
 * @param spec 时长参数规格。
 * @param target 目标秒数。
 * @returns 选中的秒数；参数无可用值时 undefined。
 */
export function pickPixmaxDuration(
  spec: PixmaxParamSpec,
  target: number,
): number | undefined {
  const want = Math.max(1, Math.ceil(Number(target) || 0));
  if (spec.options?.length) {
    const values = spec.options
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (!values.length) return undefined;
    return values.find((value) => value >= want) ?? values[values.length - 1];
  }
  if (typeof spec.min === 'number' && typeof spec.max === 'number') {
    const step = spec.step && spec.step > 0 ? spec.step : 1;
    const stepped = Math.ceil(want / step) * step;
    return Math.min(spec.max, Math.max(spec.min, stepped));
  }
  return undefined;
}

/**
 * @description 列出模型可生成的时长（秒，升序）：枚举型取可选值，滑块型按步长展开；目录里没有的模型按通用兜底 5～15 秒；
 *   不是生视频模型时返回空数组。
 * @keyword-cn 模型可用时长, 时长选项
 * @keyword-en model-duration-choices, duration-options
 * @param modelCode 模型编码。
 * @returns {number[]} 可选秒数。
 */
export function listPixmaxDurationChoices(modelCode: string): number[] {
  const spec = findPixmaxModel(modelCode);
  if (!spec) return Array.from({ length: 11 }, (_, index) => index + 5);
  const param = spec.params.find((item) => item.name === 'duration');
  if (!param) return [];
  if (param.options?.length) {
    return [
      ...new Set(
        param.options
          .map(Number)
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
    ].sort((a, b) => a - b);
  }
  if (typeof param.min === 'number' && typeof param.max === 'number') {
    const step = param.step && param.step > 0 ? param.step : 1;
    const values: number[] = [];
    for (let value = param.min; value <= param.max; value += step)
      values.push(value);
    return values;
  }
  return [];
}

/**
 * @description 从生成模式的输入要求里读出可带的图片数量上限：要求不涉及图片时为 0，`无需输入素材` 时按模型图片上限。
 * @keyword-cn 解析参考图上限, 模式输入要求
 * @keyword-en parse-image-limit, mode-requirement
 * @param requirement 模式要求原文。
 * @param spec 模型规格。
 * @returns {number} 图片上限。
 */
export function readReferImageLimit(
  requirement: string,
  spec: PixmaxModelSpec,
): number {
  const text = String(requirement ?? '');
  const modelLimit = Math.min(
    spec.maxInputs.image ?? 0,
    spec.maxInputs.mediaTotal ?? Number.POSITIVE_INFINITY,
  );
  if (text.includes('无需')) return modelLimit;
  if (!text.includes('图片')) return 0;
  const range = /(\d+)\s*[～~\-]\s*(\d+)/.exec(text);
  if (range) return Math.min(Number(range[2]), modelLimit || Number(range[2]));
  const exact = /(?:为|仅有)\s*(\d+)\s*个/.exec(text);
  if (exact) return Math.min(Number(exact[1]), modelLimit || Number(exact[1]));
  return modelLimit;
}

/**
 * @description 按模式选择生成方式：分镜优先图生视频（有图）再文生视频；整片优先多图参考，模型不支持时用首尾帧
 *   （第一镜与最后一镜的画面，至少 2 张图），再退到首图图生视频，最后才是纯文生视频，尽量让分镜画面参与生成。
 * @keyword-cn 选择生成方式, 参考图模式
 * @keyword-en pick-refer-mode, reference-mode
 * @param spec 模型规格。
 * @param mode 分镜或整片。
 * @param availableImages 可用参考图数量。
 * @returns 生成方式与本次带入的图片数量。
 * @throws {BadRequestException} PIXMAX_MODEL_MODE_UNSUPPORTED:<模型>。
 */
export function pickPixmaxReferMode(
  spec: PixmaxModelSpec,
  mode: PixmaxVideoMode,
  availableImages: number,
): { referModel: string; imageCount: number } {
  const find = (value: string) =>
    spec.referModes.find((item) => item.value === value);
  const withImages = (value: string) => {
    const refer = find(value);
    if (!refer || availableImages <= 0) return undefined;
    const limit = readReferImageLimit(refer.requirement, spec);
    return limit > 0
      ? { referModel: value, imageCount: Math.min(availableImages, limit) }
      : undefined;
  };
  const textOnly = find('textToVideo')
    ? { referModel: 'textToVideo', imageCount: 0 }
    : undefined;
  const firstFrame =
    find('imageToVideo') && availableImages > 0
      ? { referModel: 'imageToVideo', imageCount: 1 }
      : undefined;
  const firstAndLast =
    find('firstAndLastFrame') && availableImages >= 2
      ? { referModel: 'firstAndLastFrame', imageCount: 2 }
      : undefined;
  const choice =
    mode === 'shot'
      ? (firstFrame ??
        withImages('imageRefer') ??
        withImages('referToVideo') ??
        textOnly)
      : (withImages('referToVideo') ??
        withImages('imageRefer') ??
        firstAndLast ??
        firstFrame ??
        textOnly);
  if (!choice) {
    throw new BadRequestException(`PIXMAX_MODEL_MODE_UNSUPPORTED:${spec.code}`);
  }
  return choice;
}

/**
 * @description 把规格里的默认值转成接口需要的类型：int/number 转数字，boolean 转布尔，其余保持字符串。
 * @keyword-cn 参数类型转换, 默认值
 * @keyword-en convert-param-value, default-value
 */
function toParamValue(spec: PixmaxParamSpec, value: string): unknown {
  if (spec.type === 'int' || spec.type === 'number') return Number(value);
  if (spec.type === 'boolean') return String(value) === 'true';
  return String(value);
}

/**
 * @description 组装一次生视频任务的 `params`：写入提示词、模型、生成方式、竖屏比例与时长，其余必填参数用模型默认值，数量固定 1。
 *   已知模型按规格选值；未知模型（目录里没有）按通用参数兜底。
 * @keyword-cn 组装生视频参数, 竖屏比例
 * @keyword-en build-video-params, portrait-ratio
 * @param input 模型、提示词、目标时长、模式、可用参考图数量，以及是否需要音频（模型有 `includeAudio` 参数时按它写入）。
 * @returns 参数与取舍结果。
 * @throws {BadRequestException} PIXMAX_MODEL_NOT_VIDEO_GENERATION / PIXMAX_MODEL_MODE_UNSUPPORTED。
 */
export function buildPixmaxVideoParams(input: {
  modelCode: string;
  prompt: string;
  targetSeconds: number;
  mode: PixmaxVideoMode;
  availableImages: number;
  audioEnabled?: boolean;
}): PixmaxVideoParamsResult {
  const spec = findPixmaxModel(input.modelCode);
  const base: Record<string, unknown> = {
    prompt: input.prompt,
    model: input.modelCode,
    nodeType: 'GENERATE_VIDEO',
  };
  if (!spec) {
    const duration = Math.min(15, Math.max(5, Math.ceil(input.targetSeconds)));
    const referModel =
      input.availableImages > 0
        ? input.mode === 'shot'
          ? 'imageToVideo'
          : 'referToVideo'
        : 'textToVideo';
    return {
      params: {
        ...base,
        referModel,
        duration: String(duration),
        aspectRatio: '9:16',
        count: 1,
      },
      referModel,
      // 规格未知时保守带图：单镜 1 张，整片最多 9 张（多数模型的参考图上限）
      imageCount:
        input.mode === 'shot'
          ? Math.min(1, input.availableImages)
          : Math.min(9, input.availableImages),
      duration,
      durationClamped: duration < input.targetSeconds,
      audioSwitchApplied: false,
    };
  }
  if (
    spec.nodeType !== 'GENERATE_VIDEO' ||
    !spec.params.some((p) => p.name === 'duration')
  ) {
    throw new BadRequestException(
      `PIXMAX_MODEL_NOT_VIDEO_GENERATION:${spec.code}`,
    );
  }
  const params: Record<string, unknown> = { ...base };
  const hasReferParam = spec.params.some((p) => p.name === 'referModel');
  const choice = hasReferParam
    ? pickPixmaxReferMode(spec, input.mode, input.availableImages)
    : { referModel: undefined, imageCount: 0 };
  if (choice.referModel) params.referModel = choice.referModel;
  const requirement =
    spec.referModes.find((item) => item.value === choice.referModel)
      ?.requirement ?? '';

  let duration: number | undefined;
  for (const param of spec.params) {
    if (param.name in params) continue;
    if (param.name === 'duration') {
      duration = pickPixmaxDuration(param, input.targetSeconds);
      if (duration !== undefined)
        params.duration = toParamValue(param, String(duration));
      continue;
    }
    if (param.name === 'aspectRatio') {
      const options = param.options ?? [];
      if (requirement.includes('adaptive') && options.includes('adaptive')) {
        params.aspectRatio = 'adaptive';
      } else if (options.includes('9:16')) {
        params.aspectRatio = '9:16';
      } else if (param.defaultValue) {
        params.aspectRatio = param.defaultValue;
      }
      continue;
    }
    if (param.name === 'count') {
      params.count = toParamValue(param, '1');
      continue;
    }
    if (param.name === 'includeAudio' && input.audioEnabled !== undefined) {
      params.includeAudio = toParamValue(param, String(input.audioEnabled));
      continue;
    }
    if (param.defaultValue !== '') {
      params[param.name] = toParamValue(param, param.defaultValue);
    }
  }
  return {
    params,
    referModel: choice.referModel,
    imageCount: choice.imageCount,
    duration,
    durationClamped:
      duration !== undefined && duration < Math.ceil(input.targetSeconds),
    audioSwitchApplied:
      input.audioEnabled !== undefined &&
      spec.params.some((p) => p.name === 'includeAudio'),
  };
}

/**
 * @description 把 PixMax 任务状态归到工作台的调用状态：排队 / 生成中 / 已完成 / 失败。
 * @keyword-cn PixMax状态映射, 调用状态
 * @keyword-en map-pixmax-status, operation-status
 * @param status PixMax 原始状态。
 * @returns 工作台状态。
 */
export function mapPixmaxTaskStatus(
  status: string,
): 'queued' | 'running' | 'completed' | 'failed' {
  switch (String(status ?? '').toUpperCase()) {
    case 'QUEUE':
      return 'queued';
    case 'COMPLETE':
      return 'completed';
    case 'FAILED':
    case 'ABORTED':
    case 'RESOURCE_INSUFFICIENT':
      return 'failed';
    default:
      return 'running';
  }
}
