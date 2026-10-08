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
import type { DouyinPublishScope } from '../entities/douyin-publish.entity.js';
import { DouyinPublishLibraryService } from '../services/douyin-publish-library.service.js';
import { DouyinPublishWorkService } from '../services/douyin-publish-work.service.js';
import {
  CreateDouyinPublishLibraryDto,
  CreateDouyinPublishWorkDto,
  UpdateDouyinPublishLibraryDto,
  UpdateDouyinPublishWorkDto,
} from './douyin-publish.dto.js';

/**
 * @description 抖音视频发布库管理端接口，统一使用 DouyinWorkbench 权限主体。
 * @keyword-cn 发布库管理接口, 管理端鉴权
 * @keyword-en publish-admin-controller, admin-authorization
 */
@Controller('api/douyin-publish')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class DouyinPublishController {
  constructor(
    private readonly libraries: DouyinPublishLibraryService,
    private readonly works: DouyinPublishWorkService,
  ) {}

  /**
   * @description 列出当前用户全部视频发布库及聚合统计。
   * @keyword-cn 发布库列表接口
   * @keyword-en list-publish-libraries-endpoint
   */
  @Get('libraries')
  @RequirePermission('read', 'DouyinWorkbench')
  async listLibraries(@Req() req: AdminRequest) {
    return {
      items: await this.libraries.list(this.scopeOf(this.requireUser(req))),
    };
  }

  /**
   * @description 新建视频发布库。
   * @keyword-cn 新建发布库接口
   * @keyword-en create-publish-library-endpoint
   */
  @Post('libraries')
  @RequirePermission('create', 'DouyinWorkbench')
  async createLibrary(
    @Body() body: CreateDouyinPublishLibraryDto,
    @Req() req: AdminRequest,
  ) {
    return {
      library: await this.libraries.create(
        body.name,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 更新视频发布库名称。
   * @keyword-cn 更新发布库接口
   * @keyword-en update-publish-library-endpoint
   */
  @Patch('libraries/:id')
  @RequirePermission('update', 'DouyinWorkbench')
  async updateLibrary(
    @Param('id') id: string,
    @Body() body: UpdateDouyinPublishLibraryDto,
    @Req() req: AdminRequest,
  ) {
    return {
      library: await this.libraries.update(
        id,
        body.name,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 删除空的视频发布库。
   * @keyword-cn 删除发布库接口
   * @keyword-en delete-publish-library-endpoint
   */
  @Delete('libraries/:id')
  @RequirePermission('delete', 'DouyinWorkbench')
  async deleteLibrary(@Param('id') id: string, @Req() req: AdminRequest) {
    await this.libraries.remove(id, this.scopeOf(this.requireUser(req)));
    return { ok: true };
  }

  /**
   * @description 获取发布库扫码入口 token、path 和二维码内容。
   * @keyword-cn 发布二维码接口
   * @keyword-en publish-qr-endpoint
   */
  @Get('libraries/:id/qr')
  @RequirePermission('read', 'DouyinWorkbench')
  async getLibraryQr(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.libraries.getQr(id, this.scopeOf(this.requireUser(req)));
  }

  /**
   * @description 分页列出发布库作品及库统计。
   * @keyword-cn 发布作品列表接口
   * @keyword-en list-publish-works-endpoint
   */
  @Get('libraries/:id/works')
  @RequirePermission('read', 'DouyinWorkbench')
  async listWorks(
    @Param('id') id: string,
    @Query('status') status: string | undefined,
    @Query('keyword') keyword: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AdminRequest,
  ) {
    const normalizedStatus = status || 'unpublished';
    if (!['unpublished', 'published'].includes(normalizedStatus)) {
      throw new BadRequestException('DOUYIN_PUBLISH_STATUS_INVALID');
    }
    return this.works.list(
      id,
      {
        status: normalizedStatus as 'unpublished' | 'published',
        keyword,
        page: this.positiveInteger(page, 1, 1, Number.MAX_SAFE_INTEGER),
        pageSize: this.positiveInteger(pageSize, 20, 1, 100),
      },
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 从当前租户视频库快照创建发布作品。
   * @keyword-cn 作品入库接口
   * @keyword-en create-publish-work-endpoint
   */
  @Post('libraries/:id/works')
  @RequirePermission('create', 'DouyinWorkbench')
  async createWork(
    @Param('id') id: string,
    @Body() body: CreateDouyinPublishWorkDto,
    @Req() req: AdminRequest,
  ) {
    return {
      work: await this.works.create(
        id,
        body,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 批量查询选题所在作品与发布库。
   * @keyword-cn 选题位置接口
   * @keyword-en topic-locations-endpoint
   */
  @Get('works/locations')
  @RequirePermission('read', 'DouyinWorkbench')
  async getLocations(
    @Query('topicIds') topicIds: string | undefined,
    @Req() req: AdminRequest,
  ) {
    const ids = Array.from(
      new Set(
        String(topicIds ?? '')
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );
    return {
      items: ids.length
        ? await this.works.locations(ids, this.scopeOf(this.requireUser(req)))
        : [],
    };
  }

  /**
   * @description 更新作品文案或移动到另一个发布库。
   * @keyword-cn 更新发布作品接口, 换库接口
   * @keyword-en update-publish-work-endpoint, move-library-endpoint
   */
  @Patch('works/:id')
  @RequirePermission('update', 'DouyinWorkbench')
  async updateWork(
    @Param('id') id: string,
    @Body() body: UpdateDouyinPublishWorkDto,
    @Req() req: AdminRequest,
  ) {
    return {
      work: await this.works.update(
        id,
        body,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 删除没有有效租约的发布作品。
   * @keyword-cn 删除发布作品接口
   * @keyword-en delete-publish-work-endpoint
   */
  @Delete('works/:id')
  @RequirePermission('delete', 'DouyinWorkbench')
  async deleteWork(@Param('id') id: string, @Req() req: AdminRequest) {
    await this.works.remove(id, this.scopeOf(this.requireUser(req)));
    return { ok: true };
  }

  /**
   * @description 从后台鉴权上下文读取当前用户。
   * @keyword-cn 读取发布用户
   * @keyword-en read-publish-user
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }

  /**
   * @description 把后台用户转换成与抖音工作台一致的租户用户作用域。
   * @keyword-cn 构造发布作用域
   * @keyword-en build-publish-scope
   */
  private scopeOf(user: AdminUserEntity): DouyinPublishScope {
    return { tenantId: user.tenantId, userId: String(user._id) };
  }

  /**
   * @description 解析带上下界的正整数查询参数。
   * @keyword-cn 分页参数解析
   * @keyword-en parse-pagination-integer
   */
  private positiveInteger(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException('DOUYIN_PUBLISH_PAGINATION_INVALID');
    }
    return parsed;
  }
}
