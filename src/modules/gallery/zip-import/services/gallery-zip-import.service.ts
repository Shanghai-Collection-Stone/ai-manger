import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
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
type StreamZipCtor = new (options: {
  file: string;
  storeEntries?: boolean;
}) => StreamZipInstance;
interface StreamZipInstance {
  on(event: 'ready' | 'error', cb: (err?: unknown) => void): void;
  entries(): Record<string, StreamZipEntry>;
  entry(name: string): StreamZipEntry | undefined;
  entryDataSync(entry: string): Buffer;
  extract(entry: string, outPath: string, cb: (err: unknown) => void): void;
  close(cb?: (err?: unknown) => void): void;
}
interface StreamZipEntry {
  name: string;
  isDirectory?: boolean;
  size?: number;
}

interface ClientPreprocessManifestEntry {
  entryName: string;
  width: number;
  height: number;
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
/** 未结束的任务状态：排队、解压、写库。 */
const ACTIVE_STATUSES: GalleryZipImportStatus[] = [
  'pending',
  'extracting',
  'importing',
];
/** 负责进程给自己名下未结束任务刷新心跳的间隔。 */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** 心跳超过这么久没刷新，就认定负责进程已经不在（重启、发版或崩溃）。 */
const HEARTBEAT_STALE_MS = 2 * 60_000;
/** 本次改动前创建的任务没有心跳，只能看 updatedAt；正常处理每 5 张就会刷新，给足余量。 */
const LEGACY_STALE_MS = 10 * 60_000;
/** 扫描中断任务的间隔。 */
const RECOVERY_INTERVAL_MS = 60_000;
const CLIENT_PREPROCESS_MANIFEST = '_gallery_manifest.json';
const MAX_CLIENT_MANIFEST_BYTES = 5 * 1024 * 1024;

/**
 * @description 图库 ZIP 批量导入服务:接收 zip → 入队列 → 进程内串行解压 → 走 GalleryService 入库
 * @keyword-en gallery zip import service, queue, extract, batch import
 */
@Injectable()
export class GalleryZipImportService implements OnModuleInit, OnModuleDestroy {
  private readonly jobs: Collection<GalleryZipImportEntity>;
  /** @description 进程内运行中任务 id,保证一次只跑一个,避免大 zip 互相挤垮内存 */
  private runningJobId: string | null = null;
  private streamZipCtorPromise: Promise<StreamZipCtor> | null = null;
  /** @description 本进程标识：每次启动都换新，任务记录它来判断负责进程是否还在 */
  private readonly ownerId = randomUUID();
  /** @description 本进程名下还没结束的任务，只为它们刷新心跳 */
  private readonly ownedJobIds = new Set<string>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('DS_MONGO_DB') db: Db,
    private readonly gallery: GalleryService,
  ) {
    this.jobs = db.collection<GalleryZipImportEntity>('gallery_zip_imports');
    void this.ensureIndexes();
  }

  /**
   * @description 启动心跳与中断任务扫描：启动后稍等一会儿先扫一次（接手重启前排队的任务、结束卡住的任务），之后每分钟扫一次。
   *   多进程时每个进程都扫，靠带过期条件的原子更新保证同一任务只有一个进程接手。
   * @keyword-cn ZIP任务恢复, 心跳续期
   * @keyword-en zip-job-recovery, heartbeat-renewal
   */
  onModuleInit(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.renewHeartbeats().catch((e) => {
        console.error('[GalleryZipImportService.heartbeat] failed', e);
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
    this.recoveryTimer = setInterval(() => {
      void this.recoverOrphanedJobs().catch((e) => {
        console.error('[GalleryZipImportService.recover] failed', e);
      });
    }, RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref();
    setTimeout(() => {
      void this.recoverOrphanedJobs().catch((e) => {
        console.error('[GalleryZipImportService.recover] failed', e);
      });
    }, 5_000).unref();
  }

  /**
   * @description 停止心跳与扫描定时器。
   * @keyword-cn 停止定时器, ZIP任务恢复
   * @keyword-en stop-timers, zip-job-recovery
   */
  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  /**
   * @description 给本进程名下还没结束的任务刷新心跳；名下没有任务时不写库。
   * @keyword-cn 心跳续期, 任务归属
   * @keyword-en heartbeat-renewal, job-ownership
   */
  private async renewHeartbeats(): Promise<void> {
    if (this.ownedJobIds.size === 0) return;
    await this.jobs.updateMany(
      {
        id: { $in: [...this.ownedJobIds] },
        ownerId: this.ownerId,
        status: { $in: ACTIVE_STATUSES },
      },
      { $set: { heartbeatAt: new Date() } },
    );
  }

  /**
   * @description 判定负责进程已不在的未结束任务的过滤条件：有心跳的看心跳是否过期，旧任务没有心跳就看 updatedAt。
   * @keyword-cn 中断任务判定, 心跳过期
   * @keyword-en orphaned-job-filter, stale-heartbeat
   */
  private buildOrphanFilter(now: Date): Record<string, unknown> {
    return {
      status: { $in: ACTIVE_STATUSES },
      $or: [
        { heartbeatAt: { $lt: new Date(now.getTime() - HEARTBEAT_STALE_MS) } },
        {
          heartbeatAt: { $exists: false },
          updatedAt: { $lt: new Date(now.getTime() - LEGACY_STALE_MS) },
        },
      ],
    };
  }

  /**
   * @description 处理负责进程已不在（重启、发版、崩溃）的任务：已请求取消的按取消收尾；还在排队的由本进程原子接手继续处理；
   *   解压或写库到一半的判为失败并说明已入库多少张（这些图保留），同时清理临时 ZIP。以前这类任务会永远停在「导入中」，也删不掉。
   * @keyword-cn ZIP任务恢复, 中断任务接手
   * @keyword-en zip-job-recovery, take-over-pending-job, fail-interrupted-job
   */
  async recoverOrphanedJobs(): Promise<void> {
    const now = new Date();
    const orphans = await this.jobs
      .find(this.buildOrphanFilter(now), {
        projection: {
          id: 1,
          status: 1,
          cancelRequested: 1,
          zipAbsPath: 1,
          imageIds: 1,
        },
      })
      .limit(50)
      .toArray();
    for (const orphan of orphans) {
      const stillOrphaned = { id: orphan.id, ...this.buildOrphanFilter(now) };
      const zipPath = String(orphan.zipAbsPath ?? '');
      if (orphan.cancelRequested) {
        const cancelled = await this.jobs.updateOne(stillOrphaned, {
          $set: {
            status: 'cancelled' as GalleryZipImportStatus,
            stage: `已取消(已入库 ${orphan.imageIds?.length ?? 0} 张)`,
            finishedAt: now,
            updatedAt: now,
          },
        });
        if (cancelled.modifiedCount && zipPath) await this.safeUnlink(zipPath);
        continue;
      }
      if (orphan.status === 'pending' && zipPath && existsSync(zipPath)) {
        const claimed = await this.jobs.updateOne(stillOrphaned, {
          $set: {
            ownerId: this.ownerId,
            heartbeatAt: now,
            stage: '排队中,服务重启后继续处理',
            updatedAt: now,
          },
        });
        if (claimed.modifiedCount) this.scheduleJob(orphan.id);
        continue;
      }
      const imported = orphan.imageIds?.length ?? 0;
      const failed = await this.jobs.updateOne(stillOrphaned, {
        $set: {
          status: 'failed' as GalleryZipImportStatus,
          stage:
            orphan.status === 'pending'
              ? '服务重启后找不到 ZIP 临时文件，请重新上传'
              : `服务重启导致导入中断，已入库 ${imported} 张已保留，剩余图片请重新上传`,
          finishedAt: now,
          updatedAt: now,
        },
      });
      if (failed.modifiedCount && zipPath) await this.safeUnlink(zipPath);
    }
  }

  /**
   * @description 把任务登记到本进程名下并异步排进本进程的串行处理（不等待）。
   * @keyword-cn 登记本进程任务, 串行处理
   * @keyword-en register-owned-job, sequential-processing
   */
  private scheduleJob(id: string): void {
    this.ownedJobIds.add(id);
    setImmediate(() => {
      void this.processJob(id)
        .catch((e) => {
          console.error('[GalleryZipImportService.processJob] crashed', e);
        })
        .finally(() => this.ownedJobIds.delete(id));
    });
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
      ownerId: this.ownerId,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.insertOne(doc);
    this.scheduleJob(doc.id);
    return doc;
  }

  /**
   * @description 查询单条任务(去 _id)
   * @keyword-en get zip import job by id
   */
  async getById(
    id: string,
  ): Promise<Omit<GalleryZipImportEntity, '_id'> | null> {
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
    if (
      cur.status === 'done' ||
      cur.status === 'failed' ||
      cur.status === 'cancelled'
    ) {
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
    const clientManifest = this.readClientPreprocessManifest(zip);

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
        const batchIds: number[] = [];
        for (const d of docs) {
          if (typeof d.id === 'number' && Number.isFinite(d.id)) {
            imageIds.push(d.id);
            batchIds.push(d.id);
          }
        }
        // 每批入库后就记下图片 id：进程中途退出时，恢复扫描据此说明已入库多少张
        if (batchIds.length) {
          await this.jobs.updateOne(
            { id },
            { $push: { imageIds: { $each: batchIds } } },
          );
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

          const clientImage = clientManifest.get(entryName);
          if (!clientImage) {
            // 兼容旧 ZIP 或客户端处理失败的 entry，继续走服务端压缩和尺寸读取。
            const compressed = await this.gallery
              .compressImageInPlace({
                filePath: absPath,
                maxWidth: 1600,
                maxHeight: 1600,
                quality: 75,
              })
              .catch(() => null);
            if (compressed?.reason && compressed.reason !== 'not-smaller') {
              console.error(
                `[gallery-zip-compress-skip] ${entryName} :: ${compressed.reason}`,
              );
            }
          }

          const thumb = await this.gallery
            .generateThumbnail(absPath, entryName)
            .catch(() => null);
          const dims = clientImage
            ? { width: clientImage.width, height: clientImage.height }
            : await this.readImageDimensions(absPath);

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
          status: (allOk
            ? 'done'
            : success > 0
              ? 'done'
              : 'failed') as GalleryZipImportStatus,
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
      stage: partial ? `已取消(已入库 ${partial.success} 张)` : '已取消',
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
        | {
            read: (
              path: string,
            ) => Promise<{ bitmap?: { width?: number; height?: number } }>;
          }
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
   * @description 读取并校验前端写入的图片预处理清单；只有 processed=true 且尺寸合法的 entry 才可跳过服务端压缩和尺寸读取。
   * @param {StreamZipInstance} zip 已打开的 ZIP 实例。
   * @returns {Map<string, ClientPreprocessManifestEntry>} 按 ZIP entryName 索引的可信客户端预处理结果。
   * @keyword-cn 客户端预处理清单, 跳过重复压缩
   * @keyword-en client-preprocess-manifest, skip-duplicate-compression
   */
  private readClientPreprocessManifest(
    zip: StreamZipInstance,
  ): Map<string, ClientPreprocessManifestEntry> {
    const output = new Map<string, ClientPreprocessManifestEntry>();
    try {
      const entry = zip.entry(CLIENT_PREPROCESS_MANIFEST);
      const size = Math.max(0, Number(entry?.size) || 0);
      if (!entry || size <= 0 || size > MAX_CLIENT_MANIFEST_BYTES)
        return output;
      const raw = zip
        .entryDataSync(CLIENT_PREPROCESS_MANIFEST)
        .toString('utf8');
      const parsed = JSON.parse(raw) as {
        version?: unknown;
        processor?: unknown;
        images?: unknown;
      };
      if (
        parsed?.version !== 1 ||
        parsed?.processor !== 'ai-manger-web' ||
        !Array.isArray(parsed.images)
      ) {
        return output;
      }
      for (const item of parsed.images) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Record<string, unknown>;
        const entryName = String(candidate.entryName || '');
        const width = Number(candidate.width);
        const height = Number(candidate.height);
        if (
          candidate.processed !== true ||
          !entryName ||
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width <= 0 ||
          height <= 0 ||
          width > 100_000 ||
          height > 100_000
        ) {
          continue;
        }
        output.set(entryName, { entryName, width, height });
      }
    } catch (error) {
      console.warn(
        '[GalleryZipImportService.readClientPreprocessManifest] ignored invalid manifest:',
        errorMessage(error),
      );
    }
    return output;
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
        const mod = (await import('node-stream-zip')) as Record<
          string,
          unknown
        >;
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
