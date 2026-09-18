import { BadRequestException, Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { GalleryService } from './gallery.service.js';
import type { GalleryImageEntity } from '../entities/gallery-image.entity.js';

type JimpLike = { read: (path: string) => Promise<unknown> };
type JimpImageLike = { bitmap?: { width?: number; height?: number } };

let jimpModulePromise: Promise<unknown> | null = null;

/**
 * @description AI 生成素材的固定标签，素材面板按此 tag 筛出「AI 生成」页签的内容。
 * @keyword-cn AI素材标签
 * @keyword-en ai-material-tag
 */
export const AI_GENERATED_IMAGE_TAG = 'ai素材';

/**
 * @description 判断动态导入的 jimp 是否具备读图能力，避免版本差异导致运行时崩溃。
 * @keyword-cn 判断jimp可用, 动态导入
 * @keyword-en detect-jimp-like, dynamic-import
 * @param {unknown} value 动态导入得到的模块成员。
 * @returns {boolean} true 表示可以调用 `read`。
 */
function isJimpLike(value: unknown): value is JimpLike {
  if (!value) return false;
  const type = typeof value;
  if (type !== 'object' && type !== 'function') return false;
  return typeof (value as { read?: unknown }).read === 'function';
}

/**
 * @description 把 AI 生图产出的相对地址解析成图库需要的落盘文件名、绝对路径和静态地址，并拒绝越权路径。
 * @keyword-cn 解析生图落盘路径, 防目录穿越
 * @keyword-en resolve-generated-image-file, path-traversal-guard
 * @param {string} imagePath 生图运行时返回的 `imagePath`。
 * @returns {{fileName: string, absPath: string, url: string}|null} 解析结果，远程地址或非法路径返回 null。
 */
export function resolveGeneratedImageFile(
  imagePath: string,
): { fileName: string; absPath: string; url: string } | null {
  const raw = String(imagePath ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  let rel = raw.replace(/^\/+/, '');
  if (rel.startsWith('static/uploads/'))
    rel = rel.slice('static/uploads/'.length);
  if (rel.startsWith('uploads/')) rel = rel.slice('uploads/'.length);
  const safeRel = rel
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    .join('/');
  if (!safeRel) return null;
  return {
    fileName: safeRel,
    absPath: join(process.cwd(), 'public', 'uploads', safeRel),
    url: `/static/uploads/${safeRel}`,
  };
}

/**
 * @description 把任意 AI 生图运行时的落盘结果统一登记进图库：校验文件、补尺寸与缩略图、打标签后写库。
 *   图库 AI 素材和抖音分镜配图共用这一条入库通道，避免各自复制一份落盘逻辑。
 * @keyword-cn 生图入库服务, 统一落盘通道
 * @keyword-en gallery-ai-image-service, unified-persist-pipeline
 */
@Injectable()
export class GalleryAiImageService {
  constructor(private readonly gallery: GalleryService) {}

  /**
   * @description 把一次生图产出的本地文件登记成当前租户用户的图库素材并返回入库记录。
   * @keyword-cn 登记生成图片, 图库素材入库
   * @keyword-en persist-generated-image, gallery-image-intake
   * @param {{imagePath: string, userId: string, tenantId?: string, originalName: string, description?: string, tags?: string[]}} input 入库参数。
   * @returns {Promise<GalleryImageEntity>} 入库后的图库记录。
   * @throws {BadRequestException} 生图地址为空、文件缺失或落盘失败时抛出。
   */
  async persistGeneratedImage(input: {
    imagePath: string;
    userId: string;
    tenantId?: string;
    originalName: string;
    description?: string;
    tags?: string[];
  }): Promise<GalleryImageEntity> {
    const file = resolveGeneratedImageFile(input.imagePath);
    if (!file) throw new BadRequestException('AI_MATERIAL_IMAGE_EMPTY');

    let byteSize: number | undefined;
    try {
      const stat = await fs.stat(file.absPath);
      byteSize =
        Number.isFinite(stat.size) && stat.size > 0 ? stat.size : undefined;
    } catch {
      throw new BadRequestException('AI_MATERIAL_IMAGE_MISSING');
    }

    const dimensions = await this.readDimensions(file.absPath);
    const thumb = await this.gallery.generateThumbnail(
      file.absPath,
      file.fileName,
    );
    const tags = Array.from(
      new Set(
        [AI_GENERATED_IMAGE_TAG, ...(input.tags ?? [])]
          .map((tag) => String(tag ?? '').trim())
          .filter(Boolean),
      ),
    );
    const [doc] = await this.gallery.createMany([
      {
        userId: input.userId,
        tenantId: input.tenantId,
        originalName: input.originalName.slice(0, 60),
        fileName: file.fileName,
        absPath: file.absPath,
        url: file.url,
        ...(thumb ?? {}),
        mimeType:
          extname(file.fileName).toLowerCase() === '.png'
            ? 'image/png'
            : 'image/jpeg',
        size: byteSize,
        width: dimensions?.width,
        height: dimensions?.height,
        tags,
        description: input.description,
      },
    ]);
    return doc;
  }

  /**
   * @description 用 jimp 读出生成图片的真实像素尺寸，失败时返回 null 让上层按未知尺寸入库。
   * @keyword-cn 读取图片尺寸, 竖图判定
   * @keyword-en read-image-dimensions, portrait-detection
   * @param {string} absPath 图片绝对路径。
   * @returns {Promise<{width: number, height: number}|null>} 像素尺寸。
   */
  private async readDimensions(
    absPath: string,
  ): Promise<{ width: number; height: number } | null> {
    if (!jimpModulePromise) jimpModulePromise = import('jimp');
    const mod = await jimpModulePromise;
    const Jimp =
      mod && typeof mod === 'object'
        ? (mod as Record<string, unknown>).Jimp
        : undefined;
    if (!isJimpLike(Jimp)) return null;
    try {
      const image = (await Jimp.read(absPath)) as JimpImageLike;
      const width = Number(image?.bitmap?.width ?? 0);
      const height = Number(image?.bitmap?.height ?? 0);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    } catch {
      return null;
    }
  }
}
