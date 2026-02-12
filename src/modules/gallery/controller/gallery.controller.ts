import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { extname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { GalleryService } from '../services/gallery.service.js';
import { GalleryGroupService } from '../services/gallery-group.service.js';
import type { GalleryImageEntity } from '../entities/gallery-image.entity.js';
import type { GalleryGroupEntity } from '../entities/gallery-group.entity.js';

type JimpLike = { read: (path: string) => Promise<unknown> };
type JimpImageLike = {
  bitmap?: { width?: number; height?: number };
  resize: (opts: { w: number; h: number }) => unknown;
  write: (path: string, opts?: { quality?: number }) => Promise<unknown>;
};

let jimpModulePromise: Promise<unknown> | null = null;

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

export async function compressImageFileInPlace(params: {
  filePath: string;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}): Promise<{
  changed: boolean;
  beforeSize: number;
  afterSize: number;
  reason?: string;
}> {
  const filePath = String(params.filePath || '');
  if (!filePath)
    return { changed: false, beforeSize: 0, afterSize: 0, reason: 'no-path' };

  let beforeSize = 0;
  try {
    const beforeStat = await fs.stat(filePath);
    beforeSize = beforeStat.size;
  } catch {
    return {
      changed: false,
      beforeSize: 0,
      afterSize: 0,
      reason: 'stat-failed',
    };
  }

  const maxWidth = Math.max(1, Math.floor(params.maxWidth ?? 1600));
  const maxHeight = Math.max(1, Math.floor(params.maxHeight ?? 1600));
  const quality = Math.min(95, Math.max(30, Math.floor(params.quality ?? 75)));

  if (!jimpModulePromise)
    jimpModulePromise = import('jimp') as Promise<unknown>;
  const mod = await jimpModulePromise;
  const Jimp = isRecord(mod) ? mod.Jimp : undefined;
  if (!isJimpLike(Jimp)) {
    return {
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      reason: 'jimp-unavailable',
    };
  }

  let imgUnknown: unknown;
  try {
    imgUnknown = await Jimp.read(filePath);
  } catch (e) {
    return {
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      reason: errorMessage(e),
    };
  }

  if (!isJimpImageLike(imgUnknown)) {
    return {
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      reason: 'bad-image',
    };
  }

  const img = imgUnknown;

  const w = typeof img.bitmap?.width === 'number' ? img.bitmap.width : 0;
  const h = typeof img.bitmap?.height === 'number' ? img.bitmap.height : 0;
  if (w > 0 && h > 0) {
    const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
    if (ratio < 1) {
      const nw = Math.max(1, Math.floor(w * ratio));
      const nh = Math.max(1, Math.floor(h * ratio));
      img.resize({ w: nw, h: nh });
    }
  }

  const ext = extname(filePath) || '.jpg';
  const base = filePath.toLowerCase().endsWith(ext.toLowerCase())
    ? filePath.slice(0, -ext.length)
    : filePath;
  const tmpPath = `${base}.__upload_compress_tmp__${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;

  try {
    await img.write(tmpPath, { quality });
  } catch (e) {
    try {
      if (existsSync(tmpPath)) await fs.unlink(tmpPath);
    } catch {
      void 0;
    }
    return {
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      reason: errorMessage(e),
    };
  }

  let afterSize = beforeSize;
  try {
    const afterStat = await fs.stat(tmpPath);
    afterSize = afterStat.size;
  } catch {
    try {
      if (existsSync(tmpPath)) await fs.unlink(tmpPath);
    } catch {
      void 0;
    }
    return {
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      reason: 'tmp-stat-failed',
    };
  }

  const improved = afterSize + 1024 < beforeSize;
  if (!improved) {
    try {
      if (existsSync(tmpPath)) await fs.unlink(tmpPath);
    } catch {
      void 0;
    }
    return {
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      reason: 'not-smaller',
    };
  }

  const bakPath = `${base}.__upload_compress_bak__${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
  try {
    await fs.rename(filePath, bakPath);
  } catch (e) {
    try {
      if (existsSync(tmpPath)) await fs.unlink(tmpPath);
    } catch {
      void 0;
    }
    return {
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      reason: errorMessage(e),
    };
  }
  try {
    await fs.rename(tmpPath, filePath);
  } catch (e) {
    try {
      if (existsSync(bakPath)) await fs.rename(bakPath, filePath);
    } catch {
      void 0;
    }
    try {
      if (existsSync(tmpPath)) await fs.unlink(tmpPath);
    } catch {
      void 0;
    }
    return {
      changed: false,
      beforeSize,
      afterSize: beforeSize,
      reason: errorMessage(e),
    };
  }
  try {
    if (existsSync(bakPath)) await fs.unlink(bakPath);
  } catch {
    void 0;
  }

  return { changed: true, beforeSize, afterSize };
}

async function compressUploadFiles(
  files: Express.Multer.File[],
): Promise<void> {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return;

  const concurrency = 2;
  await mapLimit(list, concurrency, async (f) => {
    const p = f.path;
    if (!p) return;
    const r = await compressImageFileInPlace({
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
  ) {}

  /**
   * @description 上传图片文件并写入图库记录（含Embedding向量）。
   * @param {Express.Multer.File[]} files - 上传的文件数组（字段名：files）。
   * @param {{ userId?: string; groupId?: string; tags?: string; description?: string }} body - 表单字段。
   * @returns {Promise<{ images: Array<Omit<GalleryImageEntity, '_id'>> }>} 新建图片记录列表。
   * @throws {BadRequestException} 当未上传文件或缺少 userId 时抛出。
   * @keyword gallery, controller, upload
   * @since 2026-02-04
   */
  @Post('upload')
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
      limits: { files: 24, fileSize: 12 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      userId?: string;
      groupId?: string;
      tags?: string;
      description?: string;
    },
  ): Promise<{ images: Array<Omit<GalleryImageEntity, '_id'>> }> {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('No image files uploaded');
    }
    const userId = String(body?.userId ?? '').trim();
    if (!userId) throw new BadRequestException('userId is required');

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

    const groupIdRaw = String(body?.groupId ?? '').trim();
    const groupId = groupIdRaw.length > 0 ? Number(groupIdRaw) : undefined;

    await compressUploadFiles(files);
    const thumbs = await createUploadThumbnails(files);

    const inputs = files.map((f) => ({
      userId,
      groupId:
        typeof groupId === 'number' && Number.isFinite(groupId)
          ? groupId
          : undefined,
      originalName: String(f.originalname || ''),
      fileName: String(f.filename || ''),
      absPath: String(f.path || ''),
      url: `/static/uploads/${String(f.filename || '')}`,
      ...(thumbs.get(String(f.filename || '')) ?? {}),
      mimeType: String(f.mimetype || ''),
      size: typeof f.size === 'number' ? f.size : undefined,
      tags,
      description,
    }));

    const docs = await this.gallery.createMany(inputs);
    return { images: docs.map((d) => ({ ...d, _id: undefined })) };
  }

  /**
   * @description 列出图库图片，支持按 userId/tag/groupId 过滤，并支持基于自增 id 的游标分页。
   * @param {string} [userId] - 查询参数：用户ID。
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
    @Query('groupId') groupId?: string,
    @Query('tag') tag?: string,
    @Query('cursorId') cursorId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ images: Array<Omit<GalleryImageEntity, '_id'>> }> {
    const lim = limit ? Number(limit) : undefined;
    const gid = groupId ? Number(groupId) : undefined;
    const cid = cursorId ? Number(cursorId) : undefined;
    const rows = await this.gallery.list(
      userId,
      typeof gid === 'number' && Number.isFinite(gid) ? gid : undefined,
      tag,
      typeof cid === 'number' && Number.isFinite(cid) ? cid : undefined,
      lim ?? 50,
    );
    return { images: rows as Array<Omit<GalleryImageEntity, '_id'>> };
  }

  /**
   * @description 列出图库中已存在的所有标签（distinct tags）。
   * @param {string} [userId] - 查询参数：用户ID过滤。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @returns {Promise<{ tags: string[] }>} 标签列表。
   * @keyword gallery, tag, list
   * @since 2026-02-04
   */
  @Get('tags')
  async listTags(
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ tags: string[] }> {
    const lim = limit ? Number(limit) : 500;
    const tags = await this.gallery.listDistinctTags(
      userId ? String(userId).trim() : undefined,
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
    @Query('tag') tag?: string,
    @Query('limit') limit?: string,
  ): Promise<{ groups: Array<Omit<GalleryGroupEntity, '_id'>> }> {
    const lim = limit ? Number(limit) : 50;
    const rows = await this.groups.list(userId, tag, lim);
    return { groups: rows as Array<Omit<GalleryGroupEntity, '_id'>> };
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
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
  ): Promise<{
    results: Array<{ group: Record<string, unknown>; score: number }>;
  }> {
    const query = String(q ?? '').trim();
    if (!query) throw new BadRequestException('q is required');
    const lim = limit ? Number(limit) : 8;
    const ms = minScore ? Number(minScore) : 0.5;
    const results = await this.groups.searchSimilar(query, userId, lim, ms);
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
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
  ): Promise<{
    results: Array<{ image: Record<string, unknown>; score: number }>;
  }> {
    const query = String(q ?? '').trim();
    if (!query) throw new BadRequestException('q is required');
    const lim = limit ? Number(limit) : 8;
    const ms = minScore ? Number(minScore) : 0.5;
    const results = await this.gallery.searchSimilar(query, userId, lim, ms);
    return {
      results: results.map((r) => ({
        image: { ...r.image, _id: undefined },
        score: r.score,
      })),
    };
  }
}
