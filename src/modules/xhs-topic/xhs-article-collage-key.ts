import type { XhsArticleCanvasCollage } from './entities/xhs-topic.entity.js';

/** 指纹规则版本；规则变化时升级前缀，旧指纹自然失配并触发一次重合成 */
const COLLAGE_RENDER_KEY_PREFIX = 'c1-';

/**
 * @description cyrb53 字符串哈希（53 位），与工作台 `articleCanvasBoard.js` 的实现逐行一致。
 * @keyword-cn 拼图指纹哈希, 前后端同算法
 * @keyword-en collage-key-hash, shared-hash-algorithm
 * @param {string} text - 规范化后的拼图描述。
 * @returns {number} 53 位哈希值。
 */
function hashCollageText(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * @description 把数值按固定小数位规范成字符串，非法值记为 0。
 * @keyword-cn 拼图指纹, 数值规范化
 * @keyword-en collage-render-key, number-canonicalization
 */
function canonicalNumber(value: unknown, digits = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  const factor = 10 ** digits;
  return String(Math.round(number * factor) / factor);
}

/**
 * @description 读取裁切参数：在合法范围内按两位小数取值，缺省或越界回落默认值（与前端绘制规则一致）。
 * @keyword-cn 拼图指纹, 裁切参数
 * @keyword-en collage-render-key, crop-parameters
 */
function canonicalCrop(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): string {
  const number = Number(value);
  return value !== undefined &&
    value !== null &&
    Number.isFinite(number) &&
    number >= min &&
    number <= max
    ? canonicalNumber(number)
    : String(fallback);
}

/**
 * @description 计算拼图的成品指纹：画布尺寸 + 每格图片地址、位置尺寸与焦点 / 缩放。成品图由这组格子画出时，
 *   把指纹记在 `collage.renderedKey` 上；保存到文章库时指纹一致就直接用现成成品图，不再重新合成上传。
 *   规则与工作台 `computeCollageRenderKey` 必须保持一致（两边测试用同一组样例锁定结果）。
 * @keyword-cn 拼图指纹, 跳过重合成
 * @keyword-en collage-render-key, skip-recompose
 * @param {Pick<XhsArticleCanvasCollage, 'width' | 'height' | 'cells'>} collage - 拼图画布格式。
 * @returns {string} 形如 `c1-<hex>` 的指纹。
 */
export function computeXhsCollageRenderKey(
  collage: Pick<XhsArticleCanvasCollage, 'width' | 'height' | 'cells'>,
): string {
  const cells = (collage.cells ?? []).map((cell) =>
    [
      String(cell.src ?? '').trim(),
      canonicalNumber(cell.x),
      canonicalNumber(cell.y),
      canonicalNumber(cell.width),
      canonicalNumber(cell.height),
      canonicalCrop(cell.focusX, 0, 100, 50),
      canonicalCrop(cell.focusY, 0, 100, 50),
      canonicalCrop(cell.zoom, 1, 3, 1),
    ].join(','),
  );
  const text = [
    `${canonicalNumber(collage.width)}x${canonicalNumber(collage.height)}`,
    ...cells,
  ].join('|');
  return `${COLLAGE_RENDER_KEY_PREFIX}${hashCollageText(text).toString(16)}`;
}
