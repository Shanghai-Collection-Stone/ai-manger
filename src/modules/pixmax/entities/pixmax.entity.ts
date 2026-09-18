import { ObjectId } from 'mongodb';

/**
 * @description 调用 PixMax OpenAPI 所需的连接信息，来自后台「Ai提供商设置」里 providerCode=pixmax 的记录。
 * @keyword-cn PixMax连接信息, 提供商凭证
 * @keyword-en pixmax-runtime, provider-credential
 */
export interface PixmaxRuntime {
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * @description PixMax 模型参数规格：`options` 为枚举可选值（空串表示「自动 / 不传」），`min/max/step` 为滑块范围。
 * @keyword-cn PixMax参数规格, 可选值范围
 * @keyword-en pixmax-param-spec, option-range
 */
export interface PixmaxParamSpec {
  name: string;
  type: string;
  defaultValue: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

/**
 * @description PixMax 模型规格：参数、生成模式要求与各类输入的数量上限（`mediaTotal` 为图片 / 视频 / 音频合计）。
 * @keyword-cn PixMax模型规格, 输入上限
 * @keyword-en pixmax-model-spec, input-limit
 */
export interface PixmaxModelSpec {
  code: string;
  name: string;
  nodeType: 'GENERATE_VIDEO' | 'GENERATE_IMAGE';
  maxInputs: {
    text?: number;
    image?: number;
    video?: number;
    audio?: number;
    mediaTotal?: number;
  };
  params: PixmaxParamSpec[];
  referModes: Array<{ value: string; requirement: string }>;
  promptDefault: string;
}

/**
 * @description PixMax 资产对象（上传返回、任务输入与结果共用），只列本项目用到的字段。
 * @keyword-cn PixMax资产, 结果地址
 * @keyword-en pixmax-asset, result-url
 */
export interface PixmaxAsset {
  assetsUuid?: string;
  assetUuid?: string;
  fileType?: string;
  webUrl?: string;
  previewWebUrl?: string;
  thumbnailWebUrl?: string;
  ossDomain?: string;
  ossSynced?: boolean;
  fullUrl?: string | null;
  width?: number | null;
  height?: number | null;
  metaData?: {
    fileSize?: number;
    fileExtension?: string;
    width?: number;
    height?: number;
    duration?: number;
  };
  complianceStatus?: string | null;
}

/**
 * @description PixMax 任务状态原值。
 * @keyword-cn PixMax任务状态, 状态枚举
 * @keyword-en pixmax-task-status, status-enum
 */
export type PixmaxTaskStatus =
  | 'QUEUE'
  | 'RUNNING'
  | 'COMPLETE'
  | 'FAILED'
  | 'ABORTED'
  | 'RESOURCE_INSUFFICIENT';

/**
 * @description PixMax 任务对象（提交与详情共用）。
 * @keyword-cn PixMax任务, 任务详情
 * @keyword-en pixmax-task, task-detail
 */
export interface PixmaxTask {
  taskUuid: string;
  nodeUuid?: string;
  status: PixmaxTaskStatus | string;
  progress?: number;
  userConcurrencyWaiting?: boolean | null;
  modelCode?: string;
  modelName?: string;
  resultText?: string | null;
  resultAssets?: PixmaxAsset[];
  providerErrorMsg?: string | null;
  replaceProviderErrorMsg?: string | null;
  count?: number;
  completedCount?: number;
  failedCount?: number;
}

/**
 * @description 提交任务的请求体。
 * @keyword-cn 提交任务参数, 输入资产
 * @keyword-en submit-task-input, input-assets
 */
export interface PixmaxSubmitInput {
  projectUuid: string;
  inputAssetUuids?: string[];
  inputTexts?: string[];
  params: Record<string, unknown>;
}

/**
 * @description 已上传到 PixMax 的本地素材缓存，同一提供商账号下同一素材不重复上传。
 * @keyword-cn 资产上传缓存, 避免重复上传
 * @keyword-en asset-upload-cache, dedupe-upload
 */
export interface PixmaxAssetCacheEntity {
  _id: ObjectId;
  accountKey: string;
  sourceKey: string;
  assetUuid: string;
  createdAt: Date;
}
