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
import {
  DOUYIN_PERSONA_PERSPECTIVE_LABELS,
  DOUYIN_PERSONA_VIEW_SPECS,
} from '../entities/douyin-persona.entity.js';
import {
  CreateDouyinPersonaDto,
  DraftDouyinPersonaDto,
  UpdateDouyinPersonaDto,
} from './douyin-persona.dto.js';
import { DouyinPersonaGenerationService } from '../services/douyin-persona-generation.service.js';
import { DouyinPersonaRepositoryService } from '../services/douyin-persona-repository.service.js';

/**
 * @description 抖音预设人物的鉴权 HTTP 接口：后台管理端做增删改与形象图生成，工作台只读取列表供脚本选用。
 * @keyword-cn 预设人物接口, 人设管理接口
 * @keyword-en douyin-persona-controller, persona-management-api
 */
@Controller('api/douyin-persona')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class DouyinPersonaController {
  constructor(
    private readonly repository: DouyinPersonaRepositoryService,
    private readonly generation: DouyinPersonaGenerationService,
  ) {}

  /**
   * @description 查询本租户的预设人物列表，`includeArchived=1` 时连同已归档一起返回（后台管理页使用）。
   * @keyword-cn 查询预设人物接口, 人物列表
   * @keyword-en list-douyin-personas-api, persona-list
   */
  @Get()
  @RequirePermission('read', 'DouyinPersona')
  async list(
    @Req() req: AdminRequest,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const user = this.requireUser(req);
    return {
      personas: await this.repository.list(this.scopeOf(user), {
        includeArchived: includeArchived === '1' || includeArchived === 'true',
      }),
    };
  }

  /**
   * @description 返回叙事视角与三视图的登记表，供后台表单渲染下拉与说明文案，前后端取值同源。
   * @keyword-cn 人物选项接口, 视角登记表
   * @keyword-en persona-options-api, perspective-registry
   */
  @Get('options')
  @RequirePermission('read', 'DouyinPersona')
  options() {
    return {
      perspectives: Object.entries(DOUYIN_PERSONA_PERSPECTIVE_LABELS).map(
        ([key, value]) => ({ key, ...value }),
      ),
      views: DOUYIN_PERSONA_VIEW_SPECS.map(({ view, label }) => ({
        view,
        label,
      })),
    };
  }

  /**
   * @description 新建预设人物，形象图留空，保存后再单独触发三视图生成。
   * @keyword-cn 新建预设人物接口, 人设入库
   * @keyword-en create-douyin-persona-api, persist-persona
   */
  @Post()
  @RequirePermission('create', 'DouyinPersona')
  async create(@Req() req: AdminRequest, @Body() body: CreateDouyinPersonaDto) {
    const user = this.requireUser(req);
    return { persona: await this.repository.create(body, this.scopeOf(user)) };
  }

  /**
   * @description 让 LLM 按一句话需求写出人设草稿，草稿不入库，由管理员确认后再保存。
   * @keyword-cn AI生成人设接口, 人设草稿
   * @keyword-en draft-douyin-persona-api, persona-draft
   */
  @Post('draft')
  @RequirePermission('create', 'DouyinPersona')
  async draft(@Req() req: AdminRequest, @Body() body: DraftDouyinPersonaDto) {
    const user = this.requireUser(req);
    return {
      draft: await this.generation.draftPersona(body.brief, this.scopeOf(user)),
    };
  }

  /**
   * @description 更新人物设定或归档状态。
   * @keyword-cn 更新预设人物接口, 归档人物
   * @keyword-en update-douyin-persona-api, archive-persona
   */
  @Patch(':id')
  @RequirePermission('update', 'DouyinPersona')
  async update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: UpdateDouyinPersonaDto,
  ) {
    const user = this.requireUser(req);
    return {
      persona: await this.repository.update(
        this.readId(id),
        body,
        this.scopeOf(user),
      ),
    };
  }

  /**
   * @description 按人物外貌设定串行生成正面 / 侧身 / 特写三视图形象图并整组替换。
   * @keyword-cn 生成人物三视图接口, 形象一致
   * @keyword-en generate-reference-sheet-api, identity-consistency
   */
  @Post(':id/reference-sheet')
  @RequirePermission('update', 'DouyinPersona')
  async generateReferenceSheet(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ) {
    const user = this.requireUser(req);
    return {
      persona: await this.generation.generateReferenceSheet(
        this.readId(id),
        this.scopeOf(user),
      ),
    };
  }

  /**
   * @description 删除一个预设人物。
   * @keyword-cn 删除预设人物接口, 移除人设
   * @keyword-en delete-douyin-persona-api, remove-persona
   */
  @Delete(':id')
  @RequirePermission('delete', 'DouyinPersona')
  async remove(@Req() req: AdminRequest, @Param('id') id: string) {
    const user = this.requireUser(req);
    return this.repository.remove(this.readId(id), this.scopeOf(user));
  }

  /**
   * @description 解析并校验路由中的正整数人物 ID。
   * @keyword-cn 解析人物ID, 路由校验
   * @keyword-en parse-persona-id, route-validation
   */
  private readId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('DOUYIN_PERSONA_ID_INVALID');
    }
    return id;
  }

  /**
   * @description 读取登录用户，未登录直接拒绝。
   * @keyword-cn 读取登录用户, 拒绝匿名
   * @keyword-en require-admin-user, reject-anonymous
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }

  /**
   * @description 把当前用户转换成仓储使用的租户用户作用域。
   * @keyword-cn 构造人物作用域, 租户边界
   * @keyword-en build-persona-scope, tenant-boundary
   */
  private scopeOf(user: AdminUserEntity) {
    return { tenantId: user.tenantId, userId: String(user._id) };
  }
}
