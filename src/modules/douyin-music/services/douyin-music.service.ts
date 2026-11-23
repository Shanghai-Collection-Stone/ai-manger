import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OssStorageService } from '../../video-library/services/oss-storage.service.js';
import {
  DOUYIN_MUSIC_MAX_BYTES,
  DOUYIN_MUSIC_USER_UPLOAD_LIMIT,
  type DouyinMusicEntity,
  type DouyinMusicView,
} from '../entities/douyin-music.entity.js';
import {
  DouyinMusicRepositoryService,
  type DouyinMusicScope,
} from './douyin-music-repository.service.js';
import {
  musicNameFromFile,
  normalizeMusicCategory,
  sniffMusicFormat,
} from './douyin-music-rules.js';

/**
 * @description 上传进来的音乐文件（multer 内存存储）。
 * @keyword-cn 音乐上传文件, 内存文件
 * @keyword-en music-upload-file, memory-file
 */
export type DouyinMusicFile = {
  buffer: Buffer;
  originalname: string;
  size: number;
};

/**
 * @description 音乐上传与删除：校验真实格式和大小，文件存对象存储，记录写库；写库失败回收对象，删除记录后清理对象。
 * @keyword-cn 音乐服务, 音乐上传
 * @keyword-en douyin-music-service, music-upload
 */
@Injectable()
export class DouyinMusicService {
  private readonly logger = new Logger(DouyinMusicService.name);

  /**
   * @description 注入音乐仓储与对象存储。
   * @keyword-cn 初始化音乐服务, 依赖注入
   * @keyword-en init-music-service, dependency-injection
   * @param {DouyinMusicRepositoryService} repository 音乐仓储。
   * @param {OssStorageService} oss 对象存储。
   */
  constructor(
    private readonly repository: DouyinMusicRepositoryService,
    private readonly oss: OssStorageService,
  ) {}

  /**
   * @description 后台新增一首曲库曲目，必须写明授权来源。
   * @keyword-cn 新增曲库曲目, 授权来源
   * @keyword-en add-library-track, license-source
   * @param {DouyinMusicFile|undefined} file 音乐文件。
   * @param {{name?: string, category?: string, licenseNote: string, isPublic?: boolean}} input 曲目信息。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<DouyinMusicView>} 新曲目。
   * @throws {BadRequestException} 文件不合法或没写授权来源。
   */
  async addLibraryTrack(
    file: DouyinMusicFile | undefined,
    input: {
      name?: string;
      category?: string;
      licenseNote: string;
      isPublic?: boolean;
    },
    scope: DouyinMusicScope,
  ): Promise<DouyinMusicView> {
    const licenseNote = String(input.licenseNote ?? '')
      .trim()
      .slice(0, 200);
    if (!licenseNote) throw new BadRequestException('请填写这首曲目的授权来源');
    const checked = this.checkFile(file);
    const name = String(input.name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    return this.storeAndRecord(
      checked,
      {
        source: 'library',
        name: name || musicNameFromFile(checked.file.originalname),
        category: normalizeMusicCategory(input.category),
        licenseNote,
        isPublic: input.isPublic,
      },
      scope,
    );
  }

  /**
   * @description 工作台成员上传音乐，租户内共享，每人有数量上限。
   * @keyword-cn 上传个人音乐, 上传配额
   * @keyword-en add-user-upload, upload-quota
   * @param {DouyinMusicFile|undefined} file 音乐文件。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<DouyinMusicView>} 新音乐。
   * @throws {BadRequestException} 文件不合法或超过数量上限。
   */
  async addUpload(
    file: DouyinMusicFile | undefined,
    scope: DouyinMusicScope,
  ): Promise<DouyinMusicView> {
    const checked = this.checkFile(file);
    if (
      (await this.repository.countUploads(scope)) >=
      DOUYIN_MUSIC_USER_UPLOAD_LIMIT
    )
      throw new BadRequestException(
        `最多保留 ${DOUYIN_MUSIC_USER_UPLOAD_LIMIT} 首自己上传的音乐，请先删掉不用的`,
      );
    return this.storeAndRecord(
      checked,
      {
        source: 'upload',
        name: musicNameFromFile(checked.file.originalname),
        category: 'other',
      },
      scope,
    );
  }

  /**
   * @description 删除本租户的曲库曲目并清理文件。
   * @keyword-cn 删除曲库音乐, 清理文件
   * @keyword-en delete-library-track, cleanup-object
   * @param {number} id 音乐业务 ID。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<{ok: true}>} 删除结果。
   * @throws {NotFoundException} 曲目不存在或不属于本租户。
   */
  async removeLibraryTrack(
    id: number,
    scope: DouyinMusicScope,
  ): Promise<{ ok: true }> {
    return this.finishRemoval(await this.repository.removeLibrary(id, scope));
  }

  /**
   * @description 删除上传的音乐并清理文件：成员只能删自己传的，管理员可删本租户成员传的。
   * @keyword-cn 删除个人音乐, 清理文件
   * @keyword-en delete-user-upload, cleanup-object
   * @param {number} id 音乐业务 ID。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<{ok: true}>} 删除结果。
   * @throws {NotFoundException} 音乐不存在或无权删除。
   */
  async removeUpload(
    id: number,
    scope: DouyinMusicScope,
  ): Promise<{ ok: true }> {
    return this.finishRemoval(await this.repository.removeUpload(id, scope));
  }

  /**
   * @description 校验音乐文件的存在、大小与真实格式。
   * @keyword-cn 校验音乐文件, 格式大小校验
   * @keyword-en check-music-file, format-size-check
   * @param {DouyinMusicFile|undefined} file 音乐文件。
   * @returns {{file: DouyinMusicFile, format: {extension: string, contentType: string}}} 文件与格式。
   * @throws {BadRequestException} 文件缺失、过大或格式不支持。
   */
  private checkFile(file: DouyinMusicFile | undefined): {
    file: DouyinMusicFile;
    format: { extension: string; contentType: string };
  } {
    if (!file?.buffer?.length) throw new BadRequestException('请选择音乐文件');
    if (file.buffer.length > DOUYIN_MUSIC_MAX_BYTES)
      throw new BadRequestException('音乐文件不能超过 30MB');
    const format = sniffMusicFormat(file.buffer);
    if (!format)
      throw new BadRequestException('只支持 MP3、WAV、M4A 格式的音乐');
    return { file, format };
  }

  /**
   * @description 把文件传到对象存储并写记录；写库失败时回收刚传的对象。
   * @keyword-cn 保存音乐文件, 失败回收
   * @keyword-en store-music-file, rollback-object
   * @param {{file: DouyinMusicFile, format: {extension: string, contentType: string}}} checked 校验过的文件。
   * @param {object} fields 音乐字段。
   * @param {DouyinMusicScope} scope 租户用户作用域。
   * @returns {Promise<DouyinMusicView>} 新记录。
   */
  private async storeAndRecord(
    checked: {
      file: DouyinMusicFile;
      format: { extension: string; contentType: string };
    },
    fields: Pick<DouyinMusicEntity, 'source' | 'name' | 'category'> & {
      licenseNote?: string;
      isPublic?: boolean;
    },
    scope: DouyinMusicScope,
  ): Promise<DouyinMusicView> {
    const key = this.oss.buildObjectKey({
      scene: 'audio',
      fileName: `music${checked.format.extension}`,
      tenantId: scope.tenantId,
    });
    await this.oss.putObject(
      key,
      checked.file.buffer,
      checked.format.contentType,
    );
    try {
      return await this.repository.create(
        {
          ...fields,
          key,
          contentType: checked.format.contentType,
          sizeBytes: checked.file.buffer.length,
        },
        scope,
      );
    } catch (error) {
      await this.oss.deleteObjects([key]);
      throw error;
    }
  }

  /**
   * @description 记录删掉后清理对象；对象残留只记日志，不把删除判失败。
   * @keyword-cn 完成音乐删除, 残留对象日志
   * @keyword-en finish-music-removal, orphan-object-log
   * @param {DouyinMusicEntity|null} row 被删记录。
   * @returns {Promise<{ok: true}>} 删除结果。
   * @throws {NotFoundException} 没有删到记录。
   */
  private async finishRemoval(
    row: DouyinMusicEntity | null,
  ): Promise<{ ok: true }> {
    if (!row) throw new NotFoundException('DOUYIN_MUSIC_NOT_FOUND');
    const { failed } = await this.oss.deleteObjects([row.key]);
    if (failed.length)
      this.logger.warn(`[finishRemoval] 音乐文件残留: ${failed.join(', ')}`);
    return { ok: true };
  }
}
