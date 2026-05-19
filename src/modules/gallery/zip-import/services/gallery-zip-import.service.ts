import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db, ObjectId } from 'mongodb';
import { promises as fs } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import { extname, join, basename } from 'path';
import { randomUUID } from 'crypto';
import { GalleryService } from '../../services/gallery.service.js';
import type { GalleryImageCreateInput } from '../../entities/gallery-image.entity.js';
import type {
  GalleryZipImportCreateInput,
  GalleryZipImportEntity,
  GalleryZipImportErrorItem,
  GalleryZipImportProgress,
  GalleryZipImportStatus,
} from '../entities/gallery-zip-import.entity.js';

/** @description node-stream-zip 默认导出形态 */
type StreamZipCtor = new (options: { file: string; storeEntries?: boolean }) => StreamZipInstance;
interface StreamZipInstance {
  on(event: 'ready' | 'error', cb: (err?: unknown) => void): void;
  entries(): Record<string, StreamZipEntry>;
  entry(name: string): StreamZipEntry | undefined;
  extract(entry: string, outPath: string, cb: (err: unknown) => void): void;
  close(cb?: (err?: unknown) => void): void;
}
interface StreamZipEntry {
  name: string;
  isDirectory?: boolean;
  size?: number;
}

const IMAGE_EXT_SET = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
]);

const MAX_IMPORT_PER_BATCH = 20;

/**
 * @description 图库 ZIP 批量导入服务:接收 zip → 入队列 → 进程内串行解压 → 走 GalleryService 入库
 * @keyword-en gallery zip import service, queue, extract, batch import
 */
@Injectable()
export class GalleryZipImportService {
  private readonly jobs: Collection<GalleryZipImportEntity>;
  /** @description 进程内运行中任务 id,保证一次只跑一个,避免大 zip 互相挤垮内存 */
  private runningJobId: string | null = null;
  private streamZipCtorPromise: Promise<StreamZipCtor> | null = null;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly gallery: GalleryService,
  ) {
    this.jobs = db.collection<GalleryZipImportEntity>('gallery_zip_imports');
    void this.ensureIndexes();
  }

  /**
   * @description 建索引:按 id 唯一、按 (userId,tenantId,createdAt) 查询
   * @keyword-en ensure mongo indexes for gallery zip imports
   */
  async ensureIndexes(): Promise<void> {
    await this.jobs.createIndex({ id: 1 }, { unique: true });
    await this.jobs.createIndex({ userId: 1, createdAt: -1 });
    await this.jobs.createIndex({ tenantId: 1, createdAt: -1 });
    await this.jobs.createIndex({ status: 1, createdAt: -1 });
  }

  /**
   * @description 创建一条 pending 任务,并触发异步处理(不等待)
   * @keyword-en enqueue zip import job and trigger async processing
   */
  async enqueue(
    input: GalleryZipImportCreateInput,
  ): Promise<GalleryZipImportEntity> {
    const now = new Date();
    const doc: GalleryZipImportEntity = {
      _id: new ObjectId(),
      id: randomUUID(),
      userId: input.userId,
      scope: input.scope ?? 'tenant',
      tenantId: input.tenantId,
      groupId: input.groupId,
      tags: Array.isArray(input.tags) ? input.tags : [],
      originalName: input.originalName,
      fileSize: input.fileSize,
      zipAbsPath: input.zipAbsPath,
      status: 'pending',
      stage: '排队中,等待开始解压',
      progress: { total: 0, processed: 0, success: 0, failed: 0 },
      errors: [],
      imageIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.insertOne(doc);
    setImmediate(() => {
      void this.processJob(doc.id).catch((e) => {
        console.error('[GalleryZipImportService.processJob] crashed', e);
      });
    });
    return doc;
  }

  /**
   * @description 查询单条任务(去 _id)
   * @keyword-en get zip import job by id
   */
  async getById(id: string): Promise<Omit<GalleryZipImportEntity, '_id'> | null> {
    const job = await this.jobs.findOne({ id }, { projection: { _id: 0 } });
    return (job as Omit<GalleryZipImportEntity, '_id'> | null) ?? null;
  }

  /**
   * @description 列出某租户/用户最近的 N 条任务(默认 30 条),按 createdAt desc
   * @keyword-en list recent zip import jobs scoped by tenant
   */
  async listRecent(
    userId: string | undefined,
    tenantId: string | undefined,
    limit = 30,
  ): Promise<Array<Omit<GalleryZipImportEntity, '_id'>>> {
    const lim = Math.max(1, Math.min(100, Math.floor(limit || 30)));
    const filter: Record<string, unknown> = {};
    const tid = tenantId?.trim();
    if (tid) {
      filter.tenantId = tid;
    } else {
      filter.$or = [
        { tenantId: { $exists: false } },
        { tenantId: null },
        { tenantId: '' },
      ];
    }
    if (userId) filter.userId = userId;
    const rows = await this.jobs
      .find(filter, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(lim)
      .toArray();
    return rows as Array<Omit<GalleryZipImportEntity, '_id'>>;
  }

  /**
   * @description 请求取消任务:写入 cancelRequested=true,运行循环下一次轮询时中断
   * @keyword-en request cancel for running or pending job
   */
  async cancel(id: string): Promise<{ ok: boolean }> {
    const cur = await this.jobs.findOne({ id });
    if (!cur) return { ok: false };
    if (cur.status === 'done' || cur.status === 'failed' || cur.status === 'cancelled') {
      return { ok: false };
    }
    await this.jobs.updateOne(
      { id },
      {
        $set: {
          cancelRequested: true,
          updatedAt: new Date(),
          ...(cur.status === 'pending'
            ? {
                status: 'cancelled' as GalleryZipImportStatus,
                stage: '已取消(尚未开始)',
                finishedAt: new Date(),
              }
            : {}),
        },
      },
    );
    return { ok: true };
  }

  /**
   * @description 删除一条任务记录(已完成/失败/取消的清理)
   * @keyword-en delete zip import job record
   */
  async remove(id: string): Promise<{ ok: boolean }> {
    const cur = await this.jobs.findOne({ id });
    if (!cur) return { ok: false };
    if (cur.status === 'extracting' || cur.status === 'importing') {
      return { ok: false };
    }
    await this.jobs.deleteOne({ id });
    return { ok: true };
  }

  /**
   * @description 串行处理任务主循环:同进程同时只跑一个 job,其它任务等当前完成
   * @keyword-en process zip import job sequentially per process
   */
  private async processJob(id: string): Promise<void> {
    while (this.runningJobId && this.runningJobId !== id) {
      await new Promise((r) => setTimeout(r, 500));
    }
    this.runningJobId = id;
    try {
      await this.runJob(id);
    } finally {
      this.runningJobId = null;
    }
  }

  /**
   * @description 主流水线:打开 zip → 枚举图片 → 逐张解压到 public/uploads → 分批走 GalleryService.createMany
   * @keyword-en run zip import pipeline
   */
  private async runJob(id: string): Promise<void> {
    const job = await this.jobs.findOne({ id });
    if (!job) return;
    if (job.status === 'cancelled' || job.cancelRequested) {
      await this.finalizeCancelled(id, job.zipAbsPath);
      return;
    }

    const zipPath = String(job.zipAbsPath ?? '');
    if (!zipPath || !existsSync(zipPath)) {
      await this.finalizeFailed(id, 'zip 文件丢失或路径无效');
      return;
    }

    await this.jobs.updateOne(
      { id },
      {
        $set: {
          status: 'extracting' as GalleryZipImportStatus,
          stage: '正在打开 ZIP 文件',
          startedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    const StreamZip = await this.loadStreamZip();
    let zip: StreamZipInstance | null = null;
    try {
      zip = await new Promise<StreamZipInstance>((resolve, reject) => {
        const z = new StreamZip({ file: zipPath, storeEntries: true });
        z.on('ready', () => resolve(z));
        z.on('error', (err) => reject(err));
      });
    } catch (e) {
      await this.finalizeFailed(id, `打开 zip 失败:${errorMessage(e)}`);
      await this.safeUnlink(zipPath);
      return;
    }

    const entries = Object.values(zip.entries()).filter(
      (e) => !e.isDirectory && this.isImageEntry(e.name),
    );
    if (entries.length === 0) {
      await this.closeZip(zip);
      await this.finalizeFailed(id, '压缩包内未找到图片');
      await this.safeUnlink(zipPath);
      return;
    }

    await this.jobs.updateOne(
      { id },
      {
        $set: {
          'progress.total': entries.length,
          stage: `解压并落盘 0/${entries.length}`,
          updatedAt: new Date(),
        },
      },
    );

    const dir = join(process.cwd(), 'public', 'uploads');
    mkdirSync(dir, { recursive: true });

    const pendingInputs: Array<{
      input: GalleryImageCreateInput;
      entryName: string;
    }> = [];
    let processed = 0;
    let success = 0;
    let failed = 0;
    const errors: GalleryZipImportErrorItem[] = [];
    const imageIds: number[] = [];

    const flush = async (): Promise<void> => {
      if (pendingInputs.length === 0) return;
      const batch = pendingInputs.splice(0, pendingInputs.length);
      await this.jobs.updateOne(
        { id },
        {
          $set: {
            status: 'importing' as GalleryZipImportStatus,
            stage: `正在写入数据库(批量 ${batch.length} 张)`,
            updatedAt: new Date(),
          },
        },
      );
      try {
        const docs = await this.gallery.createMany(batch.map((b) => b.input));
        success += docs.length;
        for (const d of docs) {
          if (typeof d.id === 'number' && Number.isFinite(d.id)) {
            imageIds.push(d.id);
          }
        }
      } catch (e) {
        failed += batch.length;
        const reason = errorMessage(e).slice(0, 240);
        for (const b of batch) {
          errors.push({ fileName: b.entryName, reason });
        }
      }
    };

    try {
      for (const entry of entries) {
        if (await this.shouldCancel(id)) {
          await flush();
          await this.closeZip(zip);
          await this.finalizeCancelled(id, zipPath, {
            processed,
            success,
            failed,
            total: entries.length,
            errors,
            imageIds,
          });
          await this.safeUnlink(zipPath);
          return;
        }

        const entryName = String(entry.name || '');
        try {
          const rawExt = extname(entryName).toLowerCase();
          const ext = rawExt && rawExt.length <= 12 ? rawExt : '.jpg';
          const fileName = `${Date.now()}-${randomUUID()}${ext}`;
          const absPath = join(dir, fileName);
          await this.extractEntry(zip, entryName, absPath);

          const thumb = await this.gallery
            .generateThumbnail(absPath, entryName)
            .catch(() => null);
          const dims = await this.readImageDimensions(absPath);

          const input: GalleryImageCreateInput = {
            userId: job.userId,
            scope: job.scope,
            tenantId: job.tenantId,
            groupId: job.groupId,
            originalName: basename(entryName) || fileName,
            fileName,
            url: `/static/uploads/${fileName}`,
            thumbFileName: thumb?.thumbFileName,
            thumbUrl: thumb?.thumbUrl,
            absPath,
            mimeType: this.mimeTypeFromExt(ext),
            size: await this.statSize(absPath),
            width: dims?.width,
            height: dims?.height,
            tags: job.tags,
          };
          pendingInputs.push({ input, entryName });

          if (pendingInputs.length >= MAX_IMPORT_PER_BATCH) {
            await flush();
          }
        } catch (e) {
          failed += 1;
          errors.push({
            fileName: entryName,
            reason: errorMessage(e).slice(0, 240),
          });
        }

        processed += 1;
        if (processed % 5 === 0 || processed === entries.length) {
          await this.jobs.updateOne(
            { id },
            {
              $set: {
                'progress.processed': processed,
                'progress.success': success + pendingInputs.length,
                'progress.failed': failed,
                stage: `解压并落盘 ${processed}/${entries.length}`,
                updatedAt: new Date(),
              },
            },
          );
        }
      }
      await flush();
    } finally {
      await this.closeZip(zip);
    }

    const finalProgress: GalleryZipImportProgress = {
      total: entries.length,
      processed,
      success,
      failed,
    };
    const allOk = failed === 0 && success === entries.length;
    await this.jobs.updateOne(
      { id },
      {
        $set: {
          status: (allOk ? 'done' : success > 0 ? 'done' : 'failed') as GalleryZipImportStatus,
          stage: allOk
            ? `导入完成(${success} 张)`
            : success > 0
              ? `部分导入完成(成功 ${success} / 失败 ${failed})`
              : `导入失败(全部 ${failed} 张)`,
          progress: finalProgress,
          errors: errors.slice(0, 200),
          imageIds,
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
    await this.safeUnlink(zipPath);
  }

  /**
   * @description 检查 cancelRequested 标志(实时从 db 取)
   * @keyword-en check job cancel requested flag
   */
  private async shouldCancel(id: string): Promise<boolean> {
    const cur = await this.jobs.findOne(
      { id },
      { projection: { cancelRequested: 1 } },
    );
    return cur?.cancelRequested === true;
  }

  /**
   * @description 兜底:任务标记为失败
   * @keyword-en mark job failed
   */
  private async finalizeFailed(id: string, reason: string): Promise<void> {
    await this.jobs.updateOne(
      { id },
      {
        $set: {
          status: 'failed' as GalleryZipImportStatus,
          stage: reason.slice(0, 180),
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
  }

  /**
   * @description 取消最终态写入:保留已成功入库的图片记录
   * @keyword-en mark job cancelled with partial progress preserved
   */
  private async finalizeCancelled(
    id: string,
    zipPath?: string,
    partial?: {
      processed: number;
      success: number;
      failed: number;
      total: number;
      errors: GalleryZipImportErrorItem[];
      imageIds: number[];
    },
  ): Promise<void> {
    const update: Record<string, unknown> = {
      status: 'cancelled' as GalleryZipImportStatus,
      stage: partial
        ? `已取消(已入库 ${partial.success} 张)`
        : '已取消',
      finishedAt: new Date(),
      updatedAt: new Date(),
    };
    if (partial) {
      update.progress = {
        total: partial.total,
        processed: partial.processed,
        success: partial.success,
        failed: partial.failed,
      };
      update.errors = partial.errors.slice(0, 200);
      update.imageIds = partial.imageIds;
    }
    await this.jobs.updateOne({ id }, { $set: update });
    if (zipPath) await this.safeUnlink(zipPath);
  }

  /**
   * @description 判断条目是否为图片(按扩展名)
   * @keyword-en filter image entry by extension
   */
  private isImageEntry(name: string): boolean {
    const ext = extname(String(name || '')).toLowerCase();
    if (!ext) return false;
    if (!IMAGE_EXT_SET.has(ext)) return false;
    // 忽略 macOS 元数据
    const base = basename(name);
    if (base.startsWith('._')) return false;
    if (name.includes('__MACOSX/')) return false;
    return true;
  }

  /**
   * @description 单个 entry 流式解压到目标路径
   * @keyword-en stream extract single entry
   */
  private extractEntry(
    zip: StreamZipInstance,
    entryName: string,
    outPath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      zip.extract(entryName, outPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async closeZip(zip: StreamZipInstance | null): Promise<void> {
    if (!zip) return;
    await new Promise<void>((resolve) => {
      zip.close(() => resolve());
    });
  }

  /**
   * @description 安全删除文件(忽略不存在错误)
   * @keyword-en safe unlink ignore not-exist
   */
  private async safeUnlink(p: string): Promise<void> {
    try {
      if (p && existsSync(p)) await fs.unlink(p);
    } catch {
      void 0;
    }
  }

  private async statSize(p: string): Promise<number | undefined> {
    try {
      const s = await fs.stat(p);
      return s.size;
    } catch {
      return undefined;
    }
  }

  /**
   * @description 读取图片尺寸(jimp 直读)
   * @keyword-en read image dimensions via jimp
   */
  private async readImageDimensions(
    p: string,
  ): Promise<{ width: number; height: number } | null> {
    try {
      const mod = (await import('jimp')) as Record<string, unknown>;
      const Jimp = mod.Jimp as
        | { read: (path: string) => Promise<{ bitmap?: { width?: number; height?: number } }> }
        | undefined;
      if (!Jimp) return null;
      const img = await Jimp.read(p);
      const w = typeof img?.bitmap?.width === 'number' ? img.bitmap.width : 0;
      const h = typeof img?.bitmap?.height === 'number' ? img.bitmap.height : 0;
      if (w <= 0 || h <= 0) return null;
      return { width: w, height: h };
    } catch {
      return null;
    }
  }

  /**
   * @description 按扩展名推断 mime
   * @keyword-en mime type from extension
   */
  private mimeTypeFromExt(ext: string): string {
    const e = ext.toLowerCase();
    if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
    if (e === '.png') return 'image/png';
    if (e === '.webp') return 'image/webp';
    if (e === '.gif') return 'image/gif';
    if (e === '.bmp') return 'image/bmp';
    return 'application/octet-stream';
  }

  /**
   * @description 懒加载 node-stream-zip 的 callback 版构造函数(`new StreamZip({ file })` + `on('ready')` 模式);
   *   注意:不要 fallback 到 `.async`,async 版 API 完全不同(无 'ready' 事件、extract/close 返回 Promise)。
   * @keyword-en lazy load node-stream-zip callback ctor
   */
  private async loadStreamZip(): Promise<StreamZipCtor> {
    if (!this.streamZipCtorPromise) {
      this.streamZipCtorPromise = (async () => {
        const mod = (await import('node-stream-zip')) as Record<string, unknown>;
        const Ctor = (mod.default ?? mod) as unknown;
        if (typeof Ctor !== 'function') {
          throw new Error('node-stream-zip ctor not found');
        }
        return Ctor as StreamZipCtor;
      })();
    }
    return this.streamZipCtorPromise;
  }
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
