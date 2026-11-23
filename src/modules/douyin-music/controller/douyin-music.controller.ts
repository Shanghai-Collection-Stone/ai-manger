import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import {
  DOUYIN_MUSIC_CATEGORIES,
  DOUYIN_MUSIC_DEFAULT_VOLUME,
  DOUYIN_MUSIC_MAX_BYTES,
  DOUYIN_MUSIC_USER_UPLOAD_LIMIT,
} from '../entities/douyin-music.entity.js';
import { DouyinMusicRepositoryService } from '../services/douyin-music-repository.service.js';
import { normalizeMusicCategory } from '../services/douyin-music-rules.js';
import { DouyinMusicService } from '../services/douyin-music.service.js';
import {
  CreateDouyinMusicDto,
  UpdateDouyinMusicDto,
} from './douyin-music.dto.js';

/**
 * @description 背景音乐鉴权接口：后台维护曲库，工作台读取可用音乐并管理自己上传的音乐。
 * @keyword-cn 背景音乐接口, 曲库管理接口
 * @keyword-en douyin-music-controller, music-library-api
 */
@Controller('api/douyin-music')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class DouyinMusicController {
  /**
   * @description 注入音乐仓储与上传服务。
   * @keyword-cn 初始化音乐接口, 依赖注入
   * @keyword-en init-music-controller, dependency-injection
   * @param {DouyinMusicRepositoryService} repository 音乐仓储。
   * @param {DouyinMusicService} music 音乐服务。
   */
  constructor(
    private readonly repository: DouyinMusicRepositoryService,
    private readonly music: DouyinMusicService,
  ) {}

  /**
   * @description 查询可用音乐；`source=library` 只看曲库，`includeArchived=1` 连同本租户已归档曲目（后台管理页）。
   * @keyword-cn 查询音乐接口, 可用音乐
   * @keyword-en list-music-api, usable-tracks
   */
  @Get()
  @RequirePermission('read', 'DouyinMusic')
  async list(
    @Req() req: AdminRequest,
    @Query('includeArchived') includeArchived?: string,
    @Query('source') source?: string,
  ) {
    return {
      tracks: await this.repository.list(this.scopeOf(this.requireUser(req)), {
        includeArchived: includeArchived === '1' || includeArchived === 'true',
        libraryOnly: source === 'library',
      }),
    };
  }

  /**
   * @description 返回曲库分类、默认音量和上传限制，前后端取值同源。
   * @keyword-cn 音乐选项接口, 分类登记表
   * @keyword-en music-options-api, category-registry
   */
  @Get('options')
  @RequirePermission('read', 'DouyinMusic')
  options() {
    return {
      categories: Object.entries(DOUYIN_MUSIC_CATEGORIES).map(
        ([key, label]) => ({ key, label }),
      ),
      defaultVolume: DOUYIN_MUSIC_DEFAULT_VOLUME,
      maxBytes: DOUYIN_MUSIC_MAX_BYTES,
      uploadLimit: DOUYIN_MUSIC_USER_UPLOAD_LIMIT,
    };
  }

  /**
   * @description 后台新增曲库曲目（multipart 字段 `file`，最多 30MB），必须写授权来源。
   * @keyword-cn 新增曲目接口, 上传曲库音乐
   * @keyword-en create-library-track-api, upload-library-music
   */
  @Post()
  @RequirePermission('create', 'DouyinMusic')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: DOUYIN_MUSIC_MAX_BYTES },
    }),
  )
  async create(
    @Req() req: AdminRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: CreateDouyinMusicDto,
  ) {
    return {
      track: await this.music.addLibraryTrack(
        file,
        body,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 工作台上传音乐（multipart 字段 `file`，最多 30MB），租户内成员都能选用。
   * @keyword-cn 上传个人音乐接口, 自传音乐
   * @keyword-en upload-user-music-api, personal-music
   */
  @Post('uploads')
  @RequirePermission('create', 'DouyinWorkbench')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: DOUYIN_MUSIC_MAX_BYTES },
    }),
  )
  async upload(
    @Req() req: AdminRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return {
      track: await this.music.addUpload(
        file,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 删除上传的音乐：成员只能删自己传的，管理员可删本租户任何成员传的。
   * @keyword-cn 删除个人音乐接口, 移除自传音乐
   * @keyword-en delete-user-music-api, remove-personal-music
   */
  @Delete('uploads/:id')
  @RequirePermission('delete', 'DouyinWorkbench')
  async removeUpload(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.music.removeUpload(
      this.readId(id),
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 更新曲库曲目的信息、归档状态或平台公开开关（仅母平台可设公开）。
   * @keyword-cn 更新曲目接口, 归档曲目
   * @keyword-en update-library-track-api, archive-track
   */
  @Patch(':id')
  @RequirePermission('update', 'DouyinMusic')
  async update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: UpdateDouyinMusicDto,
  ) {
    const track = await this.repository.updateLibrary(
      this.readId(id),
      {
        ...body,
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.category !== undefined
          ? { category: normalizeMusicCategory(body.category) }
          : {}),
        ...(body.licenseNote !== undefined
          ? { licenseNote: body.licenseNote.trim() }
          : {}),
      },
      this.scopeOf(this.requireUser(req)),
    );
    if (!track) throw new NotFoundException('DOUYIN_MUSIC_NOT_FOUND');
    return { track };
  }

  /**
   * @description 删除曲库曲目；已选用它的脚本下次合成时按无音乐处理并提示。
   * @keyword-cn 删除曲目接口, 移除曲库音乐
   * @keyword-en delete-library-track-api, remove-library-music
   */
  @Delete(':id')
  @RequirePermission('delete', 'DouyinMusic')
  async remove(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.music.removeLibraryTrack(
      this.readId(id),
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 解析并校验路由中的正整数音乐 ID。
   * @keyword-cn 解析音乐ID, 路由校验
   * @keyword-en parse-music-id, route-validation
   * @param {string} value 路由参数。
   * @returns {number} 音乐 ID。
   * @throws {BadRequestException} ID 不合法。
   */
  private readId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1)
      throw new BadRequestException('DOUYIN_MUSIC_ID_INVALID');
    return id;
  }

  /**
   * @description 读取登录用户，未登录直接拒绝。
   * @keyword-cn 读取音乐接口用户, 拒绝匿名
   * @keyword-en require-music-user, reject-anonymous
   * @param {AdminRequest} req 当前请求。
   * @returns {AdminUserEntity} 登录用户。
   * @throws {UnauthorizedException} 未登录。
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }

  /**
   * @description 把当前用户转换成仓储使用的租户用户作用域，超管与租户管理员可管理成员上传的音乐。
   * @keyword-cn 构造音乐作用域, 租户边界
   * @keyword-en build-music-scope, tenant-boundary
   * @param {AdminUserEntity} user 登录用户。
   * @returns {{tenantId?: string, userId: string, canManageUploads: boolean}} 作用域。
   */
  private scopeOf(user: AdminUserEntity) {
    return {
      tenantId: user.tenantId,
      userId: String(user._id),
      canManageUploads: ['super_admin', 'tenant_admin'].includes(user.role),
    };
  }
}
