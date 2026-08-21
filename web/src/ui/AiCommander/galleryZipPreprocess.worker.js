import { strToU8, unzipSync, zip } from 'fflate';

const MANIFEST_NAME = '_gallery_manifest.json';
const MAX_INPUT_BYTES = 300 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 600 * 1024 * 1024;
const MAX_IMAGE_COUNT = 3000;
const MAX_DIMENSION = 1600;
const OUTPUT_QUALITY = 0.75;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const OPTIMIZABLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * @description 从 ZIP entry 名称提取小写扩展名。
 * @param {string} name ZIP entry 名称。
 * @returns {string} 包含点号的扩展名。
 * @keyword-cn 图片扩展名, ZIP条目
 * @keyword-en image-extension, zip-entry
 */
function extensionOf(name) {
  const clean = String(name || '').split(/[?#]/, 1)[0];
  const index = clean.lastIndexOf('.');
  return index >= 0 ? clean.slice(index).toLowerCase() : '';
}

/**
 * @description 根据图片扩展名返回浏览器编码 MIME 类型。
 * @param {string} extension 图片扩展名。
 * @returns {string} 图片 MIME 类型。
 * @keyword-cn 图片媒体类型, 浏览器编码
 * @keyword-en image-mime, browser-encode
 */
function mimeTypeOf(extension) {
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

/**
 * @description 使用 OffscreenCanvas 将图片按最大边 1600 等比缩放并按原格式编码。
 * @param {ImageBitmap} bitmap 已解码图片。
 * @param {string} mimeType 输出 MIME 类型。
 * @returns {Promise<Blob>} 编码后的图片 Blob。
 * @keyword-cn 客户端图片压缩, 等比缩放
 * @keyword-en client-image-compression, proportional-resize
 */
async function encodeOptimizedImage(bitmap, mimeType) {
  if (typeof OffscreenCanvas !== 'function') {
    throw new Error('当前浏览器不支持后台图片压缩，请升级 Chrome 或 Edge');
  }
  const ratio = Math.min(MAX_DIMENSION / bitmap.width, MAX_DIMENSION / bitmap.height, 1);
  const width = Math.max(1, Math.floor(bitmap.width * ratio));
  const height = Math.max(1, Math.floor(bitmap.height * ratio));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: mimeType !== 'image/jpeg' });
  if (!context) throw new Error('无法创建图片处理画布');
  context.drawImage(bitmap, 0, 0, width, height);
  return await canvas.convertToBlob({ type: mimeType, quality: OUTPUT_QUALITY });
}

/**
 * @description 解码并优化单张 ZIP 图片，GIF/BMP 保持原始字节以保留动画和兼容性。
 * @param {string} entryName ZIP entry 名称。
 * @param {Uint8Array} bytes 原始图片字节。
 * @returns {Promise<{bytes: Uint8Array, width?: number, height?: number, processed: boolean, optimized: boolean}>} 图片结果和可信尺寸。
 * @keyword-cn 单图预处理, 保留动图
 * @keyword-en single-image-preprocess, preserve-animation
 */
async function preprocessImage(entryName, bytes) {
  const extension = extensionOf(entryName);
  const mimeType = mimeTypeOf(extension);
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  } catch {
    return { bytes, processed: false, optimized: false };
  }

  const width = Number(bitmap.width) || undefined;
  const height = Number(bitmap.height) || undefined;
  if (!OPTIMIZABLE_EXTENSIONS.has(extension)) {
    bitmap.close();
    return { bytes, width, height, processed: true, optimized: false };
  }

  try {
    const needsResize = Number(width) > MAX_DIMENSION || Number(height) > MAX_DIMENSION;
    const encoded = await encodeOptimizedImage(bitmap, mimeType);
    const encodedBytes = new Uint8Array(await encoded.arrayBuffer());
    const isMeaningfullySmaller = encodedBytes.byteLength <= bytes.byteLength * 0.95;
    if (isMeaningfullySmaller) {
      const ratio = Math.min(MAX_DIMENSION / Number(width), MAX_DIMENSION / Number(height), 1);
      return {
        bytes: encodedBytes,
        width: Math.max(1, Math.floor(Number(width) * ratio)),
        height: Math.max(1, Math.floor(Number(height) * ratio)),
        processed: true,
        optimized: true,
      };
    }
    return { bytes, width, height, processed: !needsResize, optimized: false };
  } catch {
    return { bytes, width, height, processed: false, optimized: false };
  } finally {
    bitmap.close();
  }
}

/**
 * @description 将 ZIP 在 Worker 中解包、逐张优化、写入尺寸清单并重新打包。
 * @param {File} file 用户选择的 ZIP 文件。
 * @returns {Promise<{bytes: Uint8Array, name: string, summary: Record<string, number>}>} 优化 ZIP 与统计信息。
 * @keyword-cn ZIP客户端预处理, 图片尺寸清单
 * @keyword-en client-zip-preprocess, image-dimension-manifest
 */
async function preprocessZip(file) {
  if (!file || Number(file.size) <= 0) throw new Error('ZIP 文件为空');
  if (Number(file.size) > MAX_INPUT_BYTES) {
    throw new Error('客户端优化单包上限为 300MB，请拆分 ZIP 后重试');
  }

  self.postMessage({ type: 'progress', phase: 'reading', processed: 0, total: 0 });
  const inputBytes = new Uint8Array(await file.arrayBuffer());
  let expandedBytes = 0;
  let imageCount = 0;
  let limitError = '';
  const entries = unzipSync(inputBytes, {
    filter(entry) {
      const name = String(entry?.name || '');
      const extension = extensionOf(name);
      if (!name || name.endsWith('/') || name === MANIFEST_NAME || !IMAGE_EXTENSIONS.has(extension)) return false;
      imageCount += 1;
      expandedBytes += Math.max(0, Number(entry?.originalSize) || 0);
      if (imageCount > MAX_IMAGE_COUNT) limitError = `ZIP 图片不能超过 ${MAX_IMAGE_COUNT} 张`;
      if (expandedBytes > MAX_EXPANDED_BYTES) limitError = 'ZIP 解压后的图片总量不能超过 600MB';
      return !limitError;
    },
  });
  if (limitError) throw new Error(limitError);

  const names = Object.keys(entries);
  if (names.length === 0) throw new Error('ZIP 内未找到可导入图片');
  const outputEntries = {};
  const manifestImages = [];
  let sourceImageBytes = 0;
  let optimizedImageBytes = 0;
  let optimizedCount = 0;

  for (let index = 0; index < names.length; index += 1) {
    const entryName = names[index];
    const originalBytes = entries[entryName];
    const result = await preprocessImage(entryName, originalBytes);
    outputEntries[entryName] = result.bytes;
    sourceImageBytes += originalBytes.byteLength;
    optimizedImageBytes += result.bytes.byteLength;
    if (result.optimized) optimizedCount += 1;
    manifestImages.push({
      entryName,
      width: result.width,
      height: result.height,
      originalSize: originalBytes.byteLength,
      optimizedSize: result.bytes.byteLength,
      processed: result.processed,
      optimized: result.optimized,
    });
    self.postMessage({
      type: 'progress',
      phase: 'optimizing',
      processed: index + 1,
      total: names.length,
      currentName: entryName,
      sourceImageBytes,
      optimizedImageBytes,
    });
  }

  outputEntries[MANIFEST_NAME] = strToU8(JSON.stringify({
    version: 1,
    processor: 'ai-manger-web',
    maxDimension: MAX_DIMENSION,
    quality: OUTPUT_QUALITY,
    images: manifestImages,
  }));
  self.postMessage({ type: 'progress', phase: 'packing', processed: names.length, total: names.length });

  const bytes = await new Promise((resolve, reject) => {
    zip(outputEntries, { level: 1 }, (error, zipped) => {
      if (error) reject(error);
      else resolve(zipped);
    });
  });
  const baseName = String(file.name || 'gallery').replace(/\.zip$/i, '');
  return {
    bytes,
    name: `${baseName}.optimized.zip`,
    summary: {
      imageCount: names.length,
      optimizedCount,
      originalZipBytes: Number(file.size) || inputBytes.byteLength,
      sourceImageBytes,
      optimizedImageBytes,
      outputZipBytes: bytes.byteLength,
    },
  };
}

/**
 * @description 响应主线程预处理请求并通过 transferable ArrayBuffer 返回新 ZIP。
 * @param {MessageEvent<{file: File}>} event Worker 消息事件。
 * @returns {Promise<void>}
 * @keyword-cn Worker消息处理, ZIP结果传输
 * @keyword-en worker-message-handler, zip-result-transfer
 */
async function handleMessage(event) {
  try {
    const result = await preprocessZip(event?.data?.file);
    self.postMessage(
      { type: 'done', buffer: result.bytes.buffer, name: result.name, summary: result.summary },
      [result.bytes.buffer],
    );
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'ZIP 客户端优化失败',
    });
  }
}

self.addEventListener('message', handleMessage);
