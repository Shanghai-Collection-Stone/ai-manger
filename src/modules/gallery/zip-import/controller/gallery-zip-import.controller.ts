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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { GalleryZipImportService } from '../services/gallery-zip-import.service.js';
import { AdminService } from '../../../admin/services/admin.service.js';

/** @description 1GB 单包上限 */
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

/**
 * @description Gallery ZIP 批量导入控制器(挂载于 /gallery/zip-import)
 * @keyword-en gallery zip import controller, upload, list, cancel
 */
@Controller('gallery/zip-import')
export class GalleryZipImportController {
  constructor(
    private readonly zipImport: GalleryZipImportService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * @description 从 Bearer token 解析作用域(tenantId+userId)
   * @keyword-en resolve auth scope from bearer token
   */
  private async resolveAuthScope(
    req: Request,
  ): Promise<{ tenantId?: string; userId?: string }> {
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

  /**
   * @description 上传 zip 包并入队列(立即返回 jobId,实际解压在后台)
   * @keyword-en upload zip and enqueue background import job
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.diskStorage({
        destination: (
          _req: unknown,
          _file: Express.Multer.File,
          cb: (error: Error | null, destination: string) => void,
        ) => {
          const dir = join(process.cwd(), 'public', 'uploads_zips');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (
          _req: unknown,
          file: Express.Multer.File,
          cb: (error: Error | null, filename: string) => void,
        ) => {
          const rawExt = extname(String(file.originalname || '')).toLowerCase();
          const ext = rawExt === '.zip' ? '.zip' : '.zip';
          cb(null, `${Date.now()}-${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (
        _req: unknown,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const name = String(file.originalname || '').toLowerCase();
        const mt = String(file.mimetype || '').toLowerCase();
        const okExt = name.endsWith('.zip');
        const okMime =
          mt === 'application/zip' ||
          mt === 'application/x-zip-compressed' ||
          mt === 'application/octet-stream';
        cb(null, okExt && okMime);
      },
      limits: { fileSize: MAX_ZIP_BYTES },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body()
    body: {
      userId?: string;
      groupId?: string;
      tags?: string;
    },
    @Req() req: Request,
  ): Promise<{ job: Record<string, unknown> }> {
    if (!file) throw new BadRequestException('未上传 ZIP 文件');
    const scope = await this.resolveAuthScope(req);
    const userId = String(body?.userId ?? '').trim() || scope.userId;
    if (!userId) throw new BadRequestException('userId is required');

    const rawTags = String(body?.tags ?? '');
    const tags = rawTags
      .split(/[,\t\n\r\s]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const groupIdRaw = String(body?.groupId ?? '').trim();
    let groupId: string | number | undefined;
    if (groupIdRaw.length > 0) {
      const n = Number(groupIdRaw);
      groupId = Number.isFinite(n) ? n : groupIdRaw;
    }

    const job = await this.zipImport.enqueue({
      userId,
      tenantId: scope.tenantId,
      scope: 'tenant',
      groupId,
      tags,
      originalName: String(file.originalname || file.filename || ''),
      fileSize: typeof file.size === 'number' ? file.size : 0,
      zipAbsPath: String(file.path || ''),
    });

    const clean = { ...job } as Record<string, unknown>;
    delete clean._id;
    return { job: clean };
  }

  /**
   * @description 列出当前作用域最近的 zip 导入任务
   * @keyword-en list recent zip import jobs
   */
  @Get('list')
  async list(
    @Query('limit') limit: string | undefined,
    @Query('userId') userId: string | undefined,
    @Req() req: Request,
  ): Promise<{ jobs: Array<Record<string, unknown>> }> {
    const scope = await this.resolveAuthScope(req);
    const lim = limit ? Number(limit) : 30;
    const uid = String(userId ?? '').trim() || scope.userId;
    const rows = await this.zipImport.listRecent(
      uid,
      scope.tenantId,
      Number.isFinite(lim) ? lim : 30,
    );
    return { jobs: rows };
  }

  /**
   * @description 查询单条任务详情(轮询入口)
   * @keyword-en get single zip import job by id
   */
  @Get(':id')
  async getById(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ job: Record<string, unknown> | null }> {
    await this.resolveAuthScope(req);
    const job = await this.zipImport.getById(String(id || '').trim());
    return { job: job as Record<string, unknown> | null };
  }

  /**
   * @description 请求取消任务
   * @keyword-en cancel zip import job
   */
  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    await this.resolveAuthScope(req);
    return this.zipImport.cancel(String(id || '').trim());
  }

  /**
   * @description 删除任务记录(仅限完成/失败/取消态)
   * @keyword-en delete zip import job record
   */
  @Post(':id/delete')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    await this.resolveAuthScope(req);
    return this.zipImport.remove(String(id || '').trim());
  }
}
