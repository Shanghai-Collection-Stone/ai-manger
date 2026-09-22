import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ADMIN_SUBJECTS } from '../../admin/casl/admin-permission.constants.js';
import { RequirePermission } from '../../admin/decorators/require-permission.decorator.js';
import type { AdminUserEntity } from '../../admin/entities/admin.entity.js';
import { AdminAuthGuard } from '../../admin/guards/admin-auth.guard.js';
import { AdminPoliciesGuard } from '../../admin/guards/policies.guard.js';
import type { AdminRequest } from '../../admin/types/admin-request.types.js';
import { WorkflowModelService } from '../services/workflow-model.service.js';
import {
  ListWorkflowProviderModelsDto,
  SaveWorkflowNodeModelDto,
} from './workflow-model.dto.js';

/**
 * @description 平台后台「工作流节点模型」接口：查看预设工作流节点、为节点指定提供商与模型、查询可选模型。
 *   属于平台 AI 提供商配置，权限主体沿用 `AiProvider`。
 * @keyword-cn 节点模型后台接口, 平台配置
 * @keyword-en workflow-model-admin-controller, platform-setting
 */
@Controller('admin/workflow-models')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class WorkflowModelAdminController {
  constructor(private readonly workflowModels: WorkflowModelService) {}

  /**
   * @description 列出预设工作流、节点设置与可选提供商。
   * @keyword-cn 节点模型列表接口, 工作流目录
   * @keyword-en list-workflow-models-api, workflow-catalog
   */
  @RequirePermission('read', ADMIN_SUBJECTS.AiProvider)
  @Get()
  async list(@Req() req: AdminRequest) {
    return this.workflowModels.list(this.requireUser(req));
  }

  /**
   * @description 查询某提供商在指定节点类型下可选的模型。
   * @keyword-cn 可选模型接口, PixMax模型列表, 数眼可选模型
   * @keyword-en list-provider-models-api, pixmax-model-list, shuyan-model-list
   */
  @RequirePermission('read', ADMIN_SUBJECTS.AiProvider)
  @Get('providers/:providerId/models')
  async listProviderModels(
    @Param('providerId') providerId: string,
    @Query() query: ListWorkflowProviderModelsDto,
  ) {
    return this.workflowModels.listProviderModels(providerId, query.category);
  }

  /**
   * @description 为节点保存提供商与模型。
   * @keyword-cn 保存节点模型接口, 指定模型
   * @keyword-en save-node-model-api, assign-model
   */
  @RequirePermission('update', ADMIN_SUBJECTS.AiProvider)
  @Put(':workflowKey/nodes/:nodeKey')
  async save(
    @Req() req: AdminRequest,
    @Param('workflowKey') workflowKey: string,
    @Param('nodeKey') nodeKey: string,
    @Body() body: SaveWorkflowNodeModelDto,
  ) {
    return this.workflowModels.saveNode(
      this.requireUser(req),
      workflowKey,
      nodeKey,
      body,
    );
  }

  /**
   * @description 清除节点设置，回到默认提供商。
   * @keyword-cn 重置节点模型接口, 回退默认
   * @keyword-en reset-node-model-api, fallback-default
   */
  @RequirePermission('update', ADMIN_SUBJECTS.AiProvider)
  @Delete(':workflowKey/nodes/:nodeKey')
  async reset(
    @Req() req: AdminRequest,
    @Param('workflowKey') workflowKey: string,
    @Param('nodeKey') nodeKey: string,
  ) {
    return this.workflowModels.resetNode(
      this.requireUser(req),
      workflowKey,
      nodeKey,
    );
  }

  /**
   * @description 从鉴权请求读取当前后台用户。
   * @keyword-cn 读取后台用户, 鉴权上下文
   * @keyword-en read-admin-user, auth-context
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }
}
