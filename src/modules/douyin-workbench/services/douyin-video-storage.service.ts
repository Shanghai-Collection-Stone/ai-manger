import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { OssStorageService } from '../../video-library/services/oss-storage.service.js';
import { VideoLibraryService } from '../../video-library/services/video-library.service.js';

type DouyinScope = { tenantId?: string; userId: string };

/**
 * @description 登记成片时的名称、作用域、标签与可选的时长与尺寸。
 * @keyword-cn 成片登记参数, 视频库登记
 * @keyword-en output-video-meta, video-library-register
 */
export interface DouyinOutputVideoMeta {
  name: string;
  scope: DouyinScope;
  tags: string[];
  durationSeconds?: number;
  width?: number;
  height?: number;
}

/**
 * @description 本服务站内静态目录（`/static` 映射到 `public`）下的地址换成磁盘路径，拒绝 `..` 穿越；不是站内地址时返回 null。
 * @keyword-cn 站内地址转磁盘路径, 路径穿越防护
 * @keyword-en static-url-to-path, path-traversal-guard
 * @param {string} url 视频或图片地址。
 * @returns {string|null} 磁盘路径。
 */
export function resolveStaticFilePath(url: string): string | null {
  const value = String(url ?? '').trim();
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const relative = value
    .split('?')[0]
    .replace(/^\/static\//, '')
    .replace(/^\/+/, '');
  if (!relative || relative.split('/').some((segment) => segment === '..'))
    return null;
  return join(process.cwd(), 'public', relative);
}

/**
 * @description 抖音工作台成片落库：把本地合成的视频或供应商临时地址的视频存进视频库，另存探店配音与临时克隆录音。OSS 配好时上传 OSS 并按对象键登记；
 *   没配 OSS 时合成文件落到 `public/uploads/douyin-video`、配音落到 `public/uploads/douyin-audio`、供应商地址直接登记外链，并记警告。
 * @keyword-cn 抖音成片落库, 视频库登记
 * @keyword-en douyin-output-video-storage, video-library-register
 */
@Injectable()
export class DouyinVideoStorageService {
  private readonly logger = new Logger(DouyinVideoStorageService.name);

  constructor(
    private readonly videoLibrary: VideoLibraryService,
    private readonly oss: OssStorageService,
  ) {}

  /**
   * @description 把本机上的一个 mp4 文件存进视频库，返回视频库 ID 与地址。
   * @keyword-cn 保存本地成片, 合成成片入库
   * @keyword-en save-local-video, store-merged-video
   * @param {string} filePath 本机文件路径。
   * @param {DouyinOutputVideoMeta} meta 名称、作用域、标签、时长与尺寸。
   * @returns {Promise<{id: number, url: string}>} 视频库记录。
   */
  async saveFile(
    filePath: string,
    meta: DouyinOutputVideoMeta,
  ): Promise<{ id: number; url: string }> {
    const stat = await fsPromises.stat(filePath);
    const common = this.commonFields(meta);
    if (this.oss.isConfigured()) {
      const buffer = await fsPromises.readFile(filePath);
      const key = this.oss.buildObjectKey({
        scene: 'video',
        fileName: 'generated.mp4',
        tenantId: meta.scope.tenantId,
      });
      await this.oss.putObject(key, buffer, 'video/mp4');
      const record = await this.videoLibrary.register({
        ...common,
        key,
        sizeBytes: buffer.length,
      });
      return { id: record.id, url: record.url };
    }
    const tenant =
      String(meta.scope.tenantId ?? '').replace(/[^A-Za-z0-9_-]/g, '') ||
      'platform';
    const relative = `uploads/douyin-video/${tenant}/${randomUUID()}.mp4`;
    const target = join(process.cwd(), 'public', relative);
    await fsPromises.mkdir(dirname(target), { recursive: true });
    await fsPromises.copyFile(filePath, target);
    this.logger.warn(`[saveFile] OSS 未配置，成片存到本机 public/${relative}`);
    const record = await this.videoLibrary.registerExternal({
      ...common,
      url: `/static/${relative}`,
      sizeBytes: stat.size,
    });
    return { id: record.id, url: record.url };
  }

  /**
   * @description 把供应商返回的临时视频地址存进视频库：OSS 配好时先下载再走 `saveFile`，否则直接登记外链。
   * @keyword-cn 保存供应商成片, 临时地址转存
   * @keyword-en save-remote-video, persist-temporary-url
   * @param {string} url 供应商成片地址。
   * @param {DouyinOutputVideoMeta} meta 名称、作用域、标签与时长。
   * @returns {Promise<{id: number, url: string}>} 视频库记录。
   */
  async saveRemote(
    url: string,
    meta: DouyinOutputVideoMeta,
  ): Promise<{ id: number; url: string }> {
    if (!this.oss.isConfigured()) {
      this.logger.warn('[saveRemote] OSS 未配置，视频库登记供应商临时地址');
      const record = await this.videoLibrary.registerExternal({
        ...this.commonFields(meta),
        url,
        sizeBytes: 0,
      });
      return { id: record.id, url: record.url };
    }
    const workDir = await fsPromises.mkdtemp(join(tmpdir(), 'douyin-video-'));
    try {
      const filePath = join(workDir, 'remote.mp4');
      await this.download(url, filePath);
      return await this.saveFile(filePath, meta);
    } finally {
      await fsPromises.rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * @description 保存一段音频（探店配音或克隆录音）：OSS 配好时上传到 `audio` 场景并返回公网地址与对象键；
   *   没配 OSS 时落到 `public/uploads/douyin-audio`，返回站内地址（这种地址外部服务访问不到，克隆前要先判断 `hasPublicStorage`）。
   * @keyword-cn 保存配音文件, 音频入存储
   * @keyword-en save-audio-file, store-voiceover
   * @param {Buffer} buffer 音频内容。
   * @param {{scope: DouyinScope, fileName: string, contentType: string}} meta 作用域、带扩展名的文件名与媒体类型。
   * @returns {Promise<{url: string, key?: string}>} 地址与 OSS 对象键（本地落盘时没有）。
   */
  async saveAudio(
    buffer: Buffer,
    meta: { scope: DouyinScope; fileName: string; contentType: string },
  ): Promise<{ url: string; key?: string }> {
    if (this.oss.isConfigured()) {
      const key = this.oss.buildObjectKey({
        scene: 'audio',
        fileName: meta.fileName,
        tenantId: meta.scope.tenantId,
      });
      const url = await this.oss.putObject(key, buffer, meta.contentType);
      return { url, key };
    }
    const tenant =
      String(meta.scope.tenantId ?? '').replace(/[^A-Za-z0-9_-]/g, '') ||
      'platform';
    const extension = /\.[a-z0-9]{1,8}$/i.exec(meta.fileName)?.[0] ?? '';
    const relative = `uploads/douyin-audio/${tenant}/${randomUUID()}${extension.toLowerCase()}`;
    const target = join(process.cwd(), 'public', relative);
    await fsPromises.mkdir(dirname(target), { recursive: true });
    await fsPromises.writeFile(target, buffer);
    this.logger.warn(`[saveAudio] OSS 未配置，音频存到本机 public/${relative}`);
    return { url: `/static/${relative}` };
  }

  /**
   * @description 删掉 `saveAudio` 存到 OSS 的音频（克隆完录音立即删），失败不抛错。
   * @keyword-cn 删除音频文件, 清理录音
   * @keyword-en delete-audio-file, cleanup-voice-sample
   * @param {string} key OSS 对象键。
   * @returns {Promise<void>} 删除完成。
   */
  async deleteAudio(key: string): Promise<void> {
    await this.oss.deleteObjects([key]).catch(() => undefined);
  }

  /**
   * @description 存储能否给外部服务公网访问：只有配了 OSS 才能把录音交给百炼克隆。
   * @keyword-cn 公网存储可用, OSS已配置
   * @keyword-en public-storage-available, oss-configured
   * @returns {boolean} 是否配了 OSS。
   */
  hasPublicStorage(): boolean {
    return this.oss.isConfigured();
  }

  /**
   * @description 把一条视频（站内静态地址或公网地址）落到本机指定路径：站内文件直接复制，公网地址流式下载，10 分钟超时。
   * @keyword-cn 下载视频到本机, 站内文件复制
   * @keyword-en download-video-file, copy-static-file
   * @param {string} url 视频地址。
   * @param {string} target 目标文件路径。
   * @throws {Error} 文件不存在或下载失败时抛出带原因的错误。
   */
  async download(url: string, target: string): Promise<void> {
    const local = resolveStaticFilePath(url);
    if (local) {
      await fsPromises.copyFile(local, target);
      return;
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`VIDEO_DOWNLOAD_FAILED_${response.status}`);
    }
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      ),
      createWriteStream(target),
    );
  }

  /**
   * @description 拼视频库登记的公共字段：时长换算毫秒，尺寸缺省为空。
   * @keyword-cn 视频登记公共字段, 时长换算
   * @keyword-en video-register-fields, duration-to-ms
   * @param {DouyinOutputVideoMeta} meta 登记参数。
   * @returns 视频库登记字段（不含对象键与地址）。
   */
  private commonFields(meta: DouyinOutputVideoMeta) {
    const positive = (value?: number) =>
      Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
    const seconds = positive(meta.durationSeconds);
    return {
      userId: meta.scope.userId,
      tenantId: meta.scope.tenantId,
      name: meta.name,
      contentType: 'video/mp4',
      durationMs: seconds ? Math.round(seconds * 1000) : null,
      width: positive(meta.width),
      height: positive(meta.height),
      tags: meta.tags,
    };
  }
}
