import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { TenantCredentialService } from '../services/tenant-credential.service.js';
import {
  UpdateFeishuCredentialDto,
  UpsertFeishuCredentialDto,
} from './tenant-credential.dto.js';

/**
 * @description 租户飞书凭证后台控制器（挂载于 /admin/tenant-feishu-credentials）
 * @keyword-en tenant feishu credential admin controller, crud
 */
@Controller('admin/tenant-feishu-credentials')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
)
export class TenantCredentialAdminController {
  constructor(private readonly service: TenantCredentialService) {}

  /**
   * @description 列出当前用户可见的飞书凭证
   * @keyword-en list feishu credentials
   */
  @UseGuards(AdminAuthGuard)
  @Get()
  async list(@Req() req: Request) {
    const credentials = await this.service.list(this.requireUser(req));
    return { credentials };
  }

  /**
   * @description Upsert 飞书凭证
   * @keyword-en upsert feishu credential endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Post()
  async upsert(@Req() req: Request, @Body() body: UpsertFeishuCredentialDto) {
    const credential = await this.service.upsert(this.requireUser(req), body);
    return { credential };
  }

  /**
   * @description 更新飞书凭证
   * @keyword-en update feishu credential endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateFeishuCredentialDto,
  ) {
    const credential = await this.service.update(
      this.requireUser(req),
      id,
      body,
    );
    return { credential };
  }

  /**
   * @description 删除飞书凭证
   * @keyword-en delete feishu credential endpoint
   */
  @UseGuards(AdminAuthGuard)
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const ok = await this.service.delete(this.requireUser(req), id);
    return { ok };
  }

  /**
   * @description 取登录用户
   * @keyword-en require admin user
   */
  private requireUser(req: Request) {
    const user = (req as AdminRequest).adminUser;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    return user;
  }
}
