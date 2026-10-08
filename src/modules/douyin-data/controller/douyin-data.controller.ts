import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
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
import type { DouyinDataScope } from '../entities/douyin-data.entity.js';
import { DouyinDataCrawlService } from '../services/douyin-data-crawl.service.js';
import { DouyinDataService } from '../services/douyin-data.service.js';
import {
  BindDouyinDataLinkDto,
  CreateDouyinDataManualLinkDto,
  SetDouyinDataMonitorDto,
} from './douyin-data.dto.js';

/**
 * @description 抖音作品数据监控接口，与抖音工作台、发布库统一使用 DouyinWorkbench 权限主体。
 * @keyword-cn 抖音数据监控接口, 管理端鉴权
 * @keyword-en douyin-data-controller, admin-authorization
 */
@Controller('api/douyin-data')
@UseGuards(AdminAuthGuard, AdminPoliciesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class DouyinDataController {
  constructor(
    private readonly data: DouyinDataService,
    private readonly crawler: DouyinDataCrawlService,
  ) {}

  /**
   * @description 列出发布库已发布作品及其监控状态和区间指标；start / end 为 ISO 时间，缺省为全部区间。
   * @keyword-cn 数据监控作品列表接口
   * @keyword-en list-monitor-works-endpoint
   */
  @Get('libraries/:libraryId/works')
  @RequirePermission('read', 'DouyinWorkbench')
  async listWorks(
    @Param('libraryId') libraryId: string,
    @Query('start') start: string | undefined,
    @Query('end') end: string | undefined,
    @Req() req: AdminRequest,
  ) {
    return this.data.listLibraryWorks(
      libraryId,
      { start: this.parseTime(start), end: this.parseTime(end) },
      this.scopeOf(this.requireUser(req)),
    );
  }

  /**
   * @description 开启或取消一个已发布作品的数据监控。
   * @keyword-cn 监控开关接口
   * @keyword-en set-monitor-endpoint
   */
  @Post('works/:workId/monitor')
  @RequirePermission('update', 'DouyinWorkbench')
  async setMonitor(
    @Param('workId') workId: string,
    @Body() body: SetDouyinDataMonitorDto,
    @Req() req: AdminRequest,
  ) {
    return {
      monitor: await this.data.setMonitoring(
        workId,
        body.monitoring,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 给作品绑定抖音作品链接，解析出的作品 ID 用于抓取。
   * @keyword-cn 绑定作品链接接口
   * @keyword-en bind-work-link-endpoint
   */
  @Put('works/:workId/link')
  @RequirePermission('update', 'DouyinWorkbench')
  async bindLink(
    @Param('workId') workId: string,
    @Body() body: BindDouyinDataLinkDto,
    @Req() req: AdminRequest,
  ) {
    return {
      monitor: await this.data.bindLink(
        workId,
        body.url,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 对监控中的作品立即抓取一次。
   * @keyword-cn 立即抓取接口
   * @keyword-en crawl-now-endpoint
   */
  @Post('works/:workId/crawl-now')
  @RequirePermission('create', 'DouyinWorkbench')
  async crawlNow(@Param('workId') workId: string, @Req() req: AdminRequest) {
    return this.crawler.crawlNow(workId, this.scopeOf(this.requireUser(req)));
  }

  /**
   * @description 按抖音链接在发布库新增一条已发布作品并直接开启监控。
   * @keyword-cn 新增链接接口
   * @keyword-en create-manual-link-endpoint
   */
  @Post('manual-links')
  @RequirePermission('create', 'DouyinWorkbench')
  async createManualLink(
    @Body() body: CreateDouyinDataManualLinkDto,
    @Req() req: AdminRequest,
  ) {
    return {
      item: await this.data.createManualLink(
        body,
        this.scopeOf(this.requireUser(req)),
      ),
    };
  }

  /**
   * @description 从后台鉴权上下文读取当前用户。
   * @keyword-cn 读取数据监控用户
   * @keyword-en read-data-monitor-user
   */
  private requireUser(req: AdminRequest): AdminUserEntity {
    if (!req.adminUser) throw new UnauthorizedException('UNAUTHORIZED');
    return req.adminUser;
  }

  /**
   * @description 把后台用户转换成与抖音发布库一致的租户用户作用域。
   * @keyword-cn 构造数据监控作用域
   * @keyword-en build-data-monitor-scope
   */
  private scopeOf(user: AdminUserEntity): DouyinDataScope {
    return { tenantId: user.tenantId, userId: String(user._id) };
  }

  /**
   * @description 解析 ISO 时间查询参数，空值返回 undefined，非法值 400。
   * @keyword-cn 解析区间时间
   * @keyword-en parse-range-time
   */
  private parseTime(value: string | undefined): Date | undefined {
    if (value === undefined || value === '') return undefined;
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) {
      throw new BadRequestException('DOUYIN_DATA_RANGE_INVALID');
    }
    return time;
  }
}
