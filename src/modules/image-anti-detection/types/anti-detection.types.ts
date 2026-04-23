/**
 * @title 抗AI识别处理类型
 * @description 定义 AntiDetectionService 的入参/出参/档位类型。
 * @keywords-cn 抗AI识别, 图片抗检测, 噪点, 颗粒感, EXIF清理, 类型
 * @keywords-en anti ai detection, image anti detection, noise, grain, exif strip, types
 */

/**
 * @description 处理强度档位。
 * - light: L1+L5 仅清元数据 + 轻微 gamma，几乎不损伤视觉（适合文字烧录封面）。
 * - standard: L1+L2+L4+L5 元数据清理 + 亮度/饱和度抖动 + JPEG 重采样 + gamma（适合 AI 原始生图、拼图）。
 * - strong: 全部 L1~L5 打开，包含明显颗粒噪点（适合对检测最敏感的场景）。
 * @keyword-en anti detection strength preset
 */
export type AntiDetectionStrength = 'light' | 'standard' | 'strong';

/**
 * @description 输出格式偏好。
 * - keep: 保持源格式（PNG 保 PNG，JPEG 保 JPEG）
 * - jpeg: 强制 JPEG 输出（有损重编码，更贴近"手机截屏"压缩纹理）
 * - png: 强制 PNG 输出（无损，失去 JPEG 压缩纹理抗检测效果）
 * @keyword-en anti detection output format preference
 */
export type AntiDetectionOutputFormat = 'keep' | 'jpeg' | 'png';

/**
 * @description 抗AI识别处理选项。
 * @keyword-en anti detection processing options
 */
export interface AntiDetectionOptions {
  /** 处理强度档位；不传默认 standard */
  strength?: AntiDetectionStrength;
  /** 输出格式；不传默认 keep */
  outputFormat?: AntiDetectionOutputFormat;
  /** JPEG 输出质量下限（0~100），默认 82 */
  jpegQualityMin?: number;
  /** JPEG 输出质量上限（0~100），默认 90 */
  jpegQualityMax?: number;
  /** 全局开关，false 时直接原样返回（用于 A/B 或调试） */
  enabled?: boolean;
  /** 日志前缀标签，便于追踪调用方 */
  tag?: string;
}

/**
 * @description 抗AI识别处理结果。
 * @keyword-en anti detection processing result
 */
export interface AntiDetectionResult {
  /** 处理后的二进制；处理失败或关闭时返回原 buffer */
  buffer: Buffer;
  /** 最终 mimeType（image/jpeg 或 image/png） */
  mimeType: string;
  /** 是否已实际应用抗识别处理（false 表示降级/跳过） */
  processed: boolean;
  /** 本次使用的随机化参数（调试/归因用） */
  appliedParams?: Record<string, number | string | boolean>;
}
