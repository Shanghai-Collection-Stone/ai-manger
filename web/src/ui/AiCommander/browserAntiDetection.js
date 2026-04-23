/**
 * @title 浏览器端抗 AI 识别处理
 * @description 对齐后端 AntiDetectionService 的 5 层流水线，用 Canvas 实现：
 *  L1 元数据剥离（canvas.toBlob 天然不复制 EXIF/XMP/ICC）
 *  L2 亮度/饱和度随机抖动（ImageData 逐像素 + 简化线性饱和度）
 *  L3 颗粒/噪点叠加（SVG 稀疏噪点 + drawImage composite）
 *  L4a 极微量 resize 重采样（缩小再还原，模拟二次采样）
 *  L4b JPEG 质量随机化（canvas.toBlob 的 quality 参数；浏览器内置编码器）
 *  L5 gamma 微调（ImageData pow）
 * 每次调用随机化参数避免批量指纹。
 * @keyword-en browser side anti ai detection canvas pipeline
 */

const rand = (min, max) => min + Math.random() * (max - min);
const clampInt = (n, min, max) => Math.max(min, Math.min(max, Math.round(n)));

/**
 * @description 依据强度档位随机生成参数（与后端 pickParams 同口径）
 * @keyword-en pick randomized params by strength preset
 */
const pickParams = (strength, jpegMin = 82, jpegMax = 90) => {
  const jpegQuality = clampInt(rand(jpegMin, jpegMax), 40, 100);
  let brightness = rand(0.985, 1.015);
  let saturation = rand(0.97, 1.03);
  let resampleRatio = rand(0.992, 1.0);
  let gamma = rand(1.02, 1.06);
  let noiseAlpha = 0;
  let noiseDensity = 0;

  if (strength === 'light') {
    brightness = rand(0.995, 1.005);
    saturation = rand(0.99, 1.01);
    resampleRatio = 1;
    gamma = rand(1.0, 1.02);
  } else if (strength === 'strong') {
    brightness = rand(0.97, 1.03);
    saturation = rand(0.94, 1.06);
    resampleRatio = rand(0.985, 1.0);
    gamma = rand(1.03, 1.08);
    noiseAlpha = rand(0.04, 0.07);
    noiseDensity = rand(0.12, 0.22);
  } else {
    // standard
    noiseAlpha = rand(0.02, 0.035);
    noiseDensity = rand(0.06, 0.1);
  }

  return {
    strength,
    brightness: Number(brightness.toFixed(4)),
    saturation: Number(saturation.toFixed(4)),
    resampleRatio: Number(resampleRatio.toFixed(4)),
    gamma: Number(gamma.toFixed(4)),
    noiseAlpha: Number(noiseAlpha.toFixed(4)),
    noiseDensity: Number(noiseDensity.toFixed(4)),
    jpegQuality,
  };
};

/**
 * @description 解析最终输出格式（keep 时若源为 PNG 则输出 PNG，否则 JPEG）
 * @keyword-en resolve final output format preference
 */
const resolveFinalFormat = (pref, isPng) => {
  if (pref === 'jpeg') return 'jpeg';
  if (pref === 'png') return 'png';
  return isPng ? 'png' : 'jpeg';
};

/**
 * @description 构建稀疏噪点 SVG 字符串（与后端 buildNoiseSvg 同口径）
 * @keyword-en build sparse noise svg string
 */
const buildNoiseSvg = (width, height, density, alpha) => {
  const count = Math.max(80, Math.min(6000, Math.floor(width * height * density * 0.001)));
  const parts = [];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const r = Math.random() < 0.85 ? 0.6 : 1.1;
    const gray = Math.random() < 0.5 ? 0 : 255;
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="rgb(${gray},${gray},${gray})" />`);
  }
  const a = Math.max(0, Math.min(0.2, alpha)).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" opacity="${a}">${parts.join('')}</svg>`;
};

/**
 * @description 把 SVG 字符串加载成 HTMLImageElement
 * @keyword-en load svg string as image element
 */
const loadSvgAsImage = (svg) => {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
};

/**
 * @description 把 File/Blob 解码成 ImageBitmap（兼容无 createImageBitmap 的老浏览器）
 * @keyword-en decode file to image bitmap with fallback
 */
const decodeImage = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // 某些格式（e.g. 非标准 EXIF）可能失败，降级到 Image
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
};

/**
 * @description 创建 Canvas（优先 OffscreenCanvas）
 * @keyword-en create canvas with offscreen preference
 */
const makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/**
 * @description 把 canvas 导出成 Blob（兼容 OffscreenCanvas.convertToBlob 与 HTMLCanvas.toBlob）
 * @keyword-en canvas to blob with compat
 */
const canvasToBlob = (canvas, type, quality) => {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('CANVAS_TO_BLOB_FAILED'))),
      type,
      quality,
    );
  });
};

/**
 * @description ImageData 逐像素应用 gamma / 亮度 / 饱和度；就地修改
 *  - gamma:   out = 255 * pow(in/255, 1/g)
 *  - bright:  out = in * brightness
 *  - saturation: 与灰度 Y=0.299R+0.587G+0.114B 做线性混合（近似 HSL 饱和度，速度好 10 倍）
 * @keyword-en apply color ops gamma brightness saturation
 */
const applyColorOps = (imgData, { gamma, brightness, saturation }) => {
  const data = imgData.data;
  // 预计算 gamma LUT（256 项）避免逐像素 pow
  const gammaLut = new Uint8ClampedArray(256);
  const invG = 1 / gamma;
  for (let i = 0; i < 256; i++) {
    gammaLut[i] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(i / 255, invG))));
  }
  // 饱和度系数：out = gray + sat * (in - gray)
  const satOn = Math.abs(saturation - 1) > 0.001;
  const brOn = Math.abs(brightness - 1) > 0.001;

  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    let r = gammaLut[data[i]];
    let g = gammaLut[data[i + 1]];
    let b = gammaLut[data[i + 2]];
    if (satOn) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = y + saturation * (r - y);
      g = y + saturation * (g - y);
      b = y + saturation * (b - y);
    }
    if (brOn) {
      r *= brightness;
      g *= brightness;
      b *= brightness;
    }
    data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    // alpha 不变
  }
};

/**
 * @description 基于源文件名推导输出文件名（换扩展名）
 * @keyword-en derive output filename from source name
 */
const deriveOutName = (srcName, mime) => {
  const base = (srcName || 'image').replace(/\.[^./\\]+$/u, '') || 'image';
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  return `${base}-clean.${ext}`;
};

/**
 * @description 浏览器端主处理入口
 * @param {File|Blob} file - 待处理图片
 * @param {{ strength?: 'light'|'standard'|'strong', outputFormat?: 'keep'|'jpeg'|'png', jpegQualityMin?: number, jpegQualityMax?: number }} [options]
 * @returns {Promise<{ ok: true, blob: Blob, mimeType: string, size: number, processed: boolean, outputName: string, appliedParams: object } | { ok: false, message: string }>}
 * @keyword-en process image in browser canvas pipeline
 */
export const processInBrowser = async (file, options = {}) => {
  try {
    if (!file || !file.size) return { ok: false, message: 'EMPTY_FILE' };

    const strength = options.strength || 'standard';
    const outputFormat = options.outputFormat || 'keep';
    const jpegMin = clampInt(options.jpegQualityMin ?? 82, 40, 100);
    const jpegMax = clampInt(options.jpegQualityMax ?? 90, jpegMin, 100);

    const isSrcPng = /png$/i.test(file.type) || /\.png$/i.test(file.name || '');
    const finalFormat = resolveFinalFormat(outputFormat, isSrcPng);
    const mime = finalFormat === 'png' ? 'image/png' : 'image/jpeg';

    const bitmap = await decodeImage(file);
    const w = bitmap.width;
    const h = bitmap.height;
    if (!w || !h) return { ok: false, message: 'INVALID_IMAGE_DIMENSIONS' };

    const params = pickParams(strength, jpegMin, jpegMax);

    // L4a: resize 回采样
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (params.resampleRatio !== 1 && w > 10 && h > 10) {
      const midW = Math.max(1, Math.round(w * params.resampleRatio));
      const midH = Math.max(1, Math.round(h * params.resampleRatio));
      const mid = makeCanvas(midW, midH);
      const midCtx = mid.getContext('2d');
      midCtx.imageSmoothingEnabled = true;
      midCtx.imageSmoothingQuality = 'high';
      midCtx.drawImage(bitmap, 0, 0, midW, midH);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(mid, 0, 0, w, h);
    } else {
      ctx.drawImage(bitmap, 0, 0);
    }

    // 释放 bitmap
    if (typeof bitmap.close === 'function') bitmap.close();

    // L5 + L2（gamma/亮度/饱和度）
    const imgData = ctx.getImageData(0, 0, w, h);
    applyColorOps(imgData, params);
    ctx.putImageData(imgData, 0, 0);

    // L3: 噪点叠加
    if (params.noiseAlpha > 0) {
      const svg = buildNoiseSvg(w, h, params.noiseDensity, params.noiseAlpha);
      try {
        const noiseImg = await loadSvgAsImage(svg);
        ctx.drawImage(noiseImg, 0, 0, w, h);
      } catch {
        // 噪点失败不影响主流程
      }
    }

    // L4b: 编码（JPEG 时传 quality，PNG 忽略）
    const quality = mime === 'image/jpeg' ? params.jpegQuality / 100 : undefined;
    const blob = await canvasToBlob(canvas, mime, quality);

    return {
      ok: true,
      blob,
      mimeType: mime,
      size: blob.size,
      processed: true,
      outputName: deriveOutName(file.name || 'image', mime),
      appliedParams: params,
    };
  } catch (e) {
    return { ok: false, message: e?.message || 'BROWSER_PROCESS_FAILED' };
  }
};
