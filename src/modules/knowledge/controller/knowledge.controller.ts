import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import type { KnowledgeScope } from '../entities/knowledge.entity.js';
import { KnowledgeService } from '../services/knowledge.service.js';
import { CreateKnowledgeDto, UpdateKnowledgeDto } from './knowledge.dto.js';

/**
 * @description 引用知识管理接口，小红书与抖音工作台共用，统一挂 Knowledge 权限主体。
 * @keyword-cn 引用知识接口, 管理端鉴权
 * @keyword-en knowledge-controller, admin-authorization
 */
@Controller('api/knowledge')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /**
   * @description 列出本租户引用知识，`keyword` 同时搜名称与内容。
   * @keyword-cn 查询引用知识接口
   * @keyword-en list-knowledge-endpoint
   */
  @Get()
  @RequirePermission('read', 'Knowledge')
  async list(
    @Query('keyword') keyword: string | undefined,
    @Req() req: AdminRequest,
  ) {
    return {
      items: await this.knowledge.list(
        keyword,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 新建引用知识。
   * @keyword-cn 新建引用知识接口
   * @keyword-en create-knowledge-endpoint
   */
  @Post()
  @RequirePermission('create', 'Knowledge')
  async create(@Body() body: CreateKnowledgeDto, @Req() req: AdminRequest) {
    return {
      item: await this.knowledge.create(
        body,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 修改引用知识名称或内容。
   * @keyword-cn 修改引用知识接口
   * @keyword-en update-knowledge-endpoint
   */
  @Patch(':id')
  @RequirePermission('update', 'Knowledge')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateKnowledgeDto,
    @Req() req: AdminRequest,
  ) {
    return {
      item: await this.knowledge.update(
        id,
        body,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 删除引用知识。
   * @keyword-cn 删除引用知识接口
   * @keyword-en delete-knowledge-endpoint
   */
  @Delete(':id')
  @RequirePermission('delete', 'Knowledge')
  async remove(@Param('id') id: string, @Req() req: AdminRequest) {
    await this.knowledge.remove(id, this.scopeOf(this.requireUser(req)));
    return { ok: true };
  }

  /**
   * @description 从后台鉴权上下文读取当前用户。
   * @keyword-cn 读取知识接口用户
   * @keyword-en read-knowledge-user
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }

  /**
   * @description 把后台用户转换成租户用户作用域。
   * @keyword-cn 构造知识作用域
   * @keyword-en build-knowledge-scope
   */
  private scopeOf(user: AdminUserEntity): KnowledgeScope {
    return { tenantId: user.tenantId, userId: String(user._id) };
  }
}
