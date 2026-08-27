import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ADMIN_SUBJECTS } from '../../admin/casl/admin-permission.constants.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { BrowserAuthInteractionService } from '../services/browser-auth-interaction.service.js';
import { RespondBrowserAuthInteractionDto } from './browser-auth-interaction.dto.js';

/**
 * @description 浏览器认证任务的人机交互控制器，向任务卡片提供扫码和短对话窗口。
 * @keyword-cn 任务交互控制器, 登录窗口
 * @keyword-en task-interaction-controller, login-window
 */
@Controller('task-interactions')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
export class BrowserAuthInteractionController {
  constructor(private readonly interactions: BrowserAuthInteractionService) {}

  /**
   * @description 获取指定 Todo 当前等待处理的扫码或短文本交互。
   * @keyword-cn 获取待处理交互, 任务窗口
   * @keyword-en get-pending-interaction, task-window
   */
  @Get('todo/:todoId/active')
  @RequirePermission('read', ADMIN_SUBJECTS.WorkspaceTask)
  async getActive(@Req() req: AdminRequest, @Param('todoId') todoId: string) {
    return this.interactions.getActiveForUser(
      this.requireUser(req),
      Number(todoId),
    );
  }

  /**
   * @description 提交扫码确认或简短文本，并触发原任务恢复执行。
   * @keyword-cn 回复任务交互, 恢复任务
   * @keyword-en respond-task-interaction, resume-task
   */
  @Post(':id/respond')
  @RequirePermission('update', ADMIN_SUBJECTS.WorkspaceTask)
  async respond(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: RespondBrowserAuthInteractionDto,
  ) {
    return {
      interaction: await this.interactions.respond(
        this.requireUser(req),
        id,
        body.response,
      ),
    };
  }

  /**
   * @description 从后台鉴权上下文读取当前用户。
   * @keyword-cn 读取交互用户, 鉴权上下文
   * @keyword-en read-interaction-user, auth-context
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }
}
