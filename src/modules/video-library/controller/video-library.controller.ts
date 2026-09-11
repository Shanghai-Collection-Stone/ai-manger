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
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from '../../admin/services/admin.service.js';
import { VideoLibraryService } from '../services/video-library.service.js';
import { VideoGroupService } from '../services/video-group.service.js';
import {
  OssStorageService,
  type OssUploadScene,
  type OssUploadTicket,
} from '../services/oss-storage.service.js';
import type { VideoEntity } from '../entities/video.entity.js';
import type {
  VideoGroupEntity,
  VideoGroupView,
} from '../entities/video-group.entity.js';

/**
 * @description 安全读字符串：只认字符串与数字，对象一律当空。直接对 unknown 调 String()
 *   会把请求体里塞进来的对象变成 "[object Object]" 存进库，看着像有值其实是垃圾。
 * @keyword-cn 字符串读取, 入参归一
 * @keyword-en read-string, normalize-input
 * @param {unknown} value - 原始值。
 * @returns {string} 去空白后的字符串，非标量时为空串。
 */
function readString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

/**
 * @description 把逗号 / 空白分隔的标签串或数组收敛成去重后的标签数组。
 * @keyword-cn 标签归一化
 * @keyword-en normalize-tags
 * @param {unknown} input - 原始输入（数组或分隔串）。
 * @returns {string[]} 标签数组。
 */
function normalizeTags(input: unknown): string[] {
  const list: unknown[] = Array.isArray(input)
    ? input
    : readString(input).split(/[,，、\t\n\r]+/g);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const tag = readString(item);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * @description 解析可选的数字入参，非法值一律当没传。
 * @keyword-cn 数字入参解析
 * @keyword-en parse-optional-number
 * @param {unknown} value - 原始值。
 * @returns {number|undefined} 数字或 undefined。
 */
function parseOptionalNumber(value: unknown): number | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * @title 视频库控制器 Video Library Controller
 * @description 桌面端「AI 视频」板块的后端入口：分组、视频记录、标签，以及 OSS 直传票据。
 *   视频二进制**不经过本服务**——前端拿票据直传对象存储，这里只收一条带 `key` 的登记请求。
 *
 *   鉴权沿用同类租户侧模块（gallery / article-library）的 `resolveAuthScope`：
 *   Bearer token → `AdminService.getUserByToken` → `{tenantId, userId}`，不挂 CASL
 *   `@RequirePermission`。后者绑定 `AdminAuthGuard` 且权限注册中心里没有 VideoLibrary 主体，
 *   挂上会把桌面端这类租户侧调用方整个挡死，与 gallery 当初的结论一致。
 * @keyword-cn 视频库控制器, 直传票据, 租户鉴权
 * @keyword-en video-library-controller, upload-ticket, tenant-auth
 */
@Controller('api/video-library')
export class VideoLibraryController {
  constructor(
    private readonly videos: VideoLibraryService,
    private readonly groups: VideoGroupService,
    private readonly oss: OssStorageService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @description 解析请求鉴权范围（Bearer token → `{tenantId, userId}`）。
   * @keyword-cn 鉴权解析, 租户范围
   * @keyword-en resolve-auth-scope, tenant-scope
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<{tenantId?: string, userId: string}>} 鉴权范围。
   * @throws {UnauthorizedException} 没有 token 或 token 失效时抛出 `AUTH_REQUIRED`。
   */
  private async resolveAuthScope(
    req: Request,
  ): Promise<{ tenantId?: string; userId: string }> {
    const auth = req?.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
    const token = auth.slice(7).trim();
    if (!token) throw new UnauthorizedException('AUTH_REQUIRED');
    const user = await this.adminService.getUserByToken(token);
    if (!user) throw new UnauthorizedException('AUTH_REQUIRED');
    return { tenantId: user.tenantId, userId: user.username };
  }

  // ───── 分组 ────────────────────────────────────────────────────────────────

  /**
   * @description 列出视频分组，附分组内视频数。
   * @keyword-cn 分组列表端点
   * @keyword-en list-video-groups-endpoint
   * @param {Request} req - 当前 HTTP 请求。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @returns {Promise<{groups: VideoGroupView[]}>} 分组列表。
   */
  @Get('groups')
  async listGroups(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ): Promise<{ groups: VideoGroupView[] }> {
    const scope = await this.resolveAuthScope(req);
    const groups = await this.groups.list({
      tenantId: scope.tenantId,
      limit: parseOptionalNumber(limit),
    });
    return { groups };
  }

  /**
   * @description 新建视频分组。
   * @keyword-cn 新建分组端点
   * @keyword-en create-video-group-endpoint
   * @param {{name?: string, description?: string, tags?: unknown}} body - 分组字段。
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<{group: Omit<VideoGroupEntity, '_id'>}>} 新分组。
   * @throws {BadRequestException} 缺少名称时抛出 `NAME_REQUIRED`。
   */
  @Post('groups')
  async createGroup(
    @Body() body: { name?: string; description?: string; tags?: unknown },
    @Req() req: Request,
  ): Promise<{ group: Omit<VideoGroupEntity, '_id'> }> {
    const scope = await this.resolveAuthScope(req);
    const name = readString(body?.name);
    if (!name) throw new BadRequestException('NAME_REQUIRED');
    const group = await this.groups.create({
      userId: scope.userId,
      tenantId: scope.tenantId,
      name,
      description: readString(body?.description) || undefined,
      tags: normalizeTags(body?.tags),
    });
    return { group };
  }

  /**
   * @description 更新视频分组。
   * @keyword-cn 更新分组端点
   * @keyword-en update-video-group-endpoint
   * @param {string} id - 路径参数：分组 ID。
   * @param {{name?: string, description?: string, tags?: unknown}} body - 待更新字段。
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<{group: Omit<VideoGroupEntity, '_id'>|null}>} 更新后的分组。
   * @throws {BadRequestException} ID 非法时抛出 `INVALID_ID`。
   */
  @Post('groups/:id')
  async updateGroup(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; tags?: unknown },
    @Req() req: Request,
  ): Promise<{ group: Omit<VideoGroupEntity, '_id'> | null }> {
    const scope = await this.resolveAuthScope(req);
    const groupId = Number(id);
    if (!Number.isFinite(groupId)) throw new BadRequestException('INVALID_ID');
    const group = await this.groups.update(
      groupId,
      {
        name: typeof body?.name === 'string' ? body.name : undefined,
        description:
          typeof body?.description === 'string' ? body.description : undefined,
        tags: body?.tags === undefined ? undefined : normalizeTags(body.tags),
      },
      scope.tenantId,
    );
    return { group };
  }

  /**
   * @description 删除视频分组，组内视频转为未分组。
   * @keyword-cn 删除分组端点
   * @keyword-en delete-video-group-endpoint
   * @param {string} id - 路径参数：分组 ID。
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<{ok: boolean, detached: number}>} 删除结果与被移出的视频数。
   * @throws {BadRequestException} ID 非法时抛出 `INVALID_ID`。
   */
  @Post('groups/:id/delete')
  async deleteGroup(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ ok: boolean; detached: number }> {
    const scope = await this.resolveAuthScope(req);
    const groupId = Number(id);
    if (!Number.isFinite(groupId)) throw new BadRequestException('INVALID_ID');
    return this.groups.remove(groupId, scope.tenantId);
  }

  // ───── 标签与列表 ──────────────────────────────────────────────────────────

  /**
   * @description 列出当前租户已用过的视频标签。
   * @keyword-cn 标签列表端点
   * @keyword-en list-video-tags-endpoint
   * @param {Request} req - 当前 HTTP 请求。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @returns {Promise<{tags: string[]}>} 标签列表。
   */
  @Get('tags')
  async listTags(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ): Promise<{ tags: string[] }> {
    const scope = await this.resolveAuthScope(req);
    const tags = await this.videos.listTags({
      tenantId: scope.tenantId,
      limit: parseOptionalNumber(limit),
    });
    return { tags };
  }

  /**
   * @description 游标分页列出视频。`cursorId` 取上一页最后一条的 id，与 `/gallery` 同语义。
   * @keyword-cn 视频列表端点, 游标分页
   * @keyword-en list-videos-endpoint, cursor-pagination
   * @param {Request} req - 当前 HTTP 请求。
   * @param {string} [groupId] - 查询参数：分组 ID。
   * @param {string} [tag] - 查询参数：标签。
   * @param {string} [cursorId] - 查询参数：游标。
   * @param {string} [limit] - 查询参数：返回条数上限。
   * @returns {Promise<{videos: Array<Omit<VideoEntity, '_id'>>}>} 视频列表。
   */
  @Get('videos')
  async listVideos(
    @Req() req: Request,
    @Query('groupId') groupId?: string,
    @Query('tag') tag?: string,
    @Query('cursorId') cursorId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ videos: Array<Omit<VideoEntity, '_id'>> }> {
    const scope = await this.resolveAuthScope(req);
    const videos = await this.videos.list({
      tenantId: scope.tenantId,
      groupId: parseOptionalNumber(groupId),
      tag: readString(tag) || undefined,
      cursorId: parseOptionalNumber(cursorId),
      limit: parseOptionalNumber(limit),
    });
    return { videos };
  }

  // ───── 视频记录 ────────────────────────────────────────────────────────────

  /**
   * @description 直传完成后登记视频记录。只认 `key`：可播放地址由服务端按对象键重算，
   *   不采信前端传来的 `url`，否则任何人都能往库里写一条指向站外的"视频"。
   * @keyword-cn 登记视频端点, 直传回执
   * @keyword-en register-video-endpoint, upload-receipt
   * @param {Record<string, unknown>} body - 视频记录字段。
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<{video: Omit<VideoEntity, '_id'>}>} 入库后的记录。
   * @throws {BadRequestException} 缺少 `key` 时抛出 `KEY_REQUIRED`。
   */
  @Post('videos')
  async registerVideo(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<{ video: Omit<VideoEntity, '_id'> }> {
    const scope = await this.resolveAuthScope(req);
    const key = readString(body?.key);
    if (!key) throw new BadRequestException('KEY_REQUIRED');
    const groupId = parseOptionalNumber(body?.groupId);
    const video = await this.videos.register({
      userId: scope.userId,
      tenantId: scope.tenantId,
      name: readString(body?.name) || key.split('/').pop() || key,
      key,
      coverKey: readString(body?.coverKey) || undefined,
      contentType: readString(body?.contentType) || undefined,
      sizeBytes: parseOptionalNumber(body?.sizeBytes) ?? 0,
      durationMs: parseOptionalNumber(body?.durationMs) ?? null,
      width: parseOptionalNumber(body?.width) ?? null,
      height: parseOptionalNumber(body?.height) ?? null,
      tags: normalizeTags(body?.tags),
      groupId: groupId ?? null,
    });
    return { video };
  }

  /**
   * @description 更新视频名称、标签或分组。
   * @keyword-cn 更新视频端点
   * @keyword-en update-video-endpoint
   * @param {string} id - 路径参数：视频 ID。
   * @param {{name?: string, tags?: unknown, groupId?: unknown}} body - 待更新字段。
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<{video: Omit<VideoEntity, '_id'>|null}>} 更新后的记录。
   * @throws {BadRequestException} ID 非法时抛出 `INVALID_ID`。
   */
  @Post('videos/:id')
  async updateVideo(
    @Param('id') id: string,
    @Body() body: { name?: string; tags?: unknown; groupId?: unknown },
    @Req() req: Request,
  ): Promise<{ video: Omit<VideoEntity, '_id'> | null }> {
    const scope = await this.resolveAuthScope(req);
    const videoId = Number(id);
    if (!Number.isFinite(videoId)) throw new BadRequestException('INVALID_ID');
    const video = await this.videos.update(
      videoId,
      {
        name: typeof body?.name === 'string' ? body.name : undefined,
        tags: body?.tags === undefined ? undefined : normalizeTags(body.tags),
        groupId:
          body?.groupId === null
            ? null
            : (parseOptionalNumber(body?.groupId) ?? undefined),
      },
      scope.tenantId,
    );
    return { video };
  }

  /**
   * @description 删除单个视频（记录 + OSS 对象）。
   * @keyword-cn 删除视频端点
   * @keyword-en delete-video-endpoint
   * @param {string} id - 路径参数：视频 ID。
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<{ok: boolean, orphanKeys: string[]}>} 删除结果与未能清理的对象键。
   * @throws {BadRequestException} ID 非法时抛出 `INVALID_ID`。
   */
  @Post('videos/:id/delete')
  async deleteVideo(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ ok: boolean; orphanKeys: string[] }> {
    const scope = await this.resolveAuthScope(req);
    const videoId = Number(id);
    if (!Number.isFinite(videoId)) throw new BadRequestException('INVALID_ID');
    const res = await this.videos.remove({
      ids: [videoId],
      tenantId: scope.tenantId,
    });
    return { ok: res.deleted > 0, orphanKeys: res.orphanKeys };
  }

  /**
   * @description 批量删除视频（记录 + OSS 对象）。
   * @keyword-cn 批量删除端点
   * @keyword-en batch-delete-videos-endpoint
   * @param {{ids?: Array<number|string>}} body - 待删除的视频 ID 列表。
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<{ok: boolean, deleted: number, deletedIds: number[], orphanKeys: string[]}>} 删除统计。
   * @throws {BadRequestException} ids 为空时抛出 `IDS_REQUIRED`。
   */
  @Post('videos/batch-delete')
  async deleteVideosBatch(
    @Body() body: { ids?: Array<number | string> },
    @Req() req: Request,
  ): Promise<{
    ok: boolean;
    deleted: number;
    deletedIds: number[];
    orphanKeys: string[];
  }> {
    const scope = await this.resolveAuthScope(req);
    const ids = (Array.isArray(body?.ids) ? body.ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
    if (ids.length === 0) throw new BadRequestException('IDS_REQUIRED');
    const res = await this.videos.remove({ ids, tenantId: scope.tenantId });
    return { ok: true, ...res };
  }

  // ───── 直传票据 ────────────────────────────────────────────────────────────

  /**
   * @description 签发一张 OSS 直传票据。大小上限在这里就先按 `size` 挡一次——策略里的
   *   `content-length-range` 是最后一道闸，但等 OSS 拒收意味着用户已经把几百 MB 传上去了。
   * @keyword-cn 直传票据端点, OSS签名
   * @keyword-en upload-ticket-endpoint, oss-signature
   * @param {{fileName?: string, contentType?: string, size?: unknown, scene?: string}} body - 待传文件信息。
   * @param {Request} req - 当前 HTTP 请求。
   * @returns {Promise<OssUploadTicket>} 直传票据。
   * @throws {BadRequestException} 文件超过场景上限时抛出 `FILE_TOO_LARGE`。
   * @throws {ServiceUnavailableException} OSS 未配置时由存储层抛出 `OSS_NOT_CONFIGURED`。
   */
  @Post('oss/signature')
  async createUploadTicket(
    @Body()
    body: {
      fileName?: string;
      contentType?: string;
      size?: unknown;
      scene?: string;
    },
    @Req() req: Request,
  ): Promise<OssUploadTicket> {
    const scope = await this.resolveAuthScope(req);
    const scene: OssUploadScene = body?.scene === 'poster' ? 'poster' : 'video';
    const size = parseOptionalNumber(body?.size) ?? 0;
    const maxBytes = this.oss.maxBytesOf(scene);
    if (size > maxBytes) throw new BadRequestException('FILE_TOO_LARGE');
    return this.oss.createUploadTicket({
      scene,
      fileName: readString(body?.fileName),
      contentType: readString(body?.contentType),
      tenantId: scope.tenantId,
    });
  }
}
