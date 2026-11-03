import {
  Body,
  Controller,
  Get,
  Put,
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
import { ModelConcurrencyService } from '../services/model-concurrency.service.js';
import { SetModelConcurrencyLimitDto } from './model-concurrency.dto.js';

/**
 * @description 平台后台「模型并发上限」接口：查看各模型的上限、正在跑与排队的数量，按提供商 + 模型设置或清除上限。
 *   属于平台 AI 提供商配置，权限主体沿用 `AiProvider`（仅超管）。
 * @keyword-cn 模型并发后台接口, 平台配置
 * @keyword-en model-concurrency-admin-controller, platform-setting
 */
@Controller('admin/model-concurrency')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ModelConcurrencyAdminController {
  constructor(private readonly concurrency: ModelConcurrencyService) {}

  /**
   * @description 列出设了上限、正在跑或排队的模型。
   * @keyword-cn 模型并发列表接口, 排队数量
   * @keyword-en list-model-concurrency-api, waiting-count
   */
  @RequirePermission('read', ADMIN_SUBJECTS.AiProvider)
  @Get()
  async list() {
    return { items: await this.concurrency.overview() };
  }

  /**
   * @description 设置或清除一个模型的并发上限，返回最新列表。
   * @keyword-cn 设置并发上限接口, 清除上限
   * @keyword-en set-model-concurrency-api, clear-limit
   */
  @RequirePermission('update', ADMIN_SUBJECTS.AiProvider)
  @Put()
  async save(
    @Req() req: AdminRequest,
    @Body() body: SetModelConcurrencyLimitDto,
  ) {
    const user = this.requireUser(req);
    await this.concurrency.setLimit(
      { providerId: body.providerId, model: body.model },
      body.limit ?? null,
      String(user._id),
    );
    return { items: await this.concurrency.overview() };
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
