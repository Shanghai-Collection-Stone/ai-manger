import { Injectable, Logger } from '@nestjs/common';
import type { Sharp } from 'sharp';
import {
  AntiDetectionOptions,
  AntiDetectionOutputFormat,
  AntiDetectionResult,
  AntiDetectionStrength,
} from '../types/anti-detection.types';

/**
 * @title 抗AI识别处理服务 Anti-AI-Detection Service
 * @description 对 AI 生成的图片二进制进行多层处理以降低被"AI生图检测器"识别的概率。
 * 处理手段包括：
 *  L1 元数据剥离 (EXIF/XMP/ICC)
 *  L2 亮度/饱和度随机抖动
 *  L3 颗粒/噪点叠加 (SVG 稀疏噪点)
 *  L4 极微量 resize 重采样 + JPEG 质量随机重编码 (模拟截屏压缩链路)
 *  L5 gamma 微调 (打乱颜色直方图统计特征)
 * 参数在每次调用时随机化，避免批量指纹。
 * @keywords-cn 抗AI识别, 去AI特征, 噪点, 颗粒感, EXIF清理, 截屏采样, 重采样, 图片处理
 * @keywords-en anti ai detection, remove ai fingerprint, noise, grain, exif strip, screenshot resample, sharp pipeline
 */
@Injectable()
export class AntiDetectionService {
  private readonly logger = new Logger(AntiDetectionService.name);
  private sharpModule: typeof import('sharp') | null | undefined = undefined;

  /**
   * @description 对图片 Buffer 执行抗 AI 识别处理，返回处理后的 Buffer 与 mimeType。
   * 失败时降级返回原 Buffer（processed=false），调用方无需额外 try/catch。
   * @param {Buffer} buffer - 原始图片二进制
   * @param {AntiDetectionOptions} [options] - 处理选项
   * @returns {Promise<AntiDetectionResult>} 处理后二进制 + mimeType + 是否处理 + 参数
   * @keyword-en process image buffer with anti detection pipeline
   */
  async process(
    buffer: Buffer,
    options: AntiDetectionOptions = {},
  ): Promise<AntiDetectionResult> {
    const tag = options.tag ?? 'anti-detection';
    if (options.enabled === false) {
      return { buffer, mimeType: 'image/jpeg', processed: false };
    }
    if (!buffer || buffer.length === 0) {
      return { buffer, mimeType: 'image/jpeg', processed: false };
    }

    const sharp = await this.loadSharp();
    if (!sharp) {
      this.logger.warn(`[${tag}] sharp unavailable, skip anti-detection`);
      return { buffer, mimeType: 'image/jpeg', processed: false };
    }

    try {
      const strength: AntiDetectionStrength = options.strength ?? 'standard';
      const outputFormat: AntiDetectionOutputFormat =
        options.outputFormat ?? 'keep';
      const jpegMin = this.clampInt(options.jpegQualityMin ?? 82, 40, 100);
      const jpegMax = this.clampInt(options.jpegQualityMax ?? 90, jpegMin, 100);

      const srcMeta = await sharp(buffer).metadata();
      const srcFormat = (srcMeta.format ?? 'jpeg').toLowerCase();
      const isSrcPng = srcFormat === 'png';

      const finalFormat = this.resolveFinalFormat(outputFormat, isSrcPng);
      const width = srcMeta.width ?? 0;
      const height = srcMeta.height ?? 0;

      const params = this.pickParams(strength, jpegMin, jpegMax);

      // L1: 元数据剥离
      // Sharp 默认不复制 EXIF / XMP / ICC 等元数据到输出（不调用 withMetadata/keepMetadata 即为彻底清除）。
      // 这也会顺带去除 AI 提供商在 EXIF/XMP 中埋入的生成器标识 (Software/Comment) 与 C2PA 水印。
      let pipeline: Sharp = sharp(buffer, { failOn: 'none' });

      // L5: gamma 微调（需在像素操作前，避免后续操作堆叠 gamma 失真）
      if (params.gamma !== 1 && params.gamma >= 1.0 && params.gamma <= 3.0) {
        pipeline = pipeline.gamma(params.gamma);
      } else if (params.gamma !== 1) {
        // sharp 的 gamma 范围是 [1.0, 3.0]，<1 的抖动通过 linear 模拟
        pipeline = pipeline.linear(params.gammaLinearA, params.gammaLinearB);
      }

      // L2: 亮度 / 饱和度随机抖动
      if (params.useModulate) {
        pipeline = pipeline.modulate({
          brightness: params.brightness,
          saturation: params.saturation,
        });
      }

      // L4a: 极微量 resize 重采样（模拟二次采样）
      if (params.resampleRatio !== 1 && width > 10 && height > 10) {
        const newW = Math.max(1, Math.round(width * params.resampleRatio));
        const newH = Math.max(1, Math.round(height * params.resampleRatio));
        pipeline = pipeline.resize(newW, newH, { kernel: 'lanczos3' });
        if (newW !== width || newH !== height) {
          pipeline = pipeline.resize(width, height, { kernel: 'lanczos3' });
        }
      }

      // L3: 颗粒 / 噪点叠加（SVG 稀疏噪点层）
      if (params.noiseAlpha > 0 && width > 0 && height > 0) {
        const noiseSvg = this.buildNoiseSvg(
          width,
          height,
          params.noiseDensity,
          params.noiseAlpha,
        );
        pipeline = pipeline.composite([
          {
            input: Buffer.from(noiseSvg, 'utf8'),
            top: 0,
            left: 0,
            blend: 'over',
          },
        ]);
      }

      // L4b: 编码输出（JPEG 质量随机化，模拟手机截屏压缩）
      let outBuffer: Buffer;
      let outMime: string;
      if (finalFormat === 'png') {
        outBuffer = await pipeline
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toBuffer();
        outMime = 'image/png';
      } else {
        outBuffer = await pipeline
          .jpeg({
            quality: params.jpegQuality,
            mozjpeg: true,
            chromaSubsampling: '4:2:0',
          })
          .toBuffer();
        outMime = 'image/jpeg';
      }

      return {
        buffer: outBuffer,
        mimeType: outMime,
        processed: true,
        appliedParams: params as unknown as Record<
          string,
          number | string | boolean
        >,
      };
    } catch (err) {
      this.logger.warn(
        `[${tag}] anti-detection process failed, fallback to origin: ${err}`,
      );
      return { buffer, mimeType: 'image/jpeg', processed: false };
    }
  }

  /**
   * @description 依据强度档位与 JPEG 质量区间，随机生成本次处理参数。
   * @param {AntiDetectionStrength} strength - 强度档位
   * @param {number} jpegMin - JPEG 质量下限
   * @param {number} jpegMax - JPEG 质量上限
   * @returns {object} 参数集
   * @keyword-en pick randomized anti detection params
   */
  private pickParams(
    strength: AntiDetectionStrength,
    jpegMin: number,
    jpegMax: number,
  ) {
    const rand = (min: number, max: number): number =>
      min + Math.random() * (max - min);
    const jpegQuality = this.clampInt(
      Math.round(rand(jpegMin, jpegMax)),
      40,
      100,
    );

    // 默认 standard 档
    const useModulate = true;
    let brightness = rand(0.985, 1.015);
    let saturation = rand(0.97, 1.03);
    let resampleRatio = rand(0.992, 1.0);
    let gamma = rand(1.02, 1.06); // 向 1 靠近的轻微偏移，sharp 支持 >=1.0
    let gammaLinearA = 1;
    let gammaLinearB = 0;
    let noiseAlpha = 0;
    let noiseDensity = 0;

    if (strength === 'light') {
      brightness = rand(0.995, 1.005);
      saturation = rand(0.99, 1.01);
      resampleRatio = 1;
      gamma = rand(1.0, 1.02);
      noiseAlpha = 0;
      noiseDensity = 0;
    } else if (strength === 'strong') {
      brightness = rand(0.97, 1.03);
      saturation = rand(0.94, 1.06);
      resampleRatio = rand(0.985, 1.0);
      gamma = rand(1.03, 1.08);
      noiseAlpha = rand(0.04, 0.07); // 4%~7% 颗粒
      noiseDensity = rand(0.12, 0.22);
    } else {
      // standard：轻度颗粒，平衡视觉与抗识别
      noiseAlpha = rand(0.02, 0.035);
      noiseDensity = rand(0.06, 0.1);
    }

    // 用 linear(a, b) 逼近 <1 gamma 的能力（当前默认 gamma 都 >=1，保留兜底）
    if (gamma < 1.0) {
      gammaLinearA = rand(0.98, 1.0);
      gammaLinearB = rand(-2, 2);
      gamma = 1.0;
    }

    return {
      strength,
      useModulate,
      brightness: Number(brightness.toFixed(4)),
      saturation: Number(saturation.toFixed(4)),
      resampleRatio: Number(resampleRatio.toFixed(4)),
      gamma: Number(gamma.toFixed(4)),
      gammaLinearA,
      gammaLinearB,
      noiseAlpha: Number(noiseAlpha.toFixed(4)),
      noiseDensity: Number(noiseDensity.toFixed(4)),
      jpegQuality,
    };
  }

  /**
   * @description 构建稀疏随机噪点 SVG（单色黑点，靠 composite over 低 alpha 叠加）。
   * 密度 density ∈ [0,1]：点数 = width*height*density*0.001。
   * @param {number} width - 图宽
   * @param {number} height - 图高
   * @param {number} density - 相对密度
   * @param {number} alpha - 透明度 0~1
   * @returns {string} SVG 字符串
   * @keyword-en build sparse noise svg layer
   */
  private buildNoiseSvg(
    width: number,
    height: number,
    density: number,
    alpha: number,
  ): string {
    const count = Math.max(
      80,
      Math.min(6000, Math.floor(width * height * density * 0.001)),
    );
    let dots = '';
    for (let i = 0; i < count; i++) {
      const x = Math.floor(Math.random() * width);
      const y = Math.floor(Math.random() * height);
      const r = Math.random() < 0.85 ? 0.6 : 1.1;
      const gray = Math.random() < 0.5 ? 0 : 255;
      dots += `<circle cx="${x}" cy="${y}" r="${r}" fill="rgb(${gray},${gray},${gray})" />`;
    }
    const a = Math.max(0, Math.min(0.2, alpha));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" opacity="${a.toFixed(3)}">${dots}</svg>`;
  }

  /**
   * @description 解析最终输出格式（keep 根据源图类型决定）。
   * @param {AntiDetectionOutputFormat} pref - 偏好
   * @param {boolean} isSrcPng - 源图是否为 PNG
   * @returns {'jpeg' | 'png'} 输出格式
   * @keyword-en resolve final output format
   */
  private resolveFinalFormat(
    pref: AntiDetectionOutputFormat,
    isSrcPng: boolean,
  ): 'jpeg' | 'png' {
    if (pref === 'jpeg') return 'jpeg';
    if (pref === 'png') return 'png';
    return isSrcPng ? 'png' : 'jpeg';
  }

  /**
   * @description 兼容加载 sharp（支持 default / namespace export，缓存实例）
   * @returns {Promise<typeof import('sharp') | null>} sharp 构造函数
   * @keyword-en load sharp with module interop cache
   */
  private async loadSharp(): Promise<typeof import('sharp') | null> {
    if (this.sharpModule !== undefined) return this.sharpModule;
    try {
      const mod = (await import('sharp')) as unknown;
      const maybeDefault = (mod as { default?: unknown }).default;
      const sharp = typeof maybeDefault === 'function' ? maybeDefault : mod;
      this.sharpModule =
        typeof sharp === 'function' ? (sharp as typeof import('sharp')) : null;
    } catch {
      this.sharpModule = null;
    }
    return this.sharpModule;
  }

  /**
   * @description 整数 clamp
   * @param {number} n - 数值
   * @param {number} min - 下限
   * @param {number} max - 上限
   * @returns {number} 夹取后整数
   * @keyword-en clamp integer value
   */
  private clampInt(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(n)));
  }
}
