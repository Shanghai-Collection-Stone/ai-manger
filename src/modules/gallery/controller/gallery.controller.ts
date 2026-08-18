import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseFilters,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { GalleryService } from '../services/gallery.service.js';
import { GalleryGroupService } from '../services/gallery-group.service.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { AgentService } from '../../ai-agent/services/agent.service.js';
import { GalleryUploadExceptionFilter } from '../filters/gallery-upload-exception.filter.js';
import type { GalleryImageEntity } from '../entities/gallery-image.entity.js';
import type { GalleryGroupEntity } from '../entities/gallery-group.entity.js';
import type { Request } from 'express';

type JimpLike = { read: (path: string) => Promise<unknown> };
type JimpImageLike = {
  bitmap?: { width?: number; height?: number };
  resize: (opts: { w: number; h: number }) => unknown;
  write: (path: string, opts?: { quality?: number }) => Promise<unknown>;
};

let jimpModulePromise: Promise<unknown> | null = null;

/**
 * @description AI 生成素材的固定标签，素材面板按此 tag 筛出「AI 生成」页签的内容。
 * @keyword-cn AI素材标签
 * @keyword-en ai material tag
 */
export const AI_MATERIAL_TAG = 'ai素材';

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
}

function isJimpLike(v: unknown): v is JimpLike {
  if (!v) return false;
  const t = typeof v;
  if (t !== 'object' && t !== 'function') return false;
  const read = (v as { read?: unknown }).read;
  return typeof read === 'function';
}

function isJimpImageLike(v: unknown): v is JimpImageLike {
  if (!isRecord(v)) return false;
  return typeof v.resize === 'function' && typeof v.write === 'function';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown-error';
  }
}

function parseBooleanFlag(input: unknown): boolean | undefined {
  if (typeof input === 'boolean') return input;
  if (typeof input !== 'string') return undefined;
  const v = input.trim().toLowerCase();
  if (!v) return undefined;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n') return false;
  return undefined;
}

/**
 * @description 根据文件名识别是否为动态封面/动态拼图导入。
 * @param {string} name - 文件名或路径。
 * @returns {'cover' | 'collage' | undefined} 识别类型。
 * @keyword-en detect generated image kind by name
 */
function detectGeneratedImageKindByName(
  name: string,
): 'cover' | 'collage' | undefined {
  const s = String(name || '')
    .trim()
    .toLowerCase();
  if (!s) return undefined;
  if (/(^|[\/_\-.])(cover)([\/_\-.]|$)/i.test(s) || /封面/i.test(s)) {
    return 'cover';
  }
  if (/(^|[\/_\-.])(collage)([\/_\-.]|$)/i.test(s) || /拼图/i.test(s)) {
    return 'collage';
  }
  return undefined;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(1, Math.floor(limit || 1));
  let idx = 0;
  const results = new Array<R>(list.length);

  const workers = new Array(Math.min(n, list.length)).fill(0).map(async () => {
    while (true) {
      const cur = idx;
      idx += 1;
      if (cur >= list.length) return;
      results[cur] = await mapper(list[cur]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function compressUploadFiles(
  gallery: GalleryService,
  files: Express.Multer.File[],
): Promise<void> {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return;

  const concurrency = 2;
  await mapLimit(list, concurrency, async (f) => {
    const p = f.path;
    if (!p) return;
    // 复用 GalleryService.compressImageInPlace,与 ZIP 批量导入共用同一压缩口径
    const r = await gallery.compressImageInPlace({
      filePath: p,
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 75,
    });
    if (r.reason && r.reason !== 'not-smaller') {
      console.error(`[gallery-compress-skip] ${p} :: ${r.reason}`);
    }
    if (r.changed) {
      f.size = r.afterSize;
    }
  });
}

/**
 * @description 从图片文件获取尺寸信息。
 * @param {string} filePath - 图片文件路径。
 * @returns {Promise<{ width: number; height: number; isPortrait: boolean } | null>} 尺寸信息，失败返回null。
 * @keyword gallery, image, dimensions, jimp
 * @since 2026-03-30
 */
async function getImageDimensionsFromFile(
  filePath: string,
): Promise<{ width: number; height: number; isPortrait: boolean } | null> {
  const src = String(filePath || '');
  if (!src) return null;

  if (!jimpModulePromise)
    jimpModulePromise = import('jimp') as Promise<unknown>;
  const mod = await jimpModulePromise;
  const Jimp = isRecord(mod) ? mod.Jimp : undefined;
  if (!isJimpLike(Jimp)) return null;

  try {
    const imgUnknown = await Jimp.read(src);
    if (!isJimpImageLike(imgUnknown)) return null;
    const w =
      typeof imgUnknown.bitmap?.width === 'number'
        ? imgUnknown.bitmap.width
        : 0;
    const h =
      typeof imgUnknown.bitmap?.height === 'number'
        ? imgUnknown.bitmap.height
        : 0;
    if (w <= 0 || h <= 0) return null;
    return { width: w, height: h, isPortrait: h > w };
  } catch {
    return null;
  }
}

/**
 * @description 批量提取上传文件的尺寸信息。
 * @param {Express.Multer.File[]} files - 上传的文件数组。
 * @returns {Promise<Map<string, { width: number; height: number; isPortrait: boolean }>>} key=原始filename。
 * @keyword gallery, dimensions, batch
 * @since 2026-03-30
 */
async function extractUploadFileDimensions(
  files: Express.Multer.File[],
): Promise<
  Map<string, { width: number; height: number; isPortrait: boolean }>
> {
  const list = Array.isArray(files) ? files : [];
  const out = new Map<
    string,
    { width: number; height: number; isPortrait: boolean }
  >();
  if (list.length === 0) return out;

  const concurrency = 4;
  await mapLimit(list, concurrency, async (f) => {
    const key = String(f.filename || '');
    const p = String(f.path || '');
    if (!key || !p) return;
    const dims = await getImageDimensionsFromFile(p);
    if (dims) {
      out.set(key, dims);
    }
  });

  return out;
}

/**
 * @description 生成图片缩略图文件（写入到指定输出路径）。
 * @param {{ sourcePath: string; outputPath: string; maxWidth?: number; maxHeight?: number; quality?: number }} params - 缩略图生成参数。
 * @returns {Promise<{ ok: boolean; reason?: string }>} 生成结果。
 * @keyword gallery, thumbnail, resize
 * @since 2026-02-04
 */
async function createImageThumbnail(params: {
  sourcePath: string;
  outputPath: string;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const sourcePath = String(params.sourcePath || '');
  const outputPath = String(params.outputPath || '');
  if (!sourcePath || !outputPath) return { ok: false, reason: 'no-path' };

  const maxWidth = Math.max(1, Math.floor(params.maxWidth ?? 720));
  const maxHeight = Math.max(1, Math.floor(params.maxHeight ?? 720));
  const quality = Math.min(92, Math.max(35, Math.floor(params.quality ?? 68)));

  if (!jimpModulePromise)
    jimpModulePromise = import('jimp') as Promise<unknown>;
  const mod = await jimpModulePromise;
  const Jimp = isRecord(mod) ? mod.Jimp : undefined;
  if (!isJimpLike(Jimp)) return { ok: false, reason: 'jimp-unavailable' };

  let imgUnknown: unknown;
  try {
    imgUnknown = await Jimp.read(sourcePath);
  } catch (e) {
    return { ok: false, reason: errorMessage(e) };
  }

  if (!isJimpImageLike(imgUnknown)) return { ok: false, reason: 'bad-image' };

  const img = imgUnknown;
  const w = typeof img.bitmap?.width === 'number' ? img.bitmap.width : 0;
  const h = typeof img.bitmap?.height === 'number' ? img.bitmap.height : 0;
  if (w > 0 && h > 0) {
    const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
    const nw = Math.max(1, Math.floor(w * ratio));
    const nh = Math.max(1, Math.floor(h * ratio));
    if (nw !== w || nh !== h) img.resize({ w: nw, h: nh });
  }

  try {
    await img.write(outputPath, { quality });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: errorMessage(e) };
  }
}

/**
 * @description 为上传文件批量生成缩略图，并回填缩略图信息到返回映射。
 * @param {Express.Multer.File[]} files - 上传的文件数组。
 * @returns {Promise<Map<string, { thumbFileName: string; thumbUrl: string }>>} key=原始filename。
 * @keyword gallery, thumbnail, batch
 * @since 2026-02-04
 */
async function createUploadThumbnails(
  files: Express.Multer.File[],
): Promise<Map<string, { thumbFileName: string; thumbUrl: string }>> {
  const list = Array.isArray(files) ? files : [];
  const out = new Map<string, { thumbFileName: string; thumbUrl: string }>();
  if (list.length === 0) return out;

  const dir = join(process.cwd(), 'public', 'uploads_thumbs');
  mkdirSync(dir, { recursive: true });

  const concurrency = 2;
  await mapLimit(list, concurrency, async (f) => {
    const src = String(f.path || '');
    const key = String(f.filename || '');
    if (!src || !key) return;
    const rawExt = extname(key).toLowerCase();
    const ext = rawExt && rawExt.length <= 12 ? rawExt : '.jpg';
    const thumbFileName = `${Date.now()}-${randomUUID()}${ext}`;
    const outputPath = join(dir, thumbFileName);
    const r = await createImageThumbnail({
      sourcePath: src,
      outputPath,
      maxWidth: 720,
      maxHeight: 720,
      quality: 68,
    });
    if (!r.ok) {
      if (r.reason) console.error(`[gallery-thumb-skip] ${src} :: ${r.reason}`);
      return;
    }
    out.set(key, {
      thumbFileName,
      thumbUrl: `/static/uploads_thumbs/${thumbFileName}`,
    });
  });

  return out;
}

@Controller('gallery')
export class GalleryController {
  constructor(
    private readonly gallery: GalleryService,
    private readonly groups: GalleryGroupService,
    private readonly adminService: AdminService,
    private readonly agent: AgentService,
  ) {}

  /**
   * @description 从请求中解析租户范围（必须提供有效的认证 token）
   * @param {Request} req - Express 请求对象
   * @returns {Promise<{ tenantId?: string; userId?: string }>} 租户和用户范围
   * @throws {UnauthorizedException} 当没有 token 或 token 无效时抛出
   * @keyword-en resolve auth scope from request
   */
  private async resolveAuthScope(req: Request): Promise<{
    tenantId?: string;
    userId?: string;
  }> {
    const auth = req?.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    const token = auth.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    const user = await this.adminService.getUserByToken(token);
    if (!user) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    return {
      tenantId: user.tenantId,
      userId: user.username,
    };
  }

  /**
   * @description 将默认动态分组（动态封面/动态拼图）固定置顶展示。
   * @param {GalleryGroupEntity[]} groups - 原始分组列表。
   * @param {number[]} defaultIds - 默认分组ID顺序（封面在前，拼图在后）。
   * @returns {GalleryGroupEntity[]} 排序后的分组列表。
   * @keyword-en prioritize default generated groups
   */
  private prioritizeDefaultGroups(
    groups: GalleryGroupEntity[],
    defaultIds: (string | number)[],
  ): GalleryGroupEntity[] {
    const list = Array.isArray(groups) ? groups : [];
    const idOrder = (Array.isArray(defaultIds) ? defaultIds : []).filter(
      (id) =>
        (typeof id === 'number' && Number.isFinite(id)) ||
        typeof id === 'string',
    );
    if (idOrder.length === 0) return list;

    const byId = new Map<string | number, GalleryGroupEntity>();
    for (const g of list) {
      if (
        (typeof g?.id === 'number' || typeof g?.id === 'string') &&
        !byId.has(g.id)
      ) {
        byId.set(g.id, g);
      }
    }

    const out: GalleryGroupEntity[] = [];
    const used = new Set<string | number>();
    for (const gid of idOrder) {
      const g = byId.get(gid);
      if (!g) continue;
      out.push(g);
      used.add(gid);
    }
    for (const g of list) {
      if (typeof g?.id !== 'number' && typeof g?.id !== 'string') continue;
      if (used.has(g.id)) continue;
      out.push(g);
    }
    return out;
  }

  /**
   * @description 上传图片文件并写入图库记录（含Embedding向量）。
   * @param {Express.Multer.File[]} files - 上传的文件数组（字段名：files）。
   * @param {{ userId?: string; tenantId?: string; groupId?: string; tags?: string; description?: string }} body - 表单字段。
   * @returns {Promise<{ images: Array<Omit<GalleryImageEntity, '_id'>> }>} 新建图片记录列表。
   * @throws {BadRequestException} 当未上传文件或缺少 userId 时抛出。
   * @keyword gallery, controller, upload
   * @since 2026-02-04
   */
  @Post('upload')
  @UseFilters(new GalleryUploadExceptionFilter())
  @UseInterceptors(
    FilesInterceptor('files', 24, {
      storage: multer.diskStorage({
        destination: (
          _req: unknown,
          _file: Express.Multer.File,
          cb: (error: Error | null, destination: string) => void,
        ) => {
          const dir = join(process.cwd(), 'public', 'uploads');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (
          _req: unknown,
          file: Express.Multer.File,
          cb: (error: Error | null, filename: string) => void,
        ) => {
          const rawExt = extname(String(file.originalname || '')).toLowerCase();
          const ext = rawExt && rawExt.length <= 12 ? rawExt : '';
          cb(null, `${Date.now()}-${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (
        _req: unknown,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const mt = String(file.mimetype || '').toLowerCase();
        cb(null, mt.startsWith('image/'));
      },
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      userId?: string;
      tenantId?: string;
      groupId?: string;
      tags?: string;
      description?: string;
      isCollage?: string;
      collageSourceImageIds?: string;
      collageWidth?: string;
      collageHeight?: string;
      collageDpi?: string;
    },
    @Req() req?: Request,
  ): Promise<{ images: Array<Omit<GalleryImageEntity, '_id'>> }> {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('No image files uploaded');
    }
    if (files.length > 24) {
      throw new BadRequestException(
        `最多只能同时上传 24 个文件，当前选择了 ${files.length} 个`,
      );
    }
    const authScope = req ? await this.resolveAuthScope(req) : {};
    const userId =
      String(body?.userId ?? '').trim() || authScope.userId || undefined;
    if (!userId) throw new BadRequestException('userId is required');
    const tenantId =
      authScope.tenantId || String(body?.tenantId ?? '').trim() || undefined;

    const rawTags = String(body?.tags ?? '');
    const tags = rawTags
      .split(/[,\t\n\r\s]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const description =
      typeof body?.description === 'string' &&
      body.description.trim().length > 0
        ? body.description.trim()
        : undefined;
    const explicitIsCollage = parseBooleanFlag(body?.isCollage) === true;
    const collageSourceImageIds = String(body?.collageSourceImageIds ?? '')
      .split(/[,\s]+/g)
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x))
      .slice(0, 2);
    if (explicitIsCollage) {
      if (files.length !== 1) {
        throw new BadRequestException(
          'collage upload requires exactly one file',
        );
      }
      if (collageSourceImageIds.length !== 2) {
        throw new BadRequestException(
          'collageSourceImageIds requires exactly two image ids',
        );
      }
    }
    const collageWidth = Number(body?.collageWidth ?? 640);
    const collageHeight = Number(body?.collageHeight ?? 853);
    const collageDpi = Number(body?.collageDpi ?? 96);

    const groupIdRaw = String(body?.groupId ?? '').trim();
    const groupId = groupIdRaw.length > 0 ? Number(groupIdRaw) : undefined;

    const detectedKinds = files.map((f) =>
      detectGeneratedImageKindByName(
        `${String(f.originalname || '')} ${String(f.filename || '')}`,
      ),
    );
    const hasDetectedCover = detectedKinds.some((k) => k === 'cover');
    const hasDetectedCollage =
      explicitIsCollage || detectedKinds.some((k) => k === 'collage');

    let dynamicCoverGroupId: string | number | undefined;
    let dynamicCollageGroupId: string | number | undefined;
    if (hasDetectedCover || hasDetectedCollage) {
      const defaults = await this.groups.ensureDefaultDynamicGroups(
        userId,
        tenantId,
      );
      dynamicCoverGroupId = defaults.coverGroup.id;
      dynamicCollageGroupId = defaults.collageGroup.id;
    }

    await compressUploadFiles(this.gallery, files);
    // 提取图片尺寸（压缩后），保证宽高元数据与落盘文件一致
    const dims = await extractUploadFileDimensions(files);
    const thumbs = await createUploadThumbnails(files);

    const inputs = files.map((f, idx) => {
      const key = String(f.filename || '');
      const dim = dims.get(key);
      const kind = detectedKinds[idx];
      const markAsCover = kind === 'cover';
      const markAsCollage = explicitIsCollage || kind === 'collage';
      const markAsGenerated = markAsCover || markAsCollage;
      const finalGroupId = markAsCover
        ? dynamicCoverGroupId
        : markAsGenerated
          ? dynamicCollageGroupId
          : groupId !== undefined &&
              (typeof groupId === 'number'
                ? Number.isFinite(groupId)
                : typeof groupId === 'string')
            ? groupId
            : undefined;

      const collageMetaWidth =
        dim?.width ?? (Number.isFinite(collageWidth) ? collageWidth : 640);
      const collageMetaHeight =
        dim?.height ?? (Number.isFinite(collageHeight) ? collageHeight : 853);

      return {
        userId,
        tenantId,
        groupId: finalGroupId,
        originalName: String(f.originalname || ''),
        fileName: key,
        absPath: String(f.path || ''),
        url: `/static/uploads/${key}`,
        ...(thumbs.get(key) ?? {}),
        mimeType: String(f.mimetype || ''),
        size: typeof f.size === 'number' ? f.size : undefined,
        width: dim?.width,
        height: dim?.height,
        isPortrait: dim?.isPortrait,
        tags,
        description,
        isCollage: markAsGenerated,
        collageSourceImageIds: explicitIsCollage
          ? collageSourceImageIds
          : undefined,
        collageMeta: markAsGenerated
          ? {
              width: collageMetaWidth,
              height: collageMetaHeight,
              dpi: Number.isFinite(collageDpi) ? collageDpi : 96,
            }
          : undefined,
      };
    });

    const docs = await this.gallery.createMany(inputs);
    return { images: docs.map((d) => ({ ...d, _id: undefined })) };
  }

  /**
   * @description 把生图返回的本地路径解析成 public/uploads 下的文件信息，拒绝外链和穿越路径。
   * @param {string} url - 生图返回的 imagePath。
   * @returns {{ fileName: string; absPath: string; url: string } | null} 文件信息，非法时返回 null。
   * @keyword-cn 素材落盘
   * @keyword-en resolve generated material file
   */
  private resolveGeneratedMaterialFile(
    url: string,
  ): { fileName: string; absPath: string; url: string } | null {
    const raw = String(url ?? '')
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
   * @description AI 生成贴纸素材并入图库。提示词强制单主体 + 纯色背景 + 无文字，
   * 便于前端 GPU 去底后直接当贴纸用；可选参考图只约束配色、字体气质与构成语言，
   * 不作为最终素材内容。生成结果打 `ai素材` 标签供素材面板筛选。
   * @param {{ prompt?: string; size?: string; tags?: string; userId?: string; referenceImageUrl?: string }} body - 生成参数。
   * @param {Request} [req] - Express 请求对象，用于解析租户范围。
   * @returns {Promise<{ image: Omit<GalleryImageEntity, '_id'> }>} 入库后的素材记录。
   * @throws {BadRequestException} 提示词为空或生图结果落盘失败时抛出。
   * @keyword-cn AI素材生成
   * @keyword-en ai-material-generate
   */
  @Post('ai-material')
  async generateAiMaterial(
    @Body()
    body: {
      prompt?: string;
      size?: string;
      tags?: string;
      userId?: string;
      referenceImageUrl?: string;
    },
    @Req() req?: Request,
  ): Promise<{ image: Omit<GalleryImageEntity, '_id'> }> {
    const authScope = req ? await this.resolveAuthScope(req) : {};
    const userId =
      String(body?.userId ?? '').trim() || authScope.userId || undefined;
    if (!userId) throw new BadRequestException('userId is required');
    const tenantId = authScope.tenantId || undefined;

    const rawPrompt = String(body?.prompt ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawPrompt) throw new BadRequestException('prompt is required');

    const size = /^\d{2,5}x\d{2,5}$/i.test(String(body?.size ?? '').trim())
      ? String(body.size).trim()
      : '1024x1024';
    const referenceImageUrl = String(body?.referenceImageUrl ?? '')
      .trim()
      .slice(0, 2000);
    const prompt = [
      `贴纸素材主体:${rawPrompt}`,
      referenceImageUrl
        ? '【风格参考】已附参考图，只学习其色彩组合、粗细对比、字体气质、描边方式和装饰构成；严禁复制参考图中的具体文字、人物、品牌或版面内容。'
        : '',
      '【素材规格 - 必须严格遵守】',
      '1. 画面只有一个主体，居中、完整、不裁切，主体边缘清晰锐利、轮廓闭合。',
      '2. 背景必须是单一纯色平铺(推荐纯白 #FFFFFF 或纯品绿 #00FF00)，无渐变、无阴影、无投影、无地面、无纹理、无场景元素。',
      '3. 严禁画面内出现任何文字、字母、数字、水印、logo、二维码、边框、马赛克棋盘格。',
      '4. 风格干净、色彩明快、主体与背景色差大，便于后续抠图去底。',
      '5. 只输出主体本身，不要拼图、不要多格、不要展示图排版。',
    ]
      .filter(Boolean)
      .join('\n');

    const generated = await this.agent.sendPrompt({
      prompt,
      size,
      includeSystemPrompt: false,
      ...(referenceImageUrl
        ? { baseImageCandidates: [referenceImageUrl] }
        : {}),
    });
    const file = this.resolveGeneratedMaterialFile(
      String(generated?.imagePath ?? ''),
    );
    if (!file) throw new BadRequestException('AI_MATERIAL_IMAGE_EMPTY');

    let byteSize: number | undefined;
    try {
      const st = await fs.stat(file.absPath);
      byteSize = Number.isFinite(st.size) && st.size > 0 ? st.size : undefined;
    } catch {
      throw new BadRequestException('AI_MATERIAL_IMAGE_MISSING');
    }

    const dim = await getImageDimensionsFromFile(file.absPath);
    const thumb = await this.gallery.generateThumbnail(
      file.absPath,
      file.fileName,
    );
    const tags = Array.from(
      new Set(
        [
          AI_MATERIAL_TAG,
          ...String(body?.tags ?? '')
            .split(/[,\t\n\r\s]+/g)
            .map((t) => t.trim()),
        ].filter((t) => t.length > 0),
      ),
    );

    const [doc] = await this.gallery.createMany([
      {
        userId,
        tenantId,
        originalName: rawPrompt.slice(0, 60),
        fileName: file.fileName,
        absPath: file.absPath,
        url: file.url,
        ...(thumb ?? {}),
        mimeType:
          extname(file.fileName).toLowerCase() === '.png'
            ? 'image/png'
            : 'image/jpeg',
        size: byteSize,
        width: dim?.width,
        height: dim?.height,
        tags,
        description: `AI素材:${rawPrompt.slice(0, 120)}`,
      },
    ]);
    return {
      image: { ...doc, _id: undefined } as Omit<GalleryImageEntity, '_id'>,
    };
  }

  /**
   * @description 列出图库图片，支持按 userId/tag/groupId 过滤，并支持基于自增 id 的游标分页。
   * @param {string} [userId] - 查询参数：用户ID。
   * @param {string} [tenantId] - 查询参数：租户ID（优先从请求token解析）。
   * @param {string} [groupId] - 查询参数：图库组ID。
   * @param {string} [tag] - 查询参数：标签。
   * @param {string} [cursorId] - 查询参数：游标（仅返回 id < cursorId 的更早数据）。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @returns {Promise<{ images: Array<Omit<GalleryImageEntity, '_id'>> }>} 图片列表。
   * @keyword gallery, controller, list
   * @since 2026-02-04
   */
  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('groupId') groupId?: string,
    @Query('tag') tag?: string,
    @Query('includeCollage') includeCollage?: string,
    @Query('imageType') imageType?: string,
    @Query('cursorId') cursorId?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ): Promise<{ images: Array<Omit<GalleryImageEntity, '_id'>> }> {
    // 优先从请求token解析tenantId，其次使用query参数
    const authScope = req ? await this.resolveAuthScope(req) : {};
    const tid = authScope.tenantId || tenantId?.trim() || undefined;
    const lim = limit ? Number(limit) : undefined;
    const cid = cursorId ? Number(cursorId) : undefined;
    const includeCollageFlag = parseBooleanFlag(includeCollage);
    const resolvedImageType =
      imageType === 'regular' || imageType === 'collage' || imageType === 'all'
        ? imageType
        : undefined;
    // groupId can be number (legacy) or string (default_group_image, default_collage_image)
    const resolvedGroupId = groupId
      ? Number.isFinite(Number(groupId))
        ? Number(groupId)
        : groupId
      : undefined;
    const rows = await this.gallery.findAccessibleImages(
      userId ?? 'default',
      tid,
      {
        groupId: resolvedGroupId,
        tag,
        includeCollage: includeCollageFlag !== false,
        imageType: resolvedImageType,
        cursorId:
          typeof cid === 'number' && Number.isFinite(cid) ? cid : undefined,
        limit: lim ?? 50,
      },
    );
    return { images: rows as Array<Omit<GalleryImageEntity, '_id'>> };
  }

  /**
   * @description 列出图库中已存在的所有标签（distinct tags）。
   * @param {string} [userId] - 查询参数：用户ID过滤。
   * @param {string} [tenantId] - 查询参数：租户ID（优先从请求token解析）。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @returns {Promise<{ tags: string[] }>} 标签列表。
   * @keyword gallery, tag, list
   * @since 2026-02-04
   */
  @Get('tags')
  async listTags(
    @Query('userId') userId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ): Promise<{ tags: string[] }> {
    const authScope = req ? await this.resolveAuthScope(req) : {};
    const tid = authScope.tenantId || tenantId?.trim() || undefined;
    const lim = limit ? Number(limit) : 500;
    const tags = await this.gallery.listDistinctTagsWithTenant(
      userId ? String(userId).trim() : 'default',
      tid,
      lim,
    );
    return { tags };
  }

  /**
   * @description 批量为图片添加/移除标签。
   * @param {{ userId?: string; ids?: Array<number | string>; addTags?: string[] | string; removeTags?: string[] | string }} body - 批量更新输入。
   * @returns {Promise<{ matched: number; modified: number }>} 匹配与修改数量。
   * @throws {BadRequestException} 当缺少 userId 或 ids 时抛出。
   * @keyword gallery, tag, batch
   * @since 2026-02-04
   */
  @Post('images/tags/batch')
  async updateImageTagsBatch(
    @Body()
    body: {
      userId?: string;
      ids?: Array<number | string>;
      addTags?: string[] | string;
      removeTags?: string[] | string;
    },
  ): Promise<{ matched: number; modified: number }> {
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');
    const ids = (Array.isArray(body?.ids) ? body.ids : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    if (ids.length === 0) throw new BadRequestException('ids is required');

    const res = await this.gallery.updateTagsBatch({
      userId,
      ids,
      addTags: body?.addTags,
      removeTags: body?.removeTags,
    });
    return res;
  }

  /**
   * @description 删除单张图片（记录+可选本地文件）。
   * @param {string} id - 路径参数：图片ID（自增 id）。
   * @param {{ userId?: string }} body - 请求体：用户ID。
   * @returns {Promise<{ ok: boolean }>} 删除结果。
   * @throws {BadRequestException} 当缺少 userId 或 id 无效时抛出。
   * @keyword gallery, image, delete
   * @since 2026-02-04
   */
  @Post('images/:id/delete')
  async deleteImage(
    @Param('id') id: string,
    @Body() body: { userId?: string },
  ): Promise<{ ok: boolean }> {
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');
    const imageId = Number(id);
    if (!Number.isFinite(imageId))
      throw new BadRequestException('id is invalid');
    return await this.gallery.deleteImage({ userId, id: imageId });
  }

  /**
   * @description 批量删除图片（记录+本地原图/缩略图文件）。
   * @param {{ userId?: string; ids?: Array<number | string> }} body - 批量删除输入。
   * @returns {Promise<{ deleted: number; failed: number; deletedIds: number[] }>} 删除统计。
   * @throws {BadRequestException} 当缺少 userId 或 ids 时抛出。
   * @keyword gallery, image, delete, batch
   * @keyword-cn 图库批量删除
   * @keyword-en gallery batch delete images
   */
  @Post('images/batch-delete')
  async deleteImagesBatch(
    @Body() body: { userId?: string; ids?: Array<number | string> },
  ): Promise<{ deleted: number; failed: number; deletedIds: number[] }> {
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');
    const ids = (Array.isArray(body?.ids) ? body.ids : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    if (ids.length === 0) throw new BadRequestException('ids is required');
    return await this.gallery.deleteManyImages({ userId, ids });
  }

  /**
   * @description 批量重建图片Embedding向量，支持从 startId 起更新 limit 条。
   * @param {{ userId?: string; startId?: number | string; limit?: number | string }} body - 重建输入。
   * @returns {Promise<{ updated: number }>} 更新条数。
   * @throws {BadRequestException} 当缺少 userId 时抛出。
   * @keyword gallery, embedding, rebuild
   * @since 2026-02-04
   */
  @Post('images/embedding/rebuild')
  async rebuildImageEmbeddings(
    @Body()
    body: {
      userId?: string;
      startId?: number | string;
      limit?: number | string;
    },
  ): Promise<{ updated: number }> {
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');
    const startId = Number(body?.startId ?? 1);
    const lim = Number(body?.limit ?? 50);
    return await this.gallery.rebuildEmbeddings({
      userId,
      startId: Number.isFinite(startId) ? startId : 1,
      limit: Number.isFinite(lim) ? lim : 50,
    });
  }

  /**
   * @description 创建图库组。
   * @param {{ userId?: string; name?: string; description?: string; tags?: string }} body - 表单字段。
   * @returns {Promise<{ group: Omit<GalleryGroupEntity, '_id'> }>} 新建的图库组。
   * @throws {BadRequestException} 当缺少 userId 或 name 时抛出。
   * @keyword gallery, groups, create
   * @since 2026-02-04
   */
  @Post('groups')
  async createGroup(
    @Body()
    body: {
      userId?: string;
      name?: string;
      description?: string;
      tags?: string;
    },
  ): Promise<{ group: Omit<GalleryGroupEntity, '_id'> }> {
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');

    const rawTags = String(body?.tags ?? '');
    const tags = rawTags
      .split(/[,\t\n\r\s]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const description =
      typeof body?.description === 'string' &&
      body.description.trim().length > 0
        ? body.description.trim()
        : undefined;

    const doc = await this.groups.create({ userId, name, description, tags });
    const clean = { ...doc } as unknown as { _id?: unknown };
    delete clean._id;
    return { group: clean as unknown as Omit<GalleryGroupEntity, '_id'> };
  }

  /**
   * @description 列出图库组，支持按 userId 与 tag 过滤。
   * @param {string} [userId] - 查询参数：用户ID。
   * @param {string} [tag] - 查询参数：标签。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @returns {Promise<{ groups: Array<Omit<GalleryGroupEntity, '_id'>> }>} 图库组列表。
   * @keyword gallery, groups, list
   * @since 2026-02-04
   */
  @Get('groups')
  async listGroups(
    @Query('userId') userId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('tag') tag?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ): Promise<{ groups: Array<Omit<GalleryGroupEntity, '_id'>> }> {
    const authScope = req ? await this.resolveAuthScope(req) : {};
    const tid = authScope.tenantId || tenantId?.trim() || undefined;
    const resolvedUserId =
      String(userId ?? '').trim() || authScope.userId || 'default';
    const lim = limit ? Number(limit) : 50;

    const defaults = await this.groups.ensureDefaultDynamicGroups(
      resolvedUserId,
      tid,
    );
    const rows = await this.groups.listAccessibleGroups(
      resolvedUserId,
      tid,
      tag,
      lim,
    );

    const merged = this.prioritizeDefaultGroups(rows, [
      defaults.coverGroup.id,
      defaults.collageGroup.id,
    ]);
    const safeLimit = Math.max(1, Math.min(200, Math.floor(lim)));
    return {
      groups: merged.slice(0, Math.max(safeLimit, 2)) as Array<
        Omit<GalleryGroupEntity, '_id'>
      >,
    };
  }

  /**
   * @description 更新图库组。
   * @param {string} id - 路径参数：图库组ID。
   * @param {{ name?: string; description?: string; tags?: string }} body - 更新字段。
   * @returns {Promise<{ group: Omit<GalleryGroupEntity, '_id'> | null }>} 更新后的图库组。
   * @keyword gallery, groups, update
   * @since 2026-02-04
   */
  @Post('groups/:id')
  async updateGroup(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; tags?: string },
  ): Promise<{ group: Omit<GalleryGroupEntity, '_id'> | null }> {
    const gid = Number(id);
    const rawTags = String(body?.tags ?? '');
    const tags = rawTags.length
      ? rawTags
          .split(/[,\t\n\r\s]+/g)
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined;
    const next = await this.groups.update({
      id: gid,
      name: typeof body?.name === 'string' ? body.name.trim() : undefined,
      description:
        typeof body?.description === 'string'
          ? body.description.trim()
          : undefined,
      tags,
    });
    if (!next) return { group: null };
    const clean = { ...next } as unknown as { _id?: unknown };
    delete clean._id;
    return { group: clean as unknown as Omit<GalleryGroupEntity, '_id'> };
  }

  /**
   * @description 删除图库组。
   * @param {string} id - 路径参数：图库组ID。
   * @returns {Promise<{ ok: boolean }>} 删除结果。
   * @keyword gallery, groups, delete
   * @since 2026-02-04
   */
  @Post('groups/:id/delete')
  async deleteGroup(@Param('id') id: string): Promise<{ ok: boolean }> {
    const gid = Number(id);
    return await this.groups.remove(gid);
  }

  /**
   * @description 图库组向量相似检索接口。
   * @param {string} [q] - 查询参数：检索文本（必填）。
   * @param {string} [userId] - 查询参数：用户ID过滤。
   * @param {string} [limit] - 查询参数：返回条数。
   * @param {string} [minScore] - 查询参数：最小相似度阈值。
   * @returns {Promise<{ results: Array<{ group: Record<string, unknown>; score: number }> }>} 检索结果。
   * @throws {BadRequestException} 当缺少 q 时抛出。
   * @keyword gallery, groups, search
   * @since 2026-02-04
   */
  @Get('groups/search')
  async searchGroups(
    @Query('q') q?: string,
    @Query('userId') userId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
    @Req() req?: Request,
  ): Promise<{
    results: Array<{ group: Record<string, unknown>; score: number }>;
  }> {
    const query = String(q ?? '').trim();
    if (!query) throw new BadRequestException('q is required');
    const authScope = req ? await this.resolveAuthScope(req) : {};
    const tid = authScope.tenantId || tenantId?.trim() || undefined;
    const lim = limit ? Number(limit) : 8;
    const ms = minScore ? Number(minScore) : 0.5;
    const results = await this.groups.searchSimilar(
      query,
      userId,
      tid,
      lim,
      ms,
    );
    return {
      results: results.map((r) => ({
        group: { ...r.group, _id: undefined },
        score: r.score,
      })),
    };
  }

  /**
   * @description 向量相似检索接口。
   * @param {string} [q] - 查询参数：检索文本（必填）。
   * @param {string} [userId] - 查询参数：用户ID过滤。
   * @param {string} [tenantId] - 查询参数：租户ID（优先从请求token解析）。
   * @param {string} [limit] - 查询参数：返回条数。
   * @param {string} [minScore] - 查询参数：最小相似度阈值。
   * @returns {Promise<{ results: Array<{ image: Record<string, unknown>; score: number }> }>} 检索结果。
   * @throws {BadRequestException} 当缺少 q 时抛出。
   * @keyword gallery, controller, search
   * @since 2026-02-04
   */
  @Get('search')
  async search(
    @Query('q') q?: string,
    @Query('userId') userId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
    @Req() req?: Request,
  ): Promise<{
    results: Array<{ image: Record<string, unknown>; score: number }>;
  }> {
    const query = String(q ?? '').trim();
    if (!query) throw new BadRequestException('q is required');
    const authScope = req ? await this.resolveAuthScope(req) : {};
    const tid = authScope.tenantId || tenantId?.trim() || undefined;
    const lim = limit ? Number(limit) : 8;
    const ms = minScore ? Number(minScore) : 0.5;
    const results = await this.gallery.searchSimilar(
      query,
      userId,
      tid,
      lim,
      ms,
    );
    return {
      results: results.map((r) => ({
        image: { ...r.image, _id: undefined },
        score: r.score,
      })),
    };
  }
}
