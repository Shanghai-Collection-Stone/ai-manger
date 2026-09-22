/**
 * @description 一条 PixMax 错误翻译规则：命中 `pattern` 时用 `message` 展示，`{subject}` 替换为出问题的对象（如「第 2 镜的画面」）。
 * @keyword-cn PixMax错误规则, 友好错误
 * @keyword-en pixmax-error-rule, friendly-error
 */
interface PixmaxErrorRule {
  pattern: RegExp;
  message: string;
}

/**
 * @description PixMax / 上游模型错误到中文说明的对照，按顺序匹配，越具体的越靠前。
 * @keyword-cn PixMax错误对照, 版权审核
 * @keyword-en pixmax-error-rules, copyright-review
 */
export const PIXMAX_ERROR_RULES: readonly PixmaxErrorRule[] = [
  {
    pattern: /InputImageSensitiveContentDetected\.PolicyViolation|copyright/i,
    message:
      '{subject}可能涉及版权内容（如知名 IP、动漫或影视形象、品牌标识等），没有通过平台审核。请换成原创或没有版权风险的图片后重试。',
  },
  {
    pattern: /PrivacyInformation|may contain real person|real person/i,
    message:
      '{subject}里有真人，火山系模型（Seedance / 豆包）不接受带真人的参考图，这是模型平台的硬性限制，改提示词绕不过去。可以把这几张换成没有出镜人物的空镜（门店、菜品、环境），或把脚本的「配图偏向」改成「AI 生成画面」让模型自己画人。',
  },
  {
    pattern:
      /InputImage\w*Sensitive|sensitive.*input image|input image.*sensitive/i,
    message:
      '{subject}包含平台不允许的敏感内容，没有通过审核。请换一张图片后重试。',
  },
  {
    pattern:
      /InputText\w*Sensitive|sensitive.*(prompt|text)|(prompt|text).*sensitive/i,
    message:
      '脚本或分镜描述里有平台不允许的敏感内容，没有通过审核。请修改相关画面描述或口播后重试。',
  },
  {
    pattern: /Output\w*Sensitive|output.*(sensitive|policy)/i,
    message: '生成的视频没有通过平台内容审核，请调整分镜描述或画面后重试。',
  },
  {
    pattern:
      /InputImage\w*(Resolution|Size|Ratio|Format|Invalid)|image.*(too (small|large)|aspect ratio|resolution|unsupported format)/i,
    message:
      '{subject}的尺寸、比例或格式不符合模型要求（常见要求：宽高 300～6000 像素、宽高比在 2:5 到 5:2 之间、JPG/PNG/WEBP 格式）。请换一张图片后重试。',
  },
  {
    pattern: /PIXMAX_ASSET_COMPLIANCE_TIMEOUT/,
    message: '{subject}的平台审核超过 90 秒仍未出结果，请稍后重试。',
  },
  {
    pattern: /PIXMAX_ASSET_COMPLIANCE_FAILED/,
    message: '{subject}没有通过平台审核，请换一张图片后重试。',
  },
  {
    pattern:
      /RESOURCE_INSUFFICIENT|insufficient (balance|credit|points)|积分不足|余额不足/i,
    message: 'PixMax 积分不足，请充值后重新生成。',
  },
  {
    pattern: /RateLimit|HTTP_429|too many requests/i,
    message: '请求 PixMax 太频繁，请稍等片刻再试。',
  },
  {
    pattern: /PIXMAX_API_KEY_NOT_CONFIGURED/,
    message: 'PixMax 的 API Key 还没有配置，请到后台「Ai提供商设置」里填写。',
  },
  {
    pattern: /HTTP_401|HTTP_403|unauthori[sz]ed|invalid (api )?key|forbidden/i,
    message:
      'PixMax 的 API Key 无效或没有权限，请到后台「Ai提供商设置」里检查。',
  },
  {
    pattern:
      /PIXMAX_NETWORK_ERROR|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i,
    message: '连接 PixMax 失败，请检查网络后重试。',
  },
  {
    pattern: /PIXMAX_MODEL_MODE_UNSUPPORTED/,
    message:
      '所选视频模型不支持当前的生成方式，请到后台「工作流节点模型」换一个视频模型。',
  },
  {
    pattern: /PIXMAX_MODEL_NOT_VIDEO_GENERATION/,
    message:
      '所选模型不是视频生成模型（例如超分模型），请到后台「工作流节点模型」换一个视频模型。',
  },
  {
    pattern: /PIXMAX_DOWNLOAD_FAILED|OSS_PUT_FAILED/,
    message: '成片已经生成，但转存到视频库失败，请稍后同步状态重试。',
  },
  {
    pattern: /DOUYIN_SHOT_IMAGE_UNREADABLE|ENOENT/,
    message:
      '{subject}在图库里读取不到（可能已被删除），请在分镜里重新选择画面。',
  },
];

/**
 * @description 从原始错误文本里取出上游错误码（JSON 里的 `errorCode` / `errCode` / `code`），取不到返回 undefined。
 * @keyword-cn 提取上游错误码, 错误解析
 * @keyword-en extract-upstream-error-code, error-parse
 * @param raw 原始错误文本。
 * @returns 错误码。
 */
export function extractPixmaxErrorCode(raw: string): string | undefined {
  const match = /"(?:errorCode|errCode|code)"\s*:\s*"([^"]+)"/.exec(raw);
  return match?.[1];
}

/**
 * @description 把 PixMax 相关的原始错误翻译成给用户看的中文说明；没有匹配规则时，中文原文直接用，英文或错误码给通用说明并附错误码。
 * @keyword-cn 翻译PixMax错误, 友好错误提示
 * @keyword-en describe-pixmax-error, friendly-error-message
 * @param raw 原始错误（异常或文本）。
 * @param subject 出问题的对象，用于图片类错误，默认「参考图」。
 * @returns {string} 中文说明。
 */
export function describePixmaxError(raw: unknown, subject = '参考图'): string {
  const text =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : JSON.stringify(raw ?? '');
  const rule = PIXMAX_ERROR_RULES.find((item) => item.pattern.test(text));
  if (rule) return rule.message.split('{subject}').join(subject);
  const cleaned = text.replace(/^PIXMAX_\w+:?/, '').trim();
  // 已经是中文说明（例如 PixMax 替换后的提示）就直接用，不再套通用文案
  if (/[一-龥]/.test(cleaned) && !cleaned.startsWith('{')) {
    return cleaned.slice(0, 200);
  }
  const code = extractPixmaxErrorCode(text) ?? /^[A-Z_]{4,}/.exec(text)?.[0];
  return `视频生成失败，请稍后重试${code ? `（错误码：${code}）` : ''}。`;
}

/**
 * @description 已翻译好的 PixMax 错误：`message` 给用户看，`detail` 保留原始信息供排查。
 * @keyword-cn 友好PixMax异常, 原始错误保留
 * @keyword-en friendly-pixmax-error, raw-error-detail
 */
export class PixmaxFriendlyError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'PixmaxFriendlyError';
  }
}

/**
 * @description 把任意异常包装成 `PixmaxFriendlyError`（已是则原样返回）。
 * @keyword-cn 包装友好错误, 保留原始信息
 * @keyword-en wrap-friendly-error, keep-raw-detail
 * @param error 原始异常。
 * @param subject 出问题的对象。
 * @returns {PixmaxFriendlyError} 友好异常。
 */
export function toPixmaxFriendlyError(
  error: unknown,
  subject?: string,
): PixmaxFriendlyError {
  if (error instanceof PixmaxFriendlyError) return error;
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error ?? '');
  return new PixmaxFriendlyError(
    describePixmaxError(detail, subject),
    detail.slice(0, 1000),
  );
}
