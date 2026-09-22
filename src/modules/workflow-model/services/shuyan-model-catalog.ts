import { BadRequestException } from '@nestjs/common';
import type { WorkflowNodeCategory } from '../entities/workflow-model.entity.js';

/**
 * @description 数眼智能（New API 中转）在后台可用的提供商代码，`admin_ai_providers.providerCode` 取这里的值。
 * @keyword-cn 数眼智能提供商代码, 中转站
 * @keyword-en shuyan-provider-codes, openai-compatible-relay
 */
export const SHUYAN_PROVIDER_CODES = ['shuyan', 'shuyanai'] as const;

/**
 * @description 数眼智能主节点地址，管理员把 baseUrl 留空时兜底（备用节点 https://cloud.shuyanai.com/v1 需手填）。
 * @keyword-cn 数眼智能默认地址, 主节点
 * @keyword-en shuyan-default-base-url, primary-endpoint
 */
export const SHUYAN_DEFAULT_BASE_URL = 'https://platform.shuyanai.com/v1';

/**
 * @description 模型分类：工作流节点用的三类之外，另出向量与其他（音频 / 音乐等），
 *   这两档不属于任何节点类型，按分类过滤时会被自然排除。
 * @keyword-cn 数眼模型分类, 向量与其他
 * @keyword-en shuyan-model-category, embedding-and-other
 */
export type ShuyanModelCategory = WorkflowNodeCategory | 'em' | 'other';

/**
 * @description `/v1/models` 返回的单条模型，`supportedEndpointTypes` 是 New API 较新版本才有的结构化分类信号。
 * @keyword-cn 数眼模型条目, 端点类型
 * @keyword-en shuyan-model-item, endpoint-types
 */
export interface ShuyanModelItem {
  id: string;
  ownedBy?: string;
  supportedEndpointTypes?: string[];
}

/** 向量 / 重排：命中即判定为 em。 */
const EMBEDDING_PATTERNS = [
  'embedding',
  'embed',
  'rerank',
  'bge-',
  'gte-',
  'jina-',
  'm3e',
];

/** 生视频：`-video` 后缀之外，按平台在售的视频模型族名兜底。 */
const VIDEO_PATTERNS = [
  '-video',
  'video-',
  'seedance',
  'hailuo',
  'happyhorse',
  'kling',
  'vidu',
  'pixverse',
  'runway',
  'luma',
  'veo',
  'sora',
  'ltx',
  'cogvideo',
  'minimax-h',
];

/** 生图：`-image` 之外，按平台在售的图像模型族名兜底。 */
const IMAGE_PATTERNS = [
  '-image',
  'image-',
  'seedream',
  'dall-e',
  'dalle',
  'flux',
  'midjourney',
  'mj_',
  'nano-banana',
  'stable-diffusion',
  'sd3',
  'kolors',
  'imagen',
  'ideogram',
  'recraft',
  'cogview',
  'irag',
];

/** 音频 / 音乐：不对应任何节点类型，单独归到 other 避免混进文本模型列表。 */
const OTHER_PATTERNS = [
  'suno',
  'tts',
  'whisper',
  'audio',
  'speech',
  'music',
  'voice',
  'asr',
];

/**
 * @description 判断提供商代码是否是数眼智能。
 * @keyword-cn 数眼智能识别, 提供商代码
 * @keyword-en is-shuyan-provider, provider-code
 * @param providerCode 提供商代码。
 * @returns {boolean} 是否为数眼智能。
 */
export function isShuyanProvider(providerCode: string): boolean {
  return (SHUYAN_PROVIDER_CODES as readonly string[]).includes(
    String(providerCode ?? '')
      .trim()
      .toLowerCase(),
  );
}

/**
 * @description 把 `/v1/models` 的一条模型判成节点类型。优先用 New API 的 `supported_endpoint_types`
 *   结构化字段；老版本没有这个字段时按模型名兜底匹配（规则按平台当前在售命名整理，新模型族上线后需要补）。
 *   都不命中按文本模型处理——文本模型命名最杂，且页面仍保留手填框可以纠正。
 * @keyword-cn 数眼模型分类, 按名兜底
 * @keyword-en classify-shuyan-model, name-fallback
 * @param item 模型条目。
 * @returns {ShuyanModelCategory} 模型分类。
 */
export function classifyShuyanModel(
  item: ShuyanModelItem,
): ShuyanModelCategory {
  const endpoints = (item.supportedEndpointTypes ?? [])
    .map((x) => String(x ?? '').toLowerCase())
    .filter(Boolean);
  if (endpoints.length) {
    if (endpoints.some((x) => x.includes('video'))) return 'video';
    if (endpoints.some((x) => x.includes('image') || x.includes('midjourney')))
      return 'image';
    if (endpoints.some((x) => x.includes('embed') || x.includes('rerank')))
      return 'em';
    if (endpoints.some((x) => x.includes('audio') || x.includes('suno')))
      return 'other';
    return 'llm';
  }

  const name = String(item.id ?? '')
    .trim()
    .toLowerCase();
  if (!name) return 'other';
  const hit = (patterns: string[]) => patterns.some((p) => name.includes(p));
  // 顺序固定：向量 / 重排最好认，其次生视频（`-video` 比族名更准），再生图，最后音频。
  if (hit(EMBEDDING_PATTERNS)) return 'em';
  if (hit(VIDEO_PATTERNS)) return 'video';
  if (hit(IMAGE_PATTERNS)) return 'image';
  if (hit(OTHER_PATTERNS)) return 'other';
  return 'llm';
}

/**
 * @description 用提供商的 Key 实时拉取数眼智能账号下可调的模型（OpenAI 兼容 `GET /v1/models`，
 *   New API 按 Key 所在分组返回，不消耗额度）。
 * @keyword-cn 拉取数眼模型, 账号可用模型
 * @keyword-en fetch-shuyan-models, available-models
 * @param input baseUrl / apiKey / 超时毫秒。
 * @returns {Promise<ShuyanModelItem[]>} 模型列表。
 * @throws {BadRequestException} SHUYAN_MODEL_LIST_FAILED:<原因>。
 */
export async function fetchShuyanModels(input: {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<ShuyanModelItem[]> {
  const apiKey = String(input.apiKey ?? '').trim();
  if (!apiKey) {
    throw new BadRequestException(
      'SHUYAN_MODEL_LIST_FAILED:API_KEY_NOT_CONFIGURED',
    );
  }
  const baseUrl = String(input.baseUrl ?? '').trim() || SHUYAN_DEFAULT_BASE_URL;
  const endpoint = `${baseUrl.replace(/\/$/, '')}/models`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(input.timeoutMs ?? 15 * 1000),
  }).catch((error: unknown) => {
    throw new BadRequestException(
      `SHUYAN_MODEL_LIST_FAILED:${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{
      id?: string;
      owned_by?: string;
      supported_endpoint_types?: string[];
    }>;
    error?: { message?: string; code?: string };
  };
  if (!response.ok) {
    throw new BadRequestException(
      `SHUYAN_MODEL_LIST_FAILED:${payload.error?.message || payload.error?.code || `HTTP_${response.status}`}`,
    );
  }
  return (Array.isArray(payload.data) ? payload.data : [])
    .map((row) => ({
      id: String(row?.id ?? '').trim(),
      ownedBy: String(row?.owned_by ?? '').trim() || undefined,
      supportedEndpointTypes: Array.isArray(row?.supported_endpoint_types)
        ? row.supported_endpoint_types.map((x) => String(x ?? ''))
        : undefined,
    }))
    .filter((row) => row.id);
}

/**
 * @description 拉取并按节点类型过滤数眼智能的可选模型，按模型名排序后返回给后台页面。
 * @keyword-cn 数眼可选模型, 按分类过滤
 * @keyword-en list-shuyan-models-by-category, filter-by-category
 * @param input baseUrl / apiKey / 节点类型。
 * @returns {Promise<Array<{ code: string; name: string }>>} 该类型下的可选模型。
 */
export async function listShuyanModelsByCategory(input: {
  baseUrl?: string;
  apiKey?: string;
  category: WorkflowNodeCategory;
}): Promise<Array<{ code: string; name: string }>> {
  const items = await fetchShuyanModels(input);
  return items
    .filter((item) => classifyShuyanModel(item) === input.category)
    .map((item) => ({ code: item.id, name: item.id }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
