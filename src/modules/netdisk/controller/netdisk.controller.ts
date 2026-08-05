import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { NetdiskService } from '../services/netdisk.service.js';
import { createNetdiskDiskStorage } from '../services/netdisk-storage.service.js';
import {
  CreateFolderDto,
  ListNodesQueryDto,
  RenameNodeDto,
  UpdateDiskRootDto,
  UploadFileDto,
} from './netdisk.dto.js';

/**
 * @description 单文件上传大小上限(字节)，可由 NETDISK_MAX_UPLOAD_BYTES 覆盖，默认 200MB
 * @keyword-en netdisk max upload bytes
 * @keyword-cn 网盘上传上限
 */
const MAX_UPLOAD_BYTES = Number(
  process.env.NETDISK_MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024,
);

/**
 * @description 网盘控制器(v2)，租户网盘文件/文件夹增删改查、真实上传下载与容量管理，后台 JWT + CASL 鉴权
 * @keyword-en netdisk controller
 * @keyword-cn 网盘控制器
 */
@Controller('api/v2/netdisk')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
export class NetdiskController {
  constructor(private readonly netdiskService: NetdiskService) {}

  /**
   * @description 获取租户网盘根(容量/已用)
   * @keyword-en get disk root endpoint
   * @keyword-cn 获取网盘根端点
   */
  @RequirePermission('read', 'Netdisk')
  @Get('root')
  async getRoot(@Req() req: AdminRequest) {
    const root = await this.netdiskService.getRoot(this.requireUser(req));
    return { root };
  }

  /**
   * @description 设置租户网盘总容量
   * @keyword-en update disk root endpoint
   * @keyword-cn 设置网盘容量端点
   */
  @RequirePermission('update', 'Netdisk')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Patch('root')
  async updateRoot(@Req() req: AdminRequest, @Body() body: UpdateDiskRootDto) {
    const root = await this.netdiskService.updateRootCapacity(
      this.requireUser(req),
      body.capacityBytes,
    );
    return { root };
  }

  /**
   * @description 列出某作用域(租户级/工作区级 + 父文件夹)下的子节点
   * @keyword-en list nodes endpoint
   * @keyword-cn 列节点端点
   */
  @RequirePermission('read', 'Netdisk')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Get('nodes')
  async listNodes(@Req() req: AdminRequest, @Query() query: ListNodesQueryDto) {
    const nodes = await this.netdiskService.listNodes(this.requireUser(req), {
      workspaceId: query.workspaceId,
      parentId: query.parentId,
    });
    return { nodes };
  }

  /**
   * @description 创建文件夹
   * @keyword-en create folder endpoint
   * @keyword-cn 创建文件夹端点
   */
  @RequirePermission('create', 'Netdisk')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('folders')
  async createFolder(@Req() req: AdminRequest, @Body() body: CreateFolderDto) {
    const node = await this.netdiskService.createFolder(
      this.requireUser(req),
      body,
    );
    return { node };
  }

  /**
   * @description 上传文件(multipart，字段名 file)，落盘后按租户/工作区配额记账
   * @keyword-en upload file endpoint
   * @keyword-cn 上传文件端点
   */
  @RequirePermission('create', 'Netdisk')
  @Post('files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createNetdiskDiskStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async uploadFile(
    @Req() req: AdminRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadFileDto,
  ) {
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    const node = await this.netdiskService.finalizeUpload(
      this.requireUser(req),
      file,
      { workspaceId: body.workspaceId, parentId: body.parentId },
    );
    return { node };
  }

  /**
   * @description 下载文件
   * @keyword-en download file endpoint
   * @keyword-cn 下载文件端点
   */
  @RequirePermission('read', 'Netdisk')
  @Get('files/:id/download')
  async downloadFile(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { node, absPath } = await this.netdiskService.getFileForDownload(
      this.requireUser(req),
      id,
    );
    res.download(absPath, node.name);
  }

  /**
   * @description 重命名节点
   * @keyword-en rename node endpoint
   * @keyword-cn 重命名节点端点
   */
  @RequirePermission('update', 'Netdisk')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch('nodes/:id')
  async renameNode(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: RenameNodeDto,
  ) {
    const node = await this.netdiskService.renameNode(
      this.requireUser(req),
      id,
      body.name,
    );
    return { node };
  }

  /**
   * @description 删除节点(文件删物理文件回收配额，文件夹须为空)
   * @keyword-en delete node endpoint
   * @keyword-cn 删除节点端点
   */
  @RequirePermission('delete', 'Netdisk')
  @Delete('nodes/:id')
  async deleteNode(@Req() req: AdminRequest, @Param('id') id: string) {
    const ok = await this.netdiskService.deleteNode(this.requireUser(req), id);
    return { ok };
  }

  /**
   * @description 读取当前登录后台用户
   * @keyword-en read current admin user
   * @keyword-cn 读取当前用户
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    const user = req.adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
