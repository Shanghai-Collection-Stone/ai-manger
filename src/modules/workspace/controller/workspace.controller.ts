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
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { WorkspaceService } from '../services/workspace.service.js';
import {
  AddWorkspaceMemberDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  UpdateWorkspaceMemberDto,
} from './workspace.dto.js';

/**
 * @description 工作区控制器(v2)，工作区 CRUD 与成员管理，后台 JWT + CASL 鉴权，租户隔离
 * @keyword-en workspace controller
 * @keyword-cn 工作区控制器
 */
@Controller('api/v2/workspaces')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  /**
   * @description 工作区列表
   * @keyword-en list workspaces endpoint
   * @keyword-cn 工作区列表端点
   */
  @RequirePermission('read', 'Workspace')
  @Get()
  async list(@Req() req: AdminRequest) {
    const workspaces = await this.workspaceService.list(this.requireUser(req));
    return { workspaces };
  }

  /**
   * @description 创建工作区
   * @keyword-en create workspace endpoint
   * @keyword-cn 创建工作区端点
   */
  @RequirePermission('create', 'Workspace')
  @Post()
  async create(@Req() req: AdminRequest, @Body() body: CreateWorkspaceDto) {
    const workspace = await this.workspaceService.create(
      this.requireUser(req),
      body,
    );
    return { workspace };
  }

  /**
   * @description 获取工作区详情
   * @keyword-en get workspace endpoint
   * @keyword-cn 获取工作区端点
   */
  @RequirePermission('read', 'Workspace')
  @Get(':id')
  async get(@Req() req: AdminRequest, @Param('id') id: string) {
    const workspace = await this.workspaceService.get(this.requireUser(req), id);
    return { workspace };
  }

  /**
   * @description 更新工作区(名称/描述/容量)
   * @keyword-en update workspace endpoint
   * @keyword-cn 更新工作区端点
   */
  @RequirePermission('update', 'Workspace')
  @Patch(':id')
  async update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: UpdateWorkspaceDto,
  ) {
    const workspace = await this.workspaceService.update(
      this.requireUser(req),
      id,
      body,
    );
    return { workspace };
  }

  /**
   * @description 删除工作区
   * @keyword-en delete workspace endpoint
   * @keyword-cn 删除工作区端点
   */
  @RequirePermission('delete', 'Workspace')
  @Delete(':id')
  async remove(@Req() req: AdminRequest, @Param('id') id: string) {
    const ok = await this.workspaceService.remove(this.requireUser(req), id);
    return { ok };
  }

  /**
   * @description 工作区成员列表
   * @keyword-en list workspace members endpoint
   * @keyword-cn 成员列表端点
   */
  @RequirePermission('read', 'Workspace')
  @Get(':id/members')
  async listMembers(@Req() req: AdminRequest, @Param('id') id: string) {
    const members = await this.workspaceService.listMembers(
      this.requireUser(req),
      id,
    );
    return { members };
  }

  /**
   * @description 添加工作区成员
   * @keyword-en add workspace member endpoint
   * @keyword-cn 添加成员端点
   */
  @RequirePermission('update', 'Workspace')
  @Post(':id/members')
  async addMember(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: AddWorkspaceMemberDto,
  ) {
    const member = await this.workspaceService.addMember(
      this.requireUser(req),
      id,
      body,
    );
    return { member };
  }

  /**
   * @description 更新工作区成员角色
   * @keyword-en update workspace member endpoint
   * @keyword-cn 更新成员端点
   */
  @RequirePermission('update', 'Workspace')
  @Patch(':id/members/:userId')
  async updateMember(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: UpdateWorkspaceMemberDto,
  ) {
    const member = await this.workspaceService.updateMember(
      this.requireUser(req),
      id,
      userId,
      body.role,
    );
    return { member };
  }

  /**
   * @description 移除工作区成员
   * @keyword-en remove workspace member endpoint
   * @keyword-cn 移除成员端点
   */
  @RequirePermission('update', 'Workspace')
  @Delete(':id/members/:userId')
  async removeMember(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    const ok = await this.workspaceService.removeMember(
      this.requireUser(req),
      id,
      userId,
    );
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
